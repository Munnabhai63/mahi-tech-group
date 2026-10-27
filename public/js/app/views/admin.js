import { stageMeta } from '../data.js';
import { api } from '../api.js';
import {
  state, currentUser, getUser, getProject, getIdea, getMeeting, getTicket,
  projectProgress, persistData, addAudit, addNotification, downloadCSV,
  formatINR, formatDate, formatDateTime, relativeTime, escapeHTML, titleCase,
  statusTone, initials, uid,
  fetchAdminApplications, fetchAdminMembers, fetchAdminRevenue,
  fetchAdminOffboarding, fetchAdminConfig, fetchAdminAudit,
  isDemoMode
} from '../store.js';
import {
  icon, badge, plainBadge, avatar, person, statCard, progress, pageHead,
  card, notice, emptyState, renderBackendError, withPreview, openDialog, closeDialog, confirmDialog,
  toast, bindTabs, formValues, setFormError
} from '../ui.js';
import { openOverrideDialog } from './ideas.js';
import { openFinalReview, openTaskDialog } from './projects.js';
import { openNotesReview } from './meetings.js';
import { renderAiSettings, bindAiSettings } from '../ai.js';
import { renderAdminPipelineApprovals } from './pipeline.js';

function adminHead(title, description, elevated = false) {
  return `<section class="admin-hero ${elevated ? 'admin-hero--elevated' : ''}"><div><div class="eyebrow" style="color:#b9addf">${elevated ? 'Elevated Admin zone' : 'Admin operations'}</div><h1>${title}</h1><p>${description}</p></div><div class="admin-hero__status">${icon('shield')} Admin access · live backend</div></section>`;
}
function adminStats() {
  const active = state.data.users.filter(user => user.status === 'active');
  const pendingApps = state.data.applications.filter(app => app.status === 'pending');
  const pendingPayouts = state.data.withdrawals.filter(item => item.status === 'PENDING');
  return `<section class="stat-grid">${statCard('Active members', active.length, `${state.data.users.filter(user => user.status === 'inactive').length} former member records`, 'users')}${statCard('Pending applications', pendingApps.length, 'Admin review queue', 'user-plus', pendingApps.length > 0)}${statCard('Active projects', state.data.projects.filter(project => project.stage !== 'LIVE').length, `${state.data.projects.filter(project => project.stage === 'ADMIN_REVIEW').length} at final review`, 'folder')}${statCard('Pending payouts', pendingPayouts.length, formatINR(pendingPayouts.reduce((sum, item) => sum + item.amount, 0)), 'wallet')}</section>`;}

function broadcastRecipients(audience) {
  const active = state.data.users.filter(user => user.status === 'active');
  if (audience === 'all') return active;
  if (audience.startsWith('corner:')) return active.filter(user => user.role === audience.slice(7));
  if (audience.startsWith('user:')) return active.filter(user => user.id === audience.slice(5));
  return [];
}

function openAdminBroadcastNotification() {
  if (currentUser()?.role !== 'admin') return toast('Only Admin can broadcast notifications.', 'error');
  const active = state.data.users.filter(user => user.status === 'active');
  openDialog({
    title: 'Broadcast Notification',
    subtitle: 'Admin broadcast dispatch',
    content: `<form id="admin-broadcast-form" class="stack" novalidate><div class="field"><label for="broadcast-audience">Audience</label><select class="select" id="broadcast-audience" name="audience" required><option value="all">All active users</option>${['researcher', 'developer', 'producer', 'admin'].map(role => `<option value="corner:${role}">${titleCase(role)} corner · active users</option>`).join('')}<optgroup label="Individual active user">${active.map(user => `<option value="user:${user.id}">${escapeHTML(user.name)} · ${titleCase(user.role)}</option>`).join('')}</optgroup></select></div><div class="field"><label for="broadcast-message">Message (required)</label><textarea class="textarea" id="broadcast-message" name="message" required maxlength="500" placeholder="Write the in-app notification message."></textarea><span class="field-hint">Maximum 500 characters.</span></div><section class="broadcast-preview" aria-labelledby="broadcast-preview-title"><div class="eyebrow">Live preview</div><h3 id="broadcast-preview-title">Notification Preview</h3><div id="broadcast-preview-content" class="broadcast-preview__content" aria-live="polite"></div></section></form>`,
    footer: '<button class="btn btn--outline" data-close-dialog>Cancel</button><button class="btn btn--primary" id="review-admin-broadcast">Preview & send broadcast</button>',
    onMount(dialog) {
      const form = dialog.querySelector('#admin-broadcast-form');
      const preview = dialog.querySelector('#broadcast-preview-content');
      const updatePreview = () => {
        const values = formValues(form);
        const recipients = broadcastRecipients(values.audience || '');
        const option = dialog.querySelector('#broadcast-audience').selectedOptions[0];
        preview.innerHTML = `<div class="key-value"><span>Audience</span><strong>${escapeHTML(option?.textContent || 'Not selected')}</strong></div><div class="key-value"><span>Recipients</span><strong>${recipients.length}</strong></div><div class="broadcast-preview__message">${values.message?.trim() ? escapeHTML(values.message.trim()) : '<span class="muted">Your message preview appears here.</span>'}</div>`;
      };
      dialog.querySelector('#broadcast-audience').addEventListener('change', updatePreview);
      dialog.querySelector('#broadcast-message').addEventListener('input', updatePreview);
      updatePreview();
      form.addEventListener('submit', event => { event.preventDefault(); dialog.querySelector('#review-admin-broadcast').click(); });
      dialog.querySelector('#review-admin-broadcast').addEventListener('click', async () => {
        const values = formValues(form);
        const message = values.message?.trim() || '';
        const recipients = broadcastRecipients(values.audience || '');
        if (currentUser()?.role !== 'admin') return setFormError(form, 'Only Admin can broadcast notifications.');
        if (!message) return setFormError(form, 'A broadcast message is required.', 'message');
        if (message.length > 500) return setFormError(form, 'Broadcast message must be 500 characters or fewer.', 'message');
        if (!recipients.length) return setFormError(form, 'Select an audience with at least one active recipient.', 'audience');
        const option = dialog.querySelector('#broadcast-audience').selectedOptions[0];
        if (!await confirmDialog({
          title: 'Confirm Broadcast Notification',
          message: `Send notification to ${recipients.length} recipient${recipients.length === 1 ? '' : 's'}?`,
          detail: `<div class="stack"><div><strong>Audience:</strong> ${escapeHTML(option?.textContent || values.audience)}</div><div class="broadcast-preview__message">${escapeHTML(message)}</div></div>`,
          confirmLabel: 'Send broadcast'
        })) return;
        const confirmedRecipients = broadcastRecipients(values.audience || '');
        confirmedRecipients.forEach(user => addNotification(user.id, 'admin_broadcast', message, '#/app/notifications'));
        addAudit('admin_notification_broadcast', `audience:${values.audience}; recipients:${confirmedRecipients.length}`, 'notifications');
        persistData();
        closeDialog();
        toast(`Broadcast notification sent to ${confirmedRecipients.length} user${confirmedRecipients.length === 1 ? '' : 's'}.`, 'success');
      });
    }
  });
}

export function renderAdminDashboard() {
  if (state.live.backendError && !isDemoMode()) {
    return {
      html: `${adminHead('Operational control, with a record.', 'Member, project, financial, and governance queues across MAHI TECH GROUP.')}${renderBackendError('Admin Operations Offline', 'The backend server is unreachable. Live administrative queues, application reviews, and financial oversight are suspended until connection is restored.')}`,
      mount() {
        fetchAdminApplications();
        fetchAdminMembers();
        fetchAdminRevenue();
      }
    };
  }
  const recent = state.data.auditLogs.slice(0, 6);
  const offboarding = state.data.offboarding.slice(0, 3);
  const content = `${adminStats()}<div class="admin-section-label"><h2>Queues that need a decision</h2><span></span></div><div class="grid-3"><a class="metric-alert" href="#/admin/applications"><span class="metric-alert__icon">${icon('user-plus')}</span><div><strong>${state.data.applications.filter(app => app.status === 'pending').length}</strong><span>Applications to review</span></div>${icon('chevron-right', 'icon--sm')}</a><a class="metric-alert" href="#/admin/projects"><span class="metric-alert__icon">${icon('eye')}</span><div><strong>${state.data.projects.filter(project => project.stage === 'ADMIN_REVIEW').length}</strong><span>Final review gates</span></div>${icon('chevron-right', 'icon--sm')}</a><a class="metric-alert" href="#/admin/revenue"><span class="metric-alert__icon">${icon('wallet')}</span><div><strong>${state.data.withdrawals.filter(item => item.status === 'PENDING').length}</strong><span>Manual payout reviews</span></div>${icon('chevron-right', 'icon--sm')}</a></div><div class="grid-main-side mt-3"><section class="card card--flush"><div class="card-head"><div><h2>Recent operational activity</h2><p>Latest audit events across the organization.</p></div><a class="btn btn--ghost btn--sm" href="#/admin/audit">Full access log ${icon('arrow-up-right', 'icon--sm')}</a></div><div class="card-body">${recent.map(log => `<div class="activity-item"><span class="activity-item__dot">${icon(log.severity === 'critical' ? 'alert' : log.module === 'meetings' ? 'video' : log.module === 'wallet' ? 'wallet' : 'activity')}</span><div><p><strong>${titleCase(log.action)}</strong> · ${escapeHTML(log.resource)}</p><time>${formatDateTime(log.at)} · ${escapeHTML(getUser(log.userId)?.name || 'System')}</time></div></div>`).join('')}</div></section><aside class="stack"><section class="card card--flush"><div class="card-head"><div><h2>Recent offboarding</h2><p>Permanent exit records.</p></div></div><div class="card-body">${offboarding.length ? offboarding.map(record => { const user = getUser(record.userId); return `<a class="list-row list-row--button" href="#/admin/offboarding"><div class="list-row__main">${person(user, `Exited ${formatDate(record.completedAt)}`)}</div>${badge(record.status)}</a>`; }).join('') : emptyState('No offboarding records', 'Member exits will appear here.', '', 'users')}</div></section><section class="card card--pad"><div class="eyebrow">Elevated operations</div><h3 class="mt-1" style="font:600 18px var(--font-display)">Performance, disputes & governance</h3><p class="small muted mt-1">Enter the Admin-only elevated zone for directory exports, internal support notes, gateway controls, and unified audit.</p><a class="btn btn--primary btn--full mt-2" href="#/superadmin">Open elevated zone ${icon('arrow-up-right')}</a></section></aside></div>`;
  return {
    html: `${adminHead('Operational control, with a record.', 'Member, project, financial, and governance queues across MAHI TECH GROUP.')}<div class="dashboard-actions mb-2"><button class="btn btn--primary" id="admin-broadcast-notification">${icon('bell')} Broadcast Notification</button></div>${withPreview(content, { title: 'No Admin operations in this preview', description: 'The empty-state preview hides queues, projects, payouts, and logs.', icon: 'shield' })}`,
    mount() {
      fetchAdminApplications();
      fetchAdminMembers();
      fetchAdminRevenue();
    }
  };
}

export function renderAdminApplications() {
  const applications = state.data.applications;
  const rows = applications.map(app => `<tr data-status="${app.status}" data-search="${escapeHTML(`${app.name} ${app.email} ${app.desiredRole}`.toLowerCase())}"><td>${person({ name: app.name, initials: initials(app.name), role: app.desiredRole, color: '#e3e5dc' }, app.email)}</td><td>${titleCase(app.desiredRole)}${app.desiredSubRole ? `<div class="cell-sub">${titleCase(app.desiredSubRole)}</div>` : ''}</td><td>${formatDateTime(app.submittedAt)}</td><td>${badge(app.status)}${app.localOnly ? '<div class="cell-sub">Browser-only application</div>' : ''}</td><td><div class="row-actions"><button class="btn btn--outline btn--sm" data-review-application="${app.id}">${app.status === 'pending' ? 'Review' : 'View'}</button></div></td></tr>`).join('');
  const content = `<div class="filter-bar"><div class="field field--search"><label for="application-search">Search applications</label><div class="input-wrap">${icon('search')}<input class="input" id="application-search" placeholder="Name, email, or role"></div></div><div class="field"><label for="application-status-filter">Status</label><select class="select" id="application-status-filter"><option value="all">All applications</option><option value="pending">Pending</option><option value="approved">Approved</option><option value="rejected">Rejected</option></select></div><span class="filter-count">${applications.filter(app => app.status === 'pending').length} pending</span></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Applicant</th><th>Desired role</th><th>Submitted</th><th>Status</th><th></th></tr></thead><tbody id="application-rows">${rows}</tbody></table></div>`;
  return {
    html: `${adminHead('Membership applications', 'Review desired roles, assign final roles, and retain application decisions.')}<div class="page-head page-head--compact"><div class="page-head__copy"><div class="eyebrow">Access queue</div><h1>Applications</h1></div></div>${withPreview(content, { title: 'No applications to review', description: 'New signup applications will appear in this queue.', icon: 'user-plus' })}`,
    mount() {
      fetchAdminApplications().catch(() => {});
      document.querySelectorAll('[data-review-application]').forEach(button => button.addEventListener('click', () => openApplicationReview(button.dataset.reviewApplication)));
      const search = document.querySelector('#application-search');
      const status = document.querySelector('#application-status-filter');
      const filter = () => {
        const query = search.value.trim().toLowerCase();
        document.querySelectorAll('#application-rows tr').forEach(row => {
          row.hidden = !((!query || row.dataset.search.includes(query)) && (status.value === 'all' || row.dataset.status === status.value));
        });
      };
      search?.addEventListener('input', filter);
      status?.addEventListener('change', filter);
    }
  };
}

function openApplicationReview(id) {
  const app = state.data.applications.find(item => item.id === id);
  if (!app) return;
  const pending = app.status === 'pending';
  openDialog({
    title: app.name,
    subtitle: `${app.email} · ${titleCase(app.status)} application`,
    content: `<dl class="definition-list"><dt>Desired role</dt><dd>${titleCase(app.desiredRole)}${app.desiredSubRole ? ` · ${titleCase(app.desiredSubRole)}` : ''}</dd><dt>Submitted</dt><dd>${formatDateTime(app.submittedAt)}</dd><dt>Application note</dt><dd>${escapeHTML(app.note || 'No note provided.')}</dd>${app.decisionReason ? `<dt>Decision reason</dt><dd>${escapeHTML(app.decisionReason)}</dd>` : ''}</dl>${app.localOnly ? `<div class="mt-2">${notice('This application originated in the public frontend preview and exists only in this browser.', 'info')}</div>` : ''}${pending ? `<form id="application-decision" class="stack mt-3"><div class="form-grid"><div class="field"><label for="final-role">Final role</label><select class="select" id="final-role" name="role"><option value="researcher" ${app.desiredRole === 'researcher' ? 'selected' : ''}>Researcher</option><option value="designer" ${app.desiredRole === 'designer' ? 'selected' : ''}>UI/UX Designer</option><option value="developer" ${app.desiredRole === 'developer' ? 'selected' : ''}>Developer</option><option value="producer" ${app.desiredRole === 'producer' ? 'selected' : ''}>Producer / Tester</option><option value="admin">Admin</option></select></div><div class="field"><label for="final-subrole">Developer sub-role</label><select class="select" id="final-subrole" name="subRole"><option value="">None</option><option value="frontend" ${app.desiredSubRole === 'frontend' ? 'selected' : ''}>Frontend</option><option value="backend" ${app.desiredSubRole === 'backend' ? 'selected' : ''}>Backend</option></select></div></div><div class="field"><label for="application-reason">Decision reason (optional)</label><textarea class="textarea" id="application-reason" name="reason" placeholder="Add context for the application record."></textarea></div></form>` : ''}`,
    footer: pending ? '<button class="btn btn--outline" data-close-dialog>Cancel</button><button class="btn btn--danger" data-application-decision="reject">Reject</button><button class="btn btn--primary" data-application-decision="approve">Approve & activate</button>' : '<button class="btn btn--primary" data-close-dialog>Close</button>',
    onMount(dialog) {
      dialog.querySelectorAll('[data-application-decision]').forEach(button => button.addEventListener('click', async () => {
        const form = dialog.querySelector('#application-decision');
        const values = formValues(form);
        const decision = button.dataset.applicationDecision;
        if (decision === 'approve' && values.role !== 'developer' && values.subRole) return setFormError(form, 'A sub-role can only be set when the final role is Developer.', 'subRole');
        if (decision === 'approve' && values.role === 'developer' && values.subRole && !['frontend', 'backend'].includes(values.subRole)) return setFormError(form, 'Choose frontend, backend, or no specialization.', 'subRole');

        button.disabled = true;
        const prevText = button.textContent;
        button.textContent = 'Processing...';

        try {
          await api.patch(`/api/admin/applications/${id}/decide`, {
            decision,
            finalRole: decision === 'approve' ? values.role : undefined,
            finalSubRole: decision === 'approve' && values.role === 'developer' ? (values.subRole || null) : null,
            rejectionReason: decision === 'reject' ? (values.reason?.trim() || null) : undefined
          });

          app.status = decision === 'approve' ? 'approved' : 'rejected';
          app.decidedAt = new Date().toISOString();
          app.decisionReason = values.reason?.trim() || null;
          if (decision === 'approve') {
            const role = values.role;
            const subRole = role === 'developer' ? values.subRole || null : null;
            if (!state.data.users.some(user => user.id === app.id)) {
              state.data.users.push({
                id: app.id,
                name: app.name,
                email: app.email,
                role,
                subRole,
                status: 'active',
                initials: initials(app.name),
                joinedAt: new Date().toISOString(),
                lastActive: null,
                bio: app.note || 'New MAHI TECH GROUP member.',
                location: 'Not provided',
                rating: 0, ideas: 0, projects: 0, meetings: 0, wallet: 0, totalEarnings: 0, frozen: false, color: '#e3e5dc'
              });
            }
            addNotification(app.id, 'account', `Your membership application was approved as ${role.toUpperCase()}.`, '#/app/dashboard');
          }
          addAudit(`application_${app.status}`, `application:${app.id} final role:${values.role}`, 'applications', decision === 'approve' ? 'info' : 'warning');
          persistData();
          closeDialog();
          toast(`Application ${app.status} successfully!`, 'success');
          window.dispatchEvent(new CustomEvent('app:refresh'));
        } catch (err) {
          button.disabled = false;
          button.textContent = prevText;
          toast(api.extractError(err, 'Failed to update application decision.'), 'error');
        }
      }));
    }
  });
}

export function renderAdminMembers() {
  const users = state.data.users;
  const content = `<div class="filter-bar"><div class="field field--search"><label for="admin-member-search">Search members</label><div class="input-wrap">${icon('search')}<input class="input" id="admin-member-search" placeholder="Name, email, or role"></div></div><div class="field"><label for="admin-member-role">Role</label><select class="select" id="admin-member-role"><option value="all">All roles</option><option value="researcher">Researcher</option><option value="designer">Designer</option><option value="developer">Developer</option><option value="producer">Producer</option><option value="admin">Admin</option></select></div><div class="field"><label for="admin-member-status">Status</label><select class="select" id="admin-member-status"><option value="all">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option><option value="suspended">Suspended</option></select></div><span class="filter-count" id="admin-member-count">${users.length} records</span></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Member</th><th>Role</th><th>Status</th><th>Projects</th><th>Wallet</th><th>Last active</th><th></th></tr></thead><tbody id="admin-member-rows">${users.map(user => `<tr data-role="${user.role}" data-status="${user.status}" data-search="${escapeHTML(`${user.name} ${user.email} ${user.role}`.toLowerCase())}"><td>${person(user, user.email)}</td><td>${titleCase(user.role)}${user.subRole ? `<div class="cell-sub">${titleCase(user.subRole)}</div>` : ''}</td><td>${badge(user.status)}${user.frozen ? '<div class="cell-sub text-danger">Wallet frozen</div>' : ''}</td><td>${user.projects}</td><td>${formatINR(user.wallet)}</td><td>${formatDate(user.lastActive)}</td><td><div class="row-actions"><a class="btn btn--ghost btn--sm" href="#/app/members/${user.id}">Profile</a><button class="btn btn--outline btn--sm" data-edit-member="${user.id}">Edit role</button><button class="btn btn--ghost btn--sm" data-offboard-member="${user.id}" ${user.id === currentUser().id || user.status !== 'active' ? 'disabled' : ''}>Offboard</button></div></td></tr>`).join('')}</tbody></table></div>`;
  return {
    html: `${adminHead('Member administration', 'Active roles, historical profiles, direct member creation, and the offboarding kill-switch.')}<div class="page-head page-head--compact"><div class="page-head__copy"><div class="eyebrow">Directory</div><h1>Members</h1></div><div class="page-head__actions"><button class="btn btn--primary" id="add-member">${icon('plus')} Add member</button></div></div>${withPreview(content, { title: 'No member records', description: 'Member and former-member records will appear here.', icon: 'users' })}`,
    mount() {
      fetchAdminMembers().catch(() => {});
      document.querySelector('#add-member')?.addEventListener('click', openAddMember);
      document.querySelectorAll('[data-edit-member]').forEach(button => button.addEventListener('click', () => openEditMember(button.dataset.editMember)));
      document.querySelectorAll('[data-offboard-member]').forEach(button => button.addEventListener('click', () => openOffboarding(button.dataset.offboardMember)));
      const search = document.querySelector('#admin-member-search');
      const role = document.querySelector('#admin-member-role');
      const status = document.querySelector('#admin-member-status');
      const filter = () => {
        let count = 0;
        const query = search.value.trim().toLowerCase();
        document.querySelectorAll('#admin-member-rows tr').forEach(row => {
          const show = (!query || row.dataset.search.includes(query)) && (role.value === 'all' || row.dataset.role === role.value) && (status.value === 'all' || row.dataset.status === status.value);
          row.hidden = !show;
          if (show) count++;
        });
        document.querySelector('#admin-member-count').textContent = `${count} records`;
      };
      search?.addEventListener('input', filter);
      role?.addEventListener('change', filter);
      status?.addEventListener('change', filter);
    }
  };
}

function openAddMember() {
  openDialog({
    title: 'Add an active member',
    subtitle: 'Admin direct creation',
    content: `<form id="add-member-form" class="form-grid"><div class="field"><label for="new-member-name">Full name</label><input class="input" id="new-member-name" name="name" required></div><div class="field"><label for="new-member-email">Email</label><input class="input" id="new-member-email" name="email" type="email" required></div><div class="field"><label for="new-member-role">Role</label><select class="select" id="new-member-role" name="role"><option value="researcher">Researcher</option><option value="designer">UI/UX Designer</option><option value="developer">Developer</option><option value="producer">Producer / Tester</option><option value="admin">Admin</option></select></div><div class="field"><label for="new-member-subrole">Developer sub-role</label><select class="select" id="new-member-subrole" name="subRole"><option value="">None</option><option value="frontend">Frontend</option><option value="backend">Backend</option></select></div><div class="field span-2"><label for="new-member-password">Temporary password (optional, min 8 chars)</label><input class="input" id="new-member-password" name="password" type="password" minlength="8" placeholder="Leave blank to auto-generate"><span class="field-hint">Securely hashed via bcrypt on the backend.</span></div></form>`,
    footer: '<button class="btn btn--outline" data-close-dialog>Cancel</button><button class="btn btn--primary" id="save-new-member">Create member</button>',
    onMount(dialog) {
      dialog.querySelector('#save-new-member').addEventListener('click', async () => {
        const form = dialog.querySelector('#add-member-form');
        const values = formValues(form);
        if (!values.name?.trim()) return setFormError(form, 'Name is required.', 'name');
        if (!/^\S+@\S+\.\S+$/.test(values.email || '')) return setFormError(form, 'A valid email is required.', 'email');
        if (state.data.users.some(user => user.email.toLowerCase() === values.email.toLowerCase())) return setFormError(form, 'An account with this email already exists.', 'email');
        if (values.role !== 'developer' && values.subRole) return setFormError(form, 'Sub-role is only allowed for Developers.', 'subRole');
        if (values.password && values.password.length < 8) return setFormError(form, 'Temporary password must be at least 8 characters.', 'password');

        const saveBtn = dialog.querySelector('#save-new-member');
        saveBtn.disabled = true;
        saveBtn.textContent = 'Creating member...';

        try {
          const res = await api.post('/api/admin/members/add', {
            name: values.name.trim(),
            email: values.email.trim().toLowerCase(),
            role: values.role,
            sub_role: values.role === 'developer' ? (values.subRole || null) : null,
            temporary_password: values.password || undefined
          });

          const newUser = res.user ? {
            id: res.user.id,
            name: res.user.name,
            email: res.user.email,
            role: res.user.role,
            subRole: res.user.sub_role || null,
            status: res.user.status || 'active',
            initials: initials(res.user.name),
            joinedAt: new Date().toISOString(),
            lastActive: null,
            bio: 'New member added through Admin directory.',
            location: 'Not provided',
            rating: 0, ideas: 0, projects: 0, meetings: 0, wallet: 0, totalEarnings: 0, frozen: false, color: '#e3e5dc'
          } : {
            id: uid('u'),
            name: values.name.trim(),
            email: values.email.trim().toLowerCase(),
            role: values.role,
            subRole: values.role === 'developer' ? values.subRole || null : null,
            status: 'active',
            initials: initials(values.name),
            joinedAt: new Date().toISOString(),
            lastActive: null,
            bio: 'New member added through Admin directory.',
            location: 'Not provided',
            rating: 0, ideas: 0, projects: 0, meetings: 0, wallet: 0, totalEarnings: 0, frozen: false, color: '#e3e5dc'
          };

          state.data.users.push(newUser);
          addAudit('member_created', `user:${newUser.id} role:${values.role}`, 'members');
          persistData();
          closeDialog();
          const pwNotice = res.temporaryPassword ? ` Temporary password: ${res.temporaryPassword}` : '';
          toast(`Member created successfully!${pwNotice}`, 'success');
          window.dispatchEvent(new CustomEvent('app:refresh'));
        } catch (err) {
          saveBtn.disabled = false;
          saveBtn.textContent = 'Create member';
          toast(api.extractError(err, 'Failed to create member on backend.'), 'error');
        }
      });
    }
  });
}

export function openEditMember(id) {
  const user = getUser(id);
  const self = id === currentUser().id;
  openDialog({
    title: `Edit ${user.name}`,
    subtitle: self ? 'Own Admin role is protected' : 'Role and developer specialization',
    content: `${self ? notice('You cannot modify your own administrative role.', 'danger') : ''}<form id="edit-member-form" class="stack mt-2"><div class="field"><label for="edit-role">Role</label><select class="select" id="edit-role" name="role" ${self ? 'disabled' : ''}>${['researcher', 'designer', 'developer', 'producer', 'admin'].map(role => `<option value="${role}" ${user.role === role ? 'selected' : ''}>${titleCase(role)}</option>`).join('')}</select></div><div class="field"><label for="edit-subrole">Developer sub-role</label><select class="select" id="edit-subrole" name="subRole" ${self ? 'disabled' : ''}><option value="">None</option><option value="frontend" ${user.subRole === 'frontend' ? 'selected' : ''}>Frontend</option><option value="backend" ${user.subRole === 'backend' ? 'selected' : ''}>Backend</option></select></div><div class="field"><label for="edit-status">Account status</label><input class="input" id="edit-status" value="${titleCase(user.status)}" disabled><span class="field-hint">Use offboarding or elevated governance for lifecycle changes.</span></div></form>`,
    footer: '<button class="btn btn--outline" data-close-dialog>Cancel</button><button class="btn btn--primary" id="save-member-role" ' + (self ? 'disabled' : '') + '>Save role</button>',
    onMount(dialog) {
      dialog.querySelector('#save-member-role')?.addEventListener('click', async () => {
        const form = dialog.querySelector('#edit-member-form');
        const values = formValues(form);
        if (self) return;
        if (values.role !== 'developer' && values.subRole) return setFormError(form, 'Sub-role is only allowed for Developers.', 'subRole');

        const saveBtn = dialog.querySelector('#save-member-role');
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving...';

        try {
          await api.patch(`/api/admin/members/${id}`, {
            role: values.role,
            sub_role: values.role === 'developer' ? (values.subRole || null) : null
          });

          const before = `${user.role}/${user.subRole || 'none'}`;
          user.role = values.role;
          user.subRole = values.role === 'developer' ? values.subRole || null : null;
          addAudit('member_role_changed', `user:${id} ${before} -> ${user.role}/${user.subRole || 'none'}`, 'members', 'warning');
          persistData();
          closeDialog();
          toast('Member role updated successfully.', 'success');
          window.dispatchEvent(new CustomEvent('app:refresh'));
        } catch (err) {
          saveBtn.disabled = false;
          saveBtn.textContent = 'Save role';
          toast(api.extractError(err, 'Failed to update member role.'), 'error');
        }
      });
    }
  });
}

export function renderAdminIdeas() {
  const pending = state.data.ideas.filter(idea => idea.status === 'PENDING_REVIEW');
  const history = state.data.ideas.filter(idea => !['PENDING_REVIEW', 'DRAFT'].includes(idea.status));
  const table = ideas => `<div class="table-wrap"><table class="data-table"><thead><tr><th>Idea</th><th>Owner</th><th>Green vote</th><th>Deadline / decision</th><th>Status</th><th></th></tr></thead><tbody>${ideas.map(idea => `<tr><td><a class="table-link" href="#/app/ideas/${idea.id}">${escapeHTML(idea.title)}</a></td><td>${person(getUser(idea.ownerId), getUser(idea.ownerId)?.role)}</td><td><strong>${idea.greenPercentage}%</strong></td><td>${idea.status === 'PENDING_REVIEW' ? formatDateTime(idea.deadline) : formatDate(idea.decisions?.at(-1)?.at)}</td><td>${badge(idea.status)}</td><td><div class="row-actions"><button class="btn btn--outline btn--sm" data-admin-idea="${idea.id}">Admin decision</button></div></td></tr>`).join('')}</tbody></table></div>`;
  const content = `<div data-tab-scope><div class="tabs" data-tabs role="tablist"><button class="tab" data-tab="pending" aria-selected="true">In voting <span class="tab-count">${pending.length}</span></button><button class="tab" data-tab="history" aria-selected="false">Decision history <span class="tab-count">${history.length}</span></button></div><section data-tab-panel="pending">${pending.length ? table(pending) : emptyState('No ideas in voting', 'Submitted ideas awaiting team consensus will appear here.', '', 'vote')}</section><section data-tab-panel="history" hidden>${table(history)}</section></div>`;
  return {
    html: `${adminHead('Idea governance', 'Inspect consensus and record reasoned Admin overrides or vetoes.')}<div class="page-head page-head--compact"><div class="page-head__copy"><div class="eyebrow">Decision control</div><h1>Ideas</h1></div></div>${withPreview(content, { title: 'No idea decisions', description: 'Voting and decision history will appear here.', icon: 'bulb' })}`,
    mount() {
      bindTabs(document);
      document.querySelectorAll('[data-admin-idea]').forEach(button => button.addEventListener('click', () => openOverrideDialog(button.dataset.adminIdea)));
    }
  };
}

export function renderAdminProjects() {
  const projects = state.data.projects;
  const content = `<div data-tab-scope><div class="tabs mb-3" data-tabs role="tablist"><button class="tab" data-tab="projects-list" aria-selected="true">Projects Directory</button><button class="tab" data-tab="pipeline-approvals" aria-selected="false">Pipeline Go-Live Approvals</button></div><section data-tab-panel="projects-list"><div class="filter-bar"><div class="field field--search"><label for="admin-project-search">Search projects</label><div class="input-wrap">${icon('search')}<input class="input" id="admin-project-search" placeholder="Project title or code"></div></div><div class="field"><label for="admin-project-stage">Stage</label><select class="select" id="admin-project-stage"><option value="all">All stages</option>${Object.entries(stageMeta).map(([value, meta]) => `<option value="${value}">${meta.label}</option>`).join('')}<option value="REJECTED_AT_REVIEW">Rejected at review</option></select></div><span class="filter-count">${projects.length} projects</span></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Project</th><th>Stage</th><th>Progress</th><th>Open tasks</th><th>Contributors</th><th>Final gate</th><th></th></tr></thead><tbody id="admin-project-rows">${projects.map(project => { const open = project.tasks.filter(task => task.status !== 'DONE').length; const contributors = new Set(project.tasks.map(task => task.assignedTo).filter(Boolean)).size; return `<tr data-stage="${project.stage}" data-search="${escapeHTML(`${project.title} ${project.code}`.toLowerCase())}"><td><a class="table-link" href="#/app/projects/${project.id}">${escapeHTML(project.title)}</a><div class="cell-sub">${project.code}</div></td><td>${badge(project.stage)}</td><td style="min-width:130px">${progress(projectProgress(project))}<div class="cell-sub">${projectProgress(project)}%</div></td><td>${open}</td><td>${contributors}</td><td>${['ADMIN_REVIEW', 'REJECTED_AT_REVIEW'].includes(project.stage) ? `<button class="btn btn--primary btn--sm" data-final-review="${project.id}">${project.stage === 'REJECTED_AT_REVIEW' ? 'Re-review' : 'Review'}</button>` : project.stage === 'LIVE' ? badge('approved', 'success') : '<span class="small muted">Not ready</span>'}</td><td><a class="btn btn--outline btn--sm" href="#/app/projects/${project.id}">Manage</a></td></tr>`; }).join('')}</tbody></table></div>${notice('Open a project to reassign tasks, inspect dependencies, manage contribution weights, or add organization asset references.', 'info')}</section><section data-tab-panel="pipeline-approvals" hidden><div id="admin-pipeline-approvals-mount"></div></section></div>`;
  return {
    html: `${adminHead('Project pipeline & final gates', 'All projects, assignments, prerequisites, contribution records, and launch decisions.')}<div class="page-head page-head--compact"><div class="page-head__copy"><div class="eyebrow">Delivery control</div><h1>Projects</h1></div></div>${withPreview(content, { title: 'No projects', description: 'Approved ideas will create projects for Admin management.', icon: 'folder' })}`,
    mount() {
      bindTabs(document);
      document.querySelectorAll('[data-final-review]').forEach(button => button.addEventListener('click', () => openFinalReview(button.dataset.finalReview)));
      const search = document.querySelector('#admin-project-search');
      const stage = document.querySelector('#admin-project-stage');
      const filter = () => {
        const query = search.value.trim().toLowerCase();
        document.querySelectorAll('#admin-project-rows tr').forEach(row => {
          row.hidden = !((!query || row.dataset.search.includes(query)) && (stage.value === 'all' || row.dataset.stage === stage.value));
        });
      };
      search?.addEventListener('input', filter);
      stage?.addEventListener('change', filter);

      const approvalsMount = document.querySelector('#admin-pipeline-approvals-mount');
      if (approvalsMount) {
        renderAdminPipelineApprovals(approvalsMount);
      }
      document.querySelector('[data-tab="pipeline-approvals"]')?.addEventListener('click', () => {
        if (approvalsMount) {
          renderAdminPipelineApprovals(approvalsMount);
        }
      });
    }
  };
}

export function renderAdminPipeline() {
  return {
    html: `${adminHead('Pipeline Go-Live Approvals', 'All projects, deliverable stages, and production deployment authorization.')}<div class="page-head page-head--compact"><div class="page-head__copy"><div class="eyebrow">Production Gate</div><h1>Pipeline Approvals</h1></div></div><div class="card card--pad"><div id="admin-pipeline-direct-mount"></div></div>`,
    mount() {
      const mountEl = document.querySelector('#admin-pipeline-direct-mount');
      if (mountEl) {
        renderAdminPipelineApprovals(mountEl);
      }
    }
  };
}

export function renderAdminRevenue() {
  const pending = state.data.withdrawals.filter(item => item.status === 'PENDING');
  const ledger = state.data.ledger;
  const content = `<div class="grid-main-side"><section class="card card--pad"><div class="eyebrow">Record revenue</div><h2 class="mt-1" style="font:600 20px var(--font-display)">Event entry & split preview</h2><form id="revenue-form" class="stack mt-2"><div class="field"><label for="revenue-project">Project</label><select class="select" id="revenue-project" name="projectId">${state.data.projects.map(project => `<option value="${project.id}">${escapeHTML(project.title)} · ${project.stage}</option>`).join('')}</select></div><div class="form-grid"><div class="field"><label for="revenue-amount">Amount (INR)</label><input class="input" id="revenue-amount" name="amount" type="number" step="0.01" placeholder="Nonzero amount" required></div><div class="field"><label for="revenue-date">Event date</label><input class="input" id="revenue-date" name="eventDate" type="date" value="2026-10-25" required></div></div><div class="field"><label for="revenue-source">Source</label><input class="input" id="revenue-source" name="source" value="Direct Platform Revenue" required></div><div id="revenue-preview"></div><button class="btn btn--primary" type="submit">Record revenue event</button></form></section><aside class="stack"><section class="card card--dark card--pad"><div class="eyebrow eyebrow--lime">Manual payout gate</div><div class="focus-panel__number" style="color:var(--lime)">${pending.length}</div><p class="small" style="color:#b7c1b2">Pending withdrawal requests totaling ${formatINR(pending.reduce((sum, item) => sum + item.amount, 0))}.</p></section><section class="card card--pad"><div class="eyebrow">Ledger integrity</div><p class="small muted mt-1">Revenue splits are append-only in the product model. Settlement never edits or deletes historical splits.</p><button class="btn btn--outline btn--full mt-2" id="export-ledger">${icon('download')} Export visible ledger</button></section></aside></div><section class="card card--flush mt-3"><div class="card-head"><div><h2>Pending withdrawals</h2><p>Manual approval deducts balance and marks PAID; rejection requires a reason.</p></div></div>${pending.length ? `<div class="table-wrap" style="border:0"><table class="data-table"><thead><tr><th>Member</th><th>Requested</th><th>Amount</th><th>Wallet</th><th>Status</th><th></th></tr></thead><tbody>${pending.map(item => { const user = getUser(item.userId); return `<tr><td>${person(user, user?.email)}</td><td>${formatDateTime(item.requestedAt)}</td><td class="strong">${formatINR(item.amount)}</td><td>${formatINR(user?.wallet)}${user?.frozen ? '<div class="cell-sub text-danger">Frozen</div>' : ''}</td><td>${badge(item.status)}</td><td><div class="row-actions"><button class="btn btn--outline btn--sm" data-reject-withdrawal="${item.id}">Reject</button><button class="btn btn--primary btn--sm" data-approve-withdrawal="${item.id}">Approve</button></div></td></tr>`; }).join('')}</tbody></table></div>` : emptyState('No pending withdrawals', 'New member withdrawal requests will appear here for manual review.', '', 'check')}</section><section class="card card--flush mt-3"><div class="card-head"><div><h2>Revenue split ledger</h2><p>Recorded owner/team rules and member allocations.</p></div><span class="badge badge--neutral">${ledger.length} entries</span></div><div class="table-wrap" style="border:0"><table class="data-table"><thead><tr><th>Member</th><th>Project / source</th><th>Period</th><th>Rule</th><th>Amount</th></tr></thead><tbody>${[...ledger].reverse().slice(0, 30).map(row => `<tr><td>${person(getUser(row.userId), getUser(row.userId)?.role)}</td><td><span class="cell-title">${escapeHTML(getProject(row.projectId)?.title || row.projectId)}</span><div class="cell-sub">${escapeHTML(row.source)}</div></td><td>${row.month}</td><td>${escapeHTML(row.rule)}</td><td class="text-success strong">${formatINR(row.amount)}</td></tr>`).join('')}</tbody></table></div></section>`;
  return {
    html: `${adminHead('Revenue & payout administration', 'Record project revenue, evaluate the five-month rule, and review every payout manually.')}<div class="page-head page-head--compact"><div class="page-head__copy"><div class="eyebrow">Financial operations</div><h1>Revenue</h1></div></div>${withPreview(content, { title: 'No financial records', description: 'Revenue events, withdrawals, and ledger entries are hidden in this preview.', icon: 'wallet' })}`,
    mount() {
      fetchAdminRevenue().catch(() => {});
      const form = document.querySelector('#revenue-form');
      const updatePreview = () => {
        const values = formValues(form);
        const project = getProject(values.projectId);
        const amount = Number(values.amount);
        if (!project || !values.amount || !Number.isFinite(amount)) {
          document.querySelector('#revenue-preview').innerHTML = '';
          return;
        }
        const start = new Date(project.revenueStart || project.createdAt);
        const boundary = new Date(start);
        boundary.setMonth(boundary.getMonth() + state.data.config.revenueSplitMonths);
        const under = new Date(values.eventDate) < boundary;
        const ownerShare = under ? amount * .5 : 0;
        const teamPool = amount - ownerShare;
        document.querySelector('#revenue-preview').innerHTML = notice(`${under ? 'OWNER_50_TEAM_50' : 'TEAM_100'}: owner ${formatINR(ownerShare, 2)}; team pool ${formatINR(teamPool, 2)}. Boundary ${formatDate(boundary)}.`, 'info', 'Split preview');
      };
      form?.addEventListener('input', updatePreview);
      form?.addEventListener('change', updatePreview);

      form?.addEventListener('submit', async event => {
        event.preventDefault();
        const values = formValues(form);
        const project = getProject(values.projectId);
        const amount = Number(values.amount);
        if (!Number.isFinite(amount) || amount === 0) return setFormError(form, 'Revenue amount must be a nonzero number.', 'amount');
        if (!values.eventDate) return setFormError(form, 'Event date is required.', 'eventDate');
        if (!values.source?.trim()) return setFormError(form, 'Revenue source is required.', 'source');

        const submitBtn = form.querySelector('button[type="submit"]');
        submitBtn.disabled = true;
        submitBtn.textContent = 'Recording revenue...';

        try {
          await api.post(`/api/admin/projects/${project.id}/revenue`, {
            amount,
            source: values.source.trim(),
            event_date: values.eventDate
          });
          recordRevenueLocal(project, amount, values.source.trim(), values.eventDate);
          toast('Revenue event recorded on server and ledger updated.', 'success');
        } catch (err) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Record revenue event';
          toast(api.extractError(err, 'Failed to record revenue event.'), 'error');
        }
      });

      document.querySelectorAll('[data-approve-withdrawal]').forEach(button => button.addEventListener('click', () => reviewWithdrawal(button.dataset.approveWithdrawal, true)));
      document.querySelectorAll('[data-reject-withdrawal]').forEach(button => button.addEventListener('click', () => reviewWithdrawal(button.dataset.rejectWithdrawal, false)));
      document.querySelector('#export-ledger')?.addEventListener('click', () => {
        downloadCSV('mahi-revenue-ledger.csv', [['Member', 'Project', 'Source', 'Period', 'Rule', 'Amount INR'], ...ledger.map(row => [getUser(row.userId)?.name, getProject(row.projectId)?.title, row.source, row.month, row.rule, row.amount])]);
        toast('Ledger CSV generated.', 'info');
      });
    }
  };
}

function recordRevenueLocal(project, amount, source, eventDate) {
  const start = new Date(project.revenueStart || project.createdAt);
  const boundary = new Date(start);
  boundary.setMonth(boundary.getMonth() + state.data.config.revenueSplitMonths);
  const under = new Date(eventDate) < boundary;
  const ownerShare = under ? Number((amount * .5).toFixed(2)) : 0;
  const teamPool = Number((amount - ownerShare).toFixed(2));
  const rule = under ? 'OWNER_50_TEAM_50' : 'TEAM_100';
  const month = eventDate.slice(0, 7);
  const eventId = uid('rev');
  const credits = [];
  if (ownerShare !== 0) credits.push({ userId: project.ownerId, amount: ownerShare, splitType: 'OWNER_ROYALTY' });
  const memberWeights = {};
  project.tasks.filter(task => task.assignedTo).forEach(task => { memberWeights[task.assignedTo] = (memberWeights[task.assignedTo] || 0) + task.weight; });
  const ids = Object.keys(memberWeights);
  const totalWeight = Object.values(memberWeights).reduce((sum, value) => sum + value, 0);
  let allocated = 0;
  ids.forEach((id, index) => {
    const share = index === ids.length - 1 ? Number((teamPool - allocated).toFixed(2)) : Number((teamPool * (totalWeight ? memberWeights[id] / totalWeight : 1 / ids.length)).toFixed(2));
    allocated = Number((allocated + share).toFixed(2));
    credits.push({ userId: id, amount: share, splitType: 'TEAM_SHARE' });
  });
  credits.forEach(credit => {
    const user = getUser(credit.userId);
    state.data.ledger.push({ id: uid('led'), eventId, userId: credit.userId, projectId: project.id, source, gross: amount, amount: credit.amount, rule, splitType: credit.splitType, month, status: user?.frozen ? 'PENDING_SETTLEMENT' : 'APPROVED', createdAt: new Date().toISOString() });
    if (user) {
      if (user.frozen) {
        state.data.pendingSettlements ||= [];
        state.data.pendingSettlements.push({ id: uid('set'), userId: user.id, amount: credit.amount, status: 'PENDING', source: eventId });
      } else {
        user.wallet = Number((user.wallet + credit.amount).toFixed(2));
      }
      user.totalEarnings = Number((user.totalEarnings + credit.amount).toFixed(2));
      addNotification(user.id, 'revenue', `${formatINR(credit.amount)} recorded from ${project.title} (${rule}).`, '#/app/wallet');
    }
  });
  state.data.revenueEvents ||= [];
  state.data.revenueEvents.push({ id: eventId, projectId: project.id, amount, source, eventDate, enteredBy: currentUser().id });
  addAudit('revenue_recorded', `project:${project.id} amount:${amount} rule:${rule} credits:${credits.length}`, 'revenue');
  persistData();
  window.dispatchEvent(new CustomEvent('app:refresh'));
}

function reviewWithdrawal(id, approve) {
  const item = state.data.withdrawals.find(row => row.id === id);
  if (!item) return;
  const user = getUser(item.userId);
  openDialog({
    title: approve ? 'Approve withdrawal' : 'Reject withdrawal',
    subtitle: `${user?.name || 'Member'} · ${formatINR(item.amount, 2)}`,
    content: `${approve ? notice(`Approval deducts ${formatINR(item.amount, 2)} from the wallet and marks the payout PAID.`, 'warning') : `<form id="reject-withdrawal-form"><div class="field"><label for="reject-reason">Mandatory rejection reason</label><textarea class="textarea" id="reject-reason" name="reason" required></textarea></div></form>`}`,
    footer: `<button class="btn btn--outline" data-close-dialog>Cancel</button><button class="btn ${approve ? 'btn--primary' : 'btn--danger'}" id="confirm-withdrawal-review">${approve ? 'Approve payout' : 'Reject request'}</button>`,
    onMount(dialog) {
      dialog.querySelector('#confirm-withdrawal-review').addEventListener('click', async () => {
        if (item.status !== 'PENDING') return toast('This withdrawal has already been reviewed.', 'error');
        const confirmBtn = dialog.querySelector('#confirm-withdrawal-review');
        confirmBtn.disabled = true;
        confirmBtn.textContent = 'Processing...';

        try {
          if (approve) {
            await api.post(`/api/admin/withdrawals/${id}/approve`, {});
            if (user && user.wallet >= item.amount) {
              user.wallet = Number((user.wallet - item.amount).toFixed(2));
            }
            item.status = 'PAID';
            item.reviewedAt = new Date().toISOString();
            addAudit('withdrawal_approved_and_paid', `withdrawal:${id}`, 'wallet');
            addNotification(user?.id, 'wallet', `Your withdrawal request for ${formatINR(item.amount)} was approved and paid.`, '#/app/wallet');
          } else {
            const form = dialog.querySelector('#reject-withdrawal-form');
            const values = formValues(form);
            if (!values.reason?.trim()) {
              confirmBtn.disabled = false;
              confirmBtn.textContent = 'Reject request';
              return setFormError(form, 'Rejection reason is mandatory.', 'reason');
            }
            await api.post(`/api/admin/withdrawals/${id}/reject`, {
              rejection_reason: values.reason.trim()
            });
            item.status = 'REJECTED';
            item.reason = values.reason.trim();
            item.reviewedAt = new Date().toISOString();
            addAudit('withdrawal_rejected', `withdrawal:${id} reason:${item.reason}`, 'wallet', 'warning');
            addNotification(user?.id, 'wallet', `Your withdrawal request was rejected: ${item.reason}`, '#/app/wallet');
          }

          persistData();
          closeDialog();
          toast(approve ? 'Withdrawal approved and marked PAID.' : 'Withdrawal rejected.', 'success');
          window.dispatchEvent(new CustomEvent('app:refresh'));
        } catch (err) {
          confirmBtn.disabled = false;
          confirmBtn.textContent = approve ? 'Approve payout' : 'Reject request';
          toast(api.extractError(err, 'Failed to process withdrawal review.'), 'error');
        }
      });
    }
  });
}

const offboardSteps = [
  ['Revoke active sessions', 'Invalidate session tokens and disconnect active sockets.'],
  ['Disable login', 'Set status to inactive; never delete the member record.'],
  ['Initialize external revocation', 'Create the manual external-service checklist.'],
  ['Set active tasks to Unassigned', 'Incomplete task assignments become null; historical completed tasks stay attributed.'],
  ['Preserve attribution', 'Keep profile, ideas, projects, and earnings history.'],
  ['Freeze wallet', 'Block new withdrawals and snapshot the frozen amount.'],
  ['Write exit audit', 'Create the offboarding record and Admin notification.']
];

export function renderAdminOffboarding() {
  const frozen = state.data.users.filter(user => user.frozen);
  const history = state.data.offboarding;
  const content = `<div class="grid-main-side"><section class="card card--pad"><div class="eyebrow">Offboarding kill-switch</div><h2 class="mt-1" style="font:600 20px var(--font-display)">Seven steps. Strict sequence.</h2><p class="small muted mt-1">Review the workflow before selecting an active member.</p><div class="offboard-steps mt-2">${offboardSteps.map(([title, description]) => `<div class="offboard-step"><div><strong>${title}</strong><p>${description}</p></div>${badge('required', 'neutral')}</div>`).join('')}</div><button class="btn btn--danger mt-2" id="start-offboarding">Start offboarding review</button></section><aside class="stack"><section class="card card--flush"><div class="card-head"><div><h2>Frozen wallets</h2><p>Manual settlement only for inactive members.</p></div></div><div class="card-body">${frozen.length ? frozen.map(user => `<div class="list-row"><div class="list-row__main">${person(user, `Frozen at ${formatINR(user.wallet, 2)}`)}</div><button class="btn btn--outline btn--sm" data-settle-wallet="${user.id}">Settle</button></div>`).join('') : emptyState('No frozen wallets', 'Offboarded members with frozen balances will appear here.', '', 'wallet')}</div></section></aside></div><section class="card card--flush mt-3"><div class="card-head"><div><h2>Offboarding history</h2><p>Core exit records and the manual external-service checklist.</p></div></div>${history.length ? `<div class="table-wrap" style="border:0"><table class="data-table"><thead><tr><th>Member</th><th>Reason</th><th>Completed</th><th>Frozen amount</th><th>Status</th><th></th></tr></thead><tbody>${history.map(record => { const user = getUser(record.userId); return `<tr><td>${person(user, user?.email)}</td><td>${escapeHTML(record.reason)}</td><td>${formatDateTime(record.completedAt)}</td><td>${formatINR(record.frozenAmount ?? user?.wallet ?? 0)}</td><td>${badge(record.status)}</td><td><button class="btn btn--outline btn--sm" data-offboard-status="${record.id}">Checklist</button></td></tr>`; }).join('')}</tbody></table></div>` : emptyState('No offboarding history', 'Completed member exits will appear here.', '', 'archive')}</section>`;
  return {
    html: `${adminHead('Offboarding & settlements', 'Revoke access, preserve attribution, freeze wallets, and keep the exit record.')}<div class="page-head page-head--compact"><div class="page-head__copy"><div class="eyebrow">Member lifecycle</div><h1>Offboarding</h1></div></div>${withPreview(content, { title: 'No offboarding records', description: 'Exit checklists and frozen-wallet settlements will appear here.', icon: 'archive' })}`,
    mount() {
      fetchAdminOffboarding().catch(() => {});
      document.querySelector('#start-offboarding')?.addEventListener('click', () => openOffboarding());
      document.querySelectorAll('[data-offboard-status]').forEach(button => button.addEventListener('click', () => openOffboardingStatus(button.dataset.offboardStatus)));
      document.querySelectorAll('[data-settle-wallet]').forEach(button => button.addEventListener('click', () => openWalletSettlement(button.dataset.settleWallet)));
    }
  };
}

function openOffboarding(preselected = null) {
  const candidates = state.data.users.filter(user => user.status === 'active' && user.id !== currentUser().id);
  openDialog({
    title: 'Offboard a member',
    subtitle: 'Seven-step kill-switch',
    wide: true,
    content: `<form id="offboard-form" class="stack"><div class="field"><label for="offboard-user">Active member</label><select class="select" id="offboard-user" name="userId">${candidates.map(user => `<option value="${user.id}" ${user.id === preselected ? 'selected' : ''}>${escapeHTML(user.name)} · ${titleCase(user.role)}</option>`).join('')}</select></div><div class="field"><label for="offboard-reason">Mandatory reason</label><textarea class="textarea" id="offboard-reason" name="reason" required placeholder="Record why this member is being offboarded."></textarea></div><div class="offboard-steps">${offboardSteps.map(([title, description]) => `<div class="offboard-step"><div><strong>${title}</strong><p>${description}</p></div>${badge('pending', 'warning')}</div>`).join('')}</div>${notice('This will set the member to inactive, unassign incomplete tasks, freeze the wallet balance, and preserve all historical records.', 'danger')}</form>`,
    footer: '<button class="btn btn--outline" data-close-dialog>Cancel</button><button class="btn btn--danger" id="execute-offboarding">Execute kill-switch</button>',
    onMount(dialog) {
      dialog.querySelector('#execute-offboarding').addEventListener('click', async () => {
        const form = dialog.querySelector('#offboard-form');
        const values = formValues(form);
        const user = getUser(values.userId);
        if (!values.reason?.trim()) return setFormError(form, 'An offboarding reason is mandatory.', 'reason');
        if (!user || user.id === currentUser().id || user.status !== 'active') return setFormError(form, 'Select another active member.', 'userId');
        if (!await confirmDialog({ title: `Offboard ${user.name}?`, message: 'This executes the full offboarding sequence and revokes access. Historical attribution is preserved.', confirmLabel: 'Execute all seven steps', tone: 'danger' })) return;

        const execBtn = dialog.querySelector('#execute-offboarding');
        execBtn.disabled = true;
        execBtn.textContent = 'Executing kill-switch...';

        try {
          const res = await api.post(`/api/admin/members/${user.id}/offboard`, {
            reason: values.reason.trim()
          });

          const now = new Date().toISOString();
          const incomplete = state.data.projects.flatMap(project => project.tasks).filter(task => task.assignedTo === user.id && task.status !== 'DONE');
          incomplete.forEach(task => task.assignedTo = null);
          user.status = 'inactive';
          user.exitedAt = now;
          user.frozen = true;
          const frozenAmount = res.frozenAmount ?? user.wallet;
          const obId = res.offboarding?.id || uid('ob');
          const externalChecks = [{ id: 'github_org', service: 'Remove from GitHub org' }, { id: 'google_drive', service: 'Remove from Google Drive shared folders' }, { id: 'figma_team', service: 'Remove from Figma team' }, { id: 'shared_passwords', service: 'Reset any shared passwords' }, { id: 'slack_channels', service: 'Remove from Slack/communication channels' }].map(item => ({ ...item, status: 'PENDING', completedAt: null }));
          state.data.offboarding.unshift({
            id: obId,
            userId: user.id,
            reason: values.reason.trim(),
            status: 'COMPLETED',
            startedAt: now,
            completedAt: now,
            frozenAmount,
            externalChecks,
            steps: offboardSteps.map(([title], index) => ({ step: index + 1, name: title, status: 'DONE' })),
            unassignedTasks: incomplete.map(task => task.id)
          });
          addAudit('member_offboarded', `user:${user.id} ${incomplete.length} tasks unassigned; wallet frozen ${frozenAmount}`, 'offboarding', 'critical');
          addNotification('admin', 'offboarding', `Offboarding complete for ${user.name}. Attribution preserved and wallet frozen.`, '#/admin/offboarding');
          persistData();
          closeDialog();
          toast(`Offboarding completed. ${incomplete.length} tasks unassigned.`, 'success');
          window.dispatchEvent(new CustomEvent('app:refresh'));
        } catch (err) {
          execBtn.disabled = false;
          execBtn.textContent = 'Execute kill-switch';
          toast(api.extractError(err, 'Failed to execute offboarding killswitch.'), 'error');
        }
      });
    }
  });
}

function openOffboardingStatus(id) {
  const record = state.data.offboarding.find(item => item.id === id);
  if (!record) return;
  const user = getUser(record.userId);
  openDialog({
    title: `${user?.name || 'Member'} — exit record`,
    subtitle: `${record.id} · ${record.status}`,
    wide: true,
    content: `<div class="offboard-steps">${record.steps?.length ? record.steps.map(step => `<div class="offboard-step is-done"><div><strong>${escapeHTML(step.name)}</strong><p>Core kill-switch step recorded.</p></div>${badge(step.status)}</div>`).join('') : '<div class="small muted mb-2">Core sequence executed.</div>'}</div><div class="admin-section-label"><h2>External-service checklist</h2><span></span></div><div class="checklist mt-2">${(record.externalChecks || []).map(item => `<label class="checklist-item ${item.status === 'COMPLETED' ? 'is-done' : ''}"><input type="checkbox" data-external-check="${item.id}" ${item.status === 'COMPLETED' ? 'checked' : ''} style="width:18px;height:18px;accent-color:var(--cobalt)"><div><strong>${escapeHTML(item.service)}</strong><p>${item.status}${item.completedAt ? ` · ${formatDateTime(item.completedAt)}` : ''}</p></div></label>`).join('')}</div>`,
    footer: '<button class="btn btn--primary" data-close-dialog>Done</button>',
    onMount(dialog) {
      dialog.querySelectorAll('[data-external-check]').forEach(input => input.addEventListener('change', async () => {
        const item = (record.externalChecks || []).find(check => check.id === input.dataset.externalCheck);
        const isCompleted = input.checked;
        try {
          await api.patch(`/api/admin/offboarding/${id}/checklist`, {
            serviceId: input.dataset.externalCheck,
            completed: isCompleted
          });
          if (item) {
            item.status = isCompleted ? 'COMPLETED' : 'PENDING';
            item.completedAt = isCompleted ? new Date().toISOString() : null;
          }
          addAudit('offboarding_checklist_updated', `offboarding:${id} ${input.dataset.externalCheck}:${isCompleted ? 'COMPLETED' : 'PENDING'}`, 'offboarding', 'warning');
          persistData();
          toast(`${item?.service || 'Checklist'}: ${isCompleted ? 'COMPLETED' : 'PENDING'}`, 'info');
        } catch (err) {
          input.checked = !isCompleted;
          toast(api.extractError(err, 'Failed to update offboarding checklist on backend.'), 'error');
        }
      }));
    }
  });
}

function openWalletSettlement(userId) {
  const user = getUser(userId);
  if (!user) return;
  openDialog({
    title: 'Settle frozen wallet',
    subtitle: `${user.name} · ${formatINR(user.wallet, 2)}`,
    content: `<form id="settlement-form" class="stack">${notice('Settlement creates a permanent record, marks pending settlements SETTLED, zeroes the wallet balance, and unfreezes it.', 'warning')}<div class="field"><label for="settlement-type">Settlement type</label><select class="select" id="settlement-type" name="type"><option value="MANUAL_DISBURSEMENT">Manual disbursement</option><option value="FORFEITURE">Forfeiture record</option></select></div><div class="field"><label for="settlement-notes">Notes</label><textarea class="textarea" id="settlement-notes" name="notes" placeholder="Admin manual settlement notes"></textarea></div></form>`,
    footer: '<button class="btn btn--outline" data-close-dialog>Cancel</button><button class="btn btn--danger" id="execute-settlement">Record settlement</button>',
    onMount(dialog) {
      dialog.querySelector('#execute-settlement').addEventListener('click', async () => {
        if (user.status === 'active' || !user.frozen) return toast('Settlement is only available for an inactive member with a frozen wallet.', 'error');
        const execBtn = dialog.querySelector('#execute-settlement');
        execBtn.disabled = true;
        execBtn.textContent = 'Settling wallet...';

        try {
          const values = formValues(dialog.querySelector('#settlement-form'));
          const res = await api.post(`/api/admin/wallets/${userId}/settle`, {
            settlement_type: values.type,
            notes: values.notes || 'Admin manual settlement'
          });
          const amount = user.wallet;
          state.data.walletSettlements ||= [];
          state.data.walletSettlements.push({
            id: res.settlement?.id || uid('settlement'),
            userId,
            amount,
            status: 'SETTLED',
            type: values.type,
            notes: values.notes || 'Admin manual settlement',
            settledBy: currentUser().id,
            at: new Date().toISOString()
          });
          user.wallet = 0;
          user.frozen = false;
          addAudit('wallet_settlement_manual', `user:${userId} amount:${amount}`, 'wallet', 'critical');
          persistData();
          closeDialog();
          toast('Frozen wallet settled successfully.', 'success');
          window.dispatchEvent(new CustomEvent('app:refresh'));
        } catch (err) {
          execBtn.disabled = false;
          execBtn.textContent = 'Record settlement';
          toast(api.extractError(err, 'Failed to settle frozen wallet on backend.'), 'error');
        }
      });
    }
  });
}

export function renderAdminConfig(params = new URLSearchParams()) {
  const config = state.data.config;
  const aiTab = params?.get?.('tab') === 'ai';
  const general = `<form id="config-form"><div class="config-grid"><section class="config-card"><div class="config-card__head"><span class="config-card__icon">${icon('bulb')}</span><div><h3>Idea quota</h3><p>Submission limit and rolling window. Drafts do not consume quota.</p></div></div><div class="field"><label for="cfg-quota">Idea quota limit</label><input class="input" id="cfg-quota" name="ideaQuota" type="number" min="1" step="1" value="${config.ideaQuota}"></div><div class="field"><label for="cfg-quota-days">Quota window (days)</label><input class="input" id="cfg-quota-days" name="quotaCycleDays" type="number" min="1" step="1" value="${config.quotaCycleDays}"></div></section><section class="config-card"><div class="config-card__head"><span class="config-card__icon">${icon('vote')}</span><div><h3>Voting gate</h3><p>Review window, green-vote threshold, and participation quorum.</p></div></div><div class="field"><label for="cfg-window">Voting window (hours)</label><input class="input" id="cfg-window" name="votingWindowHours" type="number" min="1" step="1" value="${config.votingWindowHours}"></div><div class="field"><label for="cfg-approval">Approval threshold (% green)</label><input class="input" id="cfg-approval" name="approvalThreshold" type="number" min="50" max="100" step="0.1" value="${config.approvalThreshold}"></div><div class="field"><label for="cfg-quorum">Quorum (% participation)</label><input class="input" id="cfg-quorum" name="quorumPercentage" type="number" min="1" max="100" step="0.1" value="${config.quorumPercentage}"></div></section><section class="config-card"><div class="config-card__head"><span class="config-card__icon">${icon('wallet')}</span><div><h3>Revenue split duration</h3><p>Initial Owner 50% / Team 50% period before Team 100%.</p></div></div><div class="field"><label for="cfg-revenue">Duration (1–36 months)</label><input class="input" id="cfg-revenue" name="revenueSplitMonths" type="number" min="1" max="36" step="1" value="${config.revenueSplitMonths}"></div><div class="key-value mt-2"><span>Initial split</span><strong>Owner 50% / Team 50%</strong></div><div class="key-value"><span>After boundary</span><strong>Team 100%</strong></div></section><section class="config-card"><div class="config-card__head"><span class="config-card__icon">${icon('video')}</span><div><h3>Meeting provider</h3><p>Domain used by the meeting provider.</p></div></div><div class="field"><label for="cfg-jitsi">Jitsi domain</label><input class="input" id="cfg-jitsi" name="jitsiDomain" value="${escapeHTML(config.jitsiDomain || 'meet.jit.si')}"></div><div class="key-value mt-2"><span>Organization ID</span><strong>DEFAULT_ORG</strong></div><div class="key-value"><span>Meeting scheduling</span><strong>Admin only</strong></div></section></div><div class="form-actions"><button class="btn btn--primary" type="submit">Save configuration</button></div></form>${notice('Configuration changes are persisted directly to the backend system config.', 'info')}`;
  const content = `<div data-tab-scope><div class="tabs" data-tabs role="tablist" aria-label="Configuration sections"><button class="tab" data-tab="general" aria-selected="${!aiTab}">General</button><button class="tab" data-tab="ai" aria-selected="${aiTab}">AI Settings</button></div><section data-tab-panel="general" ${aiTab ? 'hidden' : ''}>${general}</section><section data-tab-panel="ai" ${aiTab ? '' : 'hidden'}>${renderAiSettings()}</section></div>`;
  return {
    html: `${adminHead('System configuration', 'Quota, voting, revenue, and meeting parameters with explicit validation.')}<div class="page-head page-head--compact"><div class="page-head__copy"><div class="eyebrow">Operational parameters</div><h1>Configuration</h1></div></div>${withPreview(content)}`,
    mount() {
      fetchAdminConfig().catch(() => {});
      bindTabs(document);
      bindAiSettings();
      document.querySelector('#config-form')?.addEventListener('submit', async event => {
        event.preventDefault();
        const form = event.currentTarget;
        const values = formValues(form);
        const integers = ['ideaQuota', 'quotaCycleDays', 'votingWindowHours', 'revenueSplitMonths'];
        for (const key of integers) {
          if (!Number.isInteger(Number(values[key])) || Number(values[key]) < 1) return setFormError(form, `${key} must be a positive integer.`, key);
        }
        if (Number(values.revenueSplitMonths) > 36) return setFormError(form, 'Revenue split duration must be between 1 and 36 months.', 'revenueSplitMonths');
        if (Number(values.approvalThreshold) < 50 || Number(values.approvalThreshold) > 100) return setFormError(form, 'Approval threshold must be between 50 and 100.', 'approvalThreshold');
        if (Number(values.quorumPercentage) < 1 || Number(values.quorumPercentage) > 100) return setFormError(form, 'Quorum must be between 1 and 100.', 'quorumPercentage');
        if (!values.jitsiDomain?.trim()) return setFormError(form, 'Jitsi domain cannot be empty.', 'jitsiDomain');

        const submitBtn = form.querySelector('button[type="submit"]');
        submitBtn.disabled = true;
        submitBtn.textContent = 'Saving configuration...';

        try {
          await api.patch('/api/admin/config/general', {
            revenueSplitDurationMonths: Number(values.revenueSplitMonths),
            ideaQuotaLimit: Number(values.ideaQuota),
            ideaQuotaWindowDays: Number(values.quotaCycleDays),
            votingWindowHours: Number(values.votingWindowHours),
            voteApprovalThreshold: Number(values.approvalThreshold),
            voteQuorumPercentage: Number(values.quorumPercentage),
            jitsiDomain: values.jitsiDomain.trim()
          });

          Object.assign(config, {
            ideaQuota: Number(values.ideaQuota),
            quotaCycleDays: Number(values.quotaCycleDays),
            votingWindowHours: Number(values.votingWindowHours),
            approvalThreshold: Number(values.approvalThreshold),
            quorumPercentage: Number(values.quorumPercentage),
            revenueSplitMonths: Number(values.revenueSplitMonths),
            jitsiDomain: values.jitsiDomain.trim()
          });
          addAudit('general_config_updated', `config:${Object.keys(values).join(',')}`, 'configuration', 'warning');
          persistData();
          submitBtn.disabled = false;
          submitBtn.textContent = 'Save configuration';
          toast('Configuration saved successfully.', 'success');
        } catch (err) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Save configuration';
          toast(api.extractError(err, 'Failed to save configuration.'), 'error');
        }
      });
    }
  };
}

export function renderAdminMeetings() {
  const meetings = state.data.meetings;
  const content = `<div class="table-wrap"><table class="data-table"><thead><tr><th>Meeting</th><th>Schedule</th><th>Status</th><th>Attendance</th><th>Recording</th><th>Notes</th><th></th></tr></thead><tbody>${meetings.map(meeting => `<tr><td><a class="table-link" href="#/app/meetings/${meeting.id}">${escapeHTML(meeting.title)}</a><div class="cell-sub">${meeting.ideaId ? 'Idea review' : 'Ad hoc'}</div></td><td>${formatDateTime(meeting.scheduledAt)}</td><td>${badge(meeting.status)}</td><td>${new Set(meeting.attendance.map(item => item.userId)).size}</td><td>${meeting.recording ? 'Reference added' : meeting.recordingEnabled ? 'Enabled · no file' : 'Disabled'}</td><td>${meeting.notesStatus ? badge(meeting.notesStatus) : '<span class="small muted">No notes</span>'}</td><td><div class="row-actions"><a class="btn btn--outline btn--sm" href="#/app/meetings/${meeting.id}">Manage</a>${meeting.notesStatus === 'PENDING' ? `<button class="btn btn--primary btn--sm" data-confirm-notes="${meeting.id}">Review notes</button>` : ''}</div></td></tr>`).join('')}</tbody></table></div>`;
  return {
    html: `${adminHead('Meeting administration & AI governance', 'Schedules, attendance, recordings, and Admin-confirmed Hindi/English notes.')}<div class="page-head page-head--compact"><div class="page-head__copy"><div class="eyebrow">Meeting control</div><h1>Meetings</h1><p>Scheduling and media controls use the member meeting screen. This queue emphasizes review states.</p></div><div class="page-head__actions"><a class="btn btn--primary" href="#/app/meetings">Open meeting manager</a></div></div>${withPreview(content, { title: 'No meetings', description: 'Meeting administration records will appear here.', icon: 'video' })}`,
    mount() {
      document.querySelectorAll('[data-confirm-notes]').forEach(button => button.addEventListener('click', () => openNotesReview(button.dataset.confirmNotes)));
    }
  };
}

export function renderAdminAudit() {
  const logs = state.data.auditLogs;
  const content = `<div class="filter-bar"><div class="field field--search"><label for="audit-search">Resource or action</label><div class="input-wrap">${icon('search')}<input class="input" id="audit-search" placeholder="Search action or resource"></div></div><div class="field"><label for="audit-user">Actor</label><select class="select" id="audit-user"><option value="all">All actors</option>${state.data.users.map(user => `<option value="${user.id}">${escapeHTML(user.name)}</option>`).join('')}<option value="system">System</option></select></div><div class="field"><label for="audit-date">Date</label><input class="input" id="audit-date" type="date"></div><button class="btn btn--outline" id="export-audit">${icon('download')} Export</button></div><section class="card card--pad" id="admin-audit-list">${logs.map(log => `<article class="audit-event" data-user="${log.userId || 'system'}" data-date="${log.at.slice(0, 10)}" data-search="${escapeHTML(`${log.action} ${log.resource}`.toLowerCase())}"><time>${formatDateTime(log.at)}</time><span class="audit-event__icon">${icon(log.severity === 'critical' ? 'alert' : 'activity')}</span><div class="audit-event__main"><strong><span class="severity-dot severity-dot--${log.severity}"></span>${titleCase(log.action)}</strong><p>${escapeHTML(log.resource)}</p></div><div class="audit-event__actor">${escapeHTML(getUser(log.userId)?.name || 'System')}<br><span class="muted">${titleCase(log.module)}</span></div></article>`).join('')}</section><div id="audit-empty" hidden>${emptyState('No logs match these filters', 'Clear the actor, date, or search filter.', '', 'search')}</div>`;
  return {
    html: `${adminHead('Compliance & access logs', 'Filter member actions, resources, actors, and dates without altering the audit record.')}<div class="page-head page-head--compact"><div class="page-head__copy"><div class="eyebrow">Traceability</div><h1>Access log</h1></div></div>${withPreview(content, { title: 'No access events', description: 'Operational access records will appear here.', icon: 'clipboard' })}`,
    mount() {
      fetchAdminAudit().catch(() => {});
      const search = document.querySelector('#audit-search');
      const user = document.querySelector('#audit-user');
      const date = document.querySelector('#audit-date');
      const filter = () => {
        let count = 0;
        const query = search.value.trim().toLowerCase();
        document.querySelectorAll('#admin-audit-list [data-search]').forEach(log => {
          const show = (!query || log.dataset.search.includes(query)) && (user.value === 'all' || log.dataset.user === user.value) && (!date.value || log.dataset.date === date.value);
          log.hidden = !show;
          if (show) count++;
        });
        document.querySelector('#audit-empty').hidden = count > 0;
      };
      search?.addEventListener('input', filter);
      user?.addEventListener('change', filter);
      date?.addEventListener('change', filter);

      document.querySelector('#export-audit')?.addEventListener('click', () => {
        downloadCSV('mahi-access-log.csv', [['Timestamp', 'Actor', 'Action', 'Resource', 'Module', 'Severity'], ...logs.map(log => [log.at, getUser(log.userId)?.name || 'System', log.action, log.resource, log.module, log.severity])]);
        toast('Access log CSV generated.', 'info');
      });
    }
  };
}

export function renderAdminThresholds() {
  return {
    html: `${adminHead('Participation Threshold Settings', 'Configure minimum participation % gates, grace periods, and auto-settlement revenue unlocks.')}<div class="card card--pad" style="margin-top:1.5rem"><iframe src="/admin-threshold.html?embedded=true&v=179313" style="width:100%;height:850px;border:none;border-radius:8px;background:#090d16;"></iframe></div>`
  };
}

export function renderAdminGitHubTeams() {
  return {
    html: `${adminHead('GitHub Team Permissions & Sync', 'Manage organization members, team sync across research, dev, and core roles, and 2FA status.')}<div class="card card--pad" style="margin-top:1.5rem"><iframe src="/github-members.html?embedded=true&v=179313" style="width:100%;height:850px;border:none;border-radius:8px;background:#090d16;"></iframe></div>`
  };
}

export function renderAdminWebhooks() {
  return {
    html: `${adminHead('GitHub Webhooks & Event Ledger', 'Live webhook event stream, signature verification audits, retry execution, and delivery status.')}<div class="card card--pad" style="margin-top:1.5rem"><iframe src="/github-webhook-log.html?embedded=true&v=179313" style="width:100%;height:850px;border:none;border-radius:8px;background:#090d16;"></iframe></div>`
  };
}

