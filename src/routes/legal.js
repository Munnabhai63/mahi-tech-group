import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { queryAll } from '../db/database.js';
import {
  getActiveDocuments,
  getDocumentById,
  publishDocumentVersion,
  signDocument,
  getUnsignedDocuments,
  getUserSignatures,
  hasSignedAllActiveDocuments,
  exportLegalEvidence,
  seedDefaultDocuments,
  LEGAL_DOC_TYPES
} from '../services/legalService.js';

const router = express.Router();

/**
 * LEGAL ONBOARDING GATE ROUTES
 * Public: reading active documents (signup needs them before login exists)
 * Authenticated: signing, own signature list
 * Admin: publishing versions, evidence export, seeding defaults
 */

/**
 * 1. GET /api/legal/documents (Public)
 * Active document versions — signup page renders these for acceptance.
 */
router.get('/documents', (req, res) => {
  return res.status(200).json({ count: 0, documents: [], note: 'Use /api/legal/documents/active' });
});

/**
 * 1b. GET /api/legal/documents/active (Public)
 */
router.get('/documents/active', (req, res) => {
  const docs = getActiveDocuments();
  return res.status(200).json({ count: docs.length, documents: docs });
});

/**
 * 1c. GET /api/legal/documents/:id (Public — document body)
 */
router.get('/documents/:id', (req, res) => {
  const doc = getDocumentById(req.params.id, true);
  if (!doc) {
    return res.status(404).json({ error: 'Document not found' });
  }
  return res.status(200).json({ document: doc });
});

/**
 * 2. POST /api/legal/documents (Admin) — publish a new version
 */
router.post('/documents', authenticate, (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden: Only administrators can publish legal documents' });
  }
  try {
    const { doc_type, title, body } = req.body || {};
    const doc = publishDocumentVersion({ doc_type, title, body, adminId: req.user.id, ipAddress: req.ip });
    return res.status(201).json({
      message: `Published ${doc.doc_type} v${doc.version}. Existing members must re-sign before new task assignment.`,
      document: doc
    });
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }
});

/**
 * 3. GET /api/legal/signatures/me (Authenticated)
 * Everything I have signed + what is still pending.
 */
router.get('/signatures/me', authenticate, (req, res) => {
  return res.status(200).json({
    signed: getUserSignatures(req.user.id),
    pending: getUnsignedDocuments(req.user.id),
    all_signed: hasSignedAllActiveDocuments(req.user.id)
  });
});

/**
 * 4. POST /api/legal/sign (Authenticated)
 * Electronic signature against one active document.
 */
router.post('/sign', authenticate, (req, res) => {
  try {
    const { document_id, typed_name } = req.body || {};
    if (req.user.status !== 'active' && req.user.status !== 'pending') {
      return res.status(403).json({ error: 'Only active or pending members can sign documents' });
    }
    const result = signDocument({
      documentId: document_id,
      userId: req.user.id,
      typedName: typed_name,
      ipAddress: req.ip || req.socket.remoteAddress
    });
    return res.status(result.alreadySigned ? 200 : 201).json({
      message: result.alreadySigned ? 'Already signed earlier.' : 'Document signed successfully.',
      all_signed: hasSignedAllActiveDocuments(req.user.id),
      pending: getUnsignedDocuments(req.user.id),
      signature: result.signature
    });
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }
});

/**
 * 5. GET /api/legal/evidence/:userId (Admin)
 * Court-ready evidence bundle for one member.
 */
router.get('/evidence/:userId', authenticate, (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden: Only administrators can export legal evidence' });
  }
  try {
    const bundle = exportLegalEvidence(req.params.userId, req.user.id, req.ip);
    return res.status(200).json(bundle);
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }
});

/**
 * 6. GET /api/legal/compliance (Admin)
 * Which members have NOT signed all active documents (blocks approvals).
 */
router.get('/compliance', authenticate, (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden: administrators only' });
  }
  const members = queryAll("SELECT id, name, email, status FROM users WHERE status IN ('active','pending') ORDER BY name ASC");
  const nonCompliant = members
    .map((u) => ({ user_id: u.id, name: u.name, email: u.email, status: u.status, missing: getUnsignedDocuments(u.id) }))
    .filter((u) => u.missing.length > 0);
  return res.status(200).json({
    total_members: members.length,
    non_compliant_count: nonCompliant.length,
    non_compliant: nonCompliant
  });
});

/**
 * 7. POST /api/legal/seed-defaults (Admin)
 * One-time seeding of the six starter templates.
 */
router.post('/seed-defaults', authenticate, (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden: administrators only' });
  }
  const seeded = seedDefaultDocuments(req.user.id);
  return res.status(200).json({
    seeded,
    message: seeded ? 'Default document templates published (have a lawyer review them).' : 'Documents already exist; nothing seeded.',
    doc_types: LEGAL_DOC_TYPES
  });
});

export default router;
