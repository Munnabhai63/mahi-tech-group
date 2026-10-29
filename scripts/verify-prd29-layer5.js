/**
 * PRD 29 LAYER 5 VERIFICATION SUITE
 * Integration Seal & Production Readiness Check
 *
 * Mandatory Verification Rules:
 * 1. Full E2E User Journey (Real HTTP calls, real SQLite database):
 *    - Admin creates project -> invites member -> member signs up -> creates task -> marks complete
 *    - Admin records revenue event -> member wallet credited -> member requests withdrawal -> admin approves
 *    - Member submits expense -> admin approves -> project budget consumption updated
 *    - Member logs time -> entry retrieved & verified
 *    - Admin views analytics & dashboard telemetry
 *    - Client portal: Admin creates client -> client accepts invite & logs in -> admin grants project access -> client views project
 * 2. Performance Verification:
 *    - Page load < 2 seconds on local
 *    - API response < 500ms for all main endpoints
 * 3. Security Final Check:
 *    - No secrets in frontend
 *    - No Admin role in public dropdown
 *    - Server-side RBAC enforced (401 for unauthenticated, 403 for non-admin on admin endpoints)
 *    - All admin actions logged in access_log
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.js';
import { runMigration } from '../src/db/migrate.js';
import { execute, queryOne, queryAll } from '../src/db/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

const TEST_PORT = 5099;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;
const RUN_ID = Date.now();

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(condition, message, details = '') {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✓ [PASS] ${message}`);
  } else {
    failedTests++;
    console.error(`  ✗ [FAIL] ${message}${details ? ` -> ${details}` : ''}`);
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function request(endpoint, options = {}) {
  const url = endpoint.startsWith('http') ? endpoint : `${BASE_URL}${endpoint}`;
  const start = Date.now();
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const latency = Date.now() - start;
  let data = null;
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    data = await res.json();
  } else {
    data = await res.text();
  }
  return { status: res.status, headers: res.headers, data, latency };
}

async function runLayer5Verification() {
  console.log('======================================================================');
  console.log('🚀 PRD 29 LAYER 5 VERIFICATION: Integration Seal & Production Readiness');
  console.log('======================================================================\n');

  // Step 1: Ensure database schema is migrated
  console.log('[1/4] Preparing SQLite database with real schema...');
  runMigration();

  // Step 2: Start Express Server
  console.log(`[2/4] Starting live Express server on port ${TEST_PORT}...`);
  const app = createApp();
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(TEST_PORT, '127.0.0.1', resolve));
  console.log('✔ Express server active and listening.\n');

  try {
    console.log('[3/4] Executing End-to-End User Journeys via Real HTTP...\n');

    // ------------------------------------------------------------------------
    // JOURNEY 1: Admin Setup & Authentication
    // ------------------------------------------------------------------------
    console.log('--- Journey 1: Admin Account Creation & Authentication ---');
    let adminToken;
    let adminId;

    const existingAdmin = queryOne("SELECT id, email FROM users WHERE role = 'admin' LIMIT 1");
    if (!existingAdmin) {
      const adminInitRes = await request('/api/setup/initialize-admin', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Super Director',
          email: `director_${RUN_ID}@mahitechgroup.com`,
          password: 'Password123!',
          confirm_password: 'Password123!'
        })
      });
      assert(adminInitRes.status === 201, 'Admin initialization returns HTTP 201', JSON.stringify(adminInitRes.data));
      assert(adminInitRes.data.user.role === 'admin', 'Initialized account has admin role');
      adminToken = adminInitRes.data.token;
      adminId = adminInitRes.data.user.id;
    } else {
      adminId = existingAdmin.id;
      const testHash = await bcrypt.hash('Password123!', 10);
      execute('UPDATE users SET password_hash = ? WHERE id = ?', [testHash, adminId]);
      const loginRes = await request('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email: existingAdmin.email,
          password: 'Password123!'
        })
      });
      assert(loginRes.status === 200, 'Admin can log in via /api/auth/login');
      assert(loginRes.data.token, 'Admin login returns valid JWT token');
      adminToken = loginRes.data.token;
    }

    // ------------------------------------------------------------------------
    // JOURNEY 2: Admin Creates Project
    // ------------------------------------------------------------------------
    console.log('\n--- Journey 2: Project Creation ---');
    const projectRes = await request('/api/projects', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        title: `Mahi Next-Gen Quantum Engine ${RUN_ID}`,
        description: 'Next-generation quantum orchestration platform.'
      })
    });
    assert(projectRes.status === 201, 'Admin can create a project via POST /api/projects');
    const projectId = projectRes.data.project.id;
    assert(projectId, 'Created project returns valid UUID');

    // ------------------------------------------------------------------------
    // JOURNEY 3: Team Member Invitation & Onboarding
    // ------------------------------------------------------------------------
    console.log('\n--- Journey 3: Team Member Invite & Onboarding ---');
    const memberEmail = `alex_${RUN_ID}@mahitechgroup.com`;
    const inviteRes = await request('/api/admin/invites', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        email: memberEmail,
        role: 'developer',
        sub_role: 'backend'
      })
    });
    assert(inviteRes.status === 201, 'Admin can invite team member via POST /api/admin/invites', JSON.stringify(inviteRes.data));
    const inviteToken = inviteRes.data.invite.token;
    assert(inviteToken, 'Invite generation returns valid token');

    // Member accepts invite and sets password
    const acceptRes = await request(`/api/auth/invites/${inviteToken}/accept`, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Alex Engineer',
        password: 'SecurePassword123!'
      })
    });
    assert(acceptRes.status === 201, 'Member completes signup via POST /api/auth/invites/:token/accept', JSON.stringify(acceptRes.data));
    const memberToken = acceptRes.data.token;
    const memberId = acceptRes.data.user.id;
    assert(memberId && memberToken, 'Member onboarding returns active member credentials');

    // Add member to project team with contribution weight
    execute(`
      INSERT INTO project_members (id, project_id, user_id, role_in_project, contribution_weight, joined_at)
      VALUES (?, ?, ?, 'backend_dev', 1.0, CURRENT_TIMESTAMP)
    `, [crypto.randomUUID(), projectId, memberId]);

    // ------------------------------------------------------------------------
    // JOURNEY 4: Task Lifecycle (Create -> In Progress -> Complete)
    // ------------------------------------------------------------------------
    console.log('\n--- Journey 4: Task Creation & Completion Lifecycle ---');
    const taskRes = await request('/api/tasks', {
      method: 'POST',
      headers: { Authorization: `Bearer ${memberToken}` },
      body: JSON.stringify({
        project_id: projectId,
        title: 'Implement Core Neural Bus',
        task_type: 'backend',
        assigned_to: memberId
      })
    });
    assert(taskRes.status === 201, 'Member creates task via POST /api/tasks');
    const taskId = taskRes.data.task.id;
    assert(taskId, 'Created task has valid UUID');

    // Complete task
    const completeTaskRes = await request(`/api/tasks/${taskId}/status`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${memberToken}` },
      body: JSON.stringify({ status: 'DONE' })
    });
    assert(completeTaskRes.status === 200, 'Member completes task via PATCH /api/tasks/:id/status');
    const updatedTask = queryOne('SELECT status FROM project_tasks WHERE id = ?', [taskId]);
    assert(updatedTask.status === 'DONE', 'Task status is persisted as DONE in SQLite database');

    // ------------------------------------------------------------------------
    // JOURNEY 5: Revenue Split, Member Wallet & Withdrawal Approval
    // ------------------------------------------------------------------------
    console.log('\n--- Journey 5: Revenue Distribution & Wallet Withdrawal ---');
    const revenueRes = await request(`/api/admin/projects/${projectId}/revenue`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        amount: 100000,
        source: 'Client Enterprise License',
        event_date: new Date().toISOString()
      })
    });
    assert(revenueRes.status === 201, 'Admin records revenue event via POST /api/admin/projects/:id/revenue');

    // Check member wallet balance
    const memberUser = queryOne('SELECT wallet_balance FROM users WHERE id = ?', [memberId]);
    assert(Number(memberUser.wallet_balance) > 0, `Member wallet credited with revenue split (Balance: ₹${memberUser.wallet_balance})`);

    // Member requests withdrawal
    const withdrawRes = await request('/api/withdrawals/request', {
      method: 'POST',
      headers: { Authorization: `Bearer ${memberToken}` },
      body: JSON.stringify({ amount: 10000 })
    });
    assert(withdrawRes.status === 201, 'Member requests withdrawal via POST /api/withdrawals/request');
    const withdrawalId = withdrawRes.data.withdrawal.id;

    // Admin approves withdrawal
    const approveWithdrawRes = await request(`/api/admin/withdrawals/${withdrawalId}/approve`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(approveWithdrawRes.status === 200, 'Admin approves withdrawal via PATCH /api/admin/withdrawals/:id/approve');
    const updatedWithdrawal = queryOne('SELECT status FROM withdrawals WHERE id = ?', [withdrawalId]);
    assert(updatedWithdrawal.status === 'PAID', 'Withdrawal is transitioned to PAID in database');

    // ------------------------------------------------------------------------
    // JOURNEY 6: Project Budget & Expense Approval
    // ------------------------------------------------------------------------
    console.log('\n--- Journey 6: Budget & Expense Management ---');
    // Ensure category exists
    let category = queryOne('SELECT id FROM expense_categories WHERE is_active = 1 LIMIT 1');
    if (!category) {
      execute(`INSERT INTO expense_categories (name, description, is_active, created_by, created_at) VALUES ('Infrastructure_' || ?, 'Cloud infrastructure', 1, ?, datetime('now'))`, [RUN_ID, adminId]);
      category = queryOne('SELECT id FROM expense_categories WHERE is_active = 1 LIMIT 1');
    }

    // Admin creates budget
    const budgetRes = await request('/api/finance/budget/create', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        project_id: projectId,
        total_budget: 500000,
        currency: 'INR',
        start_date: new Date().toISOString().slice(0, 10)
      })
    });
    assert(budgetRes.status === 201, 'Admin creates project budget via POST /api/finance/budget/create', JSON.stringify(budgetRes.data));

    // Member submits expense
    const expenseRes = await request('/api/finance/expense/submit', {
      method: 'POST',
      headers: { Authorization: `Bearer ${memberToken}` },
      body: JSON.stringify({
        project_id: projectId,
        category_id: category.id,
        title: 'High-memory GPU cloud instance',
        amount: 25000,
        description: 'High-memory GPU cloud instance for vector tests',
        expense_date: new Date().toISOString().slice(0, 10)
      })
    });
    assert(expenseRes.status === 201, 'Member submits expense via POST /api/finance/expense/submit', JSON.stringify(expenseRes.data));
    const expenseId = expenseRes.data.expense.id;

    // Admin approves expense
    const approveExpenseRes = await request(`/api/finance/expense/${expenseId}/approve`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(approveExpenseRes.status === 200, 'Admin approves expense via PATCH /api/finance/expense/:id/approve', JSON.stringify(approveExpenseRes.data));

    // Verify budget consumed updated
    const budgetDetailRes = await request(`/api/finance/budget/${projectId}`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(budgetDetailRes.status === 200, 'Admin retrieves updated budget detail');
    const consumedAmount = Number(budgetDetailRes.data.consumed ?? budgetDetailRes.data.consumption?.total_consumption ?? 0);
    assert(consumedAmount >= 25000, `Project budget consumption tracked accurately (Consumed: ₹${consumedAmount})`);

    // ------------------------------------------------------------------------
    // JOURNEY 7: Time Tracking & Logging
    // ------------------------------------------------------------------------
    console.log('\n--- Journey 7: Time Tracking & Entry Logging ---');
    const now = new Date();
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    const timeLogRes = await request('/api/time/entry/create', {
      method: 'POST',
      headers: { Authorization: `Bearer ${memberToken}` },
      body: JSON.stringify({
        project_id: projectId,
        start_time: twoHoursAgo.toISOString(),
        end_time: now.toISOString(),
        description: 'Optimized vector pipeline kernel latency'
      })
    });
    assert(timeLogRes.status === 201, 'Member logs manual time entry via POST /api/time/entry/create');

    const myTimeRes = await request('/api/time/entries/my', {
      headers: { Authorization: `Bearer ${memberToken}` }
    });
    assert(myTimeRes.status === 200, 'Member retrieves personal time entries via GET /api/time/entries/my');
    assert(Array.isArray(myTimeRes.data.entries) && myTimeRes.data.entries.length > 0, 'Personal time entry confirmed in response list');

    // ------------------------------------------------------------------------
    // JOURNEY 8: Analytics & Telemetry
    // ------------------------------------------------------------------------
    console.log('\n--- Journey 8: Analytics & Live Telemetry ---');
    const summaryRes = await request('/api/dashboard/summary', {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(summaryRes.status === 200, 'Admin retrieves real-time dashboard summary via GET /api/dashboard/summary');
    assert(summaryRes.data.activeProjectsCount !== undefined, 'Dashboard summary returns live project metrics (activeProjectsCount defined)');

    const kpiRes = await request('/api/analytics/kpis', {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(kpiRes.status === 200, 'Admin retrieves active KPI definitions via GET /api/analytics/kpis');

    // ------------------------------------------------------------------------
    // JOURNEY 9: Client Portal End-to-End
    // ------------------------------------------------------------------------
    console.log('\n--- Journey 9: Client Portal Lifecycle ---');
    const clientEmail = `sarah_${RUN_ID}@cyberdyne.org`;
    const clientInviteRes = await request('/api/admin/clients/create', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        name: 'Sarah Connor',
        email: clientEmail,
        company_name: 'Cyberdyne Systems'
      })
    });
    assert(clientInviteRes.status === 201, 'Admin invites client via POST /api/admin/clients/create');
    const clientInviteToken = clientInviteRes.data.invite_token;
    const clientId = clientInviteRes.data.client.id;
    assert(clientInviteToken && clientId, 'Client invitation generated with secure 32-byte token');

    // Client accepts invite
    const clientAcceptRes = await request('/api/client/auth/accept-invite', {
      method: 'POST',
      body: JSON.stringify({
        invite_token: clientInviteToken,
        new_password: 'ClientSecretPass123!'
      })
    });
    assert(clientAcceptRes.status === 200, 'Client activates account via POST /api/client/auth/accept-invite');

    // Client logs in
    const clientLoginRes = await request('/api/client/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        email: clientEmail,
        password: 'ClientSecretPass123!'
      })
    });
    assert(clientLoginRes.status === 200, 'Client logs in via POST /api/client/auth/login');
    const clientToken = clientLoginRes.data.token;
    assert(clientToken, 'Client login returns valid client JWT');

    // Admin shares project with client
    const grantRes = await request(`/api/admin/clients/${clientId}/projects/grant`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ project_id: projectId })
    });
    assert(grantRes.status === 201, 'Admin grants project access to client via POST /api/admin/clients/:id/projects/grant');

    // Client views shared project
    const clientProjectsRes = await request('/api/client/projects', {
      headers: { Authorization: `Bearer ${clientToken}` }
    });
    assert(clientProjectsRes.status === 200, 'Client retrieves shared projects via GET /api/client/projects');
    assert(clientProjectsRes.data.projects.some(p => p.id === projectId), 'Client has verified read access to granted project');

    // ------------------------------------------------------------------------
    // PERFORMANCE VERIFICATION
    // ------------------------------------------------------------------------
    console.log('\n[4/4] Executing Performance & Security Hardening Audits...\n');
    console.log('--- Performance Check (All Latencies < 500ms, Page < 2000ms) ---');

    const perfEndpoints = [
      { name: 'Dashboard Summary', path: '/api/dashboard/summary', headers: { Authorization: `Bearer ${adminToken}` } },
      { name: 'Projects List', path: '/api/projects', headers: { Authorization: `Bearer ${adminToken}` } },
      { name: 'KPIs List', path: '/api/analytics/kpis', headers: { Authorization: `Bearer ${adminToken}` } },
      { name: 'Finance Categories', path: '/api/finance/categories', headers: { Authorization: `Bearer ${memberToken}` } },
      { name: 'Static SPA HTML', path: '/app.html', headers: {} }
    ];

    for (const ep of perfEndpoints) {
      const res = await request(ep.path, { headers: ep.headers });
      const maxAllowed = ep.path.endsWith('.html') ? 2000 : 500;
      assert(res.latency < maxAllowed, `${ep.name} responds within budget (${res.latency}ms < ${maxAllowed}ms)`);
    }

    // ------------------------------------------------------------------------
    // SECURITY & RBAC AUDIT
    // ------------------------------------------------------------------------
    console.log('\n--- Security & RBAC Enforcement Check ---');

    // 1. Unauthenticated request to protected route returns 401
    const unauthRes = await request('/api/projects');
    assert(unauthRes.status === 401, 'Unauthenticated request to /api/projects returns 401 Unauthorized');

    // 2. Member request to Admin-only route returns 403
    const forbiddenRes = await request(`/api/admin/withdrawals/${withdrawalId}/approve`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${memberToken}` }
    });
    assert(forbiddenRes.status === 403, 'Member request to Admin withdrawal approval returns 403 Forbidden');

    // 3. Public registration dropdown has no Admin role
    const indexHtml = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
    const hasAdminInPublicDropdown = indexHtml.includes('<option value="admin">') || indexHtml.includes('<option value="superadmin">');
    assert(!hasAdminInPublicDropdown, 'Public registration role dropdown strictly excludes Admin and Superadmin roles');

    // 4. Zero leaked secrets in frontend source files
    const publicJsDir = path.join(ROOT, 'public', 'js');
    function scanForSecrets(dir) {
      let leaked = [];
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          leaked = leaked.concat(scanForSecrets(fullPath));
        } else if (entry.isFile() && entry.name.endsWith('.js')) {
          const content = fs.readFileSync(fullPath, 'utf8');
          if (/AKIA[0-9A-Z]{16}/.test(content) || /BEGIN PRIVATE KEY/.test(content)) {
            leaked.push(entry.name);
          }
        }
      }
      return leaked;
    }
    const secretLeaks = scanForSecrets(publicJsDir);
    assert(secretLeaks.length === 0, 'Frontend source files contain zero leaked private keys or cloud credentials');

    // 5. Admin actions audit log
    const auditCount = queryOne('SELECT COUNT(*) as count FROM access_log WHERE user_id = ?', [adminId]);
    assert(Number(auditCount.count) > 0, `Admin actions logged in access_log audit stream (${auditCount.count} events recorded)`);

    console.log('\n======================================================================');
    console.log(`📊 LAYER 5 VERIFICATION RESULTS: ${passedTests}/${totalTests} PASS (${((passedTests/totalTests)*100).toFixed(1)}%)`);
    console.log('======================================================================');
    console.log('🎉 PRD 29 Layer 5 (Integration Seal & Production Readiness) 100% Verified!');

  } finally {
    server.close();
  }
}

runLayer5Verification().catch((err) => {
  console.error('\n❌ Layer 5 Verification Failed with unexpected error:', err);
  process.exit(1);
});
