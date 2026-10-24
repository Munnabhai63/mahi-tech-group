import crypto from 'node:crypto';
const BASE = 'http://127.0.0.1:4000';
const WEBHOOK_SECRET = 'demo-webhook-secret-change-me-1234567890';
const MERCHANT_KEY = 'demo-merchant-key-change-me-1234567890';

async function req(method, path, token, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

const login = await req('POST', '/api/auth/login', null, { email: 'admin@mahitechgroup.com', password: 'AdminPassword@2026' });
console.log('1) Admin login:', login.status === 200 ? 'OK' : 'FAIL');

const cfg = await req('PATCH', '/api/superadmin/gateway/config', login.data.token, {
  gateway_name: 'youpi', mode: 'sandbox',
  api_key: MERCHANT_KEY, webhook_secret: WEBHOOK_SECRET,
  base_url: 'http://127.0.0.1:7000'
});
console.log('2) YouPI gateway config:', cfg.status === 200 ? 'SAVED (encrypted)' : JSON.stringify(cfg.data));

const { queryOne, execute } = await import(new URL('../src/db/database.js', import.meta.url).href);
const admin = queryOne("SELECT id, wallet_balance FROM users WHERE email='admin@mahitechgroup.com'");
const dev = queryOne("SELECT id, wallet_balance, upi_id FROM users WHERE email='developer@mahitechgroup.com'");
execute("UPDATE users SET upi_id = 'demo.dev@okaxis' WHERE id = ?", [dev.id]);
const before = { admin: Number(admin.wallet_balance), dev: Number(dev.wallet_balance) };

const iid = crypto.randomUUID(), pid = crypto.randomUUID(), cid = crypto.randomUUID();
const orderId = `MTG-DEMO-${Date.now().toString().slice(-6)}`;
execute("INSERT INTO ideas (id,title,description,owner_id,status) VALUES (?,'YouPI Live Demo Idea','browser verification',?,'APPROVED')", [iid, admin.id]);
execute("INSERT INTO projects (id,idea_id,org_id,title,owner_id,status) VALUES (?,?,'DEFAULT_ORG','YouPI Live Demo Project',?,'ACTIVE')", [pid, iid, admin.id]);
execute("INSERT INTO project_members (id,project_id,user_id,role_in_project,contribution_weight) VALUES (?,?,?,'backend_dev',0.0)", [crypto.randomUUID(), pid, dev.id]);
execute("INSERT INTO payment_collections (id,youpi_payment_id,order_id,project_id,amount,status,description,created_by) VALUES (?,'pay_demo_123',?,?,2000.00,'CREATED','LIVE BROWSER DEMO',?)", [cid, orderId, pid, admin.id]);
console.log('3) Demo collection created:', orderId, '(Rs.2000)');

const payload = JSON.stringify({
  event: 'SUCCESS', deliveryId: crypto.randomUUID(), timestamp: Date.now(),
  paymentId: 'pay_demo_123', orderId, amount: '2000.00', amountPaise: 200000,
  currency: 'INR', method: 'UPI', utr: 'DEMO-UTR-778899',
  verificationTag: 'BANK_SMS_VERIFIED', verificationLevel: 2,
  completedAt: new Date().toISOString(), metadata: {}
});
const ts = String(Date.now());
const sig = 'sha256=' + crypto.createHmac('sha256', WEBHOOK_SECRET).update(`${ts}.${payload}`).digest('hex');

const bad = await fetch(BASE + '/api/payments/youpi/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Gateway-Signature-V2': 'sha256=' + '0'.repeat(64), 'X-Gateway-Timestamp': ts }, body: payload });
console.log('4a) GALAT signature wala webhook ->', bad.status, '(401 = blocked OK)');
const good = await fetch(BASE + '/api/payments/youpi/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Gateway-Signature-V2': sig, 'X-Gateway-Timestamp': ts }, body: payload });
console.log('4b) SAHI signature wala webhook ->', good.status, '(200 = accepted OK)');

const coll = queryOne('SELECT status, utr, credited_at FROM payment_collections WHERE id = ?', [cid]);
const rev = queryOne('SELECT amount, source FROM revenue_events WHERE project_id = ? ORDER BY created_at DESC LIMIT 1', [pid]);
const after = { admin: Number(queryOne('SELECT wallet_balance FROM users WHERE id=?', [admin.id]).wallet_balance), dev: Number(queryOne('SELECT wallet_balance FROM users WHERE id=?', [dev.id]).wallet_balance) };
console.log('\n===== RESULT =====');
console.log('Collection status:', coll.status, '| UTR:', coll.utr, '| credited_at:', coll.credited_at);
console.log('Revenue event:', rev ? `Rs.${rev.amount} - ${rev.source}` : 'MISSING');
console.log(`Admin wallet: Rs.${before.admin} -> Rs.${after.admin} (+Rs.${(after.admin - before.admin).toFixed(2)} owner royalty)`);
console.log(`Developer wallet: Rs.${before.dev} -> Rs.${after.dev} (+Rs.${(after.dev - before.dev).toFixed(2)} team split)`);
console.log('\nBrowser check: Admin Panel -> Revenue -> "YouPI UPI Collections" card -> order', orderId, '= PAID');
process.exit(0);
