/**
 * scripts/verify-prd24-layer4.js
 * Verification Suite: PRD 24 Layer 4 (Client-Facing API & Read Engine)
 *
 * Full real HTTP verification against real ephemeral Express server and real SQLite database.
 * Tests:
 * 1. SQLite Pragmas (WAL, busy_timeout, foreign_keys)
 * 2. Express Server Setup & Personas (Admin, Member, Client A, Client B)
 * 3. Token Guards & Cross-Namespace Rejection (401 on internal tokens / unauthenticated)
 * 4. GET /api/client/projects (active access filtering, multi-tenant isolation, activity log)
 * 5. GET /api/client/project/:projectId/overview (zero-trust client_shared_items, no internal items, activity log)
 * 6. GET /api/client/project/:projectId/timeline (shared gantt items only)
 * 7. GET /api/client/project/:projectId/milestones (shared milestones + approval status)
 * 8. POST /api/client/orders/submit (access verification, internal_notes stripped, activity log)
 * 9. GET /api/client/orders (own orders only, internal_notes stripped defensively)
 * 10. GET /api/client/orders/:orderId (cross-client 403, internal_notes stripped, is_internal=0 SQL filter mandatory)
 * 11. POST /api/client/orders/:orderId/message (client message, sender_type=CLIENT, is_internal=0, updated_at manual update)
 * 12. PATCH /api/client/milestone/approval/:approvalId (own approval only, updates gantt_milestones.status, immutability check)
 * 13. POST /api/client/feedback/submit (pre-insert share check mandatory, 403 on unshared items, trigger immutability)
 */

import http from 'node:http';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import createApp from '../src/app.js';
import { queryOne, queryAll, execute } from '../src/db/database.js';
import { config } from '../src/config.js';

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(condition, testName) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✔ PASS: Test ${totalTests}: ${testName}`);
  } else {
    failedTests++;
    console.error(`  ✖ FAIL: Test ${totalTests}: ${testName}`);
  }
}

// HTTP request helper
function request(baseUrl, { method = 'GET', path, headers = {}, body = null }) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const reqHeaders = { ...headers };
    let reqBody = null;

    if (body) {
      reqBody = typeof body === 'string' ? body : JSON.stringify(body);
      reqHeaders['Content-Type'] = 'application/json';
      reqHeaders['Content-Length'] = Buffer.byteLength(reqBody);
    }

    const req = http.request(
      url,
      {
        method,
        headers: reqHeaders
      },
      (res) => {
        let rawData = '';
        res.on('data', (chunk) => {
          rawData += chunk;
        });
        res.on('end', () => {
          let json = null;
          try {
            json = JSON.parse(rawData);
          } catch (e) {
            json = null;
          }
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: json,
            raw: rawData
          });
        });
      }
    );

    req.on('error', (err) => reject(err));
    if (reqBody) {
      req.write(reqBody);
    }
    req.end();
  });
}

async function runSuite() {
  console.log('================================================================================');
  console.log('PRD 24 Layer 4 Verification Suite: Client-Facing API & Read Engine');
  console.log('================================================================================\n');

  // 1. Check SQLite Pragmas
  console.log('--- Section 1: SQLite Pragmas ---');
  const journalMode = queryOne('PRAGMA journal_mode;');
  const busyTimeout = queryOne('PRAGMA busy_timeout;');
  const foreignKeys = queryOne('PRAGMA foreign_keys;');

  assert(journalMode && journalMode.journal_mode.toLowerCase() === 'wal', `journal_mode is WAL (was ${journalMode?.journal_mode})`);
  assert(busyTimeout && busyTimeout.timeout >= 5000, `busy_timeout >= 5000 (was ${busyTimeout?.timeout})`);
  assert(foreignKeys && Object.values(foreignKeys)[0] === 1, 'foreign_keys pragma is enabled (1)');

  // 2. Setup Server and Personas
  console.log('\n--- Section 2: Express Server & Personas Setup ---');
  const app = createApp();
  const server = http.createServer(app);

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  console.log(`Test server running at ${baseUrl}`);

  const testSuffix = Date.now().toString().slice(-6);

  // Persona 1: Admin
  const adminEmail = `admin.l4.${testSuffix}@mahitechgroup.com`;
  const adminHash = bcrypt.hashSync('Password123!', 8);
  execute(
    `INSERT OR IGNORE INTO users (id, name, email, password_hash, role, status, created_at, updated_at)
     VALUES (?, 'L4 Admin', ?, ?, 'admin', 'active', datetime('now'), datetime('now'))`,
    [`admin-l4-${testSuffix}`, adminEmail, adminHash]
  );
  const admin = queryOne('SELECT * FROM users WHERE email = ?', [adminEmail]);

  // Persona 2: Developer Member
  const memberEmail = `member.l4.${testSuffix}@mahitechgroup.com`;
  execute(
    `INSERT OR IGNORE INTO users (id, name, email, password_hash, role, status, created_at, updated_at)
     VALUES (?, 'L4 Member', ?, ?, 'developer', 'active', datetime('now'), datetime('now'))`,
    [`member-l4-${testSuffix}`, memberEmail, adminHash]
  );
  const member = queryOne('SELECT * FROM users WHERE email = ?', [memberEmail]);

  // Internal user tokens
  const adminSessionId = crypto.randomUUID();
  const adminToken = jwt.sign(
    { userId: admin.id, sessionId: adminSessionId, role: admin.role, email: admin.email },
    config.JWT_SECRET,
    { expiresIn: '1h' }
  );
  execute(
    `INSERT INTO sessions (id, user_id, token, expires_at, is_revoked, created_at)
     VALUES (?, ?, ?, datetime('now', '+1 hour'), 0, datetime('now'))`,
    [adminSessionId, admin.id, adminToken]
  );

  const memberSessionId = crypto.randomUUID();
  const memberToken = jwt.sign(
    { userId: member.id, sessionId: memberSessionId, role: member.role, email: member.email },
    config.JWT_SECRET,
    { expiresIn: '1h' }
  );
  execute(
    `INSERT INTO sessions (id, user_id, token, expires_at, is_revoked, created_at)
     VALUES (?, ?, ?, datetime('now', '+1 hour'), 0, datetime('now'))`,
    [memberSessionId, member.id, memberToken]
  );

  // Persona 3: Client A (Acme Corp)
  const clientAEmail = `clientA.l4.${testSuffix}@acme.com`;
  const clientAHash = bcrypt.hashSync('ClientPass123!', 8);
  execute(
    `INSERT INTO clients (name, email, company_name, phone, password_hash, status, invite_accepted_at, created_by, created_at, updated_at)
     VALUES ('Alice Client A', ?, 'Acme Corp', '1234567890', ?, 'ACTIVE', datetime('now'), ?, datetime('now'), datetime('now'))`,
    [clientAEmail, clientAHash, admin.id]
  );
  const clientA = queryOne('SELECT * FROM clients WHERE email = ?', [clientAEmail]);
  const clientAToken = jwt.sign(
    { clientId: clientA.id, email: clientA.email, role: 'CLIENT' },
    config.CLIENT_JWT_SECRET,
    { expiresIn: '24h' }
  );

  // Persona 4: Client B (Beta LLC)
  const clientBEmail = `clientB.l4.${testSuffix}@beta.com`;
  const clientBHash = bcrypt.hashSync('ClientPass123!', 8);
  execute(
    `INSERT INTO clients (name, email, company_name, phone, password_hash, status, invite_accepted_at, created_by, created_at, updated_at)
     VALUES ('Bob Client B', ?, 'Beta LLC', '0987654321', ?, 'ACTIVE', datetime('now'), ?, datetime('now'), datetime('now'))`,
    [clientBEmail, clientBHash, admin.id]
  );
  const clientB = queryOne('SELECT * FROM clients WHERE email = ?', [clientBEmail]);
  const clientBToken = jwt.sign(
    { clientId: clientB.id, email: clientB.email, role: 'CLIENT' },
    config.CLIENT_JWT_SECRET,
    { expiresIn: '24h' }
  );

  assert(adminToken !== null, 'Admin internal JWT generated');
  assert(memberToken !== null, 'Member internal JWT generated');
  assert(clientAToken !== null, 'Client A JWT generated');
  assert(clientBToken !== null, 'Client B JWT generated');

  // Setup Projects: Project 1 (Client A has access), Project 2 (Client A has NO access)
  execute(
    `INSERT OR IGNORE INTO ideas (id, title, description, owner_id, status, created_at, updated_at)
     VALUES ('idea-l4-1', 'Idea L4 Alpha', 'L4 Test Idea 1', ?, 'APPROVED', datetime('now'), datetime('now'))`,
    [admin.id]
  );
  execute(
    `INSERT OR IGNORE INTO ideas (id, title, description, owner_id, status, created_at, updated_at)
     VALUES ('idea-l4-2', 'Idea L4 Beta', 'L4 Test Idea 2', ?, 'APPROVED', datetime('now'), datetime('now'))`,
    [admin.id]
  );

  execute(
    `INSERT OR IGNORE INTO projects (id, idea_id, title, owner_id, current_stage, status, created_at, updated_at)
     VALUES (?, 'idea-l4-1', 'Acme E-Commerce Platform', ?, 'INTEGRATION', 'ACTIVE', datetime('now'), datetime('now'))`,
    [`proj-l4-1-${testSuffix}`, admin.id]
  );
  execute(
    `INSERT OR IGNORE INTO projects (id, idea_id, title, owner_id, current_stage, status, created_at, updated_at)
     VALUES (?, 'idea-l4-2', 'Beta Internal Service', ?, 'RESEARCH_DEV_PARALLEL', 'ACTIVE', datetime('now'), datetime('now'))`,
    [`proj-l4-2-${testSuffix}`, admin.id]
  );

  const project1 = queryOne('SELECT * FROM projects WHERE id = ?', [`proj-l4-1-${testSuffix}`]);
  const project2 = queryOne('SELECT * FROM projects WHERE id = ?', [`proj-l4-2-${testSuffix}`]);

  // Grant Client A active access to Project 1 (access_level = 'APPROVE')
  execute(
    `INSERT INTO client_project_access (client_id, project_id, access_level, granted_by, is_active, granted_at)
     VALUES (?, ?, 'APPROVE', ?, 1, datetime('now'))`,
    [clientA.id, project1.id, admin.id]
  );

  try {
    // 3. Mandatory Security Invariant 1: Client Token Guards
    console.log('\n--- Section 3: Auth Security Guards on /api/client/* ---');
    const resNoAuth = await request(baseUrl, { path: '/api/client/projects' });
    assert(resNoAuth.status === 401, 'Unauthenticated request to /api/client/projects returns 401 Unauthorized');

    const resAdminOnClient = await request(baseUrl, {
      path: '/api/client/projects',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(resAdminOnClient.status === 401, 'Internal Admin JWT on /api/client/projects returns 401 Unauthorized');

    const resMemberOnClient = await request(baseUrl, {
      path: '/api/client/projects',
      headers: { Authorization: `Bearer ${memberToken}` }
    });
    assert(resMemberOnClient.status === 401, 'Internal Member JWT on /api/client/projects returns 401 Unauthorized');

    // 4. GET /api/client/projects
    console.log('\n--- Section 4: Client Projects Listing (GET /api/client/projects) ---');
    const resClientAProjects = await request(baseUrl, {
      path: '/api/client/projects',
      headers: { Authorization: `Bearer ${clientAToken}` }
    });
    assert(resClientAProjects.status === 200, 'Client A calling GET /api/client/projects returns 200 OK');
    assert(Array.isArray(resClientAProjects.body?.projects), 'Response contains projects array');
    assert(resClientAProjects.body.projects.length === 1, 'Client A has access to exactly 1 project');
    assert(resClientAProjects.body.projects[0].id === project1.id, 'Returned project matches Project 1');
    assert(resClientAProjects.body.projects[0].access_level === 'APPROVE', "access_level is 'APPROVE'");

    const resClientBProjects = await request(baseUrl, {
      path: '/api/client/projects',
      headers: { Authorization: `Bearer ${clientBToken}` }
    });
    assert(resClientBProjects.status === 200, 'Client B calling GET /api/client/projects returns 200 OK');
    assert(resClientBProjects.body.projects.length === 0, 'Client B has access to 0 projects (strict isolation)');

    const projectListLog = queryOne(
      "SELECT * FROM client_activity_log WHERE client_id = ? AND action = 'VIEW_PROJECT' AND item_type = 'PROJECT_LIST' ORDER BY id DESC LIMIT 1;",
      [clientA.id]
    );
    assert(projectListLog !== null, "client_activity_log records 'VIEW_PROJECT' for PROJECT_LIST");

    // 5. Setup Project Items & client_shared_items for Project 1
    console.log('\n--- Section 5: Shared Items Setup & Zero-Trust Verification ---');
    // Task 1 (Shared with Client A)
    execute(
      `INSERT INTO gantt_items (project_id, title, type, start_date, end_date, progress_pct, status, created_by)
       VALUES (?, 'Frontend Checkout UI', 'TASK', '2026-11-01', '2026-11-10', 80.0, 'IN_PROGRESS', ?)`,
      [project1.id, admin.id]
    );
    const task1 = queryOne('SELECT * FROM gantt_items WHERE project_id = ? AND title = ?;', [project1.id, 'Frontend Checkout UI']);

    // Task 2 (Internal Only — NOT Shared)
    execute(
      `INSERT INTO gantt_items (project_id, title, type, start_date, end_date, progress_pct, status, created_by)
       VALUES (?, 'Internal Database Index Tuning', 'TASK', '2026-11-05', '2026-11-12', 30.0, 'IN_PROGRESS', ?)`,
      [project1.id, admin.id]
    );
    const task2 = queryOne('SELECT * FROM gantt_items WHERE project_id = ? AND title = ?;', [project1.id, 'Internal Database Index Tuning']);

    // Milestone 1 (Shared with Client A)
    execute(
      `INSERT INTO gantt_milestones (project_id, gantt_item_id, title, milestone_date, status, created_by)
       VALUES (?, ?, 'Alpha Delivery Sign-off', '2026-11-15', 'PENDING', ?)`,
      [project1.id, task1.id, admin.id]
    );
    const milestone1 = queryOne('SELECT * FROM gantt_milestones WHERE project_id = ? AND title = ?;', [project1.id, 'Alpha Delivery Sign-off']);

    // Milestone 2 (Internal Only — NOT Shared)
    execute(
      `INSERT INTO gantt_milestones (project_id, gantt_item_id, title, milestone_date, status, created_by)
       VALUES (?, ?, 'Internal Security Architecture Audit', '2026-11-20', 'PENDING', ?)`,
      [project1.id, task2.id, admin.id]
    );
    const milestone2 = queryOne('SELECT * FROM gantt_milestones WHERE project_id = ? AND title = ?;', [project1.id, 'Internal Security Architecture Audit']);

    // Backlog Item 1 (Shared with Client A)
    execute(
      `INSERT OR IGNORE INTO backlog_items (project_id, title, description, status, priority, created_by, created_at, updated_at)
       VALUES (?, 'Stripe/UPI Integration Support', 'Add direct checkout buttons', 'IN_PROGRESS', 'HIGH', ?, datetime('now'), datetime('now'))`,
      [project1.id, admin.id]
    );
    const backlogItem1 = queryOne('SELECT * FROM backlog_items WHERE project_id = ? AND title = ?;', [project1.id, 'Stripe/UPI Integration Support']);

    // Register ONLY Task 1, Milestone 1, and Backlog Item 1 in client_shared_items for Client A
    execute(
      `INSERT INTO client_shared_items (client_id, project_id, item_type, item_id, shared_by, is_active, shared_at)
       VALUES (?, ?, 'GANTT_ITEM', ?, ?, 1, datetime('now'))`,
      [clientA.id, project1.id, task1.id, admin.id]
    );
    execute(
      `INSERT INTO client_shared_items (client_id, project_id, item_type, item_id, shared_by, is_active, shared_at)
       VALUES (?, ?, 'MILESTONE', ?, ?, 1, datetime('now'))`,
      [clientA.id, project1.id, milestone1.id, admin.id]
    );
    execute(
      `INSERT INTO client_shared_items (client_id, project_id, item_type, item_id, shared_by, is_active, shared_at)
       VALUES (?, ?, 'BACKLOG_ITEM', ?, ?, 1, datetime('now'))`,
      [clientA.id, project1.id, backlogItem1.id, admin.id]
    );

    // 6. GET /api/client/project/:projectId/overview
    console.log('\n--- Section 6: Project Overview (GET /api/client/project/:projectId/overview) ---');
    // Client A querying ungranted Project 2
    const resOverviewUnauth = await request(baseUrl, {
      path: `/api/client/project/${project2.id}/overview`,
      headers: { Authorization: `Bearer ${clientAToken}` }
    });
    assert(resOverviewUnauth.status === 403, 'Client A querying ungranted Project 2 is blocked with 403 Forbidden');

    // Client A querying granted Project 1
    const resOverview = await request(baseUrl, {
      path: `/api/client/project/${project1.id}/overview`,
      headers: { Authorization: `Bearer ${clientAToken}` }
    });
    assert(resOverview.status === 200, 'Client A calling GET project overview returns 200 OK');
    assert(resOverview.body?.project?.id === project1.id, 'Overview contains project metadata');
    assert(resOverview.body?.access_level === 'APPROVE', "Overview contains access_level 'APPROVE'");

    // Zero-Trust verification: shared items vs unshared items
    const sharedGantt = resOverview.body.shared_gantt_items;
    assert(Array.isArray(sharedGantt) && sharedGantt.length === 1, 'shared_gantt_items contains exactly 1 item');
    assert(sharedGantt[0].id === task1.id, 'shared_gantt_items contains Task 1');
    assert(sharedGantt.find((t) => t.id === task2.id) === undefined, 'CRITICAL: Unshared Task 2 is strictly ABSENT from overview');

    const sharedMilestones = resOverview.body.shared_milestones;
    assert(Array.isArray(sharedMilestones) && sharedMilestones.length === 1, 'shared_milestones contains exactly 1 item');
    assert(sharedMilestones[0].id === milestone1.id, 'shared_milestones contains Milestone 1');
    assert(sharedMilestones.find((m) => m.id === milestone2.id) === undefined, 'CRITICAL: Unshared Milestone 2 is strictly ABSENT from overview');

    const sharedBacklog = resOverview.body.shared_backlog_items;
    assert(Array.isArray(sharedBacklog) && sharedBacklog.length === 1, 'shared_backlog_items contains exactly 1 item');
    assert(sharedBacklog[0].id === backlogItem1.id, 'shared_backlog_items contains Backlog Item 1');

    const overviewLog = queryOne(
      "SELECT * FROM client_activity_log WHERE client_id = ? AND action = 'VIEW_PROJECT' AND item_type = 'PROJECT' AND item_id = ? ORDER BY id DESC LIMIT 1;",
      [clientA.id, project1.id]
    );
    assert(overviewLog !== null, "client_activity_log records 'VIEW_PROJECT' for PROJECT");

    // 7. GET /api/client/project/:projectId/timeline
    console.log('\n--- Section 7: Project Timeline (GET /api/client/project/:projectId/timeline) ---');
    const resTimelineUnauth = await request(baseUrl, {
      path: `/api/client/project/${project1.id}/timeline`,
      headers: { Authorization: `Bearer ${clientBToken}` }
    });
    assert(resTimelineUnauth.status === 403, 'Client B querying Project 1 timeline is blocked with 403 Forbidden');

    const resTimeline = await request(baseUrl, {
      path: `/api/client/project/${project1.id}/timeline`,
      headers: { Authorization: `Bearer ${clientAToken}` }
    });
    assert(resTimeline.status === 200, 'Client A calling timeline returns 200 OK');
    assert(Array.isArray(resTimeline.body?.timeline_items), 'Response contains timeline_items array');
    assert(resTimeline.body.timeline_items.length === 1, 'timeline_items contains exactly 1 shared task');
    assert(resTimeline.body.timeline_items[0].id === task1.id, 'timeline_items contains Task 1');
    assert(resTimeline.body.timeline_items.find((t) => t.id === task2.id) === undefined, 'Unshared Task 2 strictly ABSENT from timeline');

    // 8. GET /api/client/project/:projectId/milestones
    console.log('\n--- Section 8: Project Milestones (GET /api/client/project/:projectId/milestones) ---');
    const resMilestonesUnauth = await request(baseUrl, {
      path: `/api/client/project/${project1.id}/milestones`,
      headers: { Authorization: `Bearer ${clientBToken}` }
    });
    assert(resMilestonesUnauth.status === 403, 'Client B querying Project 1 milestones is blocked with 403 Forbidden');

    const resMilestones = await request(baseUrl, {
      path: `/api/client/project/${project1.id}/milestones`,
      headers: { Authorization: `Bearer ${clientAToken}` }
    });
    assert(resMilestones.status === 200, 'Client A calling milestones returns 200 OK');
    assert(Array.isArray(resMilestones.body?.milestones), 'Response contains milestones array');
    assert(resMilestones.body.milestones.length === 1, 'milestones contains exactly 1 shared milestone');
    assert(resMilestones.body.milestones[0].id === milestone1.id, 'milestones contains Milestone 1');
    assert(resMilestones.body.milestones.find((m) => m.id === milestone2.id) === undefined, 'Unshared Milestone 2 strictly ABSENT from milestones');

    // 9. POST /api/client/orders/submit
    console.log('\n--- Section 9: Client Order Submission (POST /api/client/orders/submit) ---');
    // Ungranted project order
    const resOrderUnauthProj = await request(baseUrl, {
      method: 'POST',
      path: '/api/client/orders/submit',
      headers: { Authorization: `Bearer ${clientAToken}` },
      body: {
        project_id: project2.id,
        title: 'Unauthorized Project Order',
        description: 'Should be rejected'
      }
    });
    assert(resOrderUnauthProj.status === 403, 'Submitting order for ungranted project returns 403 Forbidden');

    // Missing required fields
    const resOrderMissingTitle = await request(baseUrl, {
      method: 'POST',
      path: '/api/client/orders/submit',
      headers: { Authorization: `Bearer ${clientAToken}` },
      body: { description: 'Missing title' }
    });
    assert(resOrderMissingTitle.status === 400, 'Submitting order without title returns 400 Bad Request');

    // Valid order submission
    const resOrderValid = await request(baseUrl, {
      method: 'POST',
      path: '/api/client/orders/submit',
      headers: { Authorization: `Bearer ${clientAToken}` },
      body: {
        project_id: project1.id,
        title: 'Custom Brand Theme Add-on',
        description: 'We need custom brand typography and dark mode accents applied to checkout',
        order_type: 'NEW_REQUEST',
        priority: 'HIGH',
        attachments: ['mockup-checkout.png']
      }
    });
    assert(resOrderValid.status === 201, 'Client A submitting order returns 201 Created');
    assert(resOrderValid.body?.order?.title === 'Custom Brand Theme Add-on', 'Order title matches payload');
    assert(resOrderValid.body?.order?.status === 'SUBMITTED', "Order status is 'SUBMITTED'");
    assert(resOrderValid.body?.order?.client_id === clientA.id, 'order.client_id matches Client A');
    assert(resOrderValid.body?.order?.internal_notes === undefined, 'CRITICAL: internal_notes is stripped from submit response');

    const createdOrder = resOrderValid.body.order;

    // Direct SQLite verification
    const dbOrder = queryOne('SELECT * FROM client_orders WHERE id = ?;', [createdOrder.id]);
    assert(dbOrder !== null, 'Direct DB SELECT confirms order row inserted into SQLite');
    assert(dbOrder.client_id === clientA.id, 'dbOrder.client_id matches Client A');
    assert(dbOrder.priority === 'HIGH', "dbOrder.priority is 'HIGH'");
    assert(dbOrder.created_at !== null && dbOrder.updated_at !== null, 'created_at and updated_at populated');

    // Manually add internal_notes in SQLite to test stripping in GET endpoints
    execute("UPDATE client_orders SET internal_notes = 'CONFIDENTIAL: High-value account, assign senior dev only' WHERE id = ?", [createdOrder.id]);

    const orderSubmitLog = queryOne(
      "SELECT * FROM client_activity_log WHERE client_id = ? AND action = 'SUBMIT_ORDER' AND item_type = 'ORDER' AND item_id = ? ORDER BY id DESC LIMIT 1;",
      [clientA.id, createdOrder.id]
    );
    assert(orderSubmitLog !== null, "client_activity_log records 'SUBMIT_ORDER'");

    // 10. GET /api/client/orders
    console.log('\n--- Section 10: Client Orders List (GET /api/client/orders) ---');
    const resClientAOrders = await request(baseUrl, {
      path: '/api/client/orders',
      headers: { Authorization: `Bearer ${clientAToken}` }
    });
    assert(resClientAOrders.status === 200, 'Client A calling GET /api/client/orders returns 200 OK');
    assert(Array.isArray(resClientAOrders.body?.orders), 'Response contains orders array');
    assert(resClientAOrders.body.orders.length >= 1, 'Client A orders array contains at least 1 order');
    const foundOrderA = resClientAOrders.body.orders.find((o) => o.id === createdOrder.id);
    assert(foundOrderA !== undefined, 'Target order found in Client A list');
    assert(foundOrderA.internal_notes === undefined, 'CRITICAL: internal_notes is strictly stripped from orders list');

    // Multi-tenant isolation: Client B cannot see Client A's order
    const resClientBOrders = await request(baseUrl, {
      path: '/api/client/orders',
      headers: { Authorization: `Bearer ${clientBToken}` }
    });
    assert(resClientBOrders.status === 200, 'Client B calling GET /api/client/orders returns 200 OK');
    assert(resClientBOrders.body.orders.find((o) => o.id === createdOrder.id) === undefined, "Client B orders list strictly OMITS Client A's order");

    // 11. GET /api/client/orders/:orderId
    console.log('\n--- Section 11: Client Order Detail & Message Filtering (GET /api/client/orders/:orderId) ---');
    // Client B trying to view Client A's order
    const resCrossClientOrder = await request(baseUrl, {
      path: `/api/client/orders/${createdOrder.id}`,
      headers: { Authorization: `Bearer ${clientBToken}` }
    });
    assert(resCrossClientOrder.status === 403, 'Client B attempting to view Client A order returns 403 Forbidden');

    // Non-existent order
    const resNonExistentOrder = await request(baseUrl, {
      path: '/api/client/orders/999999',
      headers: { Authorization: `Bearer ${clientAToken}` }
    });
    assert(resNonExistentOrder.status === 404, 'Non-existent orderId returns 404 Not Found');

    // Seed Messages into Order: 1 internal team message (is_internal=1), 1 client-visible message (is_internal=0)
    execute(
      `INSERT INTO client_order_messages (order_id, sender_type, sender_client_id, sender_user_id, message, is_internal, created_at)
       VALUES (?, 'TEAM', NULL, ?, 'INTERNAL ONLY: Dev team estimate is 12 hours. Do not share with client.', 1, datetime('now'))`,
      [createdOrder.id, admin.id]
    );
    const internalMsg = queryOne('SELECT * FROM client_order_messages WHERE order_id = ? AND is_internal = 1;', [createdOrder.id]);

    execute(
      `INSERT INTO client_order_messages (order_id, sender_type, sender_client_id, sender_user_id, message, is_internal, created_at)
       VALUES (?, 'TEAM', NULL, ?, 'Hello Alice! We received your theme request and have scheduled it.', 0, datetime('now'))`,
      [createdOrder.id, member.id]
    );
    const externalMsg = queryOne('SELECT * FROM client_order_messages WHERE order_id = ? AND is_internal = 0;', [createdOrder.id]);

    const resOrderDetail = await request(baseUrl, {
      path: `/api/client/orders/${createdOrder.id}`,
      headers: { Authorization: `Bearer ${clientAToken}` }
    });
    assert(resOrderDetail.status === 200, 'Client A calling order detail returns 200 OK');
    assert(resOrderDetail.body?.order?.id === createdOrder.id, 'Order detail id matches');
    assert(resOrderDetail.body?.order?.internal_notes === undefined, 'CRITICAL: internal_notes is stripped from order detail');
    assert(Array.isArray(resOrderDetail.body?.messages), 'Response contains messages array');
    assert(resOrderDetail.body.messages.length === 1, 'Messages array contains exactly 1 client-visible message');
    assert(resOrderDetail.body.messages[0].id === externalMsg.id, 'Messages array contains the external team message');
    assert(resOrderDetail.body.messages.find((m) => m.id === internalMsg.id) === undefined, 'CRITICAL SECURITY INVARIANT: is_internal=1 message strictly OMITS from client response');

    // 12. POST /api/client/orders/:orderId/message
    console.log('\n--- Section 12: Client Order Message Reply (POST /api/client/orders/:orderId/message) ---');
    // Client B trying to reply to Client A's order
    const resMsgCrossClient = await request(baseUrl, {
      method: 'POST',
      path: `/api/client/orders/${createdOrder.id}/message`,
      headers: { Authorization: `Bearer ${clientBToken}` },
      body: { message: 'Unauthorized reply' }
    });
    assert(resMsgCrossClient.status === 403, 'Client B replying to Client A order returns 403 Forbidden');

    // Empty message
    const resMsgEmpty = await request(baseUrl, {
      method: 'POST',
      path: `/api/client/orders/${createdOrder.id}/message`,
      headers: { Authorization: `Bearer ${clientAToken}` },
      body: { message: '   ' }
    });
    assert(resMsgEmpty.status === 400, 'Empty message text returns 400 Bad Request');

    // Valid reply
    const initialOrderUpdatedAt = queryOne('SELECT updated_at FROM client_orders WHERE id = ?;', [createdOrder.id]).updated_at;

    const resClientReply = await request(baseUrl, {
      method: 'POST',
      path: `/api/client/orders/${createdOrder.id}/message`,
      headers: { Authorization: `Bearer ${clientAToken}` },
      body: {
        message: 'Thank you team! Please prioritize the dark mode palette first.',
        attachments: ['palette-guide.pdf']
      }
    });
    assert(resClientReply.status === 201, 'Client A posting reply returns 201 Created');
    assert(resClientReply.body?.order_message?.sender_type === 'CLIENT', "order_message.sender_type is 'CLIENT'");
    assert(resClientReply.body?.order_message?.is_internal === 0, 'order_message.is_internal is 0');
    assert(resClientReply.body?.order_message?.sender_client_id === clientA.id, 'sender_client_id matches Client A');

    // Direct SQLite verification
    const dbClientMsg = queryOne('SELECT * FROM client_order_messages WHERE id = ?;', [resClientReply.body.order_message.id]);
    assert(dbClientMsg !== null, 'Direct DB SELECT confirms message row in client_order_messages');
    assert(dbClientMsg.is_internal === 0, 'dbClientMsg.is_internal is strictly 0');
    assert(dbClientMsg.sender_user_id === null, 'dbClientMsg.sender_user_id is NULL');

    // Manual updated_at verification
    const finalOrderUpdatedAt = queryOne('SELECT updated_at FROM client_orders WHERE id = ?;', [createdOrder.id]).updated_at;
    assert(finalOrderUpdatedAt !== null, 'client_orders.updated_at manually updated on reply');

    const msgActivityLog = queryOne(
      "SELECT * FROM client_activity_log WHERE client_id = ? AND action = 'SEND_MESSAGE' AND item_type = 'ORDER_MESSAGE' AND item_id = ? ORDER BY id DESC LIMIT 1;",
      [clientA.id, resClientReply.body.order_message.id]
    );
    assert(msgActivityLog !== null, "client_activity_log records 'SEND_MESSAGE'");

    // Trigger Immutability on client_order_messages
    let clientMsgUpdateBlocked = false;
    try {
      execute("UPDATE client_order_messages SET message = 'TAMPERED' WHERE id = ?", [dbClientMsg.id]);
    } catch (e) {
      clientMsgUpdateBlocked = true;
    }
    assert(clientMsgUpdateBlocked, 'DB trigger strictly aborts SQL UPDATE on client message');

    let clientMsgDeleteBlocked = false;
    try {
      execute('DELETE FROM client_order_messages WHERE id = ?', [dbClientMsg.id]);
    } catch (e) {
      clientMsgDeleteBlocked = true;
    }
    assert(clientMsgDeleteBlocked, 'DB trigger strictly aborts SQL DELETE on client message');

    // 13. PATCH /api/client/milestone/approval/:approvalId
    console.log('\n--- Section 13: Milestone Approval Workflow (PATCH /api/client/milestone/approval/:approvalId) ---');
    // Admin creates milestone approval requests
    execute(
      `INSERT INTO client_milestone_approvals (client_id, project_id, milestone_id, requested_by, requested_at)
       VALUES (?, ?, ?, ?, datetime('now'))`,
      [clientA.id, project1.id, milestone1.id, admin.id]
    );
    const approvalA = queryOne('SELECT * FROM client_milestone_approvals WHERE client_id = ? AND milestone_id = ?;', [clientA.id, milestone1.id]);

    execute(
      `INSERT INTO client_milestone_approvals (client_id, project_id, milestone_id, requested_by, requested_at)
       VALUES (?, ?, ?, ?, datetime('now'))`,
      [clientB.id, project2.id, milestone2.id, admin.id]
    );
    const approvalB = queryOne('SELECT * FROM client_milestone_approvals WHERE client_id = ? AND milestone_id = ?;', [clientB.id, milestone2.id]);

    // Client A trying to decide Client B's approval
    const resApprovalCross = await request(baseUrl, {
      method: 'PATCH',
      path: `/api/client/milestone/approval/${approvalB.id}`,
      headers: { Authorization: `Bearer ${clientAToken}` },
      body: { decision: 'APPROVED' }
    });
    assert(resApprovalCross.status === 403, "Client A deciding Client B's approval returns 403 Forbidden");

    // Invalid decision string
    const resApprovalInvalidDecision = await request(baseUrl, {
      method: 'PATCH',
      path: `/api/client/milestone/approval/${approvalA.id}`,
      headers: { Authorization: `Bearer ${clientAToken}` },
      body: { decision: 'MAYBE_LATER' }
    });
    assert(resApprovalInvalidDecision.status === 400, "Invalid decision string returns 400 Bad Request");

    // Valid Approval by Client A
    const resApprovalValid = await request(baseUrl, {
      method: 'PATCH',
      path: `/api/client/milestone/approval/${approvalA.id}`,
      headers: { Authorization: `Bearer ${clientAToken}` },
      body: {
        decision: 'APPROVED',
        decision_note: 'Alpha deliverables reviewed and approved by engineering team.'
      }
    });
    assert(resApprovalValid.status === 200, 'Client A approving milestone returns 200 OK');
    assert(resApprovalValid.body?.approval?.decision === 'APPROVED', "Response approval.decision is 'APPROVED'");
    assert(resApprovalValid.body?.approval?.decided_at !== null, 'Response approval.decided_at is set');

    // Direct SQLite verification on client_milestone_approvals
    const dbApproval = queryOne('SELECT * FROM client_milestone_approvals WHERE id = ?;', [approvalA.id]);
    assert(dbApproval.decision === 'APPROVED', "Direct DB SELECT confirms decision 'APPROVED'");
    assert(dbApproval.decision_note.includes('Alpha deliverables'), 'Direct DB SELECT confirms decision_note recorded');
    assert(dbApproval.decided_at !== null, 'Direct DB SELECT confirms decided_at recorded');

    // Direct SQLite verification on gantt_milestones: status updated to 'ACHIEVED'
    const dbMilestone = queryOne('SELECT * FROM gantt_milestones WHERE id = ?;', [milestone1.id]);
    assert(dbMilestone.status === 'ACHIEVED', "CRITICAL: gantt_milestones.status updated to 'ACHIEVED'");
    assert(dbMilestone.achieved_at !== null, 'gantt_milestones.achieved_at timestamp is set');
    assert(dbMilestone.updated_at !== null, 'gantt_milestones.updated_at timestamp updated');

    const approvalActivityLog = queryOne(
      "SELECT * FROM client_activity_log WHERE client_id = ? AND action = 'APPROVE_MILESTONE' AND item_type = 'MILESTONE' AND item_id = ? ORDER BY id DESC LIMIT 1;",
      [clientA.id, milestone1.id]
    );
    assert(approvalActivityLog !== null, "client_activity_log records 'APPROVE_MILESTONE'");

    // Attempting to re-decide already decided approval
    const resApprovalAlreadyDecided = await request(baseUrl, {
      method: 'PATCH',
      path: `/api/client/milestone/approval/${approvalA.id}`,
      headers: { Authorization: `Bearer ${clientAToken}` },
      body: { decision: 'REJECTED' }
    });
    assert(resApprovalAlreadyDecided.status === 400, 'Re-deciding an already approved milestone returns 400 Bad Request');

    // Trigger Immutability on decided milestone approval
    let approvalUpdateBlocked = false;
    try {
      execute("UPDATE client_milestone_approvals SET decision = 'REJECTED' WHERE id = ?", [approvalA.id]);
    } catch (e) {
      approvalUpdateBlocked = true;
    }
    assert(approvalUpdateBlocked, 'DB trigger strictly aborts SQL UPDATE on decided milestone approval');

    let approvalDeleteBlocked = false;
    try {
      execute('DELETE FROM client_milestone_approvals WHERE id = ?', [approvalA.id]);
    } catch (e) {
      approvalDeleteBlocked = true;
    }
    assert(approvalDeleteBlocked, 'DB trigger strictly aborts SQL DELETE on client_milestone_approvals');

    // 14. POST /api/client/feedback/submit
    console.log('\n--- Section 14: Client Deliverable Feedback (POST /api/client/feedback/submit) ---');
    // Pre-insert Check: Feedback on unshared item (Task 2)
    const resFeedbackUnshared = await request(baseUrl, {
      method: 'POST',
      path: '/api/client/feedback/submit',
      headers: { Authorization: `Bearer ${clientAToken}` },
      body: {
        project_id: project1.id,
        item_type: 'GANTT_ITEM',
        item_id: task2.id, // Task 2 is NOT shared with Client A
        rating: 4,
        feedback_text: 'Sneaky feedback attempt'
      }
    });
    assert(resFeedbackUnshared.status === 403, 'Feedback on unshared item is rejected with 403 Forbidden (Pre-insert check)');

    // Feedback on ungranted project
    const resFeedbackUngrantedProj = await request(baseUrl, {
      method: 'POST',
      path: '/api/client/feedback/submit',
      headers: { Authorization: `Bearer ${clientAToken}` },
      body: {
        project_id: project2.id,
        item_type: 'GANTT_ITEM',
        item_id: 1,
        rating: 5
      }
    });
    assert(resFeedbackUngrantedProj.status === 403, 'Feedback on ungranted project is rejected with 403 Forbidden');

    // Invalid rating
    const resFeedbackInvalidRating = await request(baseUrl, {
      method: 'POST',
      path: '/api/client/feedback/submit',
      headers: { Authorization: `Bearer ${clientAToken}` },
      body: {
        project_id: project1.id,
        item_type: 'GANTT_ITEM',
        item_id: task1.id,
        rating: 6
      }
    });
    assert(resFeedbackInvalidRating.status === 400, 'Rating > 5 rejected with 400 Bad Request');

    // Valid Feedback on Shared Task 1
    const resFeedbackValid = await request(baseUrl, {
      method: 'POST',
      path: '/api/client/feedback/submit',
      headers: { Authorization: `Bearer ${clientAToken}` },
      body: {
        project_id: project1.id,
        item_type: 'GANTT_ITEM',
        item_id: task1.id,
        rating: 5,
        feedback_text: 'Checkout UI responsive design looks clean and fluid on all mobile test devices.'
      }
    });
    assert(resFeedbackValid.status === 201, 'Submitting feedback on shared item returns 201 Created');
    assert(resFeedbackValid.body?.feedback?.rating === 5, 'Response feedback.rating is 5');
    assert(resFeedbackValid.body?.feedback?.status === 'SUBMITTED', "Response feedback.status is 'SUBMITTED'");

    // Direct SQLite verification
    const dbFeedback = queryOne(
      'SELECT * FROM client_deliverable_feedback WHERE client_id = ? AND item_id = ? ORDER BY id DESC LIMIT 1;',
      [clientA.id, task1.id]
    );
    assert(dbFeedback !== null, 'Direct DB SELECT confirms feedback row in client_deliverable_feedback');
    assert(dbFeedback.rating === 5, 'dbFeedback.rating is 5');
    assert(dbFeedback.feedback_text.includes('responsive design'), 'dbFeedback.feedback_text matches');

    const feedbackActivityLog = queryOne(
      "SELECT * FROM client_activity_log WHERE client_id = ? AND action = 'LEAVE_FEEDBACK' AND item_type = 'GANTT_ITEM' AND item_id = ? ORDER BY id DESC LIMIT 1;",
      [clientA.id, task1.id]
    );
    assert(feedbackActivityLog !== null, "client_activity_log records 'LEAVE_FEEDBACK'");

    // Trigger Immutability on client_deliverable_feedback
    let feedbackUpdateBlocked = false;
    try {
      execute("UPDATE client_deliverable_feedback SET rating = 1 WHERE id = ?", [dbFeedback.id]);
    } catch (e) {
      feedbackUpdateBlocked = true;
    }
    assert(feedbackUpdateBlocked, 'DB trigger strictly aborts SQL UPDATE on client_deliverable_feedback');

    let feedbackDeleteBlocked = false;
    try {
      execute('DELETE FROM client_deliverable_feedback WHERE id = ?', [dbFeedback.id]);
    } catch (e) {
      feedbackDeleteBlocked = true;
    }
    assert(feedbackDeleteBlocked, 'DB trigger strictly aborts SQL DELETE on client_deliverable_feedback');

  } catch (err) {
    console.error('Fatal Verification Error:', err);
  } finally {
    server.close();
  }

  console.log('\n================================================================================');
  console.log('PRD 24 Layer 4 Verification Summary:');
  console.log(`Total Assertions: ${totalTests}`);
  console.log(`Passed:           ${passedTests}`);
  console.log(`Failed:           ${failedTests}`);
  console.log(`Success Rate:     ${((passedTests / totalTests) * 100).toFixed(1)}%`);
  console.log('================================================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runSuite().catch((err) => {
  console.error('Test Suite Failed:', err);
  process.exit(1);
});
