import { queryAll, queryOne } from '../db/database.js';
import { emailService } from '../services/emailService.js';

/**
 * DAILY DIGEST JOB
 *
 * One email per member per day (09:00): pending votes, open assigned tasks,
 * unread notification count, wallet balance. Skips members who muted nothing?
 * Digest respects no preference — it is one low-frequency email; the prefs
 * mute in-app notifications only.
 */

export async function runDailyDigestJob(now = new Date()) {
  const members = queryAll("SELECT id, name, email FROM users WHERE status = 'active' AND email IS NOT NULL");
  let sent = 0;
  let skippedNoContent = 0;

  for (const m of members) {
    const pendingVotes = queryOne(`
      SELECT COUNT(*) as c FROM ideas i
      WHERE i.status = 'PENDING_REVIEW' AND i.owner_id != ?
        AND NOT EXISTS (SELECT 1 FROM votes v WHERE v.idea_id = i.id AND v.voter_id = ?)
    `, [m.id, m.id])?.c || 0;

    const openTasks = queryOne(`
      SELECT COUNT(*) as c FROM project_tasks
      WHERE assigned_to = ? AND status IN ('TODO', 'BLOCKED', 'IN_PROGRESS')
    `, [m.id])?.c || 0;

    const unread = queryOne(
      'SELECT COUNT(*) as c FROM notifications WHERE user_id = ? AND read_status = 0',
      [m.id]
    )?.c || 0;

    const wallet = queryOne('SELECT wallet_balance FROM users WHERE id = ?', [m.id])?.wallet_balance || 0;

    if (pendingVotes === 0 && openTasks === 0 && unread === 0) {
      skippedNoContent++;
      continue;
    }

    const lines = [`Hello ${m.name},`, '', 'Your day at Mahi Tech Group:'];
    if (pendingVotes > 0) lines.push(`- 🗳️ ${pendingVotes} idea(s) waiting for your vote`);
    if (openTasks > 0) lines.push(`- 📋 ${openTasks} task(s) assigned to you (TODO / in progress / blocked)`);
    if (unread > 0) lines.push(`- 🔔 ${unread} unread notification(s)`);
    lines.push(`- 💰 Wallet balance: Rs.${Number(wallet).toFixed(2)}`);
    lines.push('', 'Sign in to the platform to act on these.', '', '- Mahi Tech Group');

    try {
      const result = await emailService.sendEmail({
        to: m.email,
        subject: `Your Mahi Tech Group digest — ${pendingVotes} votes, ${openTasks} tasks, ${unread} notifications`,
        text: lines.join('\n'),
        userId: m.id
      });
      if (result.delivered || result.mode === 'smtp') sent++;
      else if (result.mode === 'local_audit') sent++; // count as processed in dev
    } catch (e) {
      console.error('[DIGEST] failed for', m.email, e.message);
    }
  }

  return { members: members.length, digestsSent: sent, skippedNoContent };
}

let digestTimer = null;

export function startScheduledDailyDigest() {
  if (digestTimer) return digestTimer;
  const scheduleNext = () => {
    const now = new Date();
    const next = new Date(now);
    next.setHours(9, 0, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    digestTimer = setTimeout(async () => {
      try {
        const result = await runDailyDigestJob();
        console.log(`[DIGEST] sent ${result.digestsSent} digests (${result.skippedNoContent} skipped)`);
      } catch (err) {
        console.error('[DIGEST] job failed:', err.message);
      } finally {
        scheduleNext();
      }
    }, next - now);
    if (digestTimer.unref) digestTimer.unref();
    console.log(`>>> Daily digest job scheduled for ${next.toISOString()}`);
  };
  scheduleNext();
  return digestTimer;
}

export function stopScheduledDailyDigest() {
  if (digestTimer) {
    clearTimeout(digestTimer);
    digestTimer = null;
  }
}
