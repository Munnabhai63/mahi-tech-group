import crypto from 'node:crypto';
import { queryOne, queryAll, execute } from '../db/database.js';
import { pushToUser, pushToGlobal } from './wsService.js';

/**
 * Persists a notification to the database and pushes real-time WebSocket event
 */
// Types a member may mute. Critical financial/account events stay unmutable.
export const MUTABLE_NOTIFICATION_TYPES = [
  'voting_reminder',
  'task.unblocked',
  'task.comment',
  'meeting_scheduled',
  'meeting_started',
  'project_progress',
  'ai_notes_ready_for_review',
  'github_pr_sync'
];

function isMutedFor(userId, eventType) {
  const row = queryOne('SELECT notification_prefs FROM users WHERE id = ?', [userId]);
  if (!row || !row.notification_prefs) return false;
  try {
    const prefs = JSON.parse(row.notification_prefs);
    return Array.isArray(prefs.muted_types) && prefs.muted_types.includes(eventType);
  } catch {
    return false;
  }
}

export function createNotification({ userId, eventType, message, link = null }) {
  if (!userId || !eventType || !message) {
    throw new Error('userId, eventType, and message are required for notification');
  }

  // Respect member notification preferences (critical types are never muted)
  if (MUTABLE_NOTIFICATION_TYPES.includes(eventType) && isMutedFor(userId, eventType)) {
    return null;
  }

  const id = crypto.randomUUID();
  execute(`
    INSERT INTO notifications (id, user_id, event_type, message, link, read_status, created_at)
    VALUES (?, ?, ?, ?, ?, 0, CURRENT_TIMESTAMP)
  `, [id, userId, eventType, message, link]);

  const createdNotification = queryOne('SELECT * FROM notifications WHERE id = ?', [id]);

  // Push immediate real-time alert to the specific user
  pushToUser(userId, 'notification.new', createdNotification);

  // Broadcast to global activity ticker
  pushToGlobal('activity.new', {
    id: createdNotification.id,
    type: eventType,
    message: createdNotification.message,
    timestamp: createdNotification.created_at
  });

  return createdNotification;
}

/**
 * Fetch notifications for a user
 */
export function getUserNotifications(userId, { limit = 50, unreadOnly = false } = {}) {
  let query = 'SELECT * FROM notifications WHERE user_id = ?';
  const params = [userId];

  if (unreadOnly) {
    query += ' AND read_status = 0';
  }

  query += ' ORDER BY created_at DESC LIMIT ?';
  params.push(Number(limit) || 50);

  const notifications = queryAll(query, params);
  const unreadCountRow = queryOne('SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND read_status = 0', [userId]);

  return {
    unreadCount: unreadCountRow ? Number(unreadCountRow.count) : 0,
    notifications
  };
}

/**
 * Mark a single notification as read
 */
export function markNotificationAsRead(notificationId, userId) {
  const existing = queryOne('SELECT * FROM notifications WHERE id = ? AND user_id = ?', [notificationId, userId]);
  if (!existing) {
    return { success: false, status: 404, error: 'Notification not found' };
  }

  execute('UPDATE notifications SET read_status = 1 WHERE id = ? AND user_id = ?', [notificationId, userId]);
  return { success: true, message: 'Notification marked as read' };
}

/**
 * Mark all notifications as read for a user
 */
export function markAllNotificationsAsRead(userId) {
  execute('UPDATE notifications SET read_status = 1 WHERE user_id = ?', [userId]);
  return { success: true, message: 'All notifications marked as read' };
}

/**
 * Fetch recent team activity ticker feed
 */
export function getRecentActivityTicker(limit = 20) {
  const activities = queryAll(`
    SELECT n.id, n.event_type, n.message, n.created_at, u.name as user_name, u.role as user_role
    FROM notifications n
    JOIN users u ON n.user_id = u.id
    ORDER BY n.created_at DESC
    LIMIT ?
  `, [limit]);

  return activities;
}
