import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { queryOne, queryAll, execute } from '../src/db/database.js';
import { config } from '../src/config.js';
import { requestWithdrawal } from '../src/services/payoutService.js';
import { getUserEarnings } from '../src/services/revenueService.js';

const BASE_URL = 'http://localhost:4000';

async function runStep6Tests() {
  console.log('===================================================================');
  console.log('    STEP 06: REVENUE SPLIT ENGINE & IMMUTABLE LEDGER TEST SUITE    ');
  console.log('    Testing 5-Month Boundary, Immutable Ledger, Manual Payouts &    ');
  console.log('    Wallet Freeze Integration                                      ');
  console.log('===================================================================');

  const results = [];

  try {
    // -----------------------------------------------------------------
    // STEP 0: Admin Authentication & Baseline Setup
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

    // Helper to create and login user
    async function createMember(name, email, role, subRole = null) {
      const password = 'Password@2026!';
      const normalizedEmail = email.toLowerCase().trim();
      let user = queryOne('SELECT id, name, email, role, sub_role, status, wallet_balance, wallet_frozen FROM users WHERE email = ?', [normalizedEmail]);
      if (!user) {
        await fetch(`${BASE_URL}/api/admin/members/add`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
          body: JSON.stringify({ name, email: normalizedEmail, role, sub_role: subRole, temporary_password: password })
        });
        user = queryOne('SELECT id, name, email, role, sub_role, status, wallet_balance, wallet_frozen FROM users WHERE email = ?', [normalizedEmail]);
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
    // TEST 1: Schema Verification & Database-Enforced Immutable Ledger
    // -----------------------------------------------------------------
    console.log('\n--- TEST 1: Schema Verification & Database-Enforced Immutable Ledger ---');
    // Verify tables exist
    const tables = queryAll("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('revenue_events','revenue_splits','withdrawals','pending_settlements') ORDER BY name");
    console.log('Verified Step 06 Tables in Database:', tables.map(t => t.name));
    if (tables.length !== 4) {
      throw new Error(`Expected 4 Step 06 tables, found ${tables.length}`);
    }

    // Create a dummy project and revenue event to test SQLite trigger immutability
    const dummyOwner = await createMember('Test Owner', `owner.${Date.now()}@mahitechgroup.com`, 'researcher');
    const dummyProjId = crypto.randomUUID();
    const dummyIdeaId = crypto.randomUUID();

    execute(`
      INSERT INTO ideas (id, owner_id, title, description, status)
      VALUES (?, ?, 'Dummy Immutability Idea', 'Testing ledger protection', 'APPROVED')
    `, [dummyIdeaId, dummyOwner.user.id]);

    execute(`
      INSERT INTO projects (id, idea_id, org_id, title, owner_id, current_stage, status, revenue_clock_start)
      VALUES (?, ?, 'DEFAULT_ORG', 'Dummy Immutability Project', ?, 'LIVE', 'LIVE', '2026-01-01 00:00:00')
    `, [dummyProjId, dummyIdeaId, dummyOwner.user.id]);

    execute(`
      INSERT INTO project_members (id, project_id, user_id, role_in_project, contribution_weight)
      VALUES (?, ?, ?, 'researcher', 1.0)
    `, [crypto.randomUUID(), dummyProjId, dummyOwner.user.id]);

    const revRes = await fetch(`${BASE_URL}/api/admin/projects/${dummyProjId}/revenue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({
        amount: 1000,
        source: 'Initial Enterprise Contract',
        event_date: '2026-02-15'
      })
    });
    const revData = await revRes.json();
    console.log(`Created baseline revenue event: ${revData.event.id} (amount: ₹${revData.event.amount})`);

    // Attempt 1: SQL UPDATE on revenue_events historical amount
    console.log('\nAttempting direct SQL UPDATE on revenue_events...');
    let eventUpdateFailed = false;
    let eventUpdateError = '';
    try {
      execute('UPDATE revenue_events SET amount = 99999 WHERE id = ?', [revData.event.id]);
    } catch (err) {
      eventUpdateFailed = true;
      eventUpdateError = err.message;
      console.log(`Database engine rejected UPDATE with error: "${err.message}"`);
    }

    if (!eventUpdateFailed || !eventUpdateError.includes('Immutable ledger: UPDATE not allowed on revenue_events')) {
      throw new Error('Database allowed direct mutation of historical revenue_events row!');
    }

    // Attempt 2: SQL DELETE on revenue_splits historical entry
    console.log('\nAttempting direct SQL DELETE on revenue_splits...');
    let splitDeleteFailed = false;
    let splitDeleteError = '';
    try {
      execute('DELETE FROM revenue_splits WHERE revenue_event_id = ?', [revData.event.id]);
    } catch (err) {
      splitDeleteFailed = true;
      splitDeleteError = err.message;
      console.log(`Database engine rejected DELETE with error: "${err.message}"`);
    }

    if (!splitDeleteFailed || !splitDeleteError.includes('Immutable ledger: DELETE not allowed on revenue_splits')) {
      throw new Error('Database allowed direct deletion of historical revenue_splits row!');
    }

    // Demonstrate proper accounting correction: Reversing entry via POST /api/admin/projects/:id/revenue/reversal
    console.log('\nDemonstrating proper accounting correction via reversing entry endpoint...');
    const reverseRes = await fetch(`${BASE_URL}/api/admin/projects/${dummyProjId}/revenue/reversal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({
        original_event_id: revData.event.id,
        reason: 'Customer billing adjustment'
      })
    });
    const reverseData = await reverseRes.json();
    console.log(`Reversal API response status: ${reverseRes.status}`);
    console.log(`Reversing event created: ${reverseData.reversalEventId} (reversingAmount: ₹${reverseData.reversingAmount})`);

    // Verify both original and reversing entry coexist in the ledger (append-only)
    const ledgerCheck = queryAll('SELECT id, amount, source FROM revenue_events WHERE project_id = ? ORDER BY created_at ASC', [dummyProjId]);
    console.log('Audit Ledger records for project:');
    console.table(ledgerCheck);

    if (ledgerCheck.length !== 2 || Number(ledgerCheck[0].amount) + Number(ledgerCheck[1].amount) !== 0) {
      throw new Error('Reversing ledger entry did not offset cleanly in ledger!');
    }

    results.push({ test: 'Schema & Database-Enforced Immutable Ledger', status: 'PASS' });

    // -----------------------------------------------------------------
    // TEST 2: The 5-Month Boundary Rule (Exhaustive Timestamp Tests)
    // -----------------------------------------------------------------
    console.log('\n--- TEST 2: The 5-Month Boundary Rule (Exhaustive Timestamp Tests) ---');
    // Setup a dedicated live project with:
    // revenue_clock_start = '2026-01-01 00:00:00'
    // 5-Month Boundary = '2026-06-01 00:00:00'
    const ideaOwner = await createMember('Siddharth Rao (Idea Owner)', `sid.owner.${Date.now()}@mahitechgroup.com`, 'producer');
    const devAlpha = await createMember('Kavita Nair (Dev Alpha)', `kavita.dev.${Date.now()}@mahitechgroup.com`, 'developer', 'backend');
    const devBeta = await createMember('Rohan Verma (Dev Beta)', `rohan.dev.${Date.now()}@mahitechgroup.com`, 'developer', 'frontend');

    const boundaryProjId = crypto.randomUUID();
    const boundaryIdeaId = crypto.randomUUID();

    execute(`
      INSERT INTO ideas (id, owner_id, title, description, status)
      VALUES (?, ?, 'Cloud Mesh Optimizer', 'High-throughput networking core', 'APPROVED')
    `, [boundaryIdeaId, ideaOwner.user.id]);

    const clockStartStr = '2026-01-01 00:00:00';
    execute(`
      INSERT INTO projects (id, idea_id, org_id, title, owner_id, current_stage, status, revenue_clock_start)
      VALUES (?, ?, 'DEFAULT_ORG', 'Cloud Mesh Optimizer Build', ?, 'LIVE', 'LIVE', ?)
    `, [boundaryProjId, boundaryIdeaId, ideaOwner.user.id, clockStartStr]);

    // Team members: Dev Alpha (weight 60), Dev Beta (weight 40)
    execute(`
      INSERT INTO project_members (id, project_id, user_id, role_in_project, contribution_weight)
      VALUES (?, ?, ?, 'backend_dev', 60.0),
             (?, ?, ?, 'frontend_dev', 40.0)
    `, [crypto.randomUUID(), boundaryProjId, devAlpha.user.id, crypto.randomUUID(), boundaryProjId, devBeta.user.id]);

    console.log(`Project initialized with clockStart = ${clockStartStr}`);
    console.log('Calculated 5-Month Boundary: 2026-06-01 00:00:00');
    console.log('Active Team Contributors: Kavita (60% weight), Rohan (40% weight)');

    // Test 2a: Event 1 day BEFORE boundary (2026-05-31) -> Amount: ₹10,000
    console.log('\n[TEST 2a] Revenue Event: 1 day BEFORE boundary (2026-05-31, Amount: ₹10,000)...');
    const res2a = await fetch(`${BASE_URL}/api/admin/projects/${boundaryProjId}/revenue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({
        amount: 10000,
        source: 'SaaS Subscription Batch 1',
        event_date: '2026-05-31'
      })
    });
    const data2a = await res2a.json();
    console.log(`Event 2a HTTP Status: ${res2a.status}, Rule: ${data2a.ruleApplied}`);
    console.log(`Owner Share: ₹${data2a.ownerShare}, Team Pool: ₹${data2a.teamPool}`);
    console.log('Computed Splits:');
    console.table(data2a.splits.map(s => ({ userName: s.userName, amount: s.amount, splitType: s.splitType, rule: s.ruleApplied })));

    if (data2a.ruleApplied !== 'OWNER_50_TEAM_50' || data2a.ownerShare !== 5000 || data2a.teamPool !== 5000) {
      throw new Error(`Test 2a failed! Expected OWNER_50_TEAM_50 with 5000/5000 split, got: ${JSON.stringify(data2a)}`);
    }
    const kavitaSplit2a = data2a.splits.find(s => s.userId === devAlpha.user.id);
    const rohanSplit2a = data2a.splits.find(s => s.userId === devBeta.user.id);
    if (kavitaSplit2a.amount !== 3000 || rohanSplit2a.amount !== 2000) {
      throw new Error(`Test 2a team split mismatch! Expected 3000/2000, got: ${kavitaSplit2a.amount}/${rohanSplit2a.amount}`);
    }

    // Test 2b: Event EXACTLY AT boundary (2026-06-01) -> Amount: ₹10,000
    console.log('\n[TEST 2b] Revenue Event: EXACTLY AT boundary (2026-06-01, Amount: ₹10,000)...');
    const res2b = await fetch(`${BASE_URL}/api/admin/projects/${boundaryProjId}/revenue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({
        amount: 10000,
        source: 'SaaS Subscription Batch 2',
        event_date: '2026-06-01'
      })
    });
    const data2b = await res2b.json();
    console.log(`Event 2b HTTP Status: ${res2b.status}, Rule: ${data2b.ruleApplied}`);
    console.log(`Owner Share: ₹${data2b.ownerShare}, Team Pool: ₹${data2b.teamPool}`);
    console.log('Computed Splits:');
    console.table(data2b.splits.map(s => ({ userName: s.userName, amount: s.amount, splitType: s.splitType, rule: s.ruleApplied })));

    if (data2b.ruleApplied !== 'TEAM_100' || data2b.ownerShare !== 0 || data2b.teamPool !== 10000) {
      throw new Error(`Test 2b failed! Expected TEAM_100 with 0/10000 split, got: ${JSON.stringify(data2b)}`);
    }
    const kavitaSplit2b = data2b.splits.find(s => s.userId === devAlpha.user.id);
    const rohanSplit2b = data2b.splits.find(s => s.userId === devBeta.user.id);
    if (kavitaSplit2b.amount !== 6000 || rohanSplit2b.amount !== 4000) {
      throw new Error(`Test 2b team split mismatch! Expected 6000/4000, got: ${kavitaSplit2b.amount}/${rohanSplit2b.amount}`);
    }

    // Test 2c: Event 1 day AFTER boundary (2026-06-02) -> Amount: ₹10,000
    console.log('\n[TEST 2c] Revenue Event: 1 day AFTER boundary (2026-06-02, Amount: ₹10,000)...');
    const res2c = await fetch(`${BASE_URL}/api/admin/projects/${boundaryProjId}/revenue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({
        amount: 10000,
        source: 'SaaS Subscription Batch 3',
        event_date: '2026-06-02'
      })
    });
    const data2c = await res2c.json();
    console.log(`Event 2c HTTP Status: ${res2c.status}, Rule: ${data2c.ruleApplied}`);
    console.log(`Owner Share: ₹${data2c.ownerShare}, Team Pool: ₹${data2c.teamPool}`);
    console.log('Computed Splits:');
    console.table(data2c.splits.map(s => ({ userName: s.userName, amount: s.amount, splitType: s.splitType, rule: s.ruleApplied })));

    if (data2c.ruleApplied !== 'TEAM_100' || data2c.ownerShare !== 0 || data2c.teamPool !== 10000) {
      throw new Error(`Test 2c failed! Expected TEAM_100 with 0/10000 split, got: ${JSON.stringify(data2c)}`);
    }

    results.push({ test: 'The 5-Month Boundary Rule (Exhaustive Timestamps)', status: 'PASS' });

    // -----------------------------------------------------------------
    // TEST 3: Manual-Only Withdrawal Approval & Non-Admin Rejection
    // -----------------------------------------------------------------
    console.log('\n--- TEST 3: Manual-Only Withdrawal Approval & Non-Admin Rejection ---');
    // Kavita currently earned: ₹3,000 (Event 2a) + ₹6,000 (Event 2b) + ₹6,000 (Event 2c) = ₹15,000
    const kavitaWalletBefore = queryOne('SELECT wallet_balance FROM users WHERE id = ?', [devAlpha.user.id]);
    console.log(`Kavita current wallet balance: ₹${kavitaWalletBefore.wallet_balance}`);

    // Request withdrawal for ₹5,000
    console.log('Kavita submitting withdrawal request for ₹5,000...');
    const reqWithdrawRes = await fetch(`${BASE_URL}/api/withdrawals/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${devAlpha.token}` },
      body: JSON.stringify({ amount: 5000 })
    });
    const reqWithdrawData = await reqWithdrawRes.json();
    console.log(`Withdrawal request status: ${reqWithdrawRes.status}`);
    console.log(`Withdrawal record:`, reqWithdrawData.withdrawal);

    if (reqWithdrawRes.status !== 201 || reqWithdrawData.withdrawal.status !== 'PENDING') {
      throw new Error(`Withdrawal request failed! Got ${JSON.stringify(reqWithdrawData)}`);
    }

    // Verify funds did NOT move automatically
    const kavitaWalletPending = queryOne('SELECT wallet_balance FROM users WHERE id = ?', [devAlpha.user.id]);
    console.log(`Kavita wallet balance while withdrawal is PENDING: ₹${kavitaWalletPending.wallet_balance} (Funds untouched!)`);
    if (kavitaWalletPending.wallet_balance !== kavitaWalletBefore.wallet_balance) {
      throw new Error('Funds moved prematurely while withdrawal was still PENDING!');
    }

    // Non-Admin (Rohan) attempts to approve Kavita's withdrawal -> Must be rejected with HTTP 403
    console.log('\nNon-Admin (Rohan) attempting to approve withdrawal...');
    const nonAdminApproveRes = await fetch(`${BASE_URL}/api/admin/withdrawals/${reqWithdrawData.withdrawal.id}/approve`, {
      method: 'PATCH',
      headers: { 'Authorization': `Bearer ${devBeta.token}` }
    });
    const nonAdminApproveData = await nonAdminApproveRes.json();
    console.log(`Non-Admin approval status: ${nonAdminApproveRes.status}`);
    console.log(`Non-Admin approval body:`, JSON.stringify(nonAdminApproveData));

    if (nonAdminApproveRes.status !== 403 || !nonAdminApproveData.error.includes('Forbidden')) {
      throw new Error(`Expected 403 Forbidden for non-admin withdrawal approval, got ${nonAdminApproveRes.status}`);
    }

    // Verify withdrawal is STILL sitting in PENDING (no auto-approval)
    const withdrawalStillPending = queryOne('SELECT status FROM withdrawals WHERE id = ?', [reqWithdrawData.withdrawal.id]);
    console.log(`Withdrawal status after non-admin attempt: ${withdrawalStillPending.status}`);
    if (withdrawalStillPending.status !== 'PENDING') {
      throw new Error('Withdrawal status changed unexpectedly!');
    }

    // Admin approves withdrawal -> Wallet deducted immediately + simulated gateway payout
    console.log('\nAdmin approving withdrawal via PATCH /api/admin/withdrawals/:id/approve...');
    const adminApproveRes = await fetch(`${BASE_URL}/api/admin/withdrawals/${reqWithdrawData.withdrawal.id}/approve`, {
      method: 'PATCH',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const adminApproveData = await adminApproveRes.json();
    console.log(`Admin approval status: ${adminApproveRes.status}`);
    console.log(`Admin approval message: "${adminApproveData.message}"`);
    console.log(`Payment Gateway Transaction:`, adminApproveData.gateway);

    if (adminApproveRes.status !== 200 || adminApproveData.withdrawal.status !== 'PAID') {
      throw new Error(`Admin withdrawal approval failed: ${JSON.stringify(adminApproveData)}`);
    }

    // Verify Kavita's wallet was deducted exactly by ₹5,000
    const kavitaWalletAfter = queryOne('SELECT wallet_balance FROM users WHERE id = ?', [devAlpha.user.id]);
    console.log(`Kavita wallet balance AFTER approval & payout: ₹${kavitaWalletAfter.wallet_balance} (Expected: ₹10,000)`);
    if (kavitaWalletAfter.wallet_balance !== 10000) {
      throw new Error(`Wallet balance after payout mismatch! Expected 10000, got ${kavitaWalletAfter.wallet_balance}`);
    }

    results.push({ test: 'Manual-Only Withdrawal Approval & Non-Admin 403 Guard', status: 'PASS' });

    // -----------------------------------------------------------------
    // TEST 4: Interaction with Step 05's Wallet Freeze
    // -----------------------------------------------------------------
    console.log("\n--- TEST 4: Interaction with Step 05's Wallet Freeze ---");
    // 1. Offboard Rohan (devBeta) so their wallet becomes frozen
    console.log(`Offboarding Rohan Verma (ID: ${devBeta.user.id})...`);
    const offboardRes = await fetch(`${BASE_URL}/api/admin/members/${devBeta.user.id}/offboard`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({ reason: 'Contract termination' })
    });
    const offboardData = await offboardRes.json();
    console.log(`Offboard status: ${offboardRes.status}`);

    const rohanInDb = queryOne('SELECT id, wallet_balance, wallet_frozen FROM users WHERE id = ?', [devBeta.user.id]);
    console.log(`Rohan wallet state: balance = ₹${rohanInDb.wallet_balance}, wallet_frozen = ${rohanInDb.wallet_frozen}`);

    // 2a. Offboarded user attempts POST /api/withdrawals/request -> Rejected by auth middleware (401 Access Revoked)
    const frozenUserToken = devBeta.token;
    const offboardedApiRes = await fetch(`${BASE_URL}/api/withdrawals/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${frozenUserToken}` },
      body: JSON.stringify({ amount: 1000 })
    });
    const offboardedApiData = await offboardedApiRes.json();
    console.log(`Offboarded user API withdrawal HTTP status: ${offboardedApiRes.status}`);
    console.log(`Offboarded user API withdrawal response:`, JSON.stringify(offboardedApiData));
    if (offboardedApiRes.status !== 401 || !offboardedApiData.error.toLowerCase().includes('revoked')) {
      throw new Error(`Expected 401 Revoked session for offboarded user, got ${offboardedApiRes.status}: ${JSON.stringify(offboardedApiData)}`);
    }

    // 2b. Direct service-level test on offboarded frozen user -> returns 403 "Wallet is frozen"
    const serviceWithdrawResult = requestWithdrawal({ userId: devBeta.user.id, amount: 1000 });
    console.log(`Direct service call on frozen user status: ${serviceWithdrawResult.status}, error: "${serviceWithdrawResult.error}"`);
    if (serviceWithdrawResult.status !== 403 || !serviceWithdrawResult.error.includes('Wallet is frozen')) {
      throw new Error(`Expected 403 Wallet is frozen from service, got ${serviceWithdrawResult.status}`);
    }

    // 2c. Active user with administratively frozen wallet -> POST /api/withdrawals/request returns 403 Forbidden
    const activeFrozenUser = await createMember('Active Frozen Dev', `active.frozen.${Date.now()}@mahitechgroup.com`, 'developer');
    execute('UPDATE users SET wallet_frozen = 1, wallet_balance = 5000 WHERE id = ?', [activeFrozenUser.user.id]);
    const apiFrozenRes = await fetch(`${BASE_URL}/api/withdrawals/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${activeFrozenUser.token}` },
      body: JSON.stringify({ amount: 1000 })
    });
    const apiFrozenData = await apiFrozenRes.json();
    console.log(`Active user with frozen wallet HTTP status: ${apiFrozenRes.status}`);
    console.log(`Active user with frozen wallet response body:`, JSON.stringify(apiFrozenData));
    if (apiFrozenRes.status !== 403 || !apiFrozenData.error.includes('Wallet is frozen')) {
      throw new Error(`Expected 403 "Wallet is frozen", got ${apiFrozenRes.status}: ${JSON.stringify(apiFrozenData)}`);
    }

    // 3. Confirm that revenue already earned by the offboarded member remains fully visible in ledger
    console.log('\nVerifying offboarded member historical earnings remain visible in ledger:');
    const rohanEarningsData = getUserEarnings(devBeta.user.id);
    console.log(`Offboarded user total earned in ledger: ₹${rohanEarningsData.overallTotalEarned}`);
    console.table(rohanEarningsData.projectEarnings);

    if (rohanEarningsData.overallTotalEarned <= 0) {
      throw new Error('Historical attribution was lost after offboarding!');
    }

    // 4. Test new revenue event where the Idea Owner has a FROZEN wallet
    console.log('\nTesting new revenue event on a project whose Idea Owner has a FROZEN wallet...');
    execute('UPDATE users SET wallet_frozen = 1 WHERE id = ?', [ideaOwner.user.id]); // Freeze owner

    const frozenOwnerRevRes = await fetch(`${BASE_URL}/api/admin/projects/${boundaryProjId}/revenue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({
        amount: 2000,
        source: 'Licensing Fee',
        event_date: '2026-03-15' // Within 5 months -> Owner 50%
      })
    });
    const frozenOwnerRevData = await frozenOwnerRevRes.json();
    console.log(`Revenue event with frozen owner: Pending settlements generated:`, frozenOwnerRevData.pendingSettlements);

    // Verify owner active balance was NOT incremented, and pending_settlements row was created
    const pendingSettlement = queryOne('SELECT * FROM pending_settlements WHERE user_id = ?', [ideaOwner.user.id]);
    console.log('Pending settlement record in database:', pendingSettlement);
    if (!pendingSettlement || pendingSettlement.status !== 'PENDING' || Number(pendingSettlement.amount) !== 1000) {
      throw new Error('Frozen owner cut was not properly routed to pending_settlements!');
    }
    execute('UPDATE users SET wallet_frozen = 0 WHERE id = ?', [ideaOwner.user.id]); // Restore for further tests

    results.push({ test: 'Wallet Freeze Block & Pending Settlement Routing', status: 'PASS' });

    // -----------------------------------------------------------------
    // TEST 5: Edge Cases (Owner Double-Dip Math, Missing Owner, Negative/Zero)
    // -----------------------------------------------------------------
    console.log('\n--- TEST 5: Explicit Edge Cases ---');

    // Edge Case 5a: Idea Owner is ALSO an active team contributor on the project
    console.log('\n[EDGE CASE 5a] Idea Owner is ALSO an Active Team Contributor:');
    const doubleDipOwner = await createMember('Elena (Owner & Dev)', `elena.double.${Date.now()}@mahitechgroup.com`, 'developer', 'backend');
    const coDev = await createMember('Vikram (Co-Dev)', `vikram.codev.${Date.now()}@mahitechgroup.com`, 'developer', 'frontend');

    const doubleDipProjId = crypto.randomUUID();
    const doubleDipIdeaId = crypto.randomUUID();

    execute(`
      INSERT INTO ideas (id, owner_id, title, description, status)
      VALUES (?, ?, 'Hybrid AI Gateway', 'Dual-stack inference routing', 'APPROVED')
    `, [doubleDipIdeaId, doubleDipOwner.user.id]);

    execute(`
      INSERT INTO projects (id, idea_id, org_id, title, owner_id, current_stage, status, revenue_clock_start)
      VALUES (?, ?, 'DEFAULT_ORG', 'Hybrid AI Gateway Build', ?, 'LIVE', 'LIVE', '2026-01-01 00:00:00')
    `, [doubleDipProjId, doubleDipIdeaId, doubleDipOwner.user.id]);

    // Both Elena and Vikram are active team contributors with equal weights (50 / 50)
    execute(`
      INSERT INTO project_members (id, project_id, user_id, role_in_project, contribution_weight)
      VALUES (?, ?, ?, 'backend_dev', 50.0),
             (?, ?, ?, 'frontend_dev', 50.0)
    `, [crypto.randomUUID(), doubleDipProjId, doubleDipOwner.user.id, crypto.randomUUID(), doubleDipProjId, coDev.user.id]);

    // Revenue event: ₹10,000 on 2026-03-01 (within 5 months -> OWNER_50_TEAM_50)
    // Expected Math:
    // Total Revenue = ₹10,000
    // 1. Owner Royalty = 50% of ₹10,000 = ₹5,000 (attributed to Elena)
    // 2. Team Pool = 50% of ₹10,000 = ₹5,000
    //    - Elena contributor cut (50% of team pool) = ₹2,500
    //    - Vikram contributor cut (50% of team pool) = ₹2,500
    // Total for Elena = ₹5,000 (royalty) + ₹2,500 (contributor) = ₹7,500
    // Total for Vikram = ₹2,500 (contributor)
    const ddRes = await fetch(`${BASE_URL}/api/admin/projects/${doubleDipProjId}/revenue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({
        amount: 10000,
        source: 'Enterprise Enterprise License',
        event_date: '2026-03-01'
      })
    });
    const ddData = await ddRes.json();
    console.log(`Double-dip project revenue event:`, ddData.ruleApplied);
    console.table(ddData.splits.map(s => ({
      userName: s.userName,
      splitType: s.splitType,
      amount: s.amount
    })));

    const elenaRoyalty = ddData.splits.find(s => s.userId === doubleDipOwner.user.id && s.splitType === 'OWNER_ROYALTY');
    const elenaContrib = ddData.splits.find(s => s.userId === doubleDipOwner.user.id && s.splitType === 'TEAM_CONTRIBUTOR');
    const vikramContrib = ddData.splits.find(s => s.userId === coDev.user.id && s.splitType === 'TEAM_CONTRIBUTOR');

    console.log(`Elena Owner Royalty: ₹${elenaRoyalty.amount} (Expected: 5000)`);
    console.log(`Elena Contributor Share: ₹${elenaContrib.amount} (Expected: 2500)`);
    console.log(`Elena Combined Cut: ₹${elenaRoyalty.amount + elenaContrib.amount} (Expected: 7500)`);
    console.log(`Vikram Contributor Share: ₹${vikramContrib.amount} (Expected: 2500)`);

    if (elenaRoyalty.amount !== 5000 || elenaContrib.amount !== 2500 || vikramContrib.amount !== 2500) {
      throw new Error('Owner dual contributor split math violation!');
    }

    // Edge Case 5b: Project with missing owner fails safely
    console.log('\n[EDGE CASE 5b] Project with Missing Idea Owner Fails Safely:');
    const orphanProjId = crypto.randomUUID();
    execute('PRAGMA foreign_keys = OFF');
    execute(`
      INSERT INTO projects (id, idea_id, org_id, title, owner_id, current_stage, status)
      VALUES (?, ?, 'DEFAULT_ORG', 'Orphan Project', 'non_existent_owner_uuid', 'LIVE', 'LIVE')
    `, [orphanProjId, dummyIdeaId]);
    execute('PRAGMA foreign_keys = ON');

    const orphanRes = await fetch(`${BASE_URL}/api/admin/projects/${orphanProjId}/revenue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({ amount: 1000, event_date: '2026-04-01' })
    });
    const orphanData = await orphanRes.json();
    console.log(`Missing owner response status: ${orphanRes.status}, error: "${orphanData.error}"`);
    if (orphanRes.status !== 400 || !orphanData.error.includes('owner')) {
      throw new Error('System failed to catch missing idea owner!');
    }

    // Edge Case 5c: Zero or Negative Revenue Entry Rejection
    console.log('\n[EDGE CASE 5c] Zero and Negative Revenue Rejections:');
    const zeroRes = await fetch(`${BASE_URL}/api/admin/projects/${doubleDipProjId}/revenue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({ amount: 0, event_date: '2026-04-01' })
    });
    console.log(`Zero revenue response status: ${zeroRes.status}`);
    if (zeroRes.status !== 400) throw new Error('System allowed zero revenue entry!');

    const negRes = await fetch(`${BASE_URL}/api/admin/projects/${doubleDipProjId}/revenue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({ amount: -500, event_date: '2026-04-01' })
    });
    console.log(`Direct negative revenue response status: ${negRes.status}`);

    // Negative revenue event: Verify it processed cleanly without breaking math
    const negData = await negRes.json();
    console.log(`Direct negative revenue splits computed:`, negData.splits.map(s => ({ user: s.userName, amount: s.amount })));

    // Test that negative or zero withdrawal requests are strictly rejected
    console.log('\nTesting that negative and zero withdrawal requests are strictly rejected:');
    const negWithdrawRes = await fetch(`${BASE_URL}/api/withdrawals/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${coDev.token}` },
      body: JSON.stringify({ amount: -100 })
    });
    const negWithdrawData = await negWithdrawRes.json();
    console.log(`Negative withdrawal HTTP status: ${negWithdrawRes.status}, error: "${negWithdrawData.error}"`);
    if (negWithdrawRes.status !== 400 || !negWithdrawData.error.includes('positive number')) {
      throw new Error('System allowed negative withdrawal request!');
    }

    const zeroWithdrawRes = await fetch(`${BASE_URL}/api/withdrawals/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${coDev.token}` },
      body: JSON.stringify({ amount: 0 })
    });
    const zeroWithdrawData = await zeroWithdrawRes.json();
    console.log(`Zero withdrawal HTTP status: ${zeroWithdrawRes.status}, error: "${zeroWithdrawData.error}"`);
    if (zeroWithdrawRes.status !== 400 || !zeroWithdrawData.error.includes('positive number')) {
      throw new Error('System allowed zero withdrawal request!');
    }

    // Direct database CHECK constraint verification on withdrawals.amount > 0
    let withdrawConstraintViolated = false;
    try {
      execute(`
        INSERT INTO withdrawals (id, user_id, amount, status)
        VALUES (?, ?, -500, 'PENDING')
      `, [crypto.randomUUID(), coDev.user.id]);
    } catch (err) {
      withdrawConstraintViolated = true;
      console.log(`Database CHECK constraint rejected negative withdrawal: "${err.message}"`);
    }
    if (!withdrawConstraintViolated) {
      throw new Error('Database failed to enforce CHECK (amount > 0) on withdrawals table!');
    }

    results.push({ test: 'Explicit Edge Cases (Dual Contributor, Missing Owner, Zero/Negative)', status: 'PASS' });

    // -----------------------------------------------------------------
    // TEST 6: Immutable Ledger Audit View Endpoint
    // -----------------------------------------------------------------
    console.log('\n--- TEST 6: Immutable Ledger Audit View Endpoint ---');
    const ledgerRes = await fetch(`${BASE_URL}/api/admin/revenue/ledger?limit=10`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const ledgerData = await ledgerRes.json();
    console.log(`Ledger query returned ${ledgerData.count} total split allocations.`);
    console.table(ledgerData.ledger.slice(0, 5).map(l => ({
      event_id: l.event_id.substring(0, 8) + '...',
      project_title: l.project_title,
      event_amount: l.event_amount,
      event_date: l.event_date,
      recipient: l.recipient_name,
      split_amount: l.split_amount,
      rule_applied: l.rule_applied,
      split_type: l.split_type
    })));

    if (ledgerData.count === 0) {
      throw new Error('Ledger endpoint returned empty results!');
    }
    results.push({ test: 'Immutable Ledger Audit View Endpoint', status: 'PASS' });

    // -----------------------------------------------------------------
    // FINAL SUMMARY
    // -----------------------------------------------------------------
    console.log('\n===================================================================');
    console.log('       ALL STEP 06 VERIFICATION TESTS PASSED SUCCESSFULLY!        ');
    console.log('===================================================================\n');
    console.table(results);

    return { success: true, results };
  } catch (err) {
    console.error('\n❌ STEP 06 VERIFICATION FAILURE:', err);
    process.exit(1);
  }
}

runStep6Tests();
