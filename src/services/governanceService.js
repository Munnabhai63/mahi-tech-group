import crypto from 'node:crypto';
import { queryOne, queryAll, execute } from '../db/database.js';
import { logAccess } from './auditService.js';
import { broadcastEvent } from './wsService.js';

/**
 * MAHI TECH GROUP — USER DATA GOVERNANCE SERVICE (STEP 14 LAYER 5)
 * Append-only GDPR records, right to restrict, suspension lifecycles, and audit compliance.
 */

export const VALID_GOVERNANCE_ACTIONS = [
  'consent_given',
  'consent_revoked',
  'data_export_requested',
  'data_export_delivered',
  'data_deletion_requested',
  'data_deletion_reviewed',
  'right_to_restrict',
  'restriction_lifted'
];

/**
 * Append an immutable data governance entry to user_data_governance.
 */
export function addGovernanceEntry({ userId, action, notes = null, adminId, ipAddress = '127.0.0.1' }) {
  if (!userId) {
    const err = new Error('userId is required');
    err.status = 400;
    throw err;
  }

  const user = queryOne('SELECT id, name, email FROM users WHERE id = ?', [userId]);
  if (!user) {
    const err = new Error('User not found');
    err.status = 404;
    throw err;
  }

  if (!action || !VALID_GOVERNANCE_ACTIONS.includes(action)) {
    const err = new Error(`Invalid governance action. Must be one of: ${VALID_GOVERNANCE_ACTIONS.join(', ')}`);
    err.status = 400;
    throw err;
  }

  const entryId = crypto.randomUUID();
  execute(`
    INSERT INTO user_data_governance (
      id, user_id, action, requested_by, notes, reverted, created_at
    ) VALUES (?, ?, ?, ?, ?, 0, datetime('now'))
  `, [
    entryId,
    userId,
    action,
    adminId,
    notes || null
  ]);

  logAccess({
    userId: adminId,
    targetId: userId,
    action: 'superadmin_governance_entry',
    resource: `/api/superadmin/governance/${userId} (${action})`,
    ipAddress
  });

  return queryOne('SELECT * FROM user_data_governance WHERE id = ?', [entryId]);
}

/**
 * Retrieve chronological governance history for a member.
 */
export function getGovernanceHistory(userId, adminId, ipAddress = '127.0.0.1') {
  if (!userId) {
    const err = new Error('userId is required');
    err.status = 400;
    throw err;
  }

  const user = queryOne('SELECT id, name, email, role, status FROM users WHERE id = ?', [userId]);
  if (!user) {
    const err = new Error('User not found');
    err.status = 404;
    throw err;
  }

  const history = queryAll(`
    SELECT g.*, 
           u.name as user_name, u.email as user_email,
           req.name as requested_by_name, req.email as requested_by_email
    FROM user_data_governance g
    LEFT JOIN users u ON g.user_id = u.id
    LEFT JOIN users req ON g.requested_by = req.id
    WHERE g.user_id = ?
    ORDER BY g.created_at ASC
  `, [userId]);

  logAccess({
    userId: adminId,
    targetId: userId,
    action: 'superadmin_governance_view',
    resource: `/api/superadmin/governance/${userId}`,
    ipAddress
  });

  return {
    user,
    history
  };
}

/**
 * Block a member from the platform:
 * 1. preventSelfAction guard: Admin cannot block themselves
 * 2. Sets users.status = 'suspended'
 * 3. Creates governance row with action='right_to_restrict'
 * 4. Emits WebSocket event member_blocked
 * 5. Logs in access_log
 */
export function blockMember(userId, { notes = null } = {}, adminId, ipAddress = '127.0.0.1') {
  if (!userId) {
    const err = new Error('userId is required');
    err.status = 400;
    throw err;
  }

  // Mandatory preventSelfAction check
  if (userId === adminId) {
    const err = new Error('Self-action forbidden: Admin cannot self-block, self-dispute, or self-demote');
    err.status = 400;
    throw err;
  }

  const user = queryOne('SELECT id, name, email, status FROM users WHERE id = ?', [userId]);
  if (!user) {
    const err = new Error('User not found');
    err.status = 404;
    throw err;
  }

  // 1. Update status to 'suspended'
  execute("UPDATE users SET status = 'suspended', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [userId]);

  // 2. Invalidate active sessions
  execute("UPDATE sessions SET is_revoked = 1 WHERE user_id = ?", [userId]);

  // 3. Create governance record
  const entryId = crypto.randomUUID();
  execute(`
    INSERT INTO user_data_governance (
      id, user_id, action, requested_by, notes, reverted, created_at
    ) VALUES (?, ?, 'right_to_restrict', ?, ?, 0, datetime('now'))
  `, [
    entryId,
    userId,
    adminId,
    notes || 'Platform access suspended by administrator (right to restrict)'
  ]);

  // 4. Emit WebSocket event
  broadcastEvent('org:global', 'member_blocked', {
    userId,
    blockedBy: adminId,
    timestamp: new Date().toISOString()
  });

  // 5. Audit log
  logAccess({
    userId: adminId,
    targetId: userId,
    action: 'superadmin_member_block',
    resource: `/api/superadmin/governance/${userId}/block`,
    ipAddress
  });

  return {
    success: true,
    user_id: userId,
    status: 'suspended',
    action: 'right_to_restrict',
    governance_entry_id: entryId
  };
}

/**
 * Unblock a member on the platform:
 * 1. Restores users.status to 'active'
 * 2. Creates governance row with action='restriction_lifted'
 * 3. Logs in access_log
 */
export function unblockMember(userId, { notes = null } = {}, adminId, ipAddress = '127.0.0.1') {
  if (!userId) {
    const err = new Error('userId is required');
    err.status = 400;
    throw err;
  }

  const user = queryOne('SELECT id, name, email, status FROM users WHERE id = ?', [userId]);
  if (!user) {
    const err = new Error('User not found');
    err.status = 404;
    throw err;
  }

  // 1. Restore status to 'active'
  execute("UPDATE users SET status = 'active', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [userId]);

  // 2. Create governance record (append-only)
  const entryId = crypto.randomUUID();
  execute(`
    INSERT INTO user_data_governance (
      id, user_id, action, requested_by, notes, reverted, created_at
    ) VALUES (?, ?, 'restriction_lifted', ?, ?, 0, datetime('now'))
  `, [
    entryId,
    userId,
    adminId,
    notes || 'Platform restriction lifted and active status restored by administrator'
  ]);

  // 3. Emit WebSocket event
  broadcastEvent('org:global', 'member_unblocked', {
    userId,
    unblockedBy: adminId,
    timestamp: new Date().toISOString()
  });

  // 4. Audit log
  logAccess({
    userId: adminId,
    targetId: userId,
    action: 'superadmin_member_unblock',
    resource: `/api/superadmin/governance/${userId}/unblock`,
    ipAddress
  });

  return {
    success: true,
    user_id: userId,
    status: 'active',
    action: 'restriction_lifted',
    governance_entry_id: entryId
  };
}
