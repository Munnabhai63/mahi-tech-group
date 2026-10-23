import crypto from 'node:crypto';
import { queryOne, queryAll, execute } from '../db/database.js';
import { broadcastEvent, pushToUser } from './wsService.js';
import { logAccess } from './auditService.js';
import { processMeetingRecording } from './aiNotesService.js';

/**
 * Schedule a new meeting (Admin only)
 */
export function scheduleMeeting({
  title,
  meetingType = 'ad_hoc',
  linkedIdeaId = null,
  linkedProjectId = null,
  scheduledAt = null,
  recordingEnabled = false,
  hostedBy,
  ipAddress = null
}) {
  const host = queryOne('SELECT id, name, role FROM users WHERE id = ?', [hostedBy]);
  if (!host || host.role !== 'admin') {
    return { success: false, status: 403, error: 'Forbidden: Only administrators can schedule meetings' };
  }

  if (!title || !title.trim()) {
    return { success: false, status: 400, error: 'Meeting title is required' };
  }

  const validTypes = ['ad_hoc', 'idea_review'];
  if (!validTypes.includes(meetingType)) {
    return { success: false, status: 400, error: `Invalid meeting_type. Must be one of: ${validTypes.join(', ')}` };
  }

  if (meetingType === 'idea_review' && linkedIdeaId) {
    const idea = queryOne('SELECT id FROM ideas WHERE id = ?', [linkedIdeaId]);
    if (!idea) {
      return { success: false, status: 404, error: 'Linked idea not found' };
    }
  }

  if (linkedProjectId) {
    const project = queryOne('SELECT id FROM projects WHERE id = ?', [linkedProjectId]);
    if (!project) {
      return { success: false, status: 404, error: 'Linked project not found' };
    }
  }

  const meetingId = crypto.randomUUID();
  const jitsiRoomName = `MTG_${crypto.randomBytes(12).toString('hex')}`;
  const jitsiPassword = `MTG_Pass_${crypto.randomBytes(6).toString('hex')}`;
  const recEnabled = (recordingEnabled === true || recordingEnabled === 1 || recordingEnabled === 'true' || recordingEnabled === '1') ? 1 : 0;
  const schedTime = scheduledAt || new Date().toISOString();

  execute(`
    INSERT INTO meetings (
      id, title, meeting_type, linked_idea_id, linked_project_id,
      hosted_by, jitsi_room_name, jitsi_password, recording_enabled,
      scheduled_at, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'SCHEDULED', CURRENT_TIMESTAMP)
  `, [
    meetingId,
    title.trim(),
    meetingType,
    linkedIdeaId || null,
    linkedProjectId || null,
    hostedBy,
    jitsiRoomName,
    jitsiPassword,
    recEnabled,
    schedTime
  ]);

  logAccess({
    userId: hostedBy,
    action: 'meeting_scheduled',
    resource: `/api/meetings/${meetingId} (type: ${meetingType}, title: ${title})`,
    ipAddress
  });

  // 1. Broadcast WebSocket event meeting:scheduled
  broadcastEvent('org:global', 'meeting:scheduled', {
    meeting_id: meetingId,
    title: title.trim(),
    scheduled_at: schedTime,
    hosted_by: hostedBy,
    meeting_type: meetingType,
    linked_idea_id: linkedIdeaId || null
  });

  // 2. Insert persistent notifications for all active team members
  const activeUsers = queryAll("SELECT id FROM users WHERE status = 'active'");
  for (const u of activeUsers) {
    const notifId = crypto.randomUUID();
    const notifMsg = `Meeting "${title.trim()}" scheduled for ${new Date(schedTime).toLocaleString()}`;
    execute(`
      INSERT INTO notifications (id, user_id, event_type, message, link, read_status, created_at)
      VALUES (?, ?, 'meeting_scheduled', ?, ?, 0, CURRENT_TIMESTAMP)
    `, [notifId, u.id, notifMsg, `/dashboard.html#meeting-${meetingId}`]);
  }

  const created = queryOne('SELECT * FROM meetings WHERE id = ?', [meetingId]);
  return { success: true, status: 201, meeting: created };
}

/**
 * Start a scheduled meeting (SCHEDULED -> LIVE, Admin only)
 */
export function startMeeting({ meetingId, userId, ipAddress = null }) {
  const admin = queryOne('SELECT id, role FROM users WHERE id = ?', [userId]);
  if (!admin || admin.role !== 'admin') {
    return { success: false, status: 403, error: 'Forbidden: Only administrators can start meetings' };
  }

  const meeting = queryOne('SELECT * FROM meetings WHERE id = ?', [meetingId]);
  if (!meeting) {
    return { success: false, status: 404, error: 'Meeting not found' };
  }

  if (meeting.status !== 'SCHEDULED') {
    return { success: false, status: 400, error: `Cannot start meeting with status ${meeting.status}. Must be SCHEDULED.` };
  }

  execute(`
    UPDATE meetings
    SET status = 'LIVE', started_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [meetingId]);

  logAccess({
    userId,
    action: 'meeting_started',
    resource: `/api/meetings/${meetingId}/start`,
    ipAddress
  });

  // 1. Broadcast WebSocket event meeting:started to ALL active members
  broadcastEvent('org:global', 'meeting:started', {
    meeting_id: meetingId,
    title: meeting.title,
    jitsi_room_name: meeting.jitsi_room_name,
    jitsi_password: meeting.jitsi_password,
    meeting_type: meeting.meeting_type,
    linked_idea_id: meeting.linked_idea_id
  });

  // 2. Insert persistent DB notification for all active members
  const activeUsers = queryAll("SELECT id FROM users WHERE status = 'active'");
  for (const u of activeUsers) {
    const notifId = crypto.randomUUID();
    const notifMsg = `"${meeting.title}" is now LIVE — Join now`;
    execute(`
      INSERT INTO notifications (id, user_id, event_type, message, link, read_status, created_at)
      VALUES (?, ?, 'meeting_live', ?, ?, 0, CURRENT_TIMESTAMP)
    `, [notifId, u.id, notifMsg, `/dashboard.html#meeting-${meetingId}`]);
  }

  const updated = queryOne('SELECT * FROM meetings WHERE id = ?', [meetingId]);
  return { success: true, status: 200, meeting: updated };
}

/**
 * End a live meeting (LIVE -> ENDED, Admin only)
 */
export function endMeeting({ meetingId, userId, ipAddress = null }) {
  const admin = queryOne('SELECT id, role FROM users WHERE id = ?', [userId]);
  if (!admin || admin.role !== 'admin') {
    return { success: false, status: 403, error: 'Forbidden: Only administrators can end meetings' };
  }

  const meeting = queryOne('SELECT * FROM meetings WHERE id = ?', [meetingId]);
  if (!meeting) {
    return { success: false, status: 404, error: 'Meeting not found' };
  }

  if (meeting.status !== 'LIVE') {
    return { success: false, status: 400, error: `Cannot end meeting with status ${meeting.status}. Must be LIVE.` };
  }

  // 1. Populate missing left_at in meeting_attendance for all participants still active
  execute(`
    UPDATE meeting_attendance
    SET left_at = CURRENT_TIMESTAMP
    WHERE meeting_id = ? AND left_at IS NULL
  `, [meetingId]);

  // 2. Update meeting status to ENDED
  execute(`
    UPDATE meetings
    SET status = 'ENDED', ended_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [meetingId]);

  logAccess({
    userId,
    action: 'meeting_ended',
    resource: `/api/meetings/${meetingId}/end`,
    ipAddress
  });

  const notesAvailable = Boolean(meeting.recording_enabled && meeting.recording_file_path);

  // 3. Broadcast WebSocket event meeting:ended to org:global
  broadcastEvent('org:global', 'meeting:ended', {
    meeting_id: meetingId,
    ended_at: new Date().toISOString(),
    notes_available: notesAvailable
  });

  // 4. If recording was enabled AND recording file already exists, trigger async AI pipeline
  if (meeting.recording_enabled && meeting.recording_file_path) {
    processMeetingRecording(meetingId, meeting.recording_file_path).catch((err) => {
      console.error('[AI NOTES ASYNC ERROR]', err);
    });
  }

  const updated = queryOne('SELECT * FROM meetings WHERE id = ?', [meetingId]);
  return {
    success: true,
    status: 200,
    message: 'Meeting ended successfully',
    meeting: updated
  };
}

/**
 * Cancel a scheduled meeting (SCHEDULED -> CANCELLED, Admin only)
 */
export function cancelMeeting({ meetingId, userId, ipAddress = null }) {
  const admin = queryOne('SELECT id, role FROM users WHERE id = ?', [userId]);
  if (!admin || admin.role !== 'admin') {
    return { success: false, status: 403, error: 'Forbidden: Only administrators can cancel meetings' };
  }

  const meeting = queryOne('SELECT * FROM meetings WHERE id = ?', [meetingId]);
  if (!meeting) {
    return { success: false, status: 404, error: 'Meeting not found' };
  }

  if (meeting.status !== 'SCHEDULED') {
    return { success: false, status: 400, error: `Cannot cancel meeting with status ${meeting.status}. Must be SCHEDULED.` };
  }

  execute(`
    UPDATE meetings
    SET status = 'CANCELLED'
    WHERE id = ?
  `, [meetingId]);

  logAccess({
    userId,
    action: 'meeting_cancelled',
    resource: `/api/meetings/${meetingId}/cancel`,
    ipAddress
  });

  broadcastEvent('org:global', 'meeting:ended', {
    meeting_id: meetingId,
    status: 'CANCELLED',
    ended_at: new Date().toISOString(),
    notes_available: false
  });

  const updated = queryOne('SELECT * FROM meetings WHERE id = ?', [meetingId]);
  return { success: true, status: 200, meeting: updated };
}

/**
 * In-app join flow (Active members)
 */
export function joinMeeting({ meetingId, userId, ipAddress = null }) {
  const user = queryOne('SELECT id, name, role, status FROM users WHERE id = ?', [userId]);
  if (!user || user.status !== 'active') {
    return { success: false, status: 403, error: 'Forbidden: Active account required to join meetings' };
  }

  const meeting = queryOne('SELECT * FROM meetings WHERE id = ?', [meetingId]);
  if (!meeting) {
    return { success: false, status: 404, error: 'Meeting not found' };
  }

  if (meeting.status !== 'LIVE') {
    return { success: false, status: 400, error: 'Meeting is not currently live' };
  }

  // Record attendance
  const attendanceId = crypto.randomUUID();
  execute(`
    INSERT INTO meeting_attendance (id, meeting_id, user_id, joined_at, left_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP, NULL)
  `, [attendanceId, meetingId, userId]);

  logAccess({
    userId,
    action: 'meeting_joined',
    resource: `/api/meetings/${meetingId}/join (attendance_id: ${attendanceId})`,
    ipAddress
  });

  // Broadcast WebSocket event meeting:user_joined
  broadcastEvent('org:global', 'meeting:user_joined', {
    meeting_id: meetingId,
    user_id: user.id,
    user_name: user.name,
    joined_at: new Date().toISOString()
  });

  // Retrieve jitsi_domain from system_config (default 'meet.jit.si')
  const domainRow = queryOne("SELECT value FROM system_config WHERE key = 'jitsi_domain'");
  const jitsiDomain = domainRow ? domainRow.value : 'meet.jit.si';

  return {
    success: true,
    status: 200,
    meeting: {
      id: meeting.id,
      title: meeting.title,
      meeting_type: meeting.meeting_type,
      linked_idea_id: meeting.linked_idea_id,
      linked_project_id: meeting.linked_project_id,
      hosted_by: meeting.hosted_by,
      jitsi_room_name: meeting.jitsi_room_name,
      jitsi_password: meeting.jitsi_password,
      jitsi_domain: jitsiDomain,
      recording_enabled: meeting.recording_enabled,
      split_screen: meeting.meeting_type === 'idea_review'
    }
  };
}

/**
 * In-app leave flow (Active members)
 */
export function leaveMeeting({ meetingId, userId, ipAddress = null }) {
  const meeting = queryOne('SELECT * FROM meetings WHERE id = ?', [meetingId]);
  if (!meeting) {
    return { success: false, status: 404, error: 'Meeting not found' };
  }

  // Update left_at for the user's active session in this meeting
  const now = new Date().toISOString();
  execute(`
    UPDATE meeting_attendance
    SET left_at = CURRENT_TIMESTAMP
    WHERE meeting_id = ? AND user_id = ? AND left_at IS NULL
  `, [meetingId, userId]);

  logAccess({
    userId,
    action: 'meeting_left',
    resource: `/api/meetings/${meetingId}/leave`,
    ipAddress
  });

  // Broadcast WebSocket event meeting:user_left
  broadcastEvent('org:global', 'meeting:user_left', {
    meeting_id: meetingId,
    user_id: userId,
    left_at: now
  });

  return { success: true, status: 200, message: 'Left meeting successfully' };
}

/**
 * List meetings (Active members)
 */
export function listMeetings({ userId }) {
  const meetings = queryAll(`
    SELECT m.*, u.name as host_name,
      (SELECT COUNT(DISTINCT user_id) FROM meeting_attendance WHERE meeting_id = m.id) as attendee_count,
      (SELECT COUNT(*) FROM meeting_notes WHERE meeting_id = m.id AND confirmed_at IS NOT NULL) as has_confirmed_notes
    FROM meetings m
    JOIN users u ON m.hosted_by = u.id
    ORDER BY m.created_at DESC
  `);

  return { success: true, status: 200, meetings };
}

/**
 * Get single meeting detail + attendance roster (Active members)
 */
export function getMeetingDetails({ meetingId, userId }) {
  const meeting = queryOne(`
    SELECT m.*, u.name as host_name,
      (SELECT COUNT(DISTINCT user_id) FROM meeting_attendance WHERE meeting_id = m.id) as attendee_count,
      (SELECT COUNT(*) FROM meeting_notes WHERE meeting_id = m.id AND confirmed_at IS NOT NULL) as has_confirmed_notes
    FROM meetings m
    JOIN users u ON m.hosted_by = u.id
    WHERE m.id = ?
  `, [meetingId]);

  if (!meeting) {
    return { success: false, status: 404, error: 'Meeting not found' };
  }

  const attendance = queryAll(`
    SELECT ma.*, u.name as user_name, u.role as user_role, u.profile_photo_url
    FROM meeting_attendance ma
    JOIN users u ON ma.user_id = u.id
    WHERE ma.meeting_id = ?
    ORDER BY ma.joined_at ASC
  `, [meetingId]);

  return { success: true, status: 200, meeting, attendance };
}

/**
 * Get confirmed meeting notes (Participants or Admin only)
 */
export function getMeetingNotes({ meetingId, userId }) {
  const user = queryOne('SELECT id, role FROM users WHERE id = ?', [userId]);
  if (!user) {
    return { success: false, status: 401, error: 'Unauthorized' };
  }

  const meeting = queryOne('SELECT * FROM meetings WHERE id = ?', [meetingId]);
  if (!meeting) {
    return { success: false, status: 404, error: 'Meeting not found' };
  }

  // If user is not admin, verify they were an attendee
  if (user.role !== 'admin') {
    const attended = queryOne('SELECT id FROM meeting_attendance WHERE meeting_id = ? AND user_id = ?', [meetingId, userId]);
    if (!attended) {
      return { success: false, status: 403, error: 'Forbidden: Only meeting participants or administrators can view notes' };
    }
  }

  const notes = queryOne('SELECT * FROM meeting_notes WHERE meeting_id = ?', [meetingId]);
  if (!notes || !notes.confirmed_at) {
    return { success: false, status: 404, error: 'Confirmed meeting notes not found or still pending admin review' };
  }

  return {
    success: true,
    status: 200,
    notes: {
      id: notes.id,
      meeting_id: notes.meeting_id,
      notes_hindi: notes.notes_hindi,
      notes_english: notes.notes_english,
      transcript_raw: notes.transcript_raw,
      ai_model_used: notes.ai_model_used,
      generated_at: notes.generated_at,
      confirmed_at: notes.confirmed_at
    }
  };
}

/**
 * Confirm / Edit AI meeting notes (Admin only)
 */
export function confirmMeetingNotes({
  meetingId,
  adminUserId,
  notesHindi = null,
  notesEnglish = null,
  transcriptRaw = null,
  ipAddress = null
}) {
  const admin = queryOne('SELECT id, role FROM users WHERE id = ?', [adminUserId]);
  if (!admin || admin.role !== 'admin') {
    return { success: false, status: 403, error: 'Forbidden: Only administrators can confirm meeting notes' };
  }

  const meeting = queryOne('SELECT * FROM meetings WHERE id = ?', [meetingId]);
  if (!meeting) {
    return { success: false, status: 404, error: 'Meeting not found' };
  }

  const existingNotes = queryOne('SELECT * FROM meeting_notes WHERE meeting_id = ?', [meetingId]);
  if (!existingNotes) {
    return { success: false, status: 404, error: 'Meeting notes draft not found' };
  }

  execute(`
    UPDATE meeting_notes
    SET notes_hindi = COALESCE(?, notes_hindi),
        notes_english = COALESCE(?, notes_english),
        transcript_raw = COALESCE(?, transcript_raw),
        confirmed_by = ?,
        confirmed_at = CURRENT_TIMESTAMP
    WHERE meeting_id = ?
  `, [
    notesHindi || null,
    notesEnglish || null,
    transcriptRaw || null,
    adminUserId,
    meetingId
  ]);

  logAccess({
    userId: adminUserId,
    action: 'meeting_notes_confirmed',
    resource: `/api/admin/meetings/${meetingId}/notes/confirm`,
    ipAddress
  });

  // Query all participants who attended this meeting
  const attendees = queryAll('SELECT DISTINCT user_id FROM meeting_attendance WHERE meeting_id = ?', [meetingId]);

  // Broadcast meeting:notes_ready ONLY to meeting participants
  for (const att of attendees) {
    pushToUser(att.user_id, 'meeting:notes_ready', {
      meeting_id: meetingId,
      title: meeting.title
    });

    const notifId = crypto.randomUUID();
    const notifMsg = `Notes for meeting "${meeting.title}" are now available for review (Hindi & English)`;
    execute(`
      INSERT INTO notifications (id, user_id, event_type, message, link, read_status, created_at)
      VALUES (?, ?, 'meeting_notes_ready', ?, ?, 0, CURRENT_TIMESTAMP)
    `, [notifId, att.user_id, notifMsg, `/dashboard.html#meeting-${meetingId}`]);
  }

  const confirmedNotes = queryOne('SELECT * FROM meeting_notes WHERE meeting_id = ?', [meetingId]);
  return {
    success: true,
    status: 200,
    message: 'Meeting notes confirmed and published to participants',
    notes: confirmedNotes
  };
}

/**
 * Step 05 Killswitch helper: Eject user from any active meetings
 */
export function ejectUserFromActiveMeetings(userId) {
  try {
    const updated = execute(`
      UPDATE meeting_attendance
      SET left_at = CURRENT_TIMESTAMP
      WHERE user_id = ? AND left_at IS NULL
    `, [userId]);
    return updated.changes || 0;
  } catch (err) {
    console.error(`[KILLSWITCH EJECT ERROR] Failed to close attendance for user ${userId}:`, err.message);
    return 0;
  }
}
