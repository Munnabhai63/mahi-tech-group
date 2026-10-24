import crypto from 'node:crypto';
import { queryOne, queryAll, execute } from '../db/database.js';
import { logAccess } from './auditService.js';

/**
 * LEGAL ONBOARDING GATE
 *
 * Members must electronically sign every active legal document (T&C, Privacy
 * Policy per DPDP Act 2023, NDA, IP Assignment, Liability/Indemnity, Code of
 * Conduct) before the Admin can approve their application. Electronic
 * signatures are legally valid in India under IT Act 2000 Section 3A.
 *
 * Evidence chain per signature: exact document content hash + typed name +
 * IP address + timestamp, stored in an append-only table guarded by SQLite
 * triggers. DOCUMENT TEMPLATES SHIPPED HERE ARE STARTING DRAFTS — have a
 * qualified lawyer review them before real-world enforcement.
 */

export const LEGAL_DOC_TYPES = ['terms', 'privacy', 'nda', 'ip_assignment', 'liability', 'conduct'];

function hashDocument(body) {
  return crypto.createHash('sha256').update(String(body)).digest('hex');
}

/**
 * All currently active documents (what every member must have signed).
 */
export function getActiveDocuments() {
  return queryAll(`
    SELECT id, doc_type, version, title, content_hash, created_at
    FROM legal_documents
    WHERE is_active = 1
    ORDER BY CASE doc_type
      WHEN 'terms' THEN 1 WHEN 'privacy' THEN 2 WHEN 'nda' THEN 3
      WHEN 'ip_assignment' THEN 4 WHEN 'liability' THEN 5 ELSE 6 END, version DESC
  `);
}

export function getDocumentById(docId, withBody = false) {
  const cols = withBody ? '*' : 'id, doc_type, version, title, content_hash, is_active, created_at';
  return queryOne(`SELECT ${cols} FROM legal_documents WHERE id = ?`, [docId]);
}

/**
 * Publishes a new version of a document (older versions auto-deactivated).
 */
export function publishDocumentVersion({ doc_type, title, body, adminId, ipAddress = null }) {
  if (!LEGAL_DOC_TYPES.includes(doc_type)) {
    const err = new Error(`Invalid doc_type. Must be one of: ${LEGAL_DOC_TYPES.join(', ')}`);
    err.status = 400;
    throw err;
  }
  if (!title || !body || String(body).trim().length < 50) {
    const err = new Error('Title and a substantive body (min 50 chars) are required');
    err.status = 400;
    throw err;
  }

  const latest = queryOne(
    'SELECT MAX(version) as v FROM legal_documents WHERE doc_type = ?',
    [doc_type]
  );
  const nextVersion = (latest?.v || 0) + 1;
  const docId = crypto.randomUUID();
  const contentHash = hashDocument(body);

  // One command sequence: deactivate previous versions, insert the new one
  execute('UPDATE legal_documents SET is_active = 0 WHERE doc_type = ?', [doc_type]);
  execute(`
    INSERT INTO legal_documents (id, doc_type, version, title, body, content_hash, is_active, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?, CURRENT_TIMESTAMP)
  `, [docId, doc_type, nextVersion, title.trim(), String(body), contentHash, adminId]);

  logAccess({
    userId: adminId,
    action: 'legal_document_published',
    resource: `/api/legal/documents (${doc_type} v${nextVersion}, sha256:${contentHash.slice(0, 16)}…)`,
    ipAddress
  });

  return getDocumentById(docId, false);
}

/**
 * Records a member's electronic signature against one document.
 * Idempotent per (user, document) pair.
 */
export function signDocument({ documentId, userId, typedName, ipAddress = null }) {
  const doc = getDocumentById(documentId, true);
  if (!doc || !doc.is_active) {
    const err = new Error('Document not found or no longer active');
    err.status = 404;
    throw err;
  }

  const user = queryOne('SELECT name FROM users WHERE id = ?', [userId]);
  const expected = (user?.name || '').trim().toLowerCase();
  const typed = String(typedName || '').trim().toLowerCase();
  if (!typed || typed !== expected) {
    const err = new Error('Typed name must exactly match your registered full name (legal e-signature requirement)');
    err.status = 400;
    throw err;
  }

  const existing = queryOne(
    'SELECT id FROM legal_signatures WHERE document_id = ? AND user_id = ?',
    [documentId, userId]
  );
  if (existing) {
    return { signature: existing, alreadySigned: true };
  }

  const sigId = crypto.randomUUID();
  execute(`
    INSERT INTO legal_signatures (id, document_id, user_id, document_version, document_hash, typed_name, ip_address, signed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `, [sigId, documentId, userId, doc.version, doc.content_hash, String(typedName).trim(), ipAddress || null]);

  logAccess({
    userId,
    action: 'legal_document_signed',
    resource: `/api/legal/documents/${documentId} (${doc.doc_type} v${doc.version}, sha256:${doc.content_hash.slice(0, 16)}…)`,
    ipAddress
  });

  return { signature: queryOne('SELECT * FROM legal_signatures WHERE id = ?', [sigId]), alreadySigned: false };
}

/**
 * Which active documents has this user NOT signed yet?
 */
export function getUnsignedDocuments(userId) {
  return queryAll(`
    SELECT d.id, d.doc_type, d.version, d.title
    FROM legal_documents d
    WHERE d.is_active = 1
      AND NOT EXISTS (
        SELECT 1 FROM legal_signatures s
        WHERE s.document_id = d.id AND s.user_id = ?
      )
  `, [userId]);
}

export function hasSignedAllActiveDocuments(userId) {
  return getUnsignedDocuments(userId).length === 0;
}

export function getUserSignatures(userId) {
  return queryAll(`
    SELECT s.*, d.doc_type, d.title
    FROM legal_signatures s
    JOIN legal_documents d ON s.document_id = d.id
    WHERE s.user_id = ?
    ORDER BY s.signed_at DESC
  `, [userId]);
}

/**
 * Court-ready evidence bundle: every signature with the exact document
 * hash chain and audit trail references for one user.
 */
export function exportLegalEvidence(userId, adminId, ipAddress = null) {
  const user = queryOne('SELECT id, name, email, role, status, created_at FROM users WHERE id = ?', [userId]);
  if (!user) {
    const err = new Error('User not found');
    err.status = 404;
    throw err;
  }

  const signatures = getUserSignatures(userId).map((s) => ({
    signature_id: s.id,
    document_type: s.doc_type,
    document_title: s.title,
    document_version: s.document_version,
    document_sha256: s.document_hash,
    typed_name: s.typed_name,
    ip_address: s.ip_address,
    signed_at: s.signed_at,
    storage_integrity: 'append-only table (UPDATE/DELETE blocked by SQLite triggers prevent_legal_signature_update/delete)'
  }));

  const auditTrail = queryAll(`
    SELECT action, resource, ip_address, created_at
    FROM access_log
    WHERE user_id = ? AND action LIKE 'legal_%'
    ORDER BY created_at ASC
  `, [userId]);

  logAccess({
    userId: adminId,
    action: 'legal_evidence_exported',
    resource: `/api/legal/evidence/${userId} (${signatures.length} signatures)`,
    ipAddress
  });

  return {
    generated_at: new Date().toISOString(),
    legal_basis: 'Government of India, Information Technology Act 2000, Section 3A (electronic signature validity); Digital Personal Data Protection Act 2023 (privacy consent records)',
    disclaimer: 'Document bodies are platform drafts; have counsel review before enforcement proceedings.',
    user,
    signature_count: signatures.length,
    signatures,
    audit_trail: auditTrail
  };
}

/**
 * Seeds default document templates (once). These are STARTING DRAFTS in
 * simple bilingual-friendly English — a lawyer must review before real use.
 */
export function seedDefaultDocuments(adminUserId) {
  const existing = queryOne('SELECT COUNT(*) as c FROM legal_documents');
  if (existing.c > 0) return false;

  const drafts = [
    {
      doc_type: 'terms',
      title: 'Terms & Conditions — Mahi Tech Group Platform',
      body: `TERMS AND CONDITIONS — MAHI TECH GROUP PLATFORM (DRAFT v1)

1. ACCEPTANCE: By signing up, applying for membership and using this platform you accept these Terms, the Privacy Policy, NDA, IP Assignment and Liability Agreement.

2. PLATFORM PURPOSE: Mahi Tech Group is a team orchestration platform for idea voting, project execution, revenue sharing and collaboration.

3. MEMBER RESPONSIBILITIES: (a) Provide accurate identity information; (b) Use only the access granted to your role; (c) Do not tamper with, delete, corrupt or maliciously modify any project data, code, designs, documents or platform records; (d) Do not share confidential project information outside the team; (e) Follow the task, voting and review workflows as designed.

4. PROHIBITED CONDUCT: Unauthorized access, data deletion or corruption, code/design theft, sharing credentials, automated scraping of member data, and any act that damages projects or members is strictly prohibited and constitutes grounds for immediate removal, wallet settlement hold and legal action.

5. REVENUE & WALLET: Contribution-based revenue splits are recorded in an immutable ledger. Withdrawals are disbursed after Admin verification. Fraudulent manipulation voids payouts.

6. ACCOUNT REMOVAL: The Admin may remove a member for violation of these Terms. Upon removal, all platform and repository access is revoked automatically. Signed legal records survive removal.

7. DISPUTES: Subject to the platform's dispute resolution process and the laws of India; courts at the registered jurisdiction of Mahi Tech Group shall have exclusive jurisdiction.

NOTE: This is a platform-draft template for review by a qualified lawyer before enforcement.`
    },
    {
      doc_type: 'privacy',
      title: 'Privacy Policy (DPDP Act 2023 Aligned) — Mahi Tech Group',
      body: `PRIVACY POLICY — MAHI TECH GROUP (DRAFT v1, aligned with the Digital Personal Data Protection Act, 2023)

1. DATA WE COLLECT: Name, email, phone (optional), role, UPI ID (payout), profile content, activity records (logins, votes, tasks, transactions), meeting attendance and device/IP metadata.

2. PURPOSE & CONSENT: Data is processed only for platform operations — membership, role-based access, project execution, revenue accounting, security and legal compliance. Consent is recorded via your electronic signature on this policy.

3. DATA PRINCIPAL RIGHTS (DPDP Act): You may access, correct or request erasure of your data (legal/financial records excluded as permitted by law) via the platform profile or by contacting the Admin. Withdrawal of consent may affect service usage.

4. SHARING: Data is shared only with team members on a need-and-role basis (e.g., your UPI ID with Admin for payouts). No sale of personal data. Government requests are honoured as per law.

5. SECURITY: Role-based access control, encrypted secrets, append-only audit records and automated access revocation on exit.

6. RETENTION: Account data is retained while membership is active; financial and signed legal records are retained as required by law even after exit.

NOTE: Platform-draft template — review with counsel for full DPDP rule compliance.`
    },
    {
      doc_type: 'nda',
      title: 'Non-Disclosure Agreement (NDA) — Mahi Tech Group Members',
      body: `NON-DISCLOSURE AGREEMENT — MAHI TECH GROUP (DRAFT v1)

1. CONFIDENTIAL INFORMATION: All project ideas, source code, designs, research, revenue data, member information, gateway credentials, roadmaps and internal discussions accessed through the platform or its repositories.

2. OBLIGATIONS: (a) Use Confidential Information solely for assigned team work; (b) Never disclose it to outsiders; (c) Never retain copies after exit; (d) Protect credentials with at least the care you apply to your own.

3. EXCLUSIONS: Publicly available information, independently developed knowledge, or disclosures required by law with notice to the Admin.

4. TERM: Obligations continue during membership and for 5 (five) years after exit.

5. BREACH: Any breach entitles Mahi Tech Group to remove the member, freeze settlements, claim damages and pursue legal action under Indian law.

NOTE: Platform-draft template — review with counsel before enforcement.`
    },
    {
      doc_type: 'ip_assignment',
      title: 'Intellectual Property Assignment — Mahi Tech Group Members',
      body: `INTELLECTUAL PROPERTY ASSIGNMENT — MAHI TECH GROUP (DRAFT v1)

1. ASSIGNMENT: All work product (code, designs, documents, research, assets) created by you for any Mahi Tech Group project — through the platform or its repositories — is and remains the exclusive property of Mahi Tech Group from the moment of creation.

2. REVENUE RIGHTS: Your contribution is compensated through the platform's contribution-weighted revenue split engine. Revenue share does not create any ownership right in the work product.

3. MORAL RIGHTS: To the extent permitted by law, you waive moral rights in the work product for project purposes.

4. EXIT: This assignment survives membership termination. On exit you retain no license to project work product unless granted in writing.

5. PRE-EXISTING WORK: Any pre-existing IP you introduce must be declared to the Admin in writing before use.

NOTE: Platform-draft template — review with counsel before enforcement.`
    },
    {
      doc_type: 'liability',
      title: 'Liability & Indemnity Agreement — Mahi Tech Group Members',
      body: `LIABILITY & INDEMNITY AGREEMENT — MAHI TECH GROUP (DRAFT v1)

1. MEMBER LIABILITY: You are personally responsible for any damage caused by tampering with, deleting, corrupting or misusing platform data, repositories, code, designs or credentials, and for any breach of the Terms, NDA or IP Assignment.

2. INDEMNITY: You agree to indemnify Mahi Tech Group against losses, claims or costs arising from your violations, unauthorized disclosures or malicious acts.

3. SECURITY INCIDENTS: Suspected incidents must be reported to the Admin immediately. Good-faith reporting of your own mistakes will be considered in remediation.

4. ENFORCEMENT: Mahi Tech Group may pursue suspension, wallet settlement hold, removal and legal action (including recovery of damages) based on the immutable audit trail and your signed agreements. Signed electronic records (hash, timestamp, IP) are admissible evidence under the IT Act 2000.

5. NO AGENCY: Members are independent collaborators; nothing here creates an employment relationship unless separately executed.

NOTE: Platform-draft template — review with counsel before enforcement.`
    },
    {
      doc_type: 'conduct',
      title: 'Code of Conduct — Mahi Tech Group Members',
      body: `CODE OF CONDUCT — MAHI TECH GROUP (DRAFT v1)

1. RESPECT: Treat every member professionally. No harassment, discrimination or abuse in any channel, meeting or canvas.

2. INTEGRITY: Vote honestly, report task status truthfully, never manipulate ratings, wallets or voting.

3. COLLABORATION: Respect task dependencies, review queues and the democratic voting outcomes even when you disagree.

4. SECURITY: Never share accounts, never bypass role restrictions, report vulnerabilities responsibly.

5. VIOLATIONS: Handled via the Admin review and platform dispute process; serious violations lead to removal with automatic access revocation.

NOTE: Platform-draft template — adapt with counsel as needed.`
    }
  ];

  for (const d of drafts) {
    publishDocumentVersion({ doc_type: d.doc_type, title: d.title, body: d.body, adminId: adminUserId });
  }
  return true;
}
