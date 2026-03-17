"use client";

import { useState, useEffect } from "react";

interface Stats {
  total_tasks: number;
  done_tasks: number;
  error_tasks: number;
  total_cost: number;
  total_duration: number;
  total_runs: number;
}

export default function StatsBar({ projectId }: { projectId: string | null }) {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    const url = projectId ? `/api/stats?projectId=${projectId}` : "/api/stats";
    fetch(url)
      .then((r) => r.json())
      .then(setStats)
      .catch(() => {});

    const interval = setInterval(() => {
      fetch(url)
        .then((r) => r.json())
        .then(setStats)
        .catch(() => {});
    }, 5000);
    return () => clearInterval(interval);
  }, [projectId]);

  if (!stats || stats.total_tasks === 0) return null;

  const successRate = stats.total_runs > 0
    ? Math.round(((stats.total_runs - stats.error_tasks) / stats.total_runs) * 100)
    : 0;

  const formatDuration = (ms: number) => {
    if (ms < 60000) return `${Math.round(ms / 1000)}s`;
    return `${Math.round(ms / 60000)}dk`;
  };

  return (
    <div className="flex items-center gap-4 px-6 py-1.5 border-b border-border text-[11px] text-muted">
      <span>
        <span className="text-foreground font-medium">{stats.done_tasks}</span>/{stats.total_tasks} task
      </span>
      {stats.total_runs > 0 && (
        <>
          <span className="text-muted/30">|</span>
          <span>
            Başarı: <span className={`font-medium ${successRate >= 80 ? "text-emerald-400" : successRate >= 50 ? "text-amber-400" : "text-red-400"}`}>{successRate}%</span>
          </span>
          <span className="text-muted/30">|</span>
          <span>
            {stats.total_runs} çalışma
          </span>
        </>
      )}
      {stats.total_cost > 0 && (
        <>
          <span className="text-muted/30">|</span>
          <span>
            Maliyet: <span className="text-foreground font-medium">${stats.total_cost.toFixed(4)}</span>
          </span>
        </>
      )}
      {stats.total_duration > 0 && (
        <>
          <span className="text-muted/30">|</span>
          <span>
            Süre: <span className="text-foreground font-medium">{formatDuration(stats.total_duration)}</span>
          </span>
        </>
      )}
    </div>
  );
}
