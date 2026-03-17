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
}

// --- Query helpers ---

export interface Project {
  id: string;
  name: string;
  path: string;
  color: string;
  allowed_tools: string;
  max_turns: number;
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
  created_at: string;
}

export function getAllProjects(): Project[] {
  return getDb().prepare("SELECT * FROM projects ORDER BY created_at DESC").all() as Project[];
}

export function createProject(project: Omit<Project, "created_at">): Project {
  const db = getDb();
  db.prepare(
    "INSERT INTO projects (id, name, path, color, allowed_tools, max_turns) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(project.id, project.name, project.path, project.color, project.allowed_tools, project.max_turns);
  return db.prepare("SELECT * FROM projects WHERE id = ?").get(project.id) as Project;
}

export function getTasksByProject(projectId?: string): Task[] {
  const db = getDb();
  if (projectId) {
    return db.prepare("SELECT * FROM tasks WHERE project_id = ? ORDER BY created_at DESC").all(projectId) as Task[];
  }
  return db.prepare("SELECT * FROM tasks ORDER BY created_at DESC").all() as Task[];
}

export function createTask(task: Pick<Task, "id" | "project_id" | "title" | "description"> & { priority?: string }): Task {
  const db = getDb();
  db.prepare(
    "INSERT INTO tasks (id, project_id, title, description, priority) VALUES (?, ?, ?, ?, ?)"
  ).run(task.id, task.project_id, task.title, task.description, task.priority ?? "medium");
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

export function updateTask(id: string, fields: Partial<Pick<Task, "status" | "progress" | "title" | "description" | "priority" | "next_task_id" | "max_retries" | "retry_count">>): Task | null {
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
