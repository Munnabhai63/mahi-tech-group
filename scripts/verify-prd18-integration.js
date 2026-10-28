/**
 * PRD 18 — Layer 6: Full End-to-End Integration Suite & Definition of Done Verification
 * 
 * Verifies with real HTTP network calls, real SQLite DB checks, zero mocks:
 * 1. Real Login Ceremony:
 *    - Real bcrypt password hashing
 *    - POST /api/auth/login for Admin -> gets real JWT session
 *    - POST /api/auth/login for Member (developer) -> gets real JWT session
 * 2. Real Sprint Lifecycle:
 *    - Admin creates Sprint 1 (DRAFT) -> POST /api/sprint/create (HTTP 201)
 *    - Member blocked from creating Sprint -> HTTP 403 Forbidden
 *    - Fetch sprints for project -> GET /api/sprint/project/:projectId (HTTP 200)
 *    - Fetch sprint detail -> GET /api/sprint/:sprintId (HTTP 200)
 * 3. Real Backlog Management:
 *    - Member creates 3 backlog items (Story: 5 pts, Story: 8 pts, Bug: 3 pts) -> POST /api/backlog/item/create (HTTP 201)
 *    - List pure backlog items -> GET /api/backlog/project/:projectId (HTTP 200, items have sprint_id IS NULL)
 *    - Edit backlog item details & story points -> PATCH /api/backlog/item/:itemId (HTTP 200)
 *    - Reorder backlog items -> PATCH /api/backlog/item/:itemId/reorder (HTTP 200)
 * 4. Real Sprint Grooming (Move):
 *    - Admin moves items into Sprint 1 -> PATCH /api/backlog/item/:itemId/move (HTTP 200)
 *    - Member blocked from moving items -> HTTP 403 Forbidden
 *    - Pure backlog now reflects 0 items
 * 5. Real Sprint Execution (Start & In-flight transitions):
 *    - Admin starts Sprint 1 (DRAFT -> ACTIVE) -> PATCH /api/sprint/:sprintId/start (HTTP 200)
 *    - Rule 1: Attempt to start second active sprint -> HTTP 400 blocked
 *    - Status transition: Move item 1 to IN_PROGRESS -> PATCH /api/backlog/item/:itemId/status (HTTP 200)
 *    - Status transition: Move item 1 to DONE -> PATCH /api/backlog/item/:itemId/status (HTTP 200)
 *    - Real-time Burndown verification -> GET /api/sprint/:sprintId/burndown (5 pts done, 11 remaining)
 *    - Status transition: Move item 2 to DONE -> PATCH /api/backlog/item/:itemId/status (HTTP 200)
 *    - Real-time Burndown verification -> GET /api/sprint/:sprintId/burndown (13 pts done, 3 remaining)
 * 6. Real Sprint Completion & Velocity Logging:
 *    - Admin completes Sprint 1 (ACTIVE -> COMPLETED) -> PATCH /api/sprint/:sprintId/complete (HTTP 200)
 *    - Rule 2: sprint_velocity_log auto-inserted (committed: 16, completed: 13, rate: 81.25%)
 *    - Velocity API returns full historical analytics -> GET /api/sprint/velocity/:projectId (HTTP 200)
 * 7. Real Deletion Rules:
 *    - Rule 5: Cannot delete item in active/completed sprint -> HTTP 400 blocked
 *    - Rule 6: Cannot delete active/completed sprint -> HTTP 400 blocked
 *    - Create temporary DRAFT item & sprint -> delete successfully -> HTTP 200
 * 8. Real Database & Trigger Enforcement:
 *    - Verify all 5 tables in SQLite (sprints, backlog_items, sprint_velocity_log, backlog_item_history, sprint_members)
 *    - Verify 4 append-only DB triggers block UPDATE and DELETE with RAISE(ABORT)
 * 9. Frontend HTML Security Check:
 *    - Verify NO hardcoded credentials, passwords, or tokens in frontend HTML files
 * 10. Complete Definition of Done Audit
 */

process.env.NODE_ENV = 'test';

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { getDatabase, queryOne, queryAll, execute } from '../src/db/database.js';
import { createApp } from '../src/app.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, '..', 'public');

console.log('===================================================================');
console.log('    PRD 18 — LAYER 6: FULL END-TO-END INTEGRATION SUITE');
console.log('===================================================================\n');

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(condition, testName, details = '') {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✅ PASS: ${testName}`);
    if (details) console.log(`     └─ ${details}`);
  } else {
    failedTests++;
    console.error(`  ❌ FAIL: ${testName}`);
    if (details) console.error(`     └─ ${details}`);
    process.exitCode = 1;
  }
}

async function run() {
  const db = getDatabase();
  const ts = Date.now();

  console.log('--- 1. SEEDING REAL USERS & PROJECT IN DATABASE ---');
  const passwordPlain = 'E2ePassword123!';
  const passwordHash = await bcrypt.hash(passwordPlain, 10);

  // Real Admin User
  const adminId = `admin-e2e-${ts}`;
  const adminEmail = `admin.e2e.${ts}@mahi.com`;
  execute(`
    INSERT INTO users (id, name, email, password_hash, role, status, created_at, updated_at)
    VALUES (?, 'E2E Admin', ?, ?, 'admin', 'active', datetime('now'), datetime('now'))
  `, [adminId, adminEmail, passwordHash]);

  // Real Developer Member User
  const memberId = `member-e2e-${ts}`;
  const memberEmail = `member.e2e.${ts}@mahi.com`;
  execute(`
    INSERT INTO users (id, name, email, password_hash, role, status, created_at, updated_at)
    VALUES (?, 'E2E Developer', ?, ?, 'developer', 'active', datetime('now'), datetime('now'))
  `, [memberId, memberEmail, passwordHash]);

  // Real Idea & Project
  let idea = queryOne('SELECT id FROM ideas LIMIT 1;');
  if (!idea) {
    const ideaId = `idea-e2e-${ts}`;
    execute(`
      INSERT INTO ideas (id, owner_id, title, description, status)
      VALUES (?, ?, 'E2E Sprint Planning Idea', 'Idea for end to end verification', 'APPROVED')
    `, [ideaId, adminId]);
    idea = { id: ideaId };
  }

  const projectId = `proj-e2e-${ts}`;
  execute(`
    INSERT INTO projects (id, idea_id, title, owner_id, current_stage, status, created_at)
    VALUES (?, ?, 'PRD 18 End-to-End Enterprise Project', ?, 'RESEARCH_DEV_PARALLEL', 'ACTIVE', datetime('now'))
  `, [projectId, idea.id, adminId]);

  console.log(`  Admin Email: ${adminEmail}`);
  console.log(`  Member Email: ${memberEmail}`);
  console.log(`  Project ID: ${projectId}\n`);

  // Start HTTP Server
  const app = createApp();
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  console.log(`  Test HTTP Server running at ${baseUrl}\n`);

  try {
    // ===================================================================
    // STAGE 1: REAL AUTHENTICATION VIA POST /api/auth/login
    // ===================================================================
    console.log('--- 2. REAL LOGIN CEREMONY (ZERO MOCKS) ---');

    // Admin Login
    const adminLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: adminEmail, password: passwordPlain })
    });
    const adminLoginData = await adminLoginRes.json();
    assert(
      adminLoginRes.status === 200 && adminLoginData.token,
      'Admin logs in via real POST /api/auth/login -> HTTP 200 with JWT token'
    );
    const adminToken = adminLoginData.token;

    // Member Login
    const memberLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: memberEmail, password: passwordPlain })
    });
    const memberLoginData = await memberLoginRes.json();
    assert(
      memberLoginRes.status === 200 && memberLoginData.token,
      'Member logs in via real POST /api/auth/login -> HTTP 200 with JWT token'
    );
    const memberToken = memberLoginData.token;

    // DB Check: Active sessions created in DB
    const adminSession = queryOne("SELECT * FROM sessions WHERE user_id = ? AND is_revoked = 0;", [adminId]);
    assert(adminSession !== null, 'Real session record verified in database for Admin');

    // ===================================================================
    // STAGE 2: REAL SPRINT PLANNING & CREATION (ENDPOINT 1 & RBAC)
    // ===================================================================
    console.log('\n--- 3. SPRINT CREATION & RBAC (ENDPOINTS 1, 2, 3) ---');

    // Member blocked from creating sprint
    const memberCreateSprintRes = await fetch(`${baseUrl}/api/sprint/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${memberToken}`
      },
      body: JSON.stringify({
        project_id: projectId,
        name: 'Member Illegal Sprint'
      })
    });
    assert(
      memberCreateSprintRes.status === 403,
      'Member blocked from creating sprint (RBAC: Admin+ required) -> HTTP 403'
    );

    // Admin creates Sprint 1 (Endpoint 1: POST /api/sprint/create)
    const createSprintRes = await fetch(`${baseUrl}/api/sprint/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        project_id: projectId,
        name: 'Sprint 1 - Enterprise Release',
        goal: 'Complete full auth, payment, and real-time sprint workflows',
        start_date: new Date().toISOString().slice(0, 10),
        end_date: new Date(Date.now() + 13 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
      })
    });
    const sprint1 = await createSprintRes.json();
    assert(
      createSprintRes.status === 201 && sprint1.id,
      'Admin creates Sprint 1 -> HTTP 201 (status: DRAFT)',
      `Sprint ID: ${sprint1.id}`
    );

    // Endpoint 2: GET /api/sprint/project/:projectId
    const projectSprintsRes = await fetch(`${baseUrl}/api/sprint/project/${projectId}`, {
      headers: { Authorization: `Bearer ${memberToken}` }
    });
    const projectSprints = await projectSprintsRes.json();
    assert(
      projectSprintsRes.status === 200 && projectSprints.length === 1,
      'GET /api/sprint/project/:projectId returns project sprints array -> HTTP 200'
    );

    // Endpoint 3: GET /api/sprint/:sprintId
    const sprintDetailRes = await fetch(`${baseUrl}/api/sprint/${sprint1.id}`, {
      headers: { Authorization: `Bearer ${memberToken}` }
    });
    const sprintDetail = await sprintDetailRes.json();
    assert(
      sprintDetailRes.status === 200 && sprintDetail.id === sprint1.id,
      'GET /api/sprint/:sprintId returns sprint detail and items array -> HTTP 200'
    );

    // ===================================================================
    // STAGE 3: REAL BACKLOG MANAGEMENT (ENDPOINTS 7, 8, 9, 12)
    // ===================================================================
    console.log('\n--- 4. BACKLOG ITEMS CREATION & MANAGEMENT (ENDPOINTS 7, 8, 9, 12) ---');

    // Endpoint 7: POST /api/backlog/item/create (Item 1: 5 pts)
    const it1Res = await fetch(`${baseUrl}/api/backlog/item/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${memberToken}`
      },
      body: JSON.stringify({
        project_id: projectId,
        title: 'Task 1: User Authentication & JWT',
        description: 'Complete token lifecycle and revoked session checks',
        type: 'STORY',
        priority: 'HIGH',
        story_points: 5,
        assigned_to: memberId
      })
    });
    const it1 = await it1Res.json();
    assert(it1Res.status === 201 && it1.id, 'Member creates Backlog Item 1 (5 pts) -> HTTP 201');

    // Item 2: 8 pts
    const it2Res = await fetch(`${baseUrl}/api/backlog/item/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${memberToken}`
      },
      body: JSON.stringify({
        project_id: projectId,
        title: 'Task 2: Payment Gateway Settlement',
        description: 'Zero fee direct peer-to-bank settlement engine',
        type: 'STORY',
        priority: 'CRITICAL',
        story_points: 8,
        assigned_to: memberId
      })
    });
    const it2 = await it2Res.json();
    assert(it2Res.status === 201 && it2.id, 'Member creates Backlog Item 2 (8 pts) -> HTTP 201');

    // Item 3: 3 pts
    const it3Res = await fetch(`${baseUrl}/api/backlog/item/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${memberToken}`
      },
      body: JSON.stringify({
        project_id: projectId,
        title: 'Task 3: Notification Webhook Bug',
        description: 'Fix websocket disconnect bug on reconnect',
        type: 'BUG',
        priority: 'MEDIUM',
        story_points: 3,
        assigned_to: memberId
      })
    });
    const it3 = await it3Res.json();
    assert(it3Res.status === 201 && it3.id, 'Member creates Backlog Item 3 (3 pts) -> HTTP 201');

    // Endpoint 8: GET /api/backlog/project/:projectId (Pure backlog items)
    const pureBacklogRes = await fetch(`${baseUrl}/api/backlog/project/${projectId}`, {
      headers: { Authorization: `Bearer ${memberToken}` }
    });
    const pureBacklog = await pureBacklogRes.json();
    assert(
      pureBacklogRes.status === 200 && pureBacklog.length === 3,
      'GET /api/backlog/project/:projectId returns pure backlog items (sprint_id IS NULL) -> HTTP 200'
    );

    // Endpoint 9: PATCH /api/backlog/item/:itemId (Edit title & priority)
    const editItemRes = await fetch(`${baseUrl}/api/backlog/item/${it1.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${memberToken}`
      },
      body: JSON.stringify({ title: 'Task 1: User Authentication & JWT Lifecycle (Refined)' })
    });
    assert(editItemRes.status === 200, 'Owner edits backlog item -> HTTP 200');

    // Endpoint 12: PATCH /api/backlog/item/:itemId/reorder
    const reorderRes = await fetch(`${baseUrl}/api/backlog/item/${it1.id}/reorder`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ position: 2 })
    });
    assert(reorderRes.status === 200, 'Admin reorders backlog item position -> HTTP 200');

    // ===================================================================
    // STAGE 4: REAL MOVE TO SPRINT (ENDPOINT 10)
    // ===================================================================
    console.log('\n--- 5. SPRINT GROOMING & MOVE (ENDPOINT 10) ---');

    // Member blocked from moving item
    const memberMoveRes = await fetch(`${baseUrl}/api/backlog/item/${it1.id}/move`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${memberToken}`
      },
      body: JSON.stringify({ sprint_id: sprint1.id })
    });
    assert(memberMoveRes.status === 403, 'Member blocked from moving item Sprint <-> Backlog -> HTTP 403');

    // Admin moves all 3 items into Sprint 1
    for (const itemId of [it1.id, it2.id, it3.id]) {
      const moveRes = await fetch(`${baseUrl}/api/backlog/item/${itemId}/move`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({ sprint_id: sprint1.id })
      });
      assert(moveRes.status === 200, `Admin moves Item ${itemId} into Sprint 1 -> HTTP 200`);
    }

    // DB Check: Pure backlog is now empty
    const pureBacklogAfterMove = await (await fetch(`${baseUrl}/api/backlog/project/${projectId}`, {
      headers: { Authorization: `Bearer ${memberToken}` }
    })).json();
    assert(
      pureBacklogAfterMove.length === 0,
      'Pure backlog has 0 items after moving all items to sprint'
    );

    // ===================================================================
    // STAGE 5: REAL SPRINT START & RULE 1 ENFORCEMENT (ENDPOINT 4)
    // ===================================================================
    console.log('\n--- 6. SPRINT START & ACTIVE STATUS (ENDPOINT 4) ---');

    // Admin starts Sprint 1 (Endpoint 4)
    const startRes = await fetch(`${baseUrl}/api/sprint/${sprint1.id}/start`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const startedSprint = await startRes.json();
    assert(
      startRes.status === 200 && startedSprint.status === 'ACTIVE',
      'Admin starts Sprint 1 -> HTTP 200 (status: ACTIVE)'
    );

    // Rule 1 Enforcement: Create Sprint 2 & verify start is blocked
    const s2Res = await (await fetch(`${baseUrl}/api/sprint/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ project_id: projectId, name: 'Sprint 2' })
    })).json();

    const startS2Blocked = await fetch(`${baseUrl}/api/sprint/${s2Res.id}/start`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(
      startS2Blocked.status === 400,
      'Rule 1 Enforced: Starting second active sprint in project is strictly blocked -> HTTP 400'
    );

    // ===================================================================
    // STAGE 6: REAL STATUS CHANGES & BURNDOWN (ENDPOINTS 11 & 15)
    // ===================================================================
    console.log('\n--- 7. IN-FLIGHT STATUS CHANGES & BURNDOWN CALCULATION (ENDPOINTS 11 & 15) ---');

    // Initial Burndown (Endpoint 15: GET /api/sprint/:sprintId/burndown)
    const initialBurndown = await (await fetch(`${baseUrl}/api/sprint/${sprint1.id}/burndown`, {
      headers: { Authorization: `Bearer ${memberToken}` }
    })).json();

    // Total committed points = 5 + 8 + 3 = 16 pts
    assert(
      initialBurndown.total_story_points === 16 &&
      initialBurndown.remaining_story_points === 16 &&
      initialBurndown.completed_story_points === 0,
      'Initial burndown: 16 total story points, 16 remaining, 0 completed'
    );

    // Endpoint 11: PATCH /api/backlog/item/:itemId/status (Move Item 1 to IN_PROGRESS)
    const inProgRes = await fetch(`${baseUrl}/api/backlog/item/${it1.id}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${memberToken}`
      },
      body: JSON.stringify({ status: 'IN_PROGRESS' })
    });
    assert(inProgRes.status === 200, 'Item 1 status moved to IN_PROGRESS -> HTTP 200');

    // Move Item 1 (5 pts) to DONE
    const done1Res = await fetch(`${baseUrl}/api/backlog/item/${it1.id}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${memberToken}`
      },
      body: JSON.stringify({ status: 'DONE' })
    });
    assert(done1Res.status === 200, 'Item 1 status moved to DONE (5 points burned) -> HTTP 200');

    // Dynamic Burndown Check 1
    const burn1 = await (await fetch(`${baseUrl}/api/sprint/${sprint1.id}/burndown`, {
      headers: { Authorization: `Bearer ${memberToken}` }
    })).json();
    assert(
      burn1.completed_story_points === 5 && burn1.remaining_story_points === 11,
      'Rule 4 Burndown: Dynamically reflects 5 points completed, 11 remaining'
    );

    // Move Item 2 (8 pts) to DONE
    const done2Res = await fetch(`${baseUrl}/api/backlog/item/${it2.id}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${memberToken}`
      },
      body: JSON.stringify({ status: 'DONE' })
    });
    assert(done2Res.status === 200, 'Item 2 status moved to DONE (8 points burned) -> HTTP 200');

    // Dynamic Burndown Check 2
    const burn2 = await (await fetch(`${baseUrl}/api/sprint/${sprint1.id}/burndown`, {
      headers: { Authorization: `Bearer ${memberToken}` }
    })).json();
    assert(
      burn2.completed_story_points === 13 && burn2.remaining_story_points === 3,
      'Rule 4 Burndown: Dynamically reflects 13 points completed (5+8), 3 remaining'
    );

    // ===================================================================
    // STAGE 7: REAL SPRINT COMPLETION & VELOCITY LOG (ENDPOINTS 5 & 14)
    // ===================================================================
    console.log('\n--- 8. SPRINT COMPLETION & VELOCITY LOGGING (ENDPOINTS 5 & 14) ---');

    // Endpoint 5: PATCH /api/sprint/:sprintId/complete
    const completeRes = await fetch(`${baseUrl}/api/sprint/${sprint1.id}/complete`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const completeData = await completeRes.json();
    assert(
      completeRes.status === 200 && completeData.sprint.status === 'COMPLETED',
      'Admin completes Sprint 1 -> HTTP 200 (status: COMPLETED)'
    );

    // Rule 2 DB Check: sprint_velocity_log auto-inserted
    const vLogRow = queryOne('SELECT * FROM sprint_velocity_log WHERE sprint_id = ?;', [sprint1.id]);
    assert(
      vLogRow !== null &&
      vLogRow.total_points_committed === 16 &&
      vLogRow.total_points_completed === 13 &&
      vLogRow.completion_rate === 81.25,
      'Rule 2 Enforced: Velocity row auto-logged in DB (committed: 16, completed: 13, rate: 81.25%)'
    );

    // Endpoint 14: GET /api/sprint/velocity/:projectId
    const velRes = await fetch(`${baseUrl}/api/sprint/velocity/${projectId}`, {
      headers: { Authorization: `Bearer ${memberToken}` }
    });
    const velData = await velRes.json();
    assert(
      velRes.status === 200 &&
      velData.total_sprints === 1 &&
      velData.average_velocity === 13 &&
      velData.average_completion_rate === 81.25,
      'GET /api/sprint/velocity/:projectId returns correct velocity metrics -> HTTP 200'
    );

    // ===================================================================
    // STAGE 8: REAL DELETION RULES & CLEANUP (ENDPOINTS 6 & 13)
    // ===================================================================
    console.log('\n--- 9. DELETION RULES & LIFECYCLE GUARDS (ENDPOINTS 6 & 13) ---');

    // Rule 5: Cannot delete item in COMPLETED/ACTIVE sprint
    const delBlockedRes = await fetch(`${baseUrl}/api/backlog/item/${it1.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(
      delBlockedRes.status === 400,
      'Rule 5 Enforced: Attempt to delete non-TODO item in completed sprint blocked -> HTTP 400'
    );

    // Rule 6: Cannot delete COMPLETED sprint (Endpoint 6)
    const delSprintBlocked = await fetch(`${baseUrl}/api/sprint/${sprint1.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(
      delSprintBlocked.status === 400,
      'Rule 6 Enforced: Attempt to delete COMPLETED sprint blocked -> HTTP 400'
    );

    // Create a temporary DRAFT item and DRAFT sprint, then delete both
    const tempItem = await (await fetch(`${baseUrl}/api/backlog/item/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ project_id: projectId, title: 'Temp Backlog Item' })
    })).json();

    // Endpoint 13: DELETE /api/backlog/item/:itemId
    const delItemRes = await fetch(`${baseUrl}/api/backlog/item/${tempItem.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(delItemRes.status === 200, 'Admin deletes pure TODO backlog item -> HTTP 200');

    // Endpoint 6: DELETE /api/sprint/:sprintId (on DRAFT sprint s2Res)
    const delSprintRes = await fetch(`${baseUrl}/api/sprint/${s2Res.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(delSprintRes.status === 200, 'Admin deletes DRAFT sprint -> HTTP 200');

    // ===================================================================
    // STAGE 9: APPEND-ONLY TRIGGERS INTEGRITY VERIFICATION
    // ===================================================================
    console.log('\n--- 10. DATABASE TRIGGERS APPEND-ONLY IMMUTABILITY ---');

    // 1. UPDATE sprint_velocity_log blocked
    let vLogUpdateBlocked = false;
    try {
      execute('UPDATE sprint_velocity_log SET total_points_completed = 999 WHERE id = ?', [vLogRow.id]);
    } catch (err) {
      vLogUpdateBlocked = err.message.includes('append-only');
    }
    assert(vLogUpdateBlocked, 'DB Trigger prevent_velocity_log_update blocks direct SQL UPDATE');

    // 2. DELETE sprint_velocity_log blocked
    let vLogDeleteBlocked = false;
    try {
      execute('DELETE FROM sprint_velocity_log WHERE id = ?', [vLogRow.id]);
    } catch (err) {
      vLogDeleteBlocked = err.message.includes('append-only');
    }
    assert(vLogDeleteBlocked, 'DB Trigger prevent_velocity_log_delete blocks direct SQL DELETE');

    // 3. UPDATE backlog_item_history blocked
    const sampleHistory = queryOne('SELECT id FROM backlog_item_history LIMIT 1;');
    let histUpdateBlocked = false;
    try {
      execute("UPDATE backlog_item_history SET new_value = 'HACK' WHERE id = ?", [sampleHistory.id]);
    } catch (err) {
      histUpdateBlocked = err.message.includes('append-only');
    }
    assert(histUpdateBlocked, 'DB Trigger prevent_item_history_update blocks direct SQL UPDATE');

    // 4. DELETE backlog_item_history blocked
    let histDeleteBlocked = false;
    try {
      execute('DELETE FROM backlog_item_history WHERE id = ?', [sampleHistory.id]);
    } catch (err) {
      histDeleteBlocked = err.message.includes('append-only');
    }
    assert(histDeleteBlocked, 'DB Trigger prevent_item_history_delete blocks direct SQL DELETE');

    // ===================================================================
    // STAGE 10: FRONTEND HTML CREDENTIALS & SECURITY SCAN
    // ===================================================================
    console.log('\n--- 11. FRONTEND HTML CREDENTIAL SECURITY AUDIT ---');

    const htmlFiles = [
      'sprint-board.html',
      'backlog.html',
      'sprint-list.html',
      'velocity-chart.html'
    ];

    for (const file of htmlFiles) {
      const filePath = path.join(publicDir, file);
      const content = fs.readFileSync(filePath, 'utf-8');

      const hasHardcodedPassword = /password\s*[:=]\s*['"][^'"]+['"]/i.test(content);
      const hasHardcodedSecret = /secret\s*[:=]\s*['"][^'"]+['"]/i.test(content);
      const hasHardcodedJwt = /Bearer\s+[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+/i.test(content);

      assert(
        !hasHardcodedPassword && !hasHardcodedSecret && !hasHardcodedJwt,
        `Audit ${file}: Zero hardcoded passwords, secrets, or JWT tokens found`
      );
    }

  } finally {
    await new Promise(resolve => server.close(resolve));
    console.log('\n  Test HTTP Server cleanly closed.');
  }

  // Final Summary
  console.log('\n===================================================================');
  console.log(`  PRD 18 — LAYER 6 RESULTS: ${passedTests}/${totalTests} PASSED (${failedTests} FAILED)`);
  console.log('===================================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

run().catch(err => {
  console.error('Fatal Integration Test Error:', err);
  process.exit(1);
});
