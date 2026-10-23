import express from 'express';
import { authenticate, requireRole } from '../middleware/auth.js';
import { getCommandCenterOverview } from '../services/superadminService.js';
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

export default router;
