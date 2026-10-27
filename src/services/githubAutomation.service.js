import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { Octokit } from '@octokit/rest';
import githubConfig, { validateAndLoadGithubConfig } from '../config/github.config.js';
import { queryOne, queryAll, execute } from '../db/database.js';

// In-memory token cache (module-level, not exported)
let _cachedToken = null; // { token: string, expiresAt: Date }

// Custom mock injection hooks for testing
let _customOctokit = null;
let _customAppOctokit = null;

export function setOctokitInstance(mockInstance) {
  _customOctokit = mockInstance;
}

export function setAppOctokit(mockAppInstance) {
  _customAppOctokit = mockAppInstance;
}

export function _resetTokenCache() {
  _cachedToken = null;
}

/**
 * Returns active GitHub config
 */
function getConfig() {
  if (githubConfig && githubConfig.appId) {
    return githubConfig;
  }
  return validateAndLoadGithubConfig(process.env);
}

/**
 * FUNCTION 1: generateJWT()
 * Generates a short-lived RS256 JWT for GitHub App authentication.
 * NEVER logs or exposes the private key or JWT.
 */
export function generateJWT() {
  const config = getConfig();
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iat: now - 60, // 60s clock skew buffer
    exp: now + (10 * 60), // 10 minutes expiry max
    iss: config.appId,
  };

  return jwt.sign(payload, config.privateKey, { algorithm: 'RS256' });
}

/**
 * FUNCTION 2: getInstallationToken()
 * Exchanges the JWT for a short-lived Installation Access Token.
 * Caches token in-memory and reuses if >60s remain.
 * NEVER logs or exposes the token value.
 */
export async function getInstallationToken() {
  if (_cachedToken && _cachedToken.expiresAt && (_cachedToken.expiresAt.getTime() - Date.now() > 60000)) {
    return _cachedToken.token;
  }

  const config = getConfig();
  const appJwt = generateJWT();

  let response;
  if (_customAppOctokit && typeof _customAppOctokit.createInstallationAccessToken === 'function') {
    response = await _customAppOctokit.createInstallationAccessToken({
      installation_id: config.installationId || 1,
    });
  } else if (_customAppOctokit && typeof _customAppOctokit.request === 'function') {
    response = await _customAppOctokit.request('POST /app/installations/{installation_id}/access_tokens', {
      installation_id: config.installationId || 1,
    });
  } else {
    const octokit = new Octokit({ auth: appJwt });
    response = await octokit.request('POST /app/installations/{installation_id}/access_tokens', {
      installation_id: config.installationId,
    });
  }

  const token = response.data?.token || response.token;
  if (!token) {
    throw new Error('Failed to retrieve installation access token from GitHub');
  }

  const expiresAt = response.data?.expires_at ? new Date(response.data.expires_at) : new Date(Date.now() + 3600 * 1000);

  _cachedToken = {
    token,
    expiresAt,
  };

  return _cachedToken.token;
}

/**
 * FUNCTION 3: getAuthedOctokit()
 * Returns an authenticated Octokit instance using current installation token.
 */
export async function getAuthedOctokit() {
  if (_customOctokit) {
    return _customOctokit;
  }
  const token = await getInstallationToken();
  return new Octokit({ auth: token });
}

/**
 * Helper to sanitize project name into a GitHub repo slug
 * Prefix: "mahi-" + slug, max 50 characters total
 */
function sanitizeRepoSlug(projectName) {
  if (!projectName || typeof projectName !== 'string') {
    projectName = 'project';
  }
  const baseSlug = projectName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  let fullSlug = `mahi-${baseSlug}`;
  if (fullSlug.length > 50) {
    fullSlug = fullSlug.slice(0, 50).replace(/-+$/, '');
  }
  return fullSlug;
}

/**
 * FUNCTION 4: createProjectRepo(projectId, projectName)
 * Creates a GitHub repository for a project under the organization.
 * Stores record in project_github_repos table.
 */
export async function createProjectRepo(projectId, projectName) {
  const config = getConfig();
  const repoSlug = sanitizeRepoSlug(projectName);
  const repoFullName = `${config.orgName}/${repoSlug}`;

  try {
    const octokit = await getAuthedOctokit();
    const res = await octokit.repos.createInOrg({
      org: config.orgName,
      name: repoSlug,
      description: `Mahi Tech Group — ${projectName}`,
      private: true,
      auto_init: true,
      default_branch: 'main',
    });

    const repoData = res.data || {};
    const repoId = repoData.id || Math.floor(Math.random() * 1000000);
    const fullRepoName = repoData.full_name || repoFullName;
    const repoUrl = repoData.html_url || `https://github.com/${fullRepoName}`;

    execute(`
      INSERT INTO project_github_repos (
        id, project_id, github_repo_id, repo_name, repo_full_name, repo_url, default_branch, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'main', 'ACTIVE', datetime('now'), datetime('now'))
      ON CONFLICT(project_id) DO UPDATE SET
        github_repo_id = excluded.github_repo_id,
        repo_name = excluded.repo_name,
        repo_full_name = excluded.repo_full_name,
        repo_url = excluded.repo_url,
        status = 'ACTIVE',
        updated_at = datetime('now')
    `, [crypto.randomUUID(), projectId, repoId, repoSlug, fullRepoName, repoUrl]);

    return {
      repoId,
      repoFullName: fullRepoName,
      repoUrl,
    };
  } catch (err) {
    console.error(`Error creating project repo for project ${projectId}: ${err.message}`);

    execute(`
      INSERT INTO project_github_repos (
        id, project_id, github_repo_id, repo_name, repo_full_name, repo_url, default_branch, status, created_at, updated_at
      ) VALUES (?, ?, NULL, ?, ?, '', 'main', 'FAILED', datetime('now'), datetime('now'))
      ON CONFLICT(project_id) DO UPDATE SET
        status = 'FAILED',
        updated_at = datetime('now')
    `, [crypto.randomUUID(), projectId, repoSlug, repoFullName]);

    throw err;
  }
}

/**
 * FUNCTION 5: createGitFlowBranches(repoFullName)
 * Sets up GitFlow branches in order:
 * develop (from main), then feature/research, feature/design, feature/dev, feature/test (from develop).
 */
export async function createGitFlowBranches(repoFullName) {
  const [owner, repo] = repoFullName.split('/');
  const octokit = await getAuthedOctokit();

  // 1. Get SHA of main branch
  const mainRef = await octokit.git.getRef({
    owner,
    repo,
    ref: 'heads/main',
  });
  const mainSha = mainRef.data.object.sha;

  // 2. Create develop from main SHA
  try {
    await octokit.git.createRef({
      owner,
      repo,
      ref: 'refs/heads/develop',
      sha: mainSha,
    });
  } catch (err) {
    if (err.status === 422 || (err.message && err.message.includes('Reference already exists'))) {
      console.warn(`Branch develop already exists in ${repoFullName}`);
    } else {
      throw err;
    }
  }

  // 3. Get SHA of develop branch
  const devRef = await octokit.git.getRef({
    owner,
    repo,
    ref: 'heads/develop',
  });
  const devSha = devRef.data.object.sha;

  // 4. Create all 4 feature branches from develop SHA
  const featureBranches = [
    'feature/research',
    'feature/design',
    'feature/dev',
    'feature/test',
  ];

  for (const branch of featureBranches) {
    try {
      await octokit.git.createRef({
        owner,
        repo,
        ref: `refs/heads/${branch}`,
        sha: devSha,
      });
    } catch (err) {
      if (err.status === 422 || (err.message && err.message.includes('Reference already exists'))) {
        console.warn(`Branch ${branch} already exists in ${repoFullName}`);
      } else {
        throw err;
      }
    }
  }

  return {
    branches: ['main', 'develop', ...featureBranches],
  };
}

/**
 * FUNCTION 6: createProjectTeams(projectId, repoFullName)
 * Creates 6 per-role GitHub teams under the org for this project and grants repo permissions.
 */
export async function createProjectTeams(projectId, repoFullName) {
  const config = getConfig();
  const [owner, repo] = repoFullName.split('/');
  const octokit = await getAuthedOctokit();

  const roleConfigs = [
    { role: 'researcher', permission: 'push' },
    { role: 'designer', permission: 'push' },
    { role: 'developer', permission: 'push' },
    { role: 'tester', permission: 'push' },
    { role: 'lead', permission: 'maintain' },
    { role: 'admin', permission: 'admin' },
  ];

  const teamMap = {};

  for (const rc of roleConfigs) {
    const cleanRepo = repo.startsWith('mahi-') ? repo.slice(5) : repo;
    const teamName = `mahi-${cleanRepo}-${rc.role}`;
    let teamSlug = teamName.toLowerCase().replace(/[^a-z0-9]+/g, '-');

    try {
      const createRes = await octokit.teams.create({
        org: config.orgName,
        name: teamName,
        privacy: 'closed',
      });
      if (createRes.data && createRes.data.slug) {
        teamSlug = createRes.data.slug;
      }
    } catch (err) {
      if (err.status === 422 || (err.message && err.message.includes('already exists'))) {
        console.warn(`Team ${teamName} already exists`);
      } else {
        throw err;
      }
    }

    await octokit.teams.addOrUpdateRepoPermissionsInOrg({
      org: config.orgName,
      team_slug: teamSlug,
      owner,
      repo,
      permission: rc.permission,
    });

    teamMap[rc.role] = teamSlug;
  }

  return teamMap;
}

/**
 * FUNCTION 7: setBranchProtection(repoFullName)
 * Sets branch protection rules on main and develop.
 */
export async function setBranchProtection(repoFullName) {
  const [owner, repo] = repoFullName.split('/');
  const octokit = await getAuthedOctokit();

  // Protection for main
  await octokit.repos.updateBranchProtection({
    owner,
    repo,
    branch: 'main',
    required_pull_request_reviews: {
      required_approving_review_count: 1,
      dismiss_stale_reviews: true,
    },
    enforce_admins: true,
    required_status_checks: null,
    restrictions: null,
    allow_force_pushes: false,
    allow_deletions: false,
  });

  // Protection for develop
  await octokit.repos.updateBranchProtection({
    owner,
    repo,
    branch: 'develop',
    required_pull_request_reviews: {
      required_approving_review_count: 1,
      dismiss_stale_reviews: false,
    },
    enforce_admins: false,
    required_status_checks: null,
    restrictions: null,
    allow_force_pushes: false,
    allow_deletions: true,
  });

  return {
    main: 'protected',
    develop: 'protected',
  };
}

/**
 * FUNCTION 8: addMemberToTeam(projectId, userId, role)
 * Adds a platform member to the correct GitHub team for their role on this project.
 */
export async function addMemberToTeam(projectId, userId, role) {
  const config = getConfig();

  // 1. Look up user's github_username from user_github_links
  const link = queryOne('SELECT github_username FROM user_github_links WHERE user_id = ?', [userId]);
  if (!link || !link.github_username) {
    throw new Error('User has no linked GitHub account. Link GitHub account before adding to team.');
  }
  const githubUsername = link.github_username;

  // 2. Look up repo_name for project to derive teamSlug
  const repoRow = queryOne('SELECT repo_name FROM project_github_repos WHERE project_id = ?', [projectId]);
  const repoSlug = repoRow?.repo_name || `project-${projectId.slice(0, 8)}`;
  const cleanSlug = repoSlug.startsWith('mahi-') ? repoSlug.slice(5) : repoSlug;
  const teamSlug = `mahi-${cleanSlug}-${role}`;

  // 3. Call GitHub API
  const octokit = await getAuthedOctokit();
  await octokit.teams.addOrUpdateMembershipForUserInOrg({
    org: config.orgName,
    team_slug: teamSlug,
    username: githubUsername,
  });

  // 4. INSERT into project_github_memberships
  execute(`
    INSERT INTO project_github_memberships (
      id, project_id, user_id, github_username, role, team_slug, status, added_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', datetime('now'))
  `, [crypto.randomUUID(), projectId, userId, githubUsername, role, teamSlug]);

  // 5. Log to access_log
  execute(`
    INSERT INTO access_log (id, user_id, action, resource, target_id, timestamp, created_at)
    VALUES (?, ?, 'GITHUB_MEMBER_ADDED', ?, ?, datetime('now'), datetime('now'))
  `, [crypto.randomUUID(), userId, JSON.stringify({ projectId, userId, role, teamSlug }), userId]);

  return {
    success: true,
    teamSlug,
    githubUsername,
  };
}

/**
 * FUNCTION 9: removeMemberFromTeam(projectId, userId, reason)
 * Removes a member from their GitHub team when offboarded or removed from project.
 * Status is updated to REMOVED. Row is NEVER deleted (attribution preserved).
 */
export async function removeMemberFromTeam(projectId, userId, reason) {
  const config = getConfig();

  // 1. Look up github_username
  const link = queryOne('SELECT github_username FROM user_github_links WHERE user_id = ?', [userId]);
  const githubUsername = link?.github_username;

  // 2. Look up active membership
  const membership = queryOne(`
    SELECT * FROM project_github_memberships
    WHERE project_id = ? AND user_id = ? AND status = 'ACTIVE'
  `, [projectId, userId]);

  if (!membership) {
    throw new Error('No active GitHub membership found for this project and user');
  }

  // 3. Call GitHub API
  const octokit = await getAuthedOctokit();
  if (githubUsername) {
    await octokit.teams.removeMembershipForUserInOrg({
      org: config.orgName,
      team_slug: membership.team_slug,
      username: githubUsername,
    });
  }

  // 4. UPDATE project_github_memberships
  execute(`
    UPDATE project_github_memberships
    SET status = 'REMOVED',
        removed_at = datetime('now'),
        removed_reason = ?
    WHERE project_id = ? AND user_id = ? AND status = 'ACTIVE'
  `, [reason || 'Removed from project', projectId, userId]);

  // 5. Log to access_log
  execute(`
    INSERT INTO access_log (id, user_id, action, resource, target_id, timestamp, created_at)
    VALUES (?, ?, 'GITHUB_MEMBER_REMOVED', ?, ?, datetime('now'), datetime('now'))
  `, [crypto.randomUUID(), userId, JSON.stringify({ projectId, userId, reason }), userId]);

  return {
    success: true,
    removedFrom: membership.team_slug,
  };
}

/**
 * FUNCTION 10: linkUserGitHub(userId, githubUsername, githubNodeId, linkedBy)
 * Links a platform user to their GitHub account.
 */
export async function linkUserGitHub(userId, githubUsername, githubNodeId, linkedBy) {
  // 1. Verify userId exists in users table
  const user = queryOne('SELECT id FROM users WHERE id = ?', [userId]);
  if (!user) {
    throw new Error('User not found');
  }

  // 2. Check if user already has a link
  const existing = queryOne('SELECT id FROM user_github_links WHERE user_id = ?', [userId]);
  if (existing) {
    throw new Error('GitHub account already linked. Unlink first to re-link.');
  }

  // 3. INSERT into user_github_links
  execute(`
    INSERT INTO user_github_links (
      id, user_id, github_username, github_node_id, linked_by, linked_at
    ) VALUES (?, ?, ?, ?, ?, datetime('now'))
  `, [crypto.randomUUID(), userId, githubUsername, githubNodeId || 'node_id', linkedBy || userId]);

  // 4. Log to access_log
  const actor = linkedBy ? queryOne('SELECT id FROM users WHERE id = ?', [linkedBy]) : null;
  const actorId = actor ? actor.id : userId;

  execute(`
    INSERT INTO access_log (id, user_id, action, resource, target_id, timestamp, created_at)
    VALUES (?, ?, 'GITHUB_ACCOUNT_LINKED', ?, ?, datetime('now'), datetime('now'))
  `, [crypto.randomUUID(), actorId, JSON.stringify({ userId, githubUsername, linkedBy }), userId]);

  return {
    success: true,
    githubUsername,
  };
}

/**
 * FUNCTION 11: archiveProjectRepo(projectId)
 * Archives the GitHub repo when project is completed.
 */
export async function archiveProjectRepo(projectId) {
  const config = getConfig();

  // 1. Look up repo
  const repo = queryOne('SELECT * FROM project_github_repos WHERE project_id = ?', [projectId]);
  if (!repo || repo.status !== 'ACTIVE') {
    throw new Error('Project repository not found or not in ACTIVE status');
  }

  // 2. Call GitHub API
  const octokit = await getAuthedOctokit();
  await octokit.repos.update({
    owner: config.orgName,
    repo: repo.repo_name,
    archived: true,
  });

  // 3. UPDATE project_github_repos
  execute(`
    UPDATE project_github_repos
    SET status = 'ARCHIVED',
        archived_at = datetime('now'),
        updated_at = datetime('now')
    WHERE project_id = ?
  `, [projectId]);

  // 4. Log to access_log
  execute(`
    INSERT INTO access_log (id, user_id, action, resource, target_id, timestamp, created_at)
    VALUES (?, ?, 'GITHUB_REPO_ARCHIVED', ?, ?, datetime('now'), datetime('now'))
  `, [crypto.randomUUID(), null, JSON.stringify({ projectId, repoFullName: repo.repo_full_name }), projectId]);

  return {
    success: true,
    status: 'ARCHIVED',
  };
}

/**
 * FUNCTION 12: setupProjectGitHub(projectId, projectName)
 * Orchestrator function executing sequential setup:
 * Step 1: createProjectRepo
 * Step 2: createGitFlowBranches
 * Step 3: createProjectTeams
 * Step 4: setBranchProtection
 */
export async function setupProjectGitHub(projectId, projectName) {
  let step = 'createProjectRepo';
  try {
    // Step 1: create repo
    const repo = await createProjectRepo(projectId, projectName);

    // Step 2: create branches
    step = 'createGitFlowBranches';
    const branches = await createGitFlowBranches(repo.repoFullName);

    // Step 3: create teams
    step = 'createProjectTeams';
    const teams = await createProjectTeams(projectId, repo.repoFullName);

    // Step 4: set branch protection
    step = 'setBranchProtection';
    const protection = await setBranchProtection(repo.repoFullName);

    return {
      repoFullName: repo.repoFullName,
      repoUrl: repo.repoUrl,
      branches: branches.branches,
      teams,
      protection,
    };
  } catch (err) {
    console.error(`setupProjectGitHub failed at step '${step}' for project ${projectId}: ${err.message}`);

    execute(`
      UPDATE project_github_repos
      SET status = 'FAILED',
          updated_at = datetime('now')
      WHERE project_id = ?
    `, [projectId]);

    throw new Error(`GitHub project setup failed at step '${step}': ${err.message}`);
  }
}

export default {
  setupProjectGitHub,
  createProjectRepo,
  createGitFlowBranches,
  createProjectTeams,
  setBranchProtection,
  addMemberToTeam,
  removeMemberFromTeam,
  linkUserGitHub,
  archiveProjectRepo,
  getInstallationToken,
};
