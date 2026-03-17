"use client";

import { useState } from "react";
import type { Project } from "@/lib/types";
import { AVAILABLE_TOOLS } from "@/lib/types";

interface ProjectSettingsModalProps {
  project: Project;
  onClose: () => void;
  onUpdated: (project: Project) => void;
}

export default function ProjectSettingsModal({
  project,
  onClose,
  onUpdated,
}: ProjectSettingsModalProps) {
  const currentTools = new Set(project.allowed_tools?.split(",").filter(Boolean) ?? []);
  const [selectedTools, setSelectedTools] = useState<Set<string>>(currentTools);
  const [maxTurns, setMaxTurns] = useState(project.max_turns ?? 30);
  const [extraPaths, setExtraPaths] = useState<string[]>(() => {
    try { return JSON.parse(project.extra_paths || "[]"); } catch { return []; }
  });
  const [urls, setUrls] = useState<string[]>(() => {
    try { return JSON.parse(project.urls || "[]"); } catch { return []; }
  });
  const [newPath, setNewPath] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [loading, setLoading] = useState(false);

  const toggleTool = (toolId: string) => {
    setSelectedTools((prev) => {
      const next = new Set(prev);
      if (next.has(toolId)) next.delete(toolId);
      else next.add(toolId);
      return next;
    });
  };

  const addPath = () => {
    if (newPath.trim()) {
      setExtraPaths((prev) => [...prev, newPath.trim()]);
      setNewPath("");
    }
  };

  const removePath = (idx: number) => {
    setExtraPaths((prev) => prev.filter((_, i) => i !== idx));
  };

  const addUrl = () => {
    if (newUrl.trim()) {
      setUrls((prev) => [...prev, newUrl.trim()]);
      setNewUrl("");
    }
  };

  const removeUrl = (idx: number) => {
    setUrls((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSave = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/projects", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: project.id,
          allowed_tools: Array.from(selectedTools).join(","),
          max_turns: maxTurns,
          extra_paths: JSON.stringify(extraPaths),
          urls: JSON.stringify(urls),
        }),
      });
      if (res.ok) {
        const updated = await res.json();
        onUpdated(updated);
        onClose();
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-lg bg-surface border border-border rounded-xl p-5 space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">Proje Ayarları</h2>
          <span className="text-xs text-muted">{project.name}</span>
        </div>

        {/* Primary Path (read-only display) */}
        <div>
          <label className="text-xs text-muted mb-1 block">Ana Dizin</label>
          <div className="text-xs bg-background border border-border rounded-md px-2.5 py-1.5 text-muted font-mono">
            {project.path}
          </div>
        </div>

        {/* Extra Paths */}
        <div>
          <label className="text-xs text-muted mb-1.5 block">
            Ek Dizinler
          </label>
          <p className="text-[10px] text-muted mb-2">
            Agent&apos;ın erişebileceği ek proje klasörleri (ör. frontend, backend ayrı dizinlerde ise)
          </p>
          {extraPaths.map((p, i) => (
            <div key={i} className="flex items-center gap-1.5 mb-1">
              <div className="flex-1 text-xs bg-background border border-border rounded-md px-2.5 py-1.5 font-mono truncate">
                {p}
              </div>
              <button
                type="button"
                onClick={() => removePath(i)}
                className="text-red-400 hover:text-red-300 text-xs px-1.5 shrink-0"
              >
                ✕
              </button>
            </div>
          ))}
          <div className="flex gap-1.5">
            <input
              placeholder="C:/projects/frontend"
              value={newPath}
              onChange={(e) => setNewPath(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addPath())}
              className="flex-1 bg-background border border-border rounded-md px-2.5 py-1.5 text-xs outline-none focus:border-border-hover font-mono"
            />
            <button
              type="button"
              onClick={addPath}
              disabled={!newPath.trim()}
              className="px-3 py-1.5 text-xs bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 rounded-md transition-colors disabled:opacity-30"
            >
              Ekle
            </button>
          </div>
        </div>

        {/* URLs */}
        <div>
          <label className="text-xs text-muted mb-1.5 block">
            Referans URL&apos;ler
          </label>
          <p className="text-[10px] text-muted mb-2">
            Agent&apos;ın WebFetch ile inceleyebileceği web sayfaları (ör. canlı uygulama, API docs)
          </p>
          {urls.map((u, i) => (
            <div key={i} className="flex items-center gap-1.5 mb-1">
              <div className="flex-1 text-xs bg-background border border-border rounded-md px-2.5 py-1.5 font-mono truncate text-indigo-300">
                {u}
              </div>
              <button
                type="button"
                onClick={() => removeUrl(i)}
                className="text-red-400 hover:text-red-300 text-xs px-1.5 shrink-0"
              >
                ✕
              </button>
            </div>
          ))}
          <div className="flex gap-1.5">
            <input
              placeholder="https://example.com/dashboard"
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addUrl())}
              className="flex-1 bg-background border border-border rounded-md px-2.5 py-1.5 text-xs outline-none focus:border-border-hover font-mono"
            />
            <button
              type="button"
              onClick={addUrl}
              disabled={!newUrl.trim()}
              className="px-3 py-1.5 text-xs bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 rounded-md transition-colors disabled:opacity-30"
            >
              Ekle
            </button>
          </div>
        </div>

        {/* Allowed Tools */}
        <div>
          <label className="text-xs text-muted mb-2 block">
            İzin Verilen Tool&apos;lar
          </label>
          <div className="grid grid-cols-2 gap-1.5">
            {AVAILABLE_TOOLS.map((tool) => (
              <button
                key={tool.id}
                type="button"
                onClick={() => toggleTool(tool.id)}
                className={`text-left px-2.5 py-1.5 rounded-md border text-xs transition-colors ${
                  selectedTools.has(tool.id)
                    ? "border-indigo-500/50 bg-indigo-500/10 text-indigo-300"
                    : "border-border bg-background text-muted hover:border-border-hover"
                }`}
              >
                <div className="font-medium">{tool.label}</div>
                <div className="text-[10px] opacity-60">{tool.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Max Turns */}
        <div>
          <label className="text-xs text-muted mb-1 block">
            Maks. Tur Sayısı
          </label>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={5}
              max={100}
              value={maxTurns}
              onChange={(e) => setMaxTurns(Number(e.target.value))}
              className="flex-1"
            />
            <span className="text-sm font-mono w-8 text-right">{maxTurns}</span>
          </div>
          <p className="text-[10px] text-muted mt-0.5">
            Agent&apos;ın kaç adım atabileceğini belirler
          </p>
        </div>

        {/* Actions */}
        <div className="flex gap-2 justify-end pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 text-sm text-muted hover:text-foreground transition-colors"
          >
            İptal
          </button>
          <button
            onClick={handleSave}
            disabled={loading}
            className="px-4 py-1.5 text-sm bg-indigo-600 hover:bg-indigo-500 rounded-md transition-colors disabled:opacity-50"
          >
            {loading ? "..." : "Kaydet"}
          </button>
        </div>
      </div>
    </div>
  );
}
