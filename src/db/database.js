import { DatabaseSync } from 'node:sqlite';
import { config } from '../config.js';

let dbInstance = null;

export const PIPELINE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS pipeline_deliverables (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  title VARCHAR(200) NOT NULL,
  description TEXT,
  current_stage VARCHAR(20) NOT NULL DEFAULT 'RESEARCH',
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  created_by TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS pipeline_checklist_points (
  id TEXT PRIMARY KEY,
  deliverable_id TEXT NOT NULL,
  stage VARCHAR(20) NOT NULL,
  point_title VARCHAR(300) NOT NULL,
  point_description TEXT,
  weight INTEGER NOT NULL DEFAULT 5 CHECK(weight >= 1 AND weight <= 10),
  status VARCHAR(20) NOT NULL DEFAULT 'UNCLAIMED',
  assigned_to TEXT,
  submitted_at TIMESTAMP,
  approved_at TIMESTAMP,
  approved_by TEXT,
  tool_link TEXT,
  asset_url TEXT,
  created_by TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (deliverable_id) REFERENCES pipeline_deliverables(id),
  FOREIGN KEY (assigned_to) REFERENCES users(id),
  FOREIGN KEY (approved_by) REFERENCES users(id),
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS pipeline_stage_handoffs (
  id TEXT PRIMARY KEY,
  deliverable_id TEXT NOT NULL,
  from_stage VARCHAR(20) NOT NULL,
  to_stage VARCHAR(20) NOT NULL,
  stage_completion_pct DECIMAL(5,2) NOT NULL,
  handoff_notes TEXT,
  approved_by TEXT NOT NULL,
  snapshot_json TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (deliverable_id) REFERENCES pipeline_deliverables(id),
  FOREIGN KEY (approved_by) REFERENCES users(id)
);

CREATE TRIGGER IF NOT EXISTS prevent_handoff_update
BEFORE UPDATE ON pipeline_stage_handoffs
BEGIN
  SELECT RAISE(ABORT, 'pipeline_stage_handoffs is append-only. Updates forbidden.');
END;

CREATE TRIGGER IF NOT EXISTS prevent_handoff_delete
BEFORE DELETE ON pipeline_stage_handoffs
BEGIN
  SELECT RAISE(ABORT, 'pipeline_stage_handoffs is append-only. Deletes forbidden.');
END;

CREATE TABLE IF NOT EXISTS pipeline_addendum_requests (
  id TEXT PRIMARY KEY,
  deliverable_id TEXT NOT NULL,
  requesting_stage VARCHAR(20) NOT NULL,
  target_stage VARCHAR(20) NOT NULL,
  point_title VARCHAR(300) NOT NULL,
  reason TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'OPEN',
  raised_by TEXT NOT NULL,
  resolved_by TEXT,
  resolved_at TIMESTAMP,
  type VARCHAR(20) NOT NULL DEFAULT 'ADDENDUM',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (deliverable_id) REFERENCES pipeline_deliverables(id),
  FOREIGN KEY (raised_by) REFERENCES users(id),
  FOREIGN KEY (resolved_by) REFERENCES users(id)
);
`;

export const COMPOSITE_INDEXES_SQL = `
CREATE INDEX IF NOT EXISTS idx_ideas_status_owner
  ON ideas(status, owner_id);

CREATE INDEX IF NOT EXISTS idx_projects_status_owner
  ON projects(status, owner_id);

CREATE INDEX IF NOT EXISTS idx_project_tasks_composite
  ON project_tasks(project_id, assigned_to, status);

CREATE INDEX IF NOT EXISTS idx_notifications_user_read
  ON notifications(user_id, read_status);

CREATE INDEX IF NOT EXISTS idx_access_log_user_action
  ON access_log(user_id, action);

CREATE INDEX IF NOT EXISTS idx_pipeline_points_composite
  ON pipeline_checklist_points(deliverable_id, stage, status);

CREATE INDEX IF NOT EXISTS idx_pipeline_deliverables_proj
  ON pipeline_deliverables(project_id, status);
`;

export function getDatabase() {
  if (!dbInstance) {
    dbInstance = new DatabaseSync(config.DB_PATH);
    dbInstance.exec('PRAGMA journal_mode = WAL;');
    dbInstance.exec('PRAGMA busy_timeout = 5000;');
    dbInstance.exec('PRAGMA foreign_keys = ON;');
    console.log('[DB] WAL mode enabled');
    dbInstance.exec(PIPELINE_SCHEMA_SQL);
    dbInstance.exec(COMPOSITE_INDEXES_SQL);
  }
  return dbInstance;
}

export function queryAll(sql, params = []) {
  const db = getDatabase();
  const stmt = db.prepare(sql);
  return stmt.all(...params);
}

export function queryOne(sql, params = []) {
  const db = getDatabase();
  const stmt = db.prepare(sql);
  const row = stmt.get(...params);
  return row || null;
}

export function execute(sql, params = []) {
  const db = getDatabase();
  const stmt = db.prepare(sql);
  return stmt.run(...params);
}

export function execRaw(sql) {
  const db = getDatabase();
  return db.exec(sql);
}
