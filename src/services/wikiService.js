/**
 * src/services/wikiService.js
 * PRD 27: Knowledge Base & Wiki — Service Layer & Business Logic
 *
 * Implements:
 * 1. Space Management (CRUD, slug uniqueness, access control, archiving).
 * 2. Page Hierarchy & Ordering (Nested tree, sibling ordering, circular reference protection).
 * 3. Append-Only Versioning (Version created on every save, version restore creates new version).
 * 4. Content Block Validation (Max 500 blocks, max 5MB, schema checks).
 * 5. Backlink Extraction & Synchronization (Parse PAGE_LINK blocks, upsert wiki_page_links).
 * 6. Server-Side Word Count & Reading Time (Math.ceil(words / 200)).
 * 7. SQLite FTS5 Search Synchronization (Real-time updates to wiki_search_index and FTS5).
 * 8. Threaded Comments & Inline Highlights (Resolve tracking, client masking).
 * 9. Emoji Reactions (Toggle logic).
 * 10. System & Custom Templates (Built-in protection, custom template saving).
 * 11. Client Portal Security (Client-shared validation, internal comment stripping).
 * 12. Audit Logging (access_log) and Automation Engine Trigger Dispatching.
 */

import crypto from 'node:crypto';
import { queryOne, queryAll, execute } from '../db/database.js';
import { logAccess } from './auditService.js';
import { fireTrigger } from './automationEngine.js';

// ---------------------------------------------------------------------------
// Error Helper
// ---------------------------------------------------------------------------
function createError(status, message) {
  const err = new Error(message);
  err.status = status;
  err.statusCode = status;
  return err;
}

// ---------------------------------------------------------------------------
// String & Slug Utilities
// ---------------------------------------------------------------------------

/**
 * Normalizes a title or string into a URL-friendly lowercase slug
 */
export function slugify(text) {
  if (!text || typeof text !== 'string') return 'untitled';
  const clean = text
    .toLowerCase()
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  return clean || 'untitled';
}

/**
 * Ensures global uniqueness for space slugs
 */
export function ensureUniqueSpaceSlug(baseSlug, excludeSpaceId = null) {
  let slug = slugify(baseSlug);
  let counter = 1;
  while (true) {
    const existing = queryOne(
      'SELECT id FROM wiki_spaces WHERE slug = ? AND (? IS NULL OR id != ?);',
      [slug, excludeSpaceId, excludeSpaceId]
    );
    if (!existing) return slug;
    slug = `${slugify(baseSlug)}-${counter}`;
    counter++;
  }
}

/**
 * Ensures space-scoped uniqueness for page slugs
 */
export function ensureUniquePageSlug(spaceId, baseSlug, excludePageId = null) {
  let slug = slugify(baseSlug);
  let counter = 1;
  while (true) {
    const existing = queryOne(
      'SELECT id FROM wiki_pages WHERE space_id = ? AND slug = ? AND (? IS NULL OR id != ?);',
      [spaceId, slug, excludePageId, excludePageId]
    );
    if (!existing) return slug;
    slug = `${slugify(baseSlug)}-${counter}`;
    counter++;
  }
}

// ---------------------------------------------------------------------------
// Block Parsing & Content Utilities
// ---------------------------------------------------------------------------

const MAX_BLOCKS_PER_PAGE = 500;
const MAX_CONTENT_BYTES = 5 * 1024 * 1024; // 5MB

/**
 * Validates and normalizes block array structure
 */
export function validateAndNormalizeBlocks(contentInput) {
  if (!contentInput) {
    return {
      blocks: [],
      contentJson: '[]',
      contentText: '',
      wordCount: 0,
      readingTimeMinutes: 0,
      targetPageIds: []
    };
  }

  let blocks = contentInput;
  if (typeof contentInput === 'string') {
    try {
      blocks = JSON.parse(contentInput);
    } catch {
      throw createError(400, 'Page content must be valid JSON block array');
    }
  }

  if (!Array.isArray(blocks)) {
    throw createError(400, 'Page content must be an array of blocks');
  }

  // Count total blocks including nested children
  let totalBlocks = 0;
  function countBlocks(list) {
    if (!Array.isArray(list)) return;
    for (const b of list) {
      totalBlocks++;
      if (Array.isArray(b.children)) countBlocks(b.children);
    }
  }
  countBlocks(blocks);

  if (totalBlocks > MAX_BLOCKS_PER_PAGE) {
    throw createError(400, `Page exceeds maximum limit of ${MAX_BLOCKS_PER_PAGE} blocks (found: ${totalBlocks})`);
  }

  const contentJson = JSON.stringify(blocks);
  const byteSize = Buffer.byteLength(contentJson, 'utf8');
  if (byteSize > MAX_CONTENT_BYTES) {
    throw createError(400, `Page content exceeds 5MB size limit (size: ${byteSize} bytes)`);
  }

  const { contentText, targetPageIds } = extractTextAndLinks(blocks);
  const words = contentText.trim() ? contentText.trim().split(/\s+/).filter(Boolean) : [];
  const wordCount = words.length;
  const readingTimeMinutes = Math.ceil(wordCount / 200);

  return {
    blocks,
    contentJson,
    contentText,
    wordCount,
    readingTimeMinutes,
    targetPageIds
  };
}

/**
 * Recursively extracts plain text and page link references
 */
export function extractTextAndLinks(blocks) {
  const textParts = [];
  const targetPageIds = new Set();

  function traverse(list) {
    if (!Array.isArray(list)) return;
    for (const block of list) {
      if (!block) continue;

      // Extract text content
      if (typeof block.content === 'string') {
        textParts.push(block.content);

        // Check for inline wikilinks e.g. [[123]] or [[page:123]]
        const inlineMatches = block.content.matchAll(/\[\[(?:page:)?(\d+)\]\]/g);
        for (const m of inlineMatches) {
          const parsedId = parseInt(m[1], 10);
          if (!isNaN(parsedId)) targetPageIds.add(parsedId);
        }
      }

      // Check PAGE_LINK blocks
      if (block.type === 'PAGE_LINK') {
        const targetId =
          block.attrs?.target_page_id ||
          block.attrs?.page_id ||
          (typeof block.content === 'number' ? block.content : parseInt(block.content, 10));
        if (targetId && !isNaN(Number(targetId))) {
          targetPageIds.add(Number(targetId));
        }
      }

      // Check nested children (toggles, lists, callouts)
      if (Array.isArray(block.children)) {
        traverse(block.children);
      }
    }
  }

  traverse(blocks);

  return {
    contentText: textParts.join('\n').trim(),
    targetPageIds: Array.from(targetPageIds)
  };
}

/**
 * Converts block array to clean standard Markdown
 */
export function convertBlocksToMarkdown(title, blocks) {
  const lines = [];
  if (title) {
    lines.push(`# ${title}\n`);
  }

  if (!Array.isArray(blocks)) return lines.join('\n');

  for (const block of blocks) {
    if (!block) continue;
    const type = block.type || 'PARAGRAPH';
    const text = block.content || '';
    const attrs = block.attrs || {};

    switch (type) {
      case 'HEADING_1':
        lines.push(`# ${text}\n`);
        break;
      case 'HEADING_2':
        lines.push(`## ${text}\n`);
        break;
      case 'HEADING_3':
        lines.push(`### ${text}\n`);
        break;
      case 'BULLET_LIST': {
        const items = String(text).split('\n');
        items.forEach(it => lines.push(`- ${it}`));
        lines.push('');
        break;
      }
      case 'NUMBERED_LIST': {
        const items = String(text).split('\n');
        items.forEach((it, idx) => lines.push(`${idx + 1}. ${it}`));
        lines.push('');
        break;
      }
      case 'TODO': {
        const items = String(text).split('\n');
        items.forEach(it => {
          const isChecked = attrs.checked ? 'x' : ' ';
          lines.push(`- [${isChecked}] ${it}`);
        });
        lines.push('');
        break;
      }
      case 'CODE': {
        const lang = attrs.language || '';
        lines.push(`\`\`\`${lang}\n${text}\n\`\`\`\n`);
        break;
      }
      case 'QUOTE': {
        const qLines = String(text).split('\n');
        qLines.forEach(l => lines.push(`> ${l}`));
        lines.push('');
        break;
      }
      case 'DIVIDER':
        lines.push('---\n');
        break;
      case 'CALLOUT':
        lines.push(`> [!NOTE]\n> ${String(text).replace(/\n/g, '\n> ')}\n`);
        break;
      case 'IMAGE':
        lines.push(`![${attrs.alt || 'image'}](${attrs.url || text})\n`);
        break;
      case 'PAGE_LINK': {
        const targetId = attrs.target_page_id || attrs.page_id || '';
        lines.push(`[${text || 'Internal Page Link'}](/wiki/page/${targetId})\n`);
        break;
      }
      case 'PARAGRAPH':
      default:
        lines.push(`${text}\n`);
        break;
    }
  }

  return lines.join('\n').trim();
}

// ---------------------------------------------------------------------------
// Access Control Helpers
// ---------------------------------------------------------------------------

const ROLE_RANKS = {
  VIEWER: 1,
  EDITOR: 2,
  MANAGER: 3
};

/**
 * Checks if user is authorized to perform action on a given space
 */
export function checkSpaceAccess(spaceId, currentUser, requiredRole = 'VIEWER') {
  if (!currentUser) {
    throw createError(401, 'Unauthorized: Login required');
  }

  // Superadmin and Admin have global unrestricted access
  if (['admin', 'superadmin'].includes(currentUser.role)) {
    return { role: 'MANAGER', isGlobalAdmin: true };
  }

  const membership = queryOne(
    'SELECT role FROM wiki_space_members WHERE space_id = ? AND user_id = ?;',
    [spaceId, currentUser.id]
  );

  if (!membership) {
    throw createError(403, 'Forbidden: You do not have access to this wiki space');
  }

  const userRank = ROLE_RANKS[membership.role] || 0;
  const requiredRank = ROLE_RANKS[requiredRole] || 1;

  if (userRank < requiredRank) {
    throw createError(403, `Forbidden: Requires ${requiredRole} role in this space`);
  }

  return { role: membership.role, isGlobalAdmin: false };
}

/**
 * Checks if user can access a specific page
 */
export function checkPageAccess(pageId, currentUser, requiredRole = 'VIEWER', isClient = false) {
  const page = queryOne(
    `SELECT p.*, s.name as space_name, s.slug as space_slug, s.visibility as space_visibility, s.is_archived as space_is_archived
     FROM wiki_pages p
     JOIN wiki_spaces s ON p.space_id = s.id
     WHERE p.id = ?;`,
    [pageId]
  );

  if (!page) {
    throw createError(404, 'Wiki page not found');
  }

  // Client access checks
  if (isClient) {
    if (page.is_client_shared !== 1 || page.space_visibility !== 'CLIENT_SHARED') {
      throw createError(403, 'Forbidden: This page is not shared with clients');
    }
    return { page, role: 'VIEWER', isClient: true };
  }

  // Internal team checks
  const { role, isGlobalAdmin } = checkSpaceAccess(page.space_id, currentUser, requiredRole);
  return { page, role, isGlobalAdmin, isClient: false };
}

// ---------------------------------------------------------------------------
// Space Management
// ---------------------------------------------------------------------------

export function createSpace(
  { name, slug, description = '', icon = '📁', color = '#4A90E2', visibility = 'INTERNAL', project_id = null },
  currentUser,
  ipAddress = null
) {
  if (!currentUser || !['admin', 'superadmin'].includes(currentUser.role)) {
    throw createError(403, 'Forbidden: Admin privilege required to create a wiki space');
  }

  if (!name || typeof name !== 'string' || !name.trim()) {
    throw createError(400, 'Space name is required');
  }

  const validVisibilities = ['INTERNAL', 'PROJECT_LINKED', 'CLIENT_SHARED'];
  if (!validVisibilities.includes(visibility)) {
    throw createError(400, `Invalid visibility. Must be one of: ${validVisibilities.join(', ')}`);
  }

  const finalSlug = ensureUniqueSpaceSlug(slug || name);

  const res = execute(
    `INSERT INTO wiki_spaces (
       name, slug, description, icon, color, visibility, project_id,
       is_archived, created_by, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, datetime('now'), datetime('now'));`,
    [name.trim(), finalSlug, description || null, icon || '📁', color || '#4A90E2', visibility, project_id || null, currentUser.id]
  );

  const spaceId = res.lastInsertRowid;

  // Automatically add creator as MANAGER
  execute(
    `INSERT INTO wiki_space_members (space_id, user_id, role, added_by, added_at)
     VALUES (?, ?, 'MANAGER', ?, datetime('now'));`,
    [spaceId, currentUser.id, currentUser.id]
  );

  logAccess({
    userId: currentUser.id,
    action: 'wiki_space_created',
    resource: '/api/wiki/space/create',
    ipAddress,
    targetId: spaceId
  });

  return queryOne('SELECT * FROM wiki_spaces WHERE id = ?;', [spaceId]);
}

export function getSpaces(currentUser, { includeArchived = false } = {}) {
  if (!currentUser) throw createError(401, 'Unauthorized');

  const isGlobalAdmin = ['admin', 'superadmin'].includes(currentUser.role);

  let spaces;
  if (isGlobalAdmin) {
    spaces = queryAll(
      `SELECT s.*,
              (SELECT COUNT(*) FROM wiki_pages p WHERE p.space_id = s.id AND p.status != 'ARCHIVED') as page_count,
              (SELECT COUNT(*) FROM wiki_space_members m WHERE m.space_id = s.id) as member_count
       FROM wiki_spaces s
       WHERE (? = 1 OR s.is_archived = 0)
       ORDER BY s.is_archived ASC, s.name ASC;`,
      [includeArchived ? 1 : 0]
    );
  } else {
    spaces = queryAll(
      `SELECT s.*,
              (SELECT COUNT(*) FROM wiki_pages p WHERE p.space_id = s.id AND p.status != 'ARCHIVED') as page_count,
              (SELECT COUNT(*) FROM wiki_space_members m WHERE m.space_id = s.id) as member_count
       FROM wiki_spaces s
       JOIN wiki_space_members mem ON s.id = mem.space_id
       WHERE mem.user_id = ? AND (? = 1 OR s.is_archived = 0)
       ORDER BY s.is_archived ASC, s.name ASC;`,
      [currentUser.id, includeArchived ? 1 : 0]
    );
  }

  return spaces;
}

export function getSpaceById(spaceId, currentUser) {
  checkSpaceAccess(spaceId, currentUser, 'VIEWER');

  const space = queryOne(
    `SELECT s.*,
            (SELECT COUNT(*) FROM wiki_pages p WHERE p.space_id = s.id AND p.status != 'ARCHIVED') as page_count,
            (SELECT COUNT(*) FROM wiki_space_members m WHERE m.space_id = s.id) as member_count
     FROM wiki_spaces s
     WHERE s.id = ?;`,
    [spaceId]
  );

  if (!space) throw createError(404, 'Wiki space not found');

  const members = queryAll(
    `SELECT m.id, m.space_id, m.user_id, m.role, m.added_at,
            u.name as user_name, u.email as user_email, u.role as system_role
     FROM wiki_space_members m
     JOIN users u ON m.user_id = u.id
     WHERE m.space_id = ?
     ORDER BY m.added_at ASC;`,
    [spaceId]
  );

  const pages = getPagesBySpace(spaceId, currentUser);

  return {
    ...space,
    members,
    pages
  };
}

export function updateSpace(spaceId, updates = {}, currentUser, ipAddress = null) {
  checkSpaceAccess(spaceId, currentUser, 'MANAGER');

  const space = queryOne('SELECT * FROM wiki_spaces WHERE id = ?;', [spaceId]);
  if (!space) throw createError(404, 'Wiki space not found');

  if (space.is_archived === 1) {
    throw createError(400, 'Archived spaces are read-only: edits are rejected');
  }

  const name = updates.name !== undefined ? updates.name.trim() : space.name;
  if (!name) throw createError(400, 'Space name cannot be empty');

  const description = updates.description !== undefined ? updates.description : space.description;
  const icon = updates.icon !== undefined ? updates.icon : space.icon;
  const color = updates.color !== undefined ? updates.color : space.color;
  const visibility = updates.visibility !== undefined ? updates.visibility : space.visibility;

  execute(
    `UPDATE wiki_spaces
     SET name = ?, description = ?, icon = ?, color = ?, visibility = ?, updated_at = datetime('now')
     WHERE id = ?;`,
    [name, description, icon, color, visibility, spaceId]
  );

  logAccess({
    userId: currentUser.id,
    action: 'wiki_space_updated',
    resource: `/api/wiki/space/${spaceId}`,
    ipAddress,
    targetId: spaceId
  });

  return queryOne('SELECT * FROM wiki_spaces WHERE id = ?;', [spaceId]);
}

export function archiveSpace(spaceId, currentUser, ipAddress = null) {
  if (!currentUser || !['admin', 'superadmin'].includes(currentUser.role)) {
    throw createError(403, 'Forbidden: Admin privilege required to archive spaces');
  }

  const space = queryOne('SELECT id, is_archived FROM wiki_spaces WHERE id = ?;', [spaceId]);
  if (!space) throw createError(404, 'Wiki space not found');

  execute(
    `UPDATE wiki_spaces
     SET is_archived = 1, updated_at = datetime('now')
     WHERE id = ?;`,
    [spaceId]
  );

  logAccess({
    userId: currentUser.id,
    action: 'wiki_space_archived',
    resource: `/api/wiki/space/${spaceId}/archive`,
    ipAddress,
    targetId: spaceId
  });

  return { success: true, space_id: spaceId, is_archived: 1 };
}

export function addSpaceMember(spaceId, { user_id, role = 'VIEWER' }, currentUser, ipAddress = null) {
  checkSpaceAccess(spaceId, currentUser, 'MANAGER');

  const space = queryOne('SELECT id, is_archived FROM wiki_spaces WHERE id = ?;', [spaceId]);
  if (!space) throw createError(404, 'Wiki space not found');
  if (space.is_archived === 1) {
    throw createError(400, 'Cannot add members to an archived space');
  }

  const targetUser = queryOne('SELECT id, name FROM users WHERE id = ?;', [user_id]);
  if (!targetUser) throw createError(404, 'Target user not found');

  const validRoles = ['VIEWER', 'EDITOR', 'MANAGER'];
  if (!validRoles.includes(role)) {
    throw createError(400, `Invalid space role. Must be one of: ${validRoles.join(', ')}`);
  }

  execute(
    `INSERT INTO wiki_space_members (space_id, user_id, role, added_by, added_at)
     VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT(space_id, user_id) DO UPDATE SET role = excluded.role;`,
    [spaceId, user_id, role, currentUser.id]
  );

  logAccess({
    userId: currentUser.id,
    action: 'wiki_space_member_added',
    resource: `/api/wiki/space/${spaceId}/member/add`,
    ipAddress,
    targetId: spaceId
  });

  return queryOne(
    `SELECT m.*, u.name as user_name, u.email as user_email
     FROM wiki_space_members m
     JOIN users u ON m.user_id = u.id
     WHERE m.space_id = ? AND m.user_id = ?;`,
    [spaceId, user_id]
  );
}

export function removeSpaceMember(spaceId, targetUserId, currentUser, ipAddress = null) {
  checkSpaceAccess(spaceId, currentUser, 'MANAGER');

  execute('DELETE FROM wiki_space_members WHERE space_id = ? AND user_id = ?;', [spaceId, targetUserId]);

  logAccess({
    userId: currentUser.id,
    action: 'wiki_space_member_removed',
    resource: `/api/wiki/space/${spaceId}/member/${targetUserId}`,
    ipAddress,
    targetId: spaceId
  });

  return { success: true };
}

// ---------------------------------------------------------------------------
// Page Management & Hierarchy
// ---------------------------------------------------------------------------

export function createPage(
  { space_id, parent_page_id = null, title, content = '[]', emoji_icon = '📄', cover_image = null, status = 'PUBLISHED' },
  currentUser,
  ipAddress = null
) {
  checkSpaceAccess(space_id, currentUser, 'EDITOR');

  const space = queryOne('SELECT id, is_archived, visibility FROM wiki_spaces WHERE id = ?;', [space_id]);
  if (!space) throw createError(404, 'Wiki space not found');
  if (space.is_archived === 1) {
    throw createError(400, 'Archived spaces are read-only: cannot create new pages');
  }

  if (!title || typeof title !== 'string' || !title.trim()) {
    throw createError(400, 'Page title is required');
  }

  // Parent page verification
  if (parent_page_id) {
    const parent = queryOne('SELECT id, space_id, status FROM wiki_pages WHERE id = ?;', [parent_page_id]);
    if (!parent) throw createError(404, 'Parent page not found');
    if (parent.space_id !== space_id) {
      throw createError(400, 'Parent page must reside within the same wiki space');
    }
  }

  const finalSlug = ensureUniquePageSlug(space_id, title);
  const normalized = validateAndNormalizeBlocks(content);

  // Position calculation (append to end of sibling list)
  const posRow = queryOne(
    `SELECT COALESCE(MAX(position), -1) + 1 as next_pos
     FROM wiki_pages
     WHERE space_id = ? AND (? IS NULL AND parent_page_id IS NULL OR parent_page_id = ?);`,
    [space_id, parent_page_id, parent_page_id]
  );
  const position = posRow ? posRow.next_pos : 0;

  const validStatuses = ['DRAFT', 'PUBLISHED', 'ARCHIVED'];
  const finalStatus = validStatuses.includes(status) ? status : 'PUBLISHED';

  // 1. Insert page record
  const res = execute(
    `INSERT INTO wiki_pages (
       space_id, parent_page_id, title, slug, content, content_text, status,
       is_client_shared, position, emoji_icon, cover_image, word_count,
       reading_time_minutes, created_by, last_edited_by, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'));`,
    [
      space_id,
      parent_page_id || null,
      title.trim(),
      finalSlug,
      normalized.contentJson,
      normalized.contentText,
      finalStatus,
      position,
      emoji_icon || '📄',
      cover_image || null,
      normalized.wordCount,
      normalized.readingTimeMinutes,
      currentUser.id,
      currentUser.id
    ]
  );

  const pageId = res.lastInsertRowid;

  // 2. Initial version snapshot (version_number starts at 1)
  execute(
    `INSERT INTO wiki_page_versions (
       page_id, version_number, title, content, content_text,
       change_summary, saved_by, saved_at, word_count
     ) VALUES (?, 1, ?, ?, ?, 'Initial creation', ?, datetime('now'), ?);`,
    [pageId, title.trim(), normalized.contentJson, normalized.contentText, currentUser.id, normalized.wordCount]
  );

  // 3. Search index update (FTS5 triggers automatically handle sync)
  execute(
    `INSERT INTO wiki_search_index (page_id, space_id, title, content_text, tags, last_indexed_at)
     VALUES (?, ?, ?, ?, '[]', datetime('now'))
     ON CONFLICT(page_id) DO UPDATE SET
       space_id = excluded.space_id,
       title = excluded.title,
       content_text = excluded.content_text,
       last_indexed_at = datetime('now');`,
    [pageId, space_id, title.trim(), normalized.contentText]
  );

  // 4. Backlinks synchronization
  syncBacklinks(pageId, normalized.targetPageIds);

  // 5. Fire Automation Trigger if Published
  if (finalStatus === 'PUBLISHED') {
    try {
      fireTrigger('WIKI', 'WIKI_PAGE_PUBLISHED', 'WIKI_PAGE', pageId, currentUser.id, {
        page_id: pageId,
        space_id,
        title: title.trim(),
        slug: finalSlug
      });
    } catch (triggerErr) {
      console.warn('[WikiService] Automation trigger error:', triggerErr.message);
    }
  }

  logAccess({
    userId: currentUser.id,
    action: 'wiki_page_created',
    resource: '/api/wiki/page/create',
    ipAddress,
    targetId: pageId
  });

  return getPageById(pageId, currentUser);
}

export function getPagesBySpace(spaceId, currentUser, { status = null } = {}) {
  checkSpaceAccess(spaceId, currentUser, 'VIEWER');

  const rows = queryAll(
    `SELECT id, space_id, parent_page_id, title, slug, status, is_client_shared,
            position, emoji_icon, word_count, reading_time_minutes, created_by,
            last_edited_by, created_at, updated_at
     FROM wiki_pages
     WHERE space_id = ? AND (? IS NULL OR status = ?)
     ORDER BY position ASC, created_at ASC;`,
    [spaceId, status, status]
  );

  // Build tree hierarchy
  const pageMap = new Map();
  const roots = [];

  for (const row of rows) {
    pageMap.set(row.id, { ...row, children: [] });
  }

  for (const row of rows) {
    const node = pageMap.get(row.id);
    if (row.parent_page_id && pageMap.has(row.parent_page_id)) {
      pageMap.get(row.parent_page_id).children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

export function getPageById(pageId, currentUser, { isClient = false } = {}) {
  const { page, role } = checkPageAccess(pageId, currentUser, 'VIEWER', isClient);

  // Internal comments are never exposed to clients
  let comments = [];
  if (!isClient) {
    comments = getCommentsByPage(pageId, currentUser, { isClient: false });
  }

  // Backlinks (pages linking to this page)
  const backlinks = queryAll(
    `SELECT p.id, p.title, p.slug, p.emoji_icon, s.name as space_name, s.slug as space_slug
     FROM wiki_page_links l
     JOIN wiki_pages p ON l.source_page_id = p.id
     JOIN wiki_spaces s ON p.space_id = s.id
     WHERE l.target_page_id = ?;`,
    [pageId]
  );

  // Emoji Reactions summary
  const reactions = getReactionsByPage(pageId, currentUser);

  // Latest version number
  const latestVersion = queryOne(
    'SELECT MAX(version_number) as max_v FROM wiki_page_versions WHERE page_id = ?;',
    [pageId]
  );

  return {
    ...page,
    current_version: latestVersion ? latestVersion.max_v : 1,
    comments,
    backlinks,
    reactions,
    user_space_role: role
  };
}

export function updatePage(
  pageId,
  { title, content, emoji_icon, cover_image, change_summary = null },
  currentUser,
  ipAddress = null
) {
  const { page } = checkPageAccess(pageId, currentUser, 'EDITOR');

  if (page.space_is_archived === 1) {
    throw createError(400, 'Archived spaces are read-only: page edits are rejected');
  }

  if (page.status === 'ARCHIVED') {
    throw createError(400, 'Archived pages are read-only: unarchive before editing');
  }

  const newTitle = title !== undefined ? title.trim() : page.title;
  if (!newTitle) throw createError(400, 'Page title cannot be empty');

  let normalized;
  if (content !== undefined) {
    normalized = validateAndNormalizeBlocks(content);
  } else {
    normalized = validateAndNormalizeBlocks(page.content);
  }

  const finalEmoji = emoji_icon !== undefined ? emoji_icon : page.emoji_icon;
  const finalCover = cover_image !== undefined ? cover_image : page.cover_image;

  // 1. Snapshot new version (every explicit save creates an append-only version)
  const nextVerRow = queryOne(
    'SELECT COALESCE(MAX(version_number), 0) + 1 as next_version FROM wiki_page_versions WHERE page_id = ?;',
    [pageId]
  );
  const nextVersion = nextVerRow ? nextVerRow.next_version : 2;

  execute(
    `INSERT INTO wiki_page_versions (
       page_id, version_number, title, content, content_text,
       change_summary, saved_by, saved_at, word_count
     ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), ?);`,
    [
      pageId,
      nextVersion,
      newTitle,
      normalized.contentJson,
      normalized.contentText,
      change_summary || `Version ${nextVersion} update`,
      currentUser.id,
      normalized.wordCount
    ]
  );

  // 2. Update page record with manual updated_at
  execute(
    `UPDATE wiki_pages
     SET title = ?, content = ?, content_text = ?, emoji_icon = ?, cover_image = ?,
         word_count = ?, reading_time_minutes = ?, last_edited_by = ?, updated_at = datetime('now')
     WHERE id = ?;`,
    [
      newTitle,
      normalized.contentJson,
      normalized.contentText,
      finalEmoji,
      finalCover,
      normalized.wordCount,
      normalized.readingTimeMinutes,
      currentUser.id,
      pageId
    ]
  );

  // 3. Update search index (auto-syncs to FTS5)
  execute(
    `INSERT INTO wiki_search_index (page_id, space_id, title, content_text, tags, last_indexed_at)
     VALUES (?, ?, ?, ?, '[]', datetime('now'))
     ON CONFLICT(page_id) DO UPDATE SET
       title = excluded.title,
       content_text = excluded.content_text,
       last_indexed_at = datetime('now');`,
    [pageId, page.space_id, newTitle, normalized.contentText]
  );

  // 4. Update backlinks
  syncBacklinks(pageId, normalized.targetPageIds);

  // 5. Fire Automation Trigger if Published
  if (page.status === 'PUBLISHED') {
    try {
      fireTrigger('WIKI', 'WIKI_PAGE_UPDATED', 'WIKI_PAGE', pageId, currentUser.id, {
        page_id: pageId,
        space_id: page.space_id,
        title: newTitle,
        version: nextVersion
      });
    } catch (triggerErr) {
      console.warn('[WikiService] Automation trigger error:', triggerErr.message);
    }
  }

  logAccess({
    userId: currentUser.id,
    action: 'wiki_page_updated',
    resource: `/api/wiki/page/${pageId}`,
    ipAddress,
    targetId: pageId
  });

  return getPageById(pageId, currentUser);
}

export function updatePageStatus(pageId, status, currentUser, ipAddress = null) {
  if (!currentUser || !['admin', 'superadmin'].includes(currentUser.role)) {
    throw createError(403, 'Forbidden: Admin privilege required to update page status');
  }

  const page = queryOne('SELECT id, space_id, title, status FROM wiki_pages WHERE id = ?;', [pageId]);
  if (!page) throw createError(404, 'Wiki page not found');

  const validStatuses = ['DRAFT', 'PUBLISHED', 'ARCHIVED'];
  if (!validStatuses.includes(status)) {
    throw createError(400, `Invalid status. Must be one of: ${validStatuses.join(', ')}`);
  }

  execute(
    `UPDATE wiki_pages
     SET status = ?, updated_at = datetime('now')
     WHERE id = ?;`,
    [status, pageId]
  );

  if (status === 'PUBLISHED') {
    try {
      fireTrigger('WIKI', 'WIKI_PAGE_PUBLISHED', 'WIKI_PAGE', pageId, currentUser.id, {
        page_id: pageId,
        space_id: page.space_id,
        title: page.title
      });
    } catch (triggerErr) {
      console.warn('[WikiService] Automation trigger error:', triggerErr.message);
    }
  }

  logAccess({
    userId: currentUser.id,
    action: 'wiki_page_status_updated',
    resource: `/api/wiki/page/${pageId}/status`,
    ipAddress,
    targetId: pageId
  });

  return { success: true, page_id: pageId, status };
}

export function setPageClientShare(pageId, isClientShared, currentUser, ipAddress = null) {
  if (!currentUser || !['admin', 'superadmin'].includes(currentUser.role)) {
    throw createError(403, 'Forbidden: Admin privilege required to configure client sharing');
  }

  const page = queryOne(
    `SELECT p.id, p.space_id, s.visibility as space_visibility
     FROM wiki_pages p
     JOIN wiki_spaces s ON p.space_id = s.id
     WHERE p.id = ?;`,
    [pageId]
  );

  if (!page) throw createError(404, 'Wiki page not found');

  const enabled = isClientShared ? 1 : 0;
  if (enabled === 1 && page.space_visibility !== 'CLIENT_SHARED') {
    throw createError(
      400,
      'Parent space must have CLIENT_SHARED visibility to allow sharing individual pages with clients'
    );
  }

  execute(
    `UPDATE wiki_pages
     SET is_client_shared = ?, updated_at = datetime('now')
     WHERE id = ?;`,
    [enabled, pageId]
  );

  logAccess({
    userId: currentUser.id,
    action: 'wiki_page_client_shared_updated',
    resource: `/api/wiki/page/${pageId}/client-share`,
    ipAddress,
    targetId: pageId
  });

  return { success: true, page_id: pageId, is_client_shared: enabled };
}

export function reorderPage(pageId, { position, parent_page_id = undefined }, currentUser, ipAddress = null) {
  if (!currentUser || !['admin', 'superadmin'].includes(currentUser.role)) {
    throw createError(403, 'Forbidden: Admin privilege required to reorder pages');
  }

  const page = queryOne('SELECT id, space_id, parent_page_id FROM wiki_pages WHERE id = ?;', [pageId]);
  if (!page) throw createError(404, 'Wiki page not found');

  let newParentId = page.parent_page_id;
  if (parent_page_id !== undefined) {
    if (parent_page_id === pageId) {
      throw createError(400, 'Page cannot be its own parent');
    }
    if (parent_page_id !== null) {
      const parent = queryOne('SELECT id, space_id FROM wiki_pages WHERE id = ?;', [parent_page_id]);
      if (!parent || parent.space_id !== page.space_id) {
        throw createError(400, 'Target parent page not found in the same wiki space');
      }

      // Check circular reference (parent cannot be a descendant of pageId)
      let curr = parent.id;
      while (curr) {
        if (curr === pageId) {
          throw createError(400, 'Cannot move page into one of its own descendants (circular hierarchy)');
        }
        const next = queryOne('SELECT parent_page_id FROM wiki_pages WHERE id = ?;', [curr]);
        curr = next ? next.parent_page_id : null;
      }
      newParentId = parent_page_id;
    } else {
      newParentId = null;
    }
  }

  const newPos = typeof position === 'number' ? position : 0;

  execute(
    `UPDATE wiki_pages
     SET position = ?, parent_page_id = ?, updated_at = datetime('now')
     WHERE id = ?;`,
    [newPos, newParentId, pageId]
  );

  logAccess({
    userId: currentUser.id,
    action: 'wiki_page_reordered',
    resource: `/api/wiki/page/${pageId}/reorder`,
    ipAddress,
    targetId: pageId
  });

  return { success: true, page_id: pageId, position: newPos, parent_page_id: newParentId };
}

export function deletePage(pageId, currentUser, ipAddress = null) {
  const page = queryOne('SELECT * FROM wiki_pages WHERE id = ?;', [pageId]);
  if (!page) throw createError(404, 'Wiki page not found');

  // Permission check: Admin+ or Page Creator (own page in DRAFT status only)
  const isGlobalAdmin = ['admin', 'superadmin'].includes(currentUser?.role);
  const isCreatorDraft = page.created_by === currentUser?.id && page.status === 'DRAFT';

  if (!isGlobalAdmin && !isCreatorDraft) {
    throw createError(403, 'Forbidden: Only Admins or the author of a DRAFT page can delete it');
  }

  // Child deletion guard (Rule 1 & Spec: page cannot be deleted if it has child pages)
  const childCount = queryOne('SELECT COUNT(*) as count FROM wiki_pages WHERE parent_page_id = ?;', [pageId]);
  if (childCount && childCount.count > 0) {
    throw createError(400, 'Cannot delete page with child pages. Delete or move children first.');
  }

  // Clean auxiliary references
  execute('DELETE FROM wiki_page_comments WHERE page_id = ?;', [pageId]);
  execute('DELETE FROM wiki_page_reactions WHERE page_id = ?;', [pageId]);
  execute('DELETE FROM wiki_page_links WHERE source_page_id = ? OR target_page_id = ?;', [pageId, pageId]);
  execute('DELETE FROM wiki_search_index WHERE page_id = ?;', [pageId]);

  // Delete page record (cascades to wiki_page_versions cleanly with refined trigger)
  execute('DELETE FROM wiki_pages WHERE id = ?;', [pageId]);

  logAccess({
    userId: currentUser.id,
    action: 'wiki_page_deleted',
    resource: `/api/wiki/page/${pageId}`,
    ipAddress,
    targetId: pageId
  });

  return { success: true, page_id: pageId };
}

/**
 * Upserts target page linkages for backlinks panel
 */
function syncBacklinks(sourcePageId, targetPageIds) {
  execute('DELETE FROM wiki_page_links WHERE source_page_id = ?;', [sourcePageId]);

  if (!Array.isArray(targetPageIds) || targetPageIds.length === 0) return;

  for (const tid of targetPageIds) {
    if (tid === sourcePageId) continue; // Skip self links
    const targetExists = queryOne('SELECT id FROM wiki_pages WHERE id = ?;', [tid]);
    if (targetExists) {
      execute(
        `INSERT INTO wiki_page_links (source_page_id, target_page_id, created_at)
         VALUES (?, ?, datetime('now'))
         ON CONFLICT(source_page_id, target_page_id) DO NOTHING;`,
        [sourcePageId, tid]
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Version Management (Append-Only)
// ---------------------------------------------------------------------------

export function getPageVersions(pageId, currentUser) {
  checkPageAccess(pageId, currentUser, 'VIEWER');

  return queryAll(
    `SELECT v.id, v.page_id, v.version_number, v.title, v.change_summary,
            v.saved_by, v.saved_at, v.word_count, u.name as saved_by_name
     FROM wiki_page_versions v
     JOIN users u ON v.saved_by = u.id
     WHERE v.page_id = ?
     ORDER BY v.version_number DESC;`,
    [pageId]
  );
}

export function getPageVersionById(pageId, versionId, currentUser) {
  checkPageAccess(pageId, currentUser, 'VIEWER');

  const version = queryOne(
    `SELECT v.*, u.name as saved_by_name
     FROM wiki_page_versions v
     JOIN users u ON v.saved_by = u.id
     WHERE v.page_id = ? AND v.id = ?;`,
    [pageId, versionId]
  );

  if (!version) throw createError(404, 'Page version not found');
  return version;
}

export function restorePageVersion(pageId, versionId, currentUser, ipAddress = null) {
  if (!currentUser || !['admin', 'superadmin'].includes(currentUser.role)) {
    throw createError(403, 'Forbidden: Admin privilege required to restore page versions');
  }

  const { page } = checkPageAccess(pageId, currentUser, 'EDITOR');
  if (page.space_is_archived === 1 || page.status === 'ARCHIVED') {
    throw createError(400, 'Cannot restore version on an archived space or page');
  }

  const targetVersion = queryOne(
    'SELECT * FROM wiki_page_versions WHERE page_id = ? AND id = ?;',
    [pageId, versionId]
  );
  if (!targetVersion) throw createError(404, 'Version not found for restoration');

  // Rule 5: Restoring a version creates a NEW version with old content (never overwrites history)
  const nextVerRow = queryOne(
    'SELECT COALESCE(MAX(version_number), 0) + 1 as next_v FROM wiki_page_versions WHERE page_id = ?;',
    [pageId]
  );
  const nextVersion = nextVerRow ? nextVerRow.next_v : 2;

  execute(
    `INSERT INTO wiki_page_versions (
       page_id, version_number, title, content, content_text,
       change_summary, saved_by, saved_at, word_count
     ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), ?);`,
    [
      pageId,
      nextVersion,
      targetVersion.title,
      targetVersion.content,
      targetVersion.content_text,
      `Restored from version ${targetVersion.version_number}`,
      currentUser.id,
      targetVersion.word_count
    ]
  );

  const words = targetVersion.content_text.trim() ? targetVersion.content_text.trim().split(/\s+/).filter(Boolean) : [];
  const readingTimeMinutes = Math.ceil(words.length / 200);

  execute(
    `UPDATE wiki_pages
     SET title = ?, content = ?, content_text = ?, word_count = ?,
         reading_time_minutes = ?, last_edited_by = ?, updated_at = datetime('now')
     WHERE id = ?;`,
    [
      targetVersion.title,
      targetVersion.content,
      targetVersion.content_text,
      targetVersion.word_count,
      readingTimeMinutes,
      currentUser.id,
      pageId
    ]
  );

  // Update search index
  execute(
    `INSERT INTO wiki_search_index (page_id, space_id, title, content_text, tags, last_indexed_at)
     VALUES (?, ?, ?, ?, '[]', datetime('now'))
     ON CONFLICT(page_id) DO UPDATE SET
       title = excluded.title,
       content_text = excluded.content_text,
       last_indexed_at = datetime('now');`,
    [pageId, page.space_id, targetVersion.title, targetVersion.content_text]
  );

  logAccess({
    userId: currentUser.id,
    action: 'wiki_page_version_restored',
    resource: `/api/wiki/page/${pageId}/version/${versionId}/restore`,
    ipAddress,
    targetId: pageId
  });

  return getPageById(pageId, currentUser);
}

// ---------------------------------------------------------------------------
// Comment Management
// ---------------------------------------------------------------------------

export function addComment(
  pageId,
  { content, parent_comment_id = null, selection_text = null },
  currentUser,
  ipAddress = null
) {
  checkPageAccess(pageId, currentUser, 'VIEWER');

  if (!content || typeof content !== 'string' || !content.trim()) {
    throw createError(400, 'Comment content cannot be empty');
  }

  if (parent_comment_id) {
    const parent = queryOne('SELECT id, page_id FROM wiki_page_comments WHERE id = ?;', [parent_comment_id]);
    if (!parent || parent.page_id !== pageId) {
      throw createError(400, 'Parent comment does not exist on this page');
    }
  }

  const res = execute(
    `INSERT INTO wiki_page_comments (
       page_id, parent_comment_id, commented_by, content, selection_text,
       is_resolved, is_edited, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, 0, 0, datetime('now'), datetime('now'));`,
    [pageId, parent_comment_id || null, currentUser.id, content.trim(), selection_text || null]
  );

  const commentId = res.lastInsertRowid;

  try {
    fireTrigger('WIKI', 'WIKI_COMMENT_ADDED', 'WIKI_PAGE', pageId, currentUser.id, {
      page_id: pageId,
      comment_id: commentId
    });
  } catch (triggerErr) {
    console.warn('[WikiService] Automation trigger error:', triggerErr.message);
  }

  return queryOne(
    `SELECT c.*, u.name as commented_by_name, u.avatar_url
     FROM wiki_page_comments c
     JOIN users u ON c.commented_by = u.id
     WHERE c.id = ?;`,
    [commentId]
  );
}

export function updateComment(commentId, { content }, currentUser) {
  if (!content || typeof content !== 'string' || !content.trim()) {
    throw createError(400, 'Comment content cannot be empty');
  }

  const comment = queryOne('SELECT * FROM wiki_page_comments WHERE id = ?;', [commentId]);
  if (!comment) throw createError(404, 'Comment not found');

  if (comment.commented_by !== currentUser?.id) {
    throw createError(403, 'Forbidden: Only the comment owner can edit this comment');
  }

  execute(
    `UPDATE wiki_page_comments
     SET content = ?, is_edited = 1, updated_at = datetime('now')
     WHERE id = ?;`,
    [content.trim(), commentId]
  );

  return queryOne(
    `SELECT c.*, u.name as commented_by_name
     FROM wiki_page_comments c
     JOIN users u ON c.commented_by = u.id
     WHERE c.id = ?;`,
    [commentId]
  );
}

export function resolveComment(commentId, currentUser) {
  const comment = queryOne('SELECT * FROM wiki_page_comments WHERE id = ?;', [commentId]);
  if (!comment) throw createError(404, 'Comment not found');

  const isGlobalAdmin = ['admin', 'superadmin'].includes(currentUser?.role);
  const isOwner = comment.commented_by === currentUser?.id;

  if (!isGlobalAdmin && !isOwner) {
    throw createError(403, 'Forbidden: Only the comment author or an Admin can resolve this comment');
  }

  execute(
    `UPDATE wiki_page_comments
     SET is_resolved = 1, resolved_by = ?, resolved_at = datetime('now'), updated_at = datetime('now')
     WHERE id = ?;`,
    [currentUser.id, commentId]
  );

  return queryOne(
    `SELECT c.*, u.name as resolved_by_name
     FROM wiki_page_comments c
     LEFT JOIN users u ON c.resolved_by = u.id
     WHERE c.id = ?;`,
    [commentId]
  );
}

export function deleteComment(commentId, currentUser, ipAddress = null) {
  const comment = queryOne('SELECT * FROM wiki_page_comments WHERE id = ?;', [commentId]);
  if (!comment) throw createError(404, 'Comment not found');

  const isGlobalAdmin = ['admin', 'superadmin'].includes(currentUser?.role);
  const isOwner = comment.commented_by === currentUser?.id;

  if (!isGlobalAdmin && !isOwner) {
    throw createError(403, 'Forbidden: Only the comment author or an Admin can delete this comment');
  }

  // Delete comment and its direct replies
  execute('DELETE FROM wiki_page_comments WHERE id = ? OR parent_comment_id = ?;', [commentId, commentId]);

  return { success: true, comment_id: commentId };
}

export function getCommentsByPage(pageId, currentUser, { isClient = false } = {}) {
  // Client-shared pages NEVER expose internal comments
  if (isClient) return [];

  const comments = queryAll(
    `SELECT c.*, u.name as commented_by_name, u.avatar_url as commented_by_avatar,
            res.name as resolved_by_name
     FROM wiki_page_comments c
     JOIN users u ON c.commented_by = u.id
     LEFT JOIN users res ON c.resolved_by = res.id
     WHERE c.page_id = ?
     ORDER BY c.created_at ASC;`,
    [pageId]
  );

  // Group into threaded hierarchy
  const map = new Map();
  const roots = [];

  for (const c of comments) {
    map.set(c.id, { ...c, replies: [] });
  }

  for (const c of comments) {
    const node = map.get(c.id);
    if (c.parent_comment_id && map.has(c.parent_comment_id)) {
      map.get(c.parent_comment_id).replies.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

// ---------------------------------------------------------------------------
// Reaction Management
// ---------------------------------------------------------------------------

const ALLOWED_REACTIONS = ['👍', '❤️', '🔥', '💡', '✅'];

export function toggleReaction(pageId, reaction, currentUser) {
  checkPageAccess(pageId, currentUser, 'VIEWER');

  if (!ALLOWED_REACTIONS.includes(reaction)) {
    throw createError(400, `Invalid reaction emoji. Supported: ${ALLOWED_REACTIONS.join(' ')}`);
  }

  const existing = queryOne(
    'SELECT id FROM wiki_page_reactions WHERE page_id = ? AND user_id = ? AND reaction = ?;',
    [pageId, currentUser.id, reaction]
  );

  if (existing) {
    execute('DELETE FROM wiki_page_reactions WHERE id = ?;', [existing.id]);
    return { action: 'removed', reaction };
  } else {
    execute(
      `INSERT INTO wiki_page_reactions (page_id, user_id, reaction, created_at)
       VALUES (?, ?, ?, datetime('now'));`,
      [pageId, currentUser.id, reaction]
    );
    return { action: 'added', reaction };
  }
}

export function getReactionsByPage(pageId, currentUser) {
  const counts = queryAll(
    `SELECT reaction, COUNT(*) as count
     FROM wiki_page_reactions
     WHERE page_id = ?
     GROUP BY reaction;`,
    [pageId]
  );

  let userReactions = [];
  if (currentUser && currentUser.id) {
    userReactions = queryAll(
      'SELECT reaction FROM wiki_page_reactions WHERE page_id = ? AND user_id = ?;',
      [pageId, currentUser.id]
    ).map(r => r.reaction);
  }

  return ALLOWED_REACTIONS.map(emoji => {
    const match = counts.find(c => c.reaction === emoji);
    return {
      reaction: emoji,
      count: match ? match.count : 0,
      has_reacted: userReactions.includes(emoji)
    };
  });
}

// ---------------------------------------------------------------------------
// Template Management
// ---------------------------------------------------------------------------

export function getTemplates({ category = null } = {}, currentUser) {
  if (category) {
    return queryAll(
      'SELECT * FROM wiki_templates WHERE category = ? ORDER BY is_system_template DESC, name ASC;',
      [category.toUpperCase()]
    );
  }
  return queryAll('SELECT * FROM wiki_templates ORDER BY is_system_template DESC, name ASC;');
}

export function saveTemplate(
  { name, description = '', category = 'GENERAL', content, preview_text = '' },
  currentUser,
  ipAddress = null
) {
  if (!currentUser || !['admin', 'superadmin'].includes(currentUser.role)) {
    throw createError(403, 'Forbidden: Admin privilege required to create page templates');
  }

  if (!name || typeof name !== 'string' || !name.trim()) {
    throw createError(400, 'Template name is required');
  }

  const normalized = validateAndNormalizeBlocks(content);

  const res = execute(
    `INSERT INTO wiki_templates (
       name, description, category, content, preview_text,
       is_system_template, usage_count, created_by, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, 0, 0, ?, datetime('now'), datetime('now'));`,
    [name.trim(), description || '', category.toUpperCase(), normalized.contentJson, preview_text || '', currentUser.id]
  );

  const templateId = res.lastInsertRowid;

  logAccess({
    userId: currentUser.id,
    action: 'wiki_template_saved',
    resource: '/api/wiki/template/save',
    ipAddress,
    targetId: templateId
  });

  return queryOne('SELECT * FROM wiki_templates WHERE id = ?;', [templateId]);
}

export function deleteTemplate(templateId, currentUser, ipAddress = null) {
  if (!currentUser || !['admin', 'superadmin'].includes(currentUser.role)) {
    throw createError(403, 'Forbidden: Admin privilege required to delete templates');
  }

  const template = queryOne('SELECT * FROM wiki_templates WHERE id = ?;', [templateId]);
  if (!template) throw createError(404, 'Template not found');

  if (template.is_system_template === 1) {
    throw createError(400, 'System templates cannot be deleted: built-in templates are protected');
  }

  execute('DELETE FROM wiki_templates WHERE id = ?;', [templateId]);

  logAccess({
    userId: currentUser.id,
    action: 'wiki_template_deleted',
    resource: `/api/wiki/template/${templateId}`,
    ipAddress,
    targetId: templateId
  });

  return { success: true, template_id: templateId };
}

// ---------------------------------------------------------------------------
// Search & Export
// ---------------------------------------------------------------------------

export function searchPages({ q, space_id = null, status = null } = {}, currentUser) {
  if (!currentUser) throw createError(401, 'Unauthorized');

  const searchTerm = (q || '').trim();
  if (!searchTerm) return [];

  // Determine accessible spaces
  const isGlobalAdmin = ['admin', 'superadmin'].includes(currentUser.role);
  let accessibleSpaceIds;

  if (isGlobalAdmin) {
    const allSpaces = queryAll('SELECT id FROM wiki_spaces WHERE is_archived = 0;');
    accessibleSpaceIds = allSpaces.map(s => s.id);
  } else {
    const memberSpaces = queryAll(
      `SELECT s.id FROM wiki_spaces s
       JOIN wiki_space_members m ON s.id = m.space_id
       WHERE m.user_id = ? AND s.is_archived = 0;`,
      [currentUser.id]
    );
    accessibleSpaceIds = memberSpaces.map(s => s.id);
  }

  if (accessibleSpaceIds.length === 0) return [];

  if (space_id) {
    const filterId = Number(space_id);
    if (!accessibleSpaceIds.includes(filterId)) {
      throw createError(403, 'Forbidden: You do not have access to search within this space');
    }
    accessibleSpaceIds = [filterId];
  }

  // Sanitize query for FTS5
  const sanitizedQuery = searchTerm
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .map(token => `"${token}"*`)
    .join(' ');

  if (!sanitizedQuery) return [];

  const spacePlaceholders = accessibleSpaceIds.map(() => '?').join(',');

  try {
    const results = queryAll(
      `SELECT f.page_id, f.space_id, f.title,
              snippet(wiki_search_fts, 3, '<mark>', '</mark>', '...', 15) as excerpt,
              f.rank as relevance_score,
              p.slug as page_slug, p.status, p.emoji_icon, p.updated_at,
              s.name as space_name, s.slug as space_slug,
              u.name as last_edited_by_name
       FROM wiki_search_fts f
       JOIN wiki_pages p ON f.page_id = p.id
       JOIN wiki_spaces s ON f.space_id = s.id
       LEFT JOIN users u ON p.last_edited_by = u.id
       WHERE wiki_search_fts MATCH ?
         AND f.space_id IN (${spacePlaceholders})
         AND (? IS NULL OR p.status = ?)
       ORDER BY f.rank ASC
       LIMIT 50;`,
      [sanitizedQuery, ...accessibleSpaceIds, status, status]
    );

    return results;
  } catch (ftsErr) {
    // Fallback to LIKE query on wiki_search_index if FTS tokenizer errors
    const likePattern = `%${searchTerm}%`;
    return queryAll(
      `SELECT i.page_id, i.space_id, i.title,
              substr(i.content_text, 1, 150) as excerpt,
              p.slug as page_slug, p.status, p.emoji_icon, p.updated_at,
              s.name as space_name, s.slug as space_slug,
              u.name as last_edited_by_name
       FROM wiki_search_index i
       JOIN wiki_pages p ON i.page_id = p.id
       JOIN wiki_spaces s ON i.space_id = s.id
       LEFT JOIN users u ON p.last_edited_by = u.id
       WHERE (i.title LIKE ? OR i.content_text LIKE ?)
         AND i.space_id IN (${spacePlaceholders})
         AND (? IS NULL OR p.status = ?)
       LIMIT 50;`,
      [likePattern, likePattern, ...accessibleSpaceIds, status, status]
    );
  }
}

export function exportPageToMarkdown(pageId, currentUser) {
  const { page } = checkPageAccess(pageId, currentUser, 'VIEWER');

  let blocks = [];
  try {
    blocks = JSON.parse(page.content || '[]');
  } catch {
    blocks = [];
  }

  const markdown = convertBlocksToMarkdown(page.title, blocks);

  return {
    page_id: page.id,
    title: page.title,
    slug: page.slug,
    markdown
  };
}
