import express from 'express';
import crypto from 'node:crypto';
import { authenticate } from '../middleware/auth.js';
import { queryOne, queryAll, execute } from '../db/database.js';
import { pushToProject } from '../services/wsService.js';
import { logAccess } from '../services/auditService.js';

const router = express.Router();

/**
 * PROJECT CHAT — real-time per-project messaging.
 * REST for history/post, WebSocket pushToProject('chat.message') for live sync.
 * Access: project members + admin (same guard as task comments).
 */

function isProjectMember(projectId, userId) {
  return Boolean(queryOne(
    'SELECT id FROM project_members WHERE project_id = ? AND user_id = ? AND removed_at IS NULL',
    [projectId, userId]
  ));
}

function canAccess(project, user) {
  if (user.role === 'admin') return true;
  if (project.owner_id === user.id) return true;
  return isProjectMember(project.id, user.id);
}

/**
 * GET /api/projects/:id/chat?limit=100 (Member/Admin)
 */
router.get('/:id/chat', authenticate, (req, res) => {
  const project = queryOne('SELECT * FROM projects WHERE id = ?', [req.params.id]);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  if (!canAccess(project, req.user)) {
    return res.status(403).json({ error: 'Forbidden: You are not a member of this project' });
  }
  const limit = Math.min(Number(req.query.limit) || 100, 200);
  const messages = queryAll(`
    SELECT cm.*, u.name as author_name, u.role as author_role
    FROM chat_messages cm JOIN users u ON cm.user_id = u.id
    WHERE cm.project_id = ?
    ORDER BY cm.created_at DESC LIMIT ?
  `, [project.id, limit]);
  return res.status(200).json({ count: messages.length, messages: messages.reverse() });
});

/**
 * POST /api/projects/:id/chat (Member/Admin)
 */
router.post('/:id/chat', authenticate, (req, res) => {
  const project = queryOne('SELECT * FROM projects WHERE id = ?', [req.params.id]);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  if (!canAccess(project, req.user)) {
    return res.status(403).json({ error: 'Forbidden: You are not a member of this project' });
  }

  const body = String((req.body || {}).body || '').trim();
  if (!body) return res.status(400).json({ error: 'Message body is required' });
  if (body.length > 2000) return res.status(400).json({ error: 'Message too long (max 2000 characters)' });

  const id = crypto.randomUUID();
  execute(`
    INSERT INTO chat_messages (id, project_id, user_id, body, created_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
  `, [id, project.id, req.user.id, body]);

  const message = queryOne(`
    SELECT cm.*, u.name as author_name, u.role as author_role
    FROM chat_messages cm JOIN users u ON cm.user_id = u.id
    WHERE cm.id = ?
  `, [id]);

  // Real-time broadcast to every member's open socket in this project room
  pushToProject(project.id, 'chat.message', {
    id: message.id,
    project_id: project.id,
    user_id: message.user_id,
    author_name: message.author_name,
    body: message.body,
    created_at: message.created_at
  });

  logAccess({
    userId: req.user.id,
    action: 'chat_message_sent',
    resource: `/api/projects/${project.id}/chat (${body.length} chars)`,
    ipAddress: req.ip
  });

  return res.status(201).json({ message });
});

export default router;
