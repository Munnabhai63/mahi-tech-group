import express from 'express';
import {
  acceptInvite,
  validateInviteToken,
  clientLogin,
  clientLogout,
  getClientProfile
} from '../services/clientAuthService.js';
import {
  authenticateClientToken,
  clientAuthMiddleware,
  clientLoginLimiter
} from '../middleware/clientAuth.js';
import {
  getClientProjects,
  getClientProjectOverview,
  getClientProjectTimeline,
  getClientProjectMilestones,
  submitClientOrder,
  getClientOrders,
  getClientOrderDetail,
  addClientOrderMessage,
  decideMilestoneApproval,
  submitClientFeedback
} from '../services/clientFacingService.js';

const router = express.Router();

// Helper to extract IP and user agent
function getClientMeta(req) {
  const ip = req.ip || req.socket?.remoteAddress || '127.0.0.1';
  const userAgent = req.headers['user-agent'] || null;
  return { ip, userAgent };
}

/* ==========================================================================
   Client Authentication Routes (/api/client/auth/*)
   ========================================================================== */

/**
 * GET /api/client/auth/validate-invite
 * Public - Validates invite token without activating (checks expiry and existence)
 */
router.get('/auth/validate-invite', async (req, res, next) => {
  try {
    const token = req.query.token;
    const result = await validateInviteToken(token);
    return res.status(200).json(result);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ valid: false, error: err.message });
    }
    next(err);
  }
});

/**
 * POST /api/client/auth/accept-invite
 * Public - Validates invite token, sets initial password, activates client account
 */
router.post('/auth/accept-invite', async (req, res, next) => {
  try {
    const { ip, userAgent } = getClientMeta(req);
    const invite_token = req.body?.invite_token || req.body?.token;
    const new_password = req.body?.new_password || req.body?.password;

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
    const { ip, userAgent } = getClientMeta(req);
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
router.post('/auth/logout', clientAuthMiddleware, (req, res, next) => {
  try {
    const { ip, userAgent } = getClientMeta(req);
    const result = clientLogout(req.client, ip, userAgent);
    return res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/client/auth/me & GET /api/client/me
 * Client Auth Required - Returns authenticated client profile (no internal data)
 */
const handleClientMe = (req, res, next) => {
  try {
    const profile = getClientProfile(req.client.id);
    return res.status(200).json({ client: profile });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
};

router.get('/auth/me', clientAuthMiddleware, handleClientMe);
router.get('/me', clientAuthMiddleware, handleClientMe);

/* ==========================================================================
   Client-Facing Routes (/api/client/*)
   All endpoints require clientAuthMiddleware (CLIENT JWT only)
   Static and named sub-paths defined before parameterized routes
   ========================================================================== */

/**
 * 1. GET /api/client/projects
 * Returns all projects client has active access to (no internal data)
 */
router.get('/projects', clientAuthMiddleware, (req, res, next) => {
  try {
    const { ip, userAgent } = getClientMeta(req);
    const result = getClientProjects(req.client, ip, userAgent);
    return res.status(200).json(result);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
});

/**
 * 2. POST /api/client/orders/submit
 * Submits a new client request / order
 * (Static route mounted before /orders/:orderId)
 */
router.post('/orders/submit', clientAuthMiddleware, (req, res, next) => {
  try {
    const { ip, userAgent } = getClientMeta(req);
    const result = submitClientOrder(req.client, req.body, ip, userAgent);
    return res.status(201).json(result);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
});

/**
 * 3. GET /api/client/orders
 * Returns client's own orders (internal_notes stripped at service layer)
 * (Static route mounted before /orders/:orderId)
 */
router.get('/orders', clientAuthMiddleware, (req, res, next) => {
  try {
    const { ip, userAgent } = getClientMeta(req);
    const result = getClientOrders(req.client, ip, userAgent);
    return res.status(200).json(result);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
});

/**
 * 4. GET /api/client/orders/:orderId
 * Returns order detail + messages (WHERE is_internal=0 strictly enforced)
 */
router.get('/orders/:orderId', clientAuthMiddleware, (req, res, next) => {
  try {
    const { ip, userAgent } = getClientMeta(req);
    const result = getClientOrderDetail(req.client, req.params.orderId, ip, userAgent);
    return res.status(200).json(result);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
});

/**
 * 5. POST /api/client/orders/:orderId/message
 * Client appends message to order (sender_type=CLIENT, is_internal=0)
 */
router.post('/orders/:orderId/message', clientAuthMiddleware, (req, res, next) => {
  try {
    const { ip, userAgent } = getClientMeta(req);
    const result = addClientOrderMessage(req.client, req.params.orderId, req.body, ip, userAgent);
    return res.status(201).json(result);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
});

/**
 * 6. GET /api/client/project/:projectId/overview
 * Returns project overview with shared milestones, gantt items, and backlog items
 */
router.get('/project/:projectId/overview', clientAuthMiddleware, (req, res, next) => {
  try {
    const { ip, userAgent } = getClientMeta(req);
    const result = getClientProjectOverview(req.client, req.params.projectId, ip, userAgent);
    return res.status(200).json(result);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
});

/**
 * 7. GET /api/client/project/:projectId/timeline
 * Returns shared gantt items only (no internal items)
 */
router.get('/project/:projectId/timeline', clientAuthMiddleware, (req, res, next) => {
  try {
    const { ip, userAgent } = getClientMeta(req);
    const result = getClientProjectTimeline(req.client, req.params.projectId, ip, userAgent);
    return res.status(200).json(result);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
});

/**
 * 8. GET /api/client/project/:projectId/milestones
 * Returns shared milestones + approval status
 */
router.get('/project/:projectId/milestones', clientAuthMiddleware, (req, res, next) => {
  try {
    const { ip, userAgent } = getClientMeta(req);
    const result = getClientProjectMilestones(req.client, req.params.projectId, ip, userAgent);
    return res.status(200).json(result);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
});

/**
 * 9. PATCH /api/client/milestone/approval/:approvalId
 * Client approves or rejects a milestone approval request
 */
router.patch('/milestone/approval/:approvalId', clientAuthMiddleware, (req, res, next) => {
  try {
    const { ip, userAgent } = getClientMeta(req);
    const result = decideMilestoneApproval(req.client, req.params.approvalId, req.body, ip, userAgent);
    return res.status(200).json(result);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
});

/**
 * 10. POST /api/client/feedback/submit
 * Client submits deliverable feedback (pre-insert verified via client_shared_items)
 */
router.post('/feedback/submit', clientAuthMiddleware, (req, res, next) => {
  try {
    const { ip, userAgent } = getClientMeta(req);
    const result = submitClientFeedback(req.client, req.body, ip, userAgent);
    return res.status(201).json(result);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
});

export default router;
