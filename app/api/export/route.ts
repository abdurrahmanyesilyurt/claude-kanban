import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { getAllProjects, getTasksByProject, createProject, createTask, getDb } from "@/lib/db";

/** GET: Export all projects and tasks as JSON */
export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get("project_id") ?? undefined;

  const projects = getAllProjects().filter(
    (p) => !projectId || p.id === projectId
  );

  const data = projects.map((p) => ({
    project: {
      name: p.name,
      path: p.path,
      color: p.color,
      allowed_tools: p.allowed_tools,
      max_turns: p.max_turns,
      extra_paths: p.extra_paths,
      urls: p.urls,
      doc_template: p.doc_template,
      build_command: p.build_command,
      custom_instructions: p.custom_instructions,
      test_command: p.test_command,
      pre_task_command: p.pre_task_command,
    },
    tasks: getTasksByProject(p.id).map((t) => ({
      title: t.title,
      description: t.description,
      status: t.status,
      priority: t.priority,
      max_retries: t.max_retries,
    })),
  }));

  return NextResponse.json({
    version: 1,
    exported_at: new Date().toISOString(),
    data,
  });
}

/** POST: Import projects and tasks from JSON */
export async function POST(req: NextRequest) {
  const body = await req.json();

  if (!body?.data || !Array.isArray(body.data)) {
    return NextResponse.json({ error: "Invalid import format" }, { status: 400 });
  }

  const db = getDb();
  let projectCount = 0;
  let taskCount = 0;

  for (const entry of body.data) {
    if (!entry.project?.name || !entry.project?.path) continue;

    // Check if project with same name+path already exists
    const existing = db
      .prepare("SELECT id FROM projects WHERE name = ? AND path = ?")
      .get(entry.project.name, entry.project.path) as { id: string } | undefined;

    const projectId = existing?.id ?? uuidv4();

    if (!existing) {
      createProject({
        id: projectId,
        name: entry.project.name,
        path: entry.project.path,
        color: entry.project.color ?? "#6366f1",
        allowed_tools: entry.project.allowed_tools ?? "Read,Glob,Grep,Edit,Write,Bash",
        max_turns: entry.project.max_turns ?? 30,
        extra_paths: entry.project.extra_paths ?? "[]",
        urls: entry.project.urls ?? "[]",
        doc_template: entry.project.doc_template ?? "",
        build_command: entry.project.build_command ?? "",
        custom_instructions: entry.project.custom_instructions ?? "",
        test_command: entry.project.test_command ?? "",
        pre_task_command: entry.project.pre_task_command ?? "",
      });
      projectCount++;
    }

    if (Array.isArray(entry.tasks)) {
      for (const t of entry.tasks) {
        if (!t.title) continue;
        createTask({
          id: uuidv4(),
          project_id: projectId,
          title: t.title,
          description: t.description ?? "",
          priority: t.priority ?? "medium",
        });
        taskCount++;
      }
    }
  }

  return NextResponse.json({
    ok: true,
    imported: { projects: projectCount, tasks: taskCount },
  });
}
