// COMPLETE END-TO-END: MTG collection -> YouPI checkout -> verified payment -> webhook -> auto revenue split
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MTG = 'http://127.0.0.1:4000';
const YP = 'http://127.0.0.1:6100';
const ADMIN_TOKEN = 'ae021af0fd980d97e1e9c799efddbb26a174ab2912d31170cd4b0e25a880b939';
const MKEY = '26b68fcf71f269aad430c6668efcb74d4d1b620564d4b1258b7d68c04de99baa';
const MID = '00000000-0000-0000-0000-000000000001';
const MH = { 'Content-Type': 'application/json', Authorization: `Bearer ${ADMIN_TOKEN}`, 'X-Merchant-Key': MKEY, 'X-Merchant-Id': MID };
const { queryOne, queryAll } = await import(pathToFileURL(path.join(__dirname, '..', 'src', 'db', 'database.js')).href);

console.log('======== STEP 1: MTG collection create ========');
const login = await (await fetch(MTG + '/api/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'admin@mahitechgroup.com', password: 'AdminPassword@2026' })
})).json();
const H = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + login.token };
const proj = queryOne("SELECT id FROM projects WHERE title LIKE 'Zomato%' LIMIT 1");
const coll = await (await fetch(MTG + '/api/payments/youpi/collections', {
  method: 'POST', headers: H,
  body: JSON.stringify({ project_id: proj.id, amount: 1500, customer_name: 'Rahul Sharma', customer_phone: '9876543210', customer_email: 'rahul@democlient.in' })
})).json();
console.log('order:', coll.collection.order_id, '| Rs.' + coll.collection.amount, '| session:', coll.collection.youpi_payment_id);

console.log('\n======== STEP 2: customer OTP (dev) ========');
const otpRes = await (await fetch(YP + '/api/v1/customer/send-otp', {
  method: 'POST', headers: MH,
  body: JSON.stringify({ mobileNumber: '9876543210', name: 'Rahul Sharma', email: 'rahul@democlient.in' })
})).json();
const ver = await (await fetch(YP + '/api/v1/customer/verify-otp', {
  method: 'POST', headers: MH,
  body: JSON.stringify({ mobileNumber: '9876543210', otp: otpRes.devOtp })
})).json();
console.log('verified customer:', ver.customerId ? 'YES' : JSON.stringify(ver).slice(0, 100));
const custH = ver.token ? { Authorization: 'Bearer ' + ver.token } : {};

console.log('\n======== STEP 3: activate payment slot ========');
console.log('bind:', (await fetch(YP + `/api/v1/checkout/${coll.collection.youpi_payment_id}/bind-customer`, { method: 'POST', headers: { ...MH, ...custH } })).status);
const sel = await (await fetch(YP + `/api/v1/checkout/${coll.collection.youpi_payment_id}/select-method`, {
  method: 'POST', headers: { ...MH, ...custH }, body: JSON.stringify({ method: 'UPI' })
})).json();
console.log('slot ACTIVE:', sel.status === 'ACTIVE' || sel.status, '| window:', sel.timeRemainingSeconds + 's');

console.log('\n======== STEP 4: test mode + bank observation ========');
await fetch(YP + '/api/v1/admin/dev/test-mode', { method: 'POST', headers: MH, body: JSON.stringify({ enabled: true }) });
const ref = 'UPI/' + Date.now().toString().slice(-12);
const inj = await (await fetch(YP + '/api/v1/admin/dev/simulator/inject', {
  method: 'POST', headers: MH,
  body: JSON.stringify({
    paymentSessionId: coll.collection.youpi_payment_id,
    source: 'GMAIL', sender: 'notification@hdfcbank.bank.in',
    content: `Your account has been credited with Rs 1500.00 via UPI. Reference ${ref}. UPI Ref ${Math.floor(Math.random() * 1e12)}.`
  })
})).json();
console.log('verification engine verdict:', inj.status, inj.status || JSON.stringify(inj).slice(0, 150));

console.log('\n======== STEP 5: waiting for webhook -> MTG auto-credit ========');
await new Promise(r => setTimeout(r, 8000));

console.log('======== FINAL RESULTS ========');
console.log('MTG collection:', JSON.stringify(queryOne('SELECT order_id, status, utr, credited_at FROM payment_collections WHERE id = ?', [coll.collection.id])));
const rev = queryOne("SELECT amount, source FROM revenue_events ORDER BY created_at DESC LIMIT 1");
console.log('Revenue event:', rev ? `Rs.${rev.amount} — ${String(rev.source).slice(0, 70)}` : 'NONE');
const before = { admin: 1000, dev: 3200 };
const now = queryAll("SELECT email, wallet_balance FROM users WHERE email IN ('admin@mahitechgroup.com','developer@mahitechgroup.com')");
console.log('Wallets:', JSON.stringify(now), '(admin owner-royalty 50% | dev team-split)');
const notif = queryOne("SELECT message FROM notifications WHERE event_type='revenue_collected' ORDER BY created_at DESC LIMIT 1");
console.log('Admin notification:', notif ? notif.message.slice(0, 90) : 'none');
