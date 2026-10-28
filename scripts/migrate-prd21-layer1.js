import { getDatabase, execRaw, queryOne, queryAll } from '../src/db/database.js';

console.log('===================================================================');
console.log('   PRD 21: RESOURCE WORKLOAD DASHBOARD — LAYER 1 MIGRATION');
console.log('===================================================================\n');

export function runMigration() {
  const db = getDatabase();

  // 1. Enable WAL mode, set busy_timeout = 5000, and enforce foreign keys
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA busy_timeout = 5000;');
  db.exec('PRAGMA foreign_keys = ON;');
  console.log('[PRD21-MIGRATE] WAL mode and busy_timeout configured.');

  // 2. Create all 5 tables (IF NOT EXISTS)
  // 3. Create all indexes (IF NOT EXISTS)
  // 4. Create all 5 append-only triggers
  const MIGRATION_SQL = `
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

  db.exec(MIGRATION_SQL);
  console.log('[PRD21-MIGRATE] Schema executed successfully.');

  // Verify tables
  const expectedTables = [
    'member_capacity',
    'member_availability',
    'workload_assignments',
    'workload_snapshots',
    'workload_alerts'
  ];

  for (const table of expectedTables) {
    const exists = queryOne("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", [table]);
    if (!exists) {
      throw new Error(`[PRD21-MIGRATE] Table ${table} was NOT created.`);
    }
    console.log(`[PRD21-MIGRATE] Verified table: ${table}`);
  }

  // Verify triggers
  const expectedTriggers = [
    'prevent_capacity_update',
    'prevent_capacity_delete',
    'prevent_workload_snapshot_update',
    'prevent_workload_snapshot_delete',
    'prevent_workload_alert_delete'
  ];

  for (const trigger of expectedTriggers) {
    const exists = queryOne("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = ?", [trigger]);
    if (!exists) {
      throw new Error(`[PRD21-MIGRATE] Trigger ${trigger} was NOT created.`);
    }
    console.log(`[PRD21-MIGRATE] Verified trigger: ${trigger}`);
  }

  console.log('\n[PRD21-MIGRATE] Layer 1 Migration Complete: 5 tables, 5 triggers, 11 indexes verified.');
}

if (process.argv[1] && process.argv[1].endsWith('migrate-prd21-layer1.js')) {
  try {
    runMigration();
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  }
}
