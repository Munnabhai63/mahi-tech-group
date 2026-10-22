import crypto from 'node:crypto';
import { execute } from '../db/database.js';

export function logAccess({ userId = null, action, resource = null, ipAddress = null }) {
  try {
    const id = crypto.randomUUID();
    execute(
      'INSERT INTO access_log (id, user_id, action, resource, ip_address, timestamp) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)',
      [id, userId, action, resource, ipAddress]
    );
  } catch (err) {
    console.error('Failed to write access log:', err);
  }
}
