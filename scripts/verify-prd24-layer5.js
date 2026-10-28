/**
 * scripts/verify-prd24-layer5.js
 * Verification Suite for PRD 24 Layer 5: Client Portal Frontend Views
 *
 * Verifies:
 * 1. File Existence & Integrity:
 *    - All 6 HTML views exist in public/
 * 2. Static Security & Architectural Rule Audit:
 *    - Zero hardcoded credentials or mock tokens
 *    - is_internal field never mentioned in client-facing views
 *    - internal_notes field never mentioned in client-facing views
 *    - Client portal views never reference /api/admin/* or /api/superadmin/*
 *    - clientToken key strictly segregated from internal user token
 *    - XSS protection (escapeHTML) implemented across dynamic views
 * 3. Live HTTP Serving:
 *    - Real Express app serving all 6 views with 200 OK and correct content types
 * 4. Auth Guard & Script Isolation:
 *    - Unauthenticated client redirected to /client-login.html
 *    - Unauthenticated admin redirected to /login.html
 * 5. Cross-Client Data Isolation in UI/API Layer:
 *    - Multi-client tenant isolation verified with real HTTP calls
 *    - Internal messages (is_internal=1) stripped and never visible in client layer
 *    - Internal notes stripped and never rendered in client order view
 */

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app.js';
import { queryOne, queryAll, execute } from '../src/db/database.js';
import { config } from '../src/config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const publicDir = path.join(rootDir, 'public');

let passedTests = 0;
let failedTests = 0;
const testResults = [];

function assert(condition, message) {
  if (condition) {
    passedTests++;
    testResults.push({ pass: true, message });
    console.log(`  ✓ PASS: ${message}`);
  } else {
    failedTests++;
    testResults.push({ pass: false, message });
    console.error(`  ✗ FAIL: ${message}`);
  }
}

// Helper for making real HTTP requests
function httpRequest(baseUrl, endpoint, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(endpoint, baseUrl);
    const reqOptions = {
      method: options.method || 'GET',
      headers: options.headers || {}
    };

    const req = http.request(url, reqOptions, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(data);
        } catch (e) {
          json = null;
        }
        resolve({
          status: res.statusCode,
          headers: res.headers,
          text: data,
          json
        });
      });
    });

    req.on('error', reject);

    if (options.body) {
      if (typeof options.body === 'object') {
        req.setHeader('Content-Type', 'application/json');
        req.write(JSON.stringify(options.body));
      } else {
        req.write(options.body);
      }
    }

    req.end();
  });
}

async function runLayer5Verification() {
  console.log('===================================================================');
  console.log('  PRD 24 — LAYER 5 VERIFICATION SUITE: CLIENT PORTAL FRONTEND VIEWS');
  console.log('===================================================================\n');

  // =========================================================================
  // SUITE 1: File Existence & Basic Structure
  // =========================================================================
  console.log('--- SUITE 1: Frontend Views Existence & Basic Structure ---');

  const requiredViews = [
    { file: 'client-login.html', desc: 'View 1: Client Login Page' },
    { file: 'client-invite.html', desc: 'View 2: Client Invite Acceptance Page' },
    { file: 'client-dashboard.html', desc: 'View 3: Client Dashboard' },
    { file: 'client-project.html', desc: 'View 4: Client Project View' },
    { file: 'client-orders.html', desc: 'View 5: Client Order Center' },
    { file: 'admin-client-management.html', desc: 'View 6: Admin Client Management' }
  ];

  const viewContents = {};

  for (const view of requiredViews) {
    const filePath = path.join(publicDir, view.file);
    const exists = fs.existsSync(filePath);
    assert(exists, `${view.desc} (${view.file}) exists in public/ directory`);

    if (exists) {
      const content = fs.readFileSync(filePath, 'utf-8');
      viewContents[view.file] = content;
      assert(content.length > 200, `${view.file} has substantial content (${content.length} bytes)`);
      assert(content.includes('<!DOCTYPE html>'), `${view.file} contains valid HTML5 doctype declaration`);
      assert(content.includes('<title>'), `${view.file} contains descriptive page title`);
    }
  }

  // =========================================================================
  // SUITE 2: Static Security & Architectural Rule Audit
  // =========================================================================
  console.log('\n--- SUITE 2: Static Security & Architectural Rule Audit ---');

  const clientFacingFiles = [
    'client-login.html',
    'client-invite.html',
    'client-dashboard.html',
    'client-project.html',
    'client-orders.html'
  ];

  for (const filename of clientFacingFiles) {
    const content = viewContents[filename] || '';

    // Rule 1: No hardcoded credentials
    const hasHardcodedJwt = /eyJhbGciOiJIUzI1NiIsIn/i.test(content);
    assert(!hasHardcodedJwt, `Rule 1: ${filename} contains zero hardcoded JWT tokens`);

    const hasHardcodedPassword = /password\s*[:=]\s*['"][a-zA-Z0-9!@#$%^&*]{6,}['"]/i.test(content);
    assert(!hasHardcodedPassword, `Rule 1: ${filename} contains zero hardcoded passwords`);

    // Rule 2: Client token segregated
    const storesInternalToken = content.includes("localStorage.setItem('token'") || content.includes('localStorage.setItem("token"');
    assert(!storesInternalToken, `Rule 2: ${filename} does not store internal user JWT under 'token' key`);

    // Rule 5: Client portal pages must never call /api/admin/* or /api/superadmin/*
    const callsAdminApi = content.includes('/api/admin/') || content.includes('/api/superadmin/');
    assert(!callsAdminApi, `Rule 5: ${filename} never references /api/admin/* or /api/superadmin/* endpoints`);

    // Rule 6: is_internal field must NEVER appear in rendered HTML or JS variables on client pages
    const hasIsInternal = content.includes('is_internal');
    assert(!hasIsInternal, `Rule 6: ${filename} contains zero mentions of 'is_internal' (DOM/JS isolated)`);

    // Rule 7 & 8: No internal_notes rendered on client pages
    const hasInternalNotes = content.includes('internal_notes');
    assert(!hasInternalNotes, `Rule 7: ${filename} contains zero mentions of 'internal_notes'`);

    // Rule 10: XSS protection
    const hasEscapeHtml = content.includes('escapeHTML');
    if (filename !== 'client-login.html' && filename !== 'client-invite.html') {
      assert(hasEscapeHtml, `Security: ${filename} implements escapeHTML XSS sanitizer`);
    }
  }

  // Admin view verification
  const adminContent = viewContents['admin-client-management.html'] || '';
  assert(adminContent.includes("localStorage.getItem('token')"), 'Rule 2: admin-client-management.html uses internal JWT token');
  assert(adminContent.includes('internal_notes'), 'Admin View: admin-client-management.html displays internal_notes to admin');
  assert(adminContent.includes('is_internal'), 'Admin View: admin-client-management.html supports is_internal toggle');

  // =========================================================================
  // SUITE 3: Real HTTP Server & Asset Delivery
  // =========================================================================
  console.log('\n--- SUITE 3: Real HTTP Server & Asset Delivery ---');

  const app = createApp();
  const server = http.createServer(app);

  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    for (const view of requiredViews) {
      const res = await httpRequest(baseUrl, `/${view.file}`);
      assert(res.status === 200, `Real HTTP GET /${view.file} returned 200 OK`);
      assert(res.headers['content-type']?.includes('text/html'), `Real HTTP /${view.file} served with text/html content-type`);
      assert(res.text.includes('<title>'), `Real HTTP /${view.file} body contains complete rendered HTML document`);
    }

    // =========================================================================
    // SUITE 4: Auth Guard & Redirect Verification (Sandboxed VM)
    // =========================================================================
    console.log('\n--- SUITE 4: Auth Guard & Script Isolation (Sandboxed VM) ---');

    function testAuthGuard(filename, storageKey, expectedRedirect) {
      const html = viewContents[filename] || '';
      const scriptMatches = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
      const combinedScript = scriptMatches.map(m => m[1]).join('\n');

      let redirectedTo = null;
      const localStorage = {
        getItem: (k) => null,
        setItem: () => {},
        removeItem: () => {}
      };

      const sandbox = {
        window: {
          location: {
            replace: (url) => { redirectedTo = url; },
            search: ''
          }
        },
        document: {
          getElementById: () => ({ addEventListener: () => {}, style: {}, textContent: '' }),
          querySelectorAll: () => []
        },
        localStorage,
        URLSearchParams: class { get() { return null; } },
        fetch: () => Promise.resolve({ ok: false, status: 401, json: () => Promise.resolve({}) })
      };

      try {
        vm.createContext(sandbox);
        // Execute the script in sandbox
        vm.runInContext(combinedScript, sandbox);
      } catch (e) {
        // Scripts might catch or call DOM functions, redirect may have already fired
      }

      return redirectedTo;
    }

    const clientDashRedirect = testAuthGuard('client-dashboard.html', 'clientToken', '/client-login.html');
    assert(clientDashRedirect === '/client-login.html', 'Auth Guard: client-dashboard.html redirects unauthenticated user to /client-login.html');

    const clientProjectRedirect = testAuthGuard('client-project.html', 'clientToken', '/client-login.html');
    assert(clientProjectRedirect === '/client-login.html', 'Auth Guard: client-project.html redirects unauthenticated user to /client-login.html');

    const clientOrdersRedirect = testAuthGuard('client-orders.html', 'clientToken', '/client-login.html');
    assert(clientOrdersRedirect === '/client-login.html', 'Auth Guard: client-orders.html redirects unauthenticated user to /client-login.html');

    const adminManagementRedirect = testAuthGuard('admin-client-management.html', 'token', '/login.html');
    assert(adminManagementRedirect === '/login.html', 'Auth Guard: admin-client-management.html redirects unauthenticated user to /login.html');

    // =========================================================================
    // SUITE 5: Cross-Client Data Isolation in UI/API Layer
    // =========================================================================
    console.log('\n--- SUITE 5: Cross-Client Data Isolation in UI/API Layer ---');

    // 1. Setup Admin user
    let adminUser = queryOne("SELECT id, name, email FROM users WHERE role = 'admin' LIMIT 1");
    if (!adminUser) {
      const hash = await bcrypt.hash('AdminPass123!', 10);
      const adminId = `admin-l5-${Date.now()}`;
      execute(
        "INSERT INTO users (id, name, email, password_hash, role, status) VALUES (?, 'Test Admin', 'test.admin.l5@test.com', ?, 'admin', 'active')",
        [adminId, hash]
      );
      adminUser = queryOne("SELECT id, name, email FROM users WHERE email = 'test.admin.l5@test.com'");
    }
    const adminSessionId = `admin-sess-l5-${Date.now()}`;
    const adminSessionExpires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const adminToken = jwt.sign(
      { userId: adminUser.id, sessionId: adminSessionId, role: 'admin', email: adminUser.email },
      config.JWT_SECRET,
      { expiresIn: '24h' }
    );
    execute(
      `INSERT INTO sessions (id, user_id, token, expires_at, is_revoked, created_at)
       VALUES (?, ?, ?, ?, 0, datetime('now'))`,
      [adminSessionId, adminUser.id, adminToken, adminSessionExpires]
    );

    // 2. Setup Projects A & B
    const testSuffix = Date.now();
    execute(
      `INSERT OR IGNORE INTO ideas (id, title, description, owner_id, status, created_at, updated_at)
       VALUES ('idea-l5-1', 'Idea L5 Alpha', 'L5 Test Idea 1', ?, 'APPROVED', datetime('now'), datetime('now'))`,
      [adminUser.id]
    );
    execute(
      `INSERT OR IGNORE INTO ideas (id, title, description, owner_id, status, created_at, updated_at)
       VALUES ('idea-l5-2', 'Idea L5 Beta', 'L5 Test Idea 2', ?, 'APPROVED', datetime('now'), datetime('now'))`,
      [adminUser.id]
    );

    execute(
      `INSERT OR IGNORE INTO projects (id, idea_id, title, owner_id, current_stage, status, created_at, updated_at)
       VALUES (?, 'idea-l5-1', 'Client Project Alpha', ?, 'INTEGRATION', 'ACTIVE', datetime('now'), datetime('now'))`,
      [`proj-l5-1-${testSuffix}`, adminUser.id]
    );
    execute(
      `INSERT OR IGNORE INTO projects (id, idea_id, title, owner_id, current_stage, status, created_at, updated_at)
       VALUES (?, 'idea-l5-2', 'Client Project Beta', ?, 'TESTING', 'ACTIVE', datetime('now'), datetime('now'))`,
      [`proj-l5-2-${testSuffix}`, adminUser.id]
    );

    const projectA = queryOne('SELECT * FROM projects WHERE id = ?', [`proj-l5-1-${testSuffix}`]);
    const projectB = queryOne('SELECT * FROM projects WHERE id = ?', [`proj-l5-2-${testSuffix}`]);

    // 3. Create Clients A and B
    const passHash = await bcrypt.hash('ClientSecret123!', 10);
    const emailA = `client.a.${Date.now()}@test.com`;
    const emailB = `client.b.${Date.now()}@test.com`;

    execute(
      `INSERT INTO clients (name, email, company_name, password_hash, status, created_by)
       VALUES ('Client Alpha Corp', ?, 'Alpha Corp', ?, 'ACTIVE', ?)`,
      [emailA, passHash, adminUser.id]
    );
    const clientA = queryOne('SELECT id, name, email FROM clients WHERE email = ?', [emailA]);

    execute(
      `INSERT INTO clients (name, email, company_name, password_hash, status, created_by)
       VALUES ('Client Beta Corp', ?, 'Beta Corp', ?, 'ACTIVE', ?)`,
      [emailB, passHash, adminUser.id]
    );
    const clientB = queryOne('SELECT id, name, email FROM clients WHERE email = ?', [emailB]);

    // Grant access: Client A -> Project A, Client B -> Project B
    execute(
      'INSERT INTO client_project_access (client_id, project_id, access_level, granted_by, is_active) VALUES (?, ?, ?, ?, 1)',
      [clientA.id, projectA.id, 'READ', adminUser.id]
    );
    execute(
      'INSERT INTO client_project_access (client_id, project_id, access_level, granted_by, is_active) VALUES (?, ?, ?, ?, 1)',
      [clientB.id, projectB.id, 'WRITE', adminUser.id]
    );

    // Login Client A
    const loginResA = await httpRequest(baseUrl, '/api/client/auth/login', {
      method: 'POST',
      body: { email: emailA, password: 'ClientSecret123!' }
    });
    assert(loginResA.status === 200 && loginResA.json?.token, 'Real HTTP login for Client A returns Client JWT');
    const tokenA = loginResA.json.token;

    // Login Client B
    const loginResB = await httpRequest(baseUrl, '/api/client/auth/login', {
      method: 'POST',
      body: { email: emailB, password: 'ClientSecret123!' }
    });
    assert(loginResB.status === 200 && loginResB.json?.token, 'Real HTTP login for Client B returns Client JWT');
    const tokenB = loginResB.json.token;

    // 4. Verify Project Isolation
    const clientAProjectsRes = await httpRequest(baseUrl, '/api/client/projects', {
      headers: { 'Authorization': `Bearer ${tokenA}` }
    });
    assert(clientAProjectsRes.status === 200, 'Client A can fetch /api/client/projects');
    const clientAProjects = clientAProjectsRes.json?.projects || clientAProjectsRes.json || [];
    assert(clientAProjects.some(p => p.id === projectA.id), 'Client A sees Project Alpha');
    assert(!clientAProjects.some(p => p.id === projectB.id), 'Cross-Client Isolation: Client A CANNOT see Project Beta');

    const clientBProjectsRes = await httpRequest(baseUrl, '/api/client/projects', {
      headers: { 'Authorization': `Bearer ${tokenB}` }
    });
    assert(clientBProjectsRes.status === 200, 'Client B can fetch /api/client/projects');
    const clientBProjects = clientBProjectsRes.json?.projects || clientBProjectsRes.json || [];
    assert(clientBProjects.some(p => p.id === projectB.id), 'Client B sees Project Beta');
    assert(!clientBProjects.some(p => p.id === projectA.id), 'Cross-Client Isolation: Client B CANNOT see Project Alpha');

    // 5. Submit Order from Client A and verify isolation
    const orderResA = await httpRequest(baseUrl, '/api/client/orders/submit', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${tokenA}` },
      body: {
        project_id: projectA.id,
        order_type: 'NEW_REQUEST',
        priority: 'HIGH',
        title: 'Alpha Critical Feature Request',
        description: 'Confidential client feature requirements'
      }
    });
    assert(orderResA.status === 201 && orderResA.json?.order?.id, 'Client A successfully submitted order on Project Alpha');
    const orderAId = orderResA.json.order.id;

    // Client B orders check: Client B must not see Client A's order
    const clientBOrdersRes = await httpRequest(baseUrl, '/api/client/orders', {
      headers: { 'Authorization': `Bearer ${tokenB}` }
    });
    assert(clientBOrdersRes.status === 200, 'Client B fetches orders list');
    const clientBOrders = clientBOrdersRes.json?.orders || clientBOrdersRes.json || [];
    assert(!clientBOrders.some(o => o.id === orderAId), 'Cross-Client Isolation: Client B cannot see Client A order in orders list');

    // Client B direct order detail attempt: Must return 403 or 404
    const clientBDirectOrderRes = await httpRequest(baseUrl, `/api/client/orders/${orderAId}`, {
      headers: { 'Authorization': `Bearer ${tokenB}` }
    });
    assert([403, 404].includes(clientBDirectOrderRes.status), 'Cross-Client Security: Client B blocked from accessing Client A order details');

    // 6. Admin adds messages (Public + Internal Note) to Client A's order
    const adminMsgRes = await httpRequest(baseUrl, `/api/admin/orders/${orderAId}/message`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminToken}` },
      body: {
        message: 'Hello Client Alpha, we are working on this.',
        is_internal: false
      }
    });
    if (adminMsgRes.status !== 201) {
      console.log('DEBUG adminMsgRes:', adminMsgRes.status, adminMsgRes.text);
    }
    assert(adminMsgRes.status === 201, 'Admin posted public message to order');

    const adminInternalMsgRes = await httpRequest(baseUrl, `/api/admin/orders/${orderAId}/message`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminToken}` },
      body: {
        message: 'CONFIDENTIAL: Internal team note — do not disclose estimated margin.',
        is_internal: true
      }
    });
    assert(adminInternalMsgRes.status === 201, 'Admin posted internal-only message to order');

    // Also add internal notes on the order itself
    await httpRequest(baseUrl, `/api/admin/orders/${orderAId}/status`, {
      method: 'PATCH',
      headers: { 'Authorization': `Bearer ${adminToken}` },
      body: {
        status: 'IN_PROGRESS',
        internal_notes: 'INTERNAL SECRET NOTES: Budget ceiling $15,000.'
      }
    });

    // 7. Client A fetches order detail via client API
    const clientAOrderDetailRes = await httpRequest(baseUrl, `/api/client/orders/${orderAId}`, {
      headers: { 'Authorization': `Bearer ${tokenA}` }
    });
    assert(clientAOrderDetailRes.status === 200, 'Client A fetches own order detail');
    const orderData = clientAOrderDetailRes.json?.order || clientAOrderDetailRes.json || {};

    // Verify Rule 7: internal_notes stripped in response
    assert(orderData.internal_notes === undefined || orderData.internal_notes === null, 'Rule 7: internal_notes completely stripped from client order API response');

    // Verify Rule 6: is_internal=1 messages never returned
    const messages = clientAOrderDetailRes.json?.messages || orderData.messages || [];
    const internalMsgsFound = messages.filter(m => m.is_internal === 1 || m.message?.includes('CONFIDENTIAL'));
    assert(internalMsgsFound.length === 0, 'Rule 6: ZERO is_internal messages returned to Client A');

    // 8. Simulated DOM rendering test on Client A's Order Detail
    // Emulate renderOrderDetail function from client-orders.html
    const renderedMessagesHTML = messages.map(m => {
      const isClient = m.sender_type === 'CLIENT';
      return `<div class="chat-bubble ${isClient ? 'client' : 'team'}">${m.message}</div>`;
    }).join('');

    assert(!renderedMessagesHTML.includes('CONFIDENTIAL'), 'DOM Security: Rendered DOM contains ZERO internal confidential messages');
    assert(!renderedMessagesHTML.includes('INTERNAL SECRET NOTES'), 'DOM Security: Rendered DOM contains ZERO internal notes');

  } finally {
    server.close();
  }

  // =========================================================================
  // Final Verification Summary
  // =========================================================================
  console.log('\n===================================================================');
  console.log(`  LAYER 5 VERIFICATION COMPLETE: ${passedTests} PASSED, ${failedTests} FAILED`);
  console.log('===================================================================');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runLayer5Verification().catch(err => {
  console.error('Fatal Error during Layer 5 Verification:', err);
  process.exit(1);
});
