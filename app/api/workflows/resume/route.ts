import { NextRequest, NextResponse } from "next/server";
import { getWorkflow } from "@/lib/db";
import { resumeWorkflow, isWorkflowRunning } from "@/lib/workflow-engine";

export async function POST(req: NextRequest) {
  const { workflowId } = await req.json();
  if (!workflowId) {
    return NextResponse.json({ error: "workflowId is required" }, { status: 400 });
  }
  const wf = getWorkflow(workflowId);
  if (!wf) {
    return NextResponse.json({ error: "workflow not found" }, { status: 404 });
  }
  if (isWorkflowRunning(workflowId)) {
    return NextResponse.json({ error: "workflow is already running" }, { status: 400 });
  }
  // Fire and forget
  resumeWorkflow(workflowId);
  return NextResponse.json({ ok: true });
}
