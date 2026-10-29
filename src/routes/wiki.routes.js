/**
 * src/routes/wiki.routes.js
 * PRD 27: Knowledge Base & Wiki — REST API Routes & Controllers
 *
 * Implements 29 endpoints across Spaces, Pages, Versions, Comments, Reactions, Templates, Search, and Export.
 *
 * Architectural & Security Rules:
 * 1. Strict route ordering: all static routes (e.g. /space/create, /page/create, /search, /templates)
 *    are declared before parameterized /:id routes to avoid routing collisions.
 * 2. Space routes: Admin+ for create, update, archive, and member assignment; access scoped for members.
 * 3. Page routes: Space EDITOR+ to create/edit; VIEWER to read.
 * 4. Client role isolation: Clients can only read spaces with visibility = 'CLIENT_SHARED' and
 *    pages with is_client_shared = 1. Internal comments are strictly masked as [] at both service and route layers.
 * 5. System templates: Deletion of built-in templates (is_system_template = 1) is blocked with 403.
 * 6. Full-text search: SQLite FTS5 search query returning ranked matches and highlighted excerpts.
 * 7. Admin actions audited in access_log.
 * 8. Manual updated_at timestamps maintained on all mutations.
 */

import express from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { queryOne, queryAll } from '../db/database.js';
import * as wikiService from '../services/wikiService.js';

const router = express.Router();

// ---------------------------------------------------------------------------
// Error Formatter Helper
// ---------------------------------------------------------------------------
function handleServiceError(res, err) {
  if (err && err.status) {
    return res.status(err.status).json({ error: err.message });
  }
  const msg = err?.message || 'An unexpected wiki error occurred';
  if (msg.toLowerCase().includes('not found')) {
    return res.status(404).json({ error: msg });
  }
  if (
    msg.includes('Forbidden') ||
    msg.includes('Admin privilege required') ||
    msg.includes('System templates cannot be deleted') ||
    msg.includes('permission')
  ) {
    return res.status(403).json({ error: msg });
  }
  if (msg.includes('Unauthorized')) {
    return res.status(401).json({ error: msg });
  }
  return res.status(400).json({ error: msg });
}

// ---------------------------------------------------------------------------
// Unified Wiki Authentication Middleware
// Authenticates internal users via JWT_SECRET or client portal users via CLIENT_JWT_SECRET
// ---------------------------------------------------------------------------
export function authenticateWiki(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Missing or malformed authorization header' });
  }

  const token = authHeader.substring(7).trim();

  // 1. Check if token belongs to Client Portal
  try {
    const preCheck = jwt.decode(token);
    if (preCheck && (preCheck.role === 'CLIENT' || preCheck.clientId)) {
      const clientSecret = config.CLIENT_JWT_SECRET || config.JWT_SECRET;
      const decodedClient = jwt.verify(token, clientSecret);
      const clientId = decodedClient.clientId || decodedClient.id;

      const client = queryOne('SELECT id, name, email, status FROM clients WHERE id = ?;', [clientId]);
      if (!client || client.status !== 'ACTIVE') {
        return res.status(401).json({ error: 'Unauthorized: Inactive or invalid client' });
      }

      req.user = {
        id: client.id,
        name: client.name,
        email: client.email,
        role: 'client',
        isClient: true
      };
      return next();
    }
  } catch {
    // Fall through to internal user auth verification
  }

  // 2. Standard internal user authentication
  try {
    const decoded = jwt.verify(token, config.JWT_SECRET);
    const { sessionId, userId } = decoded;

    const session = queryOne('SELECT * FROM sessions WHERE id = ?', [sessionId]);
    if (!session || session.is_revoked === 1) {
      return res.status(401).json({ error: 'Unauthorized: Session has been revoked or expired' });
    }

    const now = new Date();
    if (new Date(session.expires_at) <= now) {
      return res.status(401).json({ error: 'Unauthorized: Session has expired' });
    }

    const user = queryOne('SELECT id, name, email, role, status FROM users WHERE id = ?', [userId]);
    if (!user || user.status !== 'active') {
      return res.status(401).json({ error: 'Unauthorized: Access Revoked' });
    }

    req.user = {
      ...user,
      isClient: false
    };
    return next();
  } catch {
    return res.status(401).json({ error: 'Unauthorized: Invalid token' });
  }
}

// ===========================================================================
// STATIC ROUTES (Declared first to prevent parameterized collisions)
// ===========================================================================

/**
 * 1. POST /api/wiki/space/create
 * Role: Admin+
 */
router.post('/space/create', authenticateWiki, (req, res) => {
  try {
    if (req.user?.isClient) {
      return res.status(403).json({ error: 'Forbidden: Clients cannot create wiki spaces' });
    }
    const space = wikiService.createSpace(req.body || {}, req.user, req.ip);
    return res.status(201).json(space);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * 2. GET /api/wiki/spaces
 * Role: All authenticated users (Admin = all; Member = member spaces; Client = CLIENT_SHARED spaces)
 */
router.get('/spaces', authenticateWiki, (req, res) => {
  try {
    const includeArchived = req.query.include_archived === 'true' || req.query.include_archived === '1';

    if (req.user?.isClient) {
      const clientSpaces = queryAll(
        `SELECT s.*,
                (SELECT COUNT(*) FROM wiki_pages p WHERE p.space_id = s.id AND p.status = 'PUBLISHED' AND p.is_client_shared = 1) as page_count
         FROM wiki_spaces s
         WHERE s.visibility = 'CLIENT_SHARED' AND s.is_archived = 0
         ORDER BY s.name ASC;`
      );
      return res.status(200).json(clientSpaces);
    }

    const spaces = wikiService.getSpaces(req.user, { includeArchived });
    return res.status(200).json(spaces);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * 3. POST /api/wiki/page/create
 * Role: Space member (EDITOR+) or Admin+
 */
router.post('/page/create', authenticateWiki, (req, res) => {
  try {
    if (req.user?.isClient) {
      return res.status(403).json({ error: 'Forbidden: Clients cannot create wiki pages' });
    }
    const page = wikiService.createPage(req.body || {}, req.user, req.ip);
    return res.status(201).json(page);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * 4. GET /api/wiki/search
 * Role: All authenticated users (scoped to accessible spaces)
 */
router.get('/search', authenticateWiki, (req, res) => {
  try {
    const q = req.query.q || '';
    const space_id = req.query.space_id || null;
    const status = req.query.status || null;

    if (req.user?.isClient) {
      // Clients can only search within CLIENT_SHARED spaces for client_shared pages
      const clientResults = queryAll(
        `SELECT f.page_id, f.space_id, f.title,
                snippet(wiki_search_fts, 3, '<mark>', '</mark>', '...', 15) as excerpt,
                f.rank as relevance_score,
                p.slug as page_slug, p.status, p.emoji_icon, p.updated_at,
                s.name as space_name, s.slug as space_slug
         FROM wiki_search_fts f
         JOIN wiki_pages p ON f.page_id = p.id
         JOIN wiki_spaces s ON f.space_id = s.id
         WHERE wiki_search_fts MATCH ?
           AND s.visibility = 'CLIENT_SHARED'
           AND s.is_archived = 0
           AND p.status = 'PUBLISHED'
           AND p.is_client_shared = 1
           AND (? IS NULL OR f.space_id = ?)
         ORDER BY f.rank ASC
         LIMIT 50;`,
        [q.trim().replace(/[^\w\s]/g, '') + '*', space_id, space_id]
      );
      return res.status(200).json(clientResults);
    }

    const results = wikiService.searchPages({ q, space_id, status }, req.user);
    return res.status(200).json(results);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * 5. GET /api/wiki/templates
 * Role: All authenticated users
 */
router.get('/templates', authenticateWiki, (req, res) => {
  try {
    const category = req.query.category || null;
    const templates = wikiService.getTemplates({ category }, req.user);
    return res.status(200).json(templates);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * 6. POST /api/wiki/template/save
 * Role: Admin+
 */
router.post('/template/save', authenticateWiki, (req, res) => {
  try {
    if (req.user?.isClient) {
      return res.status(403).json({ error: 'Forbidden: Clients cannot save templates' });
    }
    const template = wikiService.saveTemplate(req.body || {}, req.user, req.ip);
    return res.status(201).json(template);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * 7. DELETE /api/wiki/template/:templateId
 * Role: Admin+ (403 if system template)
 */
router.delete('/template/:templateId', authenticateWiki, (req, res) => {
  try {
    if (req.user?.isClient) {
      return res.status(403).json({ error: 'Forbidden: Clients cannot delete templates' });
    }
    const templateId = Number(req.params.templateId);
    const result = wikiService.deleteTemplate(templateId, req.user, req.ip);
    return res.status(200).json(result);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

// ===========================================================================
// PARAMETERIZED COMMENT ROUTES
// ===========================================================================

/**
 * 8. PATCH /api/wiki/comment/:commentId/resolve
 * Role: Comment owner or Admin+
 */
router.patch('/comment/:commentId/resolve', authenticateWiki, (req, res) => {
  try {
    if (req.user?.isClient) {
      return res.status(403).json({ error: 'Forbidden: Clients cannot resolve comments' });
    }
    const commentId = Number(req.params.commentId);
    const resolved = wikiService.resolveComment(commentId, req.user);
    return res.status(200).json(resolved);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * 9. PATCH /api/wiki/comment/:commentId
 * Role: Comment owner only
 */
router.patch('/comment/:commentId', authenticateWiki, (req, res) => {
  try {
    if (req.user?.isClient) {
      return res.status(403).json({ error: 'Forbidden: Clients cannot edit comments' });
    }
    const commentId = Number(req.params.commentId);
    const updated = wikiService.updateComment(commentId, req.body || {}, req.user);
    return res.status(200).json(updated);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * 10. DELETE /api/wiki/comment/:commentId
 * Role: Comment owner or Admin+
 */
router.delete('/comment/:commentId', authenticateWiki, (req, res) => {
  try {
    if (req.user?.isClient) {
      return res.status(403).json({ error: 'Forbidden: Clients cannot delete comments' });
    }
    const commentId = Number(req.params.commentId);
    const result = wikiService.deleteComment(commentId, req.user, req.ip);
    return res.status(200).json(result);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

// ===========================================================================
// PARAMETERIZED SPACE ROUTES
// ===========================================================================

/**
 * 11. PATCH /api/wiki/space/:spaceId/archive
 * Role: Admin+
 */
router.patch('/space/:spaceId/archive', authenticateWiki, (req, res) => {
  try {
    if (req.user?.isClient) {
      return res.status(403).json({ error: 'Forbidden: Clients cannot archive spaces' });
    }
    const spaceId = Number(req.params.spaceId);
    const result = wikiService.archiveSpace(spaceId, req.user, req.ip);
    return res.status(200).json(result);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * 12. POST /api/wiki/space/:spaceId/member/add
 * Role: Admin+ or space MANAGER
 */
router.post('/space/:spaceId/member/add', authenticateWiki, (req, res) => {
  try {
    if (req.user?.isClient) {
      return res.status(403).json({ error: 'Forbidden: Clients cannot add space members' });
    }
    const spaceId = Number(req.params.spaceId);
    const member = wikiService.addSpaceMember(spaceId, req.body || {}, req.user, req.ip);
    return res.status(201).json(member);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * 13. DELETE /api/wiki/space/:spaceId/member/:userId
 * Role: Admin+ or space MANAGER
 */
router.delete('/space/:spaceId/member/:userId', authenticateWiki, (req, res) => {
  try {
    if (req.user?.isClient) {
      return res.status(403).json({ error: 'Forbidden: Clients cannot remove space members' });
    }
    const spaceId = Number(req.params.spaceId);
    const targetUserId = req.params.userId;
    const result = wikiService.removeSpaceMember(spaceId, targetUserId, req.user, req.ip);
    return res.status(200).json(result);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * 14. GET /api/wiki/space/:spaceId/pages
 * Role: Space member, Admin+, or Client if CLIENT_SHARED
 */
router.get('/space/:spaceId/pages', authenticateWiki, (req, res) => {
  try {
    const spaceId = Number(req.params.spaceId);
    if (req.user?.isClient) {
      const space = queryOne('SELECT visibility, is_archived FROM wiki_spaces WHERE id = ?;', [spaceId]);
      if (!space || space.visibility !== 'CLIENT_SHARED' || space.is_archived === 1) {
        return res.status(403).json({ error: 'Forbidden: Space not accessible to clients' });
      }
      const clientPages = queryAll(
        `SELECT id, space_id, parent_page_id, title, slug, status, is_client_shared,
                position, emoji_icon, word_count, reading_time_minutes, created_at, updated_at
         FROM wiki_pages
         WHERE space_id = ? AND status = 'PUBLISHED' AND is_client_shared = 1
         ORDER BY position ASC, created_at ASC;`,
        [spaceId]
      );
      return res.status(200).json(clientPages);
    }

    const status = req.query.status || null;
    const pages = wikiService.getPagesBySpace(spaceId, req.user, { status });
    return res.status(200).json(pages);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * 15. GET /api/wiki/space/:spaceId
 * Role: Space member or Admin+ (Client if CLIENT_SHARED)
 */
router.get('/space/:spaceId', authenticateWiki, (req, res) => {
  try {
    const spaceId = Number(req.params.spaceId);
    if (req.user?.isClient) {
      const space = queryOne(
        `SELECT s.id, s.name, s.slug, s.description, s.icon, s.color, s.visibility, s.is_archived
         FROM wiki_spaces s
         WHERE s.id = ? AND s.visibility = 'CLIENT_SHARED' AND s.is_archived = 0;`,
        [spaceId]
      );
      if (!space) {
        return res.status(403).json({ error: 'Forbidden: Space not accessible to clients' });
      }
      const clientPages = queryAll(
        `SELECT id, space_id, parent_page_id, title, slug, status, position, emoji_icon, word_count, reading_time_minutes
         FROM wiki_pages
         WHERE space_id = ? AND status = 'PUBLISHED' AND is_client_shared = 1
         ORDER BY position ASC, created_at ASC;`,
        [spaceId]
      );
      return res.status(200).json({ ...space, members: [], pages: clientPages });
    }

    const spaceDetail = wikiService.getSpaceById(spaceId, req.user);
    return res.status(200).json(spaceDetail);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * 16. PATCH /api/wiki/space/:spaceId
 * Role: Admin+ or space MANAGER
 */
router.patch('/space/:spaceId', authenticateWiki, (req, res) => {
  try {
    if (req.user?.isClient) {
      return res.status(403).json({ error: 'Forbidden: Clients cannot edit spaces' });
    }
    const spaceId = Number(req.params.spaceId);
    const updated = wikiService.updateSpace(spaceId, req.body || {}, req.user, req.ip);
    return res.status(200).json(updated);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

// ===========================================================================
// PARAMETERIZED PAGE & VERSION ROUTES
// ===========================================================================

/**
 * 17. GET /api/wiki/page/:pageId/versions
 * Role: Space member or Admin+
 */
router.get('/page/:pageId/versions', authenticateWiki, (req, res) => {
  try {
    if (req.user?.isClient) {
      return res.status(403).json({ error: 'Forbidden: Clients cannot view version history' });
    }
    const pageId = Number(req.params.pageId);
    const versions = wikiService.getPageVersions(pageId, req.user);
    return res.status(200).json(versions);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * 18. POST /api/wiki/page/:pageId/version/:versionId/restore
 * Role: Admin+
 */
router.post('/page/:pageId/version/:versionId/restore', authenticateWiki, (req, res) => {
  try {
    if (req.user?.isClient) {
      return res.status(403).json({ error: 'Forbidden: Clients cannot restore versions' });
    }
    const pageId = Number(req.params.pageId);
    const versionId = Number(req.params.versionId);
    const restored = wikiService.restorePageVersion(pageId, versionId, req.user, req.ip);
    return res.status(200).json(restored);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * 19. GET /api/wiki/page/:pageId/version/:versionId
 * Role: Space member or Admin+
 */
router.get('/page/:pageId/version/:versionId', authenticateWiki, (req, res) => {
  try {
    if (req.user?.isClient) {
      return res.status(403).json({ error: 'Forbidden: Clients cannot view version diff snapshots' });
    }
    const pageId = Number(req.params.pageId);
    const versionId = Number(req.params.versionId);
    const version = wikiService.getPageVersionById(pageId, versionId, req.user);
    return res.status(200).json(version);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * 20. GET /api/wiki/page/:pageId/comments
 * Role: Space member or Admin+ (strictly empty [] for clients)
 */
router.get('/page/:pageId/comments', authenticateWiki, (req, res) => {
  try {
    if (req.user?.isClient) {
      return res.status(200).json([]);
    }
    const pageId = Number(req.params.pageId);
    const comments = wikiService.getCommentsByPage(pageId, req.user, { isClient: false });
    return res.status(200).json(comments);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * 21. POST /api/wiki/page/:pageId/comment
 * Role: Space member or Admin+
 */
router.post('/page/:pageId/comment', authenticateWiki, (req, res) => {
  try {
    if (req.user?.isClient) {
      return res.status(403).json({ error: 'Forbidden: Clients cannot add comments' });
    }
    const pageId = Number(req.params.pageId);
    const comment = wikiService.addComment(pageId, req.body || {}, req.user, req.ip);
    return res.status(201).json(comment);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * 22. PATCH /api/wiki/page/:pageId/status
 * Role: Admin+
 */
router.patch('/page/:pageId/status', authenticateWiki, (req, res) => {
  try {
    if (req.user?.isClient) {
      return res.status(403).json({ error: 'Forbidden: Clients cannot modify page status' });
    }
    const pageId = Number(req.params.pageId);
    const { status } = req.body || {};
    const result = wikiService.updatePageStatus(pageId, status, req.user, req.ip);
    return res.status(200).json(result);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * 23. PATCH /api/wiki/page/:pageId/client-share
 * Role: Admin+
 */
router.patch('/page/:pageId/client-share', authenticateWiki, (req, res) => {
  try {
    if (req.user?.isClient) {
      return res.status(403).json({ error: 'Forbidden: Clients cannot modify client sharing' });
    }
    const pageId = Number(req.params.pageId);
    const { is_client_shared } = req.body || {};
    const result = wikiService.setPageClientShare(pageId, is_client_shared, req.user, req.ip);
    return res.status(200).json(result);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * 24. PATCH /api/wiki/page/:pageId/reorder
 * Role: Admin+
 */
router.patch('/page/:pageId/reorder', authenticateWiki, (req, res) => {
  try {
    if (req.user?.isClient) {
      return res.status(403).json({ error: 'Forbidden: Clients cannot reorder pages' });
    }
    const pageId = Number(req.params.pageId);
    const result = wikiService.reorderPage(pageId, req.body || {}, req.user, req.ip);
    return res.status(200).json(result);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * 25. GET /api/wiki/page/:pageId/export
 * Role: Space member or Admin+
 */
router.get('/page/:pageId/export', authenticateWiki, (req, res) => {
  try {
    if (req.user?.isClient) {
      return res.status(403).json({ error: 'Forbidden: Clients cannot export pages' });
    }
    const pageId = Number(req.params.pageId);
    const exported = wikiService.exportPageToMarkdown(pageId, req.user);
    return res.status(200).json(exported);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * 26. POST /api/wiki/page/:pageId/react
 * Role: Space member or Admin+
 */
router.post('/page/:pageId/react', authenticateWiki, (req, res) => {
  try {
    if (req.user?.isClient) {
      return res.status(403).json({ error: 'Forbidden: Clients cannot react to pages' });
    }
    const pageId = Number(req.params.pageId);
    const { reaction } = req.body || {};
    const result = wikiService.toggleReaction(pageId, reaction, req.user);
    return res.status(200).json(result);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * 27. GET /api/wiki/page/:pageId
 * Role: Space member, Admin+, or Client if is_client_shared = 1
 */
router.get('/page/:pageId', authenticateWiki, (req, res) => {
  try {
    const pageId = Number(req.params.pageId);
    const isClient = Boolean(req.user?.isClient);
    const page = wikiService.getPageById(pageId, req.user, { isClient });

    // Double security guard: always ensure comments are stripped for clients
    if (isClient && page) {
      page.comments = [];
    }

    return res.status(200).json(page);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * 28. PATCH /api/wiki/page/:pageId
 * Role: Page creator, space EDITOR+, or Admin+
 */
router.patch('/page/:pageId', authenticateWiki, (req, res) => {
  try {
    if (req.user?.isClient) {
      return res.status(403).json({ error: 'Forbidden: Clients cannot edit wiki pages' });
    }
    const pageId = Number(req.params.pageId);
    const updated = wikiService.updatePage(pageId, req.body || {}, req.user, req.ip);
    return res.status(200).json(updated);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * 29. DELETE /api/wiki/page/:pageId
 * Role: Admin+ or Page Creator (own DRAFT page only)
 */
router.delete('/page/:pageId', authenticateWiki, (req, res) => {
  try {
    if (req.user?.isClient) {
      return res.status(403).json({ error: 'Forbidden: Clients cannot delete wiki pages' });
    }
    const pageId = Number(req.params.pageId);
    const result = wikiService.deletePage(pageId, req.user, req.ip);
    return res.status(200).json(result);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

export default router;
