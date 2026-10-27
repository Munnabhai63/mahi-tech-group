/**
 * PRD 15 — Full End-to-End Pipeline Workflow Test Suite (Happy Path)
 * 
 * Verifies all 23 Steps specified in PRD 15 Layer 6 Step 7:
 *  1. Admin creates project (fanout triggers)
 *  2. Auto-deliverable created (verify)
 *  3. Admin adds checklist points to RESEARCH stage
 *  4. Researcher claims -> starts -> submits point
 *  5. Admin approves point -> stage = 100%
 *  6. Admin approves handoff RESEARCH -> DESIGN
 *  7. Designer claims -> starts -> submits point
 *  8. Admin approves -> DESIGN = 100%
 *  9. Admin approves handoff DESIGN -> DEV
 * 10. Developer claims -> starts -> submits point
 * 11. Admin approves -> DEV = 100%
 * 12. Admin approves handoff DEV -> TEST
 * 13. Tester claims -> starts -> submits point
 * 14. Tester raises bug ticket against Dev point
 * 15. Developer fixes -> resubmits -> Admin approves bug fix
 * 16. Tester's point Admin approves -> TEST = 100%
 * 17. Admin approves handoff TEST -> COMPLETE
 * 18. Event 9 notification fired — Admin notified
 * 19. Attempt final-review BEFORE pipeline approve-live -> verify 400 blocked
 * 20. Admin approves Go-Live (adminApproveLive)
 * 21. Event 10 notification fired — all members notified
 * 22. Admin calls final-review -> verify 200 project LIVE
 * 23. Verify access_log has entry for every step
 */

import http from 'node:http';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { createApp } from '../src/app.js';
import { runMigration } from '../src/db/migrate.js';
import { runSeed } from '../src/db/seed.js';
import { queryOne, queryAll, execute } from '../src/db/database.js';
import { config } from '../src/config.js';

console.log('===================================================================');
console.log('  PRD 15 — STEP 15 COMPLETE E2E PIPELINE WORKFLOW TEST SUITE');
console.log('===================================================================');

runMigration();
await runSeed();

const app = createApp();
const server = http.createServer(app);

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();
const BASE_URL = `http://127.0.0.1:${port}`;

let passedCount = 0;
let totalCount = 0;

function assert(condition, message, actual = null) {
  totalCount++;
  if (condition) {
    console.log(`  ✅ PASS: ${message}`);
    passedCount++;
  } else {
    console.error(`  ❌ FAIL: ${message} (Actual: ${JSON.stringify(actual)})`);
    server.close();
    process.exit(1);
  }
}

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
  // Ensure personas exist and have correct passwords
  const adminAuth = await loginUser('admin@mahitechgroup.com', 'AdminPassword@2026');

  // Check or create tester
  let testerUser = queryOne("SELECT * FROM users WHERE email = 'tester@mahitechgroup.com'");
  if (!testerUser) {
    const tId = crypto.randomUUID();
    const tHash = await bcrypt.hash('TesterPass123!', config.BCRYPT_SALT_ROUNDS);
    execute(`
      INSERT INTO users (id, name, email, password_hash, role, sub_role, status, created_at, updated_at)
      VALUES (?, 'Sameer Tester', 'tester@mahitechgroup.com', ?, 'producer', 'tester', 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `, [tId, tHash]);
  } else {
    execute("UPDATE users SET sub_role = 'tester', status = 'active' WHERE email = 'tester@mahitechgroup.com'");
  }

  // -----------------------------------------------------------------
  // STEP 1: Admin creates project (fanout triggers)
  // -----------------------------------------------------------------
  console.log('\n--- STEP 1: Admin Creates Project (Fanout Triggers) ---');
  const ideaId = crypto.randomUUID();
  execute(`
    INSERT INTO ideas (id, owner_id, title, description, status, green_percentage)
    VALUES (?, ?, 'NextGen Cloud Edge Router', 'Ultra-low latency packet broker', 'APPROVED', 100.0)
  `, [ideaId, adminAuth.user.id]);

  const fanoutRes = await fetch(`${BASE_URL}/api/projects/auto-create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminAuth.token}` },
    body: JSON.stringify({ idea_id: ideaId })
  });
  assert(fanoutRes.status === 201, 'Step 1: POST /api/projects/auto-create returns HTTP 201');
  const fanoutData = await fanoutRes.json();
  const projectId = fanoutData.project.id;
  assert(projectId, 'Step 1: Project created with valid ID', projectId);

  // Authenticate assigned project members
  const pmMembers = queryAll(`
    SELECT pm.role_in_project, u.id, u.name, u.email, u.role, u.sub_role
    FROM project_members pm
    JOIN users u ON pm.user_id = u.id
    WHERE pm.project_id = ?
  `, [projectId]);

  const researcherMember = pmMembers.find(m => m.role === 'researcher' || m.role_in_project === 'researcher');
  const developerMember = pmMembers.find(m => m.role === 'developer' || m.role_in_project.includes('dev'));
  const designerMember = pmMembers.find(m => m.role === 'designer' || m.role_in_project === 'designer');
  let producerMember = pmMembers.find(m => m.role === 'producer' || m.role_in_project === 'producer');

  // Make sure producer has sub_role tester so they act as tester in the project
  execute("UPDATE users SET sub_role = 'tester' WHERE id = ?", [producerMember.id]);

  const researcherAuth = await loginUser(researcherMember.email, 'ResearcherPass123!');
  const developerAuth = await loginUser(developerMember.email, 'DevPassword@2026!');
  const designerAuth = await loginUser(designerMember.email, 'DesignerPass123!');
  const testerAuth = await loginUser(producerMember.email, 'TesterPass123!');

  console.log(`   Authenticated project personas: Researcher (${researcherMember.name}), Dev (${developerMember.name}), Designer (${designerMember.name}), Tester (${producerMember.name})`);

  // -----------------------------------------------------------------
  // STEP 2: Auto-deliverable created (verify)
  // -----------------------------------------------------------------
  console.log('\n--- STEP 2: Auto-Deliverable Created (Verify) ---');
  const delivsRes = await fetch(`${BASE_URL}/api/pipeline/deliverables/${projectId}`, {
    headers: { Authorization: `Bearer ${adminAuth.token}` }
  });
  const delivsData = await delivsRes.json();
  const deliverables = Array.isArray(delivsData) ? delivsData : (delivsData.deliverables || []);
  assert(deliverables.length === 1, 'Step 2: Exactly 1 auto-created deliverable exists');
  const deliverable = deliverables[0];
  const deliverableId = deliverable.id;
  assert(deliverable.title === 'Initial Project Deliverable', 'Step 2: Title is "Initial Project Deliverable"');
  assert(deliverable.current_stage === 'RESEARCH', 'Step 2: Stage is RESEARCH');
  assert(deliverable.status === 'ACTIVE', 'Step 2: Status is ACTIVE');

  // -----------------------------------------------------------------
  // STEP 3: Admin adds checklist points to RESEARCH stage
  // -----------------------------------------------------------------
  console.log('\n--- STEP 3: Admin Adds Checklist Points to RESEARCH Stage ---');
  const ptRes1 = await fetch(`${BASE_URL}/api/pipeline/deliverables/${deliverableId}/points`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminAuth.token}` },
    body: JSON.stringify({
      stage: 'RESEARCH',
      point_title: 'Kernel Network Stack Architecture Spec',
      point_description: 'Benchmark DPDK and eBPF drivers',
      weight: 10
    })
  });
  assert(ptRes1.status === 201, 'Step 3: Point created in RESEARCH stage');
  const ptResearch = await ptRes1.json();
  assert(ptResearch.status === 'UNCLAIMED', 'Step 3: Initial point status is UNCLAIMED');

  // -----------------------------------------------------------------
  // STEP 4: Researcher claims -> starts -> submits point
  // -----------------------------------------------------------------
  console.log('\n--- STEP 4: Researcher Claims -> Starts -> Submits Point ---');
  const claim1 = await fetch(`${BASE_URL}/api/pipeline/points/${ptResearch.id}/claim`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${researcherAuth.token}` }
  });
  assert(claim1.status === 200, 'Step 4: Researcher claims point');

  const start1 = await fetch(`${BASE_URL}/api/pipeline/points/${ptResearch.id}/start`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${researcherAuth.token}` }
  });
  assert(start1.status === 200, 'Step 4: Researcher starts point');

  const submit1 = await fetch(`${BASE_URL}/api/pipeline/points/${ptResearch.id}/submit`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${researcherAuth.token}` },
    body: JSON.stringify({ asset_url: 'https://docs.mahitechgroup.com/ebpf-specs.pdf' })
  });
  assert(submit1.status === 200, 'Step 4: Researcher submits point');

  // -----------------------------------------------------------------
  // STEP 5: Admin approves point -> stage = 100%
  // -----------------------------------------------------------------
  console.log('\n--- STEP 5: Admin Approves Point -> Stage Reaches 100% ---');
  const approve1 = await fetch(`${BASE_URL}/api/pipeline/points/${ptResearch.id}/approve`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${adminAuth.token}` }
  });
  assert(approve1.status === 200, 'Step 5: Admin approves point');
  const appData1 = await approve1.json();
  const pct1 = Number(appData1.stagePercent ?? appData1.stage_percent);
  assert(pct1 === 100, 'Step 5: RESEARCH stage reaches 100%');

  // -----------------------------------------------------------------
  // STEP 6: Admin approves handoff RESEARCH -> DESIGN
  // -----------------------------------------------------------------
  console.log('\n--- STEP 6: Admin Approves Handoff RESEARCH -> DESIGN ---');
  const handoff1 = await fetch(`${BASE_URL}/api/pipeline/deliverables/${deliverableId}/handoff`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminAuth.token}` },
    body: JSON.stringify({
      from_stage: 'RESEARCH',
      to_stage: 'DESIGN',
      handoff_notes: 'eBPF specs validated and approved for UI layout.'
    })
  });
  assert(handoff1.status === 201, 'Step 6: Handoff RESEARCH -> DESIGN created');
  const hData1 = await handoff1.json();
  assert(hData1.to_stage === 'DESIGN', 'Step 6: Handoff to_stage is DESIGN');
  const delivCheck1 = queryOne('SELECT current_stage FROM pipeline_deliverables WHERE id = ?', [deliverableId]);
  assert(delivCheck1.current_stage === 'DESIGN', 'Step 6: Deliverable current_stage is now DESIGN');

  // -----------------------------------------------------------------
  // STEP 7: Designer claims -> starts -> submits point
  // -----------------------------------------------------------------
  console.log('\n--- STEP 7: Designer Claims -> Starts -> Submits Point ---');
  const ptRes2 = await fetch(`${BASE_URL}/api/pipeline/deliverables/${deliverableId}/points`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminAuth.token}` },
    body: JSON.stringify({
      stage: 'DESIGN',
      point_title: 'Router Dashboard Figma Wireframe',
      weight: 10
    })
  });
  const ptDesign = await ptRes2.json();

  await fetch(`${BASE_URL}/api/pipeline/points/${ptDesign.id}/claim`, { method: 'PATCH', headers: { Authorization: `Bearer ${designerAuth.token}` } });
  await fetch(`${BASE_URL}/api/pipeline/points/${ptDesign.id}/start`, { method: 'PATCH', headers: { Authorization: `Bearer ${designerAuth.token}` } });
  const submit2 = await fetch(`${BASE_URL}/api/pipeline/points/${ptDesign.id}/submit`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${designerAuth.token}` },
    body: JSON.stringify({ asset_url: 'https://figma.com/file/router-ui' })
  });
  assert(submit2.status === 200, 'Step 7: Designer submits point');

  // -----------------------------------------------------------------
  // STEP 8: Admin approves -> DESIGN = 100%
  // -----------------------------------------------------------------
  console.log('\n--- STEP 8: Admin Approves -> DESIGN = 100% ---');
  const approve2 = await fetch(`${BASE_URL}/api/pipeline/points/${ptDesign.id}/approve`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${adminAuth.token}` }
  });
  assert(approve2.status === 200, 'Step 8: Admin approves DESIGN point');
  const appData2 = await approve2.json();
  const pct2 = Number(appData2.stagePercent ?? appData2.stage_percent);
  assert(pct2 === 100, 'Step 8: DESIGN stage reaches 100%');

  // -----------------------------------------------------------------
  // STEP 9: Admin approves handoff DESIGN -> DEV
  // -----------------------------------------------------------------
  console.log('\n--- STEP 9: Admin Approves Handoff DESIGN -> DEV ---');
  const handoff2 = await fetch(`${BASE_URL}/api/pipeline/deliverables/${deliverableId}/handoff`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminAuth.token}` },
    body: JSON.stringify({
      from_stage: 'DESIGN',
      to_stage: 'DEV',
      handoff_notes: 'Design tokens ready for development implementation.'
    })
  });
  assert(handoff2.status === 201, 'Step 9: Handoff DESIGN -> DEV created');
  const hData2 = await handoff2.json();
  assert(hData2.to_stage === 'DEV', 'Step 9: Handoff to_stage is DEV');
  const delivCheck2 = queryOne('SELECT current_stage FROM pipeline_deliverables WHERE id = ?', [deliverableId]);
  assert(delivCheck2.current_stage === 'DEV', 'Step 9: Deliverable current_stage is now DEV');

  // -----------------------------------------------------------------
  // STEP 10: Developer claims -> starts -> submits point
  // -----------------------------------------------------------------
  console.log('\n--- STEP 10: Developer Claims -> Starts -> Submits Point ---');
  const ptRes3 = await fetch(`${BASE_URL}/api/pipeline/deliverables/${deliverableId}/points`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminAuth.token}` },
    body: JSON.stringify({
      stage: 'DEV',
      point_title: 'Packet Routing Microservice Implementation',
      weight: 10
    })
  });
  const ptDev = await ptRes3.json();

  await fetch(`${BASE_URL}/api/pipeline/points/${ptDev.id}/claim`, { method: 'PATCH', headers: { Authorization: `Bearer ${developerAuth.token}` } });
  await fetch(`${BASE_URL}/api/pipeline/points/${ptDev.id}/start`, { method: 'PATCH', headers: { Authorization: `Bearer ${developerAuth.token}` } });
  const submit3 = await fetch(`${BASE_URL}/api/pipeline/points/${ptDev.id}/submit`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${developerAuth.token}` },
    body: JSON.stringify({ asset_url: 'https://github.com/mahi/router/tree/v1' })
  });
  assert(submit3.status === 200, 'Step 10: Developer submits point');

  // -----------------------------------------------------------------
  // STEP 11: Admin approves -> DEV = 100%
  // -----------------------------------------------------------------
  console.log('\n--- STEP 11: Admin Approves -> DEV = 100% ---');
  const approve3 = await fetch(`${BASE_URL}/api/pipeline/points/${ptDev.id}/approve`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${adminAuth.token}` }
  });
  assert(approve3.status === 200, 'Step 11: Admin approves DEV point');
  const appData3 = await approve3.json();
  const pct3 = Number(appData3.stagePercent ?? appData3.stage_percent);
  assert(pct3 === 100, 'Step 11: DEV stage reaches 100%');

  // -----------------------------------------------------------------
  // STEP 12: Admin approves handoff DEV -> TEST
  // -----------------------------------------------------------------
  console.log('\n--- STEP 12: Admin Approves Handoff DEV -> TEST ---');
  const handoff3 = await fetch(`${BASE_URL}/api/pipeline/deliverables/${deliverableId}/handoff`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminAuth.token}` },
    body: JSON.stringify({
      from_stage: 'DEV',
      to_stage: 'TEST',
      handoff_notes: 'Code merged to staging, ready for QA load testing.'
    })
  });
  assert(handoff3.status === 201, 'Step 12: Handoff DEV -> TEST created');
  const hData3 = await handoff3.json();
  assert(hData3.to_stage === 'TEST', 'Step 12: Handoff to_stage is TEST');
  const delivCheck3 = queryOne('SELECT current_stage FROM pipeline_deliverables WHERE id = ?', [deliverableId]);
  assert(delivCheck3.current_stage === 'TEST', 'Step 12: Deliverable current_stage is now TEST');

  // -----------------------------------------------------------------
  // STEP 13: Tester claims -> starts -> submits point
  // -----------------------------------------------------------------
  console.log('\n--- STEP 13: Tester Claims -> Starts -> Submits Point ---');
  const ptRes4 = await fetch(`${BASE_URL}/api/pipeline/deliverables/${deliverableId}/points`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminAuth.token}` },
    body: JSON.stringify({
      stage: 'TEST',
      point_title: 'Chaos & Stress Test Suite',
      weight: 10
    })
  });
  const ptTest = await ptRes4.json();

  await fetch(`${BASE_URL}/api/pipeline/points/${ptTest.id}/claim`, { method: 'PATCH', headers: { Authorization: `Bearer ${testerAuth.token}` } });
  await fetch(`${BASE_URL}/api/pipeline/points/${ptTest.id}/start`, { method: 'PATCH', headers: { Authorization: `Bearer ${testerAuth.token}` } });
  const submit4 = await fetch(`${BASE_URL}/api/pipeline/points/${ptTest.id}/submit`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${testerAuth.token}` },
    body: JSON.stringify({ asset_url: 'https://ci.mahitechgroup.com/runs/stress-test' })
  });
  assert(submit4.status === 200, 'Step 13: Tester submits point');

  // -----------------------------------------------------------------
  // STEP 14: Tester raises bug ticket against Dev point
  // -----------------------------------------------------------------
  console.log('\n--- STEP 14: Tester Raises Bug Ticket Against Dev Point ---');
  const bugRes = await fetch(`${BASE_URL}/api/pipeline/deliverables/${deliverableId}/addendum`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${testerAuth.token}` },
    body: JSON.stringify({
      requesting_stage: 'TEST',
      target_stage: 'DEV',
      point_title: ptDev.point_title,
      reason: 'Ring buffer drops frames during burst traffic',
      type: 'BUG_TICKET'
    })
  });
  assert(bugRes.status === 201, 'Step 14: Bug ticket raised by Tester');
  const bugData = await bugRes.json();
  const bugTicket = bugData.addendum || bugData;
  const bugTicketId = bugTicket.id;
  assert(bugTicket.type === 'BUG_TICKET', 'Step 14: Addendum type is BUG_TICKET');

  // Verify target dev point was reverted to REVISION_NEEDED
  const devPtInDb = queryOne('SELECT * FROM pipeline_checklist_points WHERE id = ?', [ptDev.id]);
  assert(devPtInDb.status === 'REVISION_NEEDED', 'Step 14: Target dev point flipped to REVISION_NEEDED');

  // -----------------------------------------------------------------
  // STEP 15: Developer fixes -> resubmits -> Admin approves bug fix
  // -----------------------------------------------------------------
  console.log('\n--- STEP 15: Developer Fixes -> Resubmits -> Admin Approves Bug Fix ---');
  await fetch(`${BASE_URL}/api/pipeline/points/${ptDev.id}/start`, { method: 'PATCH', headers: { Authorization: `Bearer ${developerAuth.token}` } });
  await fetch(`${BASE_URL}/api/pipeline/points/${ptDev.id}/submit`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${developerAuth.token}` },
    body: JSON.stringify({ asset_url: 'https://github.com/mahi/router/commit/ring-buffer-fix' })
  });
  await fetch(`${BASE_URL}/api/pipeline/points/${ptDev.id}/approve`, { method: 'PATCH', headers: { Authorization: `Bearer ${adminAuth.token}` } });

  // Admin fulfills the bug ticket addendum
  const fulfillBug = await fetch(`${BASE_URL}/api/pipeline/addendum/${bugTicketId}/fulfill`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminAuth.token}` },
    body: JSON.stringify({ point_id: ptDev.id, resolution_notes: 'Ring buffer expanded and backpressure tested.' })
  });
  assert(fulfillBug.status === 200, 'Step 15: Admin fulfills bug ticket');
  const fulfilledData = await fulfillBug.json();
  const fulfilledAddendum = fulfilledData.addendum || fulfilledData;
  assert(fulfilledAddendum.status === 'FULFILLED', 'Step 15: Bug ticket status is FULFILLED');

  // -----------------------------------------------------------------
  // STEP 16: Tester's point Admin approves -> TEST = 100%
  // -----------------------------------------------------------------
  console.log('\n--- STEP 16: Tester Point Admin Approves -> TEST = 100% ---');
  const approveTestPt = await fetch(`${BASE_URL}/api/pipeline/points/${ptTest.id}/approve`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${adminAuth.token}` }
  });
  assert(approveTestPt.status === 200, 'Step 16: Admin approves test point');
  const appData4 = await approveTestPt.json();
  const pct4 = Number(appData4.stagePercent ?? appData4.stage_percent);
  assert(pct4 === 100, 'Step 16: TEST stage reaches 100%');

  // -----------------------------------------------------------------
  // STEP 17: Admin approves handoff TEST -> COMPLETE
  // -----------------------------------------------------------------
  console.log('\n--- STEP 17: Admin Approves Handoff TEST -> COMPLETE ---');
  const handoff4 = await fetch(`${BASE_URL}/api/pipeline/deliverables/${deliverableId}/handoff`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminAuth.token}` },
    body: JSON.stringify({
      from_stage: 'TEST',
      to_stage: 'COMPLETE',
      handoff_notes: 'All stress and load tests cleared with 0 dropped frames.'
    })
  });
  assert(handoff4.status === 201, 'Step 17: Handoff TEST -> COMPLETE created');
  const hData4 = await handoff4.json();
  assert(hData4.to_stage === 'COMPLETE', 'Step 17: Handoff to_stage is COMPLETE');
  const delivCheck4 = queryOne('SELECT current_stage, status FROM pipeline_deliverables WHERE id = ?', [deliverableId]);
  assert(delivCheck4.current_stage === 'COMPLETE', 'Step 17: Deliverable current_stage is now COMPLETE');
  assert(delivCheck4.status === 'COMPLETE', 'Step 17: Deliverable status is now COMPLETE');

  // -----------------------------------------------------------------
  // STEP 18: Event 9 notification fired — Admin notified
  // -----------------------------------------------------------------
  console.log('\n--- STEP 18: Event 9 Notification Fired — Admin Notified ---');
  const notif9 = queryOne(`
    SELECT * FROM notifications
    WHERE user_id = ? AND event_type = 'pipeline_project_ready_for_live'
    ORDER BY created_at DESC LIMIT 1
  `, [adminAuth.user.id]);
  assert(notif9, 'Step 18: Event 9 notification in DB for Admin');
  assert(notif9.link === '/admin/pipeline', 'Step 18: Link is /admin/pipeline');
  console.log(`   📋 [EVENT 9 DB RECORD]: msg="${notif9.message}" recipient=${notif9.user_id}`);

  // -----------------------------------------------------------------
  // STEP 19: Attempt final-review BEFORE pipeline approve-live -> 400 blocked
  // -----------------------------------------------------------------
  console.log('\n--- STEP 19: Attempt Final-Review Before Pipeline Approve-Live (400 Blocked) ---');
  // Complete the 8 foundational non-review tasks
  execute("UPDATE project_tasks SET status = 'DONE' WHERE project_id = ? AND task_type != 'review'", [projectId]);

  const blockedReviewRes = await fetch(`${BASE_URL}/api/admin/projects/${projectId}/final-review`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminAuth.token}` },
    body: JSON.stringify({ approved: true, notes: 'Premature review attempt' })
  });
  assert(blockedReviewRes.status === 400, 'Step 19: Final review BLOCKED with HTTP 400 while pipeline deliverable not LIVE');
  const blockedBody = await blockedReviewRes.json();
  assert(
    blockedBody.error === 'Pipeline deliverables must all reach LIVE status before final project review. Use Admin Pipeline Approval first.',
    'Step 19: Exact pipeline gate message returned'
  );
  console.log(`   📋 [BLOCKED GATE]: ${blockedBody.error}`);

  // -----------------------------------------------------------------
  // STEP 20: Admin approves Go-Live (adminApproveLive)
  // -----------------------------------------------------------------
  console.log('\n--- STEP 20: Admin Approves Go-Live (adminApproveLive) ---');
  const approveLiveRes = await fetch(`${BASE_URL}/api/admin/projects/${projectId}/pipeline/approve-live`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminAuth.token}` },
    body: JSON.stringify({ approval_notes: 'Board verified, production DNS cutover authorized.' })
  });
  assert(approveLiveRes.status === 200, 'Step 20: PATCH /api/admin/projects/:id/pipeline/approve-live returns 200');
  const liveDeliv = queryOne('SELECT * FROM pipeline_deliverables WHERE id = ?', [deliverableId]);
  assert(liveDeliv.status === 'LIVE', 'Step 20: Deliverable status transitioned to LIVE');

  // -----------------------------------------------------------------
  // STEP 21: Event 10 notification fired — all members notified
  // -----------------------------------------------------------------
  console.log('\n--- STEP 21: Event 10 Notification Fired — All Members Notified ---');
  for (const member of pmMembers) {
    const notif10 = queryOne(`
      SELECT * FROM notifications
      WHERE user_id = ? AND event_type = 'pipeline_project_live'
      ORDER BY created_at DESC LIMIT 1
    `, [member.id]);
    assert(notif10, `Step 21: Event 10 notification received by ${member.name} (${member.role_in_project})`);
  }

  // -----------------------------------------------------------------
  // STEP 22: Admin calls final-review -> verify 200 project LIVE
  // -----------------------------------------------------------------
  console.log('\n--- STEP 22: Admin Calls Final-Review -> Verify 200 Project LIVE ---');
  const finalReviewRes = await fetch(`${BASE_URL}/api/admin/projects/${projectId}/final-review`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminAuth.token}` },
    body: JSON.stringify({ approved: true, notes: 'Official production release signed off.' })
  });
  assert(finalReviewRes.status === 200, 'Step 22: Final review succeeds with HTTP 200');
  const finalData = await finalReviewRes.json();
  assert(finalData.stage === 'LIVE', 'Step 22: Project stage is LIVE');
  assert(finalData.project.status === 'LIVE', 'Step 22: Project status is LIVE');
  console.log(`   📋 [FINAL REVIEW SUCCESS]: Project ${projectId} is now LIVE in production!`);

  // -----------------------------------------------------------------
  // STEP 23: Verify access_log has entry for every step
  // -----------------------------------------------------------------
  console.log('\n--- STEP 23: Verify access_log Has Entry For Every Step ---');
  const requiredAuditActions = [
    'project_fanout_created',
    'pipeline_auto_deliverable_created',
    'pipeline_point_added',
    'pipeline_point_claimed',
    'pipeline_point_started',
    'pipeline_point_submitted',
    'pipeline_point_approved',
    'pipeline_stage_handoff_approved',
    'pipeline_bug_ticket_raised',
    'pipeline_addendum_fulfilled',
    'pipeline_admin_approved_live',
    'project_approved_live'
  ];

  for (const action of requiredAuditActions) {
    const logEntry = queryOne('SELECT * FROM access_log WHERE action = ? ORDER BY timestamp DESC LIMIT 1', [action]);
    assert(logEntry, `Step 23: access_log contains action "${action}"`);
    console.log(`   📋 [AUDIT RECORD]: action="${action}" timestamp=${logEntry?.timestamp}`);
  }

  console.log('\n===================================================================');
  console.log(`  ALL 23 FULL E2E PIPELINE STEPS PASSED: ${passedCount} / ${totalCount}`);
  console.log('===================================================================');

} catch (err) {
  console.error('\n❌ FULL E2E PIPELINE EXCEPTION:', err);
  process.exit(1);
} finally {
  try {
    const adminHash = await bcrypt.hash('AdminPassword@2026', config.BCRYPT_SALT_ROUNDS);
    execute('UPDATE users SET password_hash = ?, status = ? WHERE email = ?', [adminHash, 'active', 'admin@mahitechgroup.com']);
  } catch (e) {}
  server.close();
  process.exit(0);
}
