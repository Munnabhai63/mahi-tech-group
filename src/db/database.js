import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { config } from '../config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

export const SPRINT_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS sprints (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  name TEXT NOT NULL,
  goal TEXT,
  status TEXT NOT NULL DEFAULT 'DRAFT',
  start_date TEXT,
  end_date TEXT,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS backlog_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  sprint_id INTEGER REFERENCES sprints(id),
  title TEXT NOT NULL,
  description TEXT,
  type TEXT DEFAULT 'STORY',
  priority TEXT DEFAULT 'MEDIUM',
  story_points INTEGER DEFAULT 0,
  status TEXT DEFAULT 'TODO',
  assigned_to INTEGER REFERENCES users(id),
  created_by INTEGER NOT NULL REFERENCES users(id),
  position INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sprint_velocity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sprint_id INTEGER NOT NULL REFERENCES sprints(id),
  project_id INTEGER NOT NULL REFERENCES projects(id),
  total_points_committed INTEGER DEFAULT 0,
  total_points_completed INTEGER DEFAULT 0,
  completion_rate REAL DEFAULT 0.0,
  logged_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS backlog_item_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES backlog_items(id),
  changed_by INTEGER NOT NULL REFERENCES users(id),
  field_changed TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  changed_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sprint_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sprint_id INTEGER NOT NULL REFERENCES sprints(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  added_by INTEGER NOT NULL REFERENCES users(id),
  added_at TEXT DEFAULT (datetime('now')),
  UNIQUE(sprint_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_sprints_project_id ON sprints(project_id);
CREATE INDEX IF NOT EXISTS idx_sprints_status ON sprints(status);
CREATE INDEX IF NOT EXISTS idx_backlog_items_project_id ON backlog_items(project_id);
CREATE INDEX IF NOT EXISTS idx_backlog_items_sprint_id ON backlog_items(sprint_id);
CREATE INDEX IF NOT EXISTS idx_sprint_velocity_sprint ON sprint_velocity_log(sprint_id);
CREATE INDEX IF NOT EXISTS idx_backlog_history_item ON backlog_item_history(item_id);
CREATE INDEX IF NOT EXISTS idx_sprint_members_sprint ON sprint_members(sprint_id);

CREATE TRIGGER IF NOT EXISTS prevent_velocity_log_update
BEFORE UPDATE ON sprint_velocity_log
BEGIN SELECT RAISE(ABORT, 'sprint_velocity_log is append-only'); END;

CREATE TRIGGER IF NOT EXISTS prevent_velocity_log_delete
BEFORE DELETE ON sprint_velocity_log
BEGIN SELECT RAISE(ABORT, 'sprint_velocity_log is append-only'); END;

CREATE TRIGGER IF NOT EXISTS prevent_item_history_update
BEFORE UPDATE ON backlog_item_history
BEGIN SELECT RAISE(ABORT, 'backlog_item_history is append-only'); END;

CREATE TRIGGER IF NOT EXISTS prevent_item_history_delete
BEFORE DELETE ON backlog_item_history
BEGIN SELECT RAISE(ABORT, 'backlog_item_history is append-only'); END;
`;

export const OKR_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS okr_objectives (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  level TEXT NOT NULL DEFAULT 'COMPANY',
  owner_id INTEGER NOT NULL REFERENCES users(id),
  parent_objective_id INTEGER REFERENCES okr_objectives(id),
  project_id INTEGER REFERENCES projects(id),
  cycle TEXT NOT NULL DEFAULT 'Q1-2026',
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  progress_pct REAL DEFAULT 0.0,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS okr_key_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  objective_id INTEGER NOT NULL REFERENCES okr_objectives(id),
  title TEXT NOT NULL,
  description TEXT,
  type TEXT NOT NULL DEFAULT 'PERCENTAGE',
  target_value REAL NOT NULL DEFAULT 100,
  current_value REAL NOT NULL DEFAULT 0,
  unit TEXT,
  progress_pct REAL DEFAULT 0.0,
  status TEXT NOT NULL DEFAULT 'ON_TRACK',
  assigned_to INTEGER REFERENCES users(id),
  due_date TEXT,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS okr_checkins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key_result_id INTEGER NOT NULL REFERENCES okr_key_results(id),
  submitted_by INTEGER NOT NULL REFERENCES users(id),
  previous_value REAL NOT NULL DEFAULT 0,
  new_value REAL NOT NULL,
  confidence TEXT NOT NULL DEFAULT 'MEDIUM',
  note TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS okr_alignment_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  child_objective_id INTEGER NOT NULL REFERENCES okr_objectives(id),
  parent_objective_id INTEGER NOT NULL REFERENCES okr_objectives(id),
  linked_by INTEGER NOT NULL REFERENCES users(id),
  linked_at TEXT DEFAULT (datetime('now')),
  UNIQUE(child_objective_id, parent_objective_id)
);

CREATE TABLE IF NOT EXISTS okr_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  changed_by INTEGER NOT NULL REFERENCES users(id),
  field_changed TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  changed_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_okr_objectives_level ON okr_objectives(level);
CREATE INDEX IF NOT EXISTS idx_okr_objectives_cycle ON okr_objectives(cycle);
CREATE INDEX IF NOT EXISTS idx_okr_objectives_project ON okr_objectives(project_id);
CREATE INDEX IF NOT EXISTS idx_okr_objectives_owner ON okr_objectives(owner_id);
CREATE INDEX IF NOT EXISTS idx_okr_objectives_parent ON okr_objectives(parent_objective_id);
CREATE INDEX IF NOT EXISTS idx_okr_key_results_obj ON okr_key_results(objective_id);
CREATE INDEX IF NOT EXISTS idx_okr_key_results_assigned ON okr_key_results(assigned_to);
CREATE INDEX IF NOT EXISTS idx_okr_checkins_kr ON okr_checkins(key_result_id);
CREATE INDEX IF NOT EXISTS idx_okr_alignment_child ON okr_alignment_links(child_objective_id);
CREATE INDEX IF NOT EXISTS idx_okr_alignment_parent ON okr_alignment_links(parent_objective_id);
CREATE INDEX IF NOT EXISTS idx_okr_history_entity ON okr_history(entity_type, entity_id);

CREATE TRIGGER IF NOT EXISTS prevent_okr_checkin_update
BEFORE UPDATE ON okr_checkins
BEGIN SELECT RAISE(ABORT, 'okr_checkins is append-only'); END;

CREATE TRIGGER IF NOT EXISTS prevent_okr_checkin_delete
BEFORE DELETE ON okr_checkins
BEGIN SELECT RAISE(ABORT, 'okr_checkins is append-only'); END;

CREATE TRIGGER IF NOT EXISTS prevent_okr_alignment_update
BEFORE UPDATE ON okr_alignment_links
BEGIN SELECT RAISE(ABORT, 'okr_alignment_links is append-only'); END;

CREATE TRIGGER IF NOT EXISTS prevent_okr_alignment_delete
BEFORE DELETE ON okr_alignment_links
BEGIN SELECT RAISE(ABORT, 'okr_alignment_links is append-only'); END;

CREATE TRIGGER IF NOT EXISTS prevent_okr_history_update
BEFORE UPDATE ON okr_history
BEGIN SELECT RAISE(ABORT, 'okr_history is append-only'); END;

CREATE TRIGGER IF NOT EXISTS prevent_okr_history_delete
BEFORE DELETE ON okr_history
BEGIN SELECT RAISE(ABORT, 'okr_history is append-only'); END;
`;

export const GANTT_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS gantt_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  sprint_id INTEGER REFERENCES sprints(id),
  backlog_item_id INTEGER REFERENCES backlog_items(id),
  title TEXT NOT NULL,
  description TEXT,
  type TEXT NOT NULL DEFAULT 'TASK',
  assigned_to INTEGER REFERENCES users(id),
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  progress_pct REAL DEFAULT 0.0,
  color TEXT DEFAULT '#4A90E2',
  parent_item_id INTEGER REFERENCES gantt_items(id),
  position INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'NOT_STARTED',
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS gantt_dependencies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  predecessor_item_id INTEGER NOT NULL REFERENCES gantt_items(id),
  successor_item_id INTEGER NOT NULL REFERENCES gantt_items(id),
  dependency_type TEXT NOT NULL DEFAULT 'FINISH_TO_START',
  lag_days INTEGER DEFAULT 0,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(predecessor_item_id, successor_item_id)
);

CREATE TABLE IF NOT EXISTS gantt_milestones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  gantt_item_id INTEGER REFERENCES gantt_items(id),
  title TEXT NOT NULL,
  milestone_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  achieved_at TEXT,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS gantt_baselines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  gantt_item_id INTEGER NOT NULL REFERENCES gantt_items(id),
  baseline_start_date TEXT NOT NULL,
  baseline_end_date TEXT NOT NULL,
  snapshot_taken_by INTEGER NOT NULL REFERENCES users(id),
  snapshot_taken_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS gantt_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  gantt_item_id INTEGER NOT NULL REFERENCES gantt_items(id),
  changed_by INTEGER NOT NULL REFERENCES users(id),
  field_changed TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  changed_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_gantt_items_project ON gantt_items(project_id);
CREATE INDEX IF NOT EXISTS idx_gantt_items_sprint ON gantt_items(sprint_id);
CREATE INDEX IF NOT EXISTS idx_gantt_items_backlog ON gantt_items(backlog_item_id);
CREATE INDEX IF NOT EXISTS idx_gantt_items_assigned ON gantt_items(assigned_to);
CREATE INDEX IF NOT EXISTS idx_gantt_items_parent ON gantt_items(parent_item_id);
CREATE INDEX IF NOT EXISTS idx_gantt_dependencies_project ON gantt_dependencies(project_id);
CREATE INDEX IF NOT EXISTS idx_gantt_dependencies_pred ON gantt_dependencies(predecessor_item_id);
CREATE INDEX IF NOT EXISTS idx_gantt_dependencies_succ ON gantt_dependencies(successor_item_id);
CREATE INDEX IF NOT EXISTS idx_gantt_milestones_project ON gantt_milestones(project_id);
CREATE INDEX IF NOT EXISTS idx_gantt_milestones_item ON gantt_milestones(gantt_item_id);
CREATE INDEX IF NOT EXISTS idx_gantt_baselines_project ON gantt_baselines(project_id);
CREATE INDEX IF NOT EXISTS idx_gantt_baselines_item ON gantt_baselines(gantt_item_id);
CREATE INDEX IF NOT EXISTS idx_gantt_history_item ON gantt_history(gantt_item_id);

CREATE TRIGGER IF NOT EXISTS prevent_gantt_dependency_update
BEFORE UPDATE ON gantt_dependencies
BEGIN SELECT RAISE(ABORT, 'gantt_dependencies is append-only'); END;

CREATE TRIGGER IF NOT EXISTS prevent_gantt_dependency_delete
BEFORE DELETE ON gantt_dependencies
BEGIN SELECT RAISE(ABORT, 'gantt_dependencies is append-only'); END;

CREATE TRIGGER IF NOT EXISTS prevent_gantt_baseline_update
BEFORE UPDATE ON gantt_baselines
BEGIN SELECT RAISE(ABORT, 'gantt_baselines is append-only'); END;

CREATE TRIGGER IF NOT EXISTS prevent_gantt_baseline_delete
BEFORE DELETE ON gantt_baselines
BEGIN SELECT RAISE(ABORT, 'gantt_baselines is append-only'); END;

CREATE TRIGGER IF NOT EXISTS prevent_gantt_history_update
BEFORE UPDATE ON gantt_history
BEGIN SELECT RAISE(ABORT, 'gantt_history is append-only'); END;

CREATE TRIGGER IF NOT EXISTS prevent_gantt_history_delete
BEFORE DELETE ON gantt_history
BEGIN SELECT RAISE(ABORT, 'gantt_history is append-only'); END;
`;

export const WORKLOAD_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS member_capacity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  weekly_capacity_hrs REAL NOT NULL DEFAULT 40.0,
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  set_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS member_availability (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  date TEXT NOT NULL,
  availability_type TEXT NOT NULL DEFAULT 'LEAVE',
  available_hrs REAL DEFAULT 0.0,
  reason TEXT,
  approved_by INTEGER REFERENCES users(id),
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, date)
);

CREATE TABLE IF NOT EXISTS workload_assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  project_id INTEGER NOT NULL REFERENCES projects(id),
  source_type TEXT NOT NULL DEFAULT 'BACKLOG_ITEM',
  source_id INTEGER,
  title TEXT NOT NULL,
  estimated_hrs REAL NOT NULL DEFAULT 0.0,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS workload_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  snapshot_date TEXT NOT NULL,
  snapshot_data TEXT NOT NULL,
  taken_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS workload_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  alert_type TEXT NOT NULL,
  week_start_date TEXT NOT NULL,
  assigned_hrs REAL NOT NULL,
  capacity_hrs REAL NOT NULL,
  utilization_pct REAL NOT NULL,
  acknowledged_by INTEGER REFERENCES users(id),
  acknowledged_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_member_capacity_user ON member_capacity(user_id);
CREATE INDEX IF NOT EXISTS idx_member_capacity_effective ON member_capacity(effective_from);
CREATE INDEX IF NOT EXISTS idx_member_availability_user ON member_availability(user_id);
CREATE INDEX IF NOT EXISTS idx_member_availability_date ON member_availability(date);
CREATE INDEX IF NOT EXISTS idx_workload_assignments_user ON workload_assignments(user_id);
CREATE INDEX IF NOT EXISTS idx_workload_assignments_project ON workload_assignments(project_id);
CREATE INDEX IF NOT EXISTS idx_workload_assignments_status ON workload_assignments(status);
CREATE INDEX IF NOT EXISTS idx_workload_assignments_dates ON workload_assignments(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_workload_snapshots_project ON workload_snapshots(project_id);
CREATE INDEX IF NOT EXISTS idx_workload_alerts_user ON workload_alerts(user_id);
CREATE INDEX IF NOT EXISTS idx_workload_alerts_week ON workload_alerts(week_start_date);

CREATE TRIGGER IF NOT EXISTS prevent_capacity_update
BEFORE UPDATE ON member_capacity
BEGIN SELECT RAISE(ABORT, 'member_capacity is append-only'); END;

CREATE TRIGGER IF NOT EXISTS prevent_capacity_delete
BEFORE DELETE ON member_capacity
BEGIN SELECT RAISE(ABORT, 'member_capacity is append-only'); END;

CREATE TRIGGER IF NOT EXISTS prevent_workload_snapshot_update
BEFORE UPDATE ON workload_snapshots
BEGIN SELECT RAISE(ABORT, 'workload_snapshots is append-only'); END;

CREATE TRIGGER IF NOT EXISTS prevent_workload_snapshot_delete
BEFORE DELETE ON workload_snapshots
BEGIN SELECT RAISE(ABORT, 'workload_snapshots is append-only'); END;

CREATE TRIGGER IF NOT EXISTS prevent_workload_alert_delete
BEFORE DELETE ON workload_alerts
BEGIN SELECT RAISE(ABORT, 'workload_alerts is append-only'); END;
`;

export const TIME_TRACKING_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS time_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  project_id INTEGER NOT NULL REFERENCES projects(id),
  source_type TEXT DEFAULT 'MANUAL',
  source_ref_type TEXT,
  source_ref_id INTEGER,
  description TEXT,
  start_time TEXT NOT NULL,
  end_time TEXT,
  duration_minutes INTEGER,
  is_billable INTEGER NOT NULL DEFAULT 0,
  billable_rate REAL DEFAULT 0.0,
  billable_amount REAL DEFAULT 0.0,
  status TEXT NOT NULL DEFAULT 'PENDING',
  approved_by INTEGER REFERENCES users(id),
  approved_at TEXT,
  rejection_reason TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS time_entry_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id INTEGER NOT NULL REFERENCES time_entries(id),
  changed_by INTEGER NOT NULL REFERENCES users(id),
  field_changed TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  changed_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS billable_rates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rate_type TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id),
  project_id INTEGER REFERENCES projects(id),
  rate_per_hour REAL NOT NULL DEFAULT 0.0,
  currency TEXT NOT NULL DEFAULT 'INR',
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  set_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS active_timers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE,
  time_entry_id INTEGER NOT NULL REFERENCES time_entries(id),
  started_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS time_approval_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id INTEGER NOT NULL REFERENCES time_entries(id),
  requested_by INTEGER NOT NULL REFERENCES users(id),
  requested_at TEXT DEFAULT (datetime('now')),
  reviewed_by INTEGER REFERENCES users(id),
  reviewed_at TEXT,
  decision TEXT,
  decision_note TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS time_report_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER REFERENCES projects(id),
  report_type TEXT NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  snapshot_data TEXT NOT NULL,
  taken_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_time_entries_user ON time_entries(user_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_project ON time_entries(project_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_status ON time_entries(status);
CREATE INDEX IF NOT EXISTS idx_time_entries_start_time ON time_entries(start_time);
CREATE INDEX IF NOT EXISTS idx_time_entries_source_ref ON time_entries(source_ref_type, source_ref_id);
CREATE INDEX IF NOT EXISTS idx_time_entry_history_entry ON time_entry_history(entry_id);
CREATE INDEX IF NOT EXISTS idx_billable_rates_user ON billable_rates(user_id);
CREATE INDEX IF NOT EXISTS idx_billable_rates_project ON billable_rates(project_id);
CREATE INDEX IF NOT EXISTS idx_billable_rates_effective ON billable_rates(effective_from);
CREATE INDEX IF NOT EXISTS idx_active_timers_user ON active_timers(user_id);
CREATE INDEX IF NOT EXISTS idx_time_approval_requests_entry ON time_approval_requests(entry_id);
CREATE INDEX IF NOT EXISTS idx_time_approval_requests_status ON time_approval_requests(decision);
CREATE INDEX IF NOT EXISTS idx_time_report_snapshots_project ON time_report_snapshots(project_id);

CREATE TRIGGER IF NOT EXISTS prevent_time_history_update
BEFORE UPDATE ON time_entry_history
BEGIN SELECT RAISE(ABORT, 'time_entry_history is append-only'); END;

CREATE TRIGGER IF NOT EXISTS prevent_time_history_delete
BEFORE DELETE ON time_entry_history
BEGIN SELECT RAISE(ABORT, 'time_entry_history is append-only'); END;

CREATE TRIGGER IF NOT EXISTS prevent_billable_rate_update
BEFORE UPDATE ON billable_rates
BEGIN SELECT RAISE(ABORT, 'billable_rates is append-only'); END;

CREATE TRIGGER IF NOT EXISTS prevent_billable_rate_delete
BEFORE DELETE ON billable_rates
BEGIN SELECT RAISE(ABORT, 'billable_rates is append-only'); END;

CREATE TRIGGER IF NOT EXISTS prevent_approval_request_update
BEFORE UPDATE ON time_approval_requests
BEGIN SELECT RAISE(ABORT, 'time_approval_requests is append-only'); END;

CREATE TRIGGER IF NOT EXISTS prevent_approval_request_delete
BEFORE DELETE ON time_approval_requests
BEGIN SELECT RAISE(ABORT, 'time_approval_requests is append-only'); END;

CREATE TRIGGER IF NOT EXISTS prevent_time_report_snapshot_update
BEFORE UPDATE ON time_report_snapshots
BEGIN SELECT RAISE(ABORT, 'time_report_snapshots is append-only'); END;

CREATE TRIGGER IF NOT EXISTS prevent_time_report_snapshot_delete
BEFORE DELETE ON time_report_snapshots
BEGIN SELECT RAISE(ABORT, 'time_report_snapshots is append-only'); END;
`;

export const ANALYTICS_SCHEMA_SQL = `
-- PRD 23: Analytics & KPI Dashboard
CREATE TABLE IF NOT EXISTS kpi_definitions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  data_source TEXT NOT NULL,
  metric_type TEXT NOT NULL,
  calculation_query TEXT NOT NULL,
  unit TEXT,
  target_value REAL,
  alert_threshold_low REAL,
  alert_threshold_high REAL,
  refresh_interval_minutes INTEGER DEFAULT 60,
  is_active INTEGER DEFAULT 1,
  is_built_in INTEGER DEFAULT 0,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS kpi_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kpi_id INTEGER NOT NULL REFERENCES kpi_definitions(id),
  value REAL NOT NULL,
  period_label TEXT,
  snapshotted_at TEXT DEFAULT (datetime('now')),
  calculation_metadata TEXT
);

CREATE TABLE IF NOT EXISTS analytics_dashboards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  owner_id INTEGER NOT NULL REFERENCES users(id),
  scope TEXT NOT NULL DEFAULT 'PERSONAL',
  is_default INTEGER DEFAULT 0,
  layout TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS dashboard_widgets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dashboard_id INTEGER NOT NULL REFERENCES analytics_dashboards(id),
  kpi_id INTEGER REFERENCES kpi_definitions(id),
  widget_type TEXT NOT NULL,
  title TEXT NOT NULL,
  config TEXT,
  position_x INTEGER DEFAULT 0,
  position_y INTEGER DEFAULT 0,
  width INTEGER DEFAULT 2,
  height INTEGER DEFAULT 2,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS kpi_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kpi_id INTEGER NOT NULL REFERENCES kpi_definitions(id),
  alert_type TEXT NOT NULL,
  triggered_value REAL NOT NULL,
  threshold_value REAL NOT NULL,
  message TEXT NOT NULL,
  acknowledged_by INTEGER REFERENCES users(id),
  acknowledged_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS analytics_report_exports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  exported_by INTEGER NOT NULL REFERENCES users(id),
  report_type TEXT NOT NULL,
  filters TEXT,
  export_format TEXT NOT NULL DEFAULT 'JSON',
  row_count INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_kpi_definitions_data_source ON kpi_definitions(data_source);
CREATE INDEX IF NOT EXISTS idx_kpi_definitions_is_active ON kpi_definitions(is_active);
CREATE INDEX IF NOT EXISTS idx_kpi_snapshots_kpi_id ON kpi_snapshots(kpi_id);
CREATE INDEX IF NOT EXISTS idx_kpi_snapshots_snapshotted_at ON kpi_snapshots(snapshotted_at);
CREATE INDEX IF NOT EXISTS idx_analytics_dashboards_owner ON analytics_dashboards(owner_id);
CREATE INDEX IF NOT EXISTS idx_analytics_dashboards_scope ON analytics_dashboards(scope);
CREATE INDEX IF NOT EXISTS idx_dashboard_widgets_dashboard ON dashboard_widgets(dashboard_id);
CREATE INDEX IF NOT EXISTS idx_dashboard_widgets_kpi ON dashboard_widgets(kpi_id);
CREATE INDEX IF NOT EXISTS idx_kpi_alerts_kpi_id ON kpi_alerts(kpi_id);
CREATE INDEX IF NOT EXISTS idx_kpi_alerts_acknowledged ON kpi_alerts(acknowledged_by);
CREATE INDEX IF NOT EXISTS idx_analytics_report_exports_user ON analytics_report_exports(exported_by);

CREATE TRIGGER IF NOT EXISTS prevent_kpi_snapshot_update
BEFORE UPDATE ON kpi_snapshots
BEGIN SELECT RAISE(ABORT, 'kpi_snapshots is append-only'); END;

CREATE TRIGGER IF NOT EXISTS prevent_kpi_snapshot_delete
BEFORE DELETE ON kpi_snapshots
BEGIN SELECT RAISE(ABORT, 'kpi_snapshots is append-only'); END;

CREATE TRIGGER IF NOT EXISTS prevent_kpi_alert_delete
BEFORE DELETE ON kpi_alerts
BEGIN SELECT RAISE(ABORT, 'kpi_alerts is append-only'); END;

CREATE TRIGGER IF NOT EXISTS prevent_analytics_export_update
BEFORE UPDATE ON analytics_report_exports
BEGIN SELECT RAISE(ABORT, 'analytics_report_exports is append-only'); END;

CREATE TRIGGER IF NOT EXISTS prevent_analytics_export_delete
BEFORE DELETE ON analytics_report_exports
BEGIN SELECT RAISE(ABORT, 'analytics_report_exports is append-only'); END;
`;

export const CLIENT_PORTAL_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  company_name TEXT,
  phone TEXT,
  password_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  invite_token TEXT,
  invite_token_expires_at TEXT,
  invite_accepted_at TEXT,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS client_project_access (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL REFERENCES clients(id),
  project_id INTEGER NOT NULL REFERENCES projects(id),
  access_level TEXT NOT NULL DEFAULT 'VIEW',
  granted_by INTEGER NOT NULL REFERENCES users(id),
  granted_at TEXT DEFAULT (datetime('now')),
  revoked_by INTEGER REFERENCES users(id),
  revoked_at TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  UNIQUE(client_id, project_id)
);

CREATE TABLE IF NOT EXISTS client_shared_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL REFERENCES clients(id),
  project_id INTEGER NOT NULL REFERENCES projects(id),
  item_type TEXT NOT NULL,
  item_id INTEGER NOT NULL,
  shared_by INTEGER NOT NULL REFERENCES users(id),
  shared_at TEXT DEFAULT (datetime('now')),
  unshared_by INTEGER REFERENCES users(id),
  unshared_at TEXT,
  is_active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS client_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL REFERENCES clients(id),
  project_id INTEGER REFERENCES projects(id),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  order_type TEXT NOT NULL DEFAULT 'NEW_REQUEST',
  priority TEXT NOT NULL DEFAULT 'MEDIUM',
  status TEXT NOT NULL DEFAULT 'SUBMITTED',
  attachments TEXT,
  assigned_to INTEGER REFERENCES users(id),
  due_date TEXT,
  internal_notes TEXT,
  rejection_reason TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS client_order_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES client_orders(id),
  sender_type TEXT NOT NULL,
  sender_client_id INTEGER REFERENCES clients(id),
  sender_user_id INTEGER REFERENCES users(id),
  message TEXT NOT NULL,
  is_internal INTEGER NOT NULL DEFAULT 0,
  attachments TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS client_milestone_approvals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL REFERENCES clients(id),
  project_id INTEGER NOT NULL REFERENCES projects(id),
  milestone_id INTEGER NOT NULL REFERENCES gantt_milestones(id),
  requested_by INTEGER NOT NULL REFERENCES users(id),
  requested_at TEXT DEFAULT (datetime('now')),
  decision TEXT,
  decision_note TEXT,
  decided_at TEXT,
  UNIQUE(client_id, milestone_id)
);

CREATE TABLE IF NOT EXISTS client_deliverable_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL REFERENCES clients(id),
  project_id INTEGER NOT NULL REFERENCES projects(id),
  item_type TEXT NOT NULL,
  item_id INTEGER NOT NULL,
  rating INTEGER,
  feedback_text TEXT,
  status TEXT NOT NULL DEFAULT 'SUBMITTED',
  acknowledged_by INTEGER REFERENCES users(id),
  acknowledged_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS client_activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL REFERENCES clients(id),
  action TEXT NOT NULL,
  item_type TEXT,
  item_id INTEGER,
  ip_address TEXT,
  user_agent TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_clients_email ON clients(email);
CREATE INDEX IF NOT EXISTS idx_clients_status ON clients(status);
CREATE INDEX IF NOT EXISTS idx_clients_invite_token ON clients(invite_token);
CREATE INDEX IF NOT EXISTS idx_client_project_access_client ON client_project_access(client_id);
CREATE INDEX IF NOT EXISTS idx_client_project_access_project ON client_project_access(project_id);
CREATE INDEX IF NOT EXISTS idx_client_shared_items_client ON client_shared_items(client_id);
CREATE INDEX IF NOT EXISTS idx_client_shared_items_project ON client_shared_items(project_id);
CREATE INDEX IF NOT EXISTS idx_client_shared_items_item ON client_shared_items(item_type, item_id);
CREATE INDEX IF NOT EXISTS idx_client_orders_client ON client_orders(client_id);
CREATE INDEX IF NOT EXISTS idx_client_orders_project ON client_orders(project_id);
CREATE INDEX IF NOT EXISTS idx_client_orders_status ON client_orders(status);
CREATE INDEX IF NOT EXISTS idx_client_order_messages_order ON client_order_messages(order_id);
CREATE INDEX IF NOT EXISTS idx_client_milestone_approvals_client ON client_milestone_approvals(client_id);
CREATE INDEX IF NOT EXISTS idx_client_milestone_approvals_milestone ON client_milestone_approvals(milestone_id);
CREATE INDEX IF NOT EXISTS idx_client_feedback_client ON client_deliverable_feedback(client_id);
CREATE INDEX IF NOT EXISTS idx_client_feedback_project ON client_deliverable_feedback(project_id);
CREATE INDEX IF NOT EXISTS idx_client_activity_log_client ON client_activity_log(client_id);
CREATE INDEX IF NOT EXISTS idx_client_activity_log_action ON client_activity_log(action);

CREATE TRIGGER IF NOT EXISTS prevent_client_order_message_update
BEFORE UPDATE ON client_order_messages
BEGIN SELECT RAISE(ABORT, 'client_order_messages is append-only'); END;

CREATE TRIGGER IF NOT EXISTS prevent_client_order_message_delete
BEFORE DELETE ON client_order_messages
BEGIN SELECT RAISE(ABORT, 'client_order_messages is append-only'); END;

CREATE TRIGGER IF NOT EXISTS prevent_client_milestone_approval_update
BEFORE UPDATE ON client_milestone_approvals
WHEN (OLD.decision IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'client_milestone_approvals is append-only'); END;

CREATE TRIGGER IF NOT EXISTS prevent_client_milestone_approval_delete
BEFORE DELETE ON client_milestone_approvals
BEGIN SELECT RAISE(ABORT, 'client_milestone_approvals is append-only'); END;

CREATE TRIGGER IF NOT EXISTS prevent_client_feedback_update
BEFORE UPDATE ON client_deliverable_feedback
BEGIN SELECT RAISE(ABORT, 'client_deliverable_feedback is append-only'); END;

CREATE TRIGGER IF NOT EXISTS prevent_client_feedback_delete
BEFORE DELETE ON client_deliverable_feedback
BEGIN SELECT RAISE(ABORT, 'client_deliverable_feedback is append-only'); END;

CREATE TRIGGER IF NOT EXISTS prevent_client_activity_log_update
BEFORE UPDATE ON client_activity_log
BEGIN SELECT RAISE(ABORT, 'client_activity_log is append-only'); END;

CREATE TRIGGER IF NOT EXISTS prevent_client_activity_log_delete
BEFORE DELETE ON client_activity_log
BEGIN SELECT RAISE(ABORT, 'client_activity_log is append-only'); END;
`;

export const BUDGET_FINANCIAL_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS project_budgets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) UNIQUE,
  total_budget REAL NOT NULL DEFAULT 0.0,
  currency TEXT NOT NULL DEFAULT 'INR',
  budget_type TEXT NOT NULL DEFAULT 'FIXED',
  alert_threshold_pct REAL NOT NULL DEFAULT 80.0,
  start_date TEXT NOT NULL,
  end_date TEXT,
  notes TEXT,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS budget_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  changed_by INTEGER NOT NULL REFERENCES users(id),
  field_changed TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  reason TEXT NOT NULL,
  changed_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS expense_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS project_expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  category_id INTEGER NOT NULL REFERENCES expense_categories(id),
  submitted_by INTEGER NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  description TEXT,
  amount REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'INR',
  expense_date TEXT NOT NULL,
  receipt_path TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING',
  approved_by INTEGER REFERENCES users(id),
  approved_at TEXT,
  rejected_by INTEGER REFERENCES users(id),
  rejected_at TEXT,
  rejection_reason TEXT,
  is_billable INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS expense_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  expense_id INTEGER NOT NULL REFERENCES project_expenses(id),
  changed_by INTEGER NOT NULL REFERENCES users(id),
  field_changed TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  changed_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  client_id INTEGER REFERENCES clients(id),
  invoice_number TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT',
  issue_date TEXT NOT NULL,
  due_date TEXT NOT NULL,
  subtotal REAL NOT NULL DEFAULT 0.0,
  tax_pct REAL NOT NULL DEFAULT 0.0,
  tax_amount REAL NOT NULL DEFAULT 0.0,
  total_amount REAL NOT NULL DEFAULT 0.0,
  currency TEXT NOT NULL DEFAULT 'INR',
  notes TEXT,
  internal_notes TEXT,
  paid_amount REAL DEFAULT 0.0,
  paid_at TEXT,
  payment_reference TEXT,
  sent_at TEXT,
  viewed_at TEXT,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS invoice_line_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id),
  description TEXT NOT NULL,
  line_type TEXT NOT NULL DEFAULT 'SERVICE',
  quantity REAL NOT NULL DEFAULT 1.0,
  unit_price REAL NOT NULL DEFAULT 0.0,
  amount REAL NOT NULL DEFAULT 0.0,
  source_type TEXT,
  source_id INTEGER,
  position INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS budget_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  alert_type TEXT NOT NULL,
  triggered_at_pct REAL,
  triggered_amount REAL,
  message TEXT NOT NULL,
  acknowledged_by INTEGER REFERENCES users(id),
  acknowledged_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_project_budgets_project ON project_budgets(project_id);
CREATE INDEX IF NOT EXISTS idx_budget_history_project ON budget_history(project_id);
CREATE INDEX IF NOT EXISTS idx_expense_categories_name ON expense_categories(name);
CREATE INDEX IF NOT EXISTS idx_expense_categories_active ON expense_categories(is_active);
CREATE INDEX IF NOT EXISTS idx_project_expenses_project ON project_expenses(project_id);
CREATE INDEX IF NOT EXISTS idx_project_expenses_category ON project_expenses(category_id);
CREATE INDEX IF NOT EXISTS idx_project_expenses_submitter ON project_expenses(submitted_by);
CREATE INDEX IF NOT EXISTS idx_project_expenses_status ON project_expenses(status);
CREATE INDEX IF NOT EXISTS idx_expense_history_expense ON expense_history(expense_id);
CREATE INDEX IF NOT EXISTS idx_invoices_project ON invoices(project_id);
CREATE INDEX IF NOT EXISTS idx_invoices_client ON invoices(client_id);
CREATE INDEX IF NOT EXISTS idx_invoices_number ON invoices(invoice_number);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoice_line_items_invoice ON invoice_line_items(invoice_id);
CREATE INDEX IF NOT EXISTS idx_budget_alerts_project ON budget_alerts(project_id);
CREATE INDEX IF NOT EXISTS idx_budget_alerts_type ON budget_alerts(alert_type);

CREATE TRIGGER IF NOT EXISTS prevent_budget_history_update
BEFORE UPDATE ON budget_history
BEGIN SELECT RAISE(ABORT, 'budget_history is append-only'); END;

CREATE TRIGGER IF NOT EXISTS prevent_budget_history_delete
BEFORE DELETE ON budget_history
BEGIN SELECT RAISE(ABORT, 'budget_history is append-only'); END;

CREATE TRIGGER IF NOT EXISTS prevent_expense_history_update
BEFORE UPDATE ON expense_history
BEGIN SELECT RAISE(ABORT, 'expense_history is append-only'); END;

CREATE TRIGGER IF NOT EXISTS prevent_expense_history_delete
BEFORE DELETE ON expense_history
BEGIN SELECT RAISE(ABORT, 'expense_history is append-only'); END;

CREATE TRIGGER IF NOT EXISTS prevent_invoice_line_item_update
BEFORE UPDATE ON invoice_line_items
BEGIN SELECT RAISE(ABORT, 'invoice_line_items is append-only'); END;

CREATE TRIGGER IF NOT EXISTS prevent_invoice_line_item_delete
BEFORE DELETE ON invoice_line_items
BEGIN SELECT RAISE(ABORT, 'invoice_line_items is append-only'); END;

CREATE TRIGGER IF NOT EXISTS prevent_budget_alert_delete
BEFORE DELETE ON budget_alerts
BEGIN SELECT RAISE(ABORT, 'budget_alerts is append-only'); END;
`;

export const AUTOMATION_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS automation_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  project_id INTEGER REFERENCES projects(id),
  scope TEXT NOT NULL DEFAULT 'PROJECT',
  is_active INTEGER NOT NULL DEFAULT 1,
  trigger_module TEXT NOT NULL,
  trigger_event TEXT NOT NULL,
  trigger_conditions TEXT,
  condition_logic TEXT NOT NULL DEFAULT 'AND',
  actions TEXT NOT NULL,
  run_count INTEGER DEFAULT 0,
  last_run_at TEXT,
  is_ai_suggested INTEGER DEFAULT 0,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS automation_run_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  automation_id INTEGER NOT NULL REFERENCES automation_rules(id),
  trigger_event TEXT NOT NULL,
  trigger_source_type TEXT,
  trigger_source_id INTEGER,
  triggered_by_user_id INTEGER REFERENCES users(id),
  conditions_evaluated TEXT,
  conditions_passed INTEGER NOT NULL DEFAULT 0,
  actions_executed TEXT,
  overall_status TEXT NOT NULL DEFAULT 'PENDING',
  error_message TEXT,
  retry_count INTEGER DEFAULT 0,
  started_at TEXT DEFAULT (datetime('now')),
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS automation_errors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  automation_id INTEGER NOT NULL REFERENCES automation_rules(id),
  run_log_id INTEGER NOT NULL REFERENCES automation_run_log(id),
  error_type TEXT NOT NULL,
  error_message TEXT NOT NULL,
  action_index INTEGER,
  retry_scheduled INTEGER DEFAULT 0,
  acknowledged_by INTEGER REFERENCES users(id),
  acknowledged_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS automation_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL,
  trigger_module TEXT NOT NULL,
  trigger_event TEXT NOT NULL,
  trigger_conditions TEXT,
  actions TEXT NOT NULL,
  is_system_template INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER REFERENCES users(id),
  usage_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS automation_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  automation_id INTEGER NOT NULL REFERENCES automation_rules(id),
  run_log_id INTEGER REFERENCES automation_run_log(id),
  trigger_event TEXT NOT NULL,
  trigger_source_type TEXT,
  trigger_source_id INTEGER,
  triggered_by_user_id INTEGER REFERENCES users(id),
  trigger_data TEXT,
  status TEXT NOT NULL DEFAULT 'QUEUED',
  scheduled_at TEXT DEFAULT (datetime('now')),
  attempts INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 3,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS automation_variable_store (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  automation_id INTEGER NOT NULL REFERENCES automation_rules(id),
  run_log_id INTEGER NOT NULL REFERENCES automation_run_log(id),
  variable_name TEXT NOT NULL,
  variable_value TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS automation_ai_suggestions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  suggested_by_system TEXT NOT NULL DEFAULT 'INTERNAL_AI',
  suggestion_context TEXT,
  suggested_name TEXT NOT NULL,
  suggested_description TEXT,
  suggested_trigger_module TEXT NOT NULL,
  suggested_trigger_event TEXT NOT NULL,
  suggested_conditions TEXT,
  suggested_actions TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  reviewed_by INTEGER REFERENCES users(id),
  reviewed_at TEXT,
  rejection_reason TEXT,
  approved_automation_id INTEGER REFERENCES automation_rules(id),
  created_at TEXT DEFAULT (datetime('now'))
);

-- Performance Indexes
CREATE INDEX IF NOT EXISTS idx_automation_rules_project ON automation_rules(project_id);
CREATE INDEX IF NOT EXISTS idx_automation_rules_module ON automation_rules(trigger_module);
CREATE INDEX IF NOT EXISTS idx_automation_rules_event ON automation_rules(trigger_event);
CREATE INDEX IF NOT EXISTS idx_automation_rules_active ON automation_rules(is_active);
CREATE INDEX IF NOT EXISTS idx_automation_run_log_rule ON automation_run_log(automation_id);
CREATE INDEX IF NOT EXISTS idx_automation_run_log_status ON automation_run_log(overall_status);
CREATE INDEX IF NOT EXISTS idx_automation_errors_rule ON automation_errors(automation_id);
CREATE INDEX IF NOT EXISTS idx_automation_errors_run ON automation_errors(run_log_id);
CREATE INDEX IF NOT EXISTS idx_automation_templates_category ON automation_templates(category);
CREATE INDEX IF NOT EXISTS idx_automation_templates_system ON automation_templates(is_system_template);
CREATE INDEX IF NOT EXISTS idx_automation_queue_status ON automation_queue(status);
CREATE INDEX IF NOT EXISTS idx_automation_queue_rule ON automation_queue(automation_id);
CREATE INDEX IF NOT EXISTS idx_automation_variable_store_run ON automation_variable_store(run_log_id);
CREATE INDEX IF NOT EXISTS idx_automation_ai_suggestions_status ON automation_ai_suggestions(status);

-- Append-Only DB Triggers
CREATE TRIGGER IF NOT EXISTS prevent_run_log_update
BEFORE UPDATE ON automation_run_log
BEGIN SELECT RAISE(ABORT, 'automation_run_log is append-only'); END;

CREATE TRIGGER IF NOT EXISTS prevent_run_log_delete
BEFORE DELETE ON automation_run_log
BEGIN SELECT RAISE(ABORT, 'automation_run_log is append-only'); END;

CREATE TRIGGER IF NOT EXISTS prevent_automation_error_delete
BEFORE DELETE ON automation_errors
BEGIN SELECT RAISE(ABORT, 'automation_errors is append-only'); END;

CREATE TRIGGER IF NOT EXISTS prevent_variable_store_update
BEFORE UPDATE ON automation_variable_store
BEGIN SELECT RAISE(ABORT, 'automation_variable_store is append-only'); END;

CREATE TRIGGER IF NOT EXISTS prevent_variable_store_delete
BEFORE DELETE ON automation_variable_store
BEGIN SELECT RAISE(ABORT, 'automation_variable_store is append-only'); END;

CREATE TRIGGER IF NOT EXISTS prevent_ai_suggestion_update
BEFORE UPDATE ON automation_ai_suggestions
FOR EACH ROW
WHEN (
  OLD.suggested_name != NEW.suggested_name OR
  OLD.suggested_trigger_module != NEW.suggested_trigger_module OR
  OLD.suggested_trigger_event != NEW.suggested_trigger_event OR
  OLD.suggested_actions != NEW.suggested_actions OR
  OLD.id != NEW.id
)
BEGIN SELECT RAISE(ABORT, 'automation_ai_suggestions core fields are append-only'); END;

CREATE TRIGGER IF NOT EXISTS prevent_ai_suggestion_delete
BEFORE DELETE ON automation_ai_suggestions
BEGIN SELECT RAISE(ABORT, 'automation_ai_suggestions is append-only'); END;
`;

export const WIKI_SCHEMA_SQL = `
-- PRD 27: Knowledge Base & Wiki

CREATE TABLE IF NOT EXISTS wiki_spaces (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  icon TEXT DEFAULT '📁',
  color TEXT DEFAULT '#4A90E2',
  visibility TEXT NOT NULL DEFAULT 'INTERNAL',
  project_id INTEGER REFERENCES projects(id),
  is_archived INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS wiki_space_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  space_id INTEGER NOT NULL REFERENCES wiki_spaces(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  role TEXT NOT NULL DEFAULT 'VIEWER',
  added_by INTEGER NOT NULL REFERENCES users(id),
  added_at TEXT DEFAULT (datetime('now')),
  UNIQUE(space_id, user_id)
);

CREATE TABLE IF NOT EXISTS wiki_pages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  space_id INTEGER NOT NULL REFERENCES wiki_spaces(id) ON DELETE CASCADE,
  parent_page_id INTEGER REFERENCES wiki_pages(id),
  title TEXT NOT NULL,
  slug TEXT NOT NULL,
  content TEXT,
  content_text TEXT,
  status TEXT NOT NULL DEFAULT 'PUBLISHED',
  is_client_shared INTEGER NOT NULL DEFAULT 0,
  position INTEGER DEFAULT 0,
  emoji_icon TEXT DEFAULT '📄',
  cover_image TEXT,
  word_count INTEGER DEFAULT 0,
  reading_time_minutes INTEGER DEFAULT 0,
  created_by INTEGER NOT NULL REFERENCES users(id),
  last_edited_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(space_id, slug)
);

CREATE TABLE IF NOT EXISTS wiki_page_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  page_id INTEGER NOT NULL REFERENCES wiki_pages(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  content_text TEXT NOT NULL,
  change_summary TEXT,
  saved_by INTEGER NOT NULL REFERENCES users(id),
  saved_at TEXT DEFAULT (datetime('now')),
  word_count INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS wiki_page_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  page_id INTEGER NOT NULL REFERENCES wiki_pages(id) ON DELETE CASCADE,
  parent_comment_id INTEGER REFERENCES wiki_page_comments(id) ON DELETE CASCADE,
  commented_by INTEGER NOT NULL REFERENCES users(id),
  content TEXT NOT NULL,
  selection_text TEXT,
  is_resolved INTEGER NOT NULL DEFAULT 0,
  resolved_by INTEGER REFERENCES users(id),
  resolved_at TEXT,
  is_edited INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS wiki_page_reactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  page_id INTEGER NOT NULL REFERENCES wiki_pages(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  reaction TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(page_id, user_id, reaction)
);

CREATE TABLE IF NOT EXISTS wiki_page_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_page_id INTEGER NOT NULL REFERENCES wiki_pages(id) ON DELETE CASCADE,
  target_page_id INTEGER NOT NULL REFERENCES wiki_pages(id) ON DELETE CASCADE,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(source_page_id, target_page_id)
);

CREATE TABLE IF NOT EXISTS wiki_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL DEFAULT 'GENERAL',
  content TEXT NOT NULL,
  preview_text TEXT,
  is_system_template INTEGER NOT NULL DEFAULT 1,
  usage_count INTEGER DEFAULT 0,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS wiki_search_index (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  page_id INTEGER NOT NULL REFERENCES wiki_pages(id) ON DELETE CASCADE UNIQUE,
  space_id INTEGER NOT NULL REFERENCES wiki_spaces(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content_text TEXT NOT NULL,
  tags TEXT,
  last_indexed_at TEXT DEFAULT (datetime('now'))
);

-- Performance Indexes
CREATE INDEX IF NOT EXISTS idx_wiki_spaces_slug ON wiki_spaces(slug);
CREATE INDEX IF NOT EXISTS idx_wiki_spaces_project ON wiki_spaces(project_id);
CREATE INDEX IF NOT EXISTS idx_wiki_spaces_visibility ON wiki_spaces(visibility);
CREATE INDEX IF NOT EXISTS idx_wiki_spaces_archived ON wiki_spaces(is_archived);
CREATE INDEX IF NOT EXISTS idx_wiki_space_members_user ON wiki_space_members(user_id);
CREATE INDEX IF NOT EXISTS idx_wiki_space_members_space ON wiki_space_members(space_id);
CREATE INDEX IF NOT EXISTS idx_wiki_pages_space ON wiki_pages(space_id);
CREATE INDEX IF NOT EXISTS idx_wiki_pages_parent ON wiki_pages(parent_page_id);
CREATE INDEX IF NOT EXISTS idx_wiki_pages_slug ON wiki_pages(slug);
CREATE INDEX IF NOT EXISTS idx_wiki_pages_status ON wiki_pages(status);
CREATE INDEX IF NOT EXISTS idx_wiki_pages_client_shared ON wiki_pages(is_client_shared);
CREATE INDEX IF NOT EXISTS idx_wiki_pages_position ON wiki_pages(space_id, parent_page_id, position);
CREATE INDEX IF NOT EXISTS idx_wiki_page_versions_page ON wiki_page_versions(page_id);
CREATE INDEX IF NOT EXISTS idx_wiki_page_versions_version ON wiki_page_versions(page_id, version_number);
CREATE INDEX IF NOT EXISTS idx_wiki_page_comments_page ON wiki_page_comments(page_id);
CREATE INDEX IF NOT EXISTS idx_wiki_page_comments_parent ON wiki_page_comments(parent_comment_id);
CREATE INDEX IF NOT EXISTS idx_wiki_page_comments_resolved ON wiki_page_comments(is_resolved);
CREATE INDEX IF NOT EXISTS idx_wiki_page_reactions_page ON wiki_page_reactions(page_id);
CREATE INDEX IF NOT EXISTS idx_wiki_page_reactions_user ON wiki_page_reactions(user_id);
CREATE INDEX IF NOT EXISTS idx_wiki_page_links_source ON wiki_page_links(source_page_id);
CREATE INDEX IF NOT EXISTS idx_wiki_page_links_target ON wiki_page_links(target_page_id);
CREATE INDEX IF NOT EXISTS idx_wiki_templates_category ON wiki_templates(category);
CREATE INDEX IF NOT EXISTS idx_wiki_templates_system ON wiki_templates(is_system_template);
CREATE INDEX IF NOT EXISTS idx_wiki_search_index_page ON wiki_search_index(page_id);
CREATE INDEX IF NOT EXISTS idx_wiki_search_index_space ON wiki_search_index(space_id);

-- Append-Only DB Triggers on wiki_page_versions
CREATE TRIGGER IF NOT EXISTS prevent_page_version_update
BEFORE UPDATE ON wiki_page_versions
BEGIN SELECT RAISE(ABORT, 'wiki_page_versions is append-only'); END;

CREATE TRIGGER IF NOT EXISTS prevent_page_version_delete
BEFORE DELETE ON wiki_page_versions
WHEN (SELECT 1 FROM wiki_pages WHERE id = OLD.page_id) IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'wiki_page_versions is append-only'); END;

-- SQLite FTS5 Virtual Table for full-text search
CREATE VIRTUAL TABLE IF NOT EXISTS wiki_search_fts USING fts5(
  page_id UNINDEXED,
  space_id UNINDEXED,
  title,
  content_text,
  tags UNINDEXED,
  tokenize = 'porter unicode61'
);

-- Triggers keeping FTS5 table in sync with wiki_search_index
CREATE TRIGGER IF NOT EXISTS wiki_search_index_ai AFTER INSERT ON wiki_search_index BEGIN
  INSERT INTO wiki_search_fts(rowid, page_id, space_id, title, content_text, tags)
  VALUES (new.id, new.page_id, new.space_id, new.title, new.content_text, new.tags);
END;

CREATE TRIGGER IF NOT EXISTS wiki_search_index_ad AFTER DELETE ON wiki_search_index BEGIN
  DELETE FROM wiki_search_fts WHERE rowid = old.id;
END;

CREATE TRIGGER IF NOT EXISTS wiki_search_index_au AFTER UPDATE ON wiki_search_index BEGIN
  DELETE FROM wiki_search_fts WHERE rowid = old.id;
  INSERT INTO wiki_search_fts(rowid, page_id, space_id, title, content_text, tags)
  VALUES (new.id, new.page_id, new.space_id, new.title, new.content_text, new.tags);
END;
`;

export function seedBuiltInKpis(db) {
  try {
    const adminRow = db.prepare("SELECT id FROM users WHERE role IN ('admin', 'superadmin') LIMIT 1").get();
    const adminId = adminRow ? adminRow.id : 1;

    const builtInKpis = [
      {
        name: 'Sprint Velocity',
        description: 'Average completed story points per sprint (last 5 sprints)',
        data_source: 'SPRINT',
        metric_type: 'AVERAGE',
        calculation_query: JSON.stringify({ source: 'sprint_velocity_log', field: 'total_points_completed', agg: 'AVERAGE', limit: 5 }),
        unit: 'pts',
        target_value: 30.0,
        alert_threshold_low: 15.0,
        alert_threshold_high: null,
        refresh_interval_minutes: 60
      },
      {
        name: 'Sprint Completion Rate',
        description: 'Completed points ÷ committed points × 100 (current sprint)',
        data_source: 'SPRINT',
        metric_type: 'PERCENTAGE',
        calculation_query: JSON.stringify({ source: 'sprints', agg: 'RATIO', numerator: 'completed_points', denominator: 'committed_points', filter: { status: 'ACTIVE' } }),
        unit: '%',
        target_value: 85.0,
        alert_threshold_low: 60.0,
        alert_threshold_high: null,
        refresh_interval_minutes: 60
      },
      {
        name: 'OKR Progress (Company Level)',
        description: 'Average progress_pct of all COMPANY level active objectives',
        data_source: 'OKR',
        metric_type: 'AVERAGE',
        calculation_query: JSON.stringify({ table: 'objectives', field: 'progress_pct', filter: { level: 'COMPANY', status: 'ACTIVE' }, agg: 'AVERAGE' }),
        unit: '%',
        target_value: 75.0,
        alert_threshold_low: 40.0,
        alert_threshold_high: null,
        refresh_interval_minutes: 60
      },
      {
        name: 'Team Utilization',
        description: 'Average utilization_pct across all active members this week',
        data_source: 'WORKLOAD',
        metric_type: 'AVERAGE',
        calculation_query: JSON.stringify({ table: 'workload_snapshots', field: 'utilization_pct', agg: 'AVERAGE' }),
        unit: '%',
        target_value: 80.0,
        alert_threshold_low: 50.0,
        alert_threshold_high: 105.0,
        refresh_interval_minutes: 60
      },
      {
        name: 'Billable Hours This Month',
        description: 'SUM(duration_minutes) where is_billable=1 and APPROVED / 60',
        data_source: 'TIME_TRACKING',
        metric_type: 'SUM',
        calculation_query: JSON.stringify({ table: 'time_entries', field: 'duration_minutes', filter: { is_billable: 1, status: 'APPROVED' }, divisor: 60, agg: 'SUM' }),
        unit: 'hrs',
        target_value: 160.0,
        alert_threshold_low: 80.0,
        alert_threshold_high: null,
        refresh_interval_minutes: 60
      },
      {
        name: 'Pipeline Completion Rate',
        description: 'Approved checklist points ÷ total checklist points × 100',
        data_source: 'PIPELINE',
        metric_type: 'PERCENTAGE',
        calculation_query: JSON.stringify({ table: 'pipeline_checklist_points', agg: 'PERCENTAGE', filter_numerator: { status: 'APPROVED' } }),
        unit: '%',
        target_value: 80.0,
        alert_threshold_low: 50.0,
        alert_threshold_high: null,
        refresh_interval_minutes: 60
      },
      {
        name: 'GitHub PR Merge Rate',
        description: 'Merged PRs ÷ total PRs opened this month × 100',
        data_source: 'GITHUB',
        metric_type: 'PERCENTAGE',
        calculation_query: JSON.stringify({ table: 'github_webhook_log', event_type: 'pull_request', agg: 'PERCENTAGE' }),
        unit: '%',
        target_value: 90.0,
        alert_threshold_low: 70.0,
        alert_threshold_high: null,
        refresh_interval_minutes: 60
      },
      {
        name: 'Revenue This Month',
        description: 'SUM(payout amounts) for current month',
        data_source: 'REVENUE',
        metric_type: 'SUM',
        calculation_query: JSON.stringify({ table: 'revenue_transactions', field: 'amount', agg: 'SUM' }),
        unit: '₹',
        target_value: 500000.0,
        alert_threshold_low: 100000.0,
        alert_threshold_high: null,
        refresh_interval_minutes: 60
      },
      {
        name: 'Active Backlog Items',
        description: 'COUNT of backlog_items where sprint_id IS NULL and status != DONE',
        data_source: 'SPRINT',
        metric_type: 'COUNT',
        calculation_query: JSON.stringify({ table: 'backlog_items', filter: { sprint_id: null, not_status: 'DONE' }, agg: 'COUNT' }),
        unit: 'count',
        target_value: 20.0,
        alert_threshold_low: null,
        alert_threshold_high: 50.0,
        refresh_interval_minutes: 60
      },
      {
        name: 'Overloaded Members',
        description: 'COUNT of members with utilization > 100% this week',
        data_source: 'WORKLOAD',
        metric_type: 'COUNT',
        calculation_query: JSON.stringify({ table: 'workload_snapshots', filter: { min_utilization: 100 }, agg: 'COUNT' }),
        unit: 'count',
        target_value: 0.0,
        alert_threshold_low: null,
        alert_threshold_high: 1.0,
        refresh_interval_minutes: 60
      }
    ];

    const checkStmt = db.prepare('SELECT id FROM kpi_definitions WHERE name = ?');
    const insertStmt = db.prepare(`
      INSERT INTO kpi_definitions (
        name, description, data_source, metric_type, calculation_query, unit,
        target_value, alert_threshold_low, alert_threshold_high, refresh_interval_minutes,
        is_active, is_built_in, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?)
    `);

    for (const kpi of builtInKpis) {
      const existing = checkStmt.get(kpi.name);
      if (!existing) {
        insertStmt.run(
          kpi.name,
          kpi.description,
          kpi.data_source,
          kpi.metric_type,
          kpi.calculation_query,
          kpi.unit,
          kpi.target_value,
          kpi.alert_threshold_low,
          kpi.alert_threshold_high,
          kpi.refresh_interval_minutes,
          adminId
        );
      }
    }
  } catch (err) {
    // If users table is not yet created during initial schema loading, silently defer
    if (!err.message.includes('no such table')) {
      console.error('[DB] Warning seeding built-in KPIs:', err.message);
    }
  }
}

export function seedDefaultExpenseCategories(db) {
  try {
    const adminRow = db.prepare("SELECT id FROM users WHERE role IN ('admin', 'superadmin') LIMIT 1").get();
    const adminId = adminRow ? adminRow.id : 1;

    const defaultCategories = [
      { name: 'SOFTWARE', description: 'Software licenses, subscriptions, and developer tools' },
      { name: 'HARDWARE', description: 'Equipment, servers, peripherals, and testing devices' },
      { name: 'TRAVEL', description: 'Travel, lodging, transport, and on-site client visits' },
      { name: 'MARKETING', description: 'Marketing campaigns, advertising, collateral, and promotion' },
      { name: 'CONTRACTOR', description: 'External contractors, freelancers, and specialist consulting' },
      { name: 'OFFICE', description: 'Office supplies, utilities, workspace, and facilities' },
      { name: 'TRAINING', description: 'Training courses, certifications, conferences, and books' },
      { name: 'MISCELLANEOUS', description: 'Sundry and uncategorized project expenses' }
    ];

    const checkStmt = db.prepare('SELECT id FROM expense_categories WHERE name = ?');
    const insertStmt = db.prepare(`
      INSERT INTO expense_categories (name, description, is_active, created_by)
      VALUES (?, ?, 1, ?)
    `);

    for (const cat of defaultCategories) {
      const existing = checkStmt.get(cat.name);
      if (!existing) {
        insertStmt.run(cat.name, cat.description, adminId);
      }
    }
  } catch (err) {
    if (!err.message.includes('no such table')) {
      console.error('[DB] Warning seeding default expense categories:', err.message);
    }
  }
}

export function seedBuiltInAutomationTemplates(db) {
  try {
    const adminRow = db.prepare("SELECT id FROM users WHERE role IN ('admin', 'superadmin') LIMIT 1").get();
    const adminId = adminRow ? adminRow.id : 1;

    const templates = [
      {
        name: 'Sprint Started Notification',
        description: 'When sprint starts → notify all sprint members',
        category: 'SPRINT',
        trigger_module: 'SPRINT',
        trigger_event: 'SPRINT_STARTED',
        trigger_conditions: null,
        actions: JSON.stringify([{ action: 'SEND_NOTIFICATION', params: { to: 'PROJECT_MEMBERS', message: 'Sprint {{sprint.name}} has officially started!' } }])
      },
      {
        name: 'Sprint Completed Backlog Rollover',
        description: 'When sprint completed → move TODO items back to backlog',
        category: 'SPRINT',
        trigger_module: 'SPRINT',
        trigger_event: 'SPRINT_COMPLETED',
        trigger_conditions: null,
        actions: JSON.stringify([{ action: 'MOVE_ITEM_TO_BACKLOG', params: { item_id_from_trigger: '{{item.id}}' } }])
      },
      {
        name: 'Task Completed Assignee Alert',
        description: 'When backlog item status = DONE → notify assignee',
        category: 'NOTIFICATIONS',
        trigger_module: 'BACKLOG',
        trigger_event: 'ITEM_STATUS_CHANGED',
        trigger_conditions: JSON.stringify([{ field: 'status', operator: 'EQUALS', value: 'DONE' }]),
        actions: JSON.stringify([{ action: 'SEND_NOTIFICATION', params: { to: 'ASSIGNEE', message: 'Task {{item.title}} has been marked DONE.' } }])
      },
      {
        name: 'Overdue Task Warning',
        description: 'When backlog item overdue → notify assignee + Admin',
        category: 'NOTIFICATIONS',
        trigger_module: 'BACKLOG',
        trigger_event: 'ITEM_STATUS_CHANGED',
        trigger_conditions: JSON.stringify([{ field: 'is_overdue', operator: 'EQUALS', value: true }]),
        actions: JSON.stringify([
          { action: 'SEND_NOTIFICATION', params: { to: 'ASSIGNEE', message: 'Task {{item.title}} is overdue!' } },
          { action: 'SEND_NOTIFICATION', params: { to: 'ADMIN', message: 'Task {{item.title}} is overdue (Assignee: {{member.name}}).' } }
        ])
      },
      {
        name: 'OKR Goal Achieved',
        description: 'When OKR progress >= 100% → notify objective owner',
        category: 'OKR',
        trigger_module: 'OKR',
        trigger_event: 'OKR_PROGRESS_REACHED',
        trigger_conditions: JSON.stringify([{ field: 'progress_pct', operator: 'GREATER_THAN_OR_EQUAL', value: 100 }]),
        actions: JSON.stringify([{ action: 'SEND_NOTIFICATION', params: { to: 'SPECIFIC_USER', message: 'Congratulations! Objective {{objective.title}} has reached 100% completion.' } }])
      },
      {
        name: 'OKR At Risk Admin Alert',
        description: 'When OKR status = AT_RISK → notify Admin',
        category: 'OKR',
        trigger_module: 'OKR',
        trigger_event: 'OKR_AT_RISK',
        trigger_conditions: JSON.stringify([{ field: 'status', operator: 'EQUALS', value: 'AT_RISK' }]),
        actions: JSON.stringify([{ action: 'SEND_NOTIFICATION', params: { to: 'ADMIN', message: 'Objective {{objective.title}} is now AT RISK.' } }])
      },
      {
        name: 'Missed Milestone Follow-up',
        description: 'When gantt milestone missed → notify Admin + create follow-up backlog item',
        category: 'GENERAL',
        trigger_module: 'GANTT',
        trigger_event: 'MILESTONE_MISSED',
        trigger_conditions: null,
        actions: JSON.stringify([
          { action: 'SEND_NOTIFICATION', params: { to: 'ADMIN', message: 'Milestone {{milestone.title}} was missed.' } },
          { action: 'CREATE_BACKLOG_ITEM', params: { title: 'Follow up: Missed milestone {{milestone.title}}', type: 'TASK', priority: 'HIGH' } }
        ])
      },
      {
        name: 'Member Overload Alert',
        description: 'When member overloaded → notify Admin',
        category: 'NOTIFICATIONS',
        trigger_module: 'WORKLOAD',
        trigger_event: 'MEMBER_OVERLOADED',
        trigger_conditions: JSON.stringify([{ field: 'utilization_pct', operator: 'GREATER_THAN', value: 100 }]),
        actions: JSON.stringify([{ action: 'SEND_NOTIFICATION', params: { to: 'ADMIN', message: 'Member {{member.name}} is overloaded (>100% utilization).' } }])
      },
      {
        name: 'Expense Approval Notification',
        description: 'When expense approved → notify expense submitter',
        category: 'FINANCE',
        trigger_module: 'EXPENSE',
        trigger_event: 'EXPENSE_APPROVED',
        trigger_conditions: null,
        actions: JSON.stringify([{ action: 'SEND_NOTIFICATION', params: { to: 'SPECIFIC_USER', message: 'Your expense request for {{expense.amount}} INR has been approved.' } }])
      },
      {
        name: 'Expense Rejection Notification',
        description: 'When expense rejected → notify expense submitter with rejection reason',
        category: 'FINANCE',
        trigger_module: 'EXPENSE',
        trigger_event: 'EXPENSE_REJECTED',
        trigger_conditions: null,
        actions: JSON.stringify([{ action: 'SEND_NOTIFICATION', params: { to: 'SPECIFIC_USER', message: 'Your expense request was rejected: {{expense.rejection_reason}}' } }])
      },
      {
        name: 'Budget Warning Threshold',
        description: 'When budget threshold reached (80%) → notify Admin',
        category: 'FINANCE',
        trigger_module: 'EXPENSE',
        trigger_event: 'BUDGET_THRESHOLD_REACHED',
        trigger_conditions: JSON.stringify([{ field: 'spent_percentage', operator: 'GREATER_THAN_OR_EQUAL', value: 80 }]),
        actions: JSON.stringify([{ action: 'SEND_NOTIFICATION', params: { to: 'ADMIN', message: 'Project budget has reached 80% threshold.' } }])
      },
      {
        name: 'Budget Exceeded Critical Alert',
        description: 'When budget exceeded (100%) → notify Admin + Super Admin',
        category: 'FINANCE',
        trigger_module: 'EXPENSE',
        trigger_event: 'BUDGET_EXCEEDED',
        trigger_conditions: JSON.stringify([{ field: 'spent_percentage', operator: 'GREATER_THAN_OR_EQUAL', value: 100 }]),
        actions: JSON.stringify([{ action: 'SEND_NOTIFICATION', params: { to: 'ADMIN', message: 'URGENT: Budget exceeded for project {{project.name}}!' } }])
      },
      {
        name: 'Overdue Invoice Reminder',
        description: 'When invoice overdue → notify Admin',
        category: 'FINANCE',
        trigger_module: 'EXPENSE',
        trigger_event: 'INVOICE_OVERDUE',
        trigger_conditions: null,
        actions: JSON.stringify([{ action: 'SEND_NOTIFICATION', params: { to: 'ADMIN', message: 'Invoice {{invoice.invoice_number}} is overdue!' } }])
      },
      {
        name: 'Client Order Intake Alert',
        description: 'When client order submitted → notify Admin + assigned handler',
        category: 'CLIENT',
        trigger_module: 'CLIENT',
        trigger_event: 'CLIENT_ORDER_SUBMITTED',
        trigger_conditions: null,
        actions: JSON.stringify([{ action: 'SEND_NOTIFICATION', params: { to: 'ADMIN', message: 'New client order submitted: {{order.title}}' } }])
      },
      {
        name: 'Client Milestone Sign-off Update',
        description: 'When client milestone approved → update milestone status to ACHIEVED',
        category: 'CLIENT',
        trigger_module: 'CLIENT',
        trigger_event: 'CLIENT_MILESTONE_APPROVED',
        trigger_conditions: null,
        actions: JSON.stringify([{ action: 'CHANGE_STATUS', params: { entity_type: 'MILESTONE', new_status: 'ACHIEVED' } }])
      },
      {
        name: 'GitHub PR Merged Team Update',
        description: 'When PR merged → notify project team',
        category: 'GITHUB',
        trigger_module: 'GITHUB',
        trigger_event: 'PR_MERGED',
        trigger_conditions: null,
        actions: JSON.stringify([{ action: 'SEND_NOTIFICATION', params: { to: 'PROJECT_MEMBERS', message: 'Pull Request #{{pr.number}} merged: {{pr.title}}' } }])
      },
      {
        name: 'Rejected Time Entry Notice',
        description: 'When time entry rejected → notify submitter',
        category: 'NOTIFICATIONS',
        trigger_module: 'TIME',
        trigger_event: 'TIME_ENTRY_REJECTED',
        trigger_conditions: null,
        actions: JSON.stringify([{ action: 'SEND_NOTIFICATION', params: { to: 'SPECIFIC_USER', message: 'Your time entry has been rejected: {{time.rejection_reason}}' } }])
      },
      {
        name: 'Member Offboarding Sprint Cleanup',
        description: 'When member offboarded → notify Admin + remove from active sprint',
        category: 'GENERAL',
        trigger_module: 'MEMBER',
        trigger_event: 'MEMBER_OFFBOARDED',
        trigger_conditions: null,
        actions: JSON.stringify([{ action: 'SEND_NOTIFICATION', params: { to: 'ADMIN', message: 'Member {{member.name}} offboarded. Cleaning up sprint assignments.' } }])
      },
      {
        name: 'Pipeline Stage Handover Alert',
        description: 'When pipeline stage completed → notify next stage owner',
        category: 'GENERAL',
        trigger_module: 'PIPELINE',
        trigger_event: 'PIPELINE_STAGE_COMPLETED',
        trigger_conditions: null,
        actions: JSON.stringify([{ action: 'SEND_NOTIFICATION', params: { to: 'SPECIFIC_USER', message: 'Pipeline stage {{stage.name}} completed! Handoff ready for review.' } }])
      },
      {
        name: 'Revenue Share Blocked Warning',
        description: 'When revenue share blocked → notify Admin with member name + reason',
        category: 'NOTIFICATIONS',
        trigger_module: 'MEMBER',
        trigger_event: 'REVENUE_SHARE_BLOCKED',
        trigger_conditions: null,
        actions: JSON.stringify([{ action: 'SEND_NOTIFICATION', params: { to: 'ADMIN', message: 'Revenue share blocked for {{member.name}}: {{block.reason}}' } }])
      }
    ];

    const checkStmt = db.prepare('SELECT id FROM automation_templates WHERE name = ?');
    const insertStmt = db.prepare(`
      INSERT INTO automation_templates (
        name, description, category, trigger_module, trigger_event,
        trigger_conditions, actions, is_system_template, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
    `);

    for (const t of templates) {
      const existing = checkStmt.get(t.name);
      if (!existing) {
        insertStmt.run(
          t.name,
          t.description,
          t.category,
          t.trigger_module,
          t.trigger_event,
          t.trigger_conditions,
          t.actions,
          adminId
        );
      }
    }
  } catch (err) {
    if (!err.message.includes('no such table')) {
      console.error('[DB] Warning seeding built-in automation templates:', err.message);
    }
  }
}

export function seedBuiltInWikiTemplates(db) {
  try {
    const adminRow = db.prepare("SELECT id FROM users WHERE role IN ('admin', 'superadmin') LIMIT 1").get();
    const adminId = adminRow ? adminRow.id : 1;

    const templates = [
      {
        name: 'Standard Operating Procedure (SOP)',
        description: 'Standard operational guideline for routine business and engineering processes.',
        category: 'SOP',
        preview_text: 'Purpose, Scope, Responsibilities, Procedures & Notes',
        content: JSON.stringify([
          { id: 'sop-h1', type: 'HEADING_1', content: 'Standard Operating Procedure (SOP)', attrs: { level: 1 } },
          { id: 'sop-purpose-h2', type: 'HEADING_2', content: '1. Purpose', attrs: { level: 2 } },
          { id: 'sop-purpose-p', type: 'PARAGRAPH', content: 'Define the primary objective and business necessity for this operating procedure.' },
          { id: 'sop-scope-h2', type: 'HEADING_2', content: '2. Scope', attrs: { level: 2 } },
          { id: 'sop-scope-p', type: 'PARAGRAPH', content: 'Specify the departments, projects, roles, and systems governed by this SOP.' },
          { id: 'sop-resp-h2', type: 'HEADING_2', content: '3. Responsibilities', attrs: { level: 2 } },
          { id: 'sop-resp-list', type: 'BULLET_LIST', content: 'Process Owner: Oversees procedure compliance and maintenance.\nOperator: Executes step-by-step instructions as documented.\nReviewer: Audits execution and verifies output quality.' },
          { id: 'sop-steps-h2', type: 'HEADING_2', content: '4. Step-by-Step Procedure', attrs: { level: 2 } },
          { id: 'sop-steps-list', type: 'NUMBERED_LIST', content: 'Step 1: Pre-flight environment and dependency verification.\nStep 2: Execution of standard operational tasks.\nStep 3: Quality validation and peer review checkpoint.\nStep 4: Audit logging and status communication.' },
          { id: 'sop-notes-h2', type: 'HEADING_2', content: '5. Notes & Exceptions', attrs: { level: 2 } },
          { id: 'sop-notes-callout', type: 'CALLOUT', content: 'Important: Any divergence from this standard procedure must be authorized by an Admin.', attrs: { color: '#38bdf8' } }
        ])
      },
      {
        name: 'Meeting Notes',
        description: 'Structured meeting record capturing agenda, discussion, decisions, and action items.',
        category: 'MEETING_NOTES',
        preview_text: 'Date, Attendees, Agenda, Discussion, Decisions, Action Items',
        content: JSON.stringify([
          { id: 'meet-h1', type: 'HEADING_1', content: 'Team Meeting Notes', attrs: { level: 1 } },
          { id: 'meet-info-h2', type: 'HEADING_2', content: 'Meeting Details', attrs: { level: 2 } },
          { id: 'meet-info-p', type: 'PARAGRAPH', content: 'Date: YYYY-MM-DD | Time: HH:MM UTC | Lead: @Organizer' },
          { id: 'meet-attendees-h2', type: 'HEADING_2', content: 'Attendees', attrs: { level: 2 } },
          { id: 'meet-attendees-list', type: 'BULLET_LIST', content: 'Required Attendees: @Alice, @Bob\nOptional Attendees: @Charlie' },
          { id: 'meet-agenda-h2', type: 'HEADING_2', content: 'Agenda', attrs: { level: 2 } },
          { id: 'meet-agenda-list', type: 'NUMBERED_LIST', content: '1. Review prior sprint milestones\n2. Architecture alignment\n3. Roadblocks and dependency unblocking' },
          { id: 'meet-discussion-h2', type: 'HEADING_2', content: 'Discussion Points', attrs: { level: 2 } },
          { id: 'meet-discussion-p', type: 'PARAGRAPH', content: 'Key debate points, technical tradeoffs, and options evaluated during the call.' },
          { id: 'meet-decisions-h2', type: 'HEADING_2', content: 'Decisions', attrs: { level: 2 } },
          { id: 'meet-decisions-callout', type: 'CALLOUT', content: 'Consensus Decision: Approved architecture proposal variant B.', attrs: { color: '#10b981' } },
          { id: 'meet-actions-h2', type: 'HEADING_2', content: 'Action Items', attrs: { level: 2 } },
          { id: 'meet-actions-todo', type: 'TODO', content: 'Submit draft schema migration by Friday (@Developer)\nUpdate API endpoint contract (@Lead)', attrs: { checked: false } }
        ])
      },
      {
        name: 'Project Documentation',
        description: 'Comprehensive project charter with objectives, timeline, risks, and technical architecture.',
        category: 'PROJECT_DOC',
        preview_text: 'Overview, Goals, Timeline, Team, Tech Details, Risks',
        content: JSON.stringify([
          { id: 'proj-h1', type: 'HEADING_1', content: 'Project Charter & Technical Architecture', attrs: { level: 1 } },
          { id: 'proj-overview-h2', type: 'HEADING_2', content: '1. Overview', attrs: { level: 2 } },
          { id: 'proj-overview-p', type: 'PARAGRAPH', content: 'Executive summary detailing the project mission, target audience, and business impact.' },
          { id: 'proj-goals-h2', type: 'HEADING_2', content: '2. Goals & Success Metrics', attrs: { level: 2 } },
          { id: 'proj-goals-list', type: 'BULLET_LIST', content: 'Deliver sub-100ms API response times across all primary endpoints.\nAttain 100% test pass rate with zero regression on existing platform services.\nSeamless client portal integration with zero data leakage.' },
          { id: 'proj-timeline-h2', type: 'HEADING_2', content: '3. Timeline & Key Milestones', attrs: { level: 2 } },
          { id: 'proj-timeline-num', type: 'NUMBERED_LIST', content: 'Phase 1: Architecture, database schema, and test harness setup.\nPhase 2: Service layer and REST API implementation.\nPhase 3: Frontend dashboard and client-facing interfaces.\nPhase 4: Full integration verification and platform sealing.' },
          { id: 'proj-team-h2', type: 'HEADING_2', content: '4. Team & Ownership', attrs: { level: 2 } },
          { id: 'proj-team-p', type: 'PARAGRAPH', content: 'Project Lead: @Admin | Backend: @Developer | Design: @Designer | QA: @Tester' },
          { id: 'proj-tech-h2', type: 'HEADING_2', content: '5. Technical Details & Data Flow', attrs: { level: 2 } },
          { id: 'proj-tech-code', type: 'CODE', content: '// Data Flow Pipeline Architecture\nRequest -> Auth Gate -> Service Validator -> Database WAL -> Trigger Dispatcher', attrs: { language: 'js' } },
          { id: 'proj-risks-h2', type: 'HEADING_2', content: '6. Risks & Mitigation Strategies', attrs: { level: 2 } },
          { id: 'proj-risks-callout', type: 'CALLOUT', content: 'Identified Risk: Database lock contention during burst operations. Mitigation: WAL mode with 5000ms busy_timeout.', attrs: { color: '#f59e0b' } },
          { id: 'proj-links-h2', type: 'HEADING_2', content: '7. Relevant Links & Resources', attrs: { level: 2 } },
          { id: 'proj-links-p', type: 'PARAGRAPH', content: 'Design Specs: [Figma Workspace] | Repository: [GitHub Repo] | Live API: [Environment URL]' }
        ])
      },
      {
        name: 'Team Member Onboarding Guide',
        description: 'Step-by-step checklist and orientation handbook for new team members.',
        category: 'ONBOARDING',
        preview_text: 'Welcome, Checklist, Tools, Team Intro, Resources',
        content: JSON.stringify([
          { id: 'onboard-h1', type: 'HEADING_1', content: 'Welcome to Mahi Tech Group', attrs: { level: 1 } },
          { id: 'onboard-welcome-p', type: 'PARAGRAPH', content: 'Welcome aboard! This handbook provides everything you need to set up your environment, understand our workflows, and ship your first feature.' },
          { id: 'onboard-day1-h2', type: 'HEADING_2', content: 'First Day Checklist', attrs: { level: 2 } },
          { id: 'onboard-day1-todo', type: 'TODO', content: 'Accept your platform invitation and set a secure password\nLink your GitHub account in profile settings\nReview team communication norms and meeting schedules\nClone the main repository and verify local test suites', attrs: { checked: false } },
          { id: 'onboard-tools-h2', type: 'HEADING_2', content: 'Tools Setup & Access', attrs: { level: 2 } },
          { id: 'onboard-tools-list', type: 'BULLET_LIST', content: 'GitHub Organization: mahi-tech-group\nDatabase: SQLite WAL local instance\nDevelopment Shell: Node.js v22+ with npm\nCommunication: Internal Coworking Canvas & Meeting WebSockets' },
          { id: 'onboard-team-h2', type: 'HEADING_2', content: 'Team Introduction & Roles', attrs: { level: 2 } },
          { id: 'onboard-team-p', type: 'PARAGRAPH', content: 'Our team operates across 4 core pipeline roles: Researcher, UI/UX Designer, Developer, and Producer / Tester, coordinated by Administrators.' },
          { id: 'onboard-res-h2', type: 'HEADING_2', content: 'Core Resources & Knowledge Base', attrs: { level: 2 } },
          { id: 'onboard-res-callout', type: 'CALLOUT', content: 'Tip: Explore the Engineering SOPs and Architecture Decision Records (ADRs) in this Wiki before submitting pull requests.', attrs: { color: '#38bdf8' } }
        ])
      },
      {
        name: 'Technical Reference Architecture',
        description: 'Engineering guide covering installation, configuration, APIs, and troubleshooting.',
        category: 'TECHNICAL',
        preview_text: 'Installation, Architecture, API Reference, Examples, Troubleshooting',
        content: JSON.stringify([
          { id: 'tech-h1', type: 'HEADING_1', content: 'Technical Reference Architecture', attrs: { level: 1 } },
          { id: 'tech-overview-h2', type: 'HEADING_2', content: 'Overview & Stack', attrs: { level: 2 } },
          { id: 'tech-overview-p', type: 'PARAGRAPH', content: 'The Mahi Tech Group platform is built on an Express.js backend, SQLite WAL persistent engine, and vanilla modular frontend.' },
          { id: 'tech-install-h2', type: 'HEADING_2', content: 'Installation & Bootstrapping', attrs: { level: 2 } },
          { id: 'tech-install-code', type: 'CODE', content: 'git clone https://github.com/Munnabhai63/mahi-tech-group.git\ncd "MAHI TECH GROUP"\nnpm install\nnpm run migrate\nnpm test', attrs: { language: 'bash' } },
          { id: 'tech-api-h2', type: 'HEADING_2', content: 'API Reference & Routing Standards', attrs: { level: 2 } },
          { id: 'tech-api-p', type: 'PARAGRAPH', content: 'All API routes require Bearer JWT authentication, validate input with strict schemas, and return consistent JSON structures.' },
          { id: 'tech-trouble-h2', type: 'HEADING_2', content: 'Troubleshooting & Diagnostics', attrs: { level: 2 } },
          { id: 'tech-trouble-callout', type: 'CALLOUT', content: 'Database Locked: Verify that PRAGMA journal_mode = WAL; is active and connections set PRAGMA busy_timeout = 5000;.', attrs: { color: '#ef4444' } }
        ])
      },
      {
        name: 'Sprint Retrospective',
        description: 'Agile retrospective template analyzing what went well, improvements, and action items.',
        category: 'RETROSPECTIVE',
        preview_text: 'What Went Well, Needs Improvement, Action Items, Metrics',
        content: JSON.stringify([
          { id: 'retro-h1', type: 'HEADING_1', content: 'Sprint Retrospective', attrs: { level: 1 } },
          { id: 'retro-meta-p', type: 'PARAGRAPH', content: 'Sprint: #SprintNumber | Date: YYYY-MM-DD | Facilitator: @ScrumMaster' },
          { id: 'retro-good-h2', type: 'HEADING_2', content: '1. What Went Well (Praise & Successes)', attrs: { level: 2 } },
          { id: 'retro-good-list', type: 'BULLET_LIST', content: 'Completed 100% of committed high-priority user stories.\nZero regressions detected across all 13 core test suites.\nSmooth deployment and instant client sign-offs.' },
          { id: 'retro-improve-h2', type: 'HEADING_2', content: '2. What Could Improve (Challenges & Friction)', attrs: { level: 2 } },
          { id: 'retro-improve-list', type: 'BULLET_LIST', content: 'PR reviews took longer than 24 hours on complex backend changes.\nUnderestimated edge case testing on circular workflow automation rules.' },
          { id: 'retro-actions-h2', type: 'HEADING_2', content: '3. Action Items & Commitments', attrs: { level: 2 } },
          { id: 'retro-actions-todo', type: 'TODO', content: 'Implement automated PR review alert in PRD 26 Automation Engine\nExpand pre-flight integration test checklists for upcoming PRDs', attrs: { checked: false } },
          { id: 'retro-metrics-h2', type: 'HEADING_2', content: '4. Velocity & Quality Metrics', attrs: { level: 2 } },
          { id: 'retro-metrics-callout', type: 'CALLOUT', content: 'Velocity: 42 Story Points Completed | Defect Escape Rate: 0% | Quorum: 100%', attrs: { color: '#10b981' } }
        ])
      },
      {
        name: 'Product Requirements Document (PRD)',
        description: 'Detailed product specification defining user problems, stories, and acceptance criteria.',
        category: 'PROJECT_DOC',
        preview_text: 'Problem Statement, Goals, User Stories, Acceptance Criteria',
        content: JSON.stringify([
          { id: 'prd-h1', type: 'HEADING_1', content: 'Product Requirements Document (PRD)', attrs: { level: 1 } },
          { id: 'prd-prob-h2', type: 'HEADING_2', content: '1. Problem Statement', attrs: { level: 2 } },
          { id: 'prd-prob-p', type: 'PARAGRAPH', content: 'Clear, concise description of the user pain point, market opportunity, and why existing workarounds are insufficient.' },
          { id: 'prd-goals-h2', type: 'HEADING_2', content: '2. Goals & Non-Goals', attrs: { level: 2 } },
          { id: 'prd-goals-list', type: 'BULLET_LIST', content: 'Goal: Provide instant, tamper-evident document collaboration.\nGoal: Zero-trust segregation between internal discussions and client-facing views.\nNon-Goal: Implementing a general-purpose spreadsheet calculation engine.' },
          { id: 'prd-stories-h2', type: 'HEADING_2', content: '3. User Stories', attrs: { level: 2 } },
          { id: 'prd-stories-num', type: 'NUMBERED_LIST', content: 'As an Engineer, I want block-based editing with slash commands so that I can draft documentation rapidly.\nAs a Project Lead, I want append-only version history so that changes can be audited and restored without data loss.\nAs a Client, I want clean read-only access to shared specs without seeing internal team deliberations.' },
          { id: 'prd-criteria-h2', type: 'HEADING_2', content: '4. Acceptance Criteria & Definition of Done', attrs: { level: 2 } },
          { id: 'prd-criteria-todo', type: 'TODO', content: 'All database tables and append-only triggers verified\nAll REST API endpoints covered by real HTTP integration tests\nFull regression pass on existing platform suites', attrs: { checked: false } }
        ])
      },
      {
        name: 'Bug Report & Defect RCA',
        description: 'Defect investigation template recording reproduction steps, actual vs expected, and RCA.',
        category: 'TECHNICAL',
        preview_text: 'Summary, Steps to Reproduce, Expected vs Actual, Environment',
        content: JSON.stringify([
          { id: 'bug-h1', type: 'HEADING_1', content: 'Defect Investigation & RCA Report', attrs: { level: 1 } },
          { id: 'bug-summary-h2', type: 'HEADING_2', content: '1. Summary & Severity', attrs: { level: 2 } },
          { id: 'bug-summary-p', type: 'PARAGRAPH', content: 'Severity: High | Affected Component: Workflow Automation Worker | Reporter: @QAEngineer' },
          { id: 'bug-repro-h2', type: 'HEADING_2', content: '2. Steps to Reproduce', attrs: { level: 2 } },
          { id: 'bug-repro-num', type: 'NUMBERED_LIST', content: '1. Navigate to Automation Rules Builder.\n2. Create a rule triggering on SPRINT_STARTED with circular action.\n3. Attempt to save without valid condition logic.' },
          { id: 'bug-behavior-h2', type: 'HEADING_2', content: '3. Expected vs Actual Behavior', attrs: { level: 2 } },
          { id: 'bug-expected-p', type: 'PARAGRAPH', content: 'Expected: The API returns HTTP 400 with a descriptive circular dependency error.' },
          { id: 'bug-actual-p', type: 'PARAGRAPH', content: 'Actual: Uncaught exception in background queue worker leading to 500 error.' },
          { id: 'bug-rca-h2', type: 'HEADING_2', content: '4. Root Cause Analysis (RCA) & Permanent Fix', attrs: { level: 2 } },
          { id: 'bug-rca-callout', type: 'CALLOUT', content: 'RCA: Missing null check on action parameters during cycle validation. Fix: Add defensive parameter resolver and DFS guard.', attrs: { color: '#ef4444' } }
        ])
      },
      {
        name: 'Architecture Decision Record (ADR)',
        description: 'Architectural and strategic decision ledger recording context, choices, and rationale.',
        category: 'GENERAL',
        preview_text: 'Context, Options Considered, Final Decision, Rationale',
        content: JSON.stringify([
          { id: 'adr-h1', type: 'HEADING_1', content: 'Architecture Decision Record (ADR)', attrs: { level: 1 } },
          { id: 'adr-meta-p', type: 'PARAGRAPH', content: 'Status: PROPOSED / ACCEPTED | Date: YYYY-MM-DD | Decision Maker: @StaffArchitect' },
          { id: 'adr-context-h2', type: 'HEADING_2', content: '1. Context & Problem Statement', attrs: { level: 2 } },
          { id: 'adr-context-p', type: 'PARAGRAPH', content: 'Describe the technical problem, business drivers, and operational constraints that necessitate a structural decision.' },
          { id: 'adr-options-h2', type: 'HEADING_2', content: '2. Options Considered', attrs: { level: 2 } },
          { id: 'adr-options-list', type: 'BULLET_LIST', content: 'Option A: Third-party cloud service integration (High recurring cost, vendor lock-in).\nOption B: In-memory document caching (Risk of data loss on server restart).\nOption C: SQLite WAL database with FTS5 and append-only versioning (Zero external cost, full audit compliance).' },
          { id: 'adr-decision-h2', type: 'HEADING_2', content: '3. Final Decision', attrs: { level: 2 } },
          { id: 'adr-decision-callout', type: 'CALLOUT', content: 'Decision: Adopt Option C. Implement native SQLite WAL tables with FTS5 virtual tables and append-only version triggers.', attrs: { color: '#10b981' } },
          { id: 'adr-consequences-h2', type: 'HEADING_2', content: '4. Consequences & Tradeoffs', attrs: { level: 2 } },
          { id: 'adr-consequences-p', type: 'PARAGRAPH', content: 'Positive: Sub-millisecond queries, complete data ownership, tamper-evident audit history. Negative: Requires disciplined migration scripts.' }
        ])
      },
      {
        name: 'Weekly Team Status Update',
        description: 'Weekly progress synchronization covering accomplishments, in-progress work, and blockers.',
        category: 'GENERAL',
        preview_text: 'Accomplishments, In Progress, Blockers, Next Week Plan',
        content: JSON.stringify([
          { id: 'weekly-h1', type: 'HEADING_1', content: 'Weekly Team Status Update', attrs: { level: 1 } },
          { id: 'weekly-meta-p', type: 'PARAGRAPH', content: 'Week: WW-YYYY | Team: Platform Engineering | Author: @TeamLead' },
          { id: 'weekly-done-h2', type: 'HEADING_2', content: '1. Major Accomplishments (Shipped This Week)', attrs: { level: 2 } },
          { id: 'weekly-done-list', type: 'BULLET_LIST', content: 'Completed and permanently sealed PRD 26 (Workflow Automation Engine).\nAll 65 master integration test assertions passing with zero defects.\nZero regressions on core platform test suites.' },
          { id: 'weekly-wip-h2', type: 'HEADING_2', content: '2. In Progress (Active Sprints & Initiatives)', attrs: { level: 2 } },
          { id: 'weekly-wip-list', type: 'BULLET_LIST', content: 'Commencing PRD 27 (Knowledge Base & Wiki) Layer 1 schema and FTS5 search setup.\nFinalizing UI layout components for block-based editor.' },
          { id: 'weekly-blockers-h2', type: 'HEADING_2', content: '3. Blockers & Risks', attrs: { level: 2 } },
          { id: 'weekly-blockers-callout', type: 'CALLOUT', content: 'Status: No active blockers. All dependencies for PRD 27 are online and verified.', attrs: { color: '#10b981' } },
          { id: 'weekly-next-h2', type: 'HEADING_2', content: '4. Priorities for Next Week', attrs: { level: 2 } },
          { id: 'weekly-next-todo', type: 'TODO', content: 'Implement Layer 2 Space & Member REST APIs\nComplete Layer 3 Page CRUD and Versioning Engine', attrs: { checked: false } }
        ])
      }
    ];

    const checkStmt = db.prepare('SELECT id FROM wiki_templates WHERE name = ?');
    const insertStmt = db.prepare(`
      INSERT INTO wiki_templates (
        name, description, category, content, preview_text, is_system_template, created_by
      ) VALUES (?, ?, ?, ?, ?, 1, ?)
    `);

    for (const t of templates) {
      const existing = checkStmt.get(t.name);
      if (!existing) {
        insertStmt.run(
          t.name,
          t.description,
          t.category,
          t.content,
          t.preview_text,
          adminId
        );
      }
    }
  } catch (err) {
    if (!err.message.includes('no such table')) {
      console.error('[DB] Warning seeding built-in wiki templates:', err.message);
    }
  }
}

export function getDatabase() {
  if (!dbInstance) {
    fs.mkdirSync(path.dirname(config.DB_PATH), { recursive: true });
    dbInstance = new DatabaseSync(config.DB_PATH);
    dbInstance.exec('PRAGMA journal_mode = WAL;');
    dbInstance.exec('PRAGMA busy_timeout = 5000;');
    dbInstance.exec('PRAGMA foreign_keys = ON;');
    console.log('[DB] WAL mode enabled');

    // On fresh database (e.g. CI/CD test runner), load base schema first so tables exist for composite indexes
    const usersTable = dbInstance.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").get();
    if (!usersTable) {
      const schemaPath = path.join(__dirname, 'schema.sql');
      if (fs.existsSync(schemaPath)) {
        const schemaSql = fs.readFileSync(schemaPath, 'utf8');
        dbInstance.exec(schemaSql);
      }
    }

    dbInstance.exec(PIPELINE_SCHEMA_SQL);
    dbInstance.exec(POINT_POOL_SCHEMA_SQL);
    dbInstance.exec(COMPOSITE_INDEXES_SQL);
    dbInstance.exec(GITHUB_SCHEMA_SQL);
    dbInstance.exec(SPRINT_SCHEMA_SQL);
    dbInstance.exec(OKR_SCHEMA_SQL);
    dbInstance.exec(GANTT_SCHEMA_SQL);
    dbInstance.exec(WORKLOAD_SCHEMA_SQL);
    dbInstance.exec(TIME_TRACKING_SCHEMA_SQL);
    dbInstance.exec(ANALYTICS_SCHEMA_SQL);
    dbInstance.exec(CLIENT_PORTAL_SCHEMA_SQL);
    dbInstance.exec(BUDGET_FINANCIAL_SCHEMA_SQL);
    dbInstance.exec(AUTOMATION_SCHEMA_SQL);
    dbInstance.exec(WIKI_SCHEMA_SQL);

    seedBuiltInKpis(dbInstance);
    seedDefaultExpenseCategories(dbInstance);
    seedBuiltInAutomationTemplates(dbInstance);
    seedBuiltInWikiTemplates(dbInstance);
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
