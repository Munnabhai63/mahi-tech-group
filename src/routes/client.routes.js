import express from 'express';
import {
  acceptInvite,
  clientLogin,
  clientLogout,
  getClientProfile
} from '../services/clientAuthService.js';
import {
  authenticateClientToken,
  clientLoginLimiter
} from '../middleware/clientAuth.js';

const router = express.Router();

/**
 * POST /api/client/auth/accept-invite
 * Public - Validates invite token, sets initial password, activates client account
 */
router.post('/auth/accept-invite', async (req, res, next) => {
  try {
    const ip = req.ip || req.socket?.remoteAddress;
    const userAgent = req.headers['user-agent'];
    const { invite_token, new_password } = req.body || {};

    const result = await acceptInvite({ invite_token, new_password }, ip, userAgent);
    return res.status(200).json(result);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
});

/**
 * POST /api/client/auth/login
 * Public (Rate Limited) - Client authentication returning client JWT
 */
router.post('/auth/login', clientLoginLimiter, async (req, res, next) => {
  try {
    const ip = req.ip || req.socket?.remoteAddress;
    const userAgent = req.headers['user-agent'];
    const { email, password } = req.body || {};

    const result = await clientLogin({ email, password }, ip, userAgent);
    return res.status(200).json(result);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
});

/**
 * POST /api/client/auth/logout
 * Client Auth Required - Logs logout event in client_activity_log
 */
router.post('/auth/logout', authenticateClientToken, (req, res, next) => {
  try {
    const ip = req.ip || req.socket?.remoteAddress;
    const userAgent = req.headers['user-agent'];

    const result = clientLogout(req.client, ip, userAgent);
    return res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/client/auth/me
 * Client Auth Required - Returns authenticated client profile (no internal data)
 */
router.get('/auth/me', authenticateClientToken, (req, res, next) => {
  try {
    const profile = getClientProfile(req.client.id);
    return res.status(200).json({ client: profile });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
});

export default router;
