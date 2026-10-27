import { getDatabase, queryAll, queryOne, execute } from '../src/db/database.js';

console.log('===================================================================');
console.log('  PRD 15 — LAYER 1 DATABASE & SCHEMA VERIFICATION');
console.log('===================================================================');

const db = getDatabase();

// 1. Verify WAL mode
const journalMode = queryOne('PRAGMA journal_mode;').journal_mode;
console.log(`[1] Journal Mode: ${journalMode} (Expected: wal)`);
if (journalMode.toLowerCase() !== 'wal') {
  console.error('FAIL: Journal mode is not WAL!');
  process.exit(1);
}

// 2. Verify all 4 tables exist
const expectedTables = [
  'pipeline_deliverables',
  'pipeline_checklist_points',
  'pipeline_stage_handoffs',
  'pipeline_addendum_requests'
];

console.log('\n[2] Checking 4 Pipeline Tables:');
for (const table of expectedTables) {
  const row = queryOne("SELECT name FROM sqlite_master WHERE type='table' AND name = ?", [table]);
  if (!row) {
    console.error(`FAIL: Table ${table} does NOT exist!`);
    process.exit(1);
  }
  const columns = queryAll(`PRAGMA table_info(${table});`);
  console.log(`  ✓ Table '${table}' exists with ${columns.length} columns:`);
  console.log('    ' + columns.map(c => `${c.name} (${c.type})`).join(', '));
}

// 3. Verify Triggers exist
console.log('\n[3] Checking Append-Only Triggers:');
const triggers = queryAll("SELECT name, tbl_name FROM sqlite_master WHERE type='trigger' AND tbl_name = 'pipeline_stage_handoffs';");
const triggerNames = triggers.map(t => t.name);
console.log('  Found triggers:', triggerNames.join(', '));

if (!triggerNames.includes('prevent_handoff_update') || !triggerNames.includes('prevent_handoff_delete')) {
  console.error('FAIL: Missing required append-only triggers on pipeline_stage_handoffs!');
  process.exit(1);
}
console.log('  ✓ Both prevent_handoff_update and prevent_handoff_delete exist.');

// 4. Verify Append-Only Behavior with real test insertion, update attempt, and delete attempt
console.log('\n[4] Testing Append-Only Trigger Enforcement:');

// Ensure a user and a deliverable exist for foreign key
let user = queryOne("SELECT id FROM users LIMIT 1;");
let project = queryOne("SELECT id FROM projects LIMIT 1;");

if (!user || !project) {
  console.log('  Notice: Seeding minimal records for trigger test');
}

const testDelivId = 'deliv_test_' + Date.now();
const testHandoffId = 'handoff_test_' + Date.now();

// Insert dummy deliverable if needed
execute(`
  INSERT INTO pipeline_deliverables (id, project_id, title, description, current_stage, status, created_by)
  VALUES (?, ?, 'Trigger Test Deliverable', 'Testing triggers', 'RESEARCH', 'ACTIVE', ?)
`, [testDelivId, project.id, user.id]);

// Insert dummy handoff record
execute(`
  INSERT INTO pipeline_stage_handoffs (id, deliverable_id, from_stage, to_stage, stage_completion_pct, handoff_notes, approved_by, snapshot_json)
  VALUES (?, ?, 'RESEARCH', 'DESIGN', 100.00, 'Test Handoff', ?, '{"test":true}')
`, [testHandoffId, testDelivId, user.id]);
console.log('  ✓ Successfully inserted test handoff record into pipeline_stage_handoffs.');

// Test UPDATE prevention
let updateBlocked = false;
try {
  execute(`UPDATE pipeline_stage_handoffs SET handoff_notes = 'Modified Notes' WHERE id = ?`, [testHandoffId]);
} catch (err) {
  if (err.message && err.message.includes('append-only')) {
    updateBlocked = true;
    console.log(`  ✓ UPDATE blocked as expected: "${err.message}"`);
  } else {
    console.error('  Unexpected error on UPDATE:', err);
  }
}
if (!updateBlocked) {
  console.error('FAIL: UPDATE was not blocked by prevent_handoff_update trigger!');
  process.exit(1);
}

// Test DELETE prevention
let deleteBlocked = false;
try {
  execute(`DELETE FROM pipeline_stage_handoffs WHERE id = ?`, [testHandoffId]);
} catch (err) {
  if (err.message && err.message.includes('append-only')) {
    deleteBlocked = true;
    console.log(`  ✓ DELETE blocked as expected: "${err.message}"`);
  } else {
    console.error('  Unexpected error on DELETE:', err);
  }
}
if (!deleteBlocked) {
  console.error('FAIL: DELETE was not blocked by prevent_handoff_delete trigger!');
  process.exit(1);
}

// 5. Verify checklist points weight check constraint (1-10)
console.log('\n[5] Testing Checklist Point Weight Constraints:');
let invalidWeightBlocked = false;
try {
  execute(`
    INSERT INTO pipeline_checklist_points (id, deliverable_id, stage, point_title, weight, created_by)
    VALUES ('chk_invalid', ?, 'RESEARCH', 'Invalid Weight', 15, ?)
  `, [testDelivId, user.id]);
} catch (err) {
  if (err.message && (err.message.includes('CHECK') || err.message.includes('constraint'))) {
    invalidWeightBlocked = true;
    console.log(`  ✓ Weight > 10 blocked as expected: "${err.message}"`);
  }
}
if (!invalidWeightBlocked) {
  console.error('FAIL: Weight CHECK constraint did not block weight 15!');
  process.exit(1);
}

console.log('\n===================================================================');
console.log('  LAYER 1 VERIFICATION COMPLETE — 100% PASS');
console.log('===================================================================');
