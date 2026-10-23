import crypto from 'node:crypto';
import { execute } from '../db/database.js';

export function logAccess({ userId = null, action, resource = null, ipAddress = null, targetId = null, target_id = null }) {
  try {
    const id = crypto.randomUUID();
    const finalTargetId = targetId || target_id || null;
    try {
      execute(
        'INSERT INTO access_log (id, user_id, action, resource, ip_address, timestamp, target_id, created_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, CURRENT_TIMESTAMP)',
        [id, userId, action, resource, ipAddress, finalTargetId]
      );
    } catch (innerErr) {
      // Fallback if target_id or created_at column is not yet present
      execute(
        'INSERT INTO access_log (id, user_id, action, resource, ip_address, timestamp) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)',
        [id, userId, action, resource, ipAddress]
      );
    }
  } catch (err) {
    console.error('Failed to write access log:', err);
  }
}
