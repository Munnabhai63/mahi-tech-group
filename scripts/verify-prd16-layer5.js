import http from 'node:http';
import crypto from 'node:crypto';
import { WebSocket } from 'ws';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app.js';
import { initWebSocketServer } from '../src/services/wsService.js';
import { queryOne, queryAll, execute } from '../src/db/database.js';
import { config } from '../src/config.js';
import { applyParticipationBlocks } from '../src/services/pointPoolService.js';

console.log('===================================================================');
console.log('         PRD 16 — LAYER 5: WEBSOCKET + DB NOTIFICATIONS SUITE');
console.log('===================================================================\n');

let totalTests = 0;
let passedTests = 0;

function assert(condition, testName, statusCode = null, details = '') {
  totalTests++;
  const statusStr = statusCode !== null ? `[HTTP ${statusCode}] ` : '';
  if (condition) {
    passedTests++;
    console.log(`  ✅ PASS: ${statusStr}${testName}`);
    if (details) console.log(`     └─ ${details}`);
  } else {
    console.error(`  ❌ FAIL: ${statusStr}${testName}`);
    if (details) console.error(`     └─ ${details}`);
    process.exitCode = 1;
  }
}

// Spin up test server with real WebSocket engine
const app = createApp();
const server = http.createServer(app);
const wss = initWebSocketServer(server);

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();
const BASE_URL = `http://127.0.0.1:${port}`;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function connectWS(token) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${token}`);
    const events = [];
    ws.on('open', () => resolve({ ws, events }));
    ws.on('message', (msgRaw) => {
      try {
        const parsed = JSON.parse(msgRaw.toString());
        events.push(parsed);
      } catch (e) {}
    });
    ws.on('error', reject);
  });
}

function findEvent(events, eventType) {
  return events.find((e) => e.event === eventType || e.data?.type === eventType || e.type === eventType);
}

const openSockets = [];

try {
  const ts = Date.now();
  const dummyHash = '$2a$10$abcdefghijklmnopqrstuu';

  // 1. Setup Admin user
  let adminUser = queryOne("SELECT * FROM users WHERE role = 'admin' AND status = 'active' LIMIT 1;");
  if (!adminUser) {
    adminUser = {
      id: `admin-l5-${ts}`,
      name: 'Layer5 Admin',
      email: `admin.l5.${ts}@mahitechgroup.com`,
      role: 'admin'
    };
    execute(
      "INSERT INTO users (id, name, email, role, status, password_hash) VALUES (?, ?, ?, ?, 'active', ?);",
      [adminUser.id, adminUser.name, adminUser.email, adminUser.role, dummyHash]
    );
  }

  // 2. Setup Persona Users
  const leadUser = {
    id: `lead-l5-${ts}`,
    name: 'Layer5 Lead',
    email: `lead.l5.${ts}@mahitechgroup.com`,
    role: 'developer'
  };
  const resUser = {
    id: `res-l5-${ts}`,
    name: 'Layer5 Researcher',
    email: `res.l5.${ts}@mahitechgroup.com`,
    role: 'researcher'
  };
  const devUser = {
    id: `dev-l5-${ts}`,
    name: 'Layer5 Dev',
    email: `dev.l5.${ts}@mahitechgroup.com`,
    role: 'developer'
  };

  for (const u of [leadUser, resUser, devUser]) {
    execute(
      "INSERT INTO users (id, name, email, role, status, password_hash) VALUES (?, ?, ?, ?, 'active', ?);",
      [u.id, u.name, u.email, u.role, dummyHash]
    );
  }

  // Generate tokens and persistent sessions
  function createToken(user) {
    const sessionId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const token = jwt.sign(
      { userId: user.id, sessionId, role: user.role, email: user.email },
      config.JWT_SECRET || 'secret',
      { expiresIn: '24h' }
    );
    execute(
      "INSERT INTO sessions (id, user_id, token, expires_at, is_revoked, created_at) VALUES (?, ?, ?, ?, 0, CURRENT_TIMESTAMP);",
      [sessionId, user.id, token, expiresAt]
    );
    return token;
  }

  const adminToken = createToken(adminUser);
  const leadToken = createToken(leadUser);
  const resToken = createToken(resUser);
  const devToken = createToken(devUser);

  // 3. Setup Project, Deliverable & Points
  const ideaId = `idea-l5-${ts}`;
  execute(
    "INSERT INTO ideas (id, title, description, owner_id, status) VALUES (?, 'Layer 5 Project Idea', 'Test idea', ?, 'APPROVED');",
    [ideaId, leadUser.id]
  );

  const project = {
    id: `proj-l5-${ts}`,
    title: 'Layer 5 Realtime Project',
    owner_id: leadUser.id,
    current_stage: 'INTEGRATION',
    status: 'ACTIVE'
  };
  execute(
    "INSERT INTO projects (id, idea_id, title, owner_id, current_stage, status) VALUES (?, ?, ?, ?, ?, ?);",
    [project.id, ideaId, project.title, project.owner_id, project.current_stage, project.status]
  );

  // Add members
  execute("INSERT INTO project_members (id, project_id, user_id, role_in_project) VALUES (?, ?, ?, 'admin_reviewer');",
    [`pm-lead-${ts}`, project.id, leadUser.id]);
  execute("INSERT INTO project_members (id, project_id, user_id, role_in_project) VALUES (?, ?, ?, 'researcher');",
    [`pm-res-${ts}`, project.id, resUser.id]);
  execute("INSERT INTO project_members (id, project_id, user_id, role_in_project) VALUES (?, ?, ?, 'frontend_dev');",
    [`pm-dev-${ts}`, project.id, devUser.id]);

  const deliverable = {
    id: `del-l5-${ts}`,
    project_id: project.id,
    title: 'Layer 5 Deliverable',
    stage: 'RESEARCH',
    status: 'ACTIVE'
  };
  execute(
    "INSERT INTO pipeline_deliverables (id, project_id, title, current_stage, status, created_by) VALUES (?, ?, ?, ?, ?, ?);",
    [deliverable.id, deliverable.project_id, deliverable.title, deliverable.stage, deliverable.status, leadUser.id]
  );

  const point1 = {
    id: `pt1-l5-${ts}`,
    deliverable_id: deliverable.id,
    stage: 'RESEARCH',
    point_title: 'Point Alpha Research',
    point_description: 'Research deliverable checklist point',
    weight: 5,
    status: 'UNCLAIMED',
    created_by: adminUser.id
  };
  execute(
    "INSERT INTO pipeline_checklist_points (id, deliverable_id, stage, point_title, point_description, weight, status, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?);",
    [point1.id, point1.deliverable_id, point1.stage, point1.point_title, point1.point_description, point1.weight, point1.status, point1.created_by]
  );

  // Connect WebSockets for all personas
  const adminWS = await connectWS(adminToken);
  const leadWS = await connectWS(leadToken);
  const resWS = await connectWS(resToken);
  const devWS = await connectWS(devToken);
  openSockets.push(adminWS.ws, leadWS.ws, resWS.ws, devWS.ws);

  await wait(200); // Wait for real-time engine registration

  // ===================================================================
  // ASSERTION GROUP 1: pointpool_point_claimed (5 assertions)
  // ===================================================================
  console.log('--- ASSERTION GROUP 1: pointpool_point_claimed ---');

  // Researcher claims point1 via real HTTP request
  const claimRes = await fetch(`${BASE_URL}/api/pointpool/points/${point1.id}/claim`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${resToken}`, 'Content-Type': 'application/json' }
  });
  const claimBody = await claimRes.json();
  assert(claimRes.status === 200, 'Member claims point via HTTP PATCH /claim', claimRes.status, `Status: ${claimBody.status}`);

  await wait(250); // Allow DB insert + WS broadcast

  const notifClaimLead = queryOne(`
    SELECT *, event_type as type, read_status as is_read FROM notifications 
    WHERE user_id = ? AND event_type = 'pointpool_point_claimed' AND link LIKE ?
  `, [leadUser.id, `%${project.id}%`]);

  const notifClaimAdmin = queryOne(`
    SELECT *, event_type as type, read_status as is_read FROM notifications 
    WHERE user_id = ? AND event_type = 'pointpool_point_claimed' AND link LIKE ?
  `, [adminUser.id, `%${project.id}%`]);

  assert(Boolean(notifClaimLead), 'Claim a point → notification row inserted for Lead', null, `Lead Notif ID: ${notifClaimLead?.id}`);
  assert(Boolean(notifClaimAdmin), 'Claim a point → notification row inserted for Admin', null, `Admin Notif ID: ${notifClaimAdmin?.id}`);

  const leadClaimEvent = findEvent(leadWS.events, 'pointpool_point_claimed');
  const leadPayload = leadClaimEvent?.data || leadClaimEvent;
  assert(
    Boolean(leadClaimEvent) && leadPayload?.pointTitle === point1.point_title && leadPayload?.claimedBy?.userId === resUser.id,
    'Claim a point → WS message received by Lead with correct payload',
    null,
    `Payload: ${JSON.stringify(leadPayload?.claimedBy)}`
  );

  assert(
    notifClaimLead?.link === `/point-pool-board.html?projectId=${project.id}`,
    'Claim a point → notification link = correct URL',
    null,
    `Link: ${notifClaimLead?.link}`
  );

  assert(
    notifClaimLead?.is_read === 0 && notifClaimAdmin?.is_read === 0,
    'Claim a point → is_read = 0',
    null,
    `Lead is_read: ${notifClaimLead?.is_read}, Admin is_read: ${notifClaimAdmin?.is_read}`
  );

  // ===================================================================
  // ASSERTION GROUP 2: pointpool_point_released (5 assertions)
  // ===================================================================
  console.log('\n--- ASSERTION GROUP 2: pointpool_point_released ---');

  const releaseReason = 'Scope realignment by project lead';
  const releaseRes = await fetch(`${BASE_URL}/api/pointpool/points/${point1.id}/release`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${leadToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason: releaseReason })
  });
  const releaseBody = await releaseRes.json();
  assert(releaseRes.status === 200, 'Lead releases point via HTTP PATCH /release', releaseRes.status, `Status: ${releaseBody.status}`);

  await wait(250);

  const notifReleasePrev = queryOne(`
    SELECT *, event_type as type, read_status as is_read FROM notifications 
    WHERE user_id = ? AND event_type = 'pointpool_point_released' AND link LIKE ?
  `, [resUser.id, `%${project.id}%`]);

  assert(Boolean(notifReleasePrev), 'Release a point → notification row inserted for original claimer', null, `Claimer Notif ID: ${notifReleasePrev?.id}`);

  const resReleaseEvent = findEvent(resWS.events, 'pointpool_point_released');
  const resReleasePayload = resReleaseEvent?.data || resReleaseEvent;

  assert(
    resReleasePayload?.reason === releaseReason,
    'Release a point → notification includes release reason',
    null,
    `Reason: ${resReleasePayload?.reason}`
  );

  assert(
    Boolean(resReleaseEvent),
    'Release a point → WS message received by original claimer',
    null,
    `Event received: ${Boolean(resReleaseEvent)}`
  );

  assert(
    notifReleasePrev?.type === 'pointpool_point_released',
    'Release a point → notification type = "pointpool_point_released"',
    null,
    `Type: ${notifReleasePrev?.type}`
  );

  assert(
    notifReleasePrev?.link === `/point-pool-board.html?projectId=${project.id}`,
    'Release a point → notification link = correct URL',
    null,
    `Link: ${notifReleasePrev?.link}`
  );

  // ===================================================================
  // ASSERTION GROUP 3: pointpool_participation_warning (5 assertions)
  // ===================================================================
  console.log('\n--- ASSERTION GROUP 3: pointpool_participation_warning ---');

  // Trigger participation warning by calling GET /participation/me for resUser (resUser has 0% < 20% threshold)
  const warnRes = await fetch(`${BASE_URL}/api/pointpool/projects/${project.id}/participation/me`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${resToken}` }
  });
  const warnBody = await warnRes.json();
  assert(warnRes.status === 200, 'GET /participation/me succeeds and triggers warning evaluation', warnRes.status, `Overall: ${warnBody.overall}%`);

  await wait(250);

  const notifWarnMember = queryOne(`
    SELECT *, event_type as type, read_status as is_read FROM notifications 
    WHERE user_id = ? AND event_type = 'pointpool_participation_warning' AND link LIKE ?
  `, [resUser.id, `%${project.id}%`]);

  const notifWarnAdmin = queryOne(`
    SELECT *, event_type as type, read_status as is_read FROM notifications 
    WHERE user_id = ? AND event_type = 'pointpool_participation_warning' AND link LIKE ?
  `, [adminUser.id, `%${project.id}%`]);

  assert(Boolean(notifWarnMember), 'At-risk member detected → notification row inserted for member', null, `Notif ID: ${notifWarnMember?.id}`);
  assert(Boolean(notifWarnAdmin), 'At-risk member detected → notification row inserted for Admin', null, `Admin Notif ID: ${notifWarnAdmin?.id}`);

  assert(
    notifWarnMember?.message.includes('0%') && notifWarnMember?.message.includes('20%'),
    'Warning message includes actual % and threshold %',
    null,
    `Message: ${notifWarnMember?.message}`
  );

  // Deduplication check: call GET /participation/me again while unread warning exists
  const unreadCountBefore = queryOne(`
    SELECT COUNT(*) as cnt FROM notifications 
    WHERE user_id = ? AND event_type = 'pointpool_participation_warning' AND read_status = 0
  `, [resUser.id]).cnt;

  await fetch(`${BASE_URL}/api/pointpool/projects/${project.id}/participation/me`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${resToken}` }
  });
  await wait(150);

  const unreadCountAfter = queryOne(`
    SELECT COUNT(*) as cnt FROM notifications 
    WHERE user_id = ? AND event_type = 'pointpool_participation_warning' AND read_status = 0
  `, [resUser.id]).cnt;

  assert(
    unreadCountBefore === unreadCountAfter,
    'Deduplication: second call does NOT create duplicate unread warning',
    null,
    `Before: ${unreadCountBefore}, After: ${unreadCountAfter}`
  );

  // Mark first warning as read
  execute("UPDATE notifications SET read_status = 1 WHERE user_id = ? AND event_type = 'pointpool_participation_warning';", [resUser.id]);

  // Call GET /participation/me again -> new warning must be inserted
  await fetch(`${BASE_URL}/api/pointpool/projects/${project.id}/participation/me`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${resToken}` }
  });
  await wait(150);

  const unreadCountNew = queryOne(`
    SELECT COUNT(*) as cnt FROM notifications 
    WHERE user_id = ? AND event_type = 'pointpool_participation_warning' AND read_status = 0
  `, [resUser.id]).cnt;

  assert(
    unreadCountNew === 1,
    'After marking first warning read → new warning IS created',
    null,
    `New Unread Count: ${unreadCountNew}`
  );

  // ===================================================================
  // ASSERTION GROUP 4: pointpool_revenue_blocked (5 assertions)
  // ===================================================================
  console.log('\n--- ASSERTION GROUP 4: pointpool_revenue_blocked ---');

  // Create revenue event and split for resUser
  const revEvent = {
    id: `rev-ev-${ts}`,
    project_id: project.id,
    amount: 1000.0,
    source: 'CLIENT_PAYMENT',
    event_date: new Date().toISOString().slice(0, 10)
  };
  execute(
    "INSERT INTO revenue_events (id, project_id, amount, source, event_date) VALUES (?, ?, ?, ?, ?);",
    [revEvent.id, revEvent.project_id, revEvent.amount, revEvent.source, revEvent.event_date]
  );

  const revSplit = {
    id: `split-l5-${ts}`,
    revenue_event_id: revEvent.id,
    user_id: resUser.id,
    amount: 250.0,
    rule_applied: 'OWNER_50_TEAM_50',
    is_blocked: 0
  };
  execute(
    "INSERT INTO revenue_splits (id, revenue_event_id, user_id, amount, rule_applied, is_blocked) VALUES (?, ?, ?, ?, ?, 0);",
    [revSplit.id, revSplit.revenue_event_id, revSplit.user_id, revSplit.amount, revSplit.rule_applied]
  );

  // Apply participation blocks
  applyParticipationBlocks(project.id);
  await wait(250);

  const notifBlockMember = queryOne(`
    SELECT *, event_type as type, read_status as is_read FROM notifications 
    WHERE user_id = ? AND event_type = 'pointpool_revenue_blocked' AND link LIKE ?
  `, [resUser.id, `%${project.id}%`]);

  const notifBlockAdmin = queryOne(`
    SELECT *, event_type as type, read_status as is_read FROM notifications 
    WHERE user_id = ? AND event_type = 'pointpool_revenue_blocked' AND link LIKE ?
  `, [adminUser.id, `%${project.id}%`]);

  assert(Boolean(notifBlockMember), 'Block applied → notification row inserted for blocked member', null, `Notif ID: ${notifBlockMember?.id}`);
  assert(Boolean(notifBlockAdmin), 'Block applied → notification row inserted for Admin', null, `Admin Notif ID: ${notifBlockAdmin?.id}`);

  const blockEvent = findEvent(resWS.events, 'pointpool_revenue_blocked');
  assert(Boolean(blockEvent), 'Block applied → WS message received by blocked member', null, `Event found: ${Boolean(blockEvent)}`);

  assert(
    notifBlockMember?.message.includes('0%') && notifBlockMember?.message.includes('20%'),
    'Block notification message includes participation % and threshold',
    null,
    `Message: ${notifBlockMember?.message}`
  );

  assert(
    notifBlockMember?.type === 'pointpool_revenue_blocked',
    'Block notification type = "pointpool_revenue_blocked"',
    null,
    `Type: ${notifBlockMember?.type}`
  );

  // ===================================================================
  // ASSERTION GROUP 5: pointpool_revenue_unblocked (5 assertions)
  // ===================================================================
  console.log('\n--- ASSERTION GROUP 5: pointpool_revenue_unblocked ---');

  const unblockReason = 'Medical leave documented and approved by Admin';
  const unblockRes = await fetch(`${BASE_URL}/api/pointpool/revenue-splits/${revSplit.id}/unblock`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason: unblockReason })
  });
  const unblockBody = await unblockRes.json();
  assert(unblockRes.status === 200, 'Admin unblocks revenue split via HTTP PATCH /unblock', unblockRes.status, `is_blocked: ${unblockBody.is_blocked}`);

  await wait(250);

  const notifUnblockMember = queryOne(`
    SELECT *, event_type as type, read_status as is_read FROM notifications 
    WHERE user_id = ? AND event_type = 'pointpool_revenue_unblocked' AND link LIKE ?
  `, [resUser.id, `%${project.id}%`]);

  assert(Boolean(notifUnblockMember), 'Unblock applied → notification row inserted for unblocked member', null, `Notif ID: ${notifUnblockMember?.id}`);

  assert(
    notifUnblockMember?.message.includes(unblockReason),
    "Unblock notification includes Admin's reason",
    null,
    `Message: ${notifUnblockMember?.message}`
  );

  const unblockEvent = findEvent(resWS.events, 'pointpool_revenue_unblocked');
  const unblockPayload = unblockEvent?.data || unblockEvent;

  assert(
    unblockPayload?.unblockedBy?.username === adminUser.name,
    'Unblock notification includes unblockedBy username',
    null,
    `UnblockedBy: ${JSON.stringify(unblockPayload?.unblockedBy)}`
  );

  assert(
    Boolean(unblockEvent),
    'Unblock → WS message received by unblocked member',
    null,
    `Event found: ${Boolean(unblockEvent)}`
  );

  assert(
    notifUnblockMember?.type === 'pointpool_revenue_unblocked',
    'Unblock notification type = "pointpool_revenue_unblocked"',
    null,
    `Type: ${notifUnblockMember?.type}`
  );

  console.log('\n===================================================================');
  console.log(`  PRD 16 LAYER 5 VERIFICATION COMPLETE: ${passedTests}/${totalTests} TESTS PASSED`);
  console.log('===================================================================\n');

} catch (err) {
  console.error('Fatal Test Execution Error:', err);
  process.exitCode = 1;
} finally {
  for (const s of openSockets) {
    try { s.close(); } catch (e) {}
  }
  wss.close();
  server.close();
}
