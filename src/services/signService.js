import crypto from 'node:crypto';
import { queryOne, queryAll, execute } from '../db/database.js';
import { logAccess } from './auditService.js';
import { pushToUser, pushToGlobal } from './wsService.js';

/**
 * MAHI TECH GROUP — MEMBER SIGNING CEREMONY SERVICE (STEP 14 LAYER 4)
 * Handles secure digital execution of dispute agreements and liability waivers.
 */

export function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Fetch dispute signing document for member review
 */
export function getDisputeSigningDoc(disputeId, token, userId) {
  const sig = queryOne(`
    SELECT ds.*, da.agreement_text, da.version, da.created_at as agreement_created_at,
           d.id as dispute_id, d.dispute_number, d.dispute_type, d.description, d.status as dispute_status
    FROM dispute_signatures ds
    JOIN dispute_agreements da ON ds.agreement_id = da.id
    JOIN disputes d ON da.dispute_id = d.id
    WHERE ds.signature_token = ? AND d.id = ?
  `, [token, disputeId]);

  if (!sig) {
    const err = new Error('Invalid or non-existent signature token');
    err.status = 404;
    throw err;
  }

  // Security Check 1: Wrong user
  if (sig.signed_by !== userId) {
    const err = new Error('Forbidden: You are not authorized to view or sign this document');
    err.status = 403;
    throw err;
  }

  // Security Check 2: Already signed
  if (sig.status === 'signed' || sig.signed_at !== null) {
    const err = new Error('This document has already been signed');
    err.status = 409;
    err.data = {
      signed_at: sig.signed_at,
      status: sig.status,
      agreed: Boolean(sig.agreed)
    };
    throw err;
  }

  // Security Check 3: Expired token
  if (sig.status === 'expired' || (sig.expires_at && new Date(sig.expires_at) < new Date())) {
    const err = new Error('Signature token has expired. Please contact administrator for a new signing link.');
    err.status = 410;
    throw err;
  }

  return {
    dispute_id: sig.dispute_id,
    dispute_number: sig.dispute_number,
    dispute_type: sig.dispute_type,
    agreement_id: sig.agreement_id,
    agreement_text: sig.agreement_text,
    version: sig.version,
    status: sig.status,
    expires_at: sig.expires_at
  };
}

/**
 * Digitally execute a dispute agreement
 */
export function signDispute(disputeId, token, agreed, userId, ipAddress = '127.0.0.1') {
  const sig = queryOne(`
    SELECT ds.*, da.id as agreement_id, da.dispute_id, d.dispute_number, d.status as dispute_status
    FROM dispute_signatures ds
    JOIN dispute_agreements da ON ds.agreement_id = da.id
    JOIN disputes d ON da.dispute_id = d.id
    WHERE ds.signature_token = ? AND d.id = ?
  `, [token, disputeId]);

  if (!sig) {
    const err = new Error('Invalid or non-existent signature token');
    err.status = 404;
    throw err;
  }

  // Security Check 1: Wrong user
  if (sig.signed_by !== userId) {
    const err = new Error('Forbidden: You are not authorized to sign this document');
    err.status = 403;
    throw err;
  }

  // Security Check 2: Already signed (idempotency & append-only protection)
  if (sig.status === 'signed' || sig.signed_at !== null) {
    const err = new Error('This agreement has already been executed');
    err.status = 409;
    throw err;
  }

  // Security Check 3: Expired token
  if (sig.status === 'expired' || (sig.expires_at && new Date(sig.expires_at) < new Date())) {
    const err = new Error('Signature token has expired');
    err.status = 410;
    throw err;
  }

  const isAgreed = Boolean(agreed);
  const signatureStatus = isAgreed ? 'signed' : 'declined';

  // Perform signing update
  execute(`
    UPDATE dispute_signatures
    SET signed_at = datetime('now'),
        ip_address = ?,
        agreed = ?,
        status = ?
    WHERE id = ?
  `, [
    ipAddress,
    isAgreed ? 1 : 0,
    signatureStatus,
    sig.id
  ]);

  logAccess({
    userId,
    targetId: sig.dispute_id,
    action: isAgreed ? 'member_dispute_sign_agreed' : 'member_dispute_sign_declined',
    resource: `/api/sign/disputes/${disputeId}`,
    ipAddress
  });

  // WebSocket broadcast
  pushToGlobal('dispute_signed', {
    disputeId: sig.dispute_id,
    disputeNumber: sig.dispute_number,
    agreementId: sig.agreement_id,
    userId,
    agreed: isAgreed,
    signedAt: new Date().toISOString()
  });

  if (!isAgreed) {
    // If declined, dispute transitions back to 'negotiation'
    execute(`
      UPDATE disputes
      SET status = 'negotiation',
          updated_at = datetime('now')
      WHERE id = ?
    `, [sig.dispute_id]);

    pushToGlobal('dispute_declined', {
      disputeId: sig.dispute_id,
      disputeNumber: sig.dispute_number,
      userId
    });

    return {
      success: true,
      agreed: false,
      status: 'declined',
      dispute_status: 'negotiation',
      message: 'You have formally declined the agreement. The dispute has moved back to negotiation.'
    };
  }

  // Check if ALL required signatures on this agreement have been completed
  const pendingCount = queryOne(`
    SELECT COUNT(*) as cnt 
    FROM dispute_signatures 
    WHERE agreement_id = ? AND (status != 'signed' OR signed_at IS NULL)
  `, [sig.agreement_id]);

  let disputeStatus = 'pending_signatures';

  if (pendingCount && pendingCount.cnt === 0) {
    // Auto-transition dispute to 'settled'
    execute(`
      UPDATE disputes
      SET status = 'settled',
          updated_at = datetime('now')
      WHERE id = ?
    `, [sig.dispute_id]);

    disputeStatus = 'settled';

    pushToGlobal('dispute_settled', {
      disputeId: sig.dispute_id,
      disputeNumber: sig.dispute_number,
      message: 'All parties have signed. Dispute is now settled.'
    });
  }

  return {
    success: true,
    agreed: true,
    status: 'signed',
    dispute_status: disputeStatus,
    signed_at: new Date().toISOString(),
    message: 'Agreement digitally signed and recorded in append-only legal vault.'
  };
}

/**
 * Fetch liability waiver document for member review
 */
export function getWaiverSigningDoc(waiverId, token, userId) {
  const sig = queryOne(`
    SELECT ws.*, lw.waiver_text, lw.waiver_type, lw.scope, lw.dispute_id, lw.project_id
    FROM waiver_signatures ws
    JOIN liability_waivers lw ON ws.waiver_id = lw.id
    WHERE ws.signature_token = ? AND lw.id = ?
  `, [token, waiverId]);

  if (!sig) {
    const err = new Error('Invalid or non-existent waiver signature token');
    err.status = 404;
    throw err;
  }

  if (sig.signed_by !== userId) {
    const err = new Error('Forbidden: You are not authorized to view or sign this waiver');
    err.status = 403;
    throw err;
  }

  if (sig.status === 'signed' || sig.signed_at !== null) {
    const err = new Error('This liability waiver has already been signed');
    err.status = 409;
    err.data = { signed_at: sig.signed_at, status: sig.status };
    throw err;
  }

  if (sig.status === 'expired' || (sig.expires_at && new Date(sig.expires_at) < new Date())) {
    const err = new Error('Waiver signature token has expired');
    err.status = 410;
    throw err;
  }

  return {
    waiver_id: sig.waiver_id,
    waiver_type: sig.waiver_type,
    scope: sig.scope,
    waiver_text: sig.waiver_text,
    dispute_id: sig.dispute_id,
    status: sig.status,
    expires_at: sig.expires_at
  };
}

/**
 * Digitally execute a liability waiver
 */
export function signWaiver(waiverId, token, agreed, userId, ipAddress = '127.0.0.1') {
  const sig = queryOne(`
    SELECT ws.*, lw.waiver_type, lw.scope, lw.dispute_id
    FROM waiver_signatures ws
    JOIN liability_waivers lw ON ws.waiver_id = lw.id
    WHERE ws.signature_token = ? AND lw.id = ?
  `, [token, waiverId]);

  if (!sig) {
    const err = new Error('Invalid or non-existent waiver signature token');
    err.status = 404;
    throw err;
  }

  if (sig.signed_by !== userId) {
    const err = new Error('Forbidden: You are not authorized to sign this waiver');
    err.status = 403;
    throw err;
  }

  if (sig.status === 'signed' || sig.signed_at !== null) {
    const err = new Error('This liability waiver has already been executed');
    err.status = 409;
    throw err;
  }

  if (sig.status === 'expired' || (sig.expires_at && new Date(sig.expires_at) < new Date())) {
    const err = new Error('Waiver signature token has expired');
    err.status = 410;
    throw err;
  }

  const isAgreed = Boolean(agreed);
  const signatureStatus = isAgreed ? 'signed' : 'declined';

  execute(`
    UPDATE waiver_signatures
    SET signed_at = datetime('now'),
        ip_address = ?,
        agreed = ?,
        status = ?
    WHERE id = ?
  `, [
    ipAddress,
    isAgreed ? 1 : 0,
    signatureStatus,
    sig.id
  ]);

  logAccess({
    userId,
    targetId: waiverId,
    action: isAgreed ? 'member_waiver_sign_agreed' : 'member_waiver_sign_declined',
    resource: `/api/sign/waivers/${waiverId}`,
    ipAddress
  });

  pushToGlobal('waiver_signed', {
    waiverId,
    userId,
    agreed: isAgreed,
    signedAt: new Date().toISOString()
  });

  return {
    success: true,
    agreed: isAgreed,
    status: signatureStatus,
    signed_at: new Date().toISOString(),
    message: isAgreed ? 'Liability waiver executed successfully' : 'Liability waiver declined'
  };
}
