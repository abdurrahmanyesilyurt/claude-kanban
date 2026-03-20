import { NextRequest, NextResponse } from "next/server";
import { getWorkflow, getWorkflowSteps } from "@/lib/db";

function parseDate(val: string | null | undefined): Date | null {
  if (!val) return null;
  const d = new Date(val.includes("T") ? val : val + "Z");
  return isNaN(d.getTime()) ? null : d;
}

export async function GET(req: NextRequest) {
  const workflowId = req.nextUrl.searchParams.get("workflow_id");
  if (!workflowId) {
    return NextResponse.json({ error: "workflow_id is required" }, { status: 400 });
  }

  const wf = getWorkflow(workflowId);
  if (!wf) {
    return NextResponse.json({ error: "Workflow not found" }, { status: 404 });
  }

  const rawSteps = getWorkflowSteps(workflowId);
  const now = new Date();

  // Build step objects with duration
  const steps = rawSteps.map((s) => {
    const startedAt = parseDate(s.started_at);
    const finishedAt = parseDate(s.finished_at);

    let duration_ms: number | null = null;
    let elapsed_ms: number | null = null;

    if (startedAt && finishedAt) {
      duration_ms = finishedAt.getTime() - startedAt.getTime();
    } else if (startedAt && !finishedAt) {
      // Still running — show elapsed, no estimated completion
      elapsed_ms = now.getTime() - startedAt.getTime();
    }

    // depends_on: stored as JSON string or comma-separated
    let depends_on: string[] = [];
    try {
      const parsed = JSON.parse(s.depends_on);
      depends_on = Array.isArray(parsed) ? parsed : [];
    } catch {
      depends_on = s.depends_on
        ? s.depends_on
            .split(",")
            .map((x) => x.trim())
            .filter(Boolean)
        : [];
    }

    return {
      id: s.id,
      title: s.title,
      role: s.role,
      status: s.status,
      order_index: s.order_index,
      depends_on,
      started_at: s.started_at ?? null,
      finished_at: s.finished_at ?? null,
      duration_ms,
      elapsed_ms,
    };
  });

  // Calculate timeline boundaries
  const startTimes = steps
    .map((s) => parseDate(s.started_at))
    .filter((d): d is Date => d !== null);

  const finishTimes = steps
    .filter((s) => s.finished_at !== null)
    .map((s) => parseDate(s.finished_at))
    .filter((d): d is Date => d !== null);

  const wfCompletedAt = parseDate(wf.completed_at);
  const wfStartedAt = parseDate(wf.started_at);

  // start_time: workflow.started_at or earliest step.started_at
  const start_time =
    wfStartedAt ??
    (startTimes.length > 0
      ? new Date(Math.min(...startTimes.map((d) => d.getTime())))
      : null);

  // end_time: workflow completed_at, or latest finished_at, or null if still running
  const isRunning = ["running", "planning", "reviewing"].includes(wf.status);
  let end_time: Date | null = null;

  if (wfCompletedAt) {
    end_time = wfCompletedAt;
  } else if (!isRunning && finishTimes.length > 0) {
    end_time = new Date(Math.max(...finishTimes.map((d) => d.getTime())));
  }

  const total_duration_ms =
    start_time
      ? (end_time ?? (isRunning ? now : null))
          ? (end_time ?? now).getTime() - start_time.getTime()
          : null
      : null;

  return NextResponse.json({
    workflow: {
      id: wf.id,
      title: wf.title,
      status: wf.status,
      created_at: wf.created_at,
      started_at: wf.started_at ?? null,
      completed_at: wf.completed_at ?? null,
    },
    steps,
    timeline: {
      start_time: start_time?.toISOString() ?? null,
      end_time: end_time?.toISOString() ?? null,
      total_duration_ms,
      is_running: isRunning,
    },
  });
}
