// Full end-to-end: simulate bank observation -> YouPI verifies -> webhook -> MTG credits
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MTG = 'http://127.0.0.1:4000';
const YP = 'http://127.0.0.1:6100';
const ADMIN_TOKEN = 'ae021af0fd980d97e1e9c799efddbb26a174ab2912d31170cd4b0e25a880b939';

const { queryOne, queryAll } = await import(pathToFileURL(path.join(__dirname, '..', 'src', 'db', 'database.js')).href);

// Latest CREATED collection
const coll = queryOne("SELECT * FROM payment_collections WHERE status = 'CREATED' ORDER BY created_at DESC LIMIT 1");
console.log('Target collection:', coll.order_id, '| Rs.' + coll.amount, '| youpi:', coll.youpi_payment_id);

const inject = async (source, sender, content) => {
  const res = await fetch(YP + '/api/v1/admin/dev/simulator/inject', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + ADMIN_TOKEN, 'X-Merchant-Key': '26b68fcf71f269aad430c6668efcb74d4d1b620564d4b1258b7d68c04de99baa', 'X-Merchant-Id': '00000000-0000-0000-0000-000000000001' },
    body: JSON.stringify({ paymentSessionId: coll.youpi_payment_id, source, sender, content })
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
};

// Realistic bank SMS (dual-verification stream 1)
const sms = await inject('SMS', 'HDFCBK',
  `Rs 2500.00 credited to A/C XX4821 via UPI from RAHUL SHARMA. Ref no ${coll.order_id}. UPI ref 432198765432.`);
console.log('SMS inject:', sms.status, JSON.stringify(sms.data).slice(0, 300));

// Gmail confirmation (stream 2)
const gmail = await inject('GMAIL', 'notification@hdfcbank.bank.in',
  `Your account has been credited with Rs 2500.00 via UPI. Reference ${coll.order_id}. UPI Ref 432198765432.`);
console.log('GMAIL inject:', gmail.status, JSON.stringify(gmail.data).slice(0, 300));

// Wait for pipeline + webhook to fire
await new Promise(r => setTimeout(r, 6000));

// Verify: YouPI session status
console.log('\n--- RESULTS ---');
console.log('MTG collection:', JSON.stringify(queryOne('SELECT status, utr, credited_at FROM payment_collections WHERE id = ?', [coll.id])));
const rev = queryOne("SELECT amount, source FROM revenue_events ORDER BY created_at DESC LIMIT 1");
console.log('Revenue event:', rev ? `Rs.${rev.amount} — ${String(rev.source).slice(0, 80)}` : 'NONE');
const adminW = queryOne("SELECT wallet_balance FROM users WHERE email='admin@mahitechgroup.com'");
const devW = queryOne("SELECT wallet_balance FROM users WHERE email='developer@mahitechgroup.com'");
console.log('Admin wallet: Rs.' + adminW.wallet_balance, '| Developer wallet: Rs.' + devW.wallet_balance);
