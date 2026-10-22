import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { queryOne, queryAll, execute } from '../src/db/database.js';
import { config } from '../src/config.js';

const BASE_URL = 'http://localhost:4000';

async function runStep5Tests() {
  console.log('===================================================================');
  console.log('   STEP 05: ADMIN OFFBOARDING KILL-SWITCH VERIFICATION SUITE');
  console.log('   Testing 7-Step Sequence, Attribution, Task Reassignment & Security');
  console.log('===================================================================');

  const results = [];

  try {
    // -----------------------------------------------------------------
    // STEP 0: Admin Login & Bootstrap
    // -----------------------------------------------------------------
    console.log('\n--- STEP 0: Admin Authentication & Baseline Setup ---');
    const adminLoginRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@mahitechgroup.com', password: 'AdminPassword@2026' })
    });
    const adminLoginData = await adminLoginRes.json();
    if (adminLoginRes.status !== 200) {
      throw new Error(`Admin login failed: ${JSON.stringify(adminLoginData)}`);
    }
    const adminToken = adminLoginData.token;
    const adminUser = adminLoginData.user;
    console.log(`Admin Authenticated: ${adminUser.name} (${adminUser.email})`);
    results.push({ test: 'Admin Authentication & Environment Setup', status: 'PASS' });

    // Helper to create & login team member
    async function createMember(name, email, role, subRole = null) {
      const password = 'Password@2026!';
      const normalizedEmail = email.toLowerCase().trim();
      let user = queryOne('SELECT id, name, email, role, sub_role, status, wallet_balance FROM users WHERE email = ?', [normalizedEmail]);
      if (!user) {
        await fetch(`${BASE_URL}/api/admin/members/add`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
          body: JSON.stringify({ name, email: normalizedEmail, role, sub_role: subRole, temporary_password: password })
        });
        user = queryOne('SELECT id, name, email, role, sub_role, status, wallet_balance FROM users WHERE email = ?', [normalizedEmail]);
      }
      const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: normalizedEmail, password })
      });
      const loginData = await loginRes.json();
      return { user, token: loginData.token, password };
    }

    // -----------------------------------------------------------------
    // TEST 1: Offboard a User with ACTIVE Tasks in an In-Progress Project
    // -----------------------------------------------------------------
    console.log('\n--- TEST 1: Offboard User with Active Tasks (Task Reassignment to Unassigned) ---');
    const devSubject = await createMember('Vikram Malhotra', `vikram.dev.${Date.now()}@mahitechgroup.com`, 'developer', 'backend');
    const peerDev = await createMember('Nisha Patel', `nisha.dev.${Date.now()}@mahitechgroup.com`, 'developer', 'frontend');

    // Create a real active project with multiple tasks
    const testProjectId = crypto.randomUUID();
    const testIdeaId = crypto.randomUUID();

    // Insert idea owned by Vikram (for attribution test later)
    execute(`
      INSERT INTO ideas (id, owner_id, title, description, status)
      VALUES (?, ?, 'Distributed Edge Ledger', 'Low-latency telemetry sync for enterprise clusters', 'APPROVED')
    `, [testIdeaId, devSubject.user.id]);

    // Insert project
    execute(`
      INSERT INTO projects (id, idea_id, org_id, title, owner_id, current_stage, status)
      VALUES (?, ?, 'DEFAULT_ORG', 'Edge Ledger Build', ?, 'INTEGRATION', 'ACTIVE')
    `, [testProjectId, testIdeaId, adminUser.id]);

    // Add project members
    execute(`
      INSERT INTO project_members (id, project_id, user_id, role_in_project, task_status)
      VALUES (?, ?, ?, 'backend_dev', 'IN_PROGRESS'),
             (?, ?, ?, 'frontend_dev', 'IN_PROGRESS')
    `, [crypto.randomUUID(), testProjectId, devSubject.user.id, crypto.randomUUID(), testProjectId, peerDev.user.id]);

    // Create tasks: 1 IN_PROGRESS task for Vikram, 1 TODO task for Vikram, 1 IN_PROGRESS task for Nisha
    const vikramTaskId1 = crypto.randomUUID();
    const vikramTaskId2 = crypto.randomUUID();
    const nishaTaskId = crypto.randomUUID();

    execute(`
      INSERT INTO project_tasks (id, project_id, assigned_to, task_name, task_type, status)
      VALUES (?, ?, ?, 'Core Ledger Engine', 'backend', 'IN_PROGRESS'),
             (?, ?, ?, 'P2P Gossip Sync Protocol', 'backend', 'TODO'),
             (?, ?, ?, 'Web Dashboard Live Stream', 'frontend', 'IN_PROGRESS')
    `, [vikramTaskId1, testProjectId, devSubject.user.id, vikramTaskId2, testProjectId, devSubject.user.id, nishaTaskId, testProjectId, peerDev.user.id]);

    console.log('[BEFORE OFFBOARDING] Project Tasks State:');
    const beforeTasks = queryAll('SELECT id, task_name, assigned_to, status FROM project_tasks WHERE project_id = ?', [testProjectId]);
    console.table(beforeTasks);

    const beforeMember = queryOne('SELECT user_id, role_in_project, removed_at FROM project_members WHERE project_id = ? AND user_id = ?', [testProjectId, devSubject.user.id]);
    console.log(`Vikram project_members removed_at BEFORE offboard: ${beforeMember.removed_at}`);

    // Trigger 7-step offboarding kill-switch via Admin API
    console.log(`\nTriggering POST /api/admin/members/${devSubject.user.id}/offboard...`);
    const offboardRes = await fetch(`${BASE_URL}/api/admin/members/${devSubject.user.id}/offboard`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({ reason: 'Resignation - Relocating abroad' })
    });
    const offboardData = await offboardRes.json();
    console.log(`Offboarding HTTP Status: ${offboardRes.status}`);
    console.log(`Admin Notification Message: "${offboardData.message}"`);

    if (offboardRes.status !== 200) {
      throw new Error(`Offboarding API failed: ${JSON.stringify(offboardData)}`);
    }

    // Inspect tasks AFTER offboarding
    console.log('\n[AFTER OFFBOARDING] Project Tasks State:');
    const afterTasks = queryAll('SELECT id, task_name, assigned_to, status FROM project_tasks WHERE project_id = ?', [testProjectId]);
    console.table(afterTasks);

    // Verify Vikram's tasks are now assigned_to = NULL
    const task1After = afterTasks.find(t => t.id === vikramTaskId1);
    const task2After = afterTasks.find(t => t.id === vikramTaskId2);
    const nishaTaskAfter = afterTasks.find(t => t.id === nishaTaskId);

    console.log(`Task 1 ("${task1After.task_name}") assigned_to: ${task1After.assigned_to} (Expected: null)`);
    console.log(`Task 2 ("${task2After.task_name}") assigned_to: ${task2After.assigned_to} (Expected: null)`);
    console.log(`Peer Dev Task ("${nishaTaskAfter.task_name}") assigned_to: ${nishaTaskAfter.assigned_to} (Expected: ${peerDev.user.id})`);
    console.log(`Peer Dev Task status remains: ${nishaTaskAfter.status} (Parallel work unaffected!)`);

    if (task1After.assigned_to !== null || task2After.assigned_to !== null) {
      throw new Error('Active tasks were not reassigned to NULL!');
    }
    if (nishaTaskAfter.assigned_to !== peerDev.user.id) {
      throw new Error("Peer developer task was unintentionally modified!");
    }

    // Verify project_members.removed_at timestamp is set
    const afterMember = queryOne('SELECT user_id, role_in_project, removed_at FROM project_members WHERE project_id = ? AND user_id = ?', [testProjectId, devSubject.user.id]);
    console.log(`Vikram project_members removed_at AFTER offboard: ${afterMember.removed_at}`);
    if (!afterMember.removed_at) {
      throw new Error('project_members.removed_at was not set!');
    }

    results.push({ test: 'Active Task Reassignment to NULL & Parallel Work Preservation', status: 'PASS' });

    // -----------------------------------------------------------------
    // TEST 2: Attribution Preservation & Foreign Key ON DELETE RESTRICT
    // -----------------------------------------------------------------
    console.log('\n--- TEST 2: Attribution Preservation & ON DELETE RESTRICT Foreign Key Protection ---');
    // 1. Verify Idea still exists and belongs to Vikram
    const ideaInDb = queryOne(`
      SELECT i.id, i.title, i.owner_id, u.name as owner_name, u.status as owner_status
      FROM ideas i
      JOIN users u ON i.owner_id = u.id
      WHERE i.id = ?
    `, [testIdeaId]);

    console.log('Querying idea authored by offboarded user:');
    console.log({
      idea_id: ideaInDb.id,
      title: ideaInDb.title,
      owner_id: ideaInDb.owner_id,
      owner_name: ideaInDb.owner_name,
      owner_status: ideaInDb.owner_status,
      display_badge: ideaInDb.owner_status === 'inactive' ? `${ideaInDb.owner_name} (Former Member)` : ideaInDb.owner_name
    });

    if (ideaInDb.owner_id !== devSubject.user.id || ideaInDb.owner_status !== 'inactive') {
      throw new Error('Idea ownership or user inactive status corrupted!');
    }

    // 2. Explicitly test ON DELETE RESTRICT: Attempt to DELETE user from database
    console.log('\nTesting ON DELETE RESTRICT: Attempting hard SQL DELETE on offboarded user...');
    let deletePrevented = false;
    let deleteErrorMessage = '';
    try {
      execute('DELETE FROM users WHERE id = ?', [devSubject.user.id]);
    } catch (err) {
      deletePrevented = true;
      deleteErrorMessage = err.message;
      console.log(`Database engine rejected deletion with error: "${err.message}"`);
    }

    if (!deletePrevented || !deleteErrorMessage.includes('FOREIGN KEY constraint failed')) {
      throw new Error('Foreign key failed to restrict hard deletion! Cascading deletion would cause catastrophic attribution loss.');
    }
    console.log('Verified: ON DELETE RESTRICT strictly prevents cascade deletion of user records.');
    results.push({ test: 'Attribution Preservation & ON DELETE RESTRICT Verification', status: 'PASS' });

    // -----------------------------------------------------------------
    // TEST 3: Login Attempt with Old Credentials -> 403 "Access Revoked"
    // -----------------------------------------------------------------
    console.log('\n--- TEST 3: Offboarded User Login Attempt (403 "Access Revoked") ---');
    console.log(`Attempting login with email: ${devSubject.user.email} and valid password...`);
    const revokedLoginRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: devSubject.user.email, password: devSubject.password })
    });
    const revokedLoginData = await revokedLoginRes.json();
    console.log(`Login attempt response status: ${revokedLoginRes.status}`);
    console.log(`Login attempt response body:`, JSON.stringify(revokedLoginData));

    if (revokedLoginRes.status !== 403 || revokedLoginData.error !== 'Access Revoked') {
      throw new Error(`Expected 403 "Access Revoked", got ${revokedLoginRes.status}: ${JSON.stringify(revokedLoginData)}`);
    }
    results.push({ test: 'Deactivated User Login Block (403 Access Revoked)', status: 'PASS' });

    // -----------------------------------------------------------------
    // TEST 4: Immediate Session Invalidation (Pre-existing JWT -> 401)
    // -----------------------------------------------------------------
    console.log('\n--- TEST 4: Immediate Session Invalidation for Pre-Existing JWT Token ---');
    console.log('Using JWT token obtained BEFORE offboarding occurred...');
    const sessionRes = await fetch(`${BASE_URL}/api/projects/my-tasks`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${devSubject.token}` }
    });
    const sessionData = await sessionRes.json();
    console.log(`API request with pre-existing session token HTTP status: ${sessionRes.status}`);
    console.log(`API response body:`, JSON.stringify(sessionData));

    if (sessionRes.status !== 401 || !sessionData.error.includes('Unauthorized')) {
      throw new Error(`Session was not invalidated! Got status ${sessionRes.status}: ${JSON.stringify(sessionData)}`);
    }

    // Direct database verification on sessions table
    const allUserSessions = queryAll('SELECT id, user_id, is_revoked, expires_at FROM sessions WHERE user_id = ?', [devSubject.user.id]);
    console.log('Database verification of sessions for offboarded user:');
    console.table(allUserSessions);
    const allRevoked = allUserSessions.every(s => s.is_revoked === 1);
    console.log(`All sessions have is_revoked = 1: ${allRevoked}`);
    if (!allRevoked) {
      throw new Error('Not all sessions were marked is_revoked = 1 in database!');
    }
    results.push({ test: 'Immediate Invalidation of Pre-Existing Sessions (401)', status: 'PASS' });

    // -----------------------------------------------------------------
    // TEST 5: Wallet Freeze with Nonzero Balance Snapshot
    // -----------------------------------------------------------------
    console.log('\n--- TEST 5: Revenue Wallet Freeze & Snapshot Verification ---');
    // Create new member with simulated nonzero wallet balance
    const walletMember = await createMember('Aarav Mehta', `aarav.wallet.${Date.now()}@mahitechgroup.com`, 'researcher');
    const simulatedBalance = 24850.50;
    execute('UPDATE users SET wallet_balance = ? WHERE id = ?', [simulatedBalance, walletMember.user.id]);

    const userBeforeFreeze = queryOne('SELECT id, name, wallet_balance, wallet_frozen FROM users WHERE id = ?', [walletMember.user.id]);
    console.log(`User BEFORE offboarding: balance = ₹${userBeforeFreeze.wallet_balance}, wallet_frozen = ${userBeforeFreeze.wallet_frozen}`);

    // Trigger offboarding
    const freezeOffboardRes = await fetch(`${BASE_URL}/api/admin/members/${walletMember.user.id}/offboard`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({ reason: 'End of contractual tenure' })
    });
    const freezeOffboardData = await freezeOffboardRes.json();
    console.log(`Offboard API response message: "${freezeOffboardData.message}"`);

    // Verify DB user wallet_frozen
    const userAfterFreeze = queryOne('SELECT id, name, wallet_balance, wallet_frozen FROM users WHERE id = ?', [walletMember.user.id]);
    console.log(`User AFTER offboarding: balance = ₹${userAfterFreeze.wallet_balance}, wallet_frozen = ${userAfterFreeze.wallet_frozen}`);
    if (userAfterFreeze.wallet_frozen !== 1) {
      throw new Error('users.wallet_frozen was not set to 1!');
    }

    // Verify offboarding table snapshot
    const offboardingRow = queryOne('SELECT id, user_id, wallet_frozen_amount, status FROM offboarding WHERE user_id = ?', [walletMember.user.id]);
    console.log('Offboarding row snapshot:', offboardingRow);
    if (Number(offboardingRow.wallet_frozen_amount) !== simulatedBalance) {
      throw new Error(`Frozen amount snapshot mismatch! Expected ${simulatedBalance}, got ${offboardingRow.wallet_frozen_amount}`);
    }

    // Verify Admin Frozen Wallets list endpoint
    const frozenWalletsRes = await fetch(`${BASE_URL}/api/admin/wallets/frozen`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const frozenWalletsData = await frozenWalletsRes.json();
    console.log(`Admin /api/admin/wallets/frozen count: ${frozenWalletsData.count}`);
    const foundUserInFrozen = frozenWalletsData.frozenWallets.find(w => w.id === walletMember.user.id);
    console.log('Found user in frozen wallets query:', foundUserInFrozen);
    if (!foundUserInFrozen || Number(foundUserInFrozen.wallet_balance) !== simulatedBalance) {
      throw new Error('User missing from frozen wallets listing!');
    }
    results.push({ test: 'Revenue Wallet Freeze & Balance Snapshot', status: 'PASS' });

    // -----------------------------------------------------------------
    // TEST 6: Exact 7-Step Sequence Order Verification
    // -----------------------------------------------------------------
    console.log('\n--- TEST 6: Verification of Mandatory 7-Step Execution Order ---');
    console.log('Verifying sequence reported in offboarding execution output:');
    const steps = freezeOffboardData.stepsExecuted;
    console.table(steps.map(s => ({ step: s.step, action: s.action, details: s.details })));

    const expectedActions = [
      'invalidate_sessions',
      'disable_login',
      'revoke_external_services',
      'reassign_active_tasks',
      'preserve_attribution',
      'freeze_wallet',
      'write_audit_log'
    ];

    if (steps.length !== 7) {
      throw new Error(`Expected exactly 7 steps, got ${steps.length}`);
    }

    for (let i = 0; i < 7; i++) {
      if (steps[i].step !== i + 1 || steps[i].action !== expectedActions[i]) {
        throw new Error(`Step order violation at index ${i}: expected step ${i + 1} (${expectedActions[i]}), got step ${steps[i].step} (${steps[i].action})`);
      }
    }
    console.log('Verified: All 7 steps executed in exact mandated order (1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7).');
    results.push({ test: 'Mandatory 7-Step Sequence Exact Order', status: 'PASS' });

    // -----------------------------------------------------------------
    // TEST 7: Offboarding Status & External Checklist Management
    // -----------------------------------------------------------------
    console.log('\n--- TEST 7: Offboarding Checklist Management & History Endpoints ---');
    const offboardingId = freezeOffboardData.offboarding.id;

    // 1. GET status
    const statusRes = await fetch(`${BASE_URL}/api/admin/offboarding/${offboardingId}/status`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const statusData = await statusRes.json();
    console.log(`Offboarding Status endpoint returned status: ${statusRes.status}`);
    console.log('External Services Checklist (Initial State):');
    console.table(statusData.offboarding.revoked_services);

    if (statusData.offboarding.revoked_services.length !== 5) {
      throw new Error(`Expected 5 checklist items, got ${statusData.offboarding.revoked_services.length}`);
    }

    // 2. PATCH checklist item
    console.log('\nUpdating checklist item "github_org" to COMPLETED via PATCH...');
    const patchChecklistRes = await fetch(`${BASE_URL}/api/admin/offboarding/${offboardingId}/checklist`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({ serviceId: 'github_org', completed: true })
    });
    const patchChecklistData = await patchChecklistRes.json();
    console.log(`Checklist PATCH status: ${patchChecklistRes.status}`);
    console.log(`Checklist PATCH response: ${patchChecklistData.message}`);
    const updatedGithubItem = patchChecklistData.checklist.find(c => c.id === 'github_org');
    console.log('Updated item:', updatedGithubItem);
    if (!updatedGithubItem || updatedGithubItem.status !== 'COMPLETED') {
      throw new Error('Checklist item was not updated to COMPLETED!');
    }

    // 3. GET History
    const historyRes = await fetch(`${BASE_URL}/api/admin/offboarding/history`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const historyData = await historyRes.json();
    console.log(`Offboarding History endpoint returned ${historyData.count} total records.`);
    console.table(historyData.offboardingHistory.map(h => ({
      id: h.id,
      user_name: h.user_name,
      user_email: h.user_email,
      frozen_amount: h.wallet_frozen_amount,
      status: h.status,
      completed_at: h.completed_at
    })));

    results.push({ test: 'Offboarding Checklist & History Endpoints', status: 'PASS' });

    // -----------------------------------------------------------------
    // TEST 8: Asset Registration & Strict 'ORG' Ownership Enforcement
    // -----------------------------------------------------------------
    console.log('\n--- TEST 8: Asset Registration & Strict "ORG" Ownership Enforcement ---');
    console.log(`Registering design file asset for project "${testProjectId}"...`);

    const assetRes = await fetch(`${BASE_URL}/api/projects/${testProjectId}/assets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({
        type: 'design_file',
        url: 'https://figma.com/file/enterprise-edge-ledger-v1'
      })
    });
    const assetData = await assetRes.json();
    console.log(`Asset creation response status: ${assetRes.status}`);
    console.log('Created Asset:', assetData.asset);

    if (assetRes.status !== 201 || assetData.asset.owner_entity !== 'ORG') {
      throw new Error(`Expected owner_entity = 'ORG', got '${assetData.asset.owner_entity}'`);
    }

    // Verify DB level CHECK constraint: Attempting to insert owner_entity = 'USER'
    console.log('\nTesting DB CHECK constraint: Attempting to force owner_entity = "USER"...');
    let assetCheckViolated = false;
    let assetCheckError = '';
    try {
      execute(`
        INSERT INTO assets (id, project_id, type, url, owner_entity)
        VALUES (?, ?, 'code_repo', 'https://github.com/personal/repo', 'USER')
      `, [crypto.randomUUID(), testProjectId]);
    } catch (err) {
      assetCheckViolated = true;
      assetCheckError = err.message;
      console.log(`Database engine rejected user ownership: "${err.message}"`);
    }

    if (!assetCheckViolated || !assetCheckError.includes('CHECK constraint failed')) {
      throw new Error('Database allowed non-ORG owner_entity on assets table!');
    }
    console.log('Verified: Database schema constraint enforces owner_entity = "ORG" at all times.');

    // Query GET /api/projects/:id/assets
    const listAssetsRes = await fetch(`${BASE_URL}/api/projects/${testProjectId}/assets`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const listAssetsData = await listAssetsRes.json();
    console.log(`Assets query for project returned ${listAssetsData.assets.length} asset(s):`);
    console.table(listAssetsData.assets.map(a => ({
      id: a.id,
      type: a.type,
      url: a.url,
      owner_entity: a.owner_entity,
      uploaded_by_label: a.uploaded_by_label
    })));

    results.push({ test: 'Asset Registration & ORG Ownership Enforcement', status: 'PASS' });

    // -----------------------------------------------------------------
    // FINAL REPORT SUMMARY
    // -----------------------------------------------------------------
    console.log('\n===================================================================');
    console.log('       ALL STEP 05 VERIFICATION TESTS PASSED SUCCESSFULLY!        ');
    console.log('===================================================================\n');
    console.table(results);

    return { success: true, results };
  } catch (err) {
    console.error('\n❌ STEP 05 VERIFICATION FAILURE:', err);
    process.exit(1);
  }
}

runStep5Tests();
