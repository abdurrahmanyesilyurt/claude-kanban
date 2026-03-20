import { NextRequest, NextResponse } from "next/server";
import { getWorkflowSteps } from "@/lib/db";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ workflowId: string }> }
) {
  const { workflowId } = await params;
  if (!workflowId) {
    return NextResponse.json({ error: "workflowId is required" }, { status: 400 });
  }
  const steps = getWorkflowSteps(workflowId);
  return NextResponse.json(steps);
}
