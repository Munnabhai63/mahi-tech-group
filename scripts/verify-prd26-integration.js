/**
 * scripts/verify-prd26-integration.js
 * Master End-to-End Integration Suite for PRD 26: Workflow Automation Engine
 *
 * Verifies the complete 7-Layer Architecture:
 * 1. End-to-End Trigger-to-Action Execution Loop (Rule -> Trigger -> Queue -> Condition -> Action -> Variables -> Notification -> DB Mutation)
 * 2. Circular Automation Detection & Chain Depth Safeguards (DFS cycle detection & API HTTP rejection)
 * 3. Rate Limiting & Queue Backpressure Protection (Max 10 fires/min/rule, excess deferred)
 * 4. Dry-Run Simulation (Guaranteed zero DB mutations, zero real notifications)
 * 5. AI Suggestion Approval Flow (Suggestion-only, zero auto-execution, explicit admin approval)
 * 6. Error Triage & Exponential Retry Lifecycle (Error recording, acknowledge, retry cap at 3)
 * 7. System Template Immutability Guard (System templates protected from deletion)
 * 8. Full Platform Health & Zero Regressions
 */

import http from 'node:http';
import bcrypt from 'bcryptjs';
import { createApp } from '../src/app.js';
import { runMigration } from '../src/db/migrate.js';
import { runSeed } from '../src/db/seed.js';
import { getDatabase, queryOne, queryAll, execute } from '../src/db/database.js';
import { config } from '../src/config.js';
import * as sprintService from '../src/services/sprintService.js';
import * as automationEngine from '../src/services/automationEngine.js';

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
  console.log('🚀 PRD 26: MASTER END-TO-END INTEGRATION SUITE');
  console.log('='.repeat(80));

  runMigration();
  await runSeed();
  const db = getDatabase();

  const app = createApp();
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  console.log(`[MASTER TEST SERVER] Live on ${baseUrl}\n`);

  async function loginUser(email, plainPassword) {
    const pHash = await bcrypt.hash(plainPassword, config.BCRYPT_SALT_ROUNDS);
    execute('UPDATE users SET password_hash = ?, status = ? WHERE email = ?', [pHash, 'active', email]);

    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: plainPassword })
    });
    const data = await res.json();
    if (res.status !== 200 || !data.token) {
      throw new Error(`Failed to log in as ${email}: ${JSON.stringify(data)}`);
    }
    return { token: data.token, user: data.user || queryOne('SELECT * FROM users WHERE email = ?', [email]) };
  }

  const adminAuth = await loginUser('admin@mahitechgroup.com', 'AdminPassword@2026');
  const memberAuth = await loginUser('developer@mahitechgroup.com', 'DevPassword123!');

  const adminHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${adminAuth.token}`
  };
  const memberHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${memberAuth.token}`
  };

  async function api(path, options = {}) {
    const res = await fetch(`${baseUrl}${path}`, options);
    let json = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    return { status: res.status, headers: res.headers, body: json };
  }

  // Get active fixture project
  const project = queryOne('SELECT * FROM projects LIMIT 1;') || {
    id: 'test-project-master-e2e',
    title: 'Master E2E Project'
  };

  try {
    // -----------------------------------------------------------------
    // SECTION 1: End-to-End Trigger-to-Action Execution Lifecycle
    // -----------------------------------------------------------------
    console.log('\n--- Section 1: End-to-End Trigger-to-Action Lifecycle ---');

    // Clean test isolation
    execute("DELETE FROM automation_queue;");
    execute("UPDATE automation_rules SET is_active = 0 WHERE trigger_module = 'SPRINT' AND trigger_event = 'SPRINT_STARTED';");
    execute("UPDATE sprints SET status = 'COMPLETED' WHERE project_id = ? AND status = 'ACTIVE';", [project.id]);

    // 1. Create a clean active automation rule via REST API
    const e2eRuleName = 'E2E Master Sprint Start Automation ' + Date.now();
    const createRuleRes = await api('/api/automation/rule/create', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        name: e2eRuleName,
        description: 'Auto-notifies admin and creates kickoff task on sprint start',
        scope: 'PROJECT',
        project_id: project.id,
        trigger_module: 'SPRINT',
        trigger_event: 'SPRINT_STARTED',
        condition_logic: 'AND',
        trigger_conditions: [
          {
            field: 'sprint.name',
            operator: 'NOT_EQUALS',
            value: ''
          }
        ],
        actions: [
          {
            action_type: 'send_notification',
            params: {
              recipient_type: 'admin',
              title: 'Sprint Started: {{ sprint.name }}',
              message: 'Sprint #{{ sprint.id }} has officially started.'
            }
          },
          {
            action_type: 'create_backlog_item',
            params: {
              project_id: project.id,
              title: 'Automated Kickoff for {{ sprint.name }}',
              description: 'Created automatically by PRD 26 automation engine for sprint #{{ sprint.id }}',
              priority: 'HIGH'
            }
          }
        ]
      })
    });

    if (createRuleRes.status !== 201) {
      console.error('Failed to create rule in Section 1:', createRuleRes.status, createRuleRes.body);
    }
    assert(createRuleRes.status === 201, 'Rule created via REST API with 201 Created');
    const ruleId = createRuleRes.body?.id;
    assert(ruleId > 0, `Rule ID assigned: #${ruleId}`);
    assert(createRuleRes.body?.is_active === 1, 'Rule is active by default');

    // 2. Setup a test sprint with status DRAFT and trigger SPRINT_STARTED via real service call
    const sprintInsert = execute(
      `INSERT INTO sprints (name, project_id, status, start_date, end_date, created_by, created_at, updated_at)
       VALUES (?, ?, 'DRAFT', date('now'), date('now', '+14 days'), ?, datetime('now'), datetime('now'));`,
      ['Sprint Alpha Integration', project.id, adminAuth.user.id]
    );
    const sprintId = sprintInsert.lastInsertRowid;

    // Start sprint via sprintService (triggers fireTrigger SPRINT_STARTED)
    const startedSprint = sprintService.startSprint(sprintId, adminAuth.user.id);
    assert(startedSprint.status === 'ACTIVE', 'Sprint status transitioned to ACTIVE via sprintService');

    // 3. Verify automation queue entry was created
    const queueItem = queryOne(
      'SELECT * FROM automation_queue WHERE automation_id = ? AND trigger_event = ? ORDER BY id DESC LIMIT 1;',
      [ruleId, 'SPRINT_STARTED']
    );
    assert(queueItem !== null && queueItem !== undefined, 'Queue entry successfully created for SPRINT_STARTED trigger');
    assert(queueItem.status === 'QUEUED', 'Queue entry status is QUEUED');

    // 4. Run queue batch processor
    const batchResult = await automationEngine.processQueueBatch(10);
    assert(batchResult.processed >= 1, `Queue batch processed at least 1 job (processed: ${batchResult.processed})`);

    // 5. Verify queue item transitioned to DONE
    const updatedQueueItem = queryOne('SELECT * FROM automation_queue WHERE id = ?;', [queueItem.id]);
    assert(updatedQueueItem.status === 'DONE', 'Queue item status transitioned to DONE');

    // 6. Verify run log recorded
    const runLog = queryOne(
      'SELECT * FROM automation_run_log WHERE automation_id = ? AND overall_status = ? ORDER BY id DESC LIMIT 1;',
      [ruleId, 'SUCCESS']
    );
    assert(runLog !== null && runLog !== undefined, 'Automation run log created with overall_status SUCCESS');
    assert(Number(runLog.trigger_source_id) === Number(sprintId), `Run log tracks trigger source ID (${sprintId})`);

    // Verify conditions evaluated in runLog
    const condLogs = JSON.parse(runLog.conditions_evaluated || '[]');
    assert(condLogs.length >= 1, 'Condition evaluations recorded in run log');
    assert(condLogs[0].passed === true, 'Condition evaluated to PASS');

    // Verify actions executed in runLog
    const actionLogs = JSON.parse(runLog.actions_executed || '[]');
    assert(actionLogs.length === 2, '2 action executions recorded in run log');
    assert(actionLogs[0].status === 'SUCCESS', 'Action #1 (send_notification) succeeded');
    assert(actionLogs[1].status === 'SUCCESS', 'Action #2 (create_backlog_item) succeeded');

    // 7. Verify real DB mutation: notification created
    const notification = queryOne(
      'SELECT * FROM notifications WHERE message LIKE ? ORDER BY created_at DESC LIMIT 1;',
      [`%Sprint #${sprintId} has officially started.%`]
    );
    assert(notification !== null && notification !== undefined, 'Notification created in DB with resolved template variables');
    assert(notification.message.includes(`Sprint #${sprintId}`), `Notification message includes resolved sprint #${sprintId}`);

    // 8. Verify real DB mutation: backlog item created
    const backlogItem = queryOne(
      'SELECT * FROM backlog_items WHERE title = ? ORDER BY id DESC LIMIT 1;',
      ['Automated Kickoff for Sprint Alpha Integration']
    );
    assert(backlogItem !== null && backlogItem !== undefined, 'Backlog item created in DB with resolved sprint name');
    assert(backlogItem.priority === 'HIGH', 'Backlog item created with priority HIGH');

    // 9. Verify variable store populated
    const varRows = queryAll('SELECT * FROM automation_variable_store WHERE run_log_id = ?;', [runLog.id]);
    assert(varRows.length > 0, `Variable store recorded ${varRows.length} resolved template variables`);
    const sprintNameVar = varRows.find(v => v.variable_name === 'sprint.name' || v.variable_name === 'sprint_name');
    assert(sprintNameVar && sprintNameVar.variable_value === 'Sprint Alpha Integration', 'Variable store resolved {{ sprint.name }} correctly');

    // -----------------------------------------------------------------
    // SECTION 2: Circular Automation Detection & Chain Depth Limits
    // -----------------------------------------------------------------
    console.log('\n--- Section 2: Circular Loop Detection & Chain Depth Safeguards ---');

    // Test direct 2-Hop circular loop: Rule A (SPRINT_COMPLETED -> starts sprint) and Rule B (SPRINT_STARTED -> completes sprint)
    const ruleA = {
      id: 901,
      name: 'Loop Rule A',
      trigger_event: 'SPRINT_COMPLETED',
      actions: JSON.stringify([
        { action: 'UPDATE_FIELD', params: { entity_type: 'SPRINT', new_status: 'ACTIVE' } }
      ]),
      is_active: 1
    };
    const ruleB = {
      id: 902,
      name: 'Loop Rule B',
      trigger_event: 'SPRINT_STARTED',
      actions: JSON.stringify([
        { action: 'COMPLETE_SPRINT' }
      ]),
      is_active: 1
    };

    const circ2 = automationEngine.detectCircularDependency(ruleB, [ruleA]);
    assert(circ2.circular === true, 'DFS cycle detector identifies direct circular loop (A -> B -> A)');
    assert(circ2.reason.includes('Circular automation loop detected'), 'Descriptive loop detection message returned');

    // Test Chain Depth (> 5 levels)
    const deepChainRules = [
      { id: 801, trigger_event: 'E1', actions: JSON.stringify([{ action: 'CREATE_BACKLOG_ITEM' }]), is_active: 1 },
      { id: 802, trigger_event: 'ITEM_CREATED', actions: JSON.stringify([{ action: 'ASSIGN_MEMBER' }]), is_active: 1 },
      { id: 803, trigger_event: 'ITEM_ASSIGNED', actions: JSON.stringify([{ action: 'CREATE_GITHUB_BRANCH' }]), is_active: 1 },
      { id: 804, trigger_event: 'BRANCH_CREATED', actions: JSON.stringify([{ action: 'MOVE_ITEM_TO_BACKLOG' }]), is_active: 1 },
      { id: 805, trigger_event: 'SPRINT_ITEM_MOVED_TO_BACKLOG', actions: JSON.stringify([{ action: 'COMPLETE_SPRINT' }]), is_active: 1 },
      { id: 806, trigger_event: 'SPRINT_COMPLETED', actions: JSON.stringify([{ action: 'CREATE_GANTT_ITEM' }]), is_active: 1 }
    ];
    const circDepth = automationEngine.detectCircularDependency(
      { id: 800, trigger_event: 'START_E0', actions: JSON.stringify([{ action: 'CREATE_BACKLOG_ITEM' }]), is_active: 1 },
      deepChainRules
    );
    assert(circDepth !== null && (circDepth.circular || circDepth.maxDepthExceeded), 'Chain depth validator halts deep chains beyond limit');

    // Test real API rejection of circular rule save
    // Insert ruleA as active
    const savedRuleA = execute(
      `INSERT INTO automation_rules (
         name, project_id, scope, is_active, trigger_module, trigger_event,
         trigger_conditions, condition_logic, actions, created_by, created_at, updated_at
       ) VALUES (
         'Persistent Loop Rule A', ?, 'PROJECT', 1, 'SPRINT', 'SPRINT_COMPLETED',
         '[]', 'AND', ?, ?, datetime('now'), datetime('now')
       );`,
      [project.id, JSON.stringify([{ action: 'UPDATE_FIELD', params: { entity_type: 'SPRINT', new_status: 'ACTIVE' } }]), adminAuth.user.id]
    ).lastInsertRowid;

    // Attempt to save ruleB via REST API -> must be rejected with 400
    const circularApiRes = await api('/api/automation/rule/create', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        name: 'Persistent Loop Rule B Attempt',
        trigger_module: 'SPRINT',
        trigger_event: 'SPRINT_STARTED',
        scope: 'PROJECT',
        project_id: project.id,
        actions: [
          {
            action_type: 'complete_sprint',
            params: { sprint_id: 1 }
          }
        ]
      })
    });
    assert(circularApiRes.status === 400, 'Saving circular automation rule via REST API rejected with 400 Bad Request');
    assert(circularApiRes.body.error.includes('Circular automation loop detected'), 'API error response details circular loop detection');

    // Clean up temporary ruleA
    execute('DELETE FROM automation_rules WHERE id = ?;', [savedRuleA]);

    // -----------------------------------------------------------------
    // SECTION 3: Rate Limiting & Queue Backpressure Protection
    // -----------------------------------------------------------------
    console.log('\n--- Section 3: Rate Limiting & Backpressure Protection ---');

    // Rapid-fire triggers on the rule
    let deferCount = 0;
    for (let i = 0; i < 15; i++) {
      const fireRes = automationEngine.fireTrigger({
        module: 'SPRINT',
        event: 'SPRINT_STARTED',
        sourceType: 'sprint',
        sourceId: String(sprintId),
        userId: adminAuth.user.id,
        projectId: project.id,
        data: { sprint: { name: 'Rate Limit Test Sprint', id: sprintId } }
      });
      if (fireRes && fireRes.queue_ids && fireRes.queue_ids.length > 0) {
        const qId = fireRes.queue_ids[0];
        const item = queryOne("SELECT scheduled_at, datetime('now') as now_str FROM automation_queue WHERE id = ?;", [qId]);
        if (item && item.scheduled_at > item.now_str) {
          deferCount++;
        }
      }
    }
    assert(deferCount > 0, `Rate limiter deferred ${deferCount} excess fires beyond 10/min threshold into future timestamps`);

    // -----------------------------------------------------------------
    // SECTION 4: Dry-Run Simulation (Guaranteed Zero DB Mutation)
    // -----------------------------------------------------------------
    console.log('\n--- Section 4: Dry-Run Testing Simulation ---');

    const preQueueCount = queryOne('SELECT COUNT(*) as c FROM automation_queue;').c;
    const preLogCount = queryOne('SELECT COUNT(*) as c FROM automation_run_log;').c;
    const preNotifCount = queryOne('SELECT COUNT(*) as c FROM notifications;').c;

    const dryRunRes = await api(`/api/automation/rule/${ruleId}/test`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        mock_trigger_data: {
          sprint: {
            name: 'Simulated Non-Persistent Sprint',
            id: 8888
          },
          user_id: 42
        }
      })
    });

    assert(dryRunRes.status === 200, 'Dry-run endpoint returns 200 OK');
    assert(dryRunRes.body.conditions_evaluated.length >= 1, 'Dry-run evaluated rule conditions');
    assert(dryRunRes.body.conditions_passed === true || dryRunRes.body.conditions_passed === 1, 'Dry-run conditions passed');
    assert(dryRunRes.body.actions_resolved.length === 2, 'Dry-run simulated 2 actions');
    assert(dryRunRes.body.actions_resolved[0].rendered_params.title.includes('Simulated Non-Persistent Sprint'), 'Dry-run rendered template variables');

    // Verify ZERO mutations occurred in the DB
    const postQueueCount = queryOne('SELECT COUNT(*) as c FROM automation_queue;').c;
    const postLogCount = queryOne('SELECT COUNT(*) as c FROM automation_run_log;').c;
    const postNotifCount = queryOne('SELECT COUNT(*) as c FROM notifications;').c;

    assert(postQueueCount === preQueueCount, 'Dry-run created 0 queue entries (verified zero DB mutation)');
    assert(postLogCount === preLogCount, 'Dry-run created 0 run logs (verified zero DB mutation)');
    assert(postNotifCount === preNotifCount, 'Dry-run created 0 notifications (verified zero real dispatches)');

    // -----------------------------------------------------------------
    // SECTION 5: AI Suggestion Approval Flow
    // -----------------------------------------------------------------
    console.log('\n--- Section 5: AI Suggestion Approval Flow ---');

    // 1. Get pending suggestions
    const suggListRes = await api('/api/automation/suggestions', {
      method: 'GET',
      headers: adminHeaders
    });
    assert(suggListRes.status === 200, 'GET /api/automation/suggestions returns 200 OK');
    assert(Array.isArray(suggListRes.body), 'Suggestions returned as array');

    // Insert a fresh test suggestion
    const insertSugg = execute(
      `INSERT INTO automation_ai_suggestions (
         suggested_name, suggested_description, suggested_trigger_module, suggested_trigger_event,
         suggested_conditions, suggested_actions, status, created_at
       ) VALUES (
         'Auto-Notify Product Lead on Stage Complete',
         'Suggested by workflow optimization analyzer',
         'PIPELINE',
         'PIPELINE_STAGE_COMPLETED',
         '[]',
         '[{"action_type":"send_notification","params":{"recipient_type":"admin","title":"Stage Complete","message":"Pipeline progressed"}}]',
         'PENDING',
         datetime('now')
       );`
    );
    const suggId = insertSugg.lastInsertRowid;

    // Member attempt to approve must be rejected (403)
    const memApprove = await api(`/api/automation/suggestion/${suggId}/approve`, {
      method: 'PATCH',
      headers: memberHeaders
    });
    assert(memApprove.status === 403, 'Member approval of AI suggestion blocked with 403 Forbidden');

    // Admin approves suggestion
    const adminApprove = await api(`/api/automation/suggestion/${suggId}/approve`, {
      method: 'PATCH',
      headers: adminHeaders
    });
    assert(adminApprove.status === 200, 'Admin approval returns 200 OK');
    assert(adminApprove.body.suggestion.status === 'APPROVED', 'Suggestion status marked APPROVED');
    assert(adminApprove.body.created_rule_id > 0, `Real automation rule created from suggestion: #${adminApprove.body.created_rule_id}`);

    // Verify rule actually exists in DB
    const suggRule = queryOne('SELECT * FROM automation_rules WHERE id = ?;', [adminApprove.body.created_rule_id]);
    assert(suggRule !== null && suggRule.name === 'Auto-Notify Product Lead on Stage Complete', 'Verified real automation rule in automation_rules table');

    // -----------------------------------------------------------------
    // SECTION 6: Error Triage & Exponential Retry Lifecycle
    // -----------------------------------------------------------------
    console.log('\n--- Section 6: Error Triage & Retry Lifecycle ---');

    // 1. Create a rule with an invalid action to deliberately provoke execution fault
    const brokenRuleName = 'Failing Rule for Error Testing ' + Date.now();
    const brokenRuleRes = await api('/api/automation/rule/create', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        name: brokenRuleName,
        trigger_module: 'SPRINT',
        trigger_event: 'SPRINT_STARTED',
        scope: 'PROJECT',
        project_id: project.id,
        actions: [
          {
            action_type: 'assign_member',
            params: {
              target_entity: 'non_existent_table_target',
              target_id: 99999,
              user_id: 1
            }
          }
        ]
      })
    });
    const brokenRuleId = brokenRuleRes.body.id;

    // Enqueue job directly for broken rule
    const brokenQueueId = execute(
      `INSERT INTO automation_queue (
         automation_id, trigger_event, trigger_source_type, trigger_source_id,
         triggered_by_user_id, trigger_data, status, scheduled_at, attempts, max_attempts,
         created_at, updated_at
       ) VALUES (?, 'SPRINT_STARTED', 'sprint', '1', ?, '{}', 'QUEUED', datetime('now'), 0, 3, datetime('now'), datetime('now'));`,
      [brokenRuleId, adminAuth.user.id]
    ).lastInsertRowid;

    // Process batch to execute failing action
    await automationEngine.processQueueBatch(10);

    // Verify error was logged in automation_errors table
    const loggedError = queryOne(
      'SELECT * FROM automation_errors WHERE automation_id = ? ORDER BY id DESC LIMIT 1;',
      [brokenRuleId]
    );
    assert(loggedError !== null && loggedError !== undefined, 'Execution error recorded in automation_errors');
    assert(loggedError.error_type === 'ACTION_FAILED' || loggedError.error_type === 'ACTION_EXECUTION_FAILED', 'Error type indicates action failure');
    assert(loggedError.acknowledged_at === null, 'Error starts unacknowledged');

    // Acknowledge error via REST API
    const ackRes = await api(`/api/automation/error/${loggedError.id}/acknowledge`, {
      method: 'PATCH',
      headers: adminHeaders
    });
    assert(ackRes.status === 200, 'PATCH /api/automation/error/:id/acknowledge returns 200 OK');
    assert(ackRes.body.acknowledged_at !== null, 'acknowledged_at timestamp is set');
    assert(ackRes.body.acknowledged_by === adminAuth.user.id, 'acknowledged_by set to admin user ID');

    // Retry error via REST API
    const retryRes1 = await api(`/api/automation/error/${loggedError.id}/retry`, {
      method: 'PATCH',
      headers: adminHeaders
    });
    assert(retryRes1.status === 200, 'PATCH /api/automation/error/:id/retry returns 200 OK');
    assert(retryRes1.body.attempt === 1, 'Retry attempt 1 enqueued');

    const retryRes2 = await api(`/api/automation/error/${loggedError.id}/retry`, {
      method: 'PATCH',
      headers: adminHeaders
    });
    assert(retryRes2.status === 200, 'Retry attempt 2 enqueued');

    const retryRes3 = await api(`/api/automation/error/${loggedError.id}/retry`, {
      method: 'PATCH',
      headers: adminHeaders
    });
    assert(retryRes3.status === 200, 'Retry attempt 3 enqueued');

    // Attempt 4 must be rejected with 400
    const retryRes4 = await api(`/api/automation/error/${loggedError.id}/retry`, {
      method: 'PATCH',
      headers: adminHeaders
    });
    assert(retryRes4.status === 400, 'Attempting retry beyond max 3 attempts rejected with 400 Bad Request');
    assert(retryRes4.body.error.includes('Max 3 retries reached'), 'Error message clearly states Max 3 retries reached');

    // -----------------------------------------------------------------
    // SECTION 7: System Template Immutability Guard
    // -----------------------------------------------------------------
    console.log('\n--- Section 7: System Template Immutability Guard ---');

    // Find a system template
    const sysTpl = queryOne('SELECT * FROM automation_templates WHERE is_system_template = 1 LIMIT 1;');
    assert(sysTpl !== null, `Located system template #${sysTpl.id}: ${sysTpl.name}`);

    // Attempt to delete system template via REST API
    const delSysRes = await api(`/api/automation/template/${sysTpl.id}`, {
      method: 'DELETE',
      headers: adminHeaders
    });
    assert(delSysRes.status === 403, 'Deleting system template rejected with 403 Forbidden');
    assert(delSysRes.body.error.includes('System templates cannot be deleted'), 'Error confirms system template protection');

    // Create and delete a custom template
    const saveCustomRes = await api('/api/automation/template/save', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        name: 'Ephemeral Custom Blueprint',
        description: 'Temporary blueprint for deletion testing',
        category: 'GENERAL',
        trigger_module: 'SPRINT',
        trigger_event: 'SPRINT_STARTED',
        actions: [
          {
            action_type: 'send_notification',
            params: { recipient_type: 'admin', title: 'Test', message: 'Test' }
          }
        ]
      })
    });
    assert(saveCustomRes.status === 201, 'Custom template saved with 201 Created');
    const customTplId = saveCustomRes.body.id;

    const delCustomRes = await api(`/api/automation/template/${customTplId}`, {
      method: 'DELETE',
      headers: adminHeaders
    });
    assert(delCustomRes.status === 200, 'Custom template deleted with 200 OK');

    const verifyDeleted = queryOne('SELECT * FROM automation_templates WHERE id = ?;', [customTplId]);
    assert(verifyDeleted === null, 'Custom template row verified deleted from DB');

    // -----------------------------------------------------------------
    // SECTION 8: Frontend Views Verification Link Check
    // -----------------------------------------------------------------
    console.log('\n--- Section 8: Frontend Production Static Asset Serving ---');

    const staticViews = [
      '/automation-rules.html',
      '/automation-builder.html',
      '/automation-history.html',
      '/automation-errors.html',
      '/automation-templates.html'
    ];

    for (const viewUrl of staticViews) {
      const viewRes = await api(viewUrl);
      assert(viewRes.status === 200, `Static view served with 200 OK: ${viewUrl}`);
    }

  } finally {
    await new Promise((resolve) => server.close(resolve));
    console.log('\n[MASTER TEST SERVER] Server closed successfully');
  }

  // Final Summary
  console.log('\n' + '='.repeat(80));
  console.log(`MASTER INTEGRATION TEST SUMMARY: ${passed} Passed, ${failed} Failed`);
  console.log('='.repeat(80));

  if (failed > 0) {
    console.error('\n❌ MASTER INTEGRATION SUITE FAILED');
    process.exit(1);
  } else {
    console.log('\n🌟 ALL MASTER END-TO-END AUTOMATION ENGINE TESTS PASSED CLEANLY (100%)');
    process.exit(0);
  }
}

run().catch((err) => {
  console.error('Fatal execution error:', err);
  process.exit(1);
});
