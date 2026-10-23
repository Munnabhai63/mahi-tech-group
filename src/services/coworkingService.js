import crypto from 'node:crypto';
import { queryOne, queryAll, execute } from '../db/database.js';

export const MAX_ACTIVE_OBJECTS = 500;
export const MAX_OBJECT_PAYLOAD_BYTES = 5 * 1024; // 5 KB
export const MAX_CANVAS_PAYLOAD_BYTES = 2 * 1024 * 1024; // 2 MB
export const MAX_TOMBSTONES = 200;

/**
 * Verify whether a user is an active assigned contributor to a project
 */
export function isUserProjectContributor(projectId, userId) {
  const user = queryOne('SELECT id, name, role, status FROM users WHERE id = ?', [userId]);
  if (!user || user.status !== 'active') {
    return { allowed: false, reason: 'User is not active' };
  }

  // 4-Corner Non-Negotiable Rule: Admin is excluded from peer canvas cursor collaboration
  if (user.role === 'admin') {
    return {
      allowed: false,
      reason: 'Administrator accounts are excluded from the creative peer co-working canvas (governance oversight is reserved for Admin Control Panel)'
    };
  }

  const project = queryOne('SELECT id, owner_id, current_stage, status FROM projects WHERE id = ?', [projectId]);
  if (!project) {
    return { allowed: false, reason: 'Project not found' };
  }

  // Owner is always an authorized contributor
  if (project.owner_id === userId) {
    return { allowed: true, user, project };
  }

  // Check project_members table
  const member = queryOne(`
    SELECT * FROM project_members
    WHERE project_id = ? AND user_id = ? AND removed_at IS NULL
  `, [projectId, userId]);

  if (!member) {
    return { allowed: false, reason: 'You are not an assigned contributor to this project' };
  }

  return { allowed: true, user, project, member };
}

/**
 * Get or create deterministic room for a project
 */
export function getOrCreateRoomForProject(projectId) {
  let room = queryOne('SELECT * FROM coworking_rooms WHERE project_id = ?', [projectId]);
  if (!room) {
    const roomId = crypto.randomUUID();
    const initState = JSON.stringify({
      objects: {},
      tombstones: {},
      metadata: { version: 1, archived: false }
    });
    execute(`
      INSERT OR IGNORE INTO coworking_rooms (
        id, project_id, room_type, status, canvas_state_json, created_at, last_active_at
      ) VALUES (?, ?, 'custom', 'active', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `, [roomId, projectId, initState]);

    room = queryOne('SELECT * FROM coworking_rooms WHERE project_id = ?', [projectId]);
  }
  return room;
}

/**
 * Fetch room details, parsed state, and active participants
 */
export function getRoomDetails(projectId, userId) {
  const authCheck = isUserProjectContributor(projectId, userId);
  if (!authCheck.allowed) {
    return { success: false, status: 403, error: authCheck.reason };
  }

  const room = getOrCreateRoomForProject(projectId);
  if (!room) {
    return { success: false, status: 404, error: 'Co-working room not found' };
  }

  let canvasState = { objects: {}, tombstones: {}, metadata: { version: 1, archived: false } };
  try {
    if (room.canvas_state_json) {
      canvasState = JSON.parse(room.canvas_state_json);
    }
  } catch (err) {
    console.error('Failed to parse canvas_state_json:', err);
  }

  // Active participants in room
  const activeParticipants = queryAll(`
    SELECT rp.id, rp.user_id, rp.joined_at, u.name, u.role
    FROM room_participants rp
    JOIN users u ON rp.user_id = u.id
    WHERE rp.room_id = ? AND rp.left_at IS NULL
    ORDER BY rp.joined_at ASC
  `, [room.id]);

  const isArchived = (room.status === 'archived' || authCheck.project.current_stage === 'LIVE' || authCheck.project.status === 'LIVE');

  return {
    success: true,
    room: {
      id: room.id,
      project_id: room.project_id,
      room_type: room.room_type,
      status: isArchived ? 'archived' : room.status,
      created_at: room.created_at,
      last_active_at: room.last_active_at
    },
    projectTitle: authCheck.project.title,
    isArchived,
    canvasState,
    participants: activeParticipants
  };
}

/**
 * Join Room and record in room_participants
 */
export function joinRoom(roomId, userId) {
  const room = queryOne('SELECT * FROM coworking_rooms WHERE id = ?', [roomId]);
  if (!room) {
    return { success: false, status: 404, error: 'Co-working room not found' };
  }

  const authCheck = isUserProjectContributor(room.project_id, userId);
  if (!authCheck.allowed) {
    return { success: false, status: 403, error: authCheck.reason };
  }

  // Close any dangling stale sessions for this user in this room
  execute(`
    UPDATE room_participants
    SET left_at = CURRENT_TIMESTAMP
    WHERE room_id = ? AND user_id = ? AND left_at IS NULL
  `, [roomId, userId]);

  const participantId = crypto.randomUUID();
  execute(`
    INSERT INTO room_participants (id, room_id, user_id, joined_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
  `, [participantId, roomId, userId]);

  execute(`
    UPDATE coworking_rooms SET last_active_at = CURRENT_TIMESTAMP WHERE id = ?
  `, [roomId]);

  return {
    success: true,
    participantId,
    roomId,
    user: authCheck.user
  };
}

/**
 * Leave Room and update left_at in room_participants
 */
export function leaveRoom(roomId, userId) {
  execute(`
    UPDATE room_participants
    SET left_at = CURRENT_TIMESTAMP
    WHERE room_id = ? AND user_id = ? AND left_at IS NULL
  `, [roomId, userId]);

  execute(`
    UPDATE coworking_rooms SET last_active_at = CURRENT_TIMESTAMP WHERE id = ?
  `, [roomId]);

  return { success: true };
}

/**
 * Apply element update with Last-Write-Wins and permanent attribution
 */
export function updateCanvasElement(roomId, elementData, user) {
  const room = queryOne('SELECT * FROM coworking_rooms WHERE id = ?', [roomId]);
  if (!room) {
    return { success: false, error: 'Room not found' };
  }

  if (room.status === 'archived') {
    return { success: false, error: 'Canvas is archived (read-only): project is LIVE' };
  }

  let canvasState = { objects: {}, tombstones: {}, metadata: { version: 1, archived: false } };
  try {
    if (room.canvas_state_json) {
      canvasState = JSON.parse(room.canvas_state_json);
    }
  } catch (err) {
    canvasState = { objects: {}, tombstones: {}, metadata: { version: 1, archived: false } };
  }

  const elementId = elementData.id || crypto.randomUUID();
  const existing = canvasState.objects[elementId];

  // Safeguard: Limit active objects count
  if (!existing && Object.keys(canvasState.objects).length >= MAX_ACTIVE_OBJECTS) {
    return { success: false, error: `Canvas capacity reached (maximum ${MAX_ACTIVE_OBJECTS} active objects per room)` };
  }

  // Safeguard: Limit individual element payload size
  const elementRaw = JSON.stringify(elementData);
  if (elementRaw.length > MAX_OBJECT_PAYLOAD_BYTES) {
    return { success: false, error: `Element payload exceeds maximum size limit of ${MAX_OBJECT_PAYLOAD_BYTES / 1024} KB` };
  }

  const nowIso = new Date().toISOString();
  let updatedElement;

  if (!existing) {
    // New object creation
    updatedElement = {
      ...elementData,
      id: elementId,
      createdBy: {
        userId: user.id,
        name: user.name,
        role: user.role,
        timestamp: nowIso
      },
      lastModifiedBy: {
        userId: user.id,
        name: user.name,
        role: user.role,
        timestamp: nowIso
      },
      version: 1,
      editHistory: [
        { action: 'created', userId: user.id, name: user.name, role: user.role, timestamp: nowIso }
      ]
    };
  } else {
    // Existing object update (LWW with Attribution History)
    const history = Array.isArray(existing.editHistory) ? existing.editHistory : [];
    const newHistory = [
      ...history,
      { action: 'updated', userId: user.id, name: user.name, role: user.role, timestamp: nowIso }
    ].slice(-10); // Keep last 10 edits

    updatedElement = {
      ...existing,
      ...elementData,
      id: elementId,
      createdBy: existing.createdBy || {
        userId: user.id,
        name: user.name,
        role: user.role,
        timestamp: nowIso
      },
      lastModifiedBy: {
        userId: user.id,
        name: user.name,
        role: user.role,
        timestamp: nowIso
      },
      version: (existing.version || 1) + 1,
      editHistory: newHistory
    };
  }

  canvasState.objects[elementId] = updatedElement;
  canvasState.metadata.version = (canvasState.metadata.version || 1) + 1;

  // Persist updated canvas state
  saveCanvasStateSync(roomId, canvasState);

  return { success: true, element: updatedElement, canvasState };
}

/**
 * Soft-delete an element with attributed tombstone
 */
export function deleteCanvasElement(roomId, elementId, user) {
  const room = queryOne('SELECT * FROM coworking_rooms WHERE id = ?', [roomId]);
  if (!room) {
    return { success: false, error: 'Room not found' };
  }

  if (room.status === 'archived') {
    return { success: false, error: 'Canvas is archived (read-only): project is LIVE' };
  }

  let canvasState = { objects: {}, tombstones: {}, metadata: { version: 1, archived: false } };
  try {
    if (room.canvas_state_json) {
      canvasState = JSON.parse(room.canvas_state_json);
    }
  } catch (err) {}

  const existing = canvasState.objects[elementId];
  if (!existing) {
    return { success: false, error: 'Element not found on canvas' };
  }

  const nowIso = new Date().toISOString();
  const tombstone = {
    ...existing,
    isDeleted: true,
    deletedBy: {
      userId: user.id,
      name: user.name,
      role: user.role,
      timestamp: nowIso
    }
  };

  delete canvasState.objects[elementId];
  if (!canvasState.tombstones) canvasState.tombstones = {};
  canvasState.tombstones[elementId] = tombstone;

  // Prune tombstones if over cap
  const tombstoneKeys = Object.keys(canvasState.tombstones);
  if (tombstoneKeys.length > MAX_TOMBSTONES) {
    const keysToDrop = tombstoneKeys.slice(0, tombstoneKeys.length - MAX_TOMBSTONES);
    for (const k of keysToDrop) {
      delete canvasState.tombstones[k];
    }
  }

  canvasState.metadata.version = (canvasState.metadata.version || 1) + 1;
  saveCanvasStateSync(roomId, canvasState);

  return { success: true, elementId, deletedBy: tombstone.deletedBy, canvasState };
}

/**
 * Save complete canvas snapshot to SQLite
 */
export function saveCanvasStateSync(roomId, canvasState) {
  const serialised = JSON.stringify(canvasState);
  if (serialised.length > MAX_CANVAS_PAYLOAD_BYTES) {
    throw new Error(`Canvas total state exceeds ${MAX_CANVAS_PAYLOAD_BYTES / (1024 * 1024)} MB limit`);
  }

  execute(`
    UPDATE coworking_rooms
    SET canvas_state_json = ?, last_active_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [serialised, roomId]);

  return true;
}
