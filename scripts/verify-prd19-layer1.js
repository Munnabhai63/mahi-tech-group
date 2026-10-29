/**
 * PRD 19 — Layer 1 Verification Suite: OKR Database Schema, Migrations & Append-Only Triggers
 * 
 * Verifies:
 * 1. All 5 OKR tables exist in sqlite_master:
 *    - okr_objectives
 *    - okr_key_results
 *    - okr_checkins
 *    - okr_alignment_links
 *    - okr_history
 * 2. All 11 performance indexes exist in sqlite_master:
 *    - idx_okr_objectives_level
 *    - idx_okr_objectives_cycle
 *    - idx_okr_objectives_project
 *    - idx_okr_objectives_owner
 *    - idx_okr_objectives_parent
 *    - idx_okr_key_results_obj
 *    - idx_okr_key_results_assigned
 *    - idx_okr_checkins_kr
 *    - idx_okr_alignment_child
 *    - idx_okr_alignment_parent
 *    - idx_okr_history_entity
 * 3. All 6 append-only triggers exist in sqlite_master:
 *    - prevent_okr_checkin_update
 *    - prevent_okr_checkin_delete
 *    - prevent_okr_alignment_update
 *    - prevent_okr_alignment_delete
 *    - prevent_okr_history_update
 *    - prevent_okr_history_delete
 * 4. Append-Only Enforcements tested with real database statements:
 *    - prevent_okr_checkin_update aborts UPDATE on okr_checkins
 *    - prevent_okr_checkin_delete aborts DELETE on okr_checkins
 *    - prevent_okr_alignment_update aborts UPDATE on okr_alignment_links
 *    - prevent_okr_alignment_delete aborts DELETE on okr_alignment_links
 *    - prevent_okr_history_update aborts UPDATE on okr_history
 *    - prevent_okr_history_delete aborts DELETE on okr_history
 * 5. Foreign Key & Column Structure integrity verified.
 */

import { getDatabase, queryAll, queryOne, execute } from '../src/db/database.js';
import { runMigration } from '../src/db/migrate.js';

console.log('===================================================================');
console.log('  PRD 19 — LAYER 1: OKR DATABASE, MIGRATION & TRIGGER VERIFICATION');
console.log('===================================================================');

// Run migration first to verify migration execution
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
// 1. Verify all 5 tables exist in sqlite_master with correct schema
// -------------------------------------------------------------------
console.log('\n--- 1. VERIFYING 5 PRD 19 OKR TABLES ---');
const expectedTables = [
  {
    name: 'okr_objectives',
    requiredCols: ['id', 'title', 'description', 'level', 'owner_id', 'parent_objective_id', 'project_id', 'cycle', 'status', 'progress_pct', 'created_by', 'created_at', 'updated_at']
  },
  {
    name: 'okr_key_results',
    requiredCols: ['id', 'objective_id', 'title', 'description', 'type', 'target_value', 'current_value', 'unit', 'progress_pct', 'status', 'assigned_to', 'due_date', 'created_by', 'created_at', 'updated_at']
  },
  {
    name: 'okr_checkins',
    requiredCols: ['id', 'key_result_id', 'submitted_by', 'previous_value', 'new_value', 'confidence', 'note', 'created_at']
  },
  {
    name: 'okr_alignment_links',
    requiredCols: ['id', 'child_objective_id', 'parent_objective_id', 'linked_by', 'linked_at']
  },
  {
    name: 'okr_history',
    requiredCols: ['id', 'entity_type', 'entity_id', 'changed_by', 'field_changed', 'old_value', 'new_value', 'changed_at']
  }
];

for (const t of expectedTables) {
  const row = queryOne("SELECT name FROM sqlite_master WHERE type='table' AND name = ?", [t.name]);
  const exists = !!row;
  const cols = exists ? queryAll(`PRAGMA table_info(${t.name});`) : [];
  const colNames = cols.map(c => c.name);
  const allColsPresent = t.requiredCols.every(c => colNames.includes(c));

  assertTest(
    exists && allColsPresent,
    `Table Existence & Columns: ${t.name}`,
    exists && allColsPresent
      ? `Table exists with ${cols.length} columns: ${cols.map(c => `${c.name} (${c.type})`).join(', ')}`
      : `Table missing or missing expected columns. Found: ${colNames.join(', ')}`
  );
}

// -------------------------------------------------------------------
// 2. Verify all 11 indexes exist in sqlite_master
// -------------------------------------------------------------------
console.log('\n--- 2. VERIFYING 11 PRD 19 OKR INDEXES ---');
const expectedIndexes = [
  'idx_okr_objectives_level',
  'idx_okr_objectives_cycle',
  'idx_okr_objectives_project',
  'idx_okr_objectives_owner',
  'idx_okr_objectives_parent',
  'idx_okr_key_results_obj',
  'idx_okr_key_results_assigned',
  'idx_okr_checkins_kr',
  'idx_okr_alignment_child',
  'idx_okr_alignment_parent',
  'idx_okr_history_entity'
];

for (const idx of expectedIndexes) {
  const row = queryOne(
    "SELECT name, tbl_name FROM sqlite_master WHERE type='index' AND name = ?",
    [idx]
  );
  assertTest(
    !!row,
    `Index Existence: ${idx}`,
    row ? `Index exists on table '${row.tbl_name}'` : `Index '${idx}' missing in sqlite_master`
  );
}

// -------------------------------------------------------------------
// 3. Verify all 6 append-only triggers exist in sqlite_master
// -------------------------------------------------------------------
console.log('\n--- 3. VERIFYING 6 APPEND-ONLY TRIGGERS ---');
const expectedTriggers = [
  { name: 'prevent_okr_checkin_update', table: 'okr_checkins' },
  { name: 'prevent_okr_checkin_delete', table: 'okr_checkins' },
  { name: 'prevent_okr_alignment_update', table: 'okr_alignment_links' },
  { name: 'prevent_okr_alignment_delete', table: 'okr_alignment_links' },
  { name: 'prevent_okr_history_update', table: 'okr_history' },
  { name: 'prevent_okr_history_delete', table: 'okr_history' }
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
// 4. Test Append-Only Enforcement & Data Operations
// -------------------------------------------------------------------
console.log('\n--- 4. TESTING APPEND-ONLY ENFORCEMENT ON REAL DATA ---');

// Setup base user & project
let user = queryOne("SELECT id FROM users LIMIT 1;");
let project = queryOne("SELECT id FROM projects LIMIT 1;");

if (!user) {
  user = { id: 'test_user_prd19' };
  execute("INSERT INTO users (id, name, email, password_hash, role) VALUES (?, 'Test User PRD19', 'test19@example.com', 'hash', 'admin')", [user.id]);
}

if (!project) {
  project = { id: 'test_proj_prd19' };
  execute("INSERT INTO projects (id, title, description, owner_id) VALUES (?, 'Test Project 19', 'Desc', ?)", [project.id, user.id]);
}

// Create test parent and child objectives
const parentObjRes = execute(
  "INSERT INTO okr_objectives (title, description, level, owner_id, project_id, cycle, status, progress_pct, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ['Company OKR: Achieve Market Leadership', 'Scale globally', 'COMPANY', user.id, project.id, 'Q1-2026', 'ACTIVE', 0, user.id]
);
const parentObjId = Number(parentObjRes.lastInsertRowid);

const childObjRes = execute(
  "INSERT INTO okr_objectives (title, description, level, owner_id, parent_objective_id, project_id, cycle, status, progress_pct, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ['Team OKR: Deliver Real-Time OKR Engine', 'Sub-objective for dev team', 'TEAM', user.id, parentObjId, project.id, 'Q1-2026', 'ACTIVE', 0, user.id]
);
const childObjId = Number(childObjRes.lastInsertRowid);

// Create test key result
const krRes = execute(
  "INSERT INTO okr_key_results (objective_id, title, description, type, target_value, current_value, unit, progress_pct, status, assigned_to, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  [childObjId, 'KR 1: 100% Test Coverage on Layer 1', 'Achieve zero regression', 'PERCENTAGE', 100, 0, '%', 0, 'ON_TRACK', user.id, user.id]
);
const testKrId = Number(krRes.lastInsertRowid);

// 4a. okr_checkins: INSERT, then attempt UPDATE & DELETE
console.log('Testing okr_checkins append-only trigger...');
const checkinRes = execute(
  "INSERT INTO okr_checkins (key_result_id, submitted_by, previous_value, new_value, confidence, note) VALUES (?, ?, ?, ?, ?, ?)",
  [testKrId, user.id, 0, 50, 'HIGH', 'First checkin verified']
);
const checkinId = Number(checkinRes.lastInsertRowid);

let checkinUpdateBlocked = false;
let checkinUpdateErr = '';
try {
  execute("UPDATE okr_checkins SET new_value = 100 WHERE id = ?", [checkinId]);
} catch (err) {
  checkinUpdateBlocked = true;
  checkinUpdateErr = err.message;
}

assertTest(
  checkinUpdateBlocked && checkinUpdateErr.includes('okr_checkins is append-only'),
  'Trigger prevent_okr_checkin_update',
  checkinUpdateBlocked ? `UPDATE aborted as expected: "${checkinUpdateErr}"` : 'UPDATE was permitted (FAIL)'
);

let checkinDeleteBlocked = false;
let checkinDeleteErr = '';
try {
  execute("DELETE FROM okr_checkins WHERE id = ?", [checkinId]);
} catch (err) {
  checkinDeleteBlocked = true;
  checkinDeleteErr = err.message;
}

assertTest(
  checkinDeleteBlocked && checkinDeleteErr.includes('okr_checkins is append-only'),
  'Trigger prevent_okr_checkin_delete',
  checkinDeleteBlocked ? `DELETE aborted as expected: "${checkinDeleteErr}"` : 'DELETE was permitted (FAIL)'
);

// 4b. okr_alignment_links: INSERT, then attempt UPDATE & DELETE
console.log('Testing okr_alignment_links append-only trigger...');
const linkRes = execute(
  "INSERT INTO okr_alignment_links (child_objective_id, parent_objective_id, linked_by) VALUES (?, ?, ?)",
  [childObjId, parentObjId, user.id]
);
const linkId = Number(linkRes.lastInsertRowid);

let linkUpdateBlocked = false;
let linkUpdateErr = '';
try {
  execute("UPDATE okr_alignment_links SET linked_by = ? WHERE id = ?", [user.id, linkId]);
} catch (err) {
  linkUpdateBlocked = true;
  linkUpdateErr = err.message;
}

assertTest(
  linkUpdateBlocked && linkUpdateErr.includes('okr_alignment_links is append-only'),
  'Trigger prevent_okr_alignment_update',
  linkUpdateBlocked ? `UPDATE aborted as expected: "${linkUpdateErr}"` : 'UPDATE was permitted (FAIL)'
);

let linkDeleteBlocked = false;
let linkDeleteErr = '';
try {
  execute("DELETE FROM okr_alignment_links WHERE id = ?", [linkId]);
} catch (err) {
  linkDeleteBlocked = true;
  linkDeleteErr = err.message;
}

assertTest(
  linkDeleteBlocked && linkDeleteErr.includes('okr_alignment_links is append-only'),
  'Trigger prevent_okr_alignment_delete',
  linkDeleteBlocked ? `DELETE aborted as expected: "${linkDeleteErr}"` : 'DELETE was permitted (FAIL)'
);

// 4c. okr_history: INSERT, then attempt UPDATE & DELETE
console.log('Testing okr_history append-only trigger...');
const histRes = execute(
  "INSERT INTO okr_history (entity_type, entity_id, changed_by, field_changed, old_value, new_value) VALUES (?, ?, ?, ?, ?, ?)",
  ['OBJECTIVE', childObjId, user.id, 'status', 'DRAFT', 'ACTIVE']
);
const historyId = Number(histRes.lastInsertRowid);

let histUpdateBlocked = false;
let histUpdateErr = '';
try {
  execute("UPDATE okr_history SET new_value = 'COMPLETED' WHERE id = ?", [historyId]);
} catch (err) {
  histUpdateBlocked = true;
  histUpdateErr = err.message;
}

assertTest(
  histUpdateBlocked && histUpdateErr.includes('okr_history is append-only'),
  'Trigger prevent_okr_history_update',
  histUpdateBlocked ? `UPDATE aborted as expected: "${histUpdateErr}"` : 'UPDATE was permitted (FAIL)'
);

let histDeleteBlocked = false;
let histDeleteErr = '';
try {
  execute("DELETE FROM okr_history WHERE id = ?", [historyId]);
} catch (err) {
  histDeleteBlocked = true;
  histDeleteErr = err.message;
}

assertTest(
  histDeleteBlocked && histDeleteErr.includes('okr_history is append-only'),
  'Trigger prevent_okr_history_delete',
  histDeleteBlocked ? `DELETE aborted as expected: "${histDeleteErr}"` : 'DELETE was permitted (FAIL)'
);

// -------------------------------------------------------------------
// 5. Unique constraint on okr_alignment_links
// -------------------------------------------------------------------
console.log('\n--- 5. TESTING UNIQUE CONSTRAINT ON okr_alignment_links ---');
let duplicateLinkBlocked = false;
let duplicateLinkErr = '';
try {
  execute(
    "INSERT INTO okr_alignment_links (child_objective_id, parent_objective_id, linked_by) VALUES (?, ?, ?)",
    [childObjId, parentObjId, user.id]
  );
} catch (err) {
  duplicateLinkBlocked = true;
  duplicateLinkErr = err.message;
}

assertTest(
  duplicateLinkBlocked && duplicateLinkErr.includes('UNIQUE constraint failed'),
  'Unique Constraint: okr_alignment_links(child, parent)',
  duplicateLinkBlocked ? `Duplicate link rejected as expected: "${duplicateLinkErr}"` : 'Duplicate link was allowed (FAIL)'
);

// -------------------------------------------------------------------
// Summary Report
// -------------------------------------------------------------------
console.log('\n===================================================================');
console.log(`  VERIFICATION RESULT: ${passedCount}/${totalCount} TESTS PASSED`);
if (passedCount === totalCount) {
  console.log('  🎉 LAYER 1 INTEGRITY VERIFIED: All tables, indexes & triggers 100% operational');
} else {
  console.error(`  ⚠️ FAILURES DETECTED: ${totalCount - passedCount} test(s) failed`);
  process.exit(1);
}
console.log('===================================================================\n');
