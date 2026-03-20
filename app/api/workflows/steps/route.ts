import { NextRequest, NextResponse } from "next/server";
import { getWorkflowSteps, createWorkflowStep } from "@/lib/db";
import { v4 as uuidv4 } from "uuid";

export async function GET(req: NextRequest) {
  const workflowId = req.nextUrl.searchParams.get("workflow_id");
  if (!workflowId) {
    return NextResponse.json({ error: "workflow_id is required" }, { status: 400 });
  }
  const steps = getWorkflowSteps(workflowId);
  return NextResponse.json(steps);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { workflow_id, role, title, prompt, depends_on, order_index } = body;
  if (!workflow_id || !role || !title || !prompt) {
    return NextResponse.json({ error: "workflow_id, role, title, prompt are required" }, { status: 400 });
  }
  const step = createWorkflowStep({
    id: uuidv4(),
    workflow_id,
    role,
    title,
    prompt,
    depends_on: depends_on || "",
    order_index: order_index ?? 0,
  });
  return NextResponse.json(step);
}
