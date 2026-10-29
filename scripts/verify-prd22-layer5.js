/**
 * PRD 22 Layer 5: Frontend Views Verification Suite (Time Tracking & Timesheet Management)
 * Tests all 4 HTML frontend views:
 *  1. public/my-time-tracker.html (My Time Tracker)
 *  2. public/team-time-report.html (Team Time Report)
 *  3. public/time-approval-queue.html (Time Approval Queue)
 *  4. public/billable-rates.html (Billable Rates Management)
 *
 * Verifies:
 *  - File presence in public/ directory & substantial size (> 1KB)
 *  - Zero hardcoded credentials (no secrets, passwords, or hardcoded JWT tokens)
 *  - XSS Protection: escapeHTML implemented and utilized in all views
 *  - Authentication: dynamic localStorage.getItem('token') auth flow
 *  - RBAC: server-side role verification via GET /api/users/me
 *  - Key functional DOM elements and UX components
 *  - Live HTTP serving: 200 OK with text/html content-type from ephemeral test server
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
    console.log(`  [PASS] Test ${totalTests}: ${testName}`);
  } else {
    failedTests++;
    console.error(`  [FAIL] Test ${totalTests}: ${testName} - ${details}`);
  }
}

async function runLayer5Verification() {
  console.log('===================================================================');
  console.log('  STARTING PRD 22 LAYER 5: FRONTEND VIEWS VERIFICATION SUITE');
  console.log('===================================================================');

  const views = [
    {
      fileName: 'my-time-tracker.html',
      title: 'My Time Tracker',
      requiredElements: [
        'timerWidget',
        'timerRunningSection',
        'timerIdleSection',
        'timerDisplay',
        'btnStopTimer',
        'startTimerForm',
        'timerProjectSelect',
        'timerTaskInput',
        'timerBillableCheck',
        'btnStartTimer',
        'todayEntriesSection',
        'todayEntriesTable',
        'todayEntriesTableBody',
        'todayTotalHrs',
        'todayBillableAmount',
        'weeklySummarySection',
        'weeklyChartWrap',
        'btnPrevWeek',
        'btnNextWeek',
        'manualEntryModal',
        'btnOpenManualModal',
        'manualEntryForm',
        'editEntryModal',
        'editEntryForm',
        'toastNotification'
      ],
      requiredTerms: [
        'escapeHTML',
        'localStorage.getItem',
        '/api/users/me',
        '/api/time/timer/status',
        '/api/time/timer/start',
        '/api/time/timer/stop',
        '/api/time/entries/my',
        '/api/time/report/my',
        '/api/time/entry/create',
        '/api/time/approval/request/'
      ]
    },
    {
      fileName: 'team-time-report.html',
      title: 'Team Time & Financial Report',
      requiredElements: [
        'accessDeniedBanner',
        'adminReportWorkspace',
        'reportFilterBar',
        'projectFilterSelect',
        'filterFromDate',
        'filterToDate',
        'btnApplyFilters',
        'btnExportCsv',
        'btnExportJson',
        'btnOpenSnapshotModal',
        'summaryCards',
        'metricTotalHrs',
        'metricBillableHrs',
        'metricNonBillableHrs',
        'metricBillableAmount',
        'metricTotalEntries',
        'teamReportTable',
        'teamReportTableBody',
        'teamReportTableFoot',
        'snapshotHistorySection',
        'snapshotTableBody',
        'takeSnapshotModal',
        'takeSnapshotForm',
        'memberDrilldownModal',
        'drilldownTableBody',
        'inspectSnapshotModal',
        'inspectSnapshotJson',
        'toastNotification'
      ],
      requiredTerms: [
        'escapeHTML',
        'localStorage.getItem',
        '/api/users/me',
        '/api/time/report/team',
        '/api/time/report/export/',
        '/api/time/report/snapshot',
        '/api/time/report/snapshots/',
        'snapshot_data'
      ]
    },
    {
      fileName: 'time-approval-queue.html',
      title: 'Time Approval Queue',
      requiredElements: [
        'accessDeniedBanner',
        'adminQueueWorkspace',
        'approvalTabs',
        'tabPending',
        'tabApproved',
        'tabRejected',
        'tabAll',
        'badgePendingCount',
        'filterQueueProject',
        'btnRefreshQueue',
        'pendingQueueTable',
        'queueTableBody',
        'rejectModal',
        'rejectForm',
        'rejectRequestId',
        'rejectReasonInput',
        'rejectCharCounter',
        'btnConfirmReject',
        'toastNotification'
      ],
      requiredTerms: [
        'escapeHTML',
        'localStorage.getItem',
        '/api/users/me',
        '/api/time/approval/pending',
        '/api/time/approval/',
        'approve',
        'reject',
        'decision_note'
      ]
    },
    {
      fileName: 'billable-rates.html',
      title: 'Billable Rates Management',
      requiredElements: [
        'accessDeniedBanner',
        'adminRatesWorkspace',
        'memberRatesSection',
        'memberRatesTable',
        'memberRatesTableBody',
        'btnOpenMemberRateModal',
        'projectOverridesSection',
        'projectOverridesTable',
        'projectOverridesTableBody',
        'btnOpenProjectOverrideModal',
        'rateHistorySection',
        'rateAccordionContainer',
        'rateModal',
        'rateForm',
        'rateUserSelect',
        'rateTypeSelect',
        'rateProjectSelect',
        'rateHourlyInput',
        'rateCurrencySelect',
        'rateEffectiveDate',
        'btnSubmitRate',
        'toastNotification'
      ],
      requiredTerms: [
        'escapeHTML',
        'localStorage.getItem',
        '/api/users/me',
        '/api/time/rate/set',
        '/api/time/rate/member/',
        'MEMBER_DEFAULT',
        'PROJECT_OVERRIDE'
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

      // Auth: Dynamic localStorage token usage
      const hasLocalStorageAuth = content.includes("localStorage.getItem('token')") ||
                                  content.includes('localStorage.getItem("token")');
      assert(
        hasLocalStorageAuth,
        `${view.fileName} authenticates via localStorage token`
      );

      // Auth: Server-side role verification via GET /api/users/me
      const hasMeEndpoint = content.includes('/api/users/me');
      assert(
        hasMeEndpoint,
        `${view.fileName} performs server-side role verification via GET /api/users/me`
      );

      // Verify DOM Elements
      for (const elId of view.requiredElements) {
        const hasEl = content.includes(`id="${elId}"`) || content.includes(`id='${elId}'`);
        assert(hasEl, `${view.fileName} contains required DOM element #${elId}`);
      }

      // Verify Key Terms & API patterns
      for (const term of view.requiredTerms) {
        const hasTerm = content.includes(term);
        assert(hasTerm, `${view.fileName} references required pattern: "${term}"`);
      }
    }
  }

  console.log('\n--- SECTION 2: Live HTTP Serving from Express Server ---');

  const app = createApp();
  const server = http.createServer(app);

  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve();
    });
  });

  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  console.log(`  [INFO] Ephemeral server running at ${baseUrl}`);

  try {
    for (const view of views) {
      const url = `${baseUrl}/${view.fileName}`;
      const res = await fetch(url);

      assert(res.status === 200, `GET /${view.fileName} returns HTTP 200 OK`);

      const contentType = res.headers.get('content-type') || '';
      assert(
        contentType.includes('text/html'),
        `GET /${view.fileName} returns Content-Type text/html (${contentType})`
      );

      const htmlText = await res.text();
      assert(
        htmlText.includes(view.title) || htmlText.includes('MAHI TIME'),
        `GET /${view.fileName} returns valid HTML document body`
      );
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
    console.log('  [INFO] Ephemeral test server closed cleanly');
  }

  console.log('\n===================================================================');
  console.log(`  PRD 22 LAYER 5 VERIFICATION COMPLETE`);
  console.log(`  TOTAL TESTS: ${totalTests} | PASSED: ${passedTests} | FAILED: ${failedTests}`);
  console.log(`  PASS RATE: ${((passedTests / totalTests) * 100).toFixed(1)}%`);
  console.log('===================================================================');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runLayer5Verification().catch((err) => {
  console.error('Fatal test error in PRD 22 Layer 5:', err);
  process.exit(1);
});
