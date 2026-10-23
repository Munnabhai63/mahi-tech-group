import express from 'express';
import { authenticate } from '../middleware/auth.js';
import {
  getDashboardSummary,
  getKanbanProjects,
  getPendingVotesFeed
} from '../services/dashboardService.js';
import {
  createNotification,
  getUserNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  getRecentActivityTicker
} from '../services/notificationService.js';

const router = express.Router();

/**
 * 1. GET /api/dashboard/summary (Authenticated)
 * Returns Quick Stats Bar metrics (projects, votes, quota, presence, wallet)
 */
router.get('/summary', authenticate, (req, res) => {
  const summary = getDashboardSummary(req.user);
  return res.status(200).json(summary);
});

/**
 * 2. GET /api/dashboard/kanban (Authenticated)
 * Returns projects grouped by stage for the Center Kanban Board
 */
router.get('/kanban', authenticate, (req, res) => {
  const kanban = getKanbanProjects(req.user);
  return res.status(200).json(kanban);
});

/**
 * 3. GET /api/dashboard/votes-feed (Authenticated)
 * Returns pending review ideas with live green percentages
 */
router.get('/votes-feed', authenticate, (req, res) => {
  const feed = getPendingVotesFeed(req.user);
  return res.status(200).json({
    count: feed.length,
    ideas: feed
  });
});

/**
 * 4. GET /api/notifications/my (Authenticated)
 * Chronological notifications list for current user
 */
router.get('/notifications/my', authenticate, (req, res) => {
  const { limit, unread_only } = req.query;
  const result = getUserNotifications(req.user.id, {
    limit: limit ? Number(limit) : 50,
    unreadOnly: unread_only === 'true'
  });
  return res.status(200).json(result);
});

/**
 * 5. PATCH /api/notifications/:id/read (Authenticated)
 * Marks a notification as read
 */
router.patch('/notifications/:id/read', authenticate, (req, res) => {
  const result = markNotificationAsRead(req.params.id, req.user.id);
  if (!result.success) {
    return res.status(result.status || 400).json({ error: result.error });
  }
  return res.status(200).json(result);
});

/**
 * 6. POST /api/notifications/mark-all-read (Authenticated)
 * Marks all notifications as read for current user
 */
router.post('/notifications/mark-all-read', authenticate, (req, res) => {
  const result = markAllNotificationsAsRead(req.user.id);
  return res.status(200).json(result);
});

/**
 * 7. GET /api/activity/recent (Authenticated)
 * Team activity ticker feed
 */
router.get('/activity/recent', authenticate, (req, res) => {
  const limit = req.query.limit ? Number(req.query.limit) : 20;
  const activities = getRecentActivityTicker(limit);
  return res.status(200).json({
    count: activities.length,
    activities
  });
});

/**
 * 8. POST /api/notifications/send (Authenticated)
 * Broadcasts a new notification through the server process
 */
router.post('/notifications/send', authenticate, (req, res) => {
  const { user_id, event_type, message, link } = req.body || {};
  if (!user_id || !event_type || !message) {
    return res.status(400).json({ error: 'user_id, event_type, and message are required' });
  }

  const notification = createNotification({
    userId: user_id,
    eventType: event_type,
    message,
    link
  });

  return res.status(201).json({
    message: 'Notification sent and broadcast successfully',
    notification
  });
});

export default router;
