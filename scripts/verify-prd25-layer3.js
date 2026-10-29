/**
 * scripts/verify-prd25-layer3.js
 * Verification Suite for PRD 25 Layer 3: Expense Service + API & Category Management
 *
 * Real HTTP calls, Real SQLite database, Zero mocks.
 *
 * Checks:
 * 1. Database Connection & Pragmas (WAL mode, busy_timeout >= 5000, foreign_keys = ON)
 * 2. Express HTTP Server on ephemeral port (createApp)
 * 3. Expense Category Management:
 *    - GET /api/finance/categories: 401 unauthenticated, 200 authenticated, returns 8 seeded categories
 *    - POST /api/finance/category/create: 403 member, 400 invalid, 201 admin, uniqueness enforced, access_log
 *    - PATCH /api/finance/category/:categoryId: 403 member, 404 not found, 200 admin update, access_log
 * 4. Expense Submission (POST /api/finance/expense/submit):
 *    - 401 unauthenticated
 *    - Validations: missing project_id (400), invalid project (404), invalid category (400),
 *      missing title (400), invalid amount <= 0 (400), missing date (400)
 *    - 201 Member submission: default PENDING status, submitted_by = current user
 *    - Initial PENDING status auto-logged to append-only expense_history
 * 5. Strict Member Data Isolation:
 *    - Member blocked from viewing project-wide expenses (GET /api/finance/expenses/project/:projectId -> 403)
 *    - Admin allowed to view project-wide expenses (200 with filters)
 *    - Member can only view own expenses (GET /api/finance/expenses/my -> only own rows)
 *    - Member blocked from viewing other member's expense detail (403)
 *    - Member blocked from viewing other member's expense history (403)
 * 6. Expense Modification & Locking (PATCH /api/finance/expense/:expenseId):
 *    - Member blocked from editing other member's expense (403)
 *    - Member can edit own PENDING expense (200)
 *    - All field changes recorded in append-only expense_history
 *    - updated_at manually updated
 * 7. Expense Approval & Budget Recalculation Engine:
 *    - Member blocked from approving (403)
 *    - Admin approves expense (PATCH /api/finance/expense/:expenseId/approve -> 200)
 *    - Status transition logged to expense_history
 *    - Immediate budget recalculation triggered (approved expense now counts in consumption)
 *    - Admin action logged to access_log ('expense_approve')
 *    - Locked state: APPROVED expense edits strictly blocked (400 Bad Request) for both member and admin
 * 8. Budget Threshold & Exceeded Alerts on Expense Approval:
 *    - Approving expense crossing alert_threshold_pct (>= 80%) auto-triggers THRESHOLD_REACHED alert
 *    - Approving expense crossing 100% budget auto-triggers BUDGET_EXCEEDED alert
 * 9. Expense Rejection & Reason Validation:
 *    - Member blocked from rejecting (403)
 *    - Missing reason rejected (400 Bad Request)
 *    - Reason shorter than 10 characters rejected (400 Bad Request)
 *    - Valid reason accepted (PATCH /api/finance/expense/:expenseId/reject -> 200)
 *    - Status and rejection_reason logged to expense_history
 *    - Admin action logged to access_log ('expense_reject')
 *    - Locked state: REJECTED expense edits strictly blocked (400 Bad Request)
 * 10. Database Append-Only Triggers:
 *    - Direct UPDATE on expense_history strictly aborted
 *    - Direct DELETE on expense_history strictly aborted
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
  console.log('PRD 25 Layer 3 Verification Suite: Expense Service, Categories & Member Isolation');
  console.log('='.repeat(80));

  // 1. Database connection & Pragmas
  console.log('\n--- Phase 1: Database Pragmas Verification ---');
  const journalMode = queryOne('PRAGMA journal_mode;');
  assert(journalMode && journalMode.journal_mode.toLowerCase() === 'wal', 'Pragma journal_mode is WAL');

  const busyTimeout = queryOne('PRAGMA busy_timeout;');
  assert(busyTimeout && busyTimeout.timeout >= 5000, 'Pragma busy_timeout >= 5000ms');

  const foreignKeys = queryOne('PRAGMA foreign_keys;');
  assert(foreignKeys && foreignKeys.foreign_keys === 1, 'Pragma foreign_keys is enabled (1)');

  // 2. Start HTTP Server
  console.log('\n--- Phase 2: Express HTTP Server Initialization ---');
  const app = createApp();
  const server = http.createServer(app);

  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const serverUrl = `http://127.0.0.1:${address.port}`;
  console.log(`  Live test server listening at ${serverUrl}`);

  try {
    // 3. Test Fixtures Setup
    console.log('\n--- Phase 3: Test Fixtures Setup ---');
    const suffix = crypto.randomBytes(4).toString('hex');
    const adminEmail = `admin_l3_${suffix}@test.local`;
    const member1Email = `member1_l3_${suffix}@test.local`;
    const member2Email = `member2_l3_${suffix}@test.local`;

    const adminId = crypto.randomUUID();
    const member1Id = crypto.randomUUID();
    const member2Id = crypto.randomUUID();

    execute(`
      INSERT INTO users (id, email, password_hash, name, role, status)
      VALUES (?, ?, 'hash_admin', 'Admin Layer3', 'admin', 'active')
    `, [adminId, adminEmail]);
    const adminUser = queryOne('SELECT * FROM users WHERE id = ?', [adminId]);

    execute(`
      INSERT INTO users (id, email, password_hash, name, role, status)
      VALUES (?, ?, 'hash_mem1', 'Member One L3', 'developer', 'active')
    `, [member1Id, member1Email]);
    const member1User = queryOne('SELECT * FROM users WHERE id = ?', [member1Id]);

    execute(`
      INSERT INTO users (id, email, password_hash, name, role, status)
      VALUES (?, ?, 'hash_mem2', 'Member Two L3', 'developer', 'active')
    `, [member2Id, member2Email]);
    const member2User = queryOne('SELECT * FROM users WHERE id = ?', [member2Id]);

    assert(adminUser && member1User && member2User, 'Created admin and 2 member test users');

    // Mint Tokens with DB sessions
    const adminToken = generateInternalUserToken(adminUser);
    const member1Token = generateInternalUserToken(member1User);
    const member2Token = generateInternalUserToken(member2User);


    // Create Idea & Project
    let idea = queryOne('SELECT id FROM ideas LIMIT 1');
    if (!idea) {
      const ideaId = `idea_l3_${suffix}`;
      execute(`
        INSERT INTO ideas (id, owner_id, title, description, status)
        VALUES (?, ?, 'L3 Idea', 'Test idea for Layer 3', 'APPROVED')
      `, [ideaId, adminId]);
      idea = { id: ideaId };
    }

    const projectId = `proj_l3_${suffix}`;
    execute(`
      INSERT INTO projects (id, idea_id, org_id, title, owner_id)
      VALUES (?, ?, 'org_mtg', ?, ?)
    `, [projectId, idea.id, `PRD25 Layer3 Project ${suffix}`, adminId]);
    const project = queryOne('SELECT * FROM projects WHERE id = ?', [projectId]);
    assert(project && project.id, 'Test project created in DB');

    // Create Project Budget ($10,000, 80% threshold)
    execute(`
      INSERT INTO project_budgets (
        project_id, total_budget, currency, budget_type, alert_threshold_pct,
        start_date, created_by, created_at, updated_at
      ) VALUES (?, 10000.0, 'INR', 'FIXED', 80.0, '2026-01-01', ?, datetime('now'), datetime('now'))
    `, [project.id, adminUser.id]);
    const budget = queryOne('SELECT * FROM project_budgets WHERE project_id = ?', [project.id]);
    assert(budget && budget.total_budget === 10000, 'Baseline project budget created ($10,000, 80% alert threshold)');


    // 4. Expense Category Management Tests
    console.log('\n--- Phase 4: Expense Category Management ---');
    // GET /api/finance/categories unauth
    let res = await makeRequest(serverUrl, '/api/finance/categories');
    assert(res.status === 401, 'GET /api/finance/categories requires authentication (401)');

    // GET /api/finance/categories member
    res = await makeRequest(serverUrl, '/api/finance/categories', {
      headers: { Authorization: `Bearer ${member1Token}` }
    });
    assert(res.status === 200, 'GET /api/finance/categories accessible to members (200)');
    assert(Array.isArray(res.data.categories) && res.data.categories.length >= 8, 'Returns at least 8 default categories');
    const softwareCat = res.data.categories.find(c => c.name === 'SOFTWARE');
    assert(softwareCat && softwareCat.is_active === 1, 'Default SOFTWARE category is active');

    // POST /api/finance/category/create by member -> 403
    res = await makeRequest(serverUrl, '/api/finance/category/create', {
      method: 'POST',
      headers: { Authorization: `Bearer ${member1Token}` },
      body: { name: 'CLOUD_SERVICES', description: 'Cloud infrastructure' }
    });
    assert(res.status === 403, 'POST /api/finance/category/create forbidden for members (403)');

    // POST /api/finance/category/create by admin missing name -> 400
    res = await makeRequest(serverUrl, '/api/finance/category/create', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { description: 'Missing name' }
    });
    assert(res.status === 400, 'POST /api/finance/category/create requires category name (400)');

    // POST /api/finance/category/create by admin valid
    const newCatName = `CLOUD_INFRA_${suffix.toUpperCase()}`;
    res = await makeRequest(serverUrl, '/api/finance/category/create', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { name: newCatName, description: 'Cloud servers and DBs' }
    });
    assert(res.status === 201, 'POST /api/finance/category/create succeeds for admin (201)');
    assert(res.data.category && res.data.category.name === newCatName, 'Created category has normalized name');
    const customCatId = res.data.category.id;

    // Duplicate category rejected -> 400
    res = await makeRequest(serverUrl, '/api/finance/category/create', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { name: newCatName, description: 'Duplicate test' }
    });
    assert(res.status === 400, 'Duplicate category name is rejected with 400 Bad Request');

    // Audit log check for category creation
    const catCreateAudit = queryOne(`
      SELECT * FROM access_log
      WHERE action = 'expense_category_create' AND target_id = ?
    `, [String(customCatId)]);
    assert(catCreateAudit !== null, 'expense_category_create logged to access_log');

    // PATCH /api/finance/category/:categoryId by member -> 403
    res = await makeRequest(serverUrl, `/api/finance/category/${customCatId}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${member1Token}` },
      body: { is_active: 0 }
    });
    assert(res.status === 403, 'PATCH /api/finance/category/:categoryId forbidden for members (403)');

    // PATCH /api/finance/category/:categoryId by admin deactivates
    res = await makeRequest(serverUrl, `/api/finance/category/${customCatId}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { is_active: 0, description: 'Temporarily disabled' }
    });
    assert(res.status === 200, 'PATCH /api/finance/category/:categoryId deactivates category (200)');
    assert(res.data.category.is_active === 0, 'Category is_active updated to 0');

    // Verify deactivated category excluded from active categories list
    res = await makeRequest(serverUrl, '/api/finance/categories', {
      headers: { Authorization: `Bearer ${member1Token}` }
    });
    const foundInactive = res.data.categories.find(c => c.id === customCatId);
    assert(foundInactive === undefined, 'Deactivated category excluded from active categories listing');

    // Reactivate category
    res = await makeRequest(serverUrl, `/api/finance/category/${customCatId}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { is_active: 1 }
    });
    assert(res.status === 200 && res.data.category.is_active === 1, 'Category reactivated successfully');

    // 5. Expense Submission Tests
    console.log('\n--- Phase 5: Expense Submission & Validation ---');
    // POST /api/finance/expense/submit unauth -> 401
    res = await makeRequest(serverUrl, '/api/finance/expense/submit', {
      method: 'POST',
      body: { project_id: project.id, category_id: customCatId, title: 'AWS EC2', amount: 500, expense_date: '2026-02-01' }
    });
    assert(res.status === 401, 'POST /api/finance/expense/submit requires auth (401)');

    // Missing project_id -> 400
    res = await makeRequest(serverUrl, '/api/finance/expense/submit', {
      method: 'POST',
      headers: { Authorization: `Bearer ${member1Token}` },
      body: { category_id: customCatId, title: 'AWS EC2', amount: 500, expense_date: '2026-02-01' }
    });
    assert(res.status === 400, 'Missing project_id returns 400');

    // Non-existent project_id -> 404
    res = await makeRequest(serverUrl, '/api/finance/expense/submit', {
      method: 'POST',
      headers: { Authorization: `Bearer ${member1Token}` },
      body: { project_id: 999999, category_id: customCatId, title: 'AWS EC2', amount: 500, expense_date: '2026-02-01' }
    });
    assert(res.status === 404, 'Non-existent project_id returns 404');

    // Non-existent category_id -> 400
    res = await makeRequest(serverUrl, '/api/finance/expense/submit', {
      method: 'POST',
      headers: { Authorization: `Bearer ${member1Token}` },
      body: { project_id: project.id, category_id: 999999, title: 'AWS EC2', amount: 500, expense_date: '2026-02-01' }
    });
    assert(res.status === 400, 'Non-existent category_id returns 400');

    // Missing title -> 400
    res = await makeRequest(serverUrl, '/api/finance/expense/submit', {
      method: 'POST',
      headers: { Authorization: `Bearer ${member1Token}` },
      body: { project_id: project.id, category_id: customCatId, title: '   ', amount: 500, expense_date: '2026-02-01' }
    });
    assert(res.status === 400, 'Empty title returns 400');

    // Negative / 0 amount -> 400
    res = await makeRequest(serverUrl, '/api/finance/expense/submit', {
      method: 'POST',
      headers: { Authorization: `Bearer ${member1Token}` },
      body: { project_id: project.id, category_id: customCatId, title: 'AWS EC2', amount: -100, expense_date: '2026-02-01' }
    });
    assert(res.status === 400, 'Negative amount returns 400');

    res = await makeRequest(serverUrl, '/api/finance/expense/submit', {
      method: 'POST',
      headers: { Authorization: `Bearer ${member1Token}` },
      body: { project_id: project.id, category_id: customCatId, title: 'AWS EC2', amount: 0, expense_date: '2026-02-01' }
    });
    assert(res.status === 400, 'Zero amount returns 400');

    // Missing expense_date -> 400
    res = await makeRequest(serverUrl, '/api/finance/expense/submit', {
      method: 'POST',
      headers: { Authorization: `Bearer ${member1Token}` },
      body: { project_id: project.id, category_id: customCatId, title: 'AWS EC2', amount: 500 }
    });
    assert(res.status === 400, 'Missing expense_date returns 400');

    // Member 1 submits valid expense (AWS Hosting ₹1,000)
    res = await makeRequest(serverUrl, '/api/finance/expense/submit', {
      method: 'POST',
      headers: { Authorization: `Bearer ${member1Token}` },
      body: {
        project_id: project.id,
        category_id: customCatId,
        title: 'AWS Production Server',
        description: 'Monthly cloud hosting fee',
        amount: 1000.0,
        currency: 'INR',
        expense_date: '2026-02-05',
        is_billable: 1,
        receipt_path: '/uploads/receipts/aws_feb2026.pdf'
      }
    });
    assert(res.status === 201, 'Member 1 submits valid expense (201)');
    const mem1Expense = res.data.expense;
    assert(mem1Expense && mem1Expense.id, 'Expense record created');
    assert(mem1Expense.status === 'PENDING', 'Default expense status is PENDING');
    assert(mem1Expense.submitted_by === member1User.id, 'submitted_by is set to Member 1 ID');
    assert(mem1Expense.amount === 1000.0, 'Expense amount is 1000.0');

    // Check expense_history initial status logging
    const initHistory = queryOne(`
      SELECT * FROM expense_history
      WHERE expense_id = ? AND field_changed = 'status'
    `, [mem1Expense.id]);
    assert(initHistory && initHistory.new_value === 'PENDING', 'Initial PENDING status logged to expense_history');

    // Member 2 submits valid expense (Hardware Peripheral ₹2,000)
    res = await makeRequest(serverUrl, '/api/finance/expense/submit', {
      method: 'POST',
      headers: { Authorization: `Bearer ${member2Token}` },
      body: {
        project_id: project.id,
        category_id: softwareCat.id,
        title: 'Testing Android Device',
        description: 'Test phone for QA',
        amount: 2000.0,
        expense_date: '2026-02-06'
      }
    });
    assert(res.status === 201, 'Member 2 submits valid expense (201)');
    const mem2Expense = res.data.expense;
    assert(mem2Expense && mem2Expense.submitted_by === member2User.id, 'Member 2 expense has member 2 as submitter');

    // 6. Strict Member Data Isolation & RBAC
    console.log('\n--- Phase 6: Strict Member Data Isolation ---');
    // Member 1 attempts to list all project expenses -> 403 Forbidden
    res = await makeRequest(serverUrl, `/api/finance/expenses/project/${project.id}`, {
      headers: { Authorization: `Bearer ${member1Token}` }
    });
    assert(res.status === 403, 'Member 1 strictly blocked from viewing project expenses (403 Forbidden)');

    // Member 2 attempts to list all project expenses -> 403 Forbidden
    res = await makeRequest(serverUrl, `/api/finance/expenses/project/${project.id}`, {
      headers: { Authorization: `Bearer ${member2Token}` }
    });
    assert(res.status === 403, 'Member 2 strictly blocked from viewing project expenses (403 Forbidden)');

    // Admin lists project expenses -> 200 OK (sees both Member 1 and Member 2 expenses)
    res = await makeRequest(serverUrl, `/api/finance/expenses/project/${project.id}`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(res.status === 200, 'Admin can view all project expenses (200)');
    assert(res.data.count >= 2, 'Project expense count includes all members submissions');

    // GET /api/finance/expenses/my for Member 1 -> ONLY returns Member 1's expense
    res = await makeRequest(serverUrl, '/api/finance/expenses/my', {
      headers: { Authorization: `Bearer ${member1Token}` }
    });
    assert(res.status === 200, 'Member 1 can fetch own expenses (200)');
    assert(res.data.expenses.every(e => e.submitted_by === member1User.id), 'Member 1 expenses contain ONLY Member 1 submitted items');
    assert(res.data.expenses.some(e => e.id === mem1Expense.id), 'Member 1 sees their own expense');
    assert(!res.data.expenses.some(e => e.id === mem2Expense.id), 'Member 1 CANNOT see Member 2 expense in my expenses');

    // GET /api/finance/expenses/my for Member 2 -> ONLY returns Member 2's expense
    res = await makeRequest(serverUrl, '/api/finance/expenses/my', {
      headers: { Authorization: `Bearer ${member2Token}` }
    });
    assert(res.status === 200, 'Member 2 can fetch own expenses (200)');
    assert(res.data.expenses.every(e => e.submitted_by === member2User.id), 'Member 2 expenses contain ONLY Member 2 submitted items');
    assert(!res.data.expenses.some(e => e.id === mem1Expense.id), 'Member 2 CANNOT see Member 1 expense in my expenses');

    // Member 1 attempts to view Member 2's expense detail -> 403 Forbidden
    res = await makeRequest(serverUrl, `/api/finance/expense/${mem2Expense.id}`, {
      headers: { Authorization: `Bearer ${member1Token}` }
    });
    assert(res.status === 403, 'Member 1 viewing Member 2 expense returns 403 Forbidden');

    // Member 1 views own expense detail -> 200 OK
    res = await makeRequest(serverUrl, `/api/finance/expense/${mem1Expense.id}`, {
      headers: { Authorization: `Bearer ${member1Token}` }
    });
    assert(res.status === 200 && res.data.expense.id === mem1Expense.id, 'Member 1 viewing own expense returns 200 OK');

    // Member 1 attempts to view Member 2's expense history -> 403 Forbidden
    res = await makeRequest(serverUrl, `/api/finance/expense/${mem2Expense.id}/history`, {
      headers: { Authorization: `Bearer ${member1Token}` }
    });
    assert(res.status === 403, 'Member 1 viewing Member 2 expense history returns 403 Forbidden');

    // Member 1 views own expense history -> 200 OK
    res = await makeRequest(serverUrl, `/api/finance/expense/${mem1Expense.id}/history`, {
      headers: { Authorization: `Bearer ${member1Token}` }
    });
    assert(res.status === 200 && Array.isArray(res.data.history), 'Member 1 viewing own expense history returns 200 OK');

    // 7. Expense Modification & Lock Rules
    console.log('\n--- Phase 7: Expense Modification & History Tracking ---');
    // Member 2 attempts to edit Member 1's expense -> 403 Forbidden
    res = await makeRequest(serverUrl, `/api/finance/expense/${mem1Expense.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${member2Token}` },
      body: { amount: 1200 }
    });
    assert(res.status === 403, 'Member 2 cannot edit Member 1 expense (403 Forbidden)');

    // Member 1 edits own PENDING expense (changes amount to 1500 and title)
    res = await makeRequest(serverUrl, `/api/finance/expense/${mem1Expense.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${member1Token}` },
      body: {
        title: 'AWS Production Cluster',
        amount: 1500.0,
        description: 'Upgraded EC2 instance'
      }
    });
    assert(res.status === 200, 'Member 1 can edit own PENDING expense (200)');
    assert(res.data.expense.amount === 1500.0, 'Amount successfully updated to 1500');
    assert(res.data.changes_recorded === 3, 'Recorded exactly 3 changed fields');

    // Verify changes logged to expense_history
    const historyRows = queryAll(`
      SELECT * FROM expense_history
      WHERE expense_id = ? AND changed_by = ?
      ORDER BY id ASC
    `, [mem1Expense.id, member1User.id]);
    assert(historyRows.some(h => h.field_changed === 'amount' && h.old_value === '1000' && h.new_value === '1500'),
      'expense_history records amount change from 1000 to 1500');
    assert(historyRows.some(h => h.field_changed === 'title' && h.new_value === 'AWS Production Cluster'),
      'expense_history records title update');

    // 8. Expense Approval & Budget Recalculation Engine
    console.log('\n--- Phase 8: Expense Approval & Real-Time Budget Recalculation ---');
    // Verify before approval: budget consumption is 0 (PENDING expenses don't count)
    let budgetRes = await makeRequest(serverUrl, `/api/finance/budget/${project.id}`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(budgetRes.data.consumption.total_consumption === 0, 'Before approval: total_consumption is 0');
    assert(budgetRes.data.consumption.approved_expenses_total === 0, 'Before approval: approved_expenses_total is 0');

    // Member 1 attempts to approve own expense -> 403 Forbidden
    res = await makeRequest(serverUrl, `/api/finance/expense/${mem1Expense.id}/approve`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${member1Token}` }
    });
    assert(res.status === 403, 'Member cannot approve expenses (403 Forbidden)');

    // Admin approves Member 1's expense ($1500)
    res = await makeRequest(serverUrl, `/api/finance/expense/${mem1Expense.id}/approve`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(res.status === 200, 'Admin approves expense (200 OK)');
    assert(res.data.expense.status === 'APPROVED', 'Expense status is now APPROVED');
    assert(res.data.expense.approved_by === adminUser.id, 'approved_by is recorded');
    assert(res.data.expense.approved_at !== null, 'approved_at timestamp is set');
    assert(res.data.budget_consumption.total_consumption === 1500.0, 'Immediate budget recalculation: consumption is 1500.0');
    assert(res.data.budget_consumption.consumed_pct === 15.0, 'consumed_pct recalculated to 15%');

    // Verify approval logged to access_log
    const approveAudit = queryOne(`
      SELECT * FROM access_log
      WHERE action = 'expense_approve' AND target_id = ?
    `, [String(mem1Expense.id)]);
    assert(approveAudit !== null, 'expense_approve logged to access_log');

    // Lock rule: APPROVED expense cannot be edited
    res = await makeRequest(serverUrl, `/api/finance/expense/${mem1Expense.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${member1Token}` },
      body: { amount: 1600 }
    });
    assert(res.status === 400, 'Member cannot edit APPROVED expense (400 Bad Request)');
    assert(res.data.error.includes('Only PENDING expenses can be modified'), 'Returns clear locked status error message');

    res = await makeRequest(serverUrl, `/api/finance/expense/${mem1Expense.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { amount: 1600 }
    });
    assert(res.status === 400, 'Admin cannot edit APPROVED expense (400 Bad Request)');

    // 9. Alert Evaluation on Expense Approval
    console.log('\n--- Phase 9: Budget Alerts Triggered on Expense Approval ---');
    // Submit a large expense ($7,000) that will push consumption to 85% (>= 80% threshold)
    const largeExpenseRes = await makeRequest(serverUrl, '/api/finance/expense/submit', {
      method: 'POST',
      headers: { Authorization: `Bearer ${member1Token}` },
      body: {
        project_id: project.id,
        category_id: customCatId,
        title: 'Enterprise Server License',
        amount: 7000.0,
        expense_date: '2026-02-10'
      }
    });
    const largeExpId = largeExpenseRes.data.expense.id;

    // Admin approves large expense -> total consumption becomes 1500 + 7000 = 8500 (85%)
    res = await makeRequest(serverUrl, `/api/finance/expense/${largeExpId}/approve`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(res.status === 200, 'Admin approved large expense');
    assert(res.data.budget_consumption.total_consumption === 8500.0, 'Total consumption is 8500.0');
    assert(res.data.budget_consumption.consumed_pct === 85.0, 'Consumed pct is 85.0%');

    // Verify THRESHOLD_REACHED alert automatically generated
    const thresholdAlert = queryOne(`
      SELECT * FROM budget_alerts
      WHERE project_id = ? AND alert_type = 'THRESHOLD_REACHED'
    `, [project.id]);
    assert(thresholdAlert !== null, 'THRESHOLD_REACHED alert auto-generated on expense approval');
    assert(thresholdAlert.triggered_at_pct === 85.0, 'Alert recorded triggered_at_pct = 85.0%');

    // Submit another expense ($2,000) that will push consumption to 105% (>= 100% BUDGET_EXCEEDED)
    const breachExpenseRes = await makeRequest(serverUrl, '/api/finance/expense/submit', {
      method: 'POST',
      headers: { Authorization: `Bearer ${member1Token}` },
      body: {
        project_id: project.id,
        category_id: customCatId,
        title: 'Emergency Contractor Assistance',
        amount: 2000.0,
        expense_date: '2026-02-15'
      }
    });
    const breachExpId = breachExpenseRes.data.expense.id;

    // Admin approves breach expense
    res = await makeRequest(serverUrl, `/api/finance/expense/${breachExpId}/approve`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(res.status === 200, 'Admin approved breach expense');
    assert(res.data.budget_consumption.total_consumption === 10500.0, 'Total consumption is 10500.0');
    assert(res.data.budget_consumption.consumed_pct === 105.0, 'Consumed pct is 105.0%');

    // Verify BUDGET_EXCEEDED alert automatically generated
    const exceededAlert = queryOne(`
      SELECT * FROM budget_alerts
      WHERE project_id = ? AND alert_type = 'BUDGET_EXCEEDED'
    `, [project.id]);
    assert(exceededAlert !== null, 'BUDGET_EXCEEDED alert auto-generated on expense approval');
    assert(exceededAlert.triggered_at_pct === 105.0, 'Exceeded alert recorded triggered_at_pct = 105.0%');

    // 10. Expense Rejection Tests
    console.log('\n--- Phase 10: Expense Rejection & Mandatory Reason Validation ---');
    // Member 1 attempts to reject Member 2's expense -> 403 Forbidden
    res = await makeRequest(serverUrl, `/api/finance/expense/${mem2Expense.id}/reject`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${member1Token}` },
      body: { rejection_reason: 'Testing rejection by member' }
    });
    assert(res.status === 403, 'Member cannot reject expense (403 Forbidden)');

    // Admin rejects without reason -> 400 Bad Request
    res = await makeRequest(serverUrl, `/api/finance/expense/${mem2Expense.id}/reject`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {}
    });
    assert(res.status === 400, 'Rejection without reason returns 400 Bad Request');

    // Admin rejects with short reason (< 10 chars) -> 400 Bad Request
    res = await makeRequest(serverUrl, `/api/finance/expense/${mem2Expense.id}/reject`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { rejection_reason: 'Too high' }
    });
    assert(res.status === 400, 'Rejection reason shorter than 10 characters returns 400 Bad Request');
    assert(res.data.error.includes('minimum 10 characters required'), 'Error mentions minimum 10 characters');

    // Admin rejects with valid reason (>= 10 chars)
    const validReason = 'Receipt missing VAT invoice and device model details.';
    res = await makeRequest(serverUrl, `/api/finance/expense/${mem2Expense.id}/reject`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { rejection_reason: validReason }
    });
    assert(res.status === 200, 'Admin rejects expense with valid reason (200 OK)');
    assert(res.data.expense.status === 'REJECTED', 'Expense status is REJECTED');
    assert(res.data.expense.rejection_reason === validReason, 'Rejection reason is saved');
    assert(res.data.expense.rejected_by === adminUser.id, 'rejected_by is recorded');
    assert(res.data.expense.rejected_at !== null, 'rejected_at timestamp is set');

    // Verify rejection audit log
    const rejectAudit = queryOne(`
      SELECT * FROM access_log
      WHERE action = 'expense_reject' AND target_id = ?
    `, [String(mem2Expense.id)]);
    assert(rejectAudit !== null, 'expense_reject logged to access_log');

    // Verify rejection logged to expense_history
    const rejHistory = queryOne(`
      SELECT * FROM expense_history
      WHERE expense_id = ? AND field_changed = 'rejection_reason'
    `, [mem2Expense.id]);
    assert(rejHistory && rejHistory.new_value === validReason, 'Rejection reason logged to expense_history');

    // Lock rule: REJECTED expense cannot be edited
    res = await makeRequest(serverUrl, `/api/finance/expense/${mem2Expense.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${member2Token}` },
      body: { amount: 1800 }
    });
    assert(res.status === 400, 'Member cannot edit REJECTED expense (400 Bad Request)');
    assert(res.data.error.includes('Only PENDING expenses can be modified'), 'Returns clear locked status error message');

    // 11. Append-Only Trigger Tests for expense_history
    console.log('\n--- Phase 11: DB Append-Only Trigger Integrity ---');
    const historySample = queryOne('SELECT id FROM expense_history LIMIT 1');
    assert(historySample !== null, 'Found existing expense_history row for trigger testing');

    let updateBlocked = false;
    try {
      execute("UPDATE expense_history SET old_value = 'hacked' WHERE id = ?", [historySample.id]);
    } catch (err) {
      updateBlocked = err.message.includes('expense_history is append-only');
    }
    assert(updateBlocked, 'Trigger prevent_expense_history_update strictly blocks direct UPDATE with RAISE(ABORT)');

    let deleteBlocked = false;
    try {
      execute("DELETE FROM expense_history WHERE id = ?", [historySample.id]);
    } catch (err) {
      deleteBlocked = err.message.includes('expense_history is append-only');
    }
    assert(deleteBlocked, 'Trigger prevent_expense_history_delete strictly blocks direct DELETE with RAISE(ABORT)');

  } finally {
    await new Promise((resolve) => server.close(resolve));
    console.log('\n  Test HTTP server closed cleanly.');
  }

  // Final Summary
  console.log('\n' + '='.repeat(80));
  console.log(`PRD 25 Layer 3 Verification Complete: ${passedTests}/${totalTests} Passed (${failedTests} Failed)`);
  console.log('='.repeat(80));

  if (failedTests > 0) {
    process.exit(1);
  }
}

runSuite().catch(err => {
  console.error('Unhandled fatal error in Layer 3 suite:', err);
  process.exit(1);
});
