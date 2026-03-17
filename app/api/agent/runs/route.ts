import { NextRequest, NextResponse } from "next/server";
import { getAgentRuns } from "@/lib/db";

export async function GET(req: NextRequest) {
  const taskId = req.nextUrl.searchParams.get("taskId");

  if (!taskId) {
    return NextResponse.json({ error: "taskId is required" }, { status: 400 });
  }

  const runs = getAgentRuns(taskId);
  return NextResponse.json(runs);
}
