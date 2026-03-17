import { NextRequest, NextResponse } from "next/server";
import { getWorkflow } from "@/lib/db";
import { startWorkflow } from "@/lib/workflow-engine";

export async function POST(req: NextRequest) {
  const { workflowId } = await req.json();
  if (!workflowId) {
    return NextResponse.json({ error: "workflowId is required" }, { status: 400 });
  }
  const wf = getWorkflow(workflowId);
  if (!wf) {
    return NextResponse.json({ error: "workflow not found" }, { status: 404 });
  }
  if (wf.status !== "draft") {
    return NextResponse.json({ error: "workflow is not in draft state" }, { status: 400 });
  }
  // Fire and forget
  startWorkflow(workflowId);
  return NextResponse.json({ ok: true });
}
