/**
 * STEP 11: CO-WORKING CANVAS COMPREHENSIVE END-TO-END TEST SUITE
 * 
 * Verifies:
 * 1. Deterministic Co-working Room Provisioning on Step 04 Parallel Fan-out
 * 2. RBAC Enforcement: Non-member rejected with HTTP 403
 * 3. 4-Corner RBAC Enforcement: Admin excluded from peer canvas cursor collaboration
 * 4. Real Multi-Client Concurrent Sessions (Developer, Researcher, Designer)
 * 5. Real-Time Presence: canvas:join and "Who's Here" presence avatar updates
 * 6. Server-Side Cursor Throttling (60ms server-side enforcement)
 * 7. Collaborative Object Creation & LWW Attribution (createdBy, lastModifiedBy, editHistory)
 * 8. Attributed Soft-Deletion with Tombstones (deletedBy)
 * 9. Storage Safeguards: Capacity and payload bounds
 * 10. Autosave & SQLite Snapshot Persistence across reconnects
 * 11. Participation Ledger History (room_participants joined_at / left_at)
 * 12. Project LIVE Transition -> Automatic Canvas Archival (read-only enforcement)
 * 13. Step 05 Killswitch Integration: Instant WebSocket termination on offboarding
 */

import { WebSocket } from 'ws';
import { createApp } from '../src/app.js';
import { initWebSocketServer } from '../src/services/wsService.js';
import { withLegalAcceptance } from './lib/legal-helper.js';
import { queryOne, queryAll, execute } from '../src/db/database.js';
import { verifyEmailFor } from './lib/legal-helper.js';
import { cleanupTestData, CANONICAL_TEAM } from './cleanup-test-data.js';

const PORT = 4994;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const WS_URL = `ws://127.0.0.1:${PORT}/ws`;

async function req(method, path, token = null, body = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
  let data;
  try {
    data = await res.json();
  } catch (e) {
    data = null;
  }
  return { status: res.status, data };
}

function connectWs(token) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${WS_URL}?token=${token}`);
    const timeout = setTimeout(() => {
      reject(new Error('WebSocket connection timed out after 5000ms'));
    }, 5000);

    ws.on('open', () => {
      clearTimeout(timeout);
      resolve(ws);
    });

    ws.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

function waitForWsMessage(ws, eventName, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for WS event "${eventName}"`));
    }, timeoutMs);

    const onMessage = (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.event === eventName) {
          clearTimeout(timer);
          ws.off('message', onMessage);
          resolve(msg);
        } else if (msg.event === 'canvas:error' && eventName !== 'canvas:error') {
          clearTimeout(timer);
          ws.off('message', onMessage);
          reject(new Error(`Received unexpected canvas:error while waiting for "${eventName}": ${JSON.stringify(msg.data)}`));
        }
      } catch (e) {}
    };

    ws.on('message', onMessage);
  });
}

async function runStep11Tests() {
  console.log('===================================================================');
  console.log('   STEP 11: CO-WORKING CANVAS REAL-TIME COLLABORATION SUITE');
  console.log('   Zero Mocks • Real Concurrent WebSockets • Strict Attribution');
  console.log('===================================================================\n');

  // 1. Restore canonical database
  await cleanupTestData(false);

  // 2. Start server
  const app = createApp();
  const server = app.listen(PORT);
  const wss = initWebSocketServer(server);
  console.log(`[SETUP] Test server listening on ${BASE_URL}\n`);

  try {
    // -------------------------------------------------------------------------
    // STAGE 0: Authenticate Personas (Admin, Dev, Res, Des, Non-Member)
    // -------------------------------------------------------------------------
    console.log('[STAGE 0] Authenticating test personas via real login calls...');
    
    // Admin
    const adminLogin = await req('POST', '/api/auth/login', null, {
      email: 'admin@mahitechgroup.com',
      password: 'AdminPassword@2026'
    });
    if (!adminLogin.data || !adminLogin.data.user) {
      throw new Error(`Admin login failed: ${JSON.stringify(adminLogin)}`);
    }
    const adminToken = adminLogin.data.token;
    const adminUser = adminLogin.data.user;

    // Researcher / Owner (Elena Vance)
    const resLogin = await req('POST', '/api/auth/login', null, {
      email: 'elena.researcher@mahitechgroup.com',
      password: 'ElenaPass123!'
    });
    const resToken = resLogin.data.token;
    const resUser = resLogin.data.user;

    let devToken = null;
    let devUser = null;
    let desToken = null;
    let desUser = null;

    console.log(`   ✓ Admin: ${adminUser.name} (${adminUser.role})`);
    console.log(`   ✓ Researcher (Owner): ${resUser.name} (${resUser.role})\n`);

    // -------------------------------------------------------------------------
    // TEST 1: Step 04 Parallel Fan-out & Deterministic Co-working Room Provisioning
    // -------------------------------------------------------------------------
    console.log('[TEST 1] Step 04 Fan-out -> Deterministic Co-working Room Provisioning...');
    // Create an idea
    const ideaRes = await req('POST', '/api/ideas/draft', resToken, {
      title: 'Neural Synthesizer Engine',
      description: 'Ultra-low latency audio neural synthesis architecture'
    });
    const ideaId = ideaRes.data.idea.id;
    await req('POST', `/api/ideas/${ideaId}/submit`, resToken);

    // Override to approved via Admin to trigger fan-out
    const approveRes = await req('PATCH', `/api/admin/ideas/${ideaId}/override`, adminToken, {
      decision: 'APPROVED',
      reason: 'Approved for testing co-working canvas provisioning'
    });
    console.log(`   -> Admin override idea status: HTTP ${approveRes.status}`);

    const projectCreated = queryOne('SELECT * FROM projects WHERE idea_id = ?', [ideaId]);
    if (!projectCreated) throw new Error('Project was not created from approved idea');
    console.log(`   ✓ Project created: "${projectCreated.title}" (id: ${projectCreated.id})`);

    // Fetch the developer assigned by fanout
    const assignedDev = queryOne(`
      SELECT pm.*, u.email, u.name, u.role
      FROM project_members pm
      JOIN users u ON pm.user_id = u.id
      WHERE pm.project_id = ? AND pm.role_in_project IN ('backend_dev', 'frontend_dev')
      LIMIT 1
    `, [projectCreated.id]);
    const devCanonical = CANONICAL_TEAM.find(m => m.email.toLowerCase() === assignedDev.email.toLowerCase());
    const devLogin = await req('POST', '/api/auth/login', null, {
      email: assignedDev.email,
      password: devCanonical ? devCanonical.pass : 'DeveloperPass123!'
    });
    devToken = devLogin.data.token;
    devUser = devLogin.data.user;
    console.log(`   ✓ Authenticated Assigned Project Developer: ${devUser.name} (${devUser.email})`);

    // Fetch the designer assigned by fanout
    const assignedDesigner = queryOne(`
      SELECT pm.*, u.email, u.name, u.role
      FROM project_members pm
      JOIN users u ON pm.user_id = u.id
      WHERE pm.project_id = ? AND pm.role_in_project = 'designer'
    `, [projectCreated.id]);
    const desCanonical = CANONICAL_TEAM.find(m => m.email.toLowerCase() === assignedDesigner.email.toLowerCase());
    const desLogin = await req('POST', '/api/auth/login', null, {
      email: assignedDesigner.email,
      password: desCanonical ? desCanonical.pass : 'DesignerPass123!'
    });
    desToken = desLogin.data.token;
    desUser = desLogin.data.user;
    console.log(`   ✓ Authenticated Assigned Project Designer: ${desUser.name} (${desUser.email})`);

    // Verify room was deterministically created inside the same transaction
    const roomInDb = queryOne('SELECT * FROM coworking_rooms WHERE project_id = ?', [projectCreated.id]);
    console.log(`   ✓ Co-working Room in SQLite: id=${roomInDb?.id}, status=${roomInDb?.status}, room_type=${roomInDb?.room_type}`);
    if (!roomInDb || roomInDb.status !== 'active') {
      throw new Error('Co-working room was NOT deterministically created on project fan-out');
    }
    console.log('   ✓ TEST 1 PASSED: Co-working room created deterministically on Step 04 fan-out\n');

    // -------------------------------------------------------------------------
    // TEST 2: RBAC Enforcement — Non-Member Rejected (HTTP 403)
    // -------------------------------------------------------------------------
    console.log('[TEST 2] RBAC Access Guard: Non-Member Rejected (HTTP 403)...');
    
    // Create a standalone non-project user NOW after project fanout has locked its roster
    const nonMemberEmail = `outsider.${Date.now()}@example.com`;
    const outsiderSignup = await req('POST', '/api/auth/signup', null, await withLegalAcceptance(req, {
      name: 'Oliver Outsider',
      email: nonMemberEmail,
      password: 'OutsiderPass123!',
      desired_role: 'developer'
    }));
    await verifyEmailFor(req, outsiderSignup.data.user.id);
    await req('PATCH', `/api/admin/applications/${outsiderSignup.data.user.id}/decide`, adminToken, {
      decision: 'approve',
      assigned_role: 'developer'
    });
    const outsiderLogin = await req('POST', '/api/auth/login', null, {
      email: nonMemberEmail,
      password: 'OutsiderPass123!'
    });
    const outsiderToken = outsiderLogin.data.token;
    console.log(`   ✓ Created non-project outsider: Oliver Outsider`);

    const outsiderAccess = await req('GET', `/api/projects/${projectCreated.id}/coworking-room`, outsiderToken);
    console.log(`   -> Outsider GET /coworking-room: HTTP ${outsiderAccess.status} (Expected 403)`);
    console.log(`     * Rejection error: "${outsiderAccess.data.error}"`);
    if (outsiderAccess.status !== 403 || !outsiderAccess.data.error.includes('not an assigned contributor')) {
      throw new Error(`Expected HTTP 403 rejection for non-member, got ${outsiderAccess.status}`);
    }
    console.log('   ✓ TEST 2 PASSED: Non-project member strictly blocked from co-working room\n');

    // -------------------------------------------------------------------------
    // TEST 3: 4-Corner Non-Negotiable Rule — Admin Excluded from Peer Canvas
    // -------------------------------------------------------------------------
    console.log('[TEST 3] 4-Corner Exclusion: Admin Excluded from Peer Canvas Collaboration...');
    const adminAccess = await req('GET', `/api/projects/${projectCreated.id}/coworking-room`, adminToken);
    console.log(`   -> Admin GET /coworking-room: HTTP ${adminAccess.status} (Expected 403)`);
    console.log(`     * Rejection error: "${adminAccess.data.error}"`);
    if (adminAccess.status !== 403 || !adminAccess.data.error.includes('Administrator accounts are excluded')) {
      throw new Error(`Expected HTTP 403 rejection for Admin, got ${adminAccess.status}`);
    }
    console.log('   ✓ TEST 3 PASSED: Admin strictly excluded from peer canvas (governance oversight preserved)\n');

    // -------------------------------------------------------------------------
    // TEST 4: Real Multi-Client Concurrent WebSockets & Live Presence ("Who's Here")
    // -------------------------------------------------------------------------
    console.log('[TEST 4] Real Multi-Client Concurrent WebSockets & Live Presence Tracking...');
    // Connect Developer, Researcher, and Designer simultaneously
    const wsDev = await connectWs(devToken);
    const wsRes = await connectWs(resToken);
    const wsDes = await connectWs(desToken);
    console.log('   ✓ 3 live WebSocket client connections established simultaneously');

    // Devon (Developer) joins canvas
    const devInitPromise = waitForWsMessage(wsDev, 'canvas:init');
    wsDev.send(JSON.stringify({ action: 'canvas:join', projectId: projectCreated.id }));
    const devInit = await devInitPromise;
    console.log(`   ✓ Devon received canvas:init: roomId=${devInit.data.roomId}`);

    // Raya (Researcher) joins canvas -> Devon should receive canvas:user_joined
    const devHearsResPromise = waitForWsMessage(wsDev, 'canvas:user_joined');
    const resInitPromise = waitForWsMessage(wsRes, 'canvas:init');
    wsRes.send(JSON.stringify({ action: 'canvas:join', projectId: projectCreated.id }));
    const [devHearsRes, resInit] = await Promise.all([devHearsResPromise, resInitPromise]);
    console.log(`   ✓ Devon heard Raya join: "${devHearsRes.data.user.name}" (${devHearsRes.data.user.role})`);

    // Diya (Designer) joins canvas -> Devon and Raya both hear Diya join
    const devHearsDesPromise = waitForWsMessage(wsDev, 'canvas:user_joined');
    const resHearsDesPromise = waitForWsMessage(wsRes, 'canvas:user_joined');
    const desInitPromise = waitForWsMessage(wsDes, 'canvas:init');
    wsDes.send(JSON.stringify({ action: 'canvas:join', projectId: projectCreated.id }));
    const [devHearsDes, resHearsDes, desInit] = await Promise.all([
      devHearsDesPromise,
      resHearsDesPromise,
      desInitPromise
    ]);
    console.log(`   ✓ Both Devon & Raya heard Diya join: "${devHearsDes.data.user.name}" (${devHearsDes.data.user.role})`);

    // Verify presence bar count
    const activeInRoom = desInit.data.participants;
    console.log(`   ✓ "Who's Here" presence count: ${activeInRoom.length} contributors`);
    if (activeInRoom.length < 3) throw new Error('Expected at least 3 active participants');
    console.log('   ✓ TEST 4 PASSED: Multi-client concurrent presence and live announcements verified\n');

    // -------------------------------------------------------------------------
    // TEST 5: Server-Side Cursor Throttling (60ms Throttle Enforcement)
    // -------------------------------------------------------------------------
    console.log('[TEST 5] Server-Side Cursor Throttling Verification...');
    let cursorReceivedCount = 0;
    const onCursorMove = (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.event === 'canvas:cursor_move') cursorReceivedCount++;
      } catch (e) {}
    };
    wsRes.on('message', onCursorMove);

    // Rapid-fire send 8 cursor updates within 40ms from Devon
    for (let i = 0; i < 8; i++) {
      wsDev.send(JSON.stringify({
        action: 'canvas:cursor_move',
        projectId: projectCreated.id,
        x: 100 + i * 10,
        y: 200 + i * 5
      }));
    }

    // Wait 250ms to let all packets clear
    await new Promise(r => setTimeout(r, 250));
    wsRes.off('message', onCursorMove);

    console.log(`   -> Devon sent 8 rapid cursor bursts within 40ms`);
    console.log(`   -> Raya received ${cursorReceivedCount} throttled cursor updates (Expected <= 3 due to 60ms throttle)`);
    if (cursorReceivedCount > 3) {
      throw new Error(`Server-side throttle failed: received ${cursorReceivedCount} cursor packets`);
    }
    console.log('   ✓ TEST 5 PASSED: Server-side cursor throttling strictly enforced\n');

    // -------------------------------------------------------------------------
    // TEST 6: Collaborative Object Creation & LWW Attribution
    // -------------------------------------------------------------------------
    console.log('[TEST 6] Collaborative Object Creation & Last-Write-Wins Attribution...');
    const stickyId = `sticky_${Date.now()}`;
    const stickyPayload = {
      id: stickyId,
      type: 'sticky',
      color: '#fef08a',
      content: 'DSP latency must stay under 5ms',
      x: 250,
      y: 180,
      width: 200,
      height: 150
    };

    // Elena (Researcher) creates sticky note
    const devHearsStickyPromise = waitForWsMessage(wsDev, 'canvas:object_update');
    const desHearsStickyPromise = waitForWsMessage(wsDes, 'canvas:object_update');
    wsRes.send(JSON.stringify({
      action: 'canvas:object_update',
      projectId: projectCreated.id,
      object: stickyPayload
    }));

    const [devHearsSticky, desHearsSticky] = await Promise.all([devHearsStickyPromise, desHearsStickyPromise]);
    const createdElem = devHearsSticky.data.element;
    console.log(`   ✓ Element created: id=${createdElem.id}`);
    console.log(`     * createdBy: ${createdElem.createdBy.name} (${createdElem.createdBy.role})`);
    console.log(`     * lastModifiedBy: ${createdElem.lastModifiedBy.name} (${createdElem.lastModifiedBy.role})`);
    console.log(`     * version: ${createdElem.version}`);

    if (createdElem.createdBy.name !== resUser.name || createdElem.version !== 1) {
      throw new Error('Attribution on creation mismatch');
    }

    // Diya (Designer) edits the same sticky note
    const devHearsEditPromise = waitForWsMessage(wsDev, 'canvas:object_update');
    const resHearsEditPromise = waitForWsMessage(wsRes, 'canvas:object_update');
    wsDes.send(JSON.stringify({
      action: 'canvas:object_update',
      projectId: projectCreated.id,
      object: {
        ...createdElem,
        content: 'DSP latency must stay under 5ms (Verified on WebAudio)'
      }
    }));

    const [devHearsEdit, resHearsEdit] = await Promise.all([devHearsEditPromise, resHearsEditPromise]);
    const updatedElem = devHearsEdit.data.element;
    console.log(`   ✓ Element edited by Diya Designer:`);
    console.log(`     * Permanent createdBy: ${updatedElem.createdBy.name} (${updatedElem.createdBy.role})`);
    console.log(`     * Updated lastModifiedBy: ${updatedElem.lastModifiedBy.name} (${updatedElem.lastModifiedBy.role})`);
    console.log(`     * New version: ${updatedElem.version}`);
    console.log(`     * Edit history count: ${updatedElem.editHistory.length}`);

    if (updatedElem.createdBy.name !== resUser.name) throw new Error('Original creator attribution was lost!');
    if (updatedElem.lastModifiedBy.name !== desUser.name) throw new Error('Last modifier attribution not updated');
    if (updatedElem.version !== 2) throw new Error('Version counter was not incremented');
    console.log('   ✓ TEST 6 PASSED: LWW element sync preserves original creator and tracks updater history\n');

    // -------------------------------------------------------------------------
    // TEST 7: Attributed Soft-Deletion with Tombstones
    // -------------------------------------------------------------------------
    console.log('[TEST 7] Attributed Soft-Deletion with Tombstones...');
    // Devon (Developer) deletes the sticky note
    const resHearsDelPromise = waitForWsMessage(wsRes, 'canvas:object_delete');
    const desHearsDelPromise = waitForWsMessage(wsDes, 'canvas:object_delete');
    wsDev.send(JSON.stringify({
      action: 'canvas:object_delete',
      projectId: projectCreated.id,
      objectId: stickyId
    }));

    const [resHearsDel, desHearsDel] = await Promise.all([resHearsDelPromise, desHearsDelPromise]);
    console.log(`   ✓ Element deletion event received across clients`);
    console.log(`     * Deleted objectId: ${resHearsDel.data.objectId}`);
    console.log(`     * deletedBy: ${resHearsDel.data.deletedBy.name} (${resHearsDel.data.deletedBy.role})`);

    // Verify SQLite snapshot has the tombstone
    const updatedRoomInDb = queryOne('SELECT canvas_state_json FROM coworking_rooms WHERE project_id = ?', [projectCreated.id]);
    const stateObj = JSON.parse(updatedRoomInDb.canvas_state_json);
    if (stateObj.objects[stickyId]) throw new Error('Deleted object still present in active objects');
    if (!stateObj.tombstones[stickyId] || !stateObj.tombstones[stickyId].isDeleted) {
      throw new Error('Tombstone missing from persisted canvas state');
    }
    console.log(`   ✓ Persisted tombstone verified in SQLite: deletedBy="${stateObj.tombstones[stickyId].deletedBy.name}"`);
    console.log('   ✓ TEST 7 PASSED: Object deletion is fully attributed via tombstones without silent disappearance\n');

    // -------------------------------------------------------------------------
    // TEST 8: Storage Safeguards & Capacity Bounds
    // -------------------------------------------------------------------------
    console.log('[TEST 8] Storage Safeguards: Oversized Payload Rejection...');
    const giantContent = 'A'.repeat(6000); // Exceeds 5KB limit
    const errorPromise = waitForWsMessage(wsDev, 'canvas:error');
    wsDev.send(JSON.stringify({
      action: 'canvas:object_update',
      projectId: projectCreated.id,
      object: { id: 'giant_elem', type: 'text', content: giantContent, x: 0, y: 0 }
    }));
    const errEvent = await errorPromise;
    console.log(`   -> Attempted oversized element (6KB): "${errEvent.data.error}"`);
    if (!errEvent.data.error.includes('maximum size limit')) {
      throw new Error('Oversized element payload should be rejected');
    }
    console.log('   ✓ TEST 8 PASSED: Storage safeguard bounds enforced against unbounded growth\n');

    // -------------------------------------------------------------------------
    // TEST 9: Participation History Ledger (room_participants)
    // -------------------------------------------------------------------------
    console.log('[TEST 9] Participation History Ledger Verification (room_participants)...');
    const participantsInDb = queryAll('SELECT * FROM room_participants WHERE room_id = ?', [roomInDb.id]);
    console.log(`   ✓ Total logged participant entries in SQLite: ${participantsInDb.length}`);
    const devEntry = participantsInDb.find(p => p.user_id === devUser.id);
    const resEntry = participantsInDb.find(p => p.user_id === resUser.id);
    const desEntry = participantsInDb.find(p => p.user_id === desUser.id);

    if (!devEntry || !resEntry || !desEntry) throw new Error('Missing participant entry in room_participants table');
    console.log(`     * Devon: joined_at=${devEntry.joined_at}, left_at=${devEntry.left_at}`);
    console.log(`     * Elena: joined_at=${resEntry.joined_at}, left_at=${resEntry.left_at}`);

    // Devon leaves room
    const resHearsLeavePromise = waitForWsMessage(wsRes, 'canvas:user_left');
    wsDev.send(JSON.stringify({ action: 'canvas:leave', projectId: projectCreated.id }));
    const resHearsLeave = await resHearsLeavePromise;
    console.log(`   ✓ Elena heard Devon leave: "${resHearsLeave.data.user.name}"`);

    // Verify left_at is stamped in SQLite
    const devUpdatedEntry = queryOne('SELECT * FROM room_participants WHERE id = ?', [devEntry.id]);
    console.log(`   ✓ Devon room_participants.left_at stamped: "${devUpdatedEntry.left_at}"`);
    if (!devUpdatedEntry.left_at) throw new Error('left_at was not updated on room exit');
    console.log('   ✓ TEST 9 PASSED: Participation session ledger logged and closed with exact timestamps\n');

    // -------------------------------------------------------------------------
    // TEST 10: Step 10 Project LIVE Transition -> Automatic Canvas Archival
    // -------------------------------------------------------------------------
    console.log('[TEST 10] Project LIVE Transition -> Automatic Canvas Archival (Read-Only)...');
    // Complete all 8 non-review tasks on projectCreated so Final Review succeeds
    const projectTasks = queryAll('SELECT id, task_type FROM project_tasks WHERE project_id = ?', [projectCreated.id]);
    for (const t of projectTasks) {
      if (t.task_type !== 'review') {
        execute("UPDATE project_tasks SET status = 'DONE', completed_at = CURRENT_TIMESTAMP WHERE id = ?", [t.id]);
      }
    }

    // Admin approves final review -> Transitions to LIVE
    const reviewRes = await req('PATCH', `/api/admin/projects/${projectCreated.id}/final-review`, adminToken, {
      approved: true,
      notes: 'Ready for market'
    });
    console.log(`   -> Admin approves project for LIVE launch: HTTP ${reviewRes.status}`);
    if (reviewRes.status !== 200) throw new Error('Admin final review failed');

    // Verify coworking_rooms table status is now 'archived'
    const archivedRoom = queryOne('SELECT status FROM coworking_rooms WHERE project_id = ?', [projectCreated.id]);
    console.log(`   ✓ coworking_rooms status in SQLite: "${archivedRoom.status}" (Expected 'archived')`);
    if (archivedRoom.status !== 'archived') throw new Error('Room was not archived on LIVE transition');

    // Test writing to archived canvas (Expected error rejection)
    const writeBlockedPromise = waitForWsMessage(wsDes, 'canvas:error');
    wsDes.send(JSON.stringify({
      action: 'canvas:object_update',
      projectId: projectCreated.id,
      object: { id: 'late_note', type: 'sticky', content: 'Trying to edit after live', x: 0, y: 0 }
    }));
    const writeErr = await writeBlockedPromise;
    console.log(`   -> Contributor write attempt on archived canvas: "${writeErr.data.error}"`);
    if (!writeErr.data.error.includes('archived (read-only)')) {
      throw new Error('Write on archived room should be rejected');
    }

    // Read-only access remains available
    const getArchivedRes = await req('GET', `/api/projects/${projectCreated.id}/coworking-room`, desToken);
    console.log(`   -> Contributor GET /coworking-room on archived project: HTTP ${getArchivedRes.status}`);
    console.log(`     * isArchived: ${getArchivedRes.data.isArchived}`);
    if (getArchivedRes.status !== 200 || !getArchivedRes.data.isArchived) {
      throw new Error('Read-only view should remain accessible for archived project');
    }
    console.log('   ✓ TEST 10 PASSED: Canvas automatically archived on LIVE launch; read-only access preserved\n');

    // -------------------------------------------------------------------------
    // TEST 11: Step 05 Killswitch Integration — Instant WebSocket Termination
    // -------------------------------------------------------------------------
    console.log('[TEST 11] Step 05 Killswitch Integration: Instant Session Revocation...');
    // Create another project for active collaboration
    const liveProjectRes = await req('POST', '/api/ideas/draft', resToken, {
      title: 'Active Collab Idea',
      description: 'Idea for testing live offboarding killswitch'
    });
    await req('POST', `/api/ideas/${liveProjectRes.data.idea.id}/submit`, resToken);
    await req('PATCH', `/api/admin/ideas/${liveProjectRes.data.idea.id}/override`, adminToken, {
      decision: 'APPROVED',
      reason: 'Approved for killswitch test'
    });
    const liveProject = queryOne('SELECT id FROM projects WHERE idea_id = ?', [liveProjectRes.data.idea.id]);

    // Create a temporary developer persona to join and offboard
    const offboardDevEmail = `temp.dev.${Date.now()}@mahitechgroup.com`;
    const tempDevSignup = await req('POST', '/api/auth/signup', null, await withLegalAcceptance(req, {
      name: 'Temp Collab Dev',
      email: offboardDevEmail,
      password: 'TempPassword123!',
      desired_role: 'developer'
    }));
    await verifyEmailFor(req, tempDevSignup.data.user.id);
    await req('PATCH', `/api/admin/applications/${tempDevSignup.data.user.id}/decide`, adminToken, {
      decision: 'approve',
      assigned_role: 'developer'
    });
    const tempDevLogin = await req('POST', '/api/auth/login', null, {
      email: offboardDevEmail,
      password: 'TempPassword123!'
    });
    const tempDevToken = tempDevLogin.data.token;
    const tempDevId = tempDevLogin.data.user.id;

    // Assign temp dev to project
    execute(`
      INSERT INTO project_members (id, project_id, user_id, role_in_project, task_status, contribution_weight)
      VALUES (?, ?, ?, 'backend_dev', 'ASSIGNED', 10.0)
    `, [crypto.randomUUID(), liveProject.id, tempDevId]);

    // Connect temp dev to WebSocket and join canvas
    const wsTemp = await connectWs(tempDevToken);
    wsTemp.send(JSON.stringify({ action: 'canvas:join', projectId: liveProject.id }));
    await waitForWsMessage(wsTemp, 'canvas:init');
    console.log('   ✓ Temp developer joined co-working canvas session');

    // Admin triggers Step 05 offboarding killswitch on temp dev
    const wsClosePromise = new Promise((resolve) => {
      wsTemp.on('close', (code, reason) => {
        resolve({ code, reason: reason.toString() });
      });
    });

    const offboardRes = await req('POST', `/api/admin/members/${tempDevId}/offboard`, adminToken, {
      reason: 'Contract completion'
    });
    console.log(`   -> Admin executes offboarding killswitch: HTTP ${offboardRes.status}`);

    const closeInfo = await wsClosePromise;
    console.log(`   ✓ Temp dev WebSocket severed immediately: code=${closeInfo.code}, reason="${closeInfo.reason}"`);
    if (closeInfo.code !== 4001) throw new Error('Expected WebSocket close code 4001 for forced session revocation');

    // Verify temp dev cannot re-join canvas
    const reattempt = await req('GET', `/api/projects/${liveProject.id}/coworking-room`, tempDevToken);
    console.log(`   -> Offboarded member re-entry attempt: HTTP ${reattempt.status} (Expected 401 or 403)`);
    if (reattempt.status !== 401 && reattempt.status !== 403) {
      throw new Error('Offboarded user should be rejected from canvas');
    }
    console.log('   ✓ TEST 11 PASSED: Step 05 killswitch instantly terminates active canvas WebSockets and blocks re-entry\n');

    // -------------------------------------------------------------------------
    // TEST 12: Reconnection Full-State Resync Test
    // -------------------------------------------------------------------------
    console.log('[TEST 12] Reconnection Full-State Resync Verification...');
    // Ensure Devon and Diya are members of liveProject and join room
    execute(`
      INSERT OR IGNORE INTO project_members (id, project_id, user_id, role_in_project, task_status, contribution_weight)
      VALUES (?, ?, ?, 'backend_dev', 'ASSIGNED', 10.0)
    `, [crypto.randomUUID(), liveProject.id, devUser.id]);
    execute(`
      INSERT OR IGNORE INTO project_members (id, project_id, user_id, role_in_project, task_status, contribution_weight)
      VALUES (?, ?, ?, 'designer', 'ASSIGNED', 10.0)
    `, [crypto.randomUUID(), liveProject.id, desUser.id]);

    wsDev.send(JSON.stringify({ action: 'canvas:join', projectId: liveProject.id }));
    await waitForWsMessage(wsDev, 'canvas:init');
    wsRes.send(JSON.stringify({ action: 'canvas:join', projectId: liveProject.id }));
    await waitForWsMessage(wsRes, 'canvas:init');
    wsDes.send(JSON.stringify({ action: 'canvas:join', projectId: liveProject.id }));
    await waitForWsMessage(wsDes, 'canvas:init');
    console.log('   ✓ Devon, Elena, and Diya joined active canvas session');

    // Elena adds a sticky note and edits it to create history in liveProject
    const stickyResync = {
      id: 'resync_sticky_alpha',
      type: 'sticky',
      color: '#fef08a',
      content: 'Original spec state before drop',
      x: 120,
      y: 150
    };
    wsRes.send(JSON.stringify({
      action: 'canvas:object_update',
      projectId: liveProject.id,
      object: stickyResync
    }));
    await waitForWsMessage(wsDev, 'canvas:object_update');

    // Diya/Maya edits it to produce version 2 + editHistory
    wsDes.send(JSON.stringify({
      action: 'canvas:object_update',
      projectId: liveProject.id,
      object: { ...stickyResync, content: 'Updated spec state before drop' }
    }));
    await waitForWsMessage(wsDev, 'canvas:object_update');

    // Diya creates and deletes an item to produce a tombstone
    const doomedItem = { id: 'doomed_elem_1', type: 'card', title: 'Temporary Item', x: 0, y: 0 };
    wsDes.send(JSON.stringify({
      action: 'canvas:object_update',
      projectId: liveProject.id,
      object: doomedItem
    }));
    await waitForWsMessage(wsDev, 'canvas:object_update');

    wsDes.send(JSON.stringify({
      action: 'canvas:object_delete',
      projectId: liveProject.id,
      objectId: 'doomed_elem_1'
    }));
    await waitForWsMessage(wsDev, 'canvas:object_delete');

    // Simulate abrupt network drop for Devon without clean exit
    console.log('   -> Simulating abrupt network severance for Devon (ws.terminate)...');
    wsDev.terminate();
    await new Promise(r => setTimeout(r, 150));

    // Devon reconnects with fresh WebSocket
    console.log('   -> Devon reconnects to canvas room with new WebSocket...');
    const wsDevReconnected = await connectWs(devToken);
    const reconnectInitPromise = waitForWsMessage(wsDevReconnected, 'canvas:init');
    wsDevReconnected.send(JSON.stringify({
      action: 'canvas:join',
      projectId: liveProject.id
    }));
    const reconnectInit = await reconnectInitPromise;

    console.log('   ✓ Reconnected client received canvas:init state');
    const rState = reconnectInit.data.canvasState;
    const syncedSticky = rState.objects['resync_sticky_alpha'];
    const syncedTombstone = rState.tombstones['doomed_elem_1'];

    if (!syncedSticky || syncedSticky.content !== 'Updated spec state before drop') {
      throw new Error('Reconnection failed to deliver updated active object state');
    }
    if (syncedSticky.version !== 2 || !syncedSticky.editHistory || syncedSticky.editHistory.length < 2) {
      throw new Error('Reconnection did not preserve full edit history');
    }
    if (!syncedTombstone || !syncedTombstone.isDeleted) {
      throw new Error('Reconnection did not preserve tombstone records');
    }
    console.log(`     * Active object synced: id=${syncedSticky.id}, version=${syncedSticky.version}, editHistory count=${syncedSticky.editHistory.length}`);
    console.log(`     * Tombstone synced: id=${syncedTombstone.id}, deletedBy=${syncedTombstone.deletedBy.name}`);
    console.log('   ✓ TEST 12 PASSED: Reconnection delivers full-state resync including editHistory and tombstones\n');

    // -------------------------------------------------------------------------
    // TEST 13: Room Isolation Test (Project A vs Project B)
    // -------------------------------------------------------------------------
    console.log('[TEST 13] Room Isolation Between Concurrent Projects...');
    // Create Project B
    const projBRes = await req('POST', '/api/ideas/draft', resToken, {
      title: 'Project B Isolated Domain',
      description: 'Idea for testing concurrent room isolation'
    });
    await req('POST', `/api/ideas/${projBRes.data.idea.id}/submit`, resToken);
    await req('PATCH', `/api/admin/ideas/${projBRes.data.idea.id}/override`, adminToken, {
      decision: 'APPROVED',
      reason: 'Approved for room isolation test'
    });
    const projectB = queryOne('SELECT id FROM projects WHERE idea_id = ?', [projBRes.data.idea.id]);
    console.log(`   ✓ Project B created: id=${projectB.id}`);

    // Elena joins Project B canvas on a dedicated WebSocket
    const wsProjectBClient = await connectWs(resToken);
    wsProjectBClient.send(JSON.stringify({ action: 'canvas:join', projectId: projectB.id }));
    await waitForWsMessage(wsProjectBClient, 'canvas:init');
    console.log('   ✓ Dedicated client joined Project B canvas room');

    // Attach spy on Project B client to listen for any leaked packets from Project A (liveProject)
    let leakedPacketsCount = 0;
    const packetSpy = (raw) => {
      try {
        const parsed = JSON.parse(raw.toString());
        if (parsed.channel === `canvas:${liveProject.id}` || parsed.data?.projectId === liveProject.id) {
          leakedPacketsCount++;
        }
      } catch (e) {}
    };
    wsProjectBClient.on('message', packetSpy);

    // Broadcast heavy traffic on Project A (liveProject)
    console.log('   -> Broadcasting cursor movements and object updates on Project A...');
    wsDevReconnected.send(JSON.stringify({
      action: 'canvas:cursor_move',
      projectId: liveProject.id,
      x: 777,
      y: 888
    }));
    wsDevReconnected.send(JSON.stringify({
      action: 'canvas:object_update',
      projectId: liveProject.id,
      object: { id: 'private_project_a_note', type: 'sticky', content: 'Top Secret Project A data', x: 10, y: 10 }
    }));

    await new Promise(r => setTimeout(r, 250));
    wsProjectBClient.off('message', packetSpy);

    console.log(`   -> Project B received ${leakedPacketsCount} packets from Project A (Expected exactly 0)`);
    if (leakedPacketsCount !== 0) {
      throw new Error(`Room isolation violated: Project B received ${leakedPacketsCount} messages from Project A`);
    }
    console.log('   ✓ TEST 13 PASSED: Cross-room communication strictly isolated; zero leakage\n');

    // -------------------------------------------------------------------------
    // TEST 14: Capacity Limit Enforcement (500 Objects Cap + 200 Tombstones FIFO)
    // -------------------------------------------------------------------------
    console.log('[TEST 14] Capacity Limit Enforcement & Tombstones FIFO Eviction...');
    const roomB = queryOne('SELECT id FROM coworking_rooms WHERE project_id = ?', [projectB.id]);
    
    // Test 500 active objects cap
    console.log('   -> Populating canvas room to exact capacity of 500 objects...');
    const testState = {
      objects: {},
      tombstones: {},
      metadata: { version: 1, archived: false }
    };
    for (let i = 1; i <= 500; i++) {
      testState.objects[`bulk_obj_${i}`] = {
        id: `bulk_obj_${i}`,
        type: 'shape',
        x: i,
        y: i,
        version: 1,
        createdBy: { userId: resUser.id, name: resUser.name, role: resUser.role, timestamp: new Date().toISOString() },
        lastModifiedBy: { userId: resUser.id, name: resUser.name, role: resUser.role, timestamp: new Date().toISOString() }
      };
    }
    // Save 500 items into room
    const { saveCanvasStateSync, updateCanvasElement, deleteCanvasElement } = await import('../src/services/coworkingService.js');
    saveCanvasStateSync(roomB.id, testState);

    // Attempt to add 501st object
    console.log('   -> Attempting to add 501st object beyond capacity cap...');
    const overflowResult = updateCanvasElement(roomB.id, {
      id: 'bulk_obj_501',
      type: 'sticky',
      content: 'This should overflow'
    }, resUser);

    console.log(`   -> 501st object update response: success=${overflowResult.success}, error="${overflowResult.error}"`);
    if (overflowResult.success || !overflowResult.error.includes('maximum 500 active objects')) {
      throw new Error('Failed to reject 501st object beyond capacity cap');
    }
    console.log('   ✓ 500 active object cap strictly enforced');

    // Test 200 Tombstones Cap with FIFO Eviction
    console.log('   -> Populating room with exactly 200 tombstones...');
    testState.objects = {};
    for (let i = 1; i <= 200; i++) {
      testState.tombstones[`tomb_${i}`] = {
        id: `tomb_${i}`,
        isDeleted: true,
        deletedBy: { userId: resUser.id, name: resUser.name, role: resUser.role, timestamp: new Date().toISOString() }
      };
    }
    testState.objects['victim_obj_201'] = {
      id: 'victim_obj_201',
      type: 'sticky',
      content: 'Item to be deleted as 201st tombstone',
      x: 0,
      y: 0
    };
    saveCanvasStateSync(roomB.id, testState);

    // Delete 201st object -> Should evict tomb_1 (FIFO) and keep exactly 200 tombstones
    console.log('   -> Deleting 201st object to trigger FIFO tombstone eviction...');
    const delete201Result = deleteCanvasElement(roomB.id, 'victim_obj_201', resUser);
    const updatedRoomBState = JSON.parse(queryOne('SELECT canvas_state_json FROM coworking_rooms WHERE id = ?', [roomB.id]).canvas_state_json);
    const tombstoneKeys = Object.keys(updatedRoomBState.tombstones);

    console.log(`   ✓ Total tombstones count in SQLite: ${tombstoneKeys.length} (Expected exactly 200)`);
    console.log(`   ✓ Oldest tombstone 'tomb_1' exists: ${updatedRoomBState.tombstones['tomb_1'] !== undefined} (Expected false - evicted)`);
    console.log(`   ✓ Newest tombstone 'victim_obj_201' exists: ${updatedRoomBState.tombstones['victim_obj_201'] !== undefined} (Expected true)`);

    if (tombstoneKeys.length !== 200) {
      throw new Error(`Expected exactly 200 tombstones, got ${tombstoneKeys.length}`);
    }
    if (updatedRoomBState.tombstones['tomb_1'] !== undefined) {
      throw new Error('Oldest tombstone was NOT evicted via FIFO');
    }
    if (!updatedRoomBState.tombstones['victim_obj_201']) {
      throw new Error('Newest tombstone was not preserved');
    }
    console.log('   ✓ TEST 14 PASSED: Capacity limits enforced (500 objects cap + 200 tombstones FIFO eviction)\n');

    // -------------------------------------------------------------------------
    // TEST 15: Immediate Persist on Last-Peer-Exit (<500ms Check)
    // -------------------------------------------------------------------------
    console.log('[TEST 15] Immediate Persist on Last-Peer-Exit (<500ms Timing Verification)...');
    // Project B currently has 1 active participant (wsProjectBClient)
    // Send a final modification
    const finalNote = {
      id: 'final_persist_note',
      type: 'sticky',
      content: 'Final note before last peer disconnects',
      x: 50,
      y: 50
    };
    wsProjectBClient.send(JSON.stringify({
      action: 'canvas:object_update',
      projectId: projectB.id,
      object: finalNote
    }));
    await waitForWsMessage(wsProjectBClient, 'canvas:object_update');

    // Disconnect the last peer
    const exitStartTime = Date.now();
    wsProjectBClient.send(JSON.stringify({
      action: 'canvas:leave',
      projectId: projectB.id
    }));
    wsProjectBClient.close();

    // Query SQLite immediately (within 60ms, well below 500ms ceiling)
    await new Promise(r => setTimeout(r, 60));
    const elapsedMs = Date.now() - exitStartTime;
    
    const dbSnapshotRow = queryOne('SELECT canvas_state_json FROM coworking_rooms WHERE id = ?', [roomB.id]);
    const persistedState = JSON.parse(dbSnapshotRow.canvas_state_json);
    const activeParticipantsRemaining = queryAll('SELECT id FROM room_participants WHERE room_id = ? AND left_at IS NULL', [roomB.id]);

    console.log(`   -> SQLite query executed in ${elapsedMs}ms after last peer exit (<500ms required)`);
    console.log(`   ✓ Persisted object found in SQLite: id=${persistedState.objects['final_persist_note']?.id}`);
    console.log(`   ✓ Active participants remaining: ${activeParticipantsRemaining.length} (Expected 0)`);

    if (!persistedState.objects['final_persist_note']) {
      throw new Error('Final canvas state was not immediately persisted on last peer exit');
    }
    if (activeParticipantsRemaining.length !== 0) {
      throw new Error('Active participants count should be 0 after last peer exit');
    }
    console.log('   ✓ TEST 15 PASSED: Snapshot immediately persisted to SQLite upon last-peer exit\n');

    // Close connections
    wsDevReconnected.close();
    wsRes.close();
    wsDes.close();

    console.log('===================================================================');
    console.log('   ALL 15 CHECKS OF STEP 11 (CO-WORKING CANVAS) FULLY VERIFIED & PASSED');
    console.log('===================================================================\n');

  } finally {
    // Teardown
    await cleanupTestData(false);
    server.close();
    wss.close();
    console.log('[TEARDOWN] Test server closed cleanly.');
  }
}

runStep11Tests().then(() => {
  process.exit(0);
}).catch(err => {
  console.error('\n❌ STEP 11 TEST SUITE FAILED:', err);
  process.exit(1);
});
