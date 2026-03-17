import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { getTasksByProject, createTask, updateTask, getDb } from "@/lib/db";

export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get("project_id") ?? undefined;
  const tasks = getTasksByProject(projectId);
  return NextResponse.json(tasks);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { project_id, title, description, priority } = body;

  if (!project_id || !title) {
    return NextResponse.json({ error: "project_id and title are required" }, { status: 400 });
  }

  const task = createTask({
    id: uuidv4(),
    project_id,
    title,
    description: description ?? "",
    priority: priority ?? "medium",
  });

  return NextResponse.json(task, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const { id, ...fields } = body;

  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const task = updateTask(id, fields);
  if (!task) {
    return NextResponse.json({ error: "task not found" }, { status: 404 });
  }

  return NextResponse.json(task);
}

export async function DELETE(req: NextRequest) {
  const { id } = await req.json();

  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const db = getDb();
  const result = db.prepare("DELETE FROM tasks WHERE id = ?").run(id);

  if (result.changes === 0) {
    return NextResponse.json({ error: "task not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
