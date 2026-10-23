import express from 'express';
import crypto from 'node:crypto';
import { queryOne, queryAll, execute } from '../db/database.js';
import { authenticate } from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import { consumeQuota } from '../services/quotaService.js';
import { logAccess } from '../services/auditService.js';
import { castVote, getIdeaVotingSummary } from '../services/votingService.js';
import { broadcastEvent } from '../services/wsService.js';
import { createNotification } from '../services/notificationService.js';

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

// 3. POST /api/ideas/:id/submit (Owner only - Triggers Server-Side Quota Enforcement + Review Meeting)
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

  // Fetch voting window hours from system_config (default 48 hours)
  const windowRow = queryOne("SELECT value FROM system_config WHERE key = 'voting_window_hours'");
  const windowHours = windowRow ? parseInt(windowRow.value, 10) : 48;
  const deadline = new Date(Date.now() + windowHours * 60 * 60 * 1000).toISOString();

  // Create review_meetings row
  const meetingId = crypto.randomUUID();
  execute(`
    INSERT INTO review_meetings (id, idea_id, scheduled_at, voting_window_end, status, created_at)
    VALUES (?, ?, CURRENT_TIMESTAMP, ?, 'SCHEDULED', CURRENT_TIMESTAMP)
  `, [meetingId, id, deadline]);

  // Transition to PENDING_REVIEW and set submitted_at and voting_deadline
  execute(`
    UPDATE ideas
    SET status = 'PENDING_REVIEW', submitted_at = CURRENT_TIMESTAMP, voting_deadline = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [deadline, id]);

  logAccess({
    userId: req.user.id,
    action: 'idea_submitted',
    resource: `/api/ideas/${id}/submit (meeting_id: ${meetingId}, deadline: ${deadline})`,
    ipAddress
  });

  const submittedIdea = queryOne('SELECT * FROM ideas WHERE id = ?', [id]);
  const meeting = queryOne('SELECT * FROM review_meetings WHERE id = ?', [meetingId]);

  // Broadcast new idea submission to all online team members
  broadcastEvent('org:global', 'idea.submitted', {
    id: submittedIdea.id,
    title: submittedIdea.title,
    owner_name: req.user.name,
    submitted_at: submittedIdea.submitted_at,
    voting_deadline: submittedIdea.voting_deadline
  });

  return res.status(200).json({
    message: 'Idea submitted for review successfully',
    idea: submittedIdea,
    meeting,
    quota: quotaResult
  });
});

// 4. GET /api/ideas/pending-my-vote (Authenticated - Ideas awaiting this user's vote)
// NOTE: MUST be defined before /:id route to prevent collision
router.get('/pending-my-vote', authenticate, (req, res) => {
  const currentUserId = req.user.id;

  // Active ideas in PENDING_REVIEW where owner != current user AND current user hasn't voted
  const ideas = queryAll(`
    SELECT i.id, i.owner_id, i.title, i.description, i.attachment_url,
           i.status, i.submitted_at, i.voting_deadline, i.green_percentage,
           u.name as owner_name, u.role as owner_role
    FROM ideas i
    JOIN users u ON i.owner_id = u.id
    WHERE i.status = 'PENDING_REVIEW'
      AND i.owner_id != ?
      AND i.id NOT IN (SELECT idea_id FROM votes WHERE voter_id = ?)
    ORDER BY i.submitted_at ASC
  `, [currentUserId, currentUserId]);

  return res.status(200).json({ pendingIdeas: ideas });
});

// 5. GET /api/ideas/my (Authenticated - List authenticated user's ideas)
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

// 6. POST /api/ideas/:id/vote (Non-owner only - Cast vote)
router.post('/:id/vote', authenticate, requirePermission('idea.vote'), (req, res) => {
  const ipAddress = req.ip || req.socket.remoteAddress;
  const { id } = req.params;
  const { score_feasibility, score_market, score_capacity, vote_color, comment } = req.body || {};

  const result = castVote({
    ideaId: id,
    voterId: req.user.id,
    scoreFeasibility: score_feasibility !== undefined ? parseInt(score_feasibility, 10) : null,
    scoreMarket: score_market !== undefined ? parseInt(score_market, 10) : null,
    scoreCapacity: score_capacity !== undefined ? parseInt(score_capacity, 10) : null,
    voteColor: vote_color,
    comment,
    ipAddress
  });

  if (!result.success) {
    return res.status(result.status || 400).json({ error: result.error });
  }

  return res.status(200).json({
    message: 'Vote cast successfully',
    vote: result
  });
});

// 7. GET /api/ideas/:id/votes (Authenticated - All votes & current green percentage)
router.get('/:id/votes', authenticate, (req, res) => {
  try {
    const summary = getIdeaVotingSummary(req.params.id);
    return res.status(200).json({ summary });
  } catch (err) {
    return res.status(404).json({ error: err.message });
  }
});

// 8. GET /api/ideas/:id/meeting (Authenticated - Review meeting details / deadline)
router.get('/:id/meeting', authenticate, (req, res) => {
  const meeting = queryOne(
    'SELECT * FROM review_meetings WHERE idea_id = ? ORDER BY created_at DESC LIMIT 1',
    [req.params.id]
  );

  if (!meeting) {
    return res.status(404).json({ error: 'No review meeting scheduled for this idea' });
  }

  const idea = queryOne('SELECT id, title, status, voting_deadline, green_percentage FROM ideas WHERE id = ?', [req.params.id]);

  return res.status(200).json({
    meeting,
    idea
  });
});

// 9. GET /api/ideas/:id (Authenticated - Single idea detail)
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
