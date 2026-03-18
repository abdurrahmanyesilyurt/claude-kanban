export type ProjectType = "backend" | "frontend" | "mobile";

export interface Project {
  id: string;
  name: string;
  path: string;
  color: string;
  project_type: ProjectType; // backend | frontend | mobile
  parent_project_id: string; // Backend project ID (for frontend/mobile projects)
  allowed_tools: string;
  max_turns: number;
  extra_paths: string; // JSON array of extra directory paths
  urls: string; // JSON array of reference URLs
  doc_template: string; // Document format template for agent output
  doc_output_dir: string; // Directory to save generated docs (e.g. "C:/repos/Karbon/docs")
  build_command: string; // Build/verify command to run after task completion (e.g. "dotnet build", "npm run build")
  custom_instructions: string; // Project-specific agent instructions (coding style, conventions, etc.)
  test_command: string; // Test command to run after build (e.g. "dotnet test", "npm test")
  pre_task_command: string; // Command to run before task starts (e.g. "git pull", "npm install")
  created_at: string;
}

export const PROJECT_TYPE_LABELS: Record<ProjectType, string> = {
  backend: "Backend",
  frontend: "Frontend",
  mobile: "Mobil",
};

export const PROJECT_TYPE_ICONS: Record<ProjectType, string> = {
  backend: "🖥️",
  frontend: "🌐",
  mobile: "📱",
};

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
  doc_path: string;
  check_url: string; // URL to investigate/verify (e.g. "https://ekonazdijital.com/dashboard/firmalar/101")
  generate_doc: number; // 1 = auto-generate frontend doc after task completion, 0 = skip
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

// --- Workflow Types ---

export type WorkflowStatus = "draft" | "planning" | "running" | "reviewing" | "done" | "error" | "cancelled";
export type WorkflowStepStatus = "pending" | "running" | "done" | "error" | "skipped";

export interface Workflow {
  id: string;
  project_id: string;
  title: string;
  description: string;
  status: WorkflowStatus;
  shared_memory: string;
  plan: string;
  created_at: string;
}

export interface WorkflowStep {
  id: string;
  workflow_id: string;
  role: string;
  title: string;
  prompt: string;
  status: WorkflowStepStatus;
  depends_on: string;
  agent_summary: string;
  order_index: number;
  created_at: string;
}

export const WORKFLOW_STATUS_LABELS: Record<WorkflowStatus, string> = {
  draft: "Taslak",
  planning: "Planlama",
  running: "Yürütülüyor",
  reviewing: "İnceleniyor",
  done: "Tamamlandı",
  error: "Hata",
  cancelled: "İptal Edildi",
};

export const WORKFLOW_STATUS_COLORS: Record<WorkflowStatus, string> = {
  draft: "#6b7280",
  planning: "#8b5cf6",
  running: "#f59e0b",
  reviewing: "#3b82f6",
  done: "#10b981",
  error: "#ef4444",
  cancelled: "#9ca3af",
};

export const STEP_STATUS_LABELS: Record<WorkflowStepStatus, string> = {
  pending: "Bekliyor",
  running: "Çalışıyor",
  done: "Tamamlandı",
  error: "Hata",
  skipped: "Atlandı",
};
