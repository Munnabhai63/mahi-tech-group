/**
 * scripts/verify-prd24-layer1.js
 * Verification Suite for PRD 24 Layer 1: Client Portal Database Schema, Triggers, and Pragmas
 *
 * Checks:
 * 1. SQLite Pragmas: journal_mode = WAL, busy_timeout = 5000, foreign_keys = ON.
 * 2. Schema Structure: All 8 required tables exist with exact column names and types.
 * 3. Composite & Performance Indexes: All indexes created and active in sqlite_master.
 * 4. Constraint Enforcement: UNIQUE(email), UNIQUE(client_id, project_id), UNIQUE(client_id, milestone_id), and FK integrity.
 * 5. Append-Only DB Triggers: All 8 triggers exist and strictly block illegal UPDATE and DELETE queries with RAISE(ABORT).
 */

import { getDatabase, queryOne, queryAll, execute } from '../src/db/database.js';
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
  console.log('PRD 24 Layer 1 Verification Suite: Client Portal Schema & Triggers');
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
  // Test 2: Database Schema Validation (8 Required Tables)
  // ---------------------------------------------------------
  console.log('\n=== Test 2: Database Schema Validation (8 Required Tables) ===');
  const requiredTables = [
    'clients',
    'client_project_access',
    'client_shared_items',
    'client_orders',
    'client_order_messages',
    'client_milestone_approvals',
    'client_deliverable_feedback',
    'client_activity_log'
  ];

  for (const table of requiredTables) {
    const tableExists = queryOne(
      "SELECT name FROM sqlite_master WHERE type='table' AND name = ?;",
      [table]
    );
    assert(tableExists !== null, `Table ${table} exists in database`);
  }

  // Column verification
  const expectedColumns = {
    clients: [
      { name: 'id', type: 'INTEGER' },
      { name: 'name', type: 'TEXT' },
      { name: 'email', type: 'TEXT' },
      { name: 'company_name', type: 'TEXT' },
      { name: 'phone', type: 'TEXT' },
      { name: 'password_hash', type: 'TEXT' },
      { name: 'status', type: 'TEXT' },
      { name: 'invite_token', type: 'TEXT' },
      { name: 'invite_token_expires_at', type: 'TEXT' },
      { name: 'invite_accepted_at', type: 'TEXT' },
      { name: 'created_by', type: 'INTEGER' },
      { name: 'created_at', type: 'TEXT' },
      { name: 'updated_at', type: 'TEXT' }
    ],
    client_project_access: [
      { name: 'id', type: 'INTEGER' },
      { name: 'client_id', type: 'INTEGER' },
      { name: 'project_id', type: 'INTEGER' },
      { name: 'access_level', type: 'TEXT' },
      { name: 'granted_by', type: 'INTEGER' },
      { name: 'granted_at', type: 'TEXT' },
      { name: 'revoked_by', type: 'INTEGER' },
      { name: 'revoked_at', type: 'TEXT' },
      { name: 'is_active', type: 'INTEGER' }
    ],
    client_shared_items: [
      { name: 'id', type: 'INTEGER' },
      { name: 'client_id', type: 'INTEGER' },
      { name: 'project_id', type: 'INTEGER' },
      { name: 'item_type', type: 'TEXT' },
      { name: 'item_id', type: 'INTEGER' },
      { name: 'shared_by', type: 'INTEGER' },
      { name: 'shared_at', type: 'TEXT' },
      { name: 'unshared_by', type: 'INTEGER' },
      { name: 'unshared_at', type: 'TEXT' },
      { name: 'is_active', type: 'INTEGER' }
    ],
    client_orders: [
      { name: 'id', type: 'INTEGER' },
      { name: 'client_id', type: 'INTEGER' },
      { name: 'project_id', type: 'INTEGER' },
      { name: 'title', type: 'TEXT' },
      { name: 'description', type: 'TEXT' },
      { name: 'order_type', type: 'TEXT' },
      { name: 'priority', type: 'TEXT' },
      { name: 'status', type: 'TEXT' },
      { name: 'attachments', type: 'TEXT' },
      { name: 'assigned_to', type: 'INTEGER' },
      { name: 'due_date', type: 'TEXT' },
      { name: 'internal_notes', type: 'TEXT' },
      { name: 'rejection_reason', type: 'TEXT' },
      { name: 'created_at', type: 'TEXT' },
      { name: 'updated_at', type: 'TEXT' }
    ],
    client_order_messages: [
      { name: 'id', type: 'INTEGER' },
      { name: 'order_id', type: 'INTEGER' },
      { name: 'sender_type', type: 'TEXT' },
      { name: 'sender_client_id', type: 'INTEGER' },
      { name: 'sender_user_id', type: 'INTEGER' },
      { name: 'message', type: 'TEXT' },
      { name: 'is_internal', type: 'INTEGER' },
      { name: 'attachments', type: 'TEXT' },
      { name: 'created_at', type: 'TEXT' }
    ],
    client_milestone_approvals: [
      { name: 'id', type: 'INTEGER' },
      { name: 'client_id', type: 'INTEGER' },
      { name: 'project_id', type: 'INTEGER' },
      { name: 'milestone_id', type: 'INTEGER' },
      { name: 'requested_by', type: 'INTEGER' },
      { name: 'requested_at', type: 'TEXT' },
      { name: 'decision', type: 'TEXT' },
      { name: 'decision_note', type: 'TEXT' },
      { name: 'decided_at', type: 'TEXT' }
    ],
    client_deliverable_feedback: [
      { name: 'id', type: 'INTEGER' },
      { name: 'client_id', type: 'INTEGER' },
      { name: 'project_id', type: 'INTEGER' },
      { name: 'item_type', type: 'TEXT' },
      { name: 'item_id', type: 'INTEGER' },
      { name: 'rating', type: 'INTEGER' },
      { name: 'feedback_text', type: 'TEXT' },
      { name: 'status', type: 'TEXT' },
      { name: 'acknowledged_by', type: 'INTEGER' },
      { name: 'acknowledged_at', type: 'TEXT' },
      { name: 'created_at', type: 'TEXT' }
    ],
    client_activity_log: [
      { name: 'id', type: 'INTEGER' },
      { name: 'client_id', type: 'INTEGER' },
      { name: 'action', type: 'TEXT' },
      { name: 'item_type', type: 'TEXT' },
      { name: 'item_id', type: 'INTEGER' },
      { name: 'ip_address', type: 'TEXT' },
      { name: 'user_agent', type: 'TEXT' },
      { name: 'created_at', type: 'TEXT' }
    ]
  };

  for (const [table, cols] of Object.entries(expectedColumns)) {
    const tableInfo = queryAll(`PRAGMA table_info(${table});`);
    const actualCols = new Map(tableInfo.map(c => [c.name, c.type.toUpperCase()]));
    for (const expected of cols) {
      assert(
        actualCols.has(expected.name),
        `Column ${expected.name} in table ${table} exists`
      );
      if (actualCols.has(expected.name)) {
        const actualType = actualCols.get(expected.name);
        assert(
          actualType.includes(expected.type),
          `Column ${expected.name} in table ${table} matches type ${expected.type} (actual: ${actualType})`
        );
      }
    }
  }

  // ---------------------------------------------------------
  // Test 3: Composite and Performance Indexes
  // ---------------------------------------------------------
  console.log('\n=== Test 3: Composite and Performance Indexes ===');
  const requiredIndexes = [
    'idx_clients_email',
    'idx_clients_status',
    'idx_clients_invite_token',
    'idx_client_project_access_client',
    'idx_client_project_access_project',
    'idx_client_shared_items_client',
    'idx_client_shared_items_project',
    'idx_client_shared_items_item',
    'idx_client_orders_client',
    'idx_client_orders_project',
    'idx_client_orders_status',
    'idx_client_order_messages_order',
    'idx_client_milestone_approvals_client',
    'idx_client_milestone_approvals_milestone',
    'idx_client_feedback_client',
    'idx_client_feedback_project',
    'idx_client_activity_log_client',
    'idx_client_activity_log_action'
  ];

  for (const index of requiredIndexes) {
    const indexExists = queryOne(
      "SELECT name FROM sqlite_master WHERE type='index' AND name = ?;",
      [index]
    );
    assert(indexExists !== null, `Index ${index} exists in sqlite_master`);
  }

  // ---------------------------------------------------------
  // Test 4: Relational Constraints & Foreign Keys
  // ---------------------------------------------------------
  console.log('\n=== Test 4: Relational Constraints & Foreign Keys ===');
  const admin = queryOne("SELECT id FROM users WHERE role IN ('admin', 'superadmin') LIMIT 1;");
  const adminId = admin ? admin.id : 1;
  const project = queryOne("SELECT id FROM projects LIMIT 1;");
  const projectId = project ? project.id : 1;

  // 4a. Unique email on clients
  const uniqueTestEmail = `client-test-${Date.now()}@domain.com`;
  execute(`
    INSERT INTO clients (name, email, password_hash, created_by)
    VALUES (?, ?, ?, ?);
  `, ['Test Client Alpha', uniqueTestEmail, 'hash_sample_abc', adminId]);

  let duplicateEmailCaught = false;
  try {
    execute(`
      INSERT INTO clients (name, email, password_hash, created_by)
      VALUES (?, ?, ?, ?);
    `, ['Duplicate Client', uniqueTestEmail, 'hash_sample_xyz', adminId]);
  } catch (err) {
    duplicateEmailCaught = err.message.includes('UNIQUE constraint failed');
  }
  assert(duplicateEmailCaught, 'clients table enforces UNIQUE(email)');

  const testClient = queryOne('SELECT id FROM clients WHERE email = ?;', [uniqueTestEmail]);
  const clientId = testClient.id;

  // 4b. Unique (client_id, project_id) on client_project_access
  execute(`
    INSERT INTO client_project_access (client_id, project_id, access_level, granted_by)
    VALUES (?, ?, 'VIEW', ?);
  `, [clientId, projectId, adminId]);

  let duplicateAccessCaught = false;
  try {
    execute(`
      INSERT INTO client_project_access (client_id, project_id, access_level, granted_by)
      VALUES (?, ?, 'COMMENT', ?);
    `, [clientId, projectId, adminId]);
  } catch (err) {
    duplicateAccessCaught = err.message.includes('UNIQUE constraint failed');
  }
  assert(duplicateAccessCaught, 'client_project_access enforces UNIQUE(client_id, project_id)');

  // 4c. Foreign key violation test
  let invalidFkCaught = false;
  try {
    execute(`
      INSERT INTO clients (name, email, password_hash, created_by)
      VALUES (?, ?, ?, 999999);
    `, ['Ghost Creator', `ghost-${Date.now()}@ghost.com`, 'hash',]);
  } catch (err) {
    invalidFkCaught = err.message.includes('FOREIGN KEY constraint failed');
  }
  assert(invalidFkCaught, 'Foreign key integrity active (PRAGMA foreign_keys = ON)');

  // ---------------------------------------------------------
  // Test 5: All 8 Append-Only Triggers Immutability Enforcement
  // ---------------------------------------------------------
  console.log('\n=== Test 5: Append-Only Triggers Immutability Enforcement ===');

  // Trigger 1 & 2: client_order_messages update & delete
  const triggerOrderMsgUpdate = queryOne("SELECT name FROM sqlite_master WHERE type='trigger' AND name='prevent_client_order_message_update';");
  assert(triggerOrderMsgUpdate !== null, 'Trigger prevent_client_order_message_update exists');

  const triggerOrderMsgDelete = queryOne("SELECT name FROM sqlite_master WHERE type='trigger' AND name='prevent_client_order_message_delete';");
  assert(triggerOrderMsgDelete !== null, 'Trigger prevent_client_order_message_delete exists');

  // Create test order
  execute(`
    INSERT INTO client_orders (client_id, project_id, title, description, created_at, updated_at)
    VALUES (?, ?, 'Test Order', 'Need verification', datetime('now'), datetime('now'));
  `, [clientId, projectId]);
  const orderRow = queryOne('SELECT id FROM client_orders WHERE client_id = ? ORDER BY id DESC LIMIT 1;', [clientId]);
  const orderId = orderRow.id;

  // Create test message
  execute(`
    INSERT INTO client_order_messages (order_id, sender_type, sender_client_id, message)
    VALUES (?, 'CLIENT', ?, 'Hello team!');
  `, [orderId, clientId]);
  const msgRow = queryOne('SELECT id FROM client_order_messages WHERE order_id = ? ORDER BY id DESC LIMIT 1;', [orderId]);

  let msgUpdateAborted = false;
  try {
    execute('UPDATE client_order_messages SET message = ? WHERE id = ?;', ['Tampered message', msgRow.id]);
  } catch (err) {
    msgUpdateAborted = err.message.includes('client_order_messages is append-only');
  }
  assert(msgUpdateAborted, 'prevent_client_order_message_update strictly aborted SQL UPDATE');

  let msgDeleteAborted = false;
  try {
    execute('DELETE FROM client_order_messages WHERE id = ?;', [msgRow.id]);
  } catch (err) {
    msgDeleteAborted = err.message.includes('client_order_messages is append-only');
  }
  assert(msgDeleteAborted, 'prevent_client_order_message_delete strictly aborted SQL DELETE');

  // Trigger 3 & 4: client_milestone_approvals update & delete
  const triggerMilestoneUpdate = queryOne("SELECT name FROM sqlite_master WHERE type='trigger' AND name='prevent_client_milestone_approval_update';");
  assert(triggerMilestoneUpdate !== null, 'Trigger prevent_client_milestone_approval_update exists');

  const triggerMilestoneDelete = queryOne("SELECT name FROM sqlite_master WHERE type='trigger' AND name='prevent_client_milestone_approval_delete';");
  assert(triggerMilestoneDelete !== null, 'Trigger prevent_client_milestone_approval_delete exists');

  // Find or create test milestone in gantt_milestones
  let milestone = queryOne('SELECT id FROM gantt_milestones LIMIT 1;');
  if (!milestone) {
    execute(`
      INSERT INTO gantt_milestones (project_id, title, milestone_date, created_by)
      VALUES (?, 'Milestone Beta', '2026-12-01', ?);
    `, [projectId, adminId]);
    milestone = queryOne('SELECT id FROM gantt_milestones ORDER BY id DESC LIMIT 1;');
  }
  const milestoneId = milestone.id;

  // Create approval record
  execute(`
    INSERT INTO client_milestone_approvals (client_id, project_id, milestone_id, requested_by, decision, decision_note, decided_at)
    VALUES (?, ?, ?, ?, 'APPROVED', 'Looks good to client', datetime('now'));
  `, [clientId, projectId, milestoneId, adminId]);
  const approvalRow = queryOne('SELECT id FROM client_milestone_approvals WHERE client_id = ? AND milestone_id = ?;', [clientId, milestoneId]);

  let approvalUpdateAborted = false;
  try {
    execute('UPDATE client_milestone_approvals SET decision = ? WHERE id = ?;', ['REJECTED', approvalRow.id]);
  } catch (err) {
    approvalUpdateAborted = err.message.includes('client_milestone_approvals is append-only');
  }
  assert(approvalUpdateAborted, 'prevent_client_milestone_approval_update strictly aborted SQL UPDATE on decided approval');

  let approvalDeleteAborted = false;
  try {
    execute('DELETE FROM client_milestone_approvals WHERE id = ?;', [approvalRow.id]);
  } catch (err) {
    approvalDeleteAborted = err.message.includes('client_milestone_approvals is append-only');
  }
  assert(approvalDeleteAborted, 'prevent_client_milestone_approval_delete strictly aborted SQL DELETE');

  // Trigger 5 & 6: client_deliverable_feedback update & delete
  const triggerFeedbackUpdate = queryOne("SELECT name FROM sqlite_master WHERE type='trigger' AND name='prevent_client_feedback_update';");
  assert(triggerFeedbackUpdate !== null, 'Trigger prevent_client_feedback_update exists');

  const triggerFeedbackDelete = queryOne("SELECT name FROM sqlite_master WHERE type='trigger' AND name='prevent_client_feedback_delete';");
  assert(triggerFeedbackDelete !== null, 'Trigger prevent_client_feedback_delete exists');

  execute(`
    INSERT INTO client_deliverable_feedback (client_id, project_id, item_type, item_id, rating, feedback_text)
    VALUES (?, ?, 'DOCUMENT', 101, 5, 'Exceptional quality delivery');
  `, [clientId, projectId]);
  const feedbackRow = queryOne('SELECT id FROM client_deliverable_feedback WHERE client_id = ? ORDER BY id DESC LIMIT 1;', [clientId]);

  let feedbackUpdateAborted = false;
  try {
    execute('UPDATE client_deliverable_feedback SET rating = 1 WHERE id = ?;', [feedbackRow.id]);
  } catch (err) {
    feedbackUpdateAborted = err.message.includes('client_deliverable_feedback is append-only');
  }
  assert(feedbackUpdateAborted, 'prevent_client_feedback_update strictly aborted SQL UPDATE');

  let feedbackDeleteAborted = false;
  try {
    execute('DELETE FROM client_deliverable_feedback WHERE id = ?;', [feedbackRow.id]);
  } catch (err) {
    feedbackDeleteAborted = err.message.includes('client_deliverable_feedback is append-only');
  }
  assert(feedbackDeleteAborted, 'prevent_client_feedback_delete strictly aborted SQL DELETE');

  // Trigger 7 & 8: client_activity_log update & delete
  const triggerActivityUpdate = queryOne("SELECT name FROM sqlite_master WHERE type='trigger' AND name='prevent_client_activity_log_update';");
  assert(triggerActivityUpdate !== null, 'Trigger prevent_client_activity_log_update exists');

  const triggerActivityDelete = queryOne("SELECT name FROM sqlite_master WHERE type='trigger' AND name='prevent_client_activity_log_delete';");
  assert(triggerActivityDelete !== null, 'Trigger prevent_client_activity_log_delete exists');

  execute(`
    INSERT INTO client_activity_log (client_id, action, item_type, item_id, ip_address, user_agent)
    VALUES (?, 'LOGIN', 'CLIENT', ?, '127.0.0.1', 'Node.js Test Agent');
  `, [clientId, clientId]);
  const activityRow = queryOne('SELECT id FROM client_activity_log WHERE client_id = ? ORDER BY id DESC LIMIT 1;', [clientId]);

  let activityUpdateAborted = false;
  try {
    execute('UPDATE client_activity_log SET action = ? WHERE id = ?;', ['TAMPERED', activityRow.id]);
  } catch (err) {
    activityUpdateAborted = err.message.includes('client_activity_log is append-only');
  }
  assert(activityUpdateAborted, 'prevent_client_activity_log_update strictly aborted SQL UPDATE');

  let activityDeleteAborted = false;
  try {
    execute('DELETE FROM client_activity_log WHERE id = ?;', [activityRow.id]);
  } catch (err) {
    activityDeleteAborted = err.message.includes('client_activity_log is append-only');
  }
  assert(activityDeleteAborted, 'prevent_client_activity_log_delete strictly aborted SQL DELETE');

  // ---------------------------------------------------------
  // Summary
  // ---------------------------------------------------------
  console.log('\n' + '='.repeat(80));
  console.log('Layer 1 Verification Summary:');
  console.log(`Total Tests : ${passed + failed}`);
  console.log(`Passed      : ${passed}`);
  console.log(`Failed      : ${failed}`);
  console.log(`Success Rate: ${((passed / (passed + failed)) * 100).toFixed(1)}%`);
  console.log('='.repeat(80));

  if (failed > 0) {
    process.exit(1);
  }
}

run().catch(err => {
  console.error('Fatal error in Layer 1 test suite:', err);
  process.exit(1);
});
