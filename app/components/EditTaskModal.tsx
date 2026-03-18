"use client";

import { useState } from "react";
import type { Task, Priority } from "@/lib/types";
import { PRIORITY_LABELS } from "@/lib/types";

interface EditTaskModalProps {
  task: Task;
  allTasks: Task[];
  onClose: () => void;
  onUpdated: (task: Task) => void;
}

export default function EditTaskModal({ task, allTasks, onClose, onUpdated }: EditTaskModalProps) {
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description);
  const [priority, setPriority] = useState<Priority>(task.priority);
  const [maxRetries, setMaxRetries] = useState(task.max_retries);
  const [nextTaskId, setNextTaskId] = useState(task.next_task_id ?? "");
  const [checkUrl, setCheckUrl] = useState(task.check_url ?? "");
  const [generateDoc, setGenerateDoc] = useState(task.generate_doc === 1);
  const [loading, setLoading] = useState(false);
  const [newSubtask, setNewSubtask] = useState("");

  const chainableTasks = allTasks.filter((t) => t.id !== task.id && t.project_id === task.project_id);

  // Parse checklist items from description
  const parseChecklist = (text: string) => {
    const lines = text.split("\n");
    const items: { text: string; checked: boolean; index: number }[] = [];
    lines.forEach((line, i) => {
      const match = line.match(/^- \[([ x])\] (.+)$/);
      if (match) {
        items.push({ text: match[2], checked: match[1] === "x", index: i });
      }
    });
    return items;
  };

  const toggleChecklist = (lineIndex: number) => {
    const lines = description.split("\n");
    const line = lines[lineIndex];
    if (line.includes("- [ ] ")) {
      lines[lineIndex] = line.replace("- [ ] ", "- [x] ");
    } else if (line.includes("- [x] ")) {
      lines[lineIndex] = line.replace("- [x] ", "- [ ] ");
    }
    setDescription(lines.join("\n"));
  };

  const addSubtask = () => {
    if (!newSubtask.trim()) return;
    const item = `- [ ] ${newSubtask.trim()}`;
    setDescription((prev) => (prev ? `${prev}\n${item}` : item));
    setNewSubtask("");
  };

  const checklistItems = parseChecklist(description);
  const checkedCount = checklistItems.filter((i) => i.checked).length;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setLoading(true);
    try {
      const res = await fetch("/api/tasks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: task.id,
          title: title.trim(),
          description: description.trim(),
          priority,
          max_retries: maxRetries,
          next_task_id: nextTaskId || null,
          check_url: checkUrl.trim() || null,
          generate_doc: generateDoc ? 1 : 0,
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
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md bg-surface border border-border rounded-xl p-5 space-y-4"
      >
        <h2 className="text-base font-semibold">Task Düzenle</h2>

        <div>
          <label className="text-xs text-muted mb-1 block">Başlık</label>
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full bg-background border border-border rounded-md px-2.5 py-1.5 text-sm outline-none focus:border-border-hover"
          />
        </div>

        <div>
          <label className="text-xs text-muted mb-1 block">Açıklama</label>
          <textarea
            rows={4}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full bg-background border border-border rounded-md px-2.5 py-1.5 text-sm outline-none focus:border-border-hover resize-none"
          />
        </div>

        {/* Checklist */}
        {checklistItems.length > 0 && (
          <div>
            <label className="text-xs text-muted mb-1 block">
              Kontrol Listesi ({checkedCount}/{checklistItems.length})
            </label>
            <div className="space-y-1">
              {checklistItems.map((item) => (
                <label
                  key={item.index}
                  className="flex items-center gap-2 px-2 py-1 rounded hover:bg-white/5 cursor-pointer text-sm"
                >
                  <input
                    type="checkbox"
                    checked={item.checked}
                    onChange={() => toggleChecklist(item.index)}
                    className="rounded border-border"
                  />
                  <span className={item.checked ? "line-through text-muted/50" : ""}>
                    {item.text}
                  </span>
                </label>
              ))}
            </div>
          </div>
        )}

        <div className="flex gap-2">
          <input
            placeholder="Alt adım ekle..."
            value={newSubtask}
            onChange={(e) => setNewSubtask(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addSubtask(); } }}
            className="flex-1 bg-background border border-border rounded-md px-2.5 py-1.5 text-sm outline-none focus:border-border-hover"
          />
          <button
            type="button"
            onClick={addSubtask}
            disabled={!newSubtask.trim()}
            className="px-3 py-1.5 text-xs border border-border hover:border-border-hover rounded-md transition-colors text-muted hover:text-foreground disabled:opacity-30"
          >
            +
          </button>
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

        <div className="flex gap-4">
          <div className="flex-1">
            <label className="text-xs text-muted mb-1 block">Otomatik Retry</label>
            <select
              value={maxRetries}
              onChange={(e) => setMaxRetries(Number(e.target.value))}
              className="w-full bg-background border border-border rounded-md px-2.5 py-1.5 text-sm outline-none focus:border-border-hover"
            >
              <option value={0}>Kapalı</option>
              <option value={1}>1 deneme</option>
              <option value={2}>2 deneme</option>
              <option value={3}>3 deneme</option>
            </select>
          </div>
          <div className="flex-1">
            <label className="text-xs text-muted mb-1 block">Sonraki Task</label>
            <select
              value={nextTaskId}
              onChange={(e) => setNextTaskId(e.target.value)}
              className="w-full bg-background border border-border rounded-md px-2.5 py-1.5 text-sm outline-none focus:border-border-hover"
            >
              <option value="">Yok</option>
              {chainableTasks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="text-xs text-muted mb-1 block">Kontrol URL</label>
          <input
            placeholder="https://site.com/hata-olan-sayfa"
            value={checkUrl}
            onChange={(e) => setCheckUrl(e.target.value)}
            className="w-full bg-background border border-border rounded-md px-2.5 py-1.5 text-sm outline-none focus:border-border-hover"
          />
        </div>

        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="edit-generate-doc"
            checked={generateDoc}
            onChange={(e) => setGenerateDoc(e.target.checked)}
            className="rounded border-border"
          />
          <label htmlFor="edit-generate-doc" className="text-xs text-muted cursor-pointer">
            📄 Tamamlandığında frontend dokümanı oluştur
          </label>
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
            disabled={loading || !title.trim()}
            className="px-4 py-1.5 text-sm bg-indigo-600 hover:bg-indigo-500 rounded-md transition-colors disabled:opacity-50"
          >
            {loading ? "..." : "Kaydet"}
          </button>
        </div>
      </form>
    </div>
  );
}
