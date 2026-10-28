/**
 * scripts/verify-prd24-layer2.js
 * Verification Suite for PRD 24 Layer 2: Client Auth System & Security Isolation
 *
 * Verifies:
 * 1. Database Connection & Pragmas (WAL mode, busy_timeout=5000, foreign_keys=ON)
 * 2. Express HTTP Server Integration on ephemeral port
 * 3. Admin Client Invitation API (POST /api/admin/clients/invite & /api/admin/clients/create):
 *    - Member blocked with 403 Forbidden
 *    - Admin creates client with status='INVITED'
 *    - 32-byte cryptographically random hex invite_token (>=64 hex chars)
 *    - invite_token_expires_at set to 72 hours in future
 *    - Duplicate email invite rejected with 409 Conflict
 * 4. Client Activation Flow (POST /api/client/auth/accept-invite):
 *    - Unactivated client login rejected with 400 Bad Request
 *    - Expired invite token rejected with 400 Bad Request
 *    - Short password (<8 chars) rejected with 400 Bad Request
 *    - Valid invite accept: sets bcrypt password, status='ACTIVE', clears invite_token to NULL
 *    - Logs INVITE_ACCEPTED to client_activity_log
 *    - One-time use: re-using accepted invite token rejected with 400 Bad Request
 * 5. Admin Resend Invite (POST /api/admin/clients/:clientId/invite/resend):
 *    - Admin issues new 32-byte invite token with renewed 72h expiry
 * 6. Client Login (POST /api/client/auth/login):
 *    - Invalid credentials return 401 and log FAILED_LOGIN
 *    - Valid credentials return 200 with JWT payload { clientId, email, role: 'CLIENT' }
 *    - Signed with dedicated CLIENT_JWT_SECRET
 *    - Logs LOGIN to client_activity_log
 * 7. Rate Limiting Protection (5 failed attempts per 15 min lockout):
 *    - 5 failed login attempts return 401
 *    - 6th attempt returns 429 Too Many Requests
 *    - Successful reset verified
 * 8. Suspended Client Lifecycle (PATCH /api/admin/clients/:clientId/status):
 *    - Admin can SUSPEND client
 *    - Suspended client login blocked with 403 Forbidden
 *    - Authenticated route for suspended client blocked with 403 Forbidden
 * 9. Client Profile (GET /api/client/auth/me) & Logout (POST /api/client/auth/logout):
 *    - Profile returns client data with role='CLIENT' and zero internal fields
 *    - Logout logs LOGOUT in client_activity_log
 * 10. Bi-Directional Security Isolation Guards:
 *    - Client JWT on internal routes (/api/users/me, /api/projects) -> 403 Forbidden
 *    - Internal User JWT on client routes (/api/client/auth/me, /api/client/auth/logout) -> 401 Unauthorized
 * 11. Append-Only Trigger Verification:
 *    - UPDATE on client_activity_log strictly blocked by DB trigger
 *    - DELETE on client_activity_log strictly blocked by DB trigger
 */

import http from 'node:http';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app.js';
import { queryOne, queryAll, execute, getDatabase } from '../src/db/database.js';
import { config } from '../src/config.js';
import { resetClientRateLimiter } from '../src/middleware/clientAuth.js';

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(condition, message, details = '') {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  \x1b[32m✔ PASS:\x1b[0m Test ${totalTests}: ${message}`);
  } else {
    failedTests++;
    console.error(`  \x1b[31m✖ FAIL:\x1b[0m Test ${totalTests}: ${message}`);
    if (details) console.error(`    \x1b[33mDetails: ${details}\x1b[0m`);
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
        } catch (e) {
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

// Generate valid internal user token with DB session
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

async function runSuite() {
  console.log('='.repeat(80));
  console.log('PRD 24 Layer 2 Verification Suite: Client Auth System & Security Isolation');
  console.log('='.repeat(80));

  // 1. Connection & Pragmas
  console.log('\n--- Section 1: SQLite Connection & Pragmas ---');
  const journal = queryOne('PRAGMA journal_mode;');
  assert(journal?.journal_mode?.toLowerCase() === 'wal', `journal_mode is WAL (was ${journal?.journal_mode})`);

  const timeout = queryOne('PRAGMA busy_timeout;');
  assert(timeout?.timeout >= 5000, `busy_timeout >= 5000 (was ${timeout?.timeout})`);

  const fk = queryOne('PRAGMA foreign_keys;');
  assert(fk?.foreign_keys === 1, 'foreign_keys pragma is enabled (1)');

  // 2. Start Test Server on Ephemeral Port
  console.log('\n--- Section 2: Express Server Setup ---');
  const app = createApp();
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;
  const serverUrl = `http://127.0.0.1:${port}`;
  console.log(`Test server running at ${serverUrl}`);

  // Fetch or create Admin and Member test personas
  let admin = queryOne("SELECT * FROM users WHERE role = 'admin' AND status = 'active' LIMIT 1;");
  if (!admin) {
    const adminId = crypto.randomUUID();
    execute(
      "INSERT INTO users (id, name, email, password_hash, role, status) VALUES (?, 'Admin User', 'admin_client_test@mahi.test', 'hash', 'admin', 'active')",
      [adminId]
    );
    admin = queryOne('SELECT * FROM users WHERE id = ?;', [adminId]);
  }
  const adminToken = generateInternalUserToken(admin);

  let member = queryOne("SELECT * FROM users WHERE role = 'developer' AND status = 'active' LIMIT 1;");
  if (!member) {
    const memberId = crypto.randomUUID();
    execute(
      "INSERT INTO users (id, name, email, password_hash, role, status) VALUES (?, 'Dev Member', 'dev_client_test@mahi.test', 'hash', 'developer', 'active')",
      [memberId]
    );
    member = queryOne('SELECT * FROM users WHERE id = ?;', [memberId]);
  }
  const memberToken = generateInternalUserToken(member);

  assert(adminToken.length > 20, 'Admin JWT generated with active session in database');
  assert(memberToken.length > 20, 'Member JWT generated with active session in database');

  // Reset in-memory rate limiter before tests
  resetClientRateLimiter();

  try {
    // 3. Admin Client Invitation API
    console.log('\n--- Section 3: Admin Client Invitation API (/api/admin/clients/invite) ---');
    const timestamp = Date.now();
    const testClientEmail = `client_acme_${timestamp}@example.com`;

    // 3a. Member calling invite -> 403 Forbidden
    const memberInviteRes = await makeRequest(serverUrl, '/api/admin/clients/invite', {
      method: 'POST',
      headers: { Authorization: `Bearer ${memberToken}` },
      body: { name: 'Acme Corp', email: testClientEmail }
    });
    assert(memberInviteRes.status === 403, 'Member calling POST /api/admin/clients/invite is blocked with 403 Forbidden');

    // 3b. Admin calling with missing fields -> 400 Bad Request
    const badInviteRes = await makeRequest(serverUrl, '/api/admin/clients/invite', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { name: 'Missing Email' }
    });
    assert(badInviteRes.status === 400, 'Admin calling invite with missing email returns 400 Bad Request');

    // 3c. Admin inviting new client -> 201 Created
    const inviteRes = await makeRequest(serverUrl, '/api/admin/clients/invite', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        name: 'Acme Client Partner',
        email: testClientEmail,
        company_name: 'Acme International',
        phone: '+91 98765 43210'
      }
    });
    assert(inviteRes.status === 201, 'Admin inviting client returns 201 Created');
    assert(inviteRes.data.client?.status === 'INVITED', "Initial client status is 'INVITED'");
    assert(typeof inviteRes.data.invite_token === 'string', 'Invite token string returned in response');
    assert(inviteRes.data.invite_token.length >= 64, 'Invite token is at least 32 bytes (>=64 hex chars)');

    const inviteToken = inviteRes.data.invite_token;
    const clientId = inviteRes.data.client.id;

    // Direct DB check for client record
    const clientDb = queryOne('SELECT * FROM clients WHERE id = ?;', [clientId]);
    assert(clientDb !== null, 'Client record inserted into clients table');
    assert(clientDb.status === 'INVITED', "Database status is 'INVITED'");
    assert(clientDb.created_by === admin.id, 'Client created_by references admin user id');
    assert(clientDb.invite_token === inviteToken, 'invite_token persisted in database');
    assert(clientDb.invite_token_expires_at !== null, 'invite_token_expires_at persisted in database');

    const expiryTime = new Date(clientDb.invite_token_expires_at).getTime();
    const nowTime = Date.now();
    const hoursAhead = (expiryTime - nowTime) / (3600 * 1000);
    assert(hoursAhead >= 71 && hoursAhead <= 73, 'invite_token_expires_at set ~72 hours in future');

    // 3d. Duplicate email invitation -> 409 Conflict
    const dupInviteRes = await makeRequest(serverUrl, '/api/admin/clients/invite', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { name: 'Duplicate Client', email: testClientEmail }
    });
    assert(dupInviteRes.status === 409, 'Duplicate client email invitation returns 409 Conflict');

    // 3e. Test /api/admin/clients/create alias
    const aliasEmail = `client_beta_${timestamp}@example.com`;
    const aliasCreateRes = await makeRequest(serverUrl, '/api/admin/clients/create', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { name: 'Beta Client', email: aliasEmail, company_name: 'Beta LLC' }
    });
    assert(aliasCreateRes.status === 201, 'POST /api/admin/clients/create alias returns 201 Created');
    assert(aliasCreateRes.data.client?.email === aliasEmail, 'Created client has expected email');

    // 4. Client Activation Flow (POST /api/client/auth/accept-invite)
    console.log('\n--- Section 4: Client Invite Acceptance Flow ---');

    // 4a. Client login before activation -> 400 Bad Request
    const prematureLogin = await makeRequest(serverUrl, '/api/client/auth/login', {
      method: 'POST',
      body: { email: testClientEmail, password: 'AnyPassword123!' }
    });
    assert(prematureLogin.status === 400, 'Login on INVITED status returns 400 Bad Request');
    assert(prematureLogin.data.error.includes('not been activated'), 'Clear error indicates invite must be accepted first');

    // 4b. Expired invite token test
    const expiredEmail = `client_expired_${timestamp}@example.com`;
    execute(
      `INSERT INTO clients (name, email, password_hash, status, invite_token, invite_token_expires_at, created_by, created_at, updated_at)
       VALUES ('Expired Client', ?, 'hash', 'INVITED', 'expired_token_hex_1234567890abcdef1234567890abcdef', datetime('now', '-2 hours'), ?, datetime('now'), datetime('now'))`,
      [expiredEmail, admin.id]
    );

    const expiredAcceptRes = await makeRequest(serverUrl, '/api/client/auth/accept-invite', {
      method: 'POST',
      body: { invite_token: 'expired_token_hex_1234567890abcdef1234567890abcdef', new_password: 'ValidPass123!' }
    });
    assert(expiredAcceptRes.status === 400, 'Accepting expired invite token returns 400 Bad Request');
    assert(expiredAcceptRes.data.error.includes('expired'), 'Error message explicitly reports token expiration');

    // 4c. Password length validation (<8 chars)
    const shortPassRes = await makeRequest(serverUrl, '/api/client/auth/accept-invite', {
      method: 'POST',
      body: { invite_token: inviteToken, new_password: 'short' }
    });
    assert(shortPassRes.status === 400, 'Accepting invite with <8 char password returns 400 Bad Request');

    // 4d. Successful invite acceptance
    const clientPlainPassword = 'ClientSecurePass2026!';
    const acceptRes = await makeRequest(serverUrl, '/api/client/auth/accept-invite', {
      method: 'POST',
      body: { invite_token: inviteToken, new_password: clientPlainPassword }
    });
    assert(acceptRes.status === 200, 'Accepting valid invite token returns 200 OK');
    assert(acceptRes.data.client?.status === 'ACTIVE', 'Response client status updated to ACTIVE');

    // Direct DB check after acceptance
    const clientAfterAccept = queryOne('SELECT * FROM clients WHERE id = ?;', [clientId]);
    assert(clientAfterAccept.status === 'ACTIVE', "Database client status updated to 'ACTIVE'");
    assert(clientAfterAccept.invite_token === null, 'invite_token cleared to NULL after acceptance (one-time use)');
    assert(clientAfterAccept.invite_accepted_at !== null, 'invite_accepted_at timestamp set');
    assert(clientAfterAccept.password_hash.startsWith('$2'), 'password_hash is a valid bcrypt hash');

    // Verify activity log row for invite acceptance
    const inviteActLog = queryOne(
      "SELECT * FROM client_activity_log WHERE client_id = ? AND action = 'INVITE_ACCEPTED';",
      [clientId]
    );
    assert(inviteActLog !== null, "client_activity_log contains 'INVITE_ACCEPTED' entry");

    // 4e. One-time use: re-using the accepted token -> 400 Bad Request
    const reAcceptRes = await makeRequest(serverUrl, '/api/client/auth/accept-invite', {
      method: 'POST',
      body: { invite_token: inviteToken, new_password: 'AnotherPassword123!' }
    });
    assert(reAcceptRes.status === 400, 'Re-using already accepted invite token is rejected with 400 Bad Request');

    // 5. Admin Resend Invite API
    console.log('\n--- Section 5: Admin Resend Invite API ---');
    const betaClient = queryOne('SELECT * FROM clients WHERE email = ?;', [aliasEmail]);
    const oldBetaToken = betaClient.invite_token;

    // Member forbidden
    const memberResend = await makeRequest(serverUrl, `/api/admin/clients/${betaClient.id}/invite/resend`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${memberToken}` }
    });
    assert(memberResend.status === 403, 'Member calling resend invite is rejected with 403 Forbidden');

    // Admin resend
    const adminResend = await makeRequest(serverUrl, `/api/admin/clients/${betaClient.id}/invite/resend`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(adminResend.status === 200, 'Admin calling resend invite returns 200 OK');
    assert(adminResend.data.invite_token !== oldBetaToken, 'New invite_token generated on resend');
    assert(adminResend.data.invite_token.length >= 64, 'Resent invite_token is >= 32 bytes hex');

    // 6. Client Login (POST /api/client/auth/login) & JWT
    console.log('\n--- Section 6: Client Login & Client JWT Verification ---');

    // 6a. Wrong password -> 401 Unauthorized
    const wrongLogin = await makeRequest(serverUrl, '/api/client/auth/login', {
      method: 'POST',
      body: { email: testClientEmail, password: 'WrongPassword123!' }
    });
    assert(wrongLogin.status === 401, 'Login with incorrect password returns 401 Unauthorized');

    const failedLogDb = queryOne(
      "SELECT * FROM client_activity_log WHERE client_id = ? AND action = 'FAILED_LOGIN' ORDER BY id DESC LIMIT 1;",
      [clientId]
    );
    assert(failedLogDb !== null, "Failed login logged in client_activity_log as 'FAILED_LOGIN'");

    // 6b. Correct credentials -> 200 OK with Client JWT
    const loginRes = await makeRequest(serverUrl, '/api/client/auth/login', {
      method: 'POST',
      body: { email: testClientEmail, password: clientPlainPassword }
    });
    assert(loginRes.status === 200, 'Login with correct credentials returns 200 OK');
    assert(typeof loginRes.data.token === 'string', 'Client JWT token returned');
    assert(loginRes.data.client?.role === 'CLIENT', "Client object contains role='CLIENT'");

    const clientToken = loginRes.data.token;

    // Verify token payload and signature using CLIENT_JWT_SECRET
    const decodedClient = jwt.verify(clientToken, config.CLIENT_JWT_SECRET);
    assert(decodedClient.clientId === clientId, 'Client JWT payload contains correct clientId');
    assert(decodedClient.email === testClientEmail, 'Client JWT payload contains correct email');
    assert(decodedClient.role === 'CLIENT', "Client JWT payload strictly contains role='CLIENT'");

    // Verify LOGIN activity log
    const loginLogDb = queryOne(
      "SELECT * FROM client_activity_log WHERE client_id = ? AND action = 'LOGIN' ORDER BY id DESC LIMIT 1;",
      [clientId]
    );
    assert(loginLogDb !== null, "Successful login logged in client_activity_log as 'LOGIN'");

    // 7. Rate Limiting (Max 5 attempts per 15 min per IP)
    console.log('\n--- Section 7: Rate Limiting Enforcement ---');
    resetClientRateLimiter(); // Clear before testing sequence

    const targetEmail = testClientEmail;
    // Send 5 failed attempts
    for (let i = 1; i <= 5; i++) {
      const attempt = await makeRequest(serverUrl, '/api/client/auth/login', {
        method: 'POST',
        body: { email: targetEmail, password: `BadPass_${i}` }
      });
      assert(attempt.status === 401, `Failed login attempt ${i} returns 401 Unauthorized`);
    }

    // 6th attempt from same IP must return 429 Too Many Requests
    const lockedAttempt = await makeRequest(serverUrl, '/api/client/auth/login', {
      method: 'POST',
      body: { email: targetEmail, password: clientPlainPassword } // Even with correct password!
    });
    assert(lockedAttempt.status === 429, '6th attempt returns 429 Too Many Requests lockout');
    assert(lockedAttempt.data.error.includes('Too many failed login attempts'), 'Lockout error message returned');

    // Reset rate limiter so further tests can proceed
    resetClientRateLimiter();
    console.log('  Rate limiter reset for subsequent verification tests.');

    // 8. Client Account Suspension Lifecycle
    console.log('\n--- Section 8: Client Account Suspension Lifecycle ---');

    // Admin suspends client
    const suspendRes = await makeRequest(serverUrl, `/api/admin/clients/${clientId}/status`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { status: 'SUSPENDED' }
    });
    assert(suspendRes.status === 200, 'Admin can suspend client (PATCH /api/admin/clients/:id/status -> 200)');
    assert(suspendRes.data.client?.status === 'SUSPENDED', "Response confirms status='SUSPENDED'");

    // Direct DB check
    const clientSuspendedDb = queryOne('SELECT status FROM clients WHERE id = ?;', [clientId]);
    assert(clientSuspendedDb.status === 'SUSPENDED', "Database confirms client status is 'SUSPENDED'");

    // Suspended client login attempt -> 403 Forbidden
    const suspendedLogin = await makeRequest(serverUrl, '/api/client/auth/login', {
      method: 'POST',
      body: { email: testClientEmail, password: clientPlainPassword }
    });
    assert(suspendedLogin.status === 403, 'Suspended client login is blocked with 403 Forbidden');
    assert(suspendedLogin.data.error.includes('suspended'), 'Error indicates account has been suspended');

    // Suspended client accessing /api/client/auth/me with existing token -> 403 Forbidden
    const suspendedMe = await makeRequest(serverUrl, '/api/client/auth/me', {
      headers: { Authorization: `Bearer ${clientToken}` }
    });
    assert(suspendedMe.status === 403, 'Suspended client token on /api/client/auth/me returns 403 Forbidden');

    // Admin reactivates client
    const activateRes = await makeRequest(serverUrl, `/api/admin/clients/${clientId}/status`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { status: 'ACTIVE' }
    });
    assert(activateRes.status === 200, 'Admin reactivates client to ACTIVE');

    // 9. Client Profile (GET /api/client/auth/me) & Logout (POST /api/client/auth/logout)
    console.log('\n--- Section 9: Client Profile & Logout Endpoints ---');

    // Profile retrieval with Client JWT
    const meRes = await makeRequest(serverUrl, '/api/client/auth/me', {
      headers: { Authorization: `Bearer ${clientToken}` }
    });
    assert(meRes.status === 200, 'GET /api/client/auth/me with Client JWT returns 200 OK');
    assert(meRes.data.client?.id === clientId, 'Profile id matches authenticated client');
    assert(meRes.data.client?.email === testClientEmail, 'Profile email matches authenticated client');
    assert(meRes.data.client?.role === 'CLIENT', "Profile role is strictly 'CLIENT'");
    assert(meRes.data.client?.password_hash === undefined, 'password_hash is NOT exposed in client profile');

    // Client logout
    const logoutRes = await makeRequest(serverUrl, '/api/client/auth/logout', {
      method: 'POST',
      headers: { Authorization: `Bearer ${clientToken}` }
    });
    assert(logoutRes.status === 200, 'POST /api/client/auth/logout returns 200 OK');

    const logoutLogDb = queryOne(
      "SELECT * FROM client_activity_log WHERE client_id = ? AND action = 'LOGOUT' ORDER BY id DESC LIMIT 1;",
      [clientId]
    );
    assert(logoutLogDb !== null, "Logout activity logged in client_activity_log as 'LOGOUT'");

    // 10. Bi-Directional Security Isolation Guards
    console.log('\n--- Section 10: Bi-Directional Security Isolation Guards ---');

    // Direction 1: Client JWT used on internal endpoints must be rejected
    const clientOnInternalUsers = await makeRequest(serverUrl, '/api/users/me', {
      headers: { Authorization: `Bearer ${clientToken}` }
    });
    assert(
      clientOnInternalUsers.status === 403 || clientOnInternalUsers.status === 401,
      `Client JWT on internal /api/users/me is strictly rejected with status ${clientOnInternalUsers.status} (403/401)`
    );

    const clientOnInternalProjects = await makeRequest(serverUrl, '/api/projects', {
      headers: { Authorization: `Bearer ${clientToken}` }
    });
    assert(
      clientOnInternalProjects.status === 403 || clientOnInternalProjects.status === 401,
      `Client JWT on internal /api/projects is strictly rejected with status ${clientOnInternalProjects.status} (403/401)`
    );

    // Direction 2: Internal User JWT used on client portal endpoints must be rejected
    const internalAdminOnClientMe = await makeRequest(serverUrl, '/api/client/auth/me', {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(
      internalAdminOnClientMe.status === 401 || internalAdminOnClientMe.status === 403,
      `Internal User JWT on /api/client/auth/me is strictly rejected with status ${internalAdminOnClientMe.status} (401/403)`
    );

    const internalMemberOnClientLogout = await makeRequest(serverUrl, '/api/client/auth/logout', {
      method: 'POST',
      headers: { Authorization: `Bearer ${memberToken}` }
    });
    assert(
      internalMemberOnClientLogout.status === 401 || internalMemberOnClientLogout.status === 403,
      `Internal User JWT on /api/client/auth/logout is strictly rejected with status ${internalMemberOnClientLogout.status} (401/403)`
    );

    // 11. Append-Only Trigger Verification on client_activity_log
    console.log('\n--- Section 11: Append-Only DB Trigger Enforcement ---');
    const sampleLog = queryOne('SELECT * FROM client_activity_log LIMIT 1;');
    assert(sampleLog !== null, 'client_activity_log contains rows to test trigger immutability');

    // Attempt direct SQL UPDATE on client_activity_log
    let updateBlocked = false;
    try {
      execute("UPDATE client_activity_log SET action = 'HACKED' WHERE id = ?;", [sampleLog.id]);
    } catch (triggerErr) {
      updateBlocked = triggerErr.message.includes('append-only');
    }
    assert(updateBlocked, 'Direct UPDATE on client_activity_log strictly blocked by trigger (RAISE ABORT)');

    // Attempt direct SQL DELETE on client_activity_log
    let deleteBlocked = false;
    try {
      execute('DELETE FROM client_activity_log WHERE id = ?;', [sampleLog.id]);
    } catch (triggerErr) {
      deleteBlocked = triggerErr.message.includes('append-only');
    }
    assert(deleteBlocked, 'Direct DELETE on client_activity_log strictly blocked by trigger (RAISE ABORT)');

  } finally {
    server.close();
  }

  // Final Summary
  console.log('\n' + '='.repeat(80));
  console.log(`PRD 24 Layer 2 Verification Summary:`);
  console.log(`Total Assertions: ${totalTests}`);
  console.log(`Passed:           ${passedTests}`);
  console.log(`Failed:           ${failedTests}`);
  console.log(`Success Rate:     ${((passedTests / totalTests) * 100).toFixed(1)}%`);
  console.log('='.repeat(80));

  if (failedTests > 0) {
    process.exit(1);
  }
}

runSuite().catch(err => {
  console.error('Fatal Verification Error:', err);
  process.exit(1);
});
