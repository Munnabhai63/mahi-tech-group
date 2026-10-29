import jwt from 'jsonwebtoken';
import { queryOne, execute } from '../db/database.js';
import { config } from '../config.js';
import { logAccess } from '../services/auditService.js';

export function authenticate(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Missing or malformed authorization header' });
  }

  const token = authHeader.substring(7).trim();

  // Guard: Client portal tokens must NEVER be accepted on internal routes
  try {
    const preCheck = jwt.decode(token);
    if (preCheck && (preCheck.role === 'CLIENT' || preCheck.clientId)) {
      return res.status(403).json({ error: 'Forbidden: Client tokens are not permitted on internal endpoints' });
    }
  } catch (e) {
    // Continue to standard verification
  }

  try {
    const decoded = jwt.verify(token, config.JWT_SECRET);
    if (decoded && (decoded.role === 'CLIENT' || decoded.clientId)) {
      return res.status(403).json({ error: 'Forbidden: Client tokens are not permitted on internal endpoints' });
    }
    const { sessionId, userId } = decoded;

    // Check session validity in database
    const session = queryOne('SELECT * FROM sessions WHERE id = ?', [sessionId]);
    if (!session) {
      return res.status(401).json({ error: 'Unauthorized: Session not found' });
    }

    if (session.is_revoked === 1 || session.is_revoked === true) {
      return res.status(401).json({ error: 'Unauthorized: Session has been revoked' });
    }

    const now = new Date();
    const expiresAt = new Date(session.expires_at);
    if (expiresAt <= now) {
      return res.status(401).json({ error: 'Unauthorized: Session has expired' });
    }

    // Check user active status in database
    const user = queryOne('SELECT * FROM users WHERE id = ?', [userId]);
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized: User not found' });
    }

    if (user.status !== 'active') {
      logAccess({
        userId: user.id,
        action: 'access_blocked_inactive_status',
        resource: req.originalUrl,
        ipAddress: req.ip || req.socket.remoteAddress
      });
      return res.status(401).json({ error: 'Unauthorized: Access Revoked' });
    }

    // Step 14 Layer 1: Update users.last_active_at on every successful authenticated request
    try {
      execute('UPDATE users SET last_active_at = CURRENT_TIMESTAMP WHERE id = ?', [user.id]);
    } catch (e) {
      // Safe fallback if column not yet initialized
    }

    // Attach user and session to request
    req.user = user;
    req.session = session;
    req.token = token;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Unauthorized: Token has expired' });
    }
    return res.status(401).json({ error: 'Unauthorized: Invalid token signature' });
  }
}

export function requireRole(expectedRole) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized: User authentication required' });
    }
    if (req.user.role !== expectedRole) {
      return res.status(403).json({ error: 'Forbidden: Insufficient privileges' });
    }
    next();
  };
}
