import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const config = {
  PORT: process.env.PORT || 4000,
  JWT_SECRET: process.env.JWT_SECRET || 'mahi-tech-group-secure-jwt-secret-key-2026-production',
  JWT_EXPIRES_IN: '7d',
  DB_PATH: process.env.DB_PATH || path.join(__dirname, '../../database.sqlite'),
  BCRYPT_SALT_ROUNDS: 12,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || ''
};
