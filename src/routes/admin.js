import express from 'express';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { queryOne, queryAll, execute } from '../db/database.js';
import { config } from '../config.js';
import { authenticate } from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import { logAccess } from '../services/auditService.js';

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

export default router;
