import express from 'express';
import bcrypt from 'bcryptjs';
import { queryOne, queryAll, execute } from '../db/database.js';
import { config } from '../config.js';
import { authenticate } from '../middleware/auth.js';
import { logAccess } from '../services/auditService.js';
import { getUserQuotaStatus } from '../services/quotaService.js';
import { provisionMemberAccess } from '../services/githubService.js';
import { MUTABLE_NOTIFICATION_TYPES } from '../services/notificationService.js';
import { getUserWallet, getUserEarnings } from '../services/revenueService.js';
import {
  createTicket,
  listTickets,
  getTicketById,
  addTicketMessage
} from '../services/ticketService.js';

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

// 8b. PATCH /api/users/me/profile (Authenticated - Edit own photo/bio/UPI/GitHub)
router.patch('/me/profile', authenticate, async (req, res) => {
  const ipAddress = req.ip || req.socket.remoteAddress;
  const { profile_photo_url, bio, upi_id, github_username } = req.body || {};

  const currentUser = queryOne('SELECT status FROM users WHERE id = ?', [req.user.id]);
  if (!currentUser) {
    return res.status(404).json({ error: 'User not found' });
  }

  // Non-negotiable rule: Former Member profile is READ-ONLY
  if (currentUser.status === 'inactive' || currentUser.status === 'suspended') {
    return res.status(403).json({ error: 'Former or inactive member profile is read-only. Editing is disabled.' });
  }

  if (upi_id !== undefined) {
    const upi = String(upi_id).trim();
    if (upi.length === 0) {
      // empty string clears the stored UPI ID
    } else if (!/^[a-zA-Z0-9.\-_]{2,64}@[a-zA-Z]{2,32}$/.test(upi)) {
      return res.status(400).json({ error: 'Invalid UPI ID format. Expected something like name@bank' });
    }
  }

  let ghChanged = false;
  let ghProvision = null;
  if (github_username !== undefined) {
    const gh = String(github_username).trim();
    if (gh.length === 0) {
      execute('UPDATE users SET github_username = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [req.user.id]);
      ghChanged = true;
    } else if (/^[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38}$/.test(gh)) {
      execute('UPDATE users SET github_username = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [gh, req.user.id]);
      ghChanged = true;
      // Self-serve provisioning: attempt best-effort org invite + role team
      try {
        ghProvision = await provisionMemberAccess({
          userId: req.user.id, githubUsername: gh, role: req.user.role,
          adminId: req.user.id, ipAddress
        });
      } catch (e) {
        ghProvision = { provisioned: false, reason: 'error', message: e.message };
      }
    } else {
      return res.status(400).json({ error: 'Invalid GitHub username format. Expected 1-39 chars: letters, digits, hyphens' });
    }
  }

  if (profile_photo_url === undefined && bio === undefined && upi_id === undefined && !ghChanged) {
    return res.status(400).json({ error: "At least one of 'profile_photo_url', 'bio', 'upi_id' or 'github_username' must be provided" });
  }

  execute(
    'UPDATE users SET profile_photo_url = COALESCE(?, profile_photo_url), bio = COALESCE(?, bio), upi_id = COALESCE(?, upi_id), updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [
      profile_photo_url !== undefined ? profile_photo_url : null,
      bio !== undefined ? bio : null,
      upi_id !== undefined ? (String(upi_id).trim() || null) : null,
      req.user.id
    ]
  );

  logAccess({
    userId: req.user.id,
    action: 'profile_updated',
    resource: `/api/users/me/profile${upi_id !== undefined ? ' (upi_id changed)' : ''}${ghChanged ? ' (github_username changed)' : ''}`,
    ipAddress
  });

  const updatedUser = queryOne(
    'SELECT id, name, email, role, sub_role, status, profile_photo_url, bio, upi_id, github_username, rating_avg, updated_at FROM users WHERE id = ?',
    [req.user.id]
  );

  return res.status(200).json({
    message: 'Profile updated successfully',
    user: updatedUser,
    ...(ghProvision ? { github: ghProvision } : {})
  });
});

// GET /api/users/me/notification-preferences (Authenticated)
router.get('/me/notification-preferences', authenticate, (req, res) => {
  const row = queryOne('SELECT notification_prefs FROM users WHERE id = ?', [req.user.id]);
  let muted_types = [];
  try {
    const parsed = JSON.parse(row?.notification_prefs || '{}');
    if (Array.isArray(parsed.muted_types)) muted_types = parsed.muted_types;
  } catch (e) {}
  return res.status(200).json({
    muted_types,
    mutable_types: MUTABLE_NOTIFICATION_TYPES,
    note: 'Critical financial and account events are always delivered.'
  });
});

// PUT /api/users/me/notification-preferences (Authenticated)
router.put('/me/notification-preferences', authenticate, (req, res) => {
  const { muted_types } = req.body || {};
  if (!Array.isArray(muted_types)) {
    return res.status(400).json({ error: 'muted_types must be an array of notification types' });
  }
  const valid = muted_types.filter((t) => MUTABLE_NOTIFICATION_TYPES.includes(t));
  const invalid = muted_types.filter((t) => !MUTABLE_NOTIFICATION_TYPES.includes(t));
  execute('UPDATE users SET notification_prefs = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [JSON.stringify({ muted_types: valid }), req.user.id]);
  return res.status(200).json({ message: 'Notification preferences saved.', muted_types: valid, ...(invalid.length ? { ignored: invalid } : {}) });
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
// Private data (email, wallet, quota) is limited to the owner or an admin.
router.get('/:id/profile-mini', authenticate, (req, res) => {
  if (req.params.id !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden: You may only view your own profile summary' });
  }
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

// ===================================================================
// STEP 09: FRONTEND USER PROFILE PAGE ENDPOINTS
// ===================================================================

// 1. GET /api/users/:id/profile (Authenticated - Full profile header + stats)
router.get('/:id/profile', authenticate, (req, res) => {
  const { id } = req.params;
  const targetId = id === 'me' ? req.user.id : id;

  // UPI ID is private: visible only on the owner's own full profile
  const isSelf = targetId === req.user.id;
  const user = queryOne(`
    SELECT id, name, email, role, sub_role, status, rating_avg,
           wallet_balance, wallet_frozen, profile_photo_url, bio,
           ${isSelf ? 'upi_id,' : ''}
           created_at, updated_at, deactivated_at
    FROM users WHERE id = ?
  `, [targetId]);

  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  const ideasSubmitted = queryOne('SELECT COUNT(*) as count FROM ideas WHERE owner_id = ?', [targetId])?.count || 0;
  const nonDraftIdeas = queryOne("SELECT COUNT(*) as count FROM ideas WHERE owner_id = ? AND status != 'DRAFT'", [targetId])?.count || 0;
  const approvedIdeas = queryOne("SELECT COUNT(*) as count FROM ideas WHERE owner_id = ? AND status = 'APPROVED'", [targetId])?.count || 0;
  const approvalRate = nonDraftIdeas > 0 ? Math.round((approvedIdeas / nonDraftIdeas) * 100) : 0;

  const projectsBuilt = queryOne(`
    SELECT COUNT(DISTINCT p.id) as count
    FROM projects p
    LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.removed_at IS NULL
    WHERE pm.user_id = ? OR p.owner_id = ?
  `, [targetId, targetId])?.count || 0;

  const revSplitTotal = queryOne('SELECT COALESCE(SUM(amount), 0) as total FROM revenue_splits WHERE user_id = ?', [targetId])?.total || 0;
  const totalRevenue = Math.max(Number(revSplitTotal), Number(user.wallet_balance || 0));

  return res.status(200).json({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      subRole: user.sub_role,
      status: user.status,
      avatar: user.name ? user.name.charAt(0).toUpperCase() : 'U',
      profilePhotoUrl: user.profile_photo_url,
      bio: user.bio || '',
      ratingAvg: Number(user.rating_avg || 5.0).toFixed(1),
      isFormerMember: user.status === 'inactive',
      isWalletFrozen: user.wallet_frozen === 1,
      createdAt: user.created_at,
      deactivatedAt: user.deactivated_at
    },
    stats: {
      ideasSubmitted: Number(ideasSubmitted),
      projectsBuilt: Number(projectsBuilt),
      approvalRate,
      totalRevenueEarned: totalRevenue.toFixed(2),
      walletBalance: Number(user.wallet_balance || 0).toFixed(2)
    }
  });
});

// 2. GET /api/users/:id/ideas (Authenticated - Ideas history tab)
router.get('/:id/ideas', authenticate, (req, res) => {
  const { id } = req.params;
  const targetId = id === 'me' ? req.user.id : id;

  const user = queryOne('SELECT id FROM users WHERE id = ?', [targetId]);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  const ideas = queryAll(`
    SELECT i.id, i.title, i.description, i.status, i.submitted_at,
           i.voting_deadline, i.green_percentage, i.created_at,
           p.id as project_id, p.title as project_title, p.current_stage as project_stage
    FROM ideas i
    LEFT JOIN projects p ON p.idea_id = i.id
    WHERE i.owner_id = ?
    ORDER BY i.created_at DESC
  `, [targetId]);

  return res.status(200).json({
    count: ideas.length,
    ideas
  });
});

// 3. GET /api/users/:id/projects (Authenticated - Projects history tab)
router.get('/:id/projects', authenticate, (req, res) => {
  const { id } = req.params;
  const targetId = id === 'me' ? req.user.id : id;

  const user = queryOne('SELECT id FROM users WHERE id = ?', [targetId]);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  const projects = queryAll(`
    SELECT DISTINCT p.id, p.title, p.current_stage, p.status, p.created_at,
           p.owner_id,
           COALESCE(pm.contribution_weight, 0) as contribution_weight,
           pm.role_in_project as member_role,
           (SELECT COUNT(*) FROM project_tasks pt WHERE pt.project_id = p.id AND pt.assigned_to = ?) as assigned_tasks,
           (SELECT COUNT(*) FROM project_tasks pt WHERE pt.project_id = p.id AND pt.assigned_to = ? AND pt.status = 'DONE') as completed_tasks
    FROM projects p
    LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = ? AND pm.removed_at IS NULL
    WHERE pm.user_id = ? OR p.owner_id = ?
    ORDER BY p.created_at DESC
  `, [targetId, targetId, targetId, targetId, targetId]);

  const formatted = projects.map(p => ({
    id: p.id,
    title: p.title,
    currentStage: p.current_stage,
    status: p.status,
    role: p.member_role || (p.owner_id === targetId ? 'idea_owner' : 'contributor'),
    contributionWeight: parseFloat(Number(p.contribution_weight).toFixed(2)),
    isIdeaOwner: p.owner_id === targetId,
    assignedTasks: p.assigned_tasks,
    completedTasks: p.completed_tasks,
    createdAt: p.created_at
  }));

  return res.status(200).json({
    count: formatted.length,
    projects: formatted
  });
});

// 4. GET /api/users/:id/ratings (Authenticated - Ratings tab)
router.get('/:id/ratings', authenticate, (req, res) => {
  const { id } = req.params;
  const targetId = id === 'me' ? req.user.id : id;

  const user = queryOne('SELECT id, name, rating_avg FROM users WHERE id = ?', [targetId]);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  const projectsCount = queryOne(`
    SELECT COUNT(DISTINCT p.id) as count
    FROM projects p
    LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.removed_at IS NULL
    WHERE pm.user_id = ? OR p.owner_id = ?
  `, [targetId, targetId])?.count || 0;

  return res.status(200).json({
    userId: user.id,
    ratingAverage: Number(user.rating_avg || 5.0).toFixed(1),
    totalRatedProjects: Number(projectsCount),
    ratingScale: '0.0 - 5.0',
    status: 'MVP rating display (detailed peer-ratings engine planned for future addendum)'
  });
});

// 5. GET /api/users/:id/earnings (Owner or Admin ONLY - Detailed revenue split ledger)
router.get('/:id/earnings', authenticate, (req, res) => {
  const { id } = req.params;
  const targetId = id === 'me' ? req.user.id : id;

  const user = queryOne('SELECT id, name, wallet_balance, wallet_frozen FROM users WHERE id = ?', [targetId]);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  // Privacy Rule: Detailed financial ledger is restricted strictly to profile owner and Admin
  if (req.user.id !== targetId && req.user.role !== 'admin') {
    return res.status(403).json({
      error: 'Forbidden: Detailed earnings ledger is private to profile owner and administrators'
    });
  }

  const splits = queryAll(`
    SELECT rs.id, rs.amount, rs.rule_applied, rs.created_at,
           p.id as project_id, p.title as project_title
    FROM revenue_splits rs
    JOIN revenue_events re ON rs.revenue_event_id = re.id
    LEFT JOIN projects p ON re.project_id = p.id
    WHERE rs.user_id = ?
    ORDER BY rs.created_at DESC
  `, [targetId]);

  const timeline = queryAll(`
    SELECT strftime('%Y-%m', created_at) as month, SUM(amount) as monthly_total
    FROM revenue_splits
    WHERE user_id = ?
    GROUP BY strftime('%Y-%m', created_at)
    ORDER BY month ASC
  `, [targetId]);

  const withdrawals = queryAll(`
    SELECT id, amount, status, requested_at, COALESCE(paid_at, approved_at) as processed_at, rejection_reason
    FROM withdrawals
    WHERE user_id = ?
    ORDER BY requested_at DESC
  `, [targetId]);

  const revSplitTotal = queryOne('SELECT COALESCE(SUM(amount), 0) as total FROM revenue_splits WHERE user_id = ?', [targetId])?.total || 0;
  const totalRevenue = Math.max(Number(revSplitTotal), Number(user.wallet_balance || 0));

  return res.status(200).json({
    userId: user.id,
    totalEarned: totalRevenue.toFixed(2),
    walletBalance: Number(user.wallet_balance || 0).toFixed(2),
    isWalletFrozen: user.wallet_frozen === 1,
    timeline,
    splits,
    withdrawals
  });
});

// 6. GET /api/users/:id/earnings-summary (Authenticated - Peer safe aggregate)
router.get('/:id/earnings-summary', authenticate, (req, res) => {
  const { id } = req.params;
  const targetId = id === 'me' ? req.user.id : id;

  const user = queryOne('SELECT id, wallet_balance FROM users WHERE id = ?', [targetId]);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  const projectsCount = queryOne(`
    SELECT COUNT(DISTINCT p.id) as count
    FROM projects p
    LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.removed_at IS NULL
    WHERE pm.user_id = ? OR p.owner_id = ?
  `, [targetId, targetId])?.count || 0;

  const revSplitTotal = queryOne('SELECT COALESCE(SUM(amount), 0) as total FROM revenue_splits WHERE user_id = ?', [targetId])?.total || 0;
  const totalRevenue = Math.max(Number(revSplitTotal), Number(user.wallet_balance || 0));

  return res.status(200).json({
    userId: user.id,
    totalRevenueEarned: totalRevenue.toFixed(2),
    projectsContributedCount: Number(projectsCount),
    privacyNotice: 'Detailed transaction breakdown is restricted to profile owner and administrators'
  });
});

// ===================================================================
// STEP 14 LAYER 3: Member Ticket Endpoints (Dual-mode, internal notes isolated)
// ===================================================================

/**
 * GET /api/users/tickets
 * Authenticated member fetches their own support tickets
 */
router.get('/tickets', authenticate, (req, res) => {
  try {
    const tickets = listTickets({ reporter_id: req.user.id });
    return res.status(200).json(tickets);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/users/tickets
 * Authenticated member submits a new support ticket
 */
router.post('/tickets', authenticate, (req, res) => {
  try {
    const { category, priority, subject, body } = req.body || {};
    const ticket = createTicket({
      reporter_id: req.user.id,
      category,
      priority,
      subject,
      body
    });
    return res.status(201).json(ticket);
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message });
  }
});

/**
 * GET /api/users/tickets/:id
 * Member views own ticket thread (STRICT: is_internal=0 only)
 */
router.get('/tickets/:id', authenticate, (req, res) => {
  try {
    const ticket = getTicketById(req.params.id, {
      isAdmin: req.user.role === 'admin',
      userId: req.user.id
    });
    if (!ticket) {
      return res.status(404).json({ error: 'Ticket not found' });
    }
    return res.status(200).json(ticket);
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message });
  }
});

/**
 * POST /api/users/tickets/:id/messages
 * Member replies to their own ticket (is_internal is forced to 0)
 */
router.post('/tickets/:id/messages', authenticate, (req, res) => {
  try {
    const { body } = req.body || {};
    // Verify ownership first
    const ticket = getTicketById(req.params.id, {
      isAdmin: req.user.role === 'admin',
      userId: req.user.id
    });
    if (!ticket) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    const msg = addTicketMessage(req.params.id, {
      sender_id: req.user.id,
      body,
      is_internal: 0,
      isAdmin: false
    });
    return res.status(201).json(msg);
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message });
  }
});

export default router;

