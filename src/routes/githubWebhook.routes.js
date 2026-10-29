import express from 'express';
import crypto from 'node:crypto';
import { execute } from '../db/database.js';
import verifyGitHubWebhookSignature from '../middleware/githubWebhookVerify.js';
import { processWebhookEvent } from '../services/githubWebhookProcessor.js';

const router = express.Router();

/**
 * POST /api/github/webhook
 * Receives all GitHub App webhook events, verifies HMAC-SHA256 signature,
 * records in append-only log, and processes event asynchronously.
 */
router.post('/webhook', verifyGitHubWebhookSignature, async (req, res) => {
  const deliveryId = req.headers['x-github-delivery'] || crypto.randomUUID();
  const eventType = req.headers['x-github-event'] || 'unknown';
  const action = req.parsedPayload?.action || null;
  const repoFullName = req.parsedPayload?.repository?.full_name || null;
  const senderLogin = req.parsedPayload?.sender?.login || null;
  const payloadStr = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(req.parsedPayload || {});

  const logId = crypto.randomUUID();

  try {
    execute(`
      INSERT INTO github_webhook_log (
        id, delivery_id, event_type, action, repo_full_name, sender_login, payload, signature_valid, processed, received_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0, datetime('now'))
    `, [logId, deliveryId, eventType, action, repoFullName, senderLogin, payloadStr]);
  } catch (err) {
    // Idempotency: Duplicate delivery_id returns 200 with skipped: true
    if (err.message && (err.message.includes('UNIQUE constraint') || err.message.includes('delivery_id'))) {
      return res.status(200).json({ status: 'duplicate', skipped: true });
    }
    console.error('[GitHub Webhook Log Error]:', err.message);
    return res.status(500).json({ error: 'Internal log storage failure' });
  }

  // Respond immediately to GitHub with HTTP 200
  res.status(200).json({ status: 'received' });

  // Asynchronous non-blocking event processing
  setImmediate(async () => {
    try {
      await processWebhookEvent(eventType, action, req.parsedPayload, logId);
    } catch (procErr) {
      console.error(`[Webhook Async Processing Error for delivery ${deliveryId}]:`, procErr.message);
      try {
        execute('UPDATE github_webhook_log SET error_message = ? WHERE id = ?', [procErr.message, logId]);
      } catch (e) {}
    }
  });
});

export default router;
