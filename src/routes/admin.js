import express from 'express';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { queryOne, queryAll, execute } from '../db/database.js';
import { config } from '../config.js';
import { authenticate } from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import { logAccess } from '../services/auditService.js';
import { adminOverrideDecision } from '../services/votingService.js';
import { reassignTask, adminFinalReview } from '../services/fanoutService.js';
import {
  executeOffboardingKillswitch,
  getOffboardingStatus,
  updateOffboardingChecklist,
  getOffboardingHistory,
  getFrozenWallets
} from '../services/offboardingService.js';
import {
  recordRevenueEvent,
  recordReversingEntry,
  getImmutableLedger
} from '../services/revenueService.js';
import {
  getPendingWithdrawals,
  approveWithdrawal,
  rejectWithdrawal
} from '../services/payoutService.js';

const router = express.Router();

// 4. POST /api/admin/members/add (Admin only - RBAC: member.add)
router.post('/members/add', authenticate, requirePermission('member.add'), async (req, res) => {
  const ipAddress = req.ip || req.socket.remoteAddress;
  const { name, email, role, sub_role, temporary_password } = req.body || {};

  if (!name || !email || !role) {
    return res.status(400).json({ error: 'Name, email, and role are required' });
  }

  const validRoles = ['researcher', 'developer', 'producer', 'admin'];
  if (!validRoles.includes(role)) {
    return res.status(400).json({ error: `Invalid role. Must be one of: ${validRoles.join(', ')}` });
  }

  if (sub_role && !['frontend', 'backend'].includes(sub_role)) {
    return res.status(400).json({ error: "Invalid sub_role. Must be 'frontend', 'backend', or null" });
  }

  const normalizedEmail = email.toLowerCase().trim();
  const existing = queryOne('SELECT id FROM users WHERE email = ?', [normalizedEmail]);
  if (existing) {
    return res.status(409).json({ error: 'User with this email already exists' });
  }

  const plainPassword = temporary_password || crypto.randomBytes(8).toString('hex') + 'A1!';
  const passwordHash = await bcrypt.hash(plainPassword, config.BCRYPT_SALT_ROUNDS);
  const newUserId = crypto.randomUUID();

  execute(`
    INSERT INTO users (
      id, name, email, password_hash, role, sub_role, status,
      rating_avg, idea_quota_used, quota_reset_date, wallet_balance,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'active', 0.0, 0, null, 0.0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `, [
    newUserId,
    name.trim(),
    normalizedEmail,
    passwordHash,
    role,
    sub_role || null
  ]);

  logAccess({
    userId: req.user.id,
    action: 'member_created',
    resource: `/api/admin/members/add (new_user_id: ${newUserId}, role: ${role})`,
    ipAddress
  });

  return res.status(201).json({
    message: 'Member created successfully',
    temporaryPassword: plainPassword,
    user: {
      id: newUserId,
      name: name.trim(),
      email: normalizedEmail,
      role,
      sub_role: sub_role || null,
      status: 'active'
    }
  });
});

// 5. PATCH /api/admin/members/:id/status (Admin only - RBAC: member.remove)
// NON-NEGOTIABLE RULE: NEVER USE DELETE QUERY. ONLY SOFT STATUS TRANSITION.
router.patch('/members/:id/status', authenticate, requirePermission('member.remove'), (req, res) => {
  const ipAddress = req.ip || req.socket.remoteAddress;
  const { id } = req.params;
  const { status } = req.body || {};

  const validStatuses = ['active', 'inactive', 'suspended'];
  if (!status || !validStatuses.includes(status)) {
    return res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
  }

  const targetUser = queryOne('SELECT * FROM users WHERE id = ?', [id]);
  if (!targetUser) {
    return res.status(404).json({ error: 'Member not found' });
  }

  // Prevent admin from deactivating themselves if sole admin
  if (targetUser.id === req.user.id && status !== 'active') {
    const adminCount = queryOne("SELECT COUNT(*) as count FROM users WHERE role = 'admin' AND status = 'active'");
    if (adminCount.count <= 1) {
      return res.status(400).json({ error: 'Cannot deactivate the sole active administrator' });
    }
  }

  let deactivatedAt = null;
  if (status === 'inactive' || status === 'suspended') {
    deactivatedAt = new Date().toISOString();
    // Cascade kill-switch for sessions: revoke all active sessions immediately
    execute('UPDATE sessions SET is_revoked = 1 WHERE user_id = ?', [id]);
  }

  execute(
    'UPDATE users SET status = ?, deactivated_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [status, deactivatedAt, id]
  );

  logAccess({
    userId: req.user.id,
    action: `member_status_changed_to_${status}`,
    resource: `/api/admin/members/${id}/status`,
    ipAddress
  });

  const updatedUser = queryOne(
    'SELECT id, name, email, role, sub_role, status, deactivated_at, updated_at FROM users WHERE id = ?',
    [id]
  );

  return res.status(200).json({
    message: `Member status updated to ${status} successfully`,
    user: updatedUser
  });
});

// 7. GET /api/admin/members (Admin only - RBAC: member.add)
router.get('/members', authenticate, requirePermission('member.add'), (req, res) => {
  const members = queryAll(`
    SELECT id, name, email, role, sub_role, status, rating_avg,
           idea_quota_used, quota_reset_date, wallet_balance, profile_photo_url,
           created_at, updated_at, deactivated_at
    FROM users
    ORDER BY created_at DESC
  `);

  return res.status(200).json({ members });
});

// 8. PATCH /api/admin/config/quota (Admin only)
router.patch('/config/quota', authenticate, (req, res) => {
  const ipAddress = req.ip || req.socket.remoteAddress;

  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden: Only administrators can update system configuration' });
  }

  const { limit, windowDays } = req.body || {};

  if (limit === undefined && windowDays === undefined) {
    return res.status(400).json({ error: "At least one of 'limit' or 'windowDays' must be provided" });
  }

  if (limit !== undefined) {
    const numLimit = parseInt(limit, 10);
    if (isNaN(numLimit) || numLimit < 1) {
      return res.status(400).json({ error: "'limit' must be a positive integer" });
    }
    execute(
      'UPDATE system_config SET value = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE key = ?',
      [numLimit.toString(), req.user.id, 'idea_quota_limit']
    );
  }

  if (windowDays !== undefined) {
    const numWindow = parseInt(windowDays, 10);
    if (isNaN(numWindow) || numWindow < 1) {
      return res.status(400).json({ error: "'windowDays' must be a positive integer" });
    }
    execute(
      'UPDATE system_config SET value = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE key = ?',
      [numWindow.toString(), req.user.id, 'idea_quota_window_days']
    );
  }

  const currentLimit = queryOne("SELECT value FROM system_config WHERE key = 'idea_quota_limit'")?.value;
  const currentWindow = queryOne("SELECT value FROM system_config WHERE key = 'idea_quota_window_days'")?.value;

  logAccess({
    userId: req.user.id,
    action: 'quota_config_updated',
    resource: `/api/admin/config/quota (limit: ${currentLimit}, windowDays: ${currentWindow})`,
    ipAddress
  });

  return res.status(200).json({
    message: 'Quota configuration updated successfully',
    config: {
      limit: parseInt(currentLimit, 10),
      windowDays: parseInt(currentWindow, 10)
    }
  });
});

// 9. PATCH /api/admin/ideas/:id/override (Admin only - Veto / Manual Decision)
router.patch('/ideas/:id/override', authenticate, (req, res) => {
  const ipAddress = req.ip || req.socket.remoteAddress;

  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden: Only administrators can override idea decisions' });
  }

  const { id } = req.params;
  const { decision, reason } = req.body || {};

  const overrideResult = adminOverrideDecision({
    ideaId: id,
    adminUserId: req.user.id,
    decision,
    reason,
    ipAddress
  });

  if (!overrideResult.success) {
    return res.status(overrideResult.status || 400).json({ error: overrideResult.error });
  }

  return res.status(200).json({
    message: `Idea decision manually overridden to ${decision} by Admin`,
    override: overrideResult.override,
    idea: overrideResult.idea
  });
});

// 10. PATCH /api/admin/config/voting (Admin only - Threshold / Quorum / Window hours)
router.patch('/config/voting', authenticate, (req, res) => {
  const ipAddress = req.ip || req.socket.remoteAddress;

  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden: Only administrators can update voting configuration' });
  }

  const { approvalThreshold, quorumPercentage, windowHours } = req.body || {};

  if (approvalThreshold === undefined && quorumPercentage === undefined && windowHours === undefined) {
    return res.status(400).json({ error: 'At least one voting configuration parameter must be provided' });
  }

  if (approvalThreshold !== undefined) {
    const val = parseFloat(approvalThreshold);
    if (isNaN(val) || val < 50 || val > 100) {
      return res.status(400).json({ error: 'approvalThreshold must be a percentage between 50 and 100' });
    }
    execute(
      'UPDATE system_config SET value = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE key = ?',
      [val.toString(), req.user.id, 'vote_approval_threshold']
    );
  }

  if (quorumPercentage !== undefined) {
    const val = parseFloat(quorumPercentage);
    if (isNaN(val) || val < 1 || val > 100) {
      return res.status(400).json({ error: 'quorumPercentage must be a percentage between 1 and 100' });
    }
    execute(
      'UPDATE system_config SET value = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE key = ?',
      [val.toString(), req.user.id, 'vote_quorum_percentage']
    );
  }

  if (windowHours !== undefined) {
    const val = parseInt(windowHours, 10);
    if (isNaN(val) || val < 1) {
      return res.status(400).json({ error: 'windowHours must be a positive integer' });
    }
    execute(
      'UPDATE system_config SET value = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE key = ?',
      [val.toString(), req.user.id, 'voting_window_hours']
    );
  }

  const currentThreshold = queryOne("SELECT value FROM system_config WHERE key = 'vote_approval_threshold'")?.value;
  const currentQuorum = queryOne("SELECT value FROM system_config WHERE key = 'vote_quorum_percentage'")?.value;
  const currentWindow = queryOne("SELECT value FROM system_config WHERE key = 'voting_window_hours'")?.value;

  logAccess({
    userId: req.user.id,
    action: 'voting_config_updated',
    resource: `/api/admin/config/voting (threshold: ${currentThreshold}%, quorum: ${currentQuorum}%, window: ${currentWindow}h)`,
    ipAddress
  });

  return res.status(200).json({
    message: 'Voting configuration updated successfully',
    config: {
      approvalThreshold: parseFloat(currentThreshold),
      quorumPercentage: parseFloat(currentQuorum),
      windowHours: parseInt(currentWindow, 10)
    }
  });
});

// 11. GET /api/admin/projects/all (Admin only)
router.get('/projects/all', authenticate, (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden: Only administrators can view all projects' });
  }

  const projects = queryAll(`
    SELECT p.*, u.name as owner_name, u.email as owner_email,
           (SELECT COUNT(*) FROM project_members pm WHERE pm.project_id = p.id AND pm.removed_at IS NULL) as member_count,
           (SELECT COUNT(*) FROM project_tasks pt WHERE pt.project_id = p.id) as total_tasks,
           (SELECT COUNT(*) FROM project_tasks pt WHERE pt.project_id = p.id AND pt.status = 'DONE') as done_tasks
    FROM projects p
    JOIN users u ON p.owner_id = u.id
    ORDER BY p.created_at DESC
  `);

  return res.status(200).json({
    count: projects.length,
    projects
  });
});

// 12. PATCH /api/admin/projects/:id/reassign (Admin only)
router.patch('/projects/:id/reassign', authenticate, (req, res) => {
  const ipAddress = req.ip || req.socket.remoteAddress;

  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden: Only administrators can reassign project tasks' });
  }

  const { taskId, newUserId } = req.body || {};

  if (!taskId || !newUserId) {
    return res.status(400).json({ error: 'taskId and newUserId are required' });
  }

  const result = reassignTask({
    taskId,
    newUserId,
    adminUserId: req.user.id,
    ipAddress
  });

  if (!result.success) {
    return res.status(result.status || 400).json({ error: result.error });
  }

  return res.status(200).json({
    message: 'Task successfully reassigned by Admin',
    task: result.task
  });
});

// 13. PATCH /api/admin/projects/:id/final-review (Admin only)
router.patch('/projects/:id/final-review', authenticate, (req, res) => {
  const ipAddress = req.ip || req.socket.remoteAddress;
  const { id } = req.params;

  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden: Only administrators can perform final review' });
  }

  const { approved, notes } = req.body || {};

  if (typeof approved !== 'boolean') {
    return res.status(400).json({ error: "'approved' boolean flag (true/false) is required" });
  }

  const result = adminFinalReview({
    projectId: id,
    adminUserId: req.user.id,
    approved,
    notes,
    ipAddress
  });

  if (!result.success) {
    return res.status(result.status || 400).json({ error: result.error });
  }

  return res.status(200).json({
    message: approved ? 'Project approved and moved to LIVE stage' : 'Project rejected at review',
    stage: result.stage,
    project: result.project
  });
});

// ===================================================================
// STEP 05: Offboarding Kill-Switch Endpoints (Admin Only)
// ===================================================================

// 14. POST /api/admin/members/:id/offboard (Admin only - RBAC: member.remove)
router.post('/members/:id/offboard', authenticate, requirePermission('member.remove'), (req, res) => {
  const ipAddress = req.ip || req.socket.remoteAddress;
  const { id } = req.params;
  const { reason } = req.body || {};

  const result = executeOffboardingKillswitch({
    userId: id,
    adminUserId: req.user.id,
    reason,
    ipAddress
  });

  if (!result.success) {
    return res.status(result.status || 400).json({ error: result.error, offboardingRecord: result.offboardingRecord });
  }

  return res.status(200).json({
    message: result.message,
    offboarding: result.offboarding,
    stepsExecuted: result.stepsExecuted,
    executionTimestamps: result.executionTimestamps,
    reassignedTasks: result.reassignedTasks,
    frozenAmount: result.frozenAmount,
    attributionBadge: result.attributionBadge
  });
});

// 15. GET /api/admin/offboarding/:id/status (Admin only - RBAC: member.remove)
router.get('/offboarding/:id/status', authenticate, requirePermission('member.remove'), (req, res) => {
  const { id } = req.params;
  const result = getOffboardingStatus(id);

  if (!result.success) {
    return res.status(result.status || 404).json({ error: result.error });
  }

  return res.status(200).json(result);
});

// 16. PATCH /api/admin/offboarding/:id/checklist (Admin only - RBAC: member.remove)
router.patch('/offboarding/:id/checklist', authenticate, requirePermission('member.remove'), (req, res) => {
  const ipAddress = req.ip || req.socket.remoteAddress;
  const { id } = req.params;
  const { serviceId, completed } = req.body || {};

  if (!serviceId || typeof completed !== 'boolean') {
    return res.status(400).json({ error: "serviceId and boolean 'completed' flag are required" });
  }

  const result = updateOffboardingChecklist({
    offboardingId: id,
    serviceId,
    completed,
    adminUserId: req.user.id,
    ipAddress
  });

  if (!result.success) {
    return res.status(result.status || 400).json({ error: result.error });
  }

  return res.status(200).json(result);
});

// 17. GET /api/admin/offboarding/history (Admin only - RBAC: member.remove)
router.get('/offboarding/history', authenticate, requirePermission('member.remove'), (req, res) => {
  const history = getOffboardingHistory();
  return res.status(200).json({
    count: history.length,
    offboardingHistory: history
  });
});

// 18. GET /api/admin/wallets/frozen (Admin only - RBAC: member.remove)
router.get('/wallets/frozen', authenticate, requirePermission('member.remove'), (req, res) => {
  const frozenWallets = getFrozenWallets();
  return res.status(200).json({
    count: frozenWallets.length,
    frozenWallets
  });
});

// ===================================================================
// STEP 06: Revenue Split Engine & Manual Payout Endpoints (Admin Only)
// ===================================================================

// 19. POST /api/admin/projects/:id/revenue (Admin only - RBAC: revenue.manual_entry)
router.post('/projects/:id/revenue', authenticate, requirePermission('revenue.manual_entry'), (req, res) => {
  const ipAddress = req.ip || req.socket.remoteAddress;
  const { id } = req.params;
  const { amount, source, event_date } = req.body || {};

  const result = recordRevenueEvent({
    projectId: id,
    amount,
    source,
    eventDate: event_date,
    adminUserId: req.user.id,
    ipAddress
  });

  if (!result.success) {
    return res.status(result.status || 400).json({ error: result.error });
  }

  return res.status(201).json(result);
});

// 20. POST /api/admin/projects/:id/revenue/reversal (Admin only - RBAC: revenue.manual_entry)
router.post('/projects/:id/revenue/reversal', authenticate, requirePermission('revenue.manual_entry'), (req, res) => {
  const ipAddress = req.ip || req.socket.remoteAddress;
  const { original_event_id, reason } = req.body || {};

  if (!original_event_id) {
    return res.status(400).json({ error: 'original_event_id is required' });
  }

  const result = recordReversingEntry({
    originalEventId: original_event_id,
    reason,
    adminUserId: req.user.id,
    ipAddress
  });

  if (!result.success) {
    return res.status(result.status || 400).json({ error: result.error });
  }

  return res.status(201).json(result);
});

// 21. GET /api/admin/revenue/ledger (Admin only - RBAC: revenue.manual_entry)
router.get('/revenue/ledger', authenticate, requirePermission('revenue.manual_entry'), (req, res) => {
  const { project_id, limit } = req.query;
  const result = getImmutableLedger({
    projectId: project_id || null,
    limit: limit ? Number(limit) : 100
  });

  return res.status(200).json(result);
});

// 22. GET /api/admin/withdrawals/pending (Admin only - RBAC: payout.approve)
router.get('/withdrawals/pending', authenticate, requirePermission('payout.approve'), (req, res) => {
  const pending = getPendingWithdrawals();
  return res.status(200).json({
    count: pending.length,
    withdrawals: pending
  });
});

// 23. PATCH /api/admin/withdrawals/:id/approve (Admin only - RBAC: payout.approve)
router.patch('/withdrawals/:id/approve', authenticate, requirePermission('payout.approve'), (req, res) => {
  const ipAddress = req.ip || req.socket.remoteAddress;
  const { id } = req.params;

  const result = approveWithdrawal({
    withdrawalId: id,
    adminUserId: req.user.id,
    ipAddress
  });

  if (!result.success) {
    return res.status(result.status || 400).json({ error: result.error });
  }

  return res.status(200).json(result);
});

// 24. PATCH /api/admin/withdrawals/:id/reject (Admin only - RBAC: payout.approve)
router.patch('/withdrawals/:id/reject', authenticate, requirePermission('payout.approve'), (req, res) => {
  const ipAddress = req.ip || req.socket.remoteAddress;
  const { id } = req.params;
  const { rejection_reason } = req.body || {};

  const result = rejectWithdrawal({
    withdrawalId: id,
    rejectionReason: rejection_reason,
    adminUserId: req.user.id,
    ipAddress
  });

  if (!result.success) {
    return res.status(result.status || 400).json({ error: result.error });
  }

  return res.status(200).json(result);
});

export default router;
