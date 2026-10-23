/**
 * STEP 01 AMENDMENT: PUBLIC SIGNUP + ADMIN APPROVAL GATE TEST SUITE
 * 
 * Verifies all 8 testing requirements specified by the user:
 * 1. Signup with desired_role='designer' -> confirm status='pending', role=NULL in DB
 * 2. Attempt login while pending -> confirm HTTP 403 "Account Pending Approval", ZERO session/JWT created
 * 3. Admin views pending queue -> sees application with correct desired_role
 * 4. Admin approves with REASSIGNMENT to 'developer' -> confirm role='developer', desired_role='designer' preserved
 * 5. User logs in -> succeeds, receives developer JWT, developer role confirmed
 * 6. Separate test: new signup -> Admin REJECTS -> confirm status='rejected', login returns 403 "Application Denied"
 * 7. Duplicate email signup attempt blocked (HTTP 409), validation checks verified
 * 8. RBAC isolation: non-admin blocked from admin application endpoints (HTTP 403)
 */

import http from 'node:http';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app.js';
import { runMigration } from '../src/db/migrate.js';
import { runSeed } from '../src/db/seed.js';
import { queryOne, queryAll, execute } from '../src/db/database.js';
import { initWebSocketServer } from '../src/services/wsService.js';

const TEST_PORT = 4992;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

async function req(method, endpoint, token = null, body = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${BASE_URL}${endpoint}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });

  let data = null;
  const text = await res.text();
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }

  return { status: res.status, ok: res.ok, data };
}

async function runStep01AmendmentTests() {
  console.log('===================================================================');
  console.log('   STEP 01 AMENDMENT TEST SUITE: PUBLIC SIGNUP & ADMIN APPROVAL GATE');
  console.log('===================================================================\n');

  // 1. Database migration & baseline check
  console.log('[SETUP] Running database migrations...');
  runMigration();
  runSeed();

  const app = createApp();
  const server = http.createServer(app);
  const wss = initWebSocketServer(server);

  await new Promise((resolve) => server.listen(TEST_PORT, resolve));
  console.log(`[SETUP] Test server listening on ${BASE_URL}\n`);

  try {
    // Authenticate Admin account
    console.log('[STAGE 0] Authenticating Admin session...');
    const adminLoginRes = await req('POST', '/api/auth/login', null, {
      email: 'admin@mahitechgroup.com',
      password: 'AdminPassword@2026'
    });
    if (!adminLoginRes.ok) {
      throw new Error(`Admin login failed: ${adminLoginRes.status} ${JSON.stringify(adminLoginRes.data)}`);
    }
    const adminToken = adminLoginRes.data.token;
    const adminUser = adminLoginRes.data.user;
    console.log(`   ✓ Admin authenticated: ${adminUser.name} (${adminUser.id})\n`);

    // -------------------------------------------------------------------------
    // TEST 1: Public Signup with desired_role='designer'
    // -------------------------------------------------------------------------
    console.log('[TEST 1] Public Signup with desired_role="designer"...');
    const applicantEmail = `applicant.designer.${Date.now()}@example.com`;
    const applicantPass = 'SecurePass@2026';
    const signupPayload = {
      name: 'Elena Rostova',
      email: applicantEmail,
      phone_number: '+1-555-014-9988',
      password: applicantPass,
      desired_role: 'designer'
    };

    const signupRes = await req('POST', '/api/auth/signup', null, signupPayload);
    console.log(`   -> HTTP Status: ${signupRes.status}`);
    console.log(`   -> Response message: "${signupRes.data.message}"`);

    if (signupRes.status !== 201) {
      throw new Error(`Expected HTTP 201 Created, got ${signupRes.status}: ${JSON.stringify(signupRes.data)}`);
    }
    const receivedStatus = signupRes.data.status || signupRes.data.user?.status;
    if (receivedStatus !== 'pending') {
      throw new Error(`Expected response status='pending', got ${receivedStatus}`);
    }

    // Direct Database State Inspection
    const dbApplicant = queryOne('SELECT * FROM users WHERE email = ?', [applicantEmail]);
    if (!dbApplicant) throw new Error('Applicant record not found in users table');

    console.log('   ✓ Database record verification:');
    console.log(`     - id: ${dbApplicant.id}`);
    console.log(`     - status: '${dbApplicant.status}' (Must be 'pending')`);
    console.log(`     - role: ${dbApplicant.role} (Must be NULL/unset)`);
    console.log(`     - desired_role: '${dbApplicant.desired_role}' (Must be 'designer')`);
    console.log(`     - phone_number: '${dbApplicant.phone_number}'`);

    if (dbApplicant.status !== 'pending') throw new Error(`DB status mismatch: expected 'pending', got '${dbApplicant.status}'`);
    if (dbApplicant.role !== null) throw new Error(`DB role must be NULL for pending signup, got '${dbApplicant.role}'`);
    if (dbApplicant.desired_role !== 'designer') throw new Error(`DB desired_role mismatch: expected 'designer', got '${dbApplicant.desired_role}'`);
    if (dbApplicant.phone_number !== '+1-555-014-9988') throw new Error(`DB phone_number mismatch: got '${dbApplicant.phone_number}'`);
    console.log('   ✓ TEST 1 PASSED: Public signup created pending record with role=NULL and desired_role="designer"\n');

    // -------------------------------------------------------------------------
    // TEST 2: Attempt Login While Pending
    // -------------------------------------------------------------------------
    console.log('[TEST 2] Attempt Login while status="pending"...');
    const pendingLoginRes = await req('POST', '/api/auth/login', null, {
      email: applicantEmail,
      password: applicantPass
    });

    console.log(`   -> HTTP Status: ${pendingLoginRes.status}`);
    console.log(`   -> Error message: "${pendingLoginRes.data.error}"`);

    if (pendingLoginRes.status !== 403) {
      throw new Error(`Expected HTTP 403 Forbidden for pending user login, got ${pendingLoginRes.status}`);
    }
    if (!pendingLoginRes.data.error || !pendingLoginRes.data.error.includes('Account Pending Approval')) {
      throw new Error(`Expected error message to contain "Account Pending Approval", got "${pendingLoginRes.data.error}"`);
    }
    if (pendingLoginRes.data.token) {
      throw new Error('SECURITY VIOLATION: JWT was issued to a pending user!');
    }

    // Verify zero sessions created in database
    const sessionCount = queryOne('SELECT COUNT(*) as count FROM sessions WHERE user_id = ?', [dbApplicant.id])?.count || 0;
    console.log(`   ✓ Active session count in DB: ${sessionCount} (Must be 0)`);
    if (sessionCount !== 0) {
      throw new Error(`Security violation: ${sessionCount} sessions exist for pending user in DB!`);
    }
    console.log('   ✓ TEST 2 PASSED: Pending user login strictly blocked with HTTP 403 and zero session/JWT created\n');

    // -------------------------------------------------------------------------
    // TEST 3: Admin Views Pending Applications Queue
    // -------------------------------------------------------------------------
    console.log('[TEST 3] Admin views pending applications queue...');
    const pendingQueueRes = await req('GET', '/api/admin/applications/pending', adminToken);

    console.log(`   -> HTTP Status: ${pendingQueueRes.status}`);
    console.log(`   -> Pending applications count: ${pendingQueueRes.data.count}`);

    if (pendingQueueRes.status !== 200) {
      throw new Error(`Expected HTTP 200 from admin applications queue, got ${pendingQueueRes.status}`);
    }

    const applicationItem = pendingQueueRes.data.applications.find(a => a.id === dbApplicant.id);
    if (!applicationItem) {
      throw new Error(`Pending application for ${applicantEmail} not listed in admin queue!`);
    }

    console.log('   ✓ Pending item in queue:');
    console.log(`     - id: ${applicationItem.id}`);
    console.log(`     - name: ${applicationItem.name}`);
    console.log(`     - email: ${applicationItem.email}`);
    console.log(`     - phone_number: ${applicationItem.phone_number}`);
    console.log(`     - desired_role: ${applicationItem.desired_role}`);
    console.log(`     - status: ${applicationItem.status}`);

    if (applicationItem.desired_role !== 'designer') {
      throw new Error(`Expected desired_role 'designer', got '${applicationItem.desired_role}'`);
    }

    // RBAC check: Non-admin calling pending applications queue must get 403
    const researcherLogin = await req('POST', '/api/auth/login', null, {
      email: 'researcher@mahitechgroup.com',
      password: 'ResearcherPass123!'
    });
    const researcherToken = researcherLogin.data.token;
    const nonAdminRes = await req('GET', '/api/admin/applications/pending', researcherToken);
    console.log(`   -> Non-admin access attempt HTTP Status: ${nonAdminRes.status} (Must be 403)`);
    if (nonAdminRes.status !== 403) {
      throw new Error(`RBAC failure: non-admin received HTTP ${nonAdminRes.status} instead of 403`);
    }
    console.log('   ✓ TEST 3 PASSED: Admin sees pending application; non-admin blocked with HTTP 403\n');

    // -------------------------------------------------------------------------
    // TEST 4: Admin Approves with Role Reassignment (Requested 'designer' -> Assigned 'developer')
    // -------------------------------------------------------------------------
    console.log('[TEST 4] Admin approves with REASSIGNMENT to role="developer", sub_role="backend"...');
    const decisionRes = await req('PATCH', `/api/admin/applications/${dbApplicant.id}/decide`, adminToken, {
      decision: 'approve',
      finalRole: 'developer',
      finalSubRole: 'backend'
    });

    console.log(`   -> HTTP Status: ${decisionRes.status}`);
    console.log(`   -> Decision response: "${decisionRes.data.message}"`);

    if (decisionRes.status !== 200) {
      throw new Error(`Expected HTTP 200 on approval decision, got ${decisionRes.status}: ${JSON.stringify(decisionRes.data)}`);
    }

    // Inspect database post-decision
    const postApprovalUser = queryOne('SELECT * FROM users WHERE id = ?', [dbApplicant.id]);
    console.log('   ✓ Post-approval Database State:');
    console.log(`     - status: '${postApprovalUser.status}' (Must be 'active')`);
    console.log(`     - role: '${postApprovalUser.role}' (Must be 'developer')`);
    console.log(`     - sub_role: '${postApprovalUser.sub_role}' (Must be 'backend')`);
    console.log(`     - desired_role: '${postApprovalUser.desired_role}' (MUST STILL BE 'designer' - IMMUTABLE AUDIT)`);
    console.log(`     - approved_by: '${postApprovalUser.approved_by}' (Admin ID: ${adminUser.id})`);
    console.log(`     - approved_at: '${postApprovalUser.approved_at}'`);

    if (postApprovalUser.status !== 'active') throw new Error(`Expected status 'active', got '${postApprovalUser.status}'`);
    if (postApprovalUser.role !== 'developer') throw new Error(`Expected role 'developer', got '${postApprovalUser.role}'`);
    if (postApprovalUser.sub_role !== 'backend') throw new Error(`Expected sub_role 'backend', got '${postApprovalUser.sub_role}'`);
    if (postApprovalUser.desired_role !== 'designer') throw new Error(`AUDIT VIOLATION: desired_role was overwritten! Expected 'designer', got '${postApprovalUser.desired_role}'`);
    if (postApprovalUser.approved_by !== adminUser.id) throw new Error('approved_by does not match approving admin ID');

    // Verify access_log audit entry
    const auditLogs = queryAll("SELECT * FROM access_log WHERE action = 'application_approved' AND user_id = ? ORDER BY timestamp DESC LIMIT 1", [adminUser.id]);
    if (auditLogs.length === 0) throw new Error('No access_log entry recorded for application approval!');
    console.log(`   ✓ Audit log entry verified: "${auditLogs[0].resource}"`);

    console.log('   ✓ TEST 4 PASSED: Admin approved with reassigned role; original desired_role permanently preserved\n');

    // -------------------------------------------------------------------------
    // TEST 5: Newly Approved User Logs In -> Receives Developer Role JWT
    // -------------------------------------------------------------------------
    console.log('[TEST 5] Re-attempt user login post-approval...');
    const approvedLoginRes = await req('POST', '/api/auth/login', null, {
      email: applicantEmail,
      password: applicantPass
    });

    console.log(`   -> HTTP Status: ${approvedLoginRes.status}`);
    console.log(`   -> Login user role: "${approvedLoginRes.data.user?.role}"`);
    console.log(`   -> Login user sub_role: "${approvedLoginRes.data.user?.sub_role}"`);

    if (approvedLoginRes.status !== 200) {
      throw new Error(`Expected HTTP 200 for approved user login, got ${approvedLoginRes.status}`);
    }

    const issuedToken = approvedLoginRes.data.token;
    if (!issuedToken) throw new Error('No JWT token returned in approved login response');

    const decodedToken = jwt.decode(issuedToken);
    console.log(`   ✓ JWT Payload Verified:`);
    console.log(`     - userId: ${decodedToken.userId}`);
    console.log(`     - role: ${decodedToken.role} (Must be 'developer')`);
    console.log(`     - email: ${decodedToken.email}`);

    if (decodedToken.role !== 'developer') {
      throw new Error(`Expected JWT role 'developer', got '${decodedToken.role}'`);
    }

    // Verify session recorded in DB
    const activeSessions = queryAll('SELECT * FROM sessions WHERE user_id = ? AND is_revoked = 0', [dbApplicant.id]);
    console.log(`   ✓ Active sessions in DB: ${activeSessions.length} (Must be 1)`);
    if (activeSessions.length !== 1) throw new Error('Expected 1 active session in DB');

    console.log('   ✓ TEST 5 PASSED: Approved user logs in successfully, receives developer JWT, routes to Developer corner\n');

    // -------------------------------------------------------------------------
    // TEST 6: New Signup -> Admin Rejects -> 403 "Application Denied"
    // -------------------------------------------------------------------------
    console.log('[TEST 6] New signup and Admin REJECTION flow...');
    const rejectedEmail = `applicant.producer.${Date.now()}@example.com`;
    const rejectedPass = 'RejectPass@2026';

    const rejSignupRes = await req('POST', '/api/auth/signup', null, {
      name: 'Arthur Dent',
      email: rejectedEmail,
      password: rejectedPass,
      phone_number: '+44-20-7946-0912',
      desired_role: 'producer'
    });
    if (rejSignupRes.status !== 201) {
      throw new Error(`Signup failed for reject test: ${rejSignupRes.status}`);
    }
    const rejUser = queryOne('SELECT * FROM users WHERE email = ?', [rejectedEmail]);

    // Admin rejects application
    const rejectDecisionRes = await req('PATCH', `/api/admin/applications/${rejUser.id}/decide`, adminToken, {
      decision: 'reject'
    });
    console.log(`   -> Admin Reject Decision HTTP Status: ${rejectDecisionRes.status}`);
    console.log(`   -> Reject response: "${rejectDecisionRes.data.message}"`);

    if (rejectDecisionRes.status !== 200) {
      throw new Error(`Expected HTTP 200 on reject, got ${rejectDecisionRes.status}`);
    }

    // Inspect database post-rejection
    const postRejectUser = queryOne('SELECT * FROM users WHERE id = ?', [rejUser.id]);
    console.log('   ✓ Post-rejection Database State:');
    console.log(`     - status: '${postRejectUser.status}' (Must be 'rejected')`);
    console.log(`     - role: ${postRejectUser.role} (Must remain NULL)`);
    console.log(`     - desired_role: '${postRejectUser.desired_role}' (Must remain 'producer')`);
    console.log(`     - rejected_by: '${postRejectUser.rejected_by}'`);
    console.log(`     - rejected_at: '${postRejectUser.rejected_at}'`);

    if (postRejectUser.status !== 'rejected') throw new Error(`Expected status 'rejected', got '${postRejectUser.status}'`);
    if (postRejectUser.role !== null) throw new Error(`Rejected user role must remain NULL, got '${postRejectUser.role}'`);
    if (postRejectUser.desired_role !== 'producer') throw new Error(`desired_role must remain 'producer', got '${postRejectUser.desired_role}'`);
    if (!postRejectUser.rejected_at || postRejectUser.rejected_by !== adminUser.id) throw new Error('Rejection audit fields not properly set');

    // Rejected applicant attempts login
    const rejectedLoginRes = await req('POST', '/api/auth/login', null, {
      email: rejectedEmail,
      password: rejectedPass
    });
    console.log(`   -> Rejected user login HTTP Status: ${rejectedLoginRes.status}`);
    console.log(`   -> Error message: "${rejectedLoginRes.data.error}"`);

    if (rejectedLoginRes.status !== 403) {
      throw new Error(`Expected HTTP 403 Forbidden for rejected user login, got ${rejectedLoginRes.status}`);
    }
    if (!rejectedLoginRes.data.error || !rejectedLoginRes.data.error.includes('Application Denied')) {
      throw new Error(`Expected error to contain "Application Denied", got "${rejectedLoginRes.data.error}"`);
    }
    if (rejectedLoginRes.data.token) {
      throw new Error('SECURITY VIOLATION: JWT was issued to a rejected applicant!');
    }

    const rejSessionCount = queryOne('SELECT COUNT(*) as count FROM sessions WHERE user_id = ?', [rejUser.id])?.count || 0;
    console.log(`   ✓ Active sessions in DB for rejected applicant: ${rejSessionCount} (Must be 0)`);
    if (rejSessionCount !== 0) throw new Error('Active session exists for rejected applicant in DB');

    console.log('   ✓ TEST 6 PASSED: Rejected application correctly flagged; login returns HTTP 403 "Application Denied"\n');

    // -------------------------------------------------------------------------
    // TEST 7: Duplicate Email Signup & Validation Protections
    // -------------------------------------------------------------------------
    console.log('[TEST 7] Duplicate email signup and validation tests...');

    // Attempt signup with already registered email
    const duplicateRes = await req('POST', '/api/auth/signup', null, {
      name: 'Duplicate Applicant',
      email: applicantEmail, // already registered
      password: 'StrongPassword123!',
      desired_role: 'designer'
    });
    console.log(`   -> Duplicate email HTTP Status: ${duplicateRes.status}`);
    console.log(`   -> Duplicate email error: "${duplicateRes.data.error}"`);

    if (duplicateRes.status !== 409) {
      throw new Error(`Expected HTTP 409 Conflict for duplicate email, got ${duplicateRes.status}`);
    }

    // Weak password rejection
    const weakPassRes = await req('POST', '/api/auth/signup', null, {
      name: 'Weak Pass User',
      email: `weak.${Date.now()}@example.com`,
      password: '123',
      desired_role: 'developer'
    });
    console.log(`   -> Weak password HTTP Status: ${weakPassRes.status}`);
    if (weakPassRes.status !== 400) {
      throw new Error(`Expected HTTP 400 for password < 6 chars, got ${weakPassRes.status}`);
    }

    // Invalid desired_role rejection
    const invalidRoleRes = await req('POST', '/api/auth/signup', null, {
      name: 'Hacker Role User',
      email: `hacker.${Date.now()}@example.com`,
      password: 'StrongPassword123!',
      desired_role: 'admin' // public signup cannot request admin
    });
    console.log(`   -> Invalid desired_role HTTP Status: ${invalidRoleRes.status}`);
    if (invalidRoleRes.status !== 400) {
      throw new Error(`Expected HTTP 400 for invalid desired_role, got ${invalidRoleRes.status}`);
    }

    console.log('   ✓ TEST 7 PASSED: Duplicate email blocked with HTTP 409; weak passwords and invalid roles rejected\n');

    // -------------------------------------------------------------------------
    // TEST 8: Preserved Admin Member Addition Flow Verification
    // -------------------------------------------------------------------------
    console.log('[TEST 8] Verify existing POST /api/admin/members/add remains intact and functional...');
    const directMemberEmail = `direct.member.${Date.now()}@mahitechgroup.com`;
    const directAddRes = await req('POST', '/api/admin/members/add', adminToken, {
      name: 'Direct Onboarded Member',
      email: directMemberEmail,
      role: 'developer',
      sub_role: 'frontend'
    });

    console.log(`   -> Direct member add HTTP Status: ${directAddRes.status}`);
    console.log(`   -> Response message: "${directAddRes.data.message}"`);

    if (directAddRes.status !== 201) {
      throw new Error(`Direct member add failed: ${directAddRes.status} ${JSON.stringify(directAddRes.data)}`);
    }

    const directUser = queryOne('SELECT * FROM users WHERE email = ?', [directMemberEmail]);
    if (!directUser || directUser.status !== 'active' || directUser.role !== 'developer') {
      throw new Error('Directly added member record not properly created with active status and developer role');
    }
    console.log('   ✓ Direct member added with immediate active status, role="developer", bypassing pending gate.');
    console.log('   ✓ TEST 8 PASSED: Existing POST /api/admin/members/add flow completely intact and unaffected\n');

    console.log('===================================================================');
    console.log('   ALL 8 CHECKS OF STEP 01 AMENDMENT FULLY VERIFIED & PASSED');
    console.log('===================================================================');

  } finally {
    wss.close();
    await new Promise((resolve) => server.close(resolve));
    console.log('\n[TEARDOWN] Test server closed cleanly.');
  }
}

runStep01AmendmentTests().catch(err => {
  console.error('\n❌ STEP 01 AMENDMENT TEST SUITE FAILED:', err);
  process.exit(1);
});
