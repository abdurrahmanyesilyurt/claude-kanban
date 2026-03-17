export interface Project {
  id: string;
  name: string;
  path: string;
  color: string;
  allowed_tools: string;
  max_turns: number;
  extra_paths: string; // JSON array of extra directory paths
  urls: string; // JSON array of reference URLs
  created_at: string;
}

export const AVAILABLE_TOOLS = [
  { id: "Read", label: "Dosya Oku", desc: "Dosyaları okur" },
  { id: "Glob", label: "Dosya Ara", desc: "Glob pattern ile dosya arar" },
  { id: "Grep", label: "İçerik Ara", desc: "Dosya içeriğinde arama yapar" },
  { id: "Edit", label: "Dosya Düzenle", desc: "Dosyaları düzenler" },
  { id: "Write", label: "Dosya Yaz", desc: "Yeni dosya oluşturur" },
  { id: "Bash", label: "Terminal", desc: "Shell komutları çalıştırır" },
  { id: "WebFetch", label: "Web Fetch", desc: "URL'den veri çeker" },
  { id: "WebSearch", label: "Web Ara", desc: "Web'de arama yapar" },
  { id: "NotebookEdit", label: "Notebook", desc: "Jupyter notebook düzenler" },
] as const;

export type Priority = "high" | "medium" | "low";

export interface Task {
  id: string;
  project_id: string;
  title: string;
  description: string;
  status: "todo" | "in_progress" | "done" | "error";
  priority: Priority;
  progress: number;
  next_task_id: string | null;
  max_retries: number;
  retry_count: number;
  created_at: string;
}

export const PRIORITY_LABELS: Record<Priority, string> = {
  high: "Yüksek",
  medium: "Orta",
  low: "Düşük",
};

export const PRIORITY_COLORS: Record<Priority, string> = {
  high: "#ef4444",
  medium: "#f59e0b",
  low: "#6b7280",
};

export const STATUS_LABELS: Record<Task["status"], string> = {
  todo: "Yapılacak",
  in_progress: "Devam Ediyor",
  done: "Tamamlandı",
  error: "Hata",
};

export const STATUS_COLORS: Record<Task["status"], string> = {
  todo: "#6b7280",
  in_progress: "#f59e0b",
  done: "#10b981",
  error: "#ef4444",
};
