# PRD 27 — Knowledge Base & Wiki
**File:** docs/27_KNOWLEDGE_BASE_WIKI.md
**Status:** PENDING IMPLEMENTATION
**Depends On:** PRD 15 (Pipeline), PRD 17 (GitHub), PRD 24 (Client Portal), PRD 26 (Automation Engine)

---

## 🔬 REVERSE ENGINEERING MANDATE (Antigravity Must Follow)

Before writing a single line of code, Antigravity MUST produce a structured Reverse Engineering Report.

**Competitors to Reverse Engineer:**
- Notion (Pages, nested pages, blocks, inline databases, slash commands, rich editor)
- Confluence (Spaces, pages, templates, macros, page hierarchy, version history)
- Coda (Docs + databases combined, formulas, views, packs/integrations)
- GitBook (Documentation sites, spaces, collections, git-sync, search)
- Nuclino (Wiki + graph view, real-time collaboration, linked items)
- GitHub Wiki (Markdown-based pages, sidebar navigation, version history via git)

**Reverse Engineering Process (Mandatory Steps):**
1. Study each competitor's knowledge base flow — how pages are created, how hierarchy is built, how search works, how version history is maintained, how permissions are scoped
2. Map every screen that exists in their system (list all views)
3. Map every data relationship (Space → Collection → Page → Block → Version → Comment)
4. Map every business rule (e.g., page cannot be deleted if it has child pages, version restore creates new version not overwrite, search indexes on save)
5. Identify what we will NOT copy (visual design, branding, color scheme, exact wording, icons)
6. Identify what logic/flow we WILL reverse-engineer and rebuild our own way
7. Identify gaps — what competitors are missing that we can add to be better

**Rule:** No competitor UI, color, icon, or copy to be used. Only flow logic and data relationships are fair game. Reverse Engineering Report must be submitted and confirmed before Layer 1 code begins.

---

## 🎯 Objective

Give Mahi Tech Group a complete internal Knowledge Base and Wiki system where team members can create, organize, search, and collaborate on documentation — SOPs, onboarding guides, project docs, technical references — with full version history, rich content, access control, and the ability to selectively share pages with clients. Built our own way.

---

## 👥 Roles & Permissions

| Action | Super Admin | Admin | Member |
|--------|-------------|-------|--------|
| Create Space | ✅ | ✅ | ❌ |
| Edit Space settings | ✅ | ✅ | ❌ |
| Delete Space | ✅ | ✅ | ❌ |
| Create Page (in any space) | ✅ | ✅ | ✅ (if space member) |
| Edit Page (own) | ✅ | ✅ | ✅ |
| Edit Page (any) | ✅ | ✅ | ❌ |
| Delete Page | ✅ | ✅ | ✅ (own only) |
| Restore Page Version | ✅ | ✅ | ❌ |
| Comment on Page | ✅ | ✅ | ✅ |
| Resolve Comment | ✅ | ✅ | ✅ (own comment) |
| Share Page with Client | ✅ | ✅ | ❌ |
| Add Space Members | ✅ | ✅ | ❌ |
| View All Spaces | ✅ | ✅ | ✅ (only spaces they are member of) |
| Archive Page | ✅ | ✅ | ❌ |
| Export Page | ✅ | ✅ | ✅ |
| Create Page Template | ✅ | ✅ | ❌ |

---

## 🗄️ Database Tables (New — 9 Tables)

### Table 1: wiki_spaces

CREATE TABLE wiki_spaces (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  -- URL-friendly identifier e.g. 'engineering-docs', 'hr-handbook'
  description TEXT,
  icon TEXT DEFAULT '📁',
  -- emoji or icon code for space
  color TEXT DEFAULT '#4A90E2',
  -- accent color for space
  visibility TEXT NOT NULL DEFAULT 'INTERNAL',
  -- INTERNAL | PROJECT_LINKED | CLIENT_SHARED
  project_id INTEGER REFERENCES projects(id),
  -- non-NULL if space is linked to a specific project
  is_archived INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

### Table 2: wiki_space_members

CREATE TABLE wiki_space_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  space_id INTEGER NOT NULL REFERENCES wiki_spaces(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  role TEXT NOT NULL DEFAULT 'VIEWER',
  -- VIEWER | EDITOR | MANAGER
  added_by INTEGER NOT NULL REFERENCES users(id),
  added_at TEXT DEFAULT (datetime('now')),
  UNIQUE(space_id, user_id)
);

### Table 3: wiki_pages

CREATE TABLE wiki_pages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  space_id INTEGER NOT NULL REFERENCES wiki_spaces(id),
  parent_page_id INTEGER REFERENCES wiki_pages(id),
  -- NULL = root page in space; non-NULL = child page
  title TEXT NOT NULL,
  slug TEXT NOT NULL,
  -- URL-friendly, unique within space e.g. 'getting-started'
  content TEXT,
  -- full page content stored as JSON (block-based structure)
  content_text TEXT,
  -- plain text version for full-text search indexing
  status TEXT NOT NULL DEFAULT 'PUBLISHED',
  -- DRAFT | PUBLISHED | ARCHIVED
  is_client_shared INTEGER NOT NULL DEFAULT 0,
  -- 1 = page visible to linked clients; 0 = internal only
  position INTEGER DEFAULT 0,
  -- ordering among siblings (same parent)
  emoji_icon TEXT DEFAULT '📄',
  cover_image TEXT,
  -- optional cover image path
  word_count INTEGER DEFAULT 0,
  reading_time_minutes INTEGER DEFAULT 0,
  -- calculated: word_count / 200 (avg reading speed)
  created_by INTEGER NOT NULL REFERENCES users(id),
  last_edited_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(space_id, slug)
);
-- Rule: page cannot be deleted if it has child pages — must delete/move children first
-- Rule: ARCHIVED pages are read-only

### Table 4: wiki_page_versions

CREATE TABLE wiki_page_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  page_id INTEGER NOT NULL REFERENCES wiki_pages(id),
  version_number INTEGER NOT NULL,
  -- auto-incremented per page: 1, 2, 3...
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  -- full content snapshot at this version
  content_text TEXT NOT NULL,
  change_summary TEXT,
  -- optional: brief description of what changed in this version
  saved_by INTEGER NOT NULL REFERENCES users(id),
  saved_at TEXT DEFAULT (datetime('now')),
  word_count INTEGER DEFAULT 0
);
-- Append-only: DB trigger prevents update/delete
-- New version created on every SAVE (not every keystroke)
-- Restoring a version = creating a new version with old content (not overwriting)

### Table 5: wiki_page_comments

CREATE TABLE wiki_page_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  page_id INTEGER NOT NULL REFERENCES wiki_pages(id),
  parent_comment_id INTEGER REFERENCES wiki_page_comments(id),
  -- NULL = top-level comment; non-NULL = reply to comment
  commented_by INTEGER NOT NULL REFERENCES users(id),
  content TEXT NOT NULL,
  selection_text TEXT,
  -- optional: text that was highlighted when comment was made (inline comment)
  is_resolved INTEGER NOT NULL DEFAULT 0,
  resolved_by INTEGER REFERENCES users(id),
  resolved_at TEXT,
  is_edited INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

### Table 6: wiki_page_reactions

CREATE TABLE wiki_page_reactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  page_id INTEGER NOT NULL REFERENCES wiki_pages(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  reaction TEXT NOT NULL,
  -- emoji reaction: '👍' | '❤️' | '🔥' | '💡' | '✅'
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(page_id, user_id, reaction)
);

### Table 7: wiki_page_links

CREATE TABLE wiki_page_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_page_id INTEGER NOT NULL REFERENCES wiki_pages(id),
  target_page_id INTEGER NOT NULL REFERENCES wiki_pages(id),
  -- internal page link (for backlinks feature)
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(source_page_id, target_page_id)
);
-- Auto-populated when editor detects [[page-link]] or internal URL in content
-- Enables backlinks panel: "X pages link to this page"

### Table 8: wiki_templates

CREATE TABLE wiki_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL DEFAULT 'GENERAL',
  -- GENERAL | SOP | MEETING_NOTES | PROJECT_DOC | ONBOARDING | TECHNICAL | RETROSPECTIVE
  content TEXT NOT NULL,
  -- JSON block content (same format as wiki_pages.content)
  preview_text TEXT,
  -- short preview shown in template picker
  is_system_template INTEGER NOT NULL DEFAULT 1,
  -- 1 = built-in (cannot be deleted); 0 = custom
  usage_count INTEGER DEFAULT 0,
  created_by INTEGER REFERENCES users(id),
  -- NULL for system templates
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
-- Pre-seeded with 10 system templates

### Table 9: wiki_search_index

CREATE TABLE wiki_search_index (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  page_id INTEGER NOT NULL REFERENCES wiki_pages(id) UNIQUE,
  space_id INTEGER NOT NULL REFERENCES wiki_spaces(id),
  title TEXT NOT NULL,
  content_text TEXT NOT NULL,
  -- plain text for FTS (Full Text Search)
  tags TEXT,
  -- JSON: array of tags for this page
  last_indexed_at TEXT DEFAULT (datetime('now'))
);
-- Updated on every page save (upsert)
-- Used for full-text search across all pages
-- SQLite FTS5 virtual table created alongside this for fast search

---

## 🔒 DB Triggers (Append-Only)

CREATE TRIGGER prevent_page_version_update
BEFORE UPDATE ON wiki_page_versions
BEGIN SELECT RAISE(ABORT, 'wiki_page_versions is append-only'); END;

CREATE TRIGGER prevent_page_version_delete
BEFORE DELETE ON wiki_page_versions
BEGIN SELECT RAISE(ABORT, 'wiki_page_versions is append-only'); END;

---

## 📝 Content Block System (JSON Structure)

Pages store content as a JSON array of blocks. Each block has:

{
  "id": "unique-block-id",
  "type": "PARAGRAPH | HEADING_1 | HEADING_2 | HEADING_3 | BULLET_LIST |
           NUMBERED_LIST | TODO | CODE | QUOTE | DIVIDER | IMAGE |
           TABLE | CALLOUT | TOGGLE | PAGE_LINK | FILE_EMBED",
  "content": "text content or nested blocks",
  "attrs": {
    "level": 1,         -- for headings
    "language": "js",   -- for code blocks
    "checked": false,   -- for todo blocks
    "url": "...",       -- for images/files
    "color": "...",     -- for callouts
    "align": "left"     -- for paragraphs
  },
  "children": []        -- nested blocks for lists/toggles
}

Rules:
- Block IDs are UUIDs generated client-side but validated server-side
- Max 500 blocks per page (service enforces)
- Max page content size: 5MB
- Images stored in uploads/wiki/ folder; path stored in block attrs.url

---

## 🔌 API Routes (26 Endpoints)

### Space Routes

POST   /api/wiki/space/create
         body: { name, slug, description, icon, color, visibility, project_id }
         rule: slug must be unique, URL-safe (alphanumeric + hyphens only)
         role: Admin+

GET    /api/wiki/spaces
         returns: all spaces user has access to (Admin = all; Member = spaces they are member of)
         role: All

GET    /api/wiki/space/:spaceId
         returns: space detail + root pages tree + member list
         role: Space member or Admin+

PATCH  /api/wiki/space/:spaceId
         body: { name, description, icon, color, visibility }
         role: Admin+

PATCH  /api/wiki/space/:spaceId/archive
         rule: status → archived; all pages become read-only
         role: Admin+

POST   /api/wiki/space/:spaceId/member/add
         body: { user_id, role }
         role: Admin+

DELETE /api/wiki/space/:spaceId/member/:userId
         role: Admin+

### Page Routes

POST   /api/wiki/page/create
         body: { space_id, parent_page_id, title, content, emoji_icon }
         rule: slug auto-generated from title (URL-safe); version_number starts at 1
         role: Space member (EDITOR+) or Admin+

GET    /api/wiki/space/:spaceId/pages
         returns: full page tree (nested hierarchy) for space
         role: Space member or Admin+

GET    /api/wiki/page/:pageId
         returns: page detail + current content + metadata
         role: Space member or Admin+ (client if is_client_shared=1)

PATCH  /api/wiki/page/:pageId
         body: { title, content, emoji_icon, cover_image, change_summary }
         rule: creates new version on every save; updates search index; recalculates word_count
         role: Page creator or Admin+ (EDITOR role in space)

PATCH  /api/wiki/page/:pageId/status
         body: { status }
         -- DRAFT → PUBLISHED or PUBLISHED → ARCHIVED
         role: Admin+

PATCH  /api/wiki/page/:pageId/client-share
         body: { is_client_shared }
         rule: space must have CLIENT_SHARED visibility to enable this
         role: Admin+

PATCH  /api/wiki/page/:pageId/reorder
         body: { position, parent_page_id }
         -- move page to different position or different parent
         role: Admin+

DELETE /api/wiki/page/:pageId
         rule: cannot delete if page has child pages; logs deletion to access_log
         role: Page creator (own, DRAFT only) or Admin+

### Version Routes

GET    /api/wiki/page/:pageId/versions
         returns: all versions for page (version number, saved_by, saved_at, word_count, change_summary)
         role: Space member or Admin+

GET    /api/wiki/page/:pageId/version/:versionId
         returns: full version content (for diff/preview)
         role: Space member or Admin+

POST   /api/wiki/page/:pageId/version/:versionId/restore
         rule: creates NEW version with content of old version (append-only — no overwrite)
         role: Admin+

### Comment Routes

POST   /api/wiki/page/:pageId/comment
         body: { content, parent_comment_id, selection_text }
         role: Space member or Admin+

PATCH  /api/wiki/comment/:commentId
         body: { content }
         rule: only comment owner can edit; marks is_edited=1
         role: Comment owner only

PATCH  /api/wiki/comment/:commentId/resolve
         rule: is_resolved=1; resolved_by = current user
         role: Comment owner or Admin+

DELETE /api/wiki/comment/:commentId
         role: Comment owner or Admin+

### Search Route

GET    /api/wiki/search
         query: ?q=search_term&space_id=&status=
         returns: matched pages ranked by relevance (FTS5 search)
         rule: searches title + content_text; returns page title, space name, excerpt, last edited
         role: All (scoped to accessible spaces)

### Template Routes

GET    /api/wiki/templates
         query: ?category=
         returns: all templates
         role: All

POST   /api/wiki/template/save
         body: { name, description, category, content, preview_text }
         rule: saves current page content as custom template
         role: Admin+

DELETE /api/wiki/template/:templateId
         rule: system templates cannot be deleted
         role: Admin+

### Reaction Route

POST   /api/wiki/page/:pageId/react
         body: { reaction }
         rule: toggle — if reaction exists for user, remove it; if not, add it
         role: Space member or Admin+

---

## 🖥️ Frontend Views (5 HTML Views)

### View 1: Wiki Home / Space List (wiki-home.html)
- Grid of space cards: icon, name, description, page count, last updated
- "Create Space" button (Admin only)
- Recent activity feed: recently edited pages across all accessible spaces
- Quick search bar at top → triggers live search
- "My Pages" section: pages created or last edited by current user
- Pinned pages section (most viewed pages this week)
- All members view (scoped to accessible spaces)

### View 2: Space View / Page Tree (wiki-space.html)
- Left sidebar: hierarchical page tree
  - Root pages listed, expand to show children
  - Indent level shows depth
  - Page emoji icon shown next to title
  - Active page highlighted
  - "New Page" button at top of sidebar (+ button per parent)
  - Drag-drop to reorder pages (Admin only)
  - Archive/Delete option in context menu (Admin only)
- Right panel: selected page content rendered
- Space header: space name, icon, color accent, member count
- Search within space input
- All accessible members view

### View 3: Page Editor (wiki-editor.html)
- Full-page editor (no distracting chrome)
- Top bar: breadcrumb (Space > Parent Page > Current Page), Save button, Share button, History button
- Page title: large editable heading at top
- Emoji icon picker (click emoji to change)
- Cover image upload area (optional)
- Block-based editor:
  - Slash command (/) to insert block types
  - Supported blocks: paragraph, H1/H2/H3, bullet list, numbered list, todo, code, quote, divider, image, table, callout, toggle, page link
  - Inline formatting: bold, italic, underline, strikethrough, inline code, highlight
  - Drag handle on left of each block (to reorder blocks)
- Right sidebar (collapsible):
  - Page info: created by, last edited by, word count, reading time
  - Comments panel: list of comments with resolve buttons
  - Backlinks panel: list of pages that link to this page
  - Reactions bar: emoji reaction buttons with counts
- "Add Comment" via text selection (highlights text → comment bubble appears)
- Auto-save indicator (shows "Saving..." and "Saved" status)
- Version history panel (click History → shows version list on right, click version → preview diff)
- All members (if space member with EDITOR role)

### View 4: Page View (wiki-page-view.html)
- Read-only rendered view of page content
- All block types rendered correctly
- Table of contents auto-generated from H1/H2/H3 headings (sticky sidebar)
- Comment bubbles shown on highlighted text
- Reaction bar at bottom
- "Edit" button (if user has edit permission)
- "Export" button → copies markdown version to clipboard or downloads as .md file
- Backlinks section at bottom: "X pages link here"
- Last edited by + date shown in header
- All members (if space member)

### View 5: Wiki Search Results (wiki-search.html)
- Search input at top (live search as user types, debounced 300ms)
- Filter bar: All Spaces | specific space selector | Status: PUBLISHED | DRAFT | ARCHIVED
- Result list:
  - Each result: page title, space name, breadcrumb path, content excerpt with search term highlighted, last edited by, last edited date
  - Relevance-ranked (FTS5 rank)
- Empty state: "No pages found for [term]" with suggestions
- Recent searches list (stored in localStorage — not in DB)
- All members (scoped to accessible spaces)

---

## ⚙️ Business Rules (Non-Negotiable)

1. Page cannot be deleted if it has child pages — must delete or move children first; service enforces
2. Archived spaces make all pages read-only — no new pages, no edits; service enforces
3. Archived pages are read-only — cannot be edited; must be un-archived by Admin first
4. Version created on every explicit save — not on every keystroke (auto-save drafts in localStorage only)
5. Restoring a version creates a NEW version with old content — never overwrites existing versions
6. Page versions are append-only — no version can ever be deleted
7. Slug auto-generated from title: lowercase, spaces → hyphens, special chars stripped, must be unique within space; service enforces
8. Max 500 blocks per page — service rejects saves exceeding this
9. Max page content 5MB — service rejects saves exceeding this
10. Full-text search uses SQLite FTS5 — search index updated on every page save (upsert)
11. is_client_shared=1 only allowed if parent space visibility = CLIENT_SHARED
12. Client-shared pages must NEVER expose internal comments (is_resolved or otherwise) to clients
13. Member can only view spaces they are explicitly added to — no implicit access
14. Admin+ can view all spaces always
15. Page link backlinks auto-populated when content saved (service parses content JSON for PAGE_LINK blocks)
16. Export = Markdown conversion server-side from block JSON — no external library required
17. System wiki templates cannot be deleted — only custom templates deletable
18. updated_at manually updated in service on every PATCH
19. Server-side RBAC — all role checks in wikiService.js, never trust client-side role
20. Automation Engine integration: fire trigger WIKI_PAGE_PUBLISHED, WIKI_PAGE_UPDATED, WIKI_COMMENT_ADDED on relevant events

---

## 📋 Built-in Templates (Pre-seeded — 10 Templates)

TEMPLATE 01: SOP (Standard Operating Procedure)
  -- sections: Purpose, Scope, Responsibilities, Steps, Notes

TEMPLATE 02: Meeting Notes
  -- sections: Date, Attendees, Agenda, Discussion Points, Decisions, Action Items

TEMPLATE 03: Project Documentation
  -- sections: Overview, Goals, Timeline, Team, Technical Details, Risks, Links

TEMPLATE 04: Onboarding Guide
  -- sections: Welcome, First Day Checklist, Tools Setup, Team Intro, Resources

TEMPLATE 05: Technical Reference
  -- sections: Overview, Installation, Usage, API Reference, Examples, Troubleshooting

TEMPLATE 06: Sprint Retrospective
  -- sections: What Went Well, What Could Improve, Action Items, Metrics

TEMPLATE 07: Product Requirements
  -- sections: Problem Statement, Goals, User Stories, Acceptance Criteria, Out of Scope

TEMPLATE 08: Bug Report
  -- sections: Summary, Steps to Reproduce, Expected Behavior, Actual Behavior, Environment, Screenshots

TEMPLATE 09: Decision Log
  -- sections: Decision, Date, Decision Maker, Context, Options Considered, Final Decision, Rationale

TEMPLATE 10: Weekly Team Update
  -- sections: Accomplishments, In Progress, Blockers, Next Week Plan, Metrics

---

## 📋 Layer Implementation Plan

### Layer 1: Database + Migrations + Seed + FTS5
- Create 9 tables
- Create 2 append-only triggers
- Create SQLite FTS5 virtual table for full-text search
- Seed 10 system templates
- Verify triggers with real INSERT/UPDATE/DELETE tests
- Verify FTS5 search returns results (real test)
- Must pass before Layer 2 begins

### Layer 2: Space + Member Service + API
- wikiService.js (space CRUD, member management, archive)
- Space routes + controller
- Member access scoping logic
- Real HTTP tests
- Must pass before Layer 3 begins

### Layer 3: Page Service + API (CRUD + Versioning + Search Index)
- Page CRUD in wikiService.js
- Slug auto-generation
- Version creation on every save
- Search index upsert on every save
- Backlink auto-population (parse PAGE_LINK blocks)
- word_count + reading_time_minutes calculation
- Real HTTP tests (including version creation, slug uniqueness)
- Must pass before Layer 4 begins

### Layer 4: Version Restore + Comments + Reactions + Templates + Search
- Version restore (creates new version)
- Comment CRUD (with inline selection support)
- Reaction toggle
- Template CRUD
- FTS5 search endpoint
- Export to Markdown
- Real HTTP tests (including FTS5 search with real content)
- Must pass before Layer 5 begins

### Layer 5: Frontend (5 Views)
- Wiki Home / Space List
- Space View / Page Tree (with sidebar)
- Page Editor (block-based, slash commands)
- Page View (read-only, TOC)
- Wiki Search Results
- All views functional before Layer 6

### Layer 6: Integration + Full Test Suite
- End-to-end: create space → add members → create page with blocks → save → verify version created → verify search index updated → search and find page → restore old version → verify new version created → add comment → resolve comment → add reaction → export markdown → client-shared page visible to client → internal comment hidden from client
- Delete page with children blocked (real HTTP test)
- Archived page edit blocked (real HTTP test)
- Slug uniqueness enforced (real HTTP test)
- System template delete blocked (real HTTP test)
- Member without space access blocked (real HTTP test)
- FTS5 search relevance verified (real multi-page search test)
- Automation triggers fired: WIKI_PAGE_PUBLISHED (real test)
- Full regression: all 469 existing tests still passing
- Honest Status Report submitted
- Explicit GO-AHEAD required before PRD 28 begins

---

## 📊 Test Scripts

scripts/verify-prd27-layer1.js        (DB + triggers + FTS5 + seed)
scripts/verify-prd27-layer2.js        (Space + Member API)
scripts/verify-prd27-layer3.js        (Page CRUD + Versioning + Search Index)
scripts/verify-prd27-layer4.js        (Version Restore + Comments + Reactions + Search)
scripts/verify-prd27-layer5.js        (Frontend smoke)
scripts/verify-prd27-integration.js   (end-to-end)

---

## ✅ Definition of Done

- [ ] 9 tables created and verified
- [ ] 2 append-only triggers tested (real UPDATE/DELETE attempt blocked)
- [ ] FTS5 virtual table created and search working (real test)
- [ ] 10 system templates seeded correctly
- [ ] 26 API endpoints working with real HTTP calls
- [ ] Version created on every save (real test — 3 saves = 3 versions)
- [ ] Version restore creates new version not overwrite (real test)
- [ ] Slug auto-generated and unique within space (real test)
- [ ] Search index updated on every save (real FTS5 search test)
- [ ] Backlinks auto-populated from PAGE_LINK blocks (real test)
- [ ] word_count and reading_time calculated correctly (real test)
- [ ] Page with children cannot be deleted (real HTTP test)
- [ ] Archived page edit blocked (real HTTP test)
- [ ] Client-shared page visible to client (real HTTP test)
- [ ] Internal comments hidden from client (real HTTP test)
- [ ] System template delete blocked (real HTTP test)
- [ ] Export to Markdown working (real conversion test)
- [ ] Automation triggers fired on page publish (real integration test)
- [ ] 5 frontend views functional
- [ ] Block editor slash commands working (all block types)
- [ ] All existing 469 tests still passing
- [ ] Reverse Engineering Report submitted and confirmed
- [ ] Honest Status Report submitted
- [ ] Admin GO-AHEAD received
- [ ] Committed to GitHub with message: feat(wiki): PRD 27 complete

---

*PRD 27 — Sealed for implementation. Do not begin Layer 1 until Reverse Engineering Report is submitted and confirmed.*