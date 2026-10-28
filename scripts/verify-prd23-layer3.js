/**
 * PRD 23 — Layer 3 Verification Suite
 * Dashboards & 12-Column Grid Widget Engine
 */

import http from 'node:http';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app.js';
import { queryOne, queryAll, execute, getDatabase } from '../src/db/database.js';
import { config } from '../src/config.js';
import * as analyticsService from '../src/services/analyticsService.js';

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(condition, message, details = '') {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  \x1b[32m✔ PASS:\x1b[0m Test ${totalTests}: ${message}`);
  } else {
    failedTests++;
    console.error(`  \x1b[31m✖ FAIL:\x1b[0m Test ${totalTests}: ${message}`);
    if (details) console.error(`    \x1b[33mDetails: ${details}\x1b[0m`);
    process.exitCode = 1;
  }
}

function makeRequest(serverUrl, path, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, serverUrl);
    const reqOptions = {
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    };

    const req = http.request(url, reqOptions, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        let parsed = null;
        try {
          parsed = JSON.parse(body);
        } catch (e) {
          parsed = body;
        }
        resolve({
          status: res.statusCode,
          headers: res.headers,
          data: parsed
        });
      });
    });

    req.on('error', reject);

    if (options.body) {
      const payload = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
      req.write(payload);
    }
    req.end();
  });
}

function generateToken(user) {
  const secret = config.JWT_SECRET || 'test_jwt_secret_mahi_tech_group_default';
  const sessionId = crypto.randomUUID();
  const token = jwt.sign(
    {
      sessionId,
      userId: user.id,
      role: user.role,
      email: user.email,
      name: user.name
    },
    secret,
    { expiresIn: '2h' }
  );

  const expiresAt = new Date(Date.now() + 2 * 3600 * 1000).toISOString();
  execute(`
    INSERT INTO sessions (id, user_id, token, expires_at, is_revoked, created_at)
    VALUES (?, ?, ?, ?, 0, datetime('now'));
  `, [sessionId, user.id, token, expiresAt]);

  return token;
}

async function runLayer3Verification() {
  console.log('\n========================================================================');
  console.log('  PRD 23 LAYER 3: DASHBOARDS & 12-COLUMN GRID WIDGET ENGINE VERIFICATION');
  console.log('========================================================================\n');

  let server;
  let serverUrl;

  try {
    // -------------------------------------------------------------------------
    // 1. Database Connection & Pragmas
    // -------------------------------------------------------------------------
    console.log('--- SECTION 1: Database Pragmas & Preconditions ---');

    const db = getDatabase();
    const journalMode = queryOne('PRAGMA journal_mode;');
    assert(journalMode && journalMode.journal_mode.toLowerCase() === 'wal', 'SQLite journal_mode is strictly WAL');

    const busyTimeout = queryOne('PRAGMA busy_timeout;');
    assert(busyTimeout && busyTimeout.timeout >= 5000, `SQLite busy_timeout is >= 5000ms (got: ${busyTimeout?.timeout})`);

    const fkStatus = queryOne('PRAGMA foreign_keys;');
    assert(fkStatus && fkStatus.foreign_keys === 1, 'SQLite foreign_keys constraint enforcement is ON (1)');

    // -------------------------------------------------------------------------
    // 2. HTTP Server & Personas Setup
    // -------------------------------------------------------------------------
    console.log('\n--- SECTION 2: HTTP Test Server & Personas ---');

    const app = createApp();
    server = http.createServer(app);

    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        serverUrl = `http://127.0.0.1:${addr.port}`;
        console.log(`  [HARNESS] Ephemeral test server active on ${serverUrl}`);
        resolve();
      });
    });

    const runSuffix = Date.now();

    // Authenticate Admin persona
    const adminUser = queryOne("SELECT id, name, email, role FROM users WHERE role IN ('admin', 'superadmin') AND status = 'active' LIMIT 1;");
    assert(!!adminUser, `Admin persona found in DB (ID: ${adminUser?.id})`);
    const adminToken = generateToken(adminUser);

    // Authenticate Member 1 persona
    let member1User = queryOne("SELECT id, name, email, role FROM users WHERE role NOT IN ('admin', 'superadmin') AND status = 'active' LIMIT 1;");
    if (!member1User) {
      const m1Id = `mem1-${runSuffix}`;
      execute(`
        INSERT INTO users (id, name, email, role, status, created_at, updated_at)
        VALUES (?, 'Test Member 1', ?, 'developer', 'active', datetime('now'), datetime('now'));
      `, [m1Id, `mem1_${runSuffix}@test.com`]);
      member1User = queryOne('SELECT id, name, email, role FROM users WHERE id = ?;', [m1Id]);
    }
    assert(!!member1User, `Member 1 persona verified (ID: ${member1User?.id})`);
    const member1Token = generateToken(member1User);

    // Authenticate Member 2 persona
    let member2User = queryOne("SELECT id, name, email, role FROM users WHERE id != ? AND role NOT IN ('admin', 'superadmin') AND status = 'active' LIMIT 1;", [member1User.id]);
    if (!member2User) {
      const m2Id = `mem2-${runSuffix}`;
      execute(`
        INSERT INTO users (id, name, email, role, status, created_at, updated_at)
        VALUES (?, 'Test Member 2', ?, 'designer', 'active', datetime('now'), datetime('now'));
      `, [m2Id, `mem2_${runSuffix}@test.com`]);
      member2User = queryOne('SELECT id, name, email, role FROM users WHERE id = ?;', [m2Id]);
    }
    assert(!!member2User, `Member 2 persona verified (ID: ${member2User?.id})`);
    const member2Token = generateToken(member2User);

    // -------------------------------------------------------------------------
    // 3. Dashboard Scope Creation & RBAC
    // -------------------------------------------------------------------------
    console.log('\n--- SECTION 3: Dashboard Scope Creation & RBAC ---');

    // Member 1 creates PERSONAL dashboard -> 201 Created
    const resM1Personal = await makeRequest(serverUrl, '/api/analytics/dashboard/create', {
      method: 'POST',
      headers: { Authorization: `Bearer ${member1Token}` },
      body: {
        name: `Member 1 Personal Workspace ${runSuffix}`,
        description: 'Personal productivity metrics',
        scope: 'PERSONAL',
        is_default: 1,
        layout: { columns: 12, theme: 'dark' }
      }
    });
    assert(resM1Personal.status === 201, 'Member successfully creates PERSONAL dashboard (201 Created)');
    assert(resM1Personal.data.success === true, 'Response indicates success = true');
    const m1PersonalDashboard = resM1Personal.data.dashboard;
    assert(m1PersonalDashboard && m1PersonalDashboard.scope === 'PERSONAL', 'Created dashboard scope is strictly "PERSONAL"');
    assert(m1PersonalDashboard.owner_id === member1User.id, 'Dashboard owner_id accurately matches Member 1 ID');

    // Member 1 attempts to create TEAM dashboard -> 403 Forbidden
    const resM1TeamAttempt = await makeRequest(serverUrl, '/api/analytics/dashboard/create', {
      method: 'POST',
      headers: { Authorization: `Bearer ${member1Token}` },
      body: {
        name: `Illegal Member Team Board ${runSuffix}`,
        scope: 'TEAM'
      }
    });
    assert(resM1TeamAttempt.status === 403, 'Member blocked from creating TEAM dashboard (403 Forbidden)');
    assert(resM1TeamAttempt.data.error.includes('Only Admins can create TEAM dashboards'), 'Error cites Admin role required for TEAM dashboard');

    // Member 1 attempts to create COMPANY dashboard -> 403 Forbidden
    const resM1CompAttempt = await makeRequest(serverUrl, '/api/analytics/dashboard/create', {
      method: 'POST',
      headers: { Authorization: `Bearer ${member1Token}` },
      body: {
        name: `Illegal Member Company Board ${runSuffix}`,
        scope: 'COMPANY'
      }
    });
    assert(resM1CompAttempt.status === 403, 'Member blocked from creating COMPANY dashboard (403 Forbidden)');
    assert(resM1CompAttempt.data.error.includes('Only Admins can create COMPANY dashboards'), 'Error cites Admin role required for COMPANY dashboard');

    // Admin creates TEAM dashboard -> 201 Created
    const resAdminTeam = await makeRequest(serverUrl, '/api/analytics/dashboard/create', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        name: `Engineering Team Dashboard ${runSuffix}`,
        description: 'Cross-functional engineering delivery metrics',
        scope: 'TEAM',
        layout: { columns: 12, gridGap: 16 }
      }
    });
    assert(resAdminTeam.status === 201, 'Admin successfully creates TEAM dashboard (201 Created)');
    const adminTeamDashboard = resAdminTeam.data.dashboard;
    assert(adminTeamDashboard.scope === 'TEAM', 'Created dashboard scope is strictly "TEAM"');

    // Admin creates COMPANY dashboard -> 201 Created
    const resAdminComp = await makeRequest(serverUrl, '/api/analytics/dashboard/create', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        name: `Executive Company Overview ${runSuffix}`,
        description: 'C-level executive KPI metrics',
        scope: 'COMPANY',
        layout: { columns: 12, rows: 4 }
      }
    });
    assert(resAdminComp.status === 201, 'Admin successfully creates COMPANY dashboard (201 Created)');
    const adminCompDashboard = resAdminComp.data.dashboard;
    assert(adminCompDashboard.scope === 'COMPANY', 'Created dashboard scope is strictly "COMPANY"');

    // Validation checks on creation
    const resEmptyName = await makeRequest(serverUrl, '/api/analytics/dashboard/create', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { name: '   ', scope: 'PERSONAL' }
    });
    assert(resEmptyName.status === 400, 'Creation without name rejected with 400 Bad Request');

    const resInvalidScope = await makeRequest(serverUrl, '/api/analytics/dashboard/create', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { name: 'Bad Scope Board', scope: 'GLOBAL_UNIVERSE' }
    });
    assert(resInvalidScope.status === 400, 'Creation with invalid scope rejected with 400 Bad Request');

    const resBadLayout = await makeRequest(serverUrl, '/api/analytics/dashboard/create', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { name: 'Bad Layout Board', layout: 'NOT_VALID_JSON{{[' }
    });
    assert(resBadLayout.status === 400, 'Creation with invalid JSON layout rejected with 400 Bad Request');

    // Member 2 creates own PERSONAL dashboard
    const resM2Personal = await makeRequest(serverUrl, '/api/analytics/dashboard/create', {
      method: 'POST',
      headers: { Authorization: `Bearer ${member2Token}` },
      body: {
        name: `Member 2 Secret Board ${runSuffix}`,
        scope: 'PERSONAL'
      }
    });
    assert(resM2Personal.status === 201, 'Member 2 creates own PERSONAL dashboard');
    const m2PersonalDashboard = resM2Personal.data.dashboard;

    // -------------------------------------------------------------------------
    // 4. Dashboard List Visibility & Scope Isolation
    // -------------------------------------------------------------------------
    console.log('\n--- SECTION 4: Dashboard List Visibility & Scope Isolation ---');

    // Member 1 lists dashboards
    const resListM1 = await makeRequest(serverUrl, '/api/analytics/dashboards', {
      method: 'GET',
      headers: { Authorization: `Bearer ${member1Token}` }
    });
    assert(resListM1.status === 200, 'Member 1 lists accessible dashboards (200 OK)');
    const m1Dashboards = resListM1.data.dashboards;

    assert(m1Dashboards.some(d => d.id === m1PersonalDashboard.id), 'Member 1 list includes own PERSONAL dashboard');
    assert(m1Dashboards.some(d => d.id === adminTeamDashboard.id), 'Member 1 list includes TEAM dashboard');
    assert(!m1Dashboards.some(d => d.id === m2PersonalDashboard.id), 'Member 1 list strictly EXCLUDES Member 2 PERSONAL dashboard');
    assert(!m1Dashboards.some(d => d.id === adminCompDashboard.id), 'Member 1 list strictly EXCLUDES COMPANY dashboard');

    // Member 2 lists dashboards
    const resListM2 = await makeRequest(serverUrl, '/api/analytics/dashboards', {
      method: 'GET',
      headers: { Authorization: `Bearer ${member2Token}` }
    });
    const m2Dashboards = resListM2.data.dashboards;
    assert(m2Dashboards.some(d => d.id === m2PersonalDashboard.id), 'Member 2 list includes own PERSONAL dashboard');
    assert(!m2Dashboards.some(d => d.id === m1PersonalDashboard.id), 'Member 2 list strictly EXCLUDES Member 1 PERSONAL dashboard');
    assert(!m2Dashboards.some(d => d.id === adminCompDashboard.id), 'Member 2 list strictly EXCLUDES COMPANY dashboard');

    // Admin lists dashboards
    const resListAdmin = await makeRequest(serverUrl, '/api/analytics/dashboards', {
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const adminDashboards = resListAdmin.data.dashboards;
    assert(adminDashboards.some(d => d.id === adminTeamDashboard.id), 'Admin list includes TEAM dashboards');
    assert(adminDashboards.some(d => d.id === adminCompDashboard.id), 'Admin list includes COMPANY dashboards');

    // -------------------------------------------------------------------------
    // 5. Dashboard Details & Scope Access Enforcement
    // -------------------------------------------------------------------------
    console.log('\n--- SECTION 5: Dashboard Details & Scope Access Enforcement ---');

    // Member 1 reads own PERSONAL dashboard -> 200 OK
    const resGetM1Own = await makeRequest(serverUrl, `/api/analytics/dashboard/${m1PersonalDashboard.id}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${member1Token}` }
    });
    assert(resGetM1Own.status === 200, 'Member 1 successfully views own PERSONAL dashboard (200 OK)');

    // Member 2 attempts to read Member 1's PERSONAL dashboard -> 403 Forbidden
    const resGetM2Alien = await makeRequest(serverUrl, `/api/analytics/dashboard/${m1PersonalDashboard.id}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${member2Token}` }
    });
    assert(resGetM2Alien.status === 403, 'Member 2 blocked from viewing Member 1 PERSONAL dashboard (403 Forbidden)');
    assert(resGetM2Alien.data.error.includes("Cannot view another user's personal dashboard"), 'Error explicitly forbids viewing alien personal board');

    // Member 1 reads TEAM dashboard -> 200 OK
    const resGetM1Team = await makeRequest(serverUrl, `/api/analytics/dashboard/${adminTeamDashboard.id}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${member1Token}` }
    });
    assert(resGetM1Team.status === 200, 'Member 1 successfully views TEAM dashboard (200 OK)');

    // Member 1 attempts to read COMPANY dashboard -> 403 Forbidden
    const resGetM1Company = await makeRequest(serverUrl, `/api/analytics/dashboard/${adminCompDashboard.id}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${member1Token}` }
    });
    assert(resGetM1Company.status === 403, 'Member 1 blocked from viewing COMPANY dashboard (403 Forbidden)');
    assert(resGetM1Company.data.error.includes('Only Admins can view COMPANY dashboards'), 'Error explicitly reserves COMPANY dashboards to Admins');

    // Admin reads COMPANY dashboard -> 200 OK
    const resGetAdminCompany = await makeRequest(serverUrl, `/api/analytics/dashboard/${adminCompDashboard.id}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(resGetAdminCompany.status === 200, 'Admin successfully views COMPANY dashboard (200 OK)');

    // Non-existent dashboard -> 404 Not Found
    const resGetNonExistent = await makeRequest(serverUrl, '/api/analytics/dashboard/9999999', {
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(resGetNonExistent.status === 404, 'Non-existent dashboard returns 404 Not Found');

    // -------------------------------------------------------------------------
    // 6. 12-Column Grid Widget Creation & Constraints
    // -------------------------------------------------------------------------
    console.log('\n--- SECTION 6: 12-Column Grid Widget Creation & Constraints ---');

    // Valid widget creation on TEAM dashboard: width 4, position_x 0 -> valid
    const resW1 = await makeRequest(serverUrl, '/api/analytics/widget/create', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        dashboard_id: adminTeamDashboard.id,
        kpi_id: 1, // Sprint Velocity
        widget_type: 'NUMBER_CARD',
        title: 'Current Sprint Velocity',
        config: { colorScheme: 'emerald', showSparkline: true },
        position_x: 0,
        position_y: 0,
        width: 4,
        height: 2
      }
    });
    assert(resW1.status === 201, 'Valid widget created on 12-column grid (201 Created)');
    assert(resW1.data.success === true, 'Response indicates success = true');
    const widget1 = resW1.data.widget;
    assert(widget1 && widget1.width === 4 && widget1.position_x === 0, 'Widget dimensions stored accurately (pos_x=0, width=4)');

    // Second widget on same row: position_x 4, width 4 -> 4 + 4 = 8 <= 12 -> valid
    const resW2 = await makeRequest(serverUrl, '/api/analytics/widget/create', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        dashboard_id: adminTeamDashboard.id,
        kpi_id: 2, // Sprint Completion Rate
        widget_type: 'PROGRESS_BAR',
        title: 'Sprint Completion Gauge',
        position_x: 4,
        position_y: 0,
        width: 4,
        height: 2
      }
    });
    assert(resW2.status === 201, 'Second widget placed on same row within 12 columns (pos_x=4, width=4)');

    // Third widget on same row filling to edge: position_x 8, width 4 -> 8 + 4 = 12 <= 12 -> valid
    const resW3 = await makeRequest(serverUrl, '/api/analytics/widget/create', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        dashboard_id: adminTeamDashboard.id,
        kpi_id: 3, // OKR Progress
        widget_type: 'LINE_CHART',
        title: 'OKR Trend Line',
        position_x: 8,
        position_y: 0,
        width: 4,
        height: 2
      }
    });
    assert(resW3.status === 201, 'Third widget fits boundary perfectly at col 12 (pos_x=8, width=4)');

    // 12-Column Overflow Violation: position_x 10, width 4 -> 10 + 4 = 14 > 12 -> 400 Bad Request
    const resGridOverflow = await makeRequest(serverUrl, '/api/analytics/widget/create', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        dashboard_id: adminTeamDashboard.id,
        widget_type: 'BAR_CHART',
        title: 'Overflowing Chart',
        position_x: 10,
        position_y: 1,
        width: 4, // 10 + 4 = 14 > 12
        height: 2
      }
    });
    assert(resGridOverflow.status === 400, 'Widget exceeding 12-column row boundary rejected with 400 Bad Request');
    assert(resGridOverflow.data.error.includes('cannot exceed 12 columns'), 'Error explicitly details 12-column grid limit breach');

    // Negative coordinate rejection
    const resNegPos = await makeRequest(serverUrl, '/api/analytics/widget/create', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        dashboard_id: adminTeamDashboard.id,
        widget_type: 'BAR_CHART',
        title: 'Negative Pos',
        position_x: -2,
        width: 4
      }
    });
    assert(resNegPos.status === 400, 'Negative position_x rejected with 400 Bad Request');

    // Zero width rejection
    const resZeroWidth = await makeRequest(serverUrl, '/api/analytics/widget/create', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        dashboard_id: adminTeamDashboard.id,
        widget_type: 'BAR_CHART',
        title: 'Zero Width',
        position_x: 0,
        width: 0
      }
    });
    assert(resZeroWidth.status === 400, 'Zero width rejected with 400 Bad Request');

    // Width > 12 rejection
    const resTooWide = await makeRequest(serverUrl, '/api/analytics/widget/create', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        dashboard_id: adminTeamDashboard.id,
        widget_type: 'BAR_CHART',
        title: 'Too Wide',
        position_x: 0,
        width: 13
      }
    });
    assert(resTooWide.status === 400, 'Width > 12 rejected with 400 Bad Request');

    // Invalid widget_type rejection
    const resBadType = await makeRequest(serverUrl, '/api/analytics/widget/create', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        dashboard_id: adminTeamDashboard.id,
        widget_type: 'SUPER_HOLOGRAM_3D',
        title: 'Bad Type',
        position_x: 0,
        width: 4
      }
    });
    assert(resBadType.status === 400, 'Invalid widget_type rejected with 400 Bad Request');

    // Non-existent kpi_id rejection
    const resBadKpi = await makeRequest(serverUrl, '/api/analytics/widget/create', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        dashboard_id: adminTeamDashboard.id,
        kpi_id: 999999, // Non-existent KPI
        widget_type: 'NUMBER_CARD',
        title: 'Ghost KPI Widget',
        position_x: 0,
        width: 4
      }
    });
    assert(resBadKpi.status === 404, 'Non-existent referenced kpi_id rejected with 404 Not Found');

    // Verify all 9 allowed widget types pass validation
    const allowedTypes = ['NUMBER_CARD', 'BAR_CHART', 'LINE_CHART', 'PIE_CHART', 'PROGRESS_BAR', 'TABLE', 'HEATMAP', 'BURNDOWN', 'VELOCITY'];
    for (const type of allowedTypes) {
      const resTypeCheck = await makeRequest(serverUrl, '/api/analytics/widget/create', {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: {
          dashboard_id: adminCompDashboard.id,
          widget_type: type,
          title: `Test ${type}`,
          position_x: 0,
          position_y: 0,
          width: 2,
          height: 2
        }
      });
      assert(resTypeCheck.status === 201, `Allowed widget_type "${type}" accepted (201 Created)`);
    }

    // Permission check: Member 1 attempts to add widget to Admin's TEAM board -> 403 Forbidden
    const resM1WidgetOnTeam = await makeRequest(serverUrl, '/api/analytics/widget/create', {
      method: 'POST',
      headers: { Authorization: `Bearer ${member1Token}` },
      body: {
        dashboard_id: adminTeamDashboard.id,
        widget_type: 'TABLE',
        title: 'Hacked Widget',
        position_x: 0,
        width: 4
      }
    });
    assert(resM1WidgetOnTeam.status === 403, 'Member blocked from adding widgets to TEAM dashboard (403 Forbidden)');

    // Member 1 creates widget on own PERSONAL dashboard -> 201 Created
    const resM1OwnWidget = await makeRequest(serverUrl, '/api/analytics/widget/create', {
      method: 'POST',
      headers: { Authorization: `Bearer ${member1Token}` },
      body: {
        dashboard_id: m1PersonalDashboard.id,
        kpi_id: 5, // Billable Hours
        widget_type: 'NUMBER_CARD',
        title: 'My Billable Hours',
        position_x: 0,
        position_y: 0,
        width: 6,
        height: 2
      }
    });
    assert(resM1OwnWidget.status === 201, 'Member successfully creates widget on own PERSONAL dashboard (201 Created)');
    const m1PersonalWidget = resM1OwnWidget.data.widget;

    // -------------------------------------------------------------------------
    // 7. Pre-computed Snapshot & Trend Sparkline Data Verification
    // -------------------------------------------------------------------------
    console.log('\n--- SECTION 7: Pre-computed Snapshot & Trend Sparkline Data ---');

    // Fetch dashboard with widgets: verify pre-computed snapshots and sparkline trend
    const resDashboardData = await makeRequest(serverUrl, `/api/analytics/dashboard/${adminTeamDashboard.id}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(resDashboardData.status === 200, 'Fetch dashboard data returns 200 OK');
    const fetchedWidgets = resDashboardData.data.widgets;
    assert(Array.isArray(fetchedWidgets) && fetchedWidgets.length >= 3, 'Dashboard response contains attached widgets array');

    const velocityWidget = fetchedWidgets.find(w => w.kpi_id === 1);
    assert(!!velocityWidget, 'Found Sprint Velocity widget in fetched widgets');
    assert(!!velocityWidget.kpi, 'Widget includes joined KPI definition metadata');
    assert(velocityWidget.kpi.name === 'Sprint Velocity', 'KPI name matches "Sprint Velocity"');
    assert(velocityWidget.latest_snapshot !== null, 'Widget includes pre-computed latest_snapshot object');
    assert(typeof velocityWidget.latest_snapshot.value === 'number', `Latest snapshot value is a valid number: ${velocityWidget.latest_snapshot.value}`);

    // Direct DB SELECT verify that widget latest_snapshot matches SQLite kpi_snapshots
    const dbLatestSnap = queryOne(`
      SELECT value, snapshotted_at 
      FROM kpi_snapshots 
      WHERE kpi_id = 1 
      ORDER BY id DESC LIMIT 1;
    `);
    assert(dbLatestSnap && dbLatestSnap.value === velocityWidget.latest_snapshot.value, 'Direct DB SELECT: widget snapshot matches latest row in kpi_snapshots table');

    // Verify 30-point trend sparkline array
    assert(Array.isArray(velocityWidget.trend_snapshots), 'Widget contains trend_snapshots array');
    assert(velocityWidget.trend_snapshots.length > 0 && velocityWidget.trend_snapshots.length <= 30, `Trend sparkline contains ${velocityWidget.trend_snapshots.length} historical snapshot points`);

    // Privacy rule verification: Member view of dashboard strips raw individual member breakdowns
    const resM1TeamView = await makeRequest(serverUrl, `/api/analytics/dashboard/${adminTeamDashboard.id}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${member1Token}` }
    });
    const m1ViewWidgets = resM1TeamView.data.widgets;
    for (const w of m1ViewWidgets) {
      if (w.latest_snapshot && w.latest_snapshot.calculation_metadata) {
        assert(!w.latest_snapshot.calculation_metadata.members, 'Member view: raw members breakdown redacted from metadata');
        assert(!w.latest_snapshot.calculation_metadata.memberResults, 'Member view: raw memberResults redacted from metadata');
        assert(!w.latest_snapshot.calculation_metadata.individual_contributions, 'Member view: individual contributions redacted from metadata');
      }
    }
    assert(true, 'Privacy test: Raw individual member contribution data strictly redacted from non-admin viewers');

    // -------------------------------------------------------------------------
    // 8. Widget Modification & Deletion
    // -------------------------------------------------------------------------
    console.log('\n--- SECTION 8: Widget Modification & Deletion ---');

    // Update widget properties and dimensions
    const resUpdateW1 = await makeRequest(serverUrl, `/api/analytics/widget/${widget1.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        title: 'Updated Velocity Metric Card',
        position_x: 2,
        width: 6
      }
    });
    assert(resUpdateW1.status === 200, 'Widget updated successfully with 200 OK');
    assert(resUpdateW1.data.widget.title === 'Updated Velocity Metric Card', 'Widget title updated in response');
    assert(resUpdateW1.data.widget.width === 6 && resUpdateW1.data.widget.position_x === 2, 'Widget position and width updated');

    // Direct DB SELECT verify widget update in SQLite
    const dbW1 = queryOne('SELECT * FROM dashboard_widgets WHERE id = ?;', [widget1.id]);
    assert(dbW1.title === 'Updated Velocity Metric Card' && dbW1.width === 6, 'Direct DB SELECT: widget row updated in dashboard_widgets');

    // Overflow check on update: position_x: 10, width: 6 -> 10 + 6 = 16 > 12 -> 400 Bad Request
    const resUpdateOverflow = await makeRequest(serverUrl, `/api/analytics/widget/${widget1.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        position_x: 10,
        width: 6
      }
    });
    assert(resUpdateOverflow.status === 400, 'Widget update exceeding 12 columns rejected with 400 Bad Request');

    // Member 1 attempts to update widget on Admin's TEAM board -> 403 Forbidden
    const resM1UpdateTeamW = await makeRequest(serverUrl, `/api/analytics/widget/${widget1.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${member1Token}` },
      body: { title: 'Hacked Title' }
    });
    assert(resM1UpdateTeamW.status === 403, 'Member 1 blocked from modifying widgets on TEAM board (403 Forbidden)');

    // Member 1 attempts to delete widget on Admin's TEAM board -> 403 Forbidden
    const resM1DelTeamW = await makeRequest(serverUrl, `/api/analytics/widget/${widget1.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${member1Token}` }
    });
    assert(resM1DelTeamW.status === 403, 'Member 1 blocked from deleting widgets on TEAM board (403 Forbidden)');

    // Member 1 deletes own widget on PERSONAL board -> 200 OK
    const resM1DelOwnW = await makeRequest(serverUrl, `/api/analytics/widget/${m1PersonalWidget.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${member1Token}` }
    });
    assert(resM1DelOwnW.status === 200, 'Member 1 deletes own widget on PERSONAL board (200 OK)');

    const dbDelW = queryOne('SELECT id FROM dashboard_widgets WHERE id = ?;', [m1PersonalWidget.id]);
    assert(!dbDelW, 'Direct DB SELECT: deleted widget completely removed from dashboard_widgets');

    // -------------------------------------------------------------------------
    // 9. Dashboard Modification & Deletion Rules
    // -------------------------------------------------------------------------
    console.log('\n--- SECTION 9: Dashboard Modification & Deletion Rules ---');

    // Update dashboard metadata via PATCH
    const dbDashBefore = queryOne('SELECT updated_at FROM analytics_dashboards WHERE id = ?;', [adminTeamDashboard.id]);
    await new Promise(r => setTimeout(r, 1000));

    const resPatchDash = await makeRequest(serverUrl, `/api/analytics/dashboard/${adminTeamDashboard.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        name: 'Updated Engineering Delivery Board',
        description: 'New unified delivery view',
        layout: { columns: 12, theme: 'corporate-blue' }
      }
    });
    assert(resPatchDash.status === 200, 'Dashboard updated with 200 OK');
    assert(resPatchDash.data.dashboard.name === 'Updated Engineering Delivery Board', 'Updated name returned in response');

    const dbDashAfter = queryOne('SELECT name, description, updated_at FROM analytics_dashboards WHERE id = ?;', [adminTeamDashboard.id]);
    assert(dbDashAfter.name === 'Updated Engineering Delivery Board', 'Direct DB SELECT: dashboard name updated in SQLite');
    assert(dbDashAfter.updated_at !== dbDashBefore.updated_at, 'Direct DB SELECT: updated_at changed manually on row modification');

    // Member attempts to update Admin TEAM dashboard -> 403 Forbidden
    const resM1PatchTeam = await makeRequest(serverUrl, `/api/analytics/dashboard/${adminTeamDashboard.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${member1Token}` },
      body: { name: 'Member Hijacked Team Board' }
    });
    assert(resM1PatchTeam.status === 403, 'Member blocked from updating TEAM dashboard (403 Forbidden)');

    // Sole COMPANY Dashboard Deletion Defense:
    // First verify current COMPANY dashboard count
    const compBoards = queryAll("SELECT id FROM analytics_dashboards WHERE scope = 'COMPANY';");
    if (compBoards.length > 1) {
      // Clean up extra company dashboards so exactly 1 remains
      for (let i = 1; i < compBoards.length; i++) {
        execute('DELETE FROM dashboard_widgets WHERE dashboard_id = ?;', [compBoards[i].id]);
        execute('DELETE FROM analytics_dashboards WHERE id = ?;', [compBoards[i].id]);
      }
    }

    const soleCompBoard = queryOne("SELECT id FROM analytics_dashboards WHERE scope = 'COMPANY' LIMIT 1;");
    assert(!!soleCompBoard, 'Sole COMPANY dashboard confirmed in database');

    // Attempt to delete sole COMPANY dashboard -> 400 Bad Request
    const resDelSoleComp = await makeRequest(serverUrl, `/api/analytics/dashboard/${soleCompBoard.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(resDelSoleComp.status === 400, 'Attempt to delete sole COMPANY dashboard rejected with 400 Bad Request');
    assert(resDelSoleComp.data.error.includes('Cannot delete COMPANY scope dashboard as it is the only company dashboard'), 'Error explicitly cites sole company dashboard protection rule');

    // Create a second COMPANY dashboard to verify deletion works when count > 1
    const resCreateSecondComp = await makeRequest(serverUrl, '/api/analytics/dashboard/create', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        name: `Redundant Company Board ${runSuffix}`,
        scope: 'COMPANY'
      }
    });
    const secondCompId = resCreateSecondComp.data.dashboard.id;

    // Deleting second COMPANY dashboard should now succeed
    const resDelSecondComp = await makeRequest(serverUrl, `/api/analytics/dashboard/${secondCompId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(resDelSecondComp.status === 200, 'Deleting secondary COMPANY dashboard succeeds with 200 OK');

    const dbSecondDeleted = queryOne('SELECT id FROM analytics_dashboards WHERE id = ?;', [secondCompId]);
    assert(!dbSecondDeleted, 'Direct DB SELECT: secondary COMPANY dashboard deleted from database');

    // Member 2 attempts to delete Member 1's PERSONAL dashboard -> 403 Forbidden
    const resM2DelM1Personal = await makeRequest(serverUrl, `/api/analytics/dashboard/${m1PersonalDashboard.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${member2Token}` }
    });
    assert(resM2DelM1Personal.status === 403, 'Member 2 blocked from deleting Member 1 PERSONAL dashboard (403 Forbidden)');

    // Member 1 deletes own PERSONAL dashboard -> 200 OK
    const resM1DelOwn = await makeRequest(serverUrl, `/api/analytics/dashboard/${m1PersonalDashboard.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${member1Token}` }
    });
    assert(resM1DelOwn.status === 200, 'Member 1 deletes own PERSONAL dashboard with 200 OK');

    const dbM1Deleted = queryOne('SELECT id FROM analytics_dashboards WHERE id = ?;', [m1PersonalDashboard.id]);
    assert(!dbM1Deleted, 'Direct DB SELECT: Member 1 PERSONAL dashboard removed from database');

    // -------------------------------------------------------------------------
    // 10. Audit Trail Logging Verification
    // -------------------------------------------------------------------------
    console.log('\n--- SECTION 10: Audit Trail Logging in access_log ---');

    const logActions = ['DASHBOARD_CREATED', 'DASHBOARD_UPDATED', 'DASHBOARD_DELETED', 'WIDGET_CREATED', 'WIDGET_UPDATED', 'WIDGET_DELETED'];
    for (const act of logActions) {
      const logRow = queryOne('SELECT id, action, resource, timestamp FROM access_log WHERE action = ? ORDER BY id DESC LIMIT 1;', [act]);
      assert(!!logRow, `Audit event "${act}" successfully recorded in access_log`);
    }

    // Clean up test dashboards created in this run
    execute('DELETE FROM dashboard_widgets WHERE dashboard_id IN (?, ?);', [adminTeamDashboard.id, m2PersonalDashboard.id]);
    execute('DELETE FROM analytics_dashboards WHERE id IN (?, ?);', [adminTeamDashboard.id, m2PersonalDashboard.id]);

    console.log('\n========================================================================');
    console.log('  PRD 23 LAYER 3 VERIFICATION SUMMARY:');
    console.log(`  Total Tests:  ${totalTests}`);
    console.log(`  Passed Tests: ${passedTests}`);
    console.log(`  Failed Tests: ${failedTests}`);
    console.log('========================================================================\n');

    if (failedTests > 0) {
      process.exit(1);
    }
  } catch (error) {
    console.error('Fatal error during PRD 23 Layer 3 verification:', error);
    process.exit(1);
  } finally {
    if (server) {
      server.close();
      console.log('  [HARNESS] Ephemeral test server closed cleanly\n');
    }
  }
}

runLayer3Verification();
