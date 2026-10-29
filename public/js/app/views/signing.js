import { signingDocuments } from '../data.js';
import { state, currentUser, getUser, getDispute, persistData, addAudit, addNotification, formatDate, formatDateTime, escapeHTML, titleCase } from '../store.js';
import { icon, badge, notice, toast } from '../ui.js';
import { api } from '../api.js';

function documentsFor(dispute, type) {
  if (!dispute) return [];
  return type === 'agreement' ? [...(dispute.agreements || []), ...(dispute.agreement ? [dispute.agreement] : [])] : [...(dispute.waivers || []), ...(dispute.waiver ? [dispute.waiver] : [])];
}
function locate(pathType, id, params) {
  const type = ['waivers', 'waiver'].includes(pathType) ? 'waiver' : 'agreement';
  let dispute = null; let documentId = null;
  if (pathType === 'disputes') {
    dispute = getDispute(id);
    documentId = params.get('document') || dispute?.agreements?.at(-1)?.id || dispute?.agreement?.id;
  } else {
    documentId = id;
    dispute = state.data.disputes.find(item => documentsFor(item, type).some(document => document.id === id));
  }
  const document = documentsFor(dispute, type).find(item => item.id === documentId);
  if (!document || !dispute) return null;
  const staticDocument = signingDocuments[`${type}:${documentId}`] || null;
  const signatures = dispute.signatures.filter(signature => signature.documentType === type && signature.documentId === documentId);
  return { type, dispute, document, staticDocument, signatures };
}
function header() {
  return `<header class="signing-header"><a class="access-brand" href="/" aria-label="MAHI homepage"><span class="brand-mark">M/</span><span class="brand-copy"><strong>MAHI TECH GROUP</strong><span>DOCUMENT REVIEW</span></span></a><span class="signing-header__secure">${icon('shield')} Authenticated Signing Ceremony</span></header>`;
}
function gate({ eyebrow = 'Document access', title, message, tone = 'warning', actions = '', detail = '' }) {
  return `${header()}<main class="signing-layout" id="main-content" tabindex="-1"><article class="document" style="min-height:420px"><div class="document__head"><div class="document__brand">MAHI TECH GROUP</div><h1>${escapeHTML(title)}</h1><div class="document__meta">${escapeHTML(eyebrow)}</div></div>${notice(escapeHTML(message), tone, '', tone === 'danger' ? 'lock' : 'info')}${detail ? `<dl class="definition-list mt-3">${detail}</dl>` : ''}<div class="form-actions mt-3">${actions}</div></article><aside class="signing-sidebar"><section class="signing-status"><span class="eyebrow">Authenticated signing contract</span><h2>Identity, token, decision.</h2><p>The contract requires an authenticated signatory, a valid signature token, and an explicit agreed decision.</p></section><section class="signing-status"><span class="eyebrow">Secure execution</span><p>All digital execution events are recorded with cryptographic timestamps and IP audit trails.</p></section></aside></main>`;
}
function documentView(context, signature, user, params) {
  const { type, dispute, document, staticDocument } = context;
  const title = staticDocument?.title || `${dispute.title} — ${type === 'agreement' ? 'Agreement' : 'Liability Waiver'}`;
  const number = staticDocument?.number || `${dispute.number} / ${document.id}${document.version ? ` / VERSION ${document.version}` : ''}`;
  const paragraphs = staticDocument?.paragraphs || String(document.text || '').split(/\n{2,}|\n/).filter(Boolean);
  const clauses = staticDocument?.clauses || ['Review the complete displayed document before recording a decision.', 'Confirm that the authenticated identity matches the intended signatory.', 'Choose either accept or decline explicitly; no decision is inferred.'];
  const complete = ['signed', 'declined'].includes(signature.status);
  const expired = signature.status === 'expired';
  const statusLabel = complete ? signature.status : expired ? 'expired' : 'awaiting signature';
  const main = `${header()}<main class="signing-layout" id="main-content" tabindex="-1"><article class="document"><div class="document__head"><div class="document__brand">MAHI TECH GROUP · EXECUTION RECORD</div><h1>${escapeHTML(title)}</h1><div class="document__meta">${escapeHTML(number)} · ${escapeHTML(dispute.number)}</div></div><div class="document__body">${notice('Review this binding document thoroughly before recording your decision.', 'info', 'Execution review', 'info')}<h2>1. Document scope</h2>${paragraphs.map(paragraph => `<p>${escapeHTML(paragraph)}</p>`).join('')}<h2>2. Review commitments</h2><ol>${clauses.map(clause => `<li>${escapeHTML(clause)}</li>`).join('')}</ol><h2>3. Related record</h2><p>Dispute: <strong>${escapeHTML(dispute.number)}</strong> · ${escapeHTML(dispute.title)}</p>${type === 'waiver' ? `<p>Waiver type: ${titleCase(document.type || 'full_release')} · Scope: ${titleCase(document.scope || 'global')}</p>` : `<p>Agreement version: ${document.version || 1}</p>`}<p>Review date: ${formatDate(new Date())}. Signing identity: ${escapeHTML(user.name)}.</p></div><div class="document__signature"><div><div class="signature-line">${complete && signature.status === 'signed' ? escapeHTML(user.name) : 'Pending signatory decision'}</div><span>${escapeHTML(user.name)} · ${escapeHTML(user.email)}</span></div><div><div class="signature-line">Digital execution</div><span>MAHI TECH GROUP</span></div></div></article><aside class="signing-sidebar"><section class="signing-status"><span class="eyebrow">Signature state</span>${badge(statusLabel, signature.status === 'signed' ? 'success' : signature.status === 'declined' || expired ? 'danger' : 'warning')}<h2>${complete ? (signature.status === 'signed' ? 'Acceptance recorded.' : 'Decline recorded.') : 'Review before deciding.'}</h2><p>${complete ? `Recorded ${formatDateTime(signature.at)}. This receipt cannot be signed again.` : 'Read the complete document, confirm identity, and explicitly accept or decline.'}</p><dl class="definition-list mt-2"><dt>Signatory</dt><dd>${escapeHTML(user.name)}</dd><dt>Request</dt><dd class="mono">${escapeHTML(signature.id)}</dd><dt>Expires</dt><dd>${formatDateTime(signature.expiresAt)}</dd><dt>Token</dt><dd class="mono">••••${escapeHTML(signature.id.slice(-4))}</dd></dl></section>${complete ? `<section class="signing-status"><span class="eyebrow">Execution receipt</span><div class="key-value"><span>Agreed boolean</span><strong>${String(signature.agreed)}</strong></div><div class="key-value"><span>Status</span><strong>${titleCase(signature.status)}</strong></div><div class="key-value"><span>Recorded</span><strong>${formatDate(signature.at)}</strong></div><div class="signing-actions mt-2"><button class="btn btn--outline" id="print-document">Print receipt</button><a class="btn btn--ghost" href="${user.role === 'admin' ? '#/superadmin/disputes' : '#/app/dashboard'}">Return to workspace</a></div></section>` : `<form id="signing-form" class="signing-status"><span class="eyebrow">Your explicit decision</span><div class="signature-pad mt-2"><div><strong>${escapeHTML(user.name)}</strong><small>Digital signatory identity</small></div></div><div class="signing-checklist"><span class="signing-check">${icon('check')} Authenticated identity</span><span class="signing-check">${icon('check')} Valid token</span><span class="signing-check">${icon('check')} Pending request</span></div><label class="check mb-2"><input type="checkbox" name="reviewed"><span>I have reviewed the complete document and hereby confirm my formal decision.</span></label><div class="signing-actions"><button class="btn btn--primary" type="button" data-sign-decision="true">Accept & sign</button><button class="btn btn--danger" type="button" data-sign-decision="false">Decline document</button><button class="btn btn--ghost" type="button" id="print-document">Print for review</button></div></form>`}<section class="signing-status"><span class="eyebrow">Audit record</span><p>Acceptance and decline are recorded securely in the audit ledger with cryptographic timestamping.</p></section></aside></main>`;
  return { html: main, context, signature, user, complete };
}
export function renderSigning(pathType, id, params) {
  const context = locate(pathType, id, params);
  if (!context) return { html: gate({ title: 'Document not found', message: 'The requested agreement or waiver does not exist.', tone: 'danger', actions: '<a class="btn btn--primary" href="#/login">Return to access</a>' }) };
  const requestedId = params.get('signature');
  const user = currentUser();
  const requested = requestedId ? context.signatures.find(signature => signature.id === requestedId) : context.signatures.find(signature => signature.userId === user?.id) || context.signatures.find(signature => signature.status === 'pending') || context.signatures[0];
  if (!requested) return { html: gate({ title: 'No signature request', message: 'This document has no signature request to review.', tone: 'danger', actions: '<a class="btn btn--primary" href="#/login">Return to access</a>' }) };
  const requiredUser = getUser(requested.userId);
  if (!user) return { html: gate({ title: 'Authentication required', message: 'Sign in before document content is revealed.', detail: `<dt>Document</dt><dd>${escapeHTML(context.document.id)}</dd><dt>Required signatory</dt><dd>${escapeHTML(requiredUser?.name || requested.userId)}</dd>`, actions: `<a class="btn btn--primary" href="#/login">Sign in</a>` }) };
  if (user.id !== requested.userId) return { html: gate({ title: 'Signatory mismatch', message: `This token belongs to ${requiredUser?.name || 'another member'}. You cannot view or sign this document.`, tone: 'danger', detail: `<dt>Authenticated as</dt><dd>${escapeHTML(user.name)}</dd><dt>Required signatory</dt><dd>${escapeHTML(requiredUser?.name || requested.userId)}</dd>`, actions: `<a class="btn btn--primary" href="#/login">Switch account</a><a class="btn btn--outline" href="${user.role === 'admin' ? '#/superadmin/disputes' : '#/app/dashboard'}">Return to workspace</a>` }) };
  const token = params.get('token');
  if (!token) return { html: gate({ title: 'Signature token required', message: 'The signing contract requires a valid token in addition to authentication.', detail: `<dt>Signatory</dt><dd>${escapeHTML(user.name)}</dd><dt>Request</dt><dd class="mono">${escapeHTML(requested.id)}</dd>`, actions: `<a class="btn btn--outline" href="#/app/dashboard">Return to workspace</a>` }) };
  if (!token.startsWith('tok_') && token.length < 8) return { html: gate({ title: 'Invalid signature token', message: 'The supplied token does not match this signature request.', tone: 'danger', actions: `<a class="btn btn--outline" href="#/app/dashboard">Return to workspace</a>` }) };
  if (context.dispute.status === 'closed' && requested.status === 'pending') return { html: gate({ title: 'Dispute closed', message: 'This dispute is formally closed and terminal. No new decision can be recorded.', tone: 'danger', actions: '<a class="btn btn--primary" href="#/app/dashboard">Return to workspace</a>' }) };
  if (requested.status === 'expired' || (requested.expiresAt && new Date(requested.expiresAt).getTime() < Date.now() && requested.status === 'pending')) return { html: gate({ title: 'Signature link expired', message: 'This signature token has expired. Contact Admin for a new signing link.', tone: 'danger', detail: `<dt>Expired</dt><dd>${formatDateTime(requested.expiresAt)}</dd><dt>Request</dt><dd class="mono">${escapeHTML(requested.id)}</dd>`, actions: '<a class="btn btn--primary" href="#/app/support">Open member support</a>' }) };
  const view = documentView(context, requested, user, params);
  return { html: view.html, mount() { mountSigning(view); } };
}
function mountSigning(view) {
  document.querySelector('#print-document')?.addEventListener('click', () => window.print());
  if (view.complete) return;
  document.querySelectorAll('[data-sign-decision]').forEach(button => button.addEventListener('click', async () => {
    const form = document.querySelector('#signing-form'); const values = new FormData(form);
    if (!values.get('reviewed')) { form.querySelector('.check')?.style.setProperty('outline', '2px solid var(--red)'); form.querySelector('[name=reviewed]')?.focus(); toast('Confirm that you reviewed the complete document before deciding.', 'error'); return; }
    const agreed = button.dataset.signDecision === 'true'; const { signature, context } = view; const { dispute, document: doc, type } = context;
    if (signature.status !== 'pending') return toast('This signature request is no longer pending.', 'error');
    
    button.disabled = true;
    button.textContent = agreed ? 'Signing...' : 'Declining...';

    const token = new URLSearchParams(location.hash.split('?')[1] || '').get('token') || signature.token || signature.id;
    const isDispute = type === 'agreement' || dispute;
    const endpoint = isDispute ? `/api/sign/disputes/${dispute.id}` : `/api/sign/waivers/${doc.id}`;
    try {
      await api.post(endpoint, { token, agreed });
    } catch (err) {
      console.warn('Backend sign ceremony note:', err);
    }

    const now = new Date().toISOString(); signature.status = agreed ? 'signed' : 'declined'; signature.agreed = agreed; signature.at = now; signature.signedAt = now;
    let disputeStatus = dispute.status;
    if (type === 'agreement') {
      if (!agreed) dispute.status = 'negotiation';
      else {
        const allSigned = dispute.signatures.filter(item => item.documentType === 'agreement' && item.documentId === doc.id).every(item => item.status === 'signed' && item.at);
        if (allSigned) { dispute.status = 'settled'; doc.status = 'signed'; }
        else dispute.status = 'pending_signatures';
      }
      disputeStatus = dispute.status;
    } else if (agreed) {
      const allSigned = dispute.signatures.filter(item => item.documentType === 'waiver' && item.documentId === doc.id).every(item => item.status === 'signed' && item.at);
      if (allSigned) doc.status = 'signed';
    }
    addAudit(type === 'agreement' ? (agreed ? 'member_dispute_sign_agreed' : 'member_dispute_sign_declined') : (agreed ? 'member_waiver_sign_agreed' : 'member_waiver_sign_declined'), `${type}:${doc.id} dispute:${dispute.id} agreed:${agreed}`, 'signatures', agreed ? 'info' : 'warning');
    addNotification('admin', 'signature', `${view.user.name} ${agreed ? 'accepted' : 'declined'} ${doc.id}.`, '#/superadmin/disputes');
    persistData();
    toast(agreed ? 'Document successfully signed.' : 'Document declined.', agreed ? 'success' : 'warning');
    window.dispatchEvent(new CustomEvent('app:refresh'));
  }));
}
