import { spawn, ChildProcess } from "child_process";
import { v4 as uuidv4 } from "uuid";
import { updateTask, createAgentRun, finishAgentRun, getDb } from "./db";
import type { Task as DbTask } from "./db";

// In-memory log store per task (for SSE streaming)
const taskLogs = new Map<string, string[]>();
const taskListeners = new Map<string, Set<(line: string) => void>>();

// Track running agent processes and their run IDs
const runningAgents = new Map<string, { child: ChildProcess; runId: string }>();

export function stopAgent(taskId: string): boolean {
  const entry = runningAgents.get(taskId);
  if (!entry) return false;
  entry.child.kill("SIGTERM");
  runningAgents.delete(taskId);
  pushLog(taskId, "[agent] Agent durduruldu (kullanıcı tarafından)");
  updateTask(taskId, { status: "error", progress: 0 });
  finishAgentRun(entry.runId, "stopped", getTaskLogs(taskId));
  return true;
}

export function isAgentRunning(taskId: string): boolean {
  return runningAgents.has(taskId);
}

export function getTaskLogs(taskId: string): string[] {
  return taskLogs.get(taskId) ?? [];
}

export function subscribeToTask(taskId: string, listener: (line: string) => void): () => void {
  if (!taskListeners.has(taskId)) {
    taskListeners.set(taskId, new Set());
  }
  taskListeners.get(taskId)!.add(listener);
  return () => {
    taskListeners.get(taskId)?.delete(listener);
  };
}

function pushLog(taskId: string, line: string) {
  if (!taskLogs.has(taskId)) {
    taskLogs.set(taskId, []);
  }
  taskLogs.get(taskId)!.push(line);
  taskListeners.get(taskId)?.forEach((fn) => fn(line));
}

interface AgentOptions {
  allowedTools?: string[];
  maxTurns?: number;
}

function handlePostCompletion(taskId: string, result: "done" | "error") {
  const db = getDb();
  const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId) as DbTask | undefined;
  if (!task) return;

  if (result === "error" && task.max_retries > 0 && task.retry_count < task.max_retries) {
    // Auto-retry
    const newRetryCount = task.retry_count + 1;
    db.prepare("UPDATE tasks SET retry_count = ? WHERE id = ?").run(newRetryCount, taskId);
    pushLog(taskId, `[agent] Otomatik yeniden deneme ${newRetryCount}/${task.max_retries}`);

    const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(task.project_id) as { path: string; allowed_tools: string; max_turns: number } | undefined;
    if (project) {
      setTimeout(() => {
        runAgent(taskId, task.description || task.title, project.path, {
          allowedTools: project.allowed_tools.split(",").filter(Boolean),
          maxTurns: project.max_turns,
        });
      }, 2000);
    }
    return;
  }

  if (result === "done" && task.next_task_id) {
    // Task chaining
    const nextTask = db.prepare("SELECT * FROM tasks WHERE id = ?").get(task.next_task_id) as DbTask | undefined;
    if (nextTask && nextTask.status === "todo") {
      pushLog(taskId, `[agent] Zincir: sonraki task başlatılıyor → ${nextTask.title}`);
      const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(nextTask.project_id) as { path: string; allowed_tools: string; max_turns: number } | undefined;
      if (project) {
        setTimeout(() => {
          runAgent(nextTask.id, nextTask.description || nextTask.title, project.path, {
            allowedTools: project.allowed_tools.split(",").filter(Boolean),
            maxTurns: project.max_turns,
          });
        }, 1000);
      }
    }
  }
}

export async function runAgent(taskId: string, prompt: string, projectPath: string, options?: AgentOptions) {
  const runId = uuidv4();
  createAgentRun(runId, taskId);
  // Clear previous in-memory logs for this task
  taskLogs.set(taskId, []);

  updateTask(taskId, { status: "in_progress", progress: 10 });
  pushLog(taskId, `[agent] Starting task in ${projectPath}`);
  pushLog(taskId, `[agent] Prompt: ${prompt}`);

  const allowedTools = options?.allowedTools ?? [];
  const maxTurns = options?.maxTurns ?? 30;

  if (allowedTools.length > 0) {
    pushLog(taskId, `[agent] Allowed tools: ${allowedTools.join(", ")}`);
  }
  pushLog(taskId, `[agent] Max turns: ${maxTurns}`);

  let totalCost = 0;
  let totalDuration = 0;

  try {
    let lastProgress = 10;

    const args = ["claude", "-p", prompt, "--output-format", "stream-json", "--max-turns", String(maxTurns)];

    // Add allowed tools
    for (const tool of allowedTools) {
      args.push("--allowedTools", tool);
    }

    const child = spawn(
      "npx",
      args,
      {
        cwd: projectPath,
        shell: true,
        env: { ...process.env },
        stdio: ["ignore", "pipe", "pipe"],
      }
    );

    runningAgents.set(taskId, { child, runId });
    let stderrBuf = "";

    child.stdout.on("data", (chunk: Buffer) => {
      const lines = chunk.toString().split("\n").filter(Boolean);
      for (const line of lines) {
        try {
          const msg = JSON.parse(line);
          if (msg.type === "assistant") {
            const content = msg.message?.content;
            if (Array.isArray(content)) {
              for (const block of content) {
                if (block.type === "text") {
                  pushLog(taskId, `[assistant] ${block.text}`);
                } else if (block.type === "tool_use") {
                  pushLog(taskId, `[tool] ${block.name}: ${JSON.stringify(block.input).slice(0, 200)}`);
                }
              }
            }
            lastProgress = Math.min(90, lastProgress + 10);
            updateTask(taskId, { progress: lastProgress });
          } else if (msg.type === "result") {
            totalCost = msg.cost_usd ?? 0;
            totalDuration = msg.duration_ms ?? 0;
            pushLog(taskId, `[result] Cost: $${msg.cost_usd?.toFixed(4) ?? "?"}, Duration: ${msg.duration_ms ?? "?"}ms`);
          }
        } catch {
          // Non-JSON line, log as-is
          if (line.trim()) {
            pushLog(taskId, `[stdout] ${line.trim()}`);
          }
        }
      }
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderrBuf += chunk.toString();
    });

    await new Promise<void>((resolve, reject) => {
      child.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`claude exited with code ${code}: ${stderrBuf.slice(0, 500)}`));
      });
      child.on("error", reject);
    });

    runningAgents.delete(taskId);
    updateTask(taskId, { status: "done", progress: 100 });
    pushLog(taskId, `[agent] Task completed successfully`);
    finishAgentRun(runId, "done", getTaskLogs(taskId), totalCost, totalDuration);

    // Task chaining: start next task if configured
    handlePostCompletion(taskId, "done");
  } catch (err: unknown) {
    runningAgents.delete(taskId);
    const message = err instanceof Error ? err.message : String(err);
    pushLog(taskId, `[error] ${message}`);
    updateTask(taskId, { status: "error", progress: 0 });
    finishAgentRun(runId, "error", getTaskLogs(taskId), totalCost, totalDuration);

    // Auto-retry or chaining
    handlePostCompletion(taskId, "error");
  }
}
