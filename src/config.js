import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const config = {
  PORT: process.env.PORT || 4000,
  JWT_SECRET: process.env.JWT_SECRET || 'mahi-tech-group-secure-jwt-secret-key-2026-production',
  JWT_EXPIRES_IN: '7d',
  CLIENT_JWT_SECRET: process.env.CLIENT_JWT_SECRET || (process.env.NODE_ENV === 'production' ? (() => { throw new Error('CLIENT_JWT_SECRET env var is required in production'); })() : 'dev-insecure-client-jwt-secret-local-only'),
  CLIENT_JWT_EXPIRES_IN: '7d',
  DB_PATH: process.env.DB_PATH || path.join(__dirname, '../../database.sqlite'),
  BCRYPT_SALT_ROUNDS: 12,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',
  ENCRYPTION_KEY: process.env.ENCRYPTION_KEY || 'mahi-tech-group-aes-256-gcm-master-key-2026'
};

if (!process.env.ENCRYPTION_KEY) {
  process.env.ENCRYPTION_KEY = config.ENCRYPTION_KEY;
}

if (!process.env.CLIENT_JWT_SECRET && process.env.NODE_ENV !== 'production') {
  console.warn('WARNING: CLIENT_JWT_SECRET not set, using insecure default for non-production environment');
}
