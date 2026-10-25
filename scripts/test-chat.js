/**
 * PROJECT CHAT TEST SUITE — real-time messaging over WS + REST history
 */
process.env.NODE_ENV = 'test';
process.env.DB_PATH = process.env.DB_PATH || undefined;

import http from 'node:http';
import crypto from 'node:crypto';
import { createApp } from '../src/app.js';
import { runMigration } from '../src/db/migrate.js';
import { runSeed } from '../src/db/seed.js';
import { queryOne, execute } from '../src/db/database.js';
import { WebSocket } from 'ws';

const TEST_PORT = 4974;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

const results = [];
function assert(condition, label) {
  console.log(`  ${condition ? '✓ PASS' : '✗ FAIL'}: ${label}`);
  results.push({ test: label, status: condition ? 'PASS' : 'FAIL' });
}

async function req(method, endpoint, token = null, body = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE_URL}${endpoint}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json().catch(() => null) };
}

async function login(email, password) {
  return (await req('POST', '/api/auth/login', null, { email, password })).data;
}

async function runChatTests() {
  console.log('===================================================================');
  console.log('   PROJECT CHAT VERIFICATION SUITE');
  console.log('===================================================================\n');

  runMigration();
  await runSeed();

  const app = createApp();
  const server = http.createServer(app);
  const { initWebSocketServer } = await import('../src/services/wsService.js');
  initWebSocketServer(server);
  await new Promise((r) => server.listen(TEST_PORT, '127.0.0.1', r));
  console.log(`[SETUP] Test server on ${BASE_URL}\n`);

  try {
    const admin = await login('admin@mahitechgroup.com', 'AdminPassword@2026');
    const dev = await login('developer@mahitechgroup.com', 'DeveloperPass123!');

    // project with both members
    const me = (await req('GET', '/api/users/me', admin.token)).data.user;
    const devMe = (await req('GET', '/api/users/me', dev.token)).data.user;
    const pid = crypto.randomUUID(), iid = crypto.randomUUID();
    execute("INSERT INTO ideas (id,title,description,owner_id,status) VALUES (?,'Chat Idea','x',?,'APPROVED')", [iid, me.id]);
    execute("INSERT INTO projects (id,idea_id,org_id,title,owner_id,status) VALUES (?,?,'DEFAULT_ORG','Chat Project',?,'ACTIVE')", [pid, iid, me.id]);
    execute("INSERT INTO project_members (id,project_id,user_id,role_in_project) VALUES (?,?,?,'backend_dev')", [crypto.randomUUID(), pid, devMe.id]);

    // WS listener (dev member socket) — must receive live chat.message
    const ticketRes = await req('POST', '/api/auth/ws-ticket', dev.token);
    assert(ticketRes.status === 201 && ticketRes.data.ticket, 'WS ticket issued for member');
    const ws = new WebSocket(`ws://127.0.0.1:${TEST_PORT}/ws?ticket=${ticketRes.data.ticket}`);
    ws.on('error', (e) => console.error('[WS ERROR]', e.message));
    await new Promise((r, rej) => {
      ws.on('open', r);
      ws.on('unexpected-response', (req2, res2) => rej(new Error('WS handshake HTTP ' + res2.statusCode)));
      setTimeout(() => rej(new Error('WS open timeout')), 8000);
    });

    const received = new Promise((resolve) => {
      ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          if (msg.event === 'chat.message' && msg.data?.body === 'Standup at 10am everyone') resolve(true);
        } catch { resolve(false); }
      });
      setTimeout(() => resolve(false), 8000);
    });

    // 1. admin posts
    let r = await req('POST', `/api/projects/${pid}/chat`, admin.token, { body: 'Standup at 10am everyone' });
    assert(r.status === 201 && r.data.message.author_name === 'System Admin', 'Admin posts message');

    // 2. dev receives live over WS
    assert(await received, 'Live chat.message broadcast received over WebSocket');

    // 3. dev posts + history ordered
    r = await req('POST', `/api/projects/${pid}/chat`, dev.token, { body: 'On it!' });
    assert(r.status === 201, 'Member posts message');
    r = await req('GET', `/api/projects/${pid}/chat`, dev.token);
    assert(r.data.count === 2, `History returns both messages (got ${r.data.count})`);
    assert(r.data.messages[0].body === 'Standup at 10am everyone', 'History chronological order');

    // 4. outsider blocked
    const des = await login('designer@mahitechgroup.com', 'DesignerPass123!');
    r = await req('GET', `/api/projects/${pid}/chat`, des.token);
    assert(r.status === 403, 'Non-member blocked (403)');
    r = await req('POST', `/api/projects/${pid}/chat`, des.token, { body: 'spam' });
    assert(r.status === 403, 'Non-member post blocked (403)');

    // 5. validation
    r = await req('POST', `/api/projects/${pid}/chat`, admin.token, { body: '' });
    assert(r.status === 400, 'Empty message rejected');
    r = await req('POST', `/api/projects/${pid}/chat`, admin.token, { body: 'x'.repeat(2001) });
    assert(r.status === 400, 'Over-length message rejected');

    // 6. append-only trigger
    let blocked = false;
    try { execute("UPDATE chat_messages SET body = 'hacked'"); } catch { blocked = true; }
    assert(blocked, 'chat_messages append-only (UPDATE blocked)');

    ws.close();
  } finally {
    await new Promise((r) => server.close(r));
    console.log('\n[TEARDOWN] Test server closed.');
  }

  const failed = results.filter((r) => r.status === 'FAIL').length;
  console.log('\n===================================================================');
  console.log(`   CHAT SUMMARY: ${results.length - failed} PASSED / ${results.length} TOTAL`);
  console.log('===================================================================\n');
  console.table(results);
  process.exit(failed > 0 ? 1 : 0);
}

runChatTests().catch((err) => {
  console.error('\n[CHAT SUITE FATAL]:', err);
  process.exit(1);
});
