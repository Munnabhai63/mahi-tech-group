import { queryOne } from '../db/database.js';
import { logAccess } from '../services/auditService.js';

export function requirePermission(permissionKey) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized: User authentication required' });
    }

    const { role, id: userId } = req.user;

    const record = queryOne(
      'SELECT allowed FROM roles_permissions WHERE role = ? AND permission_key = ?',
      [role, permissionKey]
    );

    const isAllowed = record && (record.allowed === 1 || record.allowed === true);

    if (!isAllowed) {
      logAccess({
        userId,
        action: 'permission_denied',
        resource: `${req.method} ${req.originalUrl} (${permissionKey})`,
        ipAddress: req.ip || req.socket.remoteAddress
      });

      return res.status(403).json({
        error: 'Forbidden: Insufficient permissions',
        requiredPermission: permissionKey,
        currentRole: role
      });
    }

    next();
  };
}
