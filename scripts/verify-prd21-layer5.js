/**
 * PRD 21 Layer 5: Frontend Verification Suite (Resource Workload Dashboard)
 * Tests all 4 HTML frontend views:
 *  1. public/workload-dashboard.html (Team Workload Dashboard)
 *  2. public/workload-heatmap.html (Workload Heatmap Grid)
 *  3. public/my-workload.html (My Workload Member View)
 *  4. public/capacity-planning.html (Capacity Planning & Governance)
 *
 * Verifies:
 *  - File presence & substantial size (> 1KB)
 *  - Zero hardcoded credentials (no secrets, passwords, or hardcoded JWTs)
 *  - XSS Protection: escapeHTML implemented and utilized in all views
 *  - Authentication: localStorage.getItem('token') auth flow
 *  - Key functional DOM elements and UX components
 *  - Live HTTP serving: 200 OK with text/html content-type from running dev server
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.join(__dirname, '..');
const publicDir = path.join(projectRoot, 'public');

const SERVER_BASE = process.env.TEST_SERVER_URL || 'http://localhost:4000';

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(condition, testName, details = '') {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  [PASS] Test ${totalTests}: ${testName}`);
  } else {
    failedTests++;
    console.error(`  [FAIL] Test ${totalTests}: ${testName} - ${details}`);
  }
}

async function runLayer5Verification() {
  console.log('===================================================================');
  console.log('  STARTING PRD 21 LAYER 5: FRONTEND VIEWS VERIFICATION SUITE');
  console.log('===================================================================');

  const views = [
    {
      fileName: 'workload-dashboard.html',
      title: 'Team Workload Dashboard',
      requiredElements: [
        'projectSelect',
        'currentWeekLabel',
        'btnPrevWeek',
        'btnNextWeek',
        'statTotalMembers',
        'statOverloaded',
        'statOptimal',
        'statNearCapacity',
        'statUnderloaded',
        'alertsSection',
        'memberTableBody',
        'rebalanceContainer',
        'reassignModal',
        'memberDetailModal',
        'btnTakeSnapshot'
      ],
      requiredTerms: [
        'escapeHTML',
        'localStorage.getItem',
        '/api/workload/team/',
        '/api/workload/alerts',
        '/api/workload/rebalance/',
        'util-bar-fill'
      ]
    },
    {
      fileName: 'workload-heatmap.html',
      title: 'Workload Heatmap Grid',
      requiredElements: [
        'projectSelect',
        'btnPrev4Weeks',
        'btnNext4Weeks',
        'btnToday',
        'startWeekPicker',
        'heatmapTable',
        'heatmapHeaderRow',
        'heatmapBody',
        'heatmapTooltip',
        'cellDetailModal',
        'btnExportJson'
      ],
      requiredTerms: [
        'escapeHTML',
        'localStorage.getItem',
        '/api/workload/heatmap/',
        '/api/workload/export/',
        'heat-cell',
        'heat-overloaded',
        'heat-optimal'
      ]
    },
    {
      fileName: 'my-workload.html',
      title: 'My Workload & Availability',
      requiredElements: [
        'userAvatar',
        'userName',
        'userWeeklyCapacity',
        'gaugePct',
        'gaugeStatusBadge',
        'gaugeProgressBar',
        'forecastGrid',
        'assignmentsTableBody',
        'availabilityTableBody',
        'availabilityModal',
        'btnMarkAvailabilityTop',
        'btnSubmitAvailability'
      ],
      requiredTerms: [
        'escapeHTML',
        'localStorage.getItem',
        '/api/workload/dashboard/member/',
        '/api/workload/assignments/',
        '/api/workload/availability/',
        'availability_type'
      ]
    },
    {
      fileName: 'capacity-planning.html',
      title: 'Capacity Planning & Governance',
      requiredElements: [
        'projectSelect',
        'tabCapacity',
        'tabAvailability',
        'tabSnapshots',
        'tabAlerts',
        'capacityTableBody',
        'availabilityAdminTableBody',
        'snapshotTableBody',
        'alertAuditTableBody',
        'capacityModal',
        'adminAvailModal',
        'snapshotDetailModal',
        'btnTakeSnapshot',
        'btnSubmitCapacity'
      ],
      requiredTerms: [
        'escapeHTML',
        'localStorage.getItem',
        '/api/workload/capacity/set',
        '/api/workload/availability/',
        '/api/workload/snapshots/',
        'append-only',
        'snapshot_data'
      ]
    }
  ];

  console.log('\n--- SECTION 1: File Existence, Structure & Non-Negotiable Standards ---');

  for (const view of views) {
    const filePath = path.join(publicDir, view.fileName);
    const exists = fs.existsSync(filePath);
    assert(exists, `${view.fileName} exists in public/ directory`);

    if (exists) {
      const stats = fs.statSync(filePath);
      const content = fs.readFileSync(filePath, 'utf-8');

      // Size check (> 1KB)
      assert(
        stats.size > 1024,
        `${view.fileName} is substantial and complete (${(stats.size / 1024).toFixed(1)} KB)`
      );

      // Security: Zero hardcoded credentials
      const hasHardcodedSecret = /password\s*[:=]\s*['"][^'"]+['"]/i.test(content) ||
                                 /bearer\s+eyJ/i.test(content) ||
                                 /secret\s*[:=]\s*['"][^'"]+['"]/i.test(content);
      assert(
        !hasHardcodedSecret,
        `${view.fileName} has ZERO hardcoded credentials or passwords`
      );

      // Security: Mandatory escapeHTML implementation
      const hasEscapeHTML = content.includes('function escapeHTML(') || content.includes('escapeHTML =');
      assert(
        hasEscapeHTML,
        `${view.fileName} implements escapeHTML XSS sanitization`
      );

      // Auth: localStorage token usage
      const hasLocalStorageAuth = content.includes("localStorage.getItem('token')") ||
                                  content.includes('localStorage.getItem("token")');
      assert(
        hasLocalStorageAuth,
        `${view.fileName} authenticates via localStorage token`
      );

      // Required UI elements
      for (const elId of view.requiredElements) {
        const hasElement = content.includes(`id="${elId}"`) || content.includes(`id='${elId}'`);
        assert(
          hasElement,
          `${view.fileName} contains expected UI component id="${elId}"`
        );
      }

      // Required technical terms & routes
      for (const term of view.requiredTerms) {
        const hasTerm = content.includes(term);
        assert(
          hasTerm,
          `${view.fileName} references required pattern: "${term}"`
        );
      }
    }
  }

  console.log('\n--- SECTION 2: Live HTTP Serving from Backend Server ---');

  for (const view of views) {
    const url = `${SERVER_BASE}/${view.fileName}`;
    try {
      const res = await fetch(url);
      assert(
        res.status === 200,
        `GET /${view.fileName} returns HTTP 200 OK`,
        `Status was ${res.status}`
      );

      const contentType = res.headers.get('content-type') || '';
      assert(
        contentType.includes('text/html'),
        `GET /${view.fileName} returns text/html content-type`,
        `Content-Type was ${contentType}`
      );

      const htmlBody = await res.text();
      assert(
        htmlBody.includes(view.title) || htmlBody.includes('Mahi Tech Group'),
        `GET /${view.fileName} serves valid rendered HTML page with brand identity`
      );
    } catch (err) {
      assert(false, `GET /${view.fileName} failed to fetch from server: ${err.message}`);
    }
  }

  console.log('\n===================================================================');
  console.log('  PRD 21 LAYER 5 VERIFICATION SUMMARY:');
  console.log(`  Total Tests:  ${totalTests}`);
  console.log(`  Passed Tests: ${passedTests}`);
  console.log(`  Failed Tests: ${failedTests}`);
  console.log('===================================================================');

  if (failedTests > 0) {
    process.exitCode = 1;
  } else {
    process.exitCode = 0;
  }
}

runLayer5Verification().catch(err => {
  console.error('Unhandled fatal error in Layer 5 verification:', err);
  process.exit(1);
});
