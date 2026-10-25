import crypto from 'node:crypto';
import { queryOne, execute } from '../db/database.js';
import { encrypt, decrypt } from './gatewayService.js';
import { logAccess } from './auditService.js';

/**
 * GITHUB ACCESS LIFECYCLE SERVICE
 *
 * Joiner: application approval → org invite + role-team membership
 *         (least-privilege: designers/design repos, developers/code repos…)
 * Leaver: offboarding kill-switch → org removal (revokes every team, repo
 *         and pending invite in one API call) — no manual chasing.
 *
 * The PAT (org admin scope) is AES-256-GCM encrypted at rest. Until the
 * gateway is configured, every operation degrades to an honest skipped/error
 * result — the platform never pretends access was managed.
 *
 * Uses standard GitHub REST endpoints (documented, no reverse-engineering):
 *   PUT    /orgs/{org}/memberships/{user}          — invite/add member
 *   DELETE /orgs/{org}/memberships/{user}          — remove ALL access
 *   PUT    /orgs/{org}/teams/{team}/memberships/{user} — role team add
 *   GET    /rate_limit                             — connectivity check
 */

const ROLE_TEAM_MAP = {
  researcher: 'mtg-researchers',
  developer: 'mtg-developers',
  designer: 'mtg-designers',
  producer: 'mtg-testers',
  admin: null // admins are managed manually at org level
};

function getConfigRow() {
  return queryOne('SELECT * FROM github_config ORDER BY created_at ASC LIMIT 1');
}

export function getGithubConfigStatus() {
  const row = getConfigRow();
  return {
    configured: Boolean(row),
    org_login: row?.org_login || null,
    api_base: row?.api_base || 'https://api.github.com',
    role_teams: ROLE_TEAM_MAP
  };
}

export function setGithubConfig({ org_login, token, api_base, webhook_secret, adminId, ipAddress = '127.0.0.1' }) {
  if (!org_login || !token) {
    const err = new Error('org_login and token are required');
    err.status = 400;
    throw err;
  }
  let apiBase = (api_base || 'https://api.github.com').replace(/\/+$/, '');
  try {
    const u = new URL(apiBase);
    if (!['http:', 'https:'].includes(u.protocol)) throw new Error();
    apiBase = u.origin;
  } catch {
    const err = new Error('Invalid api_base URL');
    err.status = 400;
    throw err;
  }

  const existing = getConfigRow();
  const encrypted = encrypt(String(token));
  if (existing) {
    execute(`
      UPDATE github_config
      SET org_login = ?, token_encrypted = ?, api_base = ?, updated_at = CURRENT_TIMESTAMP
      ${webhook_secret !== undefined ? ', webhook_secret_encrypted = ?' : ''}
      WHERE id = ?
    `, webhook_secret !== undefined
        ? [String(org_login).trim(), encrypted, apiBase, webhook_secret ? encrypt(String(webhook_secret)) : null, existing.id]
        : [String(org_login).trim(), encrypted, apiBase, existing.id]);
  } else {
    execute(`
      INSERT INTO github_config (id, org_login, token_encrypted, webhook_secret_encrypted, api_base, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `, [crypto.randomUUID(), String(org_login).trim(), encrypted, webhook_secret ? encrypt(String(webhook_secret)) : null, apiBase]);
  }

  logAccess({
    userId: adminId,
    action: 'github_config_updated',
    resource: `/api/superadmin/github/config (org: ${org_login}, api: ${apiBase}${webhook_secret !== undefined ? ', webhook_secret: updated' : ''})`,
    ipAddress
  });

  return getGithubConfigStatus();
}

/**
 * Verifies a GitHub webhook request (X-Hub-Signature-256 = HMAC-SHA256 of the
 * raw body with the configured webhook secret — GitHub documented contract).
 */
export function verifyGithubWebhookSignature({ rawBody, signatureHeader }) {
  const row = getConfigRow();
  if (!row?.webhook_secret_encrypted) {
    return { valid: false, reason: 'Webhook secret not configured' };
  }
  const secret = decrypt(row.webhook_secret_encrypted);
  const provided = String(signatureHeader || '').replace(/^sha256=/, '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(provided)) {
    return { valid: false, reason: 'Malformed signature header' };
  }
  const expected = crypto.createHmac('sha256', secret).update(Buffer.from(String(rawBody), 'utf8')).digest('hex');
  const a = Buffer.from(provided, 'hex');
  const b = Buffer.from(expected, 'hex');
  const valid = a.length === b.length && crypto.timingSafeEqual(a, b);
  return valid ? { valid: true } : { valid: false, reason: 'Signature mismatch' };
}

function getConnection() {
  const row = getConfigRow();
  if (!row) {
    const err = new Error('GitHub access lifecycle is not configured (Super Admin → GitHub Config)');
    err.status = 503;
    throw err;
  }
  return {
    org: row.org_login,
    apiBase: row.api_base,
    token: decrypt(row.token_encrypted)
  };
}

async function ghFetch(path, { method = 'GET', body } = {}) {
  const { apiBase, token } = getConnection();
  let res;
  try {
    res = await fetch(`${apiBase}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body ? { 'Content-Type': 'application/json' } : {})
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(12_000)
    });
  } catch (e) {
    const err = new Error(`GitHub API unreachable at ${apiBase}: ${e.message}`);
    err.status = 502;
    throw err;
  }
  const data = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, data };
}

/**
 * Connectivity check (GET /rate_limit — cheapest authenticated call).
 */
export async function testGithubConnection() {
  const status = getGithubConfigStatus();
  if (!status.configured) {
    return { success: false, configured: false, note: 'GitHub config missing (org + token).' };
  }
  try {
    const res = await ghFetch('/rate_limit');
    return {
      success: res.ok,
      configured: true,
      org: status.org_login,
      api_base: status.api_base,
      http_status: res.status,
      rate_remaining: res.data?.resources?.core?.remaining ?? null,
      note: res.ok ? 'GitHub API reachable with the configured token.' : `GitHub responded HTTP ${res.status}.`
    };
  } catch (e) {
    return { success: false, configured: true, org: status.org_login, error: e.message };
  }
}

/**
 * JOINER: invite a member into the org and add them to their role team.
 * Never throws upward for integration hiccups — returns a result object so
 * the approval flow can continue (access provisioning is best-effort with
 * full audit; Admin can retry from the member list).
 */
export async function provisionMemberAccess({ userId, githubUsername, role, adminId, ipAddress = null }) {
  const user = queryOne('SELECT id, name, github_username FROM users WHERE id = ?', [userId]);
  const username = String(githubUsername || user?.github_username || '').trim();
  if (!username) {
    return { provisioned: false, reason: 'no_github_username', message: 'Member has no GitHub username on file — set it from the member list to provision access.' };
  }
  if (!getGithubConfigStatus().configured) {
    return { provisioned: false, reason: 'not_configured', message: 'GitHub access lifecycle not configured.' };
  }
  const team = ROLE_TEAM_MAP[role];

  try {
    // 1) Org membership (invite) — owners/admins already in the org cannot be
    //    re-PUT as members (GitHub self-demotion guard); that is a success path
    const invite = await ghFetch(`/orgs/${encodeURIComponent(getConnection().org)}/memberships/${encodeURIComponent(username)}`, {
      method: 'PUT',
      body: { role: 'member' }
    });
    const alreadyMember = invite.status === 403 && /demote yourself/i.test(String(invite.data?.message || ''));
    if (!invite.ok && !alreadyMember) {
      logAccess({ userId: adminId, action: 'github_provision_failed', resource: `org invite for ${username}: HTTP ${invite.status} ${JSON.stringify(invite.data).slice(0, 120)}`, ipAddress });
      return { provisioned: false, reason: 'invite_failed', http_status: invite.status, message: invite.data?.message || 'GitHub org invite failed' };
    }

    // 2) Role team (least-privilege repo scope)
    let teamAdded = null;
    if (team) {
      const teamRes = await ghFetch(`/orgs/${encodeURIComponent(getConnection().org)}/teams/${team}/memberships/${encodeURIComponent(username)}`, { method: 'PUT' });
      teamAdded = teamRes.ok;
    }

    execute('UPDATE users SET github_username = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [username, userId]);
    logAccess({
      userId: adminId,
      action: 'github_access_provisioned',
      resource: `org: ${getConnection().org} user: ${username}${team ? ` team: ${team} (added: ${teamAdded})` : ''}${alreadyMember ? ' (already org member/owner — membership unchanged)' : ''}`,
      ipAddress
    });

    return {
      provisioned: true,
      username,
      org: getConnection().org,
      team: team || null,
      team_added: teamAdded,
      already_org_member: alreadyMember
    };
  } catch (e) {
    logAccess({ userId: adminId, action: 'github_provision_error', resource: `${username}: ${e.message}`, ipAddress });
    return { provisioned: false, reason: 'error', message: e.message };
  }
}

/**
 * LEAVER: remove a member from the org — this single call revokes every
 * team, repository and pending invitation (GitHub documented behaviour).
 */
export async function revokeMemberAccess({ userId, adminId, ipAddress = null }) {
  const user = queryOne('SELECT id, github_username FROM users WHERE id = ?', [userId]);
  const username = String(user?.github_username || '').trim();
  if (!username) {
    return { revoked: false, reason: 'no_github_username', message: 'No GitHub username on file — nothing to revoke.' };
  }
  if (!getGithubConfigStatus().configured) {
    return { revoked: false, reason: 'not_configured', message: 'GitHub access lifecycle not configured.' };
  }

  try {
    const res = await ghFetch(`/orgs/${encodeURIComponent(getConnection().org)}/memberships/${encodeURIComponent(username)}`, { method: 'DELETE' });
    // 204 = removed; 404 = was not a member (pending invite path handled below)
    const removed = res.status === 204 || res.status === 404;

    // Pending invitations are a separate endpoint — cancel those too so a
    // not-yet-accepted invite cannot outlive the offboarding
    let inviteCancelled = null;
    try {
      const inviteList = await ghFetch(`/orgs/${encodeURIComponent(getConnection().org)}/invitations`);
      if (inviteList.ok && Array.isArray(inviteList.data)) {
        const match = inviteList.data.find((inv) => (inv.login || inv.username) === username);
        if (match) {
          const cancel = await ghFetch(`/orgs/${encodeURIComponent(getConnection().org)}/invitations/${match.id}`, { method: 'DELETE' });
          inviteCancelled = cancel.status === 204;
        }
      }
    } catch (e) { /* best effort */ }

    logAccess({
      userId: adminId,
      action: removed ? 'github_access_revoked' : 'github_revoke_issue',
      resource: `org: ${getConnection().org} user: ${username} (membership HTTP ${res.status}${inviteCancelled ? `, invite cancelled: ${inviteCancelled}` : ''})`,
      ipAddress
    });

    return { revoked: removed, username, org: getConnection().org, http_status: res.status, invite_cancelled: inviteCancelled };
  } catch (e) {
    logAccess({ userId: adminId, action: 'github_revoke_error', resource: `${username}: ${e.message}`, ipAddress });
    return { revoked: false, reason: 'error', message: e.message };
  }
}

export { ROLE_TEAM_MAP };
