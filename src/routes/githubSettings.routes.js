import express from 'express';
import { queryOne, queryAll } from '../db/database.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

/**
 * Middleware: requireAdmin
 * Enforces server-side Admin role check.
 */
function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden: Admin role required' });
  }
  next();
}

/**
 * ROUTE 1: POST /api/github/settings/link-account
 * Allows any authenticated user to link their GitHub account.
 */
router.post('/link-account', authenticate, async (req, res) => {
  const { githubUsername, githubNodeId } = req.body || {};

  if (!githubUsername || !githubNodeId) {
    return res.status(400).json({ error: 'Missing required fields: githubUsername and githubNodeId' });
  }

  try {
    const { linkUserGitHub } = await import('../services/githubAutomation.service.js');
    const result = await linkUserGitHub(req.user.id, githubUsername.trim(), githubNodeId.trim(), req.user.id);
    return res.status(201).json({ success: true, githubUsername: result.githubUsername });
  } catch (err) {
    if (err.message && err.message.includes('already linked')) {
      return res.status(409).json({ error: err.message });
    }
    return res.status(400).json({ error: err.message });
  }
});

/**
 * ROUTE 2: GET /api/github/settings/my-link
 * Returns current user's linked GitHub account details.
 */
router.get('/my-link', authenticate, (req, res) => {
  const link = queryOne(`
    SELECT github_username, linked_at
    FROM user_github_links
    WHERE user_id = ?
  `, [req.user.id]);

  if (!link) {
    return res.status(200).json({ linked: false });
  }

  return res.status(200).json({
    linked: true,
    githubUsername: link.github_username,
    linkedAt: link.linked_at,
  });
});

/**
 * ROUTE 3: POST /api/github/settings/admin/link-member
 * Allows Admins to link a member's GitHub account on their behalf.
 */
router.post('/admin/link-member', authenticate, requireAdmin, async (req, res) => {
  const { userId, githubUsername, githubNodeId } = req.body || {};

  if (!userId || !githubUsername || !githubNodeId) {
    return res.status(400).json({ error: 'Missing required fields: userId, githubUsername, githubNodeId' });
  }

  const targetUser = queryOne('SELECT id FROM users WHERE id = ?', [userId]);
  if (!targetUser) {
    return res.status(404).json({ error: 'User not found' });
  }

  try {
    const { linkUserGitHub } = await import('../services/githubAutomation.service.js');
    await linkUserGitHub(userId, githubUsername.trim(), githubNodeId.trim(), req.user.id);
    return res.status(201).json({ success: true });
  } catch (err) {
    if (err.message && err.message.includes('already linked')) {
      return res.status(409).json({ error: err.message });
    }
    return res.status(400).json({ error: err.message });
  }
});

/**
 * ROUTE 8: GET /api/github/settings/webhook-log
 * Admin-only audit route returning append-only webhook deliveries.
 * NEVER returns the payload column (blocks sensitive payload leakage).
 */
router.get('/webhook-log', authenticate, requireAdmin, (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
  const eventType = req.query.eventType ? String(req.query.eventType).trim() : null;

  let whereClause = '';
  const params = [];

  if (eventType && eventType !== 'all') {
    if (eventType === 'invalid_signature') {
      whereClause = 'WHERE signature_valid = 0';
    } else {
      whereClause = 'WHERE event_type = ?';
      params.push(eventType);
    }
  }

  const countRow = queryOne(`SELECT COUNT(*) as total FROM github_webhook_log ${whereClause}`, params);
  const total = countRow ? countRow.total : 0;

  const logs = queryAll(`
    SELECT id, delivery_id, event_type, action, repo_full_name, sender_login, signature_valid, processed, error_message, received_at
    FROM github_webhook_log
    ${whereClause}
    ORDER BY received_at DESC
    LIMIT ? OFFSET ?
  `, [...params, limit, offset]);

  const formattedLogs = logs.map(l => ({
    id: l.id,
    delivery_id: l.delivery_id,
    deliveryId: l.delivery_id,
    event_type: l.event_type,
    eventType: l.event_type,
    action: l.action,
    repo_full_name: l.repo_full_name,
    repoFullName: l.repo_full_name,
    sender_login: l.sender_login,
    senderLogin: l.sender_login,
    signature_valid: l.signature_valid,
    signatureValid: l.signature_valid,
    processed: l.processed,
    error_message: l.error_message,
    errorMessage: l.error_message,
    received_at: l.received_at,
    receivedAt: l.received_at,
  }));

  return res.status(200).json({ logs: formattedLogs, total });
});

/**
 * ROUTE 4: GET /api/github/settings/projects/:projectId/repo
 * Returns GitHub repository metadata for a project.
 */
router.get('/projects/:projectId/repo', authenticate, (req, res) => {
  const { projectId } = req.params;

  // Authorization check: User must be Admin, project owner, or project member
  if (req.user.role !== 'admin') {
    const isOwner = queryOne('SELECT id FROM projects WHERE id = ? AND owner_id = ?', [projectId, req.user.id]);
    const isMember = queryOne('SELECT id FROM project_members WHERE project_id = ? AND user_id = ?', [projectId, req.user.id]);
    if (!isOwner && !isMember) {
      return res.status(403).json({ error: 'Forbidden: You are not a member of this project' });
    }
  }

  const repo = queryOne(`
    SELECT * FROM project_github_repos
    WHERE project_id = ?
    ORDER BY rowid DESC
    LIMIT 1
  `, [projectId]);

  if (!repo) {
    return res.status(404).json({ error: 'No GitHub repository record found for this project' });
  }

  return res.status(200).json({
    repoFullName: repo.repo_full_name,
    repoUrl: repo.repo_url,
    status: repo.status,
    defaultBranch: repo.default_branch,
    createdAt: repo.created_at,
    archivedAt: repo.archived_at,
  });
});

/**
 * ROUTE 5: GET /api/github/settings/projects/:projectId/members
 * Admin-only route returning all project GitHub team memberships.
 */
router.get('/projects/:projectId/members', authenticate, requireAdmin, (req, res) => {
  const { projectId } = req.params;

  const members = queryAll(`
    SELECT 
      pgm.user_id as userId,
      u.name as username,
      pgm.github_username as githubUsername,
      pgm.role,
      pgm.team_slug as teamSlug,
      pgm.status,
      pgm.added_at as addedAt,
      pgm.removed_at as removedAt,
      pgm.removed_reason as removedReason
    FROM project_github_memberships pgm
    JOIN users u ON pgm.user_id = u.id
    WHERE pgm.project_id = ?
    ORDER BY pgm.added_at DESC
  `, [projectId]);

  return res.status(200).json(members);
});

/**
 * ROUTE 6: POST /api/github/settings/projects/:projectId/members/:userId/add
 * Admin-only route to add a project member to their GitHub role sub-team.
 */
router.post('/projects/:projectId/members/:userId/add', authenticate, requireAdmin, async (req, res) => {
  const { projectId, userId } = req.params;
  const { role } = req.body || {};

  const allowedRoles = ['researcher', 'designer', 'developer', 'tester', 'lead'];
  if (!role || !allowedRoles.includes(role)) {
    return res.status(400).json({ error: `Invalid role: must be one of ${allowedRoles.join(', ')}` });
  }

  // Check if user has linked GitHub account
  const link = queryOne('SELECT github_username FROM user_github_links WHERE user_id = ?', [userId]);
  if (!link || !link.github_username) {
    return res.status(400).json({ error: 'User has no linked GitHub account. Link GitHub account before adding to team.' });
  }

  // Check if already an active member
  const existing = queryOne(`
    SELECT id FROM project_github_memberships
    WHERE project_id = ? AND user_id = ? AND status = 'ACTIVE'
  `, [projectId, userId]);

  if (existing) {
    return res.status(409).json({ error: 'Already an active member of this project GitHub team' });
  }

  try {
    const { addMemberToTeam } = await import('../services/githubAutomation.service.js');
    const result = await addMemberToTeam(projectId, userId, role);
    return res.status(200).json({ success: true, teamSlug: result.teamSlug });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

/**
 * ROUTE 7: DELETE /api/github/settings/projects/:projectId/members/:userId
 * Admin-only route to remove a member from a GitHub team. Preserves attribution permanent history.
 */
router.delete('/projects/:projectId/members/:userId', authenticate, requireAdmin, async (req, res) => {
  const { projectId, userId } = req.params;
  const { reason } = req.body || {};

  if (!reason || typeof reason !== 'string' || reason.trim().length < 10) {
    return res.status(400).json({ error: 'Removal reason is required and must be at least 10 characters' });
  }

  const existing = queryOne(`
    SELECT id FROM project_github_memberships
    WHERE project_id = ? AND user_id = ? AND status = 'ACTIVE'
  `, [projectId, userId]);

  if (!existing) {
    return res.status(400).json({ error: 'No active GitHub membership found for this project and user' });
  }

  try {
    const { removeMemberFromTeam } = await import('../services/githubAutomation.service.js');
    await removeMemberFromTeam(projectId, userId, reason.trim());
    return res.status(200).json({ success: true });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

/**
 * ROUTE 9: POST /api/github/settings/projects/:projectId/setup
 * Admin-only route to orchestrate full GitHub repository setup.
 */
router.post('/projects/:projectId/setup', authenticate, requireAdmin, async (req, res) => {
  const { projectId } = req.params;
  let projectName = req.body?.projectName;

  if (!projectName) {
    const proj = queryOne('SELECT title FROM projects WHERE id = ?', [projectId]);
    if (proj?.title) {
      projectName = proj.title;
    } else {
      projectName = `Project-${projectId}`;
    }
  }

  // Check if an ACTIVE repository already exists for this project
  const existingActive = queryOne(`
    SELECT id, repo_full_name FROM project_github_repos
    WHERE project_id = ? AND status = 'ACTIVE'
  `, [projectId]);

  if (existingActive) {
    return res.status(400).json({ error: 'GitHub repository already exists for this project' });
  }

  try {
    const { setupProjectGitHub } = await import('../services/githubAutomation.service.js');
    const result = await setupProjectGitHub(projectId, projectName);
    return res.status(200).json({
      repoFullName: result.repoFullName,
      repoUrl: result.repoUrl,
      branches: result.branches,
      protection: result.protection,
    });
  } catch (err) {
    console.error(`[Project GitHub Setup Error]:`, err.message);
    return res.status(500).json({ error: err.message, step: 'setup' });
  }
});

export default router;
