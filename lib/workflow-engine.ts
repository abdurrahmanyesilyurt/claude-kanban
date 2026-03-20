import { query } from "@anthropic-ai/claude-agent-sdk";
import { v4 as uuidv4 } from "uuid";
import { spawn } from "child_process";
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

const MOBILE_TEST_INSTRUCTIONS = `

--- Mobil Test Aracı (Android Emülatör) ---
Mobil uygulama testleri için node scripts/mobile-test.mjs kullan.
ÖNEMLİ: Screenshot ALMA! Hafızayı tüketir ve hata verir.
Bunun yerine inspect (XML-based, ~50KB) kullan — tüm ekran elementlerini text olarak görürsün.

TEMEL KOMUTLAR:
  node scripts/mobile-test.mjs inspect              — Ekrandaki tüm elementleri listele (HAFİF!)
  node scripts/mobile-test.mjs screen-text           — Ekrandaki tüm yazıları al
  node scripts/mobile-test.mjs tap-text "Giriş Yap"  — Yazıya göre tıkla
  node scripts/mobile-test.mjs tap-id "btn_login"     — ID'ye göre tıkla
  node scripts/mobile-test.mjs tap 540 800            — Koordinata tıkla
  node scripts/mobile-test.mjs type "admin"           — Yazı yaz
  node scripts/mobile-test.mjs clear-and-type "yeni"  — Alanı temizle + yaz
  node scripts/mobile-test.mjs check-text "Dashboard" — Yazı var mı kontrol et
  node scripts/mobile-test.mjs wait-for "Hoşgeldin" 20 — Yazı görünene kadar bekle
  node scripts/mobile-test.mjs scroll-down            — Aşağı kaydır
  node scripts/mobile-test.mjs scroll-up              — Yukarı kaydır
  node scripts/mobile-test.mjs back                   — Geri tuşu
  node scripts/mobile-test.mjs logcat-errors 30       — Son hata logları
  node scripts/mobile-test.mjs app-start <package>    — Uygulama başlat
  node scripts/mobile-test.mjs app-stop <package>     — Uygulama durdur

TEST YAKLAŞIMI:
1. Her ekranda önce "inspect" çalıştır — elementleri gör
2. check-text ile beklenen elementlerin varlığını doğrula
3. tap-text veya tap-id ile etkileşim kur
4. Tekrar inspect ile sonucu doğrula
5. Screenshot SADECE görsel bir bug kanıtlamak gerektiğinde al:
   node scripts/mobile-test.mjs screenshot "bug-kanit"
6. Hata bulunca logcat-errors ile log kontrol et

ASLA şunları yapma:
- Her adımda screenshot alma
- adb exec-out screencap kullanma
- Büyük PNG dosyaları oluşturma
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

/** Parse depends_on field — handles JSON array, comma-separated, or single ID */
function parseDependsOn(raw: string | undefined | null): string[] {
  const trimmed = (raw || "").trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[")) {
    try { return JSON.parse(trimmed); } catch { return []; }
  }
  return trimmed.split(",").map(s => s.trim()).filter(Boolean);
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
      pathToClaudeCodeExecutable: "C:\\Users\\HP\\AppData\\Roaming\\npm\\claude.cmd",
      spawnClaudeCodeProcess: ({ command, args, cwd, env, signal }) => {
        // Filter out empty --setting-sources arg (SDK bug: sends "" which breaks CLI parsing)
        const filteredArgs = [];
        for (let i = 0; i < args.length; i++) {
          if (args[i] === "--setting-sources" && (i + 1 >= args.length || args[i + 1] === "")) {
            i++;
            continue;
          }
          filteredArgs.push(args[i]);
        }
        const proc = spawn(command, filteredArgs, {
          cwd,
          stdio: ["pipe", "pipe", "pipe"] as ["pipe", "pipe", "pipe"],
          signal,
          env: env as NodeJS.ProcessEnv,
          windowsHide: true,
          shell: true,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        }) as any;
        return {
          stdin: proc.stdin,
          stdout: proc.stdout,
          get killed() { return proc.killed; },
          get exitCode() { return proc.exitCode; },
          kill: proc.kill.bind(proc),
          on: proc.on.bind(proc),
          once: proc.once.bind(proc),
          off: proc.off.bind(proc),
        };
      },
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
  updateWorkflow(workflowId, { status: "planning", started_at: new Date().toISOString() });
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

    updateWorkflowStep(step.id, { status: "running", started_at: new Date().toISOString() });
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

    // Auto-inject mobile test instructions for test/mobile roles
    const mobileRoles = ["test", "mobile", "frontend", "mobile-test"];
    const isMobileStep = mobileRoles.some(r => step.role.toLowerCase().includes(r))
      || step.title.toLowerCase().includes("mobil")
      || step.title.toLowerCase().includes("test")
      || step.prompt.toLowerCase().includes("emulator")
      || step.prompt.toLowerCase().includes("adb ");
    if (isMobileStep) {
      fullPrompt += MOBILE_TEST_INSTRUCTIONS;
    }

    try {
      const result = await runQueryAgent(
        workflowId, `[${step.role}]`, fullPrompt, projectPath, allowedTools, maxTurns, abortController
      );

      // Save summary to step and shared memory
      const summary = result.text.slice(0, 1000);
      updateWorkflowStep(step.id, { status: "done", agent_summary: summary, finished_at: new Date().toISOString(), completed_at: new Date().toISOString() });

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
      updateWorkflowStep(step.id, { status: "error", agent_summary: `Hata: ${msg}`, finished_at: new Date().toISOString(), completed_at: new Date().toISOString() });
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
      const deps: string[] = parseDependsOn(s.depends_on);
      return deps.every((depId) => {
        const depStep = steps.find((x) => x.id === depId);
        return depStep?.status === "done";
      });
    }).filter((s) => !executed.has(s.id));

    // Also skip steps whose dependencies have errors
    for (const s of pending) {
      const deps: string[] = parseDependsOn(s.depends_on);
      const hasErrorDep = deps.some((depId) => {
        const depStep = steps.find((x) => x.id === depId);
        return depStep?.status === "error";
      });
      if (hasErrorDep && !executed.has(s.id)) {
        updateWorkflowStep(s.id, { status: "skipped", agent_summary: "Bağımlılık hatası nedeniyle atlandı", completed_at: new Date().toISOString() });
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
      updateWorkflow(workflowId, { status: "error", completed_at: new Date().toISOString() });
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
      updateWorkflow(workflowId, { status: "done", completed_at: new Date().toISOString() });
      pushLog(workflowId, `[sistem] ✓ İş akışı başarıyla tamamlandı!`);
    } else {
      updateWorkflow(workflowId, { status: "done", completed_at: new Date().toISOString() });
      pushLog(workflowId, `[sistem] İş akışı tamamlandı (uyarılarla)`);
    }
  } catch (err) {
    if (!abortController.signal.aborted) {
      pushLog(workflowId, `[sistem] [error] ${err instanceof Error ? err.message : String(err)}`);
      updateWorkflow(workflowId, { status: "error", completed_at: new Date().toISOString() });
    }
  } finally {
    runningWorkflows.delete(workflowId);
    pruneOldWorkflowLogs();
  }
}

/**
 * Resume a workflow that was interrupted (e.g., server restart).
 * Skips the planning phase and directly executes remaining pending steps.
 */
export async function resumeWorkflow(workflowId: string) {
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

  // Reset any stuck "running" steps to "pending"
  const steps = getWorkflowSteps(workflowId);
  for (const s of steps) {
    if (s.status === "running") {
      updateWorkflowStep(s.id, { status: "pending" });
    }
  }

  updateWorkflow(workflowId, { status: "running" });
  pushLog(workflowId, `[sistem] İş akışı devam ettiriliyor (resume): ${wf.title}`);

  try {
    // Skip planning — go directly to step execution
    pushLog(workflowId, `[sistem] Kalan adımlar yürütülüyor...`);
    const stepsOk = await executeWorkflowSteps(workflowId, project.path, allowedTools, maxTurns, abortController, project.build_command, project.test_command, project.custom_instructions, project.pre_task_command);
    if (abortController.signal.aborted) {
      runningWorkflows.delete(workflowId);
      return;
    }

    if (!stepsOk) {
      pushLog(workflowId, `[sistem] Bazı adımlarda hata oluştu`);
      updateWorkflow(workflowId, { status: "error", completed_at: new Date().toISOString() });
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
      updateWorkflow(workflowId, { status: "done", completed_at: new Date().toISOString() });
      pushLog(workflowId, `[sistem] ✓ İş akışı başarıyla tamamlandı!`);
    } else {
      updateWorkflow(workflowId, { status: "done", completed_at: new Date().toISOString() });
      pushLog(workflowId, `[sistem] İş akışı tamamlandı (uyarılarla)`);
    }
  } catch (err) {
    if (!abortController.signal.aborted) {
      pushLog(workflowId, `[sistem] [error] ${err instanceof Error ? err.message : String(err)}`);
      updateWorkflow(workflowId, { status: "error", completed_at: new Date().toISOString() });
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
