/**
 * PRD 21 Layer 3 Comprehensive Verification Suite
 * Tests:
 * 1. Assignment Service CRUD (workload_assignments across BACKLOG_ITEM, GANTT_ITEM, PIPELINE_POINT, MANUAL)
 * 2. Multi-week proration engine (exact fractional day proportional split per week)
 * 3. Member full weekly workload retrieval & assigned hours aggregation
 * 4. Team-wide utilization aggregation (GET /api/workload/team/:projectId)
 * 5. Auto-alert generation on assignment create/update
 * 6. RBAC enforcement (Admin+ vs Member permissions, Rule 11 team privacy)
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
    VALUES (?, ?, ?, 'Test Suite Layer 3', '127.0.0.1', datetime('now'), datetime('now', '+1 day'), 0)
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
  console.log('  STARTING PRD 21 LAYER 3 COMPREHENSIVE VERIFICATION SUITE');
  console.log('===================================================================\n');

  // Test context setup
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
  // SECTION 1: WORKLOAD ASSIGNMENT CRUD & SOURCE TYPES
  // -----------------------------------------------------------------
  console.log('--- SECTION 1: Workload Assignment Service & CRUD ---');

  // Test 1: Member trying to create assignment -> 403 Forbidden
  const res1 = await request(`${BASE_URL}/assignment/create`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${memberToken}` },
    body: JSON.stringify({
      user_id: memberUser.id,
      project_id: project.id,
      title: 'Unauthorized Task',
      estimated_hrs: 10,
      start_date: '2026-11-02',
      end_date: '2026-11-06'
    })
  });
  assert(res1.status === 403, 'Non-admin member cannot create workload assignments (403 Forbidden)');

  // Test 2: Validation - Missing user_id -> 400
  const res2 = await request(`${BASE_URL}/assignment/create`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({
      project_id: project.id,
      title: 'Missing User Task',
      estimated_hrs: 10,
      start_date: '2026-11-02',
      end_date: '2026-11-06'
    })
  });
  assert(res2.status === 400 && res2.data.error.includes('user_id'), 'Validation: missing user_id returns 400');

  // Test 3: Validation - Invalid source_type -> 400
  const res3 = await request(`${BASE_URL}/assignment/create`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({
      user_id: memberUser.id,
      project_id: project.id,
      source_type: 'INVALID_TYPE',
      title: 'Invalid Source Task',
      estimated_hrs: 10,
      start_date: '2026-11-02',
      end_date: '2026-11-06'
    })
  });
  assert(res3.status === 400 && res3.data.error.includes('source_type'), 'Validation: invalid source_type returns 400');

  // Test 4: Validation - start_date > end_date -> 400
  const res4 = await request(`${BASE_URL}/assignment/create`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({
      user_id: memberUser.id,
      project_id: project.id,
      title: 'Inverted Dates Task',
      estimated_hrs: 10,
      start_date: '2026-11-10',
      end_date: '2026-11-02'
    })
  });
  assert(res4.status === 400 && res4.data.error.includes('before or equal'), 'Validation: start_date > end_date returns 400');

  // Test 5: Create assignment with BACKLOG_ITEM source -> 201
  const res5 = await request(`${BASE_URL}/assignment/create`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({
      user_id: memberUser.id,
      project_id: project.id,
      source_type: 'BACKLOG_ITEM',
      source_id: 101,
      title: 'Backlog Feature: Real-time Sync',
      estimated_hrs: 15.0,
      start_date: '2026-11-02',
      end_date: '2026-11-06'
    })
  });
  const backlogAsgnId = res5.data?.assignment?.id;
  assert(
    res5.status === 201 &&
    res5.data.assignment.source_type === 'BACKLOG_ITEM' &&
    res5.data.assignment.status === 'ACTIVE',
    'Admin creates assignment with BACKLOG_ITEM source (201 Created)'
  );

  // Test 6: Create assignment with GANTT_ITEM source -> 201
  const res6 = await request(`${BASE_URL}/assignment/create`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({
      user_id: memberUser.id,
      project_id: project.id,
      source_type: 'GANTT_ITEM',
      source_id: 202,
      title: 'Gantt Milestone: Architecture Audit',
      estimated_hrs: 20.0,
      start_date: '2026-11-02',
      end_date: '2026-11-04'
    })
  });
  assert(
    res6.status === 201 &&
    res6.data.assignment.source_type === 'GANTT_ITEM',
    'Admin creates assignment with GANTT_ITEM source (201 Created)'
  );

  // Test 7: Create assignment with PIPELINE_POINT source -> 201
  const res7 = await request(`${BASE_URL}/assignment/create`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({
      user_id: otherMember.id,
      project_id: project.id,
      source_type: 'PIPELINE_POINT',
      source_id: 303,
      title: 'Pipeline Point: Security Hardening',
      estimated_hrs: 12.0,
      start_date: '2026-11-05',
      end_date: '2026-11-06'
    })
  });
  assert(
    res7.status === 201 &&
    res7.data.assignment.source_type === 'PIPELINE_POINT',
    'Admin creates assignment with PIPELINE_POINT source (201 Created)'
  );

  // Test 8: Create assignment with MANUAL source -> 201
  const res8 = await request(`${BASE_URL}/assignment/create`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({
      user_id: memberUser.id,
      project_id: project.id,
      source_type: 'MANUAL',
      title: 'Manual Ad-hoc Investigation',
      estimated_hrs: 5.0,
      start_date: '2026-11-04',
      end_date: '2026-11-04'
    })
  });
  assert(
    res8.status === 201 &&
    res8.data.assignment.source_type === 'MANUAL',
    'Admin creates assignment with MANUAL source (201 Created)'
  );

  // Test 9: GET /assignments/:userId by Member for self -> 200
  const res9 = await request(`${BASE_URL}/assignments/${memberUser.id}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${memberToken}` }
  });
  assert(
    res9.status === 200 &&
    res9.data.assignments.length >= 3 &&
    res9.data.user_id === memberUser.id,
    'Member retrieves their own assignments list (200 OK)'
  );

  // Test 10: GET /assignments/:userId by Member for another user -> 403
  const res10 = await request(`${BASE_URL}/assignments/${otherMember.id}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${memberToken}` }
  });
  assert(res10.status === 403, 'Member cannot view other member assignments (403 Forbidden)');

  // Test 11: GET /assignments/:userId by Admin for any user -> 200
  const res11 = await request(`${BASE_URL}/assignments/${otherMember.id}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert(res11.status === 200 && res11.data.user_id === otherMember.id, 'Admin can view any member assignments (200 OK)');

  // Test 12: PATCH /assignment/:assignmentId by Admin -> update hours and status to COMPLETED
  const res12 = await request(`${BASE_URL}/assignment/${backlogAsgnId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({
      estimated_hrs: 18.0,
      status: 'COMPLETED'
    })
  });
  assert(
    res12.status === 200 &&
    res12.data.assignment.estimated_hrs === 18.0 &&
    res12.data.assignment.status === 'COMPLETED',
    'Admin updates assignment estimated_hrs to 18.0 and status to COMPLETED (200 OK)'
  );

  // Test 13: PATCH /assignment/:assignmentId by Member -> 403 Forbidden
  const res13 = await request(`${BASE_URL}/assignment/${backlogAsgnId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${memberToken}` },
    body: JSON.stringify({ estimated_hrs: 30.0 })
  });
  assert(res13.status === 403, 'Non-admin member cannot update assignment (403 Forbidden)');

  // Test 14: DELETE /assignment/:assignmentId by Member -> 403 Forbidden
  const res14 = await request(`${BASE_URL}/assignment/${backlogAsgnId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${memberToken}` }
  });
  assert(res14.status === 403, 'Non-admin member cannot delete assignment (403 Forbidden)');

  // Test 15: DELETE /assignment/:assignmentId by Admin -> 200
  const res15 = await request(`${BASE_URL}/assignment/${backlogAsgnId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  const deletedRow = queryOne('SELECT id FROM workload_assignments WHERE id = ?', [backlogAsgnId]);
  assert(res15.status === 200 && deletedRow === null, 'Admin deletes workload assignment (200 OK)');

  // -----------------------------------------------------------------
  // SECTION 2: MULTI-WEEK PRORATION ENGINE
  // -----------------------------------------------------------------
  console.log('\n--- SECTION 2: Multi-Week Proration Engine (Rule 7) ---');

  // Scenario A: 10-day assignment spanning 2 calendar weeks (40 total hours)
  // Start: Monday 2026-11-02. End: Wednesday 2026-11-11 (10 calendar days inclusive)
  // Week 1 (2026-11-02 to 2026-11-08): overlaps 7 days -> (7/10) * 40 = 28.00 hrs
  // Week 2 (2026-11-09 to 2026-11-15): overlaps 3 days -> (3/10) * 40 = 12.00 hrs
  // Week 3 (2026-11-16 to 2026-11-22): overlaps 0 days -> 0.00 hrs

  // Test 16: Week 1 proration (7/10 * 40 = 28.00 hrs)
  const p1 = workloadService.calculateProratedHours('2026-11-02', '2026-11-11', '2026-11-02', 40);
  assert(p1 === 28.0, 'Proration Week 1 (7/10 days): (7/10) * 40 = 28.00 hrs');

  // Test 17: Week 2 proration (3/10 * 40 = 12.00 hrs)
  const p2 = workloadService.calculateProratedHours('2026-11-02', '2026-11-11', '2026-11-09', 40);
  assert(p2 === 12.0, 'Proration Week 2 (3/10 days): (3/10) * 40 = 12.00 hrs');

  // Test 18: Conservation of hours check: Week 1 + Week 2 = Total estimated hours
  assert((p1 + p2) === 40.0, 'Conservation of hours: 28.00 + 12.00 = 40.00 hrs (100% accounted for)');

  // Test 19: Non-overlapping Week 3 proration (0 days = 0.00 hrs)
  const p3 = workloadService.calculateProratedHours('2026-11-02', '2026-11-11', '2026-11-16', 40);
  assert(p3 === 0.0, 'Proration Week 3 (0 days overlap) = 0.00 hrs');

  // Test 20: Single day assignment proration (1/1 * 8 = 8.00 hrs)
  const pSingle = workloadService.calculateProratedHours('2026-11-04', '2026-11-04', '2026-11-02', 8);
  assert(pSingle === 8.0, 'Single-day task within week contributes 100% (8.00 hrs)');

  // Test 21: HTTP endpoint POST /api/workload/prorate/calculate
  const res21 = await request(`${BASE_URL}/prorate/calculate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({
      start_date: '2026-11-02',
      end_date: '2026-11-11',
      week_start_date: '2026-11-02',
      estimated_hrs: 40
    })
  });
  assert(
    res21.status === 200 &&
    res21.data.prorated_week_hrs === 28.0,
    'HTTP POST /api/workload/prorate/calculate returns server-calculated 28.00 hrs'
  );

  // -----------------------------------------------------------------
  // SECTION 3: SYNC HOOKS & MEMBER WEEKLY WORKLOAD INTEGRATION
  // -----------------------------------------------------------------
  console.log('\n--- SECTION 3: Sync Hooks & Member Weekly Workload ---');

  // Test 22: syncAssignmentFromSource creates new record on first sync
  const syncCreate = workloadService.syncAssignmentFromSource({
    source_type: 'BACKLOG_ITEM',
    source_id: 888,
    user_id: memberUser.id,
    project_id: project.id,
    title: 'Synced Backlog Item',
    estimated_hrs: 10.0,
    start_date: '2026-11-02',
    end_date: '2026-11-06'
  }, adminUser);
  assert(
    syncCreate.assignment &&
    syncCreate.assignment.source_id === 888 &&
    syncCreate.assignment.title === 'Synced Backlog Item',
    'syncAssignmentFromSource creates new assignment on first sync'
  );

  // Test 23: syncAssignmentFromSource updates existing record on second sync with changed hours
  const syncUpdate = workloadService.syncAssignmentFromSource({
    source_type: 'BACKLOG_ITEM',
    source_id: 888,
    user_id: memberUser.id,
    project_id: project.id,
    title: 'Synced Backlog Item Updated',
    estimated_hrs: 16.0,
    start_date: '2026-11-02',
    end_date: '2026-11-06'
  }, adminUser);
  assert(
    syncUpdate.assignment &&
    syncUpdate.assignment.id === syncCreate.assignment.id &&
    syncUpdate.assignment.estimated_hrs === 16.0 &&
    syncUpdate.assignment.title === 'Synced Backlog Item Updated',
    'syncAssignmentFromSource idempotently updates existing assignment on subsequent sync'
  );

  // Test 24: GET /member/workload/:userId for memberUser in week 2026-11-02
  const res24 = await request(`${BASE_URL}/member/workload/${memberUser.id}?week_start_date=2026-11-02`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${memberToken}` }
  });
  assert(
    res24.status === 200 &&
    typeof res24.data.assigned_hours === 'number' &&
    typeof res24.data.utilization_pct === 'number' &&
    res24.data.assignments.length >= 1,
    'Member retrieves consolidated weekly workload breakdown with prorated hours'
  );

  // -----------------------------------------------------------------
  // SECTION 4: TEAM-WIDE UTILIZATION AGGREGATION
  // -----------------------------------------------------------------
  console.log('\n--- SECTION 4: Team-Wide Utilization Aggregation (GET /api/workload/team/:projectId) ---');

  // Test 25: Non-admin member trying to view team workload -> 403 Forbidden (Rule 11)
  const res25 = await request(`${BASE_URL}/team/${project.id}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${memberToken}` }
  });
  assert(res25.status === 403, 'Rule 11 Enforced: Non-admin member cannot view team workload (403 Forbidden)');

  // Test 26: Admin requesting team workload for invalid project -> 404
  const res26 = await request(`${BASE_URL}/team/non-existent-project-id`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert(res26.status === 404, 'Admin querying invalid project returns 404 Not Found');

  // Test 27: Admin requesting team workload for project -> 200 with summary and members
  const res27 = await request(`${BASE_URL}/team/${project.id}?week_start_date=2026-11-02`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  const teamData = res27.data;
  assert(
    res27.status === 200 &&
    teamData.project_id === project.id &&
    teamData.summary &&
    typeof teamData.summary.total_members === 'number' &&
    typeof teamData.summary.team_utilization_pct === 'number' &&
    Array.isArray(teamData.members),
    'Admin retrieves full team utilization aggregation with summary stats and member array'
  );

  // Test 28: Summary statistics consistency check
  const sum = teamData.summary;
  const countsSum = sum.overloaded_count + sum.optimal_count + sum.near_capacity_count + sum.underloaded_count;
  assert(
    countsSum === sum.total_members,
    `Summary badge counts sum (${countsSum}) matches total_members (${sum.total_members})`
  );

  // Test 29: Team utilization % is mathematically computed server-side
  const expectedTeamUtil = sum.total_available_hrs > 0
    ? Number(((sum.total_assigned_hrs / sum.total_available_hrs) * 100.0).toFixed(2))
    : 0.0;
  assert(
    sum.team_utilization_pct === expectedTeamUtil,
    `Team utilization % (${sum.team_utilization_pct}%) strictly matches server-side formula`
  );

  // -----------------------------------------------------------------
  // SECTION 5: AUTO-ALERT GENERATION ON ASSIGNMENT OVERLOAD
  // -----------------------------------------------------------------
  console.log('\n--- SECTION 5: Auto-Alert Generation on Assignment Overload ---');

  const alertTestWeek = '2028-02-07'; // Fresh future Monday
  // Acknowledge any existing alerts and clear assignments for test week
  execute("UPDATE workload_alerts SET acknowledged_at = datetime('now'), acknowledged_by = ? WHERE user_id = ? AND week_start_date = ?", [adminUser.id, memberUser.id, alertTestWeek]);
  execute('DELETE FROM workload_assignments WHERE user_id = ? AND start_date = ?', [memberUser.id, alertTestWeek]);

  // Test 30: Create massive assignment (55 hrs on 32-40 hrs capacity) -> utilization > 100% -> Auto-Alert OVERLOADED created
  const res30 = await request(`${BASE_URL}/assignment/create`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({
      user_id: memberUser.id,
      project_id: project.id,
      title: 'High Priority Overload Sprint Delivery',
      estimated_hrs: 55.0,
      start_date: alertTestWeek,
      end_date: '2028-02-11' // Friday of same week
    })
  });
  assert(res30.status === 201, 'Massive assignment (55 hrs) created successfully');

  // Test 31: Verify OVERLOADED alert automatically generated in workload_alerts
  const autoAlert = queryOne(`
    SELECT * FROM workload_alerts
    WHERE user_id = ? AND week_start_date = ? AND alert_type = 'OVERLOADED'
    ORDER BY id DESC LIMIT 1
  `, [memberUser.id, alertTestWeek]);
  assert(
    autoAlert !== null &&
    autoAlert.alert_type === 'OVERLOADED' &&
    autoAlert.assigned_hrs >= 55.0 &&
    autoAlert.utilization_pct > 100.0,
    `Auto-Alert verified in DB: ${autoAlert?.alert_type} (${autoAlert?.utilization_pct}%)`
  );

  // Test 32: Updating assignment down to 24 hrs reduces load and stops overload
  const res32 = await request(`${BASE_URL}/assignment/${res30.data.assignment.id}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({
      estimated_hrs: 24.0
    })
  });
  const workloadAfterPatch = workloadService.getMemberWeeklyWorkload(memberUser.id, alertTestWeek);
  assert(
    res32.status === 200 &&
    workloadAfterPatch.assigned_hours === 24.0 &&
    workloadAfterPatch.status === 'OPTIMAL',
    'Updating assignment reduces workload: assigned_hours = 24.0, status transitions to OPTIMAL'
  );

  // -----------------------------------------------------------------
  // SUMMARY RESULTS
  // -----------------------------------------------------------------
  console.log('\n===================================================================');
  console.log(`  PRD 21 LAYER 3 VERIFICATION SUMMARY:`);
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
