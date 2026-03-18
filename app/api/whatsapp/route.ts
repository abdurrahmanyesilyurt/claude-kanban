import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import type { Task } from "@/lib/db";
import { sendMessage, getStatus, initialize } from "@/lib/whatsapp-service";
import path from "path";
import fs from "fs";

function generateSummary(task: Task, logs: string[]): string {
  const assistantMessages = logs
    .filter((l) => l.startsWith("[assistant]"))
    .map((l) => l.replace("[assistant] ", ""));

  const resultLogs = logs
    .filter((l) => l.startsWith("[result]"))
    .map((l) => l.replace("[result] ", ""));

  const costLine = resultLogs.find((l) => l.includes("Maliyet:"));

  const lines: string[] = [];
  lines.push(`*${task.title}*`);
  lines.push(
    `Durum: ${task.status === "done" ? "Tamamlandi" : task.status}`
  );
  lines.push("");

  const lastAssistant = assistantMessages
    .filter((m) => m.length > 50)
    .slice(-3);

  if (lastAssistant.length > 0) {
    lines.push("*Yapilan Isler:*");
    for (const msg of lastAssistant) {
      const clean = msg.slice(0, 500).replace(/\n/g, " ").trim();
      lines.push(`- ${clean}`);
    }
  }

  if (costLine) {
    lines.push("");
    lines.push(`_${costLine}_`);
  }

  return lines.join("\n");
}

// POST: Send task doc + summary via WhatsApp
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { taskId, target, docPath } = body;
    // target: phone number or group name
    // docPath: optional, path to .md doc file

    if (!taskId) {
      return NextResponse.json(
        { error: "taskId is required" },
        { status: 400 }
      );
    }

    if (!target) {
      return NextResponse.json(
        { error: "target (phone or group name) is required" },
        { status: 400 }
      );
    }

    // Check WhatsApp connection
    const status = getStatus();
    if (!status.connected) {
      if (!status.initializing) {
        initialize().catch(() => {});
      }
      return NextResponse.json(
        {
          error: "WhatsApp bagli degil. Ayarlardan QR kodu tarayin.",
          needsAuth: true,
        },
        { status: 503 }
      );
    }

    const db = getDb();
    const task = db
      .prepare("SELECT * FROM tasks WHERE id = ?")
      .get(taskId) as Task | undefined;

    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    // Get agent logs for summary
    const run = db
      .prepare(
        "SELECT logs FROM agent_runs WHERE task_id = ? ORDER BY started_at DESC LIMIT 1"
      )
      .get(taskId) as { logs: string } | undefined;

    let logs: string[] = [];
    if (run?.logs) {
      try {
        logs = JSON.parse(run.logs);
      } catch {
        /* ignore */
      }
    }

    // Build summary message
    const messageParts: string[] = [];
    messageParts.push("*Claude Kanban - Gorev Raporu*");
    messageParts.push(`Tarih: ${new Date().toLocaleDateString("tr-TR")}`);
    messageParts.push("---");
    messageParts.push("");
    messageParts.push(generateSummary(task, logs));
    messageParts.push("");
    messageParts.push("_Claude Kanban ile otomatik gonderildi_");

    const message = messageParts.join("\n");

    // Resolve doc file path
    let resolvedDocPath: string | undefined;
    if (docPath) {
      // docPath could be relative to project or absolute
      const absPath = path.isAbsolute(docPath) ? docPath : path.resolve(docPath);
      if (fs.existsSync(absPath)) {
        resolvedDocPath = absPath;
      }
    }

    // Also check task's doc_path field if no explicit docPath given
    if (!resolvedDocPath && task.doc_path) {
      if (fs.existsSync(task.doc_path)) {
        resolvedDocPath = task.doc_path;
      }
    }

    const result = await sendMessage(target, message, resolvedDocPath);

    return NextResponse.json({
      ok: result.ok,
      error: result.error,
      message: result.ok
        ? `Mesaj ${target} hedefine gonderildi${resolvedDocPath ? " (dokuman eklendi)" : ""}`
        : `Gonderim basarisiz: ${result.error}`,
      docSent: !!resolvedDocPath,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
