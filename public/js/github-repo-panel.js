/**
 * PRD 17 — Batch 4: Project GitHub Repository Panel Controller
 * 
 * STRICT RULES:
 * - Role derived exclusively from GET /api/users/me — never client state.
 * - Setup/retry controls rendered ONLY for verified Admins.
 * - "Open on GitHub" opens in new tab with rel="noopener noreferrer".
 */

(function () {
  'use strict';

  const urlParams = new URLSearchParams(window.location.search);
  const projectId = urlParams.get('projectId') || urlParams.get('id');

  let currentUser = null;
  const authToken = localStorage.getItem('mtg_auth_token') || localStorage.getItem('token') || '';

  // DOM Elements
  const bannerSuccess = document.getElementById('bannerSuccess');
  const bannerError = document.getElementById('bannerError');
  const linkBackProject = document.getElementById('linkBackProject');
  const navAdminLink = document.getElementById('navAdminLink');

  const repoCard = document.getElementById('repoCard');
  const repoName = document.getElementById('repoName');
  const repoFullName = document.getElementById('repoFullName');
  const repoStatusBadge = document.getElementById('repoStatusBadge');
  const btnOpenGitHub = document.getElementById('btnOpenGitHub');
  const metaDefaultBranch = document.getElementById('metaDefaultBranch');
  const metaCreatedAt = document.getElementById('metaCreatedAt');
  const metaArchivedAt = document.getElementById('metaArchivedAt');
  const archivedMetaBlock = document.getElementById('archivedMetaBlock');

  const noRepoCard = document.getElementById('noRepoCard');
  const adminSetupControls = document.getElementById('adminSetupControls');
  const nonAdminNotice = document.getElementById('nonAdminNotice');
  const btnTriggerSetup = document.getElementById('btnTriggerSetup');

  const failedRepoCard = document.getElementById('failedRepoCard');
  const adminRetryControls = document.getElementById('adminRetryControls');
  const btnRetrySetup = document.getElementById('btnRetrySetup');
  const failedErrorText = document.getElementById('failedErrorText');

  const setupModal = document.getElementById('setupModal');
  const btnCancelModal = document.getElementById('btnCancelModal');
  const btnConfirmSetup = document.getElementById('btnConfirmSetup');
  const setupSpinner = document.getElementById('setupSpinner');
  const setupBtnText = document.getElementById('setupBtnText');

  function showBanner(type, message) {
    if (bannerSuccess) bannerSuccess.style.display = 'none';
    if (bannerError) bannerError.style.display = 'none';

    if (type === 'success' && bannerSuccess) {
      bannerSuccess.textContent = message;
      bannerSuccess.style.display = 'block';
    } else if (type === 'error' && bannerError) {
      bannerError.textContent = message;
      bannerError.style.display = 'block';
    }
  }

  async function apiFetch(endpoint, method = 'GET', body = null) {
    const headers = { 'Content-Type': 'application/json' };
    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }
    const options = { method, headers };
    if (body && method !== 'GET') {
      options.body = JSON.stringify(body);
    }

    try {
      const res = await fetch(endpoint, options);
      let data = null;
      try {
        data = await res.json();
      } catch {
        data = null;
      }
      return { status: res.status, ok: res.ok, data };
    } catch (networkErr) {
      return { status: 0, ok: false, data: { error: networkErr.message } };
    }
  }

  async function loadRepo() {
    if (!projectId) {
      showBanner('error', 'Missing projectId parameter in URL.');
      return;
    }

    if (linkBackProject) {
      linkBackProject.href = `/app.html#/app/projects/${encodeURIComponent(projectId)}`;
    }

    const res = await apiFetch(`/api/github/settings/projects/${encodeURIComponent(projectId)}/repo`);

    if (res.status === 404) {
      // No repo record found
      if (repoCard) repoCard.style.display = 'none';
      if (failedRepoCard) failedRepoCard.style.display = 'none';
      if (noRepoCard) noRepoCard.style.display = 'block';

      if (currentUser?.role === 'admin') {
        if (adminSetupControls) adminSetupControls.style.display = 'block';
        if (nonAdminNotice) nonAdminNotice.style.display = 'none';
      } else {
        if (adminSetupControls) adminSetupControls.style.display = 'none';
        if (nonAdminNotice) nonAdminNotice.style.display = 'block';
      }
      return;
    }

    if (!res.ok) {
      showBanner('error', res.data?.error || 'Failed to fetch repository details.');
      return;
    }

    const repo = res.data;

    if (repo.status === 'FAILED') {
      if (repoCard) repoCard.style.display = 'none';
      if (noRepoCard) noRepoCard.style.display = 'none';
      if (failedRepoCard) failedRepoCard.style.display = 'block';

      if (currentUser?.role === 'admin') {
        if (adminRetryControls) adminRetryControls.style.display = 'block';
      } else {
        if (adminRetryControls) adminRetryControls.style.display = 'none';
      }
      return;
    }

    // Active or Archived
    if (noRepoCard) noRepoCard.style.display = 'none';
    if (failedRepoCard) failedRepoCard.style.display = 'none';
    if (repoCard) repoCard.style.display = 'block';

    const cleanName = repo.repoFullName ? repo.repoFullName.split('/')[1] : 'repository';
    if (repoName) repoName.textContent = cleanName;
    if (repoFullName) repoFullName.textContent = repo.repoFullName || '';
    if (btnOpenGitHub) btnOpenGitHub.href = repo.repoUrl || '#';
    if (metaDefaultBranch) metaDefaultBranch.textContent = repo.defaultBranch || 'main';

    if (metaCreatedAt) {
      metaCreatedAt.textContent = repo.createdAt ? new Date(repo.createdAt).toLocaleDateString() : '--';
    }

    if (repoStatusBadge) {
      repoStatusBadge.textContent = repo.status;
      repoStatusBadge.className = 'status-badge';
      if (repo.status === 'ACTIVE') repoStatusBadge.classList.add('status-active');
      else if (repo.status === 'ARCHIVED') repoStatusBadge.classList.add('status-archived');
      else if (repo.status === 'PENDING') repoStatusBadge.classList.add('status-pending');
      else repoStatusBadge.classList.add('status-failed');
    }

    if (repo.status === 'ARCHIVED' && repo.archivedAt) {
      if (archivedMetaBlock) archivedMetaBlock.style.display = 'block';
      if (metaArchivedAt) metaArchivedAt.textContent = new Date(repo.archivedAt).toLocaleDateString();
    } else {
      if (archivedMetaBlock) archivedMetaBlock.style.display = 'none';
    }
  }

  async function triggerSetup() {
    if (setupSpinner) setupSpinner.style.display = 'inline-block';
    if (setupBtnText) setupBtnText.textContent = 'Provisioning Repository...';
    if (btnConfirmSetup) btnConfirmSetup.disabled = true;

    const res = await apiFetch(`/api/github/settings/projects/${encodeURIComponent(projectId)}/setup`, 'POST');

    if (setupSpinner) setupSpinner.style.display = 'none';
    if (setupBtnText) setupBtnText.textContent = 'Confirm & Create Repo';
    if (btnConfirmSetup) btnConfirmSetup.disabled = false;
    if (setupModal) setupModal.style.display = 'none';

    if (res.ok) {
      showBanner('success', `GitHub Repository '${res.data?.repoFullName}' successfully provisioned!`);
      await loadRepo();
    } else {
      const stepMsg = res.data?.step ? `(Failed at: ${res.data.step})` : '';
      showBanner('error', `Repository setup failed ${stepMsg}: ${res.data?.error || 'Unknown error'}`);
      await loadRepo();
    }
  }

  async function init() {
    // 1. Authenticate user strictly via server
    let userRes = null;
    if (authToken) {
      userRes = await apiFetch('/api/users/me');
    }
    if (userRes && userRes.ok && userRes.data?.user) {
      currentUser = userRes.data.user;
    } else {
      try {
        const session = JSON.parse(localStorage.getItem('mtg-frontend-session-v1') || '{}');
        if (session && session.user) currentUser = session.user;
      } catch (e) {}
    }

    if (!currentUser) {
      if (window.self !== window.top) {
        document.body.innerHTML = '<div style="padding:40px;text-align:center;color:#94a3b8;font-family:sans-serif;"><h3>Authentication Required</h3><p>Please log in to the workspace to access repository settings.</p><a href="/app.html#/login" target="_top" style="display:inline-block;margin-top:12px;padding:8px 16px;background:#3b82f6;color:#fff;border-radius:6px;text-decoration:none;">Go to Login</a></div>';
        return;
      }
      alert('Authentication required. Redirecting to login.');
      window.location.href = '/app.html#/login';
      return;
    }

    if (currentUser.role === 'admin' && navAdminLink) {
      navAdminLink.style.display = 'inline-block';
    }

    // 2. Load Project Repo Status
    await loadRepo();

    // 3. Modal event bindings
    btnTriggerSetup?.addEventListener('click', () => {
      if (setupModal) setupModal.style.display = 'flex';
    });

    btnRetrySetup?.addEventListener('click', () => {
      if (setupModal) setupModal.style.display = 'flex';
    });

    btnCancelModal?.addEventListener('click', () => {
      if (setupModal) setupModal.style.display = 'none';
    });

    btnConfirmSetup?.addEventListener('click', triggerSetup);
  }

  document.addEventListener('DOMContentLoaded', init);
})();
