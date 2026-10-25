import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MTG = 'http://127.0.0.1:4000';
const { queryOne } = await import(pathToFileURL(path.join(__dirname, '..', 'src', 'db', 'database.js')).href);

const login = await (await fetch(MTG + '/api/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'admin@mahitechgroup.com', password: 'AdminPassword@2026' })
})).json();
const H = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + login.token };
const proj = queryOne("SELECT id FROM projects WHERE title LIKE 'Zomato%' LIMIT 1");

const coll = await (await fetch(MTG + '/api/payments/youpi/collections', {
  method: 'POST', headers: H,
  body: JSON.stringify({
    project_id: proj.id, amount: 2500,
    customer_name: 'Rahul Sharma',
    customer_phone: '9876543210',
    customer_email: 'rahul@democlient.in'
  })
})).json();
console.log(JSON.stringify(coll.collection ? { order: coll.collection.order_id, payment_id: coll.collection.youpi_payment_id, amount: coll.collection.amount, status: coll.collection.status, checkout: coll.checkoutUrl } : coll, null, 1));
