import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { createWorkflow, getWorkflowsByProject, deleteWorkflow, updateWorkflow } from "@/lib/db";

export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get("project_id") ?? undefined;
  const workflows = getWorkflowsByProject(projectId);
  return NextResponse.json(workflows);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { project_id, title, description } = body;
  if (!project_id || !title) {
    return NextResponse.json({ error: "project_id and title are required" }, { status: 400 });
  }
  const wf = createWorkflow({ id: uuidv4(), project_id, title, description: description ?? "" });
  return NextResponse.json(wf, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const { id, ...fields } = body;
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  const wf = updateWorkflow(id, fields);
  if (!wf) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(wf);
}

export async function DELETE(req: NextRequest) {
  const { id } = await req.json();
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  const ok = deleteWorkflow(id);
  if (!ok) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
