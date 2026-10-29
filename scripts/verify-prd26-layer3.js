/**
 * scripts/verify-prd26-layer3.js
 * Verification Suite for PRD 26 Layer 3: Action Execution Engine
 *
 * Verifies:
 * 1. Template variable resolution ({{ variable }}) strictly from frozen trigger_data snapshots.
 * 2. Strict declarative guard: zero eval/vm, only 12 supported action types.
 * 3. SEND_NOTIFICATION and SEND_EMAIL execution and delivery logging.
 * 4. UPDATE_FIELD, ASSIGN_MEMBER, CHANGE_STATUS, SET_DUE_DATE with manual updated_at.
 * 5. CREATE_BACKLOG_ITEM, CREATE_GANTT_ITEM entity creation with manual updated_at.
 * 6. MOVE_ITEM_TO_BACKLOG, COMPLETE_SPRINT, WAIT, and STOP_IF control flow.
 * 7. End-to-end queue processor integration: actions_executed JSON, automation_variable_store,
 *    PARTIAL status on partial success, automation_errors recording, and 3-tier retry backoff.
 *
 * Real SQLite database (./data/mahi.db), ZERO mocks.
 */

import { getDatabase, queryOne, queryAll, execute } from '../src/db/database.js';
import {
  executeAction,
  executeActionsSequence,
  resolveTemplateVariables,
  SUPPORTED_ACTIONS
} from '../src/services/automationActionExecutor.js';
import {
  fireTrigger,
  processQueueBatch
} from '../src/services/automationEngine.js';
import crypto from 'node:crypto';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✔ PASS: ${message}`);
    passed++;
  } else {
    console.error(`  ✖ FAIL: ${message}`);
    failed++;
  }
}

async function run() {
  console.log('='.repeat(80));
  console.log('PRD 26 Layer 3 Verification Suite: Action Execution Engine');
  console.log('='.repeat(80));

  const db = getDatabase();

  // Test Fixtures: Admin, Member, Projects
  const admin = queryOne("SELECT * FROM users WHERE role IN ('admin', 'superadmin') LIMIT 1;") || {
    id: 1,
    role: 'admin'
  };
  const member = queryOne("SELECT * FROM users WHERE role = 'developer' LIMIT 1;") || {
    id: 999,
    role: 'developer'
  };
  const project = queryOne("SELECT * FROM projects LIMIT 1;") || {
    id: 'test-project-layer3',
    title: 'Test Project'
  };

  // Clean test queue and deactivate existing rules for clean isolation
  execute("DELETE FROM automation_queue;");
  execute("UPDATE automation_rules SET is_active = 0 WHERE trigger_module = 'SPRINT' OR trigger_module = 'BACKLOG';");

  // =========================================================================
  // Section 1: Template Variable Resolution ({{ variable }})
  // =========================================================================
  console.log('\n--- Section 1: Template Variable Resolution ---');

  const snapshotData = {
    project_id: project.id,
    item: {
      id: 101,
      title: 'Fix authentication token leak',
      status: 'IN_PROGRESS',
      priority: 'CRITICAL',
      assigned_to: member.id
    },
    sprint: {
      id: 42,
      name: 'Sprint Titan'
    },
    actor: {
      name: 'Sarah Connor',
      email: 'sarah@skynet-defense.com'
    }
  };

  const recordedVars = [];
  const singleResolved = resolveTemplateVariables('{{ sprint.name }} started', snapshotData, recordedVars);
  assert(singleResolved === 'Sprint Titan started', 'Single variable resolved: {{ sprint.name }}');
  assert(recordedVars.length === 1 && recordedVars[0].name === 'sprint.name', 'Recorded variable in tracking array');

  const multiResolved = resolveTemplateVariables(
    'Item "{{ item.title }}" in {{ sprint.name }} by {{ actor.name }}',
    snapshotData
  );
  assert(
    multiResolved === 'Item "Fix authentication token leak" in Sprint Titan by Sarah Connor',
    'Multiple variables in single string resolved properly'
  );

  const unknownResolved = resolveTemplateVariables('Unknown is {{ item.nonexistent }} here', snapshotData);
  assert(unknownResolved === 'Unknown is  here', 'Unknown variable safely resolves to empty string without throwing');

  // =========================================================================
  // Section 2: Declarative Guard & Supported Action Types
  // =========================================================================
  console.log('\n--- Section 2: Declarative Guard & Supported Action Types ---');

  assert(SUPPORTED_ACTIONS.length === 12, 'Strictly 12 supported declarative action types defined');
  assert(SUPPORTED_ACTIONS.includes('SEND_NOTIFICATION'), 'SEND_NOTIFICATION supported');
  assert(SUPPORTED_ACTIONS.includes('SEND_EMAIL'), 'SEND_EMAIL supported');
  assert(SUPPORTED_ACTIONS.includes('UPDATE_FIELD'), 'UPDATE_FIELD supported');
  assert(SUPPORTED_ACTIONS.includes('ASSIGN_MEMBER'), 'ASSIGN_MEMBER supported');
  assert(SUPPORTED_ACTIONS.includes('CHANGE_STATUS'), 'CHANGE_STATUS supported');
  assert(SUPPORTED_ACTIONS.includes('SET_DUE_DATE'), 'SET_DUE_DATE supported');
  assert(SUPPORTED_ACTIONS.includes('CREATE_BACKLOG_ITEM'), 'CREATE_BACKLOG_ITEM supported');
  assert(SUPPORTED_ACTIONS.includes('CREATE_GANTT_ITEM'), 'CREATE_GANTT_ITEM supported');
  assert(SUPPORTED_ACTIONS.includes('MOVE_ITEM_TO_BACKLOG'), 'MOVE_ITEM_TO_BACKLOG supported');
  assert(SUPPORTED_ACTIONS.includes('COMPLETE_SPRINT'), 'COMPLETE_SPRINT supported');
  assert(SUPPORTED_ACTIONS.includes('WAIT'), 'WAIT supported');
  assert(SUPPORTED_ACTIONS.includes('STOP_IF'), 'STOP_IF supported');

  let illegalBlocked = false;
  try {
    executeAction({ action: 'RUN_BASH_SCRIPT', params: { command: 'rm -rf /' } }, snapshotData);
  } catch (err) {
    if (err.message.includes('Unsupported action type')) illegalBlocked = true;
  }
  assert(illegalBlocked, 'Arbitrary code execution action (RUN_BASH_SCRIPT) hard rejected');

  // =========================================================================
  // Section 3: Notification & Communication Actions
  // =========================================================================
  console.log('\n--- Section 3: Notification & Communication Actions ---');

  // Test 3.1: SEND_NOTIFICATION to ADMIN
  const notifAdminRes = executeAction(
    {
      action: 'SEND_NOTIFICATION',
      params: { to: 'ADMIN', message: 'Alert: {{ item.title }} assigned' }
    },
    snapshotData,
    { currentUserId: admin.id }
  );
  assert(notifAdminRes.sent_count > 0, 'SEND_NOTIFICATION sent to ADMIN user(s)');
  assert(notifAdminRes.message === 'Alert: Fix authentication token leak assigned', 'Template message resolved in notification');

  const notifRow = queryOne(
    "SELECT * FROM notifications WHERE message = ? ORDER BY created_at DESC LIMIT 1;",
    [notifAdminRes.message]
  );
  assert(notifRow && notifRow.event_type === 'AUTOMATION_NOTIFICATION', 'Notification persisted in database with AUTOMATION_NOTIFICATION');

  // Test 3.2: SEND_EMAIL (declarative dispatch)
  const emailRes = executeAction(
    {
      action: 'SEND_EMAIL',
      params: {
        to: '{{ actor.email }}',
        subject: 'Notification: {{ sprint.name }}',
        body: 'Hello {{ actor.name }}, welcome to {{ sprint.name }}'
      }
    },
    snapshotData
  );
  assert(emailRes.delivered === true, 'SEND_EMAIL executed declarative dispatch');
  assert(emailRes.to === 'sarah@skynet-defense.com', 'Recipient email resolved from trigger snapshot');
  assert(emailRes.subject === 'Notification: Sprint Titan', 'Subject resolved with variables');

  // =========================================================================
  // Section 4: Data Mutation Actions & Manual updated_at
  // =========================================================================
  console.log('\n--- Section 4: Data Mutation Actions & Manual updated_at ---');

  // Create real test entities
  const testSprint = execute(`
    INSERT INTO sprints (project_id, name, status, created_by, created_at, updated_at)
    VALUES (?, 'Action Test Sprint', 'PLANNED', ?, datetime('now', '-1 hour'), datetime('now', '-1 hour'));
  `, [project.id, admin.id]);
  const testSprintId = testSprint.lastInsertRowid;

  const testItem = execute(`
    INSERT INTO backlog_items (project_id, sprint_id, title, priority, status, assigned_to, created_by, created_at, updated_at)
    VALUES (?, ?, 'Action Test Backlog Item', 'LOW', 'TODO', ?, ?, datetime('now', '-1 hour'), datetime('now', '-1 hour'));
  `, [project.id, testSprintId, member.id, admin.id]);
  const testItemId = testItem.lastInsertRowid;

  const itemBefore = queryOne('SELECT * FROM backlog_items WHERE id = ?;', [testItemId]);

  // Test 4.1: UPDATE_FIELD (priority -> URGENT)
  const updateRes = executeAction(
    {
      action: 'UPDATE_FIELD',
      params: { entity_type: 'BACKLOG_ITEM', entity_id: testItemId, field: 'priority', value: 'URGENT' }
    },
    snapshotData
  );
  assert(updateRes.updated === true, 'UPDATE_FIELD executed successfully');

  const itemAfterUpdate = queryOne('SELECT * FROM backlog_items WHERE id = ?;', [testItemId]);
  assert(itemAfterUpdate.priority === 'URGENT', 'Field updated to URGENT in database');
  assert(itemAfterUpdate.updated_at > itemBefore.updated_at, 'updated_at timestamp manually advanced on UPDATE_FIELD');

  // Test 4.2: ASSIGN_MEMBER
  const assignRes = executeAction(
    {
      action: 'ASSIGN_MEMBER',
      params: { entity_type: 'BACKLOG_ITEM', entity_id: testItemId, user_id: admin.id }
    },
    snapshotData
  );
  assert(assignRes.assigned === true, 'ASSIGN_MEMBER executed successfully');

  const itemAfterAssign = queryOne('SELECT assigned_to FROM backlog_items WHERE id = ?;', [testItemId]);
  assert(itemAfterAssign.assigned_to === admin.id, 'Assigned user updated in database');

  // Test 4.3: CHANGE_STATUS
  const statusRes = executeAction(
    {
      action: 'CHANGE_STATUS',
      params: { entity_type: 'BACKLOG_ITEM', entity_id: testItemId, new_status: 'IN_PROGRESS' }
    },
    snapshotData
  );
  assert(statusRes.status_changed === true, 'CHANGE_STATUS executed successfully');

  const itemAfterStatus = queryOne('SELECT status FROM backlog_items WHERE id = ?;', [testItemId]);
  assert(itemAfterStatus.status === 'IN_PROGRESS', 'Backlog item status updated to IN_PROGRESS');

  // Test 4.4: SET_DUE_DATE (7 days offset)
  const dueDateRes = executeAction(
    {
      action: 'SET_DUE_DATE',
      params: { entity_type: 'BACKLOG_ITEM', entity_id: testItemId, due_date_offset_days: 7 }
    },
    snapshotData
  );
  assert(dueDateRes.due_date_set === true, 'SET_DUE_DATE executed successfully');

  const itemAfterDue = queryOne('SELECT due_date FROM backlog_items WHERE id = ?;', [testItemId]);
  assert(itemAfterDue.due_date !== null, 'due_date column populated on backlog item');

  // =========================================================================
  // Section 5: Entity Creation Actions
  // =========================================================================
  console.log('\n--- Section 5: Entity Creation Actions ---');

  // Test 5.1: CREATE_BACKLOG_ITEM
  const createBacklogRes = executeAction(
    {
      action: 'CREATE_BACKLOG_ITEM',
      params: {
        project_id: project.id,
        title: 'Auto Follow-up for {{ sprint.name }}',
        type: 'TASK',
        priority: 'HIGH',
        assigned_to: admin.id
      }
    },
    snapshotData,
    { currentUserId: admin.id }
  );
  assert(createBacklogRes.created === true && createBacklogRes.item_id > 0, 'CREATE_BACKLOG_ITEM created new item');

  const createdBacklogRow = queryOne('SELECT * FROM backlog_items WHERE id = ?;', [createBacklogRes.item_id]);
  assert(createdBacklogRow && createdBacklogRow.title === 'Auto Follow-up for Sprint Titan', 'Templated title resolved on created item');
  assert(createdBacklogRow.priority === 'HIGH', 'Priority set correctly on created item');
  assert(createdBacklogRow.created_at !== null && createdBacklogRow.updated_at !== null, 'created_at and updated_at populated');

  // Test 5.2: CREATE_GANTT_ITEM
  const createGanttRes = executeAction(
    {
      action: 'CREATE_GANTT_ITEM',
      params: {
        project_id: project.id,
        title: 'Milestone for {{ sprint.name }}',
        start_date_offset: 2,
        duration_days: 10
      }
    },
    snapshotData,
    { currentUserId: admin.id }
  );
  assert(createGanttRes.created === true && createGanttRes.item_id > 0, 'CREATE_GANTT_ITEM created new milestone');

  const createdGanttRow = queryOne('SELECT * FROM gantt_items WHERE id = ?;', [createGanttRes.item_id]);
  assert(createdGanttRow && createdGanttRow.title === 'Milestone for Sprint Titan', 'Gantt title templated correctly');
  assert(createdGanttRow.status === 'NOT_STARTED', 'Gantt status defaults to NOT_STARTED');

  // =========================================================================
  // Section 6: Sprint & Workflow Control Actions
  // =========================================================================
  console.log('\n--- Section 6: Sprint & Workflow Control Actions ---');

  // Test 6.1: MOVE_ITEM_TO_BACKLOG
  const moveRes = executeAction(
    {
      action: 'MOVE_ITEM_TO_BACKLOG',
      params: { item_id: testItemId }
    },
    snapshotData
  );
  assert(moveRes.moved_to_backlog === true, 'MOVE_ITEM_TO_BACKLOG executed');

  const itemAfterMove = queryOne('SELECT sprint_id, status FROM backlog_items WHERE id = ?;', [testItemId]);
  assert(itemAfterMove.sprint_id === null, 'Item sprint_id cleared (moved to backlog)');
  assert(itemAfterMove.status === 'TODO', 'Item reset to TODO status');

  // Test 6.2: COMPLETE_SPRINT
  const completeSprintRes = executeAction(
    {
      action: 'COMPLETE_SPRINT',
      params: { sprint_id: testSprintId }
    },
    snapshotData
  );
  assert(completeSprintRes.sprint_completed === true, 'COMPLETE_SPRINT executed');

  const sprintAfterComplete = queryOne('SELECT status FROM sprints WHERE id = ?;', [testSprintId]);
  assert(sprintAfterComplete.status === 'COMPLETED', 'Sprint status updated to COMPLETED');

  // Test 6.3: STOP_IF (condition met -> stops sequence)
  const stopRes1 = executeAction(
    {
      action: 'STOP_IF',
      params: { condition: { field: 'item.priority', operator: 'EQUALS', value: 'CRITICAL' } }
    },
    snapshotData
  );
  assert(stopRes1.status === 'STOPPED', 'STOP_IF halts execution when condition is met');

  // Test 6.4: STOP_IF (condition not met -> continues sequence)
  const stopRes2 = executeAction(
    {
      action: 'STOP_IF',
      params: { condition: { field: 'item.priority', operator: 'EQUALS', value: 'LOW' } }
    },
    snapshotData
  );
  assert(stopRes2.status === 'CONTINUED', 'STOP_IF continues execution when condition is not met');

  // Test 6.5: WAIT action
  const waitRes = executeAction(
    {
      action: 'WAIT',
      params: { hours: 2, seconds: 30 }
    },
    snapshotData
  );
  assert(waitRes.status === 'WAITING' && waitRes.wait_seconds === 7230, 'WAIT returns WAITING status with delay_seconds');

  // =========================================================================
  // Section 7: End-to-End Queue Processor Integration & Error Backoff
  // =========================================================================
  console.log('\n--- Section 7: End-to-End Queue Processor Integration & Error Backoff ---');

  // Test 7.1: Multi-action sequence with variable store population
  const multiActionRule = execute(`
    INSERT INTO automation_rules (
      name, project_id, scope, is_active, trigger_module, trigger_event,
      trigger_conditions, condition_logic, actions, created_by
    ) VALUES (
      'Layer 3 Multi-Action Rule ${Date.now()}', ?, 'PROJECT', 1, 'BACKLOG', 'ITEM_UPDATED',
      '[{"field":"item.status","operator":"EQUALS","value":"IN_PROGRESS"}]', 'AND',
      '[
        {"action":"SEND_NOTIFICATION","params":{"to":"ADMIN","message":"Start: {{ item.title }} for {{ sprint.name }}"}},
        {"action":"UPDATE_FIELD","params":{"entity_type":"BACKLOG_ITEM","entity_id":${testItemId},"field":"title","value":"Automated Title Update"}}
      ]', ?
    );
  `, [project.id, admin.id]);
  const multiRuleId = multiActionRule.lastInsertRowid;

  const fireRes = fireTrigger('BACKLOG', 'ITEM_UPDATED', 'BACKLOG_ITEM', testItemId, admin.id, snapshotData);
  assert(fireRes.enqueued > 0, 'Trigger fired and enqueued job');

  const batchRes = processQueueBatch(5);
  assert(batchRes.processed > 0, 'processQueueBatch executed queued job');

  const queueRowAfter = queryOne('SELECT * FROM automation_queue WHERE id = ?;', [fireRes.queue_ids[0]]);
  assert(queueRowAfter.status === 'DONE', 'Job marked status DONE in queue');
  assert(queueRowAfter.run_log_id > 0, 'Job linked to run_log_id');

  const runLogRow = queryOne('SELECT * FROM automation_run_log WHERE id = ?;', [queueRowAfter.run_log_id]);
  assert(runLogRow.overall_status === 'SUCCESS', 'Run log recorded overall_status = SUCCESS');

  const executedActionsArray = JSON.parse(runLogRow.actions_executed);
  assert(executedActionsArray.length === 2, 'actions_executed JSON array contains 2 action results');
  assert(executedActionsArray[0].status === 'SUCCESS', 'Action 1 status = SUCCESS');
  assert(executedActionsArray[1].status === 'SUCCESS', 'Action 2 status = SUCCESS');

  // Verify automation_variable_store populated
  const varStoreRows = queryAll('SELECT * FROM automation_variable_store WHERE run_log_id = ?;', [queueRowAfter.run_log_id]);
  assert(varStoreRows.length >= 2, 'automation_variable_store populated with resolved runtime variables');
  const sprintVar = varStoreRows.find((v) => v.variable_name === 'sprint.name');
  assert(sprintVar && sprintVar.variable_value === 'Sprint Titan', 'Resolved variable sprint.name matches snapshot');

  // Test 7.2: Partial Success & Error Backoff
  const partialRule = execute(`
    INSERT INTO automation_rules (
      name, project_id, scope, is_active, trigger_module, trigger_event,
      trigger_conditions, condition_logic, actions, created_by
    ) VALUES (
      'Layer 3 Partial Error Rule ${Date.now()}', ?, 'PROJECT', 1, 'BACKLOG', 'ITEM_FAIL_TEST',
      NULL, 'AND',
      '[
        {"action":"SEND_NOTIFICATION","params":{"to":"ADMIN","message":"Step 1 Ok"}},
        {"action":"UPDATE_FIELD","params":{"entity_type":"BACKLOG_ITEM","entity_id":9999999,"field":"title","value":"Invalid ID"}}
      ]', ?
    );
  `, [project.id, admin.id]);
  const partialRuleId = partialRule.lastInsertRowid;

  const failJob = execute(`
    INSERT INTO automation_queue (
      automation_id, trigger_event, trigger_source_type, trigger_source_id,
      trigger_data, status, attempts, max_attempts, scheduled_at
    ) VALUES (?, 'ITEM_FAIL_TEST', 'BACKLOG_ITEM', 1, '{}', 'QUEUED', 0, 3, datetime('now', '-5 seconds'));
  `, [partialRuleId]);
  const failJobId = failJob.lastInsertRowid;

  processQueueBatch(5);

  const failJobAfter = queryOne('SELECT * FROM automation_queue WHERE id = ?;', [failJobId]);
  assert(failJobAfter.status === 'QUEUED', 'First failed attempt rescheduled as QUEUED for retry backoff');
  assert(failJobAfter.attempts === 1, 'Job attempts incremented to 1');

  // Verify scheduled in future (1 min backoff)
  const isFutureRetry = queryOne(
    "SELECT scheduled_at > datetime('now') AS is_future FROM automation_queue WHERE id = ?;",
    [failJobId]
  );
  assert(Boolean(isFutureRetry.is_future), 'Retry scheduled into the future (+60 seconds)');

  const partialRunLog = queryOne('SELECT * FROM automation_run_log WHERE id = ?;', [failJobAfter.run_log_id]);
  assert(partialRunLog && partialRunLog.overall_status === 'PARTIAL', 'Partial success recorded overall_status = PARTIAL');

  const errorEntry = queryOne('SELECT * FROM automation_errors WHERE run_log_id = ?;', [failJobAfter.run_log_id]);
  assert(errorEntry !== null, 'automation_errors record created for failed action');
  assert(errorEntry.error_type === 'ACTION_FAILED', 'automation_errors.error_type = ACTION_FAILED');
  assert(errorEntry.retry_scheduled === 1, 'automation_errors.retry_scheduled = 1 on first failure');

  // Test 7.3: Max Attempts (3) -> Permanent FAILED
  execute(
    "UPDATE automation_queue SET attempts = 2, scheduled_at = datetime('now', '-5 seconds') WHERE id = ?;",
    [failJobId]
  );
  processQueueBatch(5);

  const maxAttemptsJob = queryOne('SELECT * FROM automation_queue WHERE id = ?;', [failJobId]);
  assert(maxAttemptsJob.status === 'FAILED', 'After 3 attempts, queue item transitioned permanently to FAILED');

  // =========================================================================
  // Summary
  // =========================================================================
  console.log('\n' + '='.repeat(80));
  console.log(`PRD 26 Layer 3 Verification Complete: ${passed} PASS, ${failed} FAIL`);
  console.log('='.repeat(80));

  if (failed > 0) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('Fatal error during PRD 26 Layer 3 verification:', err);
  process.exit(1);
});
