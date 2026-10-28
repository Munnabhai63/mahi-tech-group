/**
 * PRD 21 Layer 2 Comprehensive Verification Suite
 * Tests:
 * 1. Member capacity set/get service & routes (Admin+, member, append-only, validation)
 * 2. Member availability management (LEAVE/HOLIDAY/PARTIAL/TRAINING, future-date rules, approval workflow, access_log)
 * 3. Server-side utilization calculation formula: (allocated_hours / available_hours) * 100 with all status thresholds
 * 4. Overload (>100%) and underload (<30%) auto-alert generation in workload_alerts & deduplication
 * 5. Direct database trigger enforcement (append-only rules)
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
    VALUES (?, ?, ?, 'Test Suite', '127.0.0.1', datetime('now'), datetime('now', '+1 day'), 0)
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
  console.log('  STARTING PRD 21 LAYER 2 COMPREHENSIVE VERIFICATION SUITE');
  console.log('===================================================================\n');

  // Setup test users
  const adminUser = queryOne("SELECT id, name, email, role FROM users WHERE role = 'admin' LIMIT 1");
  const memberUser = queryOne("SELECT id, name, email, role FROM users WHERE role NOT IN ('admin', 'superadmin') LIMIT 1");
  const otherMember = queryOne("SELECT id, name, email, role FROM users WHERE id NOT IN (?, ?) LIMIT 1", [adminUser.id, memberUser.id]);

  console.log(`Test Context:`);
  console.log(`- Admin User: ${adminUser.name} (ID: ${adminUser.id}, Role: ${adminUser.role})`);
  console.log(`- Member User: ${memberUser.name} (ID: ${memberUser.id}, Role: ${memberUser.role})`);
  console.log(`- Other Member: ${otherMember.name} (ID: ${otherMember.id}, Role: ${otherMember.role})\n`);

  const adminToken = createToken(adminUser);
  const memberToken = createToken(memberUser);

  // -----------------------------------------------------------------
  // 1. CAPACITY SET / GET & APPEND-ONLY RULES
  // -----------------------------------------------------------------
  console.log('--- SECTION 1: Member Capacity Management (Admin+, Append-Only) ---');

  // Test 1: Non-admin trying to set capacity -> 403
  const res1 = await request(`${BASE_URL}/capacity/set`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${memberToken}` },
    body: JSON.stringify({ user_id: memberUser.id, weekly_capacity_hrs: 35, effective_from: '2026-11-01' })
  });
  assert(res1.status === 403, 'Non-admin member cannot set capacity (403 Forbidden)');

  // Test 2: Validation - missing user_id -> 400
  const res2 = await request(`${BASE_URL}/capacity/set`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ weekly_capacity_hrs: 40, effective_from: '2026-11-01' })
  });
  assert(res2.status === 400 && res2.data.error.includes('user_id'), 'Validation fails if user_id is missing (400)');

  // Test 3: Validation - invalid capacity (e.g. 0 or >168) -> 400
  const res3 = await request(`${BASE_URL}/capacity/set`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ user_id: memberUser.id, weekly_capacity_hrs: 200, effective_from: '2026-11-01' })
  });
  assert(res3.status === 400 && res3.data.error.includes('168'), 'Validation fails if capacity > 168 hrs (400)');

  // Test 4: Validation - invalid date format -> 400
  const res4 = await request(`${BASE_URL}/capacity/set`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ user_id: memberUser.id, weekly_capacity_hrs: 40, effective_from: 'invalid-date' })
  });
  assert(res4.status === 400 && res4.data.error.includes('YYYY-MM-DD'), 'Validation fails if date format is invalid (400)');

  // Test 5: Admin setting valid initial capacity (40 hrs) -> 201
  const res5 = await request(`${BASE_URL}/capacity/set`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ user_id: memberUser.id, weekly_capacity_hrs: 40, effective_from: '2026-10-01' })
  });
  assert(res5.status === 201 && res5.data.capacity.weekly_capacity_hrs === 40, 'Admin sets initial capacity 40 hrs (201 Created)');

  // Test 6: Append-only rule: Setting updated capacity (32 hrs) inserts a new row, preserves previous
  const res6 = await request(`${BASE_URL}/capacity/set`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ user_id: memberUser.id, weekly_capacity_hrs: 32, effective_from: '2026-11-01' })
  });
  assert(res6.status === 201 && res6.data.capacity.weekly_capacity_hrs === 32, 'Admin updates capacity to 32 hrs via new append row (201 Created)');

  // Test 7: Verify database trigger prevents direct UPDATE on member_capacity
  let updateBlocked = false;
  try {
    execute('UPDATE member_capacity SET weekly_capacity_hrs = 50 WHERE user_id = ?', [memberUser.id]);
  } catch (err) {
    updateBlocked = err.message.includes('append-only');
  }
  assert(updateBlocked, 'DB Trigger prevent_capacity_update blocks direct SQL UPDATE');

  // Test 8: Verify database trigger prevents direct DELETE on member_capacity
  let deleteBlocked = false;
  try {
    execute('DELETE FROM member_capacity WHERE user_id = ?', [memberUser.id]);
  } catch (err) {
    deleteBlocked = err.message.includes('append-only');
  }
  assert(deleteBlocked, 'DB Trigger prevent_capacity_delete blocks direct SQL DELETE');

  // Test 9: GET /capacity/:userId by Admin -> retrieves current capacity and history
  const res9 = await request(`${BASE_URL}/capacity/${memberUser.id}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert(
    res9.status === 200 &&
    res9.data.current_capacity.weekly_capacity_hrs === 32 &&
    res9.data.history.length >= 2,
    'Admin retrieves member current capacity (32 hrs) and full history list'
  );

  // Test 10: GET /capacity/:userId by member for self -> 200
  const res10 = await request(`${BASE_URL}/capacity/${memberUser.id}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${memberToken}` }
  });
  assert(res10.status === 200 && res10.data.current_capacity.weekly_capacity_hrs === 32, 'Member can view own capacity (200 OK)');

  // Test 11: GET /capacity/:userId by member for another user -> 403
  const res11 = await request(`${BASE_URL}/capacity/${otherMember.id}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${memberToken}` }
  });
  assert(res11.status === 403, 'Member cannot view another member capacity (403 Forbidden)');

  // -----------------------------------------------------------------
  // 2. AVAILABILITY MANAGEMENT (LEAVE, HOLIDAY, PARTIAL, TRAINING)
  // -----------------------------------------------------------------
  console.log('\n--- SECTION 2: Member Availability Management & Approvals ---');

  // Test 12: Member setting availability for past date -> 400
  const res12 = await request(`${BASE_URL}/availability/set`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${memberToken}` },
    body: JSON.stringify({
      user_id: memberUser.id,
      date: '2020-01-15',
      availability_type: 'LEAVE',
      available_hrs: 0,
      reason: 'Old leave'
    })
  });
  assert(res12.status === 400 && res12.data.error.includes('future dates'), 'Member cannot mark availability for past dates (400 Bad Request)');

  // Test 13: Member marking availability for other user -> 403
  const res13 = await request(`${BASE_URL}/availability/set`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${memberToken}` },
    body: JSON.stringify({
      user_id: otherMember.id,
      date: '2026-11-20',
      availability_type: 'LEAVE',
      available_hrs: 0,
      reason: 'Malicious leave'
    })
  });
  assert(res13.status === 403, 'Member cannot mark availability for other users (403 Forbidden)');

  // Test 14: Member submitting future LEAVE -> 201, approved_by is null
  const futureLeaveDate = '2026-11-16'; // Monday in future
  execute('DELETE FROM member_availability WHERE user_id = ? AND date = ?', [memberUser.id, futureLeaveDate]);
  const res14 = await request(`${BASE_URL}/availability/set`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${memberToken}` },
    body: JSON.stringify({
      user_id: memberUser.id,
      date: futureLeaveDate,
      availability_type: 'LEAVE',
      available_hrs: 0,
      reason: 'Medical appointment'
    })
  });
  const pendingLeaveId = res14.data?.availability?.id;
  assert(
    res14.status === 201 &&
    res14.data.availability.approved_by === null &&
    res14.data.availability.availability_type === 'LEAVE',
    'Member submits future LEAVE; approved_by is NULL awaiting admin approval'
  );

  // Test 15: Duplicate availability on same date -> 400
  const res15 = await request(`${BASE_URL}/availability/set`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${memberToken}` },
    body: JSON.stringify({
      user_id: memberUser.id,
      date: futureLeaveDate,
      availability_type: 'PARTIAL',
      available_hrs: 4,
      reason: 'Duplicate attempt'
    })
  });
  assert(res15.status === 400 && res15.data.error.includes('already exists'), 'Duplicate availability entry on same date is rejected (400)');

  // Test 16: Admin submitting HOLIDAY / TRAINING for member (any date) -> 201, auto-approved
  const trainingDate = '2026-11-17';
  execute('DELETE FROM member_availability WHERE user_id = ? AND date = ?', [memberUser.id, trainingDate]);
  const res16 = await request(`${BASE_URL}/availability/set`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({
      user_id: memberUser.id,
      date: trainingDate,
      availability_type: 'TRAINING',
      available_hrs: 4,
      reason: 'AWS Architecture Certification Workshop'
    })
  });
  assert(
    res16.status === 201 &&
    res16.data.availability.approved_by === adminUser.id &&
    res16.data.availability.availability_type === 'TRAINING',
    'Admin sets TRAINING entry with partial hours; auto-approved by admin'
  );

  // Test 17: Non-admin trying to approve leave -> 403
  const res17 = await request(`${BASE_URL}/availability/${pendingLeaveId}/approve`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${memberToken}` }
  });
  assert(res17.status === 403, 'Non-admin member cannot approve availability requests (403 Forbidden)');

  // Test 18: Admin approves member LEAVE -> 200, approved_by set and logged to access_log
  const res18 = await request(`${BASE_URL}/availability/${pendingLeaveId}/approve`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  const accessLog = queryOne(
    "SELECT * FROM access_log WHERE action = 'WORKLOAD_AVAILABILITY_APPROVED' AND resource = ? ORDER BY id DESC LIMIT 1",
    [`member_availability:${pendingLeaveId}`]
  );
  assert(
    res18.status === 200 &&
    res18.data.availability.approved_by === adminUser.id &&
    accessLog !== null,
    'Admin approves pending LEAVE; approved_by recorded and logged to access_log'
  );

  // Test 19: GET /availability/:userId by member -> 200
  const res19 = await request(`${BASE_URL}/availability/${memberUser.id}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${memberToken}` }
  });
  assert(
    res19.status === 200 &&
    Array.isArray(res19.data.availability) &&
    res19.data.availability.length >= 2,
    'Member retrieves their availability records (200 OK)'
  );

  // -----------------------------------------------------------------
  // 3. SERVER-SIDE UTILIZATION CALCULATION FORMULA
  // Formula: (allocated_hours ÷ available_hours) × 100
  // -----------------------------------------------------------------
  console.log('\n--- SECTION 3: Server-side Utilization Calculation Engine ---');

  // Test 20: Math formula: available = 40, allocated = 24 -> 60.00% (OPTIMAL)
  const math1 = workloadService.calculateUtilization(24, 40);
  assert(
    math1.utilization_pct === 60.0 && math1.status === 'OPTIMAL',
    'Formula: 24 allocated / 40 available = 60.00% (OPTIMAL)'
  );

  // Test 21: Math formula: available = 40, allocated = 38 -> 95.00% (NEAR_CAPACITY)
  const math2 = workloadService.calculateUtilization(38, 40);
  assert(
    math2.utilization_pct === 95.0 && math2.status === 'NEAR_CAPACITY',
    'Formula: 38 allocated / 40 available = 95.00% (NEAR_CAPACITY)'
  );

  // Test 22: Math formula: available = 40, allocated = 48 -> 120.00% (OVERLOADED)
  const math3 = workloadService.calculateUtilization(48, 40);
  assert(
    math3.utilization_pct === 120.0 && math3.status === 'OVERLOADED',
    'Formula: 48 allocated / 40 available = 120.00% (OVERLOADED)'
  );

  // Test 23: Math formula: available = 40, allocated = 10 -> 25.00% (UNDERLOADED)
  const math4 = workloadService.calculateUtilization(10, 40);
  assert(
    math4.utilization_pct === 25.0 && math4.status === 'UNDERLOADED',
    'Formula: 10 allocated / 40 available = 25.00% (UNDERLOADED)'
  );

  // Test 24: Weekly availability deduction:
  // Week starting 2026-11-16: capacity is 32 hrs (from earlier append test).
  // Member has 1 full day approved LEAVE (daily hrs = 32 / 5 = 6.4 hrs lost)
  // Plus 1 partial TRAINING day on 2026-11-17 with 4 hrs available (6.4 - 4 = 2.4 hrs lost)
  // Total lost = 6.4 + 2.4 = 8.8 hrs. Available = 32 - 8.8 = 23.2 hrs.
  const weekAvail = workloadService.calculateMemberWeeklyAvailability(memberUser.id, '2026-11-16');
  assert(
    weekAvail.weekly_capacity_hrs === 32.0 &&
    weekAvail.hours_lost === 8.8 &&
    weekAvail.available_hours === 23.2,
    `Weekly availability deductions: 32 cap - 8.8 lost = 23.2 available hours`
  );

  // Test 25: HTTP Endpoint POST /api/workload/utilization/calculate with user_id and week
  const res25 = await request(`${BASE_URL}/utilization/calculate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${memberToken}` },
    body: JSON.stringify({
      user_id: memberUser.id,
      week_start_date: '2026-11-16',
      allocated_hours: 23.2
    })
  });
  assert(
    res25.status === 200 &&
    res25.data.utilization_pct === 100.0 &&
    res25.data.status === 'NEAR_CAPACITY',
    'HTTP Utilization endpoint returns exact server-computed math: 23.2 / 23.2 = 100.00% (NEAR_CAPACITY)'
  );

  // Test 26: Zero available hours edge case (e.g. whole week off, 0 allocated)
  const mathZero = workloadService.calculateUtilization(0, 0);
  assert(
    mathZero.utilization_pct === 0.0 && mathZero.status === 'UNDERLOADED',
    'Edge case: 0 allocated / 0 available returns 0.00% (UNDERLOADED) safely without NaN'
  );

  // -----------------------------------------------------------------
  // 4. OVERLOAD (>100%) & UNDERLOAD (<30%) AUTO-ALERT GENERATION
  // -----------------------------------------------------------------
  console.log('\n--- SECTION 4: Overload & Underload Auto-Alert Generation ---');

  const testWeekDate = '2026-12-07'; // Future Monday
  execute('DELETE FROM workload_alerts WHERE user_id = ? AND week_start_date = ?', [memberUser.id, testWeekDate]);

  // Test 27: Overload scenario (>100%): 48 hrs on 32 cap -> 150% -> OVERLOADED alert created
  const alertOver = workloadService.evaluateAndCreateWorkloadAlert(memberUser.id, testWeekDate, 48, 32);
  assert(
    alertOver.alert_created === true &&
    alertOver.alert.alert_type === 'OVERLOADED' &&
    alertOver.alert.utilization_pct === 150.0,
    'Overload (>100%): 150.00% utilization triggers OVERLOADED alert in workload_alerts'
  );

  // Test 28: Duplicate alert check: Running again does NOT duplicate unacknowledged alert
  const alertDup = workloadService.evaluateAndCreateWorkloadAlert(memberUser.id, testWeekDate, 50, 32);
  assert(
    alertDup.alert_created === false &&
    alertDup.already_exists === true,
    'Deduplication: duplicate unacknowledged alert for same user and week is NOT duplicated'
  );

  // Test 29: Underload scenario (<30%): 8 hrs on 32 cap -> 25% -> UNDERLOADED alert created
  const testWeekDate2 = '2026-12-14';
  execute('DELETE FROM workload_alerts WHERE user_id = ? AND week_start_date = ?', [memberUser.id, testWeekDate2]);
  const alertUnder = workloadService.evaluateAndCreateWorkloadAlert(memberUser.id, testWeekDate2, 8, 32);
  assert(
    alertUnder.alert_created === true &&
    alertUnder.alert.alert_type === 'UNDERLOADED' &&
    alertUnder.alert.utilization_pct === 25.0,
    'Underload (<30%): 25.00% utilization triggers UNDERLOADED alert in workload_alerts'
  );

  // Test 30: Optimal scenario (50-85%): No alert created
  const testWeekDate3 = '2026-12-21';
  execute('DELETE FROM workload_alerts WHERE user_id = ? AND week_start_date = ?', [memberUser.id, testWeekDate3]);
  const alertNone = workloadService.evaluateAndCreateWorkloadAlert(memberUser.id, testWeekDate3, 22.4, 32);
  assert(
    alertNone.alert_created === false &&
    alertNone.utilization_pct === 70.0,
    'Optimal range (70.00%): No alert created in workload_alerts'
  );

  // Test 31: Admin listing active alerts via HTTP GET /api/workload/alerts
  const res31 = await request(`${BASE_URL}/alerts?unacknowledged=true`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert(
    res31.status === 200 &&
    Array.isArray(res31.data.alerts) &&
    res31.data.alerts.some(a => a.id === alertOver.alert.id),
    'Admin lists unacknowledged workload alerts (200 OK)'
  );

  // Test 32: Non-admin trying to view alerts -> 403
  const res32 = await request(`${BASE_URL}/alerts`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${memberToken}` }
  });
  assert(res32.status === 403, 'Non-admin member cannot view system workload alerts (403 Forbidden)');

  // Test 33: Admin acknowledging active alert via PATCH /api/workload/alert/:id/acknowledge
  const res33 = await request(`${BASE_URL}/alert/${alertOver.alert.id}/acknowledge`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert(
    res33.status === 200 &&
    res33.data.alert.acknowledged_by === adminUser.id &&
    res33.data.alert.acknowledged_at !== null,
    'Admin acknowledges alert; acknowledged_by & acknowledged_at recorded (200 OK)'
  );

  // Test 34: Trigger prevents DELETE on workload_alerts
  let alertDeleteBlocked = false;
  try {
    execute('DELETE FROM workload_alerts WHERE id = ?', [alertOver.alert.id]);
  } catch (err) {
    alertDeleteBlocked = err.message.includes('append-only');
  }
  assert(alertDeleteBlocked, 'DB Trigger prevent_workload_alert_delete blocks SQL DELETE on workload_alerts');

  // -----------------------------------------------------------------
  // SUMMARY RESULTS
  // -----------------------------------------------------------------
  console.log('\n===================================================================');
  console.log(`  PRD 21 LAYER 2 VERIFICATION SUMMARY:`);
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
