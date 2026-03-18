"use client";

import { useState } from "react";
import type { Task, Project } from "@/lib/types";
import { STATUS_COLORS, PRIORITY_COLORS, PRIORITY_LABELS } from "@/lib/types";

interface TaskCardProps {
  task: Task;
  project?: Project;
  onStartAgent: (taskId: string) => void;
  onStopAgent: (taskId: string) => void;
  onOpenLog: (taskId: string) => void;
  onDelete: (taskId: string) => void;
  onRestart: (taskId: string) => void;
  onEdit: (task: Task) => void;
}

export default function TaskCard({ task, project, onStartAgent, onStopAgent, onOpenLog, onDelete, onRestart, onEdit }: TaskCardProps) {
  const [waSending, setWaSending] = useState(false);
  const [waResult, setWaResult] = useState<{ ok: boolean; message: string } | null>(null);

  const sendToWhatsApp = async (target: string) => {
    setWaSending(true);
    setWaResult(null);
    try {
      const res = await fetch("/api/whatsapp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskId: task.id,
          target,
          docPath: task.doc_path || undefined,
        }),
      });
      const data = await res.json();
      setWaResult({ ok: data.ok ?? false, message: data.message || data.error || "Bilinmeyen hata" });
    } catch (e) {
      setWaResult({ ok: false, message: String(e) });
    } finally {
      setWaSending(false);
    }
  };

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", task.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      className="bg-surface border border-border rounded-lg p-3 hover:border-border-hover transition-colors group cursor-grab active:cursor-grabbing"
    >
      <div className="flex items-start justify-between gap-2">
        <h3
          className="text-sm font-medium leading-snug cursor-pointer hover:text-indigo-300 transition-colors"
          onClick={() => onEdit(task)}
          title="Düzenlemek için tıkla"
        >
          {task.title}
        </h3>
        <div className="flex items-center gap-1 shrink-0">
          {task.status === "in_progress" && (
            <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse mt-0.5" />
          )}
          <button
            onClick={() => onDelete(task.id)}
            className="text-muted/30 hover:text-red-400 text-xs transition-colors opacity-0 group-hover:opacity-100 mt-0.5"
            title="Sil"
          >
            &times;
          </button>
        </div>
      </div>

      {task.description && (() => {
        const checkItems = task.description.match(/^- \[[ x]\] .+$/gm);
        if (checkItems && checkItems.length > 0) {
          const done = checkItems.filter((l) => l.startsWith("- [x]")).length;
          return (
            <div className="flex items-center gap-1.5 mt-1 text-[10px] text-muted">
              <div className="flex-1 h-1 bg-white/5 rounded-full overflow-hidden">
                <div
                  className="h-full bg-emerald-500 rounded-full transition-all"
                  style={{ width: `${(done / checkItems.length) * 100}%` }}
                />
              </div>
              <span>{done}/{checkItems.length}</span>
            </div>
          );
        }
        return <p className="text-xs text-muted mt-1 line-clamp-2">{task.description}</p>;
      })()}

      {/* Progress bar */}
      {task.progress > 0 && task.status !== "done" && (
        <div className="mt-2 h-1 bg-white/5 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${task.progress}%`,
              backgroundColor: STATUS_COLORS[task.status],
            }}
          />
        </div>
      )}

      <div className="mt-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          {project && (
            <span
              className="inline-flex items-center gap-1 text-[10px] text-muted px-1.5 py-0.5 rounded bg-white/5"
            >
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ backgroundColor: project.color }}
              />
              {project.name}
            </span>
          )}
          {task.priority && task.priority !== "medium" && (
            <span
              className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded"
              style={{
                color: PRIORITY_COLORS[task.priority],
                backgroundColor: `${PRIORITY_COLORS[task.priority]}15`,
              }}
            >
              {task.priority === "high" ? "\u25B2" : "\u25BC"} {PRIORITY_LABELS[task.priority]}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1">
          {task.status === "todo" && (
            <button
              onClick={() => onStartAgent(task.id)}
              className="text-[10px] px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-400 hover:bg-indigo-500/30 transition-colors"
            >
              Agent Başlat
            </button>
          )}
          {task.status === "in_progress" && (
            <button
              onClick={() => onStopAgent(task.id)}
              className="text-[10px] px-2 py-0.5 rounded bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors"
            >
              Durdur
            </button>
          )}
          {(task.status === "done" || task.status === "error") && (
            <button
              onClick={() => onRestart(task.id)}
              className="text-[10px] px-2 py-0.5 rounded bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 transition-colors"
            >
              Tekrar
            </button>
          )}
          {(task.status === "in_progress" || task.status === "done" || task.status === "error") && (
            <button
              onClick={() => onOpenLog(task.id)}
              className="text-[10px] px-2 py-0.5 rounded bg-white/5 text-muted hover:text-foreground transition-colors"
            >
              Log
            </button>
          )}
        </div>
      </div>

      {/* Doc path & WhatsApp send — only for completed tasks */}
      {task.status === "done" && (
        <div className="mt-2 pt-2 border-t border-border/50 space-y-1.5">
          {task.doc_path && (
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-emerald-400">&#128196;</span>
              <span className="text-[10px] text-muted font-mono truncate flex-1" title={task.doc_path}>
                {task.doc_path.split(/[/\\]/).slice(-2).join("/")}
              </span>
            </div>
          )}
          <div className="flex items-center gap-1">
            <button
              onClick={() => {
                const target = prompt("Hedef (telefon veya grup adi):", "Ivır Zıvır");
                if (target) sendToWhatsApp(target);
              }}
              disabled={waSending}
              className="text-[10px] px-2 py-0.5 rounded bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/30 transition-colors disabled:opacity-50 flex items-center gap-1"
            >
              <span>&#128172;</span>
              {waSending ? "Gonderiliyor..." : "WhatsApp"}
            </button>
            {waResult && (
              <span className={`text-[10px] ${waResult.ok ? "text-emerald-400" : "text-red-400"}`}>
                {waResult.ok ? "Gonderildi!" : waResult.message.slice(0, 40)}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
