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
  const [loading, setLoading] = useState(false);

  const toggleTool = (toolId: string) => {
    setSelectedTools((prev) => {
      const next = new Set(prev);
      if (next.has(toolId)) next.delete(toolId);
      else next.add(toolId);
      return next;
    });
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
      <div className="w-full max-w-md bg-surface border border-border rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">Proje Ayarları</h2>
          <span className="text-xs text-muted">{project.name}</span>
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
