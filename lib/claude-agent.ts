import { query } from "@anthropic-ai/claude-agent-sdk";
import { v4 as uuidv4 } from "uuid";
import { updateTask, createAgentRun, finishAgentRun, getDb } from "./db";
import type { Task as DbTask } from "./db";
import fs from "fs";
import path from "path";

// In-memory log store per task (for SSE streaming)
const taskLogs = new Map<string, string[]>();
const taskListeners = new Map<string, Set<(line: string) => void>>();

// Track running agent queries for abort
const runningAgents = new Map<
  string,
  { abortController: AbortController; runId: string }
>();

export function stopAgent(taskId: string): boolean {
  const entry = runningAgents.get(taskId);
  if (!entry) return false;
  entry.abortController.abort();
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

export function subscribeToTask(
  taskId: string,
  listener: (line: string) => void
): () => void {
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

/**
 * Detect doc files created by the agent by scanning logs for Write tool calls to .md files
 * or by checking the docs/ directory for recently created files.
 */
function detectDocPath(taskId: string, projectPath: string): string | null {
  const logs = getTaskLogs(taskId);

  // Method 1: Scan logs for Write tool calls targeting .md files
  for (const log of logs) {
    if (log.startsWith("[tool] Write:") || log.startsWith("[tool] write:")) {
      // Extract file_path from the JSON input
      const match = log.match(/"file_path"\s*:\s*"([^"]+\.md)"/);
      if (match) {
        const filePath = match[1];
        if (fs.existsSync(filePath)) {
          return filePath;
        }
      }
    }
  }

  // Method 2: Check docs/ directory for recently modified .md files (last 2 minutes)
  const docsDir = path.join(projectPath, "docs");
  if (fs.existsSync(docsDir)) {
    try {
      const files = fs.readdirSync(docsDir)
        .filter((f) => f.endsWith(".md"))
        .map((f) => {
          const fullPath = path.join(docsDir, f);
          const stat = fs.statSync(fullPath);
          return { path: fullPath, mtime: stat.mtimeMs };
        })
        .sort((a, b) => b.mtime - a.mtime);

      if (files.length > 0) {
        const newest = files[0];
        const twoMinutesAgo = Date.now() - 2 * 60 * 1000;
        if (newest.mtime > twoMinutesAgo) {
          return newest.path;
        }
      }
    } catch {
      /* ignore */
    }
  }

  return null;
}

function handlePostCompletion(taskId: string, result: "done" | "error") {
  const db = getDb();
  const task = db
    .prepare("SELECT * FROM tasks WHERE id = ?")
    .get(taskId) as DbTask | undefined;
  if (!task) return;

  if (
    result === "error" &&
    task.max_retries > 0 &&
    task.retry_count < task.max_retries
  ) {
    // Auto-retry
    const newRetryCount = task.retry_count + 1;
    db.prepare("UPDATE tasks SET retry_count = ? WHERE id = ?").run(
      newRetryCount,
      taskId
    );
    pushLog(
      taskId,
      `[agent] Otomatik yeniden deneme ${newRetryCount}/${task.max_retries}`
    );

    const project = db
      .prepare("SELECT * FROM projects WHERE id = ?")
      .get(task.project_id) as
      | { path: string; allowed_tools: string; max_turns: number }
      | undefined;
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
    const nextTask = db
      .prepare("SELECT * FROM tasks WHERE id = ?")
      .get(task.next_task_id) as DbTask | undefined;
    if (nextTask && nextTask.status === "todo") {
      pushLog(
        taskId,
        `[agent] Zincir: sonraki task başlatılıyor → ${nextTask.title}`
      );
      const project = db
        .prepare("SELECT * FROM projects WHERE id = ?")
        .get(nextTask.project_id) as
        | { path: string; allowed_tools: string; max_turns: number }
        | undefined;
      if (project) {
        setTimeout(() => {
          runAgent(
            nextTask.id,
            nextTask.description || nextTask.title,
            project.path,
            {
              allowedTools: project.allowed_tools.split(",").filter(Boolean),
              maxTurns: project.max_turns,
            }
          );
        }, 1000);
      }
    }
  }
}

export async function runAgent(
  taskId: string,
  prompt: string,
  projectPath: string,
  options?: AgentOptions
) {
  const runId = uuidv4();
  createAgentRun(runId, taskId);
  // Clear previous in-memory logs for this task
  taskLogs.set(taskId, []);

  updateTask(taskId, { status: "in_progress", progress: 10 });
  pushLog(taskId, `[agent] Task başlatılıyor: ${projectPath}`);
  pushLog(taskId, `[agent] Prompt: ${prompt}`);

  const allowedTools = options?.allowedTools ?? [];
  const maxTurns = options?.maxTurns ?? 30;

  if (allowedTools.length > 0) {
    pushLog(taskId, `[agent] İzin verilen araçlar: ${allowedTools.join(", ")}`);
  }
  pushLog(taskId, `[agent] Max turns: ${maxTurns}`);

  let totalCost = 0;
  let totalDuration = 0;
  const abortController = new AbortController();

  runningAgents.set(taskId, { abortController, runId });

  try {
    let lastProgress = 10;

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
              pushLog(taskId, `[assistant] ${block.text}`);
            } else if (block.type === "tool_use") {
              pushLog(
                taskId,
                `[tool] ${block.name}: ${JSON.stringify(block.input).slice(0, 200)}`
              );
            } else if (block.type === "tool_result") {
              const text = typeof block.content === "string"
                ? block.content
                : Array.isArray(block.content)
                  ? block.content.map((c: any) => c.text || "").join("")
                  : "";
              if (text) {
                pushLog(taskId, `[tool_result] ${text.slice(0, 300)}`);
              }
            }
          }
        }
        lastProgress = Math.min(90, lastProgress + 5);
        updateTask(taskId, { progress: lastProgress });
      } else if (msg.type === "user") {
        // Tool results come back as user messages
        const content = msg.message?.content ?? msg.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === "tool_result") {
              const text = typeof block.content === "string"
                ? block.content.slice(0, 300)
                : Array.isArray(block.content)
                  ? block.content.map((c: any) => c.text || "").join("").slice(0, 300)
                  : "";
              if (text) {
                pushLog(taskId, `[tool_result] ${text}`);
              }
            }
          }
        }
      } else if (msg.type === "result") {
        totalCost = msg.total_cost_usd ?? 0;
        totalDuration = msg.duration_ms ?? 0;
        pushLog(
          taskId,
          `[result] Maliyet: $${totalCost.toFixed(4)}, Süre: ${totalDuration}ms, Turns: ${msg.num_turns ?? "?"}`
        );
        if (msg.result) {
          pushLog(taskId, `[result] ${msg.result}`);
        }
      } else {
        // Log any unknown message types for debugging
        pushLog(taskId, `[${msg.type || "unknown"}] ${JSON.stringify(msg).slice(0, 300)}`);
      }
    }

    runningAgents.delete(taskId);

    // Detect generated docs — scan logs for Write tool calls to .md files in docs/
    const docPath = detectDocPath(taskId, projectPath);
    updateTask(taskId, { status: "done", progress: 100, ...(docPath ? { doc_path: docPath } : {}) });
    if (docPath) {
      pushLog(taskId, `[agent] Dokuman olusturuldu: ${docPath}`);
    }
    pushLog(taskId, `[agent] Task başarıyla tamamlandı`);
    finishAgentRun(runId, "done", getTaskLogs(taskId), totalCost, totalDuration);

    handlePostCompletion(taskId, "done");
  } catch (err: unknown) {
    runningAgents.delete(taskId);

    // Check if it was an abort (user stopped the agent)
    if (abortController.signal.aborted) {
      // Already handled in stopAgent()
      return;
    }

    const message = err instanceof Error ? err.message : String(err);
    pushLog(taskId, `[error] ${message}`);
    updateTask(taskId, { status: "error", progress: 0 });
    finishAgentRun(
      runId,
      "error",
      getTaskLogs(taskId),
      totalCost,
      totalDuration
    );

    handlePostCompletion(taskId, "error");
  }
}
