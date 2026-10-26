import { api } from '../api.js';
import {
  state, currentUser, getUser, getProject, getTicket, getDispute,
  persistData, addAudit, addNotification, formatINR, formatDate, formatDateTime,
  relativeTime, escapeHTML, titleCase, uid,
  fetchLiveDisputes, fetchDisputeDetail
} from '../store.js';
import {
  icon, badge, plainBadge, avatar, person, statCard, pageHead,
  notice, emptyState, withPreview, openDialog, closeDialog, openDrawer,
  closeDrawer, confirmDialog, toast, formValues, setFormError
} from '../ui.js';

const transitions = {
  open: ['under_review', 'escalated_legal', 'closed'],
  under_review: ['negotiation', 'pending_signatures', 'resolved', 'settled', 'escalated_legal', 'closed'],
  negotiation: ['pending_signatures', 'under_review', 'resolved', 'settled', 'escalated_legal', 'closed'],
  pending_signatures: ['negotiation', 'settled', 'resolved', 'escalated_legal', 'closed'],
  settled: ['resolved', 'closed', 'escalated_legal'],
  resolved: ['settled', 'closed', 'escalated_legal'],
  escalated_legal: ['under_review', 'negotiation', 'closed'],
  closed: []
};
const disputeTypes = ['financial_settlement', 'ip_ownership', 'contribution_disagreement', 'offboarding_settlement', 'formal_complaint', 'legal_matter', 'other'];
const waiverTypes = ['full_release', 'partial_release', 'nda_extension', 'ip_assignment', 'financial_final_settlement'];

function partiesFor(dispute) {
  if (dispute.parties?.length) return dispute.parties;
  return (dispute.partyIds || []).map((userId, index) => ({
    userId,
    name: getUser(userId)?.name || 'Unknown',
    type: userId === dispute.raisedBy ? 'complainant' : getUser(userId)?.role === 'admin' ? 'admin' : index === 1 ? 'respondent' : 'witness'
  }));
}
function setParties(dispute, parties) {
  dispute.parties = parties;
  dispute.partyIds = [...new Set(parties.map(party => party.userId).filter(Boolean))];
}
function signaturesFor(dispute, documentType, documentId) {
  return (dispute.signatures || []).filter(signature => signature.documentType === documentType && signature.documentId === documentId);
}
function disputeRow(dispute) {
  const raisedBy = getUser(dispute.raisedBy);
  const signatures = dispute.signatures || [];
  return `<tr data-status="${dispute.status}" data-type="${dispute.disputeType}" data-search="${escapeHTML(`${dispute.number} ${dispute.title || ''} ${dispute.description || ''}`.toLowerCase())}"><td><button class="table-link" data-open-dispute="${dispute.id}">${dispute.number}</button><div class="cell-sub">${escapeHTML(dispute.title || dispute.description?.slice(0, 40) || 'Dispute')}</div></td><td>${titleCase(dispute.disputeType)}</td><td>${person(raisedBy, raisedBy?.role)}</td><td>${badge(dispute.status)}</td><td>${signatures.filter(signature => signature.status === 'signed').length}/${signatures.length} signed</td><td>${formatDate(dispute.createdAt)}</td><td><button class="btn btn--outline btn--sm" data-open-dispute="${dispute.id}">Open</button></td></tr>`;
}

export function renderDisputes() {
  const disputes = state.data.disputes;
  const open = disputes.filter(dispute => dispute.status !== 'closed');
  const pending = disputes.reduce((sum, dispute) => sum + (dispute.signatures || []).filter(signature => signature.status === 'pending').length, 0);
  const content = `<section class="stat-grid">${statCard('Open disputes', open.length, 'Excludes formally closed records', 'alert')}${statCard('Pending signatures', pending, 'Across agreements and waivers', 'edit', pending > 0)}${statCard('Under review', disputes.filter(dispute => dispute.status === 'under_review').length, 'Forward-only lifecycle', 'eye')}${statCard('Settled records', disputes.filter(dispute => dispute.status === 'settled').length, 'Settlement amount locked to record', 'wallet')}</section><div class="filter-bar mt-3"><div class="field field--search"><label for="dispute-search">Search disputes</label><div class="input-wrap">${icon('search')}<input class="input" id="dispute-search" placeholder="Number, title, or description"></div></div><div class="field"><label for="dispute-status">Status</label><select class="select" id="dispute-status"><option value="all">All statuses</option>${Object.keys(transitions).map(status => `<option value="${status}">${titleCase(status)}</option>`).join('')}</select></div><div class="field"><label for="dispute-type">Type</label><select class="select" id="dispute-type"><option value="all">All types</option>${disputeTypes.map(type => `<option value="${type}">${titleCase(type)}</option>`).join('')}</select></div><span class="filter-count">${disputes.length} records</span></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Dispute</th><th>Type</th><th>Raised by</th><th>Status</th><th>Signatures</th><th>Created</th><th></th></tr></thead><tbody id="dispute-rows">${disputes.map(disputeRow).join('')}</tbody></table></div>`;
  return {
    html: `${pageHead('Elevated Admin · Disputes', 'Resolution with a formal record.', 'Parties, forward-only status transitions, agreements, liability waivers, signatures, and financial settlement.', `<button class="btn btn--primary" id="create-dispute">${icon('plus')} Create dispute</button>`)}${withPreview(content, { title: 'No disputes', description: 'Formal resolution records will appear here.', icon: 'shield' })}`,
    mount() {
      fetchLiveDisputes().catch(() => {});
      document.querySelector('#create-dispute')?.addEventListener('click', () => openCreateDispute());
      document.querySelectorAll('[data-open-dispute]').forEach(button => button.addEventListener('click', () => openDisputeDetail(button.dataset.openDispute)));
      const search = document.querySelector('#dispute-search');
      const status = document.querySelector('#dispute-status');
      const type = document.querySelector('#dispute-type');
      const filter = () => {
        const query = search.value.trim().toLowerCase();
        document.querySelectorAll('#dispute-rows tr').forEach(row => {
          row.hidden = !((!query || row.dataset.search.includes(query)) && (status.value === 'all' || row.dataset.status === status.value) && (type.value === 'all' || row.dataset.type === type.value));
        });
      };
      search?.addEventListener('input', filter);
      status?.addEventListener('change', filter);
      type?.addEventListener('change', filter);
    }
  };
}

export function openCreateDispute(preselected = {}) {
  const activeUsers = state.data.users.filter(user => user.status === 'active');
  openDialog({
    title: 'Create a dispute record',
    subtitle: 'Elevated Admin · resolution workflow',
    wide: true,
    content: `<form id="create-dispute-form" class="form-grid"><div class="field"><label for="new-dispute-type">Dispute type</label><select class="select" id="new-dispute-type" name="type">${disputeTypes.map(type => `<option value="${type}">${titleCase(type)}</option>`).join('')}</select></div><div class="field"><label for="new-dispute-title">Short title</label><input class="input" id="new-dispute-title" name="title" required placeholder="Concise review title"></div><div class="field"><label for="new-dispute-raised">Raised by</label><select class="select" id="new-dispute-raised" name="raisedBy">${state.data.users.map(user => `<option value="${user.id}" ${preselected.raisedBy === user.id ? 'selected' : ''}>${escapeHTML(user.name)} · ${titleCase(user.status)}</option>`).join('')}</select></div><div class="field"><label for="new-dispute-against">Internal respondent</label><select class="select" id="new-dispute-against" name="against"><option value="">None / external party</option>${state.data.users.filter(user => user.id !== currentUser().id).map(user => `<option value="${user.id}" ${preselected.against === user.id ? 'selected' : ''}>${escapeHTML(user.name)}</option>`).join('')}</select><span class="field-hint">The current Admin cannot be selected as respondent.</span></div><div class="field"><label for="new-dispute-external">External respondent (optional)</label><input class="input" id="new-dispute-external" name="external" placeholder="External party name"></div><div class="field"><label for="new-dispute-ticket">Linked ticket</label><select class="select" id="new-dispute-ticket" name="ticketId"><option value="">None</option>${state.data.tickets.map(ticket => `<option value="${ticket.id}" ${preselected.ticketId === ticket.id ? 'selected' : ''}>${ticket.number} · ${escapeHTML(ticket.subject)}</option>`).join('')}</select></div><div class="field span-2"><label for="new-dispute-project">Linked project</label><select class="select" id="new-dispute-project" name="projectId"><option value="">None</option>${state.data.projects.map(project => `<option value="${project.id}">${escapeHTML(project.title)}</option>`).join('')}</select></div><div class="field span-2"><label for="new-dispute-description">Description</label><textarea class="textarea" id="new-dispute-description" name="description" required placeholder="Record the issue, relevant history, and requested review."></textarea></div></form>`,
    footer: '<button class="btn btn--outline" data-close-dialog>Cancel</button><button class="btn btn--primary" id="save-dispute">Create record</button>',
    onMount(dialog) {
      dialog.querySelector('#save-dispute').addEventListener('click', async () => {
        const form = dialog.querySelector('#create-dispute-form');
        const values = formValues(form);
        if (!values.title?.trim()) return setFormError(form, 'Add a concise dispute title.', 'title');
        if (!values.description?.trim()) return setFormError(form, 'Description is required.', 'description');
        if (values.against === currentUser().id) return setFormError(form, 'Admin cannot create a dispute against themselves.', 'against');

        const saveBtn = dialog.querySelector('#save-dispute');
        saveBtn.disabled = true;
        saveBtn.textContent = 'Creating dispute...';

        const fullDescription = `${values.title.trim()}\n\n${values.description.trim()}`;

        try {
          const res = await api.post('/api/superadmin/disputes', {
            dispute_type: values.type,
            raised_by: values.raisedBy,
            against_party: values.against || null,
            against_party_ext: values.against ? null : (values.external?.trim() || null),
            linked_ticket_id: values.ticketId || null,
            linked_project_id: values.projectId || null,
            description: fullDescription
          });

          const id = res?.id || uid('d');
          const number = res?.dispute_number || `DSP-LOCAL-${String(state.data.disputes.length + 1).padStart(3, '0')}`;
          const parties = [{ userId: values.raisedBy, name: getUser(values.raisedBy)?.name, type: 'complainant' }];
          if (values.against) parties.push({ userId: values.against, name: getUser(values.against)?.name, type: 'respondent' });
          else if (values.external?.trim()) parties.push({ userId: null, name: values.external.trim(), type: 'respondent' });

          const dispute = {
            id,
            number,
            title: values.title.trim(),
            disputeType: values.type,
            description: values.description.trim(),
            raisedBy: values.raisedBy,
            againstParty: values.against || null,
            againstPartyExt: values.against ? null : values.external?.trim() || null,
            linkedTicketId: values.ticketId || null,
            linkedProjectId: values.projectId || null,
            partyIds: parties.map(party => party.userId).filter(Boolean),
            parties,
            status: 'open',
            createdAt: new Date().toISOString(),
            settlementAmount: null,
            settlementAction: null,
            agreement: null,
            waiver: null,
            agreements: [],
            waivers: [],
            signatures: []
          };

          state.data.disputes.unshift(dispute);
          if (values.ticketId) {
            const ticket = getTicket(values.ticketId);
            if (ticket) ticket.linkedDisputeId = id;
          }
          addAudit('superadmin_dispute_create', `dispute:${number} type:${values.type}`, 'disputes', 'warning');
          persistData();
          closeDialog();
          toast('Dispute record created successfully.', 'success');
          window.dispatchEvent(new CustomEvent('app:refresh'));
          setTimeout(() => openDisputeDetail(id), 60);
        } catch (err) {
          saveBtn.disabled = false;
          saveBtn.textContent = 'Create record';
          toast(api.extractError(err, 'Failed to create dispute on backend.'), 'error');
        }
      });
    }
  });
}

function agreementList(dispute) {
  const agreements = [...(dispute.agreements || []), ...(dispute.agreement ? [dispute.agreement] : [])];
  const waivers = [...(dispute.waivers || []), ...(dispute.waiver ? [dispute.waiver] : [])];
  if (!agreements.length && !waivers.length) return emptyState('No documents drafted', 'Draft an agreement or liability waiver to generate signature requests for registered parties.', '', 'file');
  return `${agreements.map(agreement => `<article class="decision-card mb-2"><div class="spread"><div><span class="eyebrow">Agreement · v${agreement.version}</span><strong class="mt-1" style="display:block">${agreement.id}</strong></div>${badge(agreement.status || 'pending')}</div><p style="max-height:100px;overflow:auto;white-space:pre-wrap">${escapeHTML(agreement.text)}</p><div class="mt-2">${signaturesFor(dispute, 'agreement', agreement.id).map(signature => signatureRow(dispute, 'agreement', agreement.id, signature)).join('') || '<span class="small muted">No signature requests.</span>'}</div></article>`).join('')}${waivers.map(waiver => `<article class="decision-card mb-2"><div class="spread"><div><span class="eyebrow">Waiver · ${titleCase(waiver.type)}</span><strong class="mt-1" style="display:block">${waiver.id}</strong></div>${badge(waiver.status || 'pending')}</div><p style="max-height:100px;overflow:auto;white-space:pre-wrap">${escapeHTML(waiver.text)}</p><p class="tiny muted">Scope: ${titleCase(waiver.scope || 'global')}</p><div class="mt-2">${signaturesFor(dispute, 'waiver', waiver.id).map(signature => signatureRow(dispute, 'waiver', waiver.id, signature)).join('') || '<span class="small muted">No signature requests.</span>'}</div></article>`).join('')}`;
}
function signatureRow(dispute, documentType, documentId, signature) {
  const user = getUser(signature.userId);
  const signatureId = signature.id || '';
  const href = documentType === 'agreement' ? `#/sign/disputes/${dispute.id}?document=${documentId}&signature=${signatureId}&token=demo-${signatureId}` : `#/sign/waivers/${documentId}?signature=${signatureId}&token=demo-${signatureId}`;
  const ownPending = signature.status === 'pending' && signature.userId === currentUser()?.id;
  const action = ownPending ? `<a class="btn btn--ghost btn--sm" href="${href}">Review & sign</a>` : signature.status === 'pending' && currentUser()?.role === 'admin' ? `<button class="btn btn--ghost btn--sm" data-copy-sign-link="${escapeHTML(href)}">Copy sign link</button>` : signature.status === 'pending' ? '<span class="tiny muted">Awaiting signatory</span>' : `<span class="tiny muted">${formatDate(signature.at)}</span>`;
  return `<div class="list-row"><div class="list-row__main">${person(user, `${titleCase(signature.documentType)} signatory`)}</div>${badge(signature.status)}${action}</div>`;
}

export function openDisputeDetail(id) {
  const dispute = getDispute(id);
  if (!dispute) return;
  const project = getProject(dispute.linkedProjectId);
  const ticket = getTicket(dispute.linkedTicketId);
  const allowed = transitions[dispute.status] || [];
  const content = `<div class="spread"><div><span class="ticket-number">${dispute.number}</span><h3 class="mt-1" style="font:600 20px var(--font-display)">${escapeHTML(dispute.title || dispute.description?.slice(0, 40) || 'Dispute')}</h3></div>${badge(dispute.status)}</div><p class="small muted mt-2">${escapeHTML(dispute.description || '')}</p><dl class="definition-list mt-3"><dt>Type</dt><dd>${titleCase(dispute.disputeType)}</dd><dt>Raised by</dt><dd>${escapeHTML(getUser(dispute.raisedBy)?.name)}</dd><dt>Created</dt><dd>${formatDateTime(dispute.createdAt)}</dd><dt>Project</dt><dd>${project ? escapeHTML(project.title) : 'None'}</dd><dt>Ticket</dt><dd>${ticket ? `${ticket.number} · ${escapeHTML(ticket.subject)}` : 'None'}</dd>${dispute.settlementAmount !== null ? `<dt>Settlement</dt><dd>${formatINR(dispute.settlementAmount, 2)} · ${titleCase(dispute.settlementAction || 'recorded')}</dd>` : ''}</dl><div class="admin-section-label"><h2>Forward-only status</h2><span></span></div>${dispute.status === 'closed' ? notice('This dispute is formally closed and cannot be reopened or transitioned.', 'danger') : `<form id="dispute-status-form" class="stack"><div class="field"><label for="dispute-next-status">Allowed next states</label><select class="select" id="dispute-next-status" name="status"><option value="${dispute.status}">Keep ${titleCase(dispute.status)}</option>${allowed.map(status => `<option value="${status}">${titleCase(status)}</option>`).join('')}</select><span class="field-hint">Allowed from ${titleCase(dispute.status)}: ${allowed.map(titleCase).join(', ') || 'none'}.</span></div><div class="field"><label for="dispute-resolution">Resolution notes (optional)</label><textarea class="textarea" id="dispute-resolution" name="notes">${escapeHTML(dispute.resolutionNotes || '')}</textarea></div><button class="btn btn--outline" type="submit">Apply status</button></form>`}<div class="admin-section-label"><h2>Parties</h2><span></span></div><div>${partiesFor(dispute).map(party => `<div class="list-row"><div class="list-row__main">${party.userId ? person(getUser(party.userId), titleCase(party.type)) : person({ name: party.name, initials: party.name ? party.name.slice(0, 2).toUpperCase() : 'EX', role: 'external', color: '#e5e5df' }, `${titleCase(party.type)} · External`)}</div>${plainBadge(party.type)}</div>`).join('')}</div>${dispute.status !== 'closed' ? '<button class="btn btn--outline btn--full mt-2" id="add-dispute-party">Add party</button>' : ''}<div class="admin-section-label"><h2>Agreements, waivers & signatures</h2><span></span></div>${agreementList(dispute)}${dispute.status !== 'closed' ? '<div class="grid-2"><button class="btn btn--outline" id="draft-agreement">Draft agreement</button><button class="btn btn--outline" id="draft-waiver">Draft waiver</button></div>' : ''}<div class="admin-section-label"><h2>Financial settlement</h2><span></span></div>${dispute.settlementAmount !== null ? notice(`${formatINR(dispute.settlementAmount, 2)} recorded via ${titleCase(dispute.settlementAction)}. The settlement amount is locked to this record.`, 'success', 'Settlement executed') : dispute.status === 'closed' ? notice('This dispute is closed. No further settlement action is available.', 'info', 'Terminal record', 'lock') : '<button class="btn btn--primary btn--full" id="settle-dispute">Execute settlement</button>'}`;
  openDrawer({
    title: 'Dispute detail',
    subtitle: `${dispute.number} · ${titleCase(dispute.disputeType)}`,
    content,
    wide: true,
    footer: '<button class="btn btn--outline" data-close-drawer>Close</button>',
    onMount(drawer) {
      drawer.querySelectorAll('[data-close-drawer]').forEach(button => button.addEventListener('click', () => closeDrawer()));
      drawer.querySelector('#dispute-status-form')?.addEventListener('submit', async event => {
        event.preventDefault();
        const form = event.currentTarget;
        const values = formValues(form);
        if (values.status === dispute.status) return toast('Choose an allowed next state or keep the current status.', 'info');
        if (!(transitions[dispute.status] || []).includes(values.status)) return setFormError(form, `Invalid transition from ${dispute.status} to ${values.status}.`, 'status');

        const submitBtn = form.querySelector('button[type="submit"]');
        submitBtn.disabled = true;
        submitBtn.textContent = 'Applying...';

        try {
          await api.patch(`/api/superadmin/disputes/${id}/status`, {
            status: values.status,
            resolution_notes: values.notes?.trim() || null
          });

          const before = dispute.status;
          dispute.status = values.status;
          dispute.resolutionNotes = values.notes?.trim() || dispute.resolutionNotes || null;
          if (values.status === 'closed') {
            dispute.closedAt = new Date().toISOString();
            dispute.closedBy = currentUser().id;
          }
          addAudit('superadmin_dispute_status_update', `dispute:${id} ${before} -> ${values.status}`, 'disputes', 'warning');
          persistData();
          closeDrawer();
          toast('Dispute status updated on backend.', 'success');
          window.dispatchEvent(new CustomEvent('app:refresh'));
        } catch (err) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Apply status';
          toast(api.extractError(err, 'Failed to update dispute status.'), 'error');
        }
      });

      drawer.querySelector('#add-dispute-party')?.addEventListener('click', () => openAddParty(id));
      drawer.querySelector('#draft-agreement')?.addEventListener('click', () => openAgreementEditor(id));
      drawer.querySelector('#draft-waiver')?.addEventListener('click', () => openWaiverEditor(id));
      drawer.querySelector('#settle-dispute')?.addEventListener('click', () => openDisputeSettlement(id));
      drawer.querySelectorAll('[data-copy-sign-link]').forEach(button => button.addEventListener('click', async () => {
        const link = `${location.origin}${location.pathname}${button.dataset.copySignLink}`;
        try {
          await navigator.clipboard.writeText(link);
          toast('Signing link copied.', 'info');
        } catch {
          openDialog({
            title: 'Signing link',
            subtitle: 'Copy manually',
            content: `<div class="field"><label for="copy-sign-url">Signing URL</label><input class="input mono" id="copy-sign-url" readonly value="${escapeHTML(link)}"></div>`,
            footer: '<button class="btn btn--primary" data-close-dialog>Done</button>'
          });
        }
      }));
    }
  });
}

function openAddParty(id) {
  const dispute = getDispute(id);
  if (!dispute) return;
  openDialog({
    title: 'Add dispute party',
    subtitle: dispute.number,
    content: `<form id="party-form" class="stack"><div class="field"><label for="party-user">Registered member (optional)</label><select class="select" id="party-user" name="userId"><option value="">External / unregistered party</option>${state.data.users.map(user => `<option value="${user.id}">${escapeHTML(user.name)}</option>`).join('')}</select></div><div class="field"><label for="party-name">External party name</label><input class="input" id="party-name" name="name" placeholder="Required if no member is selected"></div><div class="field"><label for="party-type">Party type</label><select class="select" id="party-type" name="type"><option value="complainant">Complainant</option><option value="respondent">Respondent</option><option value="witness">Witness</option><option value="admin">Admin</option></select></div></form>`,
    footer: '<button class="btn btn--outline" data-close-dialog>Cancel</button><button class="btn btn--primary" id="save-party">Add party</button>',
    onMount(dialog) {
      dialog.querySelector('#save-party').addEventListener('click', async () => {
        const form = dialog.querySelector('#party-form');
        const values = formValues(form);
        if (!values.userId && !values.name?.trim()) return setFormError(form, 'Select a registered member or enter an external party name.', 'name');

        const saveBtn = dialog.querySelector('#save-party');
        saveBtn.disabled = true;
        saveBtn.textContent = 'Adding party...';

        const partyName = values.userId ? getUser(values.userId)?.name : values.name.trim();

        try {
          await api.post(`/api/superadmin/disputes/${id}/parties`, {
            user_id: values.userId || null,
            party_name: partyName,
            party_type: values.type,
            role_in_dispute: values.type
          });

          const parties = partiesFor(dispute);
          parties.push({
            userId: values.userId || null,
            name: partyName,
            type: values.type
          });
          setParties(dispute, parties);
          addAudit('superadmin_dispute_add_party', `dispute:${id} party:${partyName} type:${values.type}`, 'disputes');
          persistData();
          closeDialog();
          closeDrawer();
          toast('Party added to dispute.', 'success');
          window.dispatchEvent(new CustomEvent('app:refresh'));
          setTimeout(() => openDisputeDetail(id), 50);
        } catch (err) {
          saveBtn.disabled = false;
          saveBtn.textContent = 'Add party';
          toast(api.extractError(err, 'Failed to add party on backend.'), 'error');
        }
      });
    }
  });
}

function openAgreementEditor(id) {
  const dispute = getDispute(id);
  if (!dispute) return;
  const version = (dispute.agreements?.length || 0) + (dispute.agreement ? 1 : 0) + 1;
  openDialog({
    title: `Draft agreement v${version}`,
    subtitle: 'Creates signature requests for every registered dispute party',
    wide: true,
    content: `<form id="agreement-form" class="stack"><div class="field"><label for="agreement-text">Agreement text</label><textarea class="textarea" id="agreement-text" name="text" style="min-height:250px" required placeholder="Record the complete terms for formal review."></textarea></div>${notice('Dispatch moves the dispute to PENDING_SIGNATURES and dispatches signature requests.', 'warning')}</form>`,
    footer: '<button class="btn btn--outline" data-close-dialog>Cancel</button><button class="btn btn--primary" id="dispatch-agreement">Create signature requests</button>',
    onMount(dialog) {
      dialog.querySelector('#dispatch-agreement').addEventListener('click', async () => {
        const form = dialog.querySelector('#agreement-form');
        const values = formValues(form);
        if (!values.text?.trim()) return setFormError(form, 'Agreement text is required.', 'text');

        const dispatchBtn = dialog.querySelector('#dispatch-agreement');
        dispatchBtn.disabled = true;
        dispatchBtn.textContent = 'Dispatching agreement...';

        try {
          const res = await api.post(`/api/superadmin/disputes/${id}/agreement`, {
            agreement_text: values.text.trim()
          });

          const agreement = {
            id: res?.id || uid('ag'),
            version: res?.version_number || version,
            status: 'pending',
            text: values.text.trim(),
            createdBy: currentUser().id,
            createdAt: new Date().toISOString()
          };
          dispute.agreements ||= [];
          dispute.agreements.push(agreement);
          dispute.status = 'pending_signatures';

          addAudit('superadmin_dispute_agreement_create', `dispute:${id} agreement:${agreement.id} v${version}`, 'disputes', 'warning');
          persistData();
          closeDialog();
          closeDrawer();
          toast('Agreement created and signature requests dispatched.', 'success');
          window.dispatchEvent(new CustomEvent('app:refresh'));
          setTimeout(() => openDisputeDetail(id), 50);
        } catch (err) {
          dispatchBtn.disabled = false;
          dispatchBtn.textContent = 'Create signature requests';
          toast(api.extractError(err, 'Failed to draft agreement on backend.'), 'error');
        }
      });
    }
  });
}

function openWaiverEditor(id) {
  const dispute = getDispute(id);
  if (!dispute) return;
  const parties = partiesFor(dispute).filter(party => party.userId);
  openDialog({
    title: 'Draft liability waiver',
    subtitle: 'Type, scope, text, and signatories',
    wide: true,
    content: `<form id="waiver-form" class="stack"><div class="form-grid"><div class="field"><label for="waiver-type">Waiver type</label><select class="select" id="waiver-type" name="type">${waiverTypes.map(type => `<option value="${type}">${titleCase(type)}</option>`).join('')}</select></div><div class="field"><label for="waiver-scope">Scope</label><select class="select" id="waiver-scope" name="scope"><option value="global">Global</option><option value="project">Project</option><option value="individual">Individual</option></select></div></div><div class="field"><label for="waiver-project">Linked project (optional)</label><select class="select" id="waiver-project" name="projectId"><option value="">None</option>${state.data.projects.map(project => `<option value="${project.id}" ${dispute.linkedProjectId === project.id ? 'selected' : ''}>${escapeHTML(project.title)}</option>`).join('')}</select></div><div class="field"><label for="waiver-text">Waiver text</label><textarea class="textarea" id="waiver-text" name="text" style="min-height:180px" required></textarea></div><fieldset class="field" style="border:0;padding:0;margin:0"><legend class="field-label">Signatories</legend>${parties.map(party => `<label class="check"><input type="checkbox" name="signatory" value="${party.userId}" checked> ${escapeHTML(getUser(party.userId)?.name)} · ${titleCase(party.type)}</label>`).join('')}<span class="field-hint">If none are selected, defaults to all registered dispute parties.</span></fieldset></form>`,
    footer: '<button class="btn btn--outline" data-close-dialog>Cancel</button><button class="btn btn--primary" id="dispatch-waiver">Create waiver</button>',
    onMount(dialog) {
      dialog.querySelector('#dispatch-waiver').addEventListener('click', async () => {
        const form = dialog.querySelector('#waiver-form');
        const values = formValues(form);
        if (!values.text?.trim()) return setFormError(form, 'Waiver text is required.', 'text');

        let ids = [...form.querySelectorAll('[name=signatory]:checked')].map(input => input.value);
        if (!ids.length) ids = parties.map(party => party.userId);

        const dispatchBtn = dialog.querySelector('#dispatch-waiver');
        dispatchBtn.disabled = true;
        dispatchBtn.textContent = 'Dispatching waiver...';

        try {
          const res = await api.post(`/api/superadmin/disputes/${id}/waiver`, {
            waiver_type: values.type,
            scope: values.scope,
            project_id: values.projectId || null,
            waiver_text: values.text.trim(),
            user_ids: ids
          });

          const waiver = {
            id: res?.id || uid('wf'),
            type: values.type,
            scope: values.scope,
            projectId: values.projectId || null,
            status: 'pending',
            text: values.text.trim(),
            createdBy: currentUser().id,
            createdAt: new Date().toISOString()
          };
          dispute.waivers ||= [];
          dispute.waivers.push(waiver);

          addAudit('superadmin_waiver_create', `dispute:${id} waiver:${waiver.id} type:${waiver.type} scope:${waiver.scope}`, 'disputes', 'warning');
          persistData();
          closeDialog();
          closeDrawer();
          toast('Liability waiver created and dispatched.', 'success');
          window.dispatchEvent(new CustomEvent('app:refresh'));
          setTimeout(() => openDisputeDetail(id), 50);
        } catch (err) {
          dispatchBtn.disabled = false;
          dispatchBtn.textContent = 'Create waiver';
          toast(api.extractError(err, 'Failed to create liability waiver on backend.'), 'error');
        }
      });
    }
  });
}

function openDisputeSettlement(id) {
  const dispute = getDispute(id);
  if (!dispute) return;
  const parties = partiesFor(dispute).filter(party => party.userId);
  openDialog({
    title: 'Execute financial settlement',
    subtitle: `${dispute.number} · wallet action`,
    content: `<form id="dispute-settlement-form" class="stack">${notice('Wallet credit/debit updates balances and locks the settlement to this dispute.', 'warning')}<div class="form-grid"><div class="field"><label for="settlement-action">Action</label><select class="select" id="settlement-action" name="action"><option value="wallet_credit">Wallet credit</option><option value="wallet_debit">Wallet debit</option><option value="external">External settlement record</option></select></div><div class="field"><label for="dispute-settlement-amount">Amount (INR)</label><input class="input" id="dispute-settlement-amount" name="amount" type="number" min="0" step="0.01" required></div></div><div class="field"><label for="settlement-target">Target member for wallet actions</label><select class="select" id="settlement-target" name="target">${parties.map(party => `<option value="${party.userId}">${escapeHTML(getUser(party.userId)?.name)}</option>`).join('')}</select></div><div class="field"><label for="dispute-settlement-notes">Resolution notes</label><textarea class="textarea" id="dispute-settlement-notes" name="notes"></textarea></div></form>`,
    footer: '<button class="btn btn--outline" data-close-dialog>Cancel</button><button class="btn btn--danger" id="execute-dispute-settlement">Execute settlement</button>',
    onMount(dialog) {
      dialog.querySelector('#execute-dispute-settlement').addEventListener('click', async () => {
        const form = dialog.querySelector('#dispute-settlement-form');
        const values = formValues(form);
        const amount = Number(values.amount);
        if (!Number.isFinite(amount) || amount < 0) return setFormError(form, 'Settlement amount must be a non-negative number.', 'amount');
        if (values.action !== 'external' && !values.target) return setFormError(form, 'A target member is required for wallet credit or debit.', 'target');
        if (!await confirmDialog({ title: 'Lock this settlement?', message: `${titleCase(values.action)} of ${formatINR(amount, 2)} will be recorded and the dispute will move to SETTLED.`, confirmLabel: 'Execute settlement', tone: 'danger' })) return;

        const execBtn = dialog.querySelector('#execute-dispute-settlement');
        execBtn.disabled = true;
        execBtn.textContent = 'Executing settlement...';

        try {
          await api.post(`/api/superadmin/disputes/${id}/settle`, {
            action: values.action,
            amount,
            currency: 'INR',
            target_user_id: values.target || null,
            notes: values.notes?.trim() || ''
          });

          const user = getUser(values.target);
          if (values.action === 'wallet_credit' && user && amount > 0) {
            user.wallet = Number((user.wallet + amount).toFixed(2));
          }
          if (values.action === 'wallet_debit' && user && amount > 0) {
            user.wallet = Number((user.wallet - amount).toFixed(2));
          }
          dispute.settlementAmount = amount;
          dispute.settlementAction = values.action;
          dispute.status = 'settled';
          dispute.resolutionNotes = values.notes?.trim() ? `[Settlement Execution: ${values.action.toUpperCase()}] ${values.notes.trim()}` : dispute.resolutionNotes || null;
          addAudit('superadmin_dispute_settle', `dispute:${id} ${values.action} INR ${amount}`, 'disputes', 'critical');
          persistData();
          closeDialog();
          closeDrawer();
          toast('Financial settlement executed and dispute marked settled.', 'success');
          window.dispatchEvent(new CustomEvent('app:refresh'));
        } catch (err) {
          execBtn.disabled = false;
          execBtn.textContent = 'Execute settlement';
          toast(api.extractError(err, 'Failed to execute settlement on backend.'), 'error');
        }
      });
    }
  });
}
