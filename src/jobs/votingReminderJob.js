import crypto from 'node:crypto';
import { queryAll, queryOne, execute } from '../db/database.js';
import { createNotification } from '../services/notificationService.js';
import { pushToUser } from '../services/wsService.js';

/**
 * VOTING REMINDER JOB
 *
 * Ideas in PENDING_REVIEW whose voting window closes within the next 12 hours
 * get one gentle reminder per eligible voter who has not voted yet. Deduped per
 * (idea, user) — a reminder fires at most once per voting window.
 */

const REMINDER_WINDOW_HOURS = 12;

export function runVotingReminderJob(now = new Date()) {
  const windowEnd = now.getTime() + REMINDER_WINDOW_HOURS * 60 * 60 * 1000;

  // Deadline strings come in mixed formats (SQLite UTC vs JS ISO) — parse in JS
  // instead of string-comparing inside SQL.
  const pending = queryAll(`
    SELECT i.id, i.title, i.owner_id, i.voting_deadline
    FROM ideas i
    WHERE i.status = 'PENDING_REVIEW' AND i.voting_deadline IS NOT NULL
  `);

  const closing = pending.filter((idea) => {
    const d = new Date(String(idea.voting_deadline).replace(' ', 'T') + (String(idea.voting_deadline).includes('Z') ? '' : 'Z'));
    const t = d.getTime();
    return !Number.isNaN(t) && t > now.getTime() && t <= windowEnd;
  });

  let remindersSent = 0;

  for (const idea of closing) {
    const eligible = queryAll(`
      SELECT id, name FROM users
      WHERE status = 'active' AND id != ?
    `, [idea.owner_id]);

    for (const voter of eligible) {
      const voted = queryOne('SELECT id FROM votes WHERE idea_id = ? AND voter_id = ?', [idea.id, voter.id]);
      if (voted) continue;

      // Dedupe: one reminder per (user, idea) per voting window
      const existing = queryOne(`
        SELECT id FROM notifications
        WHERE user_id = ? AND event_type = 'voting_reminder' AND link = ?
      `, [voter.id, `/#${idea.id}`]);
      if (existing) continue;

      const hoursLeft = Math.max(1, Math.round((new Date(idea.voting_deadline) - now) / 3600000));
      createNotification({
        userId: voter.id,
        eventType: 'voting_reminder',
        message: `⏰ Vote closing in ~${hoursLeft}h: "${idea.title}" needs your vote before the deadline.`,
        link: `/#${idea.id}`
      });
      pushToUser(voter.id, 'notification', {
        message: `Vote closing soon on "${idea.title}"`,
        link: `/#${idea.id}`
      });
      remindersSent++;
    }
  }

  return { checked: closing.length, remindersSent, windowHours: REMINDER_WINDOW_HOURS };
}

let reminderTimer = null;

export function startScheduledVotingReminder(intervalMinutes = 30) {
  if (reminderTimer) return reminderTimer;
  runVotingReminderJob(); // one pass at boot (dedupe keeps it safe)
  reminderTimer = setInterval(() => {
    try {
      const result = runVotingReminderJob();
      if (result.remindersSent > 0) {
        console.log(`[VOTING REMINDER] sent ${result.remindersSent} reminders across ${result.checked} closing votes`);
      }
    } catch (err) {
      console.error('[VOTING REMINDER] job failed:', err.message);
    }
  }, intervalMinutes * 60 * 1000);
  if (reminderTimer.unref) reminderTimer.unref();
  console.log(`>>> Voting reminder job scheduled (every ${intervalMinutes} min)`);
  return reminderTimer;
}

export function stopScheduledVotingReminder() {
  if (reminderTimer) {
    clearInterval(reminderTimer);
    reminderTimer = null;
  }
}
