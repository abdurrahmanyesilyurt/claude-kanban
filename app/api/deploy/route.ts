import { NextRequest, NextResponse } from "next/server";
import {
  deploy,
  getDeployStatus,
  getAllDeployStatuses,
  checkServer,
  getServerLogs,
  DEPLOY_CONFIGS,
} from "@/lib/deploy-service";

// GET: Get deploy status for a project or all projects
export async function GET(req: NextRequest) {
  const project = req.nextUrl.searchParams.get("project");
  const action = req.nextUrl.searchParams.get("action");

  // List all configs and statuses
  if (!project) {
    const statuses = getAllDeployStatuses();
    const configs = Object.entries(DEPLOY_CONFIGS).map(([key, cfg]) => ({
      key,
      name: cfg.name,
      type: cfg.type,
      server: cfg.server,
      enabled: cfg.enabled,
      status: statuses[key]?.status || "idle",
    }));
    return NextResponse.json({ projects: configs });
  }

  // Server check
  if (action === "check") {
    const result = await checkServer(project);
    return NextResponse.json(result);
  }

  // Server logs
  if (action === "logs") {
    const lines = parseInt(req.nextUrl.searchParams.get("lines") || "30");
    const logs = await getServerLogs(project, lines);
    return NextResponse.json({ logs });
  }

  // Deploy status
  const status = getDeployStatus(project);
  return NextResponse.json(status);
}

// POST: Trigger deploy
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { project } = body;

    if (!project || !DEPLOY_CONFIGS[project]) {
      return NextResponse.json(
        { error: `Unknown project: ${project}. Available: ${Object.keys(DEPLOY_CONFIGS).join(", ")}` },
        { status: 400 }
      );
    }

    if (!DEPLOY_CONFIGS[project].enabled) {
      return NextResponse.json(
        { error: `${DEPLOY_CONFIGS[project].name} deploy icin yapilandirilmamis` },
        { status: 400 }
      );
    }

    // Run deploy in background (don't await)
    deploy(project).catch((e) =>
      console.error(`[Deploy:${project}] Error:`, e)
    );

    return NextResponse.json({
      ok: true,
      message: `${DEPLOY_CONFIGS[project].name} deploy baslatildi`,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
