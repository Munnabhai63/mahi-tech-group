import express from 'express';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { queryOne, execute } from '../db/database.js';
import { config } from '../config.js';
import { authenticate } from '../middleware/auth.js';
import { logAccess } from '../services/auditService.js';
import { loginLimiter, signupLimiter } from '../middleware/rateLimiter.js';
import { issueWsTicket } from '../services/wsService.js';
import { getActiveDocuments, signDocument } from '../services/legalService.js';

const router = express.Router();

// 0. POST /api/auth/signup (Public with Rate Limiting)
router.post('/signup', signupLimiter, async (req, res) => {
  const { name, email, password, phone_number, desired_role, desired_sub_role, legal_typed_name, legal_accepted_doc_ids } = req.body || {};
  const ipAddress = req.ip || req.socket.remoteAddress;

  if (!name || !email || !password || !desired_role) {
    return res.status(400).json({ error: 'Name, email, password, and desired_role are required' });
  }

  const validDesiredRoles = ['researcher', 'developer', 'producer', 'designer'];
  if (!validDesiredRoles.includes(desired_role)) {
    return res.status(400).json({
      error: `Invalid desired_role. Must be one of: ${validDesiredRoles.join(', ')}`
    });
  }

  if (desired_sub_role) {
    if (desired_role !== 'developer') {
      return res.status(400).json({
        error: "desired_sub_role can only be specified when desired_role is 'developer'. Must be null for other roles."
      });
    }
    if (!['frontend', 'backend'].includes(desired_sub_role)) {
      return res.status(400).json({
        error: "Invalid desired_sub_role. Must be 'frontend', 'backend', or null"
      });
    }
  }

  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters long' });
  }

  const normalizedEmail = email.toLowerCase().trim();
  const existing = queryOne('SELECT id, status FROM users WHERE email = ?', [normalizedEmail]);
  if (existing) {
    return res.status(409).json({ error: 'An account with this email already exists' });
  }

  // LEGAL GATE: when active legal documents exist, the application must carry
  // an electronic signature acceptance for every one of them (IT Act 2000 §3A)
  const activeLegalDocs = getActiveDocuments();
  if (activeLegalDocs.length > 0) {
    const acceptedIds = new Set(Array.isArray(legal_accepted_doc_ids) ? legal_accepted_doc_ids : []);
    const missing = activeLegalDocs.filter((d) => !acceptedIds.has(d.id)).map((d) => ({ id: d.id, doc_type: d.doc_type, title: d.title }));
    if (missing.length > 0) {
      return res.status(400).json({
        error: 'All legal documents must be read and accepted before applying',
        missing_documents: missing
      });
    }
    const typedOk = String(legal_typed_name || '').trim().toLowerCase() === name.trim().toLowerCase();
    if (!typedOk) {
      return res.status(400).json({ error: 'legal_typed_name must exactly match your full name to count as an electronic signature' });
    }
  }

  const passwordHash = await bcrypt.hash(password, config.BCRYPT_SALT_ROUNDS);
  const userId = crypto.randomUUID();

  execute(`
    INSERT INTO users (
      id, name, email, password_hash, phone_number,
      desired_role, desired_sub_role, role, sub_role, status,
      rating_avg, idea_quota_used, quota_reset_date, wallet_balance,
      wallet_frozen, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, 'pending', 0.0, 0, null, 0.0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `, [
    userId,
    name.trim(),
    normalizedEmail,
    passwordHash,
    phone_number ? phone_number.trim() : null,
    desired_role,
    desired_sub_role || null
  ]);

  logAccess({
    userId,
    action: 'signup_submitted',
    resource: `/api/auth/signup (desired_role: ${desired_role})`,
    ipAddress
  });

  // Record the electronic signature for every active legal document
  let legalSigned = 0;
  for (const doc of activeLegalDocs) {
    try {
      signDocument({ documentId: doc.id, userId, typedName: legal_typed_name, ipAddress });
      legalSigned++;
    } catch (e) {
      console.error('[SIGNUP LEGAL SIGN] failed for doc', doc.id, e.message);
    }
  }

  return res.status(201).json({
    message: 'Application submitted successfully. Your account is pending Administrator approval.',
    status: 'pending',
    legal_documents_signed: legalSigned,
    user: {
      id: userId,
      name: name.trim(),
      email: normalizedEmail,
      phone_number: phone_number ? phone_number.trim() : null,
      desired_role,
      desired_sub_role: desired_sub_role || null,
      status: 'pending'
    }
  });
});

// 1. POST /api/auth/login (Public with Rate Limiting)

// Equalizes bcrypt cost for unknown emails so response timing cannot reveal whether an account exists
const DUMMY_PASSWORD_HASH = bcrypt.hashSync('timing-equalizer-placeholder', config.BCRYPT_SALT_ROUNDS);

// Parses JWT_EXPIRES_IN style durations ("30m", "12h", "7d") to milliseconds
function parseDurationToMs(value, fallbackMs) {
  const match = /^(\d+)\s*([smhd])$/.exec(String(value || '').trim());
  if (!match) return fallbackMs;
  const units = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return Number(match[1]) * units[match[2]];
}
const SESSION_TTL_MS = parseDurationToMs(config.JWT_EXPIRES_IN, 7 * 24 * 60 * 60 * 1000);

router.post('/login', loginLimiter, async (req, res) => {
  const { email, password } = req.body || {};
  const ipAddress = req.ip || req.socket.remoteAddress;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const user = queryOne('SELECT * FROM users WHERE email = ?', [email.toLowerCase().trim()]);
  if (!user) {
    await bcrypt.compare(password, DUMMY_PASSWORD_HASH);
    logAccess({ action: 'login_failed_user_not_found', resource: '/api/auth/login', ipAddress });
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const isPasswordValid = await bcrypt.compare(password, user.password_hash);
  if (!isPasswordValid) {
    logAccess({ userId: user.id, action: 'login_failed_invalid_password', resource: '/api/auth/login', ipAddress });
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  // Check account lifecycle status (Pending, Rejected, Inactive, Suspended)
  if (user.status === 'pending') {
    logAccess({ userId: user.id, action: 'login_blocked_pending_approval', resource: '/api/auth/login', ipAddress });
    return res.status(403).json({
      error: 'Account Pending Approval',
      message: 'Your registration is currently under review by Admin. You will receive access once approved.'
    });
  }

  if (user.status === 'rejected') {
    logAccess({ userId: user.id, action: 'login_blocked_application_denied', resource: '/api/auth/login', ipAddress });
    return res.status(403).json({
      error: 'Application Denied',
      message: 'Your membership application was not approved.'
    });
  }

  if (user.status === 'inactive' || user.status === 'suspended') {
    logAccess({ userId: user.id, action: 'login_blocked_access_revoked', resource: '/api/auth/login', ipAddress });
    return res.status(403).json({ error: 'Access Revoked' });
  }

  const sessionId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  const token = jwt.sign(
    { userId: user.id, sessionId, role: user.role, email: user.email },
    config.JWT_SECRET,
    { expiresIn: config.JWT_EXPIRES_IN }
  );

  const deviceInfo = req.headers['user-agent'] || 'Unknown Device';

  // Only a SHA-256 digest of the JWT is persisted — a database leak must not
  // expose usable session tokens.
  const tokenDigest = crypto.createHash('sha256').update(token).digest('hex');

  execute(
    `INSERT INTO sessions (id, user_id, token, device_info, ip_address, created_at, expires_at, is_revoked)
     VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, 0)`,
    [sessionId, user.id, tokenDigest, deviceInfo, ipAddress, expiresAt]
  );

  logAccess({ userId: user.id, action: 'login', resource: '/api/auth/login', ipAddress });

  return res.status(200).json({
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      phone_number: user.phone_number,
      role: user.role,
      sub_role: user.sub_role,
      desired_role: user.desired_role,
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

  const newExpiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  const newToken = jwt.sign(
    { userId: user.id, sessionId: session.id, role: user.role, email: user.email },
    config.JWT_SECRET,
    { expiresIn: config.JWT_EXPIRES_IN }
  );

  const newTokenDigest = crypto.createHash('sha256').update(newToken).digest('hex');
  execute('UPDATE sessions SET token = ?, expires_at = ? WHERE id = ?', [
    newTokenDigest,
    newExpiresAt,
    session.id
  ]);

  logAccess({ userId: user.id, action: 'token_refresh', resource: '/api/auth/refresh', ipAddress });

  return res.status(200).json({ token: newToken });
});

// 4. POST /api/auth/ws-ticket (Authenticated)
// Issues a single-use 30-second ticket for WebSocket connection so the JWT
// is never placed in the connection URL (proxy/access log exposure).
router.post('/ws-ticket', authenticate, (req, res) => {
  const { ticket, expiresInMs } = issueWsTicket(req.user.id, req.session.id);
  return res.status(201).json({ ticket, expires_in_ms: expiresInMs });
});

export default router;
