import { NextRequest, NextResponse } from "next/server";
import { getWorkflowSteps } from "@/lib/db";

export async function GET(req: NextRequest) {
  const workflowId = req.nextUrl.searchParams.get("workflow_id");
  if (!workflowId) {
    return NextResponse.json({ error: "workflow_id is required" }, { status: 400 });
  }
  const steps = getWorkflowSteps(workflowId);
  return NextResponse.json(steps);
}
