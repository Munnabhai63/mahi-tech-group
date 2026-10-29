import assert from 'node:assert';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app.js';
import { execute, queryOne, queryAll } from '../src/db/database.js';
import { config } from '../src/config.js';

console.log('========================================================================');
console.log('  PRD 20 — LAYER 2: GANTT ITEMS, DEPENDENCY (DAG) & MILESTONE API SUITE');
console.log('========================================================================\n');

let server;
let baseUrl;
let passedAssertions = 0;

function pass(msg) {
  passedAssertions++;
  console.log(`  ✔ PASS: ${msg}`);
}

async function request(method, path, body = null, token = null) {
  const url = `${baseUrl}${path}`;
  const headers = { 'Content-Type': 'application/json' };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const opts = { method, headers };
  if (body) {
    opts.body = JSON.stringify(body);
  }

  const res = await fetch(url, opts);
  let json = null;
  try {
    json = await res.json();
  } catch (e) {
    // Non-JSON response
  }
  return { status: res.status, headers: res.headers, body: json };
}

function createTestToken(user) {
  const sessionId = `test-session-gantt-${Date.now()}-${Math.random().toString(36).substring(7)}`;
  execute(`
    INSERT INTO sessions (id, user_id, token, expires_at, is_revoked)
    VALUES (?, ?, 'active_token', datetime('now', '+1 day'), 0)
  `, [sessionId, user.id]);

  return jwt.sign({
    userId: user.id,
    sessionId,
    role: user.role,
    email: user.email
  }, config.JWT_SECRET, { expiresIn: '1d' });
}

async function runLayer2Tests() {
  const app = createApp();
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      console.log(`[TestServer] Ephemeral server running at ${baseUrl}\n`);
      resolve();
    });
  });

  try {
    // -----------------------------------------------------------------
    // SETUP: Test Users & Project
    // -----------------------------------------------------------------
    console.log('--- PHASE 1: User & Project Fixtures Setup ---');
    const ts = Date.now();
    const adminUser = {
      id: `admin-gantt-${ts}`,
      name: 'Admin Boss',
      email: `admin.gantt.${ts}@mahitechgroup.com`,
      role: 'admin'
    };
    const aliceUser = {
      id: `alice-gantt-${ts}`,
      name: 'Dev Alice',
      email: `alice.gantt.${ts}@mahitechgroup.com`,
      role: 'developer'
    };
    const bobUser = {
      id: `bob-gantt-${ts}`,
      name: 'Designer Bob',
      email: `bob.gantt.${ts}@mahitechgroup.com`,
      role: 'designer'
    };

    for (const u of [adminUser, aliceUser, bobUser]) {
      execute(`
        INSERT INTO users (id, name, email, password_hash, role, status)
        VALUES (?, ?, ?, 'hash123', ?, 'active')
      `, [u.id, u.name, u.email, u.role]);
    }

    const adminToken = createTestToken(adminUser);
    const aliceToken = createTestToken(aliceUser);
    const bobToken = createTestToken(bobUser);

    const testIdeaId = `idea-gantt-${ts}`;
    const testProjectId = `proj-gantt-${ts}`;

    execute(`
      INSERT INTO ideas (id, owner_id, title, description, status)
      VALUES (?, ?, 'Gantt Chart Project Idea', 'Timeline visualization platform', 'APPROVED')
    `, [testIdeaId, adminUser.id]);

    execute(`
      INSERT INTO projects (id, idea_id, owner_id, title, status)
      VALUES (?, ?, ?, 'Enterprise Timeline System', 'ACTIVE')
    `, [testProjectId, testIdeaId, adminUser.id]);

    pass('Admin, Developer Alice, and Designer Bob seeded with active tokens.');
    pass('Project fixture seeded and verified.');

    // -----------------------------------------------------------------
    // PHASE 2: Gantt Item Creation & Validation Rules
    // -----------------------------------------------------------------
    console.log('\n--- PHASE 2: Gantt Item Creation & Date Validation Rules ---');

    // 2a: Member blocked from creating timeline items
    const memCreateRes = await request('POST', '/api/gantt/item/create', {
      project_id: testProjectId,
      title: 'Member Task',
      start_date: '2026-11-01',
      end_date: '2026-11-05'
    }, aliceToken);
    assert.strictEqual(memCreateRes.status, 403, 'Member must receive 403 creating item');
    pass('Member Alice blocked from creating timeline item (HTTP 403).');

    // 2b: Admin missing title
    const noTitleRes = await request('POST', '/api/gantt/item/create', {
      project_id: testProjectId,
      start_date: '2026-11-01',
      end_date: '2026-11-05'
    }, adminToken);
    assert.strictEqual(noTitleRes.status, 400);
    pass('Creation rejected when title is missing (HTTP 400).');

    // 2c: Rule 1: end_date < start_date blocked
    const invalidDateRes = await request('POST', '/api/gantt/item/create', {
      project_id: testProjectId,
      title: 'Time Traveler Task',
      start_date: '2026-11-10',
      end_date: '2026-11-05'
    }, adminToken);
    assert.strictEqual(invalidDateRes.status, 400);
    assert.ok(invalidDateRes.body.error.includes('greater than or equal to start_date'));
    pass('Rule 1: Invalid dates (end_date < start_date) strictly rejected (HTTP 400).');

    // 2d: Rule 2: MILESTONE type start_date !== end_date blocked
    const badMilestoneRes = await request('POST', '/api/gantt/item/create', {
      project_id: testProjectId,
      title: 'Multi-day Milestone',
      type: 'MILESTONE',
      start_date: '2026-11-01',
      end_date: '2026-11-05'
    }, adminToken);
    assert.strictEqual(badMilestoneRes.status, 400);
    assert.ok(badMilestoneRes.body.error.includes('MILESTONE type must have start_date equal to end_date'));
    pass('Rule 2: MILESTONE type with start_date != end_date strictly rejected (HTTP 400).');

    // 2e: Create valid Task A (Assigned to Alice)
    const taskARes = await request('POST', '/api/gantt/item/create', {
      project_id: testProjectId,
      title: 'Task A: Requirements Gathering',
      type: 'TASK',
      start_date: '2026-11-01',
      end_date: '2026-11-05',
      assigned_to: aliceUser.id,
      color: '#4A90E2',
      position: 1
    }, adminToken);
    assert.strictEqual(taskARes.status, 201);
    const taskA = taskARes.body.item;
    assert.ok(taskA.id > 0);
    assert.strictEqual(taskA.title, 'Task A: Requirements Gathering');
    assert.strictEqual(taskA.assigned_to, aliceUser.id);
    pass('Admin successfully created Task A (Assigned to Alice, 2026-11-01 to 2026-11-05).');

    // 2f: Create valid Task B (Assigned to Bob)
    const taskBRes = await request('POST', '/api/gantt/item/create', {
      project_id: testProjectId,
      title: 'Task B: Architectural Blueprint',
      type: 'TASK',
      start_date: '2026-11-06',
      end_date: '2026-11-12',
      assigned_to: bobUser.id,
      color: '#E67E22',
      position: 2
    }, adminToken);
    assert.strictEqual(taskBRes.status, 201);
    const taskB = taskBRes.body.item;
    pass('Admin successfully created Task B (Assigned to Bob, 2026-11-06 to 2026-11-12).');

    // 2g: Create valid Task C (Assigned to Alice)
    const taskCRes = await request('POST', '/api/gantt/item/create', {
      project_id: testProjectId,
      title: 'Task C: Backend Core Engine',
      type: 'TASK',
      start_date: '2026-11-13',
      end_date: '2026-11-20',
      assigned_to: aliceUser.id,
      color: '#2ECC71',
      position: 3
    }, adminToken);
    assert.strictEqual(taskCRes.status, 201);
    const taskC = taskCRes.body.item;
    pass('Admin successfully created Task C (Assigned to Alice, 2026-11-13 to 2026-11-20).');

    // 2h: Create valid Milestone Item D
    const taskDRes = await request('POST', '/api/gantt/item/create', {
      project_id: testProjectId,
      title: 'Item D: Architecture Sign-off',
      type: 'MILESTONE',
      start_date: '2026-11-25',
      end_date: '2026-11-25',
      color: '#9B59B6',
      position: 4
    }, adminToken);
    assert.strictEqual(taskDRes.status, 201);
    const taskD = taskDRes.body.item;
    assert.strictEqual(taskD.type, 'MILESTONE');
    assert.strictEqual(taskD.start_date, taskD.end_date);
    pass('Admin successfully created Milestone Item D (start_date === end_date === 2026-11-25).');

    // -----------------------------------------------------------------
    // PHASE 3: Read Operations & Project Timeline Rollup
    // -----------------------------------------------------------------
    console.log('\n--- PHASE 3: Read Endpoints & Timeline Inspection ---');

    const projGanttRes = await request('GET', `/api/gantt/project/${testProjectId}`, null, aliceToken);
    assert.strictEqual(projGanttRes.status, 200);
    assert.ok(Array.isArray(projGanttRes.body.items));
    assert.strictEqual(projGanttRes.body.items.length, 4);
    assert.ok(projGanttRes.body.items.some(i => i.id === taskA.id && i.assignee_name === 'Dev Alice'));
    pass('GET /api/gantt/project/:projectId returns all items with assignee metadata (HTTP 200).');

    const itemDetailRes = await request('GET', `/api/gantt/item/${taskA.id}`, null, aliceToken);
    assert.strictEqual(itemDetailRes.status, 200);
    assert.strictEqual(itemDetailRes.body.id, taskA.id);
    assert.ok(Array.isArray(itemDetailRes.body.history));
    pass('GET /api/gantt/item/:itemId returns item detail with audit history.');

    // -----------------------------------------------------------------
    // PHASE 4: Dependency Creation & DAG Cycle Detection
    // -----------------------------------------------------------------
    console.log('\n--- PHASE 4: Dependency Graph & Circular Cycle Detection ---');

    // 4a: Member blocked from creating dependencies
    const memDepRes = await request('POST', '/api/gantt/dependency/add', {
      project_id: testProjectId,
      predecessor_item_id: taskA.id,
      successor_item_id: taskB.id
    }, aliceToken);
    assert.strictEqual(memDepRes.status, 403);
    pass('Member Alice blocked from adding dependency (HTTP 403).');

    // 4b: Cannot depend on self
    const selfDepRes = await request('POST', '/api/gantt/dependency/add', {
      project_id: testProjectId,
      predecessor_item_id: taskA.id,
      successor_item_id: taskA.id
    }, adminToken);
    assert.strictEqual(selfDepRes.status, 400);
    pass('Self dependency attempt strictly rejected (HTTP 400).');

    // 4c: Add Link 1: Task A -> Task B (FINISH_TO_START, lag 1d)
    const dep1Res = await request('POST', '/api/gantt/dependency/add', {
      project_id: testProjectId,
      predecessor_item_id: taskA.id,
      successor_item_id: taskB.id,
      dependency_type: 'FINISH_TO_START',
      lag_days: 1
    }, adminToken);
    assert.strictEqual(dep1Res.status, 201);
    const dep1 = dep1Res.body.dependency;
    assert.strictEqual(dep1.predecessor_item_id, taskA.id);
    assert.strictEqual(dep1.successor_item_id, taskB.id);
    pass('Admin added Dependency: Task A -> Task B (FINISH_TO_START, lag 1d).');

    // 4d: Add Link 2: Task B -> Task C (FINISH_TO_START, lag 1d)
    const dep2Res = await request('POST', '/api/gantt/dependency/add', {
      project_id: testProjectId,
      predecessor_item_id: taskB.id,
      successor_item_id: taskC.id,
      dependency_type: 'FINISH_TO_START',
      lag_days: 1
    }, adminToken);
    assert.strictEqual(dep2Res.status, 201);
    pass('Admin added Dependency: Task B -> Task C (FINISH_TO_START, lag 1d).');

    // 4e: Attempt Circular Link: Task C -> Task A (Cycle A -> B -> C -> A)
    const cycleRes = await request('POST', '/api/gantt/dependency/add', {
      project_id: testProjectId,
      predecessor_item_id: taskC.id,
      successor_item_id: taskA.id,
      dependency_type: 'FINISH_TO_START'
    }, adminToken);
    assert.strictEqual(cycleRes.status, 400);
    assert.ok(cycleRes.body.error.includes('Circular dependency detected'));
    assert.ok(cycleRes.body.error.includes('A → B → C → A'));
    pass('Circular dependency attempt (C -> A, closing A -> B -> C -> A) strictly BLOCKED (HTTP 400).');

    // 4f: Direct 2-hop Cycle: Task B -> Task A (Cycle A -> B -> A)
    const directCycleRes = await request('POST', '/api/gantt/dependency/add', {
      project_id: testProjectId,
      predecessor_item_id: taskB.id,
      successor_item_id: taskA.id
    }, adminToken);
    assert.strictEqual(directCycleRes.status, 400);
    assert.ok(directCycleRes.body.error.includes('Circular dependency detected'));
    pass('Immediate reverse dependency (B -> A) strictly BLOCKED (HTTP 400).');

    // 4g: Duplicate dependency blocked
    const dupDepRes = await request('POST', '/api/gantt/dependency/add', {
      project_id: testProjectId,
      predecessor_item_id: taskA.id,
      successor_item_id: taskB.id
    }, adminToken);
    assert.strictEqual(dupDepRes.status, 400);
    pass('Duplicate dependency link rejected (HTTP 400).');

    // 4h: Verify in database
    const dbDeps = queryAll('SELECT id, predecessor_item_id, successor_item_id FROM gantt_dependencies WHERE project_id = ?', [testProjectId]);
    assert.strictEqual(dbDeps.length, 2, 'Exactly 2 dependencies must exist in DB');
    pass('Direct DB SELECT confirms zero invalid/circular links stored in gantt_dependencies.');

    // -----------------------------------------------------------------
    // PHASE 5: Progress % Update & History Auto-Logging
    // -----------------------------------------------------------------
    console.log('\n--- PHASE 5: Progress % Updates, Auto-Completion & History Logging ---');

    // 5a: Bob blocked from updating Alice's task progress
    const bobUpdateAliceRes = await request('PATCH', `/api/gantt/item/${taskA.id}/progress`, {
      progress_pct: 40
    }, bobToken);
    assert.strictEqual(bobUpdateAliceRes.status, 403);
    pass('Designer Bob blocked from updating Alice Task A progress (HTTP 403).');

    // 5b: Alice updates own Task A progress to 60%
    const aliceUpdateRes = await request('PATCH', `/api/gantt/item/${taskA.id}/progress`, {
      progress_pct: 60
    }, aliceToken);
    assert.strictEqual(aliceUpdateRes.status, 200);
    assert.strictEqual(aliceUpdateRes.body.item.progress_pct, 60);
    pass('Alice successfully updated own Task A progress to 60%.');

    // Verify history log in SQLite
    const histProgress = queryOne(`
      SELECT * FROM gantt_history 
      WHERE gantt_item_id = ? AND field_changed = 'progress_pct'
      ORDER BY changed_at DESC
    `, [taskA.id]);
    assert.ok(histProgress, 'History record for progress_pct must exist');
    assert.strictEqual(histProgress.old_value, '0');
    assert.strictEqual(histProgress.new_value, '60');
    assert.strictEqual(histProgress.changed_by, aliceUser.id);
    pass('Direct DB SELECT confirms append-only history logged for progress_pct (0 -> 60).');

    // 5c: Alice updates Task A progress to 100% -> Auto status COMPLETED
    const completeRes = await request('PATCH', `/api/gantt/item/${taskA.id}/progress`, {
      progress_pct: 100
    }, aliceToken);
    assert.strictEqual(completeRes.status, 200);
    assert.strictEqual(completeRes.body.item.progress_pct, 100);
    assert.strictEqual(completeRes.body.item.status, 'COMPLETED');
    pass('Progress = 100% auto-transitions status to COMPLETED.');

    const histStatus = queryOne(`
      SELECT * FROM gantt_history 
      WHERE gantt_item_id = ? AND field_changed = 'status'
      ORDER BY changed_at DESC
    `, [taskA.id]);
    assert.ok(histStatus);
    assert.strictEqual(histStatus.new_value, 'COMPLETED');
    pass('Direct DB SELECT confirms history logged for auto-status COMPLETED.');

    // 5d: Invalid progress rejected
    const badProgressRes = await request('PATCH', `/api/gantt/item/${taskA.id}/progress`, {
      progress_pct: 150
    }, aliceToken);
    assert.strictEqual(badProgressRes.status, 400);
    pass('Progress > 100 rejected with HTTP 400.');

    // -----------------------------------------------------------------
    // PHASE 6: Item Editing & Date Conflict Warnings
    // -----------------------------------------------------------------
    console.log('\n--- PHASE 6: General Item Updates & Predecessor Date Conflict Warnings ---');

    // 6a: Assignee cannot change item dates or title
    const assigneeChangeDatesRes = await request('PATCH', `/api/gantt/item/${taskA.id}`, {
      start_date: '2026-11-02'
    }, aliceToken);
    assert.strictEqual(assigneeChangeDatesRes.status, 403);
    pass('Assignee blocked from editing timeline dates (Admin only, HTTP 403).');

    // 6b: Admin moves Task A end_date past Task B start_date (Warning Triggered)
    // Task B starts on 2026-11-06. Moving Task A end_date to 2026-11-08 causes date conflict warning
    const patchConflictRes = await request('PATCH', `/api/gantt/item/${taskA.id}`, {
      end_date: '2026-11-08'
    }, adminToken);
    assert.strictEqual(patchConflictRes.status, 200);
    assert.strictEqual(patchConflictRes.body.item.end_date, '2026-11-08');
    assert.ok(Array.isArray(patchConflictRes.body.warnings));
    assert.ok(patchConflictRes.body.warnings.length > 0);
    assert.ok(patchConflictRes.body.warnings[0].includes('Date conflict warning'));
    assert.ok(patchConflictRes.body.warnings[0].includes('Task B: Architectural Blueprint'));
    pass('Predecessor date extension beyond successor start date returns conflict warning alert.');

    // Verify history logged for end_date change
    const histDate = queryOne(`
      SELECT * FROM gantt_history 
      WHERE gantt_item_id = ? AND field_changed = 'end_date'
      ORDER BY changed_at DESC
    `, [taskA.id]);
    assert.ok(histDate);
    assert.strictEqual(histDate.new_value, '2026-11-08');
    pass('Direct DB SELECT confirms history logged for end_date change.');

    // -----------------------------------------------------------------
    // PHASE 7: Delete Item Protection & Soft-Remove Dependency
    // -----------------------------------------------------------------
    console.log('\n--- PHASE 7: Delete Item Protection & Soft-Remove Dependency ---');

    // 7a: Cannot delete Task A because Task B depends on it
    const deleteBlockedRes = await request('DELETE', `/api/gantt/item/${taskA.id}`, null, adminToken);
    assert.strictEqual(deleteBlockedRes.status, 400);
    assert.ok(deleteBlockedRes.body.error.includes('other timeline items depend on it'));
    pass('Item deletion strictly blocked when other timeline items depend on it (HTTP 400).');

    // 7b: Remove dependency A -> B
    const removeDepRes = await request('DELETE', `/api/gantt/dependency/${dep1.id}`, null, adminToken);
    assert.strictEqual(removeDepRes.status, 200);
    assert.strictEqual(removeDepRes.body.id, dep1.id);
    pass('Admin removed dependency A -> B via soft reversal audit log.');

    // Verify append-only protection: gantt_dependencies row still exists in DB
    const dbDepAfterRemove = queryOne('SELECT id FROM gantt_dependencies WHERE id = ?', [dep1.id]);
    assert.ok(dbDepAfterRemove, 'Underlying row remains intact due to append-only trigger');
    pass('Append-only trigger invariant verified: row preserved in gantt_dependencies.');

    // Verify active dependencies endpoint excludes the removed dependency
    const activeDepsRes = await request('GET', `/api/gantt/dependencies/${testProjectId}`, null, aliceToken);
    assert.strictEqual(activeDepsRes.status, 200);
    assert.ok(!activeDepsRes.body.dependencies.some(d => d.id === dep1.id));
    pass('GET /api/gantt/dependencies excludes reversed dependency from active list.');

    // 7c: Now Task A has no active dependents, can be deleted
    const deleteSuccessRes = await request('DELETE', `/api/gantt/item/${taskA.id}`, null, adminToken);
    assert.strictEqual(deleteSuccessRes.status, 200);
    const dbDeletedItem = queryOne('SELECT id FROM gantt_items WHERE id = ?', [taskA.id]);
    assert.strictEqual(dbDeletedItem, null);
    pass('Item with zero dependents successfully deleted (HTTP 200).');

    // -----------------------------------------------------------------
    // PHASE 8: Milestone Management
    // -----------------------------------------------------------------
    console.log('\n--- PHASE 8: Milestone Creation & Status Progression ---');

    // 8a: Member blocked from creating milestones
    const memMileRes = await request('POST', '/api/gantt/milestone/create', {
      project_id: testProjectId,
      title: 'Alpha Release',
      milestone_date: '2026-11-30'
    }, aliceToken);
    assert.strictEqual(memMileRes.status, 403);
    pass('Member Alice blocked from creating milestone (HTTP 403).');

    // 8b: Admin creates milestone linked to Task D
    const createMileRes = await request('POST', '/api/gantt/milestone/create', {
      project_id: testProjectId,
      title: 'Alpha Release Complete',
      milestone_date: '2026-11-30',
      gantt_item_id: taskD.id
    }, adminToken);
    assert.strictEqual(createMileRes.status, 201);
    const milestone = createMileRes.body.milestone;
    assert.strictEqual(milestone.title, 'Alpha Release Complete');
    assert.strictEqual(milestone.status, 'PENDING');
    pass('Admin created project milestone linked to Task D (status: PENDING).');

    // 8c: Fetch milestones
    const getMilesRes = await request('GET', `/api/gantt/milestones/${testProjectId}`, null, aliceToken);
    assert.strictEqual(getMilesRes.status, 200);
    assert.ok(getMilesRes.body.milestones.some(m => m.id === milestone.id));
    pass('GET /api/gantt/milestones/:projectId returns all project milestones.');

    // 8d: Achieve milestone
    const achieveRes = await request('PATCH', `/api/gantt/milestone/${milestone.id}/achieve`, null, adminToken);
    assert.strictEqual(achieveRes.status, 200);
    assert.strictEqual(achieveRes.body.milestone.status, 'ACHIEVED');
    assert.ok(achieveRes.body.milestone.achieved_at);
    pass('PATCH /api/gantt/milestone/:id/achieve marks milestone as ACHIEVED.');

    // Verify linked item Task D was auto-completed
    const linkedItem = queryOne('SELECT progress_pct, status FROM gantt_items WHERE id = ?', [taskD.id]);
    assert.strictEqual(linkedItem.progress_pct, 100);
    assert.strictEqual(linkedItem.status, 'COMPLETED');
    pass('Linked timeline item Task D auto-updated to 100% progress and COMPLETED.');

    // -----------------------------------------------------------------
    // PHASE 9: Item History Inspection & RBAC
    // -----------------------------------------------------------------
    console.log('\n--- PHASE 9: Full History Audit Trail Inspection ---');

    // 9a: Member blocked from reading full history endpoint
    const memHistRes = await request('GET', `/api/gantt/history/${taskB.id}`, null, aliceToken);
    assert.strictEqual(memHistRes.status, 403);
    pass('Member Alice blocked from GET /api/gantt/history/:itemId (HTTP 403).');

    // 9b: Admin reads full history
    const adminHistRes = await request('GET', `/api/gantt/history/${taskB.id}`, null, adminToken);
    assert.strictEqual(adminHistRes.status, 200);
    assert.ok(Array.isArray(adminHistRes.body.history));
    assert.ok(adminHistRes.body.history.length > 0);
    pass('Admin successfully fetched full item history audit trail.');

    console.log('\n========================================================================');
    console.log(`  PRD 20 LAYER 2 ALL TESTS PASSED: ${passedAssertions}/${passedAssertions} ASSERTIONS!`);
    console.log('========================================================================\n');

  } finally {
    if (server) {
      server.close();
    }
  }
}

runLayer2Tests().catch((err) => {
  console.error('\n[FAIL] PRD 20 Layer 2 Test Suite Failed:');
  console.error(err);
  if (server) server.close();
  process.exit(1);
});
