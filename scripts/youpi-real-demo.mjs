import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MTG = 'http://127.0.0.1:4000';

const { queryOne, execute } = await import(pathToFileURL(path.join(__dirname, '..', 'src', 'db', 'database.js')).href);
const login = await (await fetch(MTG + '/api/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'admin@mahitechgroup.com', password: 'AdminPassword@2026' })
})).json();
const H = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + login.token };

const admin = queryOne("SELECT id FROM users WHERE email='admin@mahitechgroup.com'");
const dev = queryOne("SELECT id FROM users WHERE email='developer@mahitechgroup.com'");
const iid = crypto.randomUUID(), pid = crypto.randomUUID();
execute("INSERT INTO ideas (id,title,description,owner_id,status) VALUES (?,'Zomato Clone Delivery App','Client project revenue collection',?,'APPROVED')", [iid, admin.id]);
execute("INSERT INTO projects (id,idea_id,org_id,title,owner_id,status) VALUES (?,?,'DEFAULT_ORG','Zomato Clone - Phase 1',?,'ACTIVE')", [pid, iid, admin.id]);
execute("INSERT INTO project_members (id,project_id,user_id,role_in_project,contribution_weight) VALUES (?,?,?,'backend_dev',0.0)", [crypto.randomUUID(), pid, dev.id]);

const coll = await (await fetch(MTG + '/api/payments/youpi/collections', {
  method: 'POST', headers: H,
  body: JSON.stringify({ project_id: pid, amount: 2500, customer_name: 'Demo Client Pvt Ltd' })
})).json();
console.log('COLLECTION:', JSON.stringify(coll, null, 2));
