/**
 * PRD 18 — Layer 3 Verification Suite: Backlog Service & API Endpoints
 * 
 * Verifies with real HTTP network calls:
 * 1. Member creates Backlog Item (Role: All) -> HTTP 201
 * 2. Admin creates Backlog Item with story points -> HTTP 201
 * 3. Member blocked from directly assigning item to sprint on create -> HTTP 403
 * 4. Validation: Blank title rejected -> HTTP 400
 * 5. Rule 3: Story points range 0-999 (invalid values rejected) -> HTTP 400
 * 6. Validation: Non-existent project rejected -> HTTP 404
 * 7. Pure backlog listing (GET /api/backlog/project/:projectId) -> HTTP 200
 * 8. Item detail with history (GET /api/backlog/item/:itemId) -> HTTP 200
 * 9. Item owner edits own item (PATCH /api/backlog/item/:itemId) -> HTTP 200
 * 10. Rule 7: Edit auto-logs to backlog_item_history with old_value and new_value
 * 11. Other member blocked from editing someone else's item -> HTTP 403
 * 12. Admin can edit any item -> HTTP 200
 * 13. Member blocked from moving item Sprint <-> Backlog -> HTTP 403
 * 14. Admin moves item to draft sprint -> HTTP 200
 * 15. Rule 7: Move auto-logs sprint_id change to history
 * 16. Moved item removed from pure backlog query
 * 17. Admin moves item back to backlog (sprint_id = null) -> HTTP 200
 * 18. Rule 9: Admin moving item in someone else's ACTIVE sprint without reason (< 10 chars) -> HTTP 400 blocked
 * 19. Rule 9: Admin moving item in someone else's ACTIVE sprint with valid reason (>= 10 chars) -> HTTP 200 + access_log verified
 * 20. Assigned member updates status (PATCH /api/backlog/item/:itemId/status) -> HTTP 200
 * 21. Rule 7: Status change auto-logs to history
 * 22. Unassigned non-admin member blocked from updating status -> HTTP 403
 * 23. Admin reorders item position (PATCH /api/backlog/item/:itemId/reorder) -> HTTP 200
 * 24. Member blocked from reordering item -> HTTP 403
 * 25. Rule 5 & Line 217: Non-TODO item cannot be deleted -> HTTP 400 blocked
 * 26. Rule 5: Item in ACTIVE sprint cannot be deleted -> HTTP 400 blocked
 * 27. Member blocked from deleting item -> HTTP 403
 * 28. Admin deletes TODO backlog item -> HTTP 200
 */

import http from 'node:http';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { getDatabase, queryOne, queryAll, execute } from '../src/db/database.js';
import { createApp } from '../src/app.js';
import { config } from '../src/config.js';

console.log('===================================================================');
console.log('       PRD 18 — LAYER 3: BACKLOG SERVICE & API TEST SUITE');
console.log('===================================================================\n');

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(condition, testName, details = '') {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✅ PASS: ${testName}`);
    if (details) console.log(`     └─ ${details}`);
  } else {
    failedTests++;
    console.error(`  ❌ FAIL: ${testName}`);
    if (details) console.error(`     └─ ${details}`);
    process.exitCode = 1;
  }
}

function createAuthToken(user) {
  const sessionId = crypto.randomUUID();
  const token = jwt.sign(
    { sessionId, userId: user.id, role: user.role },
    config.JWT_SECRET,
    { expiresIn: '24h' }
  );
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  execute(`
    INSERT INTO sessions (id, user_id, token, device_info, ip_address, created_at, expires_at, is_revoked)
    VALUES (?, ?, ?, 'Test Harness', '127.0.0.1', datetime('now'), ?, 0)
  `, [sessionId, user.id, token, expiresAt]);

  return token;
}

async function run() {
  const db = getDatabase();

  // 1. Setup isolated test entities
  console.log('--- 1. SETTING UP TEST USERS & PROJECT ---');
  const ts = Date.now();

  // Admin user
  let adminUser = queryOne("SELECT * FROM users WHERE role = 'admin' AND status = 'active' LIMIT 1;");
  if (!adminUser) {
    const adminId = `admin-l3-${ts}`;
    execute(`
      INSERT INTO users (id, name, email, password_hash, role, status, created_at)
      VALUES (?, 'Admin Tester', 'admin.l3.${ts}@mahi.com', 'hash', 'admin', 'active', datetime('now'))
    `, [adminId]);
    adminUser = queryOne('SELECT * FROM users WHERE id = ?', [adminId]);
  }

  // Member 1 (Developer)
  const member1Id = `member1-${ts}`;
  execute(`
    INSERT INTO users (id, name, email, password_hash, role, status, created_at)
    VALUES (?, 'Alice Developer', 'alice.${ts}@mahi.com', 'hash', 'developer', 'active', datetime('now'))
  `, [member1Id]);
  const member1User = queryOne('SELECT * FROM users WHERE id = ?', [member1Id]);

  // Member 2 (Developer)
  const member2Id = `member2-${ts}`;
  execute(`
    INSERT INTO users (id, name, email, password_hash, role, status, created_at)
    VALUES (?, 'Bob Developer', 'bob.${ts}@mahi.com', 'hash', 'developer', 'active', datetime('now'))
  `, [member2Id]);
  const member2User = queryOne('SELECT * FROM users WHERE id = ?', [member2Id]);

  // Another Admin / Sprint Lead
  const otherLeadId = `lead-${ts}`;
  execute(`
    INSERT INTO users (id, name, email, password_hash, role, sub_role, status, created_at)
    VALUES (?, 'Other Lead', 'lead.${ts}@mahi.com', 'hash', 'developer', 'lead', 'active', datetime('now'))
  `, [otherLeadId]);
  const otherLeadUser = queryOne('SELECT * FROM users WHERE id = ?', [otherLeadId]);

  const adminToken = createAuthToken(adminUser);
  const member1Token = createAuthToken(member1User);
  const member2Token = createAuthToken(member2User);
  const otherLeadToken = createAuthToken(otherLeadUser);

  // Create test project
  let idea = queryOne('SELECT id FROM ideas LIMIT 1;');
  if (!idea) {
    const ideaId = `idea-l3-${ts}`;
    execute(`
      INSERT INTO ideas (id, owner_id, title, description, status)
      VALUES (?, ?, 'Backlog Test Idea', 'Idea for PRD 18 Layer 3 testing', 'APPROVED')
    `, [ideaId, adminUser.id]);
    idea = { id: ideaId };
  }

  const projectId = `proj-backlog-${ts}`;
  execute(`
    INSERT INTO projects (id, idea_id, title, owner_id, current_stage, status, created_at)
    VALUES (?, ?, 'PRD 18 Backlog Project', ?, 'RESEARCH_DEV_PARALLEL', 'ACTIVE', datetime('now'))
  `, [projectId, idea.id, adminUser.id]);

  console.log(`  Admin User ID: ${adminUser.id}`);
  console.log(`  Member 1 User ID: ${member1User.id}`);
  console.log(`  Member 2 User ID: ${member2User.id}`);
  console.log(`  Test Project ID: ${projectId}\n`);

  // Start HTTP server
  const app = createApp();
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  console.log(`  Test HTTP Server running at ${baseUrl}\n`);

  try {
    let item1Id = null;
    let item2Id = null;
    let item3Id = null;
    let draftSprintId = null;
    let activeSprintId = null;

    // --- TEST 1: Member creates Backlog Item ---
    console.log('--- 2. BACKLOG ITEM CREATION & VALIDATION ---');
    {
      const res = await fetch(`${baseUrl}/api/backlog/item/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${member1Token}`
        },
        body: JSON.stringify({
          project_id: projectId,
          title: 'Implement User Auth Story',
          description: 'JWT Token + Refresh Token logic',
          type: 'STORY',
          priority: 'HIGH',
          story_points: 5
        })
      });
      const data = await res.json();
      assert(res.status === 201, 'Member creates Backlog Item (HTTP 201, Role: All)', `Status: ${res.status}`);
      assert(data && data.id, 'Item created with valid ID', `ID: ${data?.id}`);
      assert(data.sprint_id === null, 'Item initially has sprint_id NULL (pure backlog)');
      assert(data.status === 'TODO', 'Item initial status is TODO');
      assert(data.story_points === 5, 'Story points accurately set to 5');
      assert(data.created_by === member1User.id, 'Item creator recorded as Member 1');
      item1Id = data.id;
    }

    // --- TEST 2: Admin creates Backlog Item with 8 story points ---
    {
      const res = await fetch(`${baseUrl}/api/backlog/item/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${adminToken}`
        },
        body: JSON.stringify({
          project_id: projectId,
          title: 'Optimize Database Queries',
          description: 'Add composite indexes',
          type: 'TASK',
          priority: 'CRITICAL',
          story_points: 8
        })
      });
      const data = await res.json();
      assert(res.status === 201, 'Admin creates Backlog Item (HTTP 201)');
      assert(data.story_points === 8, 'Story points set to 8');
      assert(data.position >= 1, 'Position auto-incremented sequentially', `Position: ${data?.position}`);
      item2Id = data.id;
    }

    // --- TEST 3: Member blocked from directly assigning item to sprint on create ---
    {
      // First create a draft sprint
      const sprintRes = await fetch(`${baseUrl}/api/sprint/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${adminToken}`
        },
        body: JSON.stringify({
          project_id: projectId,
          name: 'Sprint Alpha'
        })
      });
      const sprintData = await sprintRes.json();
      draftSprintId = sprintData.id;

      const res = await fetch(`${baseUrl}/api/backlog/item/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${member1Token}`
        },
        body: JSON.stringify({
          project_id: projectId,
          sprint_id: draftSprintId,
          title: 'Illegal Direct Sprint Assignment'
        })
      });
      assert(res.status === 403, 'Member blocked from directly assigning item to sprint on create (HTTP 403 Forbidden)');
    }

    // --- TEST 4: Blank title rejected ---
    {
      const res = await fetch(`${baseUrl}/api/backlog/item/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${member1Token}`
        },
        body: JSON.stringify({
          project_id: projectId,
          title: '   '
        })
      });
      assert(res.status === 400, 'Blank title rejected (HTTP 400)');
    }

    // --- TEST 5: Rule 3: Story points range 0-999 enforced ---
    {
      const resTooHigh = await fetch(`${baseUrl}/api/backlog/item/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${member1Token}`
        },
        body: JSON.stringify({
          project_id: projectId,
          title: 'Exceeding Points Story',
          story_points: 1500
        })
      });
      assert(resTooHigh.status === 400, 'Rule 3 Enforced: Points > 999 rejected (HTTP 400)');

      const resNegative = await fetch(`${baseUrl}/api/backlog/item/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${member1Token}`
        },
        body: JSON.stringify({
          project_id: projectId,
          title: 'Negative Points Story',
          story_points: -3
        })
      });
      assert(resNegative.status === 400, 'Rule 3 Enforced: Points < 0 rejected (HTTP 400)');
    }

    // --- TEST 6: Non-existent project rejected ---
    {
      const res = await fetch(`${baseUrl}/api/backlog/item/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${member1Token}`
        },
        body: JSON.stringify({
          project_id: 'fake-proj-xyz',
          title: 'Valid Story'
        })
      });
      assert(res.status === 404, 'Non-existent project rejected (HTTP 404)');
    }

    // --- TEST 7: Pure backlog listing ---
    console.log('\n--- 3. PURE BACKLOG LISTING & DETAIL RETRIEVAL ---');
    {
      const res = await fetch(`${baseUrl}/api/backlog/project/${projectId}`, {
        headers: { 'Authorization': `Bearer ${member1Token}` }
      });
      const data = await res.json();
      assert(res.status === 200, 'Member retrieves pure backlog items (HTTP 200, Role: All)');
      assert(Array.isArray(data) && data.length >= 2, 'Backlog list returned as array with seeded items');
      assert(data.every(it => it.sprint_id === null), 'Every item returned has sprint_id === NULL');
    }

    // --- TEST 8: Item detail retrieval with history ---
    {
      const res = await fetch(`${baseUrl}/api/backlog/item/${item1Id}`, {
        headers: { 'Authorization': `Bearer ${member1Token}` }
      });
      const data = await res.json();
      assert(res.status === 200, 'Member retrieves item detail (HTTP 200)');
      assert(data.id === item1Id, 'Returned item ID matches');
      assert(Array.isArray(data.history), 'History array included in item detail');
    }

    // --- TEST 9 & 10: Owner edits own item -> Rule 7 History Auto-Log ---
    console.log('\n--- 4. ITEM EDITING & RULE 7 HISTORY LOGGING ---');
    {
      const res = await fetch(`${baseUrl}/api/backlog/item/${item1Id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${member1Token}`
        },
        body: JSON.stringify({
          title: 'Implement User Auth Story (Revised)',
          story_points: 13,
          priority: 'CRITICAL'
        })
      });
      const data = await res.json();
      assert(res.status === 200, 'Owner can edit own item (HTTP 200, Role: Owner)');
      assert(data.title === 'Implement User Auth Story (Revised)', 'Title updated');
      assert(data.story_points === 13, 'Story points updated to 13');
      assert(data.priority === 'CRITICAL', 'Priority updated to CRITICAL');

      // Verify Rule 7: Auto-logged into backlog_item_history
      const historyRows = queryAll('SELECT * FROM backlog_item_history WHERE item_id = ? ORDER BY id ASC', [item1Id]);
      assert(historyRows.length >= 3, 'Rule 7 Enforced: Field changes auto-logged to backlog_item_history', `Count: ${historyRows.length}`);
      const titleChange = historyRows.find(h => h.field_changed === 'title');
      assert(titleChange && titleChange.old_value === 'Implement User Auth Story' && titleChange.new_value === 'Implement User Auth Story (Revised)', 'History records title old vs new value');
      const pointsChange = historyRows.find(h => h.field_changed === 'story_points');
      assert(pointsChange && pointsChange.old_value === '5' && pointsChange.new_value === '13', 'History records story_points old vs new value');
    }

    // --- TEST 11: Non-owner member blocked from editing another member's item ---
    {
      const res = await fetch(`${baseUrl}/api/backlog/item/${item1Id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${member2Token}`
        },
        body: JSON.stringify({ title: 'Hacked by Bob' })
      });
      assert(res.status === 403, 'Non-owner member blocked from editing another member item (HTTP 403 Forbidden)');
    }

    // --- TEST 12: Admin can edit any item ---
    {
      const res = await fetch(`${baseUrl}/api/backlog/item/${item1Id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${adminToken}`
        },
        body: JSON.stringify({ description: 'Admin updated architectural description' })
      });
      const data = await res.json();
      assert(res.status === 200, 'Admin can edit any item (HTTP 200, Role: Admin+)');
      assert(data.description === 'Admin updated architectural description', 'Admin description update reflected');
    }

    // --- TEST 13, 14, 15, 16, 17: Move item Sprint <-> Backlog ---
    console.log('\n--- 5. SPRINT <-> BACKLOG MOVE & RULE 9 ENFORCEMENT ---');
    {
      // Member blocked from moving
      const memberMoveRes = await fetch(`${baseUrl}/api/backlog/item/${item1Id}/move`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${member1Token}`
        },
        body: JSON.stringify({ sprint_id: draftSprintId })
      });
      assert(memberMoveRes.status === 403, 'Member blocked from moving item Sprint <-> Backlog (HTTP 403 Forbidden)');

      // Admin moves item to draft sprint
      const adminMoveRes = await fetch(`${baseUrl}/api/backlog/item/${item1Id}/move`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${adminToken}`
        },
        body: JSON.stringify({ sprint_id: draftSprintId })
      });
      const movedData = await adminMoveRes.json();
      assert(adminMoveRes.status === 200, 'Admin moves item to draft sprint (HTTP 200)');
      assert(movedData.sprint_id === draftSprintId, 'Item sprint_id updated to draftSprintId');

      // Rule 7: verify move auto-logged to history
      const moveHistory = queryOne("SELECT * FROM backlog_item_history WHERE item_id = ? AND field_changed = 'sprint_id' ORDER BY id DESC LIMIT 1", [item1Id]);
      assert(moveHistory !== null, 'Rule 7 Enforced: Move operation logged to backlog_item_history');
      assert(moveHistory && moveHistory.new_value === String(draftSprintId), 'Move history records new sprint_id');

      // Moved item no longer in pure backlog
      const pureBacklogRes = await fetch(`${baseUrl}/api/backlog/project/${projectId}`, {
        headers: { 'Authorization': `Bearer ${member1Token}` }
      });
      const pureList = await pureBacklogRes.json();
      assert(!pureList.some(it => it.id === item1Id), 'Moved item excluded from pure backlog list (sprint_id IS NULL)');

      // Admin moves item back to pure backlog
      const backRes = await fetch(`${baseUrl}/api/backlog/item/${item1Id}/move`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${adminToken}`
        },
        body: JSON.stringify({ sprint_id: null })
      });
      const backData = await backRes.json();
      assert(backRes.status === 200 && backData.sprint_id === null, 'Admin moves item back to pure backlog (HTTP 200, sprint_id = null)');
    }

    // --- TEST 18 & 19: Rule 9: Admin moving item in someone else's ACTIVE sprint ---
    {
      // Create an active sprint owned by otherLeadUser
      const activeRes = await fetch(`${baseUrl}/api/sprint/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${otherLeadToken}`
        },
        body: JSON.stringify({
          project_id: projectId,
          name: 'Other Lead Active Sprint'
        })
      });
      const activeData = await activeRes.json();
      activeSprintId = activeData.id;

      // Start the sprint
      await fetch(`${baseUrl}/api/sprint/${activeSprintId}/start`, {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${otherLeadToken}` }
      });

      // Admin attempts to move item into other user's active sprint WITHOUT reason
      const moveNoReason = await fetch(`${baseUrl}/api/backlog/item/${item2Id}/move`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${adminToken}`
        },
        body: JSON.stringify({ sprint_id: activeSprintId, reason: 'short' })
      });
      assert(moveNoReason.status === 400, 'Rule 9 Enforced: Moving in someone else ACTIVE sprint without min 10 char reason blocked (HTTP 400)');

      // Admin moves with valid >= 10 char reason
      const validReason = 'Urgent hotfix injected due to production outage';
      const moveValidReason = await fetch(`${baseUrl}/api/backlog/item/${item2Id}/move`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${adminToken}`
        },
        body: JSON.stringify({ sprint_id: activeSprintId, reason: validReason })
      });
      assert(moveValidReason.status === 200, 'Rule 9 Enforced: Moving in someone else ACTIVE sprint with valid reason succeeds (HTTP 200)');

      // Verify access_log contains entry
      const accessLogRow = queryOne(`
        SELECT * FROM access_log 
        WHERE user_id = ? AND action = 'backlog_item_moved_active_sprint' 
        ORDER BY id DESC LIMIT 1
      `, [adminUser.id]);
      assert(accessLogRow !== null, 'Rule 9 Enforced: access_log entry recorded for moving item in someone else active sprint');
      assert(accessLogRow && accessLogRow.resource && accessLogRow.resource.includes(validReason.slice(0, 30)), 'access_log contains exact audit reason');
    }

    // --- TEST 20, 21, 22: Status Update & RBAC ---
    console.log('\n--- 6. STATUS UPDATE, RBAC & REORDER ---');
    {
      // Assign item 1 to member 1
      await fetch(`${baseUrl}/api/backlog/item/${item1Id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${adminToken}`
        },
        body: JSON.stringify({ assigned_to: member1User.id })
      });

      // Assigned member updates status to IN_PROGRESS
      const statusRes = await fetch(`${baseUrl}/api/backlog/item/${item1Id}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${member1Token}`
        },
        body: JSON.stringify({ status: 'IN_PROGRESS' })
      });
      const statusData = await statusRes.json();
      assert(statusRes.status === 200, 'Assigned member updates status to IN_PROGRESS (HTTP 200)');
      assert(statusData.status === 'IN_PROGRESS', 'Status updated to IN_PROGRESS');

      // Rule 7: Verify status history
      const statusHistory = queryOne("SELECT * FROM backlog_item_history WHERE item_id = ? AND field_changed = 'status' ORDER BY id DESC LIMIT 1", [item1Id]);
      assert(statusHistory !== null, 'Rule 7 Enforced: Status change recorded in history');
      assert(statusHistory && statusHistory.old_value === 'TODO' && statusHistory.new_value === 'IN_PROGRESS', 'Status history shows TODO -> IN_PROGRESS');

      // Unassigned member (member 2) blocked from updating status
      const unassignedRes = await fetch(`${baseUrl}/api/backlog/item/${item1Id}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${member2Token}`
        },
        body: JSON.stringify({ status: 'DONE' })
      });
      assert(unassignedRes.status === 403, 'Unassigned non-admin member blocked from updating status (HTTP 403 Forbidden)');
    }

    // --- TEST 23 & 24: Reorder backlog item ---
    {
      const reorderRes = await fetch(`${baseUrl}/api/backlog/item/${item1Id}/reorder`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${adminToken}`
        },
        body: JSON.stringify({ position: 99 })
      });
      const reorderData = await reorderRes.json();
      assert(reorderRes.status === 200, 'Admin can reorder backlog item (HTTP 200, Role: Admin+)');
      assert(reorderData.position === 99, 'Reordered position matches (99)');

      const memberReorderRes = await fetch(`${baseUrl}/api/backlog/item/${item1Id}/reorder`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${member1Token}`
        },
        body: JSON.stringify({ position: 1 })
      });
      assert(memberReorderRes.status === 403, 'Member blocked from reordering backlog item (HTTP 403 Forbidden)');
    }

    // --- TEST 25, 26, 27, 28: Deletion Rules & Enforcement ---
    console.log('\n--- 7. DELETION RULES & IMMUTABILITY ENFORCEMENT ---');
    {
      // Test 25: Non-TODO item cannot be deleted (Item 1 is IN_PROGRESS)
      const nonTodoRes = await fetch(`${baseUrl}/api/backlog/item/${item1Id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${adminToken}` }
      });
      assert(nonTodoRes.status === 400, 'Rule 5 & Line 217 Enforced: Non-TODO item cannot be deleted (HTTP 400)');

      // Test 26: Item in ACTIVE sprint cannot be deleted (Item 2 is in activeSprintId)
      // Even if status is TODO:
      const inActiveSprintRes = await fetch(`${baseUrl}/api/backlog/item/${item2Id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${adminToken}` }
      });
      assert(inActiveSprintRes.status === 400, 'Rule 5 Enforced: Item in ACTIVE sprint cannot be deleted (HTTP 400)');

      // Test 27: Create item 3 in TODO status; Member blocked from deleting
      const createRes = await fetch(`${baseUrl}/api/backlog/item/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${adminToken}`
        },
        body: JSON.stringify({
          project_id: projectId,
          title: 'Disposable TODO Item'
        })
      });
      const item3Data = await createRes.json();
      item3Id = item3Data.id;

      const memberDelRes = await fetch(`${baseUrl}/api/backlog/item/${item3Id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${member1Token}` }
      });
      assert(memberDelRes.status === 403, 'Member blocked from deleting backlog item (HTTP 403 Forbidden)');

      // Test 28: Admin deletes TODO backlog item
      const adminDelRes = await fetch(`${baseUrl}/api/backlog/item/${item3Id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${adminToken}` }
      });
      assert(adminDelRes.status === 200, 'Admin deletes TODO backlog item (HTTP 200)');

      const checkItem = queryOne('SELECT id FROM backlog_items WHERE id = ?', [item3Id]);
      assert(checkItem === null, 'Item verified deleted from backlog_items database table');
    }

  } finally {
    server.close();
  }

  console.log('\n===================================================================');
  console.log(`  PRD 18 LAYER 3 TEST SUMMARY: ${passedTests} / ${totalTests} TESTS PASSED`);
  if (failedTests > 0) {
    console.error(`  ❌ ${failedTests} TESTS FAILED`);
    process.exit(1);
  } else {
    console.log('  🎉 ALL LAYER 3 TESTS PASSED PERFECTLY!');
  }
  console.log('===================================================================\n');
}

run().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
