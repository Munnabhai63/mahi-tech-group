/**
 * scripts/verify-prd25-layer5.js
 * Verification Suite for PRD 25 Layer 5: Financial Dashboard, Alerts, Reports & Frontend Views
 *
 * Real HTTP calls, Real SQLite database, Zero mocks.
 *
 * Checks:
 * 1. Database Connection & Pragmas (WAL mode, busy_timeout >= 5000, foreign_keys = ON)
 * 2. Express Server Boot (createApp on ephemeral port)
 * 3. User Fixtures & Session Authentication Setup (Admin vs Member role isolation)
 * 4. Financial Dashboard Endpoint (GET /api/finance/dashboard):
 *    - 401 Unauthenticated
 *    - 403 Forbidden for Member role (strict RBAC)
 *    - 200 OK for Admin with complete company-wide rollup totals:
 *      total_budget, total_consumed, total_remaining, total_invoiced, total_paid, total_outstanding
 *    - Project-by-project breakdown table with color-coded status (<70% green, 70-99% yellow, >=100% red)
 *    - Recent top 5 alerts and invoices
 *    - Net profit calculation in p_and_l summary
 * 5. Project P&L Report Endpoint (GET /api/finance/report/project/:projectId):
 *    - 401 Unauthenticated
 *    - 403 Forbidden for Member
 *    - 404 Not Found for invalid project
 *    - 200 OK for Admin:
 *      P&L = Total Invoice Paid Amount - Total Budget Consumption (Rule 12 formula strictly verified)
 *      Itemized category expense breakdown
 *      Profit margin percentage
 * 6. Budget Alerts Listing Endpoint (GET /api/finance/alerts):
 *    - 401 Unauthenticated
 *    - 403 Forbidden for Member
 *    - 200 OK for Admin:
 *      Unacknowledged first, acknowledged history separate
 * 7. Budget Alert Acknowledgment (PATCH /api/finance/alert/:alertId/acknowledge):
 *    - 401 Unauthenticated
 *    - 403 Forbidden for Member
 *    - 404 Not Found for non-existent alert
 *    - 200 OK for Admin: acknowledged_by and acknowledged_at set
 *    - Audit trail in access_log recorded
 * 8. Budget Alert Append-Only DB Protection:
 *    - Direct SQL DELETE strictly blocked by prevent_budget_alert_delete trigger
 * 9. Financial Report Export (POST /api/finance/report/export & GET /api/finance/report/export):
 *    - 401 Unauthenticated
 *    - 403 Forbidden for Member
 *    - JSON export: row created in analytics_report_exports, action logged in access_log
 *    - CSV export: Content-Type text/csv, attachment header, valid CSV content
 * 10. Frontend HTML Views Verification (5 Views Served via Express Static):
 *     - GET /finance-dashboard.html -> 200 OK
 *     - GET /project-budget.html -> 200 OK
 *     - GET /my-expenses.html -> 200 OK
 *     - GET /invoice-manager.html -> 200 OK
 *     - GET /budget-alerts.html -> 200 OK
 *     - Zero hardcoded credentials or tokens in frontend code
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


async function runLayer5Verification() {
  console.log('\n======================================================================');
  console.log('🚀 RUNNING PRD 25 LAYER 5 VERIFICATION SUITE');
  console.log('======================================================================\n');

  // ------------------------------------------------------------------
  // 1. Pragmas & DB Connectivity
  // ------------------------------------------------------------------
  console.log('--- Step 1: Database Pragmas & Tables ---');
  const journalMode = queryOne('PRAGMA journal_mode;');
  assert(journalMode && journalMode.journal_mode.toLowerCase() === 'wal', 'Database is running in WAL journal mode');

  const busyTimeout = queryOne('PRAGMA busy_timeout;');
  assert(busyTimeout && busyTimeout.timeout >= 5000, `busy_timeout is configured (${busyTimeout.timeout}ms >= 5000ms)`);

  const foreignKeys = queryOne('PRAGMA foreign_keys;');
  assert(foreignKeys && foreignKeys.foreign_keys === 1, 'foreign_keys enforcement is ON');

  // ------------------------------------------------------------------
  // 2. Start Test Server on Ephemeral Port
  // ------------------------------------------------------------------
  console.log('\n--- Step 2: Booting Server on Ephemeral Port ---');
  const app = createApp();
  const server = http.createServer(app);

  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;
  const serverUrl = `http://127.0.0.1:${port}`;
  console.log(`  Test server listening at: ${serverUrl}`);

  try {
    // ------------------------------------------------------------------
    // 3. User & Project Fixtures
    // ------------------------------------------------------------------
    console.log('\n--- Step 3: Setting Up Fixtures (Admin, Member, Project, Invoices) ---');
    const nonce = Date.now().toString().slice(-6);

    // Admin user
    const adminId = crypto.randomUUID();
    const adminEmail = `admin_l5_${nonce}@test.com`;
    execute(`
      INSERT INTO users (id, name, email, password_hash, role, status)
      VALUES (?, ?, ?, 'hash123', 'admin', 'active')
    `, [adminId, `Admin L5 ${nonce}`, adminEmail]);
    const adminUser = queryOne('SELECT * FROM users WHERE id = ?', [adminId]);
    const adminToken = generateInternalUserToken(adminUser);
    assert(Boolean(adminUser && adminToken), `Admin user created (ID: ${adminUser.id}, role: admin)`);

    // Member user
    const memberId = crypto.randomUUID();
    const memberEmail = `member_l5_${nonce}@test.com`;
    execute(`
      INSERT INTO users (id, name, email, password_hash, role, status)
      VALUES (?, ?, ?, 'hash123', 'developer', 'active')
    `, [memberId, `Dev L5 ${nonce}`, memberEmail]);
    const memberUser = queryOne('SELECT * FROM users WHERE id = ?', [memberId]);
    const memberToken = generateInternalUserToken(memberUser);
    assert(Boolean(memberUser && memberToken), `Member user created (ID: ${memberUser.id}, role: developer)`);

    // Idea fixture for project foreign key
    let idea = queryOne('SELECT id FROM ideas LIMIT 1');
    if (!idea) {
      const ideaId = `idea_l5_${nonce}`;
      execute(`
        INSERT INTO ideas (id, title, description, owner_id, status)
        VALUES (?, 'Idea L5', 'Idea for PRD 25 Layer 5 test', ?, 'APPROVED')
      `, [ideaId, adminUser.id]);
      idea = { id: ideaId };
    }

    // Project fixture
    const projectId = `proj_l5_${nonce}`;
    const projectTitle = `PRD25 Layer 5 Project ${nonce}`;
    execute(`
      INSERT INTO projects (id, idea_id, org_id, title, owner_id)
      VALUES (?, ?, 'org_mtg', ?, ?)
    `, [projectId, idea.id, projectTitle, adminUser.id]);
    const project = queryOne('SELECT * FROM projects WHERE id = ?', [projectId]);
    assert(Boolean(project), `Test project created (ID: ${project.id}, Title: ${project.title})`);


    // Create budget for project: 50,000 INR
    execute(`
      INSERT INTO project_budgets (
        project_id, total_budget, currency, budget_type, alert_threshold_pct, start_date, created_by
      ) VALUES (?, 50000.0, 'INR', 'FIXED', 80.0, '2026-01-01', ?)
    `, [project.id, adminUser.id]);

    // Create an approved expense: 15,000 INR
    const category = queryOne('SELECT id FROM expense_categories WHERE is_active = 1 LIMIT 1');
    execute(`
      INSERT INTO project_expenses (
        project_id, category_id, submitted_by, title, amount, currency, expense_date, status, approved_by, approved_at
      ) VALUES (?, ?, ?, 'Hosting servers', 15000.0, 'INR', '2026-01-15', 'APPROVED', ?, datetime('now'))
    `, [project.id, category.id, memberUser.id, adminUser.id]);

    // Create a time entry: 10 hours at 500 INR/hr = 5,000 INR
    execute(`
      INSERT INTO time_entries (
        user_id, project_id, duration_minutes, is_billable, billable_rate, status, start_time, end_time, approved_by, approved_at
      ) VALUES (?, ?, 600, 1, 500.0, 'APPROVED', '2026-01-16 09:00:00', '2026-01-16 19:00:00', ?, datetime('now'))
    `, [memberUser.id, project.id, adminUser.id]);

    // Total consumption should be 15,000 + 5,000 = 20,000 INR

    // Create an invoice: Total 30,000 INR, marked as PAID with 30,000 INR
    const invNumber = `MTG-INV-2026-${nonce}`;
    execute(`
      INSERT INTO invoices (
        invoice_number, project_id, title, issue_date, due_date, subtotal, tax_pct, tax_amount, total_amount, paid_amount, status, created_by
      ) VALUES (?, ?, 'Q1 Deliverables', '2026-01-01', '2026-01-30', 25000.0, 20.0, 5000.0, 30000.0, 30000.0, 'PAID', ?)
    `, [invNumber, project.id, adminUser.id]);
    const invoice = queryOne('SELECT * FROM invoices WHERE invoice_number = ?', [invNumber]);
    assert(Boolean(invoice), `Test invoice created and marked PAID (ID: ${invoice.id}, Total: 30000)`);

    // Create a test budget alert
    execute(`
      INSERT INTO budget_alerts (
        project_id, alert_type, triggered_amount, message, created_at
      ) VALUES (?, 'THRESHOLD_REACHED', 40000.0, 'Project budget consumption reached 80%', datetime('now'))
    `, [project.id]);
    const testAlert = queryOne('SELECT * FROM budget_alerts WHERE project_id = ? ORDER BY id DESC LIMIT 1', [project.id]);
    assert(Boolean(testAlert), `Test budget alert created (ID: ${testAlert.id})`);

    // ------------------------------------------------------------------
    // 4. Financial Dashboard Endpoint (/api/finance/dashboard)
    // ------------------------------------------------------------------
    console.log('\n--- Step 4: Testing Financial Dashboard (GET /api/finance/dashboard) ---');

    // 4.1 Unauthenticated 401
    const unauthDash = await makeRequest(serverUrl, '/api/finance/dashboard');
    assert(unauthDash.status === 401, 'GET /dashboard without token returns 401 Unauthorized');

    // 4.2 Member 403 Forbidden (RBAC)
    const memberDash = await makeRequest(serverUrl, '/api/finance/dashboard', {
      headers: { 'Authorization': `Bearer ${memberToken}` }
    });
    assert(memberDash.status === 403, 'GET /dashboard with Member role strictly blocked with 403 Forbidden');

    // 4.3 Admin 200 OK
    const adminDash = await makeRequest(serverUrl, '/api/finance/dashboard', {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(adminDash.status === 200, 'GET /dashboard with Admin role returns 200 OK');
    assert(typeof adminDash.data.total_budget === 'number', 'Dashboard returns numeric total_budget');
    assert(typeof adminDash.data.total_consumed === 'number', 'Dashboard returns numeric total_consumed');
    assert(typeof adminDash.data.total_remaining === 'number', 'Dashboard returns numeric total_remaining');
    assert(typeof adminDash.data.total_invoiced === 'number', 'Dashboard returns numeric total_invoiced');
    assert(typeof adminDash.data.total_paid === 'number', 'Dashboard returns numeric total_paid');
    assert(typeof adminDash.data.total_outstanding === 'number', 'Dashboard returns numeric total_outstanding');

    // Verify company-wide math consistency
    assert(
      adminDash.data.total_remaining === Math.round((adminDash.data.total_budget - adminDash.data.total_consumed) * 100) / 100,
      'Dashboard formula total_remaining = total_budget - total_consumed holds exactly'
    );
    assert(
      adminDash.data.total_outstanding === Math.round((adminDash.data.total_invoiced - adminDash.data.total_paid) * 100) / 100,
      'Dashboard formula total_outstanding = total_invoiced - total_paid holds exactly'
    );

    // Verify projects breakdown array
    assert(Array.isArray(adminDash.data.projects), 'Dashboard contains projects array');
    const pSummary = adminDash.data.projects.find(p => p.project_id === project.id);
    assert(Boolean(pSummary), 'Our test project is present in dashboard projects list');
    assert(pSummary && pSummary.consumed === 20000, `Project consumption equals 20,000 INR (got: ${pSummary?.consumed})`);
    assert(pSummary && pSummary.remaining === 30000, `Project remaining equals 30,000 INR (got: ${pSummary?.remaining})`);
    assert(pSummary && pSummary.consumed_pct === 40, `Project consumed_pct equals 40% (got: ${pSummary?.consumed_pct}%)`);
    assert(pSummary && pSummary.status_color === 'green', `Project status color is 'green' for 40% consumed (<70%)`);

    // Verify recent alerts and invoices
    assert(Array.isArray(adminDash.data.recent_alerts), 'Dashboard contains recent_alerts array');
    assert(Array.isArray(adminDash.data.recent_invoices), 'Dashboard contains recent_invoices array');
    assert(typeof adminDash.data.p_and_l?.net_profit === 'number', 'Dashboard contains p_and_l summary with net_profit');

    // ------------------------------------------------------------------
    // 5. Project P&L Report Endpoint (/api/finance/report/project/:projectId)
    // ------------------------------------------------------------------
    console.log('\n--- Step 5: Testing Project P&L Report (GET /api/finance/report/project/:projectId) ---');

    // 5.1 Unauthenticated 401
    const unauthPL = await makeRequest(serverUrl, `/api/finance/report/project/${project.id}`);
    assert(unauthPL.status === 401, 'GET /report/project/:projectId without token returns 401');

    // 5.2 Member 403 Forbidden
    const memberPL = await makeRequest(serverUrl, `/api/finance/report/project/${project.id}`, {
      headers: { 'Authorization': `Bearer ${memberToken}` }
    });
    assert(memberPL.status === 403, 'GET /report/project/:projectId with Member role strictly blocked with 403');

    // 5.3 404 Not Found for non-existent project
    const notFoundPL = await makeRequest(serverUrl, '/api/finance/report/project/999999', {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(notFoundPL.status === 404, 'GET /report/project/999999 returns 404 Not Found');

    // 5.4 Admin 200 OK & Formula Verification
    const adminPL = await makeRequest(serverUrl, `/api/finance/report/project/${project.id}`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(adminPL.status === 200, 'GET /report/project/:projectId returns 200 OK for Admin');
    const plData = adminPL.data;
    assert(plData.project_id === project.id, 'Report returns correct project_id');
    assert(plData.consumption.approved_expenses === 15000, 'Approved expenses = 15,000 INR');
    assert(plData.consumption.time_cost === 5000, 'Approved billable time cost = 5,000 INR');
    assert(plData.consumption.total_consumption === 20000, 'Total consumption = 20,000 INR');
    assert(plData.paid === 30000, 'Paid invoice amount = 30,000 INR');

    // PRD 25 Rule 12: Project P&L = Total Invoice Paid Amount - Total Budget Consumption
    // P&L = 30,000 - 20,000 = +10,000 INR
    assert(plData.profit_loss === 10000, `Project P&L strictly equals paid - consumption: 30000 - 20000 = 10000 (got: ${plData.profit_loss})`);
    assert(plData.profit_margin_pct === 33.33, `Profit margin % strictly equals (10000 / 30000) * 100 = 33.33% (got: ${plData.profit_margin_pct}%)`);
    assert(Array.isArray(plData.consumption.by_category), 'Report returns itemized by_category breakdown array');
    assert(plData.consumption.by_category.length > 0, 'by_category has at least 1 category entry');

    // ------------------------------------------------------------------
    // 6. Budget Alerts Listing Endpoint (/api/finance/alerts)
    // ------------------------------------------------------------------
    console.log('\n--- Step 6: Testing Budget Alerts Listing (GET /api/finance/alerts) ---');

    // 6.1 Unauthenticated 401
    const unauthAlerts = await makeRequest(serverUrl, '/api/finance/alerts');
    assert(unauthAlerts.status === 401, 'GET /alerts without token returns 401');

    // 6.2 Member 403 Forbidden
    const memberAlerts = await makeRequest(serverUrl, '/api/finance/alerts', {
      headers: { 'Authorization': `Bearer ${memberToken}` }
    });
    assert(memberAlerts.status === 403, 'GET /alerts with Member role strictly blocked with 403');

    // 6.3 Admin 200 OK
    const adminAlerts = await makeRequest(serverUrl, '/api/finance/alerts', {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(adminAlerts.status === 200, 'GET /alerts returns 200 OK for Admin');
    assert(Array.isArray(adminAlerts.data.unacknowledged), 'Alerts returns unacknowledged list');
    assert(Array.isArray(adminAlerts.data.acknowledged), 'Alerts returns acknowledged list');
    assert(adminAlerts.data.total_unacknowledged >= 1, 'At least 1 unacknowledged alert is present');

    const foundUnack = adminAlerts.data.unacknowledged.find(a => a.id === testAlert.id);
    assert(Boolean(foundUnack), 'Our newly created alert is in unacknowledged list');

    // ------------------------------------------------------------------
    // 7. Budget Alert Acknowledgment (PATCH /api/finance/alert/:alertId/acknowledge)
    // ------------------------------------------------------------------
    console.log('\n--- Step 7: Testing Alert Acknowledgment (PATCH /api/finance/alert/:alertId/acknowledge) ---');

    // 7.1 Unauthenticated 401
    const unauthAck = await makeRequest(serverUrl, `/api/finance/alert/${testAlert.id}/acknowledge`, { method: 'PATCH' });
    assert(unauthAck.status === 401, 'PATCH /alert/:alertId/acknowledge without token returns 401');

    // 7.2 Member 403 Forbidden
    const memberAck = await makeRequest(serverUrl, `/api/finance/alert/${testAlert.id}/acknowledge`, {
      method: 'PATCH',
      headers: { 'Authorization': `Bearer ${memberToken}` }
    });
    assert(memberAck.status === 403, 'PATCH /alert/:alertId/acknowledge with Member role blocked with 403');

    // 7.3 404 for invalid alert
    const notFoundAck = await makeRequest(serverUrl, '/api/finance/alert/999999/acknowledge', {
      method: 'PATCH',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(notFoundAck.status === 404, 'PATCH /alert/999999/acknowledge returns 404 Not Found');

    // 7.4 Admin 200 OK
    const adminAck = await makeRequest(serverUrl, `/api/finance/alert/${testAlert.id}/acknowledge`, {
      method: 'PATCH',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(adminAck.status === 200, 'PATCH /alert/:alertId/acknowledge returns 200 OK for Admin');
    assert(adminAck.data.acknowledged_by === adminUser.id, `acknowledged_by is set to admin ID ${adminUser.id}`);
    assert(Boolean(adminAck.data.acknowledged_at), `acknowledged_at timestamp is set (${adminAck.data.acknowledged_at})`);

    // Verify in DB
    const dbAlert = queryOne('SELECT * FROM budget_alerts WHERE id = ?', [testAlert.id]);
    assert(dbAlert && dbAlert.acknowledged_by === adminUser.id, 'DB record has acknowledged_by updated');
    assert(dbAlert && Boolean(dbAlert.acknowledged_at), 'DB record has acknowledged_at timestamp set');

    // Verify access_log entry
    const ackLog = queryOne(`
      SELECT * FROM access_log
      WHERE user_id = ? AND action = 'acknowledge_budget_alert' AND target_id = ?
      ORDER BY id DESC LIMIT 1
    `, [adminUser.id, String(testAlert.id)]);
    assert(Boolean(ackLog), 'Admin acknowledgment action logged in access_log');

    // ------------------------------------------------------------------
    // 8. Trigger Append-Only Enforcement on budget_alerts
    // ------------------------------------------------------------------
    console.log('\n--- Step 8: Testing DB Trigger Append-Only on budget_alerts ---');
    let deletePrevented = false;
    try {
      execute('DELETE FROM budget_alerts WHERE id = ?', [testAlert.id]);
    } catch (err) {
      deletePrevented = err.message.includes('budget_alerts is append-only');
    }
    assert(deletePrevented, 'Direct SQL DELETE on budget_alerts strictly aborted by trigger: budget_alerts is append-only');

    // ------------------------------------------------------------------
    // 9. Financial Report Export (POST /api/finance/report/export & GET)
    // ------------------------------------------------------------------
    console.log('\n--- Step 9: Testing Financial Report Export API ---');

    // 9.1 Unauthenticated 401
    const unauthExport = await makeRequest(serverUrl, '/api/finance/report/export', { method: 'POST' });
    assert(unauthExport.status === 401, 'POST /report/export without token returns 401');

    // 9.2 Member 403 Forbidden
    const memberExport = await makeRequest(serverUrl, '/api/finance/report/export', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${memberToken}` },
      body: { export_format: 'JSON' }
    });
    assert(memberExport.status === 403, 'POST /report/export with Member role strictly blocked with 403');

    // 9.3 Admin JSON Export
    const adminExportJson = await makeRequest(serverUrl, '/api/finance/report/export', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminToken}` },
      body: {
        report_type: 'FINANCIAL_PL',
        project_id: project.id,
        export_format: 'JSON'
      }
    });
    assert(adminExportJson.status === 200, 'POST /report/export with JSON format returns 200 OK');
    assert(Boolean(adminExportJson.data.export_id), `Export response contains export_id (#${adminExportJson.data.export_id})`);
    assert(adminExportJson.data.export_format === 'JSON', 'Export format is JSON');

    // Verify row inserted in analytics_report_exports
    const exportDbRow = queryOne(`
      SELECT * FROM analytics_report_exports WHERE id = ?
    `, [adminExportJson.data.export_id]);
    assert(Boolean(exportDbRow), 'Export audit record successfully inserted into analytics_report_exports table');
    assert(exportDbRow && exportDbRow.exported_by === adminUser.id, 'analytics_report_exports.exported_by matches Admin');
    assert(exportDbRow && exportDbRow.export_format === 'JSON', 'analytics_report_exports.export_format matches JSON');

    // Verify access_log entry
    const exportLog = queryOne(`
      SELECT * FROM access_log
      WHERE user_id = ? AND action = 'export_financial_report' AND target_id = ?
      ORDER BY id DESC LIMIT 1
    `, [adminUser.id, String(adminExportJson.data.export_id)]);
    assert(Boolean(exportLog), 'Financial export logged into access_log');

    // 9.4 Admin CSV Export
    const adminExportCsv = await makeRequest(serverUrl, '/api/finance/report/export', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminToken}` },
      body: {
        report_type: 'FINANCIAL_PL',
        project_id: project.id,
        export_format: 'CSV'
      }
    });
    assert(adminExportCsv.status === 200, 'POST /report/export with CSV format returns 200 OK');
    assert(adminExportCsv.headers['content-type']?.includes('text/csv'), 'CSV export response header contains Content-Type text/csv');
    assert(typeof adminExportCsv.data === 'string' && adminExportCsv.data.includes('Project Title'), 'CSV export payload contains valid CSV data');

    // 9.5 GET variant for direct browser downloads
    const getExportCsv = await makeRequest(serverUrl, `/api/finance/report/export?export_format=CSV&project_id=${project.id}`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(getExportCsv.status === 200, 'GET /report/export returns 200 OK for CSV browser download');

    // ------------------------------------------------------------------
    // 10. Frontend HTML Views Serving Verification
    // ------------------------------------------------------------------
    console.log('\n--- Step 10: Testing Frontend HTML Views (5 Views) ---');

    const viewsToTest = [
      { path: '/finance-dashboard.html', title: 'Financial Dashboard' },
      { path: '/project-budget.html', title: 'Project Budget & Expenses' },
      { path: '/my-expenses.html', title: 'My Expenses' },
      { path: '/invoice-manager.html', title: 'Invoice Manager' },
      { path: '/budget-alerts.html', title: 'Budget Alerts & Reports' }
    ];

    for (const view of viewsToTest) {
      const res = await makeRequest(serverUrl, view.path);
      assert(res.status === 200, `GET ${view.path} returns 200 OK`);
      assert(res.headers['content-type']?.includes('text/html'), `${view.path} returns Content-Type text/html`);
      const html = typeof res.data === 'string' ? res.data : '';
      assert(html.includes('<!DOCTYPE html>'), `${view.path} contains standard <!DOCTYPE html>`);
      assert(html.includes(view.title), `${view.path} contains expected title '${view.title}'`);
      assert(!html.includes('secret') && !html.includes('password') && !html.includes('bearer '), `${view.path} has no hardcoded secrets or tokens`);
    }

  } finally {
    await new Promise(resolve => server.close(resolve));
    console.log('\n  Test server closed cleanly.');
  }

  // ------------------------------------------------------------------
  // Summary
  // ------------------------------------------------------------------
  console.log('\n======================================================================');
  console.log(`PRD 25 LAYER 5 RESULTS: ${passedTests}/${totalTests} PASS (${failedTests} FAILED)`);
  console.log('======================================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runLayer5Verification().catch(err => {
  console.error('Unhandled fatal error in Layer 5 verification:', err);
  process.exit(1);
});
