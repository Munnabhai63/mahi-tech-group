import jwt from 'jsonwebtoken';
import { queryOne } from '../db/database.js';
import { config } from '../config.js';

// In-memory sliding window rate limiter: max 5 failed attempts per 15 minutes per IP
const FAILED_LOGIN_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_FAILED_ATTEMPTS = 5;
const failedAttemptsMap = new Map();

/**
 * Record a failed client login attempt by IP address
 * @param {string} ip
 * @returns {{ count: number, locked: boolean }}
 */
export function recordFailedClientLogin(ip) {
  const now = Date.now();
  const entry = failedAttemptsMap.get(ip);

  if (!entry || now - entry.firstAttemptTime > FAILED_LOGIN_WINDOW_MS) {
    failedAttemptsMap.set(ip, {
      count: 1,
      firstAttemptTime: now,
      lockedUntil: 0
    });
    return { count: 1, locked: false };
  }

  entry.count += 1;
  if (entry.count >= MAX_FAILED_ATTEMPTS) {
    entry.lockedUntil = now + FAILED_LOGIN_WINDOW_MS;
    return { count: entry.count, locked: true };
  }

  return { count: entry.count, locked: false };
}

/**
 * Check if IP is currently locked out from client login
 * @param {string} ip
 * @returns {boolean}
 */
export function isClientIpLockedOut(ip) {
  const entry = failedAttemptsMap.get(ip);
  if (!entry) return false;

  const now = Date.now();
  if (entry.lockedUntil && entry.lockedUntil > now) {
    return true;
  }

  // If lock period has expired, reset
  if (entry.lockedUntil && entry.lockedUntil <= now) {
    failedAttemptsMap.delete(ip);
    return false;
  }

  // If window expired without lock
  if (now - entry.firstAttemptTime > FAILED_LOGIN_WINDOW_MS) {
    failedAttemptsMap.delete(ip);
    return false;
  }

  return false;
}

/**
 * Clear failed login attempts for an IP (called upon successful login)
 * @param {string} ip
 */
export function clearFailedClientLogins(ip) {
  failedAttemptsMap.delete(ip);
}

/**
 * Reset all rate limiter entries (used by test suites)
 */
export function resetClientRateLimiter() {
  failedAttemptsMap.clear();
}

/**
 * Rate Limiter Middleware for Client Login:
 * Locks out with 429 Too Many Requests after 5 failed attempts within 15 minutes
 */
export function clientLoginLimiter(req, res, next) {
  const ip = req.ip || req.socket?.remoteAddress || '127.0.0.1';

  if (isClientIpLockedOut(ip)) {
    return res.status(429).json({
      error: 'Too many failed login attempts. Account temporarily locked for 15 minutes.'
    });
  }

  next();
}

/**
 * Authenticate Client JWT Middleware:
 * Completely separate from internal user authentication.
 * Verifies token against CLIENT_JWT_SECRET, requires role='CLIENT',
 * checks active status in clients table, and rejects internal user tokens.
 */
export function authenticateClientToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Missing or malformed client authorization header' });
  }

  const token = authHeader.substring(7).trim();

  // Guard: Internal user tokens must NEVER be accepted on client portal routes
  try {
    const preCheck = jwt.decode(token);
    if (preCheck && (preCheck.userId || preCheck.sessionId || (preCheck.role && preCheck.role !== 'CLIENT'))) {
      return res.status(401).json({ error: 'Unauthorized: Internal user tokens are not permitted on client routes' });
    }
  } catch (e) {
    // Continue to standard verification
  }

  try {
    const decoded = jwt.verify(token, config.CLIENT_JWT_SECRET);

    if (!decoded || decoded.role !== 'CLIENT' || !decoded.clientId) {
      return res.status(403).json({ error: 'Forbidden: Invalid client role or payload' });
    }

    // Verify client exists and is active in the database
    const client = queryOne(
      'SELECT id, name, email, company_name, phone, status, created_at, updated_at FROM clients WHERE id = ?',
      [decoded.clientId]
    );

    if (!client) {
      return res.status(401).json({ error: 'Unauthorized: Client account not found' });
    }

    if (client.status === 'SUSPENDED') {
      return res.status(403).json({ error: 'Forbidden: Account has been suspended. Please contact administrator.' });
    }

    if (client.status !== 'ACTIVE') {
      return res.status(401).json({ error: 'Unauthorized: Client account is not active' });
    }

    req.client = client;
    req.clientToken = decoded;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Unauthorized: Client token has expired' });
    }
    return res.status(401).json({ error: 'Unauthorized: Invalid client token signature' });
  }
}
