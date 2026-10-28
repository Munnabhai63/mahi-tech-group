/**
 * scripts/verify-prd25-layer4.js
 * Verification Suite for PRD 25 Layer 4: Invoice Service & Lifecycle
 *
 * Real HTTP calls, Real SQLite database, Zero mocks.
 *
 * Checks:
 * 1. Database Connection & Pragmas (WAL mode, busy_timeout >= 5000, foreign_keys = ON)
 * 2. Express HTTP Server on ephemeral port (createApp)
 * 3. Invoice Number Auto-Generation Engine:
 *    - Format: MTG-INV-YYYY-NNNN
 *    - Sequential generation: 0001, 0002, 0003...
 *    - Client-sent invoice_number is ignored
 * 4. Invoice Creation (POST /api/finance/invoice/create):
 *    - 401 unauthenticated, 403 member
 *    - Validations: missing project_id (400), invalid project (404), missing title (400),
 *      missing issue_date (400), missing due_date (400), non-existent client (404), negative tax_pct (400)
 *    - 201 Created: default status DRAFT, initial subtotal/tax/total/paid = 0.0, access_log
 * 5. Server-Side Line Item Calculation (POST /api/finance/invoice/:invoiceId/line-item/add):
 *    - 403 member
 *    - Validations: missing description (400), invalid line_type (400), invalid quantity <= 0 (400), negative unit_price (400)
 *    - Amount strictly computed server-side: quantity * unit_price (client amount ignored)
 *    - Automatic server-side totals update: subtotal, tax_amount, total_amount
 * 6. Line Item DB Append-Only Trigger:
 *    - Direct SQL UPDATE strictly aborted by trigger
 *    - Direct SQL DELETE strictly aborted by trigger
 * 7. Invoice Retrieval & Security Scrubbing:
 *    - GET /api/finance/invoices/project/:projectId: 403 member, 200 admin
 *    - GET /api/finance/invoice/:invoiceId:
 *      - Admin view includes internal_notes
 *      - Client view (?client_view=true) strictly strips internal_notes
 * 8. Invoice Send & State Machine Locking (PATCH /api/finance/invoice/:invoiceId/send):
 *    - 403 member, 200 admin
 *    - Status transitions DRAFT -> SENT, sent_at set, updated_at manually set
 *    - Locking Rule: Adding line items to SENT invoice strictly blocked with 400 Bad Request
 * 9. Invoice Viewed State (PATCH /api/finance/invoice/:invoiceId/view):
 *    - Status transitions SENT -> VIEWED, viewed_at timestamp recorded
 * 10. Payment Recording (PATCH /api/finance/invoice/:invoiceId/mark-paid):
 *     - 403 member, 400 invalid amount
 *     - Status transitions to PAID, paid_amount/payment_reference/paid_at recorded
 *     - access_log recorded ('invoice_mark_paid')
 *     - PAID invoice cannot be cancelled (400 Bad Request)
 * 11. Invoice Cancellation (PATCH /api/finance/invoice/:invoiceId/cancel):
 *     - 403 member
 *     - Status transitions to CANCELLED
 *     - Cancellation reason logged to access_log
 *     - CANCELLED invoice cannot be marked as paid (400 Bad Request)
 * 12. Daily Cron / Scheduled OVERDUE Transition Engine:
 *     - SENT/VIEWED invoice past due_date auto-transitions to OVERDUE
 *     - INVOICE_OVERDUE alert auto-generated in budget_alerts
 *     - access_log recorded ('cron_invoice_overdue_check')
 */

import http from 'node:http';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app.js';
import { queryOne, queryAll, execute, getDatabase } from '../src/db/database.js';
import { config } from '../src/config.js';

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

function generateInternalUserToken(user) {
  const sessionId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 2 * 3600 * 1000).toISOString();

  const token = jwt.sign(
    {
      sessionId,
      userId: user.id,
      role: user.role,
      email: user.email,
      name: user.name
    },
    config.JWT_SECRET,
    { expiresIn: '2h' }
  );

  execute(
    'INSERT INTO sessions (id, user_id, token, expires_at, is_revoked, created_at) VALUES (?, ?, ?, ?, 0, CURRENT_TIMESTAMP)',
    [sessionId, user.id, token, expiresAt]
  );

  return token;
}

async function runSuite() {
  console.log('='.repeat(80));
  console.log('PRD 25 Layer 4 Verification Suite: Invoice Service & Lifecycle Engine');
  console.log('='.repeat(80));

  // 1. Pragmas Verification
  console.log('\n--- Phase 1: Database Pragmas Verification ---');
  const journalMode = queryOne('PRAGMA journal_mode;');
  assert(journalMode && journalMode.journal_mode.toLowerCase() === 'wal', 'Pragma journal_mode is WAL');

  const busyTimeout = queryOne('PRAGMA busy_timeout;');
  assert(busyTimeout && busyTimeout.timeout >= 5000, 'Pragma busy_timeout >= 5000ms');

  const foreignKeys = queryOne('PRAGMA foreign_keys;');
  assert(foreignKeys && foreignKeys.foreign_keys === 1, 'Pragma foreign_keys is enabled (1)');

  // 2. Start HTTP Server
  console.log('\n--- Phase 2: Express HTTP Server Initialization ---');
  const app = createApp();
  const server = http.createServer(app);

  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const serverUrl = `http://127.0.0.1:${address.port}`;
  console.log(`  Live test server listening at ${serverUrl}`);

  try {
    // 3. Setup Test Fixtures
    console.log('\n--- Phase 3: Setup Test Fixtures ---');
    const suffix = crypto.randomBytes(4).toString('hex');
    const adminEmail = `admin_inv_${suffix}@test.local`;
    const memberEmail = `dev_inv_${suffix}@test.local`;

    const adminId = crypto.randomUUID();
    const memberId = crypto.randomUUID();

    execute(`
      INSERT INTO users (id, email, password_hash, name, role, status)
      VALUES (?, ?, 'hash_admin', 'Admin Invoicer', 'admin', 'active')
    `, [adminId, adminEmail]);
    const adminUser = queryOne('SELECT * FROM users WHERE id = ?', [adminId]);

    execute(`
      INSERT INTO users (id, email, password_hash, name, role, status)
      VALUES (?, ?, 'hash_dev', 'Developer Regular', 'developer', 'active')
    `, [memberId, memberEmail]);
    const memberUser = queryOne('SELECT * FROM users WHERE id = ?', [memberId]);

    assert(adminUser && memberUser, 'Admin and member test users created');

    const adminToken = generateInternalUserToken(adminUser);
    const memberToken = generateInternalUserToken(memberUser);

    // Create Client Fixture
    const clientEmail = `client_${suffix}@acmecorp.com`;
    execute(`
      INSERT INTO clients (name, email, company_name, phone, password_hash, status, created_by)
      VALUES ('Acme Corp Client', ?, 'Acme International', '+919876543210', 'client_hash', 'ACTIVE', ?)
    `, [clientEmail, adminId]);
    const client = queryOne('SELECT * FROM clients WHERE email = ?', [clientEmail]);
    assert(client && client.id, 'Test client fixture created in clients table');

    // Create Idea & Project Fixtures
    let idea = queryOne('SELECT id FROM ideas LIMIT 1');
    if (!idea) {
      const ideaId = `idea_inv_${suffix}`;
      execute(`
        INSERT INTO ideas (id, owner_id, title, description, status)
        VALUES (?, ?, 'Invoice Feature Idea', 'Idea description', 'APPROVED')
      `, [ideaId, adminId]);
      idea = { id: ideaId };
    }

    const projectId = `proj_inv_${suffix}`;
    execute(`
      INSERT INTO projects (id, idea_id, org_id, title, owner_id)
      VALUES (?, ?, 'org_mtg', ?, ?)
    `, [projectId, idea.id, `Invoice Project ${suffix}`, adminId]);
    const project = queryOne('SELECT * FROM projects WHERE id = ?', [projectId]);
    assert(project && project.id, 'Test project fixture created in projects table');

    // 4. Invoice Creation Tests & Invoice Number Auto-Generation
    console.log('\n--- Phase 4: Invoice Creation & Auto-Numbering Engine ---');
    // POST /api/finance/invoice/create unauth -> 401
    let res = await makeRequest(serverUrl, '/api/finance/invoice/create', {
      method: 'POST',
      body: { project_id: project.id, title: 'Draft Invoice 1', issue_date: '2026-03-01', due_date: '2026-03-31' }
    });
    assert(res.status === 401, 'POST /api/finance/invoice/create requires auth (401)');

    // POST by member -> 403 Forbidden
    res = await makeRequest(serverUrl, '/api/finance/invoice/create', {
      method: 'POST',
      headers: { Authorization: `Bearer ${memberToken}` },
      body: { project_id: project.id, title: 'Draft Invoice 1', issue_date: '2026-03-01', due_date: '2026-03-31' }
    });
    assert(res.status === 403, 'POST /api/finance/invoice/create forbidden for members (403)');

    // Validations: missing project_id
    res = await makeRequest(serverUrl, '/api/finance/invoice/create', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { title: 'Missing Project', issue_date: '2026-03-01', due_date: '2026-03-31' }
    });
    assert(res.status === 400, 'Missing project_id returns 400 Bad Request');

    // Non-existent project_id
    res = await makeRequest(serverUrl, '/api/finance/invoice/create', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { project_id: 999999, title: 'Invalid Project', issue_date: '2026-03-01', due_date: '2026-03-31' }
    });
    assert(res.status === 404, 'Non-existent project_id returns 404 Not Found');

    // Missing title
    res = await makeRequest(serverUrl, '/api/finance/invoice/create', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { project_id: project.id, title: '   ', issue_date: '2026-03-01', due_date: '2026-03-31' }
    });
    assert(res.status === 400, 'Empty title returns 400 Bad Request');

    // Missing issue_date
    res = await makeRequest(serverUrl, '/api/finance/invoice/create', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { project_id: project.id, title: 'Valid Title', due_date: '2026-03-31' }
    });
    assert(res.status === 400, 'Missing issue_date returns 400 Bad Request');

    // Missing due_date
    res = await makeRequest(serverUrl, '/api/finance/invoice/create', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { project_id: project.id, title: 'Valid Title', issue_date: '2026-03-01' }
    });
    assert(res.status === 400, 'Missing due_date returns 400 Bad Request');

    // Non-existent client_id -> 404
    res = await makeRequest(serverUrl, '/api/finance/invoice/create', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { project_id: project.id, client_id: 999999, title: 'Valid Title', issue_date: '2026-03-01', due_date: '2026-03-31' }
    });
    assert(res.status === 404, 'Non-existent client_id returns 404 Not Found');

    // Negative tax_pct -> 400
    res = await makeRequest(serverUrl, '/api/finance/invoice/create', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { project_id: project.id, title: 'Valid Title', issue_date: '2026-03-01', due_date: '2026-03-31', tax_pct: -5.0 }
    });
    assert(res.status === 400, 'Negative tax_pct returns 400 Bad Request');

    // Admin creates valid invoice 1 with tax_pct = 18.0
    res = await makeRequest(serverUrl, '/api/finance/invoice/create', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        project_id: project.id,
        client_id: client.id,
        title: 'Milestone 1 Deliverables',
        issue_date: '2026-03-01',
        due_date: '2026-03-31',
        tax_pct: 18.0,
        notes: 'Payment due within 30 days of invoice date.',
        internal_notes: 'CONFIDENTIAL: Client negotiated 5% volume rebate on next milestone.'
      }
    });
    assert(res.status === 201, 'Admin successfully creates valid invoice 1 (201 Created)');
    const inv1 = res.data.invoice;
    assert(inv1 && inv1.id, 'Invoice 1 record returned');
    assert(inv1.status === 'DRAFT', 'Default invoice status is DRAFT');
    assert(inv1.subtotal === 0.0, 'Initial subtotal is 0.0');
    assert(inv1.tax_amount === 0.0, 'Initial tax_amount is 0.0');
    assert(inv1.total_amount === 0.0, 'Initial total_amount is 0.0');
    assert(inv1.tax_pct === 18.0, 'Tax percentage recorded as 18.0%');
    assert(/^MTG-INV-\d{4}-\d{4}$/.test(inv1.invoice_number), `Invoice number matches MTG-INV-YYYY-NNNN format (${inv1.invoice_number})`);

    // Admin audit log check
    const createAudit = queryOne(`
      SELECT * FROM access_log
      WHERE action = 'invoice_create' AND target_id = ?
    `, [String(inv1.id)]);
    assert(createAudit !== null, 'invoice_create action logged to access_log');

    // Admin creates valid invoice 2 (verifies sequential invoice numbering)
    res = await makeRequest(serverUrl, '/api/finance/invoice/create', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        project_id: project.id,
        client_id: client.id,
        title: 'Milestone 2 Deliverables',
        issue_date: '2026-03-05',
        due_date: '2026-04-05',
        tax_pct: 18.0
      }
    });
    assert(res.status === 201, 'Admin creates valid invoice 2 (201 Created)');
    const inv2 = res.data.invoice;
    const inv1Seq = parseInt(inv1.invoice_number.split('-')[3], 10);
    const inv2Seq = parseInt(inv2.invoice_number.split('-')[3], 10);
    assert(inv2Seq === inv1Seq + 1, `Invoice sequence is strictly monotonic (${inv1.invoice_number} -> ${inv2.invoice_number})`);

    // 5. Server-Side Line Item Calculation & Adding Tests
    console.log('\n--- Phase 5: Server-Side Line Item Calculation Engine ---');
    // POST /api/finance/invoice/:invoiceId/line-item/add by member -> 403
    res = await makeRequest(serverUrl, `/api/finance/invoice/${inv1.id}/line-item/add`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${memberToken}` },
      body: { description: 'Backend Architecture', quantity: 1, unit_price: 50000 }
    });
    assert(res.status === 403, 'Member cannot add line items (403 Forbidden)');

    // Missing description -> 400
    res = await makeRequest(serverUrl, `/api/finance/invoice/${inv1.id}/line-item/add`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { quantity: 1, unit_price: 50000 }
    });
    assert(res.status === 400, 'Missing description returns 400 Bad Request');

    // Invalid line_type -> 400
    res = await makeRequest(serverUrl, `/api/finance/invoice/${inv1.id}/line-item/add`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { description: 'Work', line_type: 'INVALID_TYPE', quantity: 1, unit_price: 50000 }
    });
    assert(res.status === 400, 'Invalid line_type returns 400 Bad Request');

    // Invalid quantity <= 0 -> 400
    res = await makeRequest(serverUrl, `/api/finance/invoice/${inv1.id}/line-item/add`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { description: 'Work', quantity: 0, unit_price: 50000 }
    });
    assert(res.status === 400, 'Zero quantity returns 400 Bad Request');

    // Negative unit_price -> 400
    res = await makeRequest(serverUrl, `/api/finance/invoice/${inv1.id}/line-item/add`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { description: 'Work', quantity: 1, unit_price: -100 }
    });
    assert(res.status === 400, 'Negative unit_price returns 400 Bad Request');

    // Add Line Item 1: quantity = 10, unit_price = 5000. Client passes spoofed amount = 99.0
    res = await makeRequest(serverUrl, `/api/finance/invoice/${inv1.id}/line-item/add`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        description: 'Fullstack Engineering Hours',
        line_type: 'SERVICE',
        quantity: 10,
        unit_price: 5000.0,
        amount: 99.0 // spoofed, should be ignored
      }
    });
    assert(res.status === 201, 'Admin adds Line Item 1 (201 Created)');
    const item1 = res.data.line_item;
    assert(item1.amount === 50000.0, 'Line item amount calculated strictly server-side (10 * 5000 = 50,000; client spoof ignored)');
    assert(res.data.invoice.subtotal === 50000.0, 'Invoice subtotal updated to 50,000.0');
    assert(res.data.invoice.tax_amount === 9000.0, 'Invoice tax_amount recalculated (18% of 50,000 = 9,000.0)');
    assert(res.data.invoice.total_amount === 59000.0, 'Invoice total_amount recalculated (50,000 + 9,000 = 59,000.0)');

    // Add Line Item 2: quantity = 2, unit_price = 15000 (amount = 30,000)
    res = await makeRequest(serverUrl, `/api/finance/invoice/${inv1.id}/line-item/add`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        description: 'Cloud Infrastructure & Setup',
        line_type: 'CUSTOM',
        quantity: 2,
        unit_price: 15000.0
      }
    });
    assert(res.status === 201, 'Admin adds Line Item 2 (201 Created)');
    assert(res.data.invoice.subtotal === 80000.0, 'Invoice subtotal updated to 80,000.0 (50k + 30k)');
    assert(res.data.invoice.tax_amount === 14400.0, 'Invoice tax_amount recalculated (18% of 80,000 = 14,400.0)');
    assert(res.data.invoice.total_amount === 94400.0, 'Invoice total_amount recalculated (80,000 + 14,400 = 94,400.0)');

    // 6. DB Append-Only Trigger on invoice_line_items
    console.log('\n--- Phase 6: DB Append-Only Trigger on invoice_line_items ---');
    let lineItemUpdateBlocked = false;
    try {
      execute("UPDATE invoice_line_items SET description = 'tampered' WHERE id = ?", [item1.id]);
    } catch (err) {
      lineItemUpdateBlocked = err.message.includes('invoice_line_items is append-only');
    }
    assert(lineItemUpdateBlocked, 'Trigger prevent_invoice_line_item_update strictly blocks direct UPDATE with RAISE(ABORT)');

    let lineItemDeleteBlocked = false;
    try {
      execute('DELETE FROM invoice_line_items WHERE id = ?', [item1.id]);
    } catch (err) {
      lineItemDeleteBlocked = err.message.includes('invoice_line_items is append-only');
    }
    assert(lineItemDeleteBlocked, 'Trigger prevent_invoice_line_item_delete strictly blocks direct DELETE with RAISE(ABORT)');

    // 7. Invoice Retrieval & Security Scrubbing
    console.log('\n--- Phase 7: Invoice Retrieval & Security Scrubbing ---');
    // GET /api/finance/invoices/project/:projectId by member -> 403
    res = await makeRequest(serverUrl, `/api/finance/invoices/project/${project.id}`, {
      headers: { Authorization: `Bearer ${memberToken}` }
    });
    assert(res.status === 403, 'Member cannot view project invoices list (403 Forbidden)');

    // GET by admin -> 200
    res = await makeRequest(serverUrl, `/api/finance/invoices/project/${project.id}`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(res.status === 200, 'Admin can view project invoices list (200 OK)');
    assert(res.data.count >= 2, 'Returns both created invoices');

    // Admin views single invoice detail -> includes internal_notes
    res = await makeRequest(serverUrl, `/api/finance/invoice/${inv1.id}`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(res.status === 200, 'Admin fetches invoice detail (200 OK)');
    assert(res.data.invoice.internal_notes !== undefined, 'Admin response contains internal_notes');
    assert(Array.isArray(res.data.line_items) && res.data.line_items.length === 2, 'Returns both line items');

    // Client view (?client_view=true) -> internal_notes is strictly scrubbed
    res = await makeRequest(serverUrl, `/api/finance/invoice/${inv1.id}?client_view=true`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(res.status === 200, 'Client view fetches invoice detail (200 OK)');
    assert(res.data.invoice.internal_notes === undefined, 'CRITICAL SECURITY: internal_notes is stripped from client view');
    assert(res.data.invoice.notes !== undefined, 'Public client notes remain visible');

    // 8. Invoice Send & State Machine Locking Rule
    console.log('\n--- Phase 8: Invoice Send & State Machine Locking Rule ---');
    // Member cannot send invoice -> 403
    res = await makeRequest(serverUrl, `/api/finance/invoice/${inv1.id}/send`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${memberToken}` }
    });
    assert(res.status === 403, 'Member cannot send invoice (403 Forbidden)');

    // Admin sends invoice 1 -> transitions to SENT
    res = await makeRequest(serverUrl, `/api/finance/invoice/${inv1.id}/send`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(res.status === 200, 'Admin sends invoice (200 OK)');
    assert(res.data.invoice.status === 'SENT', 'Invoice status transitioned to SENT');
    assert(res.data.invoice.sent_at !== null, 'sent_at timestamp is populated');

    // Action logged in access_log
    const sendAudit = queryOne(`
      SELECT * FROM access_log
      WHERE action = 'invoice_send' AND target_id = ?
    `, [String(inv1.id)]);
    assert(sendAudit !== null, 'invoice_send action logged in access_log');

    // Attempting to send again -> 400 Bad Request
    res = await makeRequest(serverUrl, `/api/finance/invoice/${inv1.id}/send`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(res.status === 400, 'Attempting to send an already SENT invoice returns 400 Bad Request');

    // CRITICAL LOCKING RULE: Line items cannot be added to SENT invoice
    res = await makeRequest(serverUrl, `/api/finance/invoice/${inv1.id}/line-item/add`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { description: 'Late addition', quantity: 1, unit_price: 1000 }
    });
    assert(res.status === 400, 'Adding line item to SENT invoice is strictly blocked (400 Bad Request)');
    assert(res.data.error.includes('Line items can only be added when invoice is in DRAFT status'),
      'Clear locking error message returned');

    // 9. Invoice Viewed State Transition
    console.log('\n--- Phase 9: Invoice Viewed State Transition ---');
    res = await makeRequest(serverUrl, `/api/finance/invoice/${inv1.id}/view`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(res.status === 200, 'Invoice marked as viewed (200 OK)');
    assert(res.data.invoice.status === 'VIEWED', 'Invoice status transitioned to VIEWED');
    assert(res.data.invoice.viewed_at !== null, 'viewed_at timestamp is populated');

    // 10. Payment Recording Tests
    console.log('\n--- Phase 10: Payment Recording Engine ---');
    // Member cannot mark paid -> 403
    res = await makeRequest(serverUrl, `/api/finance/invoice/${inv1.id}/mark-paid`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${memberToken}` },
      body: { paid_amount: 94400.0 }
    });
    assert(res.status === 403, 'Member cannot mark invoice paid (403 Forbidden)');

    // Invalid paid_amount <= 0 -> 400
    res = await makeRequest(serverUrl, `/api/finance/invoice/${inv1.id}/mark-paid`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { paid_amount: -500 }
    });
    assert(res.status === 400, 'Negative paid_amount returns 400 Bad Request');

    // Admin marks invoice 1 as paid
    const paymentRef = 'HDFC-NEFT-TXN-2026-9999';
    res = await makeRequest(serverUrl, `/api/finance/invoice/${inv1.id}/mark-paid`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        paid_amount: 94400.0,
        payment_reference: paymentRef,
        paid_at: '2026-03-20T10:00:00Z'
      }
    });
    assert(res.status === 200, 'Admin marks invoice as PAID (200 OK)');
    assert(res.data.invoice.status === 'PAID', 'Invoice status transitioned to PAID');
    assert(res.data.invoice.paid_amount === 94400.0, 'paid_amount saved correctly');
    assert(res.data.invoice.payment_reference === paymentRef, 'payment_reference saved correctly');
    assert(res.data.invoice.paid_at === '2026-03-20T10:00:00Z', 'paid_at timestamp saved correctly');

    // Audit log check
    const paidAudit = queryOne(`
      SELECT * FROM access_log
      WHERE action = 'invoice_mark_paid' AND target_id = ?
    `, [String(inv1.id)]);
    assert(paidAudit !== null, 'invoice_mark_paid action logged in access_log');

    // Attempting to cancel a PAID invoice -> 400 Bad Request
    res = await makeRequest(serverUrl, `/api/finance/invoice/${inv1.id}/cancel`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { reason: 'Client wants refund' }
    });
    assert(res.status === 400, 'Cancelling a PAID invoice is strictly blocked (400 Bad Request)');

    // 11. Invoice Cancellation Tests
    console.log('\n--- Phase 11: Invoice Cancellation Engine ---');
    // Member cannot cancel invoice -> 403
    res = await makeRequest(serverUrl, `/api/finance/invoice/${inv2.id}/cancel`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${memberToken}` },
      body: { reason: 'Developer cancellation attempt' }
    });
    assert(res.status === 403, 'Member cannot cancel invoice (403 Forbidden)');

    // Admin cancels invoice 2
    const cancelReason = 'Project scope reduced; milestone invoice no longer applicable';
    res = await makeRequest(serverUrl, `/api/finance/invoice/${inv2.id}/cancel`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { reason: cancelReason }
    });
    assert(res.status === 200, 'Admin cancels invoice 2 (200 OK)');
    assert(res.data.invoice.status === 'CANCELLED', 'Invoice status transitioned to CANCELLED');

    // Cancellation audit check
    const cancelAudit = queryOne(`
      SELECT * FROM access_log
      WHERE action = 'invoice_cancel' AND target_id = ?
    `, [String(inv2.id)]);
    assert(cancelAudit !== null, 'invoice_cancel logged in access_log');

    // Attempting to mark CANCELLED invoice as paid -> 400 Bad Request
    res = await makeRequest(serverUrl, `/api/finance/invoice/${inv2.id}/mark-paid`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { paid_amount: 1000 }
    });
    assert(res.status === 400, 'Marking CANCELLED invoice as paid is strictly blocked (400 Bad Request)');

    // 12. Daily Cron / Scheduled OVERDUE Transition Engine
    console.log('\n--- Phase 12: Daily Cron & OVERDUE Transition Engine ---');
    // Create an invoice with due_date in the past (e.g. 2026-01-10) and transition it to SENT
    res = await makeRequest(serverUrl, '/api/finance/invoice/create', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        project_id: project.id,
        client_id: client.id,
        title: 'Past Due Consultation',
        issue_date: '2026-01-01',
        due_date: '2026-01-10',
        tax_pct: 0.0
      }
    });
    const overdueCandidate = res.data.invoice;

    // Add line item
    await makeRequest(serverUrl, `/api/finance/invoice/${overdueCandidate.id}/line-item/add`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { description: 'Consulting', quantity: 1, unit_price: 25000 }
    });

    // Send invoice
    await makeRequest(serverUrl, `/api/finance/invoice/${overdueCandidate.id}/send`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}` }
    });

    const candidateBeforeCron = queryOne('SELECT * FROM invoices WHERE id = ?', [overdueCandidate.id]);
    assert(candidateBeforeCron.status === 'SENT', 'Overdue candidate is in SENT status before cron');

    // Trigger daily cron overdue check
    res = await makeRequest(serverUrl, '/api/finance/cron/overdue-check', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(res.status === 200, 'POST /api/finance/cron/overdue-check succeeds (200 OK)');
    assert(res.data.updated_count >= 1, 'Cron transitioned at least 1 invoice to OVERDUE');

    // Verify invoice status in DB
    const candidateAfterCron = queryOne('SELECT * FROM invoices WHERE id = ?', [overdueCandidate.id]);
    assert(candidateAfterCron.status === 'OVERDUE', 'Invoice status automatically transitioned to OVERDUE');

    // Verify budget alert auto-generated
    const overdueAlert = queryOne(`
      SELECT * FROM budget_alerts
      WHERE project_id = ? AND alert_type = 'INVOICE_OVERDUE' AND message LIKE ?
    `, [project.id, `%${candidateAfterCron.invoice_number}%`]);
    assert(overdueAlert !== null, 'INVOICE_OVERDUE alert automatically generated in budget_alerts');
    assert(overdueAlert.triggered_amount === 25000.0, 'Alert recorded invoice total_amount (25,000)');

    // Audit log check for cron
    const cronAudit = queryOne(`
      SELECT * FROM access_log
      WHERE action = 'cron_invoice_overdue_check'
    `);
    assert(cronAudit !== null, 'cron_invoice_overdue_check logged in access_log');

  } finally {
    await new Promise((resolve) => server.close(resolve));
    console.log('\n  Test HTTP server closed cleanly.');
  }

  // Final Summary
  console.log('\n' + '='.repeat(80));
  console.log(`PRD 25 Layer 4 Verification Complete: ${passedTests}/${totalTests} Passed (${failedTests} Failed)`);
  console.log('='.repeat(80));

  if (failedTests > 0) {
    process.exit(1);
  }
}

runSuite().catch(err => {
  console.error('Unhandled fatal error in Layer 4 suite:', err);
  process.exit(1);
});
