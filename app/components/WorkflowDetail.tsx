"use client";

import { useEffect, useState } from "react";
import type { Workflow, WorkflowStep } from "@/lib/types";
import { WORKFLOW_STATUS_LABELS, WORKFLOW_STATUS_COLORS, STEP_STATUS_LABELS } from "@/lib/types";
import WorkflowLogPanel from "./WorkflowLogPanel";

interface WorkflowDetailProps {
  workflow: Workflow;
  onClose: () => void;
  onRefresh: () => void;
}

export default function WorkflowDetail({ workflow, onClose, onRefresh }: WorkflowDetailProps) {
  const [steps, setSteps] = useState<WorkflowStep[]>([]);
  const [showLog, setShowLog] = useState(false);
  const [expandedStep, setExpandedStep] = useState<string | null>(null);

  const fetchSteps = () => {
    fetch(`/api/workflows/steps?workflow_id=${workflow.id}`)
      .then((r) => r.json())
      .then((data) => setSteps(data))
      .catch(() => {});
  };

  useEffect(() => {
    fetchSteps();
    const interval = setInterval(fetchSteps, 3000);
    return () => clearInterval(interval);
  }, [workflow.id]);

  const handleStart = async () => {
    await fetch("/api/workflows/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workflowId: workflow.id }),
    });
    onRefresh();
    setShowLog(true);
  };

  const handleStop = async () => {
    await fetch("/api/workflows/stop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workflowId: workflow.id }),
    });
    onRefresh();
  };

  const isActive = ["planning", "running", "reviewing"].includes(workflow.status);
  const doneCount = steps.filter((s) => s.status === "done").length;

  // Group steps into waves by dependency depth
  const getWave = (step: WorkflowStep, allSteps: WorkflowStep[], cache: Map<string, number> = new Map()): number => {
    if (cache.has(step.id)) return cache.get(step.id)!;
    const deps: string[] = JSON.parse(step.depends_on || "[]");
    if (deps.length === 0) { cache.set(step.id, 0); return 0; }
    const maxDep = Math.max(...deps.map((dId) => {
      const depStep = allSteps.find((s) => s.id === dId);
      return depStep ? getWave(depStep, allSteps, cache) : 0;
    }));
    const wave = maxDep + 1;
    cache.set(step.id, wave);
    return wave;
  };

  const waves: Map<number, WorkflowStep[]> = new Map();
  const cache = new Map<string, number>();
  for (const step of steps) {
    const w = getWave(step, steps, cache);
    if (!waves.has(w)) waves.set(w, []);
    waves.get(w)!.push(step);
  }
  const sortedWaves = Array.from(waves.entries()).sort((a, b) => a[0] - b[0]);

  const stepStatusIcon = (status: string) => {
    switch (status) {
      case "done": return "✓";
      case "running": return "⟳";
      case "error": return "✗";
      case "skipped": return "⊘";
      default: return "○";
    }
  };

  const stepStatusColor = (status: string) => {
    switch (status) {
      case "done": return "border-emerald-500/50 bg-emerald-500/5";
      case "running": return "border-amber-500/50 bg-amber-500/5";
      case "error": return "border-red-500/50 bg-red-500/5";
      case "skipped": return "border-gray-500/30 bg-gray-500/5 opacity-50";
      default: return "border-border bg-background";
    }
  };

  const roleColors: Record<string, string> = {
    backend: "bg-blue-500/20 text-blue-300",
    frontend: "bg-green-500/20 text-green-300",
    test: "bg-amber-500/20 text-amber-300",
    docs: "bg-purple-500/20 text-purple-300",
    refactor: "bg-cyan-500/20 text-cyan-300",
  };

  const getRoleClass = (role: string) => {
    for (const [key, cls] of Object.entries(roleColors)) {
      if (role.toLowerCase().includes(key)) return cls;
    }
    return "bg-white/10 text-muted";
  };

  // Parse shared memory
  let sharedMemory: Record<string, string> = {};
  try { sharedMemory = JSON.parse(workflow.shared_memory || "{}"); } catch { /* ignore */ }
  const hasMemory = Object.keys(sharedMemory).length > 0;

  return (
    <>
      <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-sm">
        <div className="w-full max-w-4xl max-h-[90vh] bg-surface border border-border rounded-xl flex flex-col overflow-hidden">
          {/* Header */}
          <div className="px-5 py-4 border-b border-border">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-3">
                <h2 className="text-lg font-semibold">{workflow.title}</h2>
                <span
                  className="text-[10px] px-2 py-0.5 rounded-full font-medium"
                  style={{ backgroundColor: WORKFLOW_STATUS_COLORS[workflow.status as keyof typeof WORKFLOW_STATUS_COLORS] + "20", color: WORKFLOW_STATUS_COLORS[workflow.status as keyof typeof WORKFLOW_STATUS_COLORS] }}
                >
                  {WORKFLOW_STATUS_LABELS[workflow.status as keyof typeof WORKFLOW_STATUS_LABELS]}
                </span>
              </div>
              <button onClick={onClose} className="text-muted hover:text-foreground text-lg">&times;</button>
            </div>
            <p className="text-xs text-muted">{workflow.description}</p>
            <div className="flex items-center gap-2 mt-3">
              {workflow.status === "draft" && (
                <button onClick={handleStart} className="px-3 py-1 text-xs bg-indigo-600 hover:bg-indigo-500 rounded-md transition-colors">
                  Başlat
                </button>
              )}
              {isActive && (
                <button onClick={handleStop} className="px-3 py-1 text-xs bg-red-600/80 hover:bg-red-600 rounded-md transition-colors">
                  Durdur
                </button>
              )}
              <button onClick={() => setShowLog(true)} className="px-3 py-1 text-xs border border-border hover:border-border-hover rounded-md text-muted hover:text-foreground transition-colors">
                Log
              </button>
              {steps.length > 0 && (
                <span className="text-xs text-muted ml-auto">{doneCount}/{steps.length} adım tamamlandı</span>
              )}
            </div>
          </div>

          {/* Steps Pipeline */}
          <div className="flex-1 overflow-auto p-5">
            {steps.length === 0 ? (
              <div className="flex items-center justify-center h-full">
                <p className="text-muted text-sm">
                  {workflow.status === "draft" ? "İş akışını başlattığınızda koordinatör planı oluşturacak" : "Plan oluşturuluyor..."}
                </p>
              </div>
            ) : (
              <div className="flex gap-6 overflow-x-auto pb-4">
                {sortedWaves.map(([wave, waveSteps], wi) => (
                  <div key={wave} className="flex flex-col gap-3 min-w-[220px]">
                    <div className="text-[10px] text-muted font-medium uppercase tracking-wider mb-1 flex items-center gap-2">
                      <span>Dalga {wave + 1}</span>
                      {wi < sortedWaves.length - 1 && <span className="text-muted/30">→</span>}
                    </div>
                    {waveSteps.map((step) => (
                      <div
                        key={step.id}
                        onClick={() => setExpandedStep(expandedStep === step.id ? null : step.id)}
                        className={`border rounded-lg p-3 cursor-pointer transition-all hover:scale-[1.02] ${stepStatusColor(step.status)}`}
                      >
                        <div className="flex items-center gap-2 mb-1.5">
                          <span className={`text-xs px-1.5 py-0.5 rounded ${getRoleClass(step.role)}`}>
                            {step.role}
                          </span>
                          <span className="text-xs ml-auto">
                            {step.status === "running" ? (
                              <span className="text-amber-400 animate-pulse">{stepStatusIcon(step.status)}</span>
                            ) : (
                              <span>{stepStatusIcon(step.status)}</span>
                            )}
                          </span>
                        </div>
                        <p className="text-sm font-medium">{step.title}</p>
                        <p className="text-[10px] text-muted mt-0.5">
                          {STEP_STATUS_LABELS[step.status as keyof typeof STEP_STATUS_LABELS]}
                        </p>

                        {expandedStep === step.id && step.agent_summary && (
                          <div className="mt-2 pt-2 border-t border-border">
                            <p className="text-[10px] text-muted mb-1">Agent Özeti:</p>
                            <p className="text-xs whitespace-pre-wrap">{step.agent_summary.slice(0, 500)}</p>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}

            {/* Shared Memory */}
            {hasMemory && (
              <div className="mt-6 border-t border-border pt-4">
                <h3 className="text-xs font-medium text-muted mb-2">Paylaşılan Hafıza</h3>
                <div className="bg-background border border-border rounded-lg p-3 space-y-2">
                  {Object.entries(sharedMemory).map(([role, summary]) => (
                    <div key={role}>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${getRoleClass(role)}`}>{role}</span>
                      <p className="text-xs mt-1 text-muted">{String(summary).slice(0, 300)}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {showLog && (
        <WorkflowLogPanel workflowId={workflow.id} onClose={() => setShowLog(false)} />
      )}
    </>
  );
}
