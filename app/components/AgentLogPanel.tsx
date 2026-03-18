"use client";

import { useEffect, useState } from "react";
import { useLogStream, getLogLineColor } from "../hooks/useLogStream";

interface AgentRun {
  id: string;
  task_id: string;
  status: string;
  logs: string;
  started_at: string;
  finished_at: string | null;
}

interface AgentLogPanelProps {
  taskId: string;
  onClose: () => void;
}

export default function AgentLogPanel({ taskId, onClose }: AgentLogPanelProps) {
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [viewingRunId, setViewingRunId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const streamUrl = viewingRunId ? null : `/api/agent/stream/${taskId}`;
  const { logs: liveLogs, bottomRef } = useLogStream(streamUrl);

  // Fetch history
  useEffect(() => {
    if (showHistory) {
      fetch(`/api/agent/runs?taskId=${taskId}`)
        .then((r) => r.json())
        .then((data) => setRuns(data))
        .catch(() => {});
    }
  }, [showHistory, taskId]);

  const displayLogs = viewingRunId
    ? JSON.parse(runs.find((r) => r.id === viewingRunId)?.logs ?? "[]") as string[]
    : liveLogs;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-3xl h-[60vh] bg-surface border border-border rounded-t-xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
          <div className="flex items-center gap-2">
            {!viewingRunId && (
              <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            )}
            <span className="text-sm font-medium">
              {viewingRunId ? "Geçmiş Log" : "Agent Log"}
            </span>
            <span className="text-xs text-muted font-mono">{taskId.slice(0, 8)}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                if (viewingRunId) {
                  setViewingRunId(null);
                } else {
                  setShowHistory(!showHistory);
                }
              }}
              className="text-xs px-2 py-1 rounded border border-border text-muted hover:text-foreground hover:border-border-hover transition-colors"
            >
              {viewingRunId ? "Canlı Log" : showHistory ? "Gizle" : "Geçmiş"}
            </button>
            <button
              onClick={onClose}
              className="text-muted hover:text-foreground text-lg leading-none transition-colors"
            >
              &times;
            </button>
          </div>
        </div>

        {/* History dropdown */}
        {showHistory && !viewingRunId && runs.length > 0 && (
          <div className="border-b border-border px-4 py-2 space-y-1 max-h-32 overflow-y-auto">
            {runs.map((run) => (
              <button
                key={run.id}
                onClick={() => setViewingRunId(run.id)}
                className="w-full text-left flex items-center gap-2 px-2 py-1 text-xs rounded hover:bg-white/5 transition-colors"
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    run.status === "done"
                      ? "bg-emerald-400"
                      : run.status === "error"
                      ? "bg-red-400"
                      : run.status === "stopped"
                      ? "bg-amber-400"
                      : "bg-gray-400"
                  }`}
                />
                <span className="text-muted">
                  {new Date(run.started_at).toLocaleString("tr-TR")}
                </span>
                <span className="text-muted/50">
                  {run.status === "done" ? "Tamamlandı" : run.status === "error" ? "Hata" : run.status === "stopped" ? "Durduruldu" : "Çalışıyor"}
                </span>
              </button>
            ))}
          </div>
        )}

        {showHistory && !viewingRunId && runs.length === 0 && (
          <div className="border-b border-border px-4 py-3 text-xs text-muted/50">
            Henüz geçmiş çalışma yok
          </div>
        )}

        {/* Logs */}
        <div className="flex-1 overflow-y-auto p-4 space-y-0.5">
          {displayLogs.length === 0 && (
            <p className="text-muted text-xs">Loglar bekleniyor...</p>
          )}
          {displayLogs.map((line, i) => (
            <div key={i} className={`log-line ${getLogLineColor(line)}`}>
              {line}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      </div>
    </div>
  );
}
