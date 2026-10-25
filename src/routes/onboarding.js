import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { queryOne, execute } from '../db/database.js';

const router = express.Router();

/**
 * ONBOARDING CHECKLIST (functional UX)
 * Computes the member's real progress from live data — no fake state.
 * GET  / (mounted at /api/users/me/onboarding) → items + completion
 * POST /dismiss → hide the checklist card
 */

router.get('/', authenticate, (req, res) => {
  const u = queryOne('SELECT id, upi_id, github_username, onboarding_dismissed FROM users WHERE id = ?', [req.user.id]);
  if (!u) return res.status(404).json({ error: 'User not found' });

  const firstIdea = queryOne('SELECT id FROM ideas WHERE owner_id = ? LIMIT 1', [req.user.id]);
  const firstVote = queryOne('SELECT id FROM votes WHERE voter_id = ? LIMIT 1', [req.user.id]);

  const items = [
    {
      key: 'profile_upi',
      label: 'Add your payout UPI ID (Profile → Settings)',
      done: Boolean(u.upi_id),
      action: '/profile.html?tab=settings'
    },
    {
      key: 'profile_github',
      label: 'Save your GitHub username to get repo access (Profile → Settings)',
      done: Boolean(u.github_username),
      action: '/profile.html?tab=settings'
    },
    {
      key: 'first_idea',
      label: 'Submit your first idea to the voting feed',
      done: Boolean(firstIdea),
      action: '/'
    },
    {
      key: 'first_vote',
      label: 'Cast your first vote on a pending idea',
      done: Boolean(firstVote),
      action: '/'
    }
  ];

  const doneCount = items.filter((i) => i.done).length;
  return res.status(200).json({
    dismissed: u.onboarding_dismissed === 1,
    completed: doneCount === items.length,
    progress: Math.round((doneCount / items.length) * 100),
    items
  });
});

router.post('/dismiss', authenticate, (req, res) => {
  execute('UPDATE users SET onboarding_dismissed = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [req.user.id]);
  return res.status(200).json({ message: 'Checklist dismissed. It stays hidden until you clear it with the Admin.' });
});

export default router;
