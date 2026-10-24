import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import multer from 'multer';
import { authenticate } from '../middleware/auth.js';
import { queryOne, queryAll, execute } from '../db/database.js';
import {
  scheduleMeeting,
  startMeeting,
  endMeeting,
  cancelMeeting,
  joinMeeting,
  leaveMeeting,
  listMeetings,
  getMeetingDetails,
  getMeetingNotes,
  confirmMeetingNotes
} from '../services/meetingService.js';
import { processMeetingRecording } from '../services/aiNotesService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadsDir = path.join(__dirname, '..', '..', 'uploads', 'meeting-recordings');

// Ensure upload directory exists
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Multer storage engine for recording uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.mp3';
    const meetingId = req.params.id;
    cb(null, `recording_${meetingId}_${Date.now()}${ext}`);
  }
});

const upload = multer({
  storage,
  // Whisper's transcription API hard-caps files at 25MB — anything larger would
  // always fail AI processing, so reject it at upload time.
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB max
  fileFilter: (req, file, cb) => {
    const allowed = ['.mp3', '.wav', '.m4a', '.webm', '.mp4'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`Invalid file type. Supported formats: ${allowed.join(', ')}`));
    }
  }
});

const router = express.Router();

/**
 * Validates the uploaded file's magic bytes against its claimed extension so a
 * renamed executable/payload cannot masquerade as an audio recording.
 */
function hasValidMediaSignature(filePath, originalName) {
  const ext = path.extname(originalName).toLowerCase();
  let header;
  try {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(16);
    fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    header = buf;
  } catch (e) {
    return false;
  }
  const ascii = header.toString('latin1');
  if (ext === '.wav') return ascii.slice(0, 4) === 'RIFF' && ascii.slice(8, 12) === 'WAVE';
  if (ext === '.mp3') return ascii.slice(0, 3) === 'ID3' || (header[0] === 0xff && (header[1] & 0xe0) === 0xe0);
  if (ext === '.m4a' || ext === '.mp4') return ascii.slice(4, 8) === 'ftyp';
  if (ext === '.webm') return header[0] === 0x1a && header[1] === 0x45 && header[2] === 0xdf && header[3] === 0xa3;
  return false;
}

/**
 * 1. POST /api/meetings (Admin only)
 * Schedule a new meeting
 */
router.post('/', authenticate, (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden: Only administrators can schedule meetings' });
  }

  const {
    title,
    meeting_type = 'ad_hoc',
    linked_idea_id = null,
    linked_project_id = null,
    scheduled_at = null,
    recording_enabled = false
  } = req.body || {};

  const ipAddress = req.ip || req.socket.remoteAddress;

  const result = scheduleMeeting({
    title,
    meetingType: meeting_type,
    linkedIdeaId: linked_idea_id,
    linkedProjectId: linked_project_id,
    scheduledAt: scheduled_at,
    recordingEnabled: recording_enabled,
    hostedBy: req.user.id,
    ipAddress
  });

  return res.status(result.status).json(result.meeting ? { meeting: result.meeting } : { error: result.error });
});

/**
 * 2. PATCH /api/meetings/:id/start (Admin only)
 * Transition SCHEDULED -> LIVE, notify all
 */
router.patch('/:id/start', authenticate, (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden: Only administrators can start meetings' });
  }

  const ipAddress = req.ip || req.socket.remoteAddress;
  const result = startMeeting({
    meetingId: req.params.id,
    userId: req.user.id,
    ipAddress
  });

  return res.status(result.status).json(result.meeting ? { meeting: result.meeting } : { error: result.error });
});

/**
 * 3. PATCH /api/meetings/:id/end (Admin only)
 * Transition LIVE -> ENDED, trigger AI notes pipeline if recording exists
 */
router.patch('/:id/end', authenticate, (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden: Only administrators can end meetings' });
  }

  const ipAddress = req.ip || req.socket.remoteAddress;
  const result = endMeeting({
    meetingId: req.params.id,
    userId: req.user.id,
    ipAddress
  });

  return res.status(result.status).json(result.meeting ? { message: result.message, meeting: result.meeting } : { error: result.error });
});

/**
 * 4. PATCH /api/meetings/:id/cancel (Admin only)
 * Transition SCHEDULED -> CANCELLED
 */
router.patch('/:id/cancel', authenticate, (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden: Only administrators can cancel meetings' });
  }

  const ipAddress = req.ip || req.socket.remoteAddress;
  const result = cancelMeeting({
    meetingId: req.params.id,
    userId: req.user.id,
    ipAddress
  });

  return res.status(result.status).json(result.meeting ? { meeting: result.meeting } : { error: result.error });
});

/**
 * 5. POST /api/meetings/:id/join (Active members)
 * Record joined_at, return Jitsi room credentials
 */
router.post('/:id/join', authenticate, (req, res) => {
  const ipAddress = req.ip || req.socket.remoteAddress;
  const result = joinMeeting({
    meetingId: req.params.id,
    userId: req.user.id,
    ipAddress
  });

  return res.status(result.status).json(result.meeting ? { success: true, meeting: result.meeting } : { error: result.error });
});

/**
 * 6. POST /api/meetings/:id/leave (Active members)
 * Record left_at
 */
router.post('/:id/leave', authenticate, (req, res) => {
  const ipAddress = req.ip || req.socket.remoteAddress;
  const result = leaveMeeting({
    meetingId: req.params.id,
    userId: req.user.id,
    ipAddress
  });

  return res.status(result.status).json(result.success ? { success: true, message: result.message } : { error: result.error });
});

/**
 * 7. GET /api/meetings (Active members)
 * List upcoming & past meetings
 */
router.get('/', authenticate, (req, res) => {
  const result = listMeetings({ userId: req.user.id });
  return res.status(result.status).json({ meetings: result.meetings });
});

/**
 * 8. GET /api/meetings/:id (Active members)
 * Meeting detail + attendance list
 */
router.get('/:id', authenticate, (req, res) => {
  const result = getMeetingDetails({
    meetingId: req.params.id,
    userId: req.user.id
  });

  return res.status(result.status).json(result.meeting ? { meeting: result.meeting, attendance: result.attendance } : { error: result.error });
});

/**
 * 9. GET /api/meetings/:id/notes (Participants or Admin)
 * View confirmed notes (Hindi/English)
 */
router.get('/:id/notes', authenticate, (req, res) => {
  const result = getMeetingNotes({
    meetingId: req.params.id,
    userId: req.user.id
  });

  return res.status(result.status).json(result.notes ? { notes: result.notes } : { error: result.error });
});

/**
 * 10. POST /api/meetings/:id/recording (ADMIN ONLY)
 * Upload recording file and trigger async AI notes pipeline
 */
router.post('/:id/recording', authenticate, (req, res) => {
  // 1. Mandatory Admin-only authorization check
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden: Only administrators can upload meeting recordings' });
  }

  upload.single('recording')(req, res, (uploadErr) => {
    if (uploadErr) {
      return res.status(400).json({ error: uploadErr.message });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No recording file provided in request (expected field: recording)' });
    }

    const meetingId = req.params.id;
    const meeting = queryOne('SELECT * FROM meetings WHERE id = ?', [meetingId]);

    if (!meeting) {
      // Clean up uploaded file
      try { fs.unlinkSync(req.file.path); } catch (e) {}
      return res.status(404).json({ error: 'Meeting not found' });
    }

    if (meeting.status !== 'ENDED') {
      try { fs.unlinkSync(req.file.path); } catch (e) {}
      return res.status(400).json({ error: `Cannot upload recording for meeting with status ${meeting.status}. Meeting must be ENDED.` });
    }

    if (!meeting.recording_enabled) {
      try { fs.unlinkSync(req.file.path); } catch (e) {}
      return res.status(400).json({ error: 'Recording was not enabled for this meeting' });
    }

    // Magic-byte validation: reject files whose content does not match the claimed media type
    if (!hasValidMediaSignature(req.file.path, req.file.originalname)) {
      try { fs.unlinkSync(req.file.path); } catch (e) {}
      return res.status(400).json({ error: 'File content does not match a supported media type (corrupted or disguised file)' });
    }

    // Update meeting with stored recording file path
    const storedPath = req.file.path;
    execute('UPDATE meetings SET recording_file_path = ? WHERE id = ?', [storedPath, meetingId]);

    // Dispatch async Whisper + GPT-4o pipeline (non-blocking)
    processMeetingRecording(meetingId, storedPath).catch((err) => {
      console.error('[AI NOTES ERROR in /recording]', err);
    });

    return res.status(202).json({
      message: 'Recording uploaded successfully, AI transcription and notes generation started',
      file_path: storedPath,
      meeting_id: meetingId
    });
  });
});

/**
 * 11. GET /api/meetings/:id/recording (Admin, Host, or Attendee)
 * Streams the stored meeting recording file (uploads were previously write-only).
 */
router.get('/:id/recording', authenticate, (req, res) => {
  const meetingId = req.params.id;
  const meeting = queryOne('SELECT * FROM meetings WHERE id = ?', [meetingId]);

  if (!meeting) {
    return res.status(404).json({ error: 'Meeting not found' });
  }

  const isPrivileged = req.user.role === 'admin' || meeting.hosted_by === req.user.id;
  if (!isPrivileged) {
    const attendance = queryOne(
      'SELECT id FROM meeting_attendance WHERE meeting_id = ? AND user_id = ?',
      [meetingId, req.user.id]
    );
    if (!attendance) {
      return res.status(403).json({ error: 'Forbidden: Only the host, attendees or administrators can access this recording' });
    }
  }

  if (!meeting.recording_file_path) {
    return res.status(404).json({ error: 'No recording uploaded for this meeting' });
  }

  const resolved = path.resolve(meeting.recording_file_path);
  // Defense-in-depth: stored path must stay inside the uploads directory
  const uploadsRoot = path.resolve(uploadsDir);
  if (!resolved.startsWith(uploadsRoot + path.sep)) {
    return res.status(500).json({ error: 'Recording path is invalid' });
  }
  if (!fs.existsSync(resolved)) {
    return res.status(404).json({ error: 'Recording file is no longer available on disk' });
  }

  return res.sendFile(resolved);
});

export default router;
