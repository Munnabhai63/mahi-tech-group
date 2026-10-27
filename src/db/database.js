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
  claim_locked_by TEXT REFERENCES users(id),
  claim_locked_at TIMESTAMP,
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
  FOREIGN KEY (claim_locked_by) REFERENCES users(id),
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

export const POINT_POOL_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS point_pool_claims (
  id TEXT PRIMARY KEY,
  point_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  deliverable_id TEXT NOT NULL,
  stage VARCHAR(20) NOT NULL,
  claimed_by TEXT NOT NULL,
  claimed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  released_at TIMESTAMP,
  release_reason VARCHAR(50),
  released_by TEXT,
  FOREIGN KEY (point_id) REFERENCES pipeline_checklist_points(id),
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (claimed_by) REFERENCES users(id)
);

CREATE TRIGGER IF NOT EXISTS prevent_claim_delete
BEFORE DELETE ON point_pool_claims
BEGIN
  SELECT RAISE(ABORT, 'point_pool_claims is append-only. Deletes forbidden.');
END;

CREATE TABLE IF NOT EXISTS participation_thresholds (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL UNIQUE,
  threshold_pct DECIMAL(5,2) NOT NULL DEFAULT 20.00,
  abandonment_days INTEGER NOT NULL DEFAULT 7,
  set_by TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (set_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS point_tool_links (
  id TEXT PRIMARY KEY,
  point_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  added_by TEXT NOT NULL,
  tool_name VARCHAR(100) NOT NULL,
  tool_url TEXT NOT NULL,
  deleted_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (point_id) REFERENCES pipeline_checklist_points(id),
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (added_by) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_point_pool_claims_point_id ON point_pool_claims(point_id);
CREATE INDEX IF NOT EXISTS idx_point_pool_claims_project_id ON point_pool_claims(project_id);
CREATE INDEX IF NOT EXISTS idx_point_pool_claims_claimed_by ON point_pool_claims(claimed_by);
CREATE INDEX IF NOT EXISTS idx_point_pool_claims_stage ON point_pool_claims(stage);

CREATE INDEX IF NOT EXISTS idx_participation_thresholds_project_id ON participation_thresholds(project_id);

CREATE INDEX IF NOT EXISTS idx_point_tool_links_point_id ON point_tool_links(point_id);
CREATE INDEX IF NOT EXISTS idx_point_tool_links_project_id ON point_tool_links(project_id);
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

export const GITHUB_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS user_github_links (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id         TEXT NOT NULL UNIQUE,
  github_username TEXT NOT NULL,
  github_node_id  TEXT NOT NULL,
  linked_at       TEXT NOT NULL DEFAULT (datetime('now')),
  linked_by       TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_user_github_links_user_id
  ON user_github_links(user_id);

CREATE TABLE IF NOT EXISTS project_github_repos (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  project_id      TEXT NOT NULL UNIQUE,
  github_repo_id  INTEGER,
  repo_name       TEXT NOT NULL,
  repo_full_name  TEXT NOT NULL,
  repo_url        TEXT NOT NULL,
  default_branch  TEXT NOT NULL DEFAULT 'main',
  status          TEXT NOT NULL DEFAULT 'PENDING'
                    CHECK(status IN ('PENDING','ACTIVE','ARCHIVED','FAILED')),
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  archived_at     TEXT,
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE INDEX IF NOT EXISTS idx_project_github_repos_project_id
  ON project_github_repos(project_id);
CREATE INDEX IF NOT EXISTS idx_project_github_repos_status
  ON project_github_repos(status);

CREATE TABLE IF NOT EXISTS project_github_memberships (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  project_id      TEXT NOT NULL,
  user_id         TEXT NOT NULL,
  github_username TEXT NOT NULL,
  role            TEXT NOT NULL
                    CHECK(role IN ('researcher','designer',
                                   'developer','tester','lead','admin')),
  team_slug       TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'ACTIVE'
                    CHECK(status IN ('ACTIVE','REMOVED')),
  added_at        TEXT NOT NULL DEFAULT (datetime('now')),
  removed_at      TEXT,
  removed_reason  TEXT,
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (user_id)    REFERENCES users(id),
  UNIQUE(project_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_proj_gh_memberships_project_id
  ON project_github_memberships(project_id);
CREATE INDEX IF NOT EXISTS idx_proj_gh_memberships_user_id
  ON project_github_memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_proj_gh_memberships_status
  ON project_github_memberships(status, project_id);

CREATE TABLE IF NOT EXISTS github_webhook_log (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  delivery_id     TEXT NOT NULL UNIQUE,
  event_type      TEXT NOT NULL,
  action          TEXT,
  repo_full_name  TEXT,
  sender_login    TEXT,
  payload         TEXT NOT NULL,
  signature_valid INTEGER NOT NULL DEFAULT 0
                    CHECK(signature_valid IN (0,1)),
  processed       INTEGER NOT NULL DEFAULT 0
                    CHECK(processed IN (0,1)),
  error_message   TEXT,
  received_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_gh_webhook_log_event_type
  ON github_webhook_log(event_type);
CREATE INDEX IF NOT EXISTS idx_gh_webhook_log_received_at
  ON github_webhook_log(received_at);
CREATE INDEX IF NOT EXISTS idx_gh_webhook_log_processed
  ON github_webhook_log(processed);

CREATE TRIGGER IF NOT EXISTS prevent_webhook_log_update
BEFORE UPDATE ON github_webhook_log
WHEN OLD.delivery_id != NEW.delivery_id
  OR OLD.event_type != NEW.event_type
  OR OLD.payload != NEW.payload
  OR OLD.signature_valid != NEW.signature_valid
  OR OLD.received_at != NEW.received_at
BEGIN
  SELECT RAISE(ABORT, 'github_webhook_log is append-only: only processed and error_message fields are mutable');
END;

CREATE TRIGGER IF NOT EXISTS prevent_webhook_log_delete
BEFORE DELETE ON github_webhook_log
BEGIN
  SELECT RAISE(ABORT, 'github_webhook_log rows cannot be deleted');
END;
`;

export function getDatabase() {
  if (!dbInstance) {
    dbInstance = new DatabaseSync(config.DB_PATH);
    dbInstance.exec('PRAGMA journal_mode = WAL;');
    dbInstance.exec('PRAGMA busy_timeout = 5000;');
    dbInstance.exec('PRAGMA foreign_keys = ON;');
    console.log('[DB] WAL mode enabled');
    dbInstance.exec(PIPELINE_SCHEMA_SQL);
    dbInstance.exec(POINT_POOL_SCHEMA_SQL);
    dbInstance.exec(COMPOSITE_INDEXES_SQL);
    dbInstance.exec(GITHUB_SCHEMA_SQL);
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
