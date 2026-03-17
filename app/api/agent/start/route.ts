import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { runAgent } from "@/lib/claude-agent";
import type { Task, Project } from "@/lib/db";

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

  const prompt = task.description
    ? `${task.title}\n\n${task.description}`
    : task.title;

  // Fire and forget — client will follow progress via SSE
  runAgent(taskId, prompt, project.path, {
    allowedTools: project.allowed_tools?.split(",").filter(Boolean) ?? [],
    maxTurns: project.max_turns ?? 30,
  });

  return NextResponse.json({ ok: true, taskId });
}
