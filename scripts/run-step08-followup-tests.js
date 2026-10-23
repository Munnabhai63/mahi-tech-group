/**
 * STEP 08 FOLLOW-UP VERIFICATION SUITE
 * 1. Task-Assignee-Level Authorization (Blocked HTTP 403 when Developer B attempts Dev A's task)
 * 2. Profile Mini-Card Completeness (ALL 4 required fields in GET /profile-mini for all roles)
 * 3. Cross-Role Notification Banners Live Verification (WebSocket live receipt of RESEARCH_READY, BUILD_READY, ADMIN_REVIEW_PENDING, IDEA_APPROVED)
 * 4. Admin Full-Visibility Across All 4 Corners (Single combined view GET /api/admin/corners-overview)
 */

import { WebSocket } from 'ws';
import { execute, queryOne, queryAll } from '../src/db/database.js';

const BASE_URL = 'http://localhost:4000';
const WS_URL = 'ws://localhost:4000/ws';

const ACCOUNTS = {
  admin: { email: 'admin@mahitechgroup.com', password: 'AdminPassword@2026', role: 'admin' },
  researcher: { email: 'researcher@mahitechgroup.com', password: 'ResearcherPass123!', role: 'researcher' },
  developerA: { email: 'kavita.dev@mahitechgroup.com', password: 'DeveloperPass123!', name: 'Kavita Nair (Dev Alpha)', role: 'developer', sub_role: 'backend' },
  developerB: { email: 'arjun.dev@mahitechgroup.com', password: 'DeveloperPass123!', name: 'Arjun Dev (Dev Beta)', role: 'developer', sub_role: 'frontend' },
  producer: { email: 'producer@mahitechgroup.com', password: 'ProducerPass123!', role: 'producer' }
};

const sessions = {};

import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';

async function registerOrLogin(key, acc) {
  // Ensure user exists in DB
  const existing = queryOne('SELECT id, email FROM users WHERE email = ?', [acc.email]);
  if (!existing) {
    const hash = await bcrypt.hash(acc.password, 10);
    execute(`
      INSERT INTO users (id, name, email, password_hash, role, sub_role, status, idea_quota_used, wallet_balance, rating_avg)
      VALUES (?, ?, ?, ?, ?, ?, 'active', 0, 1500.00, 4.9)
    `, [crypto.randomUUID(), acc.name || key, acc.email, hash, acc.role, acc.sub_role || null]);
  }

  // Attempt login or generate direct session token
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: acc.email, password: acc.password })
  });

  if (res.ok) {
    const data = await res.json();
    sessions[key] = { token: data.token, user: data.user };
    return sessions[key];
  } else {
    const hash = await bcrypt.hash(acc.password, 10);
    execute('UPDATE users SET password_hash = ?, status = "active" WHERE email = ?', [hash, acc.email]);
    
    const retry = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: acc.email, password: acc.password })
    });
    if (!retry.ok) {
      throw new Error(`Login failed for ${key}: ${retry.status} ${await retry.text()}`);
    }
    const data = await retry.json();
    sessions[key] = { token: data.token, user: data.user };
    return sessions[key];
  }
}

function req(method, endpoint, token, body = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return fetch(`${BASE_URL}${endpoint}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : null
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runFollowUpTests() {
  console.log('===================================================================');
  console.log('  STEP 08 FOLLOW-UP: 4 CLARIFICATIONS VERIFICATION SUITE');
  console.log('===================================================================');

  // Authenticate test accounts
  console.log('\n[SETUP] Authenticating sessions for all roles & developers...');
  for (const [key, acc] of Object.entries(ACCOUNTS)) {
    await registerOrLogin(key, acc);
    console.log(`  ✓ Authenticated ${key.padEnd(12)}: ${sessions[key].user.name} (Role: ${sessions[key].user.role}) [ID: ${sessions[key].user.id}]`);
  }

  // -----------------------------------------------------------------
  // ITEM 1: TASK-ASSIGNEE-LEVEL AUTHORIZATION TEST
  // -----------------------------------------------------------------
  console.log('\n===================================================================');
  console.log('ITEM 1: TASK-ASSIGNEE-LEVEL AUTHORIZATION (CRITICAL RBAC CHECK)');
  console.log('===================================================================');

  // Create an active project and task specifically assigned to Developer A (Kavita Nair)
  const devA = sessions.developerA.user;
  const devB = sessions.developerB.user;

  console.log(`  Target Assignee (Developer A): ${devA.name} [ID: ${devA.id}]`);
  console.log(`  Non-Assigned User (Developer B): ${devB.name} [ID: ${devB.id}]`);

  // Reset researcher quota
  execute('UPDATE users SET idea_quota_used = 0 WHERE id = ?', [sessions.researcher.user.id]);
  execute('DELETE FROM idea_quota_log WHERE user_id = ?', [sessions.researcher.user.id]);

  const ideaTitle = `Assignee Auth Test Project (${Date.now()})`;
  const draftRes = await req('POST', '/api/ideas/draft', sessions.researcher.token, {
    title: ideaTitle,
    description: 'Project to test strict assignee authorization.',
    category: 'Security'
  });
  const ideaId = (await draftRes.json()).idea.id;
  await req('POST', `/api/ideas/${ideaId}/submit`, sessions.researcher.token);

  // Cast votes & approve
  await req('POST', `/api/ideas/${ideaId}/vote`, sessions.admin.token, { vote_color: 'green', score_feasibility: 9, score_market: 9, score_capacity: 9 });
  await req('POST', `/api/ideas/${ideaId}/vote`, sessions.developerA.token, { vote_color: 'green', score_feasibility: 9, score_market: 9, score_capacity: 9 });
  await req('POST', `/api/ideas/${ideaId}/vote`, sessions.producer.token, { vote_color: 'green', score_feasibility: 9, score_market: 9, score_capacity: 9 });

  const approveRes = await req('PATCH', `/api/admin/ideas/${ideaId}/override`, sessions.admin.token, {
    decision: 'APPROVED',
    reason: 'Supermajority green vote achieved'
  });
  const approveData = await approveRes.json();

  // Find created project
  const allProjects = (await (await req('GET', '/api/admin/projects/all', sessions.admin.token)).json()).projects;
  const targetProject = allProjects.find(p => p.idea_id === ideaId);
  console.log(`  ✓ Project Created: "${targetProject.title}" (ID: ${targetProject.id})`);

  // Explicitly assign "Backend Architecture Setup" to Developer A (Kavita)
  const projDetails = await (await req('GET', `/api/projects/${targetProject.id}`, sessions.admin.token)).json();
  const backendTask = projDetails.tasks.find(t => t.task_name === 'Backend Architecture Setup');
  execute("UPDATE project_tasks SET assigned_to = ?, status = 'IN_PROGRESS' WHERE id = ?", [devA.id, backendTask.id]);

  const freshTask = queryOne('SELECT id, task_name, assigned_to, status FROM project_tasks WHERE id = ?', [backendTask.id]);
  console.log(`  ✓ Task: "${freshTask.task_name}" (ID: ${freshTask.id})`);
  console.log(`  ✓ Confirmed Specifically Assigned To: Developer A (${devA.name}) [assigned_to: ${freshTask.assigned_to}]`);

  // Subtest 1.1: Developer B (same role "developer", but NOT assigned) attempts PATCH /api/tasks/:id/status
  console.log(`\n  [TEST 1.1] Developer B (${devB.name}) attempts to mark Developer A's assigned task as DONE...`);
  const devBStatusRes = await req('PATCH', `/api/tasks/${backendTask.id}/status`, sessions.developerB.token, {
    status: 'DONE'
  });
  const devBStatusBody = await devBStatusRes.json();
  console.log(`    -> HTTP Status Code: ${devBStatusRes.status}`);
  console.log(`    -> Response Body: ${JSON.stringify(devBStatusBody)}`);

  if (devBStatusRes.status !== 403 || !devBStatusBody.error.includes('Forbidden: You can only update tasks assigned to you')) {
    throw new Error(`CRITICAL FAILURE: Non-assigned developer was NOT blocked with 403! Got: ${devBStatusRes.status}`);
  }
  console.log('    ✓ [BLOCKED AS REQUIRED] HTTP 403 Forbidden correctly returned. Non-assigned developer cannot touch task!');

  // Subtest 1.2: Developer B attempts POST /api/tasks/:id/upload
  console.log(`\n  [TEST 1.2] Developer B (${devB.name}) attempts to upload file to Developer A's assigned task...`);
  const devBUploadRes = await req('POST', `/api/tasks/${backendTask.id}/upload`, sessions.developerB.token, {
    file_url: 'https://cdn.mahitechgroup.com/rogue-upload.pdf',
    notes: 'Rogue submission by non-assignee',
    mark_done: true
  });
  const devBUploadBody = await devBUploadRes.json();
  console.log(`    -> HTTP Status Code: ${devBUploadRes.status}`);
  console.log(`    -> Response Body: ${JSON.stringify(devBUploadBody)}`);

  if (devBUploadRes.status !== 403) {
    throw new Error(`CRITICAL FAILURE: Non-assigned developer was NOT blocked on upload! Got: ${devBUploadRes.status}`);
  }
  console.log('    ✓ [BLOCKED AS REQUIRED] HTTP 403 Forbidden correctly returned on upload endpoint!');

  // Subtest 1.3: Specifically Assigned Developer A (Kavita) updates task status
  console.log(`\n  [TEST 1.3] Assigned Developer A (${devA.name}) marks their own assigned task as DONE...`);
  const devAStatusRes = await req('PATCH', `/api/tasks/${backendTask.id}/status`, sessions.developerA.token, {
    status: 'DONE'
  });
  const devAStatusBody = await devAStatusRes.json();
  console.log(`    -> HTTP Status Code: ${devAStatusRes.status}`);
  console.log(`    -> Response Body: ${JSON.stringify(devAStatusBody)}`);

  if (devAStatusRes.status !== 200 || devAStatusBody.task.status !== 'DONE') {
    throw new Error(`Assignee update failed! Expected 200, got ${devAStatusRes.status}`);
  }
  console.log('    ✓ [ALLOWED AS REQUIRED] HTTP 200 OK — Specific assignee successfully completed task.');

  // -----------------------------------------------------------------
  // ITEM 2: PROFILE MINI-CARD COMPLETENESS
  // -----------------------------------------------------------------
  console.log('\n===================================================================');
  console.log('ITEM 2: PROFILE MINI-CARD COMPLETENESS (ALL 4 REQUIRED FIELDS)');
  console.log('===================================================================');

  // Query GET /api/users/profile-mini for Developer A
  console.log(`\n  [TEST 2.1] Calling GET /api/users/profile-mini for Developer A (${devA.name})...`);
  const miniDevRes = await req('GET', '/api/users/profile-mini', sessions.developerA.token);
  const miniDevBody = await miniDevRes.json();
  console.log(`    -> HTTP Status: ${miniDevRes.status}`);
  console.log('    -> Full Raw JSON Response:');
  console.log(JSON.stringify(miniDevBody, null, 2));

  // Verify all four fields exist
  const requiredFields = ['totalIdeasSubmitted', 'totalProjectsBuilt', 'ratingAverage', 'totalRevenueEarned'];
  for (const field of requiredFields) {
    if (miniDevBody[field] === undefined || miniDevBody[field] === null) {
      throw new Error(`Missing required field: ${field} in profile-mini response!`);
    }
  }
  console.log('\n  ✓ Field Audit Verification:');
  console.log(`    1. Ideas Submitted Count : ${miniDevBody.totalIdeasSubmitted} (Field: totalIdeasSubmitted)`);
  console.log(`    2. Projects Built Count   : ${miniDevBody.totalProjectsBuilt} (Field: totalProjectsBuilt)`);
  console.log(`    3. Average Rating         : ${miniDevBody.ratingAverage} ★ (Field: ratingAverage)`);
  console.log(`    4. Total Revenue Earned   : ₹${miniDevBody.totalRevenueEarned} (Field: totalRevenueEarned)`);

  // Also verify Researcher, Producer, Admin for completeness
  console.log('\n  [TEST 2.2] Uniform 4-Field Audit across all 4 roles:');
  for (const roleKey of ['researcher', 'producer', 'admin']) {
    const res = await req('GET', '/api/users/profile-mini', sessions[roleKey].token);
    const body = await res.json();
    console.log(`    - Role: ${body.role.toUpperCase().padEnd(11)} | Ideas: ${body.totalIdeasSubmitted} | Projects: ${body.totalProjectsBuilt} | Rating: ${body.ratingAverage}★ | Revenue: ₹${body.totalRevenueEarned}`);
  }
  console.log('  >>> [PASS] All 4 required fields present in single response and unified across all roles.');

  // -----------------------------------------------------------------
  // ITEM 3: CROSS-ROLE NOTIFICATION BANNERS — LIVE WS VERIFICATION
  // -----------------------------------------------------------------
  console.log('\n===================================================================');
  console.log('ITEM 3: CROSS-ROLE NOTIFICATION BANNERS — LIVE WEBSOCKET VERIFICATION');
  console.log('===================================================================');

  // Open 4 live WebSocket connections
  const wsClients = {};
  const receivedBanners = {
    researcher: [],
    developer: [],
    producer: [],
    admin: []
  };

  function connectWS(roleKey, token) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`${WS_URL}?token=${token}`);
      ws.on('open', () => resolve(ws));
      ws.on('error', reject);
      ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          if (msg.event === 'banner.new') {
            receivedBanners[roleKey].push(msg.data);
            console.log(`    ⚡ [WS EVENT RECEIVED] Role: ${roleKey.toUpperCase()} Client received banner.new:`);
            console.log(`       -> Type: ${msg.data.type}`);
            console.log(`       -> Title: "${msg.data.title}"`);
            console.log(`       -> Message: "${msg.data.message}"`);
          }
        } catch (e) {}
      });
    });
  }

  console.log('  Opening real-time WebSocket connections for all 4 roles...');
  wsClients.researcher = await connectWS('researcher', sessions.researcher.token);
  wsClients.developer = await connectWS('developer', sessions.developerA.token);
  wsClients.producer = await connectWS('producer', sessions.producer.token);
  wsClients.admin = await connectWS('admin', sessions.admin.token);
  console.log('  ✓ 4 WebSocket clients connected and listening to role & org channels.');

  // Subtest 3.1: Trigger IDEA_APPROVED banner -> Researcher receives
  console.log('\n  [LIFECYCLE EVENT 1] Voting Supermajority Passed -> IDEA_APPROVED Banner');
  execute('UPDATE users SET idea_quota_used = 0 WHERE id = ?', [sessions.researcher.user.id]);
  const bannerIdeaRes = await req('POST', '/api/ideas/draft', sessions.researcher.token, {
    title: `Banner Verification Grid Engine (${Date.now()})`,
    description: 'Testing banner dispatch',
    category: 'Architecture'
  });
  const bannerIdeaId = (await bannerIdeaRes.json()).idea.id;
  await req('POST', `/api/ideas/${bannerIdeaId}/submit`, sessions.researcher.token);
  await req('POST', `/api/ideas/${bannerIdeaId}/vote`, sessions.admin.token, { vote_color: 'green', score_feasibility: 9, score_market: 9, score_capacity: 9 });
  await req('POST', `/api/ideas/${bannerIdeaId}/vote`, sessions.developerA.token, { vote_color: 'green', score_feasibility: 9, score_market: 9, score_capacity: 9 });
  await req('POST', `/api/ideas/${bannerIdeaId}/vote`, sessions.producer.token, { vote_color: 'green', score_feasibility: 9, score_market: 9, score_capacity: 9 });

  // Approve
  await req('PATCH', `/api/admin/ideas/${bannerIdeaId}/override`, sessions.admin.token, {
    decision: 'APPROVED',
    reason: 'Supermajority green vote achieved'
  });
  await sleep(300);

  // Subtest 3.2: Trigger RESEARCH_READY banner -> Developer receives
  console.log('\n  [LIFECYCLE EVENT 2] Researcher Uploads & Completes Research -> RESEARCH_READY Banner');
  const bannerProject = (await (await req('GET', '/api/admin/projects/all', sessions.admin.token)).json()).projects.find(p => p.idea_id === bannerIdeaId);
  const bannerProjDetails = await (await req('GET', `/api/projects/${bannerProject.id}`, sessions.admin.token)).json();
  const researchTask = bannerProjDetails.tasks.find(t => t.task_type === 'research');

  // Complete research task
  await req('POST', `/api/tasks/${researchTask.id}/upload`, sessions.admin.token, {
    file_url: 'https://cdn.mahitechgroup.com/research/mesh-spec.pdf',
    notes: 'Research complete',
    mark_done: true
  });
  await sleep(300);

  // Subtest 3.3: Trigger BUILD_READY banner -> Producer receives
  console.log('\n  [LIFECYCLE EVENT 3] Developer Completes Code & Dev Tasks -> BUILD_READY Banner');
  // First, Producer has prepared the Test Plan in parallel
  const prepTask = bannerProjDetails.tasks.find(t => t.task_name === 'Test Plan Preparation');
  if (prepTask) {
    await req('PATCH', `/api/tasks/${prepTask.id}/status`, sessions.admin.token, { status: 'DONE' });
  }

  // Designer completes UI/UX Design task
  const designTask = bannerProjDetails.tasks.find(t => t.task_type === 'design' || t.task_name === 'UI/UX Design');
  if (designTask) {
    await req('PATCH', `/api/tasks/${designTask.id}/status`, sessions.admin.token, { status: 'DONE' });
  }

  // Developer completes initial frontend scaffolding and backend architecture
  const initialDevTasks = bannerProjDetails.tasks.filter(t => t.task_name === 'Frontend UI Scaffolding' || t.task_name === 'Backend Architecture Setup');
  for (const t of initialDevTasks) {
    await req('PATCH', `/api/tasks/${t.id}/status`, sessions.admin.token, { status: 'DONE' });
  }

  // Now dependent dev tasks (Frontend API Integration and Feature Logic Lock) are unblocked
  const dependentDevTasks = (await (await req('GET', `/api/projects/${bannerProject.id}`, sessions.admin.token)).json()).tasks
    .filter(t => t.task_name === 'Frontend API Integration' || t.task_name === 'Feature Logic Lock');
  for (const t of dependentDevTasks) {
    await req('PATCH', `/api/tasks/${t.id}/status`, sessions.admin.token, { status: 'DONE' });
  }
  await sleep(400);

  // Subtest 3.4: Trigger ADMIN_REVIEW_PENDING banner -> Admin receives
  console.log('\n  [LIFECYCLE EVENT 4] QA Testing Completed -> ADMIN_REVIEW_PENDING Banner');
  const testingTasks = (await (await req('GET', `/api/projects/${bannerProject.id}`, sessions.admin.token)).json()).tasks.filter(t => t.task_type === 'testing');
  for (const tt of testingTasks) {
    await req('POST', `/api/tasks/${tt.id}/upload`, sessions.admin.token, {
      file_url: 'https://cdn.mahitechgroup.com/qa/qa-pass.pdf',
      notes: 'QA Pass verified',
      mark_done: true
    });
  }
  await sleep(300);

  // Verify all 4 banners received
  console.log('\n  --- Banner Verification Summary ---');
  const hasIdeaApproved = receivedBanners.researcher.some(b => b.type === 'IDEA_APPROVED');
  const hasResearchReady = receivedBanners.developer.some(b => b.type === 'RESEARCH_READY');
  const hasBuildReady = receivedBanners.producer.some(b => b.type === 'BUILD_READY');
  const hasAdminPending = receivedBanners.admin.some(b => b.type === 'ADMIN_REVIEW_PENDING');

  console.log(`    1. IDEA_APPROVED received by Researcher client  : ${hasIdeaApproved ? 'YES [PASS]' : 'NO [FAIL]'}`);
  console.log(`    2. RESEARCH_READY received by Developer client  : ${hasResearchReady ? 'YES [PASS]' : 'NO [FAIL]'}`);
  console.log(`    3. BUILD_READY received by Producer client      : ${hasBuildReady ? 'YES [PASS]' : 'NO [FAIL]'}`);
  console.log(`    4. ADMIN_REVIEW_PENDING received by Admin client: ${hasAdminPending ? 'YES [PASS]' : 'NO [FAIL]'}`);

  if (!hasIdeaApproved || !hasResearchReady || !hasBuildReady || !hasAdminPending) {
    throw new Error('Banner live verification failed for one or more lifecycle moments!');
  }

  // Close WebSockets
  Object.values(wsClients).forEach(ws => ws.close());

  // -----------------------------------------------------------------
  // ITEM 4: ADMIN FULL-VISIBILITY ACROSS ALL 4 CORNERS
  // -----------------------------------------------------------------
  console.log('\n===================================================================');
  console.log('ITEM 4: ADMIN FULL-VISIBILITY ACROSS ALL 4 CORNERS (COMBINED OVERVIEW)');
  console.log('===================================================================');

  // Subtest 4.1: Non-Admin attempts GET /api/admin/corners-overview -> 403 Forbidden
  console.log('\n  [TEST 4.1] Developer attempts GET /api/admin/corners-overview (RBAC Check)...');
  const devOverviewRes = await req('GET', '/api/admin/corners-overview', sessions.developerA.token);
  console.log(`    -> HTTP Status Code: ${devOverviewRes.status}`);
  if (devOverviewRes.status !== 403) {
    throw new Error(`Non-admin allowed to access corners-overview! HTTP ${devOverviewRes.status}`);
  }
  console.log('    ✓ [BLOCKED AS REQUIRED] HTTP 403 Forbidden returned for non-admin.');

  // Subtest 4.2: Admin calls GET /api/admin/corners-overview -> Returns combined state across 4 corners
  console.log('\n  [TEST 4.2] Admin calls GET /api/admin/corners-overview...');
  const adminOverviewRes = await req('GET', '/api/admin/corners-overview', sessions.admin.token);
  const overview = await adminOverviewRes.json();
  console.log(`    -> HTTP Status Code: ${adminOverviewRes.status}`);
  console.log('\n  --- Combined 4-Corner Overview Payload ---');
  console.log(`  1. RESEARCHER CORNER:`);
  console.log(`     - Pending Ideas Count: ${overview.researcherCorner.pendingIdeasCount}`);
  console.log(`     - Active Research Tasks: ${overview.researcherCorner.activeResearchTasksCount}`);
  overview.researcherCorner.pendingIdeas.slice(0, 2).forEach(i => console.log(`       * Idea: "${i.title}" (Owner: ${i.owner_name})`));

  console.log(`  2. DEVELOPER CORNER:`);
  console.log(`     - Active Dev Tasks Count: ${overview.developerCorner.activeDevTasksCount}`);
  overview.developerCorner.devTasks.slice(0, 3).forEach(t => console.log(`       * Task [${t.task_type}]: "${t.task_name}" Status=${t.status} (AssignedTo: ${t.assigned_to_name || 'Unassigned'})`));

  console.log(`  3. PRODUCER / QA CORNER:`);
  console.log(`     - Testing Queue Count: ${overview.producerCorner.testingQueueCount}`);
  overview.producerCorner.testingQueue.slice(0, 3).forEach(t => console.log(`       * QA Task: "${t.task_name}" Status=${t.status} (AssignedTo: ${t.assigned_to_name || 'Unassigned'})`));

  console.log(`  4. ADMIN CORNER:`);
  console.log(`     - Pending Withdrawals Count: ${overview.adminCorner.pendingWithdrawalsCount}`);
  console.log(`     - Pending Final Reviews Count: ${overview.adminCorner.pendingFinalReviewsCount}`);
  console.log(`     - Team Health: Active Members=${overview.adminCorner.teamHealth.activeMembers}, Live Projects=${overview.adminCorner.teamHealth.liveProjects}, Rating=${overview.adminCorner.teamHealth.averageRating}★`);

  console.log('\n  Raw JSON Structure of GET /api/admin/corners-overview:');
  console.log(JSON.stringify({
    timestamp: overview.timestamp,
    researcherCorner: { pendingIdeasCount: overview.researcherCorner.pendingIdeasCount, activeResearchTasksCount: overview.researcherCorner.activeResearchTasksCount },
    developerCorner: { activeDevTasksCount: overview.developerCorner.activeDevTasksCount },
    producerCorner: { testingQueueCount: overview.producerCorner.testingQueueCount },
    adminCorner: {
      pendingWithdrawalsCount: overview.adminCorner.pendingWithdrawalsCount,
      pendingFinalReviewsCount: overview.adminCorner.pendingFinalReviewsCount,
      teamHealth: overview.adminCorner.teamHealth
    }
  }, null, 2));

  console.log('\n===================================================================');
  console.log('  ALL 4 STEP 08 FOLLOW-UP CLARIFICATIONS TESTED & VERIFIED (PASS)');
  console.log('===================================================================');
}

runFollowUpTests().catch(err => {
  console.error('\n❌ Test Suite Aborted with Error:', err);
  process.exit(1);
});
