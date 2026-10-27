import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { getDatabase, queryOne, queryAll, execute } from '../src/db/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('===================================================================');
console.log('   PRD 17: GITHUB AUTOMATION ARCHITECTURE — BATCH 3 TEST SUITE');
console.log('===================================================================\n');

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(condition, message, details = '') {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✅ PASS: ${message}`);
    if (details) console.log(`     └─ ${details}`);
  } else {
    failedTests++;
    console.error(`  ❌ FAIL: ${message}`);
    if (details) console.error(`     └─ ${details}`);
    process.exitCode = 1;
  }
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function runTests() {
  const db = getDatabase();
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');

  // Set up temporary RSA key and webhook secret
  const { privateKey: rsaPrivateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
    publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
  });

  const certsDir = path.resolve(__dirname, '../certs');
  fs.mkdirSync(certsDir, { recursive: true });
  const tempKeyPath = path.join(certsDir, `test-prd17-batch3-${Date.now()}.pem`);
  fs.writeFileSync(tempKeyPath, rsaPrivateKey, 'utf8');

  const origAppId = process.env.GITHUB_APP_ID;
  const origKeyPath = process.env.GITHUB_APP_PRIVATE_KEY_PATH;
  const origSecret = process.env.GITHUB_WEBHOOK_SECRET;
  const origOrg = process.env.GITHUB_ORG_NAME;
  const origInstId = process.env.GITHUB_APP_INSTALLATION_ID;

  const testWebhookSecret = 'super_secret_webhook_key_32_chars_exact!!';
  process.env.GITHUB_APP_ID = '987654';
  process.env.GITHUB_APP_PRIVATE_KEY_PATH = tempKeyPath;
  process.env.GITHUB_WEBHOOK_SECRET = testWebhookSecret;
  process.env.GITHUB_ORG_NAME = 'mahitechgroup';
  process.env.GITHUB_APP_INSTALLATION_ID = '54321';

  // Import app and services after env variables are configured
  const { createApp } = await import(`../src/app.js?t=${Date.now()}`);
  const { verifyGitHubWebhookSignature } = await import(`../src/middleware/githubWebhookVerify.js?t=${Date.now()}`);
  const { setOctokitInstance } = await import('../src/services/githubAutomation.service.js');

  setOctokitInstance({
    teams: {
      removeMembershipForUserInOrg: async () => ({ data: {} }),
      addOrUpdateMembershipForUserInOrg: async () => ({ data: {} }),
    },
    repos: {
      update: async () => ({ data: {} }),
    },
  });

  const app = createApp();
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const BASE_URL = `http://127.0.0.1:${port}`;

  function computeHmacSignature(rawString, secret = testWebhookSecret) {
    return 'sha256=' + crypto.createHmac('sha256', secret).update(rawString).digest('hex');
  }

  function postWebhook({ path = '/api/github/webhook', body, headers = {} }) {
    return new Promise((resolve, reject) => {
      const payloadStr = typeof body === 'string' ? body : JSON.stringify(body);
      const reqHeaders = {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(payloadStr),
        ...headers,
      };

      const req = http.request(
        `${BASE_URL}${path}`,
        {
          method: 'POST',
          headers: reqHeaders,
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => {
            let json = null;
            try {
              json = JSON.parse(data);
            } catch (e) {
              json = data;
            }
            resolve({ status: res.statusCode, headers: res.headers, body: json });
          });
        }
      );

      req.on('error', reject);
      req.write(payloadStr);
      req.end();
    });
  }

  // Pre-seed test entities in the database
  const ts = Date.now();
  const testLeadId = `lead-b3-${ts}`;
  const testMemberId = `member-b3-${ts}`;
  const testIdeaId = `idea-b3-${ts}`;
  const testProjectId = `proj-b3-${ts}`;
  const repoSlug = `mahi-webhook-test-${ts}`;
  const repoFullName = `mahitechgroup/${repoSlug}`;

  execute(`
    INSERT INTO users (id, name, email, password_hash, role, status)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [testLeadId, 'Batch3 Lead', `${testLeadId}@example.com`, 'hash', 'admin', 'active']);

  execute(`
    INSERT INTO users (id, name, email, password_hash, role, status)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [testMemberId, 'Batch3 Member', `${testMemberId}@example.com`, 'hash', 'developer', 'active']);

  execute(`
    INSERT INTO ideas (id, title, description, owner_id, status)
    VALUES (?, ?, ?, ?, ?)
  `, [testIdeaId, 'Batch 3 Webhook Idea', 'Idea description', testLeadId, 'APPROVED']);

  execute(`
    INSERT INTO projects (id, idea_id, title, owner_id, status)
    VALUES (?, ?, ?, ?, ?)
  `, [testProjectId, testIdeaId, 'Webhook Testing Project', testLeadId, 'ACTIVE']);

  execute(`
    INSERT INTO project_github_repos (
      id, project_id, github_repo_id, repo_name, repo_full_name, repo_url, default_branch, status, created_at, updated_at
    ) VALUES (?, ?, 999888, ?, ?, ?, 'main', 'ACTIVE', datetime('now'), datetime('now'))
  `, [crypto.randomUUID(), testProjectId, repoSlug, repoFullName, `https://github.com/${repoFullName}`]);

  const testGithubUsername = `octomember_${ts}`;

  execute(`
    INSERT INTO user_github_links (
      id, user_id, github_username, github_node_id, linked_by, linked_at
    ) VALUES (?, ?, ?, 'node_octo_123', ?, datetime('now'))
  `, [crypto.randomUUID(), testMemberId, testGithubUsername, testLeadId]);

  execute(`
    INSERT INTO project_github_memberships (
      id, project_id, user_id, github_username, role, team_slug, status, added_at
    ) VALUES (?, ?, ?, ?, 'developer', ?, 'ACTIVE', datetime('now'))
  `, [crypto.randomUUID(), testProjectId, testMemberId, testGithubUsername, `${repoSlug}-developer`]);

  try {
    // ===================================================================
    // GROUP 1: Signature Middleware (7 assertions)
    // ===================================================================
    console.log('--- GROUP 1: Signature Middleware (7 assertions) ---');

    const samplePayload = JSON.stringify({ zen: 'Keep it logically awesome.', sender: { login: 'octocat' } });
    const sampleDelivery = `deliv-group1-${ts}`;

    // 1. POST /api/github/webhook with no signature header → 401
    const noSigRes = await postWebhook({
      body: samplePayload,
      headers: {
        'x-github-delivery': `${sampleDelivery}-nosig`,
        'x-github-event': 'ping',
      },
    });
    assert(
      noSigRes.status === 401 && noSigRes.body?.error?.includes('Missing X-Hub-Signature-256'),
      'POST /api/github/webhook with no signature header → 401',
      `Status: ${noSigRes.status}, Error: ${noSigRes.body?.error}`
    );

    // 2. POST with wrong signature → 401
    const wrongSigRes = await postWebhook({
      body: samplePayload,
      headers: {
        'x-hub-signature-256': 'sha256=' + 'f'.repeat(64),
        'x-github-delivery': `${sampleDelivery}-wrong`,
        'x-github-event': 'ping',
      },
    });
    assert(
      wrongSigRes.status === 401 && wrongSigRes.body?.error?.includes('Invalid webhook signature'),
      'POST with wrong signature → 401',
      `Status: ${wrongSigRes.status}, Error: ${wrongSigRes.body?.error}`
    );

    // 3. POST with correct HMAC-SHA256 signature → reaches handler (not 401)
    const validSig = computeHmacSignature(samplePayload, testWebhookSecret);
    const validSigRes = await postWebhook({
      body: samplePayload,
      headers: {
        'x-hub-signature-256': validSig,
        'x-github-delivery': `${sampleDelivery}-valid`,
        'x-github-event': 'ping',
      },
    });
    assert(
      validSigRes.status === 200,
      'POST with correct HMAC-SHA256 signature → reaches handler (not 401)',
      `Status: ${validSigRes.status}`
    );

    // 4. timingSafeEqual used — different length signatures → 401 (not a crash/throw)
    const diffLenSigRes = await postWebhook({
      body: samplePayload,
      headers: {
        'x-hub-signature-256': 'sha256=tooshort',
        'x-github-delivery': `${sampleDelivery}-difflen`,
        'x-github-event': 'ping',
      },
    });
    assert(
      diffLenSigRes.status === 401,
      'timingSafeEqual used — different length signatures → 401',
      `Status: ${diffLenSigRes.status}`
    );

    // 5 & 6. Direct middleware unit verification for req.webhookVerified and req.parsedPayload
    const mockReq = {
      headers: {
        'x-hub-signature-256': validSig,
        'x-github-delivery': 'unit-deliv-1',
        'x-github-event': 'ping',
      },
      body: Buffer.from(samplePayload, 'utf8'),
    };
    let nextCalled = false;
    const mockRes = {
      status: () => mockRes,
      json: () => mockRes,
    };
    verifyGitHubWebhookSignature(mockReq, mockRes, () => {
      nextCalled = true;
    });

    assert(
      nextCalled && mockReq.webhookVerified === true,
      'Valid signature: req.webhookVerified = true confirmed',
      `nextCalled: ${nextCalled}, webhookVerified: ${mockReq.webhookVerified}`
    );

    assert(
      mockReq.parsedPayload && mockReq.parsedPayload.sender?.login === 'octocat',
      'Valid signature: req.parsedPayload is parsed JSON confirmed',
      `parsedPayload sender: ${mockReq.parsedPayload?.sender?.login}`
    );

    // 7. Valid delivery: returns 200 { status: 'received' }
    assert(
      validSigRes.status === 200 && validSigRes.body?.status === 'received',
      'Valid delivery: returns 200 { status: \'received\' }',
      `Body: ${JSON.stringify(validSigRes.body)}`
    );

    // ===================================================================
    // GROUP 2: Webhook Log (5 assertions)
    // ===================================================================
    console.log('\n--- GROUP 2: Webhook Log (5 assertions) ---');

    // 1. Valid webhook → row inserted in github_webhook_log
    const validLog = queryOne('SELECT * FROM github_webhook_log WHERE delivery_id = ?', [`${sampleDelivery}-valid`]);
    assert(
      !!validLog,
      'Valid webhook → row inserted in github_webhook_log',
      `Delivery ID: ${validLog?.delivery_id}`
    );

    // 2. signature_valid = 1 for valid request
    assert(
      validLog && validLog.signature_valid === 1,
      'signature_valid = 1 for valid request',
      `signature_valid: ${validLog?.signature_valid}`
    );

    // 3. Invalid signature → row inserted with signature_valid = 0
    const invalidLog = queryOne('SELECT * FROM github_webhook_log WHERE delivery_id = ?', [`${sampleDelivery}-wrong`]);
    assert(
      invalidLog && invalidLog.signature_valid === 0,
      'Invalid signature → row inserted with signature_valid = 0',
      `signature_valid: ${invalidLog?.signature_valid}, error: ${invalidLog?.error_message}`
    );

    // 4. Duplicate delivery_id → returns 200 { skipped: true }, no duplicate row in DB
    const dupRes = await postWebhook({
      body: samplePayload,
      headers: {
        'x-hub-signature-256': validSig,
        'x-github-delivery': `${sampleDelivery}-valid`, // Duplicate delivery ID
        'x-github-event': 'ping',
      },
    });
    const dupCount = queryOne('SELECT COUNT(*) as cnt FROM github_webhook_log WHERE delivery_id = ?', [`${sampleDelivery}-valid`]);
    assert(
      dupRes.status === 200 && dupRes.body?.skipped === true && dupCount?.cnt === 1,
      'Duplicate delivery_id → returns 200 { skipped: true }, no duplicate row in DB',
      `Status: ${dupRes.status}, skipped: ${dupRes.body?.skipped}, row count: ${dupCount?.cnt}`
    );

    // 5. After processing: processed = 1 in DB
    await wait(60);
    const processedLog = queryOne('SELECT processed FROM github_webhook_log WHERE delivery_id = ?', [`${sampleDelivery}-valid`]);
    assert(
      processedLog && processedLog.processed === 1,
      'After processing: processed = 1 in DB',
      `processed: ${processedLog?.processed}`
    );

    // ===================================================================
    // GROUP 3: Trigger Update Verification (5 assertions)
    // ===================================================================
    console.log('\n--- GROUP 3: Trigger Update Verification (5 assertions) ---');

    const triggerTestDeliv = `trigger-test-${ts}`;
    execute(`
      INSERT INTO github_webhook_log (
        id, delivery_id, event_type, action, repo_full_name, sender_login, payload, signature_valid, processed, received_at
      ) VALUES (?, ?, 'ping', NULL, 'org/repo', 'user', '{}', 1, 0, datetime('now'))
    `, [crypto.randomUUID(), triggerTestDeliv]);

    // 1. UPDATE processed: 0→1 → SUCCEEDS
    let updateProcSuccess = false;
    try {
      execute('UPDATE github_webhook_log SET processed = 1 WHERE delivery_id = ?', [triggerTestDeliv]);
      updateProcSuccess = true;
    } catch (e) {}
    const rowProc = queryOne('SELECT processed FROM github_webhook_log WHERE delivery_id = ?', [triggerTestDeliv]);
    assert(
      updateProcSuccess && rowProc?.processed === 1,
      'UPDATE processed: 0→1 → SUCCEEDS (new trigger allows)',
      `processed: ${rowProc?.processed}`
    );

    // 2. UPDATE error_message → SUCCEEDS
    let updateErrMsgSuccess = false;
    try {
      execute('UPDATE github_webhook_log SET error_message = ? WHERE delivery_id = ?', ['test err msg', triggerTestDeliv]);
      updateErrMsgSuccess = true;
    } catch (e) {}
    const rowErr = queryOne('SELECT error_message FROM github_webhook_log WHERE delivery_id = ?', [triggerTestDeliv]);
    assert(
      updateErrMsgSuccess && rowErr?.error_message === 'test err msg',
      'UPDATE error_message → SUCCEEDS (new trigger allows)',
      `error_message: ${rowErr?.error_message}`
    );

    // 3. UPDATE event_type → FAILS
    let eventTypeFailed = false;
    try {
      execute('UPDATE github_webhook_log SET event_type = ? WHERE delivery_id = ?', ['tampered_event', triggerTestDeliv]);
    } catch (e) {
      eventTypeFailed = true;
    }
    assert(
      eventTypeFailed,
      'UPDATE event_type → FAILS (trigger blocks)',
      `Blocked: ${eventTypeFailed}`
    );

    // 4. UPDATE payload → FAILS
    let payloadFailed = false;
    try {
      execute('UPDATE github_webhook_log SET payload = ? WHERE delivery_id = ?', ['tampered_payload', triggerTestDeliv]);
    } catch (e) {
      payloadFailed = true;
    }
    assert(
      payloadFailed,
      'UPDATE payload → FAILS (trigger blocks)',
      `Blocked: ${payloadFailed}`
    );

    // 5. UPDATE delivery_id → FAILS
    let delivIdFailed = false;
    try {
      execute('UPDATE github_webhook_log SET delivery_id = ? WHERE delivery_id = ?', ['tampered_deliv', triggerTestDeliv]);
    } catch (e) {
      delivIdFailed = true;
    }
    assert(
      delivIdFailed,
      'UPDATE delivery_id → FAILS (trigger blocks)',
      `Blocked: ${delivIdFailed}`
    );

    // ===================================================================
    // GROUP 4: Push Event Processing (3 assertions)
    // ===================================================================
    console.log('\n--- GROUP 4: Push Event Processing (3 assertions) ---');

    const pushPayload = JSON.stringify({
      ref: 'refs/heads/feature/dev',
      repository: { full_name: repoFullName, html_url: `https://github.com/${repoFullName}` },
      pusher: { name: 'octomember' },
      commits: [{ id: 'c1' }, { id: 'c2' }],
      compare: `https://github.com/${repoFullName}/compare/abc...def`,
    });
    const pushSig = computeHmacSignature(pushPayload);

    await postWebhook({
      body: pushPayload,
      headers: {
        'x-hub-signature-256': pushSig,
        'x-github-delivery': `push-deliv-${ts}`,
        'x-github-event': 'push',
      },
    });

    await wait(60);

    // 1. push event with valid repo → notification created for Lead
    const pushNotif = queryOne(`
      SELECT * FROM notifications
      WHERE user_id = ? AND event_type = 'github_push'
      ORDER BY rowid DESC LIMIT 1
    `, [testLeadId]);
    assert(
      !!pushNotif && pushNotif.message.includes('octomember pushed 2 commit(s) to feature/dev'),
      'push event with valid repo → notification created for Lead',
      `Message: ${pushNotif?.message}`
    );

    // 2. push event with unknown repo_full_name → processed=1, no error
    const unknownPushPayload = JSON.stringify({
      ref: 'refs/heads/main',
      repository: { full_name: 'unknown/repo-does-not-exist' },
      pusher: { name: 'rando' },
      commits: [],
    });
    const unknownPushSig = computeHmacSignature(unknownPushPayload);
    const unknownPushDeliv = `push-unknown-${ts}`;
    await postWebhook({
      body: unknownPushPayload,
      headers: {
        'x-hub-signature-256': unknownPushSig,
        'x-github-delivery': unknownPushDeliv,
        'x-github-event': 'push',
      },
    });
    await wait(60);
    const unknownPushLog = queryOne('SELECT processed, error_message FROM github_webhook_log WHERE delivery_id = ?', [unknownPushDeliv]);
    assert(
      unknownPushLog && unknownPushLog.processed === 1 && !unknownPushLog.error_message,
      'push event with unknown repo_full_name → processed=1, no error',
      `processed: ${unknownPushLog?.processed}, error: ${unknownPushLog?.error_message}`
    );

    // 3. push event notification type = "github_push"
    assert(
      pushNotif && pushNotif.event_type === 'github_push',
      'push event notification type = "github_push"',
      `event_type: ${pushNotif?.event_type}`
    );

    // ===================================================================
    // GROUP 5: Pull Request Event (3 assertions)
    // ===================================================================
    console.log('\n--- GROUP 5: Pull Request Event (3 assertions) ---');

    // 1. PR opened → notification type = "github_pr_opened"
    const prOpenPayload = JSON.stringify({
      action: 'opened',
      repository: { full_name: repoFullName },
      pull_request: {
        title: 'Add Redis Cache Layer',
        html_url: `https://github.com/${repoFullName}/pull/1`,
        user: { login: 'octomember' },
        base: { ref: 'develop' },
      },
    });
    const prOpenSig = computeHmacSignature(prOpenPayload);
    await postWebhook({
      body: prOpenPayload,
      headers: {
        'x-hub-signature-256': prOpenSig,
        'x-github-delivery': `pr-open-${ts}`,
        'x-github-event': 'pull_request',
      },
    });
    await wait(60);

    const prOpenNotif = queryOne(`
      SELECT * FROM notifications
      WHERE user_id = ? AND event_type = 'github_pr_opened'
      ORDER BY rowid DESC LIMIT 1
    `, [testLeadId]);
    assert(
      !!prOpenNotif && prOpenNotif.message.includes("PR 'Add Redis Cache Layer' opened by octomember → develop"),
      'PR opened → notification type = "github_pr_opened"',
      `Message: ${prOpenNotif?.message}`
    );

    // 2. PR closed + merged = true → notification type = "github_pr_merged"
    const prMergePayload = JSON.stringify({
      action: 'closed',
      repository: { full_name: repoFullName },
      pull_request: {
        title: 'Add Redis Cache Layer',
        html_url: `https://github.com/${repoFullName}/pull/1`,
        user: { login: 'octomember' },
        base: { ref: 'develop' },
        merged: true,
      },
    });
    const prMergeSig = computeHmacSignature(prMergePayload);
    await postWebhook({
      body: prMergePayload,
      headers: {
        'x-hub-signature-256': prMergeSig,
        'x-github-delivery': `pr-merge-${ts}`,
        'x-github-event': 'pull_request',
      },
    });
    await wait(60);

    const prMergeNotif = queryOne(`
      SELECT * FROM notifications
      WHERE user_id = ? AND event_type = 'github_pr_merged'
      ORDER BY rowid DESC LIMIT 1
    `, [testLeadId]);
    assert(
      !!prMergeNotif && prMergeNotif.message.includes("PR 'Add Redis Cache Layer' MERGED into develop by octomember"),
      'PR closed + merged = true → notification type = "github_pr_merged"',
      `Message: ${prMergeNotif?.message}`
    );

    // 3. PR closed + merged = false → notification type = "github_pr_closed"
    const prClosePayload = JSON.stringify({
      action: 'closed',
      repository: { full_name: repoFullName },
      pull_request: {
        title: 'Discarded Branch Work',
        html_url: `https://github.com/${repoFullName}/pull/2`,
        user: { login: 'octomember' },
        base: { ref: 'develop' },
        merged: false,
      },
    });
    const prCloseSig = computeHmacSignature(prClosePayload);
    await postWebhook({
      body: prClosePayload,
      headers: {
        'x-hub-signature-256': prCloseSig,
        'x-github-delivery': `pr-close-${ts}`,
        'x-github-event': 'pull_request',
      },
    });
    await wait(60);

    const prCloseNotif = queryOne(`
      SELECT * FROM notifications
      WHERE user_id = ? AND event_type = 'github_pr_closed'
      ORDER BY rowid DESC LIMIT 1
    `, [testLeadId]);
    assert(
      !!prCloseNotif && prCloseNotif.message.includes("PR 'Discarded Branch Work' closed by octomember → develop"),
      'PR closed + merged = false → notification type = "github_pr_closed"',
      `Message: ${prCloseNotif?.message}`
    );

    // ===================================================================
    // GROUP 6: Member Event (2 assertions)
    // ===================================================================
    console.log('\n--- GROUP 6: Member Event (2 assertions) ---');

    // 1. member removed webhook with known github_username → project_github_memberships status = 'REMOVED'
    const memberRemovePayload = JSON.stringify({
      action: 'removed',
      repository: { full_name: repoFullName },
      member: { login: testGithubUsername },
    });
    const memberRemoveSig = computeHmacSignature(memberRemovePayload);
    await postWebhook({
      body: memberRemovePayload,
      headers: {
        'x-hub-signature-256': memberRemoveSig,
        'x-github-delivery': `member-remove-${ts}`,
        'x-github-event': 'member',
      },
    });
    await wait(150);

    const removedMembership = queryOne(`
      SELECT status, removed_reason FROM project_github_memberships
      WHERE project_id = ? AND user_id = ?
    `, [testProjectId, testMemberId]);
    assert(
      removedMembership && removedMembership.status === 'REMOVED' && removedMembership.removed_reason === 'Removed via GitHub webhook',
      'member removed webhook with known github_username → project_github_memberships status = \'REMOVED\'',
      `status: ${removedMembership?.status}, reason: ${removedMembership?.removed_reason}`
    );

    // 2. member event with unknown github_username → processed=1, no crash, no platform action
    const unknownMemberPayload = JSON.stringify({
      action: 'removed',
      repository: { full_name: repoFullName },
      member: { login: 'unknown_external_ghost' },
    });
    const unknownMemberSig = computeHmacSignature(unknownMemberPayload);
    const unknownMemberDeliv = `member-unknown-${ts}`;
    await postWebhook({
      body: unknownMemberPayload,
      headers: {
        'x-hub-signature-256': unknownMemberSig,
        'x-github-delivery': unknownMemberDeliv,
        'x-github-event': 'member',
      },
    });
    await wait(60);

    const unknownMemberLog = queryOne('SELECT processed, error_message FROM github_webhook_log WHERE delivery_id = ?', [unknownMemberDeliv]);
    assert(
      unknownMemberLog && unknownMemberLog.processed === 1 && !unknownMemberLog.error_message,
      'member event with unknown github_username → processed=1, no crash, no platform action',
      `processed: ${unknownMemberLog?.processed}, error: ${unknownMemberLog?.error_message}`
    );

  } finally {
    // Shutdown test server
    await new Promise((resolve) => server.close(resolve));

    // Clean up temporary cert
    try {
      if (fs.existsSync(tempKeyPath)) {
        fs.unlinkSync(tempKeyPath);
      }
    } catch (e) {}

    // Restore environment variables
    if (origAppId !== undefined) process.env.GITHUB_APP_ID = origAppId; else delete process.env.GITHUB_APP_ID;
    if (origKeyPath !== undefined) process.env.GITHUB_APP_PRIVATE_KEY_PATH = origKeyPath; else delete process.env.GITHUB_APP_PRIVATE_KEY_PATH;
    if (origSecret !== undefined) process.env.GITHUB_WEBHOOK_SECRET = origSecret; else delete process.env.GITHUB_WEBHOOK_SECRET;
    if (origOrg !== undefined) process.env.GITHUB_ORG_NAME = origOrg; else delete process.env.GITHUB_ORG_NAME;
    if (origInstId !== undefined) process.env.GITHUB_APP_INSTALLATION_ID = origInstId; else delete process.env.GITHUB_APP_INSTALLATION_ID;
  }

  // ===================================================================
  // SUMMARY
  // ===================================================================
  console.log('\n===================================================================');
  console.log(`PRD 17 BATCH 3 TEST RESULTS: ${passedTests}/${totalTests} PASSED`);
  console.log('===================================================================');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});
