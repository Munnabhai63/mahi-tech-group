/**
 * YOUPI-PG INTEGRATION TEST SUITE
 *
 * Verifies, against a live app instance:
 *  1. Webhook signature enforcement (invalid/missing signatures rejected)
 *  2. Valid HMAC-SHA256 (V2) webhook credits a collection exactly once
 *     (revenue event + splits + wallet balances) and is idempotent
 *  3. Collection creation fails honestly when the gateway is not configured
 *  4. Manual UPI payout flow: approve → PAID with NO fabricated txn id,
 *     UPI intent returned when member has upi_id, UTR attach endpoint
 *     (valid attach, invalid format, double-attach guard)
 *  5. Member upi_id profile update (valid + invalid formats)
 */
import http from 'node:http';
import crypto from 'node:crypto';
import { createApp } from '../src/app.js';
import { runMigration } from '../src/db/migrate.js';
import { runSeed } from '../src/db/seed.js';
import { queryOne, queryAll, execute } from '../src/db/database.js';

const TEST_PORT = 4997;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;
const WEBHOOK_SECRET = 'youpi-test-webhook-secret-0123456789abcdef';
const MERCHANT_KEY = 'youpi-test-merchant-key-0123456789abcdef';

const results = [];
function assert(condition, label) {
  console.log(`  ${condition ? '✓ PASS' : '✗ FAIL'}: ${label}`);
  results.push({ test: label, status: condition ? 'PASS' : 'FAIL' });
}

async function req(method, endpoint, token = null, body = null, extraHeaders = {}) {
  const headers = { 'Content-Type': 'application/json', ...extraHeaders };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE_URL}${endpoint}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, ok: res.ok, data };
}

async function login(email, password) {
  const res = await req('POST', '/api/auth/login', null, { email, password });
  if (!res.ok) throw new Error(`Login failed for ${email}: ${res.status}`);
  return { token: res.data.token, user: res.data.user };
}

async function runYoupiTests() {
  console.log('===================================================================');
  console.log('   YOUPI-PG INTEGRATION VERIFICATION SUITE');
  console.log('===================================================================\n');

  runMigration();
  await runSeed();

  const app = createApp();
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(TEST_PORT, '127.0.0.1', resolve));
  console.log(`[SETUP] Test server on ${BASE_URL}\n`);

  try {
    const admin = await login('admin@mahitechgroup.com', 'AdminPassword@2026');
    const dev = await login('developer@mahitechgroup.com', 'DeveloperPass123!');

    // Baseline project for revenue credit
    const projectId = crypto.randomUUID();
    const ideaId = crypto.randomUUID();
    execute(`INSERT INTO ideas (id, title, description, owner_id, status, created_at, updated_at) VALUES (?, 'YouPI Test Idea', 'x', ?, 'APPROVED', datetime('now'), datetime('now'))`, [ideaId, admin.user.id]);
    execute(`INSERT INTO projects (id, idea_id, org_id, title, owner_id, status, created_at, updated_at) VALUES (?, ?, 'DEFAULT_ORG', 'YouPI Test Project', ?, 'ACTIVE', datetime('now'), datetime('now'))`, [projectId, ideaId, admin.user.id]);
    execute("INSERT INTO project_members (id, project_id, user_id, role_in_project, contribution_weight) VALUES (?, ?, ?, 'backend_dev', 0.0)", [crypto.randomUUID(), projectId, dev.user.id]);

    // -----------------------------------------------------------------
    console.log('--- TEST 1: Collection creation without gateway configured (honest 503) ---');
    const unconfigured = await req('POST', '/api/payments/youpi/collections', admin.token, { project_id: projectId, amount: 500 });
    assert(unconfigured.status === 503, `Unconfigured gateway rejected with 503 (got ${unconfigured.status})`);
    assert(String(unconfigured.data?.error || '').includes('not configured'), 'Error message explains gateway configuration requirement');

    // Configure gateway via Super Admin API
    console.log('\n--- TEST 2: Gateway configuration via Super Admin ---');
    const cfg = await req('PATCH', '/api/superadmin/gateway/config', admin.token, {
      gateway_name: 'youpi',
      mode: 'live',
      api_key: MERCHANT_KEY,
      webhook_secret: WEBHOOK_SECRET,
      base_url: 'http://127.0.0.1:7777'
    });
    assert(cfg.status === 200 && cfg.data.gateway_name === 'youpi', 'Gateway config saved (gateway_name=youpi)');
    assert(cfg.data.base_url === 'http://127.0.0.1:7777', 'YouPI base_url stored');
    assert(cfg.data.api_key_set === 1 || cfg.data.api_key_set === true, 'API key stored (masked read)');

    // -----------------------------------------------------------------
    console.log('\n--- TEST 3: Webhook signature enforcement ---');
    const collectionId = crypto.randomUUID();
    const orderId = `MTG-TEST-${Date.now()}`;
    execute(`
      INSERT INTO payment_collections (id, youpi_payment_id, order_id, project_id, amount, status, description, created_by, created_at)
      VALUES (?, ?, ?, ?, 1000.00, 'CREATED', 'YouPI test collection', ?, CURRENT_TIMESTAMP)
    `, [collectionId, 'pay_test_123', orderId, projectId, admin.user.id]);

    const payloadObj = {
      event: 'SUCCESS',
      deliveryId: crypto.randomUUID(),
      timestamp: Date.now(),
      paymentId: 'pay_test_123',
      orderId,
      amount: '1000.00',
      amountPaise: 100000,
      currency: 'INR',
      method: 'UPI',
      utr: 'UTR123456789',
      verificationTag: 'BANK_SMS_VERIFIED',
      verificationLevel: 2,
      completedAt: new Date().toISOString(),
      metadata: { collection_id: collectionId }
    };
    const payloadString = JSON.stringify(payloadObj);
    const ts = String(Date.now());
    const sigV2 = 'sha256=' + crypto.createHmac('sha256', WEBHOOK_SECRET).update(`${ts}.${payloadString}`).digest('hex');

    const noSig = await req('POST', '/api/payments/youpi/webhook', null, payloadObj);
    assert(noSig.status === 401, `Webhook without signature rejected (got ${noSig.status})`);

    const badSig = await req('POST', '/api/payments/youpi/webhook', null, payloadObj, {
      'X-Gateway-Signature-V2': 'sha256=' + '0'.repeat(64),
      'X-Gateway-Timestamp': ts
    });
    assert(badSig.status === 401, `Webhook with forged signature rejected (got ${badSig.status})`);

    // -----------------------------------------------------------------
    console.log('\n--- TEST 4: Valid signed webhook credits revenue exactly once ---');
    const devWalletBefore = Number(queryOne('SELECT wallet_balance FROM users WHERE id = ?', [dev.user.id]).wallet_balance);
    const ownerWalletBefore = Number(queryOne('SELECT wallet_balance FROM users WHERE id = ?', [admin.user.id]).wallet_balance);

    // NOTE: req() re-serializes the body — signature must match EXACTLY what is sent.
    // So we sign the exact re-serialized string by sending payloadString raw.
    const rawRes = await fetch(`${BASE_URL}/api/payments/youpi/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Gateway-Signature-V2': sigV2,
        'X-Gateway-Timestamp': ts
      },
      body: payloadString
    });
    assert(rawRes.status === 200, `Valid signed webhook accepted (got ${rawRes.status})`);

    const credited = queryOne('SELECT * FROM payment_collections WHERE id = ?', [collectionId]);
    assert(credited.status === 'PAID', 'Collection marked PAID');
    assert(credited.utr === 'UTR123456789', 'UTR recorded from webhook');
    assert(credited.credited_at !== null, 'credited_at timestamp set');

    const revenueEvent = queryOne('SELECT * FROM revenue_events WHERE project_id = ? ORDER BY created_at DESC LIMIT 1', [projectId]);
    assert(Boolean(revenueEvent), 'Revenue event created from collection');
    assert(Number(revenueEvent.amount) === 1000, `Revenue event amount ₹1000 (got ${revenueEvent.amount})`);

    const splits = queryAll('SELECT * FROM revenue_splits WHERE revenue_event_id = ?', [revenueEvent.id]);
    const splitTotal = splits.reduce((s, x) => s + Number(x.amount), 0);
    assert(Math.abs(splitTotal - 1000) < 0.01, `Splits are penny-perfect (total ₹${splitTotal.toFixed(2)})`);

    const devWalletAfter = Number(queryOne('SELECT wallet_balance FROM users WHERE id = ?', [dev.user.id]).wallet_balance);
    const ownerWalletAfter = Number(queryOne('SELECT wallet_balance FROM users WHERE id = ?', [admin.user.id]).wallet_balance);
    assert(devWalletAfter > devWalletBefore, `Contributor wallet credited (₹${devWalletBefore} → ₹${devWalletAfter})`);
    assert(ownerWalletAfter > ownerWalletBefore, `Owner wallet credited via royalty (₹${ownerWalletBefore} → ₹${ownerWalletAfter})`);

    // Idempotency: replay the same webhook
    const replay = await fetch(`${BASE_URL}/api/payments/youpi/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Gateway-Signature-V2': sigV2,
        'X-Gateway-Timestamp': ts
      },
      body: payloadString
    });
    assert(replay.status === 200, `Webhook replay accepted (got ${replay.status})`);
    const revenueCount = queryAll('SELECT id FROM revenue_events WHERE project_id = ?', [projectId]).length;
    assert(revenueCount === 1, `Replay did NOT double-credit (${revenueCount} revenue event)`);

    // -----------------------------------------------------------------
    console.log('\n--- TEST 5: Unknown-session webhook acknowledged without error ---');
    const unknownPayload = JSON.stringify({ event: 'SUCCESS', paymentId: 'does-not-exist', orderId: 'NOPE', amount: '1.00' });
    const tsU = String(Date.now());
    const sigU = 'sha256=' + crypto.createHmac('sha256', WEBHOOK_SECRET).update(`${tsU}.${unknownPayload}`).digest('hex');
    const unknownRes = await fetch(`${BASE_URL}/api/payments/youpi/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Gateway-Signature-V2': sigU, 'X-Gateway-Timestamp': tsU },
      body: unknownPayload
    });
    assert(unknownRes.status === 200, `Unknown session acknowledged (got ${unknownRes.status})`);

    // -----------------------------------------------------------------
    console.log('\n--- TEST 6: Manual UPI payout flow (honest, no fabricated txn ids) ---');
    // Give dev a wallet balance + upi id, request withdrawal
    execute('UPDATE users SET wallet_balance = 4000.00, upi_id = ? WHERE id = ?', ['devtest@okhdfcbank', dev.user.id]);
    const wd = await req('POST', '/api/withdrawals/request', dev.token, { amount: 1500 });
    assert(wd.status === 201, 'Withdrawal requested');

    const approve = await req('PATCH', `/api/admin/withdrawals/${wd.data.withdrawal.id}/approve`, admin.token);
    assert(approve.status === 200, `Withdrawal approved (got ${approve.status})`);
    assert(approve.data.withdrawal.status === 'PAID', 'Withdrawal committed as PAID (funds earmarked)');
    assert(approve.data.withdrawal.gateway_txn_id === null || approve.data.withdrawal.gateway_txn_id === undefined, 'NO fabricated gateway txn id');
    assert(approve.data.gateway.provider === 'MANUAL_UPI_TRANSFER', 'Gateway provider honestly reported as MANUAL_UPI_TRANSFER');
    assert(String(approve.data.gateway.upi_intent || '').startsWith('upi://pay?pa=devtest@okhdfcbank'), 'UPI intent link generated from member upi_id');
    assert(String(approve.data.message || '').includes('UTR'), 'Response instructs admin to record UTR');

    const walletAfterApprove = Number(queryOne('SELECT wallet_balance FROM users WHERE id = ?', [dev.user.id]).wallet_balance);
    assert(Math.abs(walletAfterApprove - 2500) < 0.01, `Wallet debited exactly once (₹4000 - ₹1500 = ₹${walletAfterApprove})`);

    // UTR attach: invalid format
    const badUtr = await req('PATCH', `/api/admin/withdrawals/${wd.data.withdrawal.id}/utr`, admin.token, { utr_reference: 'AB@#' });
    assert(badUtr.status === 400, `Invalid UTR format rejected (got ${badUtr.status})`);

    // UTR attach: valid
    const goodUtr = await req('PATCH', `/api/admin/withdrawals/${wd.data.withdrawal.id}/utr`, admin.token, { utr_reference: 'UTR987654321012' });
    assert(goodUtr.status === 200 && goodUtr.data.withdrawal.gateway_txn_id === 'UTR987654321012', 'Valid UTR recorded against withdrawal');

    // UTR attach: double-attach blocked
    const doubleUtr = await req('PATCH', `/api/admin/withdrawals/${wd.data.withdrawal.id}/utr`, admin.token, { utr_reference: 'UTR111111111111' });
    assert(doubleUtr.status === 409, `Double UTR attach blocked with 409 (got ${doubleUtr.status})`);

    // Non-admin blocked
    const devUtrAttempt = await req('PATCH', `/api/admin/withdrawals/${wd.data.withdrawal.id}/utr`, dev.token, { utr_reference: 'UTR000000000000' });
    assert(devUtrAttempt.status === 403, `Non-admin UTR attach blocked (got ${devUtrAttempt.status})`);

    // -----------------------------------------------------------------
    console.log('\n--- TEST 7: Member upi_id profile management ---');
    const setUppi = await req('PATCH', '/api/users/me/profile', dev.token, { upi_id: 'newvpa@ybl' });
    assert(setUppi.status === 200 && setUppi.data.user.upi_id === 'newvpa@ybl', 'Member can set own UPI ID');

    const badUpi = await req('PATCH', '/api/users/me/profile', dev.token, { upi_id: 'not-a-upi-id' });
    assert(badUpi.status === 400, `Invalid UPI ID format rejected (got ${badUpi.status})`);

    const adminNotif = queryOne("SELECT * FROM notifications WHERE event_type = 'revenue_collected' ORDER BY created_at DESC LIMIT 1");
    assert(Boolean(adminNotif), 'Admin notified about the collected revenue');

  } finally {
    await new Promise((resolve) => server.close(resolve));
    console.log('\n[TEARDOWN] Test server closed.');
  }

  const failed = results.filter(r => r.status === 'FAIL').length;
  console.log('\n===================================================================');
  console.log(`   YOUPI INTEGRATION SUMMARY: ${results.length - failed} PASSED / ${results.length} TOTAL`);
  console.log('===================================================================\n');
  console.table(results);
  process.exit(failed > 0 ? 1 : 0);
}

runYoupiTests().catch((err) => {
  console.error('\n[YOUPI SUITE FATAL]:', err);
  process.exit(1);
});
