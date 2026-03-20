import Database from "better-sqlite3";
import path from "path";

const DB_PATH = path.join(process.cwd(), "kanban.db");

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!_db) {
    _db = new Database(DB_PATH);
    _db.pragma("journal_mode = WAL");
    _db.pragma("foreign_keys = ON");
    migrate(_db);
  }
  return _db;
}

function migrate(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      path TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#6366f1',
      allowed_tools TEXT NOT NULL DEFAULT 'Read,Glob,Grep,Edit,Write,Bash',
      max_turns INTEGER NOT NULL DEFAULT 30,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'todo',
      progress INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );
  `);

  // Add columns if migrating from older schema
  const cols = db.prepare("PRAGMA table_info(projects)").all() as { name: string }[];
  const colNames = new Set(cols.map((c) => c.name));
  if (!colNames.has("allowed_tools")) {
    db.exec("ALTER TABLE projects ADD COLUMN allowed_tools TEXT NOT NULL DEFAULT 'Read,Glob,Grep,Edit,Write,Bash'");
  }
  if (!colNames.has("max_turns")) {
    db.exec("ALTER TABLE projects ADD COLUMN max_turns INTEGER NOT NULL DEFAULT 30");
  }
  if (!colNames.has("extra_paths")) {
    db.exec("ALTER TABLE projects ADD COLUMN extra_paths TEXT NOT NULL DEFAULT '[]'");
  }
  if (!colNames.has("urls")) {
    db.exec("ALTER TABLE projects ADD COLUMN urls TEXT NOT NULL DEFAULT '[]'");
  }
  if (!colNames.has("doc_template")) {
    db.exec("ALTER TABLE projects ADD COLUMN doc_template TEXT NOT NULL DEFAULT ''");
  }
  if (!colNames.has("build_command")) {
    db.exec("ALTER TABLE projects ADD COLUMN build_command TEXT NOT NULL DEFAULT ''");
  }
  if (!colNames.has("custom_instructions")) {
    db.exec("ALTER TABLE projects ADD COLUMN custom_instructions TEXT NOT NULL DEFAULT ''");
  }
  if (!colNames.has("test_command")) {
    db.exec("ALTER TABLE projects ADD COLUMN test_command TEXT NOT NULL DEFAULT ''");
  }
  if (!colNames.has("pre_task_command")) {
    db.exec("ALTER TABLE projects ADD COLUMN pre_task_command TEXT NOT NULL DEFAULT ''");
  }
  if (!colNames.has("project_type")) {
    db.exec("ALTER TABLE projects ADD COLUMN project_type TEXT NOT NULL DEFAULT 'backend'");
  }
  if (!colNames.has("parent_project_id")) {
    db.exec("ALTER TABLE projects ADD COLUMN parent_project_id TEXT NOT NULL DEFAULT ''");
  }
  if (!colNames.has("doc_output_dir")) {
    db.exec("ALTER TABLE projects ADD COLUMN doc_output_dir TEXT NOT NULL DEFAULT ''");
  }

  // Agent runs table
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_runs (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running',
      logs TEXT NOT NULL DEFAULT '[]',
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      finished_at TEXT,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
    );
  `);

  // Agent run migrations
  const runCols = db.prepare("PRAGMA table_info(agent_runs)").all() as { name: string }[];
  const runColNames = new Set(runCols.map((c) => c.name));
  if (!runColNames.has("cost_usd")) {
    db.exec("ALTER TABLE agent_runs ADD COLUMN cost_usd REAL NOT NULL DEFAULT 0");
  }
  if (!runColNames.has("duration_ms")) {
    db.exec("ALTER TABLE agent_runs ADD COLUMN duration_ms INTEGER NOT NULL DEFAULT 0");
  }

  // Workflow tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS workflows (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'draft',
      shared_memory TEXT NOT NULL DEFAULT '{}',
      plan TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS workflow_steps (
      id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL,
      prompt TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      depends_on TEXT NOT NULL DEFAULT '[]',
      agent_summary TEXT NOT NULL DEFAULT '',
      order_index INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE CASCADE
    );
  `);

  // Task migrations
  const taskCols = db.prepare("PRAGMA table_info(tasks)").all() as { name: string }[];
  const taskColNames = new Set(taskCols.map((c) => c.name));
  if (!taskColNames.has("priority")) {
    db.exec("ALTER TABLE tasks ADD COLUMN priority TEXT NOT NULL DEFAULT 'medium'");
  }
  if (!taskColNames.has("next_task_id")) {
    db.exec("ALTER TABLE tasks ADD COLUMN next_task_id TEXT");
  }
  if (!taskColNames.has("max_retries")) {
    db.exec("ALTER TABLE tasks ADD COLUMN max_retries INTEGER NOT NULL DEFAULT 0");
  }
  if (!taskColNames.has("retry_count")) {
    db.exec("ALTER TABLE tasks ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0");
  }
  if (!taskColNames.has("doc_path")) {
    db.exec("ALTER TABLE tasks ADD COLUMN doc_path TEXT NOT NULL DEFAULT ''");
  }
  if (!taskColNames.has("check_url")) {
    db.exec("ALTER TABLE tasks ADD COLUMN check_url TEXT NOT NULL DEFAULT ''");
  }
  if (!taskColNames.has("generate_doc")) {
    db.exec("ALTER TABLE tasks ADD COLUMN generate_doc INTEGER NOT NULL DEFAULT 0");
  }

  // Workflow step migrations
  const stepCols = db.prepare("PRAGMA table_info(workflow_steps)").all() as { name: string }[];
  const stepColNames = new Set(stepCols.map((c) => c.name));
  if (!stepColNames.has("started_at")) {
    db.exec("ALTER TABLE workflow_steps ADD COLUMN started_at TEXT DEFAULT NULL");
  }
  if (!stepColNames.has("finished_at")) {
    db.exec("ALTER TABLE workflow_steps ADD COLUMN finished_at TEXT DEFAULT NULL");
  }
  if (!stepColNames.has("completed_at")) {
    db.exec("ALTER TABLE workflow_steps ADD COLUMN completed_at TEXT DEFAULT NULL");
  }

  // Workflow migrations
  const wfCols = db.prepare("PRAGMA table_info(workflows)").all() as { name: string }[];
  const wfColNames = new Set(wfCols.map((c) => c.name));
  if (!wfColNames.has("started_at")) {
    db.exec("ALTER TABLE workflows ADD COLUMN started_at TEXT DEFAULT NULL");
  }
  if (!wfColNames.has("completed_at")) {
    db.exec("ALTER TABLE workflows ADD COLUMN completed_at TEXT DEFAULT NULL");
  }

  // --- Indexes for query performance ---
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_tasks_project_id ON tasks(project_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_agent_runs_task_id ON agent_runs(task_id);
    CREATE INDEX IF NOT EXISTS idx_workflows_project_id ON workflows(project_id);
    CREATE INDEX IF NOT EXISTS idx_workflow_steps_workflow_id ON workflow_steps(workflow_id);
  `);

  // --- Deployment history table ---
  db.exec(`
    CREATE TABLE IF NOT EXISTS deployment_history (
      id TEXT PRIMARY KEY,
      project_key TEXT NOT NULL,
      deploy_type TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'running',
      commit_hash TEXT NOT NULL DEFAULT '',
      backup_path TEXT NOT NULL DEFAULT '',
      triggered_by TEXT NOT NULL DEFAULT 'deploy',
      rollback_of TEXT NOT NULL DEFAULT '',
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      finished_at TEXT,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      logs TEXT NOT NULL DEFAULT '[]'
    );

    CREATE INDEX IF NOT EXISTS idx_deployment_history_project ON deployment_history(project_key);
    CREATE INDEX IF NOT EXISTS idx_deployment_history_status ON deployment_history(status);
  `);
}

// --- Query helpers ---

export interface Project {
  id: string;
  name: string;
  path: string;
  color: string;
  project_type: string; // backend | frontend | mobile
  parent_project_id: string; // Backend project ID for frontend/mobile
  allowed_tools: string;
  max_turns: number;
  extra_paths: string;
  urls: string;
  doc_template: string;
  doc_output_dir: string; // Directory to save generated docs
  build_command: string;
  custom_instructions: string;
  test_command: string;
  pre_task_command: string;
  created_at: string;
}

export interface Task {
  id: string;
  project_id: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  progress: number;
  next_task_id: string | null;
  max_retries: number;
  retry_count: number;
  doc_path: string;
  check_url: string;
  generate_doc: number;
  created_at: string;
}

export function getAllProjects(): Project[] {
  return getDb().prepare("SELECT * FROM projects ORDER BY created_at DESC").all() as Project[];
}

export function createProject(project: Omit<Project, "created_at">): Project {
  const db = getDb();
  db.prepare(
    "INSERT INTO projects (id, name, path, color, project_type, parent_project_id, allowed_tools, max_turns, extra_paths, urls, doc_template, doc_output_dir, build_command, custom_instructions, test_command, pre_task_command) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(project.id, project.name, project.path, project.color, project.project_type ?? "backend", project.parent_project_id ?? "", project.allowed_tools, project.max_turns, project.extra_paths ?? "[]", project.urls ?? "[]", project.doc_template ?? "", project.doc_output_dir ?? "", project.build_command ?? "", project.custom_instructions ?? "", project.test_command ?? "", project.pre_task_command ?? "");
  return db.prepare("SELECT * FROM projects WHERE id = ?").get(project.id) as Project;
}

export function getTasksByProject(projectId?: string): Task[] {
  const db = getDb();
  if (projectId) {
    return db.prepare("SELECT * FROM tasks WHERE project_id = ? ORDER BY created_at DESC").all(projectId) as Task[];
  }
  return db.prepare("SELECT * FROM tasks ORDER BY created_at DESC").all() as Task[];
}

export function createTask(task: Pick<Task, "id" | "project_id" | "title" | "description"> & { priority?: string; check_url?: string | null; generate_doc?: number }): Task {
  const db = getDb();
  db.prepare(
    "INSERT INTO tasks (id, project_id, title, description, priority, check_url, generate_doc) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(task.id, task.project_id, task.title, task.description, task.priority ?? "medium", task.check_url ?? "", task.generate_doc ?? 0);
  return db.prepare("SELECT * FROM tasks WHERE id = ?").get(task.id) as Task;
}

// --- Agent run helpers ---

export interface AgentRun {
  id: string;
  task_id: string;
  status: string;
  logs: string; // JSON array of strings
  cost_usd: number;
  duration_ms: number;
  started_at: string;
  finished_at: string | null;
}

export function createAgentRun(id: string, taskId: string): AgentRun {
  const db = getDb();
  db.prepare("INSERT INTO agent_runs (id, task_id) VALUES (?, ?)").run(id, taskId);
  return db.prepare("SELECT * FROM agent_runs WHERE id = ?").get(id) as AgentRun;
}

export function finishAgentRun(id: string, status: string, logs: string[], costUsd = 0, durationMs = 0) {
  const db = getDb();
  db.prepare(
    "UPDATE agent_runs SET status = ?, logs = ?, cost_usd = ?, duration_ms = ?, finished_at = datetime('now') WHERE id = ?"
  ).run(status, JSON.stringify(logs), costUsd, durationMs, id);
}

export function getProjectStats(projectId: string) {
  const db = getDb();
  const stats = db.prepare(`
    SELECT
      COUNT(DISTINCT t.id) as total_tasks,
      SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END) as done_tasks,
      SUM(CASE WHEN t.status = 'error' THEN 1 ELSE 0 END) as error_tasks,
      SUM(CASE WHEN t.status = 'in_progress' THEN 1 ELSE 0 END) as active_tasks,
      COALESCE(SUM(ar.cost_usd), 0) as total_cost,
      COALESCE(SUM(ar.duration_ms), 0) as total_duration,
      COUNT(ar.id) as total_runs
    FROM tasks t
    LEFT JOIN agent_runs ar ON ar.task_id = t.id
    WHERE t.project_id = ?
  `).get(projectId) as {
    total_tasks: number;
    done_tasks: number;
    error_tasks: number;
    active_tasks: number;
    total_cost: number;
    total_duration: number;
    total_runs: number;
  };
  return stats;
}

export function getGlobalStats() {
  const db = getDb();
  return db.prepare(`
    SELECT
      COUNT(DISTINCT t.id) as total_tasks,
      SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END) as done_tasks,
      SUM(CASE WHEN t.status = 'error' THEN 1 ELSE 0 END) as error_tasks,
      COALESCE(SUM(ar.cost_usd), 0) as total_cost,
      COALESCE(SUM(ar.duration_ms), 0) as total_duration,
      COUNT(ar.id) as total_runs
    FROM tasks t
    LEFT JOIN agent_runs ar ON ar.task_id = t.id
  `).get() as {
    total_tasks: number;
    done_tasks: number;
    error_tasks: number;
    total_cost: number;
    total_duration: number;
    total_runs: number;
  };
}

export function getAgentRuns(taskId: string): AgentRun[] {
  return getDb()
    .prepare("SELECT * FROM agent_runs WHERE task_id = ? ORDER BY started_at DESC")
    .all(taskId) as AgentRun[];
}

// --- Workflow helpers ---

export interface WorkflowRow {
  id: string;
  project_id: string;
  title: string;
  description: string;
  status: string;
  shared_memory: string;
  plan: string;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface WorkflowStepRow {
  id: string;
  workflow_id: string;
  role: string;
  title: string;
  prompt: string;
  status: string;
  depends_on: string;
  agent_summary: string;
  order_index: number;
  started_at: string | null;
  finished_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export function createWorkflow(wf: Pick<WorkflowRow, "id" | "project_id" | "title" | "description">): WorkflowRow {
  const db = getDb();
  db.prepare("INSERT INTO workflows (id, project_id, title, description) VALUES (?, ?, ?, ?)").run(wf.id, wf.project_id, wf.title, wf.description);
  return db.prepare("SELECT * FROM workflows WHERE id = ?").get(wf.id) as WorkflowRow;
}

export function getWorkflowsByProject(projectId?: string): WorkflowRow[] {
  const db = getDb();
  if (projectId) {
    return db.prepare("SELECT * FROM workflows WHERE project_id = ? ORDER BY created_at DESC").all(projectId) as WorkflowRow[];
  }
  return db.prepare("SELECT * FROM workflows ORDER BY created_at DESC").all() as WorkflowRow[];
}

export function getWorkflow(id: string): WorkflowRow | undefined {
  return getDb().prepare("SELECT * FROM workflows WHERE id = ?").get(id) as WorkflowRow | undefined;
}

export function updateWorkflow(id: string, fields: Partial<Omit<WorkflowRow, "id" | "created_at">>): WorkflowRow | null {
  const db = getDb();
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) {
      sets.push(`${key} = ?`);
      values.push(value);
    }
  }
  if (sets.length === 0) return db.prepare("SELECT * FROM workflows WHERE id = ?").get(id) as WorkflowRow | null;
  values.push(id);
  db.prepare(`UPDATE workflows SET ${sets.join(", ")} WHERE id = ?`).run(...values);
  return db.prepare("SELECT * FROM workflows WHERE id = ?").get(id) as WorkflowRow | null;
}

export function deleteWorkflow(id: string): boolean {
  const db = getDb();
  db.prepare("DELETE FROM workflow_steps WHERE workflow_id = ?").run(id);
  const r = db.prepare("DELETE FROM workflows WHERE id = ?").run(id);
  return r.changes > 0;
}

export function createWorkflowStep(step: Pick<WorkflowStepRow, "id" | "workflow_id" | "role" | "title" | "prompt" | "depends_on" | "order_index">): WorkflowStepRow {
  const db = getDb();
  db.prepare("INSERT INTO workflow_steps (id, workflow_id, role, title, prompt, depends_on, order_index) VALUES (?, ?, ?, ?, ?, ?, ?)").run(step.id, step.workflow_id, step.role, step.title, step.prompt, step.depends_on, step.order_index);
  return db.prepare("SELECT * FROM workflow_steps WHERE id = ?").get(step.id) as WorkflowStepRow;
}

export function getWorkflowSteps(workflowId: string): WorkflowStepRow[] {
  return getDb().prepare("SELECT * FROM workflow_steps WHERE workflow_id = ? ORDER BY order_index ASC").all(workflowId) as WorkflowStepRow[];
}

export function updateWorkflowStep(id: string, fields: Partial<Omit<WorkflowStepRow, "id" | "workflow_id" | "created_at">>): WorkflowStepRow | null {
  const db = getDb();
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) {
      sets.push(`${key} = ?`);
      values.push(value);
    }
  }
  if (sets.length === 0) return db.prepare("SELECT * FROM workflow_steps WHERE id = ?").get(id) as WorkflowStepRow | null;
  values.push(id);
  db.prepare(`UPDATE workflow_steps SET ${sets.join(", ")} WHERE id = ?`).run(...values);
  return db.prepare("SELECT * FROM workflow_steps WHERE id = ?").get(id) as WorkflowStepRow | null;
}

// --- Deployment History helpers ---

export interface DeploymentHistory {
  id: string;
  project_key: string;
  deploy_type: string; // 'dotnet' | 'dotnet-fdd' | 'nestjs'
  status: string;      // 'running' | 'success' | 'failed' | 'rolled_back'
  commit_hash: string; // Local git commit (dotnet) or deployed commit (nestjs)
  backup_path: string; // Backup tar.gz path (dotnet) or previous commit hash (nestjs)
  triggered_by: string; // 'deploy' | 'rollback'
  rollback_of: string;  // ID of deployment this rollback targets
  started_at: string;
  finished_at: string | null;
  duration_ms: number;
  logs: string; // JSON array of log entries
}

export function createDeploymentHistory(
  entry: Pick<DeploymentHistory, "id" | "project_key" | "deploy_type" | "triggered_by" | "rollback_of">
): DeploymentHistory {
  const db = getDb();
  db.prepare(
    "INSERT INTO deployment_history (id, project_key, deploy_type, triggered_by, rollback_of) VALUES (?, ?, ?, ?, ?)"
  ).run(entry.id, entry.project_key, entry.deploy_type, entry.triggered_by, entry.rollback_of ?? "");
  return db.prepare("SELECT * FROM deployment_history WHERE id = ?").get(entry.id) as DeploymentHistory;
}

export function updateDeploymentHistory(
  id: string,
  fields: Partial<Pick<DeploymentHistory, "status" | "commit_hash" | "backup_path" | "finished_at" | "duration_ms" | "logs">>
): void {
  const db = getDb();
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) {
      sets.push(`${key} = ?`);
      values.push(value);
    }
  }
  if (sets.length === 0) return;
  values.push(id);
  db.prepare(`UPDATE deployment_history SET ${sets.join(", ")} WHERE id = ?`).run(...values);
}

export function getDeploymentHistory(projectKey: string, limit = 20): DeploymentHistory[] {
  return getDb()
    .prepare(
      "SELECT * FROM deployment_history WHERE project_key = ? ORDER BY started_at DESC LIMIT ?"
    )
    .all(projectKey, limit) as DeploymentHistory[];
}

export function getDeploymentById(id: string): DeploymentHistory | undefined {
  return getDb()
    .prepare("SELECT * FROM deployment_history WHERE id = ?")
    .get(id) as DeploymentHistory | undefined;
}

/**
 * Son başarılı deploy kaydını döner.
 * excludeId verilirse o kaydı atlar (rollback sırasında aktif kaydı atlamak için).
 */
export function getLastSuccessfulDeployment(
  projectKey: string,
  excludeId?: string
): DeploymentHistory | undefined {
  const db = getDb();
  if (excludeId) {
    return db
      .prepare(
        "SELECT * FROM deployment_history WHERE project_key = ? AND status = 'success' AND id != ? ORDER BY started_at DESC LIMIT 1"
      )
      .get(projectKey, excludeId) as DeploymentHistory | undefined;
  }
  return db
    .prepare(
      "SELECT * FROM deployment_history WHERE project_key = ? AND status = 'success' ORDER BY started_at DESC LIMIT 1"
    )
    .get(projectKey) as DeploymentHistory | undefined;
}

export function updateTask(id: string, fields: Partial<Pick<Task, "status" | "progress" | "title" | "description" | "priority" | "next_task_id" | "max_retries" | "retry_count" | "doc_path" | "check_url" | "generate_doc">>): Task | null {
  const db = getDb();
  const sets: string[] = [];
  const values: unknown[] = [];

  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) {
      sets.push(`${key} = ?`);
      values.push(value);
    }
  }

  if (sets.length === 0) return db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as Task | null;

  values.push(id);
  db.prepare(`UPDATE tasks SET ${sets.join(", ")} WHERE id = ?`).run(...values);
  return db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as Task | null;
}
