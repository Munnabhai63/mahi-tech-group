import http from 'node:http';
import { createApp } from '../src/app.js';
import { runMigration } from '../src/db/migrate.js';
import { runSeed } from '../src/db/seed.js';
import { queryOne, queryAll, execute } from '../src/db/database.js';
import { runQuotaResetJob } from '../src/jobs/quotaResetJob.js';

const TEST_PORT = 4998;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

async function runStep2Tests() {
  console.log('\n===================================================================');
  console.log('       RUNNING COMPREHENSIVE E2E VERIFICATION SUITE — STEP 02');
  console.log('===================================================================\n');

  // 1. Setup DB
  runMigration();
  await runSeed();

  // 2. Start Test Server
  const app = createApp();
  const server = http.createServer(app);

  await new Promise((resolve) => server.listen(TEST_PORT, '127.0.0.1', resolve));
  console.log(`[TEST SERVER] Running on ${BASE_URL}\n`);

  const results = [];

  try {
    // -----------------------------------------------------------------
    // TEST 1: Admin Login & System Config Verification
    // -----------------------------------------------------------------
    console.log('--- TEST 1: Admin Login & System Config Verification ---');
    const adminLoginRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'admin@mahitechgroup.com',
        password: 'AdminPassword@2026'
      })
    });
    const adminLoginData = await adminLoginRes.json();
    if (adminLoginRes.status !== 200) throw new Error('Admin login failed');
    const adminToken = adminLoginData.token;

    const configRows = queryAll('SELECT key, value FROM system_config');
    console.log('Database system_config initial values:', JSON.stringify(configRows, null, 2));
    results.push({ test: 'Admin Login & System Config Seed Check', status: 'PASS' });

    // -----------------------------------------------------------------
    // TEST 2: Create Submitter Member (Researcher)
    // -----------------------------------------------------------------
    console.log('\n--- TEST 2: Admin Adds Test Submitter Member ---');
    const submitterEmail = `submitter_${Date.now()}@mahitechgroup.com`;
    const submitterPassword = 'SubmitterPass123!';

    const addMemberRes = await fetch(`${BASE_URL}/api/admin/members/add`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        name: 'Kavya Submitter',
        email: submitterEmail,
        role: 'researcher',
        temporary_password: submitterPassword
      })
    });
    const addMemberData = await addMemberRes.json();
    if (addMemberRes.status !== 201) throw new Error('Add submitter failed');
    const submitterId = addMemberData.user.id;

    // Login as submitter
    const subLoginRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: submitterEmail, password: submitterPassword })
    });
    const subLoginData = await subLoginRes.json();
    const submitterToken = subLoginData.token;
    console.log(`Submitter logged in. ID: ${submitterId}`);
    results.push({ test: 'Submitter Account Creation & Login', status: 'PASS' });

    // -----------------------------------------------------------------
    // TEST 3: Initial Quota Status Check (GET /api/users/me/quota-status)
    // -----------------------------------------------------------------
    console.log('\n--- TEST 3: Initial Quota Status Check (GET /api/users/me/quota-status) ---');
    const initialQuotaRes = await fetch(`${BASE_URL}/api/users/me/quota-status`, {
      headers: { 'Authorization': `Bearer ${submitterToken}` }
    });
    const initialQuotaData = await initialQuotaRes.json();
    console.log('Status:', initialQuotaRes.status);
    console.log('Response:', JSON.stringify(initialQuotaData, null, 2));
    if (initialQuotaRes.status !== 200 || initialQuotaData.quota.used !== 0 || initialQuotaData.quota.remaining !== 2) {
      throw new Error('Initial quota status incorrect');
    }
    results.push({ test: 'Initial Quota Status (0 used, 2 remaining)', status: 'PASS' });

    // -----------------------------------------------------------------
    // TEST 4: Draft Creation and Editing (Does NOT Consume Quota)
    // -----------------------------------------------------------------
    console.log('\n--- TEST 4: Draft Creation and Editing (Zero Quota Consumption) ---');
    const draftRes = await fetch(`${BASE_URL}/api/ideas/draft`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${submitterToken}`
      },
      body: JSON.stringify({
        title: 'Autonomous AI Drone Scanner',
        description: 'Computer-vision enabled perimeter scanner for facility inspections',
        attachment_url: 'https://docs.mahitechgroup.com/specs/drone-v1.pdf'
      })
    });
    const draftData = await draftRes.json();
    console.log('Draft Create Status:', draftRes.status);
    console.log('Draft Create Response:', JSON.stringify(draftData, null, 2));
    if (draftRes.status !== 201 || draftData.idea.status !== 'DRAFT') throw new Error('Draft creation failed');
    const draft1Id = draftData.idea.id;

    // Edit Draft
    const editRes = await fetch(`${BASE_URL}/api/ideas/${draft1Id}/draft`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${submitterToken}`
      },
      body: JSON.stringify({
        title: 'Autonomous AI Drone Scanner v2',
        description: 'Updated with thermal camera payload details'
      })
    });
    const editData = await editRes.json();
    console.log('Draft Edit Status:', editRes.status);
    console.log('Draft Edit Response:', JSON.stringify(editData, null, 2));
    if (editRes.status !== 200 || editData.idea.title !== 'Autonomous AI Drone Scanner v2') throw new Error('Draft edit failed');

    // Confirm Quota is STILL 0 used
    const quotaAfterDraft = await (await fetch(`${BASE_URL}/api/users/me/quota-status`, {
      headers: { 'Authorization': `Bearer ${submitterToken}` }
    })).json();
    console.log('Quota Status After Draft Creation/Editing:', JSON.stringify(quotaAfterDraft, null, 2));
    if (quotaAfterDraft.quota.used !== 0 || quotaAfterDraft.quota.remaining !== 2) {
      throw new Error('Draft creation incorrectly consumed quota!');
    }
    results.push({ test: 'Draft Creation & Editing Does NOT Consume Quota', status: 'PASS' });

    // Create Draft 2 and Draft 3
    const draft2 = await (await fetch(`${BASE_URL}/api/ideas/draft`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${submitterToken}` },
      body: JSON.stringify({ title: 'Quantum Ledger Protocol', description: 'Zero-knowledge proofs for fast settlements' })
    })).json();
    const draft2Id = draft2.idea.id;

    const draft3 = await (await fetch(`${BASE_URL}/api/ideas/draft`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${submitterToken}` },
      body: JSON.stringify({ title: 'Biometric Smart Lanyard', description: 'Real-time indoor location beacon and badge' })
    })).json();
    const draft3Id = draft3.idea.id;

    // -----------------------------------------------------------------
    // TEST 5: First Submission (Consumes 1 Quota, Starts Fixed Cycle)
    // -----------------------------------------------------------------
    console.log('\n--- TEST 5: First Submission (POST /api/ideas/:id/submit) ---');
    const submit1Res = await fetch(`${BASE_URL}/api/ideas/${draft1Id}/submit`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${submitterToken}` }
    });
    const submit1Data = await submit1Res.json();
    console.log('Submit 1 Status:', submit1Res.status);
    console.log('Submit 1 Response:', JSON.stringify(submit1Data, null, 2));
    if (submit1Res.status !== 200 || submit1Data.idea.status !== 'PENDING_REVIEW') throw new Error('First submission failed');
    if (submit1Data.quota.quotaUsed !== 1 || submit1Data.quota.remaining !== 1) throw new Error('Quota deduction mismatch');

    // Verify database quota log entry
    const quotaLogs = queryAll('SELECT * FROM idea_quota_log WHERE user_id = ?', [submitterId]);
    console.log('Database idea_quota_log entries after 1st submit:', JSON.stringify(quotaLogs, null, 2));
    if (quotaLogs.length !== 1) throw new Error('Missing idea_quota_log entry');
    results.push({ test: 'First Submission Quota Deduction & Status Transition', status: 'PASS' });

    // -----------------------------------------------------------------
    // TEST 6: Second Submission (Exact Quota Limit Reached: 2/2)
    // -----------------------------------------------------------------
    console.log('\n--- TEST 6: Second Submission (Exact Limit: 2/2) ---');
    const submit2Res = await fetch(`${BASE_URL}/api/ideas/${draft2Id}/submit`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${submitterToken}` }
    });
    const submit2Data = await submit2Res.json();
    console.log('Submit 2 Status:', submit2Res.status);
    console.log('Submit 2 Response:', JSON.stringify(submit2Data, null, 2));
    if (submit2Res.status !== 200 || submit2Data.quota.quotaUsed !== 2 || submit2Data.quota.remaining !== 0) {
      throw new Error('Second submission quota state failed');
    }
    results.push({ test: 'Second Submission (Reaching Exact Limit 2/2)', status: 'PASS' });

    // -----------------------------------------------------------------
    // TEST 7: Third Submission Attempt Blocked by Server (Quota Exhausted)
    // -----------------------------------------------------------------
    console.log('\n--- TEST 7: Third Submission Blocked (Server-Side Quota Enforcement) ---');
    const submit3Res = await fetch(`${BASE_URL}/api/ideas/${draft3Id}/submit`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${submitterToken}` }
    });
    const submit3Data = await submit3Res.json();
    console.log('Submit 3 Status:', submit3Res.status);
    console.log('Submit 3 Response:', JSON.stringify(submit3Data, null, 2));
    if (submit3Res.status !== 403 || !submit3Data.error.includes('Quota exhausted')) {
      throw new Error('Expected 403 Quota exhausted on 3rd submission!');
    }

    // Verify draft 3 status remained DRAFT
    const draft3Check = queryOne('SELECT status FROM ideas WHERE id = ?', [draft3Id]);
    console.log('Draft 3 Status in DB:', draft3Check.status);
    if (draft3Check.status !== 'DRAFT') throw new Error('Blocked idea status was altered unexpectedly');
    results.push({ test: 'Third Submission Blocked (403 Quota Exhausted)', status: 'PASS' });

    // -----------------------------------------------------------------
    // TEST 8: Rejected Idea Does NOT Refund Quota
    // -----------------------------------------------------------------
    console.log('\n--- TEST 8: Rejected Idea Quota Retention Check (No Refund Policy) ---');
    // Admin rejects Idea 1 (simulating voting outcome)
    execute("UPDATE ideas SET status = 'REJECTED', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [draft1Id]);
    const idea1Status = queryOne('SELECT status FROM ideas WHERE id = ?', [draft1Id]);
    console.log('Idea 1 status updated to:', idea1Status.status);

    // Check submitter quota status: MUST STILL BE 2 used, 0 remaining
    const quotaAfterReject = await (await fetch(`${BASE_URL}/api/users/me/quota-status`, {
      headers: { 'Authorization': `Bearer ${submitterToken}` }
    })).json();
    console.log('Quota status after idea rejection:', JSON.stringify(quotaAfterReject, null, 2));
    if (quotaAfterReject.quota.used !== 2 || quotaAfterReject.quota.remaining !== 0) {
      throw new Error('Violation: Quota was refunded after rejection! Non-negotiable rule broken.');
    }

    // Submitting draft 3 still blocked
    const blockedAfterRejectRes = await fetch(`${BASE_URL}/api/ideas/${draft3Id}/submit`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${submitterToken}` }
    });
    if (blockedAfterRejectRes.status !== 403) throw new Error('Submission was allowed despite rejected quota retention');
    console.log('Verified: Rejected idea permanently retains quota consumption.');
    results.push({ test: 'Rejected Ideas Retain Quota (No Refund Policy)', status: 'PASS' });

    // -----------------------------------------------------------------
    // TEST 9: Admin Updates Quota Limit via PATCH /api/admin/config/quota
    // -----------------------------------------------------------------
    console.log('\n--- TEST 9: Admin Dynamic Quota Limit Update (PATCH /api/admin/config/quota) ---');
    const updateConfigRes = await fetch(`${BASE_URL}/api/admin/config/quota`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: JSON.stringify({ limit: 3 })
    });
    const updateConfigData = await updateConfigRes.json();
    console.log('Config Update Status:', updateConfigRes.status);
    console.log('Config Update Response:', JSON.stringify(updateConfigData, null, 2));
    if (updateConfigRes.status !== 200 || updateConfigData.config.limit !== 3) throw new Error('Config update failed');

    // Submitter checks quota status: Now used=2, remaining=1 (limit=3)
    const quotaAfterConfig = await (await fetch(`${BASE_URL}/api/users/me/quota-status`, {
      headers: { 'Authorization': `Bearer ${submitterToken}` }
    })).json();
    console.log('Quota status after Admin raised limit to 3:', JSON.stringify(quotaAfterConfig, null, 2));
    if (quotaAfterConfig.quota.limit !== 3 || quotaAfterConfig.quota.remaining !== 1) {
      throw new Error('New quota limit not dynamically reflected');
    }

    // Now submit Draft 3 (Should SUCCEED with 3/3)
    const submit3RetryRes = await fetch(`${BASE_URL}/api/ideas/${draft3Id}/submit`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${submitterToken}` }
    });
    const submit3RetryData = await submit3RetryRes.json();
    console.log('Submit 3 Retry Status:', submit3RetryRes.status);
    console.log('Submit 3 Retry Response:', JSON.stringify(submit3RetryData, null, 2));
    if (submit3RetryRes.status !== 200 || submit3RetryData.quota.quotaUsed !== 3) throw new Error('Submission with raised quota limit failed');
    results.push({ test: 'Dynamic Admin Config Quota Increase & Immediate Enforcement', status: 'PASS' });

    // -----------------------------------------------------------------
    // TEST 10: Scheduled / Cron Quota Reset Job (Simulated Expiration)
    // -----------------------------------------------------------------
    console.log('\n--- TEST 10: Quota Cycle Reset Job (Simulated Expiration & Auto-Reset) ---');
    // Approach: We simulate a completed fixed cycle by setting the user's quota_reset_date to yesterday in DB
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];

    execute('UPDATE users SET quota_reset_date = ? WHERE id = ?', [yesterdayStr, submitterId]);
    console.log(`Set submitter quota_reset_date to yesterday: ${yesterdayStr}`);

    // Run the actual daily cron reset job function
    console.log('Executing runQuotaResetJob()...');
    const resetJobResult = runQuotaResetJob();
    console.log('Reset Job Execution Result:', JSON.stringify(resetJobResult, null, 2));
    if (resetJobResult.resetCount < 1) throw new Error('Quota reset job did not process expired user');

    // Verify user in DB has reset: idea_quota_used = 0 and new quota_reset_date set
    const userAfterReset = queryOne('SELECT idea_quota_used, quota_reset_date FROM users WHERE id = ?', [submitterId]);
    console.log('Database User After Reset Job:', JSON.stringify(userAfterReset, null, 2));
    if (userAfterReset.idea_quota_used !== 0) throw new Error('idea_quota_used was not reset to 0');

    // Submitter quota status via API
    const quotaAfterCron = await (await fetch(`${BASE_URL}/api/users/me/quota-status`, {
      headers: { 'Authorization': `Bearer ${submitterToken}` }
    })).json();
    console.log('API Quota Status after Cron Reset:', JSON.stringify(quotaAfterCron, null, 2));
    if (quotaAfterCron.quota.used !== 0 || quotaAfterCron.quota.remaining !== 3) {
      throw new Error('API did not reflect post-cron reset state');
    }

    // Verify user can now submit a fresh idea in the new cycle
    const draft4 = await (await fetch(`${BASE_URL}/api/ideas/draft`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${submitterToken}` },
      body: JSON.stringify({ title: 'Solar Powered Satellite Relay', description: 'Low earth orbit communication mesh' })
    })).json();

    const submit4Res = await fetch(`${BASE_URL}/api/ideas/${draft4.idea.id}/submit`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${submitterToken}` }
    });
    const submit4Data = await submit4Res.json();
    console.log('Fresh Cycle Submit 4 Status:', submit4Res.status);
    console.log('Fresh Cycle Submit 4 Response:', JSON.stringify(submit4Data, null, 2));
    if (submit4Res.status !== 200 || submit4Data.quota.quotaUsed !== 1) throw new Error('Post-reset submission failed');
    results.push({ test: 'Daily Quota Reset Job Execution & New Cycle Unblock', status: 'PASS' });

    // -----------------------------------------------------------------
    // TEST 11: Ideas Listing (GET /api/ideas/my) & Detail (GET /api/ideas/:id)
    // -----------------------------------------------------------------
    console.log('\n--- TEST 11: My Ideas List & Single Idea Detail ---');
    const myListRes = await fetch(`${BASE_URL}/api/ideas/my`, {
      headers: { 'Authorization': `Bearer ${submitterToken}` }
    });
    const myListData = await myListRes.json();
    console.log('My Ideas List Count:', myListData.ideas?.length);
    console.log('Ideas Sample:', JSON.stringify(myListData.ideas.map(i => ({ id: i.id, title: i.title, status: i.status })), null, 2));
    if (myListRes.status !== 200 || myListData.ideas.length < 4) throw new Error('My ideas listing failed');

    // Fetch single idea
    const singleIdeaRes = await fetch(`${BASE_URL}/api/ideas/${draft1Id}`, {
      headers: { 'Authorization': `Bearer ${submitterToken}` }
    });
    const singleIdeaData = await singleIdeaRes.json();
    console.log('Single Idea Detail Status:', singleIdeaRes.status);
    console.log('Single Idea Detail:', JSON.stringify(singleIdeaData, null, 2));
    if (singleIdeaRes.status !== 200 || singleIdeaData.idea.id !== draft1Id) throw new Error('Single idea detail failed');
    results.push({ test: 'My Ideas List (GET /my) & Single Idea Detail (GET /:id)', status: 'PASS' });

    console.log('\n===================================================================');
    console.log('                ALL 11 TEST SUITES PASSED CLEANLY');
    console.log('===================================================================\n');
    console.table(results);

  } finally {
    await new Promise((resolve) => server.close(resolve));
    console.log('[TEST SERVER] Closed.\n');
  }
}

runStep2Tests().then(() => {
  console.log('Step 02 test suite run finished successfully.');
  process.exit(0);
}).catch((err) => {
  console.error('\nStep 02 test suite execution FAILED:', err);
  process.exit(1);
});
