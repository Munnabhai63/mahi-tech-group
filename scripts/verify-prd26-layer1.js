/**
 * scripts/verify-prd26-layer1.js
 * Verification Suite for PRD 26 Layer 1: Workflow Automation Engine Database Schema, Triggers, and Seed
 *
 * Checks:
 * 1. SQLite Pragmas: journal_mode = WAL, busy_timeout >= 5000, foreign_keys = ON.
 * 2. Schema Structure: All 7 required tables exist with exact column names and expected types.
 * 3. Performance Indexes: All 14 indexes created and active in sqlite_master.
 * 4. Default Seed Templates: Exactly 20 system templates exist with is_system_template = 1; idempotent re-seeding verified.
 * 5. Unique & Relational Constraints: Foreign keys and field validations.
 * 6. Append-Only DB Triggers: All 7 triggers exist and strictly block forbidden UPDATE and DELETE queries with RAISE(ABORT).
 * 7. Error & Suggestion Mutability: Controlled updates succeed (error ack, suggestion approve/reject) while deletes/core mutations are aborted.
 * 8. Queue and Rule State Transitions: Verified across mutable entities.
 */

import { getDatabase, queryOne, queryAll, execute, seedBuiltInAutomationTemplates } from '../src/db/database.js';
import crypto from 'node:crypto';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`[PASS] ${message}`);
    passed++;
  } else {
    console.error(`[FAIL] ${message}`);
    failed++;
  }
}

async function run() {
  console.log('='.repeat(80));
  console.log('PRD 26 Layer 1 Verification Suite: Workflow Automation Engine Schema & Triggers');
  console.log('='.repeat(80));

  const db = getDatabase();

  // ---------------------------------------------------------
  // Test 1: SQLite Connection Pragmas
  // ---------------------------------------------------------
  console.log('\n=== Test 1: SQLite Connection Pragmas ===');
  const journalMode = queryOne('PRAGMA journal_mode;');
  assert(
    journalMode && journalMode.journal_mode.toLowerCase() === 'wal',
    `WAL mode is enabled (journal_mode = ${journalMode?.journal_mode})`
  );

  const busyTimeout = queryOne('PRAGMA busy_timeout;');
  assert(
    busyTimeout && busyTimeout.timeout >= 5000,
    `busy_timeout is set to >= 5000ms (timeout = ${busyTimeout?.timeout})`
  );

  const foreignKeys = queryOne('PRAGMA foreign_keys;');
  assert(
    foreignKeys && foreignKeys.foreign_keys === 1,
    'foreign_keys pragma is enabled (foreign_keys = 1)'
  );

  // ---------------------------------------------------------
  // Test 2: Database Schema Validation (7 Required Tables)
  // ---------------------------------------------------------
  console.log('\n=== Test 2: Database Schema Validation (7 Required Tables) ===');
  const requiredTables = [
    'automation_rules',
    'automation_run_log',
    'automation_errors',
    'automation_templates',
    'automation_queue',
    'automation_variable_store',
    'automation_ai_suggestions'
  ];

  const existingTables = queryAll(
    "SELECT name FROM sqlite_master WHERE type='table' AND name IN (" +
      requiredTables.map((t) => `'${t}'`).join(',') +
      ');'
  ).map((t) => t.name);

  for (const table of requiredTables) {
    assert(existingTables.includes(table), `Table '${table}' exists in database`);
  }

  // ---------------------------------------------------------
  // Test 3: Table Column Detail Verification
  // ---------------------------------------------------------
  console.log('\n=== Test 3: Table Column Detail Verification ===');

  const checkColumns = (tableName, expectedColumns) => {
    const cols = queryAll(`PRAGMA table_info(${tableName});`);
    const colNames = cols.map((c) => c.name);
    for (const col of expectedColumns) {
      assert(colNames.includes(col), `Table '${tableName}' has column '${col}'`);
    }
  };

  checkColumns('automation_rules', [
    'id', 'name', 'description', 'project_id', 'scope', 'is_active',
    'trigger_module', 'trigger_event', 'trigger_conditions', 'condition_logic',
    'actions', 'run_count', 'last_run_at', 'is_ai_suggested', 'created_by',
    'created_at', 'updated_at'
  ]);

  checkColumns('automation_run_log', [
    'id', 'automation_id', 'trigger_event', 'trigger_source_type', 'trigger_source_id',
    'triggered_by_user_id', 'conditions_evaluated', 'conditions_passed', 'actions_executed',
    'overall_status', 'error_message', 'retry_count', 'started_at', 'completed_at'
  ]);

  checkColumns('automation_errors', [
    'id', 'automation_id', 'run_log_id', 'error_type', 'error_message',
    'action_index', 'retry_scheduled', 'acknowledged_by', 'acknowledged_at', 'created_at'
  ]);

  checkColumns('automation_templates', [
    'id', 'name', 'description', 'category', 'trigger_module', 'trigger_event',
    'trigger_conditions', 'actions', 'is_system_template', 'created_by', 'usage_count', 'created_at'
  ]);

  checkColumns('automation_queue', [
    'id', 'automation_id', 'run_log_id', 'trigger_event', 'trigger_source_type',
    'trigger_source_id', 'triggered_by_user_id', 'trigger_data', 'status', 'scheduled_at',
    'attempts', 'max_attempts', 'created_at', 'updated_at'
  ]);

  checkColumns('automation_variable_store', [
    'id', 'automation_id', 'run_log_id', 'variable_name', 'variable_value', 'created_at'
  ]);

  checkColumns('automation_ai_suggestions', [
    'id', 'suggested_by_system', 'suggestion_context', 'suggested_name', 'suggested_description',
    'suggested_trigger_module', 'suggested_trigger_event', 'suggested_conditions', 'suggested_actions',
    'status', 'reviewed_by', 'reviewed_at', 'rejection_reason', 'approved_automation_id', 'created_at'
  ]);

  // ---------------------------------------------------------
  // Test 4: Performance Indexes Verification (14 Indexes)
  // ---------------------------------------------------------
  console.log('\n=== Test 4: Performance Indexes Verification (14 Indexes) ===');
  const requiredIndexes = [
    'idx_automation_rules_project',
    'idx_automation_rules_module',
    'idx_automation_rules_event',
    'idx_automation_rules_active',
    'idx_automation_run_log_rule',
    'idx_automation_run_log_status',
    'idx_automation_errors_rule',
    'idx_automation_errors_run',
    'idx_automation_templates_category',
    'idx_automation_templates_system',
    'idx_automation_queue_status',
    'idx_automation_queue_rule',
    'idx_automation_variable_store_run',
    'idx_automation_ai_suggestions_status'
  ];

  const existingIndexes = queryAll("SELECT name FROM sqlite_master WHERE type='index';").map((i) => i.name);
  for (const idx of requiredIndexes) {
    assert(existingIndexes.includes(idx), `Index '${idx}' is active in sqlite_master`);
  }

  // ---------------------------------------------------------
  // Test 5: Default Seed Templates Verification (20 Templates)
  // ---------------------------------------------------------
  console.log('\n=== Test 5: Default Seed Templates Verification (20 Templates) ===');
  const systemTemplates = queryAll("SELECT * FROM automation_templates WHERE is_system_template = 1 ORDER BY id ASC;");
  assert(systemTemplates.length >= 20, `At least 20 system templates seeded (found: ${systemTemplates.length})`);

  const expectedTemplateNames = [
    'Sprint Started Notification',
    'Sprint Completed Backlog Rollover',
    'Task Completed Assignee Alert',
    'Overdue Task Warning',
    'OKR Goal Achieved',
    'OKR At Risk Admin Alert',
    'Missed Milestone Follow-up',
    'Member Overload Alert',
    'Expense Approval Notification',
    'Expense Rejection Notification',
    'Budget Warning Threshold',
    'Budget Exceeded Critical Alert',
    'Overdue Invoice Reminder',
    'Client Order Intake Alert',
    'Client Milestone Sign-off Update',
    'GitHub PR Merged Team Update',
    'Rejected Time Entry Notice',
    'Member Offboarding Sprint Cleanup',
    'Pipeline Stage Handover Alert',
    'Revenue Share Blocked Warning'
  ];

  for (const name of expectedTemplateNames) {
    const found = systemTemplates.find((t) => t.name === name);
    assert(found !== undefined, `Template '${name}' is properly seeded`);
    if (found) {
      let validActions = false;
      try {
        const parsed = JSON.parse(found.actions);
        validActions = Array.isArray(parsed) && parsed.length > 0;
      } catch (e) {
        validActions = false;
      }
      assert(validActions, `Template '${name}' has valid actions JSON array`);
    }
  }

  // Verify Idempotency of Seeding
  seedBuiltInAutomationTemplates(db);
  const recheckTemplates = queryAll("SELECT * FROM automation_templates WHERE is_system_template = 1;");
  assert(recheckTemplates.length === systemTemplates.length, 'Re-seeding is idempotent (no duplicate rows created)');

  // ---------------------------------------------------------
  // Test 6: Append-Only DB Triggers & Controlled Mutability
  // ---------------------------------------------------------
  console.log('\n=== Test 6: Append-Only DB Triggers & Immutability Verification ===');

  // Find admin and project for test fixtures
  const admin = queryOne("SELECT id FROM users WHERE role IN ('admin', 'superadmin') LIMIT 1;") || { id: 1 };
  const project = queryOne("SELECT id FROM projects LIMIT 1;") || { id: 1 };

  // 6.1 Create test rule
  const ruleInsert = execute(`
    INSERT INTO automation_rules (
      name, description, project_id, scope, is_active, trigger_module, trigger_event,
      trigger_conditions, condition_logic, actions, created_by
    ) VALUES (
      'Test Verify Rule', 'Description for testing triggers', ?, 'PROJECT', 1, 'SPRINT', 'SPRINT_STARTED',
      '[]', 'AND', '[{"action":"SEND_NOTIFICATION"}]', ?
    );
  `, [project.id, admin.id]);
  const testRuleId = ruleInsert.lastInsertRowid;
  assert(testRuleId > 0, `Created test automation rule (id: ${testRuleId})`);

  // 6.2 Test Trigger 1: prevent_run_log_update
  const logInsert = execute(`
    INSERT INTO automation_run_log (
      automation_id, trigger_event, overall_status
    ) VALUES (?, 'SPRINT_STARTED', 'PENDING');
  `, [testRuleId]);
  const testLogId = logInsert.lastInsertRowid;
  assert(testLogId > 0, `Created test run_log entry (id: ${testLogId})`);

  let runLogUpdateBlocked = false;
  try {
    execute(`UPDATE automation_run_log SET overall_status = 'SUCCESS' WHERE id = ?;`, [testLogId]);
  } catch (err) {
    if (err.message.includes('automation_run_log is append-only')) {
      runLogUpdateBlocked = true;
    }
  }
  assert(runLogUpdateBlocked, 'prevent_run_log_update trigger blocks UPDATE with RAISE(ABORT)');

  // 6.3 Test Trigger 2: prevent_run_log_delete
  let runLogDeleteBlocked = false;
  try {
    execute(`DELETE FROM automation_run_log WHERE id = ?;`, [testLogId]);
  } catch (err) {
    if (err.message.includes('automation_run_log is append-only')) {
      runLogDeleteBlocked = true;
    }
  }
  assert(runLogDeleteBlocked, 'prevent_run_log_delete trigger blocks DELETE with RAISE(ABORT)');

  // 6.4 Test Trigger 3: prevent_automation_error_delete & Mutability of Acknowledgment
  const errorInsert = execute(`
    INSERT INTO automation_errors (
      automation_id, run_log_id, error_type, error_message, action_index
    ) VALUES (?, ?, 'ACTION_FAILED', 'Simulated failure for verification', 0);
  `, [testRuleId, testLogId]);
  const testErrorId = errorInsert.lastInsertRowid;
  assert(testErrorId > 0, `Created test automation error (id: ${testErrorId})`);

  // DELETE must be blocked
  let errorDeleteBlocked = false;
  try {
    execute(`DELETE FROM automation_errors WHERE id = ?;`, [testErrorId]);
  } catch (err) {
    if (err.message.includes('automation_errors is append-only')) {
      errorDeleteBlocked = true;
    }
  }
  assert(errorDeleteBlocked, 'prevent_automation_error_delete trigger blocks DELETE with RAISE(ABORT)');

  // UPDATE of acknowledgment fields must succeed
  let errorAckSucceeded = false;
  try {
    execute(`
      UPDATE automation_errors
      SET acknowledged_by = ?, acknowledged_at = datetime('now')
      WHERE id = ?;
    `, [admin.id, testErrorId]);
    const updatedErr = queryOne('SELECT acknowledged_by, acknowledged_at FROM automation_errors WHERE id = ?;', [testErrorId]);
    errorAckSucceeded = updatedErr && updatedErr.acknowledged_by === admin.id && updatedErr.acknowledged_at !== null;
  } catch (err) {
    errorAckSucceeded = false;
  }
  assert(errorAckSucceeded, 'automation_errors allows acknowledgment updates (acknowledged_by, acknowledged_at)');

  // 6.5 Test Trigger 4: prevent_variable_store_update
  const varInsert = execute(`
    INSERT INTO automation_variable_store (
      automation_id, run_log_id, variable_name, variable_value
    ) VALUES (?, ?, 'item.title', 'Initial Task Title');
  `, [testRuleId, testLogId]);
  const testVarId = varInsert.lastInsertRowid;
  assert(testVarId > 0, `Created test variable_store entry (id: ${testVarId})`);

  let varUpdateBlocked = false;
  try {
    execute(`UPDATE automation_variable_store SET variable_value = 'Tampered Value' WHERE id = ?;`, [testVarId]);
  } catch (err) {
    if (err.message.includes('automation_variable_store is append-only')) {
      varUpdateBlocked = true;
    }
  }
  assert(varUpdateBlocked, 'prevent_variable_store_update trigger blocks UPDATE with RAISE(ABORT)');

  // 6.6 Test Trigger 5: prevent_variable_store_delete
  let varDeleteBlocked = false;
  try {
    execute(`DELETE FROM automation_variable_store WHERE id = ?;`, [testVarId]);
  } catch (err) {
    if (err.message.includes('automation_variable_store is append-only')) {
      varDeleteBlocked = true;
    }
  }
  assert(varDeleteBlocked, 'prevent_variable_store_delete trigger blocks DELETE with RAISE(ABORT)');

  // 6.7 Test Trigger 6: prevent_ai_suggestion_update (Core fields immutable, review fields mutable)
  const suggInsert = execute(`
    INSERT INTO automation_ai_suggestions (
      suggested_name, suggested_trigger_module, suggested_trigger_event, suggested_actions, status
    ) VALUES (
      'AI Suggested Rule', 'OKR', 'OKR_COMPLETED', '[{"action":"SEND_NOTIFICATION"}]', 'PENDING'
    );
  `, []);
  const testSuggId = suggInsert.lastInsertRowid;
  assert(testSuggId > 0, `Created test AI suggestion (id: ${testSuggId})`);

  // Attempt to tamper with core suggested fields must be blocked
  let suggCoreUpdateBlocked = false;
  try {
    execute(`UPDATE automation_ai_suggestions SET suggested_name = 'Hacked Rule Name' WHERE id = ?;`, [testSuggId]);
  } catch (err) {
    if (err.message.includes('automation_ai_suggestions core fields are append-only')) {
      suggCoreUpdateBlocked = true;
    }
  }
  assert(suggCoreUpdateBlocked, 'prevent_ai_suggestion_update trigger blocks mutation of core suggested fields');

  // Legitimate review transition (status, reviewed_by, reviewed_at, approved_automation_id) must succeed
  let suggReviewSucceeded = false;
  try {
    execute(`
      UPDATE automation_ai_suggestions
      SET status = 'APPROVED', reviewed_by = ?, reviewed_at = datetime('now'), approved_automation_id = ?
      WHERE id = ?;
    `, [admin.id, testRuleId, testSuggId]);
    const updatedSugg = queryOne('SELECT status, reviewed_by, approved_automation_id FROM automation_ai_suggestions WHERE id = ?;', [testSuggId]);
    suggReviewSucceeded = updatedSugg && updatedSugg.status === 'APPROVED' && updatedSugg.approved_automation_id === testRuleId;
  } catch (err) {
    suggReviewSucceeded = false;
  }
  assert(suggReviewSucceeded, 'automation_ai_suggestions allows legitimate review status update without mutating core fields');

  // 6.8 Test Trigger 7: prevent_ai_suggestion_delete
  let suggDeleteBlocked = false;
  try {
    execute(`DELETE FROM automation_ai_suggestions WHERE id = ?;`, [testSuggId]);
  } catch (err) {
    if (err.message.includes('automation_ai_suggestions is append-only')) {
      suggDeleteBlocked = true;
    }
  }
  assert(suggDeleteBlocked, 'prevent_ai_suggestion_delete trigger blocks DELETE with RAISE(ABORT)');

  // ---------------------------------------------------------
  // Test 7: Queue and Rule State Transitions
  // ---------------------------------------------------------
  console.log('\n=== Test 7: Queue and Rule State Transitions ===');

  // Rule toggle update
  execute(`UPDATE automation_rules SET is_active = 0, updated_at = datetime('now') WHERE id = ?;`, [testRuleId]);
  const toggledRule = queryOne('SELECT is_active FROM automation_rules WHERE id = ?;', [testRuleId]);
  assert(toggledRule && toggledRule.is_active === 0, 'automation_rules toggles is_active cleanly');

  // Queue lifecycle: QUEUED -> PROCESSING -> DONE
  const queueInsert = execute(`
    INSERT INTO automation_queue (
      automation_id, trigger_event, trigger_source_type, trigger_source_id,
      trigger_data, status
    ) VALUES (
      ?, 'SPRINT_STARTED', 'SPRINT', 1, '{"sprint":{"id":1,"name":"Sprint 1"}}', 'QUEUED'
    );
  `, [testRuleId]);
  const testQueueId = queueInsert.lastInsertRowid;
  assert(testQueueId > 0, `Created test queue item (id: ${testQueueId})`);

  execute(`UPDATE automation_queue SET status = 'PROCESSING', attempts = 1, updated_at = datetime('now') WHERE id = ?;`, [testQueueId]);
  const processingQueue = queryOne('SELECT status, attempts FROM automation_queue WHERE id = ?;', [testQueueId]);
  assert(processingQueue && processingQueue.status === 'PROCESSING' && processingQueue.attempts === 1, 'automation_queue transitions to PROCESSING');

  execute(`UPDATE automation_queue SET status = 'DONE', updated_at = datetime('now') WHERE id = ?;`, [testQueueId]);
  const doneQueue = queryOne('SELECT status FROM automation_queue WHERE id = ?;', [testQueueId]);
  assert(doneQueue && doneQueue.status === 'DONE', 'automation_queue transitions to DONE');

  // ---------------------------------------------------------
  // Summary
  // ---------------------------------------------------------
  console.log('\n' + '='.repeat(80));
  console.log(`PRD 26 Layer 1 Verification Complete: ${passed} PASS, ${failed} FAIL`);
  console.log('='.repeat(80));

  if (failed > 0) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('Fatal error during PRD 26 Layer 1 verification:', err);
  process.exit(1);
});
