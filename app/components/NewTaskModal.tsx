"use client";

import { useState } from "react";
import type { Project, Task, Priority } from "@/lib/types";
import { PRIORITY_LABELS } from "@/lib/types";

const TEMPLATES = [
  {
    label: "Bug Fix",
    title: "Bug düzelt: ",
    description: "Bu hatayı bul ve düzelt. Hatanın root cause'unu tespit et, fix'i uygula ve ilgili testleri çalıştır.",
    priority: "high" as Priority,
  },
  {
    label: "Feature",
    title: "Yeni özellik: ",
    description: "Bu özelliği implement et. Mevcut kod yapısına uygun şekilde, gerekli dosyaları oluştur/düzenle.",
    priority: "medium" as Priority,
  },
  {
    label: "Refactor",
    title: "Refactor: ",
    description: "Bu kodu refactor et. Mevcut davranışı bozmadan, kod kalitesini ve okunabilirliği artır.",
    priority: "low" as Priority,
  },
  {
    label: "Test Yaz",
    title: "Test ekle: ",
    description: "Bu modül/fonksiyon için kapsamlı unit testler yaz. Edge case'leri de kapsasın.",
    priority: "medium" as Priority,
  },
  {
    label: "Dokümantasyon",
    title: "Dokümantasyon: ",
    description: "README veya inline dokümantasyon ekle/güncelle. API kullanımı, kurulum adımları ve örnekler ekle.",
    priority: "low" as Priority,
  },
];

interface NewTaskModalProps {
  projects: Project[];
  defaultProjectId?: string | null;
  onClose: () => void;
  onCreated: (task: Task) => void;
}

export default function NewTaskModal({
  projects,
  defaultProjectId,
  onClose,
  onCreated,
}: NewTaskModalProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [projectId, setProjectId] = useState(defaultProjectId ?? projects[0]?.id ?? "");
  const [priority, setPriority] = useState<Priority>("medium");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !projectId) return;
    setLoading(true);
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: projectId,
          title: title.trim(),
          description: description.trim(),
          priority,
        }),
      });
      if (res.ok) {
        const task = await res.json();
        onCreated(task);
        onClose();
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md bg-surface border border-border rounded-xl p-5 space-y-4"
      >
        <h2 className="text-base font-semibold">Yeni Task</h2>

        <div>
          <label className="text-xs text-muted mb-1 block">Proje</label>
          <select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className="w-full bg-background border border-border rounded-md px-2.5 py-1.5 text-sm outline-none focus:border-border-hover"
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-xs text-muted mb-1 block">Şablon</label>
          <div className="flex flex-wrap gap-1.5">
            {TEMPLATES.map((t) => (
              <button
                key={t.label}
                type="button"
                onClick={() => {
                  setTitle(t.title);
                  setDescription(t.description);
                  setPriority(t.priority);
                }}
                className="px-2.5 py-1 text-[11px] rounded-md border border-border text-muted hover:text-foreground hover:border-border-hover transition-colors"
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="text-xs text-muted mb-1 block">Başlık</label>
          <input
            autoFocus
            placeholder="Ne yapılacak?"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full bg-background border border-border rounded-md px-2.5 py-1.5 text-sm outline-none focus:border-border-hover"
          />
        </div>

        <div>
          <label className="text-xs text-muted mb-1 block">Açıklama (opsiyonel)</label>
          <textarea
            rows={3}
            placeholder="Claude'a detaylı talimat ver..."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full bg-background border border-border rounded-md px-2.5 py-1.5 text-sm outline-none focus:border-border-hover resize-none"
          />
        </div>

        <div>
          <label className="text-xs text-muted mb-1 block">Öncelik</label>
          <div className="flex gap-2">
            {(["high", "medium", "low"] as Priority[]).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPriority(p)}
                className={`flex-1 px-3 py-1.5 text-xs rounded-md border transition-colors ${
                  priority === p
                    ? p === "high"
                      ? "border-red-500/50 bg-red-500/15 text-red-400"
                      : p === "medium"
                      ? "border-amber-500/50 bg-amber-500/15 text-amber-400"
                      : "border-gray-500/50 bg-gray-500/15 text-gray-400"
                    : "border-border text-muted hover:border-border-hover"
                }`}
              >
                {PRIORITY_LABELS[p]}
              </button>
            ))}
          </div>
        </div>

        <div className="flex gap-2 justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 text-sm text-muted hover:text-foreground transition-colors"
          >
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
