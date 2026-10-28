import express from 'express';
import { authenticate } from '../middleware/auth.js';
import * as clientService from '../services/clientService.js';
import * as clientAuthService from '../services/clientAuthService.js';

const router = express.Router();

/**
 * Middleware: Enforce Admin or Superadmin role for internal admin routes
 */
function requireAdmin(req, res, next) {
  if (!req.user || (req.user.role !== 'admin' && req.user.role !== 'superadmin')) {
    return res.status(403).json({ error: 'Forbidden: Admin role required' });
  }
  next();
}

/**
 * POST /api/admin/clients/invite & POST /api/admin/clients/create
 * Creates client account, generates 32-byte invite token, sends invitation
 */
const handleClientInvite = async (req, res, next) => {
  try {
    const { name, email, company_name, phone } = req.body || {};
    const result = await clientAuthService.inviteClient(req.user, {
      name,
      email,
      company_name,
      phone
    });
    return res.status(201).json({
      message: 'Client invitation created successfully',
      ...result
    });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
};

router.post('/clients/invite', authenticate, requireAdmin, handleClientInvite);
router.post('/clients/create', authenticate, requireAdmin, handleClientInvite);

/**
 * POST /api/admin/clients/:clientId/invite/resend
 * Generates fresh 32-byte invite token expiring in 72 hours
 */
router.post('/clients/:clientId/invite/resend', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const result = await clientAuthService.resendInvite(req.user, req.params.clientId);
    return res.status(200).json(result);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
});

/**
 * GET /api/admin/clients
 * Returns all clients with status and active project access count
 */
router.get('/clients', authenticate, requireAdmin, (req, res, next) => {
  try {
    const ip = req.ip || req.socket?.remoteAddress;
    const result = clientService.listClients(req.user, ip);
    return res.status(200).json(result);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
});

/**
 * GET /api/admin/clients/:clientId
 * Returns client detail + project access list + shared items + activity log
 */
router.get('/clients/:clientId', authenticate, requireAdmin, (req, res, next) => {
  try {
    const ip = req.ip || req.socket?.remoteAddress;
    const result = clientService.getClientDetail(req.user, req.params.clientId, ip);
    return res.status(200).json(result);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
});

/**
 * PATCH /api/admin/clients/:clientId
 * Updates client profile (name, company_name, phone, status)
 */
router.patch('/clients/:clientId', authenticate, requireAdmin, (req, res, next) => {
  try {
    const ip = req.ip || req.socket?.remoteAddress;
    const updated = clientService.updateClient(req.user, req.params.clientId, req.body || {}, ip);
    return res.status(200).json({
      message: 'Client updated successfully',
      client: updated
    });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
});

/**
 * PATCH /api/admin/clients/:clientId/status (Alias)
 */
router.patch('/clients/:clientId/status', authenticate, requireAdmin, (req, res, next) => {
  try {
    const { status } = req.body || {};
    const updated = clientAuthService.updateClientStatus(req.user, req.params.clientId, status);
    return res.status(200).json({
      message: `Client status updated to ${status}`,
      client: updated
    });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
});

/**
 * POST /api/admin/clients/:clientId/access/grant
 * Grants client access to a project
 */
router.post('/clients/:clientId/access/grant', authenticate, requireAdmin, (req, res, next) => {
  try {
    const ip = req.ip || req.socket?.remoteAddress;
    const result = clientService.grantProjectAccess(req.user, req.params.clientId, req.body || {}, ip);
    return res.status(201).json(result);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
});

/**
 * PATCH /api/admin/clients/:clientId/access/revoke
 * Soft-revokes client access to a project (is_active = 0)
 */
router.patch('/clients/:clientId/access/revoke', authenticate, requireAdmin, (req, res, next) => {
  try {
    const ip = req.ip || req.socket?.remoteAddress;
    const result = clientService.revokeProjectAccess(req.user, req.params.clientId, req.body || {}, ip);
    return res.status(200).json(result);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
});

/**
 * POST /api/admin/clients/:clientId/share/item
 * Shares a specific project deliverable/item with client
 */
router.post('/clients/:clientId/share/item', authenticate, requireAdmin, (req, res, next) => {
  try {
    const ip = req.ip || req.socket?.remoteAddress;
    const result = clientService.shareItem(req.user, req.params.clientId, req.body || {}, ip);
    return res.status(201).json(result);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
});

/**
 * PATCH /api/admin/clients/:clientId/share/item/:shareId/unshare
 * Soft-unshares a project item from client (is_active = 0)
 */
router.patch('/clients/:clientId/share/item/:shareId/unshare', authenticate, requireAdmin, (req, res, next) => {
  try {
    const ip = req.ip || req.socket?.remoteAddress;
    const result = clientService.unshareItem(req.user, req.params.clientId, req.params.shareId, ip);
    return res.status(200).json(result);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
});

/**
 * GET /api/admin/clients/:clientId/activity
 * Returns full client_activity_log for this client
 */
router.get('/clients/:clientId/activity', authenticate, requireAdmin, (req, res, next) => {
  try {
    const ip = req.ip || req.socket?.remoteAddress;
    const result = clientService.getClientActivityLog(req.user, req.params.clientId, ip);
    return res.status(200).json(result);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
});

/**
 * GET /api/admin/orders
 * Returns all client orders (internal_notes visible to Admin)
 */
router.get('/orders', authenticate, requireAdmin, (req, res, next) => {
  try {
    const ip = req.ip || req.socket?.remoteAddress;
    const { client_id, project_id, status } = req.query || {};
    const result = clientService.getAdminOrders(req.user, { client_id, project_id, status }, ip);
    return res.status(200).json(result);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
});

/**
 * PATCH /api/admin/orders/:orderId/status
 * Updates client order status, internal notes, and assigned team member
 */
router.patch('/orders/:orderId/status', authenticate, requireAdmin, (req, res, next) => {
  try {
    const ip = req.ip || req.socket?.remoteAddress;
    const result = clientService.updateOrderStatus(req.user, req.params.orderId, req.body || {}, ip);
    return res.status(200).json({
      message: 'Order status updated successfully',
      order: result
    });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
});

/**
 * POST /api/admin/orders/:orderId/message
 * Adds team message to client order (Admin+ or assigned Member)
 */
router.post('/orders/:orderId/message', authenticate, (req, res, next) => {
  try {
    const ip = req.ip || req.socket?.remoteAddress;
    const { message, is_internal, attachments } = req.body || {};
    const result = clientService.addOrderMessage(req.user, req.params.orderId, {
      message,
      is_internal,
      attachments
    }, ip);
    return res.status(201).json(result);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
});

/**
 * POST /api/admin/milestone/request-approval
 * Requests client approval for a milestone
 */
router.post('/milestone/request-approval', authenticate, requireAdmin, (req, res, next) => {
  try {
    const ip = req.ip || req.socket?.remoteAddress;
    const result = clientService.requestMilestoneApproval(req.user, req.body || {}, ip);
    return res.status(201).json(result);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
});

/**
 * GET /api/admin/milestone/approvals
 * Returns all pending milestone approval requests
 */
router.get('/milestone/approvals', authenticate, requireAdmin, (req, res, next) => {
  try {
    const ip = req.ip || req.socket?.remoteAddress;
    const { status } = req.query || {};
    const result = clientService.getMilestoneApprovals(req.user, { status }, ip);
    return res.status(200).json(result);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
});

export default router;
