import express from 'express';
import { authenticate, requireRole } from '../middleware/auth.js';
import {
  getCommandCenterOverview,
  getAllMembers,
  getMemberDetail,
  exportMembersCSV,
  getPerformanceConfig,
  updatePerformanceConfig,
  getUserPerformance,
  getAllPerformance,
  getPerformanceLeaderboard
} from '../services/superadminService.js';
import { logAccess } from '../services/auditService.js';

const router = express.Router();

// Enforce TWO mandatory security layers on every /api/superadmin/* route:
// 1. authenticate (valid JWT)
// 2. requireRole('admin') (must be exactly 'admin' -> non-admins get HTTP 403)
router.use(authenticate);
router.use(requireRole('admin'));

/**
 * Self-Protection Guard:
 * Admin cannot self-block, self-dispute, or self-demote.
 * Rejects with HTTP 400 if target user ID equals the requesting Admin's ID.
 */
export function preventSelfAction(req, res, next) {
  const targetId = req.params.userId || req.params.id || req.body?.targetUserId || req.body?.userId;
  if (targetId && req.user && req.user.id === targetId) {
    return res.status(400).json({
      error: 'Self-action forbidden: Admin cannot self-block, self-dispute, or self-demote'
    });
  }
  next();
}

/**
 * 1D. Command Center API (Overview Dashboard)
 * GET /api/superadmin/overview
 * Returns one JSON object with 9 real-time metrics.
 */
router.get('/overview', (req, res) => {
  try {
    const overview = getCommandCenterOverview();
    logAccess({
      userId: req.user.id,
      action: 'superadmin_overview_view',
      resource: '/api/superadmin/overview',
      ipAddress: req.ip || req.socket.remoteAddress
    });
    return res.status(200).json(overview);
  } catch (err) {
    console.error('Error fetching superadmin overview:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ===================================================================
// 2A. Full Member Directory API
// ===================================================================

/**
 * GET /api/superadmin/members/export
 * IMPORTANT: Registered BEFORE /members/:id to prevent 'export' matching :id param.
 * Returns CSV of all members with all directory fields.
 */
router.get('/members/export', (req, res) => {
  try {
    const csvData = exportMembersCSV();
    logAccess({
      userId: req.user.id,
      action: 'superadmin_member_export',
      resource: '/api/superadmin/members/export',
      ipAddress: req.ip || req.socket.remoteAddress
    });
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="members_export.csv"');
    return res.status(200).send(csvData);
  } catch (err) {
    console.error('Error exporting members CSV:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

/**
 * GET /api/superadmin/members
 * Returns ALL users (any status) with full directory fields.
 * Supports query params: ?status=&role=&search=&sort_by=&order=
 */
router.get('/members', (req, res) => {
  try {
    const { status, role, search, sort_by, order } = req.query;
    const members = getAllMembers({ status, role, search, sort_by, order });
    return res.status(200).json(members);
  } catch (err) {
    console.error('Error fetching members directory:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

/**
 * GET /api/superadmin/members/:id
 * Single user with all directory fields PLUS ideas, projects, earnings, attendance, access logs.
 */
router.get('/members/:id', (req, res) => {
  try {
    const member = getMemberDetail(req.params.id);
    if (!member) {
      return res.status(404).json({ error: 'Member not found' });
    }
    return res.status(200).json(member);
  } catch (err) {
    console.error('Error fetching member detail:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ===================================================================
// 2B. Performance Intelligence API (Stealth)
// ROUTE ORDER ENFORCED: /leaderboard and /config BEFORE /:userId
// ===================================================================

/**
 * 1. GET /api/superadmin/performance/leaderboard
 * All active members sorted by composite_score DESC.
 * Registered BEFORE /performance/:userId.
 */
router.get('/performance/leaderboard', (req, res) => {
  try {
    const leaderboard = getPerformanceLeaderboard();
    return res.status(200).json(leaderboard);
  } catch (err) {
    console.error('Error fetching performance leaderboard:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

/**
 * 2. GET /api/superadmin/performance/config
 * Returns current performance weight configuration from system_config.
 * Registered BEFORE /performance/:userId.
 */
router.get('/performance/config', (req, res) => {
  try {
    const cfg = getPerformanceConfig();
    return res.status(200).json(cfg);
  } catch (err) {
    console.error('Error fetching performance config:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

/**
 * 3. PATCH /api/superadmin/performance/config
 * Updates the 5 weight percentages. Validates that sum === 1.00 (±0.001).
 * Registered BEFORE /performance/:userId.
 */
router.patch('/performance/config', (req, res) => {
  try {
    const updated = updatePerformanceConfig(req.body || {});
    logAccess({
      userId: req.user.id,
      action: 'performance_config_updated',
      resource: '/api/superadmin/performance/config',
      ipAddress: req.ip || req.socket.remoteAddress
    });
    return res.status(200).json(updated);
  } catch (err) {
    if (err.status === 400) {
      return res.status(400).json({
        error: err.message,
        received_sum: err.received_sum
      });
    }
    console.error('Error updating performance config:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

/**
 * 4. GET /api/superadmin/performance/:userId
 * Single user performance detail with monthly_breakdown.
 * STEALTH: Logs action='superadmin_perf_view' with targetId in access_log.
 * Registered AFTER static routes and BEFORE general /performance.
 */
router.get('/performance/:userId', (req, res) => {
  try {
    const userId = req.params.userId;
    const perf = getUserPerformance(userId);
    if (!perf) {
      return res.status(404).json({ error: 'User not found' });
    }

    logAccess({
      userId: req.user.id,
      action: 'superadmin_perf_view',
      resource: `/api/superadmin/performance/${userId}`,
      targetId: userId,
      ipAddress: req.ip || req.socket.remoteAddress
    });

    return res.status(200).json(perf);
  } catch (err) {
    console.error('Error fetching user performance:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

/**
 * 5. GET /api/superadmin/performance
 * Performance summary for ALL active members (without monthly_breakdown).
 * Registered LAST in performance block.
 */
router.get('/performance', (req, res) => {
  try {
    const allPerf = getAllPerformance();
    return res.status(200).json(allPerf);
  } catch (err) {
    console.error('Error fetching all performance data:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

export default router;
