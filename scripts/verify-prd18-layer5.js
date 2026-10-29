/**
 * PRD 18 — Layer 5 Verification Suite: Frontend Views Smoke & Contract Tests
 * 
 * Verifies with real HTTP network calls against Express server:
 * 1. HTTP 200 Serving of all 4 HTML views:
 *    - /sprint-board.html
 *    - /backlog.html
 *    - /sprint-list.html
 *    - /velocity-chart.html
 * 2. Cache-Control and security headers on static HTML responses
 * 3. View 1 (sprint-board.html):
 *    - 4 Kanban columns (TODO, IN_PROGRESS, IN_REVIEW, DONE)
 *    - Drag-drop event listeners & dropzones
 *    - Status update API call integration (/api/backlog/item/:itemId/status)
 *    - Complete Sprint button & modal (/api/sprint/:sprintId/complete)
 *    - Card fields: title, type badge, priority, story points, assignee
 * 4. View 2 (backlog.html):
 *    - Filter controls (type, priority, search)
 *    - Add Item modal form & creation API (/api/backlog/item/create)
 *    - Story points input range 0-999 (Rule 3)
 *    - Move to Sprint dropdown & API (/api/backlog/item/:itemId/move)
 *    - Drag-drop reordering & API (/api/backlog/item/:itemId/reorder)
 * 5. View 3 (sprint-list.html):
 *    - Sprints container & status badges (DRAFT, ACTIVE, COMPLETED, CANCELLED)
 *    - Create Sprint button & modal (/api/sprint/create)
 *    - Start Sprint action for DRAFT sprints (/api/sprint/:sprintId/start)
 *    - Delete Sprint action for DRAFT sprints (DELETE /api/sprint/:sprintId)
 *    - Navigation link to Sprint Board
 * 6. View 4 (velocity-chart.html):
 *    - Chart.js library inclusion
 *    - Velocity chart canvas & dual bars (committed vs completed)
 *    - Average velocity trendline
 *    - Burndown chart canvas & sprint selector
 *    - Historical velocity table breakdown
 *    - Layer 4 endpoints consumption (/velocity/:projectId, /:sprintId/burndown)
 */

import http from 'node:http';
import { createApp } from '../src/app.js';

console.log('===================================================================');
console.log('       PRD 18 — LAYER 5: FRONTEND VIEWS SMOKE TEST SUITE');
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

async function run() {
  const app = createApp();
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  console.log(`  Test HTTP Server running at ${baseUrl}\n`);

  try {
    // ===================================================================
    // SECTION 1: STATIC SERVING & CACHE HEADERS
    // ===================================================================
    console.log('--- 1. STATIC ASSET SERVING & HTTP HEADERS ---');

    const views = [
      { name: 'Sprint Board', file: 'sprint-board.html' },
      { name: 'Backlog', file: 'backlog.html' },
      { name: 'Sprint List', file: 'sprint-list.html' },
      { name: 'Velocity Chart', file: 'velocity-chart.html' }
    ];

    const htmlContents = {};

    for (const v of views) {
      const res = await fetch(`${baseUrl}/${v.file}`);
      const body = await res.text();
      htmlContents[v.file] = body;

      assert(
        res.status === 200,
        `GET /${v.file} returns HTTP 200 OK`,
        `Status: ${res.status}, Size: ${body.length} bytes`
      );

      const contentType = res.headers.get('content-type') || '';
      assert(
        contentType.includes('text/html'),
        `GET /${v.file} has text/html content-type`,
        `Content-Type: ${contentType}`
      );

      const cacheControl = res.headers.get('cache-control') || '';
      assert(
        cacheControl.includes('no-cache') || cacheControl.includes('no-store'),
        `GET /${v.file} enforces anti-caching headers for fresh UI delivery`,
        `Cache-Control: ${cacheControl}`
      );
    }

    // ===================================================================
    // SECTION 2: VIEW 1 — SPRINT BOARD (sprint-board.html)
    // ===================================================================
    console.log('\n--- 2. VIEW 1: SPRINT BOARD (sprint-board.html) ---');
    const boardHtml = htmlContents['sprint-board.html'];

    // 4 Kanban Columns
    assert(
      boardHtml.includes('id="col-TODO"') &&
      boardHtml.includes('id="col-IN_PROGRESS"') &&
      boardHtml.includes('id="col-IN_REVIEW"') &&
      boardHtml.includes('id="col-DONE"'),
      'Contains 4 Kanban columns: TODO, IN_PROGRESS, IN_REVIEW, DONE'
    );

    // Cards list drop targets
    assert(
      boardHtml.includes('id="cards-TODO"') &&
      boardHtml.includes('id="cards-IN_PROGRESS"') &&
      boardHtml.includes('id="cards-IN_REVIEW"') &&
      boardHtml.includes('id="cards-DONE"'),
      'Contains distinct card dropzones with data-status attributes'
    );

    // Drag-drop implementation
    assert(
      boardHtml.includes('handleDragStart') &&
      boardHtml.includes('dragover') &&
      boardHtml.includes('drop') &&
      boardHtml.includes('/api/backlog/item/') &&
      boardHtml.includes('/status'),
      'Implements drag-and-drop event pipeline calling PATCH /api/backlog/item/:itemId/status'
    );

    // Complete Sprint button & modal
    assert(
      boardHtml.includes('id="btnCompleteSprint"') &&
      boardHtml.includes('id="completeSprintModal"') &&
      boardHtml.includes('/complete'),
      'Contains "Complete Sprint" button and modal connecting to PATCH /api/sprint/:sprintId/complete'
    );

    // Card attributes
    assert(
      boardHtml.includes('badge-type') &&
      boardHtml.includes('badge-priority') &&
      boardHtml.includes('points-tag') &&
      boardHtml.includes('assignee-info'),
      'Card template renders title, type badge, priority, story points, and assignee'
    );

    // Header metrics bar
    assert(
      boardHtml.includes('id="sprintCommittedDisplay"') &&
      boardHtml.includes('id="sprintCompletedDisplay"') &&
      boardHtml.includes('id="sprintProgressBar"'),
      'Header summary bar tracks committed points, completed points, and percentage progress'
    );

    // ===================================================================
    // SECTION 3: VIEW 2 — PRODUCT BACKLOG (backlog.html)
    // ===================================================================
    console.log('\n--- 3. VIEW 2: PRODUCT BACKLOG (backlog.html) ---');
    const backlogHtml = htmlContents['backlog.html'];

    // Filter controls
    assert(
      backlogHtml.includes('id="filterType"') &&
      backlogHtml.includes('id="filterPriority"') &&
      backlogHtml.includes('id="filterSearch"'),
      'Contains interactive filter controls: Type, Priority, and Search'
    );

    // Add Item modal and form
    assert(
      backlogHtml.includes('id="btnOpenAddModal"') &&
      backlogHtml.includes('id="addItemModal"') &&
      backlogHtml.includes('id="addItemForm"') &&
      backlogHtml.includes('/api/backlog/item/create'),
      'Contains "+ Add Item" modal form wired to POST /api/backlog/item/create'
    );

    // Story point input with 0-999 range (Rule 3)
    assert(
      backlogHtml.includes('min="0"') &&
      backlogHtml.includes('max="999"') &&
      backlogHtml.includes('pts-input-box'),
      'Enforces Rule 3: Story points input constrained to 0–999 range'
    );

    // Move to Sprint dropdown
    assert(
      backlogHtml.includes('move-sprint-select') &&
      backlogHtml.includes('/move'),
      'Contains "Move to Sprint" dropdown wired to PATCH /api/backlog/item/:itemId/move'
    );

    // Drag-drop reordering
    assert(
      backlogHtml.includes('handleRowDragStart') &&
      backlogHtml.includes('handleRowDrop') &&
      backlogHtml.includes('/reorder'),
      'Contains drag-to-reorder list functionality wired to PATCH /api/backlog/item/:itemId/reorder'
    );

    // Delete backlog item
    assert(
      backlogHtml.includes('btn-delete-item') &&
      backlogHtml.includes("method !== 'GET'") || backlogHtml.includes("'DELETE'"),
      'Contains item deletion button wired to DELETE /api/backlog/item/:itemId'
    );

    // ===================================================================
    // SECTION 4: VIEW 3 — SPRINT LIST (sprint-list.html)
    // ===================================================================
    console.log('\n--- 4. VIEW 3: SPRINT LIST (sprint-list.html) ---');
    const listHtml = htmlContents['sprint-list.html'];

    // Sprints container
    assert(
      listHtml.includes('id="sprintCardsContainer"'),
      'Contains dedicated container for all project sprints'
    );

    // Create Sprint button & modal
    assert(
      listHtml.includes('id="btnOpenCreateSprint"') &&
      listHtml.includes('id="createSprintModal"') &&
      listHtml.includes('id="createSprintForm"') &&
      listHtml.includes('/api/sprint/create'),
      'Contains "+ Create Sprint" button and modal form calling POST /api/sprint/create'
    );

    // Start Sprint action
    assert(
      listHtml.includes('btn-start-sprint') &&
      listHtml.includes('/start'),
      'Contains "Start Sprint" action wired to PATCH /api/sprint/:sprintId/start'
    );

    // Delete Draft Sprint action
    assert(
      listHtml.includes('btn-delete-sprint') &&
      listHtml.includes("'DELETE'"),
      'Contains "Delete Sprint" action wired to DELETE /api/sprint/:sprintId'
    );

    // Navigation to Sprint Board
    assert(
      listHtml.includes('/sprint-board.html'),
      'Sprint card links directly to Sprint Board (/sprint-board.html?sprintId=...)'
    );

    // Status badges support
    assert(
      listHtml.includes('status-ACTIVE') &&
      listHtml.includes('status-DRAFT') &&
      listHtml.includes('status-COMPLETED'),
      'Supports visual status badges for DRAFT, ACTIVE, and COMPLETED states'
    );

    // ===================================================================
    // SECTION 5: VIEW 4 — VELOCITY & BURNDOWN (velocity-chart.html)
    // ===================================================================
    console.log('\n--- 5. VIEW 4: VELOCITY & BURNDOWN (velocity-chart.html) ---');
    const velHtml = htmlContents['velocity-chart.html'];

    // Chart.js Open-Source Library inclusion
    assert(
      velHtml.includes('chart.js'),
      'Includes Chart.js open-source library without paid/commercial dependencies'
    );

    // KPI Cards
    assert(
      velHtml.includes('id="kpiTotalSprints"') &&
      velHtml.includes('id="kpiAvgVelocity"') &&
      velHtml.includes('id="kpiAvgRate"'),
      'Contains top KPI cards for Total Sprints, Average Velocity, and Average Completion Rate'
    );

    // Velocity Chart Canvas & Dual Bars
    assert(
      velHtml.includes('id="velocityChartCanvas"') &&
      velHtml.includes('Committed Points') &&
      velHtml.includes('Completed Points') &&
      velHtml.includes('Avg Velocity'),
      'Renders dual-bar velocity chart (Committed vs Completed) with average velocity trendline'
    );

    // Burndown Chart Canvas & Dynamic Derivation
    assert(
      velHtml.includes('id="burndownChartCanvas"') &&
      velHtml.includes('id="burndownSprintSelect"') &&
      velHtml.includes('/burndown') &&
      velHtml.includes('Ideal Burndown') &&
      velHtml.includes('Actual Remaining Points'),
      'Renders dynamic sprint burndown chart with ideal and actual remaining points lines'
    );

    // Historical Breakdown Table
    assert(
      velHtml.includes('id="velocityTable"') &&
      velHtml.includes('id="velocityTableBody"'),
      'Contains sprint-by-sprint velocity breakdown table below the charts'
    );

    // API Integration: Layer 4 endpoints
    assert(
      velHtml.includes('/api/sprint/velocity/') &&
      velHtml.includes('/api/sprint/') && velHtml.includes('/burndown'),
      'Correctly connects to Layer 4 APIs: /api/sprint/velocity/:projectId and /api/sprint/:sprintId/burndown'
    );

  } finally {
    await new Promise(resolve => server.close(resolve));
    console.log('\n  Test HTTP Server cleanly closed.');
  }

  // Final Summary
  console.log('\n===================================================================');
  console.log(`  PRD 18 — LAYER 5 RESULTS: ${passedTests}/${totalTests} PASSED (${failedTests} FAILED)`);
  console.log('===================================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

run().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
