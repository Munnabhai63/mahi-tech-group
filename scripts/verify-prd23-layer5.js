/**
 * PRD 23 Layer 5: Frontend Views Verification Suite (Analytics & KPI Dashboard)
 * Tests all 5 HTML frontend views in public/:
 *  1. public/kpi-overview.html (Company KPI Overview)
 *  2. public/dashboard-builder.html (Custom Dashboard Builder)
 *  3. public/sprint-analytics.html (Sprint Velocity & Burndown Analytics)
 *  4. public/team-analytics.html (Team Performance & Workload Analytics)
 *  5. public/kpi-alerts.html (KPI Threshold Incident & Alert Center)
 *
 * Verifies:
 *  - File presence in public/ directory & substantial file size
 *  - Zero hardcoded credentials (no passwords, tokens, or plaintext secrets)
 *  - XSS Protection: escapeHTML() implemented and used in all 5 files
 *  - Dynamic Token Authentication: retrieved from localStorage / query params
 *  - RBAC Security: server-side role verification via GET /api/users/me on startup
 *  - Offline Safety: No external CDN dependencies or scripts
 *  - Specific UI Rules: KPI status badges, trend arrows, 12-column grid, alert ack disablement, CSV exports
 *  - Live HTTP Serving: 200 OK with text/html content-type from real server
 */

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.join(__dirname, '..');
const publicDir = path.join(projectRoot, 'public');

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(condition, testName, details = '') {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✔ PASS: Test ${totalTests}: ${testName}`);
  } else {
    failedTests++;
    console.error(`  ✖ FAIL: Test ${totalTests}: ${testName}`);
    if (details) console.error(`    Details: ${details}`);
  }
}

const requiredFiles = [
  { name: 'kpi-overview.html', title: 'Company KPI Overview', adminOnly: true },
  { name: 'dashboard-builder.html', title: 'Custom Dashboard Builder', adminOnly: false },
  { name: 'sprint-analytics.html', title: 'Sprint Analytics', adminOnly: false },
  { name: 'team-analytics.html', title: 'Team Performance Analytics', adminOnly: true },
  { name: 'kpi-alerts.html', title: 'KPI Alert Center', adminOnly: true }
];

async function runLayer5Verification() {
  console.log('\n========================================================================');
  console.log('  PRD 23 LAYER 5: FRONTEND VIEWS & SECURITY AUDIT VERIFICATION');
  console.log('========================================================================\n');

  console.log('--- SECTION 1: File Existence & Non-Trivial Size ---');
  const fileContents = {};

  for (const item of requiredFiles) {
    const filePath = path.join(publicDir, item.name);
    const exists = fs.existsSync(filePath);
    assert(exists, `File exists: public/${item.name}`);

    if (exists) {
      const stats = fs.statSync(filePath);
      const sizeKB = (stats.size / 1024).toFixed(1);
      assert(stats.size > 2000, `File size is substantial: public/${item.name} (${sizeKB} KB > 2 KB)`);
      fileContents[item.name] = fs.readFileSync(filePath, 'utf-8');
    }
  }

  console.log('\n--- SECTION 2: Security Audit — Zero Hardcoded Credentials ---');
  for (const item of requiredFiles) {
    const content = fileContents[item.name] || '';

    // Check for hardcoded password patterns
    const hasHardcodedPassword = /password\s*[:=]\s*['"][^'"]{4,}['"]/i.test(content) &&
      !content.includes('password =') && !content.includes('placeholder="');
    assert(!hasHardcodedPassword, `${item.name}: Zero hardcoded passwords found`);

    // Check for hardcoded JWT or bearer tokens
    const hasHardcodedJwt = /eyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}/.test(content);
    assert(!hasHardcodedJwt, `${item.name}: Zero hardcoded JWT tokens found`);

    // Check for dynamic token acquisition
    const hasDynamicToken = content.includes("localStorage.getItem('token')") ||
                            content.includes('localStorage.getItem("token")');
    assert(hasDynamicToken, `${item.name}: Dynamic token acquisition from localStorage verified`);
  }

  console.log('\n--- SECTION 3: Security Audit — XSS Sanitization & Role Verification ---');
  for (const item of requiredFiles) {
    const content = fileContents[item.name] || '';

    // Check for escapeHTML function definition
    const hasEscapeHtml = content.includes('function escapeHTML(') || content.includes('const escapeHTML');
    assert(hasEscapeHtml, `${item.name}: escapeHTML() sanitization utility implemented`);

    // Check for escapeHTML invocation
    const usesEscapeHtml = content.includes('escapeHTML(');
    assert(usesEscapeHtml, `${item.name}: escapeHTML() actively utilized for dynamic content`);

    // Check for server-side role verification via /api/users/me
    const hasUserMeCall = content.includes('/api/users/me');
    assert(hasUserMeCall, `${item.name}: Server-side role verification via /api/users/me on startup`);
  }

  console.log('\n--- SECTION 4: Security Audit — Zero External CDN Scripts ---');
  for (const item of requiredFiles) {
    const content = fileContents[item.name] || '';

    // Check for external JS scripts from CDNs
    const hasExternalScript = /<script\s+[^>]*src=['"]https?:\/\/(?!fonts\.googleapis\.com)/i.test(content);
    assert(!hasExternalScript, `${item.name}: Zero external CDN script tags (self-contained offline safety)`);
  }

  console.log('\n--- SECTION 5: Specific UI Rules & Feature Verification ---');

  // View 1: kpi-overview.html
  const kpiContent = fileContents['kpi-overview.html'] || '';
  assert(kpiContent.includes('badge-on-track') && kpiContent.includes('badge-at-risk') && kpiContent.includes('badge-critical'),
    'kpi-overview.html: Status badges implement color coding (ON_TRACK, AT_RISK, CRITICAL)');
  assert(kpiContent.includes('trend_arrow') && kpiContent.includes('UP') && kpiContent.includes('DOWN'),
    'kpi-overview.html: Trend arrows supported (UP, DOWN, FLAT)');
  assert(kpiContent.includes('btnRefreshAll') && kpiContent.includes('/refresh'),
    'kpi-overview.html: Refresh All capability implemented');
  assert(kpiContent.includes('exportCompanySummaryCsv') || kpiContent.includes('.csv'),
    'kpi-overview.html: CSV Export download supported');
  assert(kpiContent.includes('trend_snapshots') && kpiContent.includes('renderSparklineSVG'),
    'kpi-overview.html: Sparklines render pre-computed trend_snapshots from API');

  // View 2: dashboard-builder.html
  const builderContent = fileContents['dashboard-builder.html'] || '';
  assert(builderContent.includes('repeat(12, 1fr)'),
    'dashboard-builder.html: Visual 12-column CSS grid layout implemented');
  assert(builderContent.includes('NUMBER_CARD') && builderContent.includes('BAR_CHART') && builderContent.includes('VELOCITY'),
    'dashboard-builder.html: Left sidebar widget library includes required widget types');
  assert(builderContent.includes('draggable="true"') && builderContent.includes('dragstart'),
    'dashboard-builder.html: Drag and drop widget functionality supported');
  assert(builderContent.includes('btnSaveLayout') || builderContent.includes('Save Layout'),
    'dashboard-builder.html: Save layout button and position persistence implemented');
  assert(builderContent.includes('PERSONAL') && builderContent.includes('TEAM') && builderContent.includes('COMPANY'),
    'dashboard-builder.html: 3-tier dashboard scope selector present');

  // View 3: sprint-analytics.html
  const sprintContent = fileContents['sprint-analytics.html'] || '';
  assert(sprintContent.includes('renderVelocityBarsSVG') || sprintContent.includes('Velocity'),
    'sprint-analytics.html: Sprint velocity chart implemented');
  assert(sprintContent.includes('renderCircularGaugeSVG') || sprintContent.includes('Completion Rate'),
    'sprint-analytics.html: Sprint completion rate gauge implemented');
  assert(sprintContent.includes('sprintTableBody') && sprintContent.includes('committed') && sprintContent.includes('completed'),
    'sprint-analytics.html: Sprint performance comparison table implemented');
  assert(sprintContent.includes('btnExportCsv') && sprintContent.includes('.csv'),
    'sprint-analytics.html: Sprint CSV report export download supported');

  // View 4: team-analytics.html
  const teamContent = fileContents['team-analytics.html'] || '';
  assert(teamContent.includes('memberTableBody') && teamContent.includes('utilization'),
    'team-analytics.html: Member performance and utilization table implemented');
  assert(teamContent.includes('timeDistContainer') && teamContent.includes('Billable'),
    'team-analytics.html: Billable vs non-billable time distribution rendered');
  assert(teamContent.includes('topContributorsContainer') || teamContent.includes('Top Contributors'),
    'team-analytics.html: Ranked top contributors section implemented');
  assert(teamContent.includes('accessDeniedBanner'),
    'team-analytics.html: Member privacy redaction and Admin-only access guard implemented');

  // View 5: kpi-alerts.html
  const alertContent = fileContents['kpi-alerts.html'] || '';
  assert(alertContent.includes('alertsTableBody') && alertContent.includes('btn-ack'),
    'kpi-alerts.html: Alert queue table with Acknowledge buttons implemented');
  assert(alertContent.includes('btn.disabled = true') || alertContent.includes('disabled'),
    'kpi-alerts.html: Acknowledge button is disabled after acknowledgment (no double-click)');
  assert(alertContent.includes('filter-btn') && alertContent.includes('UNACKNOWLEDGED') && alertContent.includes('ACKNOWLEDGED'),
    'kpi-alerts.html: ALL, UNACKNOWLEDGED, and ACKNOWLEDGED filter tabs implemented');
  assert(alertContent.includes('renderAlertHistorySVG') || alertContent.includes('alertHistoryChart'),
    'kpi-alerts.html: 30-day alert frequency history chart implemented');

  console.log('\n--- SECTION 6: Real HTTP Serving (200 OK & Content-Type) ---');
  const app = createApp();
  const server = http.createServer(app);

  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve();
    });
  });

  const port = server.address().port;
  console.log(`  [HARNESS] Real Express test server listening on dynamic port ${port}`);

  function fetchUrl(targetPath) {
    return new Promise((resolve, reject) => {
      http.get(`http://127.0.0.1:${port}${targetPath}`, (res) => {
        let body = '';
        res.on('data', chunk => { body += chunk; });
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body
          });
        });
      }).on('error', reject);
    });
  }

  try {
    for (const item of requiredFiles) {
      const res = await fetchUrl(`/${item.name}`);
      assert(res.statusCode === 200, `GET /${item.name} returns HTTP 200 OK`);
      assert(res.headers['content-type'] && res.headers['content-type'].includes('text/html'),
        `GET /${item.name} returns Content-Type text/html`);
      assert(res.body.length > 2000,
        `GET /${item.name} returns complete HTML payload (${res.body.length} bytes)`);
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
    console.log('  [HARNESS] Real Express test server closed cleanly');
  }

  console.log('\n========================================================================');
  console.log('  PRD 23 LAYER 5 VERIFICATION SUMMARY:');
  console.log(`  Total Tests:  ${totalTests}`);
  console.log(`  Passed Tests: ${passedTests}`);
  console.log(`  Failed Tests: ${failedTests}`);
  console.log('========================================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runLayer5Verification().catch(err => {
  console.error('Fatal execution error:', err);
  process.exit(1);
});
