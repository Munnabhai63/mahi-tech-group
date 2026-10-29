import assert from 'node:assert';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app.js';
import { execute, queryOne, queryAll } from '../src/db/database.js';
import { config } from '../src/config.js';

console.log('========================================================================');
console.log('  PRD 20 — LAYER 4: MILESTONE, BASELINE & CRITICAL PATH (CPM) API SUITE');
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
  const sessionId = `test-session-gantt4-${Date.now()}-${Math.random().toString(36).substring(7)}`;
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

async function runLayer4Tests() {
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
      id: `admin-gantt4-${ts}`,
      name: 'Admin Boss',
      email: `admin.gantt4.${ts}@mahitechgroup.com`,
      role: 'admin'
    };
    const aliceUser = {
      id: `alice-gantt4-${ts}`,
      name: 'Dev Alice',
      email: `alice.gantt4.${ts}@mahitechgroup.com`,
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
    pass('Created test users (Admin and Member Alice) with active JWT sessions.');

    const testIdeaId = `idea-gantt4-${ts}`;
    const testProjectId = `proj-gantt4-${ts}`;

    execute(`
      INSERT INTO ideas (id, owner_id, title, description, status)
      VALUES (?, ?, 'PRD 20 Layer 4 Idea', 'Milestones, Baselines & Critical Path Engine', 'APPROVED')
    `, [testIdeaId, adminUser.id]);

    execute(`
      INSERT INTO projects (id, idea_id, owner_id, title, status)
      VALUES (?, ?, ?, 'PRD 20 Layer 4 Timeline Project', 'ACTIVE')
    `, [testProjectId, testIdeaId, adminUser.id]);
    pass(`Seeded test project ID: ${testProjectId}.`);

    // -----------------------------------------------------------------
    // PHASE 2: Milestone Full CRUD & Lifecycle Management
    // -----------------------------------------------------------------
    console.log('\n--- PHASE 2: Milestone Full CRUD & Lifecycle Management ---');

    // 2a: Member blocked from creating milestone
    const memCreateMileRes = await request('POST', '/api/gantt/milestone/create', {
      project_id: testProjectId,
      title: 'Member Milestone Attempt',
      milestone_date: '2026-11-20'
    }, aliceToken);
    assert.strictEqual(memCreateMileRes.status, 403);
    pass('Member Alice blocked from POST /api/gantt/milestone/create (HTTP 403).');

    // Create an item to link milestone to
    const item1Res = await request('POST', '/api/gantt/item/create', {
      project_id: testProjectId,
      title: 'Core Engine Build',
      type: 'TASK',
      start_date: '2026-11-01',
      end_date: '2026-11-10',
      position: 1
    }, adminToken);
    assert.strictEqual(item1Res.status, 201);
    const coreItem = item1Res.body.item;

    // 2b: Admin creates Milestone 1 (linked to core item)
    const createMile1Res = await request('POST', '/api/gantt/milestone/create', {
      project_id: testProjectId,
      title: 'Engine Alpha Complete',
      milestone_date: '2026-11-10',
      gantt_item_id: coreItem.id
    }, adminToken);
    assert.strictEqual(createMile1Res.status, 201);
    const milestone1 = createMile1Res.body.milestone;
    assert.strictEqual(milestone1.status, 'PENDING');
    assert.strictEqual(milestone1.gantt_item_id, coreItem.id);
    pass('Admin created Milestone 1 linked to timeline item (status: PENDING).');

    // 2c: Admin creates Milestone 2 with past date to test auto-MISSED detection
    const createMile2Res = await request('POST', '/api/gantt/milestone/create', {
      project_id: testProjectId,
      title: 'Architecture Review Signoff',
      milestone_date: '2025-01-01' // Past date
    }, adminToken);
    assert.strictEqual(createMile2Res.status, 201);
    const milestone2 = createMile2Res.body.milestone;
    pass('Admin created Milestone 2 with historical date for status progression test.');

    // 2d: GET /api/gantt/milestones/:projectId
    const getMilesRes = await request('GET', `/api/gantt/milestones/${testProjectId}`, null, aliceToken);
    assert.strictEqual(getMilesRes.status, 200);
    assert.strictEqual(getMilesRes.body.milestones.length, 2);

    const m1Check = getMilesRes.body.milestones.find(m => m.id === milestone1.id);
    const m2Check = getMilesRes.body.milestones.find(m => m.id === milestone2.id);
    assert.strictEqual(m1Check.status, 'PENDING');
    assert.strictEqual(m2Check.status, 'MISSED');
    pass('GET /api/gantt/milestones auto-transitions overdue pending milestone to MISSED.');

    // 2e: Admin updates Milestone 1 (title & date)
    const updateMileRes = await request('PATCH', `/api/gantt/milestone/${milestone1.id}`, {
      title: 'Engine Alpha Complete (Updated)',
      milestone_date: '2026-11-12'
    }, adminToken);
    assert.strictEqual(updateMileRes.status, 200);
    assert.strictEqual(updateMileRes.body.milestone.title, 'Engine Alpha Complete (Updated)');
    assert.strictEqual(updateMileRes.body.milestone.milestone_date, '2026-11-12');
    pass('PATCH /api/gantt/milestone/:id successfully updated title and date (HTTP 200).');

    // 2f: Member blocked from updating milestone
    const memUpdateMileRes = await request('PATCH', `/api/gantt/milestone/${milestone1.id}`, {
      title: 'Hacked Title'
    }, aliceToken);
    assert.strictEqual(memUpdateMileRes.status, 403);
    pass('Member Alice blocked from PATCH /api/gantt/milestone/:id (HTTP 403).');

    // 2g: Admin marks Milestone 1 as ACHIEVED
    const achieveMileRes = await request('PATCH', `/api/gantt/milestone/${milestone1.id}/achieve`, null, adminToken);
    assert.strictEqual(achieveMileRes.status, 200);
    assert.strictEqual(achieveMileRes.body.milestone.status, 'ACHIEVED');
    assert.ok(achieveMileRes.body.milestone.achieved_at);

    // Verify linked item was auto-completed
    const dbCoreItem = queryOne('SELECT progress_pct, status FROM gantt_items WHERE id = ?', [coreItem.id]);
    assert.strictEqual(dbCoreItem.progress_pct, 100);
    assert.strictEqual(dbCoreItem.status, 'COMPLETED');
    pass('Marking milestone ACHIEVED auto-transitions linked item to 100% progress and COMPLETED.');

    // 2h: Admin deletes Milestone 2
    const deleteMileRes = await request('DELETE', `/api/gantt/milestone/${milestone2.id}`, null, adminToken);
    assert.strictEqual(deleteMileRes.status, 200);
    const dbDeletedMile = queryOne('SELECT id FROM gantt_milestones WHERE id = ?', [milestone2.id]);
    assert.strictEqual(dbDeletedMile, null);
    pass('DELETE /api/gantt/milestone/:id deleted milestone cleanly.');

    // 2i: Member blocked from deleting milestone
    const memDelMileRes = await request('DELETE', `/api/gantt/milestone/${milestone1.id}`, null, aliceToken);
    assert.strictEqual(memDelMileRes.status, 403);
    pass('Member Alice blocked from DELETE /api/gantt/milestone/:id (HTTP 403).');

    // -----------------------------------------------------------------
    // PHASE 3: Baseline Snapshotting & Planned vs Actual Comparison
    // -----------------------------------------------------------------
    console.log('\n--- PHASE 3: Baseline Snapshotting & Schedule Slip Analysis ---');

    // Create additional items for multi-task baseline & CPM network
    const item2Res = await request('POST', '/api/gantt/item/create', {
      project_id: testProjectId,
      title: 'Database Pipeline',
      type: 'TASK',
      start_date: '2026-11-13',
      end_date: '2026-11-17',
      position: 2
    }, adminToken);
    assert.strictEqual(item2Res.status, 201);
    const dbItem = item2Res.body.item;

    const item3Res = await request('POST', '/api/gantt/item/create', {
      project_id: testProjectId,
      title: 'Security Hardening',
      type: 'TASK',
      start_date: '2026-11-18',
      end_date: '2026-11-22',
      position: 3
    }, adminToken);
    assert.strictEqual(item3Res.status, 201);
    const secItem = item3Res.body.item;

    const item4Res = await request('POST', '/api/gantt/item/create', {
      project_id: testProjectId,
      title: 'UX Design Wireframes',
      type: 'TASK',
      start_date: '2026-11-01',
      end_date: '2026-11-05',
      position: 4
    }, adminToken);
    assert.strictEqual(item4Res.status, 201);
    const uxItem = item4Res.body.item;

    // 3a: Member blocked from taking baseline snapshot
    const memSnapRes = await request('POST', '/api/gantt/baseline/snapshot', {
      project_id: testProjectId
    }, aliceToken);
    assert.strictEqual(memSnapRes.status, 403);
    pass('Member Alice blocked from POST /api/gantt/baseline/snapshot (HTTP 403).');

    // 3b: Admin takes baseline snapshot
    const snapRes = await request('POST', '/api/gantt/baseline/snapshot', {
      project_id: testProjectId
    }, adminToken);
    assert.strictEqual(snapRes.status, 201);
    assert.strictEqual(snapRes.body.count, 4);
    pass('Admin took baseline snapshot of all 4 project timeline items (HTTP 201).');

    // 3c: Append-only triggers verify immutability of gantt_baselines
    let updateBlocked = false;
    try {
      execute('UPDATE gantt_baselines SET baseline_start_date = ? WHERE project_id = ?', ['2026-12-01', testProjectId]);
    } catch (e) {
      if (e.message.includes('gantt_baselines is append-only')) updateBlocked = true;
    }
    assert.ok(updateBlocked, 'Trigger prevent_gantt_baseline_update must block UPDATE');
    pass('Trigger prevent_gantt_baseline_update strictly aborted UPDATE.');

    let deleteBlocked = false;
    try {
      execute('DELETE FROM gantt_baselines WHERE project_id = ?', [testProjectId]);
    } catch (e) {
      if (e.message.includes('gantt_baselines is append-only')) deleteBlocked = true;
    }
    assert.ok(deleteBlocked, 'Trigger prevent_gantt_baseline_delete must block DELETE');
    pass('Trigger prevent_gantt_baseline_delete strictly aborted DELETE.');

    // 3d: Schedule slip test
    // Delay Database Pipeline by +3 days
    await request('PATCH', `/api/gantt/item/${dbItem.id}`, {
      start_date: '2026-11-13',
      end_date: '2026-11-20' // +3 days from 11-17
    }, adminToken);

    // Complete UX Design Wireframes 2 days early
    await request('PATCH', `/api/gantt/item/${uxItem.id}`, {
      start_date: '2026-11-01',
      end_date: '2026-11-03' // -2 days from 11-05
    }, adminToken);

    const baseRes = await request('GET', `/api/gantt/baselines/${testProjectId}`, null, aliceToken);
    assert.strictEqual(baseRes.status, 200);

    const bDb = baseRes.body.baselines.find(b => b.gantt_item_id === dbItem.id);
    const bUx = baseRes.body.baselines.find(b => b.gantt_item_id === uxItem.id);
    const bCore = baseRes.body.baselines.find(b => b.gantt_item_id === coreItem.id);

    assert.strictEqual(bDb.slip_days, 3);
    assert.strictEqual(bDb.is_delayed, true);
    assert.strictEqual(bUx.slip_days, -2);
    assert.strictEqual(bUx.is_ahead, true);
    assert.strictEqual(bCore.slip_days, 0);
    assert.strictEqual(bCore.is_on_track, true);
    pass('GET /api/gantt/baselines accurately calculated slip_days: delayed (+3d), ahead (-2d), on track (0d).');

    // -----------------------------------------------------------------
    // PHASE 4: Critical Path Method (CPM) - Topological Sort & Slack
    // -----------------------------------------------------------------
    console.log('\n--- PHASE 4: Critical Path Method (CPM) Server-Side Calculation ---');

    // Reset items to standard timeline for canonical CPM validation:
    // Core Engine Build: 2026-11-01 to 2026-11-10 (10 days)
    await request('PATCH', `/api/gantt/item/${coreItem.id}`, {
      start_date: '2026-11-01',
      end_date: '2026-11-10'
    }, adminToken);

    // Database Pipeline: 2026-11-11 to 2026-11-15 (5 days)
    await request('PATCH', `/api/gantt/item/${dbItem.id}`, {
      start_date: '2026-11-11',
      end_date: '2026-11-15'
    }, adminToken);

    // Security Hardening: 2026-11-16 to 2026-11-20 (5 days)
    await request('PATCH', `/api/gantt/item/${secItem.id}`, {
      start_date: '2026-11-16',
      end_date: '2026-11-20'
    }, adminToken);

    // UX Design Wireframes: 2026-11-01 to 2026-11-05 (5 days, parallel non-critical branch)
    await request('PATCH', `/api/gantt/item/${uxItem.id}`, {
      start_date: '2026-11-01',
      end_date: '2026-11-05'
    }, adminToken);

    // Add milestone item at project completion
    const launchItemRes = await request('POST', '/api/gantt/item/create', {
      project_id: testProjectId,
      title: 'Production Launch Gate',
      type: 'MILESTONE',
      start_date: '2026-11-20',
      end_date: '2026-11-20',
      position: 5
    }, adminToken);
    assert.strictEqual(launchItemRes.status, 201);
    const launchItem = launchItemRes.body.item;

    // Add dependencies:
    // Core Engine -> Database Pipeline (FINISH_TO_START, lag 0)
    await request('POST', '/api/gantt/dependency/add', {
      project_id: testProjectId,
      predecessor_item_id: coreItem.id,
      successor_item_id: dbItem.id,
      dependency_type: 'FINISH_TO_START',
      lag_days: 0
    }, adminToken);

    // Database Pipeline -> Security Hardening (FINISH_TO_START, lag 0)
    await request('POST', '/api/gantt/dependency/add', {
      project_id: testProjectId,
      predecessor_item_id: dbItem.id,
      successor_item_id: secItem.id,
      dependency_type: 'FINISH_TO_START',
      lag_days: 0
    }, adminToken);

    // Security Hardening -> Production Launch Gate (FINISH_TO_START, lag 0)
    await request('POST', '/api/gantt/dependency/add', {
      project_id: testProjectId,
      predecessor_item_id: secItem.id,
      successor_item_id: launchItem.id,
      dependency_type: 'FINISH_TO_START',
      lag_days: 0
    }, adminToken);

    // UX Design is independent (starts day 0, duration 5 days, finishes day 5)
    pass('Assembled CPM network: Critical Chain (10d + 5d + 5d + 0d = 20d) vs Non-Critical UX Branch (5d).');

    // Execute CPM calculation
    const cpmRes = await request('GET', `/api/gantt/criticalpath/${testProjectId}`, null, aliceToken);
    assert.strictEqual(cpmRes.status, 200);

    const cpm = cpmRes.body;
    assert.strictEqual(cpm.project_duration_days, 20);
    pass('Project makespan duration correctly computed as 20 days.');

    const cpmCore = cpm.items.find(i => i.id === coreItem.id);
    const cpmDb = cpm.items.find(i => i.id === dbItem.id);
    const cpmSec = cpm.items.find(i => i.id === secItem.id);
    const cpmLaunch = cpm.items.find(i => i.id === launchItem.id);
    const cpmUx = cpm.items.find(i => i.id === uxItem.id);

    console.log('\n  CPM Network Detailed Metrics:');
    for (const it of [cpmCore, cpmDb, cpmSec, cpmLaunch, cpmUx]) {
      console.log(`    [${it.title}] Dur=${it.duration_days}d | ES=${it.earliest_start} EF=${it.earliest_finish} | LS=${it.latest_start} LF=${it.latest_finish} | Slack=${it.slack}d | Critical=${it.is_critical}`);
    }

    // Critical Path Verification:
    assert.strictEqual(cpmCore.slack, 0);
    assert.strictEqual(cpmCore.is_critical, true);
    assert.strictEqual(cpmDb.slack, 0);
    assert.strictEqual(cpmDb.is_critical, true);
    assert.strictEqual(cpmSec.slack, 0);
    assert.strictEqual(cpmSec.is_critical, true);
    assert.strictEqual(cpmLaunch.slack, 0);
    assert.strictEqual(cpmLaunch.is_critical, true);

    // Non-critical verification:
    // UX branch dur = 5d, finishes at 5. Project finishes at 20. Slack = 20 - 5 = 15 days.
    assert.strictEqual(cpmUx.slack, 15);
    assert.strictEqual(cpmUx.is_critical, false);

    assert.deepStrictEqual(cpm.critical_path_item_ids, [coreItem.id, dbItem.id, secItem.id, launchItem.id]);
    pass('Critical path item IDs correctly identified: Core -> DB -> Sec -> Launch (slack === 0).');
    pass('Non-critical UX branch correctly identified with 15 days of total float (slack === 15).');

    // -----------------------------------------------------------------
    // PHASE 5: Full Gantt Export Bundle Endpoint
    // -----------------------------------------------------------------
    console.log('\n--- PHASE 5: Full Gantt Export Bundle Endpoint ---');

    const expRes = await request('GET', `/api/gantt/export/${testProjectId}`, null, aliceToken);
    assert.strictEqual(expRes.status, 200);

    const bundle = expRes.body;
    assert.strictEqual(bundle.export_format, 'JSON');
    assert.strictEqual(bundle.version, '1.0');
    assert.strictEqual(bundle.project.id, testProjectId);
    assert.strictEqual(bundle.items.length, 5);
    assert.strictEqual(bundle.dependencies.length, 3);
    assert.strictEqual(bundle.milestones.length, 1);
    assert.ok(bundle.baselines.length >= 4);
    assert.strictEqual(bundle.critical_path.project_duration_days, 20);
    assert.strictEqual(bundle.critical_path.critical_path_item_ids.length, 4);
    pass('Export bundle returned complete project snapshot, items, dependencies, milestones, baselines & CPM.');

    console.log('\n========================================================================');
    console.log(`  PRD 20 LAYER 4 ALL TESTS PASSED: ${passedAssertions}/${passedAssertions} ASSERTIONS!`);
    console.log('========================================================================\n');

  } finally {
    if (server) {
      server.close();
    }
  }
}

runLayer4Tests().catch((err) => {
  console.error('\n[FAIL] PRD 20 Layer 4 Test Suite Failed:');
  console.error(err);
  if (server) server.close();
  process.exit(1);
});
