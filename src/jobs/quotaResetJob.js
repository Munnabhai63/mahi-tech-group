import { queryAll, queryOne, execute } from '../db/database.js';
import { logAccess } from '../services/auditService.js';
import { getQuotaConfig } from '../services/quotaService.js';

export function runQuotaResetJob(currentDate = null) {
  const { windowDays } = getQuotaConfig();
  const dateStr = currentDate || new Date().toISOString().split('T')[0];

  console.log(`[QUOTA RESET JOB] Executing cycle reset check for date: ${dateStr}`);

  const expiredUsers = queryAll(
    'SELECT id, name, email, idea_quota_used, quota_reset_date FROM users WHERE quota_reset_date IS NOT NULL AND quota_reset_date <= ?',
    [dateStr]
  );

  let resetCount = 0;

  for (const user of expiredUsers) {
    const baseDate = new Date(dateStr);
    baseDate.setDate(baseDate.getDate() + windowDays);
    const newResetDate = baseDate.toISOString().split('T')[0];

    execute(
      'UPDATE users SET idea_quota_used = 0, quota_reset_date = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [newResetDate, user.id]
    );

    logAccess({
      userId: user.id,
      action: 'quota_reset',
      resource: `Scheduled Quota Reset (previous: ${user.quota_reset_date}, new: ${newResetDate})`
    });

    resetCount++;
    console.log(`[QUOTA RESET JOB] Reset quota for user: ${user.email} (id: ${user.id}). Next reset: ${newResetDate}`);
  }

  console.log(`[QUOTA RESET JOB] Completed. Reset ${resetCount} user(s).`);
  return { resetCount, processedUsers: expiredUsers.map(u => u.email) };
}

let intervalHandle = null;

export function startScheduledQuotaReset(intervalMs = 24 * 60 * 60 * 1000) {
  if (intervalHandle) {
    clearInterval(intervalHandle);
  }
  // Run once on startup
  runQuotaResetJob();
  // Schedule recurring interval
  intervalHandle = setInterval(() => {
    runQuotaResetJob();
  }, intervalMs);

  return intervalHandle;
}

export function stopScheduledQuotaReset() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}
