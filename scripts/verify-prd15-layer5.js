/**
 * PRD 15 — Layer 5 Notifications & WebSocket Verification Suite
 * 
 * Verifies all 10 notification and WebSocket broadcast events:
 * 1. EVENT 1: Point Submitted (submitPoint) -> Lead/Admin
 * 2. EVENT 2: Point Approved (approvePoint) -> Assigned member
 * 3. EVENT 3: Point Sent to Revision (revisionPoint) -> Assigned member
 * 4. EVENT 4: Stage Reached 100% (approvePoint) -> Lead/Admin
 * 5. EVENT 5: Handoff Approved (approveHandoff) -> Next-stage role members
 * 6. EVENT 6: Addendum Request Raised (raiseAddendum) -> Target-stage members + Lead/Admin
 * 7. EVENT 7: Addendum Fulfilled (fulfillAddendum) -> Requesting-stage members
 * 8. EVENT 8: Bug Ticket Raised (raiseAddendum BUG_TICKET) -> Dev members + Lead/Admin
 * 9. EVENT 9: All Deliverables Complete (approveHandoff COMPLETE) -> Platform Admins
 * 10. EVENT 10: Go-Live Approved (adminApproveLive) -> ALL project members
 */

import http from 'node:http';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { WebSocket } from 'ws';
import { createApp } from '../src/app.js';
import { runMigration } from '../src/db/migrate.js';
import { runSeed } from '../src/db/seed.js';
import { queryOne, queryAll, execute } from '../src/db/database.js';
import { initWebSocketServer } from '../src/services/wsService.js';
import { config } from '../src/config.js';

console.log('===================================================================');
console.log('  PRD 15 — LAYER 5 NOTIFICATIONS & WEBSOCKET VERIFICATION SUITE');
console.log('===================================================================');

// Ensure DB schema and seeds are loaded
runMigration();
await runSeed();

const app = createApp();
const server = http.createServer(app);
const wss = initWebSocketServer(server);

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

// Helper to log in users
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

// Helper to connect WebSocket clients
function connectWS(token) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${token}`);
    const events = [];
    ws.on('open', () => resolve({ ws, events }));
    ws.on('message', (msg) => {
      try {
        const parsed = JSON.parse(msg.toString());
        events.push(parsed);
      } catch (e) {}
    });
    ws.on('error', reject);
  });
}

// Sleep helper
const wait = (ms) => new Promise(r => setTimeout(r, ms));

const openSockets = [];

try {
  // 1. Authenticate canonical test users
  const adminAuth = await loginUser('admin@mahitechgroup.com', 'AdminPassword@2026');
  const researcherAuth = await loginUser('researcher@mahitechgroup.com', 'ResearcherPass123!');
  const developerAuth = await loginUser('developer@mahitechgroup.com', 'DevPassword123!');
  const designerAuth = await loginUser('designer@mahitechgroup.com', 'DesignerPass123!');
  const testerAuth = await loginUser('producer@mahitechgroup.com', 'ProducerPass123!');

  execute("UPDATE users SET role = 'admin', status = 'active' WHERE id = ?", [adminAuth.user.id]);
  execute("UPDATE users SET role = 'researcher', status = 'active' WHERE id = ?", [researcherAuth.user.id]);
  execute("UPDATE users SET role = 'developer', status = 'active' WHERE id = ?", [developerAuth.user.id]);
  execute("UPDATE users SET role = 'designer', status = 'active' WHERE id = ?", [designerAuth.user.id]);
  execute("UPDATE users SET role = 'producer', sub_role = 'tester', status = 'active' WHERE id = ?", [testerAuth.user.id]);

  // Connect active WebSocket clients
  const adminWs = await connectWS(adminAuth.token);
  const researcherWs = await connectWS(researcherAuth.token);
  const developerWs = await connectWS(developerAuth.token);
  const designerWs = await connectWS(designerAuth.token);
  const testerWs = await connectWS(testerAuth.token);

  openSockets.push(adminWs.ws, researcherWs.ws, developerWs.ws, designerWs.ws, testerWs.ws);

  console.log('\n>>> Connected 5 live WebSocket clients (Admin, Researcher, Developer, Designer, Tester)');

  // Create isolated test project
  const testProjectId = 'prj-l5-' + crypto.randomUUID().slice(0, 8);
  const testIdeaId = 'idea-l5-' + crypto.randomUUID().slice(0, 8);
  execute("INSERT OR REPLACE INTO ideas (id, title, description, owner_id, status) VALUES (?, 'Pipeline Layer 5 Idea', 'Desc', ?, 'APPROVED')", [testIdeaId, adminAuth.user.id]);
  execute("INSERT OR REPLACE INTO projects (id, idea_id, title, owner_id, current_stage, status) VALUES (?, ?, 'PRD 15 Workflow Project', ?, 'RESEARCH_DEV_PARALLEL', 'ACTIVE')", [testProjectId, testIdeaId, adminAuth.user.id]);

  // Add members to project
  execute('DELETE FROM project_members WHERE project_id = ?', [testProjectId]);
  execute('INSERT INTO project_members (id, project_id, user_id, role_in_project) VALUES (?, ?, ?, ?)', [crypto.randomUUID(), testProjectId, adminAuth.user.id, 'admin_reviewer']);
  execute('INSERT INTO project_members (id, project_id, user_id, role_in_project) VALUES (?, ?, ?, ?)', [crypto.randomUUID(), testProjectId, researcherAuth.user.id, 'researcher']);
  execute('INSERT INTO project_members (id, project_id, user_id, role_in_project) VALUES (?, ?, ?, ?)', [crypto.randomUUID(), testProjectId, designerAuth.user.id, 'designer']);
  execute('INSERT INTO project_members (id, project_id, user_id, role_in_project) VALUES (?, ?, ?, ?)', [crypto.randomUUID(), testProjectId, developerAuth.user.id, 'backend_dev']);
  execute('INSERT INTO project_members (id, project_id, user_id, role_in_project) VALUES (?, ?, ?, ?)', [crypto.randomUUID(), testProjectId, testerAuth.user.id, 'producer']);

  // Create deliverable
  const delivRes = await fetch(`${BASE_URL}/api/pipeline/deliverables`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminAuth.token}` },
    body: JSON.stringify({
      project_id: testProjectId,
      title: 'Auth Service Deliverable',
      description: 'End to end auth delivery'
    })
  });
  const delivData = await delivRes.json();
  const deliverableId = delivData.id;
  assert(delivRes.status === 201 && deliverableId, 'Created test deliverable', delivData);

  // -----------------------------------------------------------------
  // EVENT 1: Point Submitted
  // -----------------------------------------------------------------
  console.log('\n--- EVENT 1: Point Submitted (submitPoint) ---');
  // Add research point
  const ptRes1 = await fetch(`${BASE_URL}/api/pipeline/deliverables/${deliverableId}/points`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminAuth.token}` },
    body: JSON.stringify({ stage: 'RESEARCH', point_title: 'API Spec Document', weight: 10 })
  });
  const ptData1 = await ptRes1.json();
  const point1Id = ptData1.id;

  // Claim & Start as researcher
  await fetch(`${BASE_URL}/api/pipeline/points/${point1Id}/claim`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${researcherAuth.token}` }
  });
  await fetch(`${BASE_URL}/api/pipeline/points/${point1Id}/start`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${researcherAuth.token}` }
  });

  // Submit as researcher
  adminWs.events.length = 0;
  const submitRes1 = await fetch(`${BASE_URL}/api/pipeline/points/${point1Id}/submit`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${researcherAuth.token}` },
    body: JSON.stringify({ asset_url: 'https://docs.example.com/spec', notes: 'Initial draft' })
  });
  assert(submitRes1.status === 200, 'PATCH /api/pipeline/points/:id/submit succeeds');

  await wait(50);

  // Check DB notification
  const notif1 = queryOne(`
    SELECT * FROM notifications 
    WHERE user_id = ? AND event_type = 'pipeline_point_submitted'
    ORDER BY created_at DESC LIMIT 1
  `, [adminAuth.user.id]);
  assert(notif1, 'DB record inserted for Lead/Admin on point submission');
  assert(notif1 && notif1.message.includes('submitted point: API Spec Document — ready for review'), 'Notification message matches exact format', notif1?.message);
  assert(notif1 && notif1.link === `/projects/${testProjectId}?tab=pipeline`, 'Notification link matches exact target', notif1?.link);
  assert(notif1 && notif1.read_status === 0, 'Notification read_status is 0 (unread)');
  console.log(`   📋 [DB RECORD 1]: user=${notif1.user_id} event=${notif1.event_type} msg="${notif1.message}" link=${notif1.link} read=${notif1.read_status}`);

  // Check WS broadcast
  const ws1 = adminWs.events.find(e => e.event === 'pipeline_point_submitted' || e.data?.type === 'pipeline_point_submitted');
  assert(ws1, 'WS broadcast received with type pipeline_point_submitted');

  // -----------------------------------------------------------------
  // EVENT 3: Point Sent to Revision
  // -----------------------------------------------------------------
  console.log('\n--- EVENT 3: Point Sent to Revision (revisionPoint) ---');
  researcherWs.events.length = 0;
  const revRes = await fetch(`${BASE_URL}/api/pipeline/points/${point1Id}/revision`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminAuth.token}` },
    body: JSON.stringify({ reason: 'Add section on rate limiting' })
  });
  assert(revRes.status === 200, 'PATCH /api/pipeline/points/:id/revision succeeds');

  await wait(50);

  // Check DB notification
  const notif3 = queryOne(`
    SELECT * FROM notifications 
    WHERE user_id = ? AND event_type = 'pipeline_point_revision'
    ORDER BY created_at DESC LIMIT 1
  `, [researcherAuth.user.id]);
  assert(notif3, 'DB record inserted for assigned member on revision request');
  assert(notif3 && notif3.message === "Revision requested on your point 'API Spec Document': Add section on rate limiting", 'Revision message matches format', notif3?.message);
  assert(notif3 && notif3.link === `/projects/${testProjectId}?tab=pipeline`, 'Revision link is correct');
  assert(notif3 && notif3.read_status === 0, 'Revision read_status is 0');
  console.log(`   📋 [DB RECORD 3]: user=${notif3.user_id} event=${notif3.event_type} msg="${notif3.message}" link=${notif3.link} read=${notif3.read_status}`);

  // Check WS broadcast
  const ws3 = researcherWs.events.find(e => e.event === 'pipeline_point_revision' || e.data?.type === 'pipeline_point_revision');
  assert(ws3, 'WS broadcast received with type pipeline_point_revision');

  // -----------------------------------------------------------------
  // EVENT 2: Point Approved & EVENT 4: Stage Reached 100%
  // -----------------------------------------------------------------
  console.log('\n--- EVENT 2 & 4: Point Approved & Stage 100% (approvePoint) ---');
  // Re-submit point
  await fetch(`${BASE_URL}/api/pipeline/points/${point1Id}/submit`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${researcherAuth.token}` },
    body: JSON.stringify({ asset_url: 'https://docs.example.com/spec-v2', notes: 'Rate limiting added' })
  });

  researcherWs.events.length = 0;
  adminWs.events.length = 0;

  // Approve point (it's weight 10 / total weight 10 = 100%)
  const approveRes = await fetch(`${BASE_URL}/api/pipeline/points/${point1Id}/approve`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${adminAuth.token}` }
  });
  assert(approveRes.status === 200, 'PATCH /api/pipeline/points/:id/approve succeeds');

  await wait(50);

  // Check EVENT 2 in DB
  const notif2 = queryOne(`
    SELECT * FROM notifications 
    WHERE user_id = ? AND event_type = 'pipeline_point_approved'
    ORDER BY created_at DESC LIMIT 1
  `, [researcherAuth.user.id]);
  assert(notif2, 'EVENT 2: DB record inserted for assigned member on approval');
  assert(notif2 && notif2.message === "Your point 'API Spec Document' has been approved ✅", 'EVENT 2: Message matches format', notif2?.message);
  assert(notif2 && notif2.link === `/projects/${testProjectId}?tab=pipeline`, 'EVENT 2: Link is correct');
  assert(notif2 && notif2.read_status === 0, 'EVENT 2: read_status is 0');
  console.log(`   📋 [DB RECORD 2]: user=${notif2.user_id} event=${notif2.event_type} msg="${notif2.message}" link=${notif2.link} read=${notif2.read_status}`);

  const ws2 = researcherWs.events.find(e => e.event === 'pipeline_point_approved' || e.data?.type === 'pipeline_point_approved');
  assert(ws2, 'EVENT 2: WS broadcast received with type pipeline_point_approved');

  // Check EVENT 4 in DB
  const notif4 = queryOne(`
    SELECT * FROM notifications 
    WHERE user_id = ? AND event_type = 'pipeline_stage_complete'
    ORDER BY created_at DESC LIMIT 1
  `, [adminAuth.user.id]);
  assert(notif4, 'EVENT 4: DB record inserted for Lead/Admin on stage 100%');
  assert(notif4 && notif4.message === 'RESEARCH stage is 100% complete — handoff ready for deliverable: Auth Service Deliverable', 'EVENT 4: Message matches format', notif4?.message);
  assert(notif4 && notif4.link === `/projects/${testProjectId}?tab=pipeline`, 'EVENT 4: Link is correct');
  assert(notif4 && notif4.read_status === 0, 'EVENT 4: read_status is 0');
  console.log(`   📋 [DB RECORD 4]: user=${notif4.user_id} event=${notif4.event_type} msg="${notif4.message}" link=${notif4.link} read=${notif4.read_status}`);

  const ws4 = adminWs.events.find(e => e.event === 'pipeline_stage_complete' || e.data?.type === 'pipeline_stage_complete');
  assert(ws4, 'EVENT 4: WS broadcast received with type pipeline_stage_complete');

  // -----------------------------------------------------------------
  // EVENT 5: Handoff Approved (approveHandoff)
  // -----------------------------------------------------------------
  console.log('\n--- EVENT 5: Handoff Approved (approveHandoff) ---');
  designerWs.events.length = 0;
  const handoffRes1 = await fetch(`${BASE_URL}/api/pipeline/deliverables/${deliverableId}/handoff`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminAuth.token}` },
    body: JSON.stringify({ from_stage: 'RESEARCH', to_stage: 'DESIGN', handoff_notes: 'Spec approved' })
  });
  assert(handoffRes1.status === 201, 'POST /api/pipeline/deliverables/:id/handoff succeeds');

  await wait(50);

  // Check DB notification for Designer
  const notif5 = queryOne(`
    SELECT * FROM notifications 
    WHERE user_id = ? AND event_type = 'pipeline_handoff_approved'
    ORDER BY created_at DESC LIMIT 1
  `, [designerAuth.user.id]);
  assert(notif5, 'EVENT 5: DB record inserted for next-stage (DESIGN) member');
  assert(notif5 && notif5.message === 'RESEARCH stage approved — DESIGN stage is now unlocked for deliverable: Auth Service Deliverable', 'EVENT 5: Message matches format', notif5?.message);
  assert(notif5 && notif5.link === `/projects/${testProjectId}?tab=pipeline`, 'EVENT 5: Link is correct');
  assert(notif5 && notif5.read_status === 0, 'EVENT 5: read_status is 0');
  console.log(`   📋 [DB RECORD 5]: user=${notif5.user_id} event=${notif5.event_type} msg="${notif5.message}" link=${notif5.link} read=${notif5.read_status}`);

  const ws5 = designerWs.events.find(e => e.event === 'pipeline_handoff_approved' || e.data?.type === 'pipeline_handoff_approved');
  assert(ws5, 'EVENT 5: WS broadcast received with type pipeline_handoff_approved');

  // -----------------------------------------------------------------
  // EVENT 6: Addendum Request Raised (raiseAddendum)
  // -----------------------------------------------------------------
  console.log('\n--- EVENT 6: Addendum Request Raised (raiseAddendum) ---');
  researcherWs.events.length = 0;
  adminWs.events.length = 0;

  const addendumRes = await fetch(`${BASE_URL}/api/pipeline/deliverables/${deliverableId}/addendum`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${designerAuth.token}` },
    body: JSON.stringify({
      requesting_stage: 'DESIGN',
      target_stage: 'RESEARCH',
      point_title: 'Clarify OAuth Scope Matrix',
      reason: 'Need exact scopes for UI permissions grid',
      type: 'ADDENDUM'
    })
  });
  const addendumData = await addendumRes.json();
  const addendumId = addendumData.id;
  assert(addendumRes.status === 201 && addendumId, 'POST /api/pipeline/deliverables/:id/addendum creates addendum');

  await wait(50);

  // Check DB notification for Researcher (target stage role) and Admin
  const notif6Res = queryOne(`
    SELECT * FROM notifications 
    WHERE user_id = ? AND event_type = 'pipeline_addendum_raised'
    ORDER BY created_at DESC LIMIT 1
  `, [researcherAuth.user.id]);
  const notif6Admin = queryOne(`
    SELECT * FROM notifications 
    WHERE user_id = ? AND event_type = 'pipeline_addendum_raised'
    ORDER BY created_at DESC LIMIT 1
  `, [adminAuth.user.id]);

  assert(notif6Res, 'EVENT 6: DB record inserted for target-stage (RESEARCH) member');
  assert(notif6Admin, 'EVENT 6: DB record inserted for Lead/Admin');
  assert(notif6Res && notif6Res.message === "Addendum requested on RESEARCH stage by DESIGN: 'Clarify OAuth Scope Matrix'", 'EVENT 6: Message matches format', notif6Res?.message);
  assert(notif6Res && notif6Res.link === `/projects/${testProjectId}?tab=pipeline`, 'EVENT 6: Link is correct');
  assert(notif6Res && notif6Res.read_status === 0, 'EVENT 6: read_status is 0');
  console.log(`   📋 [DB RECORD 6]: user=${notif6Res.user_id} event=${notif6Res.event_type} msg="${notif6Res.message}" link=${notif6Res.link} read=${notif6Res.read_status}`);

  const ws6 = researcherWs.events.find(e => e.event === 'pipeline_addendum_raised' || e.data?.type === 'pipeline_addendum_raised');
  assert(ws6, 'EVENT 6: WS broadcast received with type pipeline_addendum_raised');

  // -----------------------------------------------------------------
  // EVENT 7: Addendum Fulfilled (fulfillAddendum)
  // -----------------------------------------------------------------
  console.log('\n--- EVENT 7: Addendum Fulfilled (fulfillAddendum) ---');
  // Add fulfilling point to RESEARCH
  const ptFulfillRes = await fetch(`${BASE_URL}/api/pipeline/deliverables/${deliverableId}/points`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminAuth.token}` },
    body: JSON.stringify({ stage: 'RESEARCH', point_title: 'Clarify OAuth Scope Matrix', weight: 5 })
  });
  const ptFulfillData = await ptFulfillRes.json();
  const ptFulfillId = ptFulfillData.id;

  // Claim, start, submit, approve fulfilling point
  await fetch(`${BASE_URL}/api/pipeline/points/${ptFulfillId}/claim`, { method: 'PATCH', headers: { Authorization: `Bearer ${researcherAuth.token}` } });
  await fetch(`${BASE_URL}/api/pipeline/points/${ptFulfillId}/start`, { method: 'PATCH', headers: { Authorization: `Bearer ${researcherAuth.token}` } });
  await fetch(`${BASE_URL}/api/pipeline/points/${ptFulfillId}/submit`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${researcherAuth.token}` }, body: JSON.stringify({ asset_url: 'https://docs.example.com/oauth' }) });
  await fetch(`${BASE_URL}/api/pipeline/points/${ptFulfillId}/approve`, { method: 'PATCH', headers: { Authorization: `Bearer ${adminAuth.token}` } });

  designerWs.events.length = 0;
  // Fulfill the addendum
  const fulfillRes = await fetch(`${BASE_URL}/api/pipeline/addendum/${addendumId}/fulfill`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminAuth.token}` },
    body: JSON.stringify({ point_id: ptFulfillId })
  });
  assert(fulfillRes.status === 200, 'PATCH /api/pipeline/addendum/:id/fulfill succeeds');

  await wait(50);

  // Check DB notification for Designer (requesting stage)
  const notif7 = queryOne(`
    SELECT * FROM notifications 
    WHERE user_id = ? AND event_type = 'pipeline_addendum_fulfilled'
    ORDER BY created_at DESC LIMIT 1
  `, [designerAuth.user.id]);
  assert(notif7, 'EVENT 7: DB record inserted for requesting-stage (DESIGN) member');
  assert(notif7 && notif7.message === "Addendum fulfilled — 'Clarify OAuth Scope Matrix' added and approved in RESEARCH stage", 'EVENT 7: Message matches format', notif7?.message);
  assert(notif7 && notif7.link === `/projects/${testProjectId}?tab=pipeline`, 'EVENT 7: Link is correct');
  assert(notif7 && notif7.read_status === 0, 'EVENT 7: read_status is 0');
  console.log(`   📋 [DB RECORD 7]: user=${notif7.user_id} event=${notif7.event_type} msg="${notif7.message}" link=${notif7.link} read=${notif7.read_status}`);

  const ws7 = designerWs.events.find(e => e.event === 'pipeline_addendum_fulfilled' || e.data?.type === 'pipeline_addendum_fulfilled');
  assert(ws7, 'EVENT 7: WS broadcast received with type pipeline_addendum_fulfilled');

  // -----------------------------------------------------------------
  // EVENT 8: Bug Ticket Raised (raiseAddendum BUG_TICKET)
  // -----------------------------------------------------------------
  console.log('\n--- EVENT 8: Bug Ticket Raised ---');
  developerWs.events.length = 0;
  adminWs.events.length = 0;

  const bugRes = await fetch(`${BASE_URL}/api/pipeline/deliverables/${deliverableId}/addendum`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${testerAuth.token}` },
    body: JSON.stringify({
      requesting_stage: 'TEST',
      target_stage: 'DEV',
      point_title: 'Auth token expiry loop',
      reason: 'Infinite refresh loop on 401 response',
      type: 'BUG_TICKET'
    })
  });
  const bugData = await bugRes.json();
  const bugId = bugData.id;
  assert(bugRes.status === 201 && bugId, 'POST /api/pipeline/deliverables/:id/addendum creates BUG_TICKET');

  await wait(50);

  // Check DB notification for Developer and Lead/Admin
  const notif8Dev = queryOne(`
    SELECT * FROM notifications 
    WHERE user_id = ? AND event_type = 'pipeline_bug_ticket_raised'
    ORDER BY created_at DESC LIMIT 1
  `, [developerAuth.user.id]);
  const notif8Admin = queryOne(`
    SELECT * FROM notifications 
    WHERE user_id = ? AND event_type = 'pipeline_bug_ticket_raised'
    ORDER BY created_at DESC LIMIT 1
  `, [adminAuth.user.id]);

  assert(notif8Dev, 'EVENT 8: DB record inserted for Developer member');
  assert(notif8Admin, 'EVENT 8: DB record inserted for Lead/Admin');
  assert(notif8Dev && notif8Dev.message === "🐛 Bug ticket raised against DEV point 'Auth token expiry loop' by Tester — revision required", 'EVENT 8: Message matches format', notif8Dev?.message);
  assert(notif8Dev && notif8Dev.link === `/projects/${testProjectId}?tab=pipeline`, 'EVENT 8: Link is correct');
  assert(notif8Dev && notif8Dev.read_status === 0, 'EVENT 8: read_status is 0');
  console.log(`   📋 [DB RECORD 8]: user=${notif8Dev.user_id} event=${notif8Dev.event_type} msg="${notif8Dev.message}" link=${notif8Dev.link} read=${notif8Dev.read_status}`);

  const ws8 = developerWs.events.find(e => e.event === 'pipeline_bug_ticket_raised' || e.data?.type === 'pipeline_bug_ticket_raised');
  assert(ws8, 'EVENT 8: WS broadcast received with type pipeline_bug_ticket_raised');

  // Reject the bug ticket to clear blockers
  await fetch(`${BASE_URL}/api/pipeline/addendum/${bugId}/reject`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminAuth.token}` },
    body: JSON.stringify({ reason: 'Resolved in patch' })
  });

  // -----------------------------------------------------------------
  // EVENT 9: All Deliverables Complete (Go-Live Ready)
  // -----------------------------------------------------------------
  console.log('\n--- EVENT 9: All Deliverables Complete (Go-Live Ready) ---');
  // Fast forward deliverable stages to TEST
  // 1. Add and approve DESIGN point
  const ptDesign = await fetch(`${BASE_URL}/api/pipeline/deliverables/${deliverableId}/points`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminAuth.token}` },
    body: JSON.stringify({ stage: 'DESIGN', point_title: 'Login UI Mockup', weight: 10 })
  }).then(r => r.json());
  await fetch(`${BASE_URL}/api/pipeline/points/${ptDesign.id}/claim`, { method: 'PATCH', headers: { Authorization: `Bearer ${designerAuth.token}` } });
  await fetch(`${BASE_URL}/api/pipeline/points/${ptDesign.id}/start`, { method: 'PATCH', headers: { Authorization: `Bearer ${designerAuth.token}` } });
  await fetch(`${BASE_URL}/api/pipeline/points/${ptDesign.id}/submit`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${designerAuth.token}` }, body: JSON.stringify({ asset_url: 'https://figma.com/test' }) });
  await fetch(`${BASE_URL}/api/pipeline/points/${ptDesign.id}/approve`, { method: 'PATCH', headers: { Authorization: `Bearer ${adminAuth.token}` } });

  // Handoff DESIGN -> DEV
  await fetch(`${BASE_URL}/api/pipeline/deliverables/${deliverableId}/handoff`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminAuth.token}` },
    body: JSON.stringify({ from_stage: 'DESIGN', to_stage: 'DEV', handoff_notes: 'Design ready' })
  });

  // 2. Add and approve DEV point
  const ptDev = await fetch(`${BASE_URL}/api/pipeline/deliverables/${deliverableId}/points`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminAuth.token}` },
    body: JSON.stringify({ stage: 'DEV', point_title: 'Auth Controller Implementation', weight: 10 })
  }).then(r => r.json());
  await fetch(`${BASE_URL}/api/pipeline/points/${ptDev.id}/claim`, { method: 'PATCH', headers: { Authorization: `Bearer ${developerAuth.token}` } });
  await fetch(`${BASE_URL}/api/pipeline/points/${ptDev.id}/start`, { method: 'PATCH', headers: { Authorization: `Bearer ${developerAuth.token}` } });
  await fetch(`${BASE_URL}/api/pipeline/points/${ptDev.id}/submit`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${developerAuth.token}` }, body: JSON.stringify({ asset_url: 'https://github.com/test' }) });
  await fetch(`${BASE_URL}/api/pipeline/points/${ptDev.id}/approve`, { method: 'PATCH', headers: { Authorization: `Bearer ${adminAuth.token}` } });

  // Handoff DEV -> TEST
  await fetch(`${BASE_URL}/api/pipeline/deliverables/${deliverableId}/handoff`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminAuth.token}` },
    body: JSON.stringify({ from_stage: 'DEV', to_stage: 'TEST', handoff_notes: 'Dev completed' })
  });

  // 3. Add and approve TEST point
  const ptTest = await fetch(`${BASE_URL}/api/pipeline/deliverables/${deliverableId}/points`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminAuth.token}` },
    body: JSON.stringify({ stage: 'TEST', point_title: 'Auth E2E Test Suite', weight: 10 })
  }).then(r => r.json());
  await fetch(`${BASE_URL}/api/pipeline/points/${ptTest.id}/claim`, { method: 'PATCH', headers: { Authorization: `Bearer ${testerAuth.token}` } });
  await fetch(`${BASE_URL}/api/pipeline/points/${ptTest.id}/start`, { method: 'PATCH', headers: { Authorization: `Bearer ${testerAuth.token}` } });
  await fetch(`${BASE_URL}/api/pipeline/points/${ptTest.id}/submit`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${testerAuth.token}` }, body: JSON.stringify({ asset_url: 'https://ci.example.com/tests' }) });
  await fetch(`${BASE_URL}/api/pipeline/points/${ptTest.id}/approve`, { method: 'PATCH', headers: { Authorization: `Bearer ${adminAuth.token}` } });

  adminWs.events.length = 0;

  // Final handoff: TEST -> COMPLETE
  const handoffFinal = await fetch(`${BASE_URL}/api/pipeline/deliverables/${deliverableId}/handoff`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminAuth.token}` },
    body: JSON.stringify({ from_stage: 'TEST', to_stage: 'COMPLETE', handoff_notes: 'All tracks tested and signed off' })
  });
  assert(handoffFinal.status === 201, 'POST handoff TEST -> COMPLETE succeeds');

  await wait(50);

  // Check EVENT 9 DB notification for platform admins
  const notif9 = queryOne(`
    SELECT * FROM notifications 
    WHERE user_id = ? AND event_type = 'pipeline_project_ready_for_live'
    ORDER BY created_at DESC LIMIT 1
  `, [adminAuth.user.id]);
  assert(notif9, 'EVENT 9: DB record inserted for Admin when all deliverables COMPLETE');
  assert(notif9 && notif9.message === "🚀 All deliverables complete — project 'PRD 15 Workflow Project' is ready for Go-Live approval", 'EVENT 9: Message matches format', notif9?.message);
  assert(notif9 && notif9.link === '/admin/pipeline', 'EVENT 9: Link is /admin/pipeline');
  assert(notif9 && notif9.read_status === 0, 'EVENT 9: read_status is 0');
  console.log(`   📋 [DB RECORD 9]: user=${notif9.user_id} event=${notif9.event_type} msg="${notif9.message}" link=${notif9.link} read=${notif9.read_status}`);

  const ws9 = adminWs.events.find(e => e.event === 'pipeline_project_ready_for_live' || e.data?.type === 'pipeline_project_ready_for_live');
  assert(ws9, 'EVENT 9: WS broadcast received with type pipeline_project_ready_for_live');

  // -----------------------------------------------------------------
  // EVENT 10: Go-Live Approved (adminApproveLive)
  // -----------------------------------------------------------------
  console.log('\n--- EVENT 10: Go-Live Approved (adminApproveLive) ---');
  adminWs.events.length = 0;
  researcherWs.events.length = 0;
  developerWs.events.length = 0;
  designerWs.events.length = 0;
  testerWs.events.length = 0;

  const liveRes = await fetch(`${BASE_URL}/api/admin/projects/${testProjectId}/pipeline/approve-live`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminAuth.token}` },
    body: JSON.stringify({ approval_notes: 'Production deployment authorized by Board.' })
  });
  assert(liveRes.status === 200, 'PATCH /api/admin/projects/:id/pipeline/approve-live succeeds');

  await wait(50);

  // Check EVENT 10 DB notification for all project members
  const memberIds = [adminAuth.user.id, researcherAuth.user.id, developerAuth.user.id, designerAuth.user.id, testerAuth.user.id];
  for (const uId of memberIds) {
    const notif10 = queryOne(`
      SELECT * FROM notifications 
      WHERE user_id = ? AND event_type = 'pipeline_project_live'
      ORDER BY created_at DESC LIMIT 1
    `, [uId]);
    assert(notif10, `EVENT 10: DB record inserted for member ${uId}`);
    assert(notif10 && notif10.message === "🎉 Project 'PRD 15 Workflow Project' has gone LIVE! Admin approval granted.", 'EVENT 10: Message matches format', notif10?.message);
    assert(notif10 && notif10.link === `/projects/${testProjectId}`, 'EVENT 10: Link is /projects/:id');
    assert(notif10 && notif10.read_status === 0, 'EVENT 10: read_status is 0');
    console.log(`   📋 [DB RECORD 10]: user=${notif10.user_id} event=${notif10.event_type} msg="${notif10.message}" link=${notif10.link} read=${notif10.read_status}`);
  }

  const ws10 = researcherWs.events.find(e => e.event === 'pipeline_project_live' || e.data?.type === 'pipeline_project_live');
  assert(ws10, 'EVENT 10: WS broadcast received with type pipeline_project_live');

  console.log('\n===================================================================');
  console.log(`  ALL LAYER 5 NOTIFICATION & WS CHECKS PASSED: ${passedCount} / ${totalCount}`);
  console.log('===================================================================');

} catch (err) {
  console.error('\n❌ VERIFICATION EXCEPTION:', err);
  process.exit(1);
} finally {
  for (const s of openSockets) {
    try { s.close(); } catch (e) {}
  }
  try {
    const adminHash = await bcrypt.hash('AdminPassword@2026', config.BCRYPT_SALT_ROUNDS);
    execute('UPDATE users SET password_hash = ?, status = ? WHERE email = ?', [adminHash, 'active', 'admin@mahitechgroup.com']);
  } catch (e) {}
  server.close();
  process.exit(0);
}
