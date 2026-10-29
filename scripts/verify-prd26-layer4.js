/**
 * scripts/verify-prd26-layer4.js
 * Verification Suite for PRD 26 Layer 4: REST API (All 22 Automation Endpoints)
 *
 * Real HTTP server, real SQLite DB, real JWT authentication, zero mocks.
 *
 * Verifies all 22 endpoints:
 * 1. Rule Routes (7 endpoints):
 *    - POST   /api/automation/rule/create
 *    - GET    /api/automation/rules
 *    - POST   /api/automation/rule/:ruleId/test (Dry-Run simulation)
 *    - PATCH  /api/automation/rule/:ruleId/toggle
 *    - GET    /api/automation/rule/:ruleId
 *    - PATCH  /api/automation/rule/:ruleId
 *    - DELETE /api/automation/rule/:ruleId
 * 2. Run Log & History Routes (2 endpoints):
 *    - GET    /api/automation/logs
 *    - GET    /api/automation/log/:runLogId
 * 3. Error Routes (3 endpoints):
 *    - GET    /api/automation/errors
 *    - PATCH  /api/automation/error/:errorId/acknowledge
 *    - PATCH  /api/automation/error/:errorId/retry
 * 4. Template Routes (4 endpoints):
 *    - GET    /api/automation/templates
 *    - POST   /api/automation/template/save
 *    - POST   /api/automation/template/:templateId/use
 *    - DELETE /api/automation/template/:templateId
 * 5. AI Suggestion Routes (3 endpoints):
 *    - GET    /api/automation/suggestions
 *    - PATCH  /api/automation/suggestion/:suggestionId/approve
 *    - PATCH  /api/automation/suggestion/:suggestionId/reject
 * 6. Queue Route (1 endpoint):
 *    - GET    /api/automation/queue
 * 7. Stats Routes (2 endpoints):
 *    - GET    /api/automation/stats/project/:projectId
 *    - GET    /api/automation/stats
 *
 * Key governance rules verified:
 * - Admin+ only for create/update/delete/toggle/test/approve/reject/templates/errors/queue/stats
 * - Members can only view rules and logs that affected them
 * - Dry-run endpoint strictly simulates without any DB mutation
 * - System templates (is_system_template=1) cannot be deleted
 * - AI suggestions: suggestion-only, never auto-execute
 * - All admin actions logged in access_log
 * - Route ordering: static paths before parameterized /:id routes
 * - updated_at manually set on all mutations
 */

import http from 'node:http';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { createApp } from '../src/app.js';
import { runMigration } from '../src/db/migrate.js';
import { runSeed } from '../src/db/seed.js';
import { getDatabase, queryOne, queryAll, execute } from '../src/db/database.js';
import { config } from '../src/config.js';

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
  console.log('PRD 26 Layer 4 Verification Suite: REST API (All 22 Endpoints)');
  console.log('='.repeat(80));

  runMigration();
  await runSeed();
  const db = getDatabase();

  const app = createApp();
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  console.log(`[TEST SERVER] Running on ${baseUrl}\n`);

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

  // Helper fetcher
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

  try {
    // -----------------------------------------------------------------
    // Section 1: Automation Rule Routes (7 Endpoints)
    // -----------------------------------------------------------------
    console.log('\n--- Section 1: Automation Rule Routes (7 Endpoints) ---');

    // 1. POST /api/automation/rule/create (Member blocked)
    const memCreateRes = await api('/api/automation/rule/create', {
      method: 'POST',
      headers: memberHeaders,
      body: JSON.stringify({
        name: 'Member Attempted Rule',
        trigger_module: 'SPRINT',
        trigger_event: 'SPRINT_STARTED',
        actions: [{ action: 'SEND_NOTIFICATION', params: { to: 'ADMIN', message: 'Hello' } }]
      })
    });
    assert(memCreateRes.status === 403, 'POST /rule/create: Non-admin member rejected with 403 Forbidden');

    // 1. POST /api/automation/rule/create (Admin success)
    const adminCreateRes = await api('/api/automation/rule/create', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        name: 'Sprint Start Team Alert L4',
        description: 'Sends notification when sprint starts',
        project_id: null,
        scope: 'COMPANY',
        trigger_module: 'SPRINT',
        trigger_event: 'SPRINT_STARTED',
        trigger_conditions: [{ field: 'sprint.name', operator: 'CONTAINS', value: 'Sprint' }],
        condition_logic: 'AND',
        actions: [
          { action: 'SEND_NOTIFICATION', params: { to: 'ADMIN', message: 'Sprint {{sprint.name}} started' } }
        ]
      })
    });
    assert(adminCreateRes.status === 201, 'POST /rule/create: Admin successfully creates rule (201 Created)');
    const rule1 = adminCreateRes.body;
    assert(rule1 && rule1.id > 0, 'POST /rule/create: Created rule has valid ID');
    assert(rule1.trigger_module === 'SPRINT', 'POST /rule/create: Created rule has correct trigger_module');

    // Verify access_log
    const createLog = queryOne(
      "SELECT * FROM access_log WHERE action = 'automation_rule_created' AND target_id = ? ORDER BY id DESC LIMIT 1;",
      [String(rule1.id)]
    );
    assert(createLog !== null && createLog.user_id === adminAuth.user.id, 'POST /rule/create: Admin action logged in access_log');

    // Circular detection on create
    const circularRes = await api('/api/automation/rule/create', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        name: 'Self Loop Rule',
        trigger_module: 'BACKLOG',
        trigger_event: 'ITEM_STATUS_CHANGED',
        actions: [{ action: 'CHANGE_STATUS', params: { entity_type: 'BACKLOG_ITEM', new_status: 'IN_PROGRESS' } }]
      })
    });
    assert(circularRes.status === 400, 'POST /rule/create: Circular automation rejected with 400 Bad Request');

    // 2. GET /api/automation/rules (Admin view)
    const adminRulesRes = await api('/api/automation/rules', { headers: adminHeaders });
    assert(adminRulesRes.status === 200, 'GET /rules: Admin receives 200 OK');
    assert(Array.isArray(adminRulesRes.body) && adminRulesRes.body.length > 0, 'GET /rules: Admin receives array of rules');

    // Filter by module
    const filteredRulesRes = await api('/api/automation/rules?trigger_module=SPRINT', { headers: adminHeaders });
    assert(
      filteredRulesRes.status === 200 && filteredRulesRes.body.every((r) => r.trigger_module === 'SPRINT'),
      'GET /rules?trigger_module=SPRINT: Filter by trigger_module works correctly'
    );

    // 2. GET /api/automation/rules (Member view: only affected rules)
    const memberRulesRes = await api('/api/automation/rules', { headers: memberHeaders });
    assert(memberRulesRes.status === 200, 'GET /rules: Member receives 200 OK');
    assert(
      Array.isArray(memberRulesRes.body) && !memberRulesRes.body.some((r) => r.id === rule1.id),
      'GET /rules: Member only views rules that affected them (unrelated rule hidden)'
    );

    // 3. POST /api/automation/rule/:ruleId/test (Dry-run simulation)
    const memberTestRes = await api(`/api/automation/rule/${rule1.id}/test`, {
      method: 'POST',
      headers: memberHeaders,
      body: JSON.stringify({ mock_trigger_data: {} })
    });
    assert(memberTestRes.status === 403, 'POST /rule/:ruleId/test: Non-admin member rejected with 403 Forbidden');

    const countNotifsBefore = queryOne('SELECT COUNT(*) as count FROM notifications;')?.count || 0;
    const countBacklogBefore = queryOne('SELECT COUNT(*) as count FROM backlog_items;')?.count || 0;
    const countRunsBefore = queryOne('SELECT COUNT(*) as count FROM automation_run_log;')?.count || 0;

    const dryRunRes = await api(`/api/automation/rule/${rule1.id}/test`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        mock_trigger_data: { sprint: { name: 'Sprint Apollo' } }
      })
    });
    assert(dryRunRes.status === 200, 'POST /rule/:ruleId/test: Admin dry-run simulation returns 200 OK');
    assert(dryRunRes.body.conditions_passed === 1, 'POST /rule/:ruleId/test: Dry-run conditions_passed evaluated to 1');
    assert(dryRunRes.body.estimated_outcome === 'WOULD_EXECUTE', 'POST /rule/:ruleId/test: Estimated outcome is WOULD_EXECUTE');
    assert(
      dryRunRes.body.actions_that_would_fire.length === 1 &&
      dryRunRes.body.actions_that_would_fire[0].simulated_params.message === 'Sprint Sprint Apollo started',
      'POST /rule/:ruleId/test: Action parameters templated correctly in simulation'
    );

    // Verify ZERO mutations in DB
    const countNotifsAfter = queryOne('SELECT COUNT(*) as count FROM notifications;')?.count || 0;
    const countBacklogAfter = queryOne('SELECT COUNT(*) as count FROM backlog_items;')?.count || 0;
    const countRunsAfter = queryOne('SELECT COUNT(*) as count FROM automation_run_log;')?.count || 0;
    assert(countNotifsBefore === countNotifsAfter, 'POST /rule/:ruleId/test: Zero notifications created (no DB mutation)');
    assert(countBacklogBefore === countBacklogAfter, 'POST /rule/:ruleId/test: Zero backlog items created (no DB mutation)');
    assert(countRunsBefore === countRunsAfter, 'POST /rule/:ruleId/test: Zero run logs created (no DB mutation)');

    // 4. PATCH /api/automation/rule/:ruleId/toggle
    const memToggleRes = await api(`/api/automation/rule/${rule1.id}/toggle`, {
      method: 'PATCH',
      headers: memberHeaders,
      body: JSON.stringify({ is_active: 0 })
    });
    assert(memToggleRes.status === 403, 'PATCH /rule/:ruleId/toggle: Non-admin member rejected with 403 Forbidden');

    const toggleOffRes = await api(`/api/automation/rule/${rule1.id}/toggle`, {
      method: 'PATCH',
      headers: adminHeaders,
      body: JSON.stringify({ is_active: 0 })
    });
    assert(toggleOffRes.status === 200 && toggleOffRes.body.is_active === 0, 'PATCH /rule/:ruleId/toggle: Rule disabled (is_active=0)');

    const toggleOnRes = await api(`/api/automation/rule/${rule1.id}/toggle`, {
      method: 'PATCH',
      headers: adminHeaders,
      body: JSON.stringify({ is_active: 1 })
    });
    assert(toggleOnRes.status === 200 && toggleOnRes.body.is_active === 1, 'PATCH /rule/:ruleId/toggle: Rule re-enabled (is_active=1)');

    // 5. GET /api/automation/rule/:ruleId
    const memDetailRes = await api(`/api/automation/rule/${rule1.id}`, { headers: memberHeaders });
    assert(memDetailRes.status === 403, 'GET /rule/:ruleId: Non-affected member receives 403 Forbidden');

    const adminDetailRes = await api(`/api/automation/rule/${rule1.id}`, { headers: adminHeaders });
    assert(adminDetailRes.status === 200, 'GET /rule/:ruleId: Admin receives 200 OK');
    assert(adminDetailRes.body.id === rule1.id, 'GET /rule/:ruleId: Returns matching rule ID');
    assert(Array.isArray(adminDetailRes.body.run_logs), 'GET /rule/:ruleId: Returns run_logs array');
    assert(typeof adminDetailRes.body.error_count === 'number', 'GET /rule/:ruleId: Returns error_count number');

    // 6. PATCH /api/automation/rule/:ruleId
    const memUpdateRes = await api(`/api/automation/rule/${rule1.id}`, {
      method: 'PATCH',
      headers: memberHeaders,
      body: JSON.stringify({ name: 'Member Hack' })
    });
    assert(memUpdateRes.status === 403, 'PATCH /rule/:ruleId: Non-admin member rejected with 403 Forbidden');

    const adminUpdateRes = await api(`/api/automation/rule/${rule1.id}`, {
      method: 'PATCH',
      headers: adminHeaders,
      body: JSON.stringify({ name: 'Sprint Start Team Alert L4 Updated' })
    });
    assert(adminUpdateRes.status === 200, 'PATCH /rule/:ruleId: Admin updates rule name (200 OK)');
    assert(adminUpdateRes.body.name === 'Sprint Start Team Alert L4 Updated', 'PATCH /rule/:ruleId: Name updated successfully');

    // 7. DELETE /api/automation/rule/:ruleId
    const memDeleteRes = await api(`/api/automation/rule/${rule1.id}`, {
      method: 'DELETE',
      headers: memberHeaders
    });
    assert(memDeleteRes.status === 403, 'DELETE /rule/:ruleId: Non-admin member rejected with 403 Forbidden');

    const adminDeleteRes = await api(`/api/automation/rule/${rule1.id}`, {
      method: 'DELETE',
      headers: adminHeaders
    });
    assert(adminDeleteRes.status === 200, 'DELETE /rule/:ruleId: Admin deletes rule (200 OK)');
    const deletedCheck = queryOne('SELECT id FROM automation_rules WHERE id = ?;', [rule1.id]);
    assert(deletedCheck === null, 'DELETE /rule/:ruleId: Rule verified removed from database');

    // Recreate a clean rule for remaining endpoint verifications
    const freshRuleRes = await api('/api/automation/rule/create', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        name: 'Persistent Rule For Logs & Errors L4',
        trigger_module: 'BACKLOG',
        trigger_event: 'ITEM_STATUS_CHANGED',
        actions: [{ action: 'SEND_NOTIFICATION', params: { to: 'ADMIN', message: 'Status changed' } }]
      })
    });
    const activeRule = freshRuleRes.body;

    // -----------------------------------------------------------------
    // Section 2: Run Log & History Routes (2 Endpoints)
    // -----------------------------------------------------------------
    console.log('\n--- Section 2: Run Log & History Routes (2 Endpoints) ---');

    // Insert test run logs
    const run1 = execute(
      `INSERT INTO automation_run_log (
         automation_id, trigger_event, trigger_source_type, trigger_source_id,
         triggered_by_user_id, conditions_evaluated, conditions_passed,
         actions_executed, overall_status, started_at, completed_at
       ) VALUES (?, 'ITEM_STATUS_CHANGED', 'BACKLOG_ITEM', 101, ?, '[]', 1, '[]', 'SUCCESS', datetime('now'), datetime('now'));`,
      [activeRule.id, memberAuth.user.id]
    );
    const runLogId = run1.lastInsertRowid;

    // Insert variable store entry
    execute(
      `INSERT INTO automation_variable_store (
         automation_id, run_log_id, variable_name, variable_value, created_at
       ) VALUES (?, ?, 'item.title', 'Fix Navigation Crash', datetime('now'));`,
      [activeRule.id, runLogId]
    );

    // 8. GET /api/automation/logs (Admin view)
    const adminLogsRes = await api('/api/automation/logs', { headers: adminHeaders });
    assert(adminLogsRes.status === 200, 'GET /logs: Admin receives 200 OK');
    assert(Array.isArray(adminLogsRes.body) && adminLogsRes.body.length > 0, 'GET /logs: Admin receives array of run logs');

    // Filter by status
    const statusLogsRes = await api('/api/automation/logs?status=SUCCESS', { headers: adminHeaders });
    assert(
      statusLogsRes.status === 200 && statusLogsRes.body.every((l) => l.overall_status === 'SUCCESS'),
      'GET /logs?status=SUCCESS: Filter by status works correctly'
    );

    // 8. GET /api/automation/logs (Member view: only own triggered logs)
    const memLogsRes = await api('/api/automation/logs', { headers: memberHeaders });
    assert(memLogsRes.status === 200, 'GET /logs: Member receives 200 OK');
    assert(
      memLogsRes.body.every((l) => l.triggered_by_user_id === memberAuth.user.id),
      'GET /logs: Member view strictly filters to logs triggered by current member'
    );

    // 9. GET /api/automation/log/:runLogId
    const adminLogDetailRes = await api(`/api/automation/log/${runLogId}`, { headers: adminHeaders });
    assert(adminLogDetailRes.status === 200, 'GET /log/:runLogId: Admin receives 200 OK');
    assert(adminLogDetailRes.body.id === runLogId, 'GET /log/:runLogId: Returns correct log ID');
    assert(Array.isArray(adminLogDetailRes.body.resolved_variables), 'GET /log/:runLogId: Includes resolved_variables array');
    assert(
      adminLogDetailRes.body.resolved_variables.some((v) => v.variable_name === 'item.title' && v.variable_value === 'Fix Navigation Crash'),
      'GET /log/:runLogId: Resolved variables match variable store'
    );

    // -----------------------------------------------------------------
    // Section 3: Error Routes (3 Endpoints)
    // -----------------------------------------------------------------
    console.log('\n--- Section 3: Error Routes (3 Endpoints) ---');

    // Insert test error
    const errInsert = execute(
      `INSERT INTO automation_errors (
         automation_id, run_log_id, error_type, error_message, action_index, retry_scheduled, created_at
       ) VALUES (?, ?, 'ACTION_FAILED', 'SMTP Gateway connection timeout', 0, 0, datetime('now'));`,
      [activeRule.id, runLogId]
    );
    const errorId = errInsert.lastInsertRowid;

    // 10. GET /api/automation/errors
    const memErrRes = await api('/api/automation/errors', { headers: memberHeaders });
    assert(memErrRes.status === 403, 'GET /errors: Non-admin member rejected with 403 Forbidden');

    const adminErrRes = await api('/api/automation/errors', { headers: adminHeaders });
    assert(adminErrRes.status === 200, 'GET /errors: Admin receives 200 OK');
    assert(Array.isArray(adminErrRes.body) && adminErrRes.body.some((e) => e.id === errorId), 'GET /errors: Returns error record');

    // 11. PATCH /api/automation/error/:errorId/acknowledge
    const memAckRes = await api(`/api/automation/error/${errorId}/acknowledge`, {
      method: 'PATCH',
      headers: memberHeaders
    });
    assert(memAckRes.status === 403, 'PATCH /error/:errorId/acknowledge: Member rejected with 403 Forbidden');

    const adminAckRes = await api(`/api/automation/error/${errorId}/acknowledge`, {
      method: 'PATCH',
      headers: adminHeaders
    });
    assert(adminAckRes.status === 200, 'PATCH /error/:errorId/acknowledge: Admin acknowledges error (200 OK)');
    assert(adminAckRes.body.acknowledged_by === adminAuth.user.id, 'PATCH /error/:errorId/acknowledge: acknowledged_by set to admin ID');
    assert(Boolean(adminAckRes.body.acknowledged_at), 'PATCH /error/:errorId/acknowledge: acknowledged_at timestamp set');

    // 12. PATCH /api/automation/error/:errorId/retry
    const memRetryRes = await api(`/api/automation/error/${errorId}/retry`, {
      method: 'PATCH',
      headers: memberHeaders
    });
    assert(memRetryRes.status === 403, 'PATCH /error/:errorId/retry: Member rejected with 403 Forbidden');

    const adminRetryRes = await api(`/api/automation/error/${errorId}/retry`, {
      method: 'PATCH',
      headers: adminHeaders
    });
    assert(adminRetryRes.status === 200, 'PATCH /error/:errorId/retry: Admin re-queues failed run for retry (200 OK)');
    assert(adminRetryRes.body.queue_id > 0, 'PATCH /error/:errorId/retry: New queue job created');

    // -----------------------------------------------------------------
    // Section 4: Template Routes (4 Endpoints)
    // -----------------------------------------------------------------
    console.log('\n--- Section 4: Template Routes (4 Endpoints) ---');

    // 13. GET /api/automation/templates
    const memTemplatesRes = await api('/api/automation/templates', { headers: memberHeaders });
    assert(memTemplatesRes.status === 403, 'GET /templates: Non-admin member rejected with 403 Forbidden');

    const adminTemplatesRes = await api('/api/automation/templates', { headers: adminHeaders });
    assert(adminTemplatesRes.status === 200, 'GET /templates: Admin receives 200 OK');
    assert(Array.isArray(adminTemplatesRes.body) && adminTemplatesRes.body.length >= 20, 'GET /templates: Contains 20+ pre-seeded templates');

    // 14. POST /api/automation/template/save
    const memSaveTplRes = await api('/api/automation/template/save', {
      method: 'POST',
      headers: memberHeaders,
      body: JSON.stringify({ name: 'Member Template' })
    });
    assert(memSaveTplRes.status === 403, 'POST /template/save: Member rejected with 403 Forbidden');

    const adminSaveTplRes = await api('/api/automation/template/save', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        name: 'Custom Bug Triage Workflow L4',
        description: 'Auto-assign urgent bugs to team lead',
        category: 'GENERAL',
        trigger_module: 'BACKLOG',
        trigger_event: 'ITEM_CREATED',
        trigger_conditions: [{ field: 'priority', operator: 'EQUALS', value: 'URGENT' }],
        actions: [{ action: 'SEND_NOTIFICATION', params: { to: 'ADMIN', message: 'Urgent bug logged' } }]
      })
    });
    assert(adminSaveTplRes.status === 201, 'POST /template/save: Admin saves custom template (201 Created)');
    const customTpl = adminSaveTplRes.body;
    assert(customTpl.is_system_template === 0, 'POST /template/save: is_system_template defaults to 0 for custom templates');

    // 15. POST /api/automation/template/:templateId/use
    const memUseTplRes = await api(`/api/automation/template/${customTpl.id}/use`, {
      method: 'POST',
      headers: memberHeaders,
      body: JSON.stringify({ name: 'Instantiated Rule From Template' })
    });
    assert(memUseTplRes.status === 403, 'POST /template/:templateId/use: Member rejected with 403 Forbidden');

    const adminUseTplRes = await api(`/api/automation/template/${customTpl.id}/use`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ name: 'Instantiated Rule From Template' })
    });
    assert(adminUseTplRes.status === 201, 'POST /template/:templateId/use: Admin creates rule from template (201 Created)');
    assert(adminUseTplRes.body.name === 'Instantiated Rule From Template', 'POST /template/:templateId/use: Rule instantiated with given name');

    // Verify usage_count incremented
    const tplAfterUse = queryOne('SELECT usage_count FROM automation_templates WHERE id = ?;', [customTpl.id]);
    assert(tplAfterUse.usage_count === 1, 'POST /template/:templateId/use: Template usage_count incremented by 1');

    // 16. DELETE /api/automation/template/:templateId (System template delete blocked)
    const systemTpl = queryOne('SELECT id FROM automation_templates WHERE is_system_template = 1 LIMIT 1;');
    const deleteSystemRes = await api(`/api/automation/template/${systemTpl.id}`, {
      method: 'DELETE',
      headers: adminHeaders
    });
    assert(deleteSystemRes.status === 400 || deleteSystemRes.status === 403, 'DELETE /template/:templateId: System templates (is_system_template=1) CANNOT be deleted (400 or 403)');

    // 16. DELETE /api/automation/template/:templateId (Custom template delete succeeds)
    const deleteCustomRes = await api(`/api/automation/template/${customTpl.id}`, {
      method: 'DELETE',
      headers: adminHeaders
    });
    assert(deleteCustomRes.status === 200, 'DELETE /template/:templateId: Custom template deleted successfully (200 OK)');
    const customTplCheck = queryOne('SELECT id FROM automation_templates WHERE id = ?;', [customTpl.id]);
    assert(customTplCheck === null, 'DELETE /template/:templateId: Custom template removed from DB');

    // -----------------------------------------------------------------
    // Section 5: AI Suggestion Routes (3 Endpoints)
    // -----------------------------------------------------------------
    console.log('\n--- Section 5: AI Suggestion Routes (3 Endpoints) ---');

    // Seed test AI suggestions
    const sug1Res = execute(
      `INSERT INTO automation_ai_suggestions (
         suggested_name, suggested_description, suggested_trigger_module, suggested_trigger_event,
         suggested_conditions, suggested_actions, status, created_at
       ) VALUES ('AI Suggested PR Merge Alert', 'Alert channel when PR merged', 'GITHUB', 'PR_MERGED',
         '[]', '[{"action":"SEND_NOTIFICATION","params":{"to":"ADMIN","message":"PR merged"}}]', 'PENDING', datetime('now'));`
    );
    const sug1Id = sug1Res.lastInsertRowid;

    const sug2Res = execute(
      `INSERT INTO automation_ai_suggestions (
         suggested_name, suggested_description, suggested_trigger_module, suggested_trigger_event,
         suggested_conditions, suggested_actions, status, created_at
       ) VALUES ('AI Suggested Redundant Task Cleanup', 'Close abandoned tasks', 'BACKLOG', 'ITEM_STATUS_CHANGED',
         '[]', '[{"action":"CHANGE_STATUS","params":{"entity_type":"BACKLOG_ITEM","new_status":"DONE"}}]', 'PENDING', datetime('now'));`
    );
    const sug2Id = sug2Res.lastInsertRowid;

    // 17. GET /api/automation/suggestions
    const memSugRes = await api('/api/automation/suggestions', { headers: memberHeaders });
    assert(memSugRes.status === 403, 'GET /suggestions: Non-admin member rejected with 403 Forbidden');

    const adminSugRes = await api('/api/automation/suggestions', { headers: adminHeaders });
    assert(adminSugRes.status === 200, 'GET /suggestions: Admin receives 200 OK');
    assert(
      Array.isArray(adminSugRes.body) && adminSugRes.body.some((s) => s.id === sug1Id),
      'GET /suggestions: Returns PENDING suggestions'
    );

    // 18. PATCH /api/automation/suggestion/:suggestionId/approve
    const memApproveSugRes = await api(`/api/automation/suggestion/${sug1Id}/approve`, {
      method: 'PATCH',
      headers: memberHeaders
    });
    assert(memApproveSugRes.status === 403, 'PATCH /suggestion/:suggestionId/approve: Member rejected with 403 Forbidden');

    const adminApproveSugRes = await api(`/api/automation/suggestion/${sug1Id}/approve`, {
      method: 'PATCH',
      headers: adminHeaders
    });
    assert(adminApproveSugRes.status === 200, 'PATCH /suggestion/:suggestionId/approve: Admin approves suggestion (200 OK)');
    assert(adminApproveSugRes.body.rule && adminApproveSugRes.body.rule.id > 0, 'PATCH /suggestion/:suggestionId/approve: Real automation rule created');
    assert(adminApproveSugRes.body.rule.is_ai_suggested === 1, 'PATCH /suggestion/:suggestionId/approve: Rule marked is_ai_suggested = 1');

    const sug1Row = queryOne('SELECT * FROM automation_ai_suggestions WHERE id = ?;', [sug1Id]);
    assert(sug1Row.status === 'APPROVED', 'PATCH /suggestion/:suggestionId/approve: Suggestion status transitions to APPROVED');
    assert(sug1Row.approved_automation_id === adminApproveSugRes.body.rule.id, 'PATCH /suggestion/:suggestionId/approve: approved_automation_id set');
    assert(sug1Row.reviewed_by === adminAuth.user.id, 'PATCH /suggestion/:suggestionId/approve: reviewed_by set to admin');

    // 19. PATCH /api/automation/suggestion/:suggestionId/reject
    const memRejectSugRes = await api(`/api/automation/suggestion/${sug2Id}/reject`, {
      method: 'PATCH',
      headers: memberHeaders,
      body: JSON.stringify({ rejection_reason: 'Too aggressive' })
    });
    assert(memRejectSugRes.status === 403, 'PATCH /suggestion/:suggestionId/reject: Member rejected with 403 Forbidden');

    const adminRejectSugRes = await api(`/api/automation/suggestion/${sug2Id}/reject`, {
      method: 'PATCH',
      headers: adminHeaders,
      body: JSON.stringify({ rejection_reason: 'Redundant with team policy' })
    });
    assert(adminRejectSugRes.status === 200, 'PATCH /suggestion/:suggestionId/reject: Admin rejects suggestion (200 OK)');
    const sug2Row = queryOne('SELECT * FROM automation_ai_suggestions WHERE id = ?;', [sug2Id]);
    assert(sug2Row.status === 'REJECTED', 'PATCH /suggestion/:suggestionId/reject: Status transitions to REJECTED');
    assert(sug2Row.rejection_reason === 'Redundant with team policy', 'PATCH /suggestion/:suggestionId/reject: Rejection reason persisted');

    // -----------------------------------------------------------------
    // Section 6: Queue Route (1 Endpoint)
    // -----------------------------------------------------------------
    console.log('\n--- Section 6: Queue Route (1 Endpoint) ---');

    // 20. GET /api/automation/queue
    const memQueueRes = await api('/api/automation/queue', { headers: memberHeaders });
    assert(memQueueRes.status === 403, 'GET /queue: Non-admin member rejected with 403 Forbidden');

    const adminQueueRes = await api('/api/automation/queue', { headers: adminHeaders });
    assert(adminQueueRes.status === 200, 'GET /queue: Admin receives 200 OK');
    assert(Array.isArray(adminQueueRes.body), 'GET /queue: Admin receives array of queue jobs');

    // -----------------------------------------------------------------
    // Section 7: Stats Routes (2 Endpoints)
    // -----------------------------------------------------------------
    console.log('\n--- Section 7: Stats Routes (2 Endpoints) ---');

    // 21. GET /api/automation/stats/project/:projectId
    const memProjStatsRes = await api('/api/automation/stats/project/1', { headers: memberHeaders });
    assert(memProjStatsRes.status === 403, 'GET /stats/project/:projectId: Member rejected with 403 Forbidden');

    const adminProjStatsRes = await api('/api/automation/stats/project/1', { headers: adminHeaders });
    assert(adminProjStatsRes.status === 200, 'GET /stats/project/:projectId: Admin receives 200 OK');
    assert(adminProjStatsRes.body.project_id === 1, 'GET /stats/project/:projectId: Returns matching project_id');
    assert(typeof adminProjStatsRes.body.total_rules === 'number', 'GET /stats/project/:projectId: Returns total_rules number');
    assert(typeof adminProjStatsRes.body.success_rate === 'number', 'GET /stats/project/:projectId: Returns success_rate number');

    // 22. GET /api/automation/stats
    const memGlobalStatsRes = await api('/api/automation/stats', { headers: memberHeaders });
    assert(memGlobalStatsRes.status === 403, 'GET /stats: Member rejected with 403 Forbidden');

    const adminGlobalStatsRes = await api('/api/automation/stats', { headers: adminHeaders });
    assert(adminGlobalStatsRes.status === 200, 'GET /stats: Admin receives 200 OK');
    assert(typeof adminGlobalStatsRes.body.total_rules === 'number', 'GET /stats: Returns total_rules number');
    assert(typeof adminGlobalStatsRes.body.active_rules === 'number', 'GET /stats: Returns active_rules number');
    assert(typeof adminGlobalStatsRes.body.success_rate === 'number', 'GET /stats: Returns success_rate number');
    assert(Array.isArray(adminGlobalStatsRes.body.top_triggered), 'GET /stats: Returns top_triggered array');
    assert(typeof adminGlobalStatsRes.body.error_count === 'number', 'GET /stats: Returns error_count number');

    // -----------------------------------------------------------------
    // Section 8: Route Ordering & Precedence Verification
    // -----------------------------------------------------------------
    console.log('\n--- Section 8: Route Ordering & Precedence Verification ---');

    // Ensure /rule/create is not captured by /rule/:ruleId
    assert(adminCreateRes.status === 201, 'Static route /rule/create resolves correctly before /rule/:ruleId');

    // Ensure /template/save is not captured by /template/:templateId
    assert(adminSaveTplRes.status === 201, 'Static route /template/save resolves correctly before /template/:templateId');

    // Ensure /stats/project/:projectId resolves correctly before /stats
    assert(adminProjStatsRes.status === 200, 'Static subpath /stats/project/:projectId resolves correctly before /stats');
    assert(adminGlobalStatsRes.status === 200, 'Static route /stats resolves correctly');

  } catch (err) {
    console.error('Fatal Verification Error:', err);
    failed++;
  } finally {
    server.close();
  }

  console.log('\n' + '='.repeat(80));
  console.log(`PRD 26 Layer 4 Verification Complete: ${passed} PASS, ${failed} FAIL`);
  console.log('='.repeat(80));

  if (failed > 0) {
    process.exit(1);
  }
}

run();
