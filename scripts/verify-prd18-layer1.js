/**
 * PRD 18 — Layer 1 Verification Suite: Database, Migrations & Append-Only Triggers
 * 
 * Verifies:
 * 1. All 5 tables exist:
 *    - sprints
 *    - backlog_items
 *    - sprint_velocity_log
 *    - backlog_item_history
 *    - sprint_members
 * 2. All 4 append-only triggers exist:
 *    - prevent_velocity_log_update
 *    - prevent_velocity_log_delete
 *    - prevent_item_history_update
 *    - prevent_item_history_delete
 * 3. Append-only enforcement tests with real DB queries:
 *    - prevent_velocity_log_update blocks UPDATE
 *    - prevent_velocity_log_delete blocks DELETE
 *    - prevent_item_history_update blocks UPDATE
 *    - prevent_item_history_delete blocks DELETE
 */

import { getDatabase, queryAll, queryOne, execute } from '../src/db/database.js';
import { runMigration } from '../src/db/migrate.js';

console.log('===================================================================');
console.log('  PRD 18 — LAYER 1 DATABASE, MIGRATION & TRIGGER VERIFICATION');
console.log('===================================================================');

// Run migration first to verify migration works without errors
runMigration();

const db = getDatabase();

let passedCount = 0;
let totalCount = 0;

function assertTest(condition, testName, reason) {
  totalCount++;
  if (condition) {
    console.log(`  ✅ PASS: [${testName}] - ${reason}`);
    passedCount++;
  } else {
    console.error(`  ❌ FAIL: [${testName}] - ${reason}`);
  }
}

// -------------------------------------------------------------------
// 1. Verify all 5 tables exist in sqlite_master
// -------------------------------------------------------------------
console.log('\n--- 1. VERIFYING 5 PRD 18 TABLES ---');
const expectedTables = [
  'sprints',
  'backlog_items',
  'sprint_velocity_log',
  'backlog_item_history',
  'sprint_members'
];

for (const tableName of expectedTables) {
  const row = queryOne("SELECT name FROM sqlite_master WHERE type='table' AND name = ?", [tableName]);
  const exists = !!row;
  const cols = exists ? queryAll(`PRAGMA table_info(${tableName});`) : [];
  assertTest(
    exists && cols.length > 0,
    `Table Existence: ${tableName}`,
    exists ? `Table exists with ${cols.length} columns: ${cols.map(c => `${c.name} (${c.type})`).join(', ')}` : 'Table not found in sqlite_master'
  );
}

// -------------------------------------------------------------------
// 2. Verify all 4 triggers exist in sqlite_master
// -------------------------------------------------------------------
console.log('\n--- 2. VERIFYING 4 APPEND-ONLY TRIGGERS ---');
const expectedTriggers = [
  { name: 'prevent_velocity_log_update', table: 'sprint_velocity_log' },
  { name: 'prevent_velocity_log_delete', table: 'sprint_velocity_log' },
  { name: 'prevent_item_history_update', table: 'backlog_item_history' },
  { name: 'prevent_item_history_delete', table: 'backlog_item_history' }
];

for (const trig of expectedTriggers) {
  const row = queryOne(
    "SELECT name, tbl_name FROM sqlite_master WHERE type='trigger' AND name = ? AND tbl_name = ?",
    [trig.name, trig.table]
  );
  assertTest(
    !!row,
    `Trigger Existence: ${trig.name}`,
    row ? `Trigger exists on table '${trig.table}'` : `Trigger '${trig.name}' missing on table '${trig.table}'`
  );
}

// -------------------------------------------------------------------
// 3. Test Append-Only Enforcement for sprint_velocity_log
// -------------------------------------------------------------------
console.log('\n--- 3. TESTING APPEND-ONLY ENFORCEMENT ON sprint_velocity_log ---');

// Need a valid user and project for foreign keys
let user = queryOne("SELECT id FROM users LIMIT 1;");
let project = queryOne("SELECT id FROM projects LIMIT 1;");

if (!user) {
  user = { id: 'test_user_prd18' };
  execute("INSERT INTO users (id, name, email, password_hash, role) VALUES (?, 'Test User', 'test18@example.com', 'hash', 'admin')", [user.id]);
}

if (!project) {
  project = { id: 'test_proj_prd18' };
  execute("INSERT INTO projects (id, title, description, owner_id) VALUES (?, 'Test Project 18', 'Desc', ?)", [project.id, user.id]);
}

// Create a test sprint
const sprintInsert = execute(
  "INSERT INTO sprints (project_id, name, goal, status, created_by) VALUES (?, 'Test Sprint 18', 'Test Goal', 'ACTIVE', ?)",
  [project.id, user.id]
);
const testSprintId = Number(sprintInsert.lastInsertRowid);

// Insert a row into sprint_velocity_log
const velocityInsert = execute(
  "INSERT INTO sprint_velocity_log (sprint_id, project_id, total_points_committed, total_points_completed, completion_rate) VALUES (?, ?, 20, 20, 100.0)",
  [testSprintId, project.id]
);
const testVelocityLogId = Number(velocityInsert.lastInsertRowid);

// 3a. Attempt UPDATE on sprint_velocity_log
let velocityUpdateBlocked = false;
let velocityUpdateError = '';
try {
  execute(
    "UPDATE sprint_velocity_log SET total_points_completed = 50 WHERE id = ?",
    [testVelocityLogId]
  );
} catch (err) {
  velocityUpdateBlocked = true;
  velocityUpdateError = err.message;
}

assertTest(
  velocityUpdateBlocked && velocityUpdateError.includes('sprint_velocity_log is append-only'),
  'Trigger prevent_velocity_log_update',
  velocityUpdateBlocked
    ? `UPDATE blocked with error: "${velocityUpdateError}"`
    : 'UPDATE was allowed (Trigger failed to abort)'
);

// 3b. Attempt DELETE on sprint_velocity_log
let velocityDeleteBlocked = false;
let velocityDeleteError = '';
try {
  execute(
    "DELETE FROM sprint_velocity_log WHERE id = ?",
    [testVelocityLogId]
  );
} catch (err) {
  velocityDeleteBlocked = true;
  velocityDeleteError = err.message;
}

assertTest(
  velocityDeleteBlocked && velocityDeleteError.includes('sprint_velocity_log is append-only'),
  'Trigger prevent_velocity_log_delete',
  velocityDeleteBlocked
    ? `DELETE blocked with error: "${velocityDeleteError}"`
    : 'DELETE was allowed (Trigger failed to abort)'
);

// -------------------------------------------------------------------
// 4. Test Append-Only Enforcement for backlog_item_history
// -------------------------------------------------------------------
console.log('\n--- 4. TESTING APPEND-ONLY ENFORCEMENT ON backlog_item_history ---');

// Create a test backlog item
const itemInsert = execute(
  "INSERT INTO backlog_items (project_id, sprint_id, title, description, type, priority, story_points, status, created_by) VALUES (?, ?, 'Test Story', 'Desc', 'STORY', 'HIGH', 5, 'TODO', ?)",
  [project.id, testSprintId, user.id]
);
const testItemId = Number(itemInsert.lastInsertRowid);

// Insert a row into backlog_item_history
const historyInsert = execute(
  "INSERT INTO backlog_item_history (item_id, changed_by, field_changed, old_value, new_value) VALUES (?, ?, 'status', 'TODO', 'IN_PROGRESS')",
  [testItemId, user.id]
);
const testHistoryId = Number(historyInsert.lastInsertRowid);

// 4a. Attempt UPDATE on backlog_item_history
let historyUpdateBlocked = false;
let historyUpdateError = '';
try {
  execute(
    "UPDATE backlog_item_history SET new_value = 'TAMPERED' WHERE id = ?",
    [testHistoryId]
  );
} catch (err) {
  historyUpdateBlocked = true;
  historyUpdateError = err.message;
}

assertTest(
  historyUpdateBlocked && historyUpdateError.includes('backlog_item_history is append-only'),
  'Trigger prevent_item_history_update',
  historyUpdateBlocked
    ? `UPDATE blocked with error: "${historyUpdateError}"`
    : 'UPDATE was allowed (Trigger failed to abort)'
);

// 4b. Attempt DELETE on backlog_item_history
let historyDeleteBlocked = false;
let historyDeleteError = '';
try {
  execute(
    "DELETE FROM backlog_item_history WHERE id = ?",
    [testHistoryId]
  );
} catch (err) {
  historyDeleteBlocked = true;
  historyDeleteError = err.message;
}

assertTest(
  historyDeleteBlocked && historyDeleteError.includes('backlog_item_history is append-only'),
  'Trigger prevent_item_history_delete',
  historyDeleteBlocked
    ? `DELETE blocked with error: "${historyDeleteError}"`
    : 'DELETE was allowed (Trigger failed to abort)'
);

// -------------------------------------------------------------------
// Final Summary
// -------------------------------------------------------------------
console.log('\n===================================================================');
console.log(`  PRD 18 — LAYER 1 VERIFICATION SUMMARY: ${passedCount} / ${totalCount} TESTS PASSED`);
console.log('===================================================================');

if (passedCount === totalCount) {
  console.log('>>> ALL LAYER 1 TESTS PASSED SUCCESSFULLY! ✅\n');
  process.exit(0);
} else {
  console.error(`>>> ${totalCount - passedCount} TESTS FAILED! ❌\n`);
  process.exit(1);
}
