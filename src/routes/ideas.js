import express from 'express';
import crypto from 'node:crypto';
import { queryOne, queryAll, execute } from '../db/database.js';
import { authenticate } from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import { consumeQuota } from '../services/quotaService.js';
import { logAccess } from '../services/auditService.js';

const router = express.Router();

// 1. POST /api/ideas/draft (All authenticated roles with idea.submit permission)
router.post('/draft', authenticate, requirePermission('idea.submit'), (req, res) => {
  const ipAddress = req.ip || req.socket.remoteAddress;
  const { title, description, attachment_url } = req.body || {};

  if (!title || typeof title !== 'string' || !title.trim()) {
    return res.status(400).json({ error: 'Idea title is required' });
  }

  if (!description || typeof description !== 'string' || !description.trim()) {
    return res.status(400).json({ error: 'Idea description is required' });
  }

  const ideaId = crypto.randomUUID();

  execute(`
    INSERT INTO ideas (
      id, owner_id, title, description, attachment_url,
      status, green_percentage, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'DRAFT', 0.0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `, [
    ideaId,
    req.user.id,
    title.trim(),
    description.trim(),
    attachment_url || null
  ]);

  logAccess({
    userId: req.user.id,
    action: 'idea_draft_created',
    resource: `/api/ideas/draft (idea_id: ${ideaId})`,
    ipAddress
  });

  const createdIdea = queryOne('SELECT * FROM ideas WHERE id = ?', [ideaId]);

  return res.status(201).json({
    message: 'Draft saved successfully (No quota consumed)',
    idea: createdIdea
  });
});

// 2. PATCH /api/ideas/:id/draft (Owner only)
router.patch('/:id/draft', authenticate, (req, res) => {
  const ipAddress = req.ip || req.socket.remoteAddress;
  const { id } = req.params;
  const { title, description, attachment_url } = req.body || {};

  const idea = queryOne('SELECT * FROM ideas WHERE id = ?', [id]);
  if (!idea) {
    return res.status(404).json({ error: 'Idea not found' });
  }

  if (idea.owner_id !== req.user.id) {
    return res.status(403).json({ error: 'Forbidden: Only the idea owner can edit this draft' });
  }

  if (idea.status !== 'DRAFT') {
    return res.status(400).json({
      error: `Cannot edit draft. Current idea status is '${idea.status}' (only 'DRAFT' status can be modified via draft endpoint)`
    });
  }

  const updatedTitle = title !== undefined ? title.trim() : idea.title;
  const updatedDesc = description !== undefined ? description.trim() : idea.description;
  const updatedAttachment = attachment_url !== undefined ? attachment_url : idea.attachment_url;

  execute(`
    UPDATE ideas
    SET title = ?, description = ?, attachment_url = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [updatedTitle, updatedDesc, updatedAttachment, id]);

  logAccess({
    userId: req.user.id,
    action: 'idea_draft_updated',
    resource: `/api/ideas/${id}/draft`,
    ipAddress
  });

  const updatedIdea = queryOne('SELECT * FROM ideas WHERE id = ?', [id]);

  return res.status(200).json({
    message: 'Draft updated successfully',
    idea: updatedIdea
  });
});

// 3. POST /api/ideas/:id/submit (Owner only - Triggers Server-Side Quota Enforcement)
router.post('/:id/submit', authenticate, requirePermission('idea.submit'), (req, res) => {
  const ipAddress = req.ip || req.socket.remoteAddress;
  const { id } = req.params;

  const idea = queryOne('SELECT * FROM ideas WHERE id = ?', [id]);
  if (!idea) {
    return res.status(404).json({ error: 'Idea not found' });
  }

  if (idea.owner_id !== req.user.id) {
    return res.status(403).json({ error: 'Forbidden: Only the idea owner can submit this idea' });
  }

  if (idea.status !== 'DRAFT') {
    return res.status(400).json({
      error: `Idea cannot be submitted. Current status is already '${idea.status}'`
    });
  }

  // Server-Side Quota Check & Deduction
  const quotaResult = consumeQuota(req.user.id, idea.id);
  if (!quotaResult.success) {
    logAccess({
      userId: req.user.id,
      action: 'idea_submission_blocked_quota_exhausted',
      resource: `/api/ideas/${id}/submit`,
      ipAddress
    });

    return res.status(quotaResult.status || 403).json({
      error: quotaResult.error,
      quotaUsed: quotaResult.quotaUsed,
      quotaLimit: quotaResult.quotaLimit,
      resetDate: quotaResult.resetDate
    });
  }

  // Transition to PENDING_REVIEW and record submitted_at
  execute(`
    UPDATE ideas
    SET status = 'PENDING_REVIEW', submitted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [id]);

  logAccess({
    userId: req.user.id,
    action: 'idea_submitted',
    resource: `/api/ideas/${id}/submit`,
    ipAddress
  });

  const submittedIdea = queryOne('SELECT * FROM ideas WHERE id = ?', [id]);

  return res.status(200).json({
    message: 'Idea submitted for review successfully',
    idea: submittedIdea,
    quota: quotaResult
  });
});

// 4. GET /api/ideas/my (Authenticated - List authenticated user's ideas)
router.get('/my', authenticate, (req, res) => {
  const ideas = queryAll(`
    SELECT id, owner_id, title, description, attachment_url,
           status, submitted_at, voting_deadline, green_percentage,
           created_at, updated_at
    FROM ideas
    WHERE owner_id = ?
    ORDER BY created_at DESC
  `, [req.user.id]);

  return res.status(200).json({ ideas });
});

// 5. GET /api/ideas/:id (Authenticated - Single idea detail)
router.get('/:id', authenticate, (req, res) => {
  const { id } = req.params;

  const idea = queryOne(`
    SELECT i.*, u.name as owner_name, u.email as owner_email, u.role as owner_role
    FROM ideas i
    JOIN users u ON i.owner_id = u.id
    WHERE i.id = ?
  `, [id]);

  if (!idea) {
    return res.status(404).json({ error: 'Idea not found' });
  }

  return res.status(200).json({ idea });
});

export default router;
