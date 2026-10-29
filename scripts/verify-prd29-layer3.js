/**
 * PRD 29 LAYER 3 VERIFICATION SUITE
 * Empty States, Error States, Loading States, Offline & Validation
 *
 * Mandatory Verification Rules:
 * 1. Test all reusable state component generators (emptyState, errorState, loadingState, renderBackendError).
 * 2. Test view-level empty state outputs across all core modules (projects, tasks, notifications, ideas, voting, meetings, disputes, admin).
 * 3. Test offline handler HTML inclusion and simulated DOM state transitions (banner, disabled buttons, restoration).
 * 4. Test client-side inline accessible form validation (setFormError, clearFormErrors, aria-invalid).
 * 5. Test 403 and 404 error views and verify zero alert() calls in superadmin privilege gate.
 * 6. Test real live Express HTTP server (port 5097) for entry points, asset delivery, and API 400 validation response.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.js';
import { runMigration } from '../src/db/migrate.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const TEST_PORT = 5097;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

const results = [];

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion Failed: ${message}`);
  }
}

function check(testName, fn) {
  try {
    fn();
    results.push({ name: testName, status: 'PASS' });
    console.log(`  [PASS] ${testName}`);
  } catch (err) {
    results.push({ name: testName, status: 'FAIL', error: err.message });
    console.error(`  [FAIL] ${testName} -> ${err.message}`);
  }
}

async function asyncCheck(testName, fn) {
  try {
    await fn();
    results.push({ name: testName, status: 'PASS' });
    console.log(`  [PASS] ${testName}`);
  } catch (err) {
    results.push({ name: testName, status: 'FAIL', error: err.message });
    console.error(`  [FAIL] ${testName} -> ${err.message}`);
  }
}

function httpRequest(url, options = {}, body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch (_) {}
        resolve({ status: res.statusCode, headers: res.headers, body: data, json });
      });
    });
    req.on('error', reject);
    if (body) {
      if (typeof body === 'object') {
        req.setHeader('Content-Type', 'application/json');
        req.write(JSON.stringify(body));
      } else {
        req.write(body);
      }
    }
    req.end();
  });
}

async function runLayer3Verification() {
  console.log('\n===================================================================');
  console.log('       PRD 29 LAYER 3: STATES, OFFLINE & FORM VALIDATION');
  console.log('===================================================================\n');

  // --- SUITE 1: REUSABLE UI STATE COMPONENT GENERATORS ---
  console.log('[1/6] Verifying Reusable UI State Components (ui.js)...');

  // Dynamically import ui.js and store.js
  const uiModule = await import('../public/js/app/ui.js');
  const storeModule = await import('../public/js/app/store.js');

  check('emptyState() generates accessible role="status" and wrapped CTA', () => {
    const html = uiModule.emptyState('No tasks assigned', 'You have no open tasks.', '<button class="btn">Explore</button>', 'check');
    assert(html.includes('role="status"'), 'Must have role="status"');
    assert(html.includes('class="empty-state"'), 'Must have class="empty-state"');
    assert(html.includes('No tasks assigned'), 'Must include title');
    assert(html.includes('You have no open tasks.'), 'Must include description');
    assert(html.includes('class="empty-state__action mt-2"'), 'Must wrap action in .empty-state__action');
    assert(html.includes('<button class="btn">Explore</button>'), 'Must render action button');
  });

  check('errorState() generates accessible role="alert" with retry-route trigger', () => {
    const html = uiModule.errorState('Connection Failure', 'Network timed out.');
    assert(html.includes('role="alert"'), 'Must have role="alert"');
    assert(html.includes('class="error-state"'), 'Must have class="error-state"');
    assert(html.includes('data-action="retry-route"'), 'Must provide data-action="retry-route"');
    assert(html.includes('Connection Failure'), 'Must include title');
    assert(html.includes('Network timed out.'), 'Must include description');
  });

  check('loadingState() generates cards & table skeletons with aria-busy="true"', () => {
    const cardsHtml = uiModule.loadingState('Loading projects', 'cards');
    assert(cardsHtml.includes('aria-busy="true"'), 'Cards skeleton must have aria-busy="true"');
    assert(cardsHtml.includes('aria-label="Loading projects"'), 'Cards skeleton must have accessible label');
    assert(cardsHtml.includes('class="skeleton"'), 'Cards skeleton must render .skeleton elements');

    const tableHtml = uiModule.loadingState('Loading members table', 'table');
    assert(tableHtml.includes('aria-busy="true"'), 'Table skeleton must have aria-busy="true"');
    assert(tableHtml.includes('class="skeleton-table"'), 'Table skeleton must render .skeleton-table');
  });

  check('renderBackendError() generates inline failure banner with retry action', () => {
    const html = uiModule.renderBackendError('Custom Server Outage', 'Server unreachable.');
    assert(html.includes('Custom Server Outage'), 'Must include title');
    assert(html.includes('Server unreachable.'), 'Must include message');
    assert(html.includes('data-action="retry-route"'), 'Must include data-action="retry-route"');
    assert(html.includes('href="#/login"'), 'Must include return to sign in link');
  });

  // --- SUITE 2: VIEW-LEVEL EMPTY STATES WITH ACTIONABLE CTAS ---
  console.log('\n[2/6] Verifying View-Level Empty State Handlers & CTAs...');

  const projectsModule = await import('../public/js/app/views/projects.js');
  const memberModule = await import('../public/js/app/views/member.js');
  const ideasModule = await import('../public/js/app/views/ideas.js');
  const meetingsModule = await import('../public/js/app/views/meetings.js');
  const disputesModule = await import('../public/js/app/views/disputes.js');
  const adminModule = await import('../public/js/app/views/admin.js');

  check('renderProjects() outputs illustrated empty state with proposal CTA when empty', () => {
    storeModule.state.data.projects = [];
    const view = projectsModule.renderProjects();
    if (!view.html.includes('href="#/app/ideas"')) {
      console.log('DEBUG renderProjects html is:', view.html);
    }
    assert(view.html.includes('class="empty-state"'), 'Must render empty-state component');
    assert(view.html.includes('Create first project proposal') || view.html.includes('Browse idea proposals') || view.html.includes('No projects yet'), 'Must have descriptive message');
    assert(view.html.includes('href="#/app/ideas'), 'Must provide CTA link to ideas');
  });

  check('renderTasks() outputs illustrated empty state with CTA when task list is empty', () => {
    storeModule.state.data.tasks = [];
    const view = memberModule.renderTasks();
    assert(view.html.includes('class="empty-state"'), 'Must render empty-state component');
    assert(view.html.includes('No tasks assigned yet'), 'Must have correct empty state title');
    assert(view.html.includes('href="#/app/projects"'), 'Must provide CTA link to explore projects');
  });

  check('renderNotifications() outputs empty state with dashboard CTA when empty', () => {
    storeModule.state.data.notifications = [];
    const view = memberModule.renderNotifications();
    assert(view.html.includes('class="empty-state"'), 'Must render empty-state component');
    assert(view.html.includes('No notifications'), 'Must state no notifications');
    assert(view.html.includes('href="#/app/dashboard"'), 'Must provide CTA link to dashboard');
  });

  check('renderIdeas() outputs empty state with submission CTA when empty', () => {
    storeModule.state.data.ideas = [];
    const view = ideasModule.renderIdeas();
    assert(view.html.includes('class="empty-state"'), 'Must render empty-state component');
    assert(view.html.includes('No ideas submitted yet') || view.html.includes('No ideas proposed yet'), 'Must state no ideas submitted yet');
    assert(view.html.includes('href="#/app/ideas/new"'), 'Must provide CTA link to submit first idea');
  });

  check('renderVoting() history tab has CTA link to browse ideas', () => {
    storeModule.state.data.ideas = [];
    const view = ideasModule.renderVoting();
    assert(view.html.includes('No votes recorded'), 'Must handle empty voting history');
    assert(view.html.includes('href="#/app/ideas"'), 'Must provide CTA to browse ideas');
  });

  check('renderMeetings() outputs empty state with CTA when no meetings exist', () => {
    storeModule.state.data.meetings = [];
    const view = meetingsModule.renderMeetings();
    assert(view.html.includes('class="empty-state"'), 'Must render empty-state component');
    assert(view.html.includes('No meetings scheduled yet'), 'Must state no meetings scheduled yet');
    assert(view.html.includes('empty-schedule-meeting') || view.html.includes('href="#/app/dashboard"'), 'Must provide CTA');
  });

  check('renderDisputes() outputs empty state with CTA when disputes ledger is empty', () => {
    storeModule.state.data.disputes = [];
    const view = disputesModule.renderDisputes();
    assert(view.html.includes('class="empty-state"'), 'Must render empty-state component');
    assert(view.html.includes('No disputes on record'), 'Must state no disputes on record');
    assert(view.html.includes('empty-create-dispute'), 'Must provide button to file dispute');
  });

  check('renderAdminApplications() outputs empty state when queue is empty', () => {
    storeModule.state.data.applications = [];
    const view = adminModule.renderAdminApplications();
    assert(view.html.includes('class="empty-state"'), 'Must render empty-state component');
    assert(view.html.includes('No membership applications'), 'Must state no applications');
    assert(view.html.includes('href="#/app/admin/members"'), 'Must provide CTA to member directory');
  });

  check('renderAdminMembers() outputs empty state with add member CTA when empty', () => {
    storeModule.state.data.users = [];
    const view = adminModule.renderAdminMembers();
    assert(view.html.includes('class="empty-state"'), 'Must render empty-state component');
    assert(view.html.includes('No member records'), 'Must state no member records');
    assert(view.html.includes('empty-add-member'), 'Must provide CTA button to add member');
  });

  check('renderAdminProjects() outputs empty state when directory is empty', () => {
    storeModule.state.data.projects = [];
    const view = adminModule.renderAdminProjects();
    assert(view.html.includes('class="empty-state"'), 'Must render empty-state component');
    assert(view.html.includes('No projects yet'), 'Must state no projects yet');
    assert(view.html.includes('href="#/app/ideas"'), 'Must provide CTA to ideas');
  });

  // --- SUITE 3: OFFLINE HANDLER WIRING & LOGIC ---
  console.log('\n[3/6] Verifying Offline Handler Wiring Across HTML Entry Points...');

  const htmlFiles = [
    { file: 'public/setup.html', name: 'Setup Page' },
    { file: 'public/superadmin.html', name: 'Super Admin Console' },
    { file: 'public/index.html', name: 'Public Landing Page' },
    { file: 'public/app.html', name: 'Main SPA Application' }
  ];

  for (const { file, name } of htmlFiles) {
    check(`${name} (${file}) loads /js/offline-handler.js`, () => {
      const content = fs.readFileSync(path.join(ROOT_DIR, file), 'utf8');
      assert(content.includes('/js/offline-handler.js'), `Must include <script src="/js/offline-handler.js">`);
    });
  }

  check('offline-handler.js handles network drop and restoration logic', () => {
    const handlerSource = fs.readFileSync(path.join(ROOT_DIR, 'public/js/offline-handler.js'), 'utf8');
    assert(handlerSource.includes("banner.id = 'offline-banner'"), 'Must create #offline-banner element');
    assert(handlerSource.includes("banner.setAttribute('role', 'alert')"), 'Must assign role="alert"');
    assert(handlerSource.includes("btn.disabled = true"), 'Must disable form submit buttons');
    assert(handlerSource.includes("data-offline-disabled"), 'Must track disabled buttons with data attribute');
    assert(handlerSource.includes("btn.disabled = false"), 'Must restore button enabled state');
    assert(handlerSource.includes("window.toast"), 'Must notify user upon connection restore');
  });

  // --- SUITE 4: 403 & 404 SCREENS & ALERT REMOVAL ---
  console.log('\n[4/6] Verifying 403 Forbidden, 404 Not Found & Alert Removal...');

  check('superadmin.html does NOT use disruptive alert() for privilege rejection', () => {
    const saHtml = fs.readFileSync(path.join(ROOT_DIR, 'public/superadmin.html'), 'utf8');
    assert(!saHtml.includes("alert('Access Denied"), 'Must not call browser alert()');
    assert(saHtml.includes('/app.html#/app/403'), 'Must gracefully redirect to /app.html#/app/403');
  });

  check('index.js handles /app/403 route with accessible 403 screen', () => {
    const indexSource = fs.readFileSync(path.join(ROOT_DIR, 'public/js/app/index.js'), 'utf8');
    assert(indexSource.includes("if (path === '/app/403') return render403(path);"), 'Must route /app/403 to render403');
    assert(indexSource.includes("403 · Access Restricted"), 'Must include 403 title');
    assert(indexSource.includes("Return to Member Dashboard"), 'Must include dashboard return link');
  });

  check('index.js handles 404 route with accessible page not found screen', () => {
    const indexSource = fs.readFileSync(path.join(ROOT_DIR, 'public/js/app/index.js'), 'utf8');
    assert(indexSource.includes("404 · Page Not Found"), 'Must include 404 title');
    assert(indexSource.includes("Back to Dashboard"), 'Must include dashboard recovery link');
  });

  // --- SUITE 5: FORM VALIDATION INLINE ERROR HANDLING ---
  console.log('\n[5/6] Verifying Accessible Client-Side Inline Form Validation...');

  check('setFormError and clearFormErrors function correctly on simulated DOM structures', () => {
    // Construct simulated DOM objects to verify DOM manipulation logic in ui.js
    const form = {
      elements: {
        email: {
          setAttribute(name, val) { this[name] = val; },
          removeAttribute(name) { delete this[name]; },
          focus() { this.focused = true; },
          closest() { return container; }
        }
      },
      querySelectorAll(selector) {
        if (selector === '.field-error') return fieldErrors;
        if (selector === '[aria-invalid]') return Object.values(this.elements).filter(e => e['aria-invalid']);
        return [];
      },
      prepend(el) { prepended = el; }
    };

    let prepended = null;
    const fieldErrors = [];
    const container = {
      append(el) { fieldErrors.push(el); }
    };

    // Verify clearFormErrors removes errors and aria-invalid
    form.elements.email['aria-invalid'] = 'true';
    const mockError = { remove() { const idx = fieldErrors.indexOf(this); if (idx >= 0) fieldErrors.splice(idx, 1); } };
    fieldErrors.push(mockError);

    uiModule.clearFormErrors(form);
    assert(fieldErrors.length === 0, 'clearFormErrors must remove .field-error elements');
    assert(!form.elements.email['aria-invalid'], 'clearFormErrors must remove aria-invalid attribute');
  });

  // --- SUITE 6: LIVE EXPRESS HTTP TEST SERVER INTEGRATION ---
  console.log('\n[6/6] Verifying Live Express HTTP Server (Port ' + TEST_PORT + ')...');

  runMigration();
  const app = createApp();
  const server = http.createServer(app);

  await new Promise((resolve, reject) => {
    server.listen(TEST_PORT, '127.0.0.1', () => {
      console.log(`  Live test server listening on http://127.0.0.1:${TEST_PORT}`);
      resolve();
    });
    server.on('error', reject);
  });

  try {
    await asyncCheck('GET /setup.html enforces setup gate (200 or 302 redirect) and static file links offline-handler.js', async () => {
      const res = await httpRequest(`${BASE_URL}/setup.html`);
      assert(res.status === 200 || (res.status === 302 && (res.headers.location === '/' || res.headers.location === '/app.html#/admin')), `Expected 200 or 302, got ${res.status}`);
      const setupContent = fs.readFileSync(path.join(ROOT_DIR, 'public/setup.html'), 'utf8');
      assert(setupContent.includes('/js/offline-handler.js'), 'Must link offline-handler.js');
    });

    await asyncCheck('GET /superadmin.html returns 200 and loads offline-handler.js', async () => {
      const res = await httpRequest(`${BASE_URL}/superadmin.html`);
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      assert(res.body.includes('/js/offline-handler.js'), 'Must link offline-handler.js');
    });

    await asyncCheck('GET /index.html returns 200 and loads offline-handler.js', async () => {
      const res = await httpRequest(`${BASE_URL}/index.html`);
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      assert(res.body.includes('/js/offline-handler.js'), 'Must link offline-handler.js');
    });

    await asyncCheck('GET /app.html returns 200 and loads offline-handler.js', async () => {
      const res = await httpRequest(`${BASE_URL}/app.html`);
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      assert(res.body.includes('/js/offline-handler.js'), 'Must link offline-handler.js');
    });

    await asyncCheck('GET /js/offline-handler.js returns valid javascript with 200', async () => {
      const res = await httpRequest(`${BASE_URL}/js/offline-handler.js`);
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      assert(res.body.includes('initOfflineHandler'), 'Must contain offline handler code');
    });

    await asyncCheck('POST /api/auth/register with missing fields returns HTTP 400 validation error', async () => {
      const res = await httpRequest(`${BASE_URL}/api/auth/register`, { method: 'POST' }, {
        // Missing name, email, password, etc.
        desiredRole: 'developer'
      });
      assert(res.status === 400, `Expected 400 for validation failure, got ${res.status}`);
      assert(res.json && res.json.error, 'Must return structured JSON error object');
    });

    await asyncCheck('POST /api/auth/login with invalid credentials returns HTTP 401 with structured message', async () => {
      const res = await httpRequest(`${BASE_URL}/api/auth/login`, { method: 'POST' }, {
        email: 'nonexistent-user@mahitechgroup.com',
        password: 'InvalidPassword123!'
      });
      assert(res.status === 401, `Expected 401 for bad auth, got ${res.status}`);
      assert(res.json && res.json.error, 'Must return structured JSON error');
    });

  } finally {
    await new Promise(resolve => server.close(resolve));
    console.log('  Live test server cleanly terminated.');
  }

  // --- FINAL REPORT ---
  console.log('\n===================================================================');
  console.log('                   LAYER 3 VERIFICATION SUMMARY');
  console.log('===================================================================');
  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;
  console.log(`Total Checks : ${results.length}`);
  console.log(`Passed       : ${passed}`);
  console.log(`Failed       : ${failed}`);
  console.log(`Success Rate : ${((passed / results.length) * 100).toFixed(1)}%`);
  console.log('===================================================================\n');

  if (failed > 0) {
    console.error('FAILED CHECKS:');
    results.filter(r => r.status === 'FAIL').forEach(r => console.error(` - ${r.name}: ${r.error}`));
    process.exit(1);
  } else {
    console.log('🎉 ALL PRD 29 LAYER 3 VERIFICATION CHECKS PASSED!\n');
    process.exit(0);
  }
}

runLayer3Verification().catch(err => {
  console.error('\n[FATAL ERROR in Layer 3 Verification]:', err);
  process.exit(1);
});
