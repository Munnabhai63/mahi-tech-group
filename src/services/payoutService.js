import crypto from 'node:crypto';
import { queryOne, queryAll, execute } from '../db/database.js';
import { logAccess } from './auditService.js';

/**
 * OUTGOING PAYMENTS — HONEST MANUAL UPI FLOW
 *
 * YouPI-PG is a COLLECTION gateway (no payout API), and no payment provider
 * is integrated for outgoing transfers. Therefore withdrawal disbursement is
 * an explicit manual process:
 *   1. Admin approves → wallet debited + withdrawal marked PAID (funds committed)
 *   2. Admin transfers the amount to the member's UPI ID from the org account
 *      (UPI intent link generated below when the member has a upi_id on file)
 *   3. Admin records the bank UTR reference via PATCH /api/admin/withdrawals/:id/utr
 *
 * No simulated transaction IDs are ever generated — gateway_txn_id stays NULL
 * until a real UTR is recorded.
 */
export function buildUpiIntentForWithdrawal(withdrawal) {
  const user = queryOne('SELECT name, upi_id FROM users WHERE id = ?', [withdrawal.user_id]);
  if (!user?.upi_id) {
    return null;
  }
  // UPI deep link convention keeps the '@' of the VPA raw
  const q =
    `pa=${encodeURIComponent(user.upi_id)}` +
    `&pn=${encodeURIComponent(user.name || 'Mahi Tech Group Member')}` +
    `&am=${Number(withdrawal.amount).toFixed(2)}` +
    `&cu=INR` +
    `&tn=${encodeURIComponent(`MTG payout ${String(withdrawal.id).slice(0, 8).toUpperCase()}`)}`;
  return `upi://pay?${q.replace(/%40/g, '@')}`;
}

/**
 * Records the real bank UTR reference against a PAID withdrawal.
 */
export function attachWithdrawalUtr({ withdrawalId, utrReference, adminUserId, ipAddress = null }) {
  const admin = queryOne('SELECT id, name, role FROM users WHERE id = ?', [adminUserId]);
  if (!admin || admin.role !== 'admin') {
    return { success: false, status: 403, error: 'Forbidden: Only administrators can record payout references' };
  }

  const utr = String(utrReference || '').trim();
  if (!/^[A-Za-z0-9-]{6,50}$/.test(utr)) {
    return { success: false, status: 400, error: 'Invalid UTR reference: 6-50 alphanumeric characters expected' };
  }

  const withdrawal = queryOne('SELECT * FROM withdrawals WHERE id = ?', [withdrawalId]);
  if (!withdrawal) {
    return { success: false, status: 404, error: 'Withdrawal not found' };
  }
  if (withdrawal.status !== 'PAID') {
    return { success: false, status: 400, error: `UTR can only be recorded for PAID withdrawals (current status: ${withdrawal.status})` };
  }
  if (withdrawal.gateway_txn_id) {
    return { success: false, status: 409, error: 'A UTR reference is already recorded for this withdrawal' };
  }

  execute('UPDATE withdrawals SET gateway_txn_id = ? WHERE id = ?', [utr, withdrawalId]);

  logAccess({
    userId: adminUserId,
    action: 'withdrawal_utr_recorded',
    resource: `/api/admin/withdrawals/${withdrawalId}/utr (utr: ${utr})`,
    ipAddress
  });

  // Inform the member their payout reference is on record
  const notifId = crypto.randomUUID();
  execute(`
    INSERT INTO notifications (id, user_id, event_type, message, link, read_status, created_at)
    VALUES (?, ?, 'payout_reference_added', ?, '/profile.html', 0, CURRENT_TIMESTAMP)
  `, [notifId, withdrawal.user_id, `Payout reference recorded for your ₹${Number(withdrawal.amount).toFixed(2)} withdrawal: UTR ${utr}`]);

  const updated = queryOne('SELECT * FROM withdrawals WHERE id = ?', [withdrawalId]);
  return {
    success: true,
    status: 200,
    message: 'UTR reference recorded against the paid withdrawal.',
    withdrawal: updated
  };
}

/**
 * Submit a new Withdrawal Request.
 * CRITICAL RULE: Funds do NOT move automatically. Request sits in PENDING.
 * Blocked if wallet_frozen = 1.
 */
export function requestWithdrawal({ userId, amount, ipAddress = null }) {
  const numAmount = Number(amount);
  if (isNaN(numAmount) || numAmount <= 0) {
    return { success: false, status: 400, error: 'Withdrawal amount must be a positive number' };
  }

  const user = queryOne('SELECT id, name, email, wallet_balance, wallet_frozen FROM users WHERE id = ?', [userId]);
  if (!user) {
    return { success: false, status: 404, error: 'User not found' };
  }

  // Check wallet freeze (Step 05 interaction)
  if (user.wallet_frozen === 1) {
    logAccess({
      userId,
      action: 'withdrawal_blocked_wallet_frozen',
      resource: `/api/withdrawals/request (attempted: ₹${numAmount})`,
      ipAddress
    });
    return {
      success: false,
      status: 403,
      error: 'Wallet is frozen. Withdrawal requests are blocked pending administrative settlement.'
    };
  }

  const currentBalance = Number(user.wallet_balance || 0);
  if (numAmount > currentBalance) {
    return {
      success: false,
      status: 400,
      error: `Insufficient wallet balance. Available: ₹${currentBalance.toFixed(2)}, Requested: ₹${numAmount.toFixed(2)}`
    };
  }

  const withdrawalId = crypto.randomUUID();
  execute(`
    INSERT INTO withdrawals (
      id, user_id, amount, status, requested_at
    ) VALUES (?, ?, ?, 'PENDING', CURRENT_TIMESTAMP)
  `, [
    withdrawalId,
    userId,
    numAmount
  ]);

  logAccess({
    userId,
    action: 'withdrawal_requested',
    resource: `/api/withdrawals/request (withdrawal_id: ${withdrawalId}, amount: ₹${numAmount})`,
    ipAddress
  });

  const created = queryOne('SELECT * FROM withdrawals WHERE id = ?', [withdrawalId]);

  return {
    success: true,
    status: 201,
    message: 'Withdrawal request submitted successfully. Awaiting manual Admin review.',
    withdrawal: created
  };
}

/**
 * Get all pending withdrawal requests (Admin only)
 */
export function getPendingWithdrawals() {
  return queryAll(`
    SELECT w.*, u.name as user_name, u.email as user_email, u.wallet_balance, u.wallet_frozen
    FROM withdrawals w
    JOIN users u ON w.user_id = u.id
    WHERE w.status = 'PENDING'
    ORDER BY w.requested_at ASC
  `);
}

/**
 * Admin Manual Approval Flow (HONEST manual-UPI disbursement):
 * 1. Admin manually approves pending request (RBAC: payout.approve).
 * 2. Deduct wallet balance immediately (prevents double-spending) and commit
 *    the withdrawal as PAID — the funds are earmarked for transfer.
 * 3. NO gateway is invoked and NO transaction id is fabricated. The admin
 *    completes the UPI transfer manually (intent link provided in the
 *    response when the member has a upi_id) and records the UTR reference
 *    via attachWithdrawalUtr / PATCH /api/admin/withdrawals/:id/utr.
 */
export function approveWithdrawal({ withdrawalId, adminUserId, ipAddress = null }) {
  const admin = queryOne('SELECT id, name, role FROM users WHERE id = ?', [adminUserId]);
  if (!admin || admin.role !== 'admin') {
    return { success: false, status: 403, error: 'Forbidden: Only administrators can approve withdrawals' };
  }

  const withdrawal = queryOne('SELECT * FROM withdrawals WHERE id = ?', [withdrawalId]);
  if (!withdrawal) {
    return { success: false, status: 404, error: 'Withdrawal request not found' };
  }

  if (withdrawal.status !== 'PENDING') {
    return {
      success: false,
      status: 400,
      error: `Cannot approve withdrawal. Current status is already "${withdrawal.status}"`
    };
  }

  // Re-verify recipient user wallet balance
  const user = queryOne('SELECT id, name, wallet_balance, wallet_frozen FROM users WHERE id = ?', [withdrawal.user_id]);
  const currentBalance = Number(user?.wallet_balance || 0);
  const withdrawalAmount = Number(withdrawal.amount);

  if (currentBalance < withdrawalAmount) {
    return {
      success: false,
      status: 400,
      error: `Approval failed: User balance (₹${currentBalance.toFixed(2)}) is lower than requested withdrawal amount (₹${withdrawalAmount.toFixed(2)})`
    };
  }

  // 1. Deduct wallet balance immediately upon approval
  execute(
    'UPDATE users SET wallet_balance = wallet_balance - ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [withdrawalAmount, withdrawal.user_id]
  );

  // 2. Commit the withdrawal as PAID (funds earmarked for manual UPI transfer)
  const upiIntent = buildUpiIntentForWithdrawal(withdrawal);
  execute(`
    UPDATE withdrawals
    SET status = 'PAID', paid_at = CURRENT_TIMESTAMP, gateway_txn_id = NULL,
        approved_by = ?, approved_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [adminUserId, withdrawalId]);

  logAccess({
    userId: adminUserId,
    action: 'withdrawal_approved_manual_upi',
    resource: `/api/admin/withdrawals/${withdrawalId}/approve (amount: ₹${withdrawalAmount}, recipient: ${withdrawal.user_id}, transfer: MANUAL_UPI pending UTR)`,
    ipAddress
  });

  const updatedWithdrawal = queryOne('SELECT * FROM withdrawals WHERE id = ?', [withdrawalId]);

  return {
    success: true,
    status: 200,
    message: `Withdrawal of ₹${withdrawalAmount.toFixed(2)} approved. Wallet debited — complete the UPI transfer and record the UTR reference.`,
    withdrawal: updatedWithdrawal,
    gateway: {
      provider: 'MANUAL_UPI_TRANSFER',
      simulated: false,
      txnId: null,
      upi_intent: upiIntent,
      next_step: upiIntent
        ? 'Open the UPI intent (or transfer manually), then record the UTR via PATCH /api/admin/withdrawals/:id/utr'
        : 'Member has no upi_id on file — transfer manually, then record the UTR via PATCH /api/admin/withdrawals/:id/utr'
    }
  };
}

/**
 * Admin Manual Rejection Flow:
 * 1. Admin rejects pending request with mandatory reason.
 * 2. Wallet balance remains untouched.
 */
export function rejectWithdrawal({ withdrawalId, rejectionReason, adminUserId, ipAddress = null }) {
  const admin = queryOne('SELECT id, name, role FROM users WHERE id = ?', [adminUserId]);
  if (!admin || admin.role !== 'admin') {
    return { success: false, status: 403, error: 'Forbidden: Only administrators can reject withdrawals' };
  }

  if (!rejectionReason || typeof rejectionReason !== 'string' || rejectionReason.trim().length === 0) {
    return { success: false, status: 400, error: 'Rejection reason is mandatory' };
  }

  const withdrawal = queryOne('SELECT * FROM withdrawals WHERE id = ?', [withdrawalId]);
  if (!withdrawal) {
    return { success: false, status: 404, error: 'Withdrawal request not found' };
  }

  if (withdrawal.status !== 'PENDING') {
    return {
      success: false,
      status: 400,
      error: `Cannot reject withdrawal. Current status is already "${withdrawal.status}"`
    };
  }

  execute(`
    UPDATE withdrawals
    SET status = 'REJECTED', approved_by = ?, approved_at = CURRENT_TIMESTAMP, rejection_reason = ?
    WHERE id = ?
  `, [adminUserId, rejectionReason.trim(), withdrawalId]);

  logAccess({
    userId: adminUserId,
    action: 'withdrawal_rejected',
    resource: `/api/admin/withdrawals/${withdrawalId}/reject (reason: "${rejectionReason.trim()}")`,
    ipAddress
  });

  const updatedWithdrawal = queryOne('SELECT * FROM withdrawals WHERE id = ?', [withdrawalId]);

  return {
    success: true,
    status: 200,
    message: 'Withdrawal request rejected. User wallet balance was not deducted.',
    withdrawal: updatedWithdrawal
  };
}
