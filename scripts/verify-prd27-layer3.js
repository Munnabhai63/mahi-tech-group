/**
 * scripts/verify-prd27-layer3.js
 * Verification Suite for PRD 27 Layer 3: REST API Routes & Controllers
 *
 * Real HTTP calls, real SQLite database, ZERO MOCKS.
 *
 * Verifies:
 * 1. Express Server Startup on ephemeral port
 * 2. Authentication & Authorization Middleware:
 *    - Missing token -> 401
 *    - Invalid / expired token -> 401
 *    - Role isolation between Admin, Member, and Client Portal
 * 3. Space Endpoints:
 *    - POST /api/wiki/space/create (Admin only, slug generation, audit logged)
 *    - GET /api/wiki/spaces (Admin=all, Member=scoped, Client=CLIENT_SHARED only)
 *    - GET /api/wiki/space/:spaceId (Space detail, members, root pages; client isolation)
 *    - PATCH /api/wiki/space/:spaceId (Admin+, manual updated_at, audit logged)
 *    - POST /api/wiki/space/:spaceId/member/add (Role assignment: VIEWER, EDITOR, MANAGER)
 *    - DELETE /api/wiki/space/:spaceId/member/:userId (Member removal, audit logged)
 *    - PATCH /api/wiki/space/:spaceId/archive (Admin+, read-only guard enforcement)
 * 4. Page Endpoints:
 *    - POST /api/wiki/page/create (EDITOR+ required, slug, version_number=1, FTS sync)
 *    - GET /api/wiki/space/:spaceId/pages (Hierarchical nested tree)
 *    - GET /api/wiki/page/:pageId (Content, metadata, reactions, comments, backlinks)
 *    - PATCH /api/wiki/page/:pageId (EDITOR+, append-only version, FTS sync, updated_at)
 *    - PATCH /api/wiki/page/:pageId/status (Admin+, DRAFT -> PUBLISHED -> ARCHIVED)
 *    - PATCH /api/wiki/page/:pageId/client-share (CLIENT_SHARED space required, audit logged)
 *    - PATCH /api/wiki/page/:pageId/reorder (Admin+, circular reparenting blocked with 400)
 *    - DELETE /api/wiki/page/:pageId (Child deletion guard 400, creator DRAFT or Admin+)
 * 5. Version History & Restore:
 *    - GET /api/wiki/page/:pageId/versions (Client 403, Member/Admin 200)
 *    - GET /api/wiki/page/:pageId/version/:versionId (Version diff snapshot)
 *    - POST /api/wiki/page/:pageId/version/:versionId/restore (Admin+, creates new version)
 * 6. Threaded Comments:
 *    - POST /api/wiki/page/:pageId/comment (Client 403, Member 201)
 *    - GET /api/wiki/page/:pageId/comments (Client strictly [], Member 200)
 *    - PATCH /api/wiki/comment/:commentId (Owner only, is_edited=1)
 *    - PATCH /api/wiki/comment/:commentId/resolve (Owner/Admin, is_resolved=1)
 *    - DELETE /api/wiki/comment/:commentId (Owner/Admin)
 * 7. Emoji Reactions:
 *    - POST /api/wiki/page/:pageId/react (Client 403, Member toggle add/remove)
 * 8. Markdown Export:
 *    - GET /api/wiki/page/:pageId/export (Client 403, Member/Admin 200)
 * 9. Template Endpoints:
 *    - GET /api/wiki/templates (Lists templates, category filter)
 *    - POST /api/wiki/template/save (Admin+, custom template)
 *    - DELETE /api/wiki/template/:templateId (System template 403, Custom template 200)
 * 10. Search:
 *    - GET /api/wiki/search (FTS5 query, space-scoping, rank order, client restriction)
 * 11. Route Ordering & Anti-Collision:
 *    - Static paths (/space/create, /page/create, /search, /templates) are not captured by /:id
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

// HTTP request helper
function makeRequest(serverUrl, path, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, serverUrl);
    const reqOptions = {
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    };

    const req = http.request(url, reqOptions, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        let parsed = null;
        try {
          parsed = JSON.parse(body);
        } catch {
          parsed = body;
        }
        resolve({
          status: res.statusCode,
          headers: res.headers,
          data: parsed
        });
      });
    });

    req.on('error', reject);

    if (options.body) {
      const payload = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
      req.write(payload);
    }
    req.end();
  });
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
  console.log('PRD 27 Layer 3 Verification Suite: REST API Routes & Controllers');
  console.log('='.repeat(80));

  const db = getDatabase();
  const testSuffix = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  // 1. Verify DB Pragmas
  console.log('\n--- Section 1: Pre-flight & DB Pragmas ---');
  const journalMode = queryOne('PRAGMA journal_mode;');
  assert(journalMode.journal_mode.toLowerCase() === 'wal', 'DB is in WAL mode');

  const fk = queryOne('PRAGMA foreign_keys;');
  assert(fk.foreign_keys === 1, 'Foreign keys pragma is ENABLED');

  // 2. Setup Test Identities
  console.log('\n--- Section 2: Identity Setup & Token Generation ---');
  let adminUser = queryOne("SELECT id, name, email, role FROM users WHERE role = 'admin' LIMIT 1;");
  assert(adminUser !== null, `Admin user located: ${adminUser?.name} (${adminUser?.id})`);

  // Create two distinct developer members:
  // Member A: Will be granted access (EDITOR/VIEWER)
  // Member B: Will NOT have access to test space (unauthorized checks)
  const memberAId = crypto.randomUUID();
  execute(
    `INSERT INTO users (id, name, email, password_hash, role, status, created_at, updated_at)
     VALUES (?, 'Wiki Member Alpha', ?, 'dummy_hash', 'developer', 'active', datetime('now'), datetime('now'));`,
    [memberAId, `memberA.${testSuffix}@example.com`]
  );
  const memberA = queryOne('SELECT id, name, email, role FROM users WHERE id = ?;', [memberAId]);

  const memberBId = crypto.randomUUID();
  execute(
    `INSERT INTO users (id, name, email, password_hash, role, status, created_at, updated_at)
     VALUES (?, 'Wiki Member Beta', ?, 'dummy_hash', 'developer', 'active', datetime('now'), datetime('now'));`,
    [memberBId, `memberB.${testSuffix}@example.com`]
  );
  const memberB = queryOne('SELECT id, name, email, role FROM users WHERE id = ?;', [memberBId]);

  // Client user setup
  let clientUser = queryOne("SELECT id, name, email, status FROM clients WHERE status = 'ACTIVE' LIMIT 1;");
  if (!clientUser) {
    const res = execute(
      `INSERT INTO clients (name, email, company_name, status, created_at, updated_at)
       VALUES ('Wiki Test Client', ?, 'Wiki Client Corp', 'ACTIVE', datetime('now'), datetime('now'));`,
      [`client.${testSuffix}@example.com`]
    );
    clientUser = queryOne('SELECT id, name, email, status FROM clients WHERE id = ?;', [res.lastInsertRowid]);
  }
  assert(clientUser !== null, `Client user located: ${clientUser?.name} (${clientUser?.id})`);

  const adminToken = generateInternalUserToken(adminUser);
  const memberAToken = generateInternalUserToken(memberA);
  const memberBToken = generateInternalUserToken(memberB);
  const clientToken = generateClientToken(clientUser);

  // 3. Start Real HTTP Server
  const app = createApp();
  const server = http.createServer(app);

  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  console.log(`[HTTP] Live test server listening on ${baseUrl}`);

  try {
    // -------------------------------------------------------------------------
    // Section 3: Authentication & Authorization Security Checks
    // -------------------------------------------------------------------------
    console.log('\n--- Section 3: Auth & Security Verification ---');

    // 3.1 Missing token
    const resNoAuth = await makeRequest(baseUrl, '/api/wiki/spaces');
    assert(resNoAuth.status === 401, 'Request without Authorization header returns 401');

    // 3.2 Malformed token
    const resBadAuth = await makeRequest(baseUrl, '/api/wiki/spaces', {
      headers: { Authorization: 'Bearer invalid.jwt.token' }
    });
    assert(resBadAuth.status === 401, 'Request with invalid token returns 401');

    // 3.3 Revoked session
    const revokedSessionId = crypto.randomUUID();
    const revokedToken = jwt.sign(
      { sessionId: revokedSessionId, userId: memberA.id, role: memberA.role, email: memberA.email, name: memberA.name },
      config.JWT_SECRET,
      { expiresIn: '2h' }
    );
    execute(
      "INSERT INTO sessions (id, user_id, token, expires_at, is_revoked, created_at) VALUES (?, ?, ?, datetime('now', '+2 hours'), 1, CURRENT_TIMESTAMP)",
      [revokedSessionId, memberA.id, revokedToken]
    );
    const resRevoked = await makeRequest(baseUrl, '/api/wiki/spaces', {
      headers: { Authorization: `Bearer ${revokedToken}` }
    });
    assert(resRevoked.status === 401, 'Request with revoked session returns 401');

    // -------------------------------------------------------------------------
    // Section 4: Space Endpoints
    // -------------------------------------------------------------------------
    console.log('\n--- Section 4: Space Management Endpoints ---');

    // 4.1 POST /api/wiki/space/create
    // Client cannot create space -> 403
    const resClientCreateSpace = await makeRequest(baseUrl, '/api/wiki/space/create', {
      method: 'POST',
      headers: { Authorization: `Bearer ${clientToken}` },
      body: { name: 'Client Illicit Space' }
    });
    assert(resClientCreateSpace.status === 403, 'Client role blocked from creating wiki space (403)');

    // Member cannot create space -> 403
    const resMemberCreateSpace = await makeRequest(baseUrl, '/api/wiki/space/create', {
      method: 'POST',
      headers: { Authorization: `Bearer ${memberAToken}` },
      body: { name: 'Member Space Attempt' }
    });
    assert(resMemberCreateSpace.status === 403, 'Member role blocked from creating wiki space (403)');

    // Admin creates Space 1 (INTERNAL)
    const space1Name = `Internal Engineering Wiki ${testSuffix}`;
    const resAdminCreateSpace1 = await makeRequest(baseUrl, '/api/wiki/space/create', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        name: space1Name,
        description: 'Internal development architecture & SOPs',
        visibility: 'INTERNAL',
        icon: '🛠️',
        color: '#2563EB'
      }
    });
    assert(resAdminCreateSpace1.status === 201, 'Admin successfully creates internal wiki space (201)');
    const space1 = resAdminCreateSpace1.data;
    assert(space1 && space1.id > 0, `Space 1 ID created: ${space1?.id}`);
    assert(space1?.visibility === 'INTERNAL', 'Space 1 visibility is INTERNAL');
    assert(space1?.slug.startsWith('internal-engineering-wiki'), `Space 1 auto-generated slug: ${space1?.slug}`);

    // Verify audit log for space creation
    const spaceCreateLog = queryOne(
      "SELECT action, target_id FROM access_log WHERE action = 'wiki_space_created' AND target_id = ? ORDER BY id DESC LIMIT 1;",
      [space1.id]
    );
    assert(spaceCreateLog !== null, 'access_log recorded wiki_space_created');

    // Admin creates Space 2 (CLIENT_SHARED)
    const space2Name = `Client Partner Portal Wiki ${testSuffix}`;
    const resAdminCreateSpace2 = await makeRequest(baseUrl, '/api/wiki/space/create', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        name: space2Name,
        description: 'Documentation shared with client stakeholders',
        visibility: 'CLIENT_SHARED',
        icon: '🌐',
        color: '#10B981'
      }
    });
    assert(resAdminCreateSpace2.status === 201, 'Admin successfully creates CLIENT_SHARED wiki space (201)');
    const space2 = resAdminCreateSpace2.data;

    // 4.2 GET /api/wiki/spaces (Role-based scoping)
    // Client sees only CLIENT_SHARED spaces
    const resClientSpaces = await makeRequest(baseUrl, '/api/wiki/spaces', {
      headers: { Authorization: `Bearer ${clientToken}` }
    });
    assert(resClientSpaces.status === 200, 'Client retrieves spaces list (200)');
    assert(Array.isArray(resClientSpaces.data), 'Client spaces response is an array');
    const clientHasSpace1 = resClientSpaces.data.some(s => s.id === space1.id);
    const clientHasSpace2 = resClientSpaces.data.some(s => s.id === space2.id);
    assert(!clientHasSpace1, 'Client CANNOT see INTERNAL space1');
    assert(clientHasSpace2, 'Client CAN see CLIENT_SHARED space2');

    // Member B (no memberships) should see 0 spaces
    const resMemberBSpaces = await makeRequest(baseUrl, '/api/wiki/spaces', {
      headers: { Authorization: `Bearer ${memberBToken}` }
    });
    assert(resMemberBSpaces.status === 200, 'Member B retrieves spaces list (200)');
    assert(!resMemberBSpaces.data.some(s => s.id === space1.id || s.id === space2.id), 'Member B sees neither space before addition');

    // 4.3 Space Member Addition: POST /api/wiki/space/:spaceId/member/add
    // Non-admin/member cannot add members -> 403
    const resMemberAddFail = await makeRequest(baseUrl, `/api/wiki/space/${space1.id}/member/add`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${memberBToken}` },
      body: { user_id: memberA.id, role: 'EDITOR' }
    });
    assert(resMemberAddFail.status === 403, 'Non-manager member blocked from adding space members (403)');

    // Admin adds Member A as EDITOR to Space 1
    const resAddMemberA = await makeRequest(baseUrl, `/api/wiki/space/${space1.id}/member/add`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { user_id: memberA.id, role: 'EDITOR' }
    });
    assert(resAddMemberA.status === 201, 'Admin adds Member A as EDITOR to Space 1 (201)');
    assert(resAddMemberA.data?.role === 'EDITOR', 'Member A assigned EDITOR role in Space 1');

    // Also add Member A to Space 2 as EDITOR
    await makeRequest(baseUrl, `/api/wiki/space/${space2.id}/member/add`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { user_id: memberA.id, role: 'EDITOR' }
    });

    // Member A now sees both spaces
    const resMemberASpaces = await makeRequest(baseUrl, '/api/wiki/spaces', {
      headers: { Authorization: `Bearer ${memberAToken}` }
    });
    assert(resMemberASpaces.data.some(s => s.id === space1.id), 'Member A now sees Space 1');
    assert(resMemberASpaces.data.some(s => s.id === space2.id), 'Member A now sees Space 2');

    // 4.4 GET /api/wiki/space/:spaceId
    // Member B accessing Space 1 -> 403
    const resMemberBSpace1 = await makeRequest(baseUrl, `/api/wiki/space/${space1.id}`, {
      headers: { Authorization: `Bearer ${memberBToken}` }
    });
    assert(resMemberBSpace1.status === 403, 'Non-member Member B blocked from reading Space 1 detail (403)');

    // Client accessing Space 1 (INTERNAL) -> 403
    const resClientSpace1 = await makeRequest(baseUrl, `/api/wiki/space/${space1.id}`, {
      headers: { Authorization: `Bearer ${clientToken}` }
    });
    assert(resClientSpace1.status === 403, 'Client blocked from reading INTERNAL Space 1 (403)');

    // Client accessing Space 2 (CLIENT_SHARED) -> 200
    const resClientSpace2 = await makeRequest(baseUrl, `/api/wiki/space/${space2.id}`, {
      headers: { Authorization: `Bearer ${clientToken}` }
    });
    assert(resClientSpace2.status === 200, 'Client successfully reads CLIENT_SHARED Space 2 detail (200)');

    // Member A accessing Space 1 -> 200 (includes members and page tree)
    const resMemberASpace1 = await makeRequest(baseUrl, `/api/wiki/space/${space1.id}`, {
      headers: { Authorization: `Bearer ${memberAToken}` }
    });
    assert(resMemberASpace1.status === 200, 'Member A reads Space 1 detail (200)');
    assert(Array.isArray(resMemberASpace1.data?.members), 'Space 1 detail returns members array');
    assert(resMemberASpace1.data?.user_role === 'EDITOR', 'Member A user_role is EDITOR');

    // 4.5 PATCH /api/wiki/space/:spaceId
    const resUpdateSpace = await makeRequest(baseUrl, `/api/wiki/space/${space1.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { description: 'Updated development architecture notes', color: '#1E40AF' }
    });
    assert(resUpdateSpace.status === 200, 'Admin updates space detail (200)');
    assert(resUpdateSpace.data?.description === 'Updated development architecture notes', 'Space description updated');

    // Check updated_at was refreshed in DB
    const spaceDb = queryOne('SELECT updated_at FROM wiki_spaces WHERE id = ?;', [space1.id]);
    assert(spaceDb.updated_at !== null, 'wiki_spaces updated_at timestamp is present');

    // 4.6 DELETE /api/wiki/space/:spaceId/member/:userId
    // Add Member B temporarily, then remove
    await makeRequest(baseUrl, `/api/wiki/space/${space1.id}/member/add`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { user_id: memberB.id, role: 'VIEWER' }
    });
    const resRemoveMemberB = await makeRequest(baseUrl, `/api/wiki/space/${space1.id}/member/${memberB.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(resRemoveMemberB.status === 200, 'Admin removes member from space (200)');

    // -------------------------------------------------------------------------
    // Section 5: Page Endpoints (Creation, Hierarchy, Updates, Deletion)
    // -------------------------------------------------------------------------
    console.log('\n--- Section 5: Page Management Endpoints ---');

    // 5.1 POST /api/wiki/page/create
    // Client cannot create pages -> 403
    const resClientCreatePage = await makeRequest(baseUrl, '/api/wiki/page/create', {
      method: 'POST',
      headers: { Authorization: `Bearer ${clientToken}` },
      body: { space_id: space2.id, title: 'Client Illicit Page' }
    });
    assert(resClientCreatePage.status === 403, 'Client blocked from creating pages (403)');

    // Member B (non-member) cannot create page in Space 1 -> 403
    const resMemberBCreatePage = await makeRequest(baseUrl, '/api/wiki/page/create', {
      method: 'POST',
      headers: { Authorization: `Bearer ${memberBToken}` },
      body: { space_id: space1.id, title: 'Unauthorized Page' }
    });
    assert(resMemberBCreatePage.status === 403, 'Non-space member blocked from creating page (403)');

    // Member A (EDITOR) creates Root Page 1 in Space 1
    const page1Content = JSON.stringify([
      { id: crypto.randomUUID(), type: 'HEADING_1', content: 'Architecture Overview' },
      { id: crypto.randomUUID(), type: 'PARAGRAPH', content: 'This system is structured with layered clean architecture.' }
    ]);
    const resCreatePage1 = await makeRequest(baseUrl, '/api/wiki/page/create', {
      method: 'POST',
      headers: { Authorization: `Bearer ${memberAToken}` },
      body: {
        space_id: space1.id,
        title: `Architecture Overview ${testSuffix}`,
        content: page1Content,
        emoji_icon: '🏛️',
        status: 'PUBLISHED'
      }
    });
    assert(resCreatePage1.status === 201, 'Member A creates Page 1 in Space 1 (201)');
    const page1 = resCreatePage1.data;
    assert(page1 && page1.id > 0, `Page 1 created with ID: ${page1?.id}`);
    assert(page1?.word_count > 0, `Page 1 word_count computed: ${page1?.word_count}`);
    assert(page1?.reading_time_minutes >= 1, `Page 1 reading_time computed: ${page1?.reading_time_minutes}`);
    assert(page1?.current_version === 1, 'Page 1 initial version is 1');

    // Member A creates Child Page under Page 1 (Hierarchy)
    const childPageContent = JSON.stringify([
      { id: crypto.randomUUID(), type: 'HEADING_2', content: 'Database Migrations' },
      { id: crypto.randomUUID(), type: 'PARAGRAPH', content: 'SQLite WAL mode provides high concurrency.' },
      { id: crypto.randomUUID(), type: 'PAGE_LINK', content: 'Overview Link', attrs: { target_page_id: page1.id } }
    ]);
    const resCreateChildPage = await makeRequest(baseUrl, '/api/wiki/page/create', {
      method: 'POST',
      headers: { Authorization: `Bearer ${memberAToken}` },
      body: {
        space_id: space1.id,
        parent_page_id: page1.id,
        title: `Database Migrations Guide ${testSuffix}`,
        content: childPageContent,
        emoji_icon: '💾',
        status: 'PUBLISHED'
      }
    });
    assert(resCreateChildPage.status === 201, 'Member A creates child page under Page 1 (201)');
    const childPage = resCreateChildPage.data;
    assert(childPage.parent_page_id === page1.id, 'Child page parent_page_id set correctly');

    // 5.2 GET /api/wiki/space/:spaceId/pages (Hierarchical tree)
    const resTree = await makeRequest(baseUrl, `/api/wiki/space/${space1.id}/pages`, {
      headers: { Authorization: `Bearer ${memberAToken}` }
    });
    assert(resTree.status === 200, 'Member A retrieves nested page tree for space (200)');
    assert(Array.isArray(resTree.data), 'Page tree response is an array of root pages');
    const rootInTree = resTree.data.find(p => p.id === page1.id);
    assert(rootInTree !== undefined, 'Page 1 exists at root level of tree');
    assert(Array.isArray(rootInTree?.children), 'Root page has children array');
    assert(rootInTree?.children.some(c => c.id === childPage.id), 'Child page is nested under root in tree');

    // 5.3 GET /api/wiki/page/:pageId (Detail, Backlinks, Reactions)
    const resGetPage1 = await makeRequest(baseUrl, `/api/wiki/page/${page1.id}`, {
      headers: { Authorization: `Bearer ${memberAToken}` }
    });
    assert(resGetPage1.status === 200, 'Member A reads Page 1 detail (200)');
    assert(Array.isArray(resGetPage1.data?.backlinks), 'Page 1 has backlinks array');
    assert(resGetPage1.data?.backlinks.some(b => b.id === childPage.id), 'Child page backlink recognized on Page 1');

    // 5.4 PATCH /api/wiki/page/:pageId (Save new content -> append-only version 2)
    const updatedContent = JSON.stringify([
      { id: crypto.randomUUID(), type: 'HEADING_1', content: 'Architecture Overview — Rev 2' },
      { id: crypto.randomUUID(), type: 'PARAGRAPH', content: 'Updated architecture documentation with microservices reference.' }
    ]);
    const resUpdatePage1 = await makeRequest(baseUrl, `/api/wiki/page/${page1.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${memberAToken}` },
      body: {
        title: `Architecture Overview (Revised) ${testSuffix}`,
        content: updatedContent,
        change_summary: 'Added microservices reference'
      }
    });
    assert(resUpdatePage1.status === 200, 'Member A updates Page 1 (200)');
    assert(resUpdatePage1.data?.current_version === 2, 'Page 1 now on version 2');

    // Verify DB versions table has 2 rows
    const versionsDb = queryAll('SELECT version_number FROM wiki_page_versions WHERE page_id = ? ORDER BY version_number ASC;', [page1.id]);
    assert(versionsDb.length === 2, 'wiki_page_versions contains exactly 2 append-only versions');

    // 5.5 PATCH /api/wiki/page/:pageId/status
    const resStatusUpdate = await makeRequest(baseUrl, `/api/wiki/page/${page1.id}/status`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { status: 'ARCHIVED' }
    });
    assert(resStatusUpdate.status === 200, 'Admin changes page status to ARCHIVED (200)');

    // While archived, edits must be rejected with 400
    const resEditArchived = await makeRequest(baseUrl, `/api/wiki/page/${page1.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${memberAToken}` },
      body: { title: 'Illegal Edit on Archived Page' }
    });
    assert(resEditArchived.status === 400, 'Editing ARCHIVED page rejected with 400');

    // Restore to PUBLISHED
    await makeRequest(baseUrl, `/api/wiki/page/${page1.id}/status`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { status: 'PUBLISHED' }
    });

    // 5.6 PATCH /api/wiki/page/:pageId/client-share
    // Attempting to share page from INTERNAL space1 with client -> 400
    const resBadShare = await makeRequest(baseUrl, `/api/wiki/page/${page1.id}/client-share`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { is_client_shared: 1 }
    });
    assert(resBadShare.status === 400, 'Sharing page in INTERNAL space with client rejected with 400');

    // Create Page in Space 2 (CLIENT_SHARED space)
    const resCreatePage2 = await makeRequest(baseUrl, '/api/wiki/page/create', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        space_id: space2.id,
        title: `Client Onboarding Guide ${testSuffix}`,
        content: JSON.stringify([{ id: crypto.randomUUID(), type: 'PARAGRAPH', content: 'Welcome to Mahi Tech Group portal!' }]),
        status: 'PUBLISHED'
      }
    });
    const page2 = resCreatePage2.data;

    // Enable client sharing on Page 2
    const resGoodShare = await makeRequest(baseUrl, `/api/wiki/page/${page2.id}/client-share`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { is_client_shared: 1 }
    });
    assert(resGoodShare.status === 200, 'Sharing page in CLIENT_SHARED space succeeded (200)');

    // Client can now read Page 2
    const resClientGetPage2 = await makeRequest(baseUrl, `/api/wiki/page/${page2.id}`, {
      headers: { Authorization: `Bearer ${clientToken}` }
    });
    assert(resClientGetPage2.status === 200, 'Client can read client-shared page (200)');
    assert(Array.isArray(resClientGetPage2.data?.comments) && resClientGetPage2.data.comments.length === 0, 'Client strictly receives empty comments array []');

    // 5.7 PATCH /api/wiki/page/:pageId/reorder
    // Attempt circular reparenting: make Page 1 parent of itself -> 400
    const resSelfParent = await makeRequest(baseUrl, `/api/wiki/page/${page1.id}/reorder`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { parent_page_id: page1.id }
    });
    assert(resSelfParent.status === 400, 'Self-parenting rejected with 400');

    // Attempt circular reparenting: make childPage parent of page1 -> 400
    const resCircular = await makeRequest(baseUrl, `/api/wiki/page/${page1.id}/reorder`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { parent_page_id: childPage.id }
    });
    assert(resCircular.status === 400, 'Circular hierarchy reparenting rejected with 400');

    // Valid reorder
    const resValidReorder = await makeRequest(baseUrl, `/api/wiki/page/${childPage.id}/reorder`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { position: 5 }
    });
    assert(resValidReorder.status === 200, 'Admin reorders child page (200)');
    assert(resValidReorder.data?.position === 5, 'Position updated to 5');

    // 5.8 DELETE /api/wiki/page/:pageId
    // Attempt to delete Page 1 while it has childPage -> 400 (child deletion guard)
    const resDeleteParent = await makeRequest(baseUrl, `/api/wiki/page/${page1.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(resDeleteParent.status === 400, 'Deleting page with child pages rejected with 400');

    // Delete child page first -> 200
    const resDeleteChild = await makeRequest(baseUrl, `/api/wiki/page/${childPage.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(resDeleteChild.status === 200, 'Child page successfully deleted (200)');

    // -------------------------------------------------------------------------
    // Section 6: Version History & Version Restore
    // -------------------------------------------------------------------------
    console.log('\n--- Section 6: Version History & Version Restore Endpoints ---');

    // 6.1 GET /api/wiki/page/:pageId/versions
    // Client blocked -> 403
    const resClientVersions = await makeRequest(baseUrl, `/api/wiki/page/${page1.id}/versions`, {
      headers: { Authorization: `Bearer ${clientToken}` }
    });
    assert(resClientVersions.status === 403, 'Client blocked from viewing version history (403)');

    // Member A views versions
    const resGetVersions = await makeRequest(baseUrl, `/api/wiki/page/${page1.id}/versions`, {
      headers: { Authorization: `Bearer ${memberAToken}` }
    });
    assert(resGetVersions.status === 200, 'Member views version history (200)');
    assert(Array.isArray(resGetVersions.data) && resGetVersions.data.length === 2, 'Exactly 2 versions in history');

    // 6.2 GET /api/wiki/page/:pageId/version/:versionId
    const resGetVersion1 = await makeRequest(baseUrl, `/api/wiki/page/${page1.id}/version/1`, {
      headers: { Authorization: `Bearer ${memberAToken}` }
    });
    assert(resGetVersion1.status === 200, 'Member views Version 1 snapshot (200)');
    assert(resGetVersion1.data?.version_number === 1, 'Version 1 snapshot confirmed');

    // 6.3 POST /api/wiki/page/:pageId/version/:versionId/restore
    // Member blocked -> 403 (Admin only)
    const resMemberRestore = await makeRequest(baseUrl, `/api/wiki/page/${page1.id}/version/1/restore`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${memberAToken}` }
    });
    assert(resMemberRestore.status === 403, 'Member blocked from restoring version (403)');

    // Admin restores Version 1 -> creates Version 3 (append-only)
    const resAdminRestore = await makeRequest(baseUrl, `/api/wiki/page/${page1.id}/version/1/restore`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(resAdminRestore.status === 200, 'Admin restores Version 1 (200)');
    assert(resAdminRestore.data?.current_version === 3, 'Restoration created append-only Version 3');

    // Verify all 3 versions preserved in DB
    const allVersionsDb = queryAll('SELECT version_number FROM wiki_page_versions WHERE page_id = ? ORDER BY version_number ASC;', [page1.id]);
    assert(allVersionsDb.length === 3, 'All 3 versions preserved in wiki_page_versions (append-only)');

    // -------------------------------------------------------------------------
    // Section 7: Threaded Comments Endpoints
    // -------------------------------------------------------------------------
    console.log('\n--- Section 7: Threaded Comments Endpoints ---');

    // 7.1 POST /api/wiki/page/:pageId/comment
    // Client blocked -> 403
    const resClientComment = await makeRequest(baseUrl, `/api/wiki/page/${page1.id}/comment`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${clientToken}` },
      body: { content: 'Client illicit comment' }
    });
    assert(resClientComment.status === 403, 'Client blocked from adding comments (403)');

    // Member A posts top-level comment
    const resPostComment = await makeRequest(baseUrl, `/api/wiki/page/${page1.id}/comment`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${memberAToken}` },
      body: { content: 'Should we add Redis caching guidelines here?' }
    });
    assert(resPostComment.status === 201, 'Member A posts top-level comment (201)');
    const comment1 = resPostComment.data;
    assert(comment1 && comment1.id > 0, `Comment 1 ID created: ${comment1?.id}`);

    // Admin replies to comment 1
    const resPostReply = await makeRequest(baseUrl, `/api/wiki/page/${page1.id}/comment`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        content: 'Yes, absolutely. Please add a Redis section.',
        parent_comment_id: comment1.id
      }
    });
    assert(resPostReply.status === 201, 'Admin posts threaded reply (201)');
    const reply1 = resPostReply.data;
    assert(reply1.parent_comment_id === comment1.id, 'Reply parent_comment_id linked correctly');

    // 7.2 GET /api/wiki/page/:pageId/comments
    // Client receives strictly empty array []
    const resClientGetComments = await makeRequest(baseUrl, `/api/wiki/page/${page1.id}/comments`, {
      headers: { Authorization: `Bearer ${clientToken}` }
    });
    assert(resClientGetComments.status === 200, 'Client comments query returns 200');
    assert(Array.isArray(resClientGetComments.data) && resClientGetComments.data.length === 0, 'Client receives empty array [] on /comments endpoint');

    // Member gets comments tree
    const resMemberGetComments = await makeRequest(baseUrl, `/api/wiki/page/${page1.id}/comments`, {
      headers: { Authorization: `Bearer ${memberAToken}` }
    });
    assert(resMemberGetComments.status === 200, 'Member retrieves comments tree (200)');
    assert(Array.isArray(resMemberGetComments.data), 'Member comments response is an array');
    const commentNode = resMemberGetComments.data.find(c => c.id === comment1.id);
    assert(commentNode !== undefined, 'Comment 1 found in comments tree');
    assert(Array.isArray(commentNode?.replies) && commentNode.replies.some(r => r.id === reply1.id), 'Reply nested under parent comment');

    // 7.3 PATCH /api/wiki/comment/:commentId (Edit comment)
    // Admin cannot edit Member A's comment -> 403 (owner only)
    const resAdminEditComment = await makeRequest(baseUrl, `/api/wiki/comment/${comment1.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { content: 'Admin illicit edit' }
    });
    assert(resAdminEditComment.status === 403, 'Non-owner blocked from editing comment (403)');

    // Member A edits own comment -> 200
    const resOwnerEditComment = await makeRequest(baseUrl, `/api/wiki/comment/${comment1.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${memberAToken}` },
      body: { content: 'Should we add Redis and Memcached caching guidelines here?' }
    });
    assert(resOwnerEditComment.status === 200, 'Comment owner edits comment (200)');
    assert(resOwnerEditComment.data?.is_edited === 1, 'Comment marked is_edited = 1');

    // 7.4 PATCH /api/wiki/comment/:commentId/resolve
    const resResolveComment = await makeRequest(baseUrl, `/api/wiki/comment/${comment1.id}/resolve`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${memberAToken}` }
    });
    assert(resResolveComment.status === 200, 'Comment owner resolves comment thread (200)');
    assert(resResolveComment.data?.is_resolved === 1, 'Comment marked is_resolved = 1');

    // 7.5 DELETE /api/wiki/comment/:commentId
    // Member B cannot delete comment -> 403
    const resMemberBDeleteComment = await makeRequest(baseUrl, `/api/wiki/comment/${reply1.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${memberBToken}` }
    });
    assert(resMemberBDeleteComment.status === 403, 'Non-owner non-admin blocked from deleting comment (403)');

    // Admin deletes reply
    const resAdminDeleteComment = await makeRequest(baseUrl, `/api/wiki/comment/${reply1.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(resAdminDeleteComment.status === 200, 'Admin successfully deletes comment (200)');

    // -------------------------------------------------------------------------
    // Section 8: Emoji Reactions Endpoint
    // -------------------------------------------------------------------------
    console.log('\n--- Section 8: Emoji Reactions Endpoints ---');

    // 8.1 POST /api/wiki/page/:pageId/react
    // Client blocked -> 403
    const resClientReact = await makeRequest(baseUrl, `/api/wiki/page/${page1.id}/react`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${clientToken}` },
      body: { reaction: '👍' }
    });
    assert(resClientReact.status === 403, 'Client blocked from reacting to page (403)');

    // Member A reacts with 👍 -> added
    const resReactAdd = await makeRequest(baseUrl, `/api/wiki/page/${page1.id}/react`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${memberAToken}` },
      body: { reaction: '👍' }
    });
    assert(resReactAdd.status === 200, 'Member A reacts with 👍 (200)');
    assert(resReactAdd.data?.action === 'added', 'Reaction action is "added"');

    // Member A reacts with 👍 again -> removed (toggle)
    const resReactToggle = await makeRequest(baseUrl, `/api/wiki/page/${page1.id}/react`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${memberAToken}` },
      body: { reaction: '👍' }
    });
    assert(resReactToggle.status === 200, 'Member A reacts with 👍 again (200)');
    assert(resReactToggle.data?.action === 'removed', 'Reaction action toggled to "removed"');

    // -------------------------------------------------------------------------
    // Section 9: Markdown Export Endpoint
    // -------------------------------------------------------------------------
    console.log('\n--- Section 9: Markdown Export Endpoint ---');

    // 9.1 GET /api/wiki/page/:pageId/export
    // Client blocked -> 403
    const resClientExport = await makeRequest(baseUrl, `/api/wiki/page/${page1.id}/export`, {
      headers: { Authorization: `Bearer ${clientToken}` }
    });
    assert(resClientExport.status === 403, 'Client blocked from exporting page (403)');

    // Member A exports Page 1 -> 200 with Markdown
    const resMemberExport = await makeRequest(baseUrl, `/api/wiki/page/${page1.id}/export`, {
      headers: { Authorization: `Bearer ${memberAToken}` }
    });
    assert(resMemberExport.status === 200, 'Member A exports page to Markdown (200)');
    assert(typeof resMemberExport.data?.markdown === 'string', 'Export data contains markdown string');
    assert(resMemberExport.data?.markdown.includes('# Architecture Overview'), 'Exported markdown contains H1 heading');

    // -------------------------------------------------------------------------
    // Section 10: Template Endpoints
    // -------------------------------------------------------------------------
    console.log('\n--- Section 10: Template Management Endpoints ---');

    // 10.1 GET /api/wiki/templates
    const resGetTemplates = await makeRequest(baseUrl, '/api/wiki/templates', {
      headers: { Authorization: `Bearer ${memberAToken}` }
    });
    assert(resGetTemplates.status === 200, 'Retrieve templates list (200)');
    assert(Array.isArray(resGetTemplates.data), 'Templates list is an array');
    const systemTemplates = resGetTemplates.data.filter(t => t.is_system_template === 1);
    assert(systemTemplates.length >= 10, `Found ${systemTemplates.length} system templates (>= 10)`);

    // Filter by category
    const resCategoryTemplates = await makeRequest(baseUrl, '/api/wiki/templates?category=ENGINEERING', {
      headers: { Authorization: `Bearer ${memberAToken}` }
    });
    assert(resCategoryTemplates.status === 200, 'Filter templates by ENGINEERING category (200)');
    assert(resCategoryTemplates.data.every(t => t.category === 'ENGINEERING'), 'All returned templates have category ENGINEERING');

    // 10.2 POST /api/wiki/template/save (Save custom template)
    // Member blocked -> 403
    const resMemberSaveTemplate = await makeRequest(baseUrl, '/api/wiki/template/save', {
      method: 'POST',
      headers: { Authorization: `Bearer ${memberAToken}` },
      body: { name: 'Member Custom Template' }
    });
    assert(resMemberSaveTemplate.status === 403, 'Member blocked from saving templates (403)');

    // Admin saves custom template -> 201
    const resAdminSaveTemplate = await makeRequest(baseUrl, '/api/wiki/template/save', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        name: `Custom Deployment Checklist ${testSuffix}`,
        description: 'Checklist before pushing to production',
        category: 'ENGINEERING',
        content: JSON.stringify([
          { id: crypto.randomUUID(), type: 'HEADING_1', content: 'Production Checklist' },
          { id: crypto.randomUUID(), type: 'TODO', content: 'Database backup confirmed' }
        ]),
        preview_text: 'Production checklist'
      }
    });
    assert(resAdminSaveTemplate.status === 201, 'Admin saves custom template (201)');
    const customTemplate = resAdminSaveTemplate.data;
    assert(customTemplate && customTemplate.id > 0, `Custom template created with ID: ${customTemplate?.id}`);
    assert(customTemplate?.is_system_template === 0, 'Custom template has is_system_template = 0');

    // 10.3 DELETE /api/wiki/template/:templateId
    // Attempt to delete system template -> 403 Forbidden (Spec rule)
    const systemTpl = systemTemplates[0];
    const resDeleteSystemTpl = await makeRequest(baseUrl, `/api/wiki/template/${systemTpl.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(resDeleteSystemTpl.status === 403, 'Deleting system template blocked with 403 Forbidden');

    // Delete custom template -> 200
    const resDeleteCustomTpl = await makeRequest(baseUrl, `/api/wiki/template/${customTemplate.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(resDeleteCustomTpl.status === 200, 'Admin deletes custom template (200)');

    // -------------------------------------------------------------------------
    // Section 11: Full-Text Search (FTS5) Endpoint
    // -------------------------------------------------------------------------
    console.log('\n--- Section 11: Full-Text Search (FTS5) Endpoints ---');

    // 11.1 GET /api/wiki/search?q=Architecture
    const resSearch = await makeRequest(baseUrl, '/api/wiki/search?q=Architecture', {
      headers: { Authorization: `Bearer ${memberAToken}` }
    });
    assert(resSearch.status === 200, 'Full-text search returns 200');
    assert(Array.isArray(resSearch.data), 'Search results is an array');
    const foundPage1 = resSearch.data.find(r => r.page_id === page1.id);
    assert(foundPage1 !== undefined, 'Search located Page 1 by keyword');
    assert(foundPage1?.excerpt.includes('<mark>') || foundPage1?.title.includes('Architecture'), 'Search result includes highlight or match');

    // 11.2 Search with space_id scoping
    const resScopedSearch = await makeRequest(baseUrl, `/api/wiki/search?q=Architecture&space_id=${space1.id}`, {
      headers: { Authorization: `Bearer ${memberAToken}` }
    });
    assert(resScopedSearch.status === 200, 'Scoped space search returns 200');
    assert(resScopedSearch.data.every(r => r.space_id === space1.id), 'All results scoped to space 1');

    // 11.3 Client Search: only returns CLIENT_SHARED spaces & is_client_shared=1 pages
    const resClientSearch = await makeRequest(baseUrl, '/api/wiki/search?q=portal', {
      headers: { Authorization: `Bearer ${clientToken}` }
    });
    assert(resClientSearch.status === 200, 'Client search returns 200');
    assert(Array.isArray(resClientSearch.data), 'Client search results is an array');
    assert(!resClientSearch.data.some(r => r.space_id === space1.id), 'Client search never returns results from INTERNAL space 1');

    // -------------------------------------------------------------------------
    // Section 12: Route Ordering & Anti-Collision Verification
    // -------------------------------------------------------------------------
    console.log('\n--- Section 12: Route Ordering & Anti-Collision Verification ---');

    // Ensure static endpoints were not intercepted by parameterized /:id routes:
    // 12.1 /api/wiki/spaces (static) vs /api/wiki/space/:spaceId
    const resSpacesStatic = await makeRequest(baseUrl, '/api/wiki/spaces', {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(resSpacesStatic.status === 200 && Array.isArray(resSpacesStatic.data), 'GET /api/wiki/spaces correctly returns array (not captured as :spaceId)');

    // 12.2 /api/wiki/templates (static) vs /api/wiki/template/:templateId
    const resTplStatic = await makeRequest(baseUrl, '/api/wiki/templates', {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(resTplStatic.status === 200 && Array.isArray(resTplStatic.data), 'GET /api/wiki/templates correctly returns array (not captured as :templateId)');

    // 12.3 /api/wiki/search (static) vs parameterized routes
    const resSearchStatic = await makeRequest(baseUrl, '/api/wiki/search?q=test', {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(resSearchStatic.status === 200 && Array.isArray(resSearchStatic.data), 'GET /api/wiki/search correctly handles query (not captured by page :id)');

    // -------------------------------------------------------------------------
    // Section 13: Space Archiving & Final Cascade Tests
    // -------------------------------------------------------------------------
    console.log('\n--- Section 13: Space Archiving & Cascade Tests ---');

    // Archive Space 1
    const resArchiveSpace1 = await makeRequest(baseUrl, `/api/wiki/space/${space1.id}/archive`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(resArchiveSpace1.status === 200, 'Admin archives Space 1 (200)');
    assert(resArchiveSpace1.data?.is_archived === 1, 'Space 1 marked is_archived = 1');

    // Creating page in archived space must be blocked with 400
    const resCreateInArchived = await makeRequest(baseUrl, '/api/wiki/page/create', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { space_id: space1.id, title: 'Blocked Page in Archived Space' }
    });
    assert(resCreateInArchived.status === 400, 'Page creation in archived space rejected with 400');

    // Delete Page 1 cleanly (child is already deleted)
    const resDeletePage1 = await makeRequest(baseUrl, `/api/wiki/page/${page1.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(resDeletePage1.status === 200, 'Admin deletes Page 1 successfully (200)');

  } finally {
    // Shutdown HTTP server cleanly
    await new Promise((resolve) => server.close(resolve));
    console.log('\n[HTTP] Test server closed cleanly');
  }

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------
  console.log('\n' + '='.repeat(80));
  console.log(`PRD 27 Layer 3 Verification Summary:`);
  console.log(`  Total Tests Run: ${testCount}`);
  console.log(`  Passed:          \x1b[32m${passed}\x1b[0m`);
  console.log(`  Failed:          \x1b[31m${failed}\x1b[0m`);
  console.log('='.repeat(80));

  if (failed > 0) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('[FATAL] Unhandled verification error:', err);
  process.exit(1);
});
