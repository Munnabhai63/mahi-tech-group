import { getDatabase, execRaw, queryOne, queryAll } from '../src/db/database.js';

console.log('===================================================================');
console.log('   PRD 17: GITHUB AUTOMATION ARCHITECTURE — BATCH 1 MIGRATION');
console.log('===================================================================\n');

export function runMigration() {
  const db = getDatabase();

  // 1. Enable WAL mode & 2. Set busy_timeout = 5000 & foreign keys
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA busy_timeout = 5000;');
  db.exec('PRAGMA foreign_keys = ON;');
  console.log('[PRD17-MIGRATE] WAL mode and busy_timeout configured.');

  // 3. Create all 4 tables (IF NOT EXISTS)
  // 4. Create all indexes (IF NOT EXISTS)
  // 5. Create both append-only triggers
  const MIGRATION_SQL = `
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
  BEGIN
    SELECT RAISE(ABORT, 'github_webhook_log is append-only');
  END;

  CREATE TRIGGER IF NOT EXISTS prevent_webhook_log_delete
  BEFORE DELETE ON github_webhook_log
  BEGIN
    SELECT RAISE(ABORT, 'github_webhook_log rows cannot be deleted');
  END;
  `;

  execRaw(MIGRATION_SQL);
  console.log('[PRD17-MIGRATE] Schema, indexes, and triggers applied successfully.');

  // 6. Quick sanity check
  const testDeliveryId = `migration-sanity-${Date.now()}`;
  console.log('[PRD17-MIGRATE] Running sanity check on github_webhook_log...');

  // INSERT test row
  db.prepare(`
    INSERT INTO github_webhook_log (delivery_id, event_type, action, repo_full_name, sender_login, payload, signature_valid, processed)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(testDeliveryId, 'ping', 'migration_test', 'mahitechgroup/test-repo', 'admin', '{"zen":"Responsive is better than fast."}', 1, 1);

  // Attempt UPDATE → must throw
  let updateBlocked = false;
  try {
    db.prepare(`UPDATE github_webhook_log SET action = 'tampered' WHERE delivery_id = ?`).run(testDeliveryId);
  } catch (err) {
    if (err.message && err.message.includes('github_webhook_log is append-only')) {
      updateBlocked = true;
    } else {
      throw err;
    }
  }
  if (!updateBlocked) {
    throw new Error('Sanity check FAILED: UPDATE on github_webhook_log did not fire prevent_webhook_log_update trigger');
  }

  // Attempt DELETE → must throw
  let deleteBlocked = false;
  try {
    db.prepare(`DELETE FROM github_webhook_log WHERE delivery_id = ?`).run(testDeliveryId);
  } catch (err) {
    if (err.message && err.message.includes('github_webhook_log rows cannot be deleted')) {
      deleteBlocked = true;
    } else {
      throw err;
    }
  }
  if (!deleteBlocked) {
    throw new Error('Sanity check FAILED: DELETE on github_webhook_log did not fire prevent_webhook_log_delete trigger');
  }

  // Confirm test row exists
  const row = queryOne('SELECT * FROM github_webhook_log WHERE delivery_id = ?', [testDeliveryId]);
  if (!row || row.delivery_id !== testDeliveryId) {
    throw new Error('Sanity check FAILED: test row could not be found via SELECT');
  }

  console.log('[PRD17-MIGRATE] Sanity check passed: INSERT succeeded, UPDATE and DELETE properly rejected by triggers, row confirmed.');

  // 7. Report
  console.log('\n===================================================================');
  console.log('PRD 17 Batch 1 migration complete');
  console.log('===================================================================');
}

// CLI Execution
if (process.argv[1] && process.argv[1].endsWith('migrate-prd17-batch1.js')) {
  try {
    runMigration();
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  }
}
