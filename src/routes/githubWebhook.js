import express from 'express';
import crypto from 'node:crypto';
import { queryOne, queryAll } from '../db/database.js';
import { logAccess } from '../services/auditService.js';
import { createNotification } from '../services/notificationService.js';
import { pushToUser } from '../services/wsService.js';
import { updateTaskStatus } from '../services/fanoutService.js';
import { verifyGithubWebhookSignature } from '../services/githubService.js';

const router = express.Router();

/**
 * GITHUB WEBHOOK — PR ↔ TASK PIPELINE
 *
 * GitHub posts here (x-hub-signature-256 HMAC over raw bytes) whenever a
 * pull request changes on a repository linked to a project.
 *
 * Task linking convention (either works):
 *   branch name:  mtg/<taskId>/anything
 *   PR body:      MTG-TASK: <taskId>
 *
 * PR opened    → task IN_PROGRESS + notification
 * PR merged    → task DONE via the standard status engine (auto-unblocks
 *                dependent tasks, advances project stage) + notifications
 * PR closed    → notification only (work continues)
 * ping         → 200 acknowledgement
 */

function extractTaskId(payload) {
  const branch = payload?.pull_request?.head?.ref || '';
  const m = branch.match(/^mtg\/([0-9a-fA-F-]{6,40})(?:[\/-]|$)/);
  if (m) return m[1].toLowerCase();
  const body = payload?.pull_request?.body || '';
  const b = String(body).match(/MTG-TASK[:\s-]*([0-9a-fA-F-]{6,40})/i);
  if (b) return b[1].toLowerCase();
  return null;
}

function notifyTaskUpdate(task, message, link) {
  const recipients = new Set();
  if (task.assigned_to) recipients.add(task.assigned_to);
  const admins = queryAll("SELECT id FROM users WHERE role='admin' AND status='active'");
  for (const a of admins) recipients.add(a.id);
  for (const userId of recipients) {
    const notifId = crypto.randomUUID();
    createNotification({ userId, eventType: 'github_pr_sync', message, link });
    pushToUser(userId, 'notification', { id: notifId, message, link });
  }
}

router.post('/webhook', (req, res) => {
  let rawBody = Buffer.isBuffer(req.rawBody) ? req.rawBody.toString('utf8') : JSON.stringify(req.body || {});

  const verification = verifyGithubWebhookSignature({
    rawBody,
    signatureHeader: req.get('x-hub-signature-256')
  });
  if (!verification.valid) {
    logAccess({
      action: 'github_webhook_rejected',
      resource: `/api/github/webhook (${verification.reason})`,
      ipAddress: req.ip
    });
    return res.status(401).json({ error: 'Invalid webhook signature' });
  }

  const event = req.get('x-github-event') || '';
  const payload = typeof req.body === 'object' ? req.body : JSON.parse(rawBody);

  if (event === 'ping') {
    return res.status(200).json({ received: true, event: 'ping' });
  }

  if (event !== 'pull_request') {
    return res.status(200).json({ received: true, event, ignored: true });
  }

  const repoFullName = payload?.repository?.full_name;
  const action = payload?.action;
  const pr = payload?.pull_request || {};
  const project = repoFullName
    ? queryOne('SELECT id, title, github_repo FROM projects WHERE github_repo = ?', [repoFullName])
    : null;

  if (!project) {
    logAccess({
      action: 'github_webhook_unlinked_repo',
      resource: `/api/github/webhook (repo: ${repoFullName}, PR #${pr.number} — no project link)`,
      ipAddress: req.ip
    });
    return res.status(200).json({ received: true, matched: false, note: 'Repository not linked to any project' });
  }

  const taskId = extractTaskId(payload);
  if (!taskId) {
    return res.status(200).json({ received: true, matched: false, note: 'No task id in branch/body (use mtg/<taskId>/ or MTG-TASK: <id>)' });
  }

  const task = queryOne('SELECT * FROM project_tasks WHERE id = ? AND project_id = ?', [taskId, project.id]);
  if (!task) {
    return res.status(200).json({ received: true, matched: false, note: `Task ${taskId} not found on project ${project.title}` });
  }

  const prUrl = pr.html_url || '';
  const prLabel = `PR #${pr.number} "${(pr.title || '').slice(0, 60)}"`;

  if (action === 'opened' || action === 'reopened' || action === 'synchronize') {
    if (['TODO', 'BLOCKED'].includes(task.status) && task.assigned_to) {
      updateTaskStatus({ taskId: task.id, userId: task.assigned_to, newStatus: 'IN_PROGRESS', isAdmin: true });
    }
    notifyTaskUpdate(task, `${prLabel} opened on ${project.title} — task marked in progress`, prUrl);
    logAccess({ action: 'github_pr_opened', resource: `${repoFullName} ${prLabel} → task ${taskId} IN_PROGRESS`, ipAddress: req.ip });
    return res.status(200).json({ received: true, matched: true, task_status: 'IN_PROGRESS' });
  }

  if (action === 'closed') {
    if (pr.merged && task.assigned_to) {
      const result = updateTaskStatus({ taskId: task.id, userId: task.assigned_to, newStatus: 'DONE', isAdmin: true });
      notifyTaskUpdate(task, `${prLabel} MERGED — task "${task.task_name}" completed${result?.unblockedTasks?.length ? ` (unblocked ${result.unblockedTasks.length} downstream tasks)` : ''}`, prUrl);
      logAccess({ action: 'github_pr_merged', resource: `${repoFullName} ${prLabel} → task ${taskId} DONE`, ipAddress: req.ip });
      return res.status(200).json({ received: true, matched: true, task_status: 'DONE' });
    }
    notifyTaskUpdate(task, `${prLabel} closed without merge — task remains "${task.status}"`, prUrl);
    logAccess({ action: 'github_pr_closed', resource: `${repoFullName} ${prLabel} (not merged)`, ipAddress: req.ip });
    return res.status(200).json({ received: true, matched: true, task_status: task.status });
  }

  return res.status(200).json({ received: true, ignored_action: action });
});

export default router;
