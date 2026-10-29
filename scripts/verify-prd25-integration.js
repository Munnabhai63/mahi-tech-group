/**
 * scripts/verify-prd25-integration.js
 * Master End-to-End Integration Suite for PRD 25: Budget & Financial Management System
 *
 * Real HTTP calls, Real SQLite database, Zero mocks.
 *
 * Covers 7 Mandatory Integration Flows:
 * 1. Full Budget Lifecycle:
 *    - Creation with constraints
 *    - Update requiring mandatory reason (min 10 chars)
 *    - Audit history verified in budget_history
 * 2. Expense & Alert Flow:
 *    - Member expense submission (default PENDING)
 *    - Admin approval triggering instant budget recalculation
 *    - Automatic threshold alert generation (THRESHOLD_REACHED and BUDGET_EXCEEDED)
 *    - Alert acknowledgment and state verification
 * 3. Invoice Lifecycle & Overdue Engine:
 *    - Auto-generated invoice numbering (MTG-INV-YYYY-NNNN)
 *    - Line items added with server-calculated totals (qty * price)
 *    - Transition to SENT and strict line item locking
 *    - VIEWED transition
 *    - Payment recording (status -> PAID, paid_amount, payment_reference, paid_at)
 *    - Daily overdue cron auto-transitioning past-due invoices
 * 4. Member Isolation & Security Sweep:
 *    - Member role attempts all admin endpoints -> strictly returns 403 Forbidden
 *    - Member cannot see other members' expenses or company-wide rollups
 * 5. Append-Only Trigger Final Sweep:
 *    - Direct SQL UPDATE/DELETE on budget_history, expense_history,
 *      invoice_line_items, and budget_alerts strictly aborted by DB triggers
 * 6. Dashboard Rollup Arithmetic Integrity:
 *    - Company-wide rollup compared against direct SQLite SUM queries
 *    - All 6 KPI metrics match to the penny
 * 7. Deep-Scan for Confidential Data Leakage:
 *    - Client-facing / public responses strictly stripped of internal_notes
 */

import http from 'node:http';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app.js';
import { queryOne, queryAll, execute } from '../src/db/database.js';
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

async function runMasterIntegrationSuite() {
  console.log('\n======================================================================');
  console.log('🚀 RUNNING PRD 25 MASTER END-TO-END INTEGRATION SUITE');
  console.log('======================================================================\n');

  // Start Express Test Server
  const app = createApp();
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;
  const serverUrl = `http://127.0.0.1:${port}`;
  console.log(`  Live test server bound to: ${serverUrl}\n`);

  try {
    const suffix = crypto.randomBytes(4).toString('hex');

    // ------------------------------------------------------------------
    // Fixtures Setup: Admin and Member Users
    // ------------------------------------------------------------------
    console.log('--- Setting Up Base Actor Fixtures ---');
    const adminId = crypto.randomUUID();
    const adminEmail = `admin_e2e_${suffix}@test.com`;
    execute(`
      INSERT INTO users (id, name, email, password_hash, role, status)
      VALUES (?, ?, ?, 'hash_admin', 'admin', 'active')
    `, [adminId, `Admin E2E ${suffix}`, adminEmail]);
    const adminUser = queryOne('SELECT * FROM users WHERE id = ?', [adminId]);
    const adminToken = generateInternalUserToken(adminUser);

    const memberId = crypto.randomUUID();
    const memberEmail = `member_e2e_${suffix}@test.com`;
    execute(`
      INSERT INTO users (id, name, email, password_hash, role, status)
      VALUES (?, ?, ?, 'hash_member', 'developer', 'active')
    `, [memberId, `Developer E2E ${suffix}`, memberEmail]);
    const memberUser = queryOne('SELECT * FROM users WHERE id = ?', [memberId]);
    const memberToken = generateInternalUserToken(memberUser);

    const otherMemberId = crypto.randomUUID();
    const otherMemberEmail = `other_dev_e2e_${suffix}@test.com`;
    execute(`
      INSERT INTO users (id, name, email, password_hash, role, status)
      VALUES (?, ?, ?, 'hash_other', 'developer', 'active')
    `, [otherMemberId, `Other Dev ${suffix}`, otherMemberEmail]);
    const otherMemberUser = queryOne('SELECT * FROM users WHERE id = ?', [otherMemberId]);
    const otherMemberToken = generateInternalUserToken(otherMemberUser);

    assert(Boolean(adminToken && memberToken && otherMemberToken), 'Actors (Admin, Member 1, Member 2) provisioned with active sessions');

    // Project fixture
    let idea = queryOne('SELECT id FROM ideas LIMIT 1');
    if (!idea) {
      const ideaId = `idea_e2e_${suffix}`;
      execute(`
        INSERT INTO ideas (id, title, description, owner_id, status)
        VALUES (?, 'Master E2E Idea', 'Idea for PRD 25 integration', ?, 'APPROVED')
      `, [ideaId, adminUser.id]);
      idea = { id: ideaId };
    }

    const projectId = `proj_e2e_${suffix}`;
    const projectTitle = `Enterprise SaaS Pipeline ${suffix}`;
    execute(`
      INSERT INTO projects (id, idea_id, org_id, title, owner_id)
      VALUES (?, ?, 'org_mtg', ?, ?)
    `, [projectId, idea.id, projectTitle, adminUser.id]);
    const project = queryOne('SELECT * FROM projects WHERE id = ?', [projectId]);
    assert(Boolean(project), `Target project created (ID: ${project.id})`);

    // ==================================================================
    // FLOW 1: FULL BUDGET LIFECYCLE
    // ==================================================================
    console.log('\n======================================================================');
    console.log('FLOW 1: FULL BUDGET LIFECYCLE (CREATE → UPDATE WITH REASON → AUDIT HISTORY)');
    console.log('======================================================================');

    // 1.1 Create Budget
    let budgetRes = await makeRequest(serverUrl, '/api/finance/budget/create', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminToken}` },
      body: {
        project_id: project.id,
        total_budget: 100000.0,
        currency: 'INR',
        budget_type: 'FIXED',
        alert_threshold_pct: 80.0,
        start_date: '2026-01-01',
        notes: 'Initial Q1 project budget'
      }
    });
    assert(budgetRes.status === 201, 'POST /budget/create succeeds with 201 Created');
    assert(budgetRes.data.budget.total_budget === 100000.0, 'Budget allocated is 100,000 INR');

    // 1.2 Verify initial consumption state
    let getBudgetRes = await makeRequest(serverUrl, `/api/finance/budget/${project.id}`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(getBudgetRes.status === 200, 'GET /budget/:projectId returns 200 OK');
    assert(getBudgetRes.data.consumed === 0, 'Initial budget consumption is 0.0 INR');
    assert(getBudgetRes.data.remaining === 100000.0, 'Initial remaining budget is 100,000.0 INR');
    assert(getBudgetRes.data.consumed_pct === 0, 'Initial consumed_pct is 0%');

    // 1.3 Update without reason must fail (Rule 2)
    let badUpdateRes = await makeRequest(serverUrl, `/api/finance/budget/${project.id}`, {
      method: 'PATCH',
      headers: { 'Authorization': `Bearer ${adminToken}` },
      body: { total_budget: 120000.0 }
    });
    assert(badUpdateRes.status === 400, 'Budget update without reason strictly rejected (400 Bad Request)');
    assert(badUpdateRes.data.error.includes('10 characters'), 'Error specifies min 10 chars requirement');

    // 1.4 Update with short reason (< 10 chars) must fail
    let shortUpdateRes = await makeRequest(serverUrl, `/api/finance/budget/${project.id}`, {
      method: 'PATCH',
      headers: { 'Authorization': `Bearer ${adminToken}` },
      body: { total_budget: 120000.0, reason: 'Scope up' }
    });
    assert(shortUpdateRes.status === 400, 'Budget update with < 10 chars reason strictly rejected (400 Bad Request)');

    // 1.5 Valid Update with mandatory reason
    let validUpdateRes = await makeRequest(serverUrl, `/api/finance/budget/${project.id}`, {
      method: 'PATCH',
      headers: { 'Authorization': `Bearer ${adminToken}` },
      body: {
        total_budget: 120000.0,
        alert_threshold_pct: 75.0,
        reason: 'Budget expanded to 120k due to client scope change'
      }
    });
    assert(validUpdateRes.status === 200, 'Budget update with valid reason succeeds with 200 OK');
    assert(validUpdateRes.data.budget.total_budget === 120000.0, 'Updated budget total is 120,000 INR');
    assert(validUpdateRes.data.budget.alert_threshold_pct === 75.0, 'Updated alert threshold is 75.0%');

    // 1.6 Verify audit history
    let historyRes = await makeRequest(serverUrl, `/api/finance/budget/${project.id}/history`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(historyRes.status === 200, 'GET /budget/:projectId/history returns 200 OK');
    const historyList = Array.isArray(historyRes.data) ? historyRes.data : (historyRes.data.history || []);
    assert(Array.isArray(historyList) && historyList.length >= 2, 'History records both total_budget and threshold changes');
    const budgetChange = historyList.find(h => h.field_changed === 'total_budget');
    assert(budgetChange && budgetChange.old_value === '100000' && budgetChange.new_value === '120000', 'History preserves old (100k) and new (120k) budget values');
    assert(budgetChange && budgetChange.reason.includes('client scope change'), 'History preserves the mandatory reason');


    // ==================================================================
    // FLOW 2: EXPENSE FLOW & AUTOMATED THRESHOLD ALERTS
    // ==================================================================
    console.log('\n======================================================================');
    console.log('FLOW 2: EXPENSE FLOW (SUBMISSION → APPROVAL → RECALCULATION → ALERTS)');
    console.log('======================================================================');

    const cat = queryOne('SELECT id FROM expense_categories WHERE is_active = 1 LIMIT 1');

    // 2.1 Member submits expense for 90,000 INR (75% of 120,000 INR -> breaches threshold)
    let submitExpRes = await makeRequest(serverUrl, '/api/finance/expense/submit', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${memberToken}` },
      body: {
        project_id: project.id,
        category_id: cat.id,
        title: 'Cloud Infrastructure & GPUs',
        description: 'Provisioning GPU instances for production model fine-tuning',
        amount: 90000.0,
        currency: 'INR',
        expense_date: '2026-01-10',
        is_billable: 1
      }
    });
    assert(submitExpRes.status === 201, 'Member submits expense (201 Created)');
    const exp1 = submitExpRes.data.expense;
    assert(exp1.status === 'PENDING', 'Default expense status is strictly PENDING');

    // 2.2 PENDING expense must NOT affect budget consumption
    let checkBudgetPending = await makeRequest(serverUrl, `/api/finance/budget/${project.id}`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(checkBudgetPending.data.consumed === 0, 'Rule 3: PENDING expense is strictly excluded from budget consumption');

    // 2.3 Admin approves expense
    let approveRes = await makeRequest(serverUrl, `/api/finance/expense/${exp1.id}/approve`, {
      method: 'PATCH',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(approveRes.status === 200, 'Admin approves expense (200 OK)');
    assert(approveRes.data.expense.status === 'APPROVED', 'Expense status is now APPROVED');

    // 2.4 Immediate Budget Recalculation verification
    let checkBudgetApproved = await makeRequest(serverUrl, `/api/finance/budget/${project.id}`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(checkBudgetApproved.data.consumed === 90000.0, 'Consumption immediately recalculated to 90,000 INR');
    assert(checkBudgetApproved.data.consumed_pct === 75.0, 'Consumed percentage is exactly 75.0%');
    assert(checkBudgetApproved.data.alert_status === 'THRESHOLD_REACHED', 'Alert status transitioned to THRESHOLD_REACHED');

    // 2.5 Automated threshold alert generated in budget_alerts
    let alertsRes = await makeRequest(serverUrl, '/api/finance/alerts', {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(alertsRes.status === 200, 'GET /alerts returns 200 OK');
    const thresholdAlert = alertsRes.data.unacknowledged.find(a => a.project_id === project.id && a.alert_type === 'THRESHOLD_REACHED');
    assert(Boolean(thresholdAlert), 'THRESHOLD_REACHED alert auto-generated in budget_alerts');
    assert(thresholdAlert.triggered_at_pct === 75.0, 'Alert recorded triggered_at_pct = 75.0%');

    // 2.6 Acknowledge the alert
    let ackRes = await makeRequest(serverUrl, `/api/finance/alert/${thresholdAlert.id}/acknowledge`, {
      method: 'PATCH',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(ackRes.status === 200, 'PATCH /alert/:id/acknowledge succeeds with 200 OK');
    assert(ackRes.data.acknowledged_by === adminUser.id, 'acknowledged_by matches authenticated admin');
    assert(Boolean(ackRes.data.acknowledged_at), 'acknowledged_at timestamp is set');

    // 2.7 Second expense pushing over 100% (BUDGET_EXCEEDED)
    let exp2Res = await makeRequest(serverUrl, '/api/finance/expense/submit', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${memberToken}` },
      body: {
        project_id: project.id,
        category_id: cat.id,
        title: 'Emergency Contractor On-Call',
        amount: 36000.0,
        currency: 'INR',
        expense_date: '2026-01-20'
      }
    });
    const exp2 = exp2Res.data.expense;
    await makeRequest(serverUrl, `/api/finance/expense/${exp2.id}/approve`, {
      method: 'PATCH',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });

    // Check budget exceeded
    let checkExceeded = await makeRequest(serverUrl, `/api/finance/budget/${project.id}`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(checkExceeded.data.consumed === 126000.0, 'Consumption recalculated to 126,000 INR (90k + 36k)');
    assert(checkExceeded.data.consumed_pct === 105.0, 'Consumed percentage is 105.0% (> 100%)');
    assert(checkExceeded.data.alert_status === 'BUDGET_EXCEEDED', 'Alert status transitioned to BUDGET_EXCEEDED');

    let alertsRes2 = await makeRequest(serverUrl, '/api/finance/alerts', {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const exceededAlert = alertsRes2.data.unacknowledged.find(a => a.project_id === project.id && a.alert_type === 'BUDGET_EXCEEDED');
    assert(Boolean(exceededAlert), 'BUDGET_EXCEEDED alert auto-generated in budget_alerts');

    // ==================================================================
    // FLOW 3: INVOICE LIFECYCLE, STATE MACHINE & OVERDUE ENGINE
    // ==================================================================
    console.log('\n======================================================================');
    console.log('FLOW 3: INVOICE LIFECYCLE (CREATE → LINE ITEMS → SEND → PAY → OVERDUE)');
    console.log('======================================================================');

    // 3.1 Create Invoice A
    let invCreateRes = await makeRequest(serverUrl, '/api/finance/invoice/create', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminToken}` },
      body: {
        project_id: project.id,
        title: 'Phase 1 Core Architecture',
        issue_date: '2026-01-01',
        due_date: '2026-01-31',
        tax_pct: 18.0,
        notes: 'Payment due in 30 days',
        internal_notes: 'VIP Client — Handle with maximum priority'
      }
    });
    assert(invCreateRes.status === 201, 'POST /invoice/create succeeds (201 Created)');
    const invA = invCreateRes.data.invoice;
    assert(invA.status === 'DRAFT', 'Initial invoice status is strictly DRAFT');
    assert(/^MTG-INV-\d{4}-\d{4}$/.test(invA.invoice_number), `Invoice number matches format MTG-INV-YYYY-NNNN (${invA.invoice_number})`);

    // 3.2 Add Line Item 1: 2 * 60,000 = 120,000 INR
    let li1Res = await makeRequest(serverUrl, `/api/finance/invoice/${invA.id}/line-item/add`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminToken}` },
      body: {
        description: 'Microservice Cluster Setup',
        line_type: 'CUSTOM',
        quantity: 2,
        unit_price: 60000.0,
        amount: 999.0 // Client spoof amount MUST be ignored!
      }
    });
    assert(li1Res.status === 201, 'Add line item 1 succeeds (201 Created)');
    assert(li1Res.data.line_item.amount === 120000.0, 'Rule 7: Line item amount strictly calculated server-side (2 * 60,000 = 120,000)');

    // 3.3 Add Line Item 2: 1 * 30,000 = 30,000 INR
    let li2Res = await makeRequest(serverUrl, `/api/finance/invoice/${invA.id}/line-item/add`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminToken}` },
      body: {
        description: 'Security & Pen-testing',
        line_type: 'CUSTOM',
        quantity: 1,
        unit_price: 30000.0
      }
    });
    assert(li2Res.status === 201, 'Add line item 2 succeeds (201 Created)');

    // 3.4 Verify Server-Side Totals on Invoice
    let invDetail = await makeRequest(serverUrl, `/api/finance/invoice/${invA.id}`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    // Subtotal = 120,000 + 30,000 = 150,000 INR
    // Tax (18%) = 27,000 INR
    // Total = 177,000 INR
    const invData = invDetail.data.invoice || invDetail.data;
    assert(invData.subtotal === 150000.0, 'Invoice subtotal is 150,000.0 INR');
    assert(invData.tax_amount === 27000.0, 'Invoice tax_amount is 27,000.0 INR (18% of 150,000)');
    assert(invData.total_amount === 177000.0, 'Invoice total_amount is 177,000.0 INR (150k + 27k)');

    // 3.5 Send Invoice -> Transitions DRAFT -> SENT
    let sendRes = await makeRequest(serverUrl, `/api/finance/invoice/${invA.id}/send`, {
      method: 'PATCH',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(sendRes.status === 200, 'PATCH /invoice/:id/send succeeds (200 OK)');
    assert(sendRes.data.invoice.status === 'SENT', 'Invoice status transitioned to SENT');
    assert(Boolean(sendRes.data.invoice.sent_at), 'sent_at timestamp is recorded');

    // 3.6 LINE ITEM LOCKING RULE: Cannot add items once SENT
    let blockedLineItem = await makeRequest(serverUrl, `/api/finance/invoice/${invA.id}/line-item/add`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminToken}` },
      body: { description: 'Late addition', quantity: 1, unit_price: 1000.0 }
    });
    assert(blockedLineItem.status === 400, 'Rule 9: Adding line item to SENT invoice strictly blocked with 400 Bad Request');
    assert(blockedLineItem.data.error.includes('DRAFT'), 'Error states line items can only be added to DRAFT invoices');

    // 3.7 Mark Viewed -> VIEWED
    let viewRes = await makeRequest(serverUrl, `/api/finance/invoice/${invA.id}/view`, {
      method: 'PATCH',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(viewRes.status === 200, 'PATCH /invoice/:id/view succeeds');
    assert(viewRes.data.invoice.status === 'VIEWED', 'Status transitioned to VIEWED');

    // 3.8 Mark Paid -> PAID
    let payRes = await makeRequest(serverUrl, `/api/finance/invoice/${invA.id}/mark-paid`, {
      method: 'PATCH',
      headers: { 'Authorization': `Bearer ${adminToken}` },
      body: {
        paid_amount: 177000.0,
        payment_reference: 'NEFT-REF-2026-990011'
      }
    });
    assert(payRes.status === 200, 'PATCH /invoice/:id/mark-paid succeeds (200 OK)');
    assert(payRes.data.invoice.status === 'PAID', 'Invoice status transitioned to PAID');
    assert(payRes.data.invoice.paid_amount === 177000.0, 'paid_amount recorded as 177,000 INR');
    assert(payRes.data.invoice.payment_reference === 'NEFT-REF-2026-990011', 'payment_reference preserved');

    // 3.9 PAID invoice cannot be cancelled
    let cancelPaidRes = await makeRequest(serverUrl, `/api/finance/invoice/${invA.id}/cancel`, {
      method: 'PATCH',
      headers: { 'Authorization': `Bearer ${adminToken}` },
      body: { reason: 'Accidental cancel' }
    });
    assert(cancelPaidRes.status === 400, 'Cancelling a PAID invoice is strictly blocked (400 Bad Request)');

    // 3.10 Daily Overdue Cron Engine Verification
    // Create Invoice B with due_date in the past ('2025-01-01')
    let invBRes = await makeRequest(serverUrl, '/api/finance/invoice/create', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminToken}` },
      body: {
        project_id: project.id,
        title: 'Past Due Retainer',
        issue_date: '2024-12-01',
        due_date: '2025-01-01',
        tax_pct: 0
      }
    });
    const invB = invBRes.data.invoice;
    await makeRequest(serverUrl, `/api/finance/invoice/${invB.id}/line-item/add`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminToken}` },
      body: { description: 'Past hours', quantity: 1, unit_price: 25000.0 }
    });
    // Send it so status is SENT
    await makeRequest(serverUrl, `/api/finance/invoice/${invB.id}/send`, {
      method: 'PATCH',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });

    // Run Overdue Cron
    let cronRes = await makeRequest(serverUrl, '/api/finance/cron/overdue-check', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(cronRes.status === 200, 'POST /cron/overdue-check returns 200 OK');
    assert(cronRes.data.updated_count >= 1, 'Cron transitioned at least 1 past-due invoice to OVERDUE');

    let invBChecked = await makeRequest(serverUrl, `/api/finance/invoice/${invB.id}`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const invBData = invBChecked.data.invoice || invBChecked.data;
    assert(invBData.status === 'OVERDUE', 'Rule 10: Invoice B automatically transitioned to OVERDUE status');

    // Check INVOICE_OVERDUE alert generated
    const overdueAlert = queryOne(`
      SELECT * FROM budget_alerts
      WHERE project_id = ? AND alert_type = 'INVOICE_OVERDUE' AND message LIKE ?
    `, [project.id, `%${invB.invoice_number}%`]);
    assert(Boolean(overdueAlert), 'INVOICE_OVERDUE alert automatically written to budget_alerts');

    // ==================================================================
    // FLOW 4: MEMBER ISOLATION & SECURITY SWEEP
    // ==================================================================
    console.log('\n======================================================================');
    console.log('FLOW 4: MEMBER ISOLATION SWEEP (ROLE-BASED ACCESS CONTROL)');
    console.log('======================================================================');

    const adminEndpoints = [
      { method: 'POST', path: '/api/finance/budget/create', body: { project_id: project.id } },
      { method: 'GET', path: `/api/finance/budget/${project.id}` },
      { method: 'PATCH', path: `/api/finance/budget/${project.id}`, body: { total_budget: 100 } },
      { method: 'GET', path: `/api/finance/budget/${project.id}/history` },
      { method: 'GET', path: `/api/finance/expenses/project/${project.id}` },
      { method: 'PATCH', path: `/api/finance/expense/${exp1.id}/approve` },
      { method: 'PATCH', path: `/api/finance/expense/${exp1.id}/reject`, body: { rejection_reason: 'Testing reject' } },
      { method: 'POST', path: '/api/finance/category/create', body: { name: 'NewCat' } },
      { method: 'PATCH', path: `/api/finance/category/${cat.id}`, body: { is_active: 0 } },
      { method: 'POST', path: '/api/finance/invoice/create', body: { project_id: project.id } },
      { method: 'POST', path: `/api/finance/invoice/${invA.id}/line-item/add`, body: { description: 'Item', quantity: 1, unit_price: 10 } },
      { method: 'GET', path: `/api/finance/invoices/project/${project.id}` },
      { method: 'PATCH', path: `/api/finance/invoice/${invA.id}/send` },
      { method: 'PATCH', path: `/api/finance/invoice/${invA.id}/mark-paid`, body: { paid_amount: 10 } },
      { method: 'PATCH', path: `/api/finance/invoice/${invA.id}/cancel`, body: { reason: 'cancel' } },
      { method: 'GET', path: '/api/finance/dashboard' },
      { method: 'GET', path: `/api/finance/report/project/${project.id}` },
      { method: 'GET', path: '/api/finance/alerts' },
      { method: 'PATCH', path: `/api/finance/alert/${thresholdAlert.id}/acknowledge` },
      { method: 'POST', path: '/api/finance/report/export', body: { export_format: 'JSON' } },
      { method: 'POST', path: '/api/finance/cron/overdue-check' }
    ];

    for (const ep of adminEndpoints) {
      const res = await makeRequest(serverUrl, ep.path, {
        method: ep.method,
        headers: { 'Authorization': `Bearer ${memberToken}` },
        body: ep.body
      });
      assert(res.status === 403, `Member blocked from ${ep.method} ${ep.path} with 403 Forbidden`);
    }

    // Member Isolation: Member 2 cannot view or edit Member 1's expense
    let m2ViewM1 = await makeRequest(serverUrl, `/api/finance/expense/${exp1.id}`, {
      headers: { 'Authorization': `Bearer ${otherMemberToken}` }
    });
    assert(m2ViewM1.status === 403, 'Member 2 cannot view Member 1 private expense (403 Forbidden)');

    let m2EditM1 = await makeRequest(serverUrl, `/api/finance/expense/${exp1.id}`, {
      method: 'PATCH',
      headers: { 'Authorization': `Bearer ${otherMemberToken}` },
      body: { title: 'Hijack title' }
    });
    assert(m2EditM1.status === 403, 'Member 2 cannot edit Member 1 expense (403 Forbidden)');

    // ==================================================================
    // FLOW 5: APPEND-ONLY FINAL SWEEP (DB TRIGGER ENFORCEMENT)
    // ==================================================================
    console.log('\n======================================================================');
    console.log('FLOW 5: APPEND-ONLY FINAL SWEEP (TRIGGER MUTATION IMMUTABILITY)');
    console.log('======================================================================');

    // 5.1 budget_history UPDATE / DELETE
    const bHist = queryOne('SELECT id FROM budget_history LIMIT 1');
    let bhUpAborted = false;
    try {
      execute("UPDATE budget_history SET reason = 'tamper' WHERE id = ?", [bHist.id]);
    } catch (e) {
      bhUpAborted = e.message.includes('budget_history is append-only');
    }
    assert(bhUpAborted, 'prevent_budget_history_update trigger strictly aborted UPDATE');

    let bhDelAborted = false;
    try {
      execute('DELETE FROM budget_history WHERE id = ?', [bHist.id]);
    } catch (e) {
      bhDelAborted = e.message.includes('budget_history is append-only');
    }
    assert(bhDelAborted, 'prevent_budget_history_delete trigger strictly aborted DELETE');

    // 5.2 expense_history UPDATE / DELETE
    const expHist = queryOne('SELECT id FROM expense_history LIMIT 1');
    let ehUpAborted = false;
    try {
      execute("UPDATE expense_history SET field_changed = 'tamper' WHERE id = ?", [expHist.id]);
    } catch (e) {
      ehUpAborted = e.message.includes('expense_history is append-only');
    }
    assert(ehUpAborted, 'prevent_expense_history_update trigger strictly aborted UPDATE');

    let ehDelAborted = false;
    try {
      execute('DELETE FROM expense_history WHERE id = ?', [expHist.id]);
    } catch (e) {
      ehDelAborted = e.message.includes('expense_history is append-only');
    }
    assert(ehDelAborted, 'prevent_expense_history_delete trigger strictly aborted DELETE');

    // 5.3 invoice_line_items UPDATE / DELETE
    const lineItem = queryOne('SELECT id FROM invoice_line_items LIMIT 1');
    let liUpAborted = false;
    try {
      execute('UPDATE invoice_line_items SET unit_price = 0 WHERE id = ?', [lineItem.id]);
    } catch (e) {
      liUpAborted = e.message.includes('invoice_line_items is append-only');
    }
    assert(liUpAborted, 'prevent_invoice_line_item_update trigger strictly aborted UPDATE');

    let liDelAborted = false;
    try {
      execute('DELETE FROM invoice_line_items WHERE id = ?', [lineItem.id]);
    } catch (e) {
      liDelAborted = e.message.includes('invoice_line_items is append-only');
    }
    assert(liDelAborted, 'prevent_invoice_line_item_delete trigger strictly aborted DELETE');

    // 5.4 budget_alerts DELETE
    const alertRow = queryOne('SELECT id FROM budget_alerts LIMIT 1');
    let alertDelAborted = false;
    try {
      execute('DELETE FROM budget_alerts WHERE id = ?', [alertRow.id]);
    } catch (e) {
      alertDelAborted = e.message.includes('budget_alerts is append-only');
    }
    assert(alertDelAborted, 'prevent_budget_alert_delete trigger strictly aborted DELETE');

    // ==================================================================
    // FLOW 6: DASHBOARD ROLLUP ARITHMETIC INTEGRITY
    // ==================================================================
    console.log('\n======================================================================');
    console.log('FLOW 6: DASHBOARD ROLLUP ARITHMETIC INTEGRITY (API VS DIRECT DB)');
    console.log('======================================================================');

    // Direct DB SQL Calculations
    const dbBudget = queryOne('SELECT COALESCE(SUM(total_budget), 0.0) as val FROM project_budgets');
    const expectedBudget = Math.round((dbBudget?.val || 0.0) * 100) / 100;

    const dbExp = queryOne("SELECT COALESCE(SUM(amount), 0.0) as val FROM project_expenses WHERE status = 'APPROVED'");
    const dbTime = queryOne("SELECT COALESCE(SUM((CAST(duration_minutes AS REAL)/60.0)*billable_rate), 0.0) as val FROM time_entries WHERE is_billable = 1 AND status = 'APPROVED'");
    const expectedConsumed = Math.round(((dbExp?.val || 0.0) + (dbTime?.val || 0.0)) * 100) / 100;
    const expectedRemaining = Math.round((expectedBudget - expectedConsumed) * 100) / 100;

    const dbInv = queryOne("SELECT COALESCE(SUM(total_amount), 0.0) as val FROM invoices WHERE status != 'CANCELLED'");
    const expectedInvoiced = Math.round((dbInv?.val || 0.0) * 100) / 100;

    const dbPaid = queryOne("SELECT COALESCE(SUM(paid_amount), 0.0) as val FROM invoices WHERE status = 'PAID' OR paid_amount > 0");
    const expectedPaid = Math.round((dbPaid?.val || 0.0) * 100) / 100;
    const expectedOutstanding = Math.round((expectedInvoiced - expectedPaid) * 100) / 100;

    // Fetch API Dashboard
    let finalDashRes = await makeRequest(serverUrl, '/api/finance/dashboard', {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(finalDashRes.status === 200, 'GET /api/finance/dashboard returns 200 OK');
    const d = finalDashRes.data;

    assert(d.total_budget === expectedBudget, `1. total_budget: API (${d.total_budget}) === DB (${expectedBudget})`);
    assert(d.total_consumed === expectedConsumed, `2. total_consumed: API (${d.total_consumed}) === DB (${expectedConsumed})`);
    assert(d.total_remaining === expectedRemaining, `3. total_remaining: API (${d.total_remaining}) === DB (${expectedRemaining})`);
    assert(d.total_invoiced === expectedInvoiced, `4. total_invoiced: API (${d.total_invoiced}) === DB (${expectedInvoiced})`);
    assert(d.total_paid === expectedPaid, `5. total_paid: API (${d.total_paid}) === DB (${expectedPaid})`);
    assert(d.total_outstanding === expectedOutstanding, `6. total_outstanding: API (${d.total_outstanding}) === DB (${expectedOutstanding})`);

    // Verify Project P&L Statement on Target Project
    let finalPLRes = await makeRequest(serverUrl, `/api/finance/report/project/${project.id}`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(finalPLRes.status === 200, 'GET /report/project/:id returns 200 OK');
    const pl = finalPLRes.data;
    // Expected project P&L: Total Paid Invoices (177,000) - Total Budget Consumption (126,000) = +51,000 INR
    assert(pl.paid === 177000.0, 'Project paid revenue is 177,000 INR');
    assert(pl.consumption.total_consumption === 126000.0, 'Project total consumption is 126,000 INR');
    assert(pl.profit_loss === 51000.0, 'Rule 12: Project P&L strictly equals 177k - 126k = +51,000 INR');
    assert(pl.profit_margin_pct === 28.81, 'Profit margin % is (51k / 177k) * 100 = 28.81%');

    // ==================================================================
    // FLOW 7: DEEP-SCAN FOR CONFIDENTIAL DATA LEAKAGE
    // ==================================================================
    console.log('\n======================================================================');
    console.log('FLOW 7: DEEP-SCAN FOR INTERNAL_NOTES CONFIDENTIALITY LEAKAGE');
    console.log('======================================================================');

    // 7.1 Admin request should have internal_notes
    let adminInvDetail = await makeRequest(serverUrl, `/api/finance/invoice/${invA.id}`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const adminInv = adminInvDetail.data.invoice || adminInvDetail.data;
    assert(adminInv.internal_notes === 'VIP Client — Handle with maximum priority', 'Admin detail view includes internal_notes');

    // 7.2 Client-facing request (?client_view=true) MUST NEVER have internal_notes
    let clientInvDetail = await makeRequest(serverUrl, `/api/finance/invoice/${invA.id}?client_view=true`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const clientInv = clientInvDetail.data.invoice || clientInvDetail.data;
    assert(clientInv.internal_notes === undefined, 'CRITICAL: internal_notes key is strictly omitted in client_view');
    assert(Object.keys(clientInv).indexOf('internal_notes') === -1, 'Deep scan confirms internal_notes key does not exist anywhere in object');
    assert(clientInv.notes === 'Payment due in 30 days', 'Public notes remain intact for client view');

  } finally {
    await new Promise(resolve => server.close(resolve));
    console.log('\n  Live test server closed cleanly.');
  }

  // ------------------------------------------------------------------
  // Summary
  // ------------------------------------------------------------------
  console.log('\n======================================================================');
  console.log(`PRD 25 MASTER INTEGRATION SUITE: ${passedTests}/${totalTests} PASS (${failedTests} FAILED)`);
  console.log('======================================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runMasterIntegrationSuite().catch(err => {
  console.error('Master integration suite fatal error:', err);
  process.exit(1);
});
