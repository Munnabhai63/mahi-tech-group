// Full real checkout flow via API: signup OTP -> verify -> session ACTIVE -> pay simulation
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
const coll = queryOne("SELECT * FROM payment_collections WHERE status = 'CREATED' ORDER BY created_at DESC LIMIT 1");
console.log('collection:', coll.order_id, '| session:', coll.youpi_payment_id);

// 1) Request signup OTP (returns devOtp since YOUPI_EXPOSE_DEV_OTP=true in dev)
const otpRes = await (await fetch(YP + '/api/v1/customer/send-otp', {
  method: 'POST', headers: MH,
  body: JSON.stringify({ mobileNumber: '9876543210', name: 'Rahul Sharma', email: 'rahul@democlient.in' })
})).json();
console.log('1) OTP response:', JSON.stringify(otpRes).slice(0, 220));
const otp = otpRes.devOtp;
if (!otp) throw new Error('devOtp not returned');

// 2) Verify OTP → customer session token
const ver = await (await fetch(YP + '/api/v1/customer/verify-otp', {
  method: 'POST', headers: MH,
  body: JSON.stringify({ mobileNumber: '9876543210', otp })
})).json();
console.log('2) verify:', JSON.stringify(ver).slice(0, 200));
const custToken = ver.sessionToken || ver.token;

// 3) Bind verified customer to the session, then select UPI method (activates the 5-min slot)
const custH = custToken ? { Authorization: `Bearer ${custToken}` } : {};
const bind = await fetch(YP + `/api/v1/checkout/${coll.youpi_payment_id}/bind-customer`, {
  method: 'POST', headers: { ...MH, ...custH }
});
console.log('3a) bind-customer:', bind.status);
const method = await fetch(YP + `/api/v1/checkout/${coll.youpi_payment_id}/select-method`, {
  method: 'POST', headers: { ...MH, ...custH, 'Content-Type': 'application/json' },
  body: JSON.stringify({ method: 'UPI' })
});
console.log('3b) select-method:', method.status, JSON.stringify(await method.json().catch(() => ({}))).slice(0, 200));

// 3c) Enable Developer Test Mode (10 min window)
const tm = await fetch(YP + '/api/v1/admin/dev/test-mode', {
  method: 'POST', headers: MH, body: JSON.stringify({ enabled: true })
});
console.log('3c) test-mode:', tm.status, JSON.stringify(await tm.json()).slice(0, 150));

// 4) Push bank SMS + Gmail (real verification engine)
const inject = async (source, sender, content) => {
  const r = await fetch(YP + '/api/v1/admin/dev/simulator/inject', {
    method: 'POST', headers: MH,
    body: JSON.stringify({ paymentSessionId: coll.youpi_payment_id, source, sender, content })
  });
  const d = await r.json();
  return `${r.status} ${d.status || d.error || ''}`;
};
console.log('4) SMS:', await inject('SMS', 'HDFCBK', `Rs 2500.00 credited to A/C XX4821 via UPI from RAHUL SHARMA. Ref no ${coll.order_id}. UPI ref 432198765432.`));
console.log('5) GMAIL:', await inject('GMAIL', 'notification@hdfcbank.bank.in', `Your account has been credited with Rs 2500.00 via UPI. Reference ${coll.order_id}. UPI Ref 432198765432.`));

// 6) Wait for webhook -> MTG credit
await new Promise(r => setTimeout(r, 7000));
console.log('\n=== FINAL STATE ===');
console.log('MTG collection:', JSON.stringify(queryOne('SELECT status, utr, credited_at FROM payment_collections WHERE id = ?', [coll.id])));
const rev = queryOne("SELECT amount, source FROM revenue_events ORDER BY created_at DESC LIMIT 1");
console.log('Revenue:', rev ? `Rs.${rev.amount} — ${String(rev.source).slice(0, 70)}` : 'NONE');
console.log('Wallets:', JSON.stringify(queryAll("SELECT email, wallet_balance FROM users WHERE email IN ('admin@mahitechgroup.com','developer@mahitechgroup.com')")));
