"use client";

import { useState, useEffect, useRef } from "react";
import { useToast } from "./Toast";

interface ProjectInfo {
  key: string;
  name: string;
  type: string;
  server: string;
  enabled: boolean;
  status: string;
}

interface DeployLog {
  timestamp: number;
  step: string;
  message: string;
  type: "info" | "success" | "error" | "warn";
}

interface DeployState {
  project: string;
  status: "idle" | "running" | "success" | "failed";
  startedAt: number | null;
  finishedAt: number | null;
  logs: DeployLog[];
  currentStep: string;
}

export default function DeployPanel({ onClose }: { onClose: () => void }) {
  const { toast } = useToast();
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [deployState, setDeployState] = useState<DeployState | null>(null);
  const [serverCheck, setServerCheck] = useState<{
    ok?: boolean;
    hostname?: string;
    service?: string;
    error?: string;
    loading?: boolean;
  } | null>(null);
  const [serverLogs, setServerLogs] = useState<string | null>(null);
  const [showLogs, setShowLogs] = useState(false);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<NodeJS.Timeout | null>(null);

  // Fetch projects list
  useEffect(() => {
    fetch("/api/deploy")
      .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then((d) => setProjects(d.projects || []))
      .catch(() => toast("Deploy projeleri yüklenemedi", "error"));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Poll deploy status when running
  useEffect(() => {
    if (!selected || deployState?.status !== "running") {
      if (pollRef.current) clearInterval(pollRef.current);
      return;
    }

    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/deploy?project=${selected}`);
        const data = await res.json();
        setDeployState(data);
        if (data.status !== "running") {
          if (pollRef.current) clearInterval(pollRef.current);
        }
      } catch {}
    }, 1500);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [selected, deployState?.status]);

  // Auto scroll logs
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [deployState?.logs?.length]);

  const checkServer = async (key: string) => {
    setServerCheck({ loading: true });
    try {
      const res = await fetch(`/api/deploy?project=${key}&action=check`);
      const data = await res.json();
      setServerCheck(data);
    } catch {
      setServerCheck({ ok: false, error: "Request failed" });
    }
  };

  const fetchServerLogs = async (key: string) => {
    try {
      const res = await fetch(`/api/deploy?project=${key}&action=logs&lines=40`);
      const data = await res.json();
      setServerLogs(data.logs);
      setShowLogs(true);
    } catch {
      toast("Sunucu logları alınamadı", "error");
      setServerLogs(null);
      setShowLogs(false);
    }
  };

  const startDeploy = async (key: string) => {
    if (!confirm(`${projects.find((p) => p.key === key)?.name} deploy baslatilsin mi?`)) return;

    try {
      const res = await fetch("/api/deploy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project: key }),
      });
      const data = await res.json();
      if (data.ok) {
        toast("Deploy başlatıldı", "success");
        setDeployState({
          project: key,
          status: "running",
          startedAt: Date.now(),
          finishedAt: null,
          logs: [{ timestamp: Date.now(), step: "start", message: data.message, type: "info" }],
          currentStep: "starting",
        });
      } else {
        toast(`Deploy başlatılamadı: ${data.error || "Bilinmeyen hata"}`, "error");
      }
    } catch {
      toast("Deploy başlatılamadı", "error");
    }
  };

  const statusColor = (s: string) => {
    switch (s) {
      case "running": return "text-yellow-400";
      case "success": return "text-emerald-400";
      case "failed": return "text-red-400";
      default: return "text-muted";
    }
  };

  const statusIcon = (s: string) => {
    switch (s) {
      case "running": return "\u23F3";
      case "success": return "\u2705";
      case "failed": return "\u274C";
      default: return "\u26AA";
    }
  };

  const logColor = (type: DeployLog["type"]) => {
    switch (type) {
      case "success": return "text-emerald-400";
      case "error": return "text-red-400";
      case "warn": return "text-yellow-400";
      default: return "text-muted";
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-2xl max-h-[85vh] bg-surface border border-border rounded-xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <span>{"\uD83D\uDE80"}</span> Deploy Yonetimi
          </h2>
          <button onClick={onClose} className="text-muted hover:text-foreground text-lg">
            &times;
          </button>
        </div>

        <div className="flex-1 overflow-auto p-4 space-y-4">
          {/* Project List */}
          {!selected && (
            <div className="space-y-2">
              {projects.map((p) => (
                <div
                  key={p.key}
                  className={`p-3 rounded-lg border transition-colors ${
                    p.enabled
                      ? "border-border hover:border-indigo-500/50 cursor-pointer"
                      : "border-border/50 opacity-50"
                  }`}
                  onClick={() => p.enabled && setSelected(p.key)}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-sm font-medium">{p.name}</span>
                      <span className="text-[10px] text-muted ml-2">
                        {p.type === "dotnet" ? ".NET" : p.type === "dotnet-fdd" ? ".NET (FDD)" : p.type === "nestjs" ? "NestJS" : "?"} &middot; {p.server || "?"}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-xs ${statusColor(p.status)}`}>
                        {statusIcon(p.status)} {p.status}
                      </span>
                      {!p.enabled && (
                        <span className="text-[10px] text-muted bg-muted/10 px-1.5 py-0.5 rounded">
                          yapilandirilmamis
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Selected Project Detail */}
          {selected && (
            <div className="space-y-3">
              <button
                onClick={() => {
                  setSelected(null);
                  setDeployState(null);
                  setServerCheck(null);
                  setShowLogs(false);
                  setServerLogs(null);
                }}
                className="text-xs text-muted hover:text-foreground"
              >
                &larr; Geri
              </button>

              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">
                  {projects.find((p) => p.key === selected)?.name}
                </h3>
                <div className="flex gap-2">
                  <button
                    onClick={() => checkServer(selected)}
                    className="text-[10px] px-2 py-1 rounded bg-blue-600/20 text-blue-400 hover:bg-blue-600/30"
                  >
                    {"\uD83D\uDD0D"} Kontrol
                  </button>
                  <button
                    onClick={() => fetchServerLogs(selected)}
                    className="text-[10px] px-2 py-1 rounded bg-gray-600/20 text-gray-400 hover:bg-gray-600/30"
                  >
                    {"\uD83D\uDCCB"} Loglar
                  </button>
                  <button
                    onClick={() => startDeploy(selected)}
                    disabled={deployState?.status === "running"}
                    className={`text-[10px] px-3 py-1 rounded font-medium ${
                      deployState?.status === "running"
                        ? "bg-yellow-600/20 text-yellow-400 cursor-not-allowed"
                        : "bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/30"
                    }`}
                  >
                    {deployState?.status === "running" ? "\u23F3 Devam ediyor..." : "\uD83D\uDE80 Deploy"}
                  </button>
                </div>
              </div>

              {/* Server check result */}
              {serverCheck && (
                <div className={`text-xs p-2 rounded ${serverCheck.ok ? "bg-emerald-900/20" : "bg-red-900/20"}`}>
                  {serverCheck.loading ? (
                    <span className="text-muted">Kontrol ediliyor...</span>
                  ) : serverCheck.ok ? (
                    <div className="space-y-0.5">
                      <div className="text-emerald-400">{"\u2705"} Sunucu erisilebilir: {serverCheck.hostname}</div>
                      {serverCheck.service && (
                        <div className="text-muted">Service: <span className={serverCheck.service.includes("active") || serverCheck.service.includes("online") ? "text-emerald-400" : "text-red-400"}>{serverCheck.service}</span></div>
                      )}
                    </div>
                  ) : (
                    <div className="text-red-400">{"\u274C"} Baglanti basarisiz: {serverCheck.error}</div>
                  )}
                </div>
              )}

              {/* Server logs */}
              {showLogs && serverLogs && (
                <div className="bg-black/40 rounded-lg p-3 max-h-48 overflow-auto">
                  <div className="flex justify-between mb-1">
                    <span className="text-[10px] text-muted">Sunucu Loglari</span>
                    <button onClick={() => setShowLogs(false)} className="text-[10px] text-muted hover:text-foreground">&times;</button>
                  </div>
                  <pre className="text-[10px] text-gray-400 whitespace-pre-wrap font-mono">{serverLogs}</pre>
                </div>
              )}

              {/* Deploy logs */}
              {deployState && deployState.logs.length > 0 && (
                <div className="bg-black/40 rounded-lg p-3 max-h-64 overflow-auto">
                  <div className="text-[10px] text-muted mb-2 flex items-center justify-between">
                    <span>Deploy Loglari</span>
                    {deployState.status === "running" && (
                      <span className="flex items-center gap-1">
                        <span className="w-1.5 h-1.5 bg-yellow-400 rounded-full animate-pulse" />
                        {deployState.currentStep}
                      </span>
                    )}
                  </div>
                  <div className="space-y-0.5">
                    {deployState.logs.map((l, i) => (
                      <div key={i} className={`text-[10px] font-mono ${logColor(l.type)}`}>
                        <span className="text-muted/50">
                          {new Date(l.timestamp).toLocaleTimeString("tr-TR")}
                        </span>{" "}
                        [{l.step}] {l.message}
                      </div>
                    ))}
                    <div ref={logsEndRef} />
                  </div>

                  {deployState.status !== "running" && deployState.finishedAt && deployState.startedAt && (
                    <div className={`mt-2 pt-2 border-t border-border/30 text-xs font-medium ${
                      deployState.status === "success" ? "text-emerald-400" : "text-red-400"
                    }`}>
                      {deployState.status === "success" ? "\u2705" : "\u274C"}{" "}
                      {deployState.status === "success" ? "Deploy basarili" : "Deploy basarisiz"}{" "}
                      ({((deployState.finishedAt - deployState.startedAt) / 1000).toFixed(1)}s)
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
