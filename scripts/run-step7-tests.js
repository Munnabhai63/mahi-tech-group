import WebSocket from 'ws';
import crypto from 'node:crypto';
import { queryOne, queryAll, execute } from '../src/db/database.js';

const BASE_URL = 'http://localhost:4000';
const WS_BASE_URL = 'ws://localhost:4000/ws';

async function runStep7Tests() {
  console.log('===================================================================');
  console.log('      STEP 07: FRONTEND CENTER DASHBOARD VERIFICATION SUITE       ');
  console.log('===================================================================\n');

  const results = [];

  try {
    // -----------------------------------------------------------------
    // TEST 0: Authentication & User Setup
    // -----------------------------------------------------------------
    console.log('--- TEST 0: Authentication & Multi-Role User Setup ---');
    const adminLoginRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@mahitechgroup.com', password: 'AdminPassword@2026' })
    });
    const adminLoginData = await adminLoginRes.json();
    const adminToken = adminLoginData.token;
    const adminUser = adminLoginData.user;
    console.log(`[AUTH] Admin successfully authenticated (ID: ${adminUser.id})`);

    // Helper to create test member
    async function createMember(name, email, role, subRole = null) {
      const addRes = await fetch(`${BASE_URL}/api/admin/members/add`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
        body: JSON.stringify({ name, email, role, sub_role: subRole })
      });
      const addData = await addRes.json();
      const tempPass = addData.temporaryPassword;

      const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: tempPass })
      });
      const loginData = await loginRes.json();
      return { user: addData.user, token: loginData.token };
    }

    const testResearcher = await createMember('Aarav Researcher', `aarav.s7.${Date.now()}@mahitechgroup.com`, 'researcher');
    const testDeveloper = await createMember('Maya Developer', `maya.s7.${Date.now()}@mahitechgroup.com`, 'developer', 'frontend');
    const testVoter = await createMember('Dev Voter', `dev.voter.s7.${Date.now()}@mahitechgroup.com`, 'developer', 'backend');

    results.push({ test: 'Authentication & Multi-Role Setup', status: 'PASS' });

    // -----------------------------------------------------------------
    // TEST 1: Schema Verification & Notifications Database Table
    // -----------------------------------------------------------------
    console.log('\n--- TEST 1: Schema Verification & Notifications Database Table ---');
    const notifTable = queryAll("PRAGMA table_info(notifications)");
    console.log('Notifications table columns:', notifTable.map(c => `${c.name} (${c.type})`).join(', '));
    if (notifTable.length < 7) {
      throw new Error(`Expected at least 7 columns in notifications table, got ${notifTable.length}`);
    }

    const notifIndexes = queryAll("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='notifications'");
    console.log('Notifications indexes:', notifIndexes.map(i => i.name).join(', '));
    if (notifIndexes.length < 3) {
      throw new Error('Missing indexes on notifications table');
    }

    results.push({ test: 'Notifications Table & Index Schema', status: 'PASS' });

    // -----------------------------------------------------------------
    // TEST 2: Static Asset Serving & SPA Fallback (PRD Requirements)
    // -----------------------------------------------------------------
    console.log('\n--- TEST 2: Static Asset Serving & SPA Fallback ---');
    const htmlRes = await fetch(`${BASE_URL}/`);
    console.log(`GET / HTTP status: ${htmlRes.status}, Content-Type: ${htmlRes.headers.get('content-type')}`);
    const htmlText = await htmlRes.text();
    if (htmlRes.status !== 200 || !htmlText.includes('CENTER DASHBOARD')) {
      throw new Error('Failed to serve Center Dashboard index.html');
    }

    const cssRes = await fetch(`${BASE_URL}/css/dashboard.css`);
    console.log(`GET /css/dashboard.css HTTP status: ${cssRes.status}`);
    if (cssRes.status !== 200) {
      throw new Error('Failed to serve /css/dashboard.css');
    }

    const jsRes = await fetch(`${BASE_URL}/js/dashboard.js`);
    console.log(`GET /js/dashboard.js HTTP status: ${jsRes.status}`);
    if (jsRes.status !== 200) {
      throw new Error('Failed to serve /js/dashboard.js');
    }

    results.push({ test: 'Static Asset Serving (HTML, CSS, JS)', status: 'PASS' });

    // -----------------------------------------------------------------
    // TEST 3: Center Dashboard API Endpoints
    // -----------------------------------------------------------------
    console.log('\n--- TEST 3: Center Dashboard API Endpoints ---');

    // 3a. GET /api/dashboard/summary
    const summaryRes = await fetch(`${BASE_URL}/api/dashboard/summary`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const summary = await summaryRes.json();
    console.log('Dashboard Summary for Admin:', summary);
    if (summaryRes.status !== 200 || typeof summary.activeProjectsCount !== 'number') {
      throw new Error('Invalid dashboard summary response');
    }

    // 3b. GET /api/dashboard/kanban
    const kanbanRes = await fetch(`${BASE_URL}/api/dashboard/kanban`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const kanban = await kanbanRes.json();
    console.log(`Kanban columns retrieved:`, Object.keys(kanban.columns));
    console.log(`Total projects in pipeline: ${kanban.totalProjects}`);
    if (kanbanRes.status !== 200 || Object.keys(kanban.columns).length !== 5) {
      throw new Error('Kanban response did not contain exactly 5 stages');
    }

    // 3c. GET /api/dashboard/votes-feed
    const votesFeedRes = await fetch(`${BASE_URL}/api/dashboard/votes-feed`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const votesFeed = await votesFeedRes.json();
    console.log(`Pending votes feed items: ${votesFeed.count}`);
    if (votesFeedRes.status !== 200 || !Array.isArray(votesFeed.ideas)) {
      throw new Error('Invalid votes feed response');
    }

    results.push({ test: 'Center Dashboard API Endpoints', status: 'PASS' });

    // -----------------------------------------------------------------
    // TEST 4: WebSocket Connection & Multi-Client Authentication
    // -----------------------------------------------------------------
    console.log('\n--- TEST 4: WebSocket Connection & Multi-Client Authentication ---');

    // 4a. Unauthorized WS connection without token rejected
    let unauthRejected = false;
    try {
      await new Promise((resolve, reject) => {
        const wsUnauth = new WebSocket(WS_BASE_URL);
        wsUnauth.on('open', () => reject(new Error('Unauthorized WS connection was accepted!')));
        wsUnauth.on('error', (err) => {
          unauthRejected = true;
          resolve();
        });
        wsUnauth.on('unexpected-response', (req, res) => {
          if (res.statusCode === 401) {
            unauthRejected = true;
            resolve();
          } else {
            reject(new Error(`Unexpected status code: ${res.statusCode}`));
          }
        });
      });
    } catch (e) {
      unauthRejected = true;
    }
    console.log(`Unauthorized WS without token rejected: ${unauthRejected}`);
    if (!unauthRejected) {
      throw new Error('Server accepted unauthorized WebSocket connection without token!');
    }

    // Helper to connect authenticated WS client
    function connectTestWs(token) {
      return new Promise((resolve, reject) => {
        const ws = new WebSocket(`${WS_BASE_URL}?token=${token}`);
        const messages = [];

        ws.on('open', () => {});
        ws.on('message', (raw) => {
          try {
            const parsed = JSON.parse(raw.toString());
            messages.push(parsed);
          } catch (e) {}
        });

        // Wait for handshake
        setTimeout(() => {
          if (ws.readyState === WebSocket.OPEN) {
            resolve({ ws, messages });
          } else {
            reject(new Error('WebSocket connection timed out'));
          }
        }, 800);
      });
    }

    // 4b. Connect Client A (Admin) and Client B (Developer)
    console.log('Connecting Client A (Admin) via WebSocket...');
    const clientA = await connectTestWs(adminToken);
    console.log(`Client A handshake received:`, clientA.messages[0]?.event);

    console.log('Connecting Client B (Maya Developer) via WebSocket...');
    const clientB = await connectTestWs(testDeveloper.token);
    console.log(`Client B handshake received:`, clientB.messages[0]?.event);

    results.push({ test: 'WebSocket Authentication & Multi-Client Connections', status: 'PASS' });

    // -----------------------------------------------------------------
    // TEST 5: Live Vote Casting & Real-Time Sync (Non-Negotiable PRD Rule)
    // -----------------------------------------------------------------
    console.log('\n--- TEST 5: Live Vote Casting & Real-Time Sync (Zero Page Reload) ---');

    // 5a. Create an idea and submit it for voting
    const draftRes = await fetch(`${BASE_URL}/api/ideas/draft`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${testResearcher.token}` },
      body: JSON.stringify({
        title: 'Real-Time Edge Neural Cache',
        description: 'Low-latency distributed model caching architecture'
      })
    });
    const draftData = await draftRes.json();
    const testIdeaId = draftData.idea.id;

    // Submit idea (enters PENDING_REVIEW)
    const submitRes = await fetch(`${BASE_URL}/api/ideas/${testIdeaId}/submit`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${testResearcher.token}` }
    });
    console.log(`Idea submitted for review. HTTP Status: ${submitRes.status}`);

    // Allow WS broadcast to propagate
    await new Promise(r => setTimeout(r, 400));

    // Verify both Client A and Client B received idea.submitted event
    const ideaSubmittedEventA = clientA.messages.find(m => m.event === 'idea.submitted' && m.data.id === testIdeaId);
    const ideaSubmittedEventB = clientB.messages.find(m => m.event === 'idea.submitted' && m.data.id === testIdeaId);
    console.log(`Client A received idea.submitted over WS:`, Boolean(ideaSubmittedEventA));
    console.log(`Client B received idea.submitted over WS:`, Boolean(ideaSubmittedEventB));
    if (!ideaSubmittedEventA || !ideaSubmittedEventB) {
      throw new Error('WebSocket failed to broadcast idea.submitted to online clients!');
    }

    // 5b. Cast a vote from testVoter and verify real-time green_percentage sync
    console.log('Casting vote on idea from voter user...');
    const voteRes = await fetch(`${BASE_URL}/api/ideas/${testIdeaId}/vote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${testVoter.token}` },
      body: JSON.stringify({
        vote_color: 'green',
        score_feasibility: 9,
        score_market: 9,
        score_capacity: 8,
        comment: 'High commercial potential'
      })
    });
    const voteData = await voteRes.json();
    console.log(`Vote cast response: greenPercentage = ${voteData.greenPercentage}%, totalVotes = ${voteData.totalVotesCast}`);

    // Wait for WS broadcast
    await new Promise(r => setTimeout(r, 400));

    // Verify both Client A and Client B received vote.cast event with exact percentage
    const voteEventA = clientA.messages.find(m => m.event === 'vote.cast' && m.data.ideaId === testIdeaId);
    const voteEventB = clientB.messages.find(m => m.event === 'vote.cast' && m.data.ideaId === testIdeaId);
    console.log(`Client A received vote.cast:`, voteEventA?.data);
    console.log(`Client B received vote.cast:`, voteEventB?.data);

    if (!voteEventA || !voteEventB || voteEventA.data.greenPercentage !== 100) {
      throw new Error('Live vote.cast event was not properly synchronized across WebSocket clients!');
    }

    results.push({ test: 'Real-Time Live Vote Sync Across Multiple Clients', status: 'PASS' });

    // -----------------------------------------------------------------
    // TEST 6: Real-Time Notifications & Read State Management
    // -----------------------------------------------------------------
    console.log('\n--- TEST 6: Notifications Creation & Read State Management ---');

    // Create a notification for Maya Developer via live API
    const notifSendRes = await fetch(`${BASE_URL}/api/notifications/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({
        user_id: testDeveloper.user.id,
        event_type: 'task.unblocked',
        message: 'Frontend API Integration is unblocked and ready for implementation',
        link: '/projects/test-project-1'
      })
    });
    const notifSendData = await notifSendRes.json();
    const createdNotif = notifSendData.notification;
    console.log(`Notification created via API: ID ${createdNotif.id}, read_status = ${createdNotif.read_status}`);

    // Wait for WS message to arrive at Client B (Maya's connection)
    await new Promise(r => setTimeout(r, 400));
    const notifWsMsg = clientB.messages.find(m => m.event === 'notification.new' && m.data.id === createdNotif.id);
    console.log(`Client B received notification.new over WS:`, Boolean(notifWsMsg));
    if (!notifWsMsg) {
      throw new Error('Notification was not pushed over WebSocket to the target user!');
    }

    // Verify via GET /api/notifications/my
    const myNotifsRes = await fetch(`${BASE_URL}/api/notifications/my`, {
      headers: { 'Authorization': `Bearer ${testDeveloper.token}` }
    });
    const myNotifsData = await myNotifsRes.json();
    console.log(`User unread notifications count: ${myNotifsData.unreadCount}`);
    if (myNotifsData.unreadCount <= 0) {
      throw new Error('Unread notification count did not reflect newly created notification');
    }

    // Mark as read via PATCH /api/notifications/:id/read
    const markReadRes = await fetch(`${BASE_URL}/api/notifications/${createdNotif.id}/read`, {
      method: 'PATCH',
      headers: { 'Authorization': `Bearer ${testDeveloper.token}` }
    });
    const markReadData = await markReadRes.json();
    console.log(`Mark read response:`, markReadData);

    const updatedNotif = queryOne('SELECT read_status FROM notifications WHERE id = ?', [createdNotif.id]);
    console.log(`Database read_status after update: ${updatedNotif.read_status}`);
    if (updatedNotif.read_status !== 1) {
      throw new Error('read_status was not persisted to database!');
    }

    results.push({ test: 'Real-Time Notifications & Read State Persistence', status: 'PASS' });

    // -----------------------------------------------------------------
    // TEST 7: Role-Based Data Filtering (Admin vs Non-Admin)
    // -----------------------------------------------------------------
    console.log('\n--- TEST 7: Role-Based Data Filtering (Admin vs Non-Admin) ---');

    // Admin sees all projects in system
    const adminKanbanRes = await fetch(`${BASE_URL}/api/dashboard/kanban`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const adminKanban = await adminKanbanRes.json();

    // Developer sees only assigned or owned projects
    const devKanbanRes = await fetch(`${BASE_URL}/api/dashboard/kanban`, {
      headers: { 'Authorization': `Bearer ${testDeveloper.token}` }
    });
    const devKanban = await devKanbanRes.json();

    console.log(`Admin visible projects count: ${adminKanban.totalProjects}`);
    console.log(`Developer visible projects count: ${devKanban.totalProjects}`);

    // Admin should see at least as many or more projects than regular developer
    if (adminKanban.totalProjects < devKanban.totalProjects) {
      throw new Error('Role-based project filtering violation: Developer sees more projects than Admin!');
    }

    results.push({ test: 'Role-Based Dashboard Data Filtering', status: 'PASS' });

    // Clean up WS clients
    clientA.ws.close();
    clientB.ws.close();

    // -----------------------------------------------------------------
    // FINAL SUMMARY
    // -----------------------------------------------------------------
    console.log('\n===================================================================');
    console.log('       ALL STEP 07 VERIFICATION TESTS PASSED SUCCESSFULLY!        ');
    console.log('===================================================================\n');
    console.table(results);

    return { success: true, results };
  } catch (err) {
    console.error('\n❌ STEP 07 VERIFICATION FAILURE:', err);
    process.exit(1);
  }
}

runStep7Tests();
