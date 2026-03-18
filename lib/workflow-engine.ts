import { query } from "@anthropic-ai/claude-agent-sdk";
import { v4 as uuidv4 } from "uuid";
import {
  getWorkflow,
  getWorkflowSteps,
  updateWorkflow,
  updateWorkflowStep,
  createWorkflowStep,
  getDb,
} from "./db";
import type { Project, WorkflowStepRow } from "./db";

const BROWSER_INSTRUCTIONS_WORKFLOW = `

--- Tarayıcı Aracı ---
Web sayfalarını kontrol etmek için Bash ile browser-cli kullanabilirsin:
  node scripts/browser-cli.mjs open <url>         — Sayfa aç
  node scripts/browser-cli.mjs get-elements        — İnteraktif elementleri listele
  node scripts/browser-cli.mjs click "<selector>"  — Tıkla
  node scripts/browser-cli.mjs fill "<selector>" <değer> — Form doldur
  node scripts/browser-cli.mjs get-text            — Sayfa metnini al
  node scripts/browser-cli.mjs navigate <url>      — Başka sayfaya git
  node scripts/browser-cli.mjs screenshot          — Screenshot al
  node scripts/browser-cli.mjs close               — Tarayıcıyı kapat
`;

// --- In-memory log pub/sub (same pattern as claude-agent.ts) ---
const MAX_WORKFLOW_LOGS = 2000;
const MAX_WORKFLOW_LOG_ENTRIES = 20;
const workflowLogs = new Map<string, string[]>();
const workflowListeners = new Map<string, Set<(line: string) => void>>();
const runningWorkflows = new Map<string, AbortController>();

/** Clean up old workflow log entries */
function pruneOldWorkflowLogs() {
  if (workflowLogs.size <= MAX_WORKFLOW_LOG_ENTRIES) return;
  const runningIds = new Set(runningWorkflows.keys());
  const completedEntries = [...workflowLogs.keys()].filter((id) => !runningIds.has(id));
  const toRemove = completedEntries.length - MAX_WORKFLOW_LOG_ENTRIES;
  if (toRemove > 0) {
    for (let i = 0; i < toRemove; i++) {
      workflowLogs.delete(completedEntries[i]);
      workflowListeners.delete(completedEntries[i]);
    }
  }
}

export function getWorkflowLogs(workflowId: string): string[] {
  return workflowLogs.get(workflowId) ?? [];
}

export function subscribeToWorkflow(workflowId: string, listener: (line: string) => void): () => void {
  if (!workflowListeners.has(workflowId)) {
    workflowListeners.set(workflowId, new Set());
  }
  workflowListeners.get(workflowId)!.add(listener);
  return () => {
    const listeners = workflowListeners.get(workflowId);
    listeners?.delete(listener);
    if (listeners?.size === 0) {
      workflowListeners.delete(workflowId);
    }
  };
}

function pushLog(workflowId: string, line: string) {
  if (!workflowLogs.has(workflowId)) {
    workflowLogs.set(workflowId, []);
  }
  const logs = workflowLogs.get(workflowId)!;
  logs.push(line);
  if (logs.length > MAX_WORKFLOW_LOGS) {
    logs.splice(0, logs.length - MAX_WORKFLOW_LOGS);
  }
  workflowListeners.get(workflowId)?.forEach((fn) => fn(line));
}

export function isWorkflowRunning(workflowId: string): boolean {
  return runningWorkflows.has(workflowId);
}

// --- Agent query helper (reusable for coordinator and steps) ---
interface QueryResult {
  text: string;
  cost: number;
  duration: number;
}

async function runQueryAgent(
  workflowId: string,
  prefix: string,
  prompt: string,
  projectPath: string,
  allowedTools: string[],
  maxTurns: number,
  abortController: AbortController
): Promise<QueryResult> {
  let resultText = "";
  let lastAssistantText = "";
  let cost = 0;
  let duration = 0;

  const session = query({
    prompt,
    options: {
      cwd: projectPath,
      allowedTools,
      maxTurns,
      abortController,
      permissionMode: "bypassPermissions",
    },
  });

  for await (const message of session) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const msg = message as any;

    if (msg.type === "assistant") {
      const content = msg.message?.content ?? msg.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === "text" && block.text) {
            pushLog(workflowId, `${prefix} [assistant] ${block.text}`);
            lastAssistantText = block.text;
          } else if (block.type === "tool_use") {
            pushLog(workflowId, `${prefix} [tool] ${block.name}: ${JSON.stringify(block.input).slice(0, 200)}`);
          }
        }
      }
    } else if (msg.type === "result") {
      cost = msg.total_cost_usd ?? 0;
      duration = msg.duration_ms ?? 0;
      resultText = msg.result ?? lastAssistantText;
      pushLog(workflowId, `${prefix} [result] Maliyet: $${cost.toFixed(4)}, Süre: ${duration}ms`);
    }
  }

  return { text: resultText || lastAssistantText, cost, duration };
}

// --- Coordinator: Plan phase ---

interface PlanStep {
  role: string;
  title: string;
  prompt: string;
  depends_on_indices: number[];
}

function extractJSON(text: string): unknown | null {
  // Try to find a JSON block in the response
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    try { return JSON.parse(jsonMatch[1].trim()); } catch { /* ignore */ }
  }
  // Try to find raw JSON object
  const braceMatch = text.match(/\{[\s\S]*"steps"[\s\S]*\}/);
  if (braceMatch) {
    try { return JSON.parse(braceMatch[0]); } catch { /* ignore */ }
  }
  return null;
}

async function runCoordinatorPlan(
  workflowId: string,
  projectPath: string,
  description: string,
  allowedTools: string[],
  maxTurns: number,
  abortController: AbortController
): Promise<boolean> {
  updateWorkflow(workflowId, { status: "planning" });
  pushLog(workflowId, `[koordinatör] Görev analiz ediliyor ve plan oluşturuluyor...`);

  const prompt = `Sen bir Koordinatör Agent'sın. Aşağıdaki hedefi analiz et ve bağımsız alt adımlara böl.
Her adım ayrı bir Claude agent tarafından yürütülecek. Adımlar mümkünse paralel çalışabilir.

ÖNEMLİ: Yanıtını SADECE JSON formatında ver, başka açıklama ekleme.

JSON formatı:
\`\`\`json
{
  "steps": [
    {
      "role": "string - adımın rolü (ör: backend, frontend, test, docs, refactor)",
      "title": "string - kısa Türkçe başlık",
      "prompt": "string - agent'a verilecek detaylı Türkçe talimat",
      "depends_on_indices": [number] - bu adımdan önce tamamlanması gereken adım indeksleri (0-indexed), bağımsızsa boş dizi []
    }
  ]
}
\`\`\`

Hedef:
${description}`;

  try {
    const result = await runQueryAgent(
      workflowId, "[koordinatör]", prompt, projectPath, allowedTools, maxTurns, abortController
    );

    const parsed = extractJSON(result.text) as { steps?: PlanStep[] } | null;
    if (!parsed?.steps || !Array.isArray(parsed.steps) || parsed.steps.length === 0) {
      pushLog(workflowId, `[koordinatör] Plan parse edilemedi. Agent yanıtı:\n${result.text.slice(0, 500)}`);
      updateWorkflow(workflowId, { status: "error" });
      return false;
    }

    // Create workflow steps from plan
    const stepIds: string[] = [];
    for (let i = 0; i < parsed.steps.length; i++) {
      const s = parsed.steps[i];
      const stepId = uuidv4();
      stepIds.push(stepId);

      const dependsOnIds = (s.depends_on_indices ?? [])
        .filter((idx: number) => idx >= 0 && idx < i)
        .map((idx: number) => stepIds[idx]);

      createWorkflowStep({
        id: stepId,
        workflow_id: workflowId,
        role: s.role || `step-${i}`,
        title: s.title || `Adım ${i + 1}`,
        prompt: s.prompt || "",
        depends_on: JSON.stringify(dependsOnIds),
        order_index: i,
      });
    }

    updateWorkflow(workflowId, { plan: JSON.stringify(parsed), status: "running" });
    pushLog(workflowId, `[koordinatör] Plan oluşturuldu: ${parsed.steps.length} adım`);
    for (const s of parsed.steps) {
      pushLog(workflowId, `[koordinatör]   → [${s.role}] ${s.title}`);
    }
    return true;
  } catch (err) {
    if (abortController.signal.aborted) return false;
    pushLog(workflowId, `[koordinatör] [error] ${err instanceof Error ? err.message : String(err)}`);
    updateWorkflow(workflowId, { status: "error" });
    return false;
  }
}

// --- Step execution with dependency resolution ---

async function executeWorkflowSteps(
  workflowId: string,
  projectPath: string,
  allowedTools: string[],
  maxTurns: number,
  abortController: AbortController,
  buildCommand?: string,
  testCommand?: string,
  customInstructions?: string,
  preTaskCommand?: string
): Promise<boolean> {
  const MAX_CONCURRENT = 3;

  const runStep = async (step: WorkflowStepRow) => {
    if (abortController.signal.aborted) return;

    updateWorkflowStep(step.id, { status: "running" });
    pushLog(workflowId, `[${step.role}] Adım başlatılıyor: ${step.title}`);

    // Build prompt with shared memory context
    const wf = getWorkflow(workflowId);
    const sharedMemory = wf?.shared_memory ?? "{}";
    const memoryObj = JSON.parse(sharedMemory);
    const hasMemory = Object.keys(memoryObj).length > 0;

    let fullPrompt = "";

    // Custom instructions
    if (customInstructions?.trim()) {
      fullPrompt += `--- Proje Talimatları ---\n${customInstructions}\n\n`;
    }

    // Pre-task command
    if (preTaskCommand?.trim()) {
      fullPrompt += `--- Ön Komut ---\nGöreve başlamadan ÖNCE çalıştır: ${preTaskCommand}\n\n`;
    }

    if (hasMemory) {
      fullPrompt += `--- Paylaşılan Hafıza (diğer adımların sonuçları) ---\n${JSON.stringify(memoryObj, null, 2)}\n\n`;
    }
    fullPrompt += `--- Görev ---\n${step.prompt}`;

    // Build/verify + test commands
    const verifyCommands: string[] = [];
    if (buildCommand?.trim()) verifyCommands.push(buildCommand);
    if (testCommand?.trim()) verifyCommands.push(testCommand);

    if (verifyCommands.length > 0) {
      fullPrompt += `\n\n--- Doğrulama Komutları (ZORUNLU) ---
İşini bitirdikten sonra sırasıyla çalıştır:

${verifyCommands.map((cmd, i) => `${i + 1}. ${cmd}`).join("\n")}

Herhangi biri başarısız olursa hataları düzelt ve tekrar çalıştır.
TÜM komutlar başarılı olana kadar görevi TAMAMLANMIŞ sayma.`;
    }

    fullPrompt += BROWSER_INSTRUCTIONS_WORKFLOW;

    try {
      const result = await runQueryAgent(
        workflowId, `[${step.role}]`, fullPrompt, projectPath, allowedTools, maxTurns, abortController
      );

      // Save summary to step and shared memory
      const summary = result.text.slice(0, 1000);
      updateWorkflowStep(step.id, { status: "done", agent_summary: summary });

      // Update shared memory
      const currentWf = getWorkflow(workflowId);
      const currentMemory = JSON.parse(currentWf?.shared_memory ?? "{}");
      currentMemory[step.role] = summary;
      updateWorkflow(workflowId, { shared_memory: JSON.stringify(currentMemory) });

      pushLog(workflowId, `[${step.role}] ✓ Adım tamamlandı`);
    } catch (err) {
      if (abortController.signal.aborted) return;
      const msg = err instanceof Error ? err.message : String(err);
      pushLog(workflowId, `[${step.role}] [error] ${msg}`);
      updateWorkflowStep(step.id, { status: "error", agent_summary: `Hata: ${msg}` });
    }
  };

  // Dependency-based execution loop
  const executed = new Set<string>();
  let hasError = false;

  while (!abortController.signal.aborted) {
    const steps = getWorkflowSteps(workflowId);
    const pending = steps.filter((s) => s.status === "pending");
    const running = steps.filter((s) => s.status === "running");
    const errored = steps.filter((s) => s.status === "error");

    // Check if all done
    if (pending.length === 0 && running.length === 0) {
      hasError = errored.length > 0;
      break;
    }

    // Find steps ready to run (all deps satisfied)
    const ready = pending.filter((s) => {
      const deps: string[] = JSON.parse(s.depends_on || "[]");
      return deps.every((depId) => {
        const depStep = steps.find((x) => x.id === depId);
        return depStep?.status === "done";
      });
    }).filter((s) => !executed.has(s.id));

    // Also skip steps whose dependencies have errors
    for (const s of pending) {
      const deps: string[] = JSON.parse(s.depends_on || "[]");
      const hasErrorDep = deps.some((depId) => {
        const depStep = steps.find((x) => x.id === depId);
        return depStep?.status === "error";
      });
      if (hasErrorDep && !executed.has(s.id)) {
        updateWorkflowStep(s.id, { status: "skipped", agent_summary: "Bağımlılık hatası nedeniyle atlandı" });
        executed.add(s.id);
        pushLog(workflowId, `[${s.role}] ⊘ Atlandı (bağımlılık hatası)`);
      }
    }

    // Launch ready steps (respecting concurrency limit)
    const slotsAvailable = MAX_CONCURRENT - running.length;
    const toLaunch = ready.slice(0, Math.max(0, slotsAvailable));

    if (toLaunch.length > 0) {
      for (const step of toLaunch) {
        executed.add(step.id);
        runStep(step); // fire and forget — runs in parallel
      }
    }

    // Wait a bit before checking again
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  return !hasError;
}

// --- Coordinator: Review phase ---

async function runCoordinatorReview(
  workflowId: string,
  projectPath: string,
  allowedTools: string[],
  maxTurns: number,
  abortController: AbortController
): Promise<boolean> {
  updateWorkflow(workflowId, { status: "reviewing" });
  pushLog(workflowId, `[koordinatör] Sonuçlar inceleniyor...`);

  const wf = getWorkflow(workflowId);
  if (!wf) return false;

  const steps = getWorkflowSteps(workflowId);
  const stepSummaries = steps.map((s) => `- [${s.role}] ${s.title}: ${s.status === "done" ? "✓" : s.status === "error" ? "✗" : "⊘"} — ${s.agent_summary.slice(0, 200)}`).join("\n");

  const prompt = `Sen bir Koordinatör Agent'sın. Alt adımların sonuçlarını incele ve değerlendir.

Orijinal Hedef: ${wf.description}

Paylaşılan Hafıza:
${wf.shared_memory}

Adım Sonuçları:
${stepSummaries}

Değerlendirme yap ve SADECE JSON yanıt ver:
\`\`\`json
{
  "approved": boolean,
  "summary": "string - Türkçe genel değerlendirme özeti"
}
\`\`\``;

  try {
    const result = await runQueryAgent(
      workflowId, "[koordinatör-review]", prompt, projectPath, allowedTools, Math.min(maxTurns, 10), abortController
    );

    const parsed = extractJSON(result.text) as { approved?: boolean; summary?: string } | null;
    if (parsed?.approved) {
      pushLog(workflowId, `[koordinatör] ✓ İş akışı onaylandı: ${parsed.summary ?? ""}`);
      return true;
    } else {
      pushLog(workflowId, `[koordinatör] ⚠ İnceleme sonucu: ${parsed?.summary ?? result.text.slice(0, 300)}`);
      return false;
    }
  } catch (err) {
    if (abortController.signal.aborted) return false;
    pushLog(workflowId, `[koordinatör-review] [error] ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

// --- Main entry points ---

export async function startWorkflow(workflowId: string) {
  const wf = getWorkflow(workflowId);
  if (!wf) return;

  const db = getDb();
  const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(wf.project_id) as Project | undefined;
  if (!project) {
    updateWorkflow(workflowId, { status: "error" });
    return;
  }

  const abortController = new AbortController();
  runningWorkflows.set(workflowId, abortController);
  workflowLogs.set(workflowId, []);

  const allowedTools = project.allowed_tools?.split(",").filter(Boolean) ?? [];
  const maxTurns = project.max_turns ?? 30;

  pushLog(workflowId, `[sistem] İş akışı başlatılıyor: ${wf.title}`);

  try {
    // Phase 1: Coordinator plans
    const planOk = await runCoordinatorPlan(workflowId, project.path, wf.description, allowedTools, maxTurns, abortController);
    if (!planOk || abortController.signal.aborted) {
      runningWorkflows.delete(workflowId);
      return;
    }

    // Phase 2: Execute steps
    pushLog(workflowId, `[sistem] Adımlar yürütülüyor...`);
    const stepsOk = await executeWorkflowSteps(workflowId, project.path, allowedTools, maxTurns, abortController, project.build_command, project.test_command, project.custom_instructions, project.pre_task_command);
    if (abortController.signal.aborted) {
      runningWorkflows.delete(workflowId);
      return;
    }

    if (!stepsOk) {
      pushLog(workflowId, `[sistem] Bazı adımlarda hata oluştu`);
      updateWorkflow(workflowId, { status: "error" });
      runningWorkflows.delete(workflowId);
      return;
    }

    // Phase 3: Coordinator reviews
    const reviewOk = await runCoordinatorReview(workflowId, project.path, allowedTools, maxTurns, abortController);
    if (abortController.signal.aborted) {
      runningWorkflows.delete(workflowId);
      return;
    }

    if (reviewOk) {
      updateWorkflow(workflowId, { status: "done" });
      pushLog(workflowId, `[sistem] ✓ İş akışı başarıyla tamamlandı!`);
    } else {
      updateWorkflow(workflowId, { status: "done" });
      pushLog(workflowId, `[sistem] İş akışı tamamlandı (uyarılarla)`);
    }
  } catch (err) {
    if (!abortController.signal.aborted) {
      pushLog(workflowId, `[sistem] [error] ${err instanceof Error ? err.message : String(err)}`);
      updateWorkflow(workflowId, { status: "error" });
    }
  } finally {
    runningWorkflows.delete(workflowId);
    pruneOldWorkflowLogs();
  }
}

export function stopWorkflow(workflowId: string): boolean {
  const controller = runningWorkflows.get(workflowId);
  if (!controller) return false;
  controller.abort();
  runningWorkflows.delete(workflowId);

  // Mark workflow and running steps
  updateWorkflow(workflowId, { status: "cancelled" });
  const steps = getWorkflowSteps(workflowId);
  for (const s of steps) {
    if (s.status === "running" || s.status === "pending") {
      updateWorkflowStep(s.id, { status: "skipped" });
    }
  }
  pushLog(workflowId, `[sistem] İş akışı durduruldu`);
  return true;
}
