import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { getAllProjects, createProject, getDb } from "@/lib/db";
import type { Project } from "@/lib/db";

export async function GET() {
  const projects = getAllProjects();
  return NextResponse.json(projects);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { name, path, color, allowed_tools, max_turns, extra_paths, urls } = body;

  if (!name || !path) {
    return NextResponse.json({ error: "name and path are required" }, { status: 400 });
  }

  const project = createProject({
    id: uuidv4(),
    name,
    path,
    color: color ?? "#6366f1",
    allowed_tools: allowed_tools ?? "Read,Glob,Grep,Edit,Write,Bash",
    max_turns: max_turns ?? 30,
    extra_paths: JSON.stringify(extra_paths ?? []),
    urls: JSON.stringify(urls ?? []),
  });

  return NextResponse.json(project, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const { id, ...fields } = body;

  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const db = getDb();
  const sets: string[] = [];
  const values: unknown[] = [];

  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined && ["name", "path", "color", "allowed_tools", "max_turns", "extra_paths", "urls"].includes(key)) {
      sets.push(`${key} = ?`);
      values.push(value);
    }
  }

  if (sets.length === 0) {
    return NextResponse.json({ error: "no valid fields to update" }, { status: 400 });
  }

  values.push(id);
  db.prepare(`UPDATE projects SET ${sets.join(", ")} WHERE id = ?`).run(...values);
  const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as Project | undefined;

  if (!project) {
    return NextResponse.json({ error: "project not found" }, { status: 404 });
  }

  return NextResponse.json(project);
}

export async function DELETE(req: NextRequest) {
  const { id } = await req.json();

  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const db = getDb();
  db.prepare("DELETE FROM tasks WHERE project_id = ?").run(id);
  const result = db.prepare("DELETE FROM projects WHERE id = ?").run(id);

  if (result.changes === 0) {
    return NextResponse.json({ error: "project not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
