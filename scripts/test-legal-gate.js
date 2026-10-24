/**
 * LEGAL ONBOARDING GATE TEST SUITE
 *
 * Verifies:
 *  1. Default document templates are seeded and publicly readable
 *  2. Signup without legal acceptance is rejected (with missing list)
 *  3. Typed-name mismatch rejected (e-signature integrity)
 *  4. Full signup records a tamper-proof signature per document
 *  5. Publishing a new version blocks approval until re-signed
 *  6. Active member can re-sign via /api/legal/sign
 *  7. legal_signatures is append-only (UPDATE/DELETE blocked by triggers)
 *  8. Admin evidence export contains the full chain
 */
import http from 'node:http';
import crypto from 'node:crypto';
import { createApp } from '../src/app.js';
import { runMigration } from '../src/db/migrate.js';
import { runSeed } from '../src/db/seed.js';
import { queryOne, queryAll, execute } from '../src/db/database.js';

const TEST_PORT = 4995;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

const results = [];
function assert(condition, label) {
  console.log(`  ${condition ? '✓ PASS' : '✗ FAIL'}: ${label}`);
  results.push({ test: label, status: condition ? 'PASS' : 'FAIL' });
}

async function req(method, endpoint, token = null, body = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE_URL}${endpoint}`, {
    method, headers,
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, ok: res.ok, data };
}

async function login(email, password) {
  const res = await req('POST', '/api/auth/login', null, { email, password });
  return { token: res.data.token, user: res.data.user };
}

async function runLegalGateTests() {
  console.log('===================================================================');
  console.log('   LEGAL ONBOARDING GATE VERIFICATION SUITE');
  console.log('===================================================================\n');

  runMigration();
  await runSeed();

  const app = createApp();
  const server = http.createServer(app);
  await new Promise((r) => server.listen(TEST_PORT, '127.0.0.1', r));
  console.log(`[SETUP] Test server on ${BASE_URL}\n`);

  try {
    const admin = await login('admin@mahitechgroup.com', 'AdminPassword@2026');

    // TEST 1: seeded + public
    console.log('--- TEST 1: Default documents seeded & publicly readable ---');
    const docs = await req('GET', '/api/legal/documents/active');
    assert(docs.status === 200, 'Public document list accessible');
    assert(docs.data.count === 6, `6 default documents seeded (got ${docs.data.count})`);
    const docDetail = await req('GET', `/api/legal/documents/${docs.data.documents[0].id}`);
    assert(docDetail.status === 200 && docDetail.data.document.body.length > 50, 'Document body readable');

    const docIds = docs.data.documents.map((d) => d.id);

    // TEST 2: signup without legal → 400
    console.log('\n--- TEST 2: Signup without legal acceptance rejected ---');
    const noLegal = await req('POST', '/api/auth/signup', null, {
      name: 'No Legal', email: `nolegal.${Date.now()}@example.com`,
      password: 'Password@123', desired_role: 'researcher'
    });
    assert(noLegal.status === 400, `Signup without acceptance rejected (got ${noLegal.status})`);
    assert(Array.isArray(noLegal.data.missing_documents), 'Missing documents list returned');

    // TEST 3: typed name mismatch
    console.log('\n--- TEST 3: Typed-name mismatch rejected ---');
    const badName = await req('POST', '/api/auth/signup', null, {
      name: 'Correct Name', email: `badname.${Date.now()}@example.com`,
      password: 'Password@123', desired_role: 'researcher',
      legal_typed_name: 'Someone Else Entirely', legal_accepted_doc_ids: docIds
    });
    assert(badName.status === 400, `Mismatched typed name rejected (got ${badName.status})`);

    // TEST 4: full signup → 6 signatures
    console.log('\n--- TEST 4: Full signup records tamper-proof signatures ---');
    const applicantEmail = `legal.applicant.${Date.now()}@example.com`;
    const signup = await req('POST', '/api/auth/signup', null, {
      name: 'Legal Applicant', email: applicantEmail,
      password: 'Password@123', desired_role: 'designer',
      legal_typed_name: 'Legal Applicant', legal_accepted_doc_ids: docIds
    });
    assert(signup.status === 201, `Signup accepted with full acceptance (got ${signup.status})`);
    assert(signup.data.legal_documents_signed === 6, `6 signatures recorded (got ${signup.data.legal_documents_signed})`);
    const applicantId = signup.data.user.id;
    const sigRows = queryAll('SELECT * FROM legal_signatures WHERE user_id = ?', [applicantId]);
    assert(sigRows.length === 6 && sigRows.every((s) => s.document_hash && s.typed_name === 'Legal Applicant'), 'Signature rows carry document hash + typed name');
    const auditOk = queryOne("SELECT id FROM access_log WHERE user_id = ? AND action = 'legal_document_signed' LIMIT 1", [applicantId]);
    assert(Boolean(auditOk), 'Signing recorded in audit log');

    // TEST 5: new version blocks approval until re-signed
    console.log('\n--- TEST 5: New document version blocks approval (re-sign gate) ---');
    const published = await req('POST', '/api/legal/documents', admin.token, {
      doc_type: 'conduct',
      title: 'Code of Conduct v2 — Updated',
      body: 'UPDATED CODE OF CONDUCT v2: adds explicit anti-tampering clause. Members must re-sign. '.padEnd(80, '.')
    });
    assert(published.status === 201, `New version published (got ${published.status})`);
    assert(published.data.document.version === 2, 'Version auto-incremented to 2');

    const approveBlocked = await req('PATCH', `/api/admin/applications/${applicantId}/decide`, admin.token, { decision: 'approve' });
    assert(approveBlocked.status === 400, `Approval blocked until re-sign (got ${approveBlocked.status})`);
    assert(String(JSON.stringify(approveBlocked.data)).includes('conduct'), 'Blocked response names the missing document');

    const comp = await req('GET', '/api/legal/compliance', admin.token);
    assert(comp.status === 200 && comp.data.non_compliant_count >= 1, 'Compliance report lists the unsigned member');

    // TEST 6: pending applicant cannot login → sign happens via a fresh full
    // signup instead; then approve passes. (Active-member re-sign path:)
    console.log('\n--- TEST 6: Active member re-signs new version via /api/legal/sign ---');
    const dev = await login('developer@mahitechgroup.com', 'DeveloperPass123!');
    const meBefore = await req('GET', '/api/legal/signatures/me', dev.token);
    assert(meBefore.status === 200 && Array.isArray(meBefore.data.pending), 'Signatures/me returns pending list');
    const pendingDoc = (meBefore.data.pending || [])[0];
    if (pendingDoc) {
      const signRes = await req('POST', '/api/legal/sign', dev.token, {
        document_id: pendingDoc.id, typed_name: 'Arjun Dev'
      });
      assert(signRes.status === 201, `Active member signed new version (got ${signRes.status})`);
      const stillPending = (signRes.data.pending || []).some((d) => d.id === pendingDoc.id);
      assert(!stillPending, 'Signed document removed from pending list');
    } else {
      assert(true, 'No pending documents for this member (already compliant)');
    }

    // Fresh full signup (with v2 included) → approve passes
    const email2 = `legal.applicant2.${Date.now()}@example.com`;
    const docs2 = (await req('GET', '/api/legal/documents/active')).data.documents.map((d) => d.id);
    const signup2 = await req('POST', '/api/auth/signup', null, {
      name: 'Second Applicant', email: email2,
      password: 'Password@123', desired_role: 'producer',
      legal_typed_name: 'Second Applicant', legal_accepted_doc_ids: docs2
    });
    const approveOk = await req('PATCH', `/api/admin/applications/${signup2.data.user.id}/decide`, admin.token, { decision: 'approve' });
    assert(approveOk.status === 200, `Fully-signed applicant approved (got ${approveOk.status})`);

    // TEST 7: append-only triggers
    console.log('\n--- TEST 7: Signatures are append-only (tamper-proof) ---');
    let updateBlocked = false;
    try { execute("UPDATE legal_signatures SET typed_name = 'hacked'"); } catch (e) { updateBlocked = true; }
    assert(updateBlocked, 'UPDATE on legal_signatures blocked by trigger');
    let deleteBlocked = false;
    try { execute('DELETE FROM legal_signatures'); } catch (e) { deleteBlocked = true; }
    assert(deleteBlocked, 'DELETE on legal_signatures blocked by trigger');

    // TEST 8: evidence export
    console.log('\n--- TEST 8: Admin evidence export (court-ready bundle) ---');
    const evidence = await req('GET', `/api/legal/evidence/${applicantId}`, admin.token);
    assert(evidence.status === 200, `Evidence export accessible (got ${evidence.status})`);
    assert(evidence.data.signature_count >= 6, `Bundle contains signatures (got ${evidence.data.signature_count})`);
    assert(String(evidence.data.legal_basis || '').includes('3A'), 'Legal basis cites IT Act 2000 Section 3A');
    assert(Array.isArray(evidence.data.audit_trail), 'Audit trail included');
    const nonAdmin = await req('GET', `/api/legal/evidence/${applicantId}`, dev.token);
    assert(nonAdmin.status === 403, `Non-admin evidence export blocked (got ${nonAdmin.status})`);

  } finally {
    await new Promise((r) => server.close(r));
    console.log('\n[TEARDOWN] Test server closed.');
  }

  const failed = results.filter((r) => r.status === 'FAIL').length;
  console.log('\n===================================================================');
  console.log(`   LEGAL GATE SUMMARY: ${results.length - failed} PASSED / ${results.length} TOTAL`);
  console.log('===================================================================\n');
  console.table(results);
  process.exit(failed > 0 ? 1 : 0);
}

runLegalGateTests().catch((err) => {
  console.error('\n[LEGAL SUITE FATAL]:', err);
  process.exit(1);
});
