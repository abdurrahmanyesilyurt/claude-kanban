import { NextRequest } from "next/server";
import { getTaskLogs, subscribeToTask } from "@/lib/claude-agent";
import { getAgentRuns } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const { taskId } = await params;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      // Send existing in-memory logs first
      let existing = getTaskLogs(taskId);

      // If no in-memory logs, try loading from DB (e.g. after server restart)
      if (existing.length === 0) {
        try {
          const runs = getAgentRuns(taskId);
          if (runs.length > 0 && runs[0].logs) {
            const dbLogs: string[] = JSON.parse(runs[0].logs);
            existing = dbLogs;
          }
        } catch { /* ignore parse errors */ }
      }

      for (const line of existing) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(line)}\n\n`));
      }

      // Subscribe to new logs
      const unsubscribe = subscribeToTask(taskId, (line) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(line)}\n\n`));
        } catch {
          unsubscribe();
        }
      });

      // Clean up when client disconnects
      _req.signal.addEventListener("abort", () => {
        unsubscribe();
        try { controller.close(); } catch { /* already closed */ }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
