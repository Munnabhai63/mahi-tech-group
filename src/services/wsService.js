import { WebSocketServer, WebSocket } from 'ws';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { queryOne, queryAll } from '../db/database.js';

let wssInstance = null;
// Map from ws client to client metadata
const clients = new Map();
// Map from userId to Set of ws clients (one user may have multiple tabs)
const userSockets = new Map();

/**
 * Initialize WebSocket Server attached to the existing HTTP server
 */
export function initWebSocketServer(httpServer) {
  wssInstance = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (request, socket, head) => {
    try {
      const url = new URL(request.url, `http://${request.headers.host}`);
      if (url.pathname !== '/ws') {
        socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
        socket.destroy();
        return;
      }

      const token = url.searchParams.get('token');
      if (!token) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }

      // Verify JWT
      let decoded;
      try {
        decoded = jwt.verify(token, config.JWT_SECRET);
      } catch (err) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }

      // Verify session in database
      const session = queryOne('SELECT * FROM sessions WHERE id = ?', [decoded.sessionId]);
      if (!session || session.is_revoked === 1 || new Date(session.expires_at) <= new Date()) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }

      // Verify user is active
      const user = queryOne('SELECT id, name, email, role, status FROM users WHERE id = ?', [decoded.userId]);
      if (!user || user.status !== 'active') {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        socket.destroy();
        return;
      }

      wssInstance.handleUpgrade(request, socket, head, (ws) => {
        wssInstance.emit('connection', ws, request, user);
      });
    } catch (err) {
      console.error('[WS UPGRADE ERROR]', err);
      socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
      socket.destroy();
    }
  });

  wssInstance.on('connection', (ws, request, user) => {
    const rooms = new Set();
    // 1. Join global organization channel
    rooms.add('org:global');
    // 2. Join personal user channel
    rooms.add(`user:${user.id}`);
    // 3. Join role-specific channel (e.g. role:developer, role:researcher, etc.)
    if (user.role) {
      rooms.add(`role:${user.role}`);
    }

    // 3. Join channels for projects where user is owner or member
    const userProjects = queryAll(`
      SELECT DISTINCT p.id as project_id
      FROM projects p
      LEFT JOIN project_members pm ON p.id = pm.project_id AND pm.user_id = ? AND pm.removed_at IS NULL
      WHERE p.owner_id = ? OR pm.user_id = ?
    `, [user.id, user.id, user.id]);

    userProjects.forEach(p => rooms.add(`project:${p.project_id}`));

    // Register client
    clients.set(ws, {
      userId: user.id,
      name: user.name,
      role: user.role,
      rooms,
      isAlive: true
    });

    if (!userSockets.has(user.id)) {
      userSockets.set(user.id, new Set());
    }
    userSockets.get(user.id).add(ws);

    // Send connection welcome handshake
    ws.send(JSON.stringify({
      channel: 'system',
      event: 'connected',
      data: {
        message: 'Connected to Mahi Tech Group Real-Time Engine',
        userId: user.id,
        name: user.name,
        role: user.role,
        rooms: Array.from(rooms),
        onlineCount: getOnlineUsersCount()
      },
      timestamp: new Date().toISOString()
    }));

    // Broadcast updated presence to all clients
    broadcastEvent('org:global', 'presence.update', {
      onlineCount: getOnlineUsersCount(),
      joinedUser: { id: user.id, name: user.name, role: user.role }
    });

    ws.on('pong', () => {
      const client = clients.get(ws);
      if (client) client.isAlive = true;
    });

    ws.on('message', (messageRaw) => {
      try {
        const msg = JSON.parse(messageRaw.toString());
        if (msg.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong', timestamp: new Date().toISOString() }));
        }
      } catch (err) {
        // Ignore unparseable client messages
      }
    });

    ws.on('close', () => {
      clients.delete(ws);
      if (userSockets.has(user.id)) {
        userSockets.get(user.id).delete(ws);
        if (userSockets.get(user.id).size === 0) {
          userSockets.delete(user.id);
        }
      }
      broadcastEvent('org:global', 'presence.update', {
        onlineCount: getOnlineUsersCount(),
        leftUser: { id: user.id, name: user.name }
      });
    });

    ws.on('error', (err) => {
      console.error(`[WS Client Error for ${user.id}]:`, err.message);
    });
  });

  // Heartbeat ping interval (every 30 seconds)
  const heartbeatInterval = setInterval(() => {
    if (!wssInstance) return;
    for (const [ws, meta] of clients.entries()) {
      if (!meta.isAlive) {
        ws.terminate();
        clients.delete(ws);
        continue;
      }
      meta.isAlive = false;
      ws.ping();
    }
  }, 30000);

  wssInstance.on('close', () => {
    clearInterval(heartbeatInterval);
  });

  console.log('>>> WebSocket Server successfully initialized on /ws');
  return wssInstance;
}

/**
 * Returns distinct count of online users
 */
export function getOnlineUsersCount() {
  return userSockets.size;
}

/**
 * Broadcast an event to all clients subscribed to a specific channel
 * @param {string} channel - e.g. 'org:global', 'user:uuid', 'project:uuid'
 * @param {string} event - e.g. 'vote.cast', 'idea.submitted', 'task.unblocked'
 * @param {object} data - payload
 */
export function broadcastEvent(channel, event, data) {
  if (!wssInstance) return;

  const payload = JSON.stringify({
    channel,
    event,
    data,
    timestamp: new Date().toISOString()
  });

  for (const [ws, meta] of clients.entries()) {
    if (ws.readyState === WebSocket.OPEN && meta.rooms.has(channel)) {
      try {
        ws.send(payload);
      } catch (err) {
        console.error(`[WS Send Error]:`, err.message);
      }
    }
  }
}

/**
 * Convenience helper to push to a specific user
 */
export function pushToUser(userId, event, data) {
  broadcastEvent(`user:${userId}`, event, data);
}

/**
 * Convenience helper to push to all organization members
 */
export function pushToGlobal(event, data) {
  broadcastEvent('org:global', event, data);
}

/**
 * Convenience helper to push to a project room
 */
export function pushToProject(projectId, event, data) {
  broadcastEvent(`project:${projectId}`, event, data);
}
