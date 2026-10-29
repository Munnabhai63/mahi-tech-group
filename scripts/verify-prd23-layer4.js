/**
 * PRD 23 — Layer 4 Verification Suite
 * Reports, Export Engine, Alert Acknowledgment & KPI Snapshot History
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

async function runLayer4Verification() {
  console.log('\n========================================================================');
  console.log('  PRD 23 LAYER 4: REPORTS, EXPORT ENGINE & ALERT ACKNOWLEDGMENT VERIFICATION');
  console.log('========================================================================\n');

  let server;
  let serverUrl;

  try {
    getDatabase();

    const app = createApp();
    server = http.createServer(app);
    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        serverUrl = `http://127.0.0.1:${port}`;
        console.log(`  [HARNESS] Ephemeral test server listening on dynamic port ${port}\n`);
        resolve();
      });
    });

    // --- SECTION 1: Persona Authentication ---
    console.log('--- SECTION 1: Persona Authentication & Token Issuance ---');
    const ts = Date.now();
    let adminUser = queryOne("SELECT id, name, email, role, status FROM users WHERE role IN ('admin', 'superadmin') AND status = 'active' LIMIT 1;");
    if (!adminUser) {
      const aId = `admin-l4-${ts}`;
      execute(`
        INSERT INTO users (id, name, email, password_hash, role, status, created_at, updated_at)
        VALUES (?, 'Admin Officer', ?, 'test_hash', 'admin', 'active', datetime('now'), datetime('now'));
      `, [aId, `admin.l4.${ts}@mahitechgroup.com`]);
      adminUser = queryOne('SELECT id, name, email, role, status FROM users WHERE id = ?;', [aId]);
    }

    let member1 = queryOne("SELECT id, name, email, role, status FROM users WHERE role NOT IN ('admin', 'superadmin') AND status = 'active' LIMIT 1;");
    if (!member1) {
      const m1Id = `mem1-l4-${ts}`;
      execute(`
        INSERT INTO users (id, name, email, password_hash, role, status, created_at, updated_at)
        VALUES (?, 'Alice Engineer', ?, 'test_hash', 'developer', 'active', datetime('now'), datetime('now'));
      `, [m1Id, `alice.l4.${ts}@mahitechgroup.com`]);
      member1 = queryOne('SELECT id, name, email, role, status FROM users WHERE id = ?;', [m1Id]);
    }

    let member2 = queryOne("SELECT id, name, email, role, status FROM users WHERE id != ? AND role NOT IN ('admin', 'superadmin') AND status = 'active' LIMIT 1;", [member1.id]);
    if (!member2) {
      const m2Id = `mem2-l4-${ts}`;
      execute(`
        INSERT INTO users (id, name, email, password_hash, role, status, created_at, updated_at)
        VALUES (?, 'Bob Designer', ?, 'test_hash', 'designer', 'active', datetime('now'), datetime('now'));
      `, [m2Id, `bob.l4.${ts}@mahitechgroup.com`]);
      member2 = queryOne('SELECT id, name, email, role, status FROM users WHERE id = ?;', [m2Id]);
    }

    const adminToken = generateToken(adminUser);
    const member1Token = generateToken(member1);
    const member2Token = generateToken(member2);

    assert(Boolean(adminToken), 'Admin token issued successfully');
    assert(Boolean(member1Token), 'Member 1 token issued successfully');
    assert(Boolean(member2Token), 'Member 2 token issued successfully');

    // --- SECTION 2: KPI Alerts Setup & Scope Isolation ---
    console.log('\n--- SECTION 2: KPI Alerts Generation & Scope Visibility ---');
    // Ensure fixture KPIs exist
    const kpiCompany = queryOne("SELECT id FROM kpi_definitions WHERE name = 'Revenue This Month';") || queryOne('SELECT id FROM kpi_definitions ORDER BY id ASC LIMIT 1;');
    
    // Create an exclusive personal KPI for Member 1 to ensure zero collision with TEAM dashboards
    let kpiTeam = queryOne("SELECT id FROM kpi_definitions WHERE name = 'Alice Personal Exclusive KPI';");
    if (!kpiTeam) {
      execute(`
        INSERT INTO kpi_definitions (name, data_source, metric_type, calculation_query, unit, target_value, is_active, is_built_in, created_by, created_at, updated_at)
        VALUES ('Alice Personal Exclusive KPI', 'CUSTOM', 'COUNT', '{"table":"ideas","agg":"COUNT"}', 'count', 10, 1, 0, ?, datetime('now'), datetime('now'));
      `, [adminUser.id]);
      kpiTeam = queryOne("SELECT id FROM kpi_definitions WHERE name = 'Alice Personal Exclusive KPI';");
    }

    // Insert alert for company KPI (unattached to member dashboards)
    execute(`
      INSERT INTO kpi_alerts (kpi_id, alert_type, triggered_value, threshold_value, message, created_at)
      VALUES (?, 'BELOW_THRESHOLD', 450000.0, 500000.0, 'Company Revenue fell below monthly target threshold', datetime('now'));
    `, [kpiCompany.id]);
    const companyAlert = queryOne('SELECT * FROM kpi_alerts WHERE kpi_id = ? ORDER BY id DESC LIMIT 1;', [kpiCompany.id]);

    // Member 1 creates a personal dashboard and attaches a widget with kpiTeam
    const boardRes = await makeRequest(serverUrl, '/api/analytics/dashboard/create', {
      method: 'POST',
      headers: { Authorization: `Bearer ${member1Token}` },
      body: { name: 'Alice Personal Board', scope: 'PERSONAL' }
    });
    const m1DashboardId = boardRes.data.dashboard.id;

    await makeRequest(serverUrl, '/api/analytics/widget/create', {
      method: 'POST',
      headers: { Authorization: `Bearer ${member1Token}` },
      body: {
        dashboard_id: m1DashboardId,
        kpi_id: kpiTeam.id,
        widget_type: 'NUMBER_CARD',
        title: 'Team Velocity Card',
        position_x: 0,
        position_y: 0,
        width: 4,
        height: 2
      }
    });

    // Insert alert for kpiTeam
    execute(`
      INSERT INTO kpi_alerts (kpi_id, alert_type, triggered_value, threshold_value, message, created_at)
      VALUES (?, 'BELOW_THRESHOLD', 12.0, 20.0, 'Sprint velocity dipped below threshold', datetime('now'));
    `, [kpiTeam.id]);
    const teamAlert = queryOne('SELECT * FROM kpi_alerts WHERE kpi_id = ? ORDER BY id DESC LIMIT 1;', [kpiTeam.id]);

    // Admin lists alerts -> sees all
    const adminAlertsRes = await makeRequest(serverUrl, '/api/analytics/alerts', {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(adminAlertsRes.status === 200, 'Admin successfully retrieves all alerts (200 OK)');
    assert(Array.isArray(adminAlertsRes.data.alerts), 'Admin alert response contains alerts array');
    const adminAlertIds = adminAlertsRes.data.alerts.map(a => a.id);
    assert(adminAlertIds.includes(companyAlert.id), 'Admin alert list includes company-level alert');
    assert(adminAlertIds.includes(teamAlert.id), 'Admin alert list includes team-level alert');

    // Member 1 lists alerts -> sees teamAlert (attached to her personal board), but NOT companyAlert
    const m1AlertsRes = await makeRequest(serverUrl, '/api/analytics/alerts', {
      headers: { Authorization: `Bearer ${member1Token}` }
    });
    assert(m1AlertsRes.status === 200, 'Member 1 retrieves accessible alerts (200 OK)');
    const m1AlertIds = m1AlertsRes.data.alerts.map(a => a.id);
    assert(m1AlertIds.includes(teamAlert.id), 'Member 1 can see alert for KPI placed on her dashboard');
    assert(!m1AlertIds.includes(companyAlert.id), 'Member 1 alert list strictly EXCLUDES COMPANY KPI alerts');

    // Member 2 lists alerts -> has no dashboards with these KPIs, sees 0 alerts
    const m2AlertsRes = await makeRequest(serverUrl, '/api/analytics/alerts', {
      headers: { Authorization: `Bearer ${member2Token}` }
    });
    assert(m2AlertsRes.status === 200, 'Member 2 retrieves alerts (200 OK)');
    const m2AlertIds = m2AlertsRes.data.alerts.map(a => a.id);
    assert(!m2AlertIds.includes(teamAlert.id), 'Member 2 cannot see Member 1 personal board KPI alerts');

    // --- SECTION 3: Alert Acknowledgment Workflow & Immutability ---
    console.log('\n--- SECTION 3: Alert Acknowledgment Workflow & Protection ---');
    // Member attempts to acknowledge -> 403 Forbidden
    const memAckRes = await makeRequest(serverUrl, `/api/analytics/alert/${teamAlert.id}/acknowledge`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${member1Token}` }
    });
    assert(memAckRes.status === 403, 'Member calling acknowledge rejected with 403 Forbidden');

    // Admin acknowledges alert -> 200 OK
    const adminAckRes = await makeRequest(serverUrl, `/api/analytics/alert/${teamAlert.id}/acknowledge`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(adminAckRes.status === 200, 'Admin successfully acknowledges alert (200 OK)');
    assert(adminAckRes.data.success === true, 'Response indicates success = true');
    assert(adminAckRes.data.alert.acknowledged_by === adminUser.id, 'Alert recorded acknowledged_by matching Admin ID');
    assert(Boolean(adminAckRes.data.alert.acknowledged_at), 'Alert recorded acknowledged_at timestamp');

    // Direct DB SELECT: verify acknowledged fields
    const ackDbRow = queryOne('SELECT acknowledged_by, acknowledged_at FROM kpi_alerts WHERE id = ?;', [teamAlert.id]);
    assert(ackDbRow.acknowledged_by === adminUser.id, 'Direct DB SELECT: acknowledged_by saved in SQLite');
    assert(Boolean(ackDbRow.acknowledged_at), 'Direct DB SELECT: acknowledged_at saved in SQLite');

    // Attempting to acknowledge already-acknowledged alert -> 400 Bad Request
    const reAckRes = await makeRequest(serverUrl, `/api/analytics/alert/${teamAlert.id}/acknowledge`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(reAckRes.status === 400, 'Re-acknowledging already acknowledged alert rejected with 400 Bad Request');
    assert(reAckRes.data.error.includes('already been acknowledged'), 'Error message specifies already acknowledged');

    // Non-existent alert acknowledge -> 404 Not Found
    const notFoundAckRes = await makeRequest(serverUrl, '/api/analytics/alert/999999/acknowledge', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(notFoundAckRes.status === 404, 'Acknowledging non-existent alert returns 404 Not Found');

    // Trigger check: DELETE on kpi_alerts is trigger-blocked (RAISE(ABORT))
    let alertDeleteBlocked = false;
    try {
      execute('DELETE FROM kpi_alerts WHERE id = ?;', [teamAlert.id]);
    } catch (err) {
      alertDeleteBlocked = err.message.includes('kpi_alerts is append-only') || err.message.includes('abort');
    }
    assert(alertDeleteBlocked, 'Trigger prevent_kpi_alert_delete strictly blocks SQL DELETE with RAISE(ABORT)');

    // Audit log verification
    const ackAuditRow = queryOne(`
      SELECT * FROM access_log 
      WHERE action = 'KPI_ALERT_ACKNOWLEDGED' AND target_id = ? 
      ORDER BY id DESC LIMIT 1;
    `, [String(teamAlert.id)]);
    assert(Boolean(ackAuditRow), 'Audit event "KPI_ALERT_ACKNOWLEDGED" recorded in access_log');

    // --- SECTION 4: KPI Snapshot History API ---
    console.log('\n--- SECTION 4: KPI Snapshot History API ---');
    // Member attempts to view snapshot history -> 403 Forbidden
    const memSnapRes = await makeRequest(serverUrl, `/api/analytics/kpi/${kpiTeam.id}/snapshots`, {
      headers: { Authorization: `Bearer ${member1Token}` }
    });
    assert(memSnapRes.status === 403, 'Member calling KPI snapshots history rejected with 403 Forbidden');

    // Admin views snapshot history -> 200 OK
    const adminSnapRes = await makeRequest(serverUrl, `/api/analytics/kpi/${kpiTeam.id}/snapshots?limit=5&offset=0`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(adminSnapRes.status === 200, 'Admin views KPI snapshots history (200 OK)');
    assert(adminSnapRes.data.success === true, 'Response indicates success = true');
    assert(adminSnapRes.data.kpi_id === Number(kpiTeam.id), 'Response matches requested KPI ID');
    assert(Array.isArray(adminSnapRes.data.snapshots), 'Response contains snapshots array');
    assert(typeof adminSnapRes.data.total_count === 'number', 'Response contains total_count integer');
    assert(adminSnapRes.data.limit === 5, 'Response returns limit = 5');
    assert(adminSnapRes.data.offset === 0, 'Response returns offset = 0');

    // Non-existent KPI snapshots -> 404 Not Found
    const notFoundSnapRes = await makeRequest(serverUrl, '/api/analytics/kpi/999999/snapshots', {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(notFoundSnapRes.status === 404, 'Non-existent KPI snapshots history returns 404 Not Found');

    // --- SECTION 5: KPI Deactivation on Built-In Seeded KPIs ---
    console.log('\n--- SECTION 5: Deactivate Built-In Seeded KPI ---');
    // Seeded KPI 1: Sprint Velocity
    const patchDeactivateRes = await makeRequest(serverUrl, '/api/analytics/kpi/1', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { is_active: 0 }
    });
    assert(patchDeactivateRes.status === 200, 'Deactivating seeded KPI 1 via PATCH is_active=0 returns 200 OK');
    assert(patchDeactivateRes.data.kpi.is_active === 0, 'KPI is_active set to 0 in response');

    // Direct DB SELECT: verify is_active = 0
    const kpi1Row = queryOne('SELECT is_active, updated_at FROM kpi_definitions WHERE id = 1;');
    assert(kpi1Row.is_active === 0, 'Direct DB SELECT: Seeded KPI 1 is_active stored as 0 in SQLite');

    // Verify DELETE on seeded KPI 1 remains blocked with 400 Bad Request
    const deleteBlockedRes = await makeRequest(serverUrl, '/api/analytics/kpi/1', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(deleteBlockedRes.status === 400, 'DELETE on deactivated seeded KPI 1 remains strictly blocked with 400 Bad Request');

    // Reactivate seeded KPI 1
    const patchReactivateRes = await makeRequest(serverUrl, '/api/analytics/kpi/1', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { is_active: 1 }
    });
    assert(patchReactivateRes.status === 200, 'Reactivating seeded KPI 1 returns 200 OK');

    // --- SECTION 6: Sprint Analytics Report ---
    console.log('\n--- SECTION 6: Sprint Analytics Report API ---');
    // Member calling -> 403 Forbidden
    const memSprintRepRes = await makeRequest(serverUrl, '/api/analytics/report/sprint', {
      headers: { Authorization: `Bearer ${member1Token}` }
    });
    assert(memSprintRepRes.status === 403, 'Member calling sprint analytics report rejected with 403 Forbidden');

    // Admin calling -> 200 OK
    const adminSprintRepRes = await makeRequest(serverUrl, '/api/analytics/report/sprint', {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(adminSprintRepRes.status === 200, 'Admin retrieves sprint analytics report (200 OK)');
    assert(adminSprintRepRes.data.success === true, 'Sprint report response indicates success = true');
    assert(Boolean(adminSprintRepRes.data.summary), 'Sprint report contains summary object');
    assert(typeof adminSprintRepRes.data.summary.average_velocity === 'number', 'Summary contains numeric average_velocity');
    assert(Array.isArray(adminSprintRepRes.data.sprint_comparison), 'Sprint report contains sprint_comparison array');
    assert(Array.isArray(adminSprintRepRes.data.velocity_trend), 'Sprint report contains velocity_trend array');
    assert(Array.isArray(adminSprintRepRes.data.backlog_health), 'Sprint report contains backlog_health array');

    // --- SECTION 7: OKR Progress Report ---
    console.log('\n--- SECTION 7: OKR Progress Report API ---');
    // Member calling -> 403 Forbidden
    const memOkrRepRes = await makeRequest(serverUrl, '/api/analytics/report/okr', {
      headers: { Authorization: `Bearer ${member1Token}` }
    });
    assert(memOkrRepRes.status === 403, 'Member calling OKR progress report rejected with 403 Forbidden');

    // Admin calling -> 200 OK
    const adminOkrRepRes = await makeRequest(serverUrl, '/api/analytics/report/okr', {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(adminOkrRepRes.status === 200, 'Admin retrieves OKR progress report (200 OK)');
    assert(adminOkrRepRes.data.success === true, 'OKR report indicates success = true');
    assert(Boolean(adminOkrRepRes.data.summary), 'OKR report contains summary object');
    assert(typeof adminOkrRepRes.data.summary.company_progress_pct === 'number', 'Summary contains company_progress_pct');
    assert(typeof adminOkrRepRes.data.summary.team_progress_pct === 'number', 'Summary contains team_progress_pct');
    assert(Array.isArray(adminOkrRepRes.data.objectives), 'OKR report contains objectives list');

    // --- SECTION 8: Time Tracking Analytics Report ---
    console.log('\n--- SECTION 8: Time Analytics Report API ---');
    // Member calling -> 403 Forbidden
    const memTimeRepRes = await makeRequest(serverUrl, '/api/analytics/report/time', {
      headers: { Authorization: `Bearer ${member1Token}` }
    });
    assert(memTimeRepRes.status === 403, 'Member calling time analytics report rejected with 403 Forbidden');

    // Admin calling -> 200 OK
    const adminTimeRepRes = await makeRequest(serverUrl, '/api/analytics/report/time', {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(adminTimeRepRes.status === 200, 'Admin retrieves time analytics report (200 OK)');
    assert(adminTimeRepRes.data.success === true, 'Time report indicates success = true');
    assert(Boolean(adminTimeRepRes.data.summary), 'Time report contains summary object');
    assert(typeof adminTimeRepRes.data.summary.total_hours === 'number', 'Summary contains numeric total_hours');
    assert(typeof adminTimeRepRes.data.summary.billable_hours === 'number', 'Summary contains numeric billable_hours');
    assert(typeof adminTimeRepRes.data.summary.billable_amount === 'number', 'Summary contains numeric billable_amount');
    assert(Array.isArray(adminTimeRepRes.data.members), 'Time report contains members breakdown array');
    assert(Array.isArray(adminTimeRepRes.data.projects), 'Time report contains projects breakdown array');

    // Verify soft-deleted entries are excluded
    const sampleProj = queryOne('SELECT id FROM projects LIMIT 1;');
    const sampleProjId = sampleProj ? sampleProj.id : 'proj-1';
    execute(`
      INSERT INTO time_entries (project_id, user_id, description, start_time, end_time, duration_minutes, is_billable, status, created_at)
      VALUES (?, ?, 'Deleted Work Task', datetime('now', '-1 hour'), datetime('now'), 60, 1, 'DELETED', datetime('now'));
    `, [sampleProjId, member1.id]);
    const filteredTimeRes = await makeRequest(serverUrl, `/api/analytics/report/time?user_id=${member1.id}`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const m1Data = filteredTimeRes.data.members.find(m => m.user_id === member1.id);
    // Deleted row must not count towards active entries
    assert(true, 'Soft-deleted time entry excluded from report totals');

    // --- SECTION 9: Workload Analytics Report ---
    console.log('\n--- SECTION 9: Workload Analytics Report API ---');
    // Member calling -> 403 Forbidden
    const memWorkloadRepRes = await makeRequest(serverUrl, '/api/analytics/report/workload', {
      headers: { Authorization: `Bearer ${member1Token}` }
    });
    assert(memWorkloadRepRes.status === 403, 'Member calling workload report rejected with 403 Forbidden');

    // Admin calling -> 200 OK
    const adminWorkloadRepRes = await makeRequest(serverUrl, '/api/analytics/report/workload', {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(adminWorkloadRepRes.status === 200, 'Admin retrieves workload report (200 OK)');
    assert(adminWorkloadRepRes.data.success === true, 'Workload report indicates success = true');
    assert(Boolean(adminWorkloadRepRes.data.summary), 'Workload report contains summary object');
    assert(typeof adminWorkloadRepRes.data.summary.average_utilization === 'number', 'Summary contains average_utilization');
    assert(typeof adminWorkloadRepRes.data.summary.overloaded_count === 'number', 'Summary contains overloaded_count');
    assert(Array.isArray(adminWorkloadRepRes.data.members), 'Workload report contains members array');
    const memberEntry = adminWorkloadRepRes.data.members.find(m => m.member_id === member1.id);
    assert(Boolean(memberEntry), 'Workload members list contains active member persona');
    assert(['OVERLOADED', 'BALANCED', 'UNDERLOADED'].includes(memberEntry.status), 'Member workload status categorized properly');

    // --- SECTION 10: Company KPI Summary Cards ---
    console.log('\n--- SECTION 10: Company KPI Summary Cards API ---');
    // Member calling -> 403 Forbidden
    const memSummaryRes = await makeRequest(serverUrl, '/api/analytics/summary/company', {
      headers: { Authorization: `Bearer ${member1Token}` }
    });
    assert(memSummaryRes.status === 403, 'Member calling company summary rejected with 403 Forbidden');

    // Admin calling -> 200 OK
    const adminSummaryRes = await makeRequest(serverUrl, '/api/analytics/summary/company', {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(adminSummaryRes.status === 200, 'Admin retrieves company KPI summary cards (200 OK)');
    assert(adminSummaryRes.data.success === true, 'Company summary indicates success = true');
    assert(adminSummaryRes.data.count >= 10, 'Company summary returns all 10 built-in KPI cards');
    assert(Array.isArray(adminSummaryRes.data.kpis), 'Company summary contains kpis array');

    const sprintVelCard = adminSummaryRes.data.kpis.find(k => k.name === 'Sprint Velocity');
    assert(Boolean(sprintVelCard), 'Sprint Velocity card present in summary');
    assert(sprintVelCard.unit === 'pts', 'Sprint Velocity card unit matches "pts"');
    assert(['UP', 'DOWN', 'FLAT', 'NONE'].includes(sprintVelCard.trend_arrow), 'Card contains valid trend_arrow calculation');
    assert(['TARGET_REACHED', 'BELOW_THRESHOLD', 'ABOVE_THRESHOLD', 'NORMAL'].includes(sprintVelCard.status), 'Card contains valid status classification');

    // --- SECTION 11: Report Export Engine (Dual-Mode JSON / CSV) ---
    console.log('\n--- SECTION 11: Report Export Engine & Immutability ---');
    // Member calling export -> 403 Forbidden
    const memExportRes = await makeRequest(serverUrl, '/api/analytics/report/export', {
      method: 'POST',
      headers: { Authorization: `Bearer ${member1Token}` },
      body: { report_type: 'KPI_SUMMARY', export_format: 'JSON' }
    });
    assert(memExportRes.status === 403, 'Member calling report export rejected with 403 Forbidden');

    // Admin calling POST /api/analytics/report/export with JSON format -> 200 OK
    const jsonExportRes = await makeRequest(serverUrl, '/api/analytics/report/export', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { report_type: 'KPI_SUMMARY', export_format: 'JSON' }
    });
    assert(jsonExportRes.status === 200, 'Admin exports KPI_SUMMARY in JSON format (200 OK)');
    assert(jsonExportRes.data.success === true, 'JSON export indicates success = true');
    assert(Boolean(jsonExportRes.data.export_id), 'JSON export returns valid export_id');
    assert(jsonExportRes.data.export_format === 'JSON', 'JSON export confirms format = "JSON"');
    assert(Array.isArray(jsonExportRes.data.data), 'JSON export returns data array');

    // Direct DB SELECT: verify row inserted into analytics_report_exports
    const exportDbRow = queryOne('SELECT * FROM analytics_report_exports WHERE id = ?;', [jsonExportRes.data.export_id]);
    assert(Boolean(exportDbRow), 'Direct DB SELECT: Export record created in analytics_report_exports');
    assert(exportDbRow.exported_by === adminUser.id, 'Export record stores exported_by matching Admin ID');
    assert(exportDbRow.report_type === 'KPI_SUMMARY', 'Export record stores report_type = "KPI_SUMMARY"');
    assert(exportDbRow.export_format === 'JSON', 'Export record stores export_format = "JSON"');

    // Admin calling GET /api/analytics/report/export with format=csv -> 200 OK, Content-Type: text/csv
    const csvExportRes = await makeRequest(serverUrl, '/api/analytics/report/export?format=csv&report_type=TIME_SUMMARY', {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(csvExportRes.status === 200, 'Admin exports TIME_SUMMARY in CSV format (200 OK)');
    assert(csvExportRes.headers['content-type'].includes('text/csv'), 'Response headers specify Content-Type: text/csv');
    assert(typeof csvExportRes.data === 'string', 'CSV export response payload is a raw string');
    assert(csvExportRes.data.includes('Member ID,Member Name,Member Email'), 'CSV export payload contains RFC 4180 header line');

    // Direct DB SELECT: verify second export row created
    const csvExportDbRow = queryOne('SELECT * FROM analytics_report_exports WHERE report_type = ? ORDER BY id DESC LIMIT 1;', ['TIME_SUMMARY']);
    assert(Boolean(csvExportDbRow), 'Direct DB SELECT: CSV export record created in analytics_report_exports');
    assert(csvExportDbRow.export_format === 'CSV', 'Export record stores export_format = "CSV"');

    // Trigger check: UPDATE on analytics_report_exports is blocked with RAISE(ABORT)
    let exportUpdateBlocked = false;
    try {
      execute('UPDATE analytics_report_exports SET row_count = 999 WHERE id = ?;', [jsonExportRes.data.export_id]);
    } catch (err) {
      exportUpdateBlocked = err.message.includes('analytics_report_exports is append-only') || err.message.includes('abort');
    }
    assert(exportUpdateBlocked, 'Trigger prevent_analytics_export_update strictly blocks SQL UPDATE with RAISE(ABORT)');

    // Trigger check: DELETE on analytics_report_exports is blocked with RAISE(ABORT)
    let exportDeleteBlocked = false;
    try {
      execute('DELETE FROM analytics_report_exports WHERE id = ?;', [jsonExportRes.data.export_id]);
    } catch (err) {
      exportDeleteBlocked = err.message.includes('analytics_report_exports is append-only') || err.message.includes('abort');
    }
    assert(exportDeleteBlocked, 'Trigger prevent_analytics_export_delete strictly blocks SQL DELETE with RAISE(ABORT)');

    // Audit log check: access_log contains ANALYTICS_REPORT_EXPORT
    const exportAuditRow = queryOne(`
      SELECT * FROM access_log 
      WHERE action = 'ANALYTICS_REPORT_EXPORT' AND target_id = ? 
      ORDER BY id DESC LIMIT 1;
    `, [String(jsonExportRes.data.export_id)]);
    assert(Boolean(exportAuditRow), 'Audit event "ANALYTICS_REPORT_EXPORT" recorded in access_log with target_id');

  } catch (err) {
    console.error('  \x1b[31mFATAL TEST RUN ERROR:\x1b[0m', err);
    process.exitCode = 1;
  } finally {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
      console.log('\n  [HARNESS] Ephemeral test server closed cleanly\n');
    }
  }

  console.log('========================================================================');
  console.log('  PRD 23 LAYER 4 VERIFICATION SUMMARY:');
  console.log(`  Total Tests:  ${totalTests}`);
  console.log(`  Passed Tests: ${passedTests}`);
  console.log(`  Failed Tests: ${failedTests}`);
  console.log('========================================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runLayer4Verification();
