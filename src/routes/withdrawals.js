import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { requestWithdrawal } from '../services/payoutService.js';

const router = express.Router();

/**
 * POST /api/withdrawals/request (Authenticated)
 * User requests a withdrawal of funds. Status starts as PENDING.
 * Funds do NOT move until manual Admin approval.
 */
router.post('/request', authenticate, (req, res) => {
  const ipAddress = req.ip || req.socket.remoteAddress;
  const { amount } = req.body || {};

  const result = requestWithdrawal({
    userId: req.user.id,
    amount,
    ipAddress
  });

  if (!result.success) {
    return res.status(result.status || 400).json({ error: result.error });
  }

  return res.status(201).json(result);
});

export default router;
