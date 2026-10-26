import { roleMeta } from '../data.js';
import { state, loginAs, loginFormer, loginWithCredentials, signupApplicant, persistData, addAudit, uid, escapeHTML } from '../store.js';
import { icon, badge, notice, formValues, setFormError, openDialog, closeDialog, toast } from '../ui.js';

function accessLayout(content, { wide = false, intro = null } = {}) {
  return `<div class="access-page"><section class="access-intro"><a class="access-brand" href="/" aria-label="MAHI TECH GROUP homepage"><span class="brand-mark">M/</span><span><strong>MAHI TECH GROUP</strong><small>COLLABORATIVE WORKSPACE</small></span></a><div class="access-intro__body">${intro || `<div class="eyebrow eyebrow--lime">Ideas into shared outcomes</div><h1>One team.<br><em>Many disciplines.</em></h1><p>A role-aware workspace for research, design, development, testing, governance, and the decisions that connect them.</p><div class="access-points"><div class="access-point">${icon('vote')}<span>Score and vote on evidenced proposals.</span></div><div class="access-point">${icon('layers')}<span>Move through parallel tracks and explicit quality gates.</span></div><div class="access-point">${icon('shield')}<span>Keep ownership, attribution, and administration visible.</span></div></div>`}</div><div class="access-intro__foot"><a href="#/about">About</a><a href="#/legal/terms">Terms</a><a href="#/legal/privacy">Privacy</a><span>Collaborative Workspace</span></div></section><section class="access-content"><div class="access-topbar"><span class="prototype-badge">Verified System</span><nav class="access-topbar__links" aria-label="Public access"><a href="#/about">Platform</a><a href="#/contact">Access & support</a><a href="#/login">Member access</a></nav></div><div class="access-form-wrap ${wide ? 'access-form-wrap--wide' : ''}">${content}</div></section></div>`;
}

export function renderLogin() {
  const sessionExpired = typeof location !== 'undefined' && location.hash.includes('session=expired');
  const content = `<div class="eyebrow">Member access</div><h2>Welcome back to the workspace.</h2><p class="access-form-wrap__intro">Enter your credentials to access your active workspace, tasks, and project records.</p>${sessionExpired ? notice('Your session has expired or was invalidated. Please sign in again with your credentials.', 'warning', 'Session expired', 'lock') : (state.session ? notice('A workspace session is currently active. You can continue or log in with another account.', 'info', 'Active session') : '')}<form id="login-form" class="stack mt-2" novalidate><div class="field"><label for="login-email">Email address</label><input class="input" id="login-email" name="email" type="email" autocomplete="email" placeholder="you@example.com" required></div><div class="field"><label for="login-password">Password</label><div class="input-wrap input-wrap--action"><input class="input" id="login-password" name="password" type="password" autocomplete="current-password" placeholder="At least 8 characters" required minlength="8"><button class="btn btn--ghost btn--icon btn--sm" type="button" id="toggle-password" aria-label="Show password">${icon('eye', 'icon--sm')}</button></div></div><div class="spread"><label class="check"><input type="checkbox" name="remember" checked> Remember this device</label><button type="button" class="link-btn small" id="recovery-placeholder">Recovery options</button></div><button class="btn btn--primary btn--lg btn--full" id="login-submit" type="submit">Sign in to workspace ${icon('arrow-up-right')}</button></form><div class="demo-box"><div class="demo-box__head"><strong>Explore with test accounts</strong><span>Instant role access</span></div><div class="demo-roles">${Object.entries(roleMeta).map(([role, meta]) => `<button class="demo-role" data-demo-role="${role}">${meta.label}</button>`).join('')}<button class="demo-role" data-demo-role="former">Former member</button></div></div><p class="access-form-wrap__foot">New to the group? <a class="link-btn" href="#/signup">Submit a membership application</a></p>`;
  return { html: accessLayout(content), mount() {
    document.querySelector('#toggle-password')?.addEventListener('click', event => {
      const input = document.querySelector('#login-password'); const showing = input.type === 'text';
      input.type = showing ? 'password' : 'text'; event.currentTarget.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
    });
    document.querySelector('#recovery-placeholder')?.addEventListener('click', () => openDialog({ title: 'Account recovery', subtitle: 'Self-service recovery', content: notice('For account recovery or password resets, contact your organization administrator or submit a ticket via Access & Support.', 'info'), footer: '<button class="btn btn--primary" data-close-dialog>Close</button>' }));
    
    document.querySelector('#login-form')?.addEventListener('submit', async event => {
      event.preventDefault();
      const form = event.currentTarget;
      const submitBtn = document.querySelector('#login-submit');
      const values = formValues(form);

      if (!/^\S+@\S+\.\S+$/.test(values.email || '')) return setFormError(form, 'Enter a valid email address.', 'email');
      if ((values.password || '').length < 8) return setFormError(form, 'Password must contain at least 8 characters.', 'password');

      submitBtn.disabled = true;
      submitBtn.textContent = 'Authenticating...';

      try {
        const result = await loginWithCredentials(values.email, values.password);
        toast(`Welcome back, ${result.user?.name || 'Member'}!`, 'success');
        if (result.user?.role === 'admin') {
          location.hash = '#/admin';
        } else if (result.user?.status === 'inactive') {
          location.hash = '#/app/former-member';
        } else {
          location.hash = '#/app/dashboard';
        }
      } catch (err) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = `Sign in to workspace ${icon('arrow-up-right')}`;
        
        const msg = err.message || '';
        if (err.status === 403) {
          if (msg.includes('pending')) {
            location.hash = '#/application-status?status=pending';
            return;
          }
          if (msg.includes('rejected')) {
            location.hash = '#/application-status?status=rejected';
            return;
          }
          if (msg.includes('suspended')) {
            return setFormError(form, 'Account Suspended: Access blocked pending administrative review.');
          }
          if (msg.includes('inactive')) {
            location.hash = '#/app/former-member';
            return;
          }
        }
        setFormError(form, msg || 'Login failed. Please check your credentials.');
      }
    });

    document.querySelectorAll('[data-demo-role]').forEach(button => button.addEventListener('click', () => {
      const role = button.dataset.demoRole;
      if (role === 'former') { loginFormer(); location.hash = '#/app/former-member'; }
      else { loginAs(role); location.hash = role === 'admin' ? '#/admin' : '#/app/dashboard'; }
    }));
  } };
}

export function renderRoleSelection() {
  const roles = Object.entries(roleMeta).map(([role, meta]) => `<button class="role-card" data-select-role="${role}"><span class="role-card__icon">${icon(meta.icon)}</span><span><h3>${meta.label}</h3><p>${meta.description}</p></span>${icon('chevron-right')}</button>`).join('');
  const content = `<div class="eyebrow">Role workspace preview</div><h2>Choose your working view.</h2><p class="access-form-wrap__intro">Each identity accesses organization data with role-appropriate tasks, actions, and financial privacy.</p><div class="role-grid">${roles}<button class="role-card" data-select-role="elevated"><span class="role-card__icon">${icon('key')}</span><span><h3>Elevated admin zone</h3><p>Open the admin-only performance, dispute, gateway, governance, and audit views.</p></span>${icon('chevron-right')}</button></div><div class="mt-3">${notice('Elevated administration is an access area for the Admin role, not an additional member role.', 'info')}</div><p class="access-form-wrap__foot"><button class="link-btn" data-select-role="former">Preview a read-only former-member account</button> · <a class="link-btn" href="#/login">Back to login</a></p>`;
  return { html: accessLayout(content, { wide: true }), mount() {
    document.querySelectorAll('[data-select-role]').forEach(button => button.addEventListener('click', () => {
      const role = button.dataset.selectRole;
      if (role === 'former') { loginFormer(); location.hash = '#/app/former-member'; return; }
      if (role === 'elevated') { loginAs('admin', { elevated: true }); location.hash = '#/superadmin'; return; }
      loginAs(role); location.hash = role === 'admin' ? '#/admin' : '#/app/dashboard';
    }));
  } };
}

export function renderSignup() {
  const content = `<div class="eyebrow">Membership application</div><h2>Start with how you want to contribute.</h2><p class="access-form-wrap__intro">Applications enter the Administrator review queue. Upon approval, your login is activated.</p><form id="signup-form" class="form-grid" novalidate><div class="field"><label for="signup-name">Full name</label><input class="input" id="signup-name" name="name" autocomplete="name" required placeholder="Your full name"></div><div class="field"><label for="signup-email">Email address</label><input class="input" id="signup-email" name="email" type="email" autocomplete="email" required placeholder="you@example.com"></div><div class="field"><label for="signup-password">Password</label><input class="input" id="signup-password" name="password" type="password" autocomplete="new-password" required minlength="8" placeholder="Minimum 8 characters"><span class="field-hint">Must contain at least 8 characters.</span></div><div class="field"><label for="signup-role">Desired role</label><select class="select" id="signup-role" name="desiredRole" required><option value="">Select a role</option><option value="researcher">Researcher</option><option value="designer">UI/UX Designer</option><option value="developer">Developer</option><option value="producer">Producer / Tester</option></select></div><div class="field span-2" id="subrole-field" hidden><label for="signup-subrole">Developer specialization</label><select class="select" id="signup-subrole" name="desiredSubRole"><option value="">Select specialization</option><option value="frontend">Frontend</option><option value="backend">Backend</option></select><span class="field-hint">The current application contract supports frontend and backend specializations.</span></div><div class="field span-2"><label for="signup-note">What would you like to work on?</label><textarea class="textarea" id="signup-note" name="note" required placeholder="Tell the reviewing Admin about your interests, working style, or relevant experience."></textarea></div><label class="check span-2"><input type="checkbox" name="terms" required><span>I have reviewed the <a class="link-btn" href="#/legal/terms">terms</a> and <a class="link-btn" href="#/legal/privacy">privacy notice</a>, and agree to collaborative workspace terms.</span></label><div class="span-2 form-actions"><a class="btn btn--outline" href="#/login">Cancel</a><button class="btn btn--primary" id="signup-submit" type="submit">Submit application ${icon('arrow-up-right')}</button></div></form>`;
  return { html: accessLayout(content, { wide: true }), mount() {
    const role = document.querySelector('#signup-role');
    role?.addEventListener('change', () => { document.querySelector('#subrole-field').hidden = role.value !== 'developer'; });
    
    document.querySelector('#signup-form')?.addEventListener('submit', async event => {
      event.preventDefault();
      const form = event.currentTarget;
      const submitBtn = document.querySelector('#signup-submit');
      const values = formValues(form);

      if (!values.name?.trim()) return setFormError(form, 'Enter your full name.', 'name');
      if (!/^\S+@\S+\.\S+$/.test(values.email || '')) return setFormError(form, 'Enter a valid email address.', 'email');
      if ((values.password || '').length < 8) return setFormError(form, 'Password must contain at least 8 characters.', 'password');
      if (!values.desiredRole) return setFormError(form, 'Choose the role you want Admin to review.', 'desiredRole');
      if (values.desiredRole === 'developer' && !['frontend', 'backend'].includes(values.desiredSubRole)) return setFormError(form, 'Choose a frontend or backend specialization.', 'desiredSubRole');
      if (!values.note?.trim()) return setFormError(form, 'Add a short note for the reviewing Admin.', 'note');
      if (!values.terms) return setFormError(form, 'Review and accept the platform terms to continue.', 'terms');

      submitBtn.disabled = true;
      submitBtn.textContent = 'Submitting application...';

      try {
        const payload = {
          name: values.name.trim(),
          email: values.email.trim().toLowerCase(),
          password: values.password,
          desired_role: values.desiredRole,
          desired_sub_role: values.desiredRole === 'developer' ? values.desiredSubRole : null
        };

        const res = await signupApplicant(payload);
        const applicationId = res.user?.id || uid('app');

        // Persist application snapshot in sessionStorage per Rule 4 decision
        try {
          sessionStorage.setItem('mtg_last_application', JSON.stringify({
            id: applicationId,
            name: values.name.trim(),
            email: values.email.trim().toLowerCase(),
            desiredRole: values.desiredRole,
            desiredSubRole: values.desiredRole === 'developer' ? values.desiredSubRole : null,
            note: values.note.trim(),
            status: 'pending',
            submittedAt: new Date().toISOString()
          }));
        } catch {}

        toast('Application submitted successfully! Awaiting Admin review.', 'success');
        location.hash = `#/application-status?id=${encodeURIComponent(applicationId)}&status=pending`;
      } catch (err) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = `Submit application ${icon('arrow-up-right')}`;
        setFormError(form, err.message || 'Failed to submit application.');
      }
    });
  } };
}

export function renderApplicationStatus(params) {
  let savedApp = null;
  try {
    const raw = sessionStorage.getItem('mtg_last_application');
    if (raw) savedApp = JSON.parse(raw);
  } catch {}

  const paramId = params.get('id');
  const application = (savedApp && (!paramId || savedApp.id === paramId)) ? savedApp : null;
  const status = params.get('status') || application?.status || 'pending';

  const contentByState = {
    pending: { 
      icon: 'clock', 
      title: application ? 'Application pending review' : 'Under review / check inbox', 
      text: application ? 'An Administrator will review your submitted application details before activating access. Once approved, you can log in immediately.' : 'All membership applications enter the Administrator governance queue for review. If you have already applied, please check your inbox for an activation notice once your account is approved.', 
      tone: 'warning' 
    },
    approved: { icon: 'check', title: 'Application approved', text: 'Your membership application has been approved! You may now sign in with your email and password.', tone: 'success' },
    rejected: { icon: 'x', title: 'Application not approved', text: 'Your application was reviewed and could not be approved at this time. If you believe this is an error, please reach out via support.', tone: 'danger' }
  };
  const view = contentByState[status] || contentByState.pending;
  const content = `<div class="eyebrow">Application status</div><h2>Review access, made visible.</h2><p class="access-form-wrap__intro">${application ? `Application for <strong>${escapeHTML(application.name)}</strong> · ${escapeHTML(application.email)}` : 'Check the status of your membership application.'}</p><div class="status-hero"><span class="status-hero__icon">${icon(view.icon)}</span>${badge(status, view.tone)}<h3>${view.title}</h3><p>${view.text}</p>${application ? `<dl class="definition-list w-full mt-2" style="text-align:left"><dt>Desired role</dt><dd>${escapeHTML(application.desiredRole)}${application.desiredSubRole ? ` · ${escapeHTML(application.desiredSubRole)}` : ''}</dd><dt>Reference ID</dt><dd class="mono">${escapeHTML(application.id)}</dd><dt>Submitted</dt><dd>${new Date(application.submittedAt).toLocaleDateString('en-IN')}</dd><dt>Note</dt><dd>${escapeHTML(application.note || 'None provided')}</dd></dl>` : ''}</div><div class="demo-box"><div class="demo-box__head"><strong>Application guidance</strong><span>Check back later</span></div><p class="small muted">Administrator reviews typically occur during weekly governance windows. Once approved, you can sign in directly.</p></div><p class="access-form-wrap__foot"><a class="link-btn" href="#/login">Return to login</a> · <a class="link-btn" href="#/contact">Access & support</a></p>`;
  return { html: accessLayout(content) };
}

export function renderAbout() {
  const intro = `<div class="eyebrow eyebrow--lime">About the platform</div><h1>Work is shared.<br><em>Context stays visible.</em></h1><p>MAHI TECH GROUP connects collaborative delivery with explicit voting, task, ownership, financial, and governance workflows.</p>`;
  const content = `<div class="eyebrow">About MAHI TECH GROUP</div><h2>A workspace for the whole delivery cycle.</h2><p class="access-form-wrap__intro">A multi-role product studio in which approved ideas become organization-owned projects with traceable contribution and administration.</p><article class="public-article"><h3>From proposal to project</h3><p>Researchers can draft and submit ideas subject to a configured quota. Submitted ideas enter a voting window. Active members other than the owner cast one green or red vote, optionally scoring feasibility, market, and capacity from 0–10.</p><div class="workflow-list"><div class="workflow-step"><span>01</span><div><h3>Apply and activate</h3><p>Signup creates a pending application. Admin approval activates access; rejected, pending, inactive, and suspended accounts have distinct states.</p></div></div><div class="workflow-step"><span>02</span><div><h3>Vote with a quorum</h3><p>The implemented configuration uses a 48-hour window, 70% participation quorum, and 70% green-vote approval threshold. Insufficient quorum can extend the window.</p></div></div><div class="workflow-step"><span>03</span><div><h3>Fan out in parallel</h3><p>Deep Research unlocks backend architecture, frontend scaffolding, UI/UX design, and test preparation together. Integration, QA, and Admin final review follow explicit prerequisites.</p></div></div><div class="workflow-step"><span>04</span><div><h3>Preserve the record</h3><p>Organization-owned assets, contributor attribution, decision history, access logs, and permanent profile history keep operational context available.</p></div></div></div><h3>Revenue and member history</h3><p>The current service rules split revenue 50% Owner / 50% Team for the first five months, then allocate 100% to Team. Withdrawals always require manual Admin approval. Former members retain read-only attribution while withdrawals and active access are disabled.</p></article><div class="form-actions"><a class="btn btn--outline" href="#/contact">Access & support</a><a class="btn btn--primary" href="#/login">Sign in to workspace ${icon('arrow-up-right')}</a></div>`;
  return { html: accessLayout(content, { wide: true, intro }) };
}

export function renderContact() {
  const content = `<div class="eyebrow">Access & support</div><h2>Choose the right way into the workspace.</h2><p class="access-form-wrap__intro">Start a membership application, continue with an existing account, or inspect the collaborative delivery model.</p><div class="contact-options"><a class="contact-option" href="#/signup">${icon('user-plus')}<strong>New membership</strong><span>Submit an application for Admin review</span></a><a class="contact-option" href="#/login">${icon('user')}<strong>Member access</strong><span>Sign in to your member workspace</span></a><a class="contact-option" href="#/role-selection">${icon('layers')}<strong>Explore roles</strong><span>Compare five role-aware workspaces</span></a></div><article class="public-article"><h3>Support stays connected to the work</h3><p>After entering your workspace, use Support in the sidebar to inspect existing tickets or create a new support ticket. The system categories cover bugs, feature requests, access issues, billing, and operational topics.</p><p>Ticket replies, status changes, priority, internal Admin notes, and audit events remain inside the production workflow.</p></article><div class="mt-3">${notice('Need platform context first? Review the delivery model, voting rules, role boundaries, and service specifications before entering the workspace.', 'info')}</div><div class="form-actions"><a class="btn btn--outline" href="#/about">Review the platform</a><a class="btn btn--primary" href="#/login">Member access ${icon('arrow-up-right')}</a></div>`;
  return { html: accessLayout(content, { wide: true }) };
}

export function renderLegal(type = 'terms') {
  const privacy = type === 'privacy';
  const content = `<div class="eyebrow">Legal & data boundaries</div><h2>${privacy ? 'Privacy and financial visibility.' : 'Terms of service.'}</h2><p class="access-form-wrap__intro">Last updated: 2026. These specifications define the operational boundaries of the collaborative workspace.</p><article class="public-article">${privacy ? `<h3>Data handling & storage</h3><p>Operational identities, projects, financial entries, support messages, and signatures are securely managed within the deployed backend architecture. Do not share credentials or transmit unverified external files.</p><h3>Profile history and attribution</h3><p>The product model preserves permanent profile and project history. Former-member profiles are read-only and retain historical contribution attribution.</p><h3>Financial visibility</h3><p>Detailed earnings are visible to the owner and Admin. Other members viewing a profile see aggregate totals rather than a detailed earnings ledger. Frozen wallets cannot initiate withdrawals.</p><h3>Administrative records</h3><p>The product model includes access logs, audit events, support tickets, internal Admin notes, governance records, and dispute documents. Internal support notes are hidden from the member thread and shown only in elevated administration.</p>` : `<h3>Membership workflow</h3><p>The workflow requires Admin review of applications. Pending, rejected, inactive, and suspended accounts do not provide active workspace access. Role permissions determine which tasks and operational actions are available.</p><h3>Organization assets and attribution</h3><p>Approved ideas become organization-owned projects. Project assets use organization ownership, while contributor attribution and profile history remain visible.</p><h3>Voting and administration</h3><p>Voting, Admin overrides, revenue records, payouts, offboarding, and governance actions have explicit states and audit requirements.</p><h3>Digital documents</h3><p>Agreement and waiver screens demonstrate review, acceptance, decline, and digital signature recording with IP and timestamp auditing.</p>`}</article><div class="form-actions"><a class="btn btn--outline" href="#/legal/${privacy ? 'terms' : 'privacy'}">Read ${privacy ? 'terms' : 'privacy'}</a><a class="btn btn--primary" href="#/login">Return to access</a></div>`;
  return { html: accessLayout(content, { wide: true }) };
}
