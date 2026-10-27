import http from 'node:http';
import { createApp } from '../src/app.js';
import { runMigration } from '../src/db/migrate.js';
import { runSeed } from '../src/db/seed.js';
import { queryOne, queryAll, execute } from '../src/db/database.js';
import { runVotingDecisionJob } from '../src/jobs/votingDecisionJob.js';
import { evaluateVotingDecision } from '../src/services/votingService.js';

const TEST_PORT = 4997;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

async function runStep3Tests() {
  console.log('\n===================================================================');
  console.log('       RUNNING COMPREHENSIVE E2E VERIFICATION SUITE — STEP 03');
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
    // TEST 1: Admin Login & Voting System Config Check
    // -----------------------------------------------------------------
    console.log('--- TEST 1: Admin Login & Voting Config Verification ---');
    const adminLoginRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@mahitechgroup.com', password: 'AdminPassword@2026' })
    });
    const adminLoginData = await adminLoginRes.json();
    if (adminLoginRes.status !== 200) throw new Error('Admin login failed');
    const adminToken = adminLoginData.token;
    const adminUser = adminLoginData.user;

    execute("UPDATE system_config SET value = '70.0' WHERE key = 'vote_approval_threshold'");
    execute("UPDATE system_config SET value = '70.0' WHERE key = 'vote_quorum_percentage'");
    const configs = queryAll("SELECT key, value FROM system_config WHERE key LIKE 'vote_%' OR key = 'voting_window_hours'");
    console.log('Database voting configurations:', JSON.stringify(configs, null, 2));
    results.push({ test: 'Admin Login & Voting Config Check', status: 'PASS' });

    // -----------------------------------------------------------------
    // Helper to create & login team members
    // -----------------------------------------------------------------
    async function createAndLoginMember(name, email, role, subRole = null) {
      const password = 'Password@2026!';
      await fetch(`${BASE_URL}/api/admin/members/add`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
        body: JSON.stringify({ name, email, role, sub_role: subRole, temporary_password: password })
      });
      const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const data = await loginRes.json();
      return { user: data.user, token: data.token };
    }

    console.log('\n--- Setting up Voter Pool (1 Idea Owner + 10 Team Members) ---');
    const timestamp = Date.now();
    const owner = await createAndLoginMember('Idea Originator', `owner_${timestamp}@mahitechgroup.com`, 'researcher');
    console.log(`Created Idea Owner: ${owner.user.email} (id: ${owner.user.id})`);

    // Create 10 voting members so we can test exact percentages (e.g. 7/10 = 70.0%)
    const voters = [];
    for (let i = 1; i <= 10; i++) {
      const v = await createAndLoginMember(`Voter ${i}`, `voter_${i}_${timestamp}@mahitechgroup.com`, i % 2 === 0 ? 'developer' : 'producer');
      voters.push(v);
    }
    console.log(`Created ${voters.length} team members in voter pool.`);

    // -----------------------------------------------------------------
    // TEST 2: Idea Submission Triggers Automatic Review Meeting
    // -----------------------------------------------------------------
    console.log('\n--- TEST 2: Idea Submit Auto-Creates Review Meeting ---');
    const draftRes = await fetch(`${BASE_URL}/api/ideas/draft`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${owner.token}` },
      body: JSON.stringify({
        title: 'Neural Synthesis Engine',
        description: 'Edge-computed speech synthesis engine',
        attachment_url: 'https://cdn.mahitechgroup.com/specs/neural-v1.pdf'
      })
    });
    const draftData = await draftRes.json();
    const idea1Id = draftData.idea.id;

    // Submit idea
    const submitRes = await fetch(`${BASE_URL}/api/ideas/${idea1Id}/submit`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${owner.token}` }
    });
    const submitData = await submitRes.json();
    console.log('Submit Response:', JSON.stringify(submitData, null, 2));

    if (submitRes.status !== 200 || !submitData.meeting || !submitData.idea.voting_deadline) {
      throw new Error('Review meeting was not auto-scheduled on submission');
    }
    console.log(`Review Meeting ID: ${submitData.meeting.id}, Deadline: ${submitData.idea.voting_deadline}`);
    results.push({ test: 'Idea Submission Auto-Schedules Review Meeting', status: 'PASS' });

    // -----------------------------------------------------------------
    // TEST 3: Idea Owner Prohibited from Voting on Own Idea (403 Block)
    // -----------------------------------------------------------------
    console.log('\n--- TEST 3: Idea Owner Voting Block (403 Forbidden) ---');
    const ownerVoteRes = await fetch(`${BASE_URL}/api/ideas/${idea1Id}/vote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${owner.token}` },
      body: JSON.stringify({
        score_feasibility: 10,
        score_market: 10,
        score_capacity: 10,
        vote_color: 'green',
        comment: 'I love my own idea!'
      })
    });
    const ownerVoteData = await ownerVoteRes.json();
    console.log('Owner Vote Status:', ownerVoteRes.status);
    console.log('Owner Vote Response:', JSON.stringify(ownerVoteData, null, 2));
    if (ownerVoteRes.status !== 403 || !ownerVoteData.error.includes('Idea owners cannot vote on their own ideas')) {
      throw new Error('Owner was not blocked from voting on own idea!');
    }
    results.push({ test: 'Owner Voting Blocked on Own Idea (403 Forbidden)', status: 'PASS' });

    // -----------------------------------------------------------------
    // TEST 4: Valid Vote Casting & Real-time Green Percentage Recalculation
    // -----------------------------------------------------------------
    console.log('\n--- TEST 4: Valid Vote Casting & Percentage Calculation ---');
    const vote1Res = await fetch(`${BASE_URL}/api/ideas/${idea1Id}/vote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${voters[0].token}` },
      body: JSON.stringify({
        score_feasibility: 8,
        score_market: 9,
        score_capacity: 7,
        vote_color: 'green',
        comment: 'Strong technical feasibility.'
      })
    });
    const vote1Data = await vote1Res.json();
    console.log('Vote 1 Status:', vote1Res.status);
    console.log('Vote 1 Response:', JSON.stringify(vote1Data, null, 2));
    if (vote1Res.status !== 200 || vote1Data.vote.greenPercentage !== 100) {
      throw new Error('Vote casting failed or percentage incorrect');
    }
    results.push({ test: 'Valid Vote Casting & Percentage Recalculation', status: 'PASS' });

    // -----------------------------------------------------------------
    // TEST 5: Duplicate Vote Block (409 Conflict)
    // -----------------------------------------------------------------
    console.log('\n--- TEST 5: Duplicate Vote Attempt Blocked (409 Conflict) ---');
    const dupVoteRes = await fetch(`${BASE_URL}/api/ideas/${idea1Id}/vote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${voters[0].token}` },
      body: JSON.stringify({
        score_feasibility: 5,
        score_market: 5,
        score_capacity: 5,
        vote_color: 'red',
        comment: 'Changed my mind'
      })
    });
    const dupVoteData = await dupVoteRes.json();
    console.log('Duplicate Vote Status:', dupVoteRes.status);
    console.log('Duplicate Vote Response:', JSON.stringify(dupVoteData, null, 2));
    if (dupVoteRes.status !== 409 || !dupVoteData.error.includes('already voted')) {
      throw new Error('Duplicate vote was not blocked with 409!');
    }
    results.push({ test: 'Duplicate Vote Blocked (409 Conflict)', status: 'PASS' });

    // -----------------------------------------------------------------
    // TEST 6: Quorum Check & Low Participation Auto-Extension (24 Hours)
    // -----------------------------------------------------------------
    console.log('\n--- TEST 6: Low Participation Quorum Auto-Extension (24h) ---');
    // Currently only Voter 1 has voted out of 10+ eligible voters -> participation ~9% < 70% quorum
    // Simulation Method: We simulate the voting deadline arriving by setting voting_window_end to 1 minute ago in DB
    const oneMinAgo = new Date(Date.now() - 60 * 1000).toISOString();
    execute('UPDATE review_meetings SET voting_window_end = ? WHERE idea_id = ?', [oneMinAgo, idea1Id]);
    execute('UPDATE ideas SET voting_deadline = ? WHERE id = ?', [oneMinAgo, idea1Id]);
    console.log(`Simulated voting deadline arrival: set window end to ${oneMinAgo}`);

    const meetingBefore = queryOne('SELECT voting_window_end, status FROM review_meetings WHERE idea_id = ?', [idea1Id]);
    console.log('Meeting before cron check:', meetingBefore);

    // Run scheduled voting decision job
    const jobResults = runVotingDecisionJob();
    console.log('Job execution output:', JSON.stringify(jobResults, null, 2));

    const meetingAfter = queryOne('SELECT voting_window_end, status FROM review_meetings WHERE idea_id = ?', [idea1Id]);
    console.log('Meeting after cron check:', meetingAfter);

    if (meetingAfter.status !== 'EXTENDED') {
      throw new Error(`Expected meeting status 'EXTENDED', got '${meetingAfter.status}'`);
    }

    const diffHours = (new Date(meetingAfter.voting_window_end) - new Date(oneMinAgo)) / (1000 * 60 * 60);
    console.log(`Window extended by exactly: ${Math.round(diffHours)} hours.`);
    if (Math.round(diffHours) !== 24) {
      throw new Error('Window was not extended by 24 hours!');
    }
    results.push({ test: 'Low Participation Quorum Auto-Extension (24h)', status: 'PASS' });

    // -----------------------------------------------------------------
    // TEST 7: Exactly-At-Threshold Vote Split (70% Green => APPROVED)
    // -----------------------------------------------------------------
    console.log('\n--- TEST 7: Exactly-at-Threshold Supermajority (70.0% Green => APPROVED) ---');
    execute("UPDATE system_config SET value = '70.0' WHERE key = 'vote_approval_threshold'");
    execute("UPDATE system_config SET value = '0.0' WHERE key = 'vote_quorum_percentage'");
    // Create Idea 2
    const draft2Res = await (await fetch(`${BASE_URL}/api/ideas/draft`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${owner.token}` },
      body: JSON.stringify({ title: 'Quantum Encryption Proxy', description: 'Hardware security module gateway' })
    })).json();
    const idea2Id = draft2Res.idea.id;
    await fetch(`${BASE_URL}/api/ideas/${idea2Id}/submit`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${owner.token}` }
    });

    // Cast exactly 7 Green votes and 3 Red votes using our 10 voters = 70.0% Green, 100% participation
    for (let i = 0; i < 7; i++) {
      await fetch(`${BASE_URL}/api/ideas/${idea2Id}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${voters[i].token}` },
        body: JSON.stringify({ score_feasibility: 8, score_market: 8, score_capacity: 8, vote_color: 'green' })
      });
    }
    for (let i = 7; i < 10; i++) {
      await fetch(`${BASE_URL}/api/ideas/${idea2Id}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${voters[i].token}` },
        body: JSON.stringify({ score_feasibility: 4, score_market: 4, score_capacity: 4, vote_color: 'red' })
      });
    }

    // Verify summary before decision
    const summary2 = await (await fetch(`${BASE_URL}/api/ideas/${idea2Id}/votes`, {
      headers: { 'Authorization': `Bearer ${owner.token}` }
    })).json();
    console.log('Idea 2 Voting Summary (7 Green, 3 Red):', JSON.stringify({
      greenPercentage: summary2.summary.greenPercentage,
      totalVotesCast: summary2.summary.totalVotesCast,
      greenVotes: summary2.summary.greenVotes,
      redVotes: summary2.summary.redVotes,
      participationRate: summary2.summary.participationRate
    }, null, 2));

    if (summary2.summary.greenPercentage !== 70) {
      throw new Error(`Expected exactly 70.0% green percentage, got ${summary2.summary.greenPercentage}`);
    }

    // Evaluate decision
    const decision2 = evaluateVotingDecision(idea2Id);
    console.log('Decision output for Idea 2:', decision2);
    if (decision2.status !== 'APPROVED') {
      throw new Error(`Expected 'APPROVED' at exact 70% threshold, got '${decision2.status}'`);
    }

    const idea2DB = queryOne('SELECT status FROM ideas WHERE id = ?', [idea2Id]);
    console.log('Database idea status:', idea2DB.status);
    if (idea2DB.status !== 'APPROVED') throw new Error('Idea status was not updated to APPROVED in DB');
    results.push({ test: 'Exact 70% Green Threshold Triggers APPROVED', status: 'PASS' });

    // -----------------------------------------------------------------
    // TEST 8: Just-Under-Threshold (60% - 69% Green => REVISE)
    // -----------------------------------------------------------------
    console.log('\n--- TEST 8: Just-Under-Threshold (60% Green => REVISE) ---');
    // Create Idea 3
    const draft3Res = await (await fetch(`${BASE_URL}/api/ideas/draft`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${owner.token}` },
      body: JSON.stringify({ title: 'Micro-Turbine Power Unit', description: 'Miniaturized renewable energy generator' })
    })).json();
    const idea3Id = draft3Res.idea.id;
    // Set user quota so we can submit
    execute('UPDATE users SET idea_quota_used = 0 WHERE id = ?', [owner.user.id]);
    await fetch(`${BASE_URL}/api/ideas/${idea3Id}/submit`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${owner.token}` }
    });

    // Cast 6 Green votes and 4 Red votes = 60.0% Green (below 70%, but >= 50%)
    for (let i = 0; i < 6; i++) {
      await fetch(`${BASE_URL}/api/ideas/${idea3Id}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${voters[i].token}` },
        body: JSON.stringify({ score_feasibility: 6, score_market: 6, score_capacity: 6, vote_color: 'green' })
      });
    }
    for (let i = 6; i < 10; i++) {
      await fetch(`${BASE_URL}/api/ideas/${idea3Id}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${voters[i].token}` },
        body: JSON.stringify({ score_feasibility: 3, score_market: 3, score_capacity: 3, vote_color: 'red' })
      });
    }

    const decision3 = evaluateVotingDecision(idea3Id);
    console.log('Decision output for Idea 3 (60% Green):', decision3);
    if (decision3.status !== 'REVISE') {
      throw new Error(`Expected 'REVISE' at 60% green, got '${decision3.status}'`);
    }

    const idea3DB = queryOne('SELECT status FROM ideas WHERE id = ?', [idea3Id]);
    console.log('Database idea status:', idea3DB.status);
    if (idea3DB.status !== 'REVISE') throw new Error('Idea status was not updated to REVISE in DB');
    results.push({ test: 'Just-Under-Threshold (60% Green) Triggers REVISE', status: 'PASS' });

    // -----------------------------------------------------------------
    // TEST 9: Below 50% Green => REJECTED (With DB Persistence Proof)
    // -----------------------------------------------------------------
    console.log('\n--- TEST 9: Below 50% Green Triggers REJECTED (Zero Deletion Proof) ---');
    // Create Idea 4
    const draft4Res = await (await fetch(`${BASE_URL}/api/ideas/draft`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${owner.token}` },
      body: JSON.stringify({ title: 'Obsolete Vapor Recovery System', description: 'Outdated mechanical recovery model' })
    })).json();
    const idea4Id = draft4Res.idea.id;
    execute('UPDATE users SET idea_quota_used = 0 WHERE id = ?', [owner.user.id]);
    await fetch(`${BASE_URL}/api/ideas/${idea4Id}/submit`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${owner.token}` }
    });

    // Cast 2 Green votes and 8 Red votes = 20.0% Green (< 50%)
    for (let i = 0; i < 2; i++) {
      await fetch(`${BASE_URL}/api/ideas/${idea4Id}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${voters[i].token}` },
        body: JSON.stringify({ score_feasibility: 2, score_market: 2, score_capacity: 2, vote_color: 'green' })
      });
    }
    for (let i = 2; i < 10; i++) {
      await fetch(`${BASE_URL}/api/ideas/${idea4Id}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${voters[i].token}` },
        body: JSON.stringify({ score_feasibility: 1, score_market: 1, score_capacity: 1, vote_color: 'red' })
      });
    }

    const decision4 = evaluateVotingDecision(idea4Id);
    console.log('Decision output for Idea 4 (20% Green):', decision4);
    if (decision4.status !== 'REJECTED') {
      throw new Error(`Expected 'REJECTED' at 20% green, got '${decision4.status}'`);
    }

    // Verify idea row STILL exists in DB (NEVER deleted)
    const idea4DB = queryOne('SELECT id, title, status FROM ideas WHERE id = ?', [idea4Id]);
    console.log('Database verification of Rejected Idea (Preserved):', JSON.stringify(idea4DB, null, 2));
    if (!idea4DB || idea4DB.status !== 'REJECTED') {
      throw new Error('Rejected idea row missing or status corrupted');
    }
    results.push({ test: 'Below 50% Triggers REJECTED with DB Row Preserved', status: 'PASS' });

    // -----------------------------------------------------------------
    // TEST 10: Admin Veto Power (Mandatory Reason Validation)
    // -----------------------------------------------------------------
    console.log('\n--- TEST 10: Admin Veto Power & Mandatory Reason Logging ---');
    // Attempt override WITHOUT a reason -> MUST be rejected with 400
    const vetoNoReasonRes = await fetch(`${BASE_URL}/api/admin/ideas/${idea4Id}/override`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({
        decision: 'APPROVED',
        reason: '   ' // Empty whitespace
      })
    });
    const vetoNoReasonData = await vetoNoReasonRes.json();
    console.log('Veto Without Reason Status:', vetoNoReasonRes.status);
    console.log('Veto Without Reason Response:', JSON.stringify(vetoNoReasonData, null, 2));
    if (vetoNoReasonRes.status !== 400 || !vetoNoReasonData.error.includes('strictly mandatory')) {
      throw new Error('Expected 400 Bad Request when Admin vetoes without a reason!');
    }

    // Attempt override WITH a valid reason -> MUST SUCCEED and record reason in access_log
    const validReasonText = 'Strategic commercial partnership signed with government sponsor requiring immediate production.';
    const vetoWithReasonRes = await fetch(`${BASE_URL}/api/admin/ideas/${idea4Id}/override`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({
        decision: 'APPROVED',
        reason: validReasonText
      })
    });
    const vetoWithReasonData = await vetoWithReasonRes.json();
    console.log('Veto With Reason Status:', vetoWithReasonRes.status);
    console.log('Veto With Reason Response:', JSON.stringify(vetoWithReasonData, null, 2));
    if (vetoWithReasonRes.status !== 200 || vetoWithReasonData.idea.status !== 'APPROVED') {
      throw new Error('Admin override with valid reason failed');
    }

    // Verify access_log records the reason text verbatim
    const auditLogRow = queryOne(`
      SELECT action, resource, timestamp
      FROM access_log
      WHERE action = 'admin_override_veto'
      ORDER BY timestamp DESC
      LIMIT 1
    `);
    console.log('Audit Log Record for Admin Veto:', JSON.stringify(auditLogRow, null, 2));
    if (!auditLogRow || !auditLogRow.resource.includes(validReasonText)) {
      throw new Error('Audit log did not record the admin veto reason verbatim!');
    }
    results.push({ test: 'Admin Veto Enforces Mandatory Reason & Verbatim Audit Logging', status: 'PASS' });

    // -----------------------------------------------------------------
    // TEST 11: GET /api/ideas/pending-my-vote
    // -----------------------------------------------------------------
    console.log('\n--- TEST 11: Pending Votes Query (GET /api/ideas/pending-my-vote) ---');
    const pendingRes = await fetch(`${BASE_URL}/api/ideas/pending-my-vote`, {
      headers: { 'Authorization': `Bearer ${voters[1].token}` }
    });
    const pendingData = await pendingRes.json();
    console.log('Pending Votes Count for Voter 2:', pendingData.pendingIdeas?.length);
    console.log('Pending Ideas Sample:', JSON.stringify(pendingData.pendingIdeas?.map(p => ({ id: p.id, title: p.title })), null, 2));
    if (pendingRes.status !== 200 || !Array.isArray(pendingData.pendingIdeas)) {
      throw new Error('Pending votes query failed');
    }
    results.push({ test: 'Pending Votes Endpoint (GET /pending-my-vote)', status: 'PASS' });

    // -----------------------------------------------------------------
    // TEST 12: Admin Updates Voting Configuration (PATCH /api/admin/config/voting)
    // -----------------------------------------------------------------
    console.log('\n--- TEST 12: Admin Updates Voting Configuration ---');
    const configRes = await fetch(`${BASE_URL}/api/admin/config/voting`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({
        approvalThreshold: 75,
        quorumPercentage: 80,
        windowHours: 72
      })
    });
    const configData = await configRes.json();
    console.log('Config Update Status:', configRes.status);
    console.log('Config Update Response:', JSON.stringify(configData, null, 2));
    if (configRes.status !== 200 || configData.config.approvalThreshold !== 75 || configData.config.quorumPercentage !== 80 || configData.config.windowHours !== 72) {
      throw new Error('Voting config update failed');
    }
    results.push({ test: 'Admin Updates Voting Threshold & Quorum Config', status: 'PASS' });

    console.log('\n===================================================================');
    console.log('                ALL 12 TEST SUITES PASSED CLEANLY');
    console.log('===================================================================\n');
    console.table(results);

  } finally {
    await new Promise((resolve) => server.close(resolve));
    console.log('[TEST SERVER] Closed.\n');
  }
}

runStep3Tests().then(() => {
  console.log('Step 03 test suite run finished successfully.');
  process.exit(0);
}).catch((err) => {
  console.error('\nStep 03 test suite execution FAILED:', err);
  process.exit(1);
});
