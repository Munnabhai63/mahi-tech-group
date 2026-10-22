import express from 'express';
import bcrypt from 'bcryptjs';
import { queryOne, queryAll, execute } from '../db/database.js';
import { config } from '../config.js';
import { authenticate } from '../middleware/auth.js';
import { logAccess } from '../services/auditService.js';

const router = express.Router();

// 6. GET /api/users/me (Authenticated)
router.get('/me', authenticate, (req, res) => {
  const user = queryOne(`
    SELECT id, name, email, role, sub_role, status, rating_avg,
           idea_quota_used, quota_reset_date, wallet_balance, profile_photo_url,
           created_at, updated_at, deactivated_at
    FROM users
    WHERE id = ?
  `, [req.user.id]);

  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  // Fetch permitted capabilities for this role
  const permissions = queryAll(
    'SELECT permission_key FROM roles_permissions WHERE role = ? AND allowed = 1',
    [user.role]
  ).map(row => row.permission_key);

  return res.status(200).json({
    user,
    permissions
  });
});

// 8. PATCH /api/users/me/password (Authenticated)
router.patch('/me/password', authenticate, async (req, res) => {
  const ipAddress = req.ip || req.socket.remoteAddress;
  const { current_password, new_password } = req.body || {};

  if (!current_password || !new_password) {
    return res.status(400).json({ error: 'current_password and new_password are required' });
  }

  if (new_password.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters long' });
  }

  const user = queryOne('SELECT password_hash FROM users WHERE id = ?', [req.user.id]);
  const isMatch = await bcrypt.compare(current_password, user.password_hash);

  if (!isMatch) {
    logAccess({
      userId: req.user.id,
      action: 'password_change_failed_invalid_current_password',
      resource: '/api/users/me/password',
      ipAddress
    });
    return res.status(400).json({ error: 'Current password is incorrect' });
  }

  const newHash = await bcrypt.hash(new_password, config.BCRYPT_SALT_ROUNDS);

  execute(
    'UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [newHash, req.user.id]
  );

  logAccess({
    userId: req.user.id,
    action: 'password_changed_success',
    resource: '/api/users/me/password',
    ipAddress
  });

  return res.status(200).json({ message: 'Password updated successfully' });
});

export default router;
