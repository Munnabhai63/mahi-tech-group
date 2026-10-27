import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import jwt from 'jsonwebtoken';
import { getDatabase, queryOne, queryAll, execute } from '../src/db/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('===================================================================');
console.log('   PRD 17: GITHUB AUTOMATION ARCHITECTURE — BATCH 2 TEST SUITE');
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

  // Set up temporary RSA-2048 keypair for cryptographic testing
  const { privateKey: rsaPrivateKey, publicKey: rsaPublicKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
    publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
  });

  const certsDir = path.resolve(__dirname, '../certs');
  fs.mkdirSync(certsDir, { recursive: true });
  const tempKeyPath = path.join(certsDir, `test-prd17-batch2-${Date.now()}.pem`);
  fs.writeFileSync(tempKeyPath, rsaPrivateKey, 'utf8');

  // Configure environment variables before importing services
  const origAppId = process.env.GITHUB_APP_ID;
  const origKeyPath = process.env.GITHUB_APP_PRIVATE_KEY_PATH;
  const origSecret = process.env.GITHUB_WEBHOOK_SECRET;
  const origOrg = process.env.GITHUB_ORG_NAME;
  const origInstId = process.env.GITHUB_APP_INSTALLATION_ID;

  process.env.GITHUB_APP_ID = '987654';
  process.env.GITHUB_APP_PRIVATE_KEY_PATH = tempKeyPath;
  process.env.GITHUB_WEBHOOK_SECRET = 'a'.repeat(32);
  process.env.GITHUB_ORG_NAME = 'mahitechgroup';
  process.env.GITHUB_APP_INSTALLATION_ID = '54321';

  // Import service functions
  const {
    default: githubAutomation,
    generateJWT,
    getInstallationToken,
    getAuthedOctokit,
    createProjectRepo,
    createGitFlowBranches,
    createProjectTeams,
    setBranchProtection,
    addMemberToTeam,
    removeMemberFromTeam,
    linkUserGitHub,
    archiveProjectRepo,
    setupProjectGitHub,
    setOctokitInstance,
    setAppOctokit,
    _resetTokenCache,
  } = await import(`../src/services/githubAutomation.service.js?t=${Date.now()}`);

  // Prepare database entities for testing
  const ts = Date.now();
  const testUserId = `user-b2-${ts}`;
  const unlinkedUserId = `user-unlinked-${ts}`;
  const adminUserId = `admin-b2-${ts}`;
  const testIdeaId = `idea-b2-${ts}`;
  const testProjectId = `proj-b2-${ts}`;
  const testProjectId2 = `proj-b2-alt-${ts}`;

  execute(`
    INSERT INTO users (id, name, email, password_hash, role, status)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [testUserId, 'Batch2 Test User', `${testUserId}@example.com`, 'hash', 'developer', 'active']);

  execute(`
    INSERT INTO users (id, name, email, password_hash, role, status)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [unlinkedUserId, 'Unlinked User', `${unlinkedUserId}@example.com`, 'hash', 'developer', 'active']);

  execute(`
    INSERT INTO users (id, name, email, password_hash, role, status)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [adminUserId, 'Admin User', `${adminUserId}@example.com`, 'hash', 'admin', 'active']);

  execute(`
    INSERT INTO ideas (id, title, description, owner_id, status)
    VALUES (?, ?, ?, ?, ?)
  `, [testIdeaId, 'Batch 2 Test Idea', 'Idea description', testUserId, 'APPROVED']);

  execute(`
    INSERT INTO projects (id, idea_id, title, owner_id, status)
    VALUES (?, ?, ?, ?, ?)
  `, [testProjectId, testIdeaId, 'Batch 2 Test Project', testUserId, 'ACTIVE']);

  execute(`
    INSERT INTO projects (id, idea_id, title, owner_id, status)
    VALUES (?, ?, ?, ?, ?)
  `, [testProjectId2, testIdeaId, 'Batch 2 Alt Project', testUserId, 'ACTIVE']);

  try {
    // ===================================================================
    // GROUP 1: Token Generation (3 assertions)
    // ===================================================================
    console.log('--- GROUP 1: Token Generation (3 assertions) ---');

    const token = generateJWT();
    const tokenParts = typeof token === 'string' ? token.split('.') : [];
    assert(
      tokenParts.length === 3,
      'generateJWT() returns a valid JWT string (3-part dot-separated)',
      `Length: ${token.length}, segments: ${tokenParts.length}`
    );

    const decoded = jwt.verify(token, rsaPublicKey, { algorithms: ['RS256'] });
    assert(
      decoded && decoded.iss === '987654',
      'JWT payload contains correct iss = GITHUB_APP_ID',
      `Decoded iss: ${decoded?.iss}`
    );

    const nowSec = Math.floor(Date.now() / 1000);
    const expectedExp = nowSec + 600;
    const diff = Math.abs(decoded.exp - expectedExp);
    assert(
      diff <= 5,
      'JWT exp is approximately 10 minutes from now (within 5 seconds)',
      `exp: ${decoded.exp}, expected: ${expectedExp}, diff: ${diff}s`
    );

    // ===================================================================
    // GROUP 2: Octokit Auth Flow (2 assertions)
    // ===================================================================
    console.log('\n--- GROUP 2: Octokit Auth Flow (2 assertions) ---');

    _resetTokenCache();
    let appCallCount = 0;
    const mockAppOctokit = {
      request: async (route, params) => {
        appCallCount++;
        return {
          data: {
            token: 'ghs_mocked_installation_token_abc123',
            expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
          },
        };
      },
    };
    setAppOctokit(mockAppOctokit);

    const instToken = await getInstallationToken();
    assert(
      instToken === 'ghs_mocked_installation_token_abc123',
      'getInstallationToken() with mocked GitHub response returns token',
      `Received token: ${instToken?.slice(0, 10)}...`
    );

    const cachedToken = await getInstallationToken();
    assert(
      cachedToken === instToken && appCallCount === 1,
      'Cached token is reused on second call (mock called only once)',
      `Call count: ${appCallCount}, matches: ${cachedToken === instToken}`
    );

    // ===================================================================
    // GROUP 3: createProjectRepo — DB side (4 assertions)
    // ===================================================================
    console.log('\n--- GROUP 3: createProjectRepo — DB side (4 assertions) ---');

    let createInOrgCalledWith = null;
    const mockOctokit = {
      repos: {
        createInOrg: async (params) => {
          createInOrgCalledWith = params;
          return {
            data: {
              id: 8881234,
              full_name: `${params.org}/${params.name}`,
              html_url: `https://github.com/${params.org}/${params.name}`,
            },
          };
        },
        update: async (params) => ({ data: { ...params } }),
        updateBranchProtection: async (params) => ({ data: { ...params } }),
      },
      git: {
        getRef: async ({ ref }) => ({ data: { object: { sha: 'sha_123456789' } } }),
        createRef: async (params) => ({ data: { ...params } }),
      },
      teams: {
        create: async (params) => ({ data: { slug: params.name.toLowerCase() } }),
        addOrUpdateRepoPermissionsInOrg: async () => ({ data: {} }),
        addOrUpdateMembershipForUserInOrg: async () => ({ data: {} }),
        removeMembershipForUserInOrg: async () => ({ data: {} }),
      },
    };
    setOctokitInstance(mockOctokit);

    // 1. Successful repo creation inserts into project_github_repos with ACTIVE
    await createProjectRepo(testProjectId, 'My Inventory App!!');
    const repoRow = queryOne('SELECT * FROM project_github_repos WHERE project_id = ?', [testProjectId]);
    assert(
      repoRow && repoRow.status === 'ACTIVE' && repoRow.github_repo_id === 8881234,
      'Successful mock → INSERT into project_github_repos with status = \'ACTIVE\'',
      `status=${repoRow?.status}, github_repo_id=${repoRow?.github_repo_id}`
    );

    // 2. Repo slug sanitized correctly: "My Inventory App!!" → "mahi-my-inventory-app"
    assert(
      repoRow && repoRow.repo_name === 'mahi-my-inventory-app',
      'Repo slug sanitized correctly: "My Inventory App!!" → "mahi-my-inventory-app"',
      `repo_name: ${repoRow?.repo_name}`
    );

    // 3. Repo slug max 50 chars enforced
    const veryLongName = 'This Is An Extremely Long Project Title Designed To Exceed The Normal Slug Limit By Far';
    await createProjectRepo(testProjectId2, veryLongName);
    const repoRowLong = queryOne('SELECT * FROM project_github_repos WHERE project_id = ?', [testProjectId2]);
    assert(
      repoRowLong && repoRowLong.repo_name.length <= 50,
      'Repo slug max 50 chars enforced',
      `Slug: ${repoRowLong?.repo_name} (length: ${repoRowLong?.repo_name.length})`
    );

    // 4. GitHub API failure → INSERT with status = 'FAILED'
    const failedProjectId = `proj-failed-${ts}`;
    execute(`
      INSERT INTO projects (id, idea_id, title, owner_id, status)
      VALUES (?, ?, ?, ?, ?)
    `, [failedProjectId, testIdeaId, 'Failed Project Test', testUserId, 'ACTIVE']);

    mockOctokit.repos.createInOrg = async () => {
      throw new Error('GitHub API 500: Server unavailable');
    };

    let createRepoFailed = false;
    try {
      await createProjectRepo(failedProjectId, 'Failing Repo');
    } catch (e) {
      createRepoFailed = true;
    }
    const failedRepoRow = queryOne('SELECT * FROM project_github_repos WHERE project_id = ?', [failedProjectId]);
    assert(
      createRepoFailed && failedRepoRow && failedRepoRow.status === 'FAILED',
      'GitHub API failure → INSERT with status = \'FAILED\'',
      `Threw error: ${createRepoFailed}, status in DB: ${failedRepoRow?.status}`
    );

    // Restore createInOrg mock
    mockOctokit.repos.createInOrg = async (params) => ({
      data: {
        id: 8881234,
        full_name: `${params.org}/${params.name}`,
        html_url: `https://github.com/${params.org}/${params.name}`,
      },
    });

    // ===================================================================
    // GROUP 4: createGitFlowBranches (3 assertions)
    // ===================================================================
    console.log('\n--- GROUP 4: createGitFlowBranches (3 assertions) ---');

    // 1. Returns all 6 branch names in result
    const branchRes = await createGitFlowBranches('mahitechgroup/mahi-my-inventory-app');
    const expectedBranches = ['main', 'develop', 'feature/research', 'feature/design', 'feature/dev', 'feature/test'];
    const hasAllBranches =
      Array.isArray(branchRes?.branches) &&
      branchRes.branches.length === 6 &&
      expectedBranches.every((b) => branchRes.branches.includes(b));
    assert(
      hasAllBranches,
      'Returns all 6 branch names in result',
      `Branches: ${branchRes?.branches?.join(', ')}`
    );

    // 2. 422 (branch exists) error → warning logged, no throw
    mockOctokit.git.createRef = async () => {
      const err = new Error('Reference already exists');
      err.status = 422;
      throw err;
    };
    let threw422 = false;
    try {
      const res422 = await createGitFlowBranches('mahitechgroup/mahi-my-inventory-app');
      assert(
        Array.isArray(res422?.branches) && res422.branches.length === 6,
        '422 (branch exists) error → warning logged, no throw',
        'Returned branches without throwing'
      );
    } catch (e) {
      threw422 = true;
      assert(false, '422 (branch exists) error → warning logged, no throw', `Unexpectedly threw: ${e.message}`);
    }

    // 3. Other GitHub API error → throws
    mockOctokit.git.createRef = async () => {
      const err = new Error('Internal GitHub error');
      err.status = 500;
      throw err;
    };
    let threw500 = false;
    try {
      await createGitFlowBranches('mahitechgroup/mahi-my-inventory-app');
    } catch (e) {
      threw500 = true;
    }
    assert(
      threw500,
      'Other GitHub API error → throws',
      `Correctly threw 500 error: ${threw500}`
    );

    // Restore createRef
    mockOctokit.git.createRef = async (params) => ({ data: { ...params } });

    // ===================================================================
    // GROUP 5: addMemberToTeam — DB side (4 assertions)
    // ===================================================================
    console.log('\n--- GROUP 5: addMemberToTeam — DB side (4 assertions) ---');

    // 1. User with no github_link → throws correct error message
    let unlinkedThrew = false;
    let unlinkedErrMsg = '';
    try {
      await addMemberToTeam(testProjectId, unlinkedUserId, 'developer');
    } catch (e) {
      unlinkedThrew = true;
      unlinkedErrMsg = e.message;
    }
    assert(
      unlinkedThrew && unlinkedErrMsg.includes('User has no linked GitHub account'),
      'User with no github_link → throws correct error message',
      `Error: ${unlinkedErrMsg}`
    );

    // Link testUserId for subsequent tests
    await linkUserGitHub(testUserId, 'testdev_octo', 'node_testdev_123', adminUserId);

    // 2. Successful add → INSERT into project_github_memberships with status = 'ACTIVE'
    const addRes = await addMemberToTeam(testProjectId, testUserId, 'developer');
    const membership = queryOne(`
      SELECT * FROM project_github_memberships
      WHERE project_id = ? AND user_id = ?
    `, [testProjectId, testUserId]);
    assert(
      membership && membership.status === 'ACTIVE' && membership.role === 'developer',
      'Successful add → INSERT into project_github_memberships with status = \'ACTIVE\'',
      `status: ${membership?.status}, role: ${membership?.role}, team: ${membership?.team_slug}`
    );

    // 3. access_log row inserted with action = 'GITHUB_MEMBER_ADDED'
    const addAccessLog = queryOne(`
      SELECT * FROM access_log
      WHERE action = 'GITHUB_MEMBER_ADDED' AND user_id = ?
      ORDER BY rowid DESC LIMIT 1
    `, [testUserId]);
    assert(
      !!addAccessLog,
      'access_log row inserted with action = \'GITHUB_MEMBER_ADDED\'',
      `action: ${addAccessLog?.action}, resource: ${addAccessLog?.resource}`
    );

    // 4. Duplicate add (same project+user) → fails (UNIQUE constraint)
    let duplicateThrew = false;
    try {
      await addMemberToTeam(testProjectId, testUserId, 'developer');
    } catch (e) {
      duplicateThrew = true;
    }
    assert(
      duplicateThrew,
      'Duplicate add (same project+user) → fails (UNIQUE constraint)',
      `Duplicate rejection caught: ${duplicateThrew}`
    );

    // ===================================================================
    // GROUP 6: removeMemberFromTeam — DB side (4 assertions)
    // ===================================================================
    console.log('\n--- GROUP 6: removeMemberFromTeam — DB side (4 assertions) ---');

    // 1. No active membership → throws descriptive error
    let noMembershipThrew = false;
    let noMembershipMsg = '';
    try {
      await removeMemberFromTeam(testProjectId, unlinkedUserId, 'Offboarding');
    } catch (e) {
      noMembershipThrew = true;
      noMembershipMsg = e.message;
    }
    assert(
      noMembershipThrew && noMembershipMsg.includes('No active GitHub membership found'),
      'No active membership → throws descriptive error',
      `Caught: ${noMembershipMsg}`
    );

    // 2. Successful remove → status = 'REMOVED', removed_at set
    const removeRes = await removeMemberFromTeam(testProjectId, testUserId, 'Completed assigned tasks');
    const removedMem = queryOne(`
      SELECT * FROM project_github_memberships
      WHERE project_id = ? AND user_id = ?
    `, [testProjectId, testUserId]);
    assert(
      removedMem && removedMem.status === 'REMOVED' && !!removedMem.removed_at && removedMem.removed_reason === 'Completed assigned tasks',
      'Successful remove → status = \'REMOVED\', removed_at set',
      `status: ${removedMem?.status}, removed_at: ${removedMem?.removed_at}, reason: ${removedMem?.removed_reason}`
    );

    // 3. Row is NOT deleted (still exists in DB)
    const memCount = queryOne(`
      SELECT COUNT(*) as cnt FROM project_github_memberships
      WHERE project_id = ? AND user_id = ?
    `, [testProjectId, testUserId]);
    assert(
      memCount && memCount.cnt === 1,
      'Row is NOT deleted (still exists in DB)',
      `Count retained: ${memCount?.cnt}`
    );

    // 4. access_log row inserted with action = 'GITHUB_MEMBER_REMOVED'
    const removeAccessLog = queryOne(`
      SELECT * FROM access_log
      WHERE action = 'GITHUB_MEMBER_REMOVED' AND user_id = ?
      ORDER BY rowid DESC LIMIT 1
    `, [testUserId]);
    assert(
      !!removeAccessLog,
      'access_log row inserted with action = \'GITHUB_MEMBER_REMOVED\'',
      `action: ${removeAccessLog?.action}, resource: ${removeAccessLog?.resource}`
    );

    // ===================================================================
    // GROUP 7: linkUserGitHub (2 assertions)
    // ===================================================================
    console.log('\n--- GROUP 7: linkUserGitHub (2 assertions) ---');

    // 1. Non-existent userId → throws
    let nonExistentUserThrew = false;
    let nonExistentUserMsg = '';
    try {
      await linkUserGitHub('non-existent-user-uuid', 'ghost_gh', 'node_gh_ghost', 'admin');
    } catch (e) {
      nonExistentUserThrew = true;
      nonExistentUserMsg = e.message;
    }
    assert(
      nonExistentUserThrew && nonExistentUserMsg.includes('User not found'),
      'Non-existent userId → throws',
      `Caught: ${nonExistentUserMsg}`
    );

    // 2. Already linked userId → throws 'already linked' message
    let alreadyLinkedThrew = false;
    let alreadyLinkedMsg = '';
    try {
      await linkUserGitHub(testUserId, 'testdev_octo_new', 'node_123', 'admin');
    } catch (e) {
      alreadyLinkedThrew = true;
      alreadyLinkedMsg = e.message;
    }
    assert(
      alreadyLinkedThrew && alreadyLinkedMsg.includes('already linked'),
      'Already linked userId → throws \'already linked\' message',
      `Caught: ${alreadyLinkedMsg}`
    );

    // ===================================================================
    // GROUP 8: archiveProjectRepo — DB side (2 assertions)
    // ===================================================================
    console.log('\n--- GROUP 8: archiveProjectRepo — DB side (2 assertions) ---');

    // 1. No repo found → throws
    let noRepoThrew = false;
    let noRepoMsg = '';
    try {
      await archiveProjectRepo('non-existent-project-id');
    } catch (e) {
      noRepoThrew = true;
      noRepoMsg = e.message;
    }
    assert(
      noRepoThrew && (noRepoMsg.includes('not found') || noRepoMsg.includes('not in ACTIVE')),
      'No repo found → throws',
      `Caught: ${noRepoMsg}`
    );

    // 2. Successful archive → status = 'ARCHIVED', archived_at set
    const archiveRes = await archiveProjectRepo(testProjectId);
    const archivedRepo = queryOne('SELECT * FROM project_github_repos WHERE project_id = ?', [testProjectId]);
    assert(
      archiveRes?.status === 'ARCHIVED' && archivedRepo && archivedRepo.status === 'ARCHIVED' && !!archivedRepo.archived_at,
      'Successful archive → status = \'ARCHIVED\', archived_at set',
      `status: ${archivedRepo?.status}, archived_at: ${archivedRepo?.archived_at}`
    );

    // ===================================================================
    // EXTRA / INTEGRATION CHECK: Orchestrator setupProjectGitHub
    // ===================================================================
    console.log('\n--- INTEGRATION: setupProjectGitHub Orchestrator (2 assertions) ---');

    const orchProjectId = `proj-orch-${ts}`;
    execute(`
      INSERT INTO projects (id, idea_id, title, owner_id, status)
      VALUES (?, ?, ?, ?, ?)
    `, [orchProjectId, testIdeaId, 'Orchestration Project', testUserId, 'ACTIVE']);

    const orchResult = await setupProjectGitHub(orchProjectId, 'Orchestration Project');
    const orchRepo = queryOne('SELECT * FROM project_github_repos WHERE project_id = ?', [orchProjectId]);

    assert(
      orchResult &&
      orchResult.branches.length === 6 &&
      orchResult.teams.lead &&
      orchResult.protection.main === 'protected' &&
      orchRepo?.status === 'ACTIVE',
      'setupProjectGitHub executes all 4 steps sequentially and stores ACTIVE repo',
      `branches: ${orchResult?.branches?.length}, teams: ${Object.keys(orchResult?.teams || {}).length}`
    );

    // Test failure rollback / status=FAILED in orchestrator
    mockOctokit.teams.create = async () => {
      throw new Error('GitHub API rate limit exceeded');
    };
    const failOrchProjectId = `proj-orch-fail-${ts}`;
    execute(`
      INSERT INTO projects (id, idea_id, title, owner_id, status)
      VALUES (?, ?, ?, ?, ?)
    `, [failOrchProjectId, testIdeaId, 'Failing Orch Project', testUserId, 'ACTIVE']);

    let orchFailThrew = false;
    try {
      await setupProjectGitHub(failOrchProjectId, 'Failing Orch Project');
    } catch (e) {
      orchFailThrew = true;
    }
    const failOrchRepo = queryOne('SELECT * FROM project_github_repos WHERE project_id = ?', [failOrchProjectId]);
    assert(
      orchFailThrew && failOrchRepo?.status === 'FAILED',
      'setupProjectGitHub records status = \'FAILED\' upon intermediate failure',
      `Threw: ${orchFailThrew}, status: ${failOrchRepo?.status}`
    );

  } finally {
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
  console.log(`PRD 17 BATCH 2 TEST RESULTS: ${passedTests}/${totalTests} PASSED`);
  console.log('===================================================================');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});
