/**
 * GITHUB WEBHOOK PIPELINE TEST SUITE
 *
 * Verifies the PR ↔ task sync contract with real signed webhook payloads:
 *  1. Signature enforcement (missing/forged → 401)
 *  2. ping acknowledged; non-PR events ignored politely
 *  3. Unlinked repo acknowledged without error (matched:false)
 *  4. PR opened on branch mtg/<taskId>/… → task IN_PROGRESS + notification
 *  5. PR merged → task DONE + dependent child task unblocked
 *  6. PR closed unmerged → status untouched
 *  7. PR body fallback link (MTG-TASK: <id>)
 */
import http from 'node:http';
import crypto from 'node:crypto';
import { createApp } from '../src/app.js';
import { runMigration } from '../src/db/migrate.js';
import { runSeed } from '../src/db/seed.js';
import { queryOne, execute } from '../src/db/database.js';

const TEST_PORT = 4992;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;
const WEBHOOK_SECRET = 'gh-webhook-secret-test-0123456789abcdef';
const REPO = 'mahi-tech-org/pipeline-demo';

const results = [];
function assert(condition, label) {
  console.log(`  ${condition ? '✓ PASS' : '✗ FAIL'}: ${label}`);
  results.push({ test: label, status: condition ? 'PASS' : 'FAIL' });
}

function sign(payloadString) {
  const sig = 'sha256=' + crypto.createHmac('sha256', WEBHOOK_SECRET).update(payloadString).digest('hex');
  return { 'Content-Type': 'application/json', 'X-GitHub-Event': 'pull_request', 'X-Hub-Signature-256': sig };
}

async function postWebhook(event, payloadString, headers) {
  return fetch(`${BASE_URL}/api/github/webhook`, { method: 'POST', headers, body: payloadString });
}

function prPayload({ action, branch, number = 1, merged = false, body = '' }) {
  return JSON.stringify({
    action,
    repository: { full_name: REPO },
    pull_request: {
      number,
      title: `Implement ${branch}`,
      body,
      merged,
      html_url: `https://github.com/${REPO}/pull/${number}`,
      head: { ref: branch }
    }
  });
}

async function runWebhookTests() {
  console.log('===================================================================');
  console.log('   GITHUB WEBHOOK PIPELINE VERIFICATION SUITE');
  console.log('===================================================================\n');

  runMigration();
  await runSeed();

  const app = createApp();
  const server = http.createServer(app);
  await new Promise((r) => server.listen(TEST_PORT, '127.0.0.1', r));
  console.log(`[SETUP] Test server on ${BASE_URL}\n`);

  try {
    const login = async (email, pass) => (await (await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: pass })
    })).json());
    const admin = await login('admin@mahitechgroup.com', 'AdminPassword@2026');

    // Configure gateway + webhook secret
    const cfgRes = await fetch(`${BASE_URL}/api/superadmin/github/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${admin.token}` },
      body: JSON.stringify({ org_login: 'mahi-tech-org', token: 'ghp_test_x', webhook_secret: WEBHOOK_SECRET, api_base: 'http://127.0.0.1:6999' })
    });
    assert(cfgRes.status === 200, 'GitHub config + webhook secret saved');

    // Baseline project + tasks (research TODO, dependent frontend BLOCKED)
    const dev = queryOne("SELECT id FROM users WHERE email='developer@mahitechgroup.com'");
    const ideaId = crypto.randomUUID(), projectId = crypto.randomUUID();
    const researchId = crypto.randomUUID(), frontendId = crypto.randomUUID();
    execute("INSERT INTO ideas (id,title,description,owner_id,status) VALUES (?,'Pipeline Idea','x',?,'APPROVED')", [ideaId, admin.user.id]);
    execute("INSERT INTO projects (id,idea_id,org_id,title,owner_id,status,github_repo) VALUES (?,?,'DEFAULT_ORG','Pipeline Project',?,'ACTIVE',?)", [projectId, ideaId, admin.user.id, REPO]);
    execute("INSERT INTO project_tasks (id,project_id,assigned_to,task_name,task_type,status) VALUES (?,?,?,'Deep Research','research','TODO')", [researchId, projectId, dev.id]);
    execute("INSERT INTO project_tasks (id,project_id,assigned_to,task_name,task_type,status,depends_on_task_id) VALUES (?,?,?,'Frontend Build','frontend','BLOCKED',?)", [frontendId, projectId, dev.id, researchId]);

    // Link repo via admin endpoint
    const linkRes = await fetch(`${BASE_URL}/api/admin/projects/${projectId}/github-repo`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${admin.token}` },
      body: JSON.stringify({ github_repo: REPO })
    });
    assert(linkRes.status === 200, 'Project linked to repository');

    // -----------------------------------------------------------------
    console.log('\n--- TEST 1: Signature enforcement ---');
    const payloadOpen = prPayload({ action: 'opened', branch: `mtg/${researchId}/research` });
    const noSig = await postWebhook('pull_request', payloadOpen, { 'Content-Type': 'application/json', 'X-GitHub-Event': 'pull_request' });
    assert(noSig.status === 401, `Unsigned webhook rejected (got ${noSig.status})`);
    const forged = await postWebhook('pull_request', payloadOpen, {
      'Content-Type': 'application/json', 'X-GitHub-Event': 'pull_request',
      'X-Hub-Signature-256': 'sha256=' + 'f'.repeat(64)
    });
    assert(forged.status === 401, `Forged signature rejected (got ${forged.status})`);

    // -----------------------------------------------------------------
    console.log('\n--- TEST 2: ping + non-PR events ---');
    const pingSig = 'sha256=' + crypto.createHmac('sha256', WEBHOOK_SECRET).update('{}').digest('hex');
    const ping = await fetch(`${BASE_URL}/api/github/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-GitHub-Event': 'ping', 'X-Hub-Signature-256': pingSig },
      body: '{}'
    });
    assert(ping.status === 200, 'ping acknowledged');
    const pushBody = JSON.stringify({ repository: { full_name: REPO }, ref: 'refs/heads/main' });
    const pushSig = 'sha256=' + crypto.createHmac('sha256', WEBHOOK_SECRET).update(pushBody).digest('hex');
    const push = await fetch(`${BASE_URL}/api/github/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-GitHub-Event': 'push', 'X-Hub-Signature-256': pushSig },
      body: pushBody
    });
    assert(push.status === 200, 'Non-PR events politely ignored');

    // -----------------------------------------------------------------
    console.log('\n--- TEST 3: Unlinked repo acknowledged ---');
    const unlinkedBody = prPayload({ action: 'opened', branch: 'feature/x' }).replace(REPO, 'someone/else-repo');
    const unlinkedSig = 'sha256=' + crypto.createHmac('sha256', WEBHOOK_SECRET).update(unlinkedBody).digest('hex');
    const unlinked = await fetch(`${BASE_URL}/api/github/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-GitHub-Event': 'pull_request', 'X-Hub-Signature-256': unlinkedSig },
      body: unlinkedBody
    });
    assert(unlinked.status === 200, 'Unlinked repo returns 200 (no retry storm)');

    // -----------------------------------------------------------------
    console.log('\n--- TEST 4: PR opened → task IN_PROGRESS ---');
    const openRes = await postWebhook('pull_request', payloadOpen, sign(payloadOpen));
    assert(openRes.status === 200, `Opened webhook accepted (got ${openRes.status})`);
    const taskAfterOpen = queryOne('SELECT status FROM project_tasks WHERE id = ?', [researchId]);
    assert(taskAfterOpen.status === 'IN_PROGRESS', `Task moved to IN_PROGRESS (got ${taskAfterOpen.status})`);
    const notif = queryOne("SELECT id FROM notifications WHERE event_type='github_pr_sync' ORDER BY created_at DESC LIMIT 1");
    assert(Boolean(notif), 'PR sync notification recorded');

    // -----------------------------------------------------------------
    console.log('\n--- TEST 5: PR merged → DONE + child unblocked ---');
    const payloadMerged = prPayload({ action: 'closed', branch: `mtg/${researchId}/research`, merged: true, number: 2 });
    const mergedRes = await postWebhook('pull_request', payloadMerged, sign(payloadMerged));
    assert(mergedRes.status === 200, 'Merged webhook accepted');
    const taskAfterMerge = queryOne('SELECT status FROM project_tasks WHERE id = ?', [researchId]);
    assert(taskAfterMerge.status === 'DONE', `Task DONE after merge (got ${taskAfterMerge.status})`);
    const child = queryOne('SELECT status FROM project_tasks WHERE id = ?', [frontendId]);
    assert(child.status === 'TODO', `Dependent child unblocked to TODO (got ${child.status})`);
    const audit = queryOne("SELECT id FROM access_log WHERE action='github_pr_merged' ORDER BY id DESC LIMIT 1");
    assert(Boolean(audit), 'Merge recorded in audit log');

    // -----------------------------------------------------------------
    console.log('\n--- TEST 6: PR closed unmerged → status untouched ---');
    const payloadClosed = prPayload({ action: 'closed', branch: `mtg/${frontendId}/frontend`, merged: false, number: 3 });
    await postWebhook('pull_request', payloadClosed, sign(payloadClosed));
    const childAfter = queryOne('SELECT status FROM project_tasks WHERE id = ?', [frontendId]);
    assert(childAfter.status === 'TODO', 'Unmerged close leaves task status untouched');

    // -----------------------------------------------------------------
    console.log('\n--- TEST 7: PR body fallback link ---');
    execute("UPDATE project_tasks SET status='TODO' WHERE id=?", [frontendId]);
    const bodyLink = prPayload({ action: 'opened', branch: 'feature/random-name', body: `Fixes MTG-TASK: ${frontendId}` });
    const bodyRes = await postWebhook('pull_request', bodyLink, sign(bodyLink));
    assert(bodyRes.status === 200, 'Body-linked webhook accepted');
    const viaBody = queryOne('SELECT status FROM project_tasks WHERE id = ?', [frontendId]);
    assert(viaBody.status === 'IN_PROGRESS', `Task linked via PR body started (got ${viaBody.status})`);

  } finally {
    await new Promise((r) => server.close(r));
    console.log('\n[TEARDOWN] Test server closed.');
  }

  const failed = results.filter((r) => r.status === 'FAIL').length;
  console.log('\n===================================================================');
  console.log(`   GITHUB WEBHOOK SUMMARY: ${results.length - failed} PASSED / ${results.length} TOTAL`);
  console.log('===================================================================\n');
  console.table(results);
  process.exit(failed > 0 ? 1 : 0);
}

runWebhookTests().catch((err) => {
  console.error('\n[WEBHOOK SUITE FATAL]:', err);
  process.exit(1);
});
