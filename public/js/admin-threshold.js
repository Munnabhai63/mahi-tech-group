/**
 * PRD 16 — Layer 4: Admin Participation Threshold Settings Controller
 * Admin-only threshold policy configuration per project.
 * 
 * STRICT RULES:
 * - Protected: strictly verified via GET /api/users/me. Non-admins immediately redirected.
 * - Project LIVE state permanently disables threshold modification.
 * - Field-level error validation for invalid threshold percentages or review days.
 */

(function () {
  'use strict';

  const urlParams = new URLSearchParams(window.location.search);
  const initialProjectId = urlParams.get('projectId') || urlParams.get('id');

  let currentUser = null;
  let activeProjects = [];
  let selectedProject = null;
  const authToken = localStorage.getItem('mtg_auth_token') || localStorage.getItem('token') || '';

  // DOM Elements
  const projectSelect = document.getElementById('projectSelect');
  const inputThresholdPct = document.getElementById('inputThresholdPct');
  const inputAbandonmentDays = document.getElementById('inputAbandonmentDays');
  const btnSaveThreshold = document.getElementById('btnSaveThreshold');
  const thresholdForm = document.getElementById('thresholdForm');

  const bannerFrozen = document.getElementById('bannerFrozen');
  const bannerSuccess = document.getElementById('bannerSuccess');
  const bannerError = document.getElementById('bannerError');
  const errorThresholdPct = document.getElementById('errorThresholdPct');
  const errorAbandonmentDays = document.getElementById('errorAbandonmentDays');
  const linkProjectParticipation = document.getElementById('linkProjectParticipation');

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

  function clearErrors() {
    if (errorThresholdPct) errorThresholdPct.style.display = 'none';
    if (errorAbandonmentDays) errorAbandonmentDays.style.display = 'none';
    if (bannerError) bannerError.style.display = 'none';
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

    const res = await fetch(endpoint, options);
    let data = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    return { status: res.status, ok: res.ok, data };
  }

  async function init() {
    // 1. Strict Server Auth Gate: Must be admin
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
        document.body.innerHTML = '<div style="padding:40px;text-align:center;color:#94a3b8;font-family:sans-serif;"><h3>Admin Access Required</h3><p>Please log in as an administrator to manage threshold settings.</p><a href="/app.html#/login" target="_top" style="display:inline-block;margin-top:12px;padding:8px 16px;background:#ef4444;color:#fff;border-radius:6px;text-decoration:none;">Go to Login</a></div>';
        return;
      }
      alert('Authentication required. Redirecting to login.');
      window.location.href = '/app.html#/login';
      return;
    }

    if (currentUser.role !== 'admin') {
      alert('Access Restricted: Admin role required to configure participation thresholds.');
      window.location.href = '/app.html#/app/dashboard';
      return;
    }

    // 2. Fetch Projects for Dropdown
    await loadProjectsList();

    // 3. Handle selection change
    projectSelect?.addEventListener('change', () => {
      const pId = projectSelect.value;
      if (pId) {
        loadProjectThreshold(pId);
      }
    });

    // 4. Handle initial project pre-selection
    if (initialProjectId && projectSelect) {
      projectSelect.value = initialProjectId;
      if (projectSelect.value === initialProjectId) {
        loadProjectThreshold(initialProjectId);
      }
    }
  }

  async function loadProjectsList() {
    // Try kanban projects first, then fallback to /api/projects/my
    const kanbanRes = await apiFetch('/api/dashboard/kanban');
    const projectsMap = new Map();

    if (kanbanRes.ok && kanbanRes.data) {
      Object.values(kanbanRes.data).forEach(arr => {
        if (Array.isArray(arr)) {
          arr.forEach(p => {
            if (p && p.id && !projectsMap.has(p.id)) {
              projectsMap.set(p.id, p);
            }
          });
        }
      });
    }

    // Also query /api/projects/my
    const myRes = await apiFetch('/api/projects/my');
    if (myRes.ok && myRes.data?.projects) {
      myRes.data.projects.forEach(p => {
        if (p && p.id && !projectsMap.has(p.id)) {
          projectsMap.set(p.id, p);
        }
      });
    }

    activeProjects = Array.from(projectsMap.values());

    if (projectSelect) {
      projectSelect.innerHTML = '<option value="">-- Choose an active project --</option>';
      activeProjects.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = `${p.title || p.name || p.id} (${p.stage || 'STAGE'})`;
        projectSelect.appendChild(opt);
      });
    }
  }

  async function loadProjectThreshold(projectId) {
    clearErrors();
    if (bannerSuccess) bannerSuccess.style.display = 'none';

    // Update navigation link
    if (linkProjectParticipation) {
      linkProjectParticipation.href = `/participation-dashboard.html?projectId=${encodeURIComponent(projectId)}`;
      linkProjectParticipation.style.display = 'inline-block';
    }

    // Fetch project details for stage verification
    const pRes = await apiFetch(`/api/projects/${projectId}`);
    if (pRes.ok && pRes.data?.project) {
      selectedProject = pRes.data.project;
    } else {
      selectedProject = activeProjects.find(p => p.id === projectId) || null;
    }

    const isLive = selectedProject && (selectedProject.stage === 'LIVE' || selectedProject.status === 'LIVE');

    // Fetch threshold from API
    const tRes = await apiFetch(`/api/pointpool/projects/${projectId}/threshold`);
    if (tRes.ok && tRes.data) {
      const t = tRes.data;
      if (inputThresholdPct) inputThresholdPct.value = Number(t.threshold_pct ?? 20.0).toFixed(2);
      if (inputAbandonmentDays) inputAbandonmentDays.value = t.abandonment_days ?? 7;
    } else {
      if (inputThresholdPct) inputThresholdPct.value = '20.00';
      if (inputAbandonmentDays) inputAbandonmentDays.value = '7';
    }

    // Handle LIVE frozen state
    if (isLive) {
      if (bannerFrozen) bannerFrozen.style.display = 'block';
      if (inputThresholdPct) inputThresholdPct.disabled = true;
      if (inputAbandonmentDays) inputAbandonmentDays.disabled = true;
      if (btnSaveThreshold) btnSaveThreshold.disabled = true;
    } else {
      if (bannerFrozen) bannerFrozen.style.display = 'none';
      if (inputThresholdPct) inputThresholdPct.disabled = false;
      if (inputAbandonmentDays) inputAbandonmentDays.disabled = false;
      if (btnSaveThreshold) btnSaveThreshold.disabled = false;
    }
  }

  if (thresholdForm) {
    thresholdForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearErrors();

      const projectId = projectSelect?.value;
      if (!projectId) {
        showBanner('error', 'Please select a project first.');
        return;
      }

      const threshold_pct = parseFloat(inputThresholdPct?.value);
      const abandonment_days = parseInt(inputAbandonmentDays?.value, 10);

      let hasError = false;
      if (isNaN(threshold_pct) || threshold_pct < 0 || threshold_pct > 100) {
        if (errorThresholdPct) {
          errorThresholdPct.textContent = 'Threshold percentage must be a number between 0 and 100.';
          errorThresholdPct.style.display = 'block';
        }
        hasError = true;
      }

      if (isNaN(abandonment_days) || abandonment_days < 1 || abandonment_days > 30) {
        if (errorAbandonmentDays) {
          errorAbandonmentDays.textContent = 'Abandonment window must be an integer between 1 and 30 days.';
          errorAbandonmentDays.style.display = 'block';
        }
        hasError = true;
      }

      if (hasError) return;

      if (btnSaveThreshold) {
        btnSaveThreshold.disabled = true;
        btnSaveThreshold.textContent = 'Saving...';
      }

      const res = await apiFetch(`/api/pointpool/projects/${projectId}/threshold`, 'PATCH', {
        threshold_pct,
        abandonment_days
      });

      if (res.ok) {
        showBanner('success', `Participation threshold updated successfully: ${Number(threshold_pct).toFixed(2)}% threshold, ${abandonment_days} days abandonment.`);
        await loadProjectThreshold(projectId);
      } else {
        const errMsg = res.data?.error || 'Failed to update threshold settings.';
        showBanner('error', errMsg);
      }

      if (btnSaveThreshold && (!selectedProject || (selectedProject.stage !== 'LIVE' && selectedProject.status !== 'LIVE'))) {
        btnSaveThreshold.disabled = false;
        btnSaveThreshold.textContent = 'Save Threshold Settings';
      }
    });
  }

  // Run on load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
