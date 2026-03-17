import { NextRequest, NextResponse } from "next/server";
import { stopAgent } from "@/lib/claude-agent";

export async function POST(req: NextRequest) {
  const { taskId } = await req.json();

  if (!taskId) {
    return NextResponse.json({ error: "taskId is required" }, { status: 400 });
  }

  const stopped = stopAgent(taskId);

  if (!stopped) {
    return NextResponse.json({ error: "No running agent found for this task" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
