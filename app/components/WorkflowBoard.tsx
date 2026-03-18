"use client";

import { useCallback, useEffect, useState } from "react";
import type { Project, Workflow } from "@/lib/types";
import { WORKFLOW_STATUS_LABELS, WORKFLOW_STATUS_COLORS } from "@/lib/types";
import { useToast } from "./Toast";
import NewWorkflowModal from "./NewWorkflowModal";
import WorkflowDetail from "./WorkflowDetail";

interface WorkflowBoardProps {
  projects: Project[];
  activeProjectId: string | null;
}

export default function WorkflowBoard({ projects, activeProjectId }: WorkflowBoardProps) {
  const { toast } = useToast();
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [showNewModal, setShowNewModal] = useState(false);
  const [selectedWorkflow, setSelectedWorkflow] = useState<Workflow | null>(null);

  const fetchWorkflows = useCallback(() => {
    const url = activeProjectId
      ? `/api/workflows?project_id=${activeProjectId}`
      : "/api/workflows";
    fetch(url)
      .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then((data) => setWorkflows(data))
      .catch(() => { /* polling — silent */ });
  }, [activeProjectId]);

  useEffect(() => {
    fetchWorkflows();
    const interval = setInterval(fetchWorkflows, 3000);
    return () => clearInterval(interval);
  }, [fetchWorkflows]);

  // Refresh selected workflow data
  useEffect(() => {
    if (selectedWorkflow) {
      const updated = workflows.find((w) => w.id === selectedWorkflow.id);
      if (updated && updated.status !== selectedWorkflow.status) {
        setSelectedWorkflow(updated);
      }
    }
  }, [workflows, selectedWorkflow]);

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch("/api/workflows", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (res.ok) {
        toast("İş akışı silindi", "info");
      } else {
        toast("İş akışı silinemedi", "error");
      }
    } catch {
      toast("İş akışı silinemedi", "error");
    }
    fetchWorkflows();
  };

  const activeCount = workflows.filter((w) => ["planning", "running", "reviewing"].includes(w.status)).length;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="px-4 py-3 border-b border-border flex items-center gap-3">
        <h2 className="text-sm font-semibold">İş Akışları</h2>
        {activeCount > 0 && (
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300">
            {activeCount} aktif
          </span>
        )}
        <button
          onClick={() => setShowNewModal(true)}
          className="ml-auto px-3 py-1.5 text-xs bg-indigo-600 hover:bg-indigo-500 rounded-md transition-colors"
        >
          + Yeni İş Akışı
        </button>
      </div>

      {/* Workflow list */}
      <div className="flex-1 overflow-y-auto p-4">
        {workflows.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <p className="text-muted text-sm mb-2">Henüz iş akışı yok</p>
              <p className="text-muted/50 text-xs">
                İş akışları, birden fazla agent&apos;ın koordineli çalışmasını sağlar
              </p>
            </div>
          </div>
        ) : (
          <div className="grid gap-3 max-w-3xl">
            {workflows.map((wf) => {
              const projectName = projects.find((p) => p.id === wf.project_id)?.name;
              const statusColor = WORKFLOW_STATUS_COLORS[wf.status as keyof typeof WORKFLOW_STATUS_COLORS] ?? "#6b7280";
              const statusLabel = WORKFLOW_STATUS_LABELS[wf.status as keyof typeof WORKFLOW_STATUS_LABELS] ?? wf.status;
              const isActive = ["planning", "running", "reviewing"].includes(wf.status);

              return (
                <div
                  key={wf.id}
                  className="border border-border rounded-lg p-4 bg-surface hover:border-border-hover transition-colors cursor-pointer"
                  onClick={() => setSelectedWorkflow(wf)}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="text-sm font-medium truncate">{wf.title}</h3>
                        <span
                          className="text-[10px] px-2 py-0.5 rounded-full font-medium shrink-0"
                          style={{ backgroundColor: statusColor + "20", color: statusColor }}
                        >
                          {isActive && <span className="inline-block w-1.5 h-1.5 rounded-full mr-1 animate-pulse" style={{ backgroundColor: statusColor }} />}
                          {statusLabel}
                        </span>
                      </div>
                      <p className="text-xs text-muted truncate">{wf.description || "Açıklama yok"}</p>
                      {projectName && (
                        <p className="text-[10px] text-muted/50 mt-1">{projectName}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-1 ml-2 shrink-0">
                      {wf.status === "draft" && (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDelete(wf.id); }}
                          className="text-xs text-muted hover:text-red-400 px-1.5 py-0.5 transition-colors"
                        >
                          Sil
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {showNewModal && (
        <NewWorkflowModal
          projects={projects}
          activeProjectId={activeProjectId}
          onClose={() => setShowNewModal(false)}
          onCreated={fetchWorkflows}
        />
      )}

      {selectedWorkflow && (
        <WorkflowDetail
          workflow={selectedWorkflow}
          onClose={() => setSelectedWorkflow(null)}
          onRefresh={fetchWorkflows}
        />
      )}
    </div>
  );
}
