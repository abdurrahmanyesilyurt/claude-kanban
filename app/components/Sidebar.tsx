"use client";

import { useState } from "react";
import type { Project } from "@/lib/types";
import { useToast } from "./Toast";

interface SidebarProps {
  projects: Project[];
  activeProjectId: string | null;
  onSelectProject: (id: string | null) => void;
  onProjectCreated: (project: Project) => void;
  onDeleteProject: (projectId: string) => void;
}

export default function Sidebar({
  projects,
  activeProjectId,
  onSelectProject,
  onProjectCreated,
  onDeleteProject,
}: SidebarProps) {
  const { toast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [color, setColor] = useState("#6366f1");
  const [extraPaths, setExtraPaths] = useState<string[]>([]);
  const [urls, setUrls] = useState<string[]>([]);
  const [newExtraPath, setNewExtraPath] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [generatingId, setGeneratingId] = useState<string | null>(null);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !path.trim()) return;
    setLoading(true);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          path: path.trim(),
          color,
          extra_paths: extraPaths,
          urls,
        }),
      });
      if (res.ok) {
        const project = await res.json();
        onProjectCreated(project);
        toast("Proje oluşturuldu", "success");
        setName("");
        setPath("");
        setColor("#6366f1");
        setExtraPaths([]);
        setUrls([]);
        setShowForm(false);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateClaudeMd = async (e: React.MouseEvent, projectId: string) => {
    e.stopPropagation();
    if (generatingId) return;
    setGeneratingId(projectId);
    try {
      const res = await fetch("/api/projects/generate-claude-md", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      const data = await res.json();
      if (res.ok) {
        toast("CLAUDE.md oluşturuldu!", "success");
      } else {
        toast(`Hata: ${data.error}`, "error");
      }
    } catch {
      toast("CLAUDE.md oluşturulurken hata oluştu", "error");
    } finally {
      setGeneratingId(null);
    }
  };

  const addExtraPath = () => {
    if (newExtraPath.trim()) {
      setExtraPaths((prev) => [...prev, newExtraPath.trim()]);
      setNewExtraPath("");
    }
  };

  const addUrlItem = () => {
    if (newUrl.trim()) {
      setUrls((prev) => [...prev, newUrl.trim()]);
      setNewUrl("");
    }
  };

  return (
    <aside className="w-64 shrink-0 border-r border-border bg-surface flex flex-col h-screen">
      <div className="p-4 border-b border-border">
        <h1 className="text-lg font-semibold tracking-tight">Claude Kanban</h1>
        <p className="text-xs text-muted mt-0.5">AI-powered task management</p>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        <button
          onClick={() => onSelectProject(null)}
          className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
            activeProjectId === null
              ? "bg-white/10 text-white"
              : "text-muted hover:text-foreground hover:bg-surface-hover"
          }`}
        >
          Tüm Projeler
        </button>

        {projects.map((p) => {
          const epCount = (() => { try { return JSON.parse(p.extra_paths || "[]").length; } catch { return 0; } })();
          const urlCount = (() => { try { return JSON.parse(p.urls || "[]").length; } catch { return 0; } })();
          return (
            <div key={p.id} className="group/proj relative">
              <button
                onClick={() => onSelectProject(p.id)}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors flex items-center gap-2 ${
                  activeProjectId === p.id
                    ? "bg-white/10 text-white"
                    : "text-muted hover:text-foreground hover:bg-surface-hover"
                }`}
              >
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: p.color }}
                />
                <span className="truncate flex-1">{p.name}</span>
                {(epCount > 0 || urlCount > 0) && (
                  <span className="text-[9px] text-muted bg-white/5 px-1 rounded" title={`${epCount} ek dizin, ${urlCount} URL`}>
                    {epCount + urlCount}
                  </span>
                )}
              </button>

              {/* Project actions */}
              {activeProjectId === p.id && (
                <div className="pl-3 pr-1 py-0.5 space-y-0.5">
                  <button
                    onClick={(e) => handleGenerateClaudeMd(e, p.id)}
                    disabled={generatingId === p.id}
                    className="w-full text-left px-2 py-0.5 text-[10px] text-muted hover:text-indigo-400 transition-colors flex items-center gap-1.5 disabled:opacity-50 rounded"
                    title="Projeyi analiz edip CLAUDE.md oluşturur"
                  >
                    {generatingId === p.id ? (
                      <>
                        <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" />
                        CLAUDE.md oluşturuluyor...
                      </>
                    ) : (
                      <>
                        <span className="w-1.5 h-1.5 rounded-full bg-muted" />
                        CLAUDE.md Oluştur
                      </>
                    )}
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); onDeleteProject(p.id); }}
                    className="w-full text-left px-2 py-0.5 text-[10px] text-muted hover:text-red-400 transition-colors flex items-center gap-1.5 rounded"
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-muted" />
                    Projeyi Sil
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="p-2 border-t border-border">
        {showForm ? (
          <form onSubmit={handleCreate} className="p-2 space-y-2 max-h-[60vh] overflow-y-auto">
            <input
              autoFocus
              placeholder="Proje adı"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-background border border-border rounded-md px-2.5 py-1.5 text-sm outline-none focus:border-border-hover"
            />
            <input
              placeholder="Ana dizin (/path/to/project)"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              className="w-full bg-background border border-border rounded-md px-2.5 py-1.5 text-sm outline-none focus:border-border-hover"
            />

            {/* Extra Paths */}
            <div>
              <label className="text-[10px] text-muted block mb-1">Ek Dizinler</label>
              {extraPaths.map((ep, i) => (
                <div key={i} className="flex items-center gap-1 mb-1">
                  <span className="flex-1 text-[10px] font-mono bg-background border border-border rounded px-1.5 py-0.5 truncate">{ep}</span>
                  <button type="button" onClick={() => setExtraPaths(prev => prev.filter((_, j) => j !== i))} className="text-red-400 text-[10px]">✕</button>
                </div>
              ))}
              <div className="flex gap-1">
                <input
                  placeholder="Ek dizin yolu"
                  value={newExtraPath}
                  onChange={(e) => setNewExtraPath(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addExtraPath())}
                  className="flex-1 bg-background border border-border rounded-md px-2 py-1 text-[11px] outline-none focus:border-border-hover font-mono"
                />
                <button type="button" onClick={addExtraPath} disabled={!newExtraPath.trim()} className="text-[10px] text-indigo-400 disabled:opacity-30 px-1.5">+</button>
              </div>
            </div>

            {/* URLs */}
            <div>
              <label className="text-[10px] text-muted block mb-1">Referans URL&apos;ler</label>
              {urls.map((u, i) => (
                <div key={i} className="flex items-center gap-1 mb-1">
                  <span className="flex-1 text-[10px] font-mono bg-background border border-border rounded px-1.5 py-0.5 truncate text-indigo-300">{u}</span>
                  <button type="button" onClick={() => setUrls(prev => prev.filter((_, j) => j !== i))} className="text-red-400 text-[10px]">✕</button>
                </div>
              ))}
              <div className="flex gap-1">
                <input
                  placeholder="https://..."
                  value={newUrl}
                  onChange={(e) => setNewUrl(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addUrlItem())}
                  className="flex-1 bg-background border border-border rounded-md px-2 py-1 text-[11px] outline-none focus:border-border-hover font-mono"
                />
                <button type="button" onClick={addUrlItem} disabled={!newUrl.trim()} className="text-[10px] text-indigo-400 disabled:opacity-30 px-1.5">+</button>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="w-8 h-8 rounded cursor-pointer bg-transparent border-0"
              />
              <span className="text-xs text-muted">Renk</span>
            </div>
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={loading}
                className="flex-1 bg-white/10 hover:bg-white/15 text-sm py-1.5 rounded-md transition-colors disabled:opacity-50"
              >
                {loading ? "..." : "Oluştur"}
              </button>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="px-3 text-sm text-muted hover:text-foreground transition-colors"
              >
                İptal
              </button>
            </div>
          </form>
        ) : (
          <button
            onClick={() => setShowForm(true)}
            className="w-full text-left px-3 py-2 rounded-lg text-sm text-muted hover:text-foreground hover:bg-surface-hover transition-colors"
          >
            + Yeni Proje
          </button>
        )}
      </div>
    </aside>
  );
}
