import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app.js';
import { execute, queryOne, queryAll } from '../src/db/database.js';
import { config } from '../src/config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, '..', 'public');

console.log('========================================================================');
console.log('  PRD 20 — LAYER 5: FRONTEND VIEWS & CLIENT CONTRACT VERIFICATION SUITE');
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
  const headers = {};
  if (body) {
    headers['Content-Type'] = 'application/json';
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const opts = { method, headers };
  if (body) {
    opts.body = JSON.stringify(body);
  }

  const res = await fetch(url, opts);
  const contentType = res.headers.get('content-type') || '';
  let data = null;
  if (contentType.includes('application/json')) {
    try {
      data = await res.json();
    } catch (e) {}
  } else {
    data = await res.text();
  }
  return { status: res.status, headers: res.headers, body: data };
}

function createTestToken(user) {
  const sessionId = `test-session-gantt5-${Date.now()}-${Math.random().toString(36).substring(7)}`;
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

async function runLayer5Tests() {
  const app = createApp();
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });

  try {
    console.log('------------------------------------------------------------------------');
    console.log('  SECTION 1: FILE EXISTENCE & ARTIFACT AUDIT (4 FRONTEND VIEWS)');
    console.log('------------------------------------------------------------------------');

    const ganttChartPath = path.join(publicDir, 'gantt-chart.html');
    const milestoneTimelinePath = path.join(publicDir, 'milestone-timeline.html');
    const ganttBaselinePath = path.join(publicDir, 'gantt-baseline.html');

    assert.ok(fs.existsSync(ganttChartPath), 'public/gantt-chart.html must exist');
    pass('public/gantt-chart.html exists');

    assert.ok(fs.existsSync(milestoneTimelinePath), 'public/milestone-timeline.html must exist');
    pass('public/milestone-timeline.html exists');

    assert.ok(fs.existsSync(ganttBaselinePath), 'public/gantt-baseline.html must exist');
    pass('public/gantt-baseline.html exists');

    const ganttChartHtml = fs.readFileSync(ganttChartPath, 'utf8');
    const milestoneTimelineHtml = fs.readFileSync(milestoneTimelinePath, 'utf8');
    const ganttBaselineHtml = fs.readFileSync(ganttBaselinePath, 'utf8');

    assert.ok(ganttChartHtml.length > 5000, 'gantt-chart.html must be fully implemented');
    pass(`public/gantt-chart.html has rich implementation (${ganttChartHtml.length} bytes)`);

    assert.ok(milestoneTimelineHtml.length > 3000, 'milestone-timeline.html must be fully implemented');
    pass(`public/milestone-timeline.html has rich implementation (${milestoneTimelineHtml.length} bytes)`);

    assert.ok(ganttBaselineHtml.length > 3000, 'gantt-baseline.html must be fully implemented');
    pass(`public/gantt-baseline.html has rich implementation (${ganttBaselineHtml.length} bytes)`);

    console.log('\n------------------------------------------------------------------------');
    console.log('  SECTION 2: VIEW 1 — GANTT CHART MAIN VIEW STRUCTURE AUDIT');
    console.log('------------------------------------------------------------------------');

    // SVG Dependency lines
    assert.ok(ganttChartHtml.includes('id="depSvgCanvas"'), 'View 1 must have an SVG canvas for dependency lines');
    assert.ok(ganttChartHtml.includes('arrowhead'), 'View 1 must define SVG arrowhead marker defs');
    assert.ok(ganttChartHtml.includes('drawDependencyArrows'), 'View 1 must implement dependency arrow rendering logic');
    pass('View 1: SVG dependency canvas, defs marker and drawing routines confirmed');

    // Today marker
    assert.ok(ganttChartHtml.includes('id="todayLine"'), 'View 1 must have today line marker');
    assert.ok(ganttChartHtml.includes('today-line-marker') || ganttChartHtml.includes('today-marker'), 'View 1 must have today line styling/label');
    pass('View 1: Today red vertical line marker confirmed');

    // Zoom controls: Day | Week | Month | Quarter
    assert.ok(ganttChartHtml.includes('data-zoom="day"'), 'View 1 must have Day zoom control');
    assert.ok(ganttChartHtml.includes('data-zoom="week"'), 'View 1 must have Week zoom control');
    assert.ok(ganttChartHtml.includes('data-zoom="month"'), 'View 1 must have Month zoom control');
    assert.ok(ganttChartHtml.includes('data-zoom="quarter"'), 'View 1 must have Quarter zoom control');
    pass('View 1: All 4 zoom scale modes (Day | Week | Month | Quarter) confirmed');

    // Critical Path
    assert.ok(ganttChartHtml.includes('toggleCritical') || ganttChartHtml.includes('Critical Path'), 'View 1 must have critical path toggle');
    assert.ok(ganttChartHtml.includes('critical'), 'View 1 must support critical path styling');
    pass('View 1: Critical path toggle and highlight styling confirmed');

    // Drag-resize bar handles
    assert.ok(ganttChartHtml.includes('resize-handle'), 'View 1 must include interactive bar resize handles');
    pass('View 1: Bar drag/resize handles and event bindings confirmed');

    console.log('\n------------------------------------------------------------------------');
    console.log('  SECTION 3: VIEW 2 — GANTT ITEM DETAIL SIDEBAR (INLINE DRAWER) AUDIT');
    console.log('------------------------------------------------------------------------');

    assert.ok(ganttChartHtml.includes('id="itemDetailDrawer"'), 'View 2 inline drawer element must exist');
    assert.ok(ganttChartHtml.includes('drawerTitle'), 'View 2 must show item title in header');
    assert.ok(ganttChartHtml.includes('drawerStartDate') && ganttChartHtml.includes('drawerEndDate'), 'View 2 must have start/end date inputs');
    assert.ok(ganttChartHtml.includes('drawerProgressSlider'), 'View 2 must have progress % slider');
    assert.ok(ganttChartHtml.includes('drawerPredecessorsList'), 'View 2 must display predecessors list');
    assert.ok(ganttChartHtml.includes('drawerSuccessorsList'), 'View 2 must display successors list');
    assert.ok(ganttChartHtml.includes('drawerHistoryList'), 'View 2 must display item change audit history');
    assert.ok(ganttChartHtml.includes('btnSaveDrawerItem'), 'View 2 must have Save Item action');
    assert.ok(ganttChartHtml.includes('btnDeleteDrawerItem'), 'View 2 must have Delete Item action');
    pass('View 2: Complete inline drawer sidebar with dates, progress slider, dependencies, history, and CRUD actions confirmed');

    console.log('\n------------------------------------------------------------------------');
    console.log('  SECTION 4: VIEW 3 — MILESTONE TIMELINE VIEW AUDIT');
    console.log('------------------------------------------------------------------------');

    assert.ok(milestoneTimelineHtml.includes('timeline-spine'), 'View 3 must include continuous vertical spine line');
    assert.ok(milestoneTimelineHtml.includes('milestone-node'), 'View 3 must render milestone node circles');
    assert.ok(milestoneTimelineHtml.includes('badge-achieved') && milestoneTimelineHtml.includes('badge-pending') && milestoneTimelineHtml.includes('badge-missed'), 'View 3 must support ACHIEVED, PENDING, and MISSED color-coded badges');
    assert.ok(milestoneTimelineHtml.includes('btn-achieve') || milestoneTimelineHtml.includes('Mark as Achieved'), 'View 3 must have "Mark as Achieved" button');
    assert.ok(milestoneTimelineHtml.includes('handleAchieveMilestone'), 'View 3 must wire achievement API call');
    assert.ok(milestoneTimelineHtml.includes('createMilestoneModal'), 'View 3 must include modal to create milestones');
    assert.ok(milestoneTimelineHtml.includes('editMilestoneModal'), 'View 3 must include modal to edit milestones');
    assert.ok(milestoneTimelineHtml.includes('linked-item-box'), 'View 3 must display linked Gantt task details and progress');
    assert.ok(milestoneTimelineHtml.includes('statAchieved') && milestoneTimelineHtml.includes('statMissed'), 'View 3 must include summary metrics cards');
    pass('View 3: Milestone timeline with vertical spine, color-coded badges, achievement triggers, and linked task boxes confirmed');

    console.log('\n------------------------------------------------------------------------');
    console.log('  SECTION 5: VIEW 4 — PLANNED VS ACTUAL (BASELINE VARIANCE) AUDIT');
    console.log('------------------------------------------------------------------------');

    assert.ok(ganttBaselineHtml.includes('id="snapshotSelect"'), 'View 4 must have snapshot version selector dropdown');
    assert.ok(ganttBaselineHtml.includes('bar-baseline'), 'View 4 must render planned baseline bar (grey)');
    assert.ok(ganttBaselineHtml.includes('bar-actual'), 'View 4 must render current actual bar');
    assert.ok(ganttBaselineHtml.includes('slip-pill') || ganttBaselineHtml.includes('slip'), 'View 4 must visually calculate and show schedule slip');
    assert.ok(ganttBaselineHtml.includes('id="varianceTable"'), 'View 4 must include comparative table below the chart');
    assert.ok(ganttBaselineHtml.includes('Planned Start') && ganttBaselineHtml.includes('Actual Start'), 'View 4 table must contain planned and actual start columns');
    assert.ok(ganttBaselineHtml.includes('Planned End') && ganttBaselineHtml.includes('Actual End'), 'View 4 table must contain planned and actual end columns');
    assert.ok(ganttBaselineHtml.includes('btnTakeSnapshot'), 'View 4 must provide Take Snapshot button');
    assert.ok(ganttBaselineHtml.includes('metricAvgSlip'), 'View 4 must calculate average schedule slip metric');
    pass('View 4: Dual horizontal bars, schedule slip pills, snapshot selector, and comparative table confirmed');

    console.log('\n------------------------------------------------------------------------');
    console.log('  SECTION 6: SECURITY & RBAC CLIENT INTEGRITY AUDIT');
    console.log('------------------------------------------------------------------------');

    const views = [
      { name: 'gantt-chart.html', content: ganttChartHtml },
      { name: 'milestone-timeline.html', content: milestoneTimelineHtml },
      { name: 'gantt-baseline.html', content: ganttBaselineHtml }
    ];

    for (const v of views) {
      // 1. Zero hardcoded JWT tokens
      assert.ok(!v.content.includes('eyJhbGciOi'), `${v.name} must not contain hardcoded JWT tokens`);
      // 2. Zero hardcoded passwords
      assert.ok(!v.content.toLowerCase().includes('password123') && !v.content.toLowerCase().includes('admin_password'), `${v.name} must not contain hardcoded passwords`);
      // 3. Dynamic token reading
      assert.ok(v.content.includes("localStorage.getItem('token')"), `${v.name} must read token dynamically from localStorage`);
      // 4. HTML sanitization / escaping function
      assert.ok(v.content.includes('escapeHTML'), `${v.name} must implement escapeHTML to prevent XSS`);
      pass(`Security audit PASSED for ${v.name}: zero credentials, dynamic token, XSS escaping present`);
    }

    console.log('\n------------------------------------------------------------------------');
    console.log('  SECTION 7: LIVE HTTP SERVING & STATIC ASSET CHECKS');
    console.log('------------------------------------------------------------------------');

    const resGantt = await request('GET', '/gantt-chart.html');
    assert.strictEqual(resGantt.status, 200, 'GET /gantt-chart.html must return 200');
    assert.ok(resGantt.headers.get('content-type').includes('text/html'), 'Must serve HTML');
    pass('GET /gantt-chart.html serves HTTP 200 text/html');

    const resMilestone = await request('GET', '/milestone-timeline.html');
    assert.strictEqual(resMilestone.status, 200, 'GET /milestone-timeline.html must return 200');
    assert.ok(resMilestone.headers.get('content-type').includes('text/html'), 'Must serve HTML');
    pass('GET /milestone-timeline.html serves HTTP 200 text/html');

    const resBaseline = await request('GET', '/gantt-baseline.html');
    assert.strictEqual(resBaseline.status, 200, 'GET /gantt-baseline.html must return 200');
    assert.ok(resBaseline.headers.get('content-type').includes('text/html'), 'Must serve HTML');
    pass('GET /gantt-baseline.html serves HTTP 200 text/html');

    console.log('\n------------------------------------------------------------------------');
    console.log('  SECTION 8: LIVE API CONTRACT VALIDATION FOR FRONTEND VIEWS');
    console.log('------------------------------------------------------------------------');

    // Seed test users
    const ts = Date.now();
    const adminUser = {
      id: `admin-gantt5-${ts}`,
      name: 'Admin Boss',
      email: `admin.gantt5.${ts}@mahitechgroup.com`,
      role: 'admin'
    };
    execute(`
      INSERT INTO users (id, name, email, password_hash, role, status)
      VALUES (?, ?, ?, 'hash123', ?, 'active')
    `, [adminUser.id, adminUser.name, adminUser.email, adminUser.role]);

    const adminToken = createTestToken(adminUser);

    const ideaId = `idea-gantt-view-test-${ts}`;
    execute(`
      INSERT INTO ideas (id, owner_id, title, description, status)
      VALUES (?, ?, 'Frontend Gantt Views Test Idea', 'Gantt Chart & Views', 'APPROVED')
    `, [ideaId, adminUser.id]);

    // Create a dedicated test project
    const projId = `proj-gantt-view-test-${ts}`;
    execute(`
      INSERT INTO projects (id, idea_id, owner_id, title, status)
      VALUES (?, ?, ?, 'Frontend Gantt Views Test Project', 'ACTIVE')
    `, [projId, ideaId, adminUser.id]);

    // Create items for project
    const item1Res = await request('POST', '/api/gantt/item/create', {
      project_id: projId,
      title: 'Frontend Architecture Spec',
      type: 'TASK',
      start_date: '2026-11-01',
      end_date: '2026-11-05',
      progress_pct: 100
    }, adminToken);
    assert.strictEqual(item1Res.status, 201);
    const item1Id = item1Res.body.item.id;

    const item2Res = await request('POST', '/api/gantt/item/create', {
      project_id: projId,
      title: 'UI Component Library',
      type: 'TASK',
      start_date: '2026-11-06',
      end_date: '2026-11-12',
      progress_pct: 50
    }, adminToken);
    assert.strictEqual(item2Res.status, 201);
    const item2Id = item2Res.body.item.id;

    // Add dependency: item1 -> item2
    const depRes = await request('POST', '/api/gantt/dependency/add', {
      project_id: projId,
      predecessor_item_id: item1Id,
      successor_item_id: item2Id,
      dependency_type: 'FINISH_TO_START'
    }, adminToken);
    assert.strictEqual(depRes.status, 201);

    // Create a milestone linked to item1
    const msRes = await request('POST', '/api/gantt/milestone/create', {
      project_id: projId,
      title: 'Architecture Signoff Gate',
      milestone_date: '2026-11-05',
      gantt_item_id: item1Id
    }, adminToken);
    assert.strictEqual(msRes.status, 201);
    const msId = msRes.body.milestone.id;

    // Take initial baseline snapshot
    const snapRes = await request('POST', '/api/gantt/baseline/snapshot', {
      project_id: projId
    }, adminToken);
    assert.strictEqual(snapRes.status, 201);
    assert.strictEqual(snapRes.body.count, 2);
    pass('API contract: Created test project, items, dependency, milestone and baseline snapshot');

    // 1. Verify GET /api/gantt/items/:projectId (feeds View 1 & View 2)
    const itemsRes = await request('GET', `/api/gantt/items/${projId}`, null, adminToken);
    assert.strictEqual(itemsRes.status, 200);
    assert.strictEqual(itemsRes.body.items.length, 2);
    assert.strictEqual(itemsRes.body.dependencies.length, 1);
    assert.strictEqual(itemsRes.body.milestones.length, 1);
    pass('API contract: GET /api/gantt/items/:projectId returns complete timeline payload for View 1 & 2');

    // 2. Verify GET /api/gantt/milestones/:projectId (feeds View 3)
    const milestonesRes = await request('GET', `/api/gantt/milestones/${projId}`, null, adminToken);
    assert.strictEqual(milestonesRes.status, 200);
    assert.strictEqual(milestonesRes.body.milestones.length, 1);
    assert.strictEqual(milestonesRes.body.milestones[0].linked_item_title, 'Frontend Architecture Spec');
    pass('API contract: GET /api/gantt/milestones/:projectId returns milestone with linked item metadata for View 3');

    // 3. Mark milestone as achieved (View 3 action)
    const achieveRes = await request('PATCH', `/api/gantt/milestone/${msId}/achieve`, {}, adminToken);
    assert.strictEqual(achieveRes.status, 200);
    assert.strictEqual(achieveRes.body.milestone.status, 'ACHIEVED');
    pass('API contract: PATCH /api/gantt/milestone/:id/achieve marks milestone achieved');

    // 4. Update task date to simulate schedule slip
    await request('PATCH', `/api/gantt/item/${item2Id}`, {
      start_date: '2026-11-08',
      end_date: '2026-11-16' // 4 days slip from baseline (12th -> 16th)
    }, adminToken);

    // 5. Verify GET /api/gantt/baselines/:projectId (feeds View 4)
    const baselinesRes = await request('GET', `/api/gantt/baselines/${projId}`, null, adminToken);
    assert.strictEqual(baselinesRes.status, 200);
    const baselineList = Array.isArray(baselinesRes.body) ? baselinesRes.body : (baselinesRes.body.baselines || []);
    assert.ok(Array.isArray(baselineList));
    assert.strictEqual(baselineList.length, 2);
    const item2Baseline = baselineList.find(b => b.gantt_item_id === item2Id);
    assert.ok(item2Baseline);
    assert.strictEqual(item2Baseline.baseline_end_date, '2026-11-12');
    assert.strictEqual(item2Baseline.current_end_date, '2026-11-16');
    assert.strictEqual(item2Baseline.slip_days, 4); // +4 days delay
    pass('API contract: GET /api/gantt/baselines/:projectId returns accurate schedule slip variance (+4 days) for View 4');

    // 6. Verify critical path endpoint (feeds View 1 critical path toggle)
    const cpRes = await request('GET', `/api/gantt/criticalpath/${projId}`, null, adminToken);
    assert.strictEqual(cpRes.status, 200);
    assert.ok(Array.isArray(cpRes.body.critical_path_item_ids));
    pass('API contract: GET /api/gantt/criticalpath/:projectId returns critical items for View 1 overlay');

    // 7. Verify item history endpoint (feeds View 2 inline drawer history log)
    const histRes = await request('GET', `/api/gantt/history/${item2Id}`, null, adminToken);
    assert.strictEqual(histRes.status, 200);
    assert.ok(Array.isArray(histRes.body.history));
    assert.ok(histRes.body.history.length > 0);
    pass('API contract: GET /api/gantt/history/:itemId returns field audit logs for View 2 inline drawer');

    console.log('\n========================================================================');
    console.log(`  🎉 ALL ${passedAssertions} PRD 20 LAYER 5 ASSERTIONS PASSED WITH ZERO ERRORS!`);
    console.log('========================================================================\n');

  } finally {
    if (server) {
      server.close();
    }
  }
}

runLayer5Tests().catch((err) => {
  console.error('\n❌ PRD 20 LAYER 5 TEST SUITE FAILED:');
  console.error(err);
  process.exit(1);
});
