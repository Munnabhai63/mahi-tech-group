import crypto from 'node:crypto';
import { execute } from '../db/database.js';

/**
 * Helper to log failed signature verification attempts to github_webhook_log for audit
 */
function logFailedSignatureAttempt(req, errorMessage) {
  try {
    const deliveryId = req.headers['x-github-delivery'] || crypto.randomUUID();
    const eventType = req.headers['x-github-event'] || 'unknown';
    let payloadStr = '';
    let action = null;
    let repoFullName = null;
    let senderLogin = null;

    if (Buffer.isBuffer(req.body)) {
      payloadStr = req.body.toString('utf8');
      try {
        const parsed = JSON.parse(payloadStr);
        action = parsed.action || null;
        repoFullName = parsed.repository?.full_name || null;
        senderLogin = parsed.sender?.login || null;
      } catch (e) {}
    } else if (typeof req.body === 'string') {
      payloadStr = req.body;
    }

    execute(`
      INSERT INTO github_webhook_log (
        id, delivery_id, event_type, action, repo_full_name, sender_login, payload, signature_valid, processed, error_message, received_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?, datetime('now'))
    `, [crypto.randomUUID(), deliveryId, eventType, action, repoFullName, senderLogin, payloadStr, errorMessage]);
  } catch (err) {
    // Suppress secondary logging error (e.g. duplicate delivery_id)
  }
}

/**
 * Returns active webhook secret
 */
function getSecret() {
  return process.env.GITHUB_WEBHOOK_SECRET || '';
}

/**
 * Middleware: verifyGitHubWebhookSignature
 * Verifies X-Hub-Signature-256 header using HMAC-SHA256 and timingSafeEqual.
 */
export function verifyGitHubWebhookSignature(req, res, next) {
  const signatureHeader = req.headers['x-hub-signature-256'];

  if (!signatureHeader) {
    console.warn('[GitHub Webhook] Missing X-Hub-Signature-256 header');
    logFailedSignatureAttempt(req, 'Missing X-Hub-Signature-256 header');
    return res.status(401).json({ error: 'Missing X-Hub-Signature-256 header' });
  }

  const secret = getSecret();
  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || '', 'utf8');

  const computedSig = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');

  const headerBuffer = Buffer.from(signatureHeader, 'utf8');
  const computedBuffer = Buffer.from(computedSig, 'utf8');

  // Prevent timing attacks and avoid timingSafeEqual throwing if lengths differ
  if (headerBuffer.length !== computedBuffer.length) {
    console.warn('[GitHub Webhook] Signature length mismatch');
    logFailedSignatureAttempt(req, 'Invalid webhook signature');
    return res.status(401).json({ error: 'Invalid webhook signature' });
  }

  const match = crypto.timingSafeEqual(headerBuffer, computedBuffer);
  if (!match) {
    console.warn('[GitHub Webhook] Signature verification failed');
    logFailedSignatureAttempt(req, 'Invalid webhook signature');
    return res.status(401).json({ error: 'Invalid webhook signature' });
  }

  // Attach verified attributes to request object
  req.webhookVerified = true;
  req.rawBody = rawBody;
  try {
    req.parsedPayload = JSON.parse(rawBody.toString('utf8'));
  } catch (err) {
    return res.status(400).json({ error: 'Malformed JSON payload' });
  }

  return next();
}

export default verifyGitHubWebhookSignature;
