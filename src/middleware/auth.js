import jwt from 'jsonwebtoken';
import { queryOne } from '../db/database.js';
import { config } from '../config.js';
import { logAccess } from '../services/auditService.js';

export function authenticate(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Missing or malformed authorization header' });
  }

  const token = authHeader.substring(7).trim();

  try {
    const decoded = jwt.verify(token, config.JWT_SECRET);
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
