import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { queryOne, execute } from '../src/db/database.js';
import { config } from '../src/config.js';

const admin = queryOne("SELECT id, name, email, role FROM users WHERE role = 'admin' LIMIT 1");
const sessionId = crypto.randomUUID();
const token = jwt.sign(
  { sessionId, userId: admin.id, role: admin.role, email: admin.email, name: admin.name },
  config.JWT_SECRET,
  { expiresIn: '7d' }
);
execute(`
  INSERT INTO sessions (id, user_id, token, device_info, ip_address, created_at, expires_at, is_revoked)
  VALUES (?, ?, ?, 'Direct Browser Login', '127.0.0.1', datetime('now'), datetime('now', '+7 days'), 0)
`, [sessionId, admin.id, token]);

console.log('ADMIN_TOKEN:' + token);
