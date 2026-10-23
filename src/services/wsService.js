import { WebSocketServer, WebSocket } from 'ws';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { queryOne, queryAll } from '../db/database.js';
import {
  isUserProjectContributor,
  getOrCreateRoomForProject,
  joinRoom,
  leaveRoom,
  updateCanvasElement,
  deleteCanvasElement
} from './coworkingService.js';

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

    // 4. Join channels for projects where user is owner or member
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
      isAlive: true,
      lastCursorBroadcastTime: 0
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
          return;
        }

        const clientMeta = clients.get(ws);
        if (!clientMeta) return;

        // -------------------------------------------------------------
        // STEP 11: CO-WORKING CANVAS WEBSOCKET MESSAGE DISPATCHER
        // -------------------------------------------------------------
        if (msg.action && msg.action.startsWith('canvas:')) {
          const projectId = msg.projectId;
          if (!projectId) {
            ws.send(JSON.stringify({
              channel: 'canvas:error',
              event: 'canvas:error',
              data: { error: 'projectId is required' }
            }));
            return;
          }

          // A. canvas:join
          if (msg.action === 'canvas:join') {
            const authCheck = isUserProjectContributor(projectId, user.id);
            if (!authCheck.allowed) {
              ws.send(JSON.stringify({
                channel: `canvas:${projectId}`,
                event: 'canvas:error',
                data: { error: authCheck.reason, code: 403 }
              }));
              return;
            }

            const room = getOrCreateRoomForProject(projectId);
            joinRoom(room.id, user.id);
            clientMeta.rooms.add(`canvas:${projectId}`);

            let canvasState = { objects: {}, tombstones: {}, metadata: { version: 1, archived: false } };
            try {
              if (room.canvas_state_json) canvasState = JSON.parse(room.canvas_state_json);
            } catch (e) {}

            const isArchived = (room.status === 'archived' || authCheck.project.current_stage === 'LIVE' || authCheck.project.status === 'LIVE');

            const activeParticipants = queryAll(`
              SELECT rp.id, rp.user_id, rp.joined_at, u.name, u.role
              FROM room_participants rp
              JOIN users u ON rp.user_id = u.id
              WHERE rp.room_id = ? AND rp.left_at IS NULL
              ORDER BY rp.joined_at ASC
            `, [room.id]);

            // Send initial state & room metadata to joining client
            ws.send(JSON.stringify({
              channel: `canvas:${projectId}`,
              event: 'canvas:init',
              data: {
                roomId: room.id,
                projectId,
                isArchived,
                canvasState,
                participants: activeParticipants
              },
              timestamp: new Date().toISOString()
            }));

            // Broadcast join notification to room peers
            broadcastEvent(`canvas:${projectId}`, 'canvas:user_joined', {
              user: { id: user.id, name: user.name, role: user.role },
              participants: activeParticipants
            });
            return;
          }

          // All subsequent canvas actions require the client to be joined in canvas room
          if (!clientMeta.rooms.has(`canvas:${projectId}`)) {
            ws.send(JSON.stringify({
              channel: `canvas:${projectId}`,
              event: 'canvas:error',
              data: { error: 'Must join canvas room before sending canvas actions' }
            }));
            return;
          }

          const room = getOrCreateRoomForProject(projectId);

          // B. canvas:cursor_move (Server-side 60ms rate-limited)
          if (msg.action === 'canvas:cursor_move') {
            const now = Date.now();
            const THROTTLE_MS = 60; // Max ~16.6 updates/sec
            if (now - (clientMeta.lastCursorBroadcastTime || 0) < THROTTLE_MS) {
              return; // Server-side throttle: drop sub-throttle packet
            }
            clientMeta.lastCursorBroadcastTime = now;

            broadcastEvent(`canvas:${projectId}`, 'canvas:cursor_move', {
              userId: user.id,
              name: user.name,
              role: user.role,
              x: Number(msg.x || 0),
              y: Number(msg.y || 0)
            }, ws); // Exclude sender
            return;
          }

          // C. canvas:object_update (LWW with Attribution History)
          if (msg.action === 'canvas:object_update') {
            const result = updateCanvasElement(room.id, msg.object || {}, user);
            if (!result.success) {
              ws.send(JSON.stringify({
                channel: `canvas:${projectId}`,
                event: 'canvas:error',
                data: { error: result.error }
              }));
              return;
            }

            broadcastEvent(`canvas:${projectId}`, 'canvas:object_update', {
              element: result.element,
              version: result.canvasState.metadata.version
            });
            return;
          }

          // D. canvas:object_delete (Attributed Soft-Delete Tombstones)
          if (msg.action === 'canvas:object_delete') {
            const result = deleteCanvasElement(room.id, msg.objectId, user);
            if (!result.success) {
              ws.send(JSON.stringify({
                channel: `canvas:${projectId}`,
                event: 'canvas:error',
                data: { error: result.error }
              }));
              return;
            }

            broadcastEvent(`canvas:${projectId}`, 'canvas:object_delete', {
              objectId: msg.objectId,
              deletedBy: result.deletedBy,
              version: result.canvasState.metadata.version
            });
            return;
          }

          // E. canvas:leave
          if (msg.action === 'canvas:leave') {
            clientMeta.rooms.delete(`canvas:${projectId}`);
            leaveRoom(room.id, user.id);

            const remainingParticipants = queryAll(`
              SELECT rp.id, rp.user_id, rp.joined_at, u.name, u.role
              FROM room_participants rp
              JOIN users u ON rp.user_id = u.id
              WHERE rp.room_id = ? AND rp.left_at IS NULL
              ORDER BY rp.joined_at ASC
            `, [room.id]);

            broadcastEvent(`canvas:${projectId}`, 'canvas:user_left', {
              user: { id: user.id, name: user.name },
              participants: remainingParticipants
            });
            return;
          }
        }
      } catch (err) {
        // Ignore unparseable client messages
      }
    });

    ws.on('close', () => {
      const clientMeta = clients.get(ws);
      if (clientMeta) {
        // Clean up any canvas rooms this client was participating in
        for (const roomName of clientMeta.rooms) {
          if (roomName.startsWith('canvas:')) {
            const projectId = roomName.replace('canvas:', '');
            const room = queryOne('SELECT id FROM coworking_rooms WHERE project_id = ?', [projectId]);
            if (room) {
              leaveRoom(room.id, user.id);
              const remainingParticipants = queryAll(`
                SELECT rp.id, rp.user_id, rp.joined_at, u.name, u.role
                FROM room_participants rp
                JOIN users u ON rp.user_id = u.id
                WHERE rp.room_id = ? AND rp.left_at IS NULL
                ORDER BY rp.joined_at ASC
              `, [room.id]);

              broadcastEvent(`canvas:${projectId}`, 'canvas:user_left', {
                user: { id: user.id, name: user.name },
                participants: remainingParticipants
              });
            }
          }
        }
      }

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
 * Disconnect all active WebSockets for a specific user (used by Step 05 offboarding killswitch)
 */
export function disconnectUserSockets(userId, reason = 'Session revoked') {
  if (userSockets.has(userId)) {
    const sockets = Array.from(userSockets.get(userId));
    for (const ws of sockets) {
      try {
        ws.send(JSON.stringify({
          channel: 'system',
          event: 'force_disconnect',
          data: { reason }
        }));
        ws.close(4001, reason);
      } catch (e) {}
    }
    userSockets.delete(userId);
  }
}

/**
 * Broadcast an event to all clients subscribed to a specific channel
 * @param {string} channel - e.g. 'org:global', 'user:uuid', 'project:uuid', 'canvas:uuid'
 * @param {string} event - e.g. 'vote.cast', 'idea.submitted', 'canvas:cursor_move'
 * @param {object} data - payload
 * @param {WebSocket} excludeWs - optional WebSocket client to exclude from broadcast (e.g. sender)
 */
export function broadcastEvent(channel, event, data, excludeWs = null) {
  if (!wssInstance) return;

  const payload = JSON.stringify({
    channel,
    event,
    data,
    timestamp: new Date().toISOString()
  });

  for (const [ws, meta] of clients.entries()) {
    if (ws !== excludeWs && ws.readyState === WebSocket.OPEN && meta.rooms.has(channel)) {
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
