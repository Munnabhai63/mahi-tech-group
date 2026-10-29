/**
 * scripts/verify-prd25-layer2.js
 * Verification Suite for PRD 25 Layer 2: Budget Service + API & Calculation Engine
 *
 * Real HTTP calls, Real SQLite database, Zero mocks.
 *
 * Checks:
 * 1. Database Connection & Pragmas (WAL mode, busy_timeout >= 5000, foreign_keys = ON)
 * 2. Express HTTP Server on ephemeral port (createApp)
 * 3. RBAC Enforcement: Unauthenticated (401) and Member (403) strictly blocked on all budget endpoints
 * 4. Budget Creation (POST /api/finance/budget/create):
 *    - Validations: missing project_id (400), non-existent project (404), negative budget (400),
 *      missing start_date (400), invalid budget_type (400), invalid threshold (400)
 *    - Valid creation returns 201 Created with clean budget payload
 *    - One budget per project rule strictly enforced (400 on duplicate)
 *    - Admin action logged to access_log
 * 5. Server-Side Budget Consumption Calculation Engine (GET /api/finance/budget/:projectId):
 *    - Zero consumption initial baseline
 *    - PENDING and REJECTED expenses strictly excluded from consumption
 *    - Non-billable and PENDING time entries strictly excluded from consumption
 *    - Only APPROVED expenses + APPROVED billable time entries count
 *    - Time cost = (duration_minutes / 60) * billable_rate accurately calculated
 *    - remaining_budget and consumed_pct accurate
 * 6. Dual-Tier Alert Auto-Trigger Engine:
 *    - THRESHOLD_REACHED auto-triggered when consumed_pct >= alert_threshold_pct
 *    - BUDGET_EXCEEDED auto-triggered when consumed_pct >= 100%
 *    - Active alerts returned in GET /api/finance/budget/:projectId
 * 7. Budget Update & History Audit Trail (PATCH /api/finance/budget/:projectId):
 *    - Missing reason rejected with 400 Bad Request
 *    - Short reason (< 10 chars) rejected with 400 Bad Request
 *    - Valid update records every altered field to append-only budget_history
 *    - updated_at manually set on budget mutation
 *    - Admin action logged to access_log
 * 8. Budget History Retrieval (GET /api/finance/budget/:projectId/history):
 *    - Returns complete history with changer details (name, email)
 *    - Preserves exact old_value, new_value, and reason
 */

import http from 'node:http';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app.js';
import { queryOne, queryAll, execute, getDatabase } from '../src/db/database.js';
import { config } from '../src/config.js';

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(condition, message, details = '') {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  \x1b[32m✔ PASS:\x1b[0m Test ${totalTests}: ${message}`);
  } else {
    failedTests++;
    console.error(`  \x1b[31m✖ FAIL:\x1b[0m Test ${totalTests}: ${message}`);
    if (details) console.error(`    \x1b[33mDetails: ${details}\x1b[0m`);
    process.exitCode = 1;
  }
}

// HTTP request helper
function makeRequest(serverUrl, path, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, serverUrl);
    const reqOptions = {
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    };

    const req = http.request(url, reqOptions, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        let parsed = null;
        try {
          parsed = JSON.parse(body);
        } catch (e) {
          parsed = body;
        }
        resolve({
          status: res.statusCode,
          headers: res.headers,
          data: parsed
        });
      });
    });

    req.on('error', reject);

    if (options.body) {
      const payload = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
      req.write(payload);
    }
    req.end();
  });
}

// Generate valid internal user token with DB session
function generateInternalUserToken(user) {
  const sessionId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 2 * 3600 * 1000).toISOString();

  const token = jwt.sign(
    {
      sessionId,
      userId: user.id,
      role: user.role,
      email: user.email,
      name: user.name
    },
    config.JWT_SECRET,
    { expiresIn: '2h' }
  );

  execute(
    'INSERT INTO sessions (id, user_id, token, expires_at, is_revoked, created_at) VALUES (?, ?, ?, ?, 0, CURRENT_TIMESTAMP)',
    [sessionId, user.id, token, expiresAt]
  );

  return token;
}

async function runSuite() {
  console.log('='.repeat(80));
  console.log('PRD 25 Layer 2 Verification Suite: Budget Service + API & Calculation Engine');
  console.log('='.repeat(80));

  const db = getDatabase();

  // ---------------------------------------------------------
  // Step 1: Database Pragmas
  // ---------------------------------------------------------
  console.log('\n--- Step 1: Database Pragmas Verification ---');
  const journalMode = queryOne('PRAGMA journal_mode;');
  assert(journalMode?.journal_mode?.toLowerCase() === 'wal', 'SQLite WAL mode enabled');

  const busyTimeout = queryOne('PRAGMA busy_timeout;');
  assert(Number(busyTimeout?.timeout) >= 5000, 'busy_timeout is >= 5000ms');

  const foreignKeys = queryOne('PRAGMA foreign_keys;');
  assert(Number(foreignKeys?.foreign_keys) === 1, 'foreign_keys pragma is enabled');

  // ---------------------------------------------------------
  // Step 2: Start HTTP Server on Ephemeral Port
  // ---------------------------------------------------------
  console.log('\n--- Step 2: HTTP Server Initialization ---');
  const app = createApp();
  const server = http.createServer(app);

  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const serverUrl = `http://127.0.0.1:${port}`;
  console.log(`  Live test server listening on port ${port}`);

  try {
    // ---------------------------------------------------------
    // Step 3: Setup Fixture Records
    // ---------------------------------------------------------
    console.log('\n--- Step 3: Setup Test Fixtures ---');
    const timestamp = Date.now();

    // Create Admin User
    const adminEmail = `admin_fin_${timestamp}@mahitechgroup.com`;
    const adminId = crypto.randomUUID();
    execute(`
      INSERT INTO users (id, name, email, password_hash, role, status)
      VALUES (?, 'Admin Financier', ?, 'hash123', 'admin', 'active');
    `, [adminId, adminEmail]);
    const adminUser = queryOne('SELECT * FROM users WHERE id = ?;', [adminId]);
    const adminToken = generateInternalUserToken(adminUser);
    assert(Boolean(adminToken), 'Admin user fixture & JWT session created');

    // Create Member User (Developer)
    const memberEmail = `dev_fin_${timestamp}@mahitechgroup.com`;
    const memberId = crypto.randomUUID();
    execute(`
      INSERT INTO users (id, name, email, password_hash, role, status)
      VALUES (?, 'Dev Regular', ?, 'hash123', 'developer', 'active');
    `, [memberId, memberEmail]);
    const memberUser = queryOne('SELECT * FROM users WHERE id = ?;', [memberId]);
    const memberToken = generateInternalUserToken(memberUser);
    assert(Boolean(memberToken), 'Member user fixture & JWT session created');

    // Ensure Idea exists for Project foreign key
    let idea = queryOne('SELECT id FROM ideas LIMIT 1;');
    if (!idea) {
      const ideaId = `idea_fin_${timestamp}`;
      execute(`
        INSERT INTO ideas (id, owner_id, title, description, status)
        VALUES (?, ?, 'Financial System Architecture', 'Architecture description', 'APPROVED');
      `, [ideaId, adminId]);
      idea = { id: ideaId };
    }
    const ideaId = idea.id;

    // Create Test Projects
    const projAlphaId = `proj_alpha_${timestamp}`;
    execute(`
      INSERT INTO projects (id, idea_id, org_id, title, owner_id)
      VALUES (?, ?, 'org_mtg', 'Alpha Cloud Infrastructure', ?);
    `, [projAlphaId, ideaId, adminId]);

    const projBetaId = `proj_beta_${timestamp}`;
    execute(`
      INSERT INTO projects (id, idea_id, org_id, title, owner_id)
      VALUES (?, ?, 'org_mtg', 'Beta Mobile App MVP', ?);
    `, [projBetaId, ideaId, adminId]);

    const categoryRow = queryOne("SELECT id FROM expense_categories WHERE name = 'SOFTWARE' LIMIT 1;");
    const softwareCatId = categoryRow.id;

    // ---------------------------------------------------------
    // Step 4: RBAC Protection Verification
    // ---------------------------------------------------------
    console.log('\n--- Step 4: RBAC Security Enforcement ---');

    // 4.1 Unauthenticated requests return 401
    const unauthCreate = await makeRequest(serverUrl, '/api/finance/budget/create', {
      method: 'POST',
      body: { project_id: projAlphaId, total_budget: 100000, start_date: '2026-01-01' }
    });
    assert(unauthCreate.status === 401, 'Unauthenticated POST /api/finance/budget/create returned 401 Unauthorized');

    const unauthGet = await makeRequest(serverUrl, `/api/finance/budget/${projAlphaId}`);
    assert(unauthGet.status === 401, 'Unauthenticated GET /api/finance/budget/:projectId returned 401 Unauthorized');

    // 4.2 Member role requests return 403 Forbidden
    const memberCreate = await makeRequest(serverUrl, '/api/finance/budget/create', {
      method: 'POST',
      headers: { Authorization: `Bearer ${memberToken}` },
      body: { project_id: projAlphaId, total_budget: 100000, start_date: '2026-01-01' }
    });
    assert(memberCreate.status === 403, 'Member POST /api/finance/budget/create blocked with 403 Forbidden');
    assert(memberCreate.data?.error?.includes('Admin role required'), '403 error message specifies admin role requirement');

    const memberGet = await makeRequest(serverUrl, `/api/finance/budget/${projAlphaId}`, {
      headers: { Authorization: `Bearer ${memberToken}` }
    });
    assert(memberGet.status === 403, 'Member GET /api/finance/budget/:projectId blocked with 403 Forbidden');

    const memberPatch = await makeRequest(serverUrl, `/api/finance/budget/${projAlphaId}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${memberToken}` },
      body: { total_budget: 200000, reason: 'Valid reason exceeding ten chars' }
    });
    assert(memberPatch.status === 403, 'Member PATCH /api/finance/budget/:projectId blocked with 403 Forbidden');

    const memberHist = await makeRequest(serverUrl, `/api/finance/budget/${projAlphaId}/history`, {
      headers: { Authorization: `Bearer ${memberToken}` }
    });
    assert(memberHist.status === 403, 'Member GET /api/finance/budget/:projectId/history blocked with 403 Forbidden');

    // ---------------------------------------------------------
    // Step 5: Budget Creation API (POST /api/finance/budget/create)
    // ---------------------------------------------------------
    console.log('\n--- Step 5: Budget Creation & Input Validation ---');

    // 5.1 Missing project_id
    const badReq1 = await makeRequest(serverUrl, '/api/finance/budget/create', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { total_budget: 100000, start_date: '2026-01-01' }
    });
    assert(badReq1.status === 400, 'Missing project_id returns 400 Bad Request');

    // 5.2 Non-existent project
    const badReq2 = await makeRequest(serverUrl, '/api/finance/budget/create', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { project_id: 'non_existent_project_xyz', total_budget: 100000, start_date: '2026-01-01' }
    });
    assert(badReq2.status === 404, 'Non-existent project_id returns 404 Not Found');

    // 5.3 Negative total_budget
    const badReq3 = await makeRequest(serverUrl, '/api/finance/budget/create', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { project_id: projAlphaId, total_budget: -500, start_date: '2026-01-01' }
    });
    assert(badReq3.status === 400, 'Negative total_budget returns 400 Bad Request');

    // 5.4 Missing start_date
    const badReq4 = await makeRequest(serverUrl, '/api/finance/budget/create', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { project_id: projAlphaId, total_budget: 500000 }
    });
    assert(badReq4.status === 400, 'Missing start_date returns 400 Bad Request');

    // 5.5 Invalid budget_type
    const badReq5 = await makeRequest(serverUrl, '/api/finance/budget/create', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { project_id: projAlphaId, total_budget: 500000, start_date: '2026-01-01', budget_type: 'INVALID_TYPE' }
    });
    assert(badReq5.status === 400, 'Invalid budget_type returns 400 Bad Request');

    // 5.6 Invalid alert_threshold_pct (> 100 or <= 0)
    const badReq6 = await makeRequest(serverUrl, '/api/finance/budget/create', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { project_id: projAlphaId, total_budget: 500000, start_date: '2026-01-01', alert_threshold_pct: 150 }
    });
    assert(badReq6.status === 400, 'Invalid alert_threshold_pct (>100) returns 400 Bad Request');

    // 5.7 Valid Budget Creation for proj_alpha
    const validCreate = await makeRequest(serverUrl, '/api/finance/budget/create', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        project_id: projAlphaId,
        total_budget: 500000.0,
        currency: 'INR',
        budget_type: 'FIXED',
        alert_threshold_pct: 80.0,
        start_date: '2026-01-01',
        end_date: '2026-12-31',
        notes: 'Initial Q1-Q4 budget allocation'
      }
    });
    assert(validCreate.status === 201, 'Valid budget creation returns 201 Created');
    assert(validCreate.data?.budget?.project_id === projAlphaId, 'Created budget has matching project_id');
    assert(validCreate.data?.budget?.total_budget === 500000.0, 'Created budget total_budget is 500,000 INR');
    assert(validCreate.data?.budget?.budget_type === 'FIXED', 'Created budget type is FIXED');
    assert(validCreate.data?.budget?.alert_threshold_pct === 80.0, 'Created budget alert threshold is 80%');

    // Verify DB state
    const budgetDb = queryOne('SELECT * FROM project_budgets WHERE project_id = ?;', [projAlphaId]);
    assert(budgetDb !== null, 'Budget saved in project_budgets table in SQLite');
    assert(budgetDb.created_by === adminId, 'Budget created_by matches authenticated admin ID');

    // Verify access_log entry
    const accessLog = queryOne("SELECT * FROM access_log WHERE action = 'budget_create' AND target_id = ? ORDER BY id DESC LIMIT 1;", [projAlphaId]);
    assert(accessLog !== null, 'Action logged to access_log with action=budget_create');

    // 5.8 One budget per project rule
    const duplicateCreate = await makeRequest(serverUrl, '/api/finance/budget/create', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        project_id: projAlphaId,
        total_budget: 750000.0,
        start_date: '2026-02-01'
      }
    });
    assert(duplicateCreate.status === 400, 'Duplicate budget creation rejected with 400 Bad Request');
    assert(duplicateCreate.data?.error?.includes('One budget per project enforced'), 'Error message clarifies one budget per project rule');

    // ---------------------------------------------------------
    // Step 6: Budget Details & Consumption Calculation Engine
    // ---------------------------------------------------------
    console.log('\n--- Step 6: Budget Consumption Engine & Calculation Verification ---');

    // 6.1 Baseline consumption (zero expenses, zero time entries)
    const baselineGet = await makeRequest(serverUrl, `/api/finance/budget/${projAlphaId}`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(baselineGet.status === 200, 'GET /api/finance/budget/:projectId returns 200 OK');
    assert(baselineGet.data?.consumption?.approved_expenses_total === 0.0, 'Initial approved_expenses_total is 0.0');
    assert(baselineGet.data?.consumption?.time_cost_total === 0.0, 'Initial time_cost_total is 0.0');
    assert(baselineGet.data?.consumption?.total_consumption === 0.0, 'Initial total_consumption is 0.0');
    assert(baselineGet.data?.consumption?.remaining_budget === 500000.0, 'Initial remaining_budget is 500,000.0');
    assert(baselineGet.data?.consumption?.consumed_pct === 0.0, 'Initial consumed_pct is 0.0%');
    assert(baselineGet.data?.consumption?.alert_status === 'NORMAL', 'Initial alert_status is NORMAL');

    // 6.2 Seed expenses & time entries to test calculation engine rules:
    // Expenses:
    // - PENDING expense: 50,000 (MUST BE EXCLUDED)
    // - REJECTED expense: 25,000 (MUST BE EXCLUDED)
    // - APPROVED expense: 200,000 (MUST BE INCLUDED)
    execute(`
      INSERT INTO project_expenses (project_id, category_id, submitted_by, title, amount, expense_date, status, is_billable)
      VALUES (?, ?, ?, 'Pending Server Hardware', 50000.0, '2026-01-10', 'PENDING', 1);
    `, [projAlphaId, softwareCatId, adminId]);

    execute(`
      INSERT INTO project_expenses (project_id, category_id, submitted_by, title, amount, expense_date, status, is_billable)
      VALUES (?, ?, ?, 'Rejected Office Catering', 25000.0, '2026-01-11', 'REJECTED', 0);
    `, [projAlphaId, softwareCatId, adminId]);

    execute(`
      INSERT INTO project_expenses (project_id, category_id, submitted_by, title, amount, expense_date, status, is_billable)
      VALUES (?, ?, ?, 'Approved Production Cloud Tier', 200000.0, '2026-01-12', 'APPROVED', 1);
    `, [projAlphaId, softwareCatId, adminId]);

    // Time entries:
    // - APPROVED non-billable: 120 mins @ 1000/hr (MUST BE EXCLUDED from budget burn)
    // - PENDING billable: 120 mins @ 2000/hr (MUST BE EXCLUDED from budget burn)
    // - APPROVED billable: 60 mins @ 2000/hr = 2,000 INR (MUST BE INCLUDED)
    execute(`
      INSERT INTO time_entries (user_id, project_id, description, start_time, duration_minutes, is_billable, billable_rate, status)
      VALUES (?, ?, 'Internal training', '2026-01-10T10:00:00', 120, 0, 1000.0, 'APPROVED');
    `, [adminId, projAlphaId]);

    execute(`
      INSERT INTO time_entries (user_id, project_id, description, start_time, duration_minutes, is_billable, billable_rate, status)
      VALUES (?, ?, 'Pending client sprint task', '2026-01-11T10:00:00', 120, 1, 2000.0, 'PENDING');
    `, [adminId, projAlphaId]);

    execute(`
      INSERT INTO time_entries (user_id, project_id, description, start_time, duration_minutes, is_billable, billable_rate, status)
      VALUES (?, ?, 'Approved client core module architecture', '2026-01-12T10:00:00', 60, 1, 2000.0, 'APPROVED');
    `, [adminId, projAlphaId]);

    // 6.3 Query consumption after data seeding
    const calcGet = await makeRequest(serverUrl, `/api/finance/budget/${projAlphaId}`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(calcGet.status === 200, 'GET /api/finance/budget/:projectId with seeded data returns 200 OK');

    const consumption = calcGet.data?.consumption;
    assert(consumption?.approved_expenses_total === 200000.0, 'approved_expenses_total is exactly 200,000.0 (PENDING 50k & REJECTED 25k strictly excluded)');
    assert(consumption?.time_cost_total === 2000.0, 'time_cost_total is exactly 2,000.0 (non-billable and pending entries strictly excluded)');
    assert(consumption?.total_consumption === 202000.0, 'total_consumption is exactly 202,000.0 (200,000 + 2,000)');
    assert(consumption?.remaining_budget === 298000.0, 'remaining_budget is exactly 298,000.0 (500,000 - 202,000)');
    assert(consumption?.consumed_pct === 40.4, 'consumed_pct is exactly 40.4% ((202,000 / 500,000) * 100)');
    assert(consumption?.alert_status === 'NORMAL', 'alert_status remains NORMAL at 40.4% consumption');

    // ---------------------------------------------------------
    // Step 7: Dual-Tier Alert Auto-Trigger Engine Verification
    // ---------------------------------------------------------
    console.log('\n--- Step 7: Dual-Tier Alert Auto-Trigger Engine Verification ---');

    // Create budget for proj_beta: total_budget = 100,000, alert_threshold_pct = 80.0
    await makeRequest(serverUrl, '/api/finance/budget/create', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        project_id: projBetaId,
        total_budget: 100000.0,
        currency: 'INR',
        budget_type: 'FIXED',
        alert_threshold_pct: 80.0,
        start_date: '2026-01-01'
      }
    });

    // 7.1 Trigger Early Warning Threshold Alert (85% consumption)
    // Add approved expense: 85,000 INR
    execute(`
      INSERT INTO project_expenses (project_id, category_id, submitted_by, title, amount, expense_date, status, is_billable)
      VALUES (?, ?, ?, 'Heavy Compute Cluster Lease', 85000.0, '2026-01-15', 'APPROVED', 1);
    `, [projBetaId, softwareCatId, adminId]);

    const betaThresholdCheck = await makeRequest(serverUrl, `/api/finance/budget/${projBetaId}`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(betaThresholdCheck.data?.consumption?.consumed_pct === 85.0, 'proj_beta consumption is 85.0%');
    assert(betaThresholdCheck.data?.consumption?.alert_status === 'THRESHOLD_REACHED', 'alert_status transitioned to THRESHOLD_REACHED');

    const thresholdAlertDb = queryOne("SELECT * FROM budget_alerts WHERE project_id = ? AND alert_type = 'THRESHOLD_REACHED';", [projBetaId]);
    assert(thresholdAlertDb !== null, 'THRESHOLD_REACHED alert auto-generated in budget_alerts');
    assert(thresholdAlertDb.triggered_at_pct === 85.0, 'triggered_at_pct recorded as 85.0%');
    assert(thresholdAlertDb.triggered_amount === 85000.0, 'triggered_amount recorded as 85,000.0 INR');

    // 7.2 Trigger Budget Exceeded Critical Alert (105% consumption)
    // Add additional approved expense: 20,000 INR (total 105,000 INR)
    execute(`
      INSERT INTO project_expenses (project_id, category_id, submitted_by, title, amount, expense_date, status, is_billable)
      VALUES (?, ?, ?, 'Emergency Domain & SSL Overhaul', 20000.0, '2026-01-16', 'APPROVED', 1);
    `, [projBetaId, softwareCatId, adminId]);

    const betaExceededCheck = await makeRequest(serverUrl, `/api/finance/budget/${projBetaId}`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(betaExceededCheck.data?.consumption?.consumed_pct === 105.0, 'proj_beta consumption reached 105.0%');
    assert(betaExceededCheck.data?.consumption?.alert_status === 'BUDGET_EXCEEDED', 'alert_status transitioned to BUDGET_EXCEEDED');

    const exceededAlertDb = queryOne("SELECT * FROM budget_alerts WHERE project_id = ? AND alert_type = 'BUDGET_EXCEEDED';", [projBetaId]);
    assert(exceededAlertDb !== null, 'BUDGET_EXCEEDED alert auto-generated in budget_alerts');
    assert(exceededAlertDb.triggered_at_pct === 105.0, 'BUDGET_EXCEEDED triggered_at_pct recorded as 105.0%');

    // Verify alerts array in response
    const returnedAlerts = betaExceededCheck.data?.alerts || [];
    assert(returnedAlerts.length >= 2, `GET /api/finance/budget/:projectId returns active alerts array (count: ${returnedAlerts.length})`);
    const alertTypes = returnedAlerts.map(a => a.alert_type);
    assert(alertTypes.includes('THRESHOLD_REACHED') && alertTypes.includes('BUDGET_EXCEEDED'), 'Both dual-tier alerts active and returned');

    // ---------------------------------------------------------
    // Step 8: Budget Update & History Audit Trail (PATCH & GET history)
    // ---------------------------------------------------------
    console.log('\n--- Step 8: Budget Update & Audit History Trail ---');

    // 8.1 Missing reason rejected
    const noReasonPatch = await makeRequest(serverUrl, `/api/finance/budget/${projAlphaId}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { total_budget: 600000.0 }
    });
    assert(noReasonPatch.status === 400, 'Budget update without reason rejected with 400 Bad Request');
    assert(noReasonPatch.data?.error?.includes('minimum 10 characters required'), 'Error specifies minimum 10 character requirement');

    // 8.2 Short reason (< 10 chars) rejected
    const shortReasonPatch = await makeRequest(serverUrl, `/api/finance/budget/${projAlphaId}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { total_budget: 600000.0, reason: 'Short' }
    });
    assert(shortReasonPatch.status === 400, 'Budget update with 5-character reason rejected with 400 Bad Request');

    // 8.3 Non-existent project
    const notFoundPatch = await makeRequest(serverUrl, '/api/finance/budget/non_existent_proj_999', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { total_budget: 600000.0, reason: 'Scope expansion confirmed by stakeholder' }
    });
    assert(notFoundPatch.status === 404, 'Budget update on non-existent budget returns 404 Not Found');

    // 8.4 Valid Budget Update
    const budgetBeforeUpdate = queryOne('SELECT updated_at FROM project_budgets WHERE project_id = ?;', [projAlphaId]);
    const validPatch = await makeRequest(serverUrl, `/api/finance/budget/${projAlphaId}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        total_budget: 650000.0,
        alert_threshold_pct: 75.0,
        notes: 'Expanded Q1 scope with client sign-off',
        reason: 'Approved client change order #402 for AI pipeline expansion'
      }
    });
    assert(validPatch.status === 200, 'Valid budget update returns 200 OK');
    assert(validPatch.data?.budget?.total_budget === 650000.0, 'Updated budget total_budget is 650,000.0');
    assert(validPatch.data?.budget?.alert_threshold_pct === 75.0, 'Updated alert_threshold_pct is 75.0%');
    assert(validPatch.data?.changes_recorded >= 3, `Recorded ${validPatch.data?.changes_recorded} field modifications`);

    // Verify updated_at timestamp updated
    const budgetAfterUpdate = queryOne('SELECT updated_at FROM project_budgets WHERE project_id = ?;', [projAlphaId]);
    assert(budgetAfterUpdate.updated_at !== null, 'updated_at timestamp is set on budget update');

    // Verify access_log for update
    const updateLog = queryOne("SELECT * FROM access_log WHERE action = 'budget_update' AND target_id = ? ORDER BY id DESC LIMIT 1;", [projAlphaId]);
    assert(updateLog !== null, 'Action logged to access_log with action=budget_update');

    // 8.5 Verify budget_history endpoint (GET /api/finance/budget/:projectId/history)
    const historyGet = await makeRequest(serverUrl, `/api/finance/budget/${projAlphaId}/history`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(historyGet.status === 200, 'GET /api/finance/budget/:projectId/history returns 200 OK');

    const historyItems = historyGet.data?.history || [];
    assert(historyItems.length >= 3, `History returns all recorded change items (count: ${historyItems.length})`);

    const fieldsChanged = historyItems.map(h => h.field_changed);
    assert(fieldsChanged.includes('total_budget'), 'budget_history includes total_budget change');
    assert(fieldsChanged.includes('alert_threshold_pct'), 'budget_history includes alert_threshold_pct change');
    assert(fieldsChanged.includes('notes'), 'budget_history includes notes change');

    const totalBudgetHistory = historyItems.find(h => h.field_changed === 'total_budget');
    assert(totalBudgetHistory.old_value === '500000', 'budget_history old_value correctly preserved (500000)');
    assert(totalBudgetHistory.new_value === '650000', 'budget_history new_value correctly preserved (650000)');
    assert(totalBudgetHistory.reason === 'Approved client change order #402 for AI pipeline expansion', 'Mandatory reason preserved in history');
    assert(totalBudgetHistory.changed_by_name === 'Admin Financier', 'Changer user name properly joined in history');
    assert(totalBudgetHistory.changed_by_email === adminEmail, 'Changer user email properly joined in history');

    // ---------------------------------------------------------
    // Step 9: DB Trigger Append-Only Verification
    // ---------------------------------------------------------
    console.log('\n--- Step 9: Database Trigger Immutability Check ---');
    let historyUpdateBlocked = false;
    try {
      execute('UPDATE budget_history SET new_value = ? WHERE id = ?;', ['9999999', totalBudgetHistory.id]);
    } catch (err) {
      historyUpdateBlocked = err.message.includes('budget_history is append-only');
    }
    assert(historyUpdateBlocked, 'DB trigger strictly aborted direct SQL UPDATE on budget_history');

    let historyDeleteBlocked = false;
    try {
      execute('DELETE FROM budget_history WHERE id = ?;', [totalBudgetHistory.id]);
    } catch (err) {
      historyDeleteBlocked = err.message.includes('budget_history is append-only');
    }
    assert(historyDeleteBlocked, 'DB trigger strictly aborted direct SQL DELETE on budget_history');

  } finally {
    await new Promise((resolve) => server.close(resolve));
    console.log('\nLive test server closed.');
  }

  // ---------------------------------------------------------
  // Summary
  // ---------------------------------------------------------
  console.log('\n' + '='.repeat(80));
  console.log('PRD 25 Layer 2 Verification Summary:');
  console.log(`Total Assertions : ${totalTests}`);
  console.log(`Passed           : ${passedTests}`);
  console.log(`Failed           : ${failedTests}`);
  console.log(`Success Rate     : ${((passedTests / totalTests) * 100).toFixed(1)}%`);
  console.log('='.repeat(80));

  if (failedTests > 0) {
    process.exit(1);
  }
}

runSuite().catch(err => {
  console.error('Fatal error in Layer 2 verification suite:', err);
  process.exit(1);
});
