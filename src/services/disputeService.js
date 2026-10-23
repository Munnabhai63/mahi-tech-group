import crypto from 'node:crypto';
import { queryOne, queryAll, execute } from '../db/database.js';
import { logAccess } from './auditService.js';
import { pushToUser, pushToGlobal } from './wsService.js';

/**
 * MAHI TECH GROUP — DISPUTE RESOLUTION SERVICE (STEP 14 LAYER 4)
 * Manages dispute lifecycle, parties, agreements, waivers, and settlements.
 */

export function generateSignatureToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Returns the next sequential dispute number in format DSP-0001, DSP-0002...
 */
export function getNextDisputeNumber() {
  const row = queryOne("SELECT dispute_number FROM disputes ORDER BY created_at DESC, id DESC LIMIT 1");
  if (!row || !row.dispute_number) {
    return 'DSP-0001';
  }
  const match = row.dispute_number.match(/^DSP-(\d+)$/);
  if (!match) {
    return 'DSP-0001';
  }
  const nextNum = parseInt(match[1], 10) + 1;
  return `DSP-${String(nextNum).padStart(4, '0')}`;
}

/**
 * Forward-only lifecycle transition map
 */
const FSM_ALLOWED_TRANSITIONS = {
  open: ['under_review', 'escalated_legal', 'closed'],
  under_review: ['negotiation', 'pending_signatures', 'resolved', 'settled', 'escalated_legal', 'closed'],
  negotiation: ['pending_signatures', 'under_review', 'resolved', 'settled', 'escalated_legal', 'closed'],
  pending_signatures: ['negotiation', 'settled', 'resolved', 'escalated_legal', 'closed'],
  settled: ['resolved', 'closed', 'escalated_legal'],
  resolved: ['settled', 'closed', 'escalated_legal'],
  escalated_legal: ['under_review', 'negotiation', 'closed'],
  closed: [] // Terminal: closed disputes can never transition
};

/**
 * Create a new dispute (Admin only)
 */
export function createDispute({
  dispute_type,
  raised_by,
  against_party = null,
  against_party_ext = null,
  linked_ticket_id = null,
  linked_project_id = null,
  description,
  adminId,
  ipAddress = '127.0.0.1'
}) {
  const validTypes = [
    'financial_settlement',
    'ip_ownership',
    'contribution_disagreement',
    'offboarding_settlement',
    'formal_complaint',
    'legal_matter',
    'other'
  ];

  if (!dispute_type || !validTypes.includes(dispute_type)) {
    throw new Error(`Invalid dispute_type. Must be one of: ${validTypes.join(', ')}`);
  }
  if (!raised_by) {
    throw new Error('raised_by is required');
  }
  if (!description || !description.trim()) {
    throw new Error('description is required');
  }

  // Prevent admin self-dispute
  if (adminId && against_party && adminId === against_party) {
    throw new Error('Self-action forbidden: Admin cannot create a dispute against themselves');
  }

  const disputeId = crypto.randomUUID();
  const disputeNumber = getNextDisputeNumber();

  execute(`
    INSERT INTO disputes (
      id, dispute_number, dispute_type, raised_by, against_party, against_party_ext,
      linked_ticket_id, linked_project_id, description, status,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', datetime('now'), datetime('now'))
  `, [
    disputeId,
    disputeNumber,
    dispute_type,
    raised_by,
    against_party || null,
    against_party_ext || null,
    linked_ticket_id || null,
    linked_project_id || null,
    description.trim()
  ]);

  // Automatically add the complainant party
  const raisedByUser = queryOne('SELECT name FROM users WHERE id = ?', [raised_by]);
  const partyId = crypto.randomUUID();
  execute(`
    INSERT INTO dispute_parties (id, dispute_id, user_id, party_name, party_type, added_at)
    VALUES (?, ?, ?, ?, 'complainant', datetime('now'))
  `, [
    partyId,
    disputeId,
    raised_by,
    raisedByUser?.name || 'Complainant'
  ]);

  // If against_party is an internal user, automatically add as respondent party
  if (against_party) {
    const respondentUser = queryOne('SELECT name FROM users WHERE id = ?', [against_party]);
    const respPartyId = crypto.randomUUID();
    execute(`
      INSERT INTO dispute_parties (id, dispute_id, user_id, party_name, party_type, added_at)
      VALUES (?, ?, ?, ?, 'respondent', datetime('now'))
    `, [
      respPartyId,
      disputeId,
      against_party,
      respondentUser?.name || 'Respondent'
    ]);
  } else if (against_party_ext) {
    const respPartyId = crypto.randomUUID();
    execute(`
      INSERT INTO dispute_parties (id, dispute_id, user_id, party_name, party_type, added_at)
      VALUES (?, ?, NULL, ?, 'respondent', datetime('now'))
    `, [
      respPartyId,
      disputeId,
      against_party_ext.trim()
    ]);
  }

  // If linked to a ticket, update the ticket row
  if (linked_ticket_id) {
    execute('UPDATE support_tickets SET dispute_id = ? WHERE id = ?', [disputeId, linked_ticket_id]);
  }

  logAccess({
    userId: adminId,
    targetId: disputeId,
    action: 'superadmin_dispute_create',
    resource: `/api/superadmin/disputes/${disputeId}`,
    ipAddress
  });

  return getDisputeById(disputeId);
}

/**
 * List disputes with optional filtering
 */
export function listDisputes({ status, dispute_type, date_from, search } = {}) {
  let sql = `
    SELECT 
      d.*,
      u1.name as raised_by_name,
      u1.email as raised_by_email,
      u2.name as against_party_name,
      u2.email as against_party_email
    FROM disputes d
    LEFT JOIN users u1 ON d.raised_by = u1.id
    LEFT JOIN users u2 ON d.against_party = u2.id
    WHERE 1=1
  `;
  const params = [];

  if (status) {
    sql += ' AND d.status = ?';
    params.push(status);
  }
  if (dispute_type) {
    sql += ' AND d.dispute_type = ?';
    params.push(dispute_type);
  }
  if (date_from) {
    sql += ' AND d.created_at >= ?';
    params.push(date_from);
  }
  if (search) {
    sql += ' AND (d.dispute_number LIKE ? OR d.description LIKE ? OR u1.name LIKE ? OR u2.name LIKE ?)';
    const term = `%${search}%`;
    params.push(term, term, term, term);
  }

  sql += ' ORDER BY d.created_at DESC';
  return queryAll(sql, params);
}

/**
 * Get dispute details including parties, agreements, signatures, and waivers
 */
export function getDisputeById(disputeId) {
  const dispute = queryOne(`
    SELECT 
      d.*,
      u1.name as raised_by_name,
      u1.email as raised_by_email,
      u2.name as against_party_name,
      u2.email as against_party_email,
      u3.name as closed_by_name
    FROM disputes d
    LEFT JOIN users u1 ON d.raised_by = u1.id
    LEFT JOIN users u2 ON d.against_party = u2.id
    LEFT JOIN users u3 ON d.closed_by = u3.id
    WHERE d.id = ?
  `, [disputeId]);

  if (!dispute) return null;

  const parties = queryAll(`
    SELECT dp.*, u.email as user_email, u.role as user_role
    FROM dispute_parties dp
    LEFT JOIN users u ON dp.user_id = u.id
    WHERE dp.dispute_id = ?
    ORDER BY dp.added_at ASC
  `, [disputeId]);

  const agreements = queryAll(`
    SELECT da.*, u.name as created_by_name
    FROM dispute_agreements da
    LEFT JOIN users u ON da.created_by = u.id
    WHERE da.dispute_id = ?
    ORDER BY da.created_at DESC
  `, [disputeId]);

  // Attach signatures to agreements
  for (const ag of agreements) {
    ag.signatures = queryAll(`
      SELECT ds.*, u.name as signer_name, u.email as signer_email
      FROM dispute_signatures ds
      LEFT JOIN users u ON ds.signed_by = u.id
      WHERE ds.agreement_id = ?
      ORDER BY ds.id ASC
    `, [ag.id]);
  }

  const waivers = queryAll(`
    SELECT lw.*, u.name as created_by_name
    FROM liability_waivers lw
    LEFT JOIN users u ON lw.created_by = u.id
    WHERE lw.dispute_id = ?
    ORDER BY lw.created_at DESC
  `, [disputeId]);

  // Attach signatures to waivers
  for (const w of waivers) {
    w.signatures = queryAll(`
      SELECT ws.*, u.name as signer_name, u.email as signer_email
      FROM waiver_signatures ws
      LEFT JOIN users u ON ws.signed_by = u.id
      WHERE ws.waiver_id = ?
      ORDER BY ws.id ASC
    `, [w.id]);
  }

  return {
    ...dispute,
    parties,
    agreements,
    waivers
  };
}

/**
 * Update dispute status enforcing forward-only transitions and updated_at = datetime('now')
 */
export function updateDisputeStatus(disputeId, newStatus, { resolution_notes = null, adminId, ipAddress = '127.0.0.1' } = {}) {
  const dispute = queryOne('SELECT * FROM disputes WHERE id = ?', [disputeId]);
  if (!dispute) {
    const err = new Error('Dispute not found');
    err.status = 404;
    throw err;
  }

  const currentStatus = dispute.status;
  const allowed = FSM_ALLOWED_TRANSITIONS[currentStatus] || [];

  if (currentStatus === 'closed') {
    const err = new Error('Dispute is formally closed and cannot be reopened or transitioned.');
    err.status = 400;
    throw err;
  }

  if (newStatus !== currentStatus && !allowed.includes(newStatus)) {
    const err = new Error(`Invalid status transition from "${currentStatus}" to "${newStatus}". Allowed: ${allowed.join(', ')}`);
    err.status = 400;
    throw err;
  }

  let closedAt = dispute.closed_at;
  let closedBy = dispute.closed_by;

  if (newStatus === 'closed' && !dispute.closed_at) {
    closedAt = new Date().toISOString();
    closedBy = adminId;
  }

  execute(`
    UPDATE disputes
    SET status = ?,
        resolution_notes = COALESCE(?, resolution_notes),
        closed_at = ?,
        closed_by = ?,
        updated_at = datetime('now')
    WHERE id = ?
  `, [
    newStatus,
    resolution_notes,
    closedAt,
    closedBy,
    disputeId
  ]);

  logAccess({
    userId: adminId,
    targetId: disputeId,
    action: 'superadmin_dispute_status_update',
    resource: `/api/superadmin/disputes/${disputeId}/status (${currentStatus} -> ${newStatus})`,
    ipAddress
  });

  return getDisputeById(disputeId);
}

/**
 * Add a party to a dispute
 */
export function addDisputeParty(disputeId, { user_id = null, party_name, party_type, adminId, ipAddress = '127.0.0.1' }) {
  const dispute = queryOne('SELECT id, status FROM disputes WHERE id = ?', [disputeId]);
  if (!dispute) {
    const err = new Error('Dispute not found');
    err.status = 404;
    throw err;
  }

  if (dispute.status === 'closed') {
    const err = new Error('Cannot add party to a closed dispute');
    err.status = 400;
    throw err;
  }

  const validPartyTypes = ['complainant', 'respondent', 'witness', 'admin'];
  if (!party_type || !validPartyTypes.includes(party_type)) {
    const err = new Error(`Invalid party_type. Must be one of: ${validPartyTypes.join(', ')}`);
    err.status = 400;
    throw err;
  }

  if (!party_name && user_id) {
    const u = queryOne('SELECT name FROM users WHERE id = ?', [user_id]);
    party_name = u?.name || 'Party';
  }

  if (!party_name || !party_name.trim()) {
    const err = new Error('party_name is required');
    err.status = 400;
    throw err;
  }

  const partyId = crypto.randomUUID();
  execute(`
    INSERT INTO dispute_parties (id, dispute_id, user_id, party_name, party_type, added_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
  `, [
    partyId,
    disputeId,
    user_id || null,
    party_name.trim(),
    party_type
  ]);

  logAccess({
    userId: adminId,
    targetId: disputeId,
    action: 'superadmin_dispute_add_party',
    resource: `/api/superadmin/disputes/${disputeId}/parties`,
    ipAddress
  });

  return queryOne('SELECT * FROM dispute_parties WHERE id = ?', [partyId]);
}

/**
 * Draft an agreement and generate cryptographic signature requests
 */
export function createDisputeAgreement(disputeId, { agreement_text, adminId, ipAddress = '127.0.0.1' }) {
  const dispute = queryOne('SELECT id, dispute_number, status FROM disputes WHERE id = ?', [disputeId]);
  if (!dispute) {
    const err = new Error('Dispute not found');
    err.status = 404;
    throw err;
  }
  if (dispute.status === 'closed') {
    const err = new Error('Cannot draft agreement for a closed dispute');
    err.status = 400;
    throw err;
  }
  if (!agreement_text || !agreement_text.trim()) {
    const err = new Error('agreement_text is required');
    err.status = 400;
    throw err;
  }

  // Count existing agreements for version numbering
  const countRow = queryOne('SELECT COUNT(*) as cnt FROM dispute_agreements WHERE dispute_id = ?', [disputeId]);
  const version = (countRow?.cnt || 0) + 1;

  const agreementId = crypto.randomUUID();
  execute(`
    INSERT INTO dispute_agreements (id, dispute_id, agreement_text, created_by, created_at, version)
    VALUES (?, ?, ?, ?, datetime('now'), ?)
  `, [
    agreementId,
    disputeId,
    agreement_text.trim(),
    adminId,
    version
  ]);

  // Fetch all parties that have registered user accounts to request signatures
  const parties = queryAll(`
    SELECT * FROM dispute_parties 
    WHERE dispute_id = ? AND user_id IS NOT NULL
  `, [disputeId]);

  const createdSignatures = [];

  for (const party of parties) {
    const sigId = crypto.randomUUID();
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(); // 14 days expiration

    execute(`
      INSERT INTO dispute_signatures (
        id, agreement_id, signed_by, signed_at, signature_token, ip_address, agreed, status, expires_at
      ) VALUES (?, ?, ?, NULL, ?, NULL, NULL, 'pending', ?)
    `, [
      sigId,
      agreementId,
      party.user_id,
      token,
      expiresAt
    ]);

    createdSignatures.push({ id: sigId, signed_by: party.user_id, token });

    // Send in-app notification to member
    const notifId = crypto.randomUUID();
    execute(`
      INSERT INTO notifications (id, user_id, event_type, message, link, read_status, created_at)
      VALUES (?, ?, 'dispute_agreement', ?, ?, 0, datetime('now'))
    `, [
      notifId,
      party.user_id,
      `Dispute Agreement for ${dispute.dispute_number} is ready for your formal review and digital signature.`,
      `/sign.html?type=dispute&id=${disputeId}&token=${token}`
    ]);

    // WebSocket push to member
    pushToUser(party.user_id, 'dispute_signature_requested', {
      disputeId,
      disputeNumber: dispute.dispute_number,
      agreementId,
      token,
      expiresAt
    });
  }

  // Also push broadcast to global stream
  pushToGlobal('dispute_signature_requested', {
    disputeId,
    disputeNumber: dispute.dispute_number,
    agreementId
  });

  // Automatically transition dispute to 'pending_signatures'
  execute(`
    UPDATE disputes 
    SET status = 'pending_signatures',
        updated_at = datetime('now')
    WHERE id = ?
  `, [disputeId]);

  logAccess({
    userId: adminId,
    targetId: disputeId,
    action: 'superadmin_dispute_agreement_create',
    resource: `/api/superadmin/disputes/${disputeId}/agreement`,
    ipAddress
  });

  return {
    agreement: queryOne('SELECT * FROM dispute_agreements WHERE id = ?', [agreementId]),
    signatures_requested: createdSignatures.length,
    signatures: createdSignatures
  };
}

/**
 * Create a liability waiver and generate signature tokens
 */
export function createLiabilityWaiver(disputeId, { waiver_text, waiver_type, scope = 'global', project_id = null, user_ids = [], adminId, ipAddress = '127.0.0.1' }) {
  const dispute = disputeId ? queryOne('SELECT id, dispute_number, status FROM disputes WHERE id = ?', [disputeId]) : null;
  if (dispute && dispute.status === 'closed') {
    const err = new Error('Cannot attach waiver to a closed dispute');
    err.status = 400;
    throw err;
  }

  const validWaiverTypes = [
    'full_release',
    'partial_release',
    'nda_extension',
    'ip_assignment',
    'financial_final_settlement'
  ];
  if (!waiver_type || !validWaiverTypes.includes(waiver_type)) {
    const err = new Error(`Invalid waiver_type. Must be one of: ${validWaiverTypes.join(', ')}`);
    err.status = 400;
    throw err;
  }

  const validScopes = ['global', 'project', 'individual'];
  if (!scope || !validScopes.includes(scope)) {
    const err = new Error(`Invalid scope. Must be one of: ${validScopes.join(', ')}`);
    err.status = 400;
    throw err;
  }

  if (!waiver_text || !waiver_text.trim()) {
    const err = new Error('waiver_text is required');
    err.status = 400;
    throw err;
  }

  const waiverId = crypto.randomUUID();
  execute(`
    INSERT INTO liability_waivers (id, dispute_id, project_id, waiver_text, waiver_type, scope, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `, [
    waiverId,
    disputeId || null,
    project_id || null,
    waiver_text.trim(),
    waiver_type,
    scope,
    adminId
  ]);

  // Determine target users to sign
  let targetUserIds = [...user_ids];
  if (targetUserIds.length === 0 && disputeId) {
    const parties = queryAll('SELECT user_id FROM dispute_parties WHERE dispute_id = ? AND user_id IS NOT NULL', [disputeId]);
    targetUserIds = parties.map(p => p.user_id);
  }

  const createdSignatures = [];

  for (const uId of targetUserIds) {
    const sigId = crypto.randomUUID();
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();

    execute(`
      INSERT INTO waiver_signatures (
        id, waiver_id, signed_by, signed_at, signature_token, ip_address, agreed, status, expires_at
      ) VALUES (?, ?, ?, NULL, ?, NULL, NULL, 'pending', ?)
    `, [
      sigId,
      waiverId,
      uId,
      token,
      expiresAt
    ]);

    createdSignatures.push({ id: sigId, signed_by: uId, token });

    // Send notification to member
    const notifId = crypto.randomUUID();
    execute(`
      INSERT INTO notifications (id, user_id, event_type, message, link, read_status, created_at)
      VALUES (?, ?, 'liability_waiver', 'A Liability Waiver requires your digital signature.', ?, 0, datetime('now'))
    `, [
      notifId,
      uId,
      `/sign.html?type=waiver&id=${waiverId}&token=${token}`
    ]);

    pushToUser(uId, 'waiver_signature_requested', {
      waiverId,
      disputeId,
      token,
      expiresAt
    });
  }

  pushToGlobal('waiver_signature_requested', { waiverId, disputeId });

  logAccess({
    userId: adminId,
    targetId: disputeId || waiverId,
    action: 'superadmin_waiver_create',
    resource: `/api/superadmin/disputes/${disputeId || 'global'}/waiver`,
    ipAddress
  });

  return {
    waiver: queryOne('SELECT * FROM liability_waivers WHERE id = ?', [waiverId]),
    signatures_requested: createdSignatures.length,
    signatures: createdSignatures
  };
}

/**
 * Execute financial settlement on a dispute (Admin only)
 */
export function settleDispute(disputeId, { action, amount, currency = 'INR', notes = '', target_user_id = null, adminId, ipAddress = '127.0.0.1' }) {
  const dispute = queryOne('SELECT * FROM disputes WHERE id = ?', [disputeId]);
  if (!dispute) {
    const err = new Error('Dispute not found');
    err.status = 404;
    throw err;
  }

  const validActions = ['wallet_credit', 'wallet_debit', 'external'];
  if (!action || !validActions.includes(action)) {
    const err = new Error(`Invalid settlement action. Must be one of: ${validActions.join(', ')}`);
    err.status = 400;
    throw err;
  }

  const numAmount = parseFloat(amount);
  if (isNaN(numAmount) || numAmount < 0) {
    const err = new Error('Settlement amount must be a non-negative number');
    err.status = 400;
    throw err;
  }

  const targetId = target_user_id || dispute.against_party || dispute.raised_by;

  if (action === 'wallet_credit' && numAmount > 0) {
    if (!targetId) {
      const err = new Error('target_user_id is required for wallet_credit');
      err.status = 400;
      throw err;
    }

    // 1. Credit wallet
    execute('UPDATE users SET wallet_balance = wallet_balance + ? WHERE id = ?', [numAmount, targetId]);

    // 2. Record revenue event
    const targetProject = dispute.linked_project_id || queryOne('SELECT id FROM projects LIMIT 1')?.id;
    if (targetProject) {
      const eventId = crypto.randomUUID();
      execute(`
        INSERT INTO revenue_events (
          id, project_id, amount, source, entered_by, event_date, created_at
        ) VALUES (?, ?, ?, 'settlement', ?, date('now'), CURRENT_TIMESTAMP)
      `, [
        eventId,
        targetProject,
        numAmount,
        adminId
      ]);
    }
  } else if (action === 'wallet_debit' && numAmount > 0) {
    if (!targetId) {
      const err = new Error('target_user_id is required for wallet_debit');
      err.status = 400;
      throw err;
    }
    execute('UPDATE users SET wallet_balance = wallet_balance - ? WHERE id = ?', [numAmount, targetId]);
  }

  // Update dispute settlement amount and status to 'settled'
  execute(`
    UPDATE disputes
    SET settlement_amount = ?,
        settlement_currency = ?,
        resolution_notes = COALESCE(?, resolution_notes),
        status = 'settled',
        updated_at = datetime('now')
    WHERE id = ?
  `, [
    numAmount,
    currency,
    notes ? `[Settlement Execution: ${action.toUpperCase()}] ${notes}` : null,
    disputeId
  ]);

  logAccess({
    userId: adminId,
    targetId: disputeId,
    action: 'superadmin_dispute_settle',
    resource: `/api/superadmin/disputes/${disputeId}/settle (${action}: ${currency} ${numAmount})`,
    ipAddress
  });

  return getDisputeById(disputeId);
}

/**
 * Link a support ticket to an existing dispute
 */
export function linkTicketToDispute(ticketId, disputeId, { adminId, ipAddress = '127.0.0.1' } = {}) {
  const ticket = queryOne('SELECT id, ticket_number FROM support_tickets WHERE id = ?', [ticketId]);
  if (!ticket) {
    const err = new Error('Support ticket not found');
    err.status = 404;
    throw err;
  }
  const dispute = queryOne('SELECT id, dispute_number FROM disputes WHERE id = ?', [disputeId]);
  if (!dispute) {
    const err = new Error('Dispute not found');
    err.status = 404;
    throw err;
  }

  execute('UPDATE support_tickets SET dispute_id = ? WHERE id = ?', [disputeId, ticketId]);
  execute("UPDATE disputes SET linked_ticket_id = ?, updated_at = datetime('now') WHERE id = ?", [ticketId, disputeId]);

  logAccess({
    userId: adminId,
    targetId: ticketId,
    action: 'superadmin_ticket_link_dispute',
    resource: `/api/superadmin/tickets/${ticketId}/link-dispute (${ticket.ticket_number} -> ${dispute.dispute_number})`,
    ipAddress
  });

  return { success: true, ticket_id: ticketId, dispute_id: disputeId };
}
