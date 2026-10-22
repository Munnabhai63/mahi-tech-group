import crypto from 'node:crypto';
import { queryOne, execute } from '../db/database.js';

export function getQuotaConfig() {
  const limitRow = queryOne("SELECT value FROM system_config WHERE key = 'idea_quota_limit'");
  const windowRow = queryOne("SELECT value FROM system_config WHERE key = 'idea_quota_window_days'");

  return {
    limit: limitRow ? parseInt(limitRow.value, 10) : 2,
    windowDays: windowRow ? parseInt(windowRow.value, 10) : 7
  };
}

export function getUserQuotaStatus(userId) {
  const { limit, windowDays } = getQuotaConfig();
  const user = queryOne('SELECT idea_quota_used, quota_reset_date FROM users WHERE id = ?', [userId]);

  if (!user) {
    throw new Error('User not found');
  }

  let ideaQuotaUsed = user.idea_quota_used || 0;
  let quotaResetDate = user.quota_reset_date;
  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];

  // If reset date has passed, cycle has expired
  if (quotaResetDate && quotaResetDate <= todayStr) {
    ideaQuotaUsed = 0;
  }

  const remaining = Math.max(0, limit - ideaQuotaUsed);
  const cycleActive = Boolean(quotaResetDate && quotaResetDate > todayStr);

  return {
    limit,
    windowDays,
    used: ideaQuotaUsed,
    remaining,
    resetDate: quotaResetDate,
    cycleActive
  };
}

export function consumeQuota(userId, ideaId) {
  const { limit, windowDays } = getQuotaConfig();
  const user = queryOne('SELECT idea_quota_used, quota_reset_date FROM users WHERE id = ?', [userId]);

  if (!user) {
    return { success: false, status: 404, error: 'User not found' };
  }

  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];
  let currentUsed = user.idea_quota_used || 0;
  let currentResetDate = user.quota_reset_date;
  let cycleStart = todayStr;

  // Section 4.1 Fixed Cycle Initialization & Expiration Check
  if (!currentResetDate || currentResetDate <= todayStr) {
    // Reset cycle
    currentUsed = 0;
    const nextDate = new Date();
    nextDate.setDate(nextDate.getDate() + windowDays);
    currentResetDate = nextDate.toISOString().split('T')[0];

    execute(
      'UPDATE users SET idea_quota_used = 0, quota_reset_date = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [currentResetDate, userId]
    );
  }

  // Quota enforcement
  if (currentUsed >= limit) {
    return {
      success: false,
      status: 403,
      error: `Quota exhausted. Resets on ${currentResetDate}`,
      quotaUsed: currentUsed,
      quotaLimit: limit,
      resetDate: currentResetDate,
      remaining: 0
    };
  }

  // Consume 1 quota unit
  const newUsed = currentUsed + 1;
  execute(
    'UPDATE users SET idea_quota_used = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [newUsed, userId]
  );

  // Insert into idea_quota_log
  const logId = crypto.randomUUID();
  execute(`
    INSERT INTO idea_quota_log (id, user_id, idea_id, cycle_start, cycle_end, used_count, created_at)
    VALUES (?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
  `, [logId, userId, ideaId, cycleStart, currentResetDate]);

  return {
    success: true,
    quotaUsed: newUsed,
    quotaLimit: limit,
    resetDate: currentResetDate,
    remaining: Math.max(0, limit - newUsed)
  };
}
