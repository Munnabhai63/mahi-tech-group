import crypto from 'node:crypto';
import { queryOne, queryAll, execute } from '../db/database.js';
import { logAccess } from './auditService.js';

/**
 * SIMULATED PAYMENT GATEWAY STUB (Stripe Connect / Razorpay Route)
 * Clearly identified as a simulation stub per Protocol 00-C.
 */
export function executePayoutGatewayStub({ withdrawalId, amount, userId }) {
  const txnId = `payout_sim_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  return {
    success: true,
    gateway: 'SIMULATED_GATEWAY_STUB',
    txnId,
    amount,
    currency: 'INR',
    timestamp: new Date().toISOString()
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
 * Admin Manual Approval Flow:
 * 1. Admin manually approves pending request (RBAC: payout.approve).
 * 2. Deduct wallet balance immediately before gateway payout (prevents double-spending).
 * 3. Invoke payment gateway payout stub.
 * 4. Transition to PAID with gateway transaction ID.
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

  // 2. Mark withdrawal APPROVED
  execute(`
    UPDATE withdrawals
    SET status = 'APPROVED', approved_by = ?, approved_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [adminUserId, withdrawalId]);

  // 3. Trigger Payment Gateway Payout
  const gatewayResult = executePayoutGatewayStub({
    withdrawalId,
    amount: withdrawalAmount,
    userId: withdrawal.user_id
  });

  // 4. Mark withdrawal PAID
  execute(`
    UPDATE withdrawals
    SET status = 'PAID', paid_at = CURRENT_TIMESTAMP, gateway_txn_id = ?
    WHERE id = ?
  `, [gatewayResult.txnId, withdrawalId]);

  logAccess({
    userId: adminUserId,
    action: 'withdrawal_approved_and_paid',
    resource: `/api/admin/withdrawals/${withdrawalId}/approve (amount: ₹${withdrawalAmount}, recipient: ${withdrawal.user_id}, txn_id: ${gatewayResult.txnId})`,
    ipAddress
  });

  const updatedWithdrawal = queryOne('SELECT * FROM withdrawals WHERE id = ?', [withdrawalId]);

  return {
    success: true,
    status: 200,
    message: `Withdrawal of ₹${withdrawalAmount.toFixed(2)} approved and disbursed successfully.`,
    withdrawal: updatedWithdrawal,
    gateway: gatewayResult
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
