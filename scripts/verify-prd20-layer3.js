import assert from 'node:assert';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app.js';
import { execute, queryOne, queryAll } from '../src/db/database.js';
import { config } from '../src/config.js';

console.log('========================================================================');
console.log('  PRD 20 — LAYER 3: BASELINE SNAPSHOTS, SCHEDULE SLIP & CPM CALCULATION');
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
  const sessionId = `test-session-gantt3-${Date.now()}-${Math.random().toString(36).substring(7)}`;
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

async function runLayer3Tests() {
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
    // PHASE 1: User & Project Setup
    // -----------------------------------------------------------------
    console.log('--- PHASE 1: User & Project Fixtures Setup ---');
    const ts = Date.now();
    const adminUser = {
      id: `admin-gantt3-${ts}`,
      name: 'Admin Boss',
      email: `admin.gantt3.${ts}@mahitechgroup.com`,
      role: 'admin'
    };
    const aliceUser = {
      id: `alice-gantt3-${ts}`,
      name: 'Dev Alice',
      email: `alice.gantt3.${ts}@mahitechgroup.com`,
      role: 'developer'
    };

    for (const u of [adminUser, aliceUser]) {
      execute(`
        INSERT INTO users (id, name, email, password_hash, role, status)
        VALUES (?, ?, ?, 'hash123', ?, 'active')
      `, [u.id, u.name, u.email, u.role]);
    }

    const adminToken = createTestToken(adminUser);
    const aliceToken = createTestToken(aliceUser);
    pass('Created test users (Admin and Member Alice) and JWT tokens.');

    const testIdeaId = `idea-gantt3-${ts}`;
    const testProjectId = `proj-gantt3-${ts}`;

    execute(`
      INSERT INTO ideas (id, owner_id, title, description, status)
      VALUES (?, ?, 'Gantt Layer 3 Test Idea', 'Timeline visualization platform', 'APPROVED')
    `, [testIdeaId, adminUser.id]);

    execute(`
      INSERT INTO projects (id, idea_id, owner_id, title, status)
      VALUES (?, ?, ?, 'Enterprise Timeline Project', 'ACTIVE')
    `, [testProjectId, testIdeaId, adminUser.id]);
    pass(`Created test project ID: ${testProjectId}.`);

    // -----------------------------------------------------------------
    // PHASE 2: Baseline Snapshotting & Role-Based Access Control
    // -----------------------------------------------------------------
    console.log('\n--- PHASE 2: Baseline Snapshotting & RBAC Enforcement ---');

    // 2a: Member blocked from creating baseline snapshot
    const memSnapRes = await request('POST', '/api/gantt/baseline/snapshot', {
      project_id: testProjectId
    }, aliceToken);
    assert.strictEqual(memSnapRes.status, 403);
    pass('Member Alice blocked from creating baseline snapshot (HTTP 403).');

    // 2b: Admin attempts snapshot on empty project
    const emptySnapRes = await request('POST', '/api/gantt/baseline/snapshot', {
      project_id: testProjectId
    }, adminToken);
    assert.strictEqual(emptySnapRes.status, 201);
    assert.strictEqual(emptySnapRes.body.count, 0);
    pass('Admin snapshot on project with 0 items returns clean count 0.');

    // 2c: Create items for project
    // Task 1: 2026-11-01 to 2026-11-05 (5 days)
    const t1Res = await request('POST', '/api/gantt/item/create', {
      project_id: testProjectId,
      title: 'Backend Architecture',
      type: 'TASK',
      start_date: '2026-11-01',
      end_date: '2026-11-05',
      position: 1
    }, adminToken);
    assert.strictEqual(t1Res.status, 201);
    const task1 = t1Res.body.item;

    // Task 2: 2026-11-06 to 2026-11-10 (5 days)
    const t2Res = await request('POST', '/api/gantt/item/create', {
      project_id: testProjectId,
      title: 'Database Schema & Triggers',
      type: 'TASK',
      start_date: '2026-11-06',
      end_date: '2026-11-10',
      position: 2
    }, adminToken);
    assert.strictEqual(t2Res.status, 201);
    const task2 = t2Res.body.item;

    // Task 3: 2026-11-11 to 2026-11-15 (5 days)
    const t3Res = await request('POST', '/api/gantt/item/create', {
      project_id: testProjectId,
      title: 'API Integration & Verification',
      type: 'TASK',
      start_date: '2026-11-11',
      end_date: '2026-11-15',
      position: 3
    }, adminToken);
    assert.strictEqual(t3Res.status, 201);
    const task3 = t3Res.body.item;

    // Task 4: 2026-11-01 to 2026-11-03 (3 days, independent parallel branch)
    const t4Res = await request('POST', '/api/gantt/item/create', {
      project_id: testProjectId,
      title: 'Documentation & Style Guide',
      type: 'TASK',
      start_date: '2026-11-01',
      end_date: '2026-11-03',
      position: 4
    }, adminToken);
    assert.strictEqual(t4Res.status, 201);
    const task4 = t4Res.body.item;

    pass('Created 4 timeline tasks for project (Task 1, 2, 3, 4).');

    // 2d: Admin takes baseline snapshot
    const snapRes = await request('POST', '/api/gantt/baseline/snapshot', {
      project_id: testProjectId
    }, adminToken);
    assert.strictEqual(snapRes.status, 201);
    assert.strictEqual(snapRes.body.count, 4);
    assert.ok(snapRes.body.snapshot_taken_at);
    assert.strictEqual(snapRes.body.baselines.length, 4);
    pass('Admin successfully created baseline snapshot with 4 items (HTTP 201).');

    // 2e: Verify SQLite append-only triggers on gantt_baselines
    console.log('\n--- PHASE 3: Append-Only DB Trigger Immutability Verification ---');

    let updateTriggerBlocked = false;
    try {
      execute(`
        UPDATE gantt_baselines
        SET baseline_start_date = '2026-12-01'
        WHERE project_id = ?
      `, [testProjectId]);
    } catch (err) {
      if (err.message.includes('gantt_baselines is append-only')) {
        updateTriggerBlocked = true;
      }
    }
    assert.ok(updateTriggerBlocked, 'UPDATE on gantt_baselines must be aborted by trigger');
    pass('Direct UPDATE on gantt_baselines strictly aborted by DB trigger.');

    let deleteTriggerBlocked = false;
    try {
      execute(`
        DELETE FROM gantt_baselines
        WHERE project_id = ?
      `, [testProjectId]);
    } catch (err) {
      if (err.message.includes('gantt_baselines is append-only')) {
        deleteTriggerBlocked = true;
      }
    }
    assert.ok(deleteTriggerBlocked, 'DELETE on gantt_baselines must be aborted by trigger');
    pass('Direct DELETE on gantt_baselines strictly aborted by DB trigger.');

    // -----------------------------------------------------------------
    // PHASE 4: Planned vs Actual Schedule Slip Analysis
    // -----------------------------------------------------------------
    console.log('\n--- PHASE 4: Planned vs Actual Schedule Slip Analysis ---');

    // 4a: Initial comparison - all tasks on track
    const baseListRes1 = await request('GET', `/api/gantt/baselines/${testProjectId}`, null, aliceToken);
    assert.strictEqual(baseListRes1.status, 200);
    assert.strictEqual(baseListRes1.body.total_baselines, 4);
    for (const b of baseListRes1.body.baselines) {
      assert.strictEqual(b.slip_days, 0, `Initial slip_days for item ${b.gantt_item_id} should be 0`);
      assert.strictEqual(b.is_on_track, true);
    }
    pass('GET /api/gantt/baselines confirms all items initially have slip_days = 0.');

    // 4b: Simulate schedule movement: Task 2 delayed by 3 days, Task 4 completed 1 day early
    await request('PATCH', `/api/gantt/item/${task2.id}`, {
      start_date: '2026-11-06',
      end_date: '2026-11-13' // +3 days delay
    }, adminToken);

    await request('PATCH', `/api/gantt/item/${task4.id}`, {
      start_date: '2026-11-01',
      end_date: '2026-11-02' // -1 day ahead
    }, adminToken);

    const baseListRes2 = await request('GET', `/api/gantt/baselines/${testProjectId}`, null, aliceToken);
    assert.strictEqual(baseListRes2.status, 200);

    const bTask2 = baseListRes2.body.baselines.find(b => b.gantt_item_id === task2.id);
    const bTask4 = baseListRes2.body.baselines.find(b => b.gantt_item_id === task4.id);
    const bTask1 = baseListRes2.body.baselines.find(b => b.gantt_item_id === task1.id);

    assert.strictEqual(bTask2.slip_days, 3, 'Task 2 should report +3 days slip');
    assert.strictEqual(bTask2.is_delayed, true);
    assert.strictEqual(bTask4.slip_days, -1, 'Task 4 should report -1 day slip');
    assert.strictEqual(bTask4.is_ahead, true);
    assert.strictEqual(bTask1.slip_days, 0, 'Task 1 should report 0 slip');
    assert.strictEqual(bTask1.is_on_track, true);
    pass('Schedule slip accurately calculated: Task 2 (+3d delay), Task 4 (-1d ahead), Task 1 (on track).');

    // 4c: Take a second baseline snapshot to test multi-version snapshot history
    const snapRes2 = await request('POST', '/api/gantt/baseline/snapshot', {
      project_id: testProjectId
    }, adminToken);
    assert.strictEqual(snapRes2.status, 201);

    const baseListRes3 = await request('GET', `/api/gantt/baselines/${testProjectId}`, null, aliceToken);
    assert.strictEqual(baseListRes3.body.total_baselines, 8); // 4 + 4
    assert.strictEqual(baseListRes3.body.snapshots.length, 2);
    pass('Multi-snapshot baseline history maintained (2 distinct snapshots, 8 total baseline records).');

    // -----------------------------------------------------------------
    // PHASE 5: Critical Path Method (CPM) - Topological Sort & Slack
    // -----------------------------------------------------------------
    console.log('\n--- PHASE 5: Server-Side Critical Path Method (CPM) Computation ---');

    // Restore Task 2 and Task 4 to original dates for canonical CPM test
    await request('PATCH', `/api/gantt/item/${task2.id}`, {
      start_date: '2026-11-06',
      end_date: '2026-11-10'
    }, adminToken);
    await request('PATCH', `/api/gantt/item/${task4.id}`, {
      start_date: '2026-11-01',
      end_date: '2026-11-03'
    }, adminToken);

    // Add dependencies:
    // Task 1 -> Task 2 (FINISH_TO_START, lag 0)
    // Task 2 -> Task 3 (FINISH_TO_START, lag 0)
    // Task 4 has no dependencies (independent parallel branch)
    const d1Res = await request('POST', '/api/gantt/dependency/add', {
      project_id: testProjectId,
      predecessor_item_id: task1.id,
      successor_item_id: task2.id,
      dependency_type: 'FINISH_TO_START',
      lag_days: 0
    }, adminToken);
    assert.strictEqual(d1Res.status, 201);

    const d2Res = await request('POST', '/api/gantt/dependency/add', {
      project_id: testProjectId,
      predecessor_item_id: task2.id,
      successor_item_id: task3.id,
      dependency_type: 'FINISH_TO_START',
      lag_days: 0
    }, adminToken);
    assert.strictEqual(d2Res.status, 201);
    pass('Added linear critical chain dependencies: Task 1 -> Task 2 -> Task 3.');

    // Execute CPM calculation
    const cpmRes = await request('GET', `/api/gantt/criticalpath/${testProjectId}`, null, aliceToken);
    assert.strictEqual(cpmRes.status, 200);

    const cpm = cpmRes.body;
    console.log('\n  CPM Summary:');
    console.log(`    Project Duration: ${cpm.project_duration_days} days`);
    console.log(`    Critical Path IDs: [${cpm.critical_path_item_ids.join(', ')}]`);

    // Verify Project Duration: Task 1 (5d) + Task 2 (5d) + Task 3 (5d) = 15 days
    assert.strictEqual(cpm.project_duration_days, 15);
    pass('Project makespan duration correctly computed as 15 days.');

    const cpmItems = cpm.items;
    const cpm1 = cpmItems.find(i => i.id === task1.id);
    const cpm2 = cpmItems.find(i => i.id === task2.id);
    const cpm3 = cpmItems.find(i => i.id === task3.id);
    const cpm4 = cpmItems.find(i => i.id === task4.id);

    console.log('\n  CPM Item Breakdown:');
    for (const item of [cpm1, cpm2, cpm3, cpm4]) {
      console.log(`    [${item.title}] Dur=${item.duration_days}d | ES=${item.earliest_start} EF=${item.earliest_finish} | LS=${item.latest_start} LF=${item.latest_finish} | Slack=${item.slack}d | Critical=${item.is_critical}`);
    }

    // Verify Task 1: ES=0, EF=5, LS=0, LF=5, slack=0, critical=true
    assert.strictEqual(cpm1.earliest_start, 0);
    assert.strictEqual(cpm1.earliest_finish, 5);
    assert.strictEqual(cpm1.latest_start, 0);
    assert.strictEqual(cpm1.latest_finish, 5);
    assert.strictEqual(cpm1.slack, 0);
    assert.strictEqual(cpm1.is_critical, true);
    pass('Task 1 verified: ES=0, EF=5, LS=0, LF=5, Slack=0, Critical=true.');

    // Verify Task 2: ES=5, EF=10, LS=5, LF=10, slack=0, critical=true
    assert.strictEqual(cpm2.earliest_start, 5);
    assert.strictEqual(cpm2.earliest_finish, 10);
    assert.strictEqual(cpm2.latest_start, 5);
    assert.strictEqual(cpm2.latest_finish, 10);
    assert.strictEqual(cpm2.slack, 0);
    assert.strictEqual(cpm2.is_critical, true);
    pass('Task 2 verified: ES=5, EF=10, LS=5, LF=10, Slack=0, Critical=true.');

    // Verify Task 3: ES=10, EF=15, LS=10, LF=15, slack=0, critical=true
    assert.strictEqual(cpm3.earliest_start, 10);
    assert.strictEqual(cpm3.earliest_finish, 15);
    assert.strictEqual(cpm3.latest_start, 10);
    assert.strictEqual(cpm3.latest_finish, 15);
    assert.strictEqual(cpm3.slack, 0);
    assert.strictEqual(cpm3.is_critical, true);
    pass('Task 3 verified: ES=10, EF=15, LS=10, LF=15, Slack=0, Critical=true.');

    // Verify Task 4: Duration=3d, ES=0, EF=3, LS=12, LF=15, slack=12, critical=false
    assert.strictEqual(cpm4.earliest_start, 0);
    assert.strictEqual(cpm4.earliest_finish, 3);
    assert.strictEqual(cpm4.latest_start, 12);
    assert.strictEqual(cpm4.latest_finish, 15);
    assert.strictEqual(cpm4.slack, 12);
    assert.strictEqual(cpm4.is_critical, false);
    pass('Task 4 verified: ES=0, EF=3, LS=12, LF=15, Slack=12, Critical=false.');

    // Verify Critical Path Item IDs list
    assert.deepStrictEqual(cpm.critical_path_item_ids, [task1.id, task2.id, task3.id]);
    pass('Critical path item IDs array strictly matches [Task 1, Task 2, Task 3].');

    // Verify Calendar dates generated
    assert.strictEqual(cpm1.calendar_earliest_start, '2026-11-01');
    assert.strictEqual(cpm1.calendar_earliest_finish, '2026-11-05');
    assert.strictEqual(cpm4.calendar_latest_start, '2026-11-13');
    assert.strictEqual(cpm4.calendar_latest_finish, '2026-11-15');
    pass('Calendar earliest and latest date projections match CPM timeline calculations.');

    // -----------------------------------------------------------------
    // PHASE 6: Advanced CPM - Milestone & Dependency Lag
    // -----------------------------------------------------------------
    console.log('\n--- PHASE 6: Advanced CPM (Milestones & Lag Handling) ---');

    // Create a MILESTONE linked after Task 3
    const mRes = await request('POST', '/api/gantt/item/create', {
      project_id: testProjectId,
      title: 'V1.0 Production Launch',
      type: 'MILESTONE',
      start_date: '2026-11-15',
      end_date: '2026-11-15',
      position: 5
    }, adminToken);
    assert.strictEqual(mRes.status, 201);
    const milestoneItem = mRes.body.item;

    // Milestone depends on Task 3 with 1 day lag
    const mDepRes = await request('POST', '/api/gantt/dependency/add', {
      project_id: testProjectId,
      predecessor_item_id: task3.id,
      successor_item_id: milestoneItem.id,
      dependency_type: 'FINISH_TO_START',
      lag_days: 1
    }, adminToken);
    assert.strictEqual(mDepRes.status, 201);
    pass('Added Milestone V1.0 Launch with 1-day lag following Task 3.');

    const cpmLagRes = await request('GET', `/api/gantt/criticalpath/${testProjectId}`, null, aliceToken);
    assert.strictEqual(cpmLagRes.status, 200);

    // Duration should now be: 15 (Task 3 finish) + 1 (lag) = 16 days
    assert.strictEqual(cpmLagRes.body.project_duration_days, 16);
    const cpmM = cpmLagRes.body.items.find(i => i.id === milestoneItem.id);
    assert.strictEqual(cpmM.duration_days, 0, 'Milestone duration must be 0');
    assert.strictEqual(cpmM.earliest_start, 16);
    assert.strictEqual(cpmM.earliest_finish, 16);
    assert.strictEqual(cpmM.slack, 0);
    assert.strictEqual(cpmM.is_critical, true);
    assert.ok(cpmLagRes.body.critical_path_item_ids.includes(milestoneItem.id));
    pass('Milestone with 1-day lag correctly extends project duration to 16d and is flagged critical.');

    // -----------------------------------------------------------------
    // PHASE 7: Gantt Export Bundle Endpoint
    // -----------------------------------------------------------------
    console.log('\n--- PHASE 7: Full Gantt Export Bundle Endpoint ---');

    const exportRes = await request('GET', `/api/gantt/export/${testProjectId}`, null, aliceToken);
    assert.strictEqual(exportRes.status, 200);

    const bundle = exportRes.body;
    assert.strictEqual(bundle.export_format, 'JSON');
    assert.strictEqual(bundle.version, '1.0');
    assert.ok(bundle.exported_at);
    assert.strictEqual(bundle.exported_by.id, aliceUser.id);
    assert.strictEqual(bundle.project.id, testProjectId);
    assert.ok(Array.isArray(bundle.items));
    assert.strictEqual(bundle.items.length, 5);
    assert.ok(Array.isArray(bundle.dependencies));
    assert.strictEqual(bundle.dependencies.length, 3);
    assert.ok(Array.isArray(bundle.baselines));
    assert.ok(Array.isArray(bundle.baseline_snapshots));
    assert.ok(bundle.critical_path);
    assert.strictEqual(bundle.critical_path.project_duration_days, 16);
    assert.strictEqual(bundle.critical_path.critical_path_items.length, 4);
    pass('Full Gantt Export bundle returned with project, items, dependencies, baselines, and CPM.');

    console.log('\n========================================================================');
    console.log(`  PRD 20 LAYER 3 ALL TESTS PASSED: ${passedAssertions}/${passedAssertions} ASSERTIONS!`);
    console.log('========================================================================\n');

  } finally {
    if (server) {
      server.close();
    }
  }
}

runLayer3Tests().catch((err) => {
  console.error('\n[FAIL] PRD 20 Layer 3 Test Suite Failed:');
  console.error(err);
  if (server) server.close();
  process.exit(1);
});
