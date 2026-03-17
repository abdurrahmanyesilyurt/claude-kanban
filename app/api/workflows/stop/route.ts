import { NextRequest, NextResponse } from "next/server";
import { stopWorkflow } from "@/lib/workflow-engine";

export async function POST(req: NextRequest) {
  const { workflowId } = await req.json();
  if (!workflowId) {
    return NextResponse.json({ error: "workflowId is required" }, { status: 400 });
  }
  const stopped = stopWorkflow(workflowId);
  if (!stopped) {
    return NextResponse.json({ error: "no running workflow found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
