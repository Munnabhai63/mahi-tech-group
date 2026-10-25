import express from 'express';
import crypto from 'node:crypto';
import { authenticate } from '../middleware/auth.js';
import { queryOne, queryAll, execute } from '../db/database.js';
import { logAccess } from '../services/auditService.js';

const router = express.Router();

/**
 * PEER RATINGS — members rate teammates on shared projects (1-5, append-only).
 * Updates the ratee's rating_avg with a running average. Self-rating blocked.
 */

/**
 * POST /api/users/:id/rate (Authenticated)
 * Body: { score: 1-5, project_id: uuid, comment?: string }
 */
router.post('/:id/rate', authenticate, (req, res) => {
  const rateeId = req.params.id;
  const { score, project_id, comment } = req.body || {};
  const numericScore = Number(score);

  if (rateeId === req.user.id) {
    return res.status(400).json({ error: 'You cannot rate yourself' });
  }
  if (!Number.isInteger(numericScore) || numericScore < 1 || numericScore > 5) {
    return res.status(400).json({ error: 'Score must be an integer between 1 and 5' });
  }
  const ratee = queryOne("SELECT id, name FROM users WHERE id = ? AND status = 'active'", [rateeId]);
  if (!ratee) return res.status(404).json({ error: 'User not found' });

  if (project_id) {
    const project = queryOne('SELECT id FROM projects WHERE id = ?', [project_id]);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    const bothMembers = queryOne(`
      SELECT COUNT(*) as c FROM project_members
      WHERE project_id = ? AND user_id IN (?, ?) AND removed_at IS NULL
    `, [project_id, req.user.id, rateeId])?.c || 0;
    if (bothMembers < 2) {
      return res.status(403).json({ error: 'Forbidden: Both members must be on the same project' });
    }
    const duplicate = queryOne(
      'SELECT id FROM peer_ratings WHERE rater_id = ? AND ratee_id = ? AND project_id = ?',
      [req.user.id, rateeId, project_id]
    );
    if (duplicate) {
      return res.status(409).json({ error: 'You have already rated this member on this project' });
    }
  }

  execute(`
    INSERT INTO peer_ratings (id, rater_id, ratee_id, project_id, score, comment, created_at)
    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `, [crypto.randomUUID(), req.user.id, rateeId, project_id || null, numericScore, comment ? String(comment).slice(0, 500) : null]);

  // Recompute running average
  const avg = queryOne('SELECT AVG(score) as avg FROM peer_ratings WHERE ratee_id = ?', [rateeId]);
  execute('UPDATE users SET rating_avg = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [Number(avg.avg).toFixed(2), rateeId]);

  logAccess({
    userId: req.user.id,
    action: 'peer_rating_submitted',
    resource: `/api/users/${rateeId}/rate (score: ${numericScore}${project_id ? ', project: ' + project_id : ''})`,
    ipAddress: req.ip
  });

  return res.status(201).json({
    message: `Rating submitted for ${ratee.name}`,
    ratee: { id: rateeId, name: ratee.name, rating_avg: Number(avg.avg).toFixed(2) }
  });
});

/**
 * GET /api/users/me/ratings-given (Authenticated)
 */
router.get('/me/ratings-given', authenticate, (req, res) => {
  const ratings = queryAll(`
    SELECT pr.*, u.name as ratee_name, p.title as project_title
    FROM peer_ratings pr
    JOIN users u ON pr.ratee_id = u.id
    LEFT JOIN projects p ON pr.project_id = p.id
    WHERE pr.rater_id = ?
    ORDER BY pr.created_at DESC
  `, [req.user.id]);
  return res.status(200).json({ count: ratings.length, ratings });
});

export default router;
