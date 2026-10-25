import express from 'express';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { queryOne, queryAll, execute } from '../db/database.js';
import { config } from '../config.js';
import { authenticate } from '../middleware/auth.js';
import { logAccess } from '../services/auditService.js';
import { loginLimiter, signupLimiter } from '../middleware/rateLimiter.js';
import { issueWsTicket } from '../services/wsService.js';
import { getActiveDocuments, signDocument } from '../services/legalService.js';
import { emailService } from '../services/emailService.js';
import { generateTotpSecret, verifyTotp, otpauthUrl } from '../services/totpService.js';
import { createNotification } from '../services/notificationService.js';

const router = express.Router();

// 0. POST /api/auth/signup (Public with Rate Limiting)
router.post('/signup', signupLimiter, async (req, res) => {
  const { name, email, password, phone_number, desired_role, desired_sub_role, legal_typed_name, legal_accepted_doc_ids, github_username } = req.body || {};
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
      wallet_frozen, github_username, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, 'pending', 0.0, 0, null, 0.0, 0, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `, [
    userId,
    name.trim(),
    normalizedEmail,
    passwordHash,
    phone_number ? phone_number.trim() : null,
    desired_role,
    desired_sub_role || null,
    (typeof github_username === 'string' && github_username.trim()) ? github_username.trim() : null
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

  // EMAIL VERIFICATION: link valid 24h; the Admin's approval gate requires it
  const verifyToken = crypto.randomBytes(32).toString('hex');
  const signupVerifyExpiresAt = new Date(Date.now() + VERIFY_TTL_HOURS * 60 * 60 * 1000).toISOString();
  execute(`
    INSERT INTO email_verifications (id, user_id, token, expires_at, created_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
  `, [crypto.randomUUID(), userId, verifyToken, signupVerifyExpiresAt]);

  let devVerifyUrl;
  try {
    const verifyUrl = `${appBaseUrl(req)}/api/auth/verify-email?token=${verifyToken}`;
    const mail = await emailService.sendEmail({
      to: normalizedEmail,
      subject: 'Verify your email — Mahi Tech Group application',
      text: `Hello ${name.trim()},\n\nYour application is in. Verify your email so the Administrator can approve it (link valid ${VERIFY_TTL_HOURS} hours):\n${verifyUrl}\n\n— Mahi Tech Group`,
      userId
    });
    if (process.env.NODE_ENV !== 'production' && !mail.delivered) devVerifyUrl = verifyUrl;
  } catch (e) {
    console.error('[SIGNUP VERIFY EMAIL] dispatch failed:', e.message);
  }

  return res.status(201).json({
    message: 'Application submitted successfully. Your account is pending Administrator approval.',
    status: 'pending',
    legal_documents_signed: legalSigned,
    email_verification_sent: true,
    ...(devVerifyUrl ? { dev_verify_url: devVerifyUrl } : {}),
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
    recordFailedLogin(user.email);
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  // 2FA: if enabled, a valid TOTP code is mandatory
  if (user.totp_enabled) {
    const code = String((req.body || {}).totp_code || '').trim();
    if (!code) {
      return res.status(401).json({ error: '2FA code required', requires_2fa: true });
    }
    if (!verifyTotp(user.totp_secret, code)) {
      logAccess({ userId: user.id, action: 'login_failed_2fa', resource: '/api/auth/login', ipAddress });
      return res.status(401).json({ error: 'Invalid 2FA code', requires_2fa: true });
    }
  }

  checkLoginAnomaly(user, ipAddress);

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

// ===================================================================
// AUTH UX: self-serve password reset + email verification
// ===================================================================

const RESET_TTL_MINUTES = 30;
const VERIFY_TTL_HOURS = 24;

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function appBaseUrl(req) {
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.headers['x-forwarded-host'] || req.get('host') || `127.0.0.1:${config.PORT}`;
  return `${proto}://${host}`;
}

// 5. POST /api/auth/forgot-password (Public, rate-limited)
// Always responds 200 — response never reveals whether the account exists.
router.post('/forgot-password', loginLimiter, async (req, res) => {
  const { email } = req.body || {};
  const generic = {
    message: 'If that email belongs to a registered member, a password reset link has been sent.'
  };
  if (!email) return res.status(200).json(generic);

  const user = queryOne('SELECT id, name, email, status FROM users WHERE email = ?', [email.toLowerCase().trim()]);
  if (!user || user.status === 'inactive' || user.status === 'suspended') {
    return res.status(200).json(generic);
  }

  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + RESET_TTL_MINUTES * 60 * 1000).toISOString();
  execute(`
    INSERT INTO password_resets (id, user_id, token_hash, ip_address, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `, [crypto.randomUUID(), user.id, sha256(token), req.ip || req.socket.remoteAddress, expiresAt]);

  const resetUrl = `${appBaseUrl(req)}/reset-password.html?token=${token}`;
  try {
    const mail = await emailService.sendEmail({
      to: user.email,
      subject: 'Reset your Mahi Tech Group password',
      text: `Hello ${user.name},\n\nUse this link within ${RESET_TTL_MINUTES} minutes to set a new password:\n${resetUrl}\n\nIf you did not request this, ignore this email — your current password keeps working.\n\n— Mahi Tech Group`,
      userId: user.id
    });
    // Dev convenience (never in production): SMTP is usually unconfigured locally,
    // so surface the link directly instead of a dead end.
    const devResetUrl = (process.env.NODE_ENV !== 'production' && !mail.delivered) ? resetUrl : undefined;
    return res.status(200).json({ ...generic, ...(devResetUrl ? { dev_reset_url: devResetUrl } : {}) });
  } catch (err) {
    console.error('[FORGOT PASSWORD] email dispatch failed:', err.message);
    return res.status(200).json(generic);
  }
});

// 6. POST /api/auth/reset-password (Public)
router.post('/reset-password', loginLimiter, async (req, res) => {
  const { token, password } = req.body || {};
  if (!token || !password) {
    return res.status(400).json({ error: 'Token and new password are required' });
  }
  if (String(password).length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters long' });
  }

  const row = queryOne(`
    SELECT pr.id, pr.user_id, pr.expires_at, pr.used_at, u.email, u.name
    FROM password_resets pr JOIN users u ON pr.user_id = u.id
    WHERE pr.token_hash = ?
    ORDER BY pr.created_at DESC LIMIT 1
  `, [sha256(token)]);

  if (!row || row.used_at || new Date(row.expires_at) <= new Date()) {
    return res.status(400).json({ error: 'Reset link is invalid or has expired. Request a new one.' });
  }

  const passwordHash = await bcrypt.hash(password, config.BCRYPT_SALT_ROUNDS);
  execute('UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [passwordHash, row.user_id]);
  execute('UPDATE password_resets SET used_at = CURRENT_TIMESTAMP WHERE id = ?', [row.id]);
  // Security: kill every existing session of this account
  execute('UPDATE sessions SET is_revoked = 1 WHERE user_id = ?', [row.user_id]);

  logAccess({ userId: row.user_id, action: 'password_reset_completed', resource: '/api/auth/reset-password', ipAddress: req.ip });
  try {
    await emailService.sendEmail({
      to: row.email,
      subject: 'Your Mahi Tech Group password was changed',
      text: `Hello ${row.name},\n\nYour password was just changed. All active sessions were signed out.\nIf this wasn't you, contact the Administrator immediately.\n\n— Mahi Tech Group`,
      userId: row.user_id
    });
  } catch (e) { /* best-effort notification */ }

  return res.status(200).json({ message: 'Password updated successfully. Sign in with your new password.' });
});

// 7. GET /api/auth/verify-email?token=... (Public — email link target)
router.get('/verify-email', (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).json({ error: 'Verification token is required' });

  const row = queryOne(`
    SELECT ev.id, ev.expires_at, ev.verified_at, u.email
    FROM email_verifications ev JOIN users u ON ev.user_id = u.id
    WHERE ev.token = ? ORDER BY ev.created_at DESC LIMIT 1
  `, [String(token)]);

  if (!row) return res.status(400).json({ error: 'Invalid verification link' });
  if (row.verified_at) return res.status(200).json({ message: 'Email already verified. You can sign in once approved.', email: row.email });
  if (new Date(row.expires_at) <= new Date()) {
    return res.status(400).json({ error: 'Verification link has expired. Apply again or contact the Administrator.' });
  }

  execute('UPDATE email_verifications SET verified_at = CURRENT_TIMESTAMP WHERE id = ?', [row.id]);
  execute("UPDATE users SET email_verified = 1, updated_at = CURRENT_TIMESTAMP WHERE email = ?", [row.email]);
  logAccess({ action: 'email_verified', resource: `/api/auth/verify-email (${row.email})`, ipAddress: req.ip });
  return res.status(200).json({ message: 'Email verified successfully. Your application can now be approved.', email: row.email });
});

// 8. POST /api/auth/resend-verification (Public, rate-limited)
router.post('/resend-verification', loginLimiter, async (req, res) => {
  const { email } = req.body || {};
  const generic = { message: 'If that email has a pending application, a new verification link has been sent.' };
  const user = queryOne("SELECT id, name, email, email_verified FROM users WHERE email = ?", [String(email || '').toLowerCase().trim()]);
  if (!user || user.email_verified) return res.status(200).json(generic);

  const token = crypto.randomBytes(32).toString('hex');
  const verifyExpiresAt = new Date(Date.now() + VERIFY_TTL_HOURS * 60 * 60 * 1000).toISOString();
  execute(`
    INSERT INTO email_verifications (id, user_id, token, expires_at, created_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
  `, [crypto.randomUUID(), user.id, token, verifyExpiresAt]);

  const verifyUrl = `${appBaseUrl(req)}/api/auth/verify-email?token=${token}`;
  try {
    const mail = await emailService.sendEmail({
      to: user.email,
      subject: 'Verify your email — Mahi Tech Group',
      text: `Hello ${user.name},\n\nVerify your email to complete your membership application (link valid ${VERIFY_TTL_HOURS} hours):\n${verifyUrl}\n\n— Mahi Tech Group`,
      userId: user.id
    });
    const devUrl = (process.env.NODE_ENV !== 'production' && !mail.delivered) ? verifyUrl : undefined;
    return res.status(200).json({ ...generic, ...(devUrl ? { dev_verify_url: devUrl } : {}) });
  } catch (err) {
    return res.status(200).json(generic);
  }
});

// ===================================================================
// LOGIN ANOMALY DETECTION: 5+ failures for one account in 10 min -> admins alerted
// ===================================================================
const failedLoginStreaks = new Map(); // email -> { count, firstAt }

function recordFailedLogin(email) {
  const now = Date.now();
  const entry = failedLoginStreaks.get(email);
  if (!entry || now - entry.firstAt > 10 * 60 * 1000) {
    failedLoginStreaks.set(email, { count: 1, firstAt: now });
    return;
  }
  entry.count++;
  if (entry.count === 5) {
    const admins = queryAll("SELECT id FROM users WHERE role = 'admin' AND status = 'active'");
    for (const a of admins) {
      try {
        createNotification({
          userId: a.id,
          eventType: 'security_alert',
          message: `🚨 Security: 5 failed login attempts for ${email} in the last 10 minutes (IP: logged in access_log).`,
          link: '/admin.html'
        });
      } catch (e) { /* non-blocking */ }
    }
    logAccess({ action: 'login_anomaly_alert', resource: `/api/auth/login (${email}: 5 failures in 10 min)` });
  }
}

function checkLoginAnomaly(user, ipAddress) {
  const entry = failedLoginStreaks.get(user.email);
  if (entry && entry.count >= 5) {
    const admins = queryAll("SELECT id FROM users WHERE role = 'admin' AND status = 'active'");
    for (const a of admins) {
      try {
        createNotification({
          userId: a.id,
          eventType: 'security_alert',
          message: `ℹ️ ${user.email} signed in successfully after the recent failed-login streak (IP: ${ipAddress}).`,
          link: '/admin.html'
        });
      } catch (e) { /* non-blocking */ }
    }
    failedLoginStreaks.delete(user.email);
  }
}

// 9. POST /api/auth/2fa/setup (Authenticated) — returns secret + otpauth URL
router.post('/2fa/setup', authenticate, (req, res) => {
  const secret = generateTotpSecret();
  execute('UPDATE users SET totp_secret = ?, totp_enabled = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [secret, req.user.id]);
  return res.status(200).json({
    secret,
    otpauth_url: otpauthUrl(secret, req.user.email),
    note: 'Add this secret to Google Authenticator/Authy, then confirm with POST /api/auth/2fa/enable { code }.'
  });
});

// 10. POST /api/auth/2fa/enable (Authenticated)
router.post('/2fa/enable', authenticate, (req, res) => {
  const { code } = req.body || {};
  const user = queryOne('SELECT totp_secret, totp_enabled FROM users WHERE id = ?', [req.user.id]);
  if (!user?.totp_secret) return res.status(400).json({ error: 'Run /api/auth/2fa/setup first' });
  if (user.totp_enabled) return res.status(409).json({ error: '2FA is already enabled' });
  if (!code || !verifyTotp(user.totp_secret, String(code))) {
    return res.status(400).json({ error: 'Invalid 2FA code. Check your authenticator app clock and try again.' });
  }
  execute('UPDATE users SET totp_enabled = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [req.user.id]);
  logAccess({ userId: req.user.id, action: '2fa_enabled', resource: '/api/auth/2fa/enable', ipAddress: req.ip });
  return res.status(200).json({ message: '2FA enabled. You will need your authenticator code at every sign-in.' });
});

// 11. POST /api/auth/2fa/disable (Authenticated)
router.post('/2fa/disable', authenticate, (req, res) => {
  const { code } = req.body || {};
  const user = queryOne('SELECT totp_secret, totp_enabled FROM users WHERE id = ?', [req.user.id]);
  if (!user?.totp_enabled) return res.status(400).json({ error: '2FA is not enabled' });
  if (!code || !verifyTotp(user.totp_secret, String(code))) {
    return res.status(400).json({ error: 'Valid 2FA code required to disable' });
  }
  execute("UPDATE users SET totp_secret = NULL, totp_enabled = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [req.user.id]);
  logAccess({ userId: req.user.id, action: '2fa_disabled', resource: '/api/auth/2fa/disable', ipAddress: req.ip });
  return res.status(200).json({ message: '2FA disabled.' });
});

export default router;
