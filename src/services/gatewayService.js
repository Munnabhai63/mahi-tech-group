import crypto from 'node:crypto';
import { queryOne, execute } from '../db/database.js';
import { logAccess } from './auditService.js';
import { config } from '../config.js';

/**
 * MAHI TECH GROUP — PAYMENT GATEWAY CONFIGURATION SERVICE (STEP 14 LAYER 5)
 * Secure AES-256-GCM encryption, auto-approval hard-block, and connection diagnostics.
 */

/**
 * Derives a 32-byte cryptographic key for AES-256-GCM.
 * Refuses to run if no ENCRYPTION_KEY was resolved at boot (config guarantees
 * a production abort when the environment variable is missing).
 */
export function getEncryptionKey() {
  const key = config.ENCRYPTION_KEY;
  if (!key) {
    throw new Error('Startup Error: ENCRYPTION_KEY is not set. Refusing to run.');
  }
  return crypto.createHash('sha256').update(String(key)).digest();
}

/**
 * AES-256-GCM Encryption
 * Output format: iv:authTag:encryptedData (colon-separated hex strings)
 */
export function encrypt(plaintext) {
  if (!plaintext) return null;
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12); // Standard 96-bit IV for AES-GCM
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');

  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

/**
 * AES-256-GCM Decryption
 */
export function decrypt(encryptedStr) {
  if (!encryptedStr) return null;
  const parts = encryptedStr.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted format. Expected iv:authTag:ciphertext');
  }
  const [ivHex, authTagHex, encryptedHex] = parts;
  const key = getEncryptionKey();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));

  let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

/**
 * Retrieve current Payment Gateway Config.
 * MANDATORY SECURITY GUARANTEE:
 * api_key_encrypted and webhook_secret_encrypted are NEVER selected or returned in plaintext.
 */
export function getGatewayConfig() {  const row = queryOne(`
    SELECT id, mode, gateway_name, auto_approve_below,
           (api_key_encrypted IS NOT NULL AND api_key_encrypted != '') as api_key_set,
           (webhook_secret_encrypted IS NOT NULL AND webhook_secret_encrypted != '') as webhook_secret_set,
           created_at, updated_at
    FROM payment_gateway_config
    ORDER BY created_at ASC
    LIMIT 1
  `);

  if (!row) {
    const newId = crypto.randomUUID();
    execute(`
      INSERT INTO payment_gateway_config (
        id, mode, gateway_name, api_key_encrypted, webhook_secret_encrypted, auto_approve_below, created_at, updated_at
      ) VALUES (?, 'sandbox', 'SIMULATED_GATEWAY_STUB', NULL, NULL, 0, datetime('now'), datetime('now'))
    `, [newId]);

    return {
      id: newId,
      mode: 'sandbox',
      gateway_name: 'SIMULATED_GATEWAY_STUB',
      auto_approve_below: 0,
      api_key_set: false,
      webhook_secret_set: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
  }

  return {
    id: row.id,
    mode: row.mode,
    gateway_name: row.gateway_name,
    auto_approve_below: Number(row.auto_approve_below),
    api_key_set: Boolean(row.api_key_set),
    webhook_secret_set: Boolean(row.webhook_secret_set),
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

/**
 * Server-side decrypted secrets for gateway API calls and webhook verification.
 * NEVER expose these through any HTTP response — internal service use only.
 */
export function getDecryptedGatewaySecrets() {
  const row = queryOne(`
    SELECT api_key_encrypted, webhook_secret_encrypted
    FROM payment_gateway_config
    ORDER BY created_at ASC
    LIMIT 1
  `);
  if (!row) {
    return { api_key: null, webhook_secret: null };
  }
  return {
    api_key: row.api_key_encrypted ? decrypt(row.api_key_encrypted) : null,
    webhook_secret: row.webhook_secret_encrypted ? decrypt(row.webhook_secret_encrypted) : null
  };
}

/**
 * Update Payment Gateway Config.
 * Non-negotiable policy: auto_approve_below > 0 is permanently rejected with HTTP 400.
 */
export function updateGatewayConfig({ mode, gateway_name, api_key, webhook_secret, auto_approve_below }, adminId, ipAddress = '127.0.0.1') {
  // HARD RULE — auto_approve_below is PERMANENTLY DISABLED
  if (auto_approve_below !== undefined && Number(auto_approve_below) > 0) {
    const err = new Error('Auto-approval is permanently disabled by policy');
    err.status = 400;
    throw err;
  }

  if (mode && !['sandbox', 'live'].includes(mode)) {
    const err = new Error("Invalid mode. Must be 'sandbox' or 'live'");
    err.status = 400;
    throw err;
  }

  // Ensure config row exists
  const current = getGatewayConfig();

  let encryptedApiKey = undefined;
  if (api_key !== undefined) {
    encryptedApiKey = api_key ? encrypt(api_key.trim()) : null;
  }

  let encryptedWebhook = undefined;
  if (webhook_secret !== undefined) {
    encryptedWebhook = webhook_secret ? encrypt(webhook_secret.trim()) : null;
  }

  execute(`
    UPDATE payment_gateway_config
    SET mode = COALESCE(?, mode),
        gateway_name = COALESCE(?, gateway_name),
        api_key_encrypted = CASE WHEN ? IS NOT NULL THEN ? ELSE api_key_encrypted END,
        webhook_secret_encrypted = CASE WHEN ? IS NOT NULL THEN ? ELSE webhook_secret_encrypted END,
        auto_approve_below = 0,
        updated_at = datetime('now')
    WHERE id = ?
  `, [
    mode || null,
    gateway_name || null,
    encryptedApiKey !== undefined ? 1 : null,
    encryptedApiKey !== undefined ? encryptedApiKey : null,
    encryptedWebhook !== undefined ? 1 : null,
    encryptedWebhook !== undefined ? encryptedWebhook : null,
    current.id
  ]);

  logAccess({
    userId: adminId,
    targetId: current.id,
    action: 'superadmin_gateway_config_update',
    resource: `/api/superadmin/gateway/config (mode: ${mode || current.mode})`,
    ipAddress
  });

  return getGatewayConfig();
}

/**
 * Simulates a gateway ping diagnostic (SIMULATED_GATEWAY_STUB only).
 * Does not make external HTTP network calls.
 */
export function testGatewayConnection(adminId, ipAddress = '127.0.0.1') {
  const current = getGatewayConfig();
  const latency_ms = Math.floor(Math.random() * 25) + 15; // 15ms - 40ms simulated latency

  logAccess({
    userId: adminId,
    targetId: current.id,
    action: 'superadmin_gateway_test',
    resource: '/api/superadmin/gateway/test',
    ipAddress
  });

  return {
    success: true,
    latency_ms,
    mode: current.mode,
    timestamp: new Date().toISOString()
  };
}
