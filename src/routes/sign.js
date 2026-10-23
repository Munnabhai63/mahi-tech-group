import express from 'express';
import { authenticate } from '../middleware/auth.js';
import {
  getDisputeSigningDoc,
  signDispute,
  getWaiverSigningDoc,
  signWaiver
} from '../services/signService.js';

const router = express.Router();

/**
 * MANDATORY ROUTE FOUNDATION:
 * Mounted at /api/sign in src/app.js (NOT /api/superadmin/sign).
 * Requires authenticate middleware ONLY — accessible to ALL authenticated members.
 */

// 1. GET /api/sign/disputes/:id/:token — Member fetches agreement text for review
router.get('/disputes/:id/:token', authenticate, (req, res) => {
  try {
    const { id, token } = req.params;
    const doc = getDisputeSigningDoc(id, token, req.user.id);
    return res.status(200).json(doc);
  } catch (err) {
    const statusCode = err.status || 500;
    return res.status(statusCode).json({ error: err.message, data: err.data || null });
  }
});

// 2. POST /api/sign/disputes/:id — Member signs or declines dispute agreement
router.post('/disputes/:id', authenticate, (req, res) => {
  try {
    const { id } = req.params;
    const { token, agreed } = req.body || {};

    if (!token) {
      return res.status(400).json({ error: 'Signature token is required' });
    }
    if (agreed === undefined || agreed === null) {
      return res.status(400).json({ error: 'agreed boolean flag (true/false) is required' });
    }

    const ipAddress = req.ip || req.socket.remoteAddress;
    const result = signDispute(id, token, agreed, req.user.id, ipAddress);
    return res.status(200).json(result);
  } catch (err) {
    const statusCode = err.status || 500;
    return res.status(statusCode).json({ error: err.message, data: err.data || null });
  }
});

// 3. GET /api/sign/waivers/:id/:token — Member fetches waiver text for review
router.get('/waivers/:id/:token', authenticate, (req, res) => {
  try {
    const { id, token } = req.params;
    const doc = getWaiverSigningDoc(id, token, req.user.id);
    return res.status(200).json(doc);
  } catch (err) {
    const statusCode = err.status || 500;
    return res.status(statusCode).json({ error: err.message, data: err.data || null });
  }
});

// 4. POST /api/sign/waivers/:id — Member signs or declines liability waiver
router.post('/waivers/:id', authenticate, (req, res) => {
  try {
    const { id } = req.params;
    const { token, agreed } = req.body || {};

    if (!token) {
      return res.status(400).json({ error: 'Signature token is required' });
    }
    if (agreed === undefined || agreed === null) {
      return res.status(400).json({ error: 'agreed boolean flag (true/false) is required' });
    }

    const ipAddress = req.ip || req.socket.remoteAddress;
    const result = signWaiver(id, token, agreed, req.user.id, ipAddress);
    return res.status(200).json(result);
  } catch (err) {
    const statusCode = err.status || 500;
    return res.status(statusCode).json({ error: err.message, data: err.data || null });
  }
});

export default router;
