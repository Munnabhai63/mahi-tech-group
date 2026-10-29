import express from 'express';
import { execute, queryOne, queryAll } from '../db/database.js';
import { authenticate } from '../middleware/auth.js';
import { logAccess } from '../services/auditService.js';

const router = express.Router();

/**
 * POST /api/mobile/device-token & POST /api/device/token/register
 * Upsert push notification device token for authenticated user
 */
router.post(['/device-token', '/token/register'], authenticate, (req, res) => {
  const ipAddress = req.ip || req.socket.remoteAddress;
  const {
    fcm_token,
    token,
    device_type = 'ANDROID',
    platform = 'ANDROID',
    device_id
  } = req.body || {};

  const effectiveToken = token || fcm_token;
  if (!effectiveToken) {
    return res.status(400).json({ error: 'fcm_token or token is required' });
  }

  const effectiveDeviceId = device_id || `device-${req.user.id.substring(0, 8)}`;
  const effectivePlatform = (platform || device_type || 'ANDROID').toUpperCase();

  execute(`
    INSERT INTO device_tokens (
      user_id, platform, token, fcm_token, device_type, device_id, is_active, last_seen_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 1, datetime('now'), datetime('now'))
    ON CONFLICT(user_id, device_id) DO UPDATE SET
      token = excluded.token,
      fcm_token = excluded.fcm_token,
      platform = excluded.platform,
      device_type = excluded.device_type,
      is_active = 1,
      last_seen_at = datetime('now'),
      updated_at = datetime('now')
  `, [
    req.user.id,
    effectivePlatform,
    effectiveToken,
    effectiveToken,
    effectivePlatform,
    effectiveDeviceId
  ]);

  logAccess({
    userId: req.user.id,
    action: 'fcm_device_token_registered',
    resource: req.originalUrl,
    ipAddress
  });

  const record = queryOne(
    'SELECT id, user_id, platform, token, is_active, device_id, updated_at FROM device_tokens WHERE user_id = ? AND device_id = ?',
    [req.user.id, effectiveDeviceId]
  );

  return res.status(200).json({
    success: true,
    message: 'Device token registered successfully',
    deviceToken: record
  });
});

/**
 * DELETE /api/mobile/device-token, DELETE /api/device/token/unregister, POST /api/mobile/device-token/unregister
 * Deactivate push notification device token on logout
 */
const unregisterHandler = (req, res) => {
  const ipAddress = req.ip || req.socket.remoteAddress;
  const { device_id } = req.body || {};

  if (device_id) {
    execute(
      "UPDATE device_tokens SET is_active = 0, updated_at = datetime('now') WHERE user_id = ? AND device_id = ?",
      [req.user.id, device_id]
    );
  } else {
    execute(
      "UPDATE device_tokens SET is_active = 0, updated_at = datetime('now') WHERE user_id = ?",
      [req.user.id]
    );
  }

  logAccess({
    userId: req.user.id,
    action: 'fcm_device_token_unregistered',
    resource: req.originalUrl,
    ipAddress
  });

  return res.status(200).json({
    success: true,
    message: 'Device token unregistered successfully'
  });
};

router.delete(['/device-token', '/token/unregister'], authenticate, unregisterHandler);
router.post(['/device-token/unregister', '/token/unregister'], authenticate, unregisterHandler);

export default router;
