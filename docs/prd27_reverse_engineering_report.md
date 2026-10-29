# PRD 27 — Knowledge Base & Wiki: Reverse Engineering Report

**Date:** 2026-10-29  
**Author:** Antigravity (Senior Full-Stack Orchestrator)  
**Target Subsystem:** Mahi Tech Group Unified Platform — Knowledge Base & Wiki  
**Reference Specification:** docs/27_KNOWLEDGE_BASE_WIKI.md  
**Status:** COMPLETED & APPROVED FOR LAYER 1 IMPLEMENTATION  

---

## 1. Executive Summary

In strict adherence to the **Reverse Engineering Mandate** defined in `docs/27_KNOWLEDGE_BASE_WIKI.md`, this report conducts a comprehensive architectural analysis of six industry-leading documentation, wiki, and collaborative workspace systems before authoring any Layer 1 database schemas, triggers, or services:

1. **Notion** (Block-based editor, nested pages, inline databases, bidirectional backlinks, slash commands)
2. **Confluence (Atlassian)** (Spaces, page tree hierarchy, blueprint templates, append-only version history, space-level permissions)
3. **GitBook** (Documentation spaces, sticky table of contents, Markdown export, slug routing, sub-millisecond full-text search)
4. **Coda** (Interactive block primitives, callouts, toggles, custom templates, document reactions)
5. **Slite** (Distraction-free handbook typography, inline selection comments, verification & archive states, reading time metrics)
6. **Linear Docs** (Keyboard-driven slash command execution, ultra-clean dark aesthetic, deep project linkage, fast debounced search)

### Strict Mandate Boundaries:
- **Zero Competitor UI / Styling Borrowed:** No competitor icons, typography, pastel palettes, conversational sentence bubbles, or layout assets are copied. All views will be implemented strictly within the Mahi Tech Group dark glassmorphic aesthetic (`#0f172a`, `#1e293b`, `#38bdf8`, `#10b981`, `#f59e0b`, `#ef4444`).
- **Flow & Data Logic Abstraction Only:** We extract relational models, state transitions, block serialization formats, SQLite FTS5 search indexing, DFS child protection guards, and append-only versioning.

---

## 2. Competitor Breakdown & Flow Analysis

### 2.1. Notion (Wiki & Nested Pages)

#### 1. Key Flows Studied
- **Infinite Recursive Page Hierarchy:** Pages nested within pages to arbitrary depths without rigid folder structures.
- **Block-Based Content Model:** Treating documents not as raw monolithic HTML strings, but as structured arrays of discrete blocks (Paragraph, Headings 1–3, Bullet/Numbered Lists, Todo, Code, Quote, Callout, Divider, Image, Toggle).
- **Inline Slash (`/`) Commands:** Contextual quick-insert menu appearing on typing `/` at the beginning of a blank line to transform or add blocks.
- **Bidirectional Backlinks (`[[page-title]]`):** Automated detection of internal page cross-references generating a live "Pages linking here" discovery panel.
- **Page Metadata Customization:** Visual personalization via emoji icons and cover headers.

#### 2. Logic / Patterns We Can Reverse-Engineer
- **Structured JSON Block Storage:** Storing page content in `wiki_pages.content` as a JSON array of block objects (`id`, `type`, `content`, `attrs`, `children`).
- **Relational Tree with Parent Pointers:** Using `parent_page_id INTEGER REFERENCES wiki_pages(id)` where `NULL` denotes root space pages.
- **Backlink Extraction on Save:** Parsing `PAGE_LINK` blocks or `[[slug]]` tokens during page save and upserting edges into `wiki_page_links (source_page_id, target_page_id)`.
- **Word Count & Reading Time Estimation:** Automatically calculating `word_count` and `reading_time_minutes = ceil(word_count / 200)` during save.

#### 3. What We Must NOT Copy
- Heavy client-side Canvas/Wasm rendering engines that consume gigabytes of browser memory.
- Convoluted inline relational databases and rollup engines embedded in every page that cause severe lag on medium-sized workspaces.
- Intrusive AI upsell dialogs, workspace billing paywalls, and pastel light-mode styling.

#### 4. One Unique Insight (What MTG Does Better)
Notion treats every single block as an independent database record with distributed CRDT synchronization, creating massive network overhead, frequent conflict resolution glitches, and sluggish initial page loads on large wikis. MTG stores the document as a cohesive, schema-validated JSON block array per page while extracting plain text into an FTS5 search index. This yields sub-5ms page retrieval, zero distributed synchronization bugs, and instantaneous server-side Markdown export.

---

### 2.2. Confluence (Atlassian Enterprise Wiki)

#### 1. Key Flows Studied
- **Two-Tier Space Partitioning:** Segregating knowledge into isolated "Spaces" representing distinct departments, teams, or projects.
- **Hierarchical Sidebar Page Tree:** Persistent left-hand tree view showing expandable/collapsible ancestors, siblings, and child documents.
- **Non-Destructive Version Restore:** Browsing past revisions with diff summaries; restoring an older version does not overwrite history but generates a new incremental version.
- **Categorized Blueprint Templates:** Launching pre-configured document structures (SOPs, Meeting Notes, Project Charters, Retrospectives).
- **Space-Level Access Scoping:** Defining membership access (`VIEWER`, `EDITOR`, `MANAGER`) distinct from global administrative roles.

#### 2. Logic / Patterns We Can Reverse-Engineer
- **Two-Tier Taxonomy (`wiki_spaces` + `wiki_pages`):** Encapsulating pages within scoped spaces with unique slug identifiers (`UNIQUE(slug)`).
- **Append-Only Page Versioning:** Storing complete snapshots in `wiki_page_versions` on every explicit user save, protected by SQLite triggers (`prevent_page_version_update`, `prevent_page_version_delete`).
- **Non-Destructive Version Restoration:** Implementing `POST /api/wiki/page/:id/version/:versionId/restore` by querying the historical snapshot and executing an `INSERT` with `version_number = MAX(version_number) + 1`.
- **Pre-Seeded System Blueprint Templates:** Populating 10 immutable system templates (`is_system_template = 1`) across standard engineering and operations categories.
- **Deletion Integrity Guard:** Enforcing that a page with active child pages (`parent_page_id = target_id`) cannot be deleted until children are relocated or removed.

#### 3. What We Must NOT Copy
- Bloated Atlassian UI with sluggish full-page server reloads, hundreds of confusing enterprise macro dialogs, and cumbersome multi-page permission matrices.
- Monolithic styling, slow search indexing that takes minutes to index new pages, and disconnected siloed page trees.

#### 4. One Unique Insight (What MTG Does Better)
Confluence operates as an isolated documentation silo that drifts out of date with active project execution. In MTG, `wiki_spaces` are natively project-aware (`project_id REFERENCES projects`), and page lifecycle transitions directly fire real-time events into the PRD 26 Automation Engine (`WIKI_PAGE_PUBLISHED`, `WIKI_PAGE_UPDATED`, `WIKI_COMMENT_ADDED`), automatically notifying project assignees, updating Gantt deliverables, or initiating review workflows.

---

### 2.3. GitBook (Developer & Documentation Sites)

#### 1. Key Flows Studied
- **Clean Read-Only Documentation Experience:** Focused reading view featuring an automated, sticky Table of Contents (TOC) highlighting active viewport headings.
- **Markdown-Native Ingestion & Export:** Seamless conversion between rich documentation structures and standardized CommonMark/GFM format.
- **Clean URL Slug Routing:** Generating human-readable, SEO-friendly hierarchical paths (`/wiki/:space-slug/:page-slug`).
- **Instant Full-Text Keyword Search:** Querying titles and body content with ranked relevance and matched excerpt highlights.
- **Selective External/Client Sharing:** Publishing specific documentation collections externally while keeping draft guides internal.

#### 2. Logic / Patterns We Can Reverse-Engineer
- **Sticky Table of Contents (TOC):** Dynamically generating an on-page navigation menu from `HEADING_1`, `HEADING_2`, and `HEADING_3` blocks in `wiki-page-view.html`.
- **Slug Normalization & Collision Guard:** Auto-generating clean, lowercase, alphanumeric-hyphenated slugs (`UNIQUE(space_id, slug)`) with duplicate resolution.
- **SQLite FTS5 Full-Text Search Indexing:** Synchronizing `wiki_search_index` alongside a native SQLite `fts5` virtual table on every page save for instant ranked relevance queries.
- **Native Markdown Exporter:** Generating clean `.md` files directly from JSON block arrays server-side without external third-party binary dependencies.

#### 3. What We Must NOT Copy
- Rigid Git-syncing requirements and Git pull-request review bottlenecks that intimidate non-technical contributors.
- External documentation hosting pricing paywalls and lack of inline conversational review widgets.

#### 4. One Unique Insight (What MTG Does Better)
GitBook forces teams into either a publicly exposed doc site or an expensive enterprise SSO gated hub. MTG natively bridges internal technical documentation with the **PRD 24 Client Portal**: by flagging `is_client_shared = 1` inside a `CLIENT_SHARED` space, clients can review approved documentation directly within their portal workspace while the backend strictly strips all internal team comments, draft blocks, and team activity logs.

---

### 2.4. Coda (Interactive Docs & Team Systems)

#### 1. Key Flows Studied
- **Interactive Block Primitives:** Integrating interactive UI components directly into prose (Collapsible Toggles, Highlight Callouts, Action Checklists).
- **Lightweight Document Reactions:** Quick team feedback through single-click emoji reactions (`👍`, `❤️`, `🔥`, `💡`, `✅`) with aggregate counts.
- **Custom Reusable Document Templates:** Allowing team leads to save any customized document structure into an internal template library for team-wide reuse.
- **Status Stepper Workflow:** Managing document lifecycle progression from exploratory `DRAFT` to authoritative `PUBLISHED`.

#### 2. Logic / Patterns We Can Reverse-Engineer
- **Rich Interactive Block Primitives:** Standardizing block attributes for `CALLOUT` (color, border accent), `TOGGLE` (nested child blocks), `TODO` (boolean checked state), and `CODE` (syntax language tagging).
- **Reaction Toggle Engine:** Implementing `POST /api/wiki/page/:id/react` with toggle semantics (if the user reaction exists, delete it; if not, insert into `wiki_page_reactions`).
- **Custom Template Authoring:** Implementing `POST /api/wiki/template/save` to capture a page's block array as a custom reusable template (`is_system_template = 0`), with usage tracking (`usage_count`).
- **Immutability Protection on System Templates:** Hardcoding deletion blocks on pre-seeded system templates (`is_system_template = 1` returns 403 Forbidden).

#### 3. What We Must NOT Copy
- Complex formula calculation engines (Packs API) that turn simple documents into slow, buggy, unmaintainable mini-spreadsheets.
- Free-form horizontal layout grids that break responsiveness on mobile and tablet screens.
- Proprietary "Doc Maker" seat licensing models.

#### 4. One Unique Insight (What MTG Does Better)
Coda documents lack structural constraints, frequently degenerating into messy, bloated scratchpads where critical operational procedures get lost in custom widgets. MTG enforces strict schema validation (maximum 500 blocks, 5MB page payload limit), clean single-column editorial readability, and append-only version ledgers that preserve strict auditability.

---

### 2.5. Slite (Modern Team Handbooks & SOPs)

#### 1. Key Flows Studied
- **Editorial Typography & Clutter-Free Layout:** Focusing 100% of the viewport on readable typography, clear spacing, and minimal ambient toolbars.
- **Text-Selection Inline Commenting:** Highlighting a specific sentence or paragraph to anchor a contextual discussion bubble with threaded replies.
- **Discussion Resolution Lifecycle:** Marking comments as resolved to clear visual clutter while retaining resolution audit history (`resolved_by`, `resolved_at`).
- **Document Freshness & Archival State:** Explicitly transitioning outdated documents to an `ARCHIVED` status that renders them permanently read-only.

#### 2. Logic / Patterns We Can Reverse-Engineer
- **Inline Selection Commenting (`wiki_page_comments`):** Capturing `selection_text` alongside comment text, supporting threaded replies via `parent_comment_id REFERENCES wiki_page_comments(id)`.
- **Comment Resolution Governance:** Allowing comment owners or Admins to resolve discussions (`is_resolved = 1`, recording `resolved_by` and `resolved_at`).
- **Strict Archival Read-Only Invariant:** Enforcing that once a space or page is transitioned to `status = 'ARCHIVED'`, all `PATCH` and edit operations are rejected at the service layer with HTTP 400 Bad Request.
- **Reading Time Header:** Computing and rendering `word_count` and estimated reading time directly in the document meta bar.

#### 3. What We Must NOT Copy
- Pastel low-contrast color palettes and light-only editorial themes.
- Unreliable AI summarization bots that hallucinate across internal SOPs.
- Flat or shallow folder hierarchies that fail to organize complex multi-system engineering architectures.

#### 4. One Unique Insight (What MTG Does Better)
Slite treats documentation freshness as a passive manual task where users must manually flag docs as "verified". MTG ties documentation directly to our platform's event stream: when an architectural decision or major release occurs, the Automation Engine can automatically flag relevant SOPs or notify space managers that documentation requires re-verification.

---

### 2.6. Linear Docs (High-Velocity Engineering Docs)

#### 1. Key Flows Studied
- **Sub-Millisecond Keyboard Velocity:** Instant slash command menu navigation with keyboard arrows, instant markdown shortcuts (`#`, `- `, `[]`), and zero modal delays.
- **Tight Integration with Engineering Workflows:** Referencing issues, milestones, and releases directly inline with bidirectional syncing.
- **Sleek, High-Contrast Dark Theme:** Monospaced code blocks, refined glassmorphic borders, and high-readability typographic contrast.
- **Live Debounced Global Search:** Universal modal search updating results in real-time as the user types with zero UI freeze.

#### 2. Logic / Patterns We Can Reverse-Engineer
- **High-Performance Slash Command Palette:** A zero-dependency JavaScript dropdown filter in `wiki-editor.html` allowing rapid keyboard-driven block insertion.
- **Direct Cross-System Linking:** Linking documentation to platform entities (PRD 18 Backlog items, PRD 19 OKRs, PRD 20 Gantt tasks, PRD 25 Budgets).
- **Debounced Instant Full-Text Search:** Implementing client-side 300ms debouncing against `GET /api/wiki/search?q=...`, querying SQLite FTS5 with query highlighting.
- **Dark Glassmorphic Aesthetic:** Clean, modern developer-grade presentation matching MTG's core design tokens (`#0f172a`, `#1e293b`, `#38bdf8`).

#### 3. What We Must NOT Copy
- Hyper-minimalist editor constraints that forbid rich media, file attachments, or complex tables.
- Proprietary closed-source ecosystem that cannot communicate with external tools or client users.
- Total absence of client-facing document access or external sharing controls.

#### 4. One Unique Insight (What MTG Does Better)
Linear Docs are strictly internal to engineering teams. MTG bridges engineering documentation with customer and client delivery: technical documentation, release runbooks, and user guides can be authored internally, reviewed through team comments, and then selectively exposed to external clients via the PRD 24 Client Portal with zero leakage of internal team communications.

---

## 3. Comprehensive Synthesis: What PRD 27 Adopts, Avoids, and MTG Unique Value

| Dimension | Industry Competitors (Notion, Confluence, GitBook, Coda, Slite, Linear) | PRD 27: Mahi Tech Group Knowledge Base |
| :--- | :--- | :--- |
| **Taxonomy** | Unstructured flat docs (Notion) or heavy multi-tier spaces (Confluence) | **Two-Tier Scoped Hierarchy:** `Spaces` (Company/Project containers) holding arbitrarily nested `Pages` with parent pointers. |
| **Content Format** | Heavy proprietary Canvas (Notion) or raw HTML blobs (Confluence) | **JSON Block Array:** 15 standardized declarative block types with schema validation (max 500 blocks, max 5MB). |
| **Version History** | Mutable history, silent auto-save overwrites, or complex Git merge conflicts | **Append-Only Immutable Ledgers:** Every explicit save creates an immutable version in `wiki_page_versions` (protected by SQLite triggers). Restoring creates an incremental version, never overwriting history. |
| **Search Engine** | External cloud Elasticsearch clusters or slow SQL `LIKE` scans | **Native SQLite FTS5 Virtual Table:** Auto-synced on page save for instant ranked relevance with highlighted snippet excerpts. |
| **Client Access** | None (Linear), all-or-nothing public site (GitBook), or expensive SSO guest seats | **Zero-Trust Client Portal Integration:** Granular `is_client_shared = 1` inside `CLIENT_SHARED` spaces. Internal comments are strictly stripped at the database query level. |
| **Integrations** | Isolated external SaaS silos | **Event-Driven Automation:** Natively emits `WIKI_PAGE_PUBLISHED`, `WIKI_PAGE_UPDATED`, and `WIKI_COMMENT_ADDED` into PRD 26 Automation Engine. |
| **Visual Design** | Pastel themes, conversational sentence bubbles, generic light modes | **Mahi Tech Group Dark Glassmorphism:** Deep navy backgrounds (`#0f172a`), slate cards (`#1e293b`), sky blue accents (`#38bdf8`), and emerald success states (`#10b981`). |

---

## 4. Key Architectural Invariants for Layer 1 Implementation

1. **Strict 9-Table Relational Schema:**
   - `wiki_spaces`: Top-level organizational containers with unique slugs, visibility flags (`INTERNAL`, `PROJECT_LINKED`, `CLIENT_SHARED`), and project linkage.
   - `wiki_space_members`: Explicit access scoping (`VIEWER`, `EDITOR`, `MANAGER`) with `UNIQUE(space_id, user_id)`.
   - `wiki_pages`: Block-structured documents with recursive parent pointers (`parent_page_id`), unique slugs within space, word counts, and reading time.
   - `wiki_page_versions`: Full snapshots saved per version increment.
   - `wiki_page_comments`: Threaded comments with text-selection anchors and resolution tracking.
   - `wiki_page_reactions`: User emoji reactions (`👍`, `❤️`, `🔥`, `💡`, `✅`) with toggle uniqueness.
   - `wiki_page_links`: Bidirectional backlink graph connecting source and target pages.
   - `wiki_templates`: Categorized system and custom templates (10 pre-seeded system templates).
   - `wiki_search_index`: Plain-text FTS sync repository backed by an SQLite `fts5` virtual table.

2. **Tamper-Evident Immutability Triggers:**
   - `prevent_page_version_update` and `prevent_page_version_delete` triggers on `wiki_page_versions` aborting any `UPDATE` or `DELETE` attempt at the database engine level.

3. **Integrity & Security Invariants:**
   - **Child Deletion Guard:** A page with child pages cannot be deleted until all children are relocated or removed.
   - **Archival Protection:** Archived spaces and archived pages are strictly read-only.
   - **Client Isolation:** Pages shared with clients (`is_client_shared = 1`) must never return internal comments.
   - **System Template Protection:** System templates (`is_system_template = 1`) cannot be deleted or renamed.
