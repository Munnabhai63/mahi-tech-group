import http from 'node:http';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { createApp } from '../src/app.js';
import { runMigration } from '../src/db/migrate.js';
import { runSeed } from '../src/db/seed.js';
import { queryOne, queryAll, execute, getDatabase } from '../src/db/database.js';
import { config } from '../src/config.js';

console.log('===================================================================');
console.log('  PRD 15 — LAYER 3 API ROUTES HTTP INTEGRATION VERIFICATION');
console.log('===================================================================');

// Ensure DB ready
runMigration();
await runSeed();

const app = createApp();
const server = http.createServer(app);

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();
const BASE_URL = `http://127.0.0.1:${port}`;
console.log(`[TEST SERVER] Running on ${BASE_URL}\n`);

let passedCount = 0;
let totalCount = 0;

function assert(condition, message, status = null) {
  totalCount++;
  const statusStr = status !== null ? ` (HTTP ${status})` : '';
  if (condition) {
    console.log(`  ✅ PASS${statusStr}: ${message}`);
    passedCount++;
  } else {
    console.error(`  ❌ FAIL${statusStr}: ${message}`);
    server.close();
    process.exit(1);
  }
}

// Helper to log in users with known test passwords
async function loginUser(email, plainPassword) {
  const pHash = await bcrypt.hash(plainPassword, config.BCRYPT_SALT_ROUNDS);
  execute('UPDATE users SET password_hash = ?, status = ? WHERE email = ?', [pHash, 'active', email]);

  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: plainPassword })
  });
  const data = await res.json();
  if (res.status !== 200 || !data.token) {
    throw new Error(`Failed to log in as ${email}: ${JSON.stringify(data)}`);
  }
  return { token: data.token, user: data.user || queryOne('SELECT * FROM users WHERE email = ?', [email]) };
}

try {
  // 1. Authenticate users
  console.log('--- 1. Authenticating Test Personas ---');
  const adminAuth = await loginUser('admin@mahitechgroup.com', 'AdminPassword@2026');
  const researcherAuth = await loginUser('researcher@mahitechgroup.com', 'ResearcherPass123!');
  const designerAuth = await loginUser('designer@mahitechgroup.com', 'DesignerPass123!');
  const devAuth = await loginUser('developer@mahitechgroup.com', 'DeveloperPass123!');
  const testerAuth = await loginUser('producer@mahitechgroup.com', 'ProducerPass123!');
  console.log('  Tokens acquired for Admin, Researcher, Designer, Developer, Tester.');

  // 2. Setup test project
  const testProjectId = 'proj_l3_' + Date.now();
  let idea = queryOne('SELECT id FROM ideas LIMIT 1;');
  if (!idea) {
    const ideaId = crypto.randomUUID();
    execute("INSERT INTO ideas (id, owner_id, title, description, status) VALUES (?, ?, 'Idea L3', 'desc', 'APPROVED')", [ideaId, adminAuth.user.id]);
    idea = { id: ideaId };
  }
  execute(`
    INSERT INTO projects (id, idea_id, title, owner_id, current_stage, status)
    VALUES (?, ?, 'PRD 15 Layer 3 Test Project', ?, 'RESEARCH_DEV_PARALLEL', 'ACTIVE')
  `, [testProjectId, idea.id, adminAuth.user.id]);

  // Add members to project
  const members = [
    { user: researcherAuth.user, role: 'researcher' },
    { user: designerAuth.user, role: 'designer' },
    { user: devAuth.user, role: 'frontend_dev' },
    { user: testerAuth.user, role: 'producer' },
    { user: adminAuth.user, role: 'admin_reviewer' }
  ];
  for (const m of members) {
    execute(`
      INSERT OR IGNORE INTO project_members (id, project_id, user_id, role_in_project)
      VALUES (?, ?, ?, ?)
    `, [crypto.randomUUID(), testProjectId, m.user.id, m.role]);
  }
  console.log(`  Project ${testProjectId} configured with 5 members.`);

  // TEST 1: POST /api/pipeline/deliverables — 403 if non-Lead/Admin
  console.log('\n--- TEST 1: POST /api/pipeline/deliverables (403 for non-Lead/Admin) ---');
  const nonAdminDelivRes = await fetch(`${BASE_URL}/api/pipeline/deliverables`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${devAuth.token}`
    },
    body: JSON.stringify({
      project_id: testProjectId,
      title: 'Dev Unauthorized Deliverable'
    })
  });
  const nonAdminDelivData = await nonAdminDelivRes.json();
  assert(nonAdminDelivRes.status === 403, 'POST /api/pipeline/deliverables returns 403 for developer', nonAdminDelivRes.status);
  assert(nonAdminDelivData.error.includes('Lead or Admin'), 'Error message specifies Lead or Admin role required');

  // TEST 2: POST /api/pipeline/deliverables — success (201)
  console.log('\n--- TEST 2: POST /api/pipeline/deliverables (201 success) ---');
  const createDelivRes = await fetch(`${BASE_URL}/api/pipeline/deliverables`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminAuth.token}`
    },
    body: JSON.stringify({
      project_id: testProjectId,
      title: 'Core Authentication Module',
      description: 'JWT Auth and RBAC Deliverable'
    })
  });
  const createDelivData = await createDelivRes.json();
  assert(createDelivRes.status === 201, 'POST /api/pipeline/deliverables returns 201', createDelivRes.status);
  assert(createDelivData && createDelivData.id, 'Created deliverable has valid ID');
  assert(createDelivData.current_stage === 'RESEARCH', 'Created deliverable initial stage is RESEARCH');
  const delivId = createDelivData.id;

  // TEST 3: GET /api/pipeline/deliverables/:project_id — success (200)
  console.log('\n--- TEST 3: GET /api/pipeline/deliverables/:project_id (200 success) ---');
  const listDelivRes = await fetch(`${BASE_URL}/api/pipeline/deliverables/${testProjectId}`, {
    headers: { 'Authorization': `Bearer ${researcherAuth.token}` }
  });
  const listDelivData = await listDelivRes.json();
  assert(listDelivRes.status === 200, 'GET /api/pipeline/deliverables/:project_id returns 200', listDelivRes.status);
  assert(Array.isArray(listDelivData) && listDelivData.length >= 1, 'Returns array of deliverables');
  assert(listDelivData[0].summary && typeof listDelivData[0].summary.RESEARCH === 'number', 'Contains computed stage % summary');

  // TEST 4: GET /api/pipeline/deliverables/:id/detail — success (200)
  console.log('\n--- TEST 4: GET /api/pipeline/deliverables/:id/detail (200 success) ---');
  const detailRes = await fetch(`${BASE_URL}/api/pipeline/deliverables/${delivId}/detail`, {
    headers: { 'Authorization': `Bearer ${designerAuth.token}` }
  });
  const detailData = await detailRes.json();
  assert(detailRes.status === 200, 'GET /api/pipeline/deliverables/:id/detail returns 200', detailRes.status);
  assert(detailData.deliverable && detailData.deliverable.id === delivId, 'Returns complete deliverable details');
  assert(detailData.stages && detailData.stages.RESEARCH, 'Contains stages tree');

  // TEST 5: POST /api/pipeline/deliverables/:id/points — 400 invalid stage
  console.log('\n--- TEST 5: POST /api/pipeline/deliverables/:id/points (400 invalid stage) ---');
  const badPointRes = await fetch(`${BASE_URL}/api/pipeline/deliverables/${delivId}/points`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminAuth.token}`
    },
    body: JSON.stringify({
      stage: 'INVALID_STAGE',
      point_title: 'Bad Stage Point',
      weight: 5
    })
  });
  const badPointData = await badPointRes.json();
  assert(badPointRes.status === 400, 'POST /api/pipeline/deliverables/:id/points returns 400 for invalid stage', badPointRes.status);
  assert(badPointData.error.includes('Invalid stage'), 'Error indicates invalid stage');

  // TEST 6: POST /api/pipeline/deliverables/:id/points — success (201)
  console.log('\n--- TEST 6: POST /api/pipeline/deliverables/:id/points (201 success) ---');
  const addPointRes = await fetch(`${BASE_URL}/api/pipeline/deliverables/${delivId}/points`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminAuth.token}`
    },
    body: JSON.stringify({
      stage: 'RESEARCH',
      point_title: 'Competitor Auth Analysis',
      point_description: 'Analyze Auth0 and Firebase',
      weight: 5
    })
  });
  const addPointData = await addPointRes.json();
  assert(addPointRes.status === 201, 'POST /api/pipeline/deliverables/:id/points returns 201', addPointRes.status);
  assert(addPointData.stage === 'RESEARCH', 'Point stage is RESEARCH');
  assert(addPointData.status === 'UNCLAIMED', 'Point status is UNCLAIMED');
  const ptId = addPointData.id;

  // TEST 7: PATCH /api/pipeline/points/:id/claim — 403 role mismatch
  console.log('\n--- TEST 7: PATCH /api/pipeline/points/:id/claim (403 role mismatch) ---');
  const mismatchClaimRes = await fetch(`${BASE_URL}/api/pipeline/points/${ptId}/claim`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${devAuth.token}`
    }
  });
  const mismatchClaimData = await mismatchClaimRes.json();
  assert(mismatchClaimRes.status === 403, 'PATCH /api/pipeline/points/:id/claim returns 403 for Developer on Research point', mismatchClaimRes.status);
  assert(mismatchClaimData.error.includes('Role mismatch'), 'Error message specifies role mismatch');

  // TEST 8: PATCH /api/pipeline/points/:id/claim — success (200)
  console.log('\n--- TEST 8: PATCH /api/pipeline/points/:id/claim (200 success) ---');
  const claimRes = await fetch(`${BASE_URL}/api/pipeline/points/${ptId}/claim`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${researcherAuth.token}`
    }
  });
  const claimData = await claimRes.json();
  assert(claimRes.status === 200, 'PATCH /api/pipeline/points/:id/claim returns 200 for Researcher', claimRes.status);
  assert(claimData.status === 'CLAIMED', 'Point status is CLAIMED');
  assert(claimData.assigned_to === researcherAuth.user.id, 'Point assigned to Researcher');

  // TEST 9: PATCH /api/pipeline/points/:id/start — success (200)
  console.log('\n--- TEST 9: PATCH /api/pipeline/points/:id/start (200 success) ---');
  const startRes = await fetch(`${BASE_URL}/api/pipeline/points/${ptId}/start`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${researcherAuth.token}`
    }
  });
  const startData = await startRes.json();
  assert(startRes.status === 200, 'PATCH /api/pipeline/points/:id/start returns 200', startRes.status);
  assert(startData.status === 'IN_PROGRESS', 'Point status is IN_PROGRESS');

  // TEST 10: PATCH /api/pipeline/points/:id/submit — success (200)
  console.log('\n--- TEST 10: PATCH /api/pipeline/points/:id/submit (200 success) ---');
  const submitRes = await fetch(`${BASE_URL}/api/pipeline/points/${ptId}/submit`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${researcherAuth.token}`
    },
    body: JSON.stringify({
      asset_url: 'https://docs.mahi.com/research-summary.pdf',
      tool_link: 'https://miro.com/board/123',
      notes: 'Research completed'
    })
  });
  const submitData = await submitRes.json();
  assert(submitRes.status === 200, 'PATCH /api/pipeline/points/:id/submit returns 200', submitRes.status);
  assert(submitData.status === 'SUBMITTED', 'Point status is SUBMITTED');
  assert(submitData.asset_url === 'https://docs.mahi.com/research-summary.pdf', 'asset_url persisted');

  // TEST 11: PATCH /api/pipeline/points/:id/revision — success (200)
  console.log('\n--- TEST 11: PATCH /api/pipeline/points/:id/revision (200 success) ---');
  const revRes = await fetch(`${BASE_URL}/api/pipeline/points/${ptId}/revision`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminAuth.token}`
    },
    body: JSON.stringify({ reason: 'Add pricing comparison' })
  });
  const revData = await revRes.json();
  assert(revRes.status === 200, 'PATCH /api/pipeline/points/:id/revision returns 200', revRes.status);
  assert(revData.status === 'IN_PROGRESS', 'Point status returned to IN_PROGRESS');
  assert(revData.point_description.includes('Add pricing comparison'), 'Revision note recorded');

  // Resubmit point for approval
  await fetch(`${BASE_URL}/api/pipeline/points/${ptId}/submit`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${researcherAuth.token}`
    },
    body: JSON.stringify({ notes: 'Pricing comparison added' })
  });

  // TEST 12: PATCH /api/pipeline/points/:id/approve — success (200)
  console.log('\n--- TEST 12: PATCH /api/pipeline/points/:id/approve (200 success) ---');
  const approveRes = await fetch(`${BASE_URL}/api/pipeline/points/${ptId}/approve`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminAuth.token}`
    }
  });
  const approveData = await approveRes.json();
  assert(approveRes.status === 200, 'PATCH /api/pipeline/points/:id/approve returns 200', approveRes.status);
  assert(approveData.updatedPoint.status === 'APPROVED', 'Point status is APPROVED');
  assert(approveData.stagePercent === 100.00, 'Stage percent calculated to 100.00%');

  // TEST 13: POST /api/pipeline/deliverables/:id/handoff — 400 when < 100%
  console.log('\n--- TEST 13: POST /api/pipeline/deliverables/:id/handoff (400 when < 100%) ---');
  // Create an incomplete deliverable
  const incDelivRes = await fetch(`${BASE_URL}/api/pipeline/deliverables`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminAuth.token}`
    },
    body: JSON.stringify({ project_id: testProjectId, title: 'Incomplete Deliv' })
  });
  const incDeliv = await incDelivRes.json();
  // Add point to it so it's 0%
  await fetch(`${BASE_URL}/api/pipeline/deliverables/${incDeliv.id}/points`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminAuth.token}`
    },
    body: JSON.stringify({ stage: 'RESEARCH', point_title: 'Unfinished Task', weight: 5 })
  });

  const badHandoffRes = await fetch(`${BASE_URL}/api/pipeline/deliverables/${incDeliv.id}/handoff`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminAuth.token}`
    },
    body: JSON.stringify({ from_stage: 'RESEARCH', to_stage: 'DESIGN' })
  });
  assert(badHandoffRes.status === 400, 'POST /api/pipeline/deliverables/:id/handoff returns 400 when < 100%', badHandoffRes.status);

  // TEST 14: POST /api/pipeline/deliverables/:id/handoff — success (201)
  console.log('\n--- TEST 14: POST /api/pipeline/deliverables/:id/handoff (201 success) ---');
  const handoffRes = await fetch(`${BASE_URL}/api/pipeline/deliverables/${delivId}/handoff`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminAuth.token}`
    },
    body: JSON.stringify({
      from_stage: 'RESEARCH',
      to_stage: 'DESIGN',
      handoff_notes: 'Research validated. Passing to Design.'
    })
  });
  const handoffData = await handoffRes.json();
  assert(handoffRes.status === 201, 'POST /api/pipeline/deliverables/:id/handoff returns 201', handoffRes.status);
  assert(handoffData.from_stage === 'RESEARCH' && handoffData.to_stage === 'DESIGN', 'Handoff records transition from RESEARCH to DESIGN');

  // TEST 15: GET /api/pipeline/deliverables/:id/handoffs — success (200)
  console.log('\n--- TEST 15: GET /api/pipeline/deliverables/:id/handoffs (200 success) ---');
  const listHandoffsRes = await fetch(`${BASE_URL}/api/pipeline/deliverables/${delivId}/handoffs`, {
    headers: { 'Authorization': `Bearer ${designerAuth.token}` }
  });
  const listHandoffsData = await listHandoffsRes.json();
  assert(listHandoffsRes.status === 200, 'GET /api/pipeline/deliverables/:id/handoffs returns 200', listHandoffsRes.status);
  assert(Array.isArray(listHandoffsData) && listHandoffsData.length >= 1, 'Handoff records list returned');

  // TEST 16: POST /api/pipeline/deliverables/:id/addendum — 400 wrong BUG_TICKET direction
  console.log('\n--- TEST 16: POST /api/pipeline/deliverables/:id/addendum (400 wrong BUG_TICKET direction) ---');
  const badBugRes = await fetch(`${BASE_URL}/api/pipeline/deliverables/${delivId}/addendum`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${devAuth.token}`
    },
    body: JSON.stringify({
      requesting_stage: 'DEV',
      target_stage: 'RESEARCH',
      point_title: 'Invalid Bug',
      reason: 'Wrong direction',
      type: 'BUG_TICKET'
    })
  });
  assert(badBugRes.status === 400, 'POST /api/pipeline/deliverables/:id/addendum returns 400 for DEV -> RESEARCH bug ticket', badBugRes.status);

  // TEST 17: POST /api/pipeline/deliverables/:id/addendum — success (201)
  console.log('\n--- TEST 17: POST /api/pipeline/deliverables/:id/addendum (201 success) ---');
  const addendumRes = await fetch(`${BASE_URL}/api/pipeline/deliverables/${delivId}/addendum`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${devAuth.token}`
    },
    body: JSON.stringify({
      requesting_stage: 'DEV',
      target_stage: 'RESEARCH',
      point_title: 'Need OAuth scopes spec',
      reason: 'Required for backend routes',
      type: 'ADDENDUM'
    })
  });
  const addendumData = await addendumRes.json();
  assert(addendumRes.status === 201, 'POST /api/pipeline/deliverables/:id/addendum returns 201', addendumRes.status);
  assert(addendumData.status === 'OPEN', 'Addendum status is OPEN');
  const addendumId = addendumData.id;

  // TEST 18: PATCH /api/pipeline/addendum/:id/reject — success (200)
  console.log('\n--- TEST 18: PATCH /api/pipeline/addendum/:id/reject (200 success) ---');
  const rejectRes = await fetch(`${BASE_URL}/api/pipeline/addendum/${addendumId}/reject`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminAuth.token}`
    },
    body: JSON.stringify({ reason: 'Handled in RFC 12' })
  });
  const rejectData = await rejectRes.json();
  assert(rejectRes.status === 200, 'PATCH /api/pipeline/addendum/:id/reject returns 200', rejectRes.status);
  assert(rejectData.status === 'REJECTED', 'Addendum status is REJECTED');

  // TEST 19: PATCH /api/pipeline/addendum/:id/fulfill — success (200)
  console.log('\n--- TEST 19: PATCH /api/pipeline/addendum/:id/fulfill (200 success) ---');
  // Create another addendum to fulfill
  const addendum2Res = await fetch(`${BASE_URL}/api/pipeline/deliverables/${delivId}/addendum`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${designerAuth.token}`
    },
    body: JSON.stringify({
      requesting_stage: 'DESIGN',
      target_stage: 'RESEARCH',
      point_title: 'Color Palette Contrast Research',
      reason: 'a11y validation',
      type: 'ADDENDUM'
    })
  });
  const addendum2 = await addendum2Res.json();

  // Create point to fulfill addendum2 (RESEARCH stage allowed because open addendum exists!)
  const ptFulfillRes = await fetch(`${BASE_URL}/api/pipeline/deliverables/${delivId}/points`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminAuth.token}`
    },
    body: JSON.stringify({
      stage: 'RESEARCH',
      point_title: 'Color Palette Contrast Research Point',
      weight: 5
    })
  });
  const ptFulfill = await ptFulfillRes.json();
  // Claim, submit, approve
  await fetch(`${BASE_URL}/api/pipeline/points/${ptFulfill.id}/claim`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${researcherAuth.token}` }
  });
  await fetch(`${BASE_URL}/api/pipeline/points/${ptFulfill.id}/start`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${researcherAuth.token}` }
  });
  await fetch(`${BASE_URL}/api/pipeline/points/${ptFulfill.id}/submit`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${researcherAuth.token}` },
    body: JSON.stringify({ notes: 'contrast validated' })
  });
  await fetch(`${BASE_URL}/api/pipeline/points/${ptFulfill.id}/approve`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminAuth.token}` }
  });

  // Fulfill addendum2
  const fulfillRes = await fetch(`${BASE_URL}/api/pipeline/addendum/${addendum2.id}/fulfill`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminAuth.token}`
    },
    body: JSON.stringify({ point_id: ptFulfill.id })
  });
  const fulfillData = await fulfillRes.json();
  assert(fulfillRes.status === 200, 'PATCH /api/pipeline/addendum/:id/fulfill returns 200', fulfillRes.status);
  assert(fulfillData.status === 'FULFILLED', 'Addendum status is FULFILLED');

  // TEST 20: GET /api/pipeline/deliverables/:id/addendums — success (200)
  console.log('\n--- TEST 20: GET /api/pipeline/deliverables/:id/addendums (200 success) ---');
  const listAddendumsRes = await fetch(`${BASE_URL}/api/pipeline/deliverables/${delivId}/addendums`, {
    headers: { 'Authorization': `Bearer ${devAuth.token}` }
  });
  const listAddendumsData = await listAddendumsRes.json();
  assert(listAddendumsRes.status === 200, 'GET /api/pipeline/deliverables/:id/addendums returns 200', listAddendumsRes.status);
  assert(Array.isArray(listAddendumsData) && listAddendumsData.length >= 2, 'Addendums array returned with records');

  // TEST 21: GET /api/admin/projects/:id/pipeline/summary — success (200)
  console.log('\n--- TEST 21: GET /api/admin/projects/:id/pipeline/summary (200 success) ---');
  const summaryRes = await fetch(`${BASE_URL}/api/admin/projects/${testProjectId}/pipeline/summary`, {
    headers: { 'Authorization': `Bearer ${adminAuth.token}` }
  });
  const summaryData = await summaryRes.json();
  assert(summaryRes.status === 200, 'GET /api/admin/projects/:id/pipeline/summary returns 200', summaryRes.status);
  assert(summaryData.project && summaryData.deliverables, 'Returns complete pipeline summary');

  // TEST 22: PATCH /api/admin/projects/:id/pipeline/approve-live — 400 when not COMPLETE
  console.log('\n--- TEST 22: PATCH /api/admin/projects/:id/pipeline/approve-live (400 when not COMPLETE) ---');
  const badLiveRes = await fetch(`${BASE_URL}/api/admin/projects/${testProjectId}/pipeline/approve-live`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminAuth.token}`
    },
    body: JSON.stringify({ approval_notes: 'Trying premature approval' })
  });
  assert(badLiveRes.status === 400, 'PATCH /api/admin/projects/:id/pipeline/approve-live returns 400 when not COMPLETE', badLiveRes.status);

  // Complete all stages of delivId and clean up incDeliv
  execute("UPDATE pipeline_deliverables SET status = 'COMPLETE', current_stage = 'COMPLETE' WHERE id = ?", [delivId]);
  execute("UPDATE pipeline_deliverables SET status = 'COMPLETE', current_stage = 'COMPLETE' WHERE id = ?", [incDeliv.id]);

  // TEST 23: PATCH /api/admin/projects/:id/pipeline/approve-live — success (200)
  console.log('\n--- TEST 23: PATCH /api/admin/projects/:id/pipeline/approve-live (200 success) ---');
  const liveRes = await fetch(`${BASE_URL}/api/admin/projects/${testProjectId}/pipeline/approve-live`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminAuth.token}`
    },
    body: JSON.stringify({ approval_notes: 'Full pipeline complete. Approved for Live launch.' })
  });
  const liveData = await liveRes.json();
  assert(liveRes.status === 200, 'PATCH /api/admin/projects/:id/pipeline/approve-live returns 200', liveRes.status);
  assert(liveData.current_stage === 'LIVE' && liveData.status === 'LIVE', 'Project current_stage and status updated to LIVE');

  console.log('\n===================================================================');
  console.log(`  LAYER 3 VERIFICATION SUMMARY: ${passedCount}/${totalCount} ASSERTIONS PASS`);
  console.log('===================================================================');

} catch (err) {
  console.error('Fatal error during Layer 3 test execution:', err);
  server.close();
  process.exit(1);
} finally {
  server.close();
}
