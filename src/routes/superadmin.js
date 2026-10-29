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
  getPerformanceLeaderboard,
  listAllIdeasCommand,
  getIdeaDetailCommand,
  killIdea,
  restoreIdea,
  getQuotaConfig,
  updateQuotaConfig,
  getSystemIntegrity
} from '../services/superadminService.js';
import {
  createTicket,
  listTickets,
  getTicketById,
  updateTicket,
  addTicketMessage
} from '../services/ticketService.js';
import {
  createDispute,
  listDisputes,
  getDisputeById,
  updateDisputeStatus,
  addDisputeParty,
  createDisputeAgreement,
  createLiabilityWaiver,
  settleDispute,
  linkTicketToDispute
} from '../services/disputeService.js';
import {
  getGatewayConfig,
  updateGatewayConfig,
  testGatewayConnection
} from '../services/gatewayService.js';
import {
  addGovernanceEntry,
  getGovernanceHistory,
  blockMember,
  unblockMember
} from '../services/governanceService.js';
import { logAccess } from '../services/auditService.js';
import { queryAll, queryOne } from '../db/database.js';

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

/**
 * Super Admin System Integrity Check
 * GET /api/superadmin/system/integrity
 * Returns trigger status, schema tables, config keys, and metrics.
 * Logs action='superadmin_integrity_check' in access_log.
 */
router.get('/system/integrity', (req, res) => {
  try {
    const ipAddress = req.ip || req.socket.remoteAddress;
    const integrity = getSystemIntegrity(req.user.id, ipAddress);
    return res.status(200).json(integrity);
  } catch (err) {
    console.error('Error fetching system integrity:', err);
    return res.status(500).json({ error: err.message });
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
    const { userId } = req.query;
    const csvData = exportMembersCSV({ userId, adminId: req.user.id });
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

// ===================================================================
// LAYER 3: Module A — Support Ticket System (Admin Endpoints)
// STRICT ROUTE ORDER: collection & sub-actions BEFORE parameterized :id
// ===================================================================

/**
 * 1. POST /api/superadmin/tickets
 * Admin creates ticket (on behalf of member or self)
 */
router.post('/tickets', (req, res) => {
  try {
    const { reporter_id, category, priority, subject, body, assigned_to } = req.body || {};
    const ticket = createTicket({
      reporter_id: reporter_id || req.user.id,
      category,
      priority,
      subject,
      body,
      assigned_to
    });
    return res.status(201).json(ticket);
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message });
  }
});

/**
 * 2. GET /api/superadmin/tickets
 * List all tickets with optional filters
 */
router.get('/tickets', (req, res) => {
  try {
    const { status, priority, category, search } = req.query;
    const tickets = listTickets({ status, priority, category, search });
    return res.status(200).json(tickets);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * 3. POST /api/superadmin/tickets/:id/messages
 * Add message or internal note to ticket thread
 * Must be registered BEFORE GET /tickets/:id
 */
router.post('/tickets/:id/messages', (req, res) => {
  try {
    const ticketId = req.params.id;
    const { body, is_internal } = req.body || {};
    const msg = addTicketMessage(ticketId, {
      sender_id: req.user.id,
      body,
      is_internal,
      isAdmin: true
    });

    if (is_internal) {
      logAccess({
        userId: req.user.id,
        action: 'superadmin_ticket_internal_note',
        resource: `/api/superadmin/tickets/${ticketId}/messages`,
        targetId: ticketId,
        ipAddress: req.ip || req.socket.remoteAddress
      });
    }

    return res.status(201).json(msg);
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message });
  }
});

/**
 * 4. PATCH /api/superadmin/tickets/:id
 * Update status, priority, assigned_to, category (enforces forward-only FSM)
 */
router.patch('/tickets/:id', (req, res) => {
  try {
    const ticketId = req.params.id;
    const updated = updateTicket(ticketId, req.body || {});

    logAccess({
      userId: req.user.id,
      action: 'superadmin_ticket_update',
      resource: `/api/superadmin/tickets/${ticketId}`,
      targetId: ticketId,
      ipAddress: req.ip || req.socket.remoteAddress
    });

    return res.status(200).json(updated);
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message });
  }
});

/**
 * 5. GET /api/superadmin/tickets/:id
 * Single ticket with full message thread (including is_internal=1 notes for Admin)
 */
router.get('/tickets/:id', (req, res) => {
  try {
    const ticket = getTicketById(req.params.id, { isAdmin: true });
    if (!ticket) {
      return res.status(404).json({ error: 'Ticket not found' });
    }
    return res.status(200).json(ticket);
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message });
  }
});

// ===================================================================
// LAYER 3: Module B — Ideation Engine Command Center
// STRICT ROUTE ORDER: list / sub-actions BEFORE parameterized :id
// ===================================================================

/**
 * 1. GET /api/superadmin/ideas
 * List all ideas with vote counts, fan-out summary, revenue clock
 */
router.get('/ideas', (req, res) => {
  try {
    const ideas = listAllIdeasCommand();
    return res.status(200).json(ideas);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * 2. POST /api/superadmin/ideas/:id/kill
 * Kill Switch: cancels pending tasks, broadcasts WebSocket, logs audit
 * Registered BEFORE GET /ideas/:id
 */
router.post('/ideas/:id/kill', (req, res) => {
  try {
    const ideaId = req.params.id;
    const { reason } = req.body || {};
    const result = killIdea(ideaId, reason, req.user.id);
    return res.status(200).json(result);
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message });
  }
});

/**
 * 3. POST /api/superadmin/ideas/:id/restore
 * Restores killed idea to pre-kill state
 * Registered BEFORE GET /ideas/:id
 */
router.post('/ideas/:id/restore', (req, res) => {
  try {
    const ideaId = req.params.id;
    const reason = (req.body?.reason || req.body?.notes || '').trim();
    const result = restoreIdea(ideaId, reason, req.user.id);
    return res.status(200).json(result);
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message });
  }
});

/**
 * 4. GET /api/superadmin/ideas/:id
 * Full idea detail with votes, all tasks, and revenue accrued
 */
router.get('/ideas/:id', (req, res) => {
  try {
    const idea = getIdeaDetailCommand(req.params.id);
    if (!idea) {
      return res.status(404).json({ error: 'Idea not found' });
    }
    return res.status(200).json(idea);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * 5. GET /api/superadmin/quota/config
 * Read current idea quota config
 */
router.get('/quota/config', (req, res) => {
  try {
    const cfg = getQuotaConfig();
    return res.status(200).json(cfg);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * 6. PATCH /api/superadmin/quota/config
 * Override idea quota config with strict boundary validation
 */
router.patch('/quota/config', (req, res) => {
  try {
    const updated = updateQuotaConfig(req.body || {}, req.user.id);
    return res.status(200).json(updated);
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message });
  }
});

// ===================================================================
// STEP 14 LAYER 4: Dispute Resolution & Legal Vault Endpoints
// ===================================================================

/**
 * POST /api/superadmin/disputes — Create new dispute
 */
router.post('/disputes', (req, res) => {
  try {
    const ipAddress = req.ip || req.socket.remoteAddress;
    const dispute = createDispute({
      ...req.body,
      adminId: req.user.id,
      ipAddress
    });
    return res.status(201).json(dispute);
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }
});

/**
 * GET /api/superadmin/disputes — List disputes with filters
 */
router.get('/disputes', (req, res) => {
  try {
    const { status, dispute_type, date_from, search } = req.query;
    const disputes = listDisputes({ status, dispute_type, date_from, search });
    return res.status(200).json(disputes);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/superadmin/disputes/:id — Full dispute detail + parties + agreements + waivers
 */
router.get('/disputes/:id', (req, res) => {
  try {
    const dispute = getDisputeById(req.params.id);
    if (!dispute) {
      return res.status(404).json({ error: 'Dispute not found' });
    }
    return res.status(200).json(dispute);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * PATCH /api/superadmin/disputes/:id/status — Forward-only FSM status mutation
 */
router.patch('/disputes/:id/status', (req, res) => {
  try {
    const { status, resolution_notes } = req.body || {};
    if (!status) {
      return res.status(400).json({ error: 'status is required' });
    }
    const ipAddress = req.ip || req.socket.remoteAddress;
    const updated = updateDisputeStatus(req.params.id, status, {
      resolution_notes,
      adminId: req.user.id,
      ipAddress
    });
    return res.status(200).json(updated);
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }
});

/**
 * POST /api/superadmin/disputes/:id/parties — Add party to dispute
 */
router.post('/disputes/:id/parties', (req, res) => {
  try {
    const ipAddress = req.ip || req.socket.remoteAddress;
    const party = addDisputeParty(req.params.id, {
      ...req.body,
      adminId: req.user.id,
      ipAddress
    });
    return res.status(201).json(party);
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }
});

/**
 * POST /api/superadmin/disputes/:id/agreement — Draft agreement & dispatch signatures
 */
router.post('/disputes/:id/agreement', (req, res) => {
  try {
    const { agreement_text } = req.body || {};
    const ipAddress = req.ip || req.socket.remoteAddress;
    const agreement = createDisputeAgreement(req.params.id, {
      agreement_text,
      adminId: req.user.id,
      ipAddress
    });
    return res.status(201).json(agreement);
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }
});

/**
 * POST /api/superadmin/disputes/:id/waiver — Create liability waiver & dispatch signatures
 */
router.post('/disputes/:id/waiver', (req, res) => {
  try {
    const ipAddress = req.ip || req.socket.remoteAddress;
    const waiver = createLiabilityWaiver(req.params.id, {
      ...req.body,
      adminId: req.user.id,
      ipAddress
    });
    return res.status(201).json(waiver);
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }
});

/**
 * GET /api/superadmin/disputes/:id/signatures — Check signature statuses
 */
router.get('/disputes/:id/signatures', (req, res) => {
  try {
    const dispute = getDisputeById(req.params.id);
    if (!dispute) {
      return res.status(404).json({ error: 'Dispute not found' });
    }
    const agreementSignatures = dispute.agreements.flatMap(a => a.signatures || []);
    const waiverSignatures = dispute.waivers.flatMap(w => w.signatures || []);
    return res.status(200).json({
      dispute_id: dispute.id,
      dispute_number: dispute.dispute_number,
      agreement_signatures: agreementSignatures,
      waiver_signatures: waiverSignatures
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/superadmin/disputes/:id/settle — Financial settlement execution
 */
router.post('/disputes/:id/settle', (req, res) => {
  try {
    const ipAddress = req.ip || req.socket.remoteAddress;
    const settled = settleDispute(req.params.id, {
      ...req.body,
      adminId: req.user.id,
      ipAddress
    });
    return res.status(200).json(settled);
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }
});

/**
 * PATCH /api/superadmin/tickets/:id/link-dispute — Link ticket to dispute
 */
router.patch('/tickets/:id/link-dispute', (req, res) => {
  try {
    const { dispute_id } = req.body || {};
    if (!dispute_id) {
      return res.status(400).json({ error: 'dispute_id is required' });
    }
    const ipAddress = req.ip || req.socket.remoteAddress;
    const result = linkTicketToDispute(req.params.id, dispute_id, {
      adminId: req.user.id,
      ipAddress
    });
    return res.status(200).json(result);
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }
});

// ===================================================================
// STEP 14 LAYER 5: Payment Gateway Config Endpoints (Static Routes First)
// ===================================================================

/**
 * GET /api/superadmin/gateway/config — Read masked gateway configuration
 */
router.get('/gateway/config', (req, res) => {
  try {
    const config = getGatewayConfig();
    return res.status(200).json(config);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * PATCH /api/superadmin/gateway/config — Update gateway configuration
 */
router.patch('/gateway/config', (req, res) => {
  try {
    const ipAddress = req.ip || req.socket.remoteAddress;
    const updated = updateGatewayConfig(req.body || {}, req.user.id, ipAddress);
    return res.status(200).json(updated);
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }
});

/**
 * POST /api/superadmin/gateway/test — Simulated gateway ping diagnostic
 */
router.post('/gateway/test', (req, res) => {
  try {
    const ipAddress = req.ip || req.socket.remoteAddress;
    const result = testGatewayConnection(req.user.id, ipAddress);
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ===================================================================
// STEP 14 LAYER 5: User Data Governance Endpoints (Parameterized Routes)
// ===================================================================

/**
 * POST /api/superadmin/governance/:userId/block — Suspend member access (with preventSelfAction guard)
 */
router.post('/governance/:userId/block', preventSelfAction, (req, res) => {
  try {
    const ipAddress = req.ip || req.socket.remoteAddress;
    const result = blockMember(req.params.userId, req.body || {}, req.user.id, ipAddress);
    return res.status(200).json(result);
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }
});

/**
 * POST /api/superadmin/governance/:userId/unblock — Restore member access
 */
router.post('/governance/:userId/unblock', (req, res) => {
  try {
    const ipAddress = req.ip || req.socket.remoteAddress;
    const result = unblockMember(req.params.userId, req.body || {}, req.user.id, ipAddress);
    return res.status(200).json(result);
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }
});

/**
 * POST /api/superadmin/governance/:userId — Append-only GDPR governance entry
 */
router.post('/governance/:userId', (req, res) => {
  try {
    const { action, notes } = req.body || {};
    const ipAddress = req.ip || req.socket.remoteAddress;
    const entry = addGovernanceEntry({
      userId: req.params.userId,
      action,
      notes,
      adminId: req.user.id,
      ipAddress
    });
    return res.status(201).json(entry);
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }
});

/**
 * GET /api/superadmin/governance/:userId — Fetch full chronological governance log
 */
router.get('/governance/:userId', (req, res) => {
  try {
    const ipAddress = req.ip || req.socket.remoteAddress;
    const history = getGovernanceHistory(req.params.userId, req.user.id, ipAddress);
    return res.status(200).json(history);
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }
});

/**
 * GET /api/superadmin/audit — Unified forensic audit stream
 */
router.get('/audit', (req, res) => {
  try {
    const { action, userId, limit = 100, offset = 0 } = req.query;
    let sql = `
      SELECT al.id, al.user_id, al.action, al.resource, al.ip_address, al.timestamp,
             u.name as user_name, u.email as user_email, u.role as user_role
      FROM access_log al
      LEFT JOIN users u ON al.user_id = u.id
      WHERE 1=1
    `;
    const params = [];
    if (action) {
      sql += ' AND al.action LIKE ?';
      params.push(`%${action}%`);
    }
    if (userId) {
      sql += ' AND al.user_id = ?';
      params.push(userId);
    }
    sql += ' ORDER BY al.timestamp DESC LIMIT ? OFFSET ?';
    params.push(Number(limit) || 100, Number(offset) || 0);

    const logs = queryAll(sql, params);
    return res.status(200).json({ logs, count: logs.length });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
