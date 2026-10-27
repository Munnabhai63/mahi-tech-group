/**
 * PRD 16 — Layer 4: Point Pool Board Controller
 * Kanban-style stage board for checklist points, claim/release lifecycles, and tool connections.
 * 
 * STRICT RULES:
 * - User role is NEVER read from localStorage. Always verified via GET /api/users/me.
 * - Admin controls Release + Abandoned only; Admin does NOT appear as a claimable member.
 * - In-place card refresh on claim/release actions.
 */

(function () {
  'use strict';

  const urlParams = new URLSearchParams(window.location.search);
  const projectId = urlParams.get('projectId') || urlParams.get('id');

  let currentUser = null;
  let projectData = null;
  let pointPoolData = null;
  const authToken = localStorage.getItem('mtg_auth_token') || localStorage.getItem('token') || '';

  // DOM Elements
  const projectTitleDisplay = document.getElementById('projectTitleDisplay');
  const projectStageBadge = document.getElementById('projectStageBadge');
  const userNameDisplay = document.getElementById('userNameDisplay');
  const userRoleBadge = document.getElementById('userRoleBadge');
  const linkParticipation = document.getElementById('linkParticipation');
  const linkProjectDetail = document.getElementById('linkProjectDetail');

  const totalPointsCount = document.getElementById('totalPointsCount');
  const claimedPointsCount = document.getElementById('claimedPointsCount');
  const approvedPointsCount = document.getElementById('approvedPointsCount');

  const stageContainers = {
    RESEARCH: document.getElementById('points-RESEARCH'),
    DESIGN: document.getElementById('points-DESIGN'),
    DEV: document.getElementById('points-DEV'),
    TEST: document.getElementById('points-TEST')
  };

  const stageCounts = {
    RESEARCH: document.getElementById('count-RESEARCH'),
    DESIGN: document.getElementById('count-DESIGN'),
    DEV: document.getElementById('count-DEV'),
    TEST: document.getElementById('count-TEST')
  };

  const abandonedPanel = document.getElementById('abandonedPanel');
  const abandonedToggle = document.getElementById('abandonedToggle');
  const abandonedBody = document.getElementById('abandonedBody');
  const abandonedChevron = document.getElementById('abandonedChevron');
  const abandonedCountBadge = document.getElementById('abandonedCountBadge');
  const abandonedListBody = document.getElementById('abandonedListBody');

  const releaseModal = document.getElementById('releaseModal');
  const releaseForm = document.getElementById('releaseForm');
  const releasePointIdInput = document.getElementById('releasePointId');
  const releaseReasonInput = document.getElementById('releaseReasonInput');
  const releaseModalError = document.getElementById('releaseModalError');
  const btnCancelRelease = document.getElementById('btnCancelRelease');

  function escapeHTML(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
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

  function isLeadOrAdmin(user) {
    if (!user) return false;
    const role = (user.role || '').toLowerCase();
    const subRole = (user.sub_role || user.subRole || '').toLowerCase();
    if (role === 'admin' || role === 'lead' || subRole === 'lead') return true;
    if (projectData && (projectData.owner_id === user.id || projectData.ownerId === user.id)) return true;
    return false;
  }

  function canClaimStage(user, stage) {
    if (!user) return false;
    const role = (user.role || '').toLowerCase();
    // Admin does NOT claim points in stage columns
    if (role === 'admin') return false;

    if (stage === 'RESEARCH') return role === 'researcher';
    if (stage === 'DESIGN') return role === 'designer';
    if (stage === 'DEV') return role === 'developer';
    if (stage === 'TEST') return role === 'tester' || role === 'producer';
    return false;
  }

  async function init() {
    if (!projectId) {
      alert('Missing projectId in URL. Redirecting to projects list.');
      window.location.href = '/app.html#/app/projects';
      return;
    }

    // Update navigation links
    if (linkParticipation) linkParticipation.href = `/participation-dashboard.html?projectId=${encodeURIComponent(projectId)}`;
    if (linkProjectDetail) linkProjectDetail.href = `/app.html#/app/projects/${encodeURIComponent(projectId)}`;

    // 1. Verify User from Server (NEVER trust localStorage role)
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
        document.body.innerHTML = '<div style="padding:40px;text-align:center;color:#94a3b8;font-family:sans-serif;"><h3>Authentication Required</h3><p>Please log in to the workspace to view this board.</p><a href="/app.html#/login" target="_top" style="display:inline-block;margin-top:12px;padding:8px 16px;background:#3b82f6;color:#fff;border-radius:6px;text-decoration:none;">Go to Login</a></div>';
        return;
      }
      alert('Authentication required. Please log in.');
      window.location.href = '/app.html#/login';
      return;
    }

    // Display user profile pill
    if (userNameDisplay) userNameDisplay.textContent = currentUser.name || currentUser.email;
    if (userRoleBadge) {
      userRoleBadge.textContent = (currentUser.role || 'MEMBER').toUpperCase();
      userRoleBadge.className = `status-pill ${(currentUser.role || '').toLowerCase()}`;
    }

    // 2. Fetch Project Metadata
    const projRes = await apiFetch(`/api/projects/${projectId}`);
    if (projRes.ok && projRes.data?.project) {
      projectData = projRes.data.project;
      if (projectTitleDisplay) projectTitleDisplay.textContent = projectData.title || 'Project Board';
      if (projectStageBadge) {
        projectStageBadge.textContent = projectData.stage || 'ACTIVE';
        projectStageBadge.style.display = 'inline-block';
      }
    } else {
      if (projectTitleDisplay) projectTitleDisplay.textContent = `Project: ${projectId}`;
    }

    // 3. Load Board Data
    await loadPointPool();

    // 4. Load Abandoned Points if Lead/Admin
    if (isLeadOrAdmin(currentUser)) {
      if (abandonedPanel) abandonedPanel.style.display = 'block';
      await loadAbandonedPoints();
    }
  }

  async function loadPointPool() {
    const res = await apiFetch(`/api/pointpool/projects/${projectId}/pool`);
    if (!res.ok) {
      const err = res.data?.error || 'Failed to load point pool';
      Object.values(stageContainers).forEach(col => {
        if (col) col.innerHTML = `<div style="padding:1rem;color:#f87171;font-size:13px;">${escapeHTML(err)}</div>`;
      });
      return;
    }

    pointPoolData = res.data;
    const stages = pointPoolData.stages || {};

    let totalPts = 0;
    let claimedPts = 0;
    let approvedPts = 0;

    ['RESEARCH', 'DESIGN', 'DEV', 'TEST'].forEach(stageName => {
      const points = stages[stageName] || [];
      const colEl = stageContainers[stageName];
      const countEl = stageCounts[stageName];

      if (countEl) countEl.textContent = points.length;

      if (!colEl) return;
      colEl.innerHTML = '';

      if (points.length === 0) {
        colEl.innerHTML = `<div style="text-align: center; color: #64748b; font-size: 13px; padding: 2rem 0; font-style: italic;">No checklist points in ${stageName}</div>`;
        return;
      }

      points.forEach(point => {
        totalPts++;
        if (point.status === 'CLAIMED' || point.status === 'IN_PROGRESS' || point.status === 'SUBMITTED') claimedPts++;
        if (point.status === 'APPROVED') approvedPts++;

        const card = createPointCard(point, stageName);
        colEl.appendChild(card);
      });
    });

    if (totalPointsCount) totalPointsCount.textContent = totalPts;
    if (claimedPointsCount) claimedPointsCount.textContent = claimedPts;
    if (approvedPointsCount) approvedPointsCount.textContent = approvedPts;
  }

  function createPointCard(point, stageName) {
    const card = document.createElement('div');
    card.className = 'point-card';
    card.id = `point-card-${point.id}`;
    card.dataset.pointId = point.id;

    const statusNorm = (point.status || 'UNCLAIMED').toLowerCase();
    const canClaim = point.status === 'UNCLAIMED' && canClaimStage(currentUser, stageName);
    const canRelease = (point.status === 'CLAIMED' || point.status === 'IN_PROGRESS') && isLeadOrAdmin(currentUser);

    const claimerName = point.claimed_by_name || point.assigned_to_name || (point.claim_locked_by ? 'Claimed' : null);

    card.innerHTML = `
      <div class="point-top">
        <span class="point-title">${escapeHTML(point.title || point.name || 'Checklist point')}</span>
        <span class="point-weight-pill">${point.weight || 10} pts</span>
      </div>
      <div class="point-meta">
        <span class="status-pill ${statusNorm}">${escapeHTML(point.status || 'UNCLAIMED')}</span>
        <button class="tool-badge-btn" data-point-id="${point.id}">
          🔗 <span class="tool-count-text">Tools</span>
        </button>
      </div>
      ${claimerName ? `
        <div class="claimer-info">
          <span>👤 Claimed by:</span>
          <strong style="color: #cbd5e1;">${escapeHTML(claimerName)}</strong>
        </div>
      ` : ''}
      <div class="card-actions">
        ${canClaim ? `
          <button class="btn-claim" data-point-id="${point.id}">Claim Point</button>
        ` : ''}
        ${canRelease ? `
          <button class="btn-release" data-point-id="${point.id}">Release</button>
        ` : ''}
      </div>
      <div class="inline-tool-panel-container"></div>
    `;

    // Wire Tool count badge click to toggle inline tool links panel
    const toolBadgeBtn = card.querySelector('.tool-badge-btn');
    const toolContainer = card.querySelector('.inline-tool-panel-container');
    const toolCountText = card.querySelector('.tool-count-text');

    if (toolBadgeBtn && window.ToolLinksPanel) {
      toolBadgeBtn.addEventListener('click', (e) => {
        e.preventDefault();
        window.ToolLinksPanel.toggle(point.id, toolContainer, currentUser, (newCount) => {
          if (toolCountText) toolCountText.textContent = `Tools (${newCount})`;
        });
      });
    }

    // Wire Claim button
    const claimBtn = card.querySelector('.btn-claim');
    if (claimBtn) {
      claimBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        claimBtn.disabled = true;
        claimBtn.textContent = 'Claiming...';

        const res = await apiFetch(`/api/pointpool/points/${point.id}/claim`, 'PATCH');
        if (res.ok) {
          await loadPointPool();
        } else {
          alert('Failed to claim point: ' + (res.data?.error || 'Role mismatch or already claimed'));
          claimBtn.disabled = false;
          claimBtn.textContent = 'Claim Point';
        }
      });
    }

    // Wire Release button
    const releaseBtn = card.querySelector('.btn-release');
    if (releaseBtn) {
      releaseBtn.addEventListener('click', (e) => {
        e.preventDefault();
        openReleaseModal(point.id);
      });
    }

    return card;
  }

  function openReleaseModal(pointId) {
    if (!releaseModal) return;
    if (releasePointIdInput) releasePointIdInput.value = pointId;
    if (releaseReasonInput) releaseReasonInput.value = '';
    if (releaseModalError) releaseModalError.style.display = 'none';
    releaseModal.style.display = 'flex';
  }

  function closeReleaseModal() {
    if (releaseModal) releaseModal.style.display = 'none';
  }

  if (btnCancelRelease) {
    btnCancelRelease.addEventListener('click', closeReleaseModal);
  }

  if (releaseForm) {
    releaseForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const pointId = releasePointIdInput?.value;
      const reason = (releaseReasonInput?.value || '').trim();

      if (!reason) {
        if (releaseModalError) {
          releaseModalError.textContent = 'Release reason cannot be empty.';
          releaseModalError.style.display = 'block';
        }
        return;
      }

      const submitBtn = document.getElementById('btnConfirmRelease');
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Releasing...';
      }

      const res = await apiFetch(`/api/pointpool/points/${pointId}/release`, 'PATCH', { reason });
      if (res.ok) {
        closeReleaseModal();
        await loadPointPool();
        if (isLeadOrAdmin(currentUser)) {
          await loadAbandonedPoints();
        }
      } else {
        if (releaseModalError) {
          releaseModalError.textContent = res.data?.error || 'Failed to release point.';
          releaseModalError.style.display = 'block';
        }
      }

      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Confirm Release';
      }
    });
  }

  // Abandoned Points (Lead / Admin only)
  async function loadAbandonedPoints() {
    const res = await apiFetch(`/api/pointpool/projects/${projectId}/abandoned`);
    if (!res.ok) {
      if (abandonedListBody) {
        abandonedListBody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:12px;color:#f87171;">Failed to load abandoned points: ${escapeHTML(res.data?.error || '')}</td></tr>`;
      }
      return;
    }

    const abandoned = Array.isArray(res.data) ? res.data : [];
    if (abandonedCountBadge) abandonedCountBadge.textContent = abandoned.length;

    if (!abandonedListBody) return;
    abandonedListBody.innerHTML = '';

    if (abandoned.length === 0) {
      abandonedListBody.innerHTML = `<tr><td colspan="5" style="text-align: center; padding: 12px; color: #94a3b8;">No inactive abandoned points found.</td></tr>`;
      return;
    }

    abandoned.forEach(pt => {
      const tr = document.createElement('tr');
      tr.style.borderBottom = '1px solid #334155';
      tr.innerHTML = `
        <td style="padding: 8px; font-weight: 600; color: #f8fafc;">${escapeHTML(pt.title || pt.name || pt.id)}</td>
        <td style="padding: 8px;"><span class="status-pill ${pt.stage ? pt.stage.toLowerCase() : ''}">${escapeHTML(pt.stage || '')}</span></td>
        <td style="padding: 8px; color: #cbd5e1;">${escapeHTML(pt.claimed_by_name || pt.assigned_to_name || 'Inactive Member')}</td>
        <td style="padding: 8px; color: #94a3b8;">${pt.claim_locked_at || pt.claimed_at || 'N/A'}</td>
        <td style="padding: 8px; text-align: right;">
          <button class="btn-release btn-release-abandoned" data-point-id="${pt.id}">Release</button>
        </td>
      `;

      tr.querySelector('.btn-release-abandoned')?.addEventListener('click', () => {
        openReleaseModal(pt.id);
      });

      abandonedListBody.appendChild(tr);
    });
  }

  if (abandonedToggle) {
    abandonedToggle.addEventListener('click', () => {
      if (!abandonedBody) return;
      const isHidden = abandonedBody.style.display === 'none';
      abandonedBody.style.display = isHidden ? 'block' : 'none';
      if (abandonedChevron) abandonedChevron.textContent = isHidden ? '▲' : '▼';
    });
  }

  // Run on load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
