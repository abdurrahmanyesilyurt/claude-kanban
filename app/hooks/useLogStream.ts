"use client";

import { useEffect, useRef, useState } from "react";

const MAX_FRONTEND_LOGS = 1000;

/** Shared log line color utility for agent/workflow logs */
export function getLogLineColor(line: string): string {
  if (line.includes("[error]")) return "text-red-400";
  if (line.includes("[tool]")) return "text-cyan-400";
  if (line.includes("[assistant]")) return "text-green-400";
  if (line.includes("[result]")) return "text-yellow-400";
  if (line.includes("[koordinatör]") || line.includes("[koordinatör-review]")) return "text-purple-400";
  if (line.includes("[sistem]") || line.includes("[agent]")) return "text-indigo-400";
  return "text-muted";
}

/** Hook for SSE log streaming with auto-scroll and bounded log array */
export function useLogStream(url: string | null) {
  const [logs, setLogs] = useState<string[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!url) return;

    const eventSource = new EventSource(url);

    eventSource.onmessage = (event) => {
      const line = JSON.parse(event.data) as string;
      setLogs((prev) => {
        const next = [...prev, line];
        return next.length > MAX_FRONTEND_LOGS ? next.slice(-MAX_FRONTEND_LOGS) : next;
      });
    };

    eventSource.onerror = () => {
      eventSource.close();
    };

    return () => eventSource.close();
  }, [url]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const clearLogs = () => setLogs([]);

  return { logs, bottomRef, clearLogs };
}
