import express from 'express';
import { authenticate } from '../middleware/auth.js';
import {
  getRoomDetails,
  getOrCreateRoomForProject,
  joinRoom,
  leaveRoom,
  saveCanvasStateSync,
  isUserProjectContributor
} from '../services/coworkingService.js';
import { queryOne } from '../db/database.js';

const router = express.Router();

/**
 * 1. POST /api/coworking-rooms/:id/join
 * Join an active room and log participant entry
 */
router.post('/:id/join', authenticate, (req, res) => {
  const { id } = req.params;
  const result = joinRoom(id, req.user.id);

  if (!result.success) {
    return res.status(result.status || 400).json({ error: result.error });
  }

  return res.status(200).json({
    message: 'Successfully joined co-working room',
    participantId: result.participantId,
    roomId: result.roomId
  });
});

/**
 * 2. POST /api/coworking-rooms/:id/leave
 * Leave room and record left_at timestamp
 */
router.post('/:id/leave', authenticate, (req, res) => {
  const { id } = req.params;
  const result = leaveRoom(id, req.user.id);

  return res.status(200).json({ message: 'Successfully left co-working room' });
});

/**
 * 3. PATCH /api/coworking-rooms/:id/snapshot
 * Persist canvas snapshot directly via HTTP (Autosave / Manual save backup)
 */
router.patch('/:id/snapshot', authenticate, (req, res) => {
  const { id } = req.params;
  const { canvasState } = req.body || {};

  if (!canvasState) {
    return res.status(400).json({ error: 'canvasState object is required' });
  }

  const room = queryOne('SELECT * FROM coworking_rooms WHERE id = ?', [id]);
  if (!room) {
    return res.status(404).json({ error: 'Co-working room not found' });
  }

  const authCheck = isUserProjectContributor(room.project_id, req.user.id);
  if (!authCheck.allowed) {
    return res.status(403).json({ error: authCheck.reason });
  }

  if (room.status === 'archived') {
    return res.status(400).json({ error: 'Canvas is archived (read-only): project is LIVE' });
  }

  try {
    saveCanvasStateSync(id, canvasState);
    return res.status(200).json({ message: 'Canvas snapshot persisted successfully' });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

export default router;
