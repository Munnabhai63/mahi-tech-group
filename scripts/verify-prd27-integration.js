/**
 * scripts/verify-prd27-integration.js
 * Master End-to-End Integration Suite for PRD 27: Knowledge Base & Wiki
 *
 * Real HTTP calls, real SQLite database, ZERO MOCKS.
 *
 * Mandatory Integration Flows:
 * 1. Space Lifecycle:
 *    create -> add member -> archive -> edit rejected (400)
 * 2. Page Lifecycle:
 *    create -> edit (version appended) -> restore version (new version created, history intact)
 *    -> delete child guard (400) -> delete child first -> delete parent succeeds
 * 3. FTS5 Search:
 *    publish page -> search unique keyword -> result found with mark highlight
 *    -> delete page -> search returns 0 results
 * 4. Backlinks:
 *    page A links to page B -> page B shows backlink from A -> remove link -> backlink cleared
 * 5. Client Isolation Sweep:
 *    client token hits every internal endpoint -> all 25 blocked (403);
 *    client accesses CLIENT_SHARED space -> succeeds (200);
 *    client calls comments endpoint -> empty array [] confirmed
 * 6. Append-Only Sweep:
 *    real UPDATE + DELETE on wiki_page_versions -> both aborted by trigger
 * 7. Version Restore:
 *    restore version 1 after 3 edits -> version 4 created -> versions 1-3 untouched in DB
 * 8. Automation Trigger:
 *    page publish fires WIKI_PAGE_PUBLISHED event -> automation_queue row confirmed
 */

import http from 'node:http';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app.js';
import { getDatabase, queryOne, queryAll, execute } from '../src/db/database.js';
import { config } from '../src/config.js';

let passed = 0;
let failed = 0;
let testCount = 0;

function assert(condition, message, details = '') {
  testCount++;
  if (condition) {
    console.log(`  \x1b[32m✔ PASS:\x1b[0m Test ${testCount}: ${message}`);
    passed++;
  } else {
    console.error(`  \x1b[31m✖ FAIL:\x1b[0m Test ${testCount}: ${message}`);
    if (details) console.error(`    \x1b[33mDetails: ${details}\x1b[0m`);
    failed++;
    process.exitCode = 1;
  }
}

// User token generator with active DB session
function generateInternalUserToken(user) {
  const sessionId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 2 * 3600 * 1000).toISOString();

  const token = jwt.sign(
    {
      sessionId,
      userId: user.id,
      role: user.role,
      email: user.email,
      name: user.name
    },
    config.JWT_SECRET,
    { expiresIn: '2h' }
  );

  execute(
    'INSERT INTO sessions (id, user_id, token, expires_at, is_revoked, created_at) VALUES (?, ?, ?, ?, 0, CURRENT_TIMESTAMP)',
    [sessionId, user.id, token, expiresAt]
  );

  return token;
}

// Client Portal JWT token generator
function generateClientToken(client) {
  return jwt.sign(
    {
      clientId: client.id,
      email: client.email,
      role: 'CLIENT'
    },
    config.CLIENT_JWT_SECRET,
    { expiresIn: '2h' }
  );
}

async function run() {
  console.log('='.repeat(80));
  console.log('🚀 PRD 27 MASTER END-TO-END INTEGRATION SUITE');
  console.log('   Full End-to-End System Integration — Real HTTP, Real DB, Zero Mocks');
  console.log('='.repeat(80));

  const db = getDatabase();
  const testSuffix = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  // 1. Verify DB Pragmas
  console.log('\n--- Pre-flight: Database Pragmas & Relational Integrity ---');
  const journalMode = queryOne('PRAGMA journal_mode;');
  assert(journalMode.journal_mode.toLowerCase() === 'wal', 'Database running in WAL journal mode');

  const fk = queryOne('PRAGMA foreign_keys;');
  assert(fk.foreign_keys === 1, 'Foreign keys enforcement enabled');

  // 2. Setup Test Identities
  console.log('\n--- Pre-flight: Identity Setup & Session Tokens ---');
  let adminUser = queryOne("SELECT id, name, email, role FROM users WHERE role = 'admin' LIMIT 1;");
  if (!adminUser) {
    const adminId = crypto.randomUUID();
    execute(
      `INSERT INTO users (id, name, email, password_hash, role, status, created_at, updated_at)
       VALUES (?, 'Integration Admin', ?, 'dummy_hash', 'admin', 'active', datetime('now'), datetime('now'));`,
      [adminId, `admin.integration.${testSuffix}@example.com`]
    );
    adminUser = queryOne('SELECT id, name, email, role FROM users WHERE id = ?;', [adminId]);
  }
  assert(adminUser !== null, `Admin user ready: ${adminUser.name} (${adminUser.id})`);

  const memberId = crypto.randomUUID();
  execute(
    `INSERT INTO users (id, name, email, password_hash, role, status, created_at, updated_at)
     VALUES (?, 'Wiki Integration Dev', ?, 'dummy_hash', 'developer', 'active', datetime('now'), datetime('now'));`,
    [memberId, `member.integration.${testSuffix}@example.com`]
  );
  const memberUser = queryOne('SELECT id, name, email, role FROM users WHERE id = ?;', [memberId]);
  assert(memberUser !== null, `Member user ready: ${memberUser.name} (${memberUser.id})`);

  let clientUser = queryOne("SELECT id, name, email, status FROM clients WHERE status = 'ACTIVE' LIMIT 1;");
  if (!clientUser) {
    const res = execute(
      `INSERT INTO clients (name, email, company_name, status, created_at, updated_at)
       VALUES ('E2E Integration Client', ?, 'Acme Global Corp', 'ACTIVE', datetime('now'), datetime('now'));`,
      [`client.integration.${testSuffix}@example.com`]
    );
    clientUser = queryOne('SELECT id, name, email, status FROM clients WHERE id = ?;', [res.lastInsertRowid]);
  }
  assert(clientUser !== null, `Client user ready: ${clientUser.name} (${clientUser.id})`);

  const adminToken = generateInternalUserToken(adminUser);
  const memberToken = generateInternalUserToken(memberUser);
  const clientToken = generateClientToken(clientUser);

  const adminHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${adminToken}`
  };
  const memberHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${memberToken}`
  };
  const clientHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${clientToken}`
  };

  // 3. Start Express Test Server on Ephemeral Port
  console.log('\n--- Pre-flight: Starting Express App on Ephemeral Port ---');
  const app = createApp();
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  console.log(`[TEST SERVER] Live on ${baseUrl}`);

  async function api(path, options = {}) {
    const res = await fetch(`${baseUrl}${path}`, {
      method: options.method || 'GET',
      headers: options.headers || {},
      body: options.body ? (typeof options.body === 'string' ? options.body : JSON.stringify(options.body)) : undefined
    });
    let data = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    return {
      status: res.status,
      headers: res.headers,
      data
    };
  }

  try {
    // =========================================================================
    // FLOW 1: SPACE LIFECYCLE
    // Create -> Add member -> Archive -> Edit rejected (400)
    // =========================================================================
    console.log('\n--- FLOW 1: Space Lifecycle ---');
    console.log('Create space -> add member -> archive -> edit rejected (400)');

    // 1.1 Create space via Admin
    const spacePayload = {
      name: `Core Systems Architecture ${testSuffix}`,
      description: 'Central engineering hub for core distributed systems architecture',
      icon: '🏛️',
      color: '#38bdf8',
      visibility: 'INTERNAL'
    };
    const createSpaceRes = await api('/api/wiki/space/create', {
      method: 'POST',
      headers: adminHeaders,
      body: spacePayload
    });
    assert(createSpaceRes.status === 201, 'Space created successfully with 201 Created');
    assert(createSpaceRes.data && createSpaceRes.data.id > 0, `Space allocated ID: ${createSpaceRes.data?.id}`);
    assert(createSpaceRes.data?.is_archived === 0, 'Space initially created with is_archived = 0');
    assert(
      createSpaceRes.data?.slug?.startsWith('core-systems-architecture'),
      `Space auto-generated slug: ${createSpaceRes.data?.slug}`
    );
    const flow1SpaceId = createSpaceRes.data.id;

    // 1.2 Verify member cannot see space before addition
    const memberSpacesBefore = await api('/api/wiki/spaces', {
      method: 'GET',
      headers: memberHeaders
    });
    const seesSpaceBefore = memberSpacesBefore.data?.some(s => s.id === flow1SpaceId);
    assert(!seesSpaceBefore, 'Member cannot see space before being added');

    // 1.3 Add member as EDITOR
    const addMemberRes = await api(`/api/wiki/space/${flow1SpaceId}/member/add`, {
      method: 'POST',
      headers: adminHeaders,
      body: { user_id: memberUser.id, role: 'EDITOR' }
    });
    assert(addMemberRes.status === 201, 'Member added to space with 201 Created');
    assert(addMemberRes.data?.role === 'EDITOR', 'Member assigned EDITOR role');

    // 1.4 Member can now view space
    const memberSpacesAfter = await api('/api/wiki/spaces', {
      method: 'GET',
      headers: memberHeaders
    });
    const seesSpaceAfter = memberSpacesAfter.data?.some(s => s.id === flow1SpaceId);
    assert(seesSpaceAfter, 'Member now sees space in member spaces list (200)');

    // 1.5 Archive space via Admin
    const archiveSpaceRes = await api(`/api/wiki/space/${flow1SpaceId}/archive`, {
      method: 'PATCH',
      headers: adminHeaders
    });
    assert(archiveSpaceRes.status === 200, 'Space archived successfully with 200 OK');
    assert(archiveSpaceRes.data?.is_archived === 1, 'Archive response confirms is_archived = 1');

    // 1.6 Verify DB state
    const spaceInDb = queryOne('SELECT is_archived FROM wiki_spaces WHERE id = ?;', [flow1SpaceId]);
    assert(spaceInDb?.is_archived === 1, 'DB record confirms space is_archived = 1');

    // 1.7 Edit archived space rejected with 400
    const editArchivedSpaceRes = await api(`/api/wiki/space/${flow1SpaceId}`, {
      method: 'PATCH',
      headers: adminHeaders,
      body: { name: `Mutated Architecture Name ${testSuffix}` }
    });
    assert(editArchivedSpaceRes.status === 400, 'Editing archived space rejected with 400 Bad Request');
    assert(
      editArchivedSpaceRes.data?.error?.includes('Archived spaces are read-only'),
      `Archived edit error message: ${editArchivedSpaceRes.data?.error}`
    );

    // 1.8 Create page in archived space rejected with 400
    const pageInArchivedSpaceRes = await api('/api/wiki/page/create', {
      method: 'POST',
      headers: memberHeaders,
      body: {
        space_id: flow1SpaceId,
        title: 'Forbidden Page In Archived Space',
        blocks: [{ type: 'PARAGRAPH', text: 'This creation must be rejected' }]
      }
    });
    assert(pageInArchivedSpaceRes.status === 400, 'Creating page in archived space rejected with 400 Bad Request');

    // =========================================================================
    // FLOW 2: PAGE LIFECYCLE
    // Create -> Edit (version appended) -> Restore version -> Delete child guard (400)
    // -> Delete child first -> Delete parent succeeds
    // =========================================================================
    console.log('\n--- FLOW 2: Page Lifecycle ---');
    console.log('Create -> edit -> restore version -> delete child guard (400) -> delete child first -> delete parent succeeds');

    // Setup an active space for Page Lifecycle
    const activeSpaceRes = await api('/api/wiki/space/create', {
      method: 'POST',
      headers: adminHeaders,
      body: {
        name: `Active Lifecycle Hub ${testSuffix}`,
        description: 'Hub for active wiki page lifecycle operations',
        icon: '📘',
        color: '#6366f1',
        visibility: 'INTERNAL'
      }
    });
    const lifecycleSpaceId = activeSpaceRes.data.id;
    await api(`/api/wiki/space/${lifecycleSpaceId}/member/add`, {
      method: 'POST',
      headers: adminHeaders,
      body: { user_id: memberUser.id, role: 'EDITOR' }
    });

    // 2.1 Create page via Member
    const initialBlocks = [
      { type: 'HEADING_1', text: 'Genesis Core Guide' },
      { type: 'PARAGRAPH', text: 'This is the initial foundation block of the guide.' }
    ];
    const createPageRes = await api('/api/wiki/page/create', {
      method: 'POST',
      headers: memberHeaders,
      body: {
        space_id: lifecycleSpaceId,
        title: `Core Architectural Guide ${testSuffix}`,
        emoji_icon: '🏛️',
        blocks: initialBlocks,
        status: 'DRAFT'
      }
    });
    assert(createPageRes.status === 201, 'Page created with 201 Created');
    assert(createPageRes.data && createPageRes.data.id > 0, `Page allocated ID: ${createPageRes.data?.id}`);
    assert(createPageRes.data?.version_number === 1, 'Initial page version_number is 1');
    const parentPageId = createPageRes.data.id;

    // 2.2 Edit page (version appended)
    const updatedBlocks = [
      { type: 'HEADING_1', text: 'Genesis Core Guide (Updated)' },
      { type: 'PARAGRAPH', text: 'Updated content with additional deployment specifications.' },
      { type: 'CALLOUT', text: 'Critical system notice for all node operators.' }
    ];
    const editPageRes = await api(`/api/wiki/page/${parentPageId}`, {
      method: 'PATCH',
      headers: memberHeaders,
      body: {
        title: `Core Architectural Guide (V2) ${testSuffix}`,
        blocks: updatedBlocks,
        change_summary: 'Added node operator specifications',
        save_version: true
      }
    });
    assert(editPageRes.status === 200, 'Page updated with 200 OK');
    assert(editPageRes.data?.version_number === 2, 'Page advanced to version_number = 2');

    // Confirm DB has exactly 2 versions in wiki_page_versions
    const versionsAfterEdit = queryAll(
      'SELECT id, version_number, title, change_summary FROM wiki_page_versions WHERE page_id = ? ORDER BY version_number ASC;',
      [parentPageId]
    );
    assert(versionsAfterEdit.length === 2, 'wiki_page_versions has exactly 2 append-only versions');
    assert(versionsAfterEdit[0].version_number === 1, 'Version 1 preserved in DB');
    assert(versionsAfterEdit[1].version_number === 2, 'Version 2 appended in DB');

    // 2.3 Restore Version 1 (New version created, history intact)
    const restoreVersionRes = await api(`/api/wiki/page/${parentPageId}/version/1/restore`, {
      method: 'POST',
      headers: adminHeaders
    });
    assert(restoreVersionRes.status === 200, 'Version 1 restored successfully with 200 OK');
    assert(restoreVersionRes.data?.version_number === 3, 'Restoration created new version_number = 3');
    assert(
      restoreVersionRes.data?.title === `Core Architectural Guide ${testSuffix}`,
      'Restored page title matches Version 1 snapshot'
    );

    // Verify history intact in DB: 3 distinct versions
    const versionsAfterRestore = queryAll(
      'SELECT version_number, title, change_summary FROM wiki_page_versions WHERE page_id = ? ORDER BY version_number ASC;',
      [parentPageId]
    );
    assert(versionsAfterRestore.length === 3, 'wiki_page_versions retains all 3 historical versions');
    assert(versionsAfterRestore[0].version_number === 1, 'Version 1 is untouched');
    assert(versionsAfterRestore[1].version_number === 2, 'Version 2 is untouched');
    assert(versionsAfterRestore[2].version_number === 3, 'Version 3 is the new restoration version');
    assert(versionsAfterRestore[2].change_summary === 'Restored from version 1', 'Version 3 change_summary recorded');

    // 2.4 Create Child Page under parent
    const createChildRes = await api('/api/wiki/page/create', {
      method: 'POST',
      headers: memberHeaders,
      body: {
        space_id: lifecycleSpaceId,
        parent_page_id: parentPageId,
        title: `Child Subsystem Node ${testSuffix}`,
        emoji_icon: '📦',
        blocks: [{ type: 'PARAGRAPH', text: 'Subsystem documentation under parent guide.' }],
        status: 'DRAFT'
      }
    });
    assert(createChildRes.status === 201, 'Child page created with 201 Created');
    assert(createChildRes.data?.parent_page_id === parentPageId, 'Child page parent_page_id linked correctly');
    const childPageId = createChildRes.data.id;

    // 2.5 Delete Child Guard: attempt to delete parent -> rejected with 400
    const deleteParentBlockedRes = await api(`/api/wiki/page/${parentPageId}`, {
      method: 'DELETE',
      headers: adminHeaders
    });
    assert(deleteParentBlockedRes.status === 400, 'Deleting page with children rejected with 400 Bad Request');
    assert(
      deleteParentBlockedRes.data?.error?.includes('Cannot delete page with child pages'),
      `Child deletion guard error: ${deleteParentBlockedRes.data?.error}`
    );

    // Confirm parent still exists in DB
    const parentStillExists = queryOne('SELECT id FROM wiki_pages WHERE id = ?;', [parentPageId]);
    assert(parentStillExists !== null, 'Parent page remains safely intact in database');

    // 2.6 Delete child first -> succeeds with 200
    const deleteChildRes = await api(`/api/wiki/page/${childPageId}`, {
      method: 'DELETE',
      headers: adminHeaders
    });
    assert(deleteChildRes.status === 200, 'Child page deleted first with 200 OK');
    const childInDb = queryOne('SELECT id FROM wiki_pages WHERE id = ?;', [childPageId]);
    assert(childInDb === null, 'Child page successfully removed from database');

    // 2.7 Delete parent now -> succeeds with 200
    const deleteParentRes = await api(`/api/wiki/page/${parentPageId}`, {
      method: 'DELETE',
      headers: adminHeaders
    });
    assert(deleteParentRes.status === 200, 'Parent page deleted successfully with 200 OK');
    const parentInDb = queryOne('SELECT id FROM wiki_pages WHERE id = ?;', [parentPageId]);
    assert(parentInDb === null, 'Parent page successfully removed from database');

    // =========================================================================
    // FLOW 3: FTS5 SEARCH
    // Publish page -> Search unique keyword -> Result found with mark highlight
    // -> Delete page -> Search returns 0 results
    // =========================================================================
    console.log('\n--- FLOW 3: SQLite FTS5 Full-Text Search ---');
    console.log('Publish page -> search unique keyword -> mark highlight confirmed -> delete page -> 0 results');

    const uniqueSearchKeyword = `hyperjump_e2e_${testSuffix}`;
    const ftsBlocks = [
      { type: 'HEADING_1', text: 'Deep Space Warp Drive Protocol' },
      {
        type: 'PARAGRAPH',
        text: `To safely initiate interstellar travel, engage the ${uniqueSearchKeyword} sublight drive capacitor.`
      },
      { type: 'CODE', language: 'python', code: `warp.engage(drive='${uniqueSearchKeyword}')` }
    ];

    // 3.1 Create page with unique keyword
    const ftsPageRes = await api('/api/wiki/page/create', {
      method: 'POST',
      headers: memberHeaders,
      body: {
        space_id: lifecycleSpaceId,
        title: `Warp Propulsion Document ${testSuffix}`,
        emoji_icon: '🚀',
        blocks: ftsBlocks,
        status: 'DRAFT'
      }
    });
    assert(ftsPageRes.status === 201, 'FTS5 test page created with 201 Created');
    const ftsPageId = ftsPageRes.data.id;

    // 3.2 Publish page
    const publishRes = await api(`/api/wiki/page/${ftsPageId}/status`, {
      method: 'PATCH',
      headers: adminHeaders,
      body: { status: 'PUBLISHED' }
    });
    assert(publishRes.status === 200, 'Page published with 200 OK');

    // 3.3 Search for unique keyword via FTS5 endpoint
    const searchRes = await api(`/api/wiki/search?q=${uniqueSearchKeyword}`, {
      method: 'GET',
      headers: memberHeaders
    });
    assert(searchRes.status === 200, 'FTS5 search endpoint returns 200 OK');
    assert(Array.isArray(searchRes.data), 'Search results returned as array');
    assert(searchRes.data.length >= 1, `Search located target page by keyword (matches: ${searchRes.data.length})`);

    const matchedResult = searchRes.data.find(r => r.page_id === ftsPageId);
    assert(matchedResult !== undefined, 'Target page present in search results');
    assert(
      matchedResult?.excerpt?.includes('<mark>') && matchedResult?.excerpt?.includes('</mark>'),
      `Result contains <mark> highlight snippet: "${matchedResult?.excerpt}"`
    );
    assert(
      matchedResult?.excerpt?.includes(uniqueSearchKeyword),
      `Highlight snippet contains matched keyword "${uniqueSearchKeyword}"`
    );

    // 3.4 Direct SQL verification of virtual table
    const ftsRow = queryOne(
      "SELECT page_id, snippet(wiki_search_fts, 3, '<mark>', '</mark>', '...', 15) as snip FROM wiki_search_fts WHERE wiki_search_fts MATCH ?;",
      [uniqueSearchKeyword]
    );
    assert(ftsRow?.page_id === ftsPageId, 'Virtual table wiki_search_fts matched via MATCH operator');

    // 3.5 Delete the page
    const deleteFtsPageRes = await api(`/api/wiki/page/${ftsPageId}`, {
      method: 'DELETE',
      headers: adminHeaders
    });
    assert(deleteFtsPageRes.status === 200, 'FTS5 test page deleted with 200 OK');

    // 3.6 Search returns 0 results
    const searchAfterDeleteRes = await api(`/api/wiki/search?q=${uniqueSearchKeyword}`, {
      method: 'GET',
      headers: memberHeaders
    });
    assert(searchAfterDeleteRes.status === 200, 'Search after delete returns 200 OK');
    assert(searchAfterDeleteRes.data.length === 0, 'Search returns exactly 0 results after page deletion');

    // Direct SQL confirms 0 rows in virtual table
    const ftsRowAfterDelete = queryOne(
      'SELECT COUNT(*) as count FROM wiki_search_fts WHERE wiki_search_fts MATCH ?;',
      [uniqueSearchKeyword]
    );
    assert(ftsRowAfterDelete.count === 0, 'Virtual table wiki_search_fts confirms 0 matching records');

    // =========================================================================
    // FLOW 4: BACKLINKS
    // Page A links to Page B -> Page B shows backlink from A -> Remove link -> Backlink cleared
    // =========================================================================
    console.log('\n--- FLOW 4: Automatic Backlink Detection & Synchronization ---');
    console.log('Page A links to Page B -> Page B shows backlink from A -> remove link -> backlink cleared');

    // 4.1 Create Target Page (Page B)
    const pageBRes = await api('/api/wiki/page/create', {
      method: 'POST',
      headers: memberHeaders,
      body: {
        space_id: lifecycleSpaceId,
        title: `Target Specification Page B ${testSuffix}`,
        emoji_icon: '🎯',
        blocks: [{ type: 'PARAGRAPH', text: 'This is the destination page that receives links.' }],
        status: 'PUBLISHED'
      }
    });
    assert(pageBRes.status === 201, 'Target Page B created with 201 Created');
    const pageBId = pageBRes.data.id;

    // 4.2 Create Source Page (Page A) with PAGE_LINK block pointing to Page B
    const pageABlocks = [
      { type: 'HEADING_1', text: 'Referrer Guide Page A' },
      { type: 'PARAGRAPH', text: 'Refer to the underlying target specifications below:' },
      { type: 'PAGE_LINK', target_page_id: pageBId, text: 'Go to Target Specification Page B' }
    ];
    const pageARes = await api('/api/wiki/page/create', {
      method: 'POST',
      headers: memberHeaders,
      body: {
        space_id: lifecycleSpaceId,
        title: `Source Referrer Page A ${testSuffix}`,
        emoji_icon: '🔗',
        blocks: pageABlocks,
        status: 'PUBLISHED'
      }
    });
    assert(pageARes.status === 201, 'Source Page A created with 201 Created');
    const pageAId = pageARes.data.id;

    // 4.3 Page B shows backlink from Page A
    const pageBDetail = await api(`/api/wiki/page/${pageBId}`, {
      method: 'GET',
      headers: memberHeaders
    });
    assert(pageBDetail.status === 200, 'Page B details retrieved with 200 OK');
    assert(Array.isArray(pageBDetail.data?.backlinks), 'Page B contains backlinks array');
    assert(pageBDetail.data.backlinks.length === 1, 'Page B has exactly 1 backlink');
    const backlinkEntry = pageBDetail.data.backlinks[0];
    assert(backlinkEntry.source_page_id === pageAId, `Backlink points to Source Page A (ID: ${pageAId})`);
    assert(
      backlinkEntry.source_title === `Source Referrer Page A ${testSuffix}`,
      `Backlink references Source Page A title: "${backlinkEntry.source_title}"`
    );

    // Verify DB record in wiki_page_links
    const linkInDb = queryOne(
      'SELECT * FROM wiki_page_links WHERE source_page_id = ? AND target_page_id = ?;',
      [pageAId, pageBId]
    );
    assert(linkInDb !== null, 'wiki_page_links record verified in database');

    // 4.4 Remove link: update Page A without PAGE_LINK block
    const unlinkedBlocks = [
      { type: 'HEADING_1', text: 'Referrer Guide Page A (Unlinked)' },
      { type: 'PARAGRAPH', text: 'The reference link has now been severed.' }
    ];
    const updatePageARes = await api(`/api/wiki/page/${pageAId}`, {
      method: 'PATCH',
      headers: memberHeaders,
      body: {
        title: `Source Referrer Page A (Unlinked) ${testSuffix}`,
        blocks: unlinkedBlocks,
        change_summary: 'Removed page link to target B'
      }
    });
    assert(updatePageARes.status === 200, 'Page A updated with severed link (200 OK)');

    // 4.5 Backlink cleared on Page B
    const pageBDetailAfter = await api(`/api/wiki/page/${pageBId}`, {
      method: 'GET',
      headers: memberHeaders
    });
    assert(pageBDetailAfter.status === 200, 'Page B details retrieved after unlink');
    assert(pageBDetailAfter.data?.backlinks?.length === 0, 'Page B backlinks array is now completely empty');

    // Verify DB table wiki_page_links has 0 rows for target
    const linkInDbAfter = queryOne(
      'SELECT * FROM wiki_page_links WHERE source_page_id = ? AND target_page_id = ?;',
      [pageAId, pageBId]
    );
    assert(linkInDbAfter === null, 'wiki_page_links record removed cleanly from database');

    // =========================================================================
    // FLOW 5: CLIENT ISOLATION SWEEP
    // Client token hits every internal endpoint -> all 25 blocked (403);
    // Client accesses CLIENT_SHARED space -> succeeds (200);
    // Client calls comments endpoint -> empty array [] confirmed
    // =========================================================================
    console.log('\n--- FLOW 5: Client Isolation & Zero-Leak Security Sweep ---');
    console.log('Client token hits 25 internal endpoints -> all 403; CLIENT_SHARED space -> 200; comments -> []');

    // Setup: Internal space + page, and CLIENT_SHARED space + page
    const internalSpaceRes = await api('/api/wiki/space/create', {
      method: 'POST',
      headers: adminHeaders,
      body: {
        name: `Internal Secret Hub ${testSuffix}`,
        description: 'Classified internal engineering data',
        visibility: 'INTERNAL'
      }
    });
    const internalSpaceId = internalSpaceRes.data.id;

    const internalPageRes = await api('/api/wiki/page/create', {
      method: 'POST',
      headers: adminHeaders,
      body: {
        space_id: internalSpaceId,
        title: `Internal Secret Architecture ${testSuffix}`,
        blocks: [{ type: 'PARAGRAPH', text: 'Top secret server topology.' }],
        status: 'PUBLISHED'
      }
    });
    const internalPageId = internalPageRes.data.id;

    // Create CLIENT_SHARED space
    const clientSharedSpaceRes = await api('/api/wiki/space/create', {
      method: 'POST',
      headers: adminHeaders,
      body: {
        name: `Client Portal Knowledge Hub ${testSuffix}`,
        description: 'Customer-facing documentation space',
        visibility: 'CLIENT_SHARED'
      }
    });
    const clientSharedSpaceId = clientSharedSpaceRes.data.id;

    // Create client shared page in CLIENT_SHARED space
    const clientPageRes = await api('/api/wiki/page/create', {
      method: 'POST',
      headers: adminHeaders,
      body: {
        space_id: clientSharedSpaceId,
        title: `Client Onboarding Overview ${testSuffix}`,
        emoji_icon: '👋',
        blocks: [{ type: 'PARAGRAPH', text: 'Welcome to your dedicated knowledge portal.' }],
        status: 'PUBLISHED'
      }
    });
    const clientSharedPageId = clientPageRes.data.id;

    // Enable client sharing on this page
    await api(`/api/wiki/page/${clientSharedPageId}/client-share`, {
      method: 'PATCH',
      headers: adminHeaders,
      body: { is_client_shared: 1 }
    });

    // Add an internal comment to the client shared page via Admin
    const addInternalCommentRes = await api(`/api/wiki/page/${clientSharedPageId}/comment`, {
      method: 'POST',
      headers: adminHeaders,
      body: { content: 'Internal secret note: Keep client billing rates confidential' }
    });
    assert(addInternalCommentRes.status === 201, 'Internal comment added by team member');
    const internalCommentId = addInternalCommentRes.data.id;

    // 5.1 Execute Client Isolation Sweep on all 25 internal endpoints
    const sweepEndpoints = [
      { name: 'POST /space/create', path: '/api/wiki/space/create', method: 'POST', body: { name: 'Hack Space' } },
      { name: 'PATCH /space/:id', path: `/api/wiki/space/${internalSpaceId}`, method: 'PATCH', body: { name: 'Hacked' } },
      { name: 'POST /space/:id/member/add', path: `/api/wiki/space/${internalSpaceId}/member/add`, method: 'POST', body: { user_id: memberUser.id } },
      { name: 'DELETE /space/:id/member/:userId', path: `/api/wiki/space/${internalSpaceId}/member/${memberUser.id}`, method: 'DELETE' },
      { name: 'PATCH /space/:id/archive', path: `/api/wiki/space/${internalSpaceId}/archive`, method: 'PATCH' },
      { name: 'POST /page/create', path: '/api/wiki/page/create', method: 'POST', body: { space_id: internalSpaceId, title: 'Hack Page' } },
      { name: 'PATCH /page/:id', path: `/api/wiki/page/${internalPageId}`, method: 'PATCH', body: { title: 'Hacked' } },
      { name: 'PATCH /page/:id/status', path: `/api/wiki/page/${internalPageId}/status`, method: 'PATCH', body: { status: 'ARCHIVED' } },
      { name: 'PATCH /page/:id/client-share', path: `/api/wiki/page/${internalPageId}/client-share`, method: 'PATCH', body: { is_client_shared: 1 } },
      { name: 'PATCH /page/:id/reorder', path: `/api/wiki/page/${internalPageId}/reorder`, method: 'PATCH', body: { position: 1 } },
      { name: 'DELETE /page/:id', path: `/api/wiki/page/${internalPageId}`, method: 'DELETE' },
      { name: 'GET /page/:id/versions', path: `/api/wiki/page/${internalPageId}/versions`, method: 'GET' },
      { name: 'GET /page/:id/version/1', path: `/api/wiki/page/${internalPageId}/version/1`, method: 'GET' },
      { name: 'POST /page/:id/version/1/restore', path: `/api/wiki/page/${internalPageId}/version/1/restore`, method: 'POST' },
      { name: 'POST /page/:id/comment', path: `/api/wiki/page/${internalPageId}/comment`, method: 'POST', body: { content: 'Client spam' } },
      { name: 'PATCH /comment/:id', path: `/api/wiki/comment/${internalCommentId}`, method: 'PATCH', body: { content: 'Client edit' } },
      { name: 'PATCH /comment/:id/resolve', path: `/api/wiki/comment/${internalCommentId}/resolve`, method: 'PATCH' },
      { name: 'DELETE /comment/:id', path: `/api/wiki/comment/${internalCommentId}`, method: 'DELETE' },
      { name: 'POST /page/:id/react', path: `/api/wiki/page/${internalPageId}/react`, method: 'POST', body: { reaction: '👍' } },
      { name: 'GET /page/:id/export', path: `/api/wiki/page/${internalPageId}/export`, method: 'GET' },
      { name: 'POST /template/save', path: '/api/wiki/template/save', method: 'POST', body: { name: 'Client Template' } },
      { name: 'DELETE /template/:id', path: '/api/wiki/template/1', method: 'DELETE' },
      { name: 'GET /space/:id (INTERNAL)', path: `/api/wiki/space/${internalSpaceId}`, method: 'GET' },
      { name: 'GET /space/:id/pages (INTERNAL)', path: `/api/wiki/space/${internalSpaceId}/pages`, method: 'GET' },
      { name: 'GET /page/:id (INTERNAL)', path: `/api/wiki/page/${internalPageId}`, method: 'GET' }
    ];

    console.log(`  Verifying client exclusion across ${sweepEndpoints.length} internal endpoints:`);
    for (const ep of sweepEndpoints) {
      const res = await api(ep.path, {
        method: ep.method,
        headers: clientHeaders,
        body: ep.body
      });
      assert(res.status === 403, `Client sweep: ${ep.name} returns HTTP 403 Forbidden`);
    }

    // 5.2 Client accesses CLIENT_SHARED space -> succeeds
    const clientSpacesRes = await api('/api/wiki/spaces', {
      method: 'GET',
      headers: clientHeaders
    });
    assert(clientSpacesRes.status === 200, 'Client lists accessible spaces with 200 OK');
    assert(Array.isArray(clientSpacesRes.data), 'Client spaces returned as array');
    const seesInternal = clientSpacesRes.data.some(s => s.id === internalSpaceId);
    const seesClientShared = clientSpacesRes.data.some(s => s.id === clientSharedSpaceId);
    assert(!seesInternal, 'Client CANNOT see INTERNAL space in space directory');
    assert(seesClientShared, 'Client CAN see CLIENT_SHARED space in space directory');

    // Client accesses specific CLIENT_SHARED space detail
    const clientSpaceDetail = await api(`/api/wiki/space/${clientSharedSpaceId}`, {
      method: 'GET',
      headers: clientHeaders
    });
    assert(clientSpaceDetail.status === 200, 'Client accesses CLIENT_SHARED space detail with 200 OK');
    assert(clientSpaceDetail.data?.id === clientSharedSpaceId, 'Client space detail matches target space');

    // Client accesses CLIENT_SHARED space pages
    const clientSpacePages = await api(`/api/wiki/space/${clientSharedSpaceId}/pages`, {
      method: 'GET',
      headers: clientHeaders
    });
    assert(clientSpacePages.status === 200, 'Client accesses CLIENT_SHARED space pages tree with 200 OK');
    assert(
      clientSpacePages.data.some(p => p.id === clientSharedPageId),
      'Client space pages tree includes client shared page'
    );

    // Client accesses CLIENT_SHARED page view
    const clientPageView = await api(`/api/wiki/page/${clientSharedPageId}`, {
      method: 'GET',
      headers: clientHeaders
    });
    assert(clientPageView.status === 200, 'Client accesses CLIENT_SHARED page with 200 OK');
    assert(
      Array.isArray(clientPageView.data?.comments) && clientPageView.data.comments.length === 0,
      'Rule 12: Internal comments stripped from page view payload for client (comments = [])'
    );

    // 5.3 Client calls comments endpoint -> empty array [] confirmed
    const clientCommentsRes = await api(`/api/wiki/page/${clientSharedPageId}/comments`, {
      method: 'GET',
      headers: clientHeaders
    });
    assert(clientCommentsRes.status === 200, 'Client calls /comments endpoint returns 200 OK');
    assert(Array.isArray(clientCommentsRes.data), 'Client comments response is an array');
    assert(
      clientCommentsRes.data.length === 0,
      'Rule 12: Client comments endpoint returns strictly empty array [] (zero internal comment leakage)'
    );

    // Verify internal team member DOES see the comment
    const memberCommentsRes = await api(`/api/wiki/page/${clientSharedPageId}/comments`, {
      method: 'GET',
      headers: memberHeaders
    });
    assert(memberCommentsRes.data?.length === 1, 'Internal team member sees the internal comment normally');

    // =========================================================================
    // FLOW 6: APPEND-ONLY SWEEP
    // Real UPDATE + DELETE on wiki_page_versions -> both aborted by trigger
    // =========================================================================
    console.log('\n--- FLOW 6: Append-Only DB Trigger Sweep ---');
    console.log('Real UPDATE + DELETE on wiki_page_versions -> both aborted by SQLite triggers');

    // Fetch an active version record to attack
    const sampleVersion = queryOne('SELECT * FROM wiki_page_versions LIMIT 1;');
    assert(sampleVersion !== null, `Target version located for trigger sweep (ID: ${sampleVersion?.id})`);

    // 6.1 Real UPDATE query on wiki_page_versions -> aborted by prevent_page_version_update
    let updateAborted = false;
    let updateErrorMessage = '';
    try {
      execute(
        "UPDATE wiki_page_versions SET title = 'HACKED TITLE BY PASSING GUARD' WHERE id = ?;",
        [sampleVersion.id]
      );
    } catch (err) {
      updateAborted = true;
      updateErrorMessage = err.message;
    }
    assert(updateAborted, 'Direct SQL UPDATE query on wiki_page_versions was aborted');
    assert(
      updateErrorMessage.includes('wiki_page_versions is append-only'),
      `Trigger prevent_page_version_update aborted query: "${updateErrorMessage}"`
    );

    // 6.2 Real DELETE query on wiki_page_versions -> aborted by prevent_page_version_delete
    let deleteAborted = false;
    let deleteErrorMessage = '';
    try {
      execute(
        'DELETE FROM wiki_page_versions WHERE id = ?;',
        [sampleVersion.id]
      );
    } catch (err) {
      deleteAborted = true;
      deleteErrorMessage = err.message;
    }
    assert(deleteAborted, 'Direct SQL DELETE query on wiki_page_versions was aborted');
    assert(
      deleteErrorMessage.includes('wiki_page_versions is append-only'),
      `Trigger prevent_page_version_delete aborted query: "${deleteErrorMessage}"`
    );

    // Verify row was completely preserved
    const versionAfterAttack = queryOne('SELECT * FROM wiki_page_versions WHERE id = ?;', [sampleVersion.id]);
    assert(versionAfterAttack !== null, 'Target version record remains untouched in DB');
    assert(versionAfterAttack.title === sampleVersion.title, 'Target version title was NOT mutated');

    // =========================================================================
    // FLOW 7: VERSION RESTORE MULTI-EDIT
    // Restore version 1 after 3 edits -> version 4 created -> versions 1-3 untouched in DB
    // =========================================================================
    console.log('\n--- FLOW 7: Version Restore Multi-Edit Architecture ---');
    console.log('Restore version 1 after 3 edits -> version 4 created -> versions 1-3 untouched in DB');

    // 7.1 Create initial page (Version 1)
    const multiVersionPageRes = await api('/api/wiki/page/create', {
      method: 'POST',
      headers: memberHeaders,
      body: {
        space_id: lifecycleSpaceId,
        title: `Multi-Version Document V1 ${testSuffix}`,
        emoji_icon: '📜',
        blocks: [
          { type: 'HEADING_1', text: 'Document Foundation (Version 1)' },
          { type: 'PARAGRAPH', text: 'Genesis text that represents the baseline version.' }
        ],
        status: 'PUBLISHED'
      }
    });
    assert(multiVersionPageRes.status === 201, 'Multi-version base page created (201)');
    const mvPageId = multiVersionPageRes.data.id;
    assert(multiVersionPageRes.data.version_number === 1, 'Initial page version is 1');

    // 7.2 Perform Edit 1 -> creates Version 2
    const edit1Res = await api(`/api/wiki/page/${mvPageId}`, {
      method: 'PATCH',
      headers: memberHeaders,
      body: {
        title: `Multi-Version Document V2 ${testSuffix}`,
        blocks: [
          { type: 'HEADING_1', text: 'Document Foundation (Version 2)' },
          { type: 'PARAGRAPH', text: 'Second iteration adding authentication schema details.' }
        ],
        change_summary: 'Added authentication schema',
        save_version: true
      }
    });
    assert(edit1Res.status === 200, 'Edit 1 completed (200)');
    assert(edit1Res.data.version_number === 2, 'Page advanced to Version 2');

    // 7.3 Perform Edit 2 -> creates Version 3
    const edit2Res = await api(`/api/wiki/page/${mvPageId}`, {
      method: 'PATCH',
      headers: memberHeaders,
      body: {
        title: `Multi-Version Document V3 ${testSuffix}`,
        blocks: [
          { type: 'HEADING_1', text: 'Document Foundation (Version 3)' },
          { type: 'PARAGRAPH', text: 'Third iteration adding high-availability clustering.' },
          { type: 'CODE', language: 'bash', code: 'docker swarm init' }
        ],
        change_summary: 'Added clustering specifications',
        save_version: true
      }
    });
    assert(edit2Res.status === 200, 'Edit 2 completed (200)');
    assert(edit2Res.data.version_number === 3, 'Page advanced to Version 3');

    // Verify 3 distinct versions exist in DB
    const threeVersionsInDb = queryAll(
      'SELECT version_number, title FROM wiki_page_versions WHERE page_id = ? ORDER BY version_number ASC;',
      [mvPageId]
    );
    assert(threeVersionsInDb.length === 3, 'Database currently holds exactly 3 versions');

    // 7.4 Restore Version 1 after 3 edits
    const restoreV1Res = await api(`/api/wiki/page/${mvPageId}/version/1/restore`, {
      method: 'POST',
      headers: adminHeaders
    });
    assert(restoreV1Res.status === 200, 'Restore version 1 succeeded (200 OK)');
    assert(restoreV1Res.data.version_number === 4, 'Restore created new Version 4 (never overwritten)');
    assert(
      restoreV1Res.data.title === `Multi-Version Document V1 ${testSuffix}`,
      'Active page title successfully restored to Version 1 title'
    );

    // 7.5 Verify DB: All 4 versions preserved and untouched
    const allVersionsInDb = queryAll(
      'SELECT version_number, title, change_summary FROM wiki_page_versions WHERE page_id = ? ORDER BY version_number ASC;',
      [mvPageId]
    );
    assert(allVersionsInDb.length === 4, 'DB now stores exactly 4 distinct append-only versions');
    assert(allVersionsInDb[0].version_number === 1, 'Version 1 is untouched in DB');
    assert(allVersionsInDb[0].title === `Multi-Version Document V1 ${testSuffix}`, 'Version 1 title intact');
    assert(allVersionsInDb[1].version_number === 2, 'Version 2 is untouched in DB');
    assert(allVersionsInDb[1].title === `Multi-Version Document V2 ${testSuffix}`, 'Version 2 title intact');
    assert(allVersionsInDb[2].version_number === 3, 'Version 3 is untouched in DB');
    assert(allVersionsInDb[2].title === `Multi-Version Document V3 ${testSuffix}`, 'Version 3 title intact');
    assert(allVersionsInDb[3].version_number === 4, 'Version 4 created new in DB');
    assert(allVersionsInDb[3].change_summary === 'Restored from version 1', 'Version 4 change_summary recorded');
    assert(allVersionsInDb[3].title === `Multi-Version Document V1 ${testSuffix}`, 'Version 4 title matches Version 1');

    // =========================================================================
    // FLOW 8: AUTOMATION TRIGGER
    // Page publish fires WIKI_PAGE_PUBLISHED event -> automation_queue row confirmed
    // =========================================================================
    console.log('\n--- FLOW 8: Automation Engine Trigger Dispatching ---');
    console.log('Page publish fires WIKI_PAGE_PUBLISHED event -> automation_queue row confirmed');

    // 8.1 Setup an active automation rule for WIKI / WIKI_PAGE_PUBLISHED
    execute(
      `INSERT INTO automation_rules (
        name, description, scope, trigger_module, trigger_event, is_active, actions, created_by, created_at, updated_at
       ) VALUES (
        'Wiki Page Published Dispatcher', 'Auto-enqueues job when a wiki page is published', 'GLOBAL', 'WIKI', 'WIKI_PAGE_PUBLISHED', 1, '[{"type":"NOTIFY","target":"ADMIN"}]', ?, datetime('now'), datetime('now')
       );`,
      [adminUser.id]
    );
    const activeWikiRule = queryOne(
      "SELECT id, name FROM automation_rules WHERE trigger_module = 'WIKI' AND trigger_event = 'WIKI_PAGE_PUBLISHED' AND is_active = 1 ORDER BY id DESC LIMIT 1;"
    );
    assert(activeWikiRule !== null, `Active automation rule configured (ID: ${activeWikiRule?.id})`);

    // Clean prior automation_queue entries for this test run
    execute("DELETE FROM automation_queue WHERE trigger_event = 'WIKI_PAGE_PUBLISHED';");

    // 8.2 Create a page in DRAFT status
    const draftPageRes = await api('/api/wiki/page/create', {
      method: 'POST',
      headers: memberHeaders,
      body: {
        space_id: lifecycleSpaceId,
        title: `Automation Event Trigger Page ${testSuffix}`,
        emoji_icon: '⚡',
        blocks: [{ type: 'PARAGRAPH', text: 'Publishing this page must fire an automation event.' }],
        status: 'DRAFT'
      }
    });
    assert(draftPageRes.status === 201, 'Draft page created with 201 Created');
    const autoPageId = draftPageRes.data.id;

    // Verify queue is currently empty before publish
    const queueBeforePublish = queryOne(
      "SELECT COUNT(*) as count FROM automation_queue WHERE trigger_event = 'WIKI_PAGE_PUBLISHED' AND trigger_source_id = ?;",
      [String(autoPageId)]
    );
    assert(queueBeforePublish.count === 0, 'automation_queue has 0 rows before page is published');

    // 8.3 Publish the page via PATCH /api/wiki/page/:id/status
    const publishTriggerRes = await api(`/api/wiki/page/${autoPageId}/status`, {
      method: 'PATCH',
      headers: adminHeaders,
      body: { status: 'PUBLISHED' }
    });
    assert(publishTriggerRes.status === 200, 'Page status updated to PUBLISHED (200 OK)');

    // 8.4 Confirm automation_queue row was created
    const queueItem = queryOne(
      `SELECT * FROM automation_queue
       WHERE trigger_event = 'WIKI_PAGE_PUBLISHED'
         AND trigger_source_type = 'WIKI_PAGE'
         AND trigger_source_id = ?
       ORDER BY id DESC LIMIT 1;`,
      [String(autoPageId)]
    );
    assert(queueItem !== null, 'Confirmed new row inserted into automation_queue table');
    assert(queueItem?.status === 'QUEUED', `Queue item has status 'QUEUED' (actual: ${queueItem?.status})`);
    assert(queueItem?.automation_id === activeWikiRule.id, `Linked to active automation rule ID: ${activeWikiRule.id}`);
    assert(queueItem?.triggered_by_user_id === adminUser.id, 'triggered_by_user_id matches admin publisher');

    let parsedPayload = null;
    try {
      parsedPayload = JSON.parse(queueItem?.trigger_data || '{}');
    } catch {
      parsedPayload = {};
    }
    assert(parsedPayload?.page_id === autoPageId, `Queue payload contains page_id: ${parsedPayload?.page_id}`);
    assert(parsedPayload?.space_id === lifecycleSpaceId, `Queue payload contains space_id: ${parsedPayload?.space_id}`);
    assert(
      parsedPayload?.title === `Automation Event Trigger Page ${testSuffix}`,
      `Queue payload contains title: "${parsedPayload?.title}"`
    );

    // =========================================================================
    // SECTION 9: CLEANUP & AUDIT TRAIL CONFIRMATION
    // =========================================================================
    console.log('\n--- Section 9: Access Log & Platform Audit Trail ---');
    const auditCount = queryOne(
      "SELECT COUNT(*) as count FROM access_log WHERE action LIKE 'wiki_%';"
    );
    assert(auditCount.count > 0, `access_log recorded wiki actions (found: ${auditCount.count})`);

  } finally {
    await new Promise((resolve) => server.close(resolve));
    console.log('\n[TEST SERVER] Closed cleanly');
  }

  // Final Summary
  console.log('\n' + '='.repeat(80));
  console.log(`MASTER INTEGRATION TEST SUMMARY: ${passed} Passed, ${failed} Failed`);
  console.log('='.repeat(80));

  if (failed > 0) {
    console.error('\n❌ PRD 27 INTEGRATION SUITE FAILED');
    process.exit(1);
  } else {
    console.log('\n🌟 ALL 8 PRD 27 MASTER INTEGRATION FLOWS PASSED CLEANLY (100%)');
    process.exit(0);
  }
}

run().catch((err) => {
  console.error('Fatal integration test error:', err);
  process.exit(1);
});
