import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { runAgent } from "@/lib/claude-agent";
import type { Task, Project } from "@/lib/db";

function buildPrompt(task: Task, project: Project): string {
  const parts: string[] = [];

  parts.push(task.title);
  if (task.description) {
    parts.push(task.description);
  }

  // Extra paths context
  const extraPaths: string[] = JSON.parse(project.extra_paths || "[]");
  if (extraPaths.length > 0) {
    parts.push(
      `\n--- Ek Proje Dizinleri ---\nBu task ile ilgili ek dizinler (gerektiğinde bu dizinlerdeki dosyaları da oku/düzenle):\n${extraPaths.map((p) => `- ${p}`).join("\n")}`
    );
  }

  // URLs context
  const urls: string[] = JSON.parse(project.urls || "[]");
  if (urls.length > 0) {
    parts.push(
      `\n--- Referans URL'ler ---\nBu task ile ilgili referans web sayfaları (gerektiğinde WebFetch ile incele):\n${urls.map((u) => `- ${u}`).join("\n")}`
    );
  }

  return parts.join("\n\n");
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { taskId } = body;

  if (!taskId) {
    return NextResponse.json({ error: "taskId is required" }, { status: 400 });
  }

  const db = getDb();
  const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId) as Task | undefined;
  if (!task) {
    return NextResponse.json({ error: "task not found" }, { status: 404 });
  }

  const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(task.project_id) as Project | undefined;
  if (!project) {
    return NextResponse.json({ error: "project not found" }, { status: 404 });
  }

  const prompt = buildPrompt(task, project);

  // Fire and forget — client will follow progress via SSE
  runAgent(taskId, prompt, project.path, {
    allowedTools: project.allowed_tools?.split(",").filter(Boolean) ?? [],
    maxTurns: project.max_turns ?? 30,
  });

  return NextResponse.json({ ok: true, taskId });
}
