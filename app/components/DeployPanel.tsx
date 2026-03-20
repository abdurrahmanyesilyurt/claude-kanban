"use client";

import { useState, useEffect, useRef, useCallback } from "react";
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
  healthCheck?: { ok: boolean; status?: string; error?: string };
}

interface BackupInfo {
  timestamp: string;
  path: string;
  size?: string;
}

type RollbackStatus = "idle" | "rolling_back" | "rolled_back" | "failed";

interface RollbackDialogProps {
  projectName: string;
  latestBackup: BackupInfo | null;
  onConfirm: () => void;
  onCancel: () => void;
}

function RollbackDialog({ projectName, latestBackup, onConfirm, onCancel }: RollbackDialogProps) {
  const formattedDate = latestBackup
    ? new Date(latestBackup.timestamp).toLocaleString("tr-TR", {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "Bilinmiyor";

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-sm bg-surface border border-red-500/40 rounded-xl p-5 shadow-xl">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-2xl">⚠️</span>
          <h3 className="text-sm font-semibold text-red-400">Rollback Onayı</h3>
        </div>
        <p className="text-xs text-muted mb-3">
          <span className="text-foreground font-medium">{projectName}</span> projesi{" "}
          önceki sürüme geri alınacak. Bu işlem mevcut sürümün üzerine yazacak.
        </p>

        {latestBackup ? (
          <div className="bg-black/30 rounded-lg p-2.5 mb-4 text-xs">
            <div className="text-muted mb-1">Geri dönülecek yedek:</div>
            <div className="text-emerald-400 font-mono">{formattedDate}</div>
            {latestBackup.size && (
              <div className="text-muted mt-0.5">Boyut: {latestBackup.size}</div>
            )}
          </div>
        ) : (
          <div className="bg-red-900/20 rounded-lg p-2.5 mb-4 text-xs text-red-400">
            ⚠️ Yedek bilgisi yüklenemedi
          </div>
        )}

        <div className="flex gap-2 justify-end">
          <button
            onClick={onCancel}
            className="text-xs px-3 py-1.5 rounded border border-border text-muted hover:text-foreground hover:border-border/80 transition-colors"
          >
            Hayır, İptal
          </button>
          <button
            onClick={onConfirm}
            className="text-xs px-3 py-1.5 rounded bg-red-600/30 text-red-400 border border-red-500/40 hover:bg-red-600/50 transition-colors font-medium"
          >
            Evet, Rollback Yap
          </button>
        </div>
      </div>
    </div>
  );
}

function RollbackBadge({ status }: { status: RollbackStatus }) {
  if (status === "idle") return null;

  const config = {
    rolling_back: {
      cls: "bg-orange-900/20 text-orange-400 border-orange-500/30",
      icon: "⏳",
      label: "Geri alınıyor...",
    },
    rolled_back: {
      cls: "bg-emerald-900/20 text-emerald-400 border-emerald-500/30",
      icon: "✅",
      label: "Rollback başarılı",
    },
    failed: {
      cls: "bg-red-900/20 text-red-400 border-red-500/30",
      icon: "❌",
      label: "Rollback başarısız",
    },
  }[status];

  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border ${config.cls}`}
    >
      <span>{config.icon}</span>
      {config.label}
    </span>
  );
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

  // Rollback states
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [backupsLoading, setBackupsLoading] = useState(false);
  const [showBackups, setShowBackups] = useState(false);
  const [rollbackStatus, setRollbackStatus] = useState<RollbackStatus>("idle");
  const [showRollbackDialog, setShowRollbackDialog] = useState(false);

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

  // Load backups when a project is selected
  const fetchBackups = useCallback(async (key: string) => {
    setBackupsLoading(true);
    setBackups([]);
    try {
      const res = await fetch(`/api/deploy/backups?projectKey=${key}`);
      const data = await res.json();
      if (Array.isArray(data)) {
        setBackups(data);
      } else {
        setBackups([]);
      }
    } catch {
      setBackups([]);
    } finally {
      setBackupsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selected) {
      fetchBackups(selected);
      setRollbackStatus("idle");
    }
  }, [selected, fetchBackups]);

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
        setRollbackStatus("idle");
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

  const handleRollbackConfirm = async () => {
    if (!selected) return;
    setShowRollbackDialog(false);
    setRollbackStatus("rolling_back");
    try {
      const res = await fetch("/api/deploy/rollback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectKey: selected }),
      });
      const data = await res.json();
      if (data.ok) {
        setRollbackStatus("rolled_back");
        toast(`Rollback başarılı: ${data.message || ""}`, "success");
        // Refresh backups list
        fetchBackups(selected);
      } else {
        setRollbackStatus("failed");
        toast(`Rollback başarısız: ${data.message || "Bilinmeyen hata"}`, "error");
      }
    } catch {
      setRollbackStatus("failed");
      toast("Rollback başlatılamadı", "error");
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
      case "running": return "⏳";
      case "success": return "✅";
      case "failed": return "❌";
      default: return "⚪";
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

  const canRollback =
    selected &&
    backups.length > 0 &&
    deployState?.status !== "running" &&
    rollbackStatus !== "rolling_back";

  const deployFinished =
    deployState &&
    deployState.status !== "running" &&
    deployState.status !== "idle";

  const deployFailed = deployState?.status === "failed";

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
        <div className="w-full max-w-2xl max-h-[85vh] bg-surface border border-border rounded-xl overflow-hidden flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-3 border-b border-border">
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <span>🚀</span> Deploy Yönetimi
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
                          {p.type === "dotnet"
                            ? ".NET"
                            : p.type === "dotnet-fdd"
                            ? ".NET (FDD)"
                            : p.type === "nestjs"
                            ? "NestJS"
                            : "?"}{" "}
                          &middot; {p.server || "?"}
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
                    setShowBackups(false);
                    setBackups([]);
                    setRollbackStatus("idle");
                  }}
                  className="text-xs text-muted hover:text-foreground"
                >
                  &larr; Geri
                </button>

                {/* Project header + action buttons */}
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold">
                      {projects.find((p) => p.key === selected)?.name}
                    </h3>
                    <RollbackBadge status={rollbackStatus} />
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    <button
                      onClick={() => checkServer(selected)}
                      className="text-[10px] px-2 py-1 rounded bg-blue-600/20 text-blue-400 hover:bg-blue-600/30"
                    >
                      🔍 Kontrol
                    </button>
                    <button
                      onClick={() => fetchServerLogs(selected)}
                      className="text-[10px] px-2 py-1 rounded bg-gray-600/20 text-gray-400 hover:bg-gray-600/30"
                    >
                      📋 Loglar
                    </button>
                    <button
                      onClick={() => {
                        setShowBackups((v) => !v);
                        if (!showBackups) fetchBackups(selected);
                      }}
                      className="text-[10px] px-2 py-1 rounded bg-purple-600/20 text-purple-400 hover:bg-purple-600/30"
                    >
                      🗂️ Yedekler {backups.length > 0 ? `(${backups.length})` : ""}
                    </button>
                    <button
                      onClick={() => {
                        if (!canRollback) return;
                        setShowRollbackDialog(true);
                      }}
                      disabled={!canRollback}
                      title={
                        backups.length === 0
                          ? "Yedek bulunamadı"
                          : rollbackStatus === "rolling_back"
                          ? "Rollback devam ediyor"
                          : deployState?.status === "running"
                          ? "Deploy devam ediyor"
                          : "Önceki sürüme geri dön"
                      }
                      className={`text-[10px] px-2 py-1 rounded font-medium border transition-colors ${
                        canRollback
                          ? "bg-red-600/20 text-red-400 border-red-500/30 hover:bg-red-600/35"
                          : "bg-red-600/10 text-red-400/40 border-red-500/10 cursor-not-allowed"
                      }`}
                    >
                      ↩️ Rollback
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
                      {deployState?.status === "running" ? "⏳ Devam ediyor..." : "🚀 Deploy"}
                    </button>
                  </div>
                </div>

                {/* Health check result after deploy */}
                {deployFinished && (
                  <div
                    className={`text-xs p-2.5 rounded-lg border flex items-start gap-2 ${
                      deployFailed
                        ? "bg-red-900/15 border-red-500/30"
                        : "bg-emerald-900/15 border-emerald-500/30"
                    }`}
                  >
                    <span className="text-base leading-none mt-0.5">
                      {deployFailed ? "❌" : "✅"}
                    </span>
                    <div className="flex-1">
                      <div
                        className={`font-medium ${
                          deployFailed ? "text-red-400" : "text-emerald-400"
                        }`}
                      >
                        {deployFailed ? "Deploy başarısız" : "Deploy başarılı"}
                        {deployState?.finishedAt && deployState?.startedAt && (
                          <span className="font-normal text-muted ml-1.5">
                            ({((deployState.finishedAt - deployState.startedAt) / 1000).toFixed(1)}s)
                          </span>
                        )}
                      </div>
                      {deployFailed && canRollback && (
                        <div className="mt-1 text-muted">
                          Sorun devam ederse{" "}
                          <button
                            onClick={() => setShowRollbackDialog(true)}
                            className="text-red-400 underline hover:text-red-300"
                          >
                            rollback yapabilirsiniz
                          </button>
                          .
                        </div>
                      )}
                      {deployState?.healthCheck && (
                        <div className="mt-1">
                          <span className="text-muted">Health check: </span>
                          <span
                            className={
                              deployState.healthCheck.ok ? "text-emerald-400" : "text-red-400"
                            }
                          >
                            {deployState.healthCheck.ok
                              ? deployState.healthCheck.status || "OK"
                              : deployState.healthCheck.error || "Başarısız"}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Server check result */}
                {serverCheck && (
                  <div
                    className={`text-xs p-2 rounded ${
                      serverCheck.ok ? "bg-emerald-900/20" : "bg-red-900/20"
                    }`}
                  >
                    {serverCheck.loading ? (
                      <span className="text-muted">Kontrol ediliyor...</span>
                    ) : serverCheck.ok ? (
                      <div className="space-y-0.5">
                        <div className="text-emerald-400">
                          ✅ Sunucu erişilebilir: {serverCheck.hostname}
                        </div>
                        {serverCheck.service && (
                          <div className="text-muted">
                            Service:{" "}
                            <span
                              className={
                                serverCheck.service.includes("active") ||
                                serverCheck.service.includes("online")
                                  ? "text-emerald-400"
                                  : "text-red-400"
                              }
                            >
                              {serverCheck.service}
                            </span>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="text-red-400">
                        ❌ Bağlantı başarısız: {serverCheck.error}
                      </div>
                    )}
                  </div>
                )}

                {/* Backups section */}
                {showBackups && (
                  <div className="bg-black/30 rounded-lg border border-border/30 overflow-hidden">
                    <div className="flex items-center justify-between px-3 py-2 border-b border-border/20">
                      <span className="text-[10px] font-medium text-muted">
                        🗂️ Yedekler
                      </span>
                      <button
                        onClick={() => fetchBackups(selected)}
                        className="text-[10px] text-muted hover:text-foreground"
                      >
                        ↻ Yenile
                      </button>
                    </div>
                    {backupsLoading ? (
                      <div className="text-[10px] text-muted p-3">Yükleniyor...</div>
                    ) : backups.length === 0 ? (
                      <div className="text-[10px] text-muted p-3">Yedek bulunamadı.</div>
                    ) : (
                      <div className="divide-y divide-border/10 max-h-40 overflow-auto">
                        {backups.map((b, i) => (
                          <div
                            key={i}
                            className="flex items-center justify-between px-3 py-1.5 text-[10px]"
                          >
                            <div className="flex items-center gap-2">
                              {i === 0 && (
                                <span className="bg-emerald-600/20 text-emerald-400 px-1 py-0.5 rounded text-[9px]">
                                  son
                                </span>
                              )}
                              <span className="text-foreground font-mono">
                                {new Date(b.timestamp).toLocaleString("tr-TR", {
                                  dateStyle: "short",
                                  timeStyle: "short",
                                })}
                              </span>
                            </div>
                            <div className="flex items-center gap-3">
                              {b.size && (
                                <span className="text-muted">{b.size}</span>
                              )}
                              <span className="text-muted/50 font-mono truncate max-w-[120px]" title={b.path}>
                                {b.path.split("/").pop()}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Server logs */}
                {showLogs && serverLogs && (
                  <div className="bg-black/40 rounded-lg p-3 max-h-48 overflow-auto">
                    <div className="flex justify-between mb-1">
                      <span className="text-[10px] text-muted">Sunucu Logları</span>
                      <button
                        onClick={() => setShowLogs(false)}
                        className="text-[10px] text-muted hover:text-foreground"
                      >
                        &times;
                      </button>
                    </div>
                    <pre className="text-[10px] text-gray-400 whitespace-pre-wrap font-mono">
                      {serverLogs}
                    </pre>
                  </div>
                )}

                {/* Deploy logs */}
                {deployState && deployState.logs.length > 0 && (
                  <div className="bg-black/40 rounded-lg p-3 max-h-64 overflow-auto">
                    <div className="text-[10px] text-muted mb-2 flex items-center justify-between">
                      <span>Deploy Logları</span>
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
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Rollback Confirmation Dialog */}
      {showRollbackDialog && selected && (
        <RollbackDialog
          projectName={projects.find((p) => p.key === selected)?.name ?? selected}
          latestBackup={backups[0] ?? null}
          onConfirm={handleRollbackConfirm}
          onCancel={() => setShowRollbackDialog(false)}
        />
      )}
    </>
  );
}
