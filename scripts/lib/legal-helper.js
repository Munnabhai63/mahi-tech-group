/**
 * Shared helper for test suites: attaches the legal gate acceptance payload
 * (typed-name e-signature + all active document ids) to a signup payload,
 * and verifies the applicant email via the token stored in the local DB.
 */
import { queryOne } from '../../src/db/database.js';

export async function withLegalAcceptance(req, payload) {
  const res = await req('GET', '/api/legal/documents/active');
  const docIds = (res.data?.documents || []).map((d) => d.id);
  return {
    ...payload,
    legal_typed_name: payload.name,
    legal_accepted_doc_ids: docIds
  };
}

/**
 * Verifies the applicant's email using the verification token stored in the
 * local test database (dev/test only — suites run against the local server).
 */
export async function verifyEmailFor(req, userId) {
  const row = queryOne(
    "SELECT token FROM email_verifications WHERE user_id = ? AND verified_at IS NULL ORDER BY created_at DESC LIMIT 1",
    [userId]
  );
  if (!row) return { ok: true, alreadyVerified: true };
  const res = await req('GET', '/api/auth/verify-email?token=' + row.token);
  return { ok: res.status === 200, alreadyVerified: false };
}
