/**
 * STEP 09: FRONTEND USER PROFILE PAGE VERIFICATION SUITE
 * 
 * Verifies all requirements from 09_FRONTEND_USER_PROFILE.md:
 * 1. Profile Header + Quick Stats (GET /api/users/:id/profile)
 * 2. Ideas History Tab (GET /api/users/:id/ideas) with permanent status preservation
 * 3. Projects Tab (GET /api/users/:id/projects) with role, contribution weight, and Idea Owner badge
 * 4. Ratings Tab (GET /api/users/:id/ratings) showing overall average rating
 * 5. Strict Financial Privacy Gating:
 *    - Owner sees own detailed earnings (HTTP 200)
 *    - Admin sees member detailed earnings (HTTP 200)
 *    - Peer non-admin calling detailed earnings is BLOCKED (HTTP 403)
 *    - Peer non-admin calling earnings-summary gets aggregate total only (HTTP 200)
 * 6. Former Member Handling (Step 05 Integration):
 *    - Offboarded inactive member has isFormerMember=true, isWalletFrozen=true
 *    - Editing profile for inactive user blocked (HTTP 403)
 * 7. Self-Profile Editing (PATCH /api/users/me/profile) for active user
 * 8. Static UI route /profile.html serves HTTP 200
 */

import http from 'node:http';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { createApp } from '../src/app.js';
import { config } from '../src/config.js';
import { runMigration } from '../src/db/migrate.js';
import { runSeed } from '../src/db/seed.js';
import { queryOne, queryAll, execute } from '../src/db/database.js';
import { initWebSocketServer } from '../src/services/wsService.js';

const TEST_PORT = 4991;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

async function req(method, endpoint, token = null, body = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${BASE_URL}${endpoint}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });

  let data = null;
  const text = await res.text();
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }

  return { status: res.status, ok: res.ok, data };
}

async function loginUser(email, password) {
  const res = await req('POST', '/api/auth/login', null, { email, password });
  if (!res.ok) {
    throw new Error(`Login failed for ${email}: ${res.status} ${JSON.stringify(res.data)}`);
  }
  return { token: res.data.token, user: res.data.user };
}

async function runStep09ProfileTests() {
  console.log('===================================================================');
  console.log('   STEP 09: FRONTEND USER PROFILE PAGE VERIFICATION SUITE');
  console.log('===================================================================\n');

  console.log('[SETUP] Running database migrations & seeding...');
  runMigration();
  runSeed();

  const app = createApp();
  const server = http.createServer(app);
  const wss = initWebSocketServer(server);

  await new Promise((resolve) => server.listen(TEST_PORT, resolve));
  console.log(`[SETUP] Test server listening on ${BASE_URL}\n`);

  try {
    // -------------------------------------------------------------------------
    // STAGE 0: Authenticate Test Personas
    // -------------------------------------------------------------------------
    console.log('[STAGE 0] Authenticating test personas...');
    const adminSession = await loginUser('admin@mahitechgroup.com', 'AdminPassword@2026');
    console.log(`   ✓ Admin authenticated: ${adminSession.user.name} (${adminSession.user.id})`);

    // Create / authenticate Active Researcher (Profile Subject)
    const researcherEmail = `researcher.step09.${Date.now()}@mahitechgroup.com`;
    const researcherPass = 'ResearchPass123!';
    const researcherId = crypto.randomUUID();
    const hashRes = await bcrypt.hash(researcherPass, 10);
    execute(`
      INSERT INTO users (id, name, email, password_hash, role, status, rating_avg, wallet_balance, wallet_frozen, bio)
      VALUES (?, ?, ?, ?, 'researcher', 'active', 4.8, 12500.00, 0, 'Quantum AI Researcher and System Architect')
    `, [researcherId, 'Dr. Samantha Carter', researcherEmail, hashRes]);

    const researcherSession = await loginUser(researcherEmail, researcherPass);
    console.log(`   ✓ Researcher (Subject) authenticated: ${researcherSession.user.name} (${researcherSession.user.id})`);

    // Create / authenticate Peer Developer (Peer Viewer)
    const peerDevEmail = `peer.dev.${Date.now()}@mahitechgroup.com`;
    const peerDevPass = 'DeveloperPass123!';
    const peerDevId = crypto.randomUUID();
    const hashDev = await bcrypt.hash(peerDevPass, 10);
    execute(`
      INSERT INTO users (id, name, email, password_hash, role, sub_role, status, rating_avg, wallet_balance, wallet_frozen)
      VALUES (?, ?, ?, ?, 'developer', 'backend', 'active', 4.9, 8000.00, 0)
    `, [peerDevId, 'Marcus Cole', peerDevEmail, hashDev]);

    const peerDevSession = await loginUser(peerDevEmail, peerDevPass);
    console.log(`   ✓ Peer Developer authenticated: ${peerDevSession.user.name} (${peerDevSession.user.id})`);

    // Create active user to be offboarded in real-time lifecycle test (Step 05 Integration)
    const offboardTestEmail = `offboard.candidate.${Date.now()}@mahitechgroup.com`;
    const offboardTestPass = 'OffboardCandidatePass123!';
    const offboardTestHash = await bcrypt.hash(offboardTestPass, 10);
    const offboardTestId = crypto.randomUUID();
    execute(`
      INSERT INTO users (id, name, email, password_hash, role, sub_role, status, rating_avg, wallet_balance, wallet_frozen, bio)
      VALUES (?, 'Julian Bashir', ?, ?, 'developer', 'backend', 'active', 4.5, 4500.00, 0, 'Original active bio before offboarding')
    `, [offboardTestId, offboardTestEmail, offboardTestHash]);
    console.log(`   ✓ Active member prepared for offboarding lifecycle: Julian Bashir (${offboardTestId})\n`);

    // Seed test Ideas for Researcher
    const idea1Id = crypto.randomUUID();
    const idea2Id = crypto.randomUUID();
    const idea3Id = crypto.randomUUID();
    execute(`
      INSERT INTO ideas (id, owner_id, title, description, status, green_percentage, created_at)
      VALUES (?, ?, 'Neural Workspace Matrix', 'Quantum parallel engine', 'APPROVED', 88.5, CURRENT_TIMESTAMP),
             (?, ?, 'Deprecated Edge Pipeline', 'Edge pipeline test', 'REJECTED', 35.0, CURRENT_TIMESTAMP),
             (?, ?, 'Autonomous Drone Telemetry', 'Drone swarm analytics', 'PENDING_REVIEW', 0.0, CURRENT_TIMESTAMP)
    `, [idea1Id, researcherId, idea2Id, researcherId, idea3Id, researcherId]);

    // Seed test Project with Researcher as Owner
    const projId = crypto.randomUUID();
    execute(`
      INSERT INTO projects (id, idea_id, title, owner_id, current_stage, status)
      VALUES (?, ?, 'Neural Workspace Engine', ?, 'RESEARCH_DEV_PARALLEL', 'ACTIVE')
    `, [projId, idea1Id, researcherId]);
    execute(`
      INSERT INTO project_members (id, project_id, user_id, role_in_project, contribution_weight)
      VALUES (?, ?, ?, 'researcher', 35.00)
    `, [crypto.randomUUID(), projId, researcherId]);

    // Seed test Revenue Event and Split for Researcher
    const revEventId = crypto.randomUUID();
    execute(`
      INSERT INTO revenue_events (id, project_id, amount, source, event_date, created_at)
      VALUES (?, ?, 25000.00, 'Stripe Gateway', '2026-10-20', CURRENT_TIMESTAMP)
    `, [revEventId, projId]);

    execute(`
      INSERT INTO revenue_splits (id, revenue_event_id, user_id, amount, rule_applied, split_type, created_at)
      VALUES (?, ?, ?, 12500.00, 'OWNER_50_TEAM_50', 'OWNER_ROYALTY', CURRENT_TIMESTAMP)
    `, [crypto.randomUUID(), revEventId, researcherId]);

    // -------------------------------------------------------------------------
    // TEST 1: Profile Header + Quick Stats (GET /api/users/:id/profile)
    // -------------------------------------------------------------------------
    console.log('[TEST 1] Fetch full profile header & quick stats (GET /api/users/:id/profile)...');
    const profileRes = await req('GET', `/api/users/${researcherId}/profile`, researcherSession.token);
    console.log(`   -> HTTP Status: ${profileRes.status}`);

    if (profileRes.status !== 200) {
      throw new Error(`Expected HTTP 200, got ${profileRes.status}: ${JSON.stringify(profileRes.data)}`);
    }

    const { user: profileUser, stats: profileStats } = profileRes.data;
    console.log('   ✓ Profile Header Details:');
    console.log(`     - Name: ${profileUser.name}`);
    console.log(`     - Role: ${profileUser.role}`);
    console.log(`     - Status: ${profileUser.status}`);
    console.log(`     - Rating Avg: ${profileUser.ratingAvg}★`);
    console.log(`     - Bio: "${profileUser.bio}"`);
    console.log(`     - isFormerMember: ${profileUser.isFormerMember}`);
    console.log(`     - isWalletFrozen: ${profileUser.isWalletFrozen}`);

    console.log('   ✓ Profile Quick Stats:');
    console.log(`     - Ideas Submitted: ${profileStats.ideasSubmitted} (Expected >= 3)`);
    console.log(`     - Projects Built: ${profileStats.projectsBuilt} (Expected >= 1)`);
    console.log(`     - Approval Rate: ${profileStats.approvalRate}%`);
    console.log(`     - Total Revenue Earned: ₹${profileStats.totalRevenueEarned}`);
    console.log(`     - Wallet Balance: ₹${profileStats.walletBalance}`);

    if (profileUser.name !== 'Dr. Samantha Carter') throw new Error('Profile name mismatch');
    if (profileUser.role !== 'researcher') throw new Error('Profile role mismatch');
    if (profileStats.ideasSubmitted < 3) throw new Error('Incorrect ideasSubmitted count');
    if (profileStats.projectsBuilt < 1) throw new Error('Incorrect projectsBuilt count');
    if (parseFloat(profileStats.totalRevenueEarned) < 12500) throw new Error('Incorrect totalRevenueEarned');
    console.log('   ✓ TEST 1 PASSED: Profile header and quick stats correctly aggregated and rendered\n');

    // -------------------------------------------------------------------------
    // TEST 2: Ideas History Tab (GET /api/users/:id/ideas)
    // -------------------------------------------------------------------------
    console.log('[TEST 2] Fetch Ideas History Tab (GET /api/users/:id/ideas)...');
    const ideasRes = await req('GET', `/api/users/${researcherId}/ideas`, peerDevSession.token);
    console.log(`   -> HTTP Status: ${ideasRes.status}`);
    console.log(`   -> Ideas Count: ${ideasRes.data.count}`);

    if (ideasRes.status !== 200) {
      throw new Error(`Expected HTTP 200 from ideas endpoint, got ${ideasRes.status}`);
    }

    const returnedIdeas = ideasRes.data.ideas;
    const hasApproved = returnedIdeas.some(i => i.status === 'APPROVED');
    const hasRejected = returnedIdeas.some(i => i.status === 'REJECTED');
    const hasPending = returnedIdeas.some(i => i.status === 'PENDING_REVIEW');

    console.log(`     * Approved idea found: ${hasApproved}`);
    console.log(`     * Rejected idea found (permanent history): ${hasRejected}`);
    console.log(`     * Pending idea found: ${hasPending}`);

    if (!hasApproved || !hasRejected || !hasPending) {
      throw new Error('Ideas tab must permanently preserve all statuses (Approved, Rejected, Pending)');
    }
    console.log('   ✓ TEST 2 PASSED: Ideas history tab lists all ideas permanently without deletion\n');

    // -------------------------------------------------------------------------
    // TEST 3: Projects History Tab (GET /api/users/:id/projects)
    // -------------------------------------------------------------------------
    console.log('[TEST 3] Fetch Projects History Tab (GET /api/users/:id/projects)...');
    const projectsRes = await req('GET', `/api/users/${researcherId}/projects`, peerDevSession.token);
    console.log(`   -> HTTP Status: ${projectsRes.status}`);
    console.log(`   -> Projects Count: ${projectsRes.data.count}`);

    if (projectsRes.status !== 200) {
      throw new Error(`Expected HTTP 200 from projects endpoint, got ${projectsRes.status}`);
    }

    const returnedProjects = projectsRes.data.projects;
    const foundProject = returnedProjects.find(p => p.id === projId);
    if (!foundProject) throw new Error('Contributed project not returned in projects list');

    console.log('   ✓ Project Contribution Card:');
    console.log(`     - Title: "${foundProject.title}"`);
    console.log(`     - Current Stage: ${foundProject.currentStage}`);
    console.log(`     - Contribution Weight: ${foundProject.contributionWeight}%`);
    console.log(`     - isIdeaOwner: ${foundProject.isIdeaOwner} (Must be true for founder/owner)`);

    if (foundProject.contributionWeight !== 35.0) throw new Error('Contribution weight mismatch');
    if (!foundProject.isIdeaOwner) throw new Error('isIdeaOwner flag must be true');
    console.log('   ✓ TEST 3 PASSED: Projects tab lists contribution weight and Idea Owner highlight badge\n');

    // -------------------------------------------------------------------------
    // TEST 4: Performance Ratings Tab (GET /api/users/:id/ratings)
    // -------------------------------------------------------------------------
    console.log('[TEST 4] Fetch Ratings Tab (GET /api/users/:id/ratings)...');
    const ratingsRes = await req('GET', `/api/users/${researcherId}/ratings`, peerDevSession.token);
    console.log(`   -> HTTP Status: ${ratingsRes.status}`);
    console.log(`   -> Rating Average: ${ratingsRes.data.ratingAverage}★ (Scale: ${ratingsRes.data.ratingScale})`);

    if (ratingsRes.status !== 200) {
      throw new Error(`Expected HTTP 200 from ratings endpoint, got ${ratingsRes.status}`);
    }
    if (ratingsRes.data.ratingAverage !== '4.8') {
      throw new Error(`Expected ratingAverage '4.8', got '${ratingsRes.data.ratingAverage}'`);
    }
    console.log('   ✓ TEST 4 PASSED: Ratings tab returns overall average rating and project count\n');

    // -------------------------------------------------------------------------
    // TEST 5: Financial Privacy Gating (Earnings Tab)
    // -------------------------------------------------------------------------
    console.log('[TEST 5] Financial Privacy Gating on Earnings Tab...');

    // 5.1 Profile Owner viewing own detailed earnings -> MUST BE HTTP 200
    const ownerEarningsRes = await req('GET', `/api/users/${researcherId}/earnings`, researcherSession.token);
    console.log(`   -> Owner viewing OWN earnings: HTTP ${ownerEarningsRes.status} (Expected 200)`);
    if (ownerEarningsRes.status !== 200) {
      throw new Error(`Owner was denied access to own earnings: HTTP ${ownerEarningsRes.status}`);
    }
    console.log(`     * Total Earned: ₹${ownerEarningsRes.data.totalEarned}`);
    console.log(`     * Splits count: ${ownerEarningsRes.data.splits?.length}`);

    // 5.2 Admin viewing member detailed earnings -> MUST BE HTTP 200
    const adminEarningsRes = await req('GET', `/api/users/${researcherId}/earnings`, adminSession.token);
    console.log(`   -> Admin viewing member earnings: HTTP ${adminEarningsRes.status} (Expected 200)`);
    if (adminEarningsRes.status !== 200) {
      throw new Error(`Admin was denied access to member earnings: HTTP ${adminEarningsRes.status}`);
    }

    // 5.3 Peer Member viewing member detailed earnings -> MUST BE HTTP 403 FORBIDDEN
    const peerEarningsRes = await req('GET', `/api/users/${researcherId}/earnings`, peerDevSession.token);
    console.log(`   -> Peer viewing member detailed earnings: HTTP ${peerEarningsRes.status} (Expected 403 Forbidden)`);
    console.log(`     * Privacy error message: "${peerEarningsRes.data.error}"`);
    if (peerEarningsRes.status !== 403) {
      throw new Error(`SECURITY REGRESSION: Peer was able to view detailed earnings breakdown! Status: ${peerEarningsRes.status}`);
    }

    // 5.4 Peer Member viewing aggregate earnings-summary -> MUST BE HTTP 200 with aggregate ONLY
    const peerSummaryRes = await req('GET', `/api/users/${researcherId}/earnings-summary`, peerDevSession.token);
    console.log(`   -> Peer viewing earnings-summary: HTTP ${peerSummaryRes.status} (Expected 200)`);
    if (peerSummaryRes.status !== 200) {
      throw new Error(`Failed to fetch earnings-summary: HTTP ${peerSummaryRes.status}`);
    }
    console.log(`     * Peer sees Total Lifetime Revenue: ₹${peerSummaryRes.data.totalRevenueEarned}`);
    console.log(`     * Peer sees Projects Count: ${peerSummaryRes.data.projectsContributedCount}`);
    console.log(`     * Splits array included in summary: ${peerSummaryRes.data.splits !== undefined} (Must be false)`);

    if (peerSummaryRes.data.splits !== undefined) {
      throw new Error('PRIVACY VIOLATION: Individual splits array leaked in earnings-summary!');
    }
    console.log('   ✓ TEST 5 PASSED: Strict financial privacy enforced (Owner/Admin get full ledger; Peers blocked with 403 & receive aggregate summary only)\n');

    // -------------------------------------------------------------------------
    // TEST 6: Former Member Handling & Real-Time Session Revocation (Step 05 Integration)
    // -------------------------------------------------------------------------
    console.log('[TEST 6] Former Member Handling & Real-Time Session Revocation (Step 05 Integration)...');

    // Step A: Active member logs in and acquires a fully valid JWT session
    const validPreOffboardSession = await loginUser(offboardTestEmail, offboardTestPass);
    console.log(`   -> Active login prior to offboard: HTTP 200 (Token obtained)`);

    // Step B: Verify the token is fully active and functional prior to offboard
    const preCheckRes = await req('GET', '/api/users/me', validPreOffboardSession.token);
    if (preCheckRes.status !== 200) {
      throw new Error(`Pre-offboard token verification failed: HTTP ${preCheckRes.status}`);
    }
    console.log(`   ✓ Active token pre-check: HTTP 200 (Verified active and working)`);

    // Step C: Admin executes REAL Step 05 Offboarding Kill-Switch (POST /api/admin/members/:id/offboard)
    const offboardRes = await req('POST', `/api/admin/members/${offboardTestId}/offboard`, adminSession.token, {
      reason: 'Contract completion - Step 09 profile verification'
    });
    console.log(`   -> Admin triggers Step 05 killswitch: HTTP ${offboardRes.status}`);
    if (offboardRes.status !== 200) {
      throw new Error(`Offboarding killswitch failed: HTTP ${offboardRes.status} ${JSON.stringify(offboardRes.data)}`);
    }

    // Step D: Verify database state post-killswitch
    const offboardedDbUser = queryOne('SELECT status, wallet_frozen, deactivated_at FROM users WHERE id = ?', [offboardTestId]);
    console.log(`   ✓ DB state post-killswitch: status='${offboardedDbUser.status}', wallet_frozen=${offboardedDbUser.wallet_frozen}, deactivated_at='${offboardedDbUser.deactivated_at}'`);

    // Step E: Attempt to use the EXACT PRE-OFFBOARDING TOKEN to call PATCH /api/users/me/profile
    const editWithStaleTokenRes = await req('PATCH', '/api/users/me/profile', validPreOffboardSession.token, {
      bio: 'Attempting to edit bio with revoked pre-offboarding token'
    });
    console.log(`   -> Attempt to edit profile with stale pre-offboarding token: HTTP ${editWithStaleTokenRes.status}`);
    console.log(`     * Revocation error message: "${editWithStaleTokenRes.data.error}"`);
    if (editWithStaleTokenRes.status !== 401) {
      throw new Error(`Expected HTTP 401 Session Revoked, got ${editWithStaleTokenRes.status}`);
    }

    // Step F: Attempt fresh login as offboarded member
    const freshLoginRes = await req('POST', '/api/auth/login', null, {
      email: offboardTestEmail,
      password: offboardTestPass
    });
    console.log(`   -> Attempt fresh login post-offboarding: HTTP ${freshLoginRes.status}`);
    console.log(`     * Login rejection message: "${freshLoginRes.data.error}"`);
    if (freshLoginRes.status !== 403) {
      throw new Error(`Expected HTTP 403 Access Revoked on login, got ${freshLoginRes.status}`);
    }

    // Step G: Fetch former member profile from peer perspective (GET /api/users/:id/profile)
    const formerProfileRes = await req('GET', `/api/users/${offboardTestId}/profile`, peerDevSession.token);
    console.log(`   -> Peer fetches former member profile: HTTP ${formerProfileRes.status}`);
    if (formerProfileRes.status !== 200) {
      throw new Error(`Failed to fetch former member profile: HTTP ${formerProfileRes.status}`);
    }
    const formerUser = formerProfileRes.data.user;
    console.log(`     * isFormerMember: ${formerUser.isFormerMember} (Must be true)`);
    console.log(`     * deactivatedAt: ${formerUser.deactivatedAt}`);
    console.log(`     * isWalletFrozen: ${formerUser.isWalletFrozen} (Must be true)`);

    if (!formerUser.isFormerMember) throw new Error('isFormerMember must be true for status=inactive');
    if (!formerUser.isWalletFrozen) throw new Error('isWalletFrozen must be true for offboarded former member');
    if (!formerUser.deactivatedAt) throw new Error('deactivatedAt must be populated');

    // Step H: Verify earnings ledger access on former member (Admin allowed, Peer blocked)
    const peerViewEarningsRes = await req('GET', `/api/users/${offboardTestId}/earnings`, peerDevSession.token);
    console.log(`   -> Peer viewing former member earnings ledger: HTTP ${peerViewEarningsRes.status} (Expected 403)`);
    if (peerViewEarningsRes.status !== 403) throw new Error('Peer should be blocked from former member earnings');

    const adminViewEarningsRes = await req('GET', `/api/users/${offboardTestId}/earnings`, adminSession.token);
    console.log(`   -> Admin viewing former member earnings ledger: HTTP ${adminViewEarningsRes.status} (Expected 200)`);
    if (adminViewEarningsRes.status !== 200) throw new Error('Admin should be able to view former member earnings');

    console.log('   ✓ TEST 6 PASSED: Real-time session invalidation, login lockout, wallet freeze, and profile read-only verified via live Step 05 killswitch\n');

    // -------------------------------------------------------------------------
    // TEST 7: Active User Profile Self-Editing (PATCH /api/users/me/profile)
    // -------------------------------------------------------------------------
    console.log('[TEST 7] Active user profile self-editing (PATCH /api/users/me/profile)...');
    const updatedBioText = 'Pioneering neural-mesh architecture and zero-gravity UX.';
    const editRes = await req('PATCH', '/api/users/me/profile', researcherSession.token, {
      bio: updatedBioText
    });
    console.log(`   -> Profile edit HTTP Status: ${editRes.status}`);
    console.log(`   -> Message: "${editRes.data.message}"`);

    if (editRes.status !== 200) {
      throw new Error(`Profile edit failed: HTTP ${editRes.status} ${JSON.stringify(editRes.data)}`);
    }

    // Direct database check
    const dbBio = queryOne('SELECT bio FROM users WHERE id = ?', [researcherId])?.bio;
    console.log(`   ✓ Database bio verification: "${dbBio}"`);
    if (dbBio !== updatedBioText) throw new Error('Updated bio was not saved in DB!');
    console.log('   ✓ TEST 7 PASSED: Self-profile editing functions and persists cleanly\n');

    // -------------------------------------------------------------------------
    // TEST 8: Static UI Route Availability (/profile.html)
    // -------------------------------------------------------------------------
    console.log('[TEST 8] Static UI Route Availability (/profile.html)...');
    const staticRes = await fetch(`${BASE_URL}/profile.html`);
    console.log(`   -> GET /profile.html HTTP Status: ${staticRes.status}`);
    if (staticRes.status !== 200) {
      throw new Error(`Expected HTTP 200 for /profile.html, got ${staticRes.status}`);
    }
    const htmlText = await staticRes.text();
    if (!htmlText.includes('MEMBER PORTFOLIO') || !htmlText.includes('tabBtnEarnings')) {
      throw new Error('profile.html content missing critical layout elements');
    }
    console.log('   ✓ TEST 8 PASSED: /profile.html serves complete HTML structure\n');

    console.log('===================================================================');
    console.log('   ALL 8 CHECKS OF STEP 09 (USER PROFILE) FULLY VERIFIED & PASSED');
    console.log('===================================================================');

  } finally {
    try {
      if (wss) {
        for (const client of wss.clients) {
          try { client.terminate(); } catch {}
        }
        wss.close();
      }
    } catch {}
    await new Promise((resolve) => server.close(resolve));
    console.log('\n[TEARDOWN] Test server closed cleanly.');
  }
}

runStep09ProfileTests().catch(err => {
  console.error('\n❌ STEP 09 PROFILE TEST SUITE FAILED:', err);
  process.exit(1);
});
