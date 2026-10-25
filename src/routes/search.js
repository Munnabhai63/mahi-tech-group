import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { queryAll } from '../db/database.js';

const router = express.Router();

/**
 * GET /api/search?q=... (Authenticated)
 * Global search across ideas, projects, tasks and members — role-filtered.
 * Powers the Cmd+K command palette. Returns top 6 results per category.
 */
router.get('/', authenticate, (req, res) => {
  const q = String((req.query.q || '')).trim();
  if (q.length < 2) {
    return res.status(200).json({ query: q, ideas: [], projects: [], tasks: [], members: [] });
  }
  const like = `%${q.replace(/[%_]/g, '')}%`;
  const uid = req.user.id;
  const isAdmin = req.user.role === 'admin';

  // Ideas: owner or any active member can see the voting feed
  const ideas = queryAll(`
    SELECT id, title, status FROM ideas
    WHERE (title LIKE ? OR description LIKE ?)
      AND status NOT IN ('killed','KILLED','archived')
    ORDER BY created_at DESC LIMIT 6
  `, [like, like]);

  // Projects: admin sees all; members see only assigned projects
  const projects = isAdmin
    ? queryAll(`
        SELECT id, title, current_stage, status FROM projects
        WHERE title LIKE ? ORDER BY updated_at DESC LIMIT 6
      `, [like])
    : queryAll(`
        SELECT p.id, p.title, p.current_stage, p.status
        FROM projects p
        JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = ? AND pm.removed_at IS NULL
        WHERE p.title LIKE ? ORDER BY p.updated_at DESC LIMIT 6
      `, [uid, like]);

  // Tasks: assigned to me, or in my projects (admin: any)
  const tasks = isAdmin
    ? queryAll(`
        SELECT pt.id, pt.task_name, pt.status, p.title as project_title
        FROM project_tasks pt JOIN projects p ON pt.project_id = p.id
        WHERE pt.task_name LIKE ? ORDER BY pt.created_at DESC LIMIT 6
      `, [like])
    : queryAll(`
        SELECT pt.id, pt.task_name, pt.status, p.title as project_title
        FROM project_tasks pt JOIN projects p ON pt.project_id = p.id
        WHERE pt.task_name LIKE ?
          AND (pt.assigned_to = ? OR EXISTS (
            SELECT 1 FROM project_members pm WHERE pm.project_id = pt.project_id AND pm.user_id = ? AND pm.removed_at IS NULL
          ))
        ORDER BY pt.created_at DESC LIMIT 6
      `, [like, uid, uid]);

  // Members: admin sees full directory; members see active colleagues (name/role only)
  const members = isAdmin
    ? queryAll(`
        SELECT id, name, role, status FROM users
        WHERE (name LIKE ? OR email LIKE ?) AND status = 'active'
        ORDER BY name ASC LIMIT 6
      `, [like, like])
    : queryAll(`
        SELECT id, name, role, status FROM users
        WHERE (name LIKE ?) AND status = 'active'
        ORDER BY name ASC LIMIT 6
      `, [like]);

  return res.status(200).json({ query: q, ideas, projects, tasks, members });
});

export default router;
