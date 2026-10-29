/**
 * PRD 17 — Batch 4: GitHub Account Linking Controller
 * 
 * STRICT RULES:
 * - Role derived exclusively from GET /api/users/me — never localStorage.
 * - Admin panel rendered only when role === 'admin'.
 * - No auto-fetching of node_id (user enters manually).
 */

(function () {
  'use strict';

  let currentUser = null;
  const authToken = localStorage.getItem('mtg_auth_token') || localStorage.getItem('token') || '';

  // DOM Elements
  const bannerSuccess = document.getElementById('bannerSuccess');
  const bannerError = document.getElementById('bannerError');
  const navAdminLink = document.getElementById('navAdminLink');

  const linkedState = document.getElementById('linkedState');
  const linkedUsername = document.getElementById('linkedUsername');
  const linkedDate = document.getElementById('linkedDate');
  const linkForm = document.getElementById('linkForm');
  const inputGithubUsername = document.getElementById('inputGithubUsername');
  const inputGithubNodeId = document.getElementById('inputGithubNodeId');
  const btnSubmitLink = document.getElementById('btnSubmitLink');

  const adminLinkCard = document.getElementById('adminLinkCard');
  const adminLinkForm = document.getElementById('adminLinkForm');
  const selectMember = document.getElementById('selectMember');
  const inputAdminGithubUsername = document.getElementById('inputAdminGithubUsername');
  const inputAdminGithubNodeId = document.getElementById('inputAdminGithubNodeId');
  const btnSubmitAdminLink = document.getElementById('btnSubmitAdminLink');

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

  async function loadMyLink() {
    const res = await apiFetch('/api/github/settings/my-link');
    if (!res.ok) {
      showBanner('error', res.data?.error || 'Failed to load GitHub link status');
      return;
    }

    if (res.data && res.data.linked) {
      if (linkedUsername) linkedUsername.textContent = `@${res.data.githubUsername}`;
      if (linkedDate) {
        const d = res.data.linkedAt ? new Date(res.data.linkedAt).toLocaleDateString() : 'Active';
        linkedDate.textContent = `Connected on ${d}`;
      }
      if (linkedState) linkedState.style.display = 'block';
      if (linkForm) linkForm.style.display = 'none';
    } else {
      if (linkedState) linkedState.style.display = 'none';
      if (linkForm) linkForm.style.display = 'block';
    }
  }

  async function loadAdminMembers() {
    if (currentUser?.role !== 'admin' || !selectMember) return;

    const res = await apiFetch('/api/admin/members');
    if (!res.ok || !Array.isArray(res.data)) {
      return;
    }

    // Populate dropdown with active members
    selectMember.innerHTML = '<option value="">-- Choose Member --</option>';
    res.data.forEach((member) => {
      const opt = document.createElement('option');
      opt.value = member.id;
      opt.textContent = `${member.name} (${member.role || 'member'}) — ${member.email}`;
      selectMember.appendChild(opt);
    });
  }

  async function init() {
    // 1. Authenticate user strictly via server with session fallback
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
        document.body.innerHTML = '<div style="padding:40px;text-align:center;color:#94a3b8;font-family:sans-serif;"><h3>Authentication Required</h3><p>Please log in to link your GitHub account.</p><a href="/app.html#/login" target="_top" style="display:inline-block;margin-top:12px;padding:8px 16px;background:#6366f1;color:#fff;border-radius:6px;text-decoration:none;">Go to Login</a></div>';
        return;
      }
      alert('Authentication required. Redirecting to login.');
      window.location.href = '/app.html#/login';
      return;
    }

    // 2. Render Admin controls only if verified Admin
    if (currentUser.role === 'admin') {
      if (navAdminLink) navAdminLink.style.display = 'inline-block';
      if (adminLinkCard) adminLinkCard.style.display = 'block';
      await loadAdminMembers();
    } else {
      if (adminLinkCard) adminLinkCard.style.display = 'none';
    }

    // 3. Load self link status
    await loadMyLink();

    // 4. Form Submit: Self link
    linkForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = inputGithubUsername?.value.trim();
      const nodeId = inputGithubNodeId?.value.trim();

      if (!username || !nodeId) {
        showBanner('error', 'Please provide both GitHub Username and Node ID.');
        return;
      }

      btnSubmitLink.disabled = true;
      btnSubmitLink.textContent = 'Linking...';

      const res = await apiFetch('/api/github/settings/link-account', 'POST', {
        githubUsername: username,
        githubNodeId: nodeId,
      });

      btnSubmitLink.disabled = false;
      btnSubmitLink.textContent = 'Link GitHub Account';

      if (res.status === 201) {
        showBanner('success', `GitHub account @${username} successfully linked!`);
        await loadMyLink();
      } else if (res.status === 409) {
        showBanner('error', res.data?.error || 'This GitHub account is already linked.');
      } else {
        showBanner('error', res.data?.error || 'Failed to link account. Please verify input.');
      }
    });

    // 5. Form Submit: Admin link for member
    adminLinkForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const memberId = selectMember?.value;
      const username = inputAdminGithubUsername?.value.trim();
      const nodeId = inputAdminGithubNodeId?.value.trim();

      if (!memberId || !username || !nodeId) {
        showBanner('error', 'Please select a member and provide both GitHub details.');
        return;
      }

      btnSubmitAdminLink.disabled = true;
      btnSubmitAdminLink.textContent = 'Linking...';

      const res = await apiFetch('/api/github/settings/admin/link-member', 'POST', {
        userId: memberId,
        githubUsername: username,
        githubNodeId: nodeId,
      });

      btnSubmitAdminLink.disabled = false;
      btnSubmitAdminLink.textContent = 'Link Member Account';

      if (res.status === 201) {
        showBanner('success', `Successfully linked @${username} for selected member!`);
        inputAdminGithubUsername.value = '';
        inputAdminGithubNodeId.value = '';
        selectMember.value = '';
        await loadAdminMembers();
      } else if (res.status === 409) {
        showBanner('error', res.data?.error || 'Member already has a linked GitHub account.');
      } else if (res.status === 404) {
        showBanner('error', res.data?.error || 'Member not found.');
      } else {
        showBanner('error', res.data?.error || 'Failed to link member account.');
      }
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
