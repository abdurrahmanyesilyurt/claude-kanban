"use client";

import { useState, useEffect, useCallback } from "react";
import type { Project, Task } from "@/lib/types";
import { STATUS_LABELS, STATUS_COLORS } from "@/lib/types";
import { ToastProvider, useToast } from "./Toast";
import Sidebar from "./Sidebar";
import TaskCard from "./TaskCard";
import NewTaskModal from "./NewTaskModal";
import AgentLogPanel from "./AgentLogPanel";
import ProjectSettingsModal from "./ProjectSettingsModal";
import EditTaskModal from "./EditTaskModal";
import StatsBar from "./StatsBar";

const COLUMNS: Task["status"][] = ["todo", "in_progress", "done", "error"];

export default function KanbanBoard() {
  return (
    <ToastProvider>
      <KanbanBoardInner />
    </ToastProvider>
  );
}

function KanbanBoardInner() {
  const { toast } = useToast();
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [showNewTask, setShowNewTask] = useState(false);
  const [logTaskId, setLogTaskId] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [dragOverColumn, setDragOverColumn] = useState<Task["status"] | null>(null);
  const [sortBy, setSortBy] = useState<"date" | "priority">("date");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const fetchData = useCallback(async () => {
    const [projRes, taskRes] = await Promise.all([
      fetch("/api/projects"),
      fetch("/api/tasks"),
    ]);
    if (projRes.ok) setProjects(await projRes.json());
    if (taskRes.ok) setTasks(await taskRes.json());
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 3000);
    return () => clearInterval(interval);
  }, [fetchData]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore when typing in an input/textarea
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      if (e.key === "n" && !e.ctrlKey && !e.metaKey) {
        if (projects.length > 0) {
          e.preventDefault();
          setShowNewTask(true);
        }
      }

      if (e.key === "Escape") {
        if (editingTask) setEditingTask(null);
        else if (logTaskId) setLogTaskId(null);
        else if (showNewTask) setShowNewTask(false);
        else if (showSettings) setShowSettings(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [projects.length, editingTask, logTaskId, showNewTask, showSettings]);

  const filteredTasks = tasks.filter((t) => {
    if (activeProjectId && t.project_id !== activeProjectId) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return t.title.toLowerCase().includes(q) || t.description.toLowerCase().includes(q);
    }
    return true;
  });

  const projectMap = new Map(projects.map((p) => [p.id, p]));

  const handleStartAgent = async (taskId: string) => {
    const res = await fetch("/api/agent/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId }),
    });
    if (res.ok) {
      toast("Agent başlatıldı", "success");
    } else {
      toast("Agent başlatılamadı", "error");
    }
    setLogTaskId(taskId);
    fetchData();
  };

  const handleStopAgent = async (taskId: string) => {
    const res = await fetch("/api/agent/stop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId }),
    });
    if (res.ok) {
      toast("Agent durduruldu", "info");
    } else {
      toast("Agent durdurulamadı", "error");
    }
    fetchData();
  };

  const handleDeleteTask = async (taskId: string) => {
    if (!confirm("Bu task silinecek. Emin misin?")) return;
    const res = await fetch("/api/tasks", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: taskId }),
    });
    if (res.ok) {
      setTasks((prev) => prev.filter((t) => t.id !== taskId));
      toast("Task silindi", "info");
    }
  };

  const handleRestartTask = async (taskId: string) => {
    await fetch("/api/tasks", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: taskId, status: "todo", progress: 0 }),
    });
    toast("Task sıfırlandı", "info");
    fetchData();
  };

  const handleDrop = async (status: Task["status"], e: React.DragEvent) => {
    e.preventDefault();
    setDragOverColumn(null);
    const taskId = e.dataTransfer.getData("text/plain");
    const task = tasks.find((t) => t.id === taskId);
    if (!task || task.status === status) return;

    // Optimistic update
    setTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, status, progress: status === "todo" ? 0 : t.progress } : t))
    );

    await fetch("/api/tasks", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: taskId, status, progress: status === "todo" ? 0 : undefined }),
    });
    toast(`Task "${task.title}" taşındı`, "info");
  };

  const handleDeleteProject = async (projectId: string) => {
    if (!confirm("Bu proje ve tüm task'ları silinecek. Emin misin?")) return;
    const res = await fetch("/api/projects", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: projectId }),
    });
    if (res.ok) {
      setProjects((prev) => prev.filter((p) => p.id !== projectId));
      setTasks((prev) => prev.filter((t) => t.project_id !== projectId));
      if (activeProjectId === projectId) setActiveProjectId(null);
      toast("Proje silindi", "info");
    }
  };

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <div className={`${sidebarOpen ? "translate-x-0" : "-translate-x-full"} md:translate-x-0 fixed md:relative z-50 md:z-auto transition-transform duration-200`}>
        <Sidebar
          projects={projects}
          activeProjectId={activeProjectId}
          onSelectProject={(id) => {
            setActiveProjectId(id);
            setSidebarOpen(false);
          }}
          onProjectCreated={(p) => setProjects((prev) => [p, ...prev])}
          onDeleteProject={handleDeleteProject}
        />
      </div>

      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Toolbar */}
        <div className="flex items-center justify-between px-4 md:px-6 py-3 border-b border-border gap-2">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="md:hidden text-muted hover:text-foreground text-lg"
            >
              &#9776;
            </button>
            <h2 className="text-sm font-medium text-muted">
            {activeProjectId
              ? projectMap.get(activeProjectId)?.name ?? "Proje"
              : "Tüm Projeler"}
            <span className="ml-2 text-xs text-muted/60">
              {filteredTasks.length} task
            </span>
          </h2>
          </div>
          {(() => {
            const activeAgents = tasks.filter((t) => t.status === "in_progress").length;
            if (activeAgents === 0) return null;
            return (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/20">
                <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                <span className="text-xs font-medium text-amber-400">
                  {activeAgents} agent çalışıyor
                </span>
              </div>
            );
          })()}
          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="Task ara..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="hidden sm:block w-44 bg-background border border-border rounded-md px-2.5 py-1.5 text-sm outline-none focus:border-border-hover placeholder:text-muted/40"
            />
            <button
              onClick={() => setSortBy(sortBy === "date" ? "priority" : "date")}
              className="px-2.5 py-1.5 text-xs border border-border hover:border-border-hover rounded-md transition-colors text-muted hover:text-foreground"
              title={`Sıralama: ${sortBy === "date" ? "Tarih" : "Öncelik"}`}
            >
              {sortBy === "date" ? "Tarih" : "Öncelik"}
            </button>
            {activeProjectId && (
              <button
                onClick={() => setShowSettings(true)}
                className="px-3 py-1.5 text-sm border border-border hover:border-border-hover rounded-md transition-colors text-muted hover:text-foreground"
              >
                Ayarlar
              </button>
            )}
            <button
              onClick={() => setShowNewTask(true)}
              disabled={projects.length === 0}
              className="px-3 py-1.5 text-sm bg-indigo-600 hover:bg-indigo-500 rounded-md transition-colors disabled:opacity-50"
            >
              + Yeni Task <kbd className="ml-1 text-[10px] opacity-60 font-mono">N</kbd>
            </button>
          </div>
        </div>

        {/* Stats */}
        <StatsBar projectId={activeProjectId} />

        {/* Empty state */}
        {projects.length === 0 && (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center max-w-sm space-y-4">
              <div className="text-4xl">&#x1F4CB;</div>
              <h3 className="text-lg font-semibold">Claude Kanban&apos;a Hoşgeldin</h3>
              <p className="text-sm text-muted leading-relaxed">
                AI destekli task yönetim aracın hazır. Başlamak için sol panelden bir proje ekle,
                sonra task oluşturup Claude agent&apos;ı başlat.
              </p>
              <div className="text-xs text-muted/60 space-y-1">
                <p>1. &quot;+ Yeni Proje&quot; ile proje dizinini ekle</p>
                <p>2. &quot;CLAUDE.md Oluştur&quot; ile projeyi analiz ettir</p>
                <p>3. Task oluştur ve &quot;Agent Başlat&quot; ile Claude&apos;u çalıştır</p>
              </div>
            </div>
          </div>
        )}

        {/* Columns */}
        {projects.length > 0 && (
        <div className="flex-1 flex overflow-x-auto p-2 md:p-4 gap-3 md:gap-4">
          {COLUMNS.map((status) => {
            const priorityOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
            const columnTasks = filteredTasks
              .filter((t) => t.status === status)
              .sort((a, b) => {
                if (sortBy === "priority") {
                  return (priorityOrder[a.priority] ?? 1) - (priorityOrder[b.priority] ?? 1);
                }
                return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
              });
            return (
              <div
                key={status}
                className={`w-64 md:w-72 shrink-0 flex flex-col rounded-lg transition-colors ${
                  dragOverColumn === status ? "bg-white/5" : ""
                }`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOverColumn(status);
                }}
                onDragLeave={() => setDragOverColumn(null)}
                onDrop={(e) => handleDrop(status, e)}
              >
                {/* Column header */}
                <div className="flex items-center gap-2 mb-3 px-1">
                  <span
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: STATUS_COLORS[status] }}
                  />
                  <span className="text-xs font-medium uppercase tracking-wider text-muted">
                    {STATUS_LABELS[status]}
                  </span>
                  <span className="text-xs text-muted/50">{columnTasks.length}</span>
                </div>

                {/* Cards */}
                <div className="flex-1 space-y-2 overflow-y-auto pr-1">
                  {columnTasks.map((task) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      project={projectMap.get(task.project_id)}
                      onStartAgent={handleStartAgent}
                      onStopAgent={handleStopAgent}
                      onOpenLog={setLogTaskId}
                      onDelete={handleDeleteTask}
                      onRestart={handleRestartTask}
                      onEdit={setEditingTask}
                    />
                  ))}

                  {columnTasks.length === 0 && (
                    <div className="border border-dashed border-border rounded-lg p-4 text-center text-xs text-muted/40">
                      Boş
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        )}
      </main>

      {/* Modals */}
      {showNewTask && (
        <NewTaskModal
          projects={projects}
          defaultProjectId={activeProjectId}
          onClose={() => setShowNewTask(false)}
          onCreated={(task) => setTasks((prev) => [task, ...prev])}
        />
      )}

      {logTaskId && (
        <AgentLogPanel
          taskId={logTaskId}
          onClose={() => setLogTaskId(null)}
        />
      )}

      {editingTask && (
        <EditTaskModal
          task={editingTask}
          allTasks={tasks}
          onClose={() => setEditingTask(null)}
          onUpdated={(updated) => {
            setTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
          }}
        />
      )}

      {showSettings && activeProjectId && projectMap.get(activeProjectId) && (
        <ProjectSettingsModal
          project={projectMap.get(activeProjectId)!}
          onClose={() => setShowSettings(false)}
          onUpdated={(updated) => {
            setProjects((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
          }}
        />
      )}
    </div>
  );
}
