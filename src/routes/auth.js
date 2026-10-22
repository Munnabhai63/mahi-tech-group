import express from 'express';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { queryOne, execute } from '../db/database.js';
import { config } from '../config.js';
import { authenticate } from '../middleware/auth.js';
import { logAccess } from '../services/auditService.js';

const router = express.Router();

// 1. POST /api/auth/login (Public)
router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  const ipAddress = req.ip || req.socket.remoteAddress;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const user = queryOne('SELECT * FROM users WHERE email = ?', [email.toLowerCase().trim()]);
  if (!user) {
    logAccess({ action: 'login_failed_user_not_found', resource: '/api/auth/login', ipAddress });
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const isPasswordValid = await bcrypt.compare(password, user.password_hash);
  if (!isPasswordValid) {
    logAccess({ userId: user.id, action: 'login_failed_invalid_password', resource: '/api/auth/login', ipAddress });
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  // Check account lifecycle status (Section 4.2: inactive or suspended -> LOGIN BLOCKED)
  if (user.status === 'inactive' || user.status === 'suspended') {
    logAccess({ userId: user.id, action: 'login_blocked_access_revoked', resource: '/api/auth/login', ipAddress });
    return res.status(403).json({ error: 'Access Revoked' });
  }

  const sessionId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const token = jwt.sign(
    { userId: user.id, sessionId, role: user.role, email: user.email },
    config.JWT_SECRET,
    { expiresIn: config.JWT_EXPIRES_IN }
  );

  const deviceInfo = req.headers['user-agent'] || 'Unknown Device';

  execute(
    `INSERT INTO sessions (id, user_id, token, device_info, ip_address, created_at, expires_at, is_revoked)
     VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, 0)`,
    [sessionId, user.id, token, deviceInfo, ipAddress, expiresAt]
  );

  logAccess({ userId: user.id, action: 'login', resource: '/api/auth/login', ipAddress });

  return res.status(200).json({
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      sub_role: user.sub_role,
      status: user.status
    }
  });
});

// 2. POST /api/auth/logout (Authenticated)
router.post('/logout', authenticate, (req, res) => {
  const ipAddress = req.ip || req.socket.remoteAddress;

  execute('UPDATE sessions SET is_revoked = 1 WHERE id = ?', [req.session.id]);

  logAccess({ userId: req.user.id, action: 'logout', resource: '/api/auth/logout', ipAddress });

  return res.status(200).json({ message: 'Logged out successfully' });
});

// 3. POST /api/auth/refresh (Authenticated)
router.post('/refresh', authenticate, (req, res) => {
  const ipAddress = req.ip || req.socket.remoteAddress;
  const user = req.user;
  const session = req.session;

  const newExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const newToken = jwt.sign(
    { userId: user.id, sessionId: session.id, role: user.role, email: user.email },
    config.JWT_SECRET,
    { expiresIn: config.JWT_EXPIRES_IN }
  );

  execute('UPDATE sessions SET token = ?, expires_at = ? WHERE id = ?', [
    newToken,
    newExpiresAt,
    session.id
  ]);

  logAccess({ userId: user.id, action: 'token_refresh', resource: '/api/auth/refresh', ipAddress });

  return res.status(200).json({ token: newToken });
});

export default router;
