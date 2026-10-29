import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { getDatabase, queryOne, queryAll, execute, execRaw } from '../src/db/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('===================================================================');
console.log('   PRD 17: GITHUB AUTOMATION ARCHITECTURE — BATCH 1 TEST SUITE');
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

async function runTests() {
  const db = getDatabase();
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');

  // Prepare test users and project for foreign key testing
  const testUserId = `user-gh-test-${Date.now()}`;
  const testProjectId = `proj-gh-test-${Date.now()}`;

  db.prepare(`
    INSERT INTO users (id, name, email, password_hash, role, status)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(testUserId, 'GitHub Test Member', `${testUserId}@example.com`, 'hash', 'developer', 'active');

  const testIdeaId = `idea-gh-test-${Date.now()}`;
  db.prepare(`
    INSERT INTO ideas (id, title, description, owner_id, status)
    VALUES (?, ?, ?, ?, ?)
  `).run(testIdeaId, 'GitHub Test Idea', 'Idea description', testUserId, 'APPROVED');

  db.prepare(`
    INSERT INTO projects (id, idea_id, title, owner_id, status)
    VALUES (?, ?, ?, ?, ?)
  `).run(testProjectId, testIdeaId, 'GitHub Test Project', testUserId, 'ACTIVE');

  // ===================================================================
  // GROUP 1: Table Structure (6 assertions)
  // ===================================================================
  console.log('--- GROUP 1: Table Structure (6 assertions) ---');

  // 1. user_github_links table exists with correct columns
  const userGhCols = queryAll('PRAGMA table_info(user_github_links);').map(c => c.name);
  const expectedUserGhCols = ['id', 'user_id', 'github_username', 'github_node_id', 'linked_at', 'linked_by'];
  const userGhColsValid = expectedUserGhCols.every(col => userGhCols.includes(col));
  assert(userGhColsValid, 'user_github_links table exists with correct columns', `Found columns: ${userGhCols.join(', ')}`);

  // 2. project_github_repos table exists with correct columns
  const projRepoCols = queryAll('PRAGMA table_info(project_github_repos);').map(c => c.name);
  const expectedProjRepoCols = ['id', 'project_id', 'github_repo_id', 'repo_name', 'repo_full_name', 'repo_url', 'default_branch', 'status', 'created_at', 'updated_at', 'archived_at'];
  const projRepoColsValid = expectedProjRepoCols.every(col => projRepoCols.includes(col));
  assert(projRepoColsValid, 'project_github_repos table exists with correct columns', `Found columns: ${projRepoCols.join(', ')}`);

  // 3. project_github_memberships table exists with correct columns
  const projMemCols = queryAll('PRAGMA table_info(project_github_memberships);').map(c => c.name);
  const expectedProjMemCols = ['id', 'project_id', 'user_id', 'github_username', 'role', 'team_slug', 'status', 'added_at', 'removed_at', 'removed_reason'];
  const projMemColsValid = expectedProjMemCols.every(col => projMemCols.includes(col));
  assert(projMemColsValid, 'project_github_memberships table exists with correct columns', `Found columns: ${projMemCols.join(', ')}`);

  // 4. github_webhook_log table exists with correct columns
  const webhookLogCols = queryAll('PRAGMA table_info(github_webhook_log);').map(c => c.name);
  const expectedWebhookCols = ['id', 'delivery_id', 'event_type', 'action', 'repo_full_name', 'sender_login', 'payload', 'signature_valid', 'processed', 'error_message', 'received_at'];
  const webhookColsValid = expectedWebhookCols.every(col => webhookLogCols.includes(col));
  assert(webhookColsValid, 'github_webhook_log table exists with correct columns', `Found columns: ${webhookLogCols.join(', ')}`);

  // 5. project_github_repos.status CHECK constraint enforced (INSERT invalid status → must fail)
  let invalidStatusFailed = false;
  try {
    db.prepare(`
      INSERT INTO project_github_repos (project_id, repo_name, repo_full_name, repo_url, status)
      VALUES (?, ?, ?, ?, ?)
    `).run(testProjectId, 'test-repo', 'mahitechgroup/test-repo', 'https://github.com/mahitechgroup/test-repo', 'INVALID_STATUS');
  } catch (err) {
    if (err.message && (err.message.includes('CHECK constraint failed') || err.message.includes('constraint'))) {
      invalidStatusFailed = true;
    }
  }
  assert(invalidStatusFailed, 'project_github_repos.status CHECK constraint enforced (INSERT invalid status → must fail)');

  // 6. project_github_memberships UNIQUE(project_id, user_id) enforced (duplicate INSERT → must fail)
  let duplicateMembershipFailed = false;
  try {
    db.prepare(`
      INSERT INTO project_github_memberships (project_id, user_id, github_username, role, team_slug, status)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(testProjectId, testUserId, 'octocat', 'developer', 'core-devs', 'ACTIVE');

    // Attempt duplicate
    db.prepare(`
      INSERT INTO project_github_memberships (project_id, user_id, github_username, role, team_slug, status)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(testProjectId, testUserId, 'octocat_duplicate', 'developer', 'core-devs', 'ACTIVE');
  } catch (err) {
    if (err.message && (err.message.includes('UNIQUE constraint failed') || err.message.includes('constraint'))) {
      duplicateMembershipFailed = true;
    }
  }
  assert(duplicateMembershipFailed, 'project_github_memberships UNIQUE(project_id, user_id) enforced (duplicate INSERT → must fail)');

  // ===================================================================
  // GROUP 2: Append-Only Trigger (4 assertions)
  // ===================================================================
  console.log('\n--- GROUP 2: Append-Only Trigger (4 assertions) ---');

  const testDeliveryId = `verify-batch1-${Date.now()}`;

  // 7. INSERT into github_webhook_log → succeeds
  let insertSucceeded = false;
  try {
    db.prepare(`
      INSERT INTO github_webhook_log (delivery_id, event_type, action, repo_full_name, sender_login, payload, signature_valid, processed)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(testDeliveryId, 'push', 'created', 'mahitechgroup/mahi-platform', 'octocat', '{"ref":"refs/heads/main"}', 1, 0);
    insertSucceeded = true;
  } catch (e) {
    console.error('Insert error:', e);
  }
  assert(insertSucceeded, 'INSERT into github_webhook_log → succeeds', `delivery_id: ${testDeliveryId}`);

  // 8. UPDATE on github_webhook_log → throws "github_webhook_log is append-only"
  let updateErrorMsg = '';
  try {
    db.prepare(`UPDATE github_webhook_log SET payload = 'tampered' WHERE delivery_id = ?`).run(testDeliveryId);
  } catch (err) {
    updateErrorMsg = err.message || '';
  }
  assert(
    updateErrorMsg.includes('github_webhook_log is append-only'),
    'UPDATE on github_webhook_log → throws "github_webhook_log is append-only"',
    `Caught: ${updateErrorMsg}`
  );

  // 9. DELETE on github_webhook_log → throws "github_webhook_log rows cannot be deleted"
  let deleteErrorMsg = '';
  try {
    db.prepare(`DELETE FROM github_webhook_log WHERE delivery_id = ?`).run(testDeliveryId);
  } catch (err) {
    deleteErrorMsg = err.message || '';
  }
  assert(
    deleteErrorMsg.includes('github_webhook_log rows cannot be deleted'),
    'DELETE on github_webhook_log → throws "github_webhook_log rows cannot be deleted"',
    `Caught: ${deleteErrorMsg}`
  );

  // 10. Row still exists after failed UPDATE/DELETE attempts
  const webhookRow = queryOne('SELECT * FROM github_webhook_log WHERE delivery_id = ?', [testDeliveryId]);
  const rowIntact = webhookRow && webhookRow.delivery_id === testDeliveryId && webhookRow.payload === '{"ref":"refs/heads/main"}';
  assert(rowIntact, 'Row still exists after failed UPDATE/DELETE attempts', `Row delivery_id: ${webhookRow?.delivery_id}, payload: ${webhookRow?.payload}`);

  // ===================================================================
  // GROUP 3: Indexes (4 assertions)
  // ===================================================================
  console.log('\n--- GROUP 3: Indexes (4 assertions) ---');

  const allIndexes = queryAll("SELECT name FROM sqlite_master WHERE type = 'index'").map(i => i.name);

  // 11. idx_user_github_links_user_id exists
  assert(allIndexes.includes('idx_user_github_links_user_id'), 'idx_user_github_links_user_id exists');

  // 12. idx_project_github_repos_project_id exists
  assert(allIndexes.includes('idx_project_github_repos_project_id'), 'idx_project_github_repos_project_id exists');

  // 13. idx_proj_gh_memberships_project_id exists
  assert(allIndexes.includes('idx_proj_gh_memberships_project_id'), 'idx_proj_gh_memberships_project_id exists');

  // 14. idx_gh_webhook_log_event_type exists
  assert(allIndexes.includes('idx_gh_webhook_log_event_type'), 'idx_gh_webhook_log_event_type exists');

  // ===================================================================
  // GROUP 4: Foreign Key Integrity (3 assertions)
  // ===================================================================
  console.log('\n--- GROUP 4: Foreign Key Integrity (3 assertions) ---');

  // 15. user_github_links INSERT with non-existent user_id → must fail
  let fkUserFailed = false;
  try {
    db.prepare(`
      INSERT INTO user_github_links (user_id, github_username, github_node_id, linked_by)
      VALUES (?, ?, ?, ?)
    `).run('non-existent-user-uuid-12345', 'ghost_user', 'MDQ6VXNlcjE=', 'admin');
  } catch (err) {
    if (err.message && (err.message.includes('FOREIGN KEY constraint failed') || err.message.includes('constraint'))) {
      fkUserFailed = true;
    }
  }
  assert(fkUserFailed, 'user_github_links INSERT with non-existent user_id → must fail (FOREIGN KEY constraint)');

  // 16. project_github_repos INSERT with non-existent project_id → fail
  let fkProjectFailed = false;
  try {
    db.prepare(`
      INSERT INTO project_github_repos (project_id, repo_name, repo_full_name, repo_url, status)
      VALUES (?, ?, ?, ?, ?)
    `).run('non-existent-proj-uuid-12345', 'phantom-repo', 'mahitechgroup/phantom-repo', 'https://github.com/mahitechgroup/phantom-repo', 'ACTIVE');
  } catch (err) {
    if (err.message && (err.message.includes('FOREIGN KEY constraint failed') || err.message.includes('constraint'))) {
      fkProjectFailed = true;
    }
  }
  assert(fkProjectFailed, 'project_github_repos INSERT with non-existent project_id → fail (FOREIGN KEY constraint)');

  // 17. project_github_memberships INSERT with invalid role → fail (CHECK constraint)
  let invalidRoleFailed = false;
  try {
    db.prepare(`
      INSERT INTO project_github_memberships (project_id, user_id, github_username, role, team_slug, status)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(testProjectId, `another-user-${Date.now()}`, 'valid_gh_user', 'invalid_hacker_role', 'devs', 'ACTIVE');
  } catch (err) {
    if (err.message && (err.message.includes('CHECK constraint failed') || err.message.includes('constraint'))) {
      invalidRoleFailed = true;
    }
  }
  assert(invalidRoleFailed, 'project_github_memberships INSERT with invalid role → fail (CHECK constraint)');

  // ===================================================================
  // GROUP 5: Config Loader (3 assertions)
  // ===================================================================
  console.log('\n--- GROUP 5: Config Loader (3 assertions) ---');

  // Create temporary certs directory and temporary key file
  const certsDir = path.resolve(__dirname, '../certs');
  fs.mkdirSync(certsDir, { recursive: true });
  const tempKeyPath = path.join(certsDir, `test-temp-${Date.now()}.pem`);
  const samplePem = '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA0...SAMPLE_TEST_KEY...\n-----END RSA PRIVATE KEY-----';
  fs.writeFileSync(tempKeyPath, samplePem, 'utf8');

  // Backup original env vars
  const origAppId = process.env.GITHUB_APP_ID;
  const origKeyPath = process.env.GITHUB_APP_PRIVATE_KEY_PATH;
  const origSecret = process.env.GITHUB_WEBHOOK_SECRET;
  const origOrg = process.env.GITHUB_ORG_NAME;
  const origInstId = process.env.GITHUB_APP_INSTALLATION_ID;

  try {
    // 18. github.config.js loads without error when env vars present
    process.env.GITHUB_APP_ID = '987654';
    process.env.GITHUB_APP_PRIVATE_KEY_PATH = tempKeyPath;
    process.env.GITHUB_WEBHOOK_SECRET = 'a'.repeat(32); // exactly 32 chars
    process.env.GITHUB_ORG_NAME = 'mahitechgroup';
    process.env.GITHUB_APP_INSTALLATION_ID = '54321';

    const { default: loadedConfig } = await import(`../src/config/github.config.js?test=valid-${Date.now()}`);
    const configValid =
      loadedConfig &&
      loadedConfig.appId === '987654' &&
      loadedConfig.privateKey === samplePem &&
      loadedConfig.webhookSecret === 'a'.repeat(32) &&
      loadedConfig.orgName === 'mahitechgroup' &&
      loadedConfig.installationId === '54321' &&
      Object.isFrozen(loadedConfig);

    assert(configValid, 'github.config.js loads without error when env vars present', `appId=${loadedConfig?.appId}, orgName=${loadedConfig?.orgName}, frozen=${Object.isFrozen(loadedConfig)}`);

    // 19. Missing GITHUB_APP_ID → throws descriptive error
    delete process.env.GITHUB_APP_ID;
    let missingAppIdThrew = false;
    let missingAppIdMsg = '';
    try {
      await import(`../src/config/github.config.js?test=missing-app-id-${Date.now()}`);
    } catch (err) {
      missingAppIdThrew = true;
      missingAppIdMsg = err.message || '';
    }
    assert(
      missingAppIdThrew && missingAppIdMsg.includes('GITHUB_APP_ID'),
      'Missing GITHUB_APP_ID → throws descriptive error',
      `Caught: ${missingAppIdMsg}`
    );

    // 20. GITHUB_WEBHOOK_SECRET < 32 chars → throws descriptive error
    process.env.GITHUB_APP_ID = '987654';
    process.env.GITHUB_WEBHOOK_SECRET = 'short_secret_only_24_ch!'; // 24 chars < 32
    let shortSecretThrew = false;
    let shortSecretMsg = '';
    try {
      await import(`../src/config/github.config.js?test=short-secret-${Date.now()}`);
    } catch (err) {
      shortSecretThrew = true;
      shortSecretMsg = err.message || '';
    }
    assert(
      shortSecretThrew && shortSecretMsg.includes('GITHUB_WEBHOOK_SECRET'),
      'GITHUB_WEBHOOK_SECRET < 32 chars → throws descriptive error',
      `Caught: ${shortSecretMsg}`
    );
  } finally {
    // Clean up temporary cert
    try {
      if (fs.existsSync(tempKeyPath)) {
        fs.unlinkSync(tempKeyPath);
      }
    } catch (e) {}

    // Restore original env vars
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
  console.log(`PRD 17 BATCH 1 TEST RESULTS: ${passedTests}/${totalTests} PASSED`);
  console.log('===================================================================');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
