import express from 'express';
import crypto from 'node:crypto';
import { queryOne, queryAll, execute } from '../db/database.js';
import { authenticate } from '../middleware/auth.js';
import { logAccess } from '../services/auditService.js';
import { recordRevenueEvent } from '../services/revenueService.js';
import { createNotification } from '../services/notificationService.js';
import { pushToUser } from '../services/wsService.js';
import {
  createYoupiPayment,
  getYoupiPaymentStatus,
  mapYoupiStatusToCollection,
  verifyYoupiWebhook,
  getYoupiConfigStatus
} from '../services/youpiService.js';

const router = express.Router();

/**
 * YOUPI-PG COLLECTION ROUTES
 *
 * Flow: Admin creates a collection for a project → YouPI payment session +
 * checkout URL (UPI QR / WhatsApp OTP) → payer pays → YouPI fires an
 * HMAC-SHA256 signed webhook to /api/payments/youpi/webhook → the collection
 * is marked PAID and a project revenue event is recorded (auto splits).
 *
 * The webhook endpoint is intentionally unauthenticated — the HMAC signature
 * IS the authentication. Admin endpoints carry their own RBAC checks.
 */

/**
 * Credits a paid collection into the project revenue ledger exactly once.
 * Shared by the webhook handler and the admin status-poll fallback.
 */
function creditCollectionIfPaid(collection, utr) {
  if (collection.status === 'PAID' && collection.credited_at) {
    return { credited: false, reason: 'already credited' };
  }

  const result = recordRevenueEvent({
    projectId: collection.project_id,
    amount: Number(collection.amount),
    source: `YouPI UPI Collection (order ${collection.order_id}${utr ? `, UTR ${utr}` : ''})`,
    eventDate: new Date().toISOString(),
    adminUserId: collection.created_by
  });

  if (!result.success) {
    throw new Error(`Revenue credit failed for collection ${collection.order_id}: ${result.error}`);
  }

  execute(`
    UPDATE payment_collections
    SET status = 'PAID', utr = COALESCE(?, utr), credited_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [utr || null, collection.id]);

  // Notify every admin about the collected revenue
  const project = queryOne('SELECT title FROM projects WHERE id = ?', [collection.project_id]);
  const admins = queryAll("SELECT id FROM users WHERE role = 'admin' AND status = 'active'");
  for (const admin of admins) {
    const notifId = crypto.randomUUID();
    execute(`
      INSERT INTO notifications (id, user_id, event_type, message, link, read_status, created_at)
      VALUES (?, ?, 'revenue_collected', ?, '/admin.html#withdrawals', 0, CURRENT_TIMESTAMP)
    `, [notifId, admin.id, `₹${Number(collection.amount).toFixed(2)} collected via YouPI UPI for "${project?.title || 'project'}" (order ${collection.order_id})${utr ? ` — UTR ${utr}` : ''}`]);
    pushToUser(admin.id, 'notification', {
      id: notifId,
      message: `YouPI collection received for "${project?.title || 'project'}"`,
      link: '/admin.html#withdrawals'
    });
  }

  return { credited: true, revenueEvent: result.revenueEvent || result.event || null };
}

/**
 * 1. GET /api/payments/youpi/config (Admin)
 * Current YouPI connection status (masked).
 */
router.get('/youpi/config', authenticate, (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden: administrators only' });
  }
  return res.status(200).json(getYoupiConfigStatus());
});

/**
 * 2. POST /api/payments/youpi/collections (Admin)
 * Creates a YouPI payment session to collect revenue for a project.
 */
router.post('/youpi/collections', authenticate, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden: Only administrators can create collections' });
  }

  const { project_id, amount, description, customer_name } = req.body || {};
  if (!project_id || !amount) {
    return res.status(400).json({ error: 'project_id and amount are required' });
  }

  const project = queryOne('SELECT id, title FROM projects WHERE id = ?', [project_id]);
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  const numAmount = Number(amount);
  if (!Number.isFinite(numAmount) || numAmount <= 0) {
    return res.status(400).json({ error: 'amount must be a positive number' });
  }

  const collectionId = crypto.randomUUID();
  const orderId = `MTG-${collectionId.slice(0, 8).toUpperCase()}`;

  // Persist the collection first so the webhook can match even if the
  // response is lost in transit
  execute(`
    INSERT INTO payment_collections (id, youpi_payment_id, order_id, project_id, amount, status, description, customer_name, created_by, created_at)
    VALUES (?, NULL, ?, ?, ?, 'CREATED', ?, ?, ?, CURRENT_TIMESTAMP)
  `, [collectionId, orderId, project_id, numAmount, description || `Revenue collection for ${project.title}`, customer_name || null, req.user.id]);

  let session;
  try {
    session = await createYoupiPayment({
      orderId,
      amountRupees: numAmount,
      description: description || `Mahi Tech Group — ${project.title}`,
      customerName: customer_name,
      metadata: { collection_id: collectionId, project_id, project_title: project.title },
      idempotencyKey: `mtg-${collectionId}`
    });
  } catch (err) {
    execute("UPDATE payment_collections SET status = 'FAILED', description = COALESCE(description,'') || ' | session creation failed' WHERE id = ?", [collectionId]);
    logAccess({
      userId: req.user.id,
      action: 'youpi_collection_create_failed',
      resource: `/api/payments/youpi/collections (${err.message})`,
      ipAddress: req.ip
    });
    return res.status(err.status || 502).json({ error: err.message });
  }

  execute('UPDATE payment_collections SET youpi_payment_id = ? WHERE id = ?', [session.paymentId, collectionId]);

  logAccess({
    userId: req.user.id,
    action: 'youpi_collection_created',
    resource: `/api/payments/youpi/collections (order ${orderId}, ₹${numAmount}, project ${project.title})`,
    ipAddress: req.ip
  });

  return res.status(201).json({
    message: 'YouPI payment session created. Share the checkoutUrl with the payer.',
    collection: {
      id: collectionId,
      order_id: orderId,
      youpi_payment_id: session.paymentId,
      project_id,
      project_title: project.title,
      amount: numAmount,
      status: 'CREATED'
    },
    checkoutUrl: session.checkoutUrl
  });
});

/**
 * 3. GET /api/payments/youpi/collections (Admin)
 * Lists all collections with project titles.
 */
router.get('/youpi/collections', authenticate, (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden: administrators only' });
  }
  const collections = queryAll(`
    SELECT pc.*, p.title as project_title, u.name as created_by_name
    FROM payment_collections pc
    JOIN projects p ON pc.project_id = p.id
    LEFT JOIN users u ON pc.created_by = u.id
    ORDER BY pc.created_at DESC
    LIMIT 200
  `);
  return res.status(200).json({ count: collections.length, collections });
});

/**
 * 4. POST /api/payments/youpi/collections/:id/sync (Admin)
 * Polls YouPI for live status — fallback when a webhook is missed.
 * Credits the revenue automatically if YouPI reports a verified payment.
 */
router.post('/youpi/collections/:id/sync', authenticate, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden: administrators only' });
  }

  const collection = queryOne('SELECT * FROM payment_collections WHERE id = ?', [req.params.id]);
  if (!collection) {
    return res.status(404).json({ error: 'Collection not found' });
  }
  if (!collection.youpi_payment_id) {
    return res.status(400).json({ error: 'Collection has no YouPI payment session (creation failed)' });
  }

  let remote;
  try {
    remote = await getYoupiPaymentStatus(collection.youpi_payment_id);
  } catch (err) {
    return res.status(err.status || 502).json({ error: err.message });
  }

  const mappedStatus = mapYoupiStatusToCollection(remote.status || remote.outcome || remote.publicOutcome);

  if (mappedStatus === 'PAID') {
    try {
      const credit = creditCollectionIfPaid(collection, remote.utr || null);
      const updated = queryOne('SELECT * FROM payment_collections WHERE id = ?', [collection.id]);
      return res.status(200).json({ message: credit.credited ? 'Payment verified and revenue credited' : 'Payment already credited', collection: updated, youpi_status: remote.status });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (mappedStatus !== 'CREATED' && collection.status === 'CREATED') {
    execute('UPDATE payment_collections SET status = ? WHERE id = ?', [mappedStatus, collection.id]);
  }

  const updated = queryOne('SELECT * FROM payment_collections WHERE id = ?', [collection.id]);
  return res.status(200).json({ message: `YouPI reports status "${remote.status}"`, collection: updated, youpi_status: remote.status });
});

/**
 * 5. POST /api/payments/youpi/webhook (PUBLIC — HMAC-SHA256 authenticated)
 * Authoritative payment notifications from the YouPI gateway.
 * Raw body bytes are captured by the global parser's verify hook because an
 * HMAC signature must be computed over the exact received bytes.
 */
router.post('/youpi/webhook', (req, res) => {
  let rawBody;
  if (Buffer.isBuffer(req.rawBody)) {
    rawBody = req.rawBody.toString('utf8');
  } else if (typeof req.body === 'object' && req.body !== null) {
    // Last-resort fallback (only correct when body is byte-identical after
    // re-serialization; the global verify hook makes this path unlikely)
    rawBody = JSON.stringify(req.body);
  }

  const verification = verifyYoupiWebhook({
    rawBody,
    signatureV2: req.get('X-Gateway-Signature-V2'),
    timestamp: req.get('X-Gateway-Timestamp'),
    signatureV1: req.get('X-Gateway-Signature')
  });

  if (!verification.valid) {
    logAccess({
      action: 'youpi_webhook_rejected',
      resource: `/api/payments/youpi/webhook (${verification.reason})`,
      ipAddress: req.ip || req.socket.remoteAddress
    });
    return res.status(401).json({ error: 'Invalid webhook signature' });
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return res.status(400).json({ error: 'Malformed webhook payload' });
  }

  const event = String(payload.event || '').toUpperCase();
  const matchField = payload.paymentId ? 'youpi_payment_id' : 'order_id';
  const matchValue = payload.paymentId || payload.orderId;

  const collection = queryOne(`SELECT * FROM payment_collections WHERE ${matchField} = ?`, [matchValue]);
  if (!collection) {
    // Unknown session: acknowledge so YouPI stops retrying, but log loudly
    logAccess({
      action: 'youpi_webhook_unknown_session',
      resource: `/api/payments/youpi/webhook (${matchField}: ${matchValue}, event: ${event})`,
      ipAddress: req.ip
    });
    return res.status(200).json({ received: true, matched: false });
  }

  if (event === 'SUCCESS') {
    try {
      const credit = creditCollectionIfPaid(collection, payload.utr || null);
      logAccess({
        action: 'youpi_webhook_payment_success',
        resource: `/api/payments/youpi/webhook (order ${collection.order_id}, ₹${collection.amount}, utr: ${payload.utr || 'n/a'}, credited: ${credit.credited})`,
        ipAddress: req.ip
      });
    } catch (err) {
      logAccess({
        action: 'youpi_webhook_credit_failed',
        resource: `/api/payments/youpi/webhook (order ${collection.order_id}: ${err.message})`,
        ipAddress: req.ip
      });
      // 500 makes YouPI retry the delivery — correct behaviour for a credit failure
      return res.status(500).json({ error: 'Credit processing failed; gateway will retry' });
    }
  } else if (['FAILED', 'EXPIRED', 'CANCELLED'].includes(event)) {
    const mapped = mapYoupiStatusToCollection(event);
    if (collection.status === 'CREATED') {
      execute('UPDATE payment_collections SET status = ? WHERE id = ?', [mapped, collection.id]);
      logAccess({
        action: `youpi_webhook_${event.toLowerCase()}`,
        resource: `/api/payments/youpi/webhook (order ${collection.order_id})`,
        ipAddress: req.ip
      });
    }
  }

  return res.status(200).json({ received: true });
});

export default router;
