import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isProduction = process.env.NODE_ENV === 'production';

/**
 * Secrets are never hardcoded. In production the process refuses to start
 * without an explicit environment value; in development an ephemeral random
 * value is generated per boot (tokens/encrypted data do not survive restarts).
 */
function resolveSecret(name, value) {
  if (value && value.length >= 16) return value;
  if (value && value.length < 16) {
    console.warn(`[CONFIG] WARNING: ${name} is shorter than 16 chars — refused. Generating ephemeral secret instead.`);
  }
  if (isProduction) {
    console.error(`[CONFIG] FATAL: ${name} environment variable is required (min 16 chars) in production. Aborting.`);
    process.exit(1);
  }
  console.warn(
    `[CONFIG] WARNING: ${name} not set — using an ephemeral random secret. ` +
    `Sessions and encrypted gateway credentials will NOT survive a restart. Set ${name} in the environment.`
  );
  return crypto.randomBytes(32).toString('hex');
}

export const config = {
  PORT: process.env.PORT || 4000,
  JWT_SECRET: resolveSecret('JWT_SECRET', process.env.JWT_SECRET),
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '7d',
  DB_PATH: process.env.DB_PATH || path.join(__dirname, '../../database.sqlite'),
  BCRYPT_SALT_ROUNDS: Number(process.env.BCRYPT_SALT_ROUNDS) || 12,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',
  ENCRYPTION_KEY: resolveSecret('ENCRYPTION_KEY', process.env.ENCRYPTION_KEY),
  // Comma-separated list of allowed cross-origin URLs. Empty = same-origin only (recommended).
  CORS_ORIGIN: process.env.CORS_ORIGIN || '',
  // Set to 'true' only when running behind a reverse proxy so req.ip is resolved correctly.
  TRUST_PROXY: process.env.TRUST_PROXY === 'true'
};
