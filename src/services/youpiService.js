import crypto from 'node:crypto';
import { queryOne, execute } from '../db/database.js';
import { getGatewayConfig, getDecryptedGatewaySecrets } from './gatewayService.js';
import { logAccess } from './auditService.js';

/**
 * YOUPI-PG INTEGRATION SERVICE
 *
 * YouPI-PG is a self-hosted UPI COLLECTION gateway (0% fee):
 *  - createPayment → payment session + checkout URL (QR / WhatsApp OTP / UPI apps)
 *  - getPaymentStatus → lifecycle status of a session
 *  - HMAC-SHA256 signed webhooks are the authoritative proof of payment
 *
 * Outgoing money (withdrawals) is intentionally NOT routed through YouPI —
 * it has no payout API. Withdrawals use the honest manual-UPI flow in
 * payoutService (admin transfers + UTR reference recording).
 *
 * Gateway credentials live in payment_gateway_config (AES-256-GCM encrypted);
 * the gateway base URL is stored in system_config under 'youpi_base_url'.
 */

const DEFAULT_BASE_URL = 'http://127.0.0.1:7000';

function getYoupiBaseUrl() {
  const row = queryOne("SELECT value FROM system_config WHERE key = 'youpi_base_url'");
  return (row?.value || '').trim() || DEFAULT_BASE_URL;
}

/**
 * Resolves the full YouPI connection: base URL + decrypted merchant key.
 * Throws with a helpful message when the gateway is not configured yet.
 */
export function getYoupiConnection() {
  const baseUrl = getYoupiBaseUrl().replace(/\/+$/, '');
  const secrets = getDecryptedGatewaySecrets();

  if (!secrets.api_key) {
    const err = new Error('YouPI gateway is not configured: set the merchant API key (X-Merchant-Key) in Super Admin → Gateway Config.');
    err.status = 503;
    throw err;
  }

  return { baseUrl, merchantKey: secrets.api_key };
}

export function getYoupiConfigStatus() {
  const gw = getGatewayConfig();
  return {
    configured: Boolean(gw.api_key_set),
    gateway_name: gw.gateway_name,
    mode: gw.mode,
    base_url: getYoupiBaseUrl()
  };
}

export function setYoupiBaseUrl(url, adminId, ipAddress = '127.0.0.1') {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    const err = new Error('Invalid YouPI base URL');
    err.status = 400;
    throw err;
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    const err = new Error('YouPI base URL must be http(s)');
    err.status = 400;
    throw err;
  }

  const existing = queryOne("SELECT key FROM system_config WHERE key = 'youpi_base_url'");
  if (existing) {
    execute("UPDATE system_config SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE key = 'youpi_base_url'", [parsed.origin]);
  } else {
    execute("INSERT INTO system_config (key, value, updated_at) VALUES ('youpi_base_url', ?, CURRENT_TIMESTAMP)", [parsed.origin]);
  }

  logAccess({
    userId: adminId,
    action: 'youpi_base_url_updated',
    resource: `/api/superadmin/gateway/config (youpi_base_url: ${parsed.origin})`,
    ipAddress
  });

  return { base_url: parsed.origin };
}

export function buildCheckoutUrl(baseUrl, paymentId) {
  return `${baseUrl}/checkout/${paymentId}`;
}

/**
 * Creates a YouPI payment session for collecting revenue.
 * @param {{orderId: string, amountRupees: number|string, description?: string, customerName?: string, metadata?: object, idempotencyKey?: string}} input
 */
export async function createYoupiPayment({ orderId, amountRupees, description, customerName, metadata, idempotencyKey }) {
  const { baseUrl, merchantKey } = getYoupiConnection();

  const amount = Number(amountRupees);
  if (!Number.isFinite(amount) || amount <= 0) {
    const err = new Error('Collection amount must be a positive number');
    err.status = 400;
    throw err;
  }

  const body = {
    orderId: String(orderId),
    amount: amount.toFixed(2),
    currency: 'INR',
    description: description || `Mahi Tech Group collection ${orderId}`,
    metadata: metadata || {}
  };
  if (customerName) {
    body.customer = { name: String(customerName).slice(0, 100) };
  }

  const headers = {
    'Content-Type': 'application/json',
    'X-Merchant-Key': merchantKey
  };
  if (idempotencyKey) {
    headers['Idempotency-Key'] = String(idempotencyKey);
  }

  let res;
  try {
    res = await fetch(`${baseUrl}/api/v1/payments`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000)
    });
  } catch (e) {
    const err = new Error(`YouPI gateway unreachable at ${baseUrl}: ${e.message}`);
    err.status = 502;
    throw err;
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.paymentId) {
    const err = new Error(`YouPI createPayment failed (HTTP ${res.status}): ${data.error || 'unknown error'}`);
    err.status = 502;
    throw err;
  }

  return {
    paymentId: data.paymentId,
    orderId: data.orderId || String(orderId),
    amount: data.amount || amount.toFixed(2),
    status: data.status,
    checkoutUrl: data.checkoutUrl || buildCheckoutUrl(baseUrl, data.paymentId)
  };
}

/**
 * Fetches the live status of a YouPI payment session.
 */
export async function getYoupiPaymentStatus(paymentId) {
  const { baseUrl, merchantKey } = getYoupiConnection();

  let res;
  try {
    res = await fetch(`${baseUrl}/api/v1/payments/${encodeURIComponent(paymentId)}`, {
      method: 'GET',
      headers: { 'X-Merchant-Key': merchantKey },
      signal: AbortSignal.timeout(10_000)
    });
  } catch (e) {
    const err = new Error(`YouPI gateway unreachable at ${baseUrl}: ${e.message}`);
    err.status = 502;
    throw err;
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`YouPI status check failed (HTTP ${res.status}): ${data.error || 'unknown error'}`);
    err.status = 502;
    throw err;
  }
  return data;
}

/**
 * Maps a YouPI payment status to the local payment_collections status.
 * YouPI reports VERIFIED (bank-observed success) / FAILED / EXPIRED / CANCELLED.
 */
export function mapYoupiStatusToCollection(youpiStatus) {
  const s = String(youpiStatus || '').toUpperCase();
  if (s === 'VERIFIED' || s === 'SUCCESS' || s === 'PAID') return 'PAID';
  if (s === 'FAILED') return 'FAILED';
  if (s === 'EXPIRED') return 'EXPIRED';
  if (s === 'CANCELLED' || s === 'CANCELED') return 'CANCELLED';
  return 'CREATED';
}

/**
 * Verifies a YouPI webhook request signature.
 * YouPI sends BOTH:
 *   X-Gateway-Signature:    sha256=HMAC(payload, webhookSecret)
 *   X-Gateway-Signature-V2: sha256=HMAC("timestamp.payload", webhookSecret)
 * V2 is preferred (replay-resistant); V1 is accepted for compatibility.
 */
export function verifyYoupiWebhook({ rawBody, signatureV2, timestamp, signatureV1 }) {
  const secret = getDecryptedGatewaySecrets().webhook_secret;
  if (!secret) {
    return { valid: false, reason: 'Webhook secret is not configured on this platform' };
  }
  if (!rawBody) {
    return { valid: false, reason: 'Empty webhook body' };
  }

  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody), 'utf8');

  const safeEqualHex = (providedSig, computedHex) => {
    const provided = String(providedSig || '').replace(/^sha256=/, '').trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(provided)) return false;
    const a = Buffer.from(provided, 'hex');
    const b = Buffer.from(computedHex, 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  };

  if (signatureV2 && timestamp) {
    const computedV2 = crypto.createHmac('sha256', secret).update(`${timestamp}.`).update(body).digest('hex');
    if (safeEqualHex(signatureV2, computedV2)) return { valid: true, scheme: 'v2' };
    return { valid: false, reason: 'Invalid X-Gateway-Signature-V2' };
  }

  if (signatureV1) {
    const computedV1 = crypto.createHmac('sha256', secret).update(body).digest('hex');
    if (safeEqualHex(signatureV1, computedV1)) return { valid: true, scheme: 'v1' };
    return { valid: false, reason: 'Invalid X-Gateway-Signature' };
  }

  return { valid: false, reason: 'Missing signature headers' };
}

/**
 * Connectivity check used by the Super Admin gateway test endpoint.
 */
export async function testYoupiConnection() {
  const gw = getGatewayConfig();
  const secrets = getDecryptedGatewaySecrets();
  const baseUrl = getYoupiBaseUrl().replace(/\/+$/, '');
  const started = Date.now();

  const result = {
    success: false,
    gateway: 'youpi',
    gateway_name: gw.gateway_name,
    mode: gw.mode,
    base_url: baseUrl,
    latency_ms: 0,
    timestamp: new Date().toISOString()
  };

  if (!secrets.api_key) {
    result.note = 'Gateway not configured: set the merchant API key in Super Admin → Gateway Config.';
    return result;
  }

  try {
    // Deliberately invalid payment id: a 401/404 from YouPI still proves the
    // gateway is up and the merchant key was presented.
    const res = await fetch(`${baseUrl}/api/v1/payments/00000000-0000-0000-0000-000000000000`, {
      method: 'GET',
      headers: { 'X-Merchant-Key': secrets.api_key },
      signal: AbortSignal.timeout(8_000)
    });
    result.http_status = res.status;
    result.latency_ms = Date.now() - started;
    result.success = res.status < 500;
    result.note = 'Gateway reachable. Any 2xx/4xx response confirms connectivity.';
  } catch (e) {
    result.latency_ms = Date.now() - started;
    result.error = e.message;
    result.note = `Gateway unreachable at ${baseUrl}.`;
  }
  return result;
}
