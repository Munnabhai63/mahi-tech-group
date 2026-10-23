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
import { createNotification } from '../services/notificationService.js';

const router = express.Router();

// 4. POST /api/admin/members/add (Admin only - RBAC: member.add)
router.post('/members/add', authenticate, requirePermission('member.add'), async (req, res) => {
  const ipAddress = req.ip || req.socket.remoteAddress;
  const { name, email, role, sub_role, temporary_password } = req.body || {};

  if (!name || !email || !role) {
    return res.status(400).json({ error: 'Name, email, and role are required' });
  }

  const validRoles = ['researcher', 'developer', 'producer', 'admin', 'designer'];
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

// 7b. GET /api/admin/applications/pending (Admin only - RBAC: application.review)
router.get('/applications/pending', authenticate, requirePermission('application.review'), (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden: Only administrators can view pending applications' });
  }

  const applications = queryAll(`
    SELECT id, name, email, phone_number, desired_role, desired_sub_role,
           status, created_at, updated_at
    FROM users
    WHERE status = 'pending'
    ORDER BY created_at ASC
  `);

  return res.status(200).json({
    count: applications.length,
    applications
  });
});

// 7c. PATCH /api/admin/applications/:id/decide (Admin only - RBAC: application.review)
router.patch('/applications/:id/decide', authenticate, requirePermission('application.review'), (req, res) => {
  const ipAddress = req.ip || req.socket.remoteAddress;
  const { id } = req.params;
  const { decision, finalRole, finalSubRole } = req.body || {};

  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden: Only administrators can decide on applications' });
  }

  if (!decision || !['approve', 'reject'].includes(decision)) {
    return res.status(400).json({ error: "decision must be either 'approve' or 'reject'" });
  }

  const application = queryOne('SELECT * FROM users WHERE id = ?', [id]);
  if (!application) {
    return res.status(404).json({ error: 'Application not found' });
  }

  if (application.status !== 'pending') {
    return res.status(400).json({
      error: `Cannot decide on application with status '${application.status}'. Only 'pending' applications can be reviewed.`
    });
  }

  const validRoles = ['researcher', 'developer', 'producer', 'admin', 'designer'];

  if (decision === 'approve') {
    const assignedRole = finalRole || application.desired_role;
    if (!assignedRole || !validRoles.includes(assignedRole)) {
      return res.status(400).json({
        error: `Invalid or missing finalRole. Must be one of: ${validRoles.join(', ')}`
      });
    }

    if (assignedRole !== 'developer' && finalSubRole) {
      return res.status(400).json({
        error: "finalSubRole can only be set when finalRole is 'developer'"
      });
    }

    let assignedSubRole = null;
    if (assignedRole === 'developer') {
      assignedSubRole = finalSubRole !== undefined ? finalSubRole : application.desired_sub_role;
      if (assignedSubRole && !['frontend', 'backend'].includes(assignedSubRole)) {
        return res.status(400).json({ error: "Invalid finalSubRole. Must be 'frontend', 'backend', or null" });
      }
    }

    execute(`
      UPDATE users SET
        status = 'active',
        role = ?,
        sub_role = ?,
        approved_at = CURRENT_TIMESTAMP,
        approved_by = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [assignedRole, assignedSubRole, req.user.id, id]);

    logAccess({
      userId: req.user.id,
      action: 'application_approved',
      resource: `/api/admin/applications/${id}/decide (desired_role: ${application.desired_role}, assigned_role: ${assignedRole}, approved_by: ${req.user.id})`,
      ipAddress
    });

    // Create welcoming in-app notification row for when candidate logs in
    try {
      createNotification({
        userId: id,
        eventType: 'account.approved',
        message: `Welcome to Mahi Tech Group! Your membership application has been approved as ${assignedRole.toUpperCase()}${assignedSubRole ? ` (${assignedSubRole})` : ''}.`,
        link: '/'
      });
    } catch (notifErr) {
      console.warn('Failed to dispatch approval notification:', notifErr.message);
    }

    const updated = queryOne(`
      SELECT id, name, email, phone_number, desired_role, desired_sub_role,
             role, sub_role, status, approved_at, approved_by, created_at, updated_at
      FROM users WHERE id = ?
    `, [id]);

    return res.status(200).json({
      message: 'Application approved successfully',
      user: updated
    });
  }

  if (decision === 'reject') {
    execute(`
      UPDATE users SET
        status = 'rejected',
        rejected_at = CURRENT_TIMESTAMP,
        rejected_by = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [req.user.id, id]);

    logAccess({
      userId: req.user.id,
      action: 'application_rejected',
      resource: `/api/admin/applications/${id}/decide (desired_role: ${application.desired_role}, rejected_by: ${req.user.id})`,
      ipAddress
    });

    // Record decision notification row in database for audit trail
    try {
      createNotification({
        userId: id,
        eventType: 'account.rejected',
        message: 'Your membership application was reviewed and could not be approved at this time.',
        link: null
      });
    } catch (notifErr) {
      console.warn('Failed to dispatch rejection notification:', notifErr.message);
    }

    const updated = queryOne(`
      SELECT id, name, email, phone_number, desired_role, desired_sub_role,
             role, sub_role, status, rejected_at, rejected_by, created_at, updated_at
      FROM users WHERE id = ?
    `, [id]);

    return res.status(200).json({
      message: 'Application rejected',
      user: updated
    });
  }
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
    SELECT p.*, COALESCE(u.name, 'Unknown Owner') as owner_name, COALESCE(u.email, '') as owner_email,
           (SELECT COUNT(*) FROM project_members pm WHERE pm.project_id = p.id AND pm.removed_at IS NULL) as member_count,
           (SELECT COUNT(*) FROM project_tasks pt WHERE pt.project_id = p.id) as total_tasks,
           (SELECT COUNT(*) FROM project_tasks pt WHERE pt.project_id = p.id AND pt.status = 'DONE') as done_tasks
    FROM projects p
    LEFT JOIN users u ON p.owner_id = u.id
    ORDER BY p.created_at DESC
  `);

  return res.status(200).json({
    count: projects.length,
    projects
  });
});

// 11b. PATCH /api/admin/projects/:id/members/:memberId/weight (Admin only - RBAC: project.launch_approve)
router.patch('/projects/:id/members/:memberId/weight', authenticate, requirePermission('project.launch_approve'), (req, res) => {
  const ipAddress = req.ip || req.socket.remoteAddress;
  const { id: projectId, memberId } = req.params;
  const { contribution_weight } = req.body || {};

  const numWeight = parseFloat(contribution_weight);
  if (isNaN(numWeight) || numWeight < 0 || numWeight > 100) {
    return res.status(400).json({ error: 'contribution_weight must be a valid number between 0 and 100' });
  }

  const member = queryOne('SELECT * FROM project_members WHERE id = ? AND project_id = ? AND removed_at IS NULL', [memberId, projectId]);
  if (!member) {
    return res.status(404).json({ error: 'Active project member not found' });
  }

  // Minor follow-up from Step 06: Validate that total weights cannot exceed 100%
  const otherMembers = queryAll(
    'SELECT SUM(contribution_weight) as total FROM project_members WHERE project_id = ? AND id != ? AND removed_at IS NULL',
    [projectId, memberId]
  );
  const otherTotal = otherMembers[0]?.total ? parseFloat(otherMembers[0].total) : 0;
  const newTotal = Number((otherTotal + numWeight).toFixed(2));

  if (newTotal > 100.0) {
    return res.status(400).json({
      error: `Total contribution weights across active project members cannot exceed 100.00%. Current sum with this update would be ${newTotal.toFixed(2)}% (other active members sum to ${otherTotal.toFixed(2)}%).`
    });
  }

  execute(
    'UPDATE project_members SET contribution_weight = ? WHERE id = ?',
    [numWeight, memberId]
  );

  logAccess({
    userId: req.user.id,
    action: 'project_member_weight_updated',
    resource: `/api/admin/projects/${projectId}/members/${memberId}/weight (new_weight: ${numWeight}%)`,
    ipAddress
  });

  const updated = queryOne('SELECT * FROM project_members WHERE id = ?', [memberId]);
  return res.status(200).json({
    message: `Contribution weight updated to ${numWeight}% successfully`,
    member: updated
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

// 23. POST / PATCH /api/admin/withdrawals/:id/approve (Admin only - RBAC: payout.approve)
const handleApproveWithdrawal = (req, res) => {
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
};
router.patch('/withdrawals/:id/approve', authenticate, requirePermission('payout.approve'), handleApproveWithdrawal);
router.post('/withdrawals/:id/approve', authenticate, requirePermission('payout.approve'), handleApproveWithdrawal);

// 24. POST / PATCH /api/admin/withdrawals/:id/reject (Admin only - RBAC: payout.approve)
const handleRejectWithdrawal = (req, res) => {
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
};
router.patch('/withdrawals/:id/reject', authenticate, requirePermission('payout.approve'), handleRejectWithdrawal);
router.post('/withdrawals/:id/reject', authenticate, requirePermission('payout.approve'), handleRejectWithdrawal);

// 25. GET /api/admin/corners-overview (Admin only - Combined oversight across all 4 corners)
router.get('/corners-overview', authenticate, (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden: Only administrators can view corners overview' });
  }

  // 1. Researcher Corner data
  const pendingIdeas = queryAll(`
    SELECT i.id, i.title, i.green_percentage, i.voting_deadline, u.name as owner_name
    FROM ideas i
    JOIN users u ON i.owner_id = u.id
    WHERE i.status = 'PENDING_REVIEW'
    ORDER BY i.created_at DESC
  `);
  const activeResearchTasks = queryAll(`
    SELECT pt.id, pt.task_name, pt.status, p.title as project_title, u.name as assigned_to_name
    FROM project_tasks pt
    JOIN projects p ON pt.project_id = p.id
    LEFT JOIN users u ON pt.assigned_to = u.id
    WHERE pt.task_type = 'research' AND pt.status IN ('TODO', 'IN_PROGRESS')
    ORDER BY pt.created_at ASC
  `);

  // 2. Developer Corner data
  const devTasks = queryAll(`
    SELECT pt.id, pt.task_name, pt.task_type, pt.status, p.title as project_title,
           u.name as assigned_to_name, dep.task_name as depends_on_task_name
    FROM project_tasks pt
    JOIN projects p ON pt.project_id = p.id
    LEFT JOIN users u ON pt.assigned_to = u.id
    LEFT JOIN project_tasks dep ON pt.depends_on_task_id = dep.id
    WHERE pt.task_type IN ('backend', 'frontend') AND pt.status IN ('TODO', 'BLOCKED', 'IN_PROGRESS')
    ORDER BY pt.created_at ASC
  `);

  // 3. Producer Corner data
  const testingQueue = queryAll(`
    SELECT pt.id, pt.task_name, pt.status, p.title as project_title, u.name as assigned_to_name
    FROM project_tasks pt
    JOIN projects p ON pt.project_id = p.id
    LEFT JOIN users u ON pt.assigned_to = u.id
    WHERE pt.task_type = 'testing' AND pt.status IN ('TODO', 'BLOCKED', 'IN_PROGRESS')
    ORDER BY pt.created_at ASC
  `);

  // 3b. UI/UX Designer Corner data
  const designTasks = queryAll(`
    SELECT pt.id, pt.task_name, pt.task_type, pt.status, p.title as project_title,
           u.name as assigned_to_name, dep.task_name as depends_on_task_name
    FROM project_tasks pt
    JOIN projects p ON pt.project_id = p.id
    LEFT JOIN users u ON pt.assigned_to = u.id
    LEFT JOIN project_tasks dep ON pt.depends_on_task_id = dep.id
    WHERE pt.task_type = 'design' AND pt.status IN ('TODO', 'BLOCKED', 'IN_PROGRESS')
    ORDER BY pt.created_at ASC
  `);

  // 4. Admin Corner data
  const pendingWithdrawals = getPendingWithdrawals();
  const pendingFinalReviews = queryAll(`
    SELECT p.id, p.title, p.current_stage, p.status, u.name as owner_name
    FROM projects p
    LEFT JOIN users u ON p.owner_id = u.id
    WHERE p.current_stage = 'ADMIN_REVIEW' AND p.status = 'ACTIVE'
  `);
  const activeMembersCount = queryOne("SELECT COUNT(*) as count FROM users WHERE status = 'active'")?.count || 0;
  const liveProjectsCount = queryOne("SELECT COUNT(*) as count FROM projects WHERE current_stage = 'LIVE'")?.count || 0;
  const avgTeamRating = queryOne("SELECT AVG(rating_avg) as avg_rating FROM users WHERE status = 'active'")?.avg_rating || 5.0;

  return res.status(200).json({
    timestamp: new Date().toISOString(),
    adminUser: { id: req.user.id, name: req.user.name },
    researcherCorner: {
      pendingIdeasCount: pendingIdeas.length,
      pendingIdeas,
      activeResearchTasksCount: activeResearchTasks.length,
      activeResearchTasks
    },
    designerCorner: {
      activeDesignTasksCount: designTasks.length,
      designTasks
    },
    developerCorner: {
      activeDevTasksCount: devTasks.length,
      devTasks
    },
    producerCorner: {
      testingQueueCount: testingQueue.length,
      testingQueue
    },
    adminCorner: {
      pendingWithdrawalsCount: pendingWithdrawals.length,
      pendingWithdrawals,
      pendingFinalReviewsCount: pendingFinalReviews.length,
      pendingFinalReviews,
      teamHealth: {
        activeMembers: activeMembersCount,
        liveProjects: liveProjectsCount,
        averageRating: Number(avgTeamRating).toFixed(1)
      }
    }
  });
});

// 26. GET /api/admin/dashboard/overview (Admin only - Dashboard Overview)
router.get('/dashboard/overview', authenticate, (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden: Only administrators can access admin dashboard overview' });
  }

  // Active members count breakdown by role
  const roleRows = queryAll(`
    SELECT role, COUNT(*) as cnt
    FROM users
    WHERE status = 'active'
    GROUP BY role
  `);
  const byRole = { researcher: 0, developer: 0, designer: 0, producer: 0, admin: 0 };
  let totalActiveMembers = 0;
  for (const r of roleRows) {
    if (r.role && byRole[r.role] !== undefined) {
      byRole[r.role] = Number(r.cnt);
      totalActiveMembers += Number(r.cnt);
    }
  }

  const totalInactiveMembers = queryOne("SELECT COUNT(*) as count FROM users WHERE status = 'inactive'")?.count || 0;

  // Active projects count breakdown by stage
  const stageRows = queryAll(`
    SELECT current_stage, COUNT(*) as cnt
    FROM projects
    WHERE status = 'ACTIVE' OR current_stage = 'LIVE'
    GROUP BY current_stage
  `);
  const byStage = {
    RESEARCH_DEV_PARALLEL: 0,
    INTEGRATION: 0,
    TESTING: 0,
    ADMIN_REVIEW: 0,
    LIVE: 0
  };
  let totalProjects = 0;
  for (const s of stageRows) {
    if (s.current_stage && byStage[s.current_stage] !== undefined) {
      byStage[s.current_stage] = Number(s.cnt);
      totalProjects += Number(s.cnt);
    }
  }

  // Pending Approvals
  const pendingApplications = queryOne("SELECT COUNT(*) as count FROM users WHERE status = 'pending'")?.count || 0;
  const pendingIdeaVotes = queryOne("SELECT COUNT(*) as count FROM ideas WHERE status = 'PENDING_REVIEW'")?.count || 0;
  const pendingWithdrawalsCount = queryOne("SELECT COUNT(*) as count FROM withdrawals WHERE status = 'PENDING'")?.count || 0;
  const pendingFinalReviewsCount = queryOne("SELECT COUNT(*) as count FROM projects WHERE current_stage = 'ADMIN_REVIEW'")?.count || 0;
  const totalPending = pendingApplications + pendingIdeaVotes + pendingWithdrawalsCount + pendingFinalReviewsCount;

  // Financials
  const revEventsTotal = queryOne('SELECT COALESCE(SUM(amount), 0) as total FROM revenue_events')?.total || 0;
  const paidWithdrawalsTotal = queryOne("SELECT COALESCE(SUM(amount), 0) as total FROM withdrawals WHERE status = 'PAID'")?.total || 0;
  const pendingWithdrawalsAmount = queryOne("SELECT COALESCE(SUM(amount), 0) as total FROM withdrawals WHERE status = 'PENDING'")?.total || 0;
  const frozenWalletsCount = queryOne('SELECT COUNT(*) as count FROM users WHERE wallet_frozen = 1')?.count || 0;

  // Recent offboarding events (last 5)
  const recentOffboarding = queryAll(`
    SELECT o.id, o.user_id, o.initiated_at, o.completed_at, o.status, o.wallet_frozen_amount, o.reason,
           u.name as user_name, u.email as user_email
    FROM offboarding o
    LEFT JOIN users u ON o.user_id = u.id
    ORDER BY o.initiated_at DESC
    LIMIT 5
  `);

  return res.status(200).json({
    members: {
      totalActive: totalActiveMembers,
      totalInactive: totalInactiveMembers,
      byRole
    },
    projects: {
      totalProjects,
      byStage
    },
    pendingApprovals: {
      pendingApplications,
      pendingIdeaVotes,
      pendingWithdrawals: pendingWithdrawalsCount,
      pendingFinalReviews: pendingFinalReviewsCount,
      totalPending
    },
    financials: {
      totalRevenueGenerated: Number(revEventsTotal).toFixed(2),
      totalWithdrawalsPaid: Number(paidWithdrawalsTotal).toFixed(2),
      pendingWithdrawalsAmount: Number(pendingWithdrawalsAmount).toFixed(2),
      frozenWalletsCount
    },
    recentOffboarding
  });
});

// 27. PATCH /api/admin/members/:id (Admin only - Edit Member Role/Sub-role)
router.patch('/members/:id', authenticate, (req, res) => {
  const ipAddress = req.ip || req.socket.remoteAddress;

  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden: Only administrators can modify member roles' });
  }

  const { id } = req.params;

  // Rule 6: Self-Role-Edit Guard
  if (req.user.id === id) {
    return res.status(400).json({ error: 'Cannot modify your own administrative role' });
  }

  const targetUser = queryOne('SELECT id, name, email, role, sub_role, status FROM users WHERE id = ?', [id]);
  if (!targetUser) {
    return res.status(404).json({ error: 'Member not found' });
  }

  const { role, sub_role } = req.body || {};
  if (!role && sub_role === undefined) {
    return res.status(400).json({ error: 'At least one of role or sub_role must be provided' });
  }

  const validRoles = ['researcher', 'developer', 'designer', 'producer', 'admin'];
  const newRole = role || targetUser.role;
  if (!validRoles.includes(newRole)) {
    return res.status(400).json({ error: `Invalid role. Must be one of: ${validRoles.join(', ')}` });
  }

  let newSubRole = targetUser.sub_role;
  if (newRole !== 'developer') {
    if (sub_role) {
      return res.status(400).json({ error: "sub_role is only allowed for the 'developer' role" });
    }
    newSubRole = null;
  } else {
    if (sub_role !== undefined) newSubRole = sub_role;
    if (newSubRole && !['frontend', 'backend'].includes(newSubRole)) {
      return res.status(400).json({ error: "sub_role must be 'frontend' or 'backend'" });
    }
  }

  execute(
    'UPDATE users SET role = ?, sub_role = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [newRole, newSubRole, id]
  );

  // Explicit before/after logging in access_log
  logAccess({
    userId: req.user.id,
    action: 'member_role_changed',
    resource: `/api/admin/members/${id} (target: ${targetUser.name}, before: {role: "${targetUser.role}", sub_role: "${targetUser.sub_role || 'none'}"}, after: {role: "${newRole}", sub_role: "${newSubRole || 'none'}"}, changed_by: ${req.user.id})`,
    ipAddress
  });

  const updatedUser = queryOne('SELECT id, name, email, role, sub_role, status, updated_at FROM users WHERE id = ?', [id]);
  return res.status(200).json({
    message: 'Member role updated successfully',
    user: updatedUser
  });
});

// 28. POST /api/admin/wallets/:user_id/settle (Admin only - Manual Frozen Wallet Settlement)
router.post('/wallets/:user_id/settle', authenticate, (req, res) => {
  const ipAddress = req.ip || req.socket.remoteAddress;

  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden: Only administrators can execute manual wallet settlements' });
  }

  const { user_id } = req.params;
  const { notes, settlement_type } = req.body || {};

  const user = queryOne('SELECT id, name, email, wallet_balance, wallet_frozen, status FROM users WHERE id = ?', [user_id]);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  const frozenAmount = Number(user.wallet_balance || 0);

  // Integrity Check: revenue_splits and withdrawals are NEVER modified or deleted
  const settlementId = crypto.randomUUID();
  execute(`
    INSERT INTO wallet_settlements (id, user_id, amount, status, settled_by, settlement_type, notes, settled_at)
    VALUES (?, ?, ?, 'SETTLED', ?, ?, ?, CURRENT_TIMESTAMP)
  `, [settlementId, user_id, frozenAmount, req.user.id, settlement_type || 'MANUAL_DISBURSEMENT', notes || 'Admin manual settlement']);

  // Update pending_settlements if any
  execute(`
    UPDATE pending_settlements
    SET status = 'SETTLED', settled_by = ?, settled_at = CURRENT_TIMESTAMP
    WHERE user_id = ? AND status = 'PENDING'
  `, [req.user.id, user_id]);

  // Zero-out wallet balance and unfreeze
  execute(`
    UPDATE users
    SET wallet_balance = 0.00, wallet_frozen = 0, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [user_id]);

  logAccess({
    userId: req.user.id,
    action: 'wallet_settlement_manual',
    resource: `/api/admin/wallets/${user_id}/settle (amount: ₹${frozenAmount.toFixed(2)}, settled_by: ${req.user.id}, settlement_id: ${settlementId})`,
    ipAddress
  });

  return res.status(200).json({
    message: 'Frozen wallet balance settled successfully',
    settlement: {
      id: settlementId,
      userId: user_id,
      settledAmount: frozenAmount.toFixed(2),
      status: 'SETTLED',
      settledBy: req.user.id,
      notes: notes || 'Admin manual settlement'
    }
  });
});

// 29. GET /api/admin/access-logs (Admin only - Filterable Audit Logs)
router.get('/access-logs', authenticate, (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden: Only administrators can view audit access logs' });
  }

  const { user_id, action, startDate, endDate, limit = 50, offset = 0 } = req.query;

  let baseSql = `
    FROM access_log al
    LEFT JOIN users u ON al.user_id = u.id
    WHERE 1=1
  `;
  const params = [];

  if (user_id) {
    baseSql += ' AND al.user_id = ?';
    params.push(user_id);
  }
  if (action) {
    baseSql += ' AND al.action LIKE ?';
    params.push(`%${action}%`);
  }
  if (startDate) {
    baseSql += ' AND al.timestamp >= ?';
    params.push(startDate);
  }
  if (endDate) {
    baseSql += ' AND al.timestamp <= ?';
    params.push(endDate);
  }

  const countRow = queryOne(`SELECT COUNT(*) as count ${baseSql}`, params);
  const totalCount = countRow ? Number(countRow.count) : 0;

  const dataSql = `
    SELECT al.id, al.user_id, al.action, al.resource, al.ip_address, al.timestamp,
           u.name as user_name, u.email as user_email, u.role as user_role
    ${baseSql}
    ORDER BY al.timestamp DESC
    LIMIT ? OFFSET ?
  `;
  const dataParams = [...params, Number(limit) || 50, Number(offset) || 0];
  const logs = queryAll(dataSql, dataParams);

  return res.status(200).json({
    count: logs.length,
    totalCount,
    limit: Number(limit) || 50,
    offset: Number(offset) || 0,
    logs
  });
});

// 30. GET /api/admin/config (Admin only - System Config Viewer)
router.get('/config', authenticate, (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden: Only administrators can view system configuration' });
  }
  const configs = queryAll('SELECT key, value, updated_at FROM system_config');
  const configMap = {};
  for (const c of configs) {
    configMap[c.key] = c.value;
  }
  return res.status(200).json({ configs: configMap });
});

// 31. PATCH /api/admin/config/general (Admin only - Revenue Split Duration & General Config)
router.patch('/config/general', authenticate, (req, res) => {
  const ipAddress = req.ip || req.socket.remoteAddress;
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden: Only administrators can update system configuration' });
  }

  const { revenueSplitDurationMonths } = req.body || {};
  if (revenueSplitDurationMonths !== undefined) {
    const val = parseInt(revenueSplitDurationMonths, 10);
    if (isNaN(val) || val < 1 || val > 36) {
      return res.status(400).json({ error: 'revenueSplitDurationMonths must be an integer between 1 and 36' });
    }
    execute(
      'UPDATE system_config SET value = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE key = ?',
      [val.toString(), req.user.id, 'revenue_split_duration_months']
    );
    logAccess({
      userId: req.user.id,
      action: 'general_config_updated',
      resource: `/api/admin/config/general (revenue_split_duration_months: ${val})`,
      ipAddress
    });
  }

  const configs = queryAll('SELECT key, value, updated_at FROM system_config');
  const configMap = {};
  for (const c of configs) {
    configMap[c.key] = c.value;
  }
  return res.status(200).json({
    message: 'Configuration updated successfully',
    configs: configMap
  });
});

export default router;
