import { NextRequest, NextResponse } from "next/server";
import { getProjectStats, getGlobalStats } from "@/lib/db";

export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get("projectId");

  if (projectId) {
    return NextResponse.json(getProjectStats(projectId));
  }

  return NextResponse.json(getGlobalStats());
}
