/**
 * PRD 29 LAYER 2 VERIFICATION SUITE
 * First-Run Setup & Team Onboarding Verification
 *
 * Mandatory Verification Rules:
 * 1. Real fresh DB test (wiped DB, restart server, verify /setup redirect fires).
 * 2. Real HTTP network calls only — ZERO mocks.
 * 3. Real invite token flow tested via real HTTP (admin invite -> token validation -> member signup).
 * 4. Verify all 4 default seeds: default expense categories, automation templates, wiki space "General", OKR cycle.
 * 5. Verify 4-item Onboarding Checklist lifecycle until allComplete === true.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.js';
import { runMigration } from '../src/db/migrate.js';
import { getDatabase, queryOne, queryAll, execute, getCurrentQuarterCycle } from '../src/db/database.js';
import { config } from '../src/config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEST_PORT = 5098;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

const results = [];

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion Failed: ${message}`);
  }
}

async function runLayer2Verification() {
  console.log('\n===================================================================');
  console.log('       PRD 29 LAYER 2: FIRST-RUN SETUP & TEAM ONBOARDING');
  console.log('===================================================================\n');

  // Step 1: Ensure database schema is migrated
  console.log('[1/4] Preparing SQLite database for fresh first-run test...');
  runMigration();

  // Wipe users and related onboarding records to test pure first-run detection
  console.log('>>> Simulating fresh install: clearing users, sessions, invites, seeds...');
  execute('PRAGMA foreign_keys = OFF;');
  execute('DELETE FROM sessions');
  execute('DELETE FROM team_invites');
  execute('DELETE FROM project_tasks');
  execute('DELETE FROM project_members');
  execute('DELETE FROM projects');
  execute('DELETE FROM ideas');
  execute('DELETE FROM expense_categories');
  execute('DELETE FROM wiki_spaces');
  execute('DELETE FROM okr_objectives');
  execute('DELETE FROM okr_cycles');
  execute('DELETE FROM users');
  execute('PRAGMA foreign_keys = ON;');

  const freshUserCount = queryOne('SELECT COUNT(*) as count FROM users');
  assert(freshUserCount.count === 0, 'Users table must have exactly 0 rows for fresh install test');
  console.log('✔ Database wiped to 0 users: fresh install state confirmed.\n');

  // Step 2: Start real Express server
  console.log(`[2/4] Starting live Express server on ${BASE_URL}...`);
  const app = createApp();
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(TEST_PORT, '127.0.0.1', resolve));
  console.log('✔ Server bound and listening for real HTTP requests.\n');

  try {
    console.log('[3/4] Executing real HTTP verification tests...\n');

    // -------------------------------------------------------------
    // TEST 1: First-Run Detection & Redirect (Zero Users in DB)
    // -------------------------------------------------------------
    console.log('--- TEST 1: First-Run Detection Redirect (GET / → /setup) ---');
    const rootRes = await fetch(`${BASE_URL}/`, { redirect: 'manual' });
    console.log(`Root GET / Status: ${rootRes.status}, Location: ${rootRes.headers.get('location')}`);
    assert(rootRes.status === 302, `Expected 302 redirect, got ${rootRes.status}`);
    assert(rootRes.headers.get('location') === '/setup', 'Must redirect to /setup on zero users in DB');

    const appRes = await fetch(`${BASE_URL}/app.html`, { redirect: 'manual' });
    assert(appRes.status === 302, 'app.html must also redirect to /setup');

    const setupStatusRes = await fetch(`${BASE_URL}/api/setup/status`);
    assert(setupStatusRes.status === 200, `Expected 200 from setup status, got ${setupStatusRes.status}`);
    const setupStatusData = await setupStatusRes.json();
    assert(setupStatusData.needsSetup === true, 'needsSetup must be true when 0 users exist');
    assert(setupStatusData.userCount === 0, 'userCount must be 0');

    const setupPageRes = await fetch(`${BASE_URL}/setup`);
    assert(setupPageRes.status === 200, 'GET /setup must serve setup page with HTTP 200');
    const setupHtml = await setupPageRes.text();
    assert(setupHtml.includes('First-Run Setup'), 'Setup page must render First-Run Setup UI');
    console.log('✔ PASS: First-run detection fired and redirected cleanly to /setup.\n');
    results.push({ test: 'First-Run Detection & Redirect', status: 'PASS' });

    // -------------------------------------------------------------
    // TEST 2: Super Admin Setup Screen (POST /api/setup)
    // -------------------------------------------------------------
    console.log('--- TEST 2: Admin Setup Screen (POST /api/setup) ---');
    const setupPayload = {
      name: 'Super Admin Lead',
      email: 'admin.lead@mahitechgroup.com',
      password: 'MasterAdmin2026!Secure',
      company_name: 'Mahi Tech Group',
      platform_url: BASE_URL
    };

    const setupRes = await fetch(`${BASE_URL}/api/setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(setupPayload)
    });

    assert(setupRes.status === 201, `Expected 201 Created, got ${setupRes.status}`);
    const setupData = await setupRes.json();
    assert(setupData.success === true, 'Setup response must indicate success');
    assert(setupData.admin?.role === 'admin', 'Admin role must be admin');
    assert(setupData.admin?.email === 'admin.lead@mahitechgroup.com', 'Admin email must match');
    assert(Boolean(setupData.token), 'Setup must return valid JWT auth token');
    assert(Boolean(setupData.env_snippet), 'Setup must generate .env guidance');
    assert(setupData.env_snippet.includes('JWT_SECRET='), '.env guidance must include JWT_SECRET');

    const adminToken = setupData.token;
    const adminId = setupData.admin.id;

    // Verify secrets are NOT in database
    const secretInConfig = queryOne("SELECT value FROM system_config WHERE key = 'jwt_secret' OR key = 'JWT_SECRET'");
    assert(!secretInConfig, 'Cryptographic secrets must NEVER be persisted in system_config DB');

    console.log(`✔ Super Admin initialized: ${setupData.admin.name} (${setupData.admin.email})`);
    console.log('✔ Generated .env guidance without leaking secrets into DB.\n');
    results.push({ test: 'Admin Setup & .env Guidance Generation', status: 'PASS' });

    // -------------------------------------------------------------
    // TEST 3: Setup Lockout & Post-Setup Redirect Sealing
    // -------------------------------------------------------------
    console.log('--- TEST 3: Setup Lockout Verification ---');
    const secondSetupRes = await fetch(`${BASE_URL}/api/setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Hacker User',
        email: 'hacker@intruder.com',
        password: 'HackerPassword123!',
        company_name: 'Compromised'
      })
    });
    assert(secondSetupRes.status === 403, `Expected 403 Forbidden on secondary setup, got ${secondSetupRes.status}`);

    const postSetupStatusRes = await fetch(`${BASE_URL}/api/setup/status`);
    const postSetupStatus = await postSetupStatusRes.json();
    assert(postSetupStatus.needsSetup === false, 'needsSetup must be false after admin setup');
    assert(postSetupStatus.userCount === 1, 'userCount must now be 1');

    const rootPostSetupRes = await fetch(`${BASE_URL}/`, { redirect: 'manual' });
    assert(rootPostSetupRes.status === 200, 'Root GET / must now serve application (HTTP 200), not redirect to /setup');

    console.log('✔ PASS: First-run setup locked out permanently and root access restored.\n');
    results.push({ test: 'Setup Lockout & Post-Setup Routing', status: 'PASS' });

    // -------------------------------------------------------------
    // TEST 4: Real Seed Data Verification
    // -------------------------------------------------------------
    console.log('--- TEST 4: Real Seed Data Verification ---');
    // 1. Default expense categories (>= 5)
    const expenseCategories = queryAll('SELECT id, name, is_active FROM expense_categories');
    console.log(`Expense Categories found in DB: ${expenseCategories.length}`);
    assert(expenseCategories.length >= 5, `Expected >= 5 expense categories, got ${expenseCategories.length}`);
    const categoryNames = expenseCategories.map(c => c.name);
    assert(categoryNames.includes('SOFTWARE'), 'Must include SOFTWARE category');
    assert(categoryNames.includes('HARDWARE'), 'Must include HARDWARE category');
    assert(categoryNames.includes('TRAVEL'), 'Must include TRAVEL category');
    console.log('✔ Default expense categories verified (>= 5 present).');

    // 2. Default automation templates (PRD 26)
    const automationTemplates = queryAll('SELECT id, name, category FROM automation_templates');
    console.log(`Automation Templates found in DB: ${automationTemplates.length}`);
    assert(automationTemplates.length >= 5, `Expected >= 5 automation templates, got ${automationTemplates.length}`);
    console.log('✔ PRD 26 automation templates verified present.');

    // 3. Default wiki space "General"
    const generalWikiSpace = queryOne("SELECT id, name, slug, visibility FROM wiki_spaces WHERE slug = 'general'");
    assert(Boolean(generalWikiSpace), 'Default wiki space General (slug: general) must exist in DB');
    assert(generalWikiSpace.name === 'General', 'Wiki space name must be General');
    console.log(`✔ Default wiki space auto-created: ${generalWikiSpace.name} (slug: ${generalWikiSpace.slug})`);

    // 4. Default OKR cycle (current quarter)
    const currentQuarter = getCurrentQuarterCycle();
    const okrCycle = queryOne('SELECT id, name, is_active FROM okr_cycles WHERE name = ?', [currentQuarter]);
    assert(Boolean(okrCycle), `Default OKR cycle for current quarter (${currentQuarter}) must exist in okr_cycles`);
    const okrObjective = queryOne('SELECT id, title, cycle, level FROM okr_objectives WHERE cycle = ? AND level = ?', [currentQuarter, 'COMPANY']);
    assert(Boolean(okrObjective), `Company OKR objective for cycle ${currentQuarter} must exist in okr_objectives`);
    console.log(`✔ Default OKR cycle auto-created: ${okrCycle.name} with objective "${okrObjective.title}"\n`);
    results.push({ test: 'Real Seed Data Verification (4 Categories)', status: 'PASS' });

    // -------------------------------------------------------------
    // TEST 5: Team Invite Flow (Real HTTP Lifecycle)
    // -------------------------------------------------------------
    console.log('--- TEST 5: Team Invite Flow (Admin Invite → Member Self-Signup) ---');
    const invitePayload = {
      email: 'engineer.dev@mahitechgroup.com',
      role: 'developer',
      sub_role: 'frontend'
    };

    const inviteRes = await fetch(`${BASE_URL}/api/admin/invites`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: JSON.stringify(invitePayload)
    });

    assert(inviteRes.status === 201, `Expected 201 from invite creation, got ${inviteRes.status}`);
    const inviteData = await inviteRes.json();
    assert(inviteData.success === true, 'Invite creation must succeed');
    assert(Boolean(inviteData.invite?.token), 'Invite must contain secure random token');
    assert(Boolean(inviteData.invite?.invite_url), 'Invite must return full invite_url');
    console.log(`✔ Admin generated invite link: ${inviteData.invite.invite_url}`);

    const inviteToken = inviteData.invite.token;

    // Public token inspection
    const tokenCheckRes = await fetch(`${BASE_URL}/api/auth/invites/${inviteToken}`);
    assert(tokenCheckRes.status === 200, `Expected 200 from invite token inspection, got ${tokenCheckRes.status}`);
    const tokenCheckData = await tokenCheckRes.json();
    assert(tokenCheckData.valid === true, 'Token must be valid');
    assert(tokenCheckData.invite?.email === 'engineer.dev@mahitechgroup.com', 'Invited email must match');

    // Member self-signup with password
    const acceptRes = await fetch(`${BASE_URL}/api/auth/invites/${inviteToken}/accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Arjun Developer',
        password: 'ArjunPassword2026!Secure'
      })
    });

    assert(acceptRes.status === 201, `Expected 201 from invite acceptance, got ${acceptRes.status}`);
    const acceptData = await acceptRes.json();
    assert(acceptData.success === true, 'Acceptance must succeed');
    assert(acceptData.user?.role === 'developer', 'User role must be developer');
    assert(acceptData.user?.status === 'active', 'User status must be active');
    assert(Boolean(acceptData.token), 'Must return active member JWT token');

    const memberToken = acceptData.token;
    const memberId = acceptData.user.id;

    // Authenticate with member token
    const meRes = await fetch(`${BASE_URL}/api/users/me`, {
      headers: { 'Authorization': `Bearer ${memberToken}` }
    });
    assert(meRes.status === 200, `Expected 200 from member profile, got ${meRes.status}`);
    const meData = await meRes.json();
    assert(meData.user?.email === 'engineer.dev@mahitechgroup.com', 'Profile email must match invited member');
    console.log(`✔ New member registered and authenticated: ${meData.user.name} (${meData.user.role})`);

    // Admin role assignment / update
    const updateRoleRes = await fetch(`${BASE_URL}/api/admin/members/${memberId}/role`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: JSON.stringify({ role: 'producer' })
    });
    assert(updateRoleRes.status === 200, `Expected 200 from role update, got ${updateRoleRes.status}`);
    const updatedUser = queryOne('SELECT role FROM users WHERE id = ?', [memberId]);
    assert(updatedUser.role === 'producer', 'Role in DB must be updated to producer by Admin');
    console.log(`✔ Admin assigned new role to member: ${updatedUser.role}\n`);
    results.push({ test: 'Team Invite Flow & Role Assignment', status: 'PASS' });

    // -------------------------------------------------------------
    // TEST 6: Onboarding Checklist (Admin Dashboard Lifecycle)
    // -------------------------------------------------------------
    console.log('--- TEST 6: Onboarding Checklist Lifecycle (Admin Dashboard) ---');
    // Check initial onboarding status (Admin created: true, Member invited: true, Project: false, Task: false)
    const checklistRes1 = await fetch(`${BASE_URL}/api/admin/onboarding-status`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(checklistRes1.status === 200, `Expected 200 from onboarding status, got ${checklistRes1.status}`);
    const chk1 = await checklistRes1.json();
    console.log('Checklist State 1:', chk1.checklist);
    assert(chk1.checklist.adminCreated === true, 'adminCreated must be true');
    assert(chk1.checklist.memberInvited === true, 'memberInvited must be true');
    assert(chk1.checklist.firstProjectCreated === false, 'firstProjectCreated must be false');
    assert(chk1.checklist.firstTaskCreated === false, 'firstTaskCreated must be false');
    assert(chk1.completedCount === 2, 'completedCount must be 2');
    assert(chk1.allComplete === false, 'allComplete must be false');

    // Create first project via real HTTP
    console.log('>>> Creating first project via real HTTP POST /api/projects...');
    const projRes = await fetch(`${BASE_URL}/api/projects`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        title: 'Mahi Alpha Platform',
        description: 'First official workspace project',
        category: 'INTERNAL',
        priority: 'HIGH'
      })
    });
    assert(projRes.status === 201, `Expected 201 from project creation, got ${projRes.status}`);
    const projData = await projRes.json();
    const projectId = projData.project?.id || projData.id;
    assert(Boolean(projectId), 'Created project must have an ID');

    // Create first task via real HTTP
    console.log('>>> Creating first task via real HTTP POST /api/tasks...');
    const taskRes = await fetch(`${BASE_URL}/api/tasks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        project_id: projectId,
        title: 'System Initial Baseline Testing',
        description: 'Verify all Layer 2 services',
        assigned_to: memberId,
        priority: 'HIGH'
      })
    });
    assert(taskRes.status === 201, `Expected 201 from task creation, got ${taskRes.status}`);

    // Re-check onboarding status
    const checklistRes2 = await fetch(`${BASE_URL}/api/admin/onboarding-status`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(checklistRes2.status === 200, `Expected 200 from onboarding status, got ${checklistRes2.status}`);
    const chk2 = await checklistRes2.json();
    console.log('Checklist State 2 (All 4 Complete):', chk2.checklist);
    assert(chk2.checklist.adminCreated === true, 'adminCreated must be true');
    assert(chk2.checklist.memberInvited === true, 'memberInvited must be true');
    assert(chk2.checklist.firstProjectCreated === true, 'firstProjectCreated must be true');
    assert(chk2.checklist.firstTaskCreated === true, 'firstTaskCreated must be true');
    assert(chk2.completedCount === 4, 'completedCount must be 4');
    assert(chk2.allComplete === true, 'allComplete must be true');

    console.log('✔ PASS: Onboarding checklist tracked all 4 milestones and sealed with allComplete === true.\n');
    results.push({ test: 'Onboarding Checklist Lifecycle & Auto-Dismissal', status: 'PASS' });

  } finally {
    await new Promise((resolve) => server.close(resolve));
    console.log('[TEST SERVER] Server gracefully stopped.\n');
  }

  console.log('===================================================================');
  console.log('                       VERIFICATION SUMMARY');
  console.log('===================================================================');
  results.forEach((r, idx) => {
    console.log(`[${idx + 1}/${results.length}] ${r.test.padEnd(52)} [ ${r.status} ]`);
  });
  console.log('===================================================================\n');

  console.log('✔ ALL LAYER 2 VERIFICATION CHECKS PASSED WITH 100% SUCCESS.\n');
}

runLayer2Verification().catch((err) => {
  console.error('\n❌ LAYER 2 VERIFICATION FAILED:', err);
  process.exit(1);
});
