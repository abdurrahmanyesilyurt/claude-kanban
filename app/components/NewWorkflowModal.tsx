"use client";

import { useState } from "react";
import type { Project } from "@/lib/types";

interface NewWorkflowModalProps {
  projects: Project[];
  activeProjectId: string | null;
  onClose: () => void;
  onCreated: () => void;
}

export default function NewWorkflowModal({ projects, activeProjectId, onClose, onCreated }: NewWorkflowModalProps) {
  const [projectId, setProjectId] = useState(activeProjectId ?? projects[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!projectId || !title.trim()) return;
    setLoading(true);
    try {
      const res = await fetch("/api/workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: projectId, title: title.trim(), description: description.trim() }),
      });
      if (res.ok) {
        onCreated();
        onClose();
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <form onSubmit={handleSubmit} className="w-full max-w-lg bg-surface border border-border rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">Yeni İş Akışı</h2>
          <button type="button" onClick={onClose} className="text-muted hover:text-foreground text-lg">&times;</button>
        </div>

        <div>
          <label className="text-xs text-muted mb-1 block">Proje</label>
          <select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className="w-full bg-background border border-border rounded-md px-2.5 py-1.5 text-sm outline-none"
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-xs text-muted mb-1 block">İş Akışı Adı</label>
          <input
            autoFocus
            placeholder="ör: Teklif Modülü Muhattap Sıralama"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full bg-background border border-border rounded-md px-2.5 py-1.5 text-sm outline-none focus:border-border-hover"
          />
        </div>

        <div>
          <label className="text-xs text-muted mb-1 block">Hedef Açıklaması</label>
          <p className="text-[10px] text-muted mb-1.5">
            Koordinatör agent bu açıklamayı analiz edip alt adımlara bölecek
          </p>
          <textarea
            placeholder="Detaylı görev açıklaması yazın. Agent'lar bu hedefe ulaşmak için paralel çalışacak..."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={5}
            className="w-full bg-background border border-border rounded-md px-2.5 py-1.5 text-sm outline-none focus:border-border-hover resize-none"
          />
        </div>

        <div className="flex gap-2 justify-end pt-2">
          <button type="button" onClick={onClose} className="px-4 py-1.5 text-sm text-muted hover:text-foreground transition-colors">
            İptal
          </button>
          <button
            type="submit"
            disabled={loading || !title.trim() || !projectId}
            className="px-4 py-1.5 text-sm bg-indigo-600 hover:bg-indigo-500 rounded-md transition-colors disabled:opacity-50"
          >
            {loading ? "..." : "Oluştur"}
          </button>
        </div>
      </form>
    </div>
  );
}
