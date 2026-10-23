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

/**
 * 9. GET /api/banners/active (Authenticated)
 * Cross-role notification banners for the active role per PRD Section 8
 */
router.get('/banners/active', authenticate, (req, res) => {
  const user = req.user;
  const banners = [];

  if (user.role === 'developer') {
    // Developer: "Research Ready" banner when research task is DONE
    const readyDevTasks = queryAll(`
      SELECT pt.id as task_id, pt.task_name, p.id as project_id, p.title as project_title,
             (SELECT url FROM assets WHERE project_id = p.id AND type = 'pdf_doc' ORDER BY created_at DESC LIMIT 1) as attachment_url
      FROM project_tasks pt
      JOIN projects p ON pt.project_id = p.id
      WHERE pt.assigned_to = ?
        AND pt.task_type IN ('backend', 'frontend')
        AND pt.status IN ('TODO', 'IN_PROGRESS')
        AND EXISTS (
          SELECT 1 FROM project_tasks r
          WHERE r.project_id = p.id AND r.task_type = 'research' AND r.status = 'DONE'
        )
    `, [user.id]);

    for (const t of readyDevTasks) {
      banners.push({
        id: `banner_research_${t.project_id}_${t.task_id}`,
        type: 'RESEARCH_READY',
        title: 'Research Ready',
        message: `Research for "${t.project_title}" is ready — view research attachment`,
        projectId: t.project_id,
        taskId: t.task_id,
        attachmentUrl: t.attachment_url || '#'
      });
    }
  }

  if (user.role === 'producer') {
    // Producer: "Dev Build Ready" banner when development is DONE and QA is TODO
    const readyQATasks = queryAll(`
      SELECT pt.id as task_id, pt.task_name, p.id as project_id, p.title as project_title
      FROM project_tasks pt
      JOIN projects p ON pt.project_id = p.id
      WHERE pt.assigned_to = ?
        AND pt.task_type = 'testing'
        AND pt.status IN ('TODO', 'IN_PROGRESS')
    `, [user.id]);

    for (const t of readyQATasks) {
      banners.push({
        id: `banner_build_${t.project_id}_${t.task_id}`,
        type: 'BUILD_READY',
        title: 'Dev Build Ready',
        message: `"${t.project_title}" build is ready for QA verification & testing`,
        projectId: t.project_id,
        taskId: t.task_id
      });
    }
  }

  if (user.role === 'admin') {
    // Admin: "Final Review Pending" banner for projects in ADMIN_REVIEW
    const reviewProjects = queryAll(`
      SELECT p.id as project_id, p.title as project_title
      FROM projects p
      WHERE p.current_stage = 'ADMIN_REVIEW' AND p.status = 'ACTIVE'
    `);

    for (const p of reviewProjects) {
      banners.push({
        id: `banner_review_${p.project_id}`,
        type: 'ADMIN_REVIEW_PENDING',
        title: 'Final Review Pending',
        message: `"${p.project_title}" passed all QA testing and is awaiting Final Approval`,
        projectId: p.project_id
      });
    }

    const pendingWithdrawalsCount = queryOne("SELECT COUNT(*) as count FROM withdrawals WHERE status = 'PENDING'")?.count || 0;
    if (pendingWithdrawalsCount > 0) {
      banners.push({
        id: 'banner_withdrawals_pending',
        type: 'WITHDRAWALS_PENDING',
        title: 'Pending Payouts',
        message: `${pendingWithdrawalsCount} withdrawal request(s) awaiting your manual disbursement review`,
        count: pendingWithdrawalsCount
      });
    }
  }

  if (user.role === 'researcher') {
    // Researcher: "Idea Approved" updates
    const approvedIdeas = queryAll(`
      SELECT i.id, i.title, p.id as project_id
      FROM ideas i
      LEFT JOIN projects p ON i.id = p.idea_id
      WHERE i.owner_id = ? AND i.status = 'APPROVED'
      ORDER BY i.updated_at DESC LIMIT 3
    `, [user.id]);

    for (const idea of approvedIdeas) {
      banners.push({
        id: `banner_idea_approved_${idea.id}`,
        type: 'IDEA_APPROVED',
        title: 'Idea Approved by Supermajority',
        message: `"${idea.title}" was approved by team vote and has entered parallel fan-out!`,
        ideaId: idea.id,
        projectId: idea.project_id
      });
    }
  }

  return res.status(200).json({
    count: banners.length,
    banners
  });
});

export default router;

