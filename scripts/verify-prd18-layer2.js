/**
 * PRD 18 — Layer 2 Verification Suite: Sprint Service & API Endpoints
 * 
 * Verifies with real HTTP network calls:
 * 1. Admin creates Sprint (DRAFT) -> HTTP 201
 * 2. Member blocked from creating Sprint -> HTTP 403 (RBAC)
 * 3. Validation: Missing name -> HTTP 400
 * 4. Validation: Invalid project -> HTTP 404
 * 5. GET /api/sprint/project/:projectId -> HTTP 200 with stats
 * 6. GET /api/sprint/:sprintId -> HTTP 200 detail + items
 * 7. Admin updates Sprint (name, goal, dates) -> HTTP 200
 * 8. Member blocked from updating Sprint -> HTTP 403
 * 9. Admin starts Sprint (DRAFT -> ACTIVE) -> HTTP 200
 * 10. Member blocked from starting Sprint -> HTTP 403
 * 11. Rule 1: Only ONE active sprint per project -> second start blocked with HTTP 400
 * 12. Rule 6: Attempt to delete ACTIVE sprint -> HTTP 400 blocked
 * 13. Seed backlog items (committed points & done points)
 * 14. Detail query reflects committed & completed points
 * 15. Member blocked from completing Sprint -> HTTP 403
 * 16. Admin completes Sprint (ACTIVE -> COMPLETED) -> HTTP 200
 * 17. Rule 2: Velocity Auto-Log inserted in sprint_velocity_log with committed, completed, rate
 * 18. Cannot re-complete COMPLETED sprint -> HTTP 400
 * 19. Cannot delete COMPLETED sprint -> HTTP 400
 * 20. Admin deletes DRAFT sprint -> HTTP 200
 * 21. After completion, a new sprint can become ACTIVE
 */

import http from 'node:http';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { getDatabase, queryOne, queryAll, execute } from '../src/db/database.js';
import { createApp } from '../src/app.js';
import { config } from '../src/config.js';

console.log('===================================================================');
console.log('       PRD 18 — LAYER 2: SPRINT SERVICE & API TEST SUITE');
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

function createAuthToken(user) {
  const sessionId = crypto.randomUUID();
  const token = jwt.sign(
    { sessionId, userId: user.id, role: user.role },
    config.JWT_SECRET,
    { expiresIn: '24h' }
  );
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  execute(`
    INSERT INTO sessions (id, user_id, token, device_info, ip_address, created_at, expires_at, is_revoked)
    VALUES (?, ?, ?, 'Test Harness', '127.0.0.1', datetime('now'), ?, 0)
  `, [sessionId, user.id, token, expiresAt]);

  return token;
}

async function run() {
  const db = getDatabase();

  // 1. Setup isolated test entities
  console.log('--- 1. SETTING UP TEST USERS & PROJECT ---');
  const ts = Date.now();

  // Admin user
  let adminUser = queryOne("SELECT * FROM users WHERE role = 'admin' AND status = 'active' LIMIT 1;");
  if (!adminUser) {
    const adminId = `admin-${ts}`;
    execute(`
      INSERT INTO users (id, name, email, password_hash, role, status, created_at)
      VALUES (?, 'Admin Tester', 'admin.${ts}@mahi.com', 'hash', 'admin', 'active', datetime('now'))
    `, [adminId]);
    adminUser = queryOne('SELECT * FROM users WHERE id = ?', [adminId]);
  }

  // Regular Member user (role: 'developer')
  const memberId = `member-${ts}`;
  execute(`
    INSERT INTO users (id, name, email, password_hash, role, status, created_at)
    VALUES (?, 'Regular Member', 'member.${ts}@mahi.com', 'hash', 'developer', 'active', datetime('now'))
  `, [memberId]);
  const memberUser = queryOne('SELECT * FROM users WHERE id = ?', [memberId]);

  const adminToken = createAuthToken(adminUser);
  const memberToken = createAuthToken(memberUser);

  // Create test project
  let idea = queryOne('SELECT id FROM ideas LIMIT 1;');
  if (!idea) {
    const ideaId = `idea-${ts}`;
    execute(`
      INSERT INTO ideas (id, owner_id, title, description, status)
      VALUES (?, ?, 'Sprint Test Idea', 'Idea for PRD 18 testing', 'APPROVED')
    `, [ideaId, adminUser.id]);
    idea = { id: ideaId };
  }

  const projectId = `proj-sprint-${ts}`;
  execute(`
    INSERT INTO projects (id, idea_id, title, owner_id, current_stage, status, created_at)
    VALUES (?, ?, 'PRD 18 Sprint Project', ?, 'RESEARCH_DEV_PARALLEL', 'ACTIVE', datetime('now'))
  `, [projectId, idea.id, adminUser.id]);

  console.log(`  Admin User ID: ${adminUser.id}`);
  console.log(`  Member User ID: ${memberUser.id}`);
  console.log(`  Test Project ID: ${projectId}\n`);

  // 2. Start HTTP server
  const app = createApp();
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  console.log(`  Test HTTP Server running at ${baseUrl}\n`);

  try {
    let sprint1Id = null;
    let sprint2Id = null;

    // --- TEST 1: Admin creates Sprint (DRAFT) ---
    console.log('--- 2. SPRINT CREATION & RBAC TESTS ---');
    {
      const res = await fetch(`${baseUrl}/api/sprint/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${adminToken}`
        },
        body: JSON.stringify({
          project_id: projectId,
          name: 'Sprint 1 - Foundation',
          goal: 'Setup Core Database and Services',
          start_date: '2026-11-01',
          end_date: '2026-11-14'
        })
      });
      const data = await res.json();
      assert(res.status === 201, 'Admin can create Sprint (HTTP 201)', `Status: ${res.status}`);
      assert(data && data.id && data.status === 'DRAFT', 'Created sprint status is DRAFT', `ID: ${data?.id}, Status: ${data?.status}`);
      assert(data.name === 'Sprint 1 - Foundation', 'Sprint name matches payload', `Name: ${data?.name}`);
      sprint1Id = data?.id;
    }

    // --- TEST 2: Member blocked from creating Sprint ---
    {
      const res = await fetch(`${baseUrl}/api/sprint/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${memberToken}`
        },
        body: JSON.stringify({
          project_id: projectId,
          name: 'Member Illegal Sprint'
        })
      });
      assert(res.status === 403, 'Member blocked from creating Sprint (HTTP 403 Forbidden)', `Status: ${res.status}`);
    }

    // --- TEST 3: Validation - Missing name ---
    {
      const res = await fetch(`${baseUrl}/api/sprint/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${adminToken}`
        },
        body: JSON.stringify({
          project_id: projectId,
          name: '   '
        })
      });
      assert(res.status === 400, 'Blank sprint name rejected (HTTP 400)', `Status: ${res.status}`);
    }

    // --- TEST 4: Validation - Invalid project ---
    {
      const res = await fetch(`${baseUrl}/api/sprint/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${adminToken}`
        },
        body: JSON.stringify({
          project_id: 'non-existent-proj-xyz',
          name: 'Sprint Valid Name'
        })
      });
      assert(res.status === 404, 'Non-existent project rejected (HTTP 404)', `Status: ${res.status}`);
    }

    // --- TEST 5: GET /api/sprint/project/:projectId ---
    console.log('\n--- 3. SPRINT RETRIEVAL & STATS TESTS ---');
    {
      const res = await fetch(`${baseUrl}/api/sprint/project/${projectId}`, {
        headers: { 'Authorization': `Bearer ${memberToken}` }
      });
      const data = await res.json();
      assert(res.status === 200, 'Member can view all project sprints (HTTP 200, Role: All)', `Count: ${data?.length}`);
      assert(Array.isArray(data) && data.length >= 1, 'Project sprints list returned as array');
      const found = data.find(s => s.id === sprint1Id);
      assert(found !== undefined, 'Created sprint found in project list');
      assert(found && found.item_count === 0 && found.total_story_points === 0, 'Sprint initial stats are 0');
    }

    // --- TEST 6: GET /api/sprint/:sprintId ---
    {
      const res = await fetch(`${baseUrl}/api/sprint/${sprint1Id}`, {
        headers: { 'Authorization': `Bearer ${memberToken}` }
      });
      const data = await res.json();
      assert(res.status === 200, 'Member can view sprint detail (HTTP 200, Role: All)');
      assert(data && data.id === sprint1Id, 'Sprint detail ID matches');
      assert(Array.isArray(data.items) && data.items.length === 0, 'Sprint items list initially empty');
    }

    // --- TEST 7: Admin updates sprint ---
    console.log('\n--- 4. SPRINT UPDATE & PERMISSION TESTS ---');
    {
      const res = await fetch(`${baseUrl}/api/sprint/${sprint1Id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${adminToken}`
        },
        body: JSON.stringify({
          name: 'Sprint 1 - Foundation & Architecture',
          goal: 'Updated Architecture Goal',
          start_date: '2026-11-02'
        })
      });
      const data = await res.json();
      assert(res.status === 200, 'Admin can update sprint details (HTTP 200)');
      assert(data.name === 'Sprint 1 - Foundation & Architecture', 'Updated name reflected');
      assert(data.goal === 'Updated Architecture Goal', 'Updated goal reflected');
    }

    // --- TEST 8: Member blocked from updating sprint ---
    {
      const res = await fetch(`${baseUrl}/api/sprint/${sprint1Id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${memberToken}`
        },
        body: JSON.stringify({ name: 'Hacked Sprint Name' })
      });
      assert(res.status === 403, 'Member blocked from updating sprint (HTTP 403 Forbidden)');
    }

    // --- TEST 9: Admin starts Sprint (DRAFT -> ACTIVE) ---
    console.log('\n--- 5. SPRINT LIFECYCLE: START & RULE 1 ENFORCEMENT ---');
    {
      const res = await fetch(`${baseUrl}/api/sprint/${sprint1Id}/start`, {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${adminToken}` }
      });
      const data = await res.json();
      assert(res.status === 200, 'Admin starts Sprint (HTTP 200)');
      assert(data.status === 'ACTIVE', 'Sprint status is now ACTIVE');
    }

    // --- TEST 10: Member blocked from starting sprint ---
    {
      // Create a draft sprint 2 first
      const createRes = await fetch(`${baseUrl}/api/sprint/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${adminToken}`
        },
        body: JSON.stringify({
          project_id: projectId,
          name: 'Sprint 2 - Secondary'
        })
      });
      const createData = await createRes.json();
      sprint2Id = createData.id;

      const res = await fetch(`${baseUrl}/api/sprint/${sprint2Id}/start`, {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${memberToken}` }
      });
      assert(res.status === 403, 'Member blocked from starting sprint (HTTP 403 Forbidden)');
    }

    // --- TEST 11: Non-negotiable Rule 1: One Active Sprint Per Project ---
    {
      const res = await fetch(`${baseUrl}/api/sprint/${sprint2Id}/start`, {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${adminToken}` }
      });
      const data = await res.json();
      assert(res.status === 400, 'Rule 1 Enforced: Starting 2nd active sprint blocked (HTTP 400)', data?.error);
    }

    // --- TEST 12: Non-negotiable Rule 6: Cannot delete ACTIVE sprint ---
    console.log('\n--- 6. SPRINT DELETE & RULE 6 ENFORCEMENT ---');
    {
      const res = await fetch(`${baseUrl}/api/sprint/${sprint1Id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${adminToken}` }
      });
      const data = await res.json();
      assert(res.status === 400, 'Rule 6 Enforced: Cannot delete ACTIVE sprint (HTTP 400)', data?.error);
    }

    // --- TEST 13 & 14: Seed backlog items into Sprint 1 and check computed stats ---
    console.log('\n--- 7. SPRINT VELOCITY & COMPLETION TESTS ---');
    {
      // Insert item 1: DONE, 8 story points
      execute(`
        INSERT INTO backlog_items (
          project_id, sprint_id, title, description, type, priority, story_points, status, created_by, position, created_at
        ) VALUES (
          ?, ?, 'Core DB Setup', 'Task 1', 'STORY', 'HIGH', 8, 'DONE', ?, 1, datetime('now')
        )
      `, [projectId, sprint1Id, adminUser.id]);

      // Insert item 2: TODO, 5 story points
      execute(`
        INSERT INTO backlog_items (
          project_id, sprint_id, title, description, type, priority, story_points, status, created_by, position, created_at
        ) VALUES (
          ?, ?, 'UI Polish', 'Task 2', 'STORY', 'MEDIUM', 5, 'TODO', ?, 2, datetime('now')
        )
      `, [projectId, sprint1Id, adminUser.id]);

      const res = await fetch(`${baseUrl}/api/sprint/${sprint1Id}`, {
        headers: { 'Authorization': `Bearer ${memberToken}` }
      });
      const data = await res.json();
      assert(data.item_count === 2, 'Sprint detail shows 2 items', `Items: ${data.item_count}`);
      assert(data.total_story_points === 13, 'Total committed points calculated as 13', `Points: ${data.total_story_points}`);
      assert(data.completed_story_points === 8, 'Completed points calculated as 8', `Done: ${data.completed_story_points}`);
      assert(data.completion_rate === 61.54, 'Completion rate accurately calculated as 61.54%', `Rate: ${data.completion_rate}%`);
    }

    // --- TEST 15: Member blocked from completing sprint ---
    {
      const res = await fetch(`${baseUrl}/api/sprint/${sprint1Id}/complete`, {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${memberToken}` }
      });
      assert(res.status === 403, 'Member blocked from completing sprint (HTTP 403 Forbidden)');
    }

    // --- TEST 16 & 17: Admin completes Sprint -> Rule 2 Velocity Auto-Log ---
    {
      const res = await fetch(`${baseUrl}/api/sprint/${sprint1Id}/complete`, {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${adminToken}` }
      });
      const data = await res.json();
      assert(res.status === 200, 'Admin completes sprint (HTTP 200)');
      assert(data.sprint && data.sprint.status === 'COMPLETED', 'Sprint status is now COMPLETED');
      assert(data.velocity_log !== undefined, 'Rule 2 Enforced: Response returns auto-logged velocity record');
      assert(data.velocity_log.total_points_committed === 13, 'Velocity log committed points match (13)', `Committed: ${data.velocity_log.total_points_committed}`);
      assert(data.velocity_log.total_points_completed === 8, 'Velocity log completed points match (8)', `Completed: ${data.velocity_log.total_points_completed}`);
      assert(data.velocity_log.completion_rate === 61.54, 'Velocity log completion rate matches (61.54%)', `Rate: ${data.velocity_log.completion_rate}%`);

      // Verify directly in DB
      const dbLogRow = queryOne('SELECT * FROM sprint_velocity_log WHERE sprint_id = ?', [sprint1Id]);
      assert(dbLogRow !== null, 'Velocity record verified in sprint_velocity_log database table');
      assert(dbLogRow && dbLogRow.total_points_completed === 8, 'Database velocity row contains correct points');
    }

    // --- TEST 18: Cannot re-complete COMPLETED sprint ---
    {
      const res = await fetch(`${baseUrl}/api/sprint/${sprint1Id}/complete`, {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${adminToken}` }
      });
      assert(res.status === 400, 'Cannot re-complete already completed sprint (HTTP 400)');
    }

    // --- TEST 19: Cannot delete COMPLETED sprint ---
    {
      const res = await fetch(`${baseUrl}/api/sprint/${sprint1Id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${adminToken}` }
      });
      assert(res.status === 400, 'Rule 6 Enforced: Cannot delete COMPLETED sprint (HTTP 400)');
    }

    // --- TEST 20: Admin deletes DRAFT sprint (Sprint 2) ---
    {
      const res = await fetch(`${baseUrl}/api/sprint/${sprint2Id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${adminToken}` }
      });
      const data = await res.json();
      assert(res.status === 200, 'Admin deletes DRAFT sprint (HTTP 200)', data?.message);

      const checkRow = queryOne('SELECT id FROM sprints WHERE id = ?', [sprint2Id]);
      assert(checkRow === null, 'Deleted draft sprint verified removed from database');
    }

    // --- TEST 21: Now that Sprint 1 is COMPLETED, new sprint can be started ---
    {
      const createRes = await fetch(`${baseUrl}/api/sprint/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${adminToken}`
        },
        body: JSON.stringify({
          project_id: projectId,
          name: 'Sprint 3 - Next Phase'
        })
      });
      const sprint3 = await createRes.json();
      const startRes = await fetch(`${baseUrl}/api/sprint/${sprint3.id}/start`, {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${adminToken}` }
      });
      const startData = await startRes.json();
      assert(startRes.status === 200 && startData.status === 'ACTIVE', 'New sprint can be started once previous sprint is completed (HTTP 200 ACTIVE)');
    }

  } finally {
    server.close();
  }

  console.log('\n===================================================================');
  console.log(`  PRD 18 LAYER 2 TEST SUMMARY: ${passedTests} / ${totalTests} TESTS PASSED`);
  if (failedTests > 0) {
    console.error(`  ❌ ${failedTests} TESTS FAILED`);
    process.exit(1);
  } else {
    console.log('  🎉 ALL LAYER 2 TESTS PASSED PERFECTLY!');
  }
  console.log('===================================================================\n');
}

run().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
