import express from 'express';
import bcrypt from 'bcryptjs';
import { queryOne, queryAll, execute } from '../db/database.js';
import { config } from '../config.js';
import { authenticate } from '../middleware/auth.js';
import { logAccess } from '../services/auditService.js';
import { getUserQuotaStatus } from '../services/quotaService.js';
import { getUserWallet, getUserEarnings } from '../services/revenueService.js';

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

// GET /api/users/me/quota-status (Authenticated - Fetch remaining quota and reset date)
router.get('/me/quota-status', authenticate, (req, res) => {
  try {
    const quotaStatus = getUserQuotaStatus(req.user.id);
    return res.status(200).json({ quota: quotaStatus });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to retrieve quota status', message: err.message });
  }
});

// GET /api/users/me/wallet (Authenticated - Wallet balance + split history)
router.get('/me/wallet', authenticate, (req, res) => {
  const result = getUserWallet(req.user.id);
  if (!result.success) {
    return res.status(result.status || 404).json({ error: result.error });
  }
  return res.status(200).json(result.wallet);
});

// GET /api/users/me/earnings (Authenticated - Full earnings breakdown per project)
router.get('/me/earnings', authenticate, (req, res) => {
  const result = getUserEarnings(req.user.id);
  if (!result.success) {
    return res.status(result.status || 404).json({ error: result.error });
  }
  return res.status(200).json(result);
});

// GET /api/users/profile-mini (Current user profile summary mini-card data)
router.get('/profile-mini', authenticate, (req, res) => {
  return handleProfileMini(req.user.id, res);
});

// GET /api/users/:id/profile-mini (Profile summary mini-card data by ID)
router.get('/:id/profile-mini', authenticate, (req, res) => {
  return handleProfileMini(req.params.id, res);
});

function handleProfileMini(userId, res) {
  const user = queryOne(`
    SELECT id, name, email, role, sub_role, status, rating_avg,
           wallet_balance, wallet_frozen, profile_photo_url
    FROM users WHERE id = ?
  `, [userId]);

  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  const ideasCount = queryOne('SELECT COUNT(*) as count FROM ideas WHERE owner_id = ?', [userId])?.count || 0;
  const projectsCount = queryOne('SELECT COUNT(DISTINCT project_id) as count FROM project_members WHERE user_id = ? AND removed_at IS NULL', [userId])?.count || 0;
  const tasksCompleted = queryOne("SELECT COUNT(*) as count FROM project_tasks WHERE assigned_to = ? AND status = 'DONE'", [userId])?.count || 0;
  const revSplitTotal = queryOne('SELECT COALESCE(SUM(amount), 0) as total FROM revenue_splits WHERE user_id = ?', [userId])?.total || 0;
  const totalRevenue = Math.max(Number(revSplitTotal), Number(user.wallet_balance || 0));

  let quotaRemaining = 0;
  let quotaWeeklyLimit = 3;
  try {
    const q = getUserQuotaStatus(userId);
    quotaRemaining = q.remaining;
    quotaWeeklyLimit = q.weeklyLimit;
  } catch (e) {}

  return res.status(200).json({
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    subRole: user.sub_role,
    avatar: user.name.charAt(0).toUpperCase(),
    profilePhotoUrl: user.profile_photo_url,
    ratingAverage: Number(user.rating_avg || 5.0).toFixed(1),
    totalIdeasSubmitted: Number(ideasCount),
    totalProjectsBuilt: Number(projectsCount),
    totalTasksCompleted: Number(tasksCompleted),
    walletBalance: Number(user.wallet_balance || 0).toFixed(2),
    totalRevenueEarned: totalRevenue.toFixed(2),
    isWalletFrozen: user.wallet_frozen === 1,
    quotaRemaining,
    quotaWeeklyLimit
  });
}

export default router;
