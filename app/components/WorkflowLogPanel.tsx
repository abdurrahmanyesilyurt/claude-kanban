"use client";

import { useEffect, useRef, useState } from "react";

interface WorkflowLogPanelProps {
  workflowId: string;
  onClose: () => void;
}

export default function WorkflowLogPanel({ workflowId, onClose }: WorkflowLogPanelProps) {
  const [logs, setLogs] = useState<string[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const eventSource = new EventSource(`/api/workflows/stream/${workflowId}`);
    eventSource.onmessage = (event) => {
      const line = JSON.parse(event.data) as string;
      setLogs((prev) => [...prev, line]);
    };
    eventSource.onerror = () => eventSource.close();
    return () => eventSource.close();
  }, [workflowId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const getLineColor = (line: string) => {
    if (line.includes("[error]")) return "text-red-400";
    if (line.includes("[tool]")) return "text-cyan-400";
    if (line.includes("[assistant]")) return "text-green-400";
    if (line.includes("[result]")) return "text-yellow-400";
    if (line.includes("[koordinatör]") || line.includes("[koordinatör-review]")) return "text-purple-400";
    if (line.includes("[sistem]")) return "text-indigo-400";
    return "text-muted";
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-4xl h-[70vh] bg-surface border border-border rounded-t-xl flex flex-col">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-purple-400 animate-pulse" />
            <span className="text-sm font-medium">İş Akışı Log</span>
            <span className="text-xs text-muted font-mono">{workflowId.slice(0, 8)}</span>
          </div>
          <button onClick={onClose} className="text-muted hover:text-foreground text-lg leading-none transition-colors">
            &times;
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-0.5">
          {logs.length === 0 && (
            <p className="text-muted text-xs">Loglar bekleniyor...</p>
          )}
          {logs.map((line, i) => (
            <div key={i} className={`log-line ${getLineColor(line)}`}>
              {line}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      </div>
    </div>
  );
}
