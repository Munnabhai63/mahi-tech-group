/**
 * Shared helper for test suites: attaches the legal gate acceptance payload
 * (typed-name e-signature + all active document ids) to a signup payload.
 */
export async function withLegalAcceptance(req, payload) {
  const res = await req('GET', '/api/legal/documents/active');
  const docIds = (res.data?.documents || []).map((d) => d.id);
  return {
    ...payload,
    legal_typed_name: payload.name,
    legal_accepted_doc_ids: docIds
  };
}
