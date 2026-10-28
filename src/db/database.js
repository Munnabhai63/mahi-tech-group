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

    seedBuiltInKpis(dbInstance);
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
