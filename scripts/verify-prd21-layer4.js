/**
 * PRD 21 Layer 4 Comprehensive Verification Suite
 * Tests:
 * 1. 8-Week Rolling Heatmap Grid (GET /api/workload/heatmap/:projectId — Member × 8 Weeks grid, status categorization)
 * 2. Workload Snapshot API (POST /api/workload/snapshot/:projectId — append-only workload_snapshots JSON freeze & triggers)
 * 3. Workload Snapshot Retrieval (GET /api/workload/snapshots/:projectId)
 * 4. Rebalance Suggestions Engine (GET /api/workload/rebalance/:projectId — server-side advisory suggestions)
 * 5. Team Dashboard & Member Forecast (GET /api/workload/dashboard & GET /api/workload/dashboard/member/:userId)
 * 6. Workload Export API (GET /api/workload/export/:projectId)
 * 7. RBAC & Security Enforcement across all Layer 4 endpoints
 */

import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { queryOne, queryAll, execute } from '../src/db/database.js';
import { config } from '../src/config.js';
import * as workloadService from '../src/services/workloadService.js';

const BASE_URL = 'http://localhost:4000/api/workload';

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(condition, message) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  [PASS] Test ${totalTests}: ${message}`);
  } else {
    failedTests++;
    console.error(`  [FAIL] Test ${totalTests}: ${message}`);
  }
}

function createToken(user) {
  const sessionId = crypto.randomUUID();
  const token = jwt.sign(
    { sessionId, userId: user.id, role: user.role, email: user.email, name: user.name },
    config.JWT_SECRET,
    { expiresIn: '1d' }
  );
  execute(`
    INSERT INTO sessions (id, user_id, token, device_info, ip_address, created_at, expires_at, is_revoked)
    VALUES (?, ?, ?, 'Test Suite Layer 4', '127.0.0.1', datetime('now'), datetime('now', '+1 day'), 0)
  `, [sessionId, user.id, token]);
  return token;
}

async function request(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers
    }
  });
  let data = null;
  try {
    data = await res.json();
  } catch (e) {
    data = null;
  }
  return { status: res.status, ok: res.ok, data };
}

async function runSuite() {
  console.log('===================================================================');
  console.log('  STARTING PRD 21 LAYER 4 COMPREHENSIVE VERIFICATION SUITE');
  console.log('===================================================================\n');

  // Test fixtures setup
  const adminUser = queryOne("SELECT id, name, email, role FROM users WHERE role = 'admin' LIMIT 1");
  const memberUser = queryOne("SELECT id, name, email, role FROM users WHERE role NOT IN ('admin', 'superadmin') LIMIT 1");
  const otherMember = queryOne("SELECT id, name, email, role FROM users WHERE id NOT IN (?, ?) LIMIT 1", [adminUser.id, memberUser.id]);
  const project = queryOne("SELECT id, title FROM projects LIMIT 1");

  console.log(`Test Context:`);
  console.log(`- Admin User: ${adminUser.name} (ID: ${adminUser.id}, Role: ${adminUser.role})`);
  console.log(`- Member User: ${memberUser.name} (ID: ${memberUser.id}, Role: ${memberUser.role})`);
  console.log(`- Other Member: ${otherMember.name} (ID: ${otherMember.id}, Role: ${otherMember.role})`);
  console.log(`- Project: ${project.title} (ID: ${project.id})\n`);

  const adminToken = createToken(adminUser);
  const memberToken = createToken(memberUser);

  // -----------------------------------------------------------------
  // SECTION 1: 8-WEEK ROLLING HEATMAP GRID
  // -----------------------------------------------------------------
  console.log('--- SECTION 1: 8-Week Rolling Heatmap Grid (GET /api/workload/heatmap/:projectId) ---');

  // Test 1: Non-admin member cannot view heatmap -> 403 Forbidden
  const res1 = await request(`${BASE_URL}/heatmap/${project.id}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${memberToken}` }
  });
  assert(res1.status === 403, 'Non-admin member cannot access heatmap (403 Forbidden)');

  // Test 2: Admin queries invalid project -> 404 Not Found
  const res2 = await request(`${BASE_URL}/heatmap/invalid-project-id-999`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert(res2.status === 404, 'Admin querying non-existent project returns 404 Not Found');

  // Test 3: Admin queries heatmap with default rolling start date -> 200 OK
  const res3 = await request(`${BASE_URL}/heatmap/${project.id}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert(
    res3.status === 200 &&
    res3.data.project_id === project.id &&
    res3.data.weeks_count === 8 &&
    Array.isArray(res3.data.weeks) &&
    res3.data.weeks.length === 8,
    'Admin retrieves 8-week heatmap with 8 consecutive calendar week headers (200 OK)'
  );

  // Test 4: Verify heatmap grid rows structure and cell attributes
  const heatmap = res3.data;
  assert(
    Array.isArray(heatmap.grid) && heatmap.grid.length > 0,
    `Heatmap contains team member grid rows (found ${heatmap.grid.length} members)`
  );

  const sampleRow = heatmap.grid[0];
  assert(
    sampleRow.user_id &&
    sampleRow.name &&
    sampleRow.metrics &&
    typeof sampleRow.metrics.avg_utilization_pct === 'number' &&
    typeof sampleRow.metrics.peak_utilization_pct === 'number' &&
    typeof sampleRow.metrics.overloaded_weeks_count === 'number',
    'Member grid row includes summary metrics: avg_utilization_pct, peak_utilization_pct, overloaded_weeks_count'
  );

  assert(
    Array.isArray(sampleRow.cells) && sampleRow.cells.length === 8,
    'Member row contains exactly 8 week cells'
  );

  // Test 5: Verify cell fields and status categorization
  const sampleCell = sampleRow.cells[0];
  const validStatuses = ['UNDERLOADED', 'OPTIMAL', 'NEAR_CAPACITY', 'OVERLOADED'];
  assert(
    typeof sampleCell.week_index === 'number' &&
    sampleCell.week_start &&
    sampleCell.week_end &&
    typeof sampleCell.capacity_hrs === 'number' &&
    typeof sampleCell.available_hrs === 'number' &&
    typeof sampleCell.assigned_hrs === 'number' &&
    typeof sampleCell.utilization_pct === 'number' &&
    validStatuses.includes(sampleCell.status) &&
    Array.isArray(sampleCell.tasks),
    `Cell contains all required fields and valid status badge: ${sampleCell.status} (${sampleCell.utilization_pct}%)`
  );

  // Test 6: Custom start_date parameter works for future heatmap projection
  const futureStartDate = '2027-01-04';
  const res6 = await request(`${BASE_URL}/heatmap/${project.id}?start_date=${futureStartDate}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert(
    res6.status === 200 &&
    res6.data.weeks[0].week_start === futureStartDate,
    `Custom start_date parameter dynamically sets week 1 start date (${futureStartDate})`
  );

  // -----------------------------------------------------------------
  // SECTION 2: WORKLOAD SNAPSHOT API & APPEND-ONLY TRIGGERS
  // -----------------------------------------------------------------
  console.log('\n--- SECTION 2: Workload Snapshot API & Append-Only Triggers ---');

  // Test 7: Non-admin member cannot create snapshot -> 403 Forbidden
  const res7 = await request(`${BASE_URL}/snapshot/${project.id}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${memberToken}` }
  });
  assert(res7.status === 403, 'Non-admin member cannot create snapshot (403 Forbidden)');

  // Test 8: Admin creates snapshot via URL param POST /api/workload/snapshot/:projectId -> 201 Created
  const res8 = await request(`${BASE_URL}/snapshot/${project.id}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  const snapshot1 = res8.data?.snapshot;
  assert(
    res8.status === 201 &&
    snapshot1 &&
    snapshot1.project_id === project.id &&
    Array.isArray(snapshot1.snapshot_data) &&
    snapshot1.snapshot_data.length > 0,
    'Admin creates point-in-time workload snapshot with frozen JSON data (201 Created)'
  );

  // Test 9: Snapshot data contains all required frozen fields
  const snapMember = snapshot1.snapshot_data[0];
  assert(
    snapMember.user_id &&
    snapMember.name &&
    typeof snapMember.capacity_hrs === 'number' &&
    typeof snapMember.assigned_hrs === 'number' &&
    typeof snapMember.utilization_pct === 'number' &&
    validStatuses.includes(snapMember.status),
    `Snapshot data captures frozen member metrics: ${snapMember.name} - ${snapMember.status} (${snapMember.utilization_pct}%)`
  );

  // Test 10: Admin creates snapshot via JSON body POST /api/workload/snapshot -> 201 Created
  const res10 = await request(`${BASE_URL}/snapshot`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ project_id: project.id })
  });
  assert(res10.status === 201, 'Admin can also create snapshot via body { project_id } (201 Created)');

  // Test 11: DB Trigger prevent_workload_snapshot_update blocks direct SQL UPDATE
  let snapshotUpdateBlocked = false;
  try {
    execute("UPDATE workload_snapshots SET snapshot_data = '{\"tampered\": true}' WHERE id = ?", [snapshot1.id]);
  } catch (err) {
    snapshotUpdateBlocked = err.message.includes('append-only');
  }
  assert(snapshotUpdateBlocked, 'DB Trigger prevent_workload_snapshot_update blocks SQL UPDATE on workload_snapshots');

  // Test 12: DB Trigger prevent_workload_snapshot_delete blocks direct SQL DELETE
  let snapshotDeleteBlocked = false;
  try {
    execute('DELETE FROM workload_snapshots WHERE id = ?', [snapshot1.id]);
  } catch (err) {
    snapshotDeleteBlocked = err.message.includes('append-only');
  }
  assert(snapshotDeleteBlocked, 'DB Trigger prevent_workload_snapshot_delete blocks SQL DELETE on workload_snapshots');

  // Test 13: GET /api/workload/snapshots/:projectId retrieves all historical snapshots
  const res13 = await request(`${BASE_URL}/snapshots/${project.id}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert(
    res13.status === 200 &&
    Array.isArray(res13.data.snapshots) &&
    res13.data.snapshots.length >= 2,
    `Admin lists project snapshots (found ${res13.data?.count} snapshots, 200 OK)`
  );

  // Test 14: Non-admin member cannot list snapshots -> 403 Forbidden
  const res14 = await request(`${BASE_URL}/snapshots/${project.id}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${memberToken}` }
  });
  assert(res14.status === 403, 'Non-admin member cannot list project snapshots (403 Forbidden)');

  // -----------------------------------------------------------------
  // SECTION 3: REBALANCE SUGGESTIONS ENGINE
  // -----------------------------------------------------------------
  console.log('\n--- SECTION 3: Rebalance Suggestions Engine (GET /api/workload/rebalance/:projectId) ---');

  // Setup a scenario with one heavily overloaded member and one underloaded member
  const rebalanceWeek = '2028-03-06'; // Future Monday
  execute('DELETE FROM workload_assignments WHERE start_date = ?', [rebalanceWeek]);

  // Member A (memberUser) gets 2 tasks: 30 hrs + 20 hrs = 50 hrs (utilization ~ 156% on 32 cap -> OVERLOADED)
  const taskA1 = workloadService.createAssignment({
    user_id: memberUser.id,
    project_id: project.id,
    title: 'Heavy Backend Refactor',
    estimated_hrs: 30.0,
    start_date: rebalanceWeek,
    end_date: '2028-03-10'
  }, adminUser);

  const taskA2 = workloadService.createAssignment({
    user_id: memberUser.id,
    project_id: project.id,
    title: 'Security Vulnerability Patch',
    estimated_hrs: 20.0,
    start_date: rebalanceWeek,
    end_date: '2028-03-10'
  }, adminUser);

  // Member B (otherMember) has 0 tasks (utilization 0.0% -> UNDERLOADED)

  // Test 15: Non-admin member cannot call rebalance engine -> 403 Forbidden
  const res15 = await request(`${BASE_URL}/rebalance/${project.id}?week_start_date=${rebalanceWeek}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${memberToken}` }
  });
  assert(res15.status === 403, 'Non-admin member cannot access rebalance suggestions (403 Forbidden)');

  // Test 16: Admin calls rebalance suggestions engine -> 200 OK with suggestions
  const res16 = await request(`${BASE_URL}/rebalance/${project.id}?week_start_date=${rebalanceWeek}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  const reb = res16.data;
  assert(
    res16.status === 200 &&
    reb.status === 'REBALANCE_AVAILABLE' &&
    reb.overloaded_count >= 1 &&
    reb.underloaded_count >= 1 &&
    Array.isArray(reb.suggestions) &&
    reb.suggestions.length >= 1,
    `Rebalance engine identified overloaded member and generated ${reb.suggestions?.length} suggestion(s)`
  );

  // Test 17: Verify suggestion structure and simulated impact
  const sug = reb.suggestions[0];
  assert(
    sug.task_id &&
    sug.task_title &&
    sug.current_owner.id === memberUser.id &&
    sug.suggested_target.id &&
    sug.suggested_target.id !== memberUser.id &&
    sug.reason &&
    sug.simulated_impact.source.before_pct > 100.0 &&
    sug.simulated_impact.source.after_pct < sug.simulated_impact.source.before_pct,
    `Suggestion details: Move "${sug.task_title}" from ${sug.current_owner.name} to ${sug.suggested_target.name} (Source reduces from ${sug.simulated_impact.source.before_pct}% to ${sug.simulated_impact.source.after_pct}%)`
  );

  // Test 18: Advisory-only rule: Rebalance engine does NOT automatically mutate assignments in DB
  const unchangedTask = queryOne('SELECT user_id FROM workload_assignments WHERE id = ?', [sug.task_id]);
  assert(
    unchangedTask.user_id === memberUser.id,
    'Rebalance engine is strictly advisory: original task assignment in DB was NOT mutated'
  );

  // Test 19: Balanced scenario: When no member is overloaded, returns BALANCED
  const balancedWeek = '2028-04-10';
  const res19 = await request(`${BASE_URL}/rebalance/${project.id}?week_start_date=${balancedWeek}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert(
    res19.status === 200 &&
    res19.data.status === 'BALANCED' &&
    res19.data.suggestions.length === 0,
    'When no members are overloaded, rebalance engine reports status: BALANCED'
  );

  // -----------------------------------------------------------------
  // SECTION 4: TEAM DASHBOARD, MEMBER FORECAST & EXPORT API
  // -----------------------------------------------------------------
  console.log('\n--- SECTION 4: Team Dashboard, Member Forecast & Export API ---');

  // Test 20: GET /api/workload/dashboard by Admin -> 200 OK
  const res20 = await request(`${BASE_URL}/dashboard`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert(
    res20.status === 200 &&
    res20.data.summary &&
    typeof res20.data.summary.total_members === 'number' &&
    Array.isArray(res20.data.members),
    'Admin accesses team-wide dashboard overview (200 OK)'
  );

  // Test 21: Non-admin member cannot view team dashboard -> 403 Forbidden
  const res21 = await request(`${BASE_URL}/dashboard`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${memberToken}` }
  });
  assert(res21.status === 403, 'Non-admin member cannot view team dashboard (403 Forbidden)');

  // Test 22: GET /api/workload/dashboard/member/:userId by member for self -> 200 OK with 5 weeks
  const res22 = await request(`${BASE_URL}/dashboard/member/${memberUser.id}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${memberToken}` }
  });
  assert(
    res22.status === 200 &&
    res22.data.user.id === memberUser.id &&
    res22.data.forecast_weeks_count === 5 &&
    Array.isArray(res22.data.weeks) &&
    res22.data.weeks.length === 5,
    'Member retrieves their personal 5-week workload forecast (200 OK)'
  );

  // Test 23: Member cannot view another member's forecast -> 403 Forbidden
  const res23 = await request(`${BASE_URL}/dashboard/member/${otherMember.id}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${memberToken}` }
  });
  assert(res23.status === 403, 'Member cannot view other member forecast (403 Forbidden)');

  // Test 24: Admin can view any member's forecast -> 200 OK
  const res24 = await request(`${BASE_URL}/dashboard/member/${otherMember.id}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert(res24.status === 200 && res24.data.user.id === otherMember.id, 'Admin can view any member forecast (200 OK)');

  // Test 25: GET /api/workload/export/:projectId by Admin -> 200 OK with timeline
  const res25 = await request(`${BASE_URL}/export/${project.id}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert(
    res25.status === 200 &&
    res25.data.export_metadata &&
    res25.data.export_metadata.weeks_exported === 5 &&
    Array.isArray(res25.data.timeline) &&
    res25.data.timeline.length === 5,
    'Admin exports 5-week project workload timeline in JSON format (200 OK)'
  );

  // Test 26: Non-admin member cannot export workload data -> 403 Forbidden
  const res26 = await request(`${BASE_URL}/export/${project.id}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${memberToken}` }
  });
  assert(res26.status === 403, 'Non-admin member cannot export project workload data (403 Forbidden)');

  // -----------------------------------------------------------------
  // SUMMARY RESULTS
  // -----------------------------------------------------------------
  console.log('\n===================================================================');
  console.log(`  PRD 21 LAYER 4 VERIFICATION SUMMARY:`);
  console.log(`  Total Tests:  ${totalTests}`);
  console.log(`  Passed Tests: ${passedTests}`);
  console.log(`  Failed Tests: ${failedTests}`);
  console.log('===================================================================');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runSuite().catch(err => {
  console.error('Test runner fatal error:', err);
  process.exit(1);
});
