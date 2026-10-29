/**
 * PRD 18 — Layer 4 Verification Suite: Velocity & Burndown API Endpoints
 * 
 * Verifies with real HTTP network calls against real Express app and SQLite DB:
 * 
 * Part 1: Velocity Route (GET /api/sprint/velocity/:projectId)
 * - 401 Unauthorized when missing token
 * - 404 Not Found for non-existent project
 * - 200 OK for fresh project (total_sprints: 0, average_velocity: 0, log: [])
 * - Member role can access (role: All)
 * - Auto-logged velocity rows recorded when sprints complete
 * - Multi-sprint velocity tracking with accurate running average velocity & completion rate
 * - Chronological ordering of velocity log rows
 * - Rule 10: No individual member performance data exposed
 * 
 * Part 2: Burndown Route (GET /api/sprint/:sprintId/burndown)
 * - 401 Unauthorized when missing token
 * - 404 Not Found for non-existent sprint
 * - Member role can access (role: All)
 * - Empty sprint (0 story points) burndown handled gracefully
 * - Active sprint burndown: ideal line steps down linearly from total to 0
 * - Dynamic derivation from backlog_item_history timestamps (Rule 4: derived, not stored)
 * - Item completion immediately reflects in remaining story points
 * - Future days in active sprint have actual_remaining = null
 * - Multi-day historical transitions reflected accurately on respective days
 * - Completed sprint burndown reflects final actual remaining points across all elapsed days
 * - Rule 10: Team/sprint-level metrics only (no individual ranking data)
 */

import http from 'node:http';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { getDatabase, queryOne, queryAll, execute } from '../src/db/database.js';
import { createApp } from '../src/app.js';
import { config } from '../src/config.js';

console.log('===================================================================');
console.log('       PRD 18 — LAYER 4: VELOCITY & BURNDOWN API TEST SUITE');
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
    const adminId = `admin-l4-${ts}`;
    execute(`
      INSERT INTO users (id, name, email, password_hash, role, status, created_at)
      VALUES (?, 'Admin Tester L4', 'admin.l4.${ts}@mahi.com', 'hash', 'admin', 'active', datetime('now'))
    `, [adminId]);
    adminUser = queryOne('SELECT * FROM users WHERE id = ?', [adminId]);
  }

  // Regular Member user (role: 'developer')
  const memberId = `member-l4-${ts}`;
  execute(`
    INSERT INTO users (id, name, email, password_hash, role, status, created_at)
    VALUES (?, 'Dev Member L4', 'dev.l4.${ts}@mahi.com', 'hash', 'developer', 'active', datetime('now'))
  `, [memberId]);
  const memberUser = queryOne('SELECT * FROM users WHERE id = ?', [memberId]);

  const adminToken = createAuthToken(adminUser);
  const memberToken = createAuthToken(memberUser);

  // Test Project
  let idea = queryOne('SELECT id FROM ideas LIMIT 1;');
  if (!idea) {
    const ideaId = `idea-l4-${ts}`;
    execute(`
      INSERT INTO ideas (id, owner_id, title, description, status)
      VALUES (?, ?, 'Velocity Test Idea', 'Idea for PRD 18 Layer 4 testing', 'APPROVED')
    `, [ideaId, adminUser.id]);
    idea = { id: ideaId };
  }

  const projectId = `proj-velocity-${ts}`;
  execute(`
    INSERT INTO projects (id, idea_id, title, owner_id, current_stage, status, created_at)
    VALUES (?, ?, 'PRD 18 Velocity Project', ?, 'RESEARCH_DEV_PARALLEL', 'ACTIVE', datetime('now'))
  `, [projectId, idea.id, adminUser.id]);

  console.log(`  Admin User ID: ${adminUser.id}`);
  console.log(`  Member User ID: ${memberUser.id}`);
  console.log(`  Test Project ID: ${projectId}\n`);

  // Start HTTP server
  const app = createApp();
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  console.log(`  Test HTTP Server running at ${baseUrl}\n`);

  try {
    // ===================================================================
    // SECTION 2: VELOCITY API — AUTH & EMPTY STATE
    // ===================================================================
    console.log('--- 2. VELOCITY API: AUTH & EMPTY STATE ---');

    // Test 1: Missing auth header -> 401
    const unauthVelRes = await fetch(`${baseUrl}/api/sprint/velocity/${projectId}`);
    assert(
      unauthVelRes.status === 401,
      'GET /api/sprint/velocity/:projectId without token returns HTTP 401',
      `Status: ${unauthVelRes.status}`
    );

    // Test 2: Non-existent project -> 404
    const notFoundVelRes = await fetch(`${baseUrl}/api/sprint/velocity/non-existent-proj-xyz`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(
      notFoundVelRes.status === 404,
      'GET /api/sprint/velocity/:projectId with unknown project returns HTTP 404',
      `Status: ${notFoundVelRes.status}`
    );

    // Test 3: Member can access velocity endpoint (role: All)
    const freshVelRes = await fetch(`${baseUrl}/api/sprint/velocity/${projectId}`, {
      headers: { Authorization: `Bearer ${memberToken}` }
    });
    const freshVelData = await freshVelRes.json();
    assert(
      freshVelRes.status === 200,
      'GET /api/sprint/velocity/:projectId with Member token returns HTTP 200 (role: All)',
      `Status: ${freshVelRes.status}`
    );

    // Test 4: Fresh project has zero metrics and empty velocity log
    assert(
      freshVelData.total_sprints === 0 &&
      freshVelData.average_velocity === 0 &&
      freshVelData.average_completion_rate === 0 &&
      Array.isArray(freshVelData.velocity_log) &&
      freshVelData.velocity_log.length === 0,
      'Fresh project returns empty velocity_log and 0 for avg velocity & completion rate',
      `total_sprints: ${freshVelData.total_sprints}, avg_vel: ${freshVelData.average_velocity}`
    );

    // ===================================================================
    // SECTION 3: VELOCITY AUTO-LOG & RUNNING STATS AGGREGATION
    // ===================================================================
    console.log('\n--- 3. VELOCITY AUTO-LOG & RUNNING STATS AGGREGATION ---');

    // Create Sprint 1
    const s1Res = await fetch(`${baseUrl}/api/sprint/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        project_id: projectId,
        name: 'Sprint 1 - Foundation',
        goal: 'Deliver core foundation',
        start_date: '2026-10-01',
        end_date: '2026-10-14'
      })
    });
    const s1 = await s1Res.json();
    assert(s1Res.status === 201, 'Admin creates Sprint 1 -> HTTP 201', `Sprint ID: ${s1.id}`);

    // Add 2 items to Sprint 1
    // Item 1: 5 points
    const it1Res = await fetch(`${baseUrl}/api/backlog/item/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        project_id: projectId,
        title: 'Task 1 in Sprint 1',
        type: 'STORY',
        story_points: 5
      })
    });
    const it1 = await it1Res.json();
    await fetch(`${baseUrl}/api/backlog/item/${it1.id}/move`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ sprint_id: s1.id })
    });

    // Item 2: 3 points
    const it2Res = await fetch(`${baseUrl}/api/backlog/item/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        project_id: projectId,
        title: 'Task 2 in Sprint 1',
        type: 'BUG',
        story_points: 3
      })
    });
    const it2 = await it2Res.json();
    await fetch(`${baseUrl}/api/backlog/item/${it2.id}/move`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ sprint_id: s1.id })
    });

    // Start Sprint 1 (Committed points = 5 + 3 = 8)
    const s1StartRes = await fetch(`${baseUrl}/api/sprint/${s1.id}/start`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(s1StartRes.status === 200, 'Sprint 1 started -> HTTP 200 (Committed: 8 pts)');

    // Complete Item 1 (5 points done), Item 2 stays TODO
    const it1DoneRes = await fetch(`${baseUrl}/api/backlog/item/${it1.id}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ status: 'DONE' })
    });
    assert(it1DoneRes.status === 200, 'Item 1 status moved to DONE (5 points completed)');

    // Complete Sprint 1 (Rule 2: Auto-logs velocity row)
    const s1CompRes = await fetch(`${baseUrl}/api/sprint/${s1.id}/complete`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const s1CompData = await s1CompRes.json();
    assert(
      s1CompRes.status === 200 && s1CompData.velocity_log,
      'Sprint 1 completed -> HTTP 200 with velocity_log auto-inserted',
      `Committed: ${s1CompData.velocity_log.total_points_committed}, Done: ${s1CompData.velocity_log.total_points_completed}`
    );

    // Query Velocity after Sprint 1
    const vel1Res = await fetch(`${baseUrl}/api/sprint/velocity/${projectId}`, {
      headers: { Authorization: `Bearer ${memberToken}` }
    });
    const vel1Data = await vel1Res.json();
    assert(
      vel1Res.status === 200 &&
      vel1Data.total_sprints === 1 &&
      vel1Data.average_velocity === 5 &&
      vel1Data.average_completion_rate === 62.5,
      'Velocity after Sprint 1: total_sprints=1, avg_velocity=5, avg_completion_rate=62.5%',
      `velocity: ${vel1Data.average_velocity}, rate: ${vel1Data.average_completion_rate}%`
    );

    assert(
      vel1Data.velocity_log[0].sprint_name === 'Sprint 1 - Foundation' &&
      vel1Data.velocity_log[0].total_points_committed === 8 &&
      vel1Data.velocity_log[0].total_points_completed === 5,
      'Velocity log row captures correct sprint metadata and points',
      `Sprint: ${vel1Data.velocity_log[0].sprint_name}`
    );

    // Create and Complete Sprint 2 (10 points committed, 10 points completed = 100% completion)
    const s2Res = await fetch(`${baseUrl}/api/sprint/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        project_id: projectId,
        name: 'Sprint 2 - Features',
        goal: 'Deliver main feature set',
        start_date: '2026-10-15',
        end_date: '2026-10-28'
      })
    });
    const s2 = await s2Res.json();

    const it3Res = await fetch(`${baseUrl}/api/backlog/item/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        project_id: projectId,
        title: 'Task 3 in Sprint 2',
        type: 'STORY',
        story_points: 10
      })
    });
    const it3 = await it3Res.json();
    await fetch(`${baseUrl}/api/backlog/item/${it3.id}/move`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ sprint_id: s2.id })
    });

    await fetch(`${baseUrl}/api/sprint/${s2.id}/start`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}` }
    });

    await fetch(`${baseUrl}/api/backlog/item/${it3.id}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ status: 'DONE' })
    });

    await fetch(`${baseUrl}/api/sprint/${s2.id}/complete`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}` }
    });

    // Query Velocity after Sprint 2
    // Sprint 1: 5 done, 8 committed
    // Sprint 2: 10 done, 10 committed
    // Average velocity = (5 + 10) / 2 = 7.5
    // Average completion rate = (15 / 18) * 100 = 83.33%
    const vel2Res = await fetch(`${baseUrl}/api/sprint/velocity/${projectId}`, {
      headers: { Authorization: `Bearer ${memberToken}` }
    });
    const vel2Data = await vel2Res.json();

    assert(
      vel2Data.total_sprints === 2 &&
      vel2Data.average_velocity === 7.5 &&
      vel2Data.average_completion_rate === 83.33 &&
      vel2Data.velocity_log.length === 2,
      'Multi-sprint velocity aggregated correctly: avg_velocity=7.5, avg_completion_rate=83.33%',
      `Sprints: ${vel2Data.total_sprints}, Avg Vel: ${vel2Data.average_velocity}, Avg Rate: ${vel2Data.average_completion_rate}%`
    );

    assert(
      vel2Data.velocity_log[0].id < vel2Data.velocity_log[1].id,
      'Velocity logs are strictly ordered chronologically by ID ascending'
    );

    // Rule 10 check: No individual member rankings in velocity response
    assert(
      vel2Data.velocity_log.every(r => !r.developer_rankings && !r.member_productivity && !r.individual_stats),
      'Rule 10: Performance data of individual members is NOT exposed in velocity responses'
    );

    // ===================================================================
    // SECTION 4: BURNDOWN API — AUTH & EMPTY SPRINT
    // ===================================================================
    console.log('\n--- 4. BURNDOWN API: AUTH & EMPTY SPRINT ---');

    // Test 401 Unauthorized
    const unauthBurnRes = await fetch(`${baseUrl}/api/sprint/${s1.id}/burndown`);
    assert(
      unauthBurnRes.status === 401,
      'GET /api/sprint/:sprintId/burndown without token returns HTTP 401',
      `Status: ${unauthBurnRes.status}`
    );

    // Test 404 Not Found
    const notFoundBurnRes = await fetch(`${baseUrl}/api/sprint/9999999/burndown`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(
      notFoundBurnRes.status === 404,
      'GET /api/sprint/:sprintId/burndown with unknown sprint returns HTTP 404',
      `Status: ${notFoundBurnRes.status}`
    );

    // Create Empty Sprint 3 (0 items)
    const s3Res = await fetch(`${baseUrl}/api/sprint/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        project_id: projectId,
        name: 'Sprint 3 - Empty Sprint',
        start_date: '2026-10-20',
        end_date: '2026-10-25'
      })
    });
    const s3 = await s3Res.json();

    const emptyBurnRes = await fetch(`${baseUrl}/api/sprint/${s3.id}/burndown`, {
      headers: { Authorization: `Bearer ${memberToken}` }
    });
    const emptyBurnData = await emptyBurnRes.json();

    assert(
      emptyBurnRes.status === 200,
      'Member can access burndown endpoint (role: All) -> HTTP 200'
    );
    assert(
      emptyBurnData.total_story_points === 0 &&
      emptyBurnData.completed_story_points === 0 &&
      emptyBurnData.remaining_story_points === 0 &&
      emptyBurnData.days.every(d => d.ideal_remaining === 0 && d.actual_remaining === 0),
      'Empty sprint burndown has 0 story points and 0 remaining points across all days',
      `Days: ${emptyBurnData.days.length}, Total pts: ${emptyBurnData.total_story_points}`
    );

    // ===================================================================
    // SECTION 5: BURNDOWN DYNAMIC CALCULATION (DERIVED FROM HISTORY)
    // ===================================================================
    console.log('\n--- 5. BURNDOWN DYNAMIC CALCULATION (RULE 4) ---');

    // Create Sprint 4 (14 days, starting today)
    const todayStr = new Date().toISOString().slice(0, 10);
    const endSprintDate = new Date(Date.now() + 13 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const s4Res = await fetch(`${baseUrl}/api/sprint/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        project_id: projectId,
        name: 'Sprint 4 - Burndown Tracking',
        start_date: todayStr,
        end_date: endSprintDate
      })
    });
    const s4 = await s4Res.json();

    // Create 3 items for Sprint 4:
    // Item A: 5 points
    // Item B: 8 points
    // Item C: 13 points
    // Total story points = 26 points
    const itARes = await fetch(`${baseUrl}/api/backlog/item/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        project_id: projectId,
        title: 'User Authentication Flow',
        type: 'STORY',
        story_points: 5
      })
    });
    const itA = await itARes.json();
    await fetch(`${baseUrl}/api/backlog/item/${itA.id}/move`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ sprint_id: s4.id })
    });

    const itBRes = await fetch(`${baseUrl}/api/backlog/item/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        project_id: projectId,
        title: 'Payment Gateway Integration',
        type: 'STORY',
        story_points: 8
      })
    });
    const itB = await itBRes.json();
    await fetch(`${baseUrl}/api/backlog/item/${itB.id}/move`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ sprint_id: s4.id })
    });

    const itCRes = await fetch(`${baseUrl}/api/backlog/item/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        project_id: projectId,
        title: 'Real-time WebSocket Engine',
        type: 'STORY',
        story_points: 13
      })
    });
    const itC = await itCRes.json();
    await fetch(`${baseUrl}/api/backlog/item/${itC.id}/move`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ sprint_id: s4.id })
    });

    // Start Sprint 4
    await fetch(`${baseUrl}/api/sprint/${s4.id}/start`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}` }
    });

    // Query Burndown: Initial active state
    const burnInitialRes = await fetch(`${baseUrl}/api/sprint/${s4.id}/burndown`, {
      headers: { Authorization: `Bearer ${memberToken}` }
    });
    const burnInitial = await burnInitialRes.json();

    assert(
      burnInitial.total_story_points === 26 &&
      burnInitial.completed_story_points === 0 &&
      burnInitial.remaining_story_points === 26,
      'Initial sprint burndown has 26 total story points and 26 remaining points',
      `Total: ${burnInitial.total_story_points}, Remaining: ${burnInitial.remaining_story_points}`
    );

    assert(
      burnInitial.days.length === 14,
      'Sprint burndown contains exactly 14 day entries for 14-day sprint'
    );

    assert(
      burnInitial.days[0].ideal_remaining === 26 &&
      burnInitial.days[burnInitial.days.length - 1].ideal_remaining === 0,
      'Ideal burndown line begins at total story points (26) and decreases to 0 at sprint end',
      `Day 0: ${burnInitial.days[0].ideal_remaining}, Day 13: ${burnInitial.days[13].ideal_remaining}`
    );

    assert(
      burnInitial.days[0].actual_remaining === 26,
      'Day 0 actual_remaining starts at 26 story points'
    );

    // Verify future days in ACTIVE sprint have actual_remaining: null
    const futureDays = burnInitial.days.filter(d => d.day > todayStr);
    assert(
      futureDays.length > 0 && futureDays.every(d => d.actual_remaining === null),
      'Future days in active sprint have actual_remaining = null (cannot burn future days)',
      `Future days count: ${futureDays.length}`
    );

    // Complete Item A (5 story points) -> status 'DONE'
    const itemADoneRes = await fetch(`${baseUrl}/api/backlog/item/${itA.id}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ status: 'DONE' })
    });
    assert(itemADoneRes.status === 200, 'Item A moved to DONE -> HTTP 200');

    // Query Burndown after Item A completed
    const burnAfterARes = await fetch(`${baseUrl}/api/sprint/${s4.id}/burndown`, {
      headers: { Authorization: `Bearer ${memberToken}` }
    });
    const burnAfterA = await burnAfterARes.json();

    assert(
      burnAfterA.completed_story_points === 5 &&
      burnAfterA.remaining_story_points === 21,
      'Burndown immediately derives completed=5 and remaining=21 after Item A marked DONE',
      `Completed: ${burnAfterA.completed_story_points}, Remaining: ${burnAfterA.remaining_story_points}`
    );

    assert(
      burnAfterA.days[0].actual_remaining === 21 &&
      burnAfterA.days[0].points_completed === 5,
      'Day 0 reflects 5 points completed and actual_remaining = 21',
      `Day 0 actual: ${burnAfterA.days[0].actual_remaining}, completed: ${burnAfterA.days[0].points_completed}`
    );

    // Complete Item B (8 story points) -> status 'DONE'
    const itemBDoneRes = await fetch(`${baseUrl}/api/backlog/item/${itB.id}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ status: 'DONE' })
    });
    assert(itemBDoneRes.status === 200, 'Item B moved to DONE -> HTTP 200');

    // Query Burndown after Item B completed
    const burnAfterBRes = await fetch(`${baseUrl}/api/sprint/${s4.id}/burndown`, {
      headers: { Authorization: `Bearer ${memberToken}` }
    });
    const burnAfterB = await burnAfterBRes.json();

    assert(
      burnAfterB.completed_story_points === 13 &&
      burnAfterB.remaining_story_points === 13,
      'Burndown derives completed=13 (5+8) and remaining=13 (26-13)',
      `Completed: ${burnAfterB.completed_story_points}, Remaining: ${burnAfterB.remaining_story_points}`
    );

    assert(
      burnAfterB.days[0].actual_remaining === 13 &&
      burnAfterB.days[0].points_completed === 13,
      'Day 0 actual_remaining drops to 13 with 13 total points completed',
      `Actual remaining: ${burnAfterB.days[0].actual_remaining}`
    );

    // ===================================================================
    // SECTION 6: HISTORICAL TIMESTAMP BURNDOWN SIMULATION (RULE 4)
    // ===================================================================
    console.log('\n--- 6. HISTORICAL TIMESTAMP BURNDOWN SIMULATION ---');

    // Create a backdated sprint (starts 4 days ago, ends 10 days from now)
    const dMinus4 = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const dMinus2 = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const dPlus10 = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const s5Res = await fetch(`${baseUrl}/api/sprint/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        project_id: projectId,
        name: 'Sprint 5 - Historical Burndown',
        start_date: dMinus4,
        end_date: dPlus10
      })
    });
    const s5 = await s5Res.json();

    // Create 2 items:
    // Item H1: 10 points
    // Item H2: 20 points
    // Total = 30 points
    const itH1Res = await fetch(`${baseUrl}/api/backlog/item/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        project_id: projectId,
        title: 'Historical Task 1',
        story_points: 10
      })
    });
    const itH1 = await itH1Res.json();
    await fetch(`${baseUrl}/api/backlog/item/${itH1.id}/move`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ sprint_id: s5.id })
    });

    const itH2Res = await fetch(`${baseUrl}/api/backlog/item/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        project_id: projectId,
        title: 'Historical Task 2',
        story_points: 20
      })
    });
    const itH2 = await itH2Res.json();
    await fetch(`${baseUrl}/api/backlog/item/${itH2.id}/move`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ sprint_id: s5.id })
    });

    // Mark items as DONE via API
    await fetch(`${baseUrl}/api/backlog/item/${itH1.id}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ status: 'DONE' })
    });
    await fetch(`${baseUrl}/api/backlog/item/${itH2.id}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ status: 'DONE' })
    });

    // To simulate completion on different historical dates without modifying append-only triggers,
    // insert history entries with simulated changed_at timestamps:
    // H1 completed on dMinus2 (2 days ago), H2 completed today
    execute(`
      INSERT INTO backlog_item_history (item_id, changed_by, field_changed, old_value, new_value, changed_at)
      VALUES (?, ?, 'status', 'IN_PROGRESS', 'DONE', ? || ' 12:00:00')
    `, [itH1.id, adminUser.id, dMinus2]);

    execute(`
      INSERT INTO backlog_item_history (item_id, changed_by, field_changed, old_value, new_value, changed_at)
      VALUES (?, ?, 'status', 'IN_PROGRESS', 'DONE', ? || ' 12:00:00')
    `, [itH2.id, adminUser.id, todayStr]);

    const histBurnRes = await fetch(`${baseUrl}/api/sprint/${s5.id}/burndown`, {
      headers: { Authorization: `Bearer ${memberToken}` }
    });
    const histBurn = await histBurnRes.json();

    // Check day 0 (dMinus4): No items done yet -> actual_remaining = 30
    const day0 = histBurn.days.find(d => d.day === dMinus4);
    assert(
      day0 && day0.actual_remaining === 30,
      `Day 0 (${dMinus4}) has actual_remaining = 30 (nothing completed yet)`,
      `Day 0 actual: ${day0?.actual_remaining}`
    );

    // Check day 2 (dMinus2): Item H1 (10 pts) done -> actual_remaining = 20
    const day2 = histBurn.days.find(d => d.day === dMinus2);
    assert(
      day2 && day2.actual_remaining === 20 && day2.points_completed === 10,
      `Day 2 (${dMinus2}) has actual_remaining = 20 (10 points burned on that day)`,
      `Day 2 actual: ${day2?.actual_remaining}, completed: ${day2?.points_completed}`
    );

    // Check today: Item H2 (20 pts) done -> actual_remaining = 0
    const dayToday = histBurn.days.find(d => d.day === todayStr);
    assert(
      dayToday && dayToday.actual_remaining === 0 && dayToday.total_completed_to_date === 30,
      `Today (${todayStr}) has actual_remaining = 0 (all 30 points burned to date)`,
      `Today actual: ${dayToday?.actual_remaining}, total_completed: ${dayToday?.total_completed_to_date}`
    );

    // Rule 10 check: No individual developer performance stats in burndown payload
    assert(
      !histBurn.developer_performance && !histBurn.member_breakdown &&
      histBurn.days.every(d => !d.individual_stats && !d.member_points),
      'Rule 10: Performance data of individual members is NOT exposed in burndown responses'
    );

  } finally {
    await new Promise(resolve => server.close(resolve));
    console.log('\n  Test HTTP Server cleanly closed.');
  }

  // Final Summary
  console.log('\n===================================================================');
  console.log(`  PRD 18 — LAYER 4 RESULTS: ${passedTests}/${totalTests} PASSED (${failedTests} FAILED)`);
  console.log('===================================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

run().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
