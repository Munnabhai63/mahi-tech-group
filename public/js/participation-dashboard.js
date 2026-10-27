/**
 * PRD 16 — Layer 4: Participation Dashboard Controller
 * Multi-member participation tracking, threshold gates, and revenue block management.
 * 
 * STRICT RULES:
 * - Server role enforcement via GET /api/users/me (never localStorage).
 * - Revenue block panel NEVER rendered for non-Admin.
 * - Client-side min 10 chars pre-check for unblock justification.
 * - In-place row updates on unblock actions.
 */

(function () {
  'use strict';

  const urlParams = new URLSearchParams(window.location.search);
  const projectId = urlParams.get('projectId') || urlParams.get('id');

  let currentUser = null;
  let projectData = null;
  const authToken = localStorage.getItem('token') || '';

  // DOM Elements
  const projectTitleDisplay = document.getElementById('projectTitleDisplay');
  const linkPointPool = document.getElementById('linkPointPool');
  const linkParticipation = document.getElementById('linkParticipation');
  const linkProjectDetail = document.getElementById('linkProjectDetail');
  const userNameDisplay = document.getElementById('userNameDisplay');
  const userRoleBadge = document.getElementById('userRoleBadge');

  // My Participation Elements
  const myOverallPct = document.getElementById('myOverallPct');
  const myStatusBadge = document.getElementById('myStatusBadge');
  const myResPct = document.getElementById('myResPct');
  const myDesPct = document.getElementById('myDesPct');
  const myDevPct = document.getElementById('myDevPct');
  const myTestPct = document.getElementById('myTestPct');
  const myAtRiskBanner = document.getElementById('myAtRiskBanner');

  // Threshold Elements
  const thresholdPctDisplay = document.getElementById('thresholdPctDisplay');
  const abandonmentDaysDisplay = document.getElementById('abandonmentDaysDisplay');
  const thresholdStatusBadge = document.getElementById('thresholdStatusBadge');
  const btnManageThreshold = document.getElementById('btnManageThreshold');

  // Table Elements
  const participationTableBody = document.getElementById('participationTableBody');
  const memberCountBadge = document.getElementById('memberCountBadge');
  const tableSubtitle = document.getElementById('tableSubtitle');

  // Revenue Blocks Elements
  const revenueBlocksPanel = document.getElementById('revenueBlocksPanel');
  const blockedCountBadge = document.getElementById('blockedCountBadge');
  const revenueBlocksTableBody = document.getElementById('revenueBlocksTableBody');

  // Modal Elements
  const unblockModal = document.getElementById('unblockModal');
  const unblockForm = document.getElementById('unblockForm');
  const unblockSplitId = document.getElementById('unblockSplitId');
  const unblockReasonInput = document.getElementById('unblockReasonInput');
  const unblockModalError = document.getElementById('unblockModalError');
  const btnCancelUnblock = document.getElementById('btnCancelUnblock');

  function escapeHTML(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatPct(val) {
    const num = Number(val) || 0;
    return `${num.toFixed(2)}%`;
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
    if (!projectId) {
      alert('Missing projectId in URL. Redirecting to projects list.');
      window.location.href = '/app.html#/app/projects';
      return;
    }

    // Set navigation links
    if (linkPointPool) linkPointPool.href = `/point-pool-board.html?projectId=${encodeURIComponent(projectId)}`;
    if (linkParticipation) linkParticipation.href = `/participation-dashboard.html?projectId=${encodeURIComponent(projectId)}`;
    if (linkProjectDetail) linkProjectDetail.href = `/app.html#/app/projects/${encodeURIComponent(projectId)}`;
    if (btnManageThreshold) btnManageThreshold.href = `/admin-threshold.html?projectId=${encodeURIComponent(projectId)}`;

    // 1. Verify user strictly from server
    const userRes = await apiFetch('/api/users/me');
    if (!userRes.ok || !userRes.data?.user) {
      alert('Authentication required. Please log in.');
      window.location.href = '/index.html#/login';
      return;
    }
    currentUser = userRes.data.user;

    if (userNameDisplay) userNameDisplay.textContent = currentUser.name || currentUser.email;
    if (userRoleBadge) {
      userRoleBadge.textContent = (currentUser.role || 'MEMBER').toUpperCase();
    }

    // 2. Fetch Project Metadata
    const projRes = await apiFetch(`/api/projects/${projectId}`);
    if (projRes.ok && projRes.data?.project) {
      projectData = projRes.data.project;
      if (projectTitleDisplay) projectTitleDisplay.textContent = projectData.title || 'Participation Dashboard';
    } else {
      if (projectTitleDisplay) projectTitleDisplay.textContent = `Project: ${projectId}`;
    }

    // 3. Load My Participation Shortcut
    await loadMyParticipation();

    // 4. Load Threshold Info
    await loadThreshold();

    // 5. Load Members Participation Ledger
    await loadParticipationTable();

    // 6. Admin Only: Load Revenue Blocks
    if (currentUser.role === 'admin') {
      if (revenueBlocksPanel) revenueBlocksPanel.style.display = 'block';
      if (btnManageThreshold) btnManageThreshold.style.display = 'inline-block';
      await loadRevenueBlocks();
    }
  }

  async function loadMyParticipation() {
    const res = await apiFetch(`/api/pointpool/projects/${projectId}/participation/me`);
    if (!res.ok) {
      if (myOverallPct) myOverallPct.textContent = '0.00%';
      return;
    }

    const data = res.data;
    const overall = Number(data.overall) || 0;
    if (myOverallPct) myOverallPct.textContent = formatPct(overall);

    const stages = data.stages || {};
    if (myResPct) myResPct.textContent = formatPct(stages.RESEARCH);
    if (myDesPct) myDesPct.textContent = formatPct(stages.DESIGN);
    if (myDevPct) myDevPct.textContent = formatPct(stages.DEV);
    if (myTestPct) myTestPct.textContent = formatPct(stages.TEST);

    if (myStatusBadge) {
      if (data.atRisk) {
        myStatusBadge.className = 'badge-status badge-at-risk';
        myStatusBadge.textContent = 'AT RISK';
      } else if (data.eligible) {
        myStatusBadge.className = 'badge-status badge-eligible';
        myStatusBadge.textContent = 'ELIGIBLE';
      } else {
        myStatusBadge.className = 'badge-status badge-at-risk';
        myStatusBadge.textContent = 'INELIGIBLE';
      }
    }

    if (myAtRiskBanner) {
      myAtRiskBanner.style.display = data.atRisk ? 'flex' : 'none';
    }
  }

  async function loadThreshold() {
    // Only Admin can call GET /threshold. For non-admin, endpoint returns 403.
    const res = await apiFetch(`/api/pointpool/projects/${projectId}/threshold`);
    if (res.ok && res.data) {
      const t = res.data;
      if (thresholdPctDisplay) thresholdPctDisplay.textContent = formatPct(t.threshold_pct);
      if (abandonmentDaysDisplay) abandonmentDaysDisplay.textContent = `${t.abandonment_days} days`;

      const isLive = projectData && (projectData.stage === 'LIVE' || projectData.status === 'LIVE');
      if (thresholdStatusBadge) {
        thresholdStatusBadge.style.display = 'inline-block';
        if (isLive) {
          thresholdStatusBadge.className = 'badge-status badge-blocked';
          thresholdStatusBadge.textContent = 'THRESHOLD FROZEN (LIVE)';
        } else {
          thresholdStatusBadge.className = 'badge-status badge-eligible';
          thresholdStatusBadge.textContent = 'THRESHOLD ACTIVE';
        }
      }
    } else {
      // Non-admin fallback default presentation
      if (thresholdPctDisplay) thresholdPctDisplay.textContent = '20.00%';
      if (abandonmentDaysDisplay) abandonmentDaysDisplay.textContent = '7 days';
    }
  }

  async function loadParticipationTable() {
    const res = await apiFetch(`/api/pointpool/projects/${projectId}/participation`);
    if (!res.ok) {
      if (participationTableBody) {
        participationTableBody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:2rem;color:#f87171;">Failed to load participation: ${escapeHTML(res.data?.error || '')}</td></tr>`;
      }
      return;
    }

    const members = Array.isArray(res.data) ? res.data : [];
    if (memberCountBadge) memberCountBadge.textContent = `${members.length} Member${members.length === 1 ? '' : 's'}`;

    if (currentUser.role !== 'admin' && currentUser.role !== 'lead' && currentUser.sub_role !== 'lead') {
      if (tableSubtitle) tableSubtitle.textContent = 'Showing your personal participation breakdown.';
    }

    if (!participationTableBody) return;
    participationTableBody.innerHTML = '';

    if (members.length === 0) {
      participationTableBody.innerHTML = `<tr><td colspan="8" style="text-align: center; padding: 2rem; color: #94a3b8;">No members recorded in participation ledger.</td></tr>`;
      return;
    }

    members.forEach(m => {
      const overall = Number(m.overall_pct || m.overallPct || m.overall || 0);
      const isBlocked = Boolean(m.is_blocked || m.isBlocked);
      const isAtRisk = Boolean(m.at_risk || m.atRisk);
      const isEligible = Boolean(m.eligible);

      let badgeHtml = '';
      if (isBlocked) {
        badgeHtml = `<span class="badge-status badge-blocked">REVENUE BLOCKED</span>`;
      } else if (isAtRisk) {
        badgeHtml = `<span class="badge-status badge-at-risk">AT RISK</span>`;
      } else if (isEligible) {
        badgeHtml = `<span class="badge-status badge-eligible">ELIGIBLE</span>`;
      } else {
        badgeHtml = `<span class="badge-status badge-at-risk">INELIGIBLE</span>`;
      }

      const stages = m.stages || {};
      const resPct = formatPct(stages.RESEARCH ?? m.research_pct ?? 0);
      const desPct = formatPct(stages.DESIGN ?? m.design_pct ?? 0);
      const devPct = formatPct(stages.DEV ?? m.dev_pct ?? 0);
      const testPct = formatPct(stages.TEST ?? m.test_pct ?? 0);

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>
          <div style="font-weight: 600; color: #f8fafc;">${escapeHTML(m.user_name || m.name || m.userName || 'Member')}</div>
          <div style="font-size: 0.75rem; color: #64748b;">${escapeHTML(m.user_email || m.email || '')}</div>
        </td>
        <td><span class="badge-status badge-eligible" style="background:#1e293b; color:#94a3b8; border-color:#334155;">${escapeHTML((m.user_role || m.role || 'member').toUpperCase())}</span></td>
        <td>
          <div class="progress-bar-wrap">
            <div class="progress-bar-fill" style="width: ${Math.min(100, Math.max(0, overall))}%;"></div>
          </div>
          <strong style="color: #f8fafc;">${formatPct(overall)}</strong>
        </td>
        <td style="color: #94a3b8;">${resPct}</td>
        <td style="color: #94a3b8;">${desPct}</td>
        <td style="color: #94a3b8;">${devPct}</td>
        <td style="color: #94a3b8;">${testPct}</td>
        <td style="text-align: right;">${badgeHtml}</td>
      `;

      participationTableBody.appendChild(tr);
    });
  }

  // 4. Admin Revenue Blocks
  async function loadRevenueBlocks() {
    const res = await apiFetch(`/api/pointpool/projects/${projectId}/revenue-blocks`);
    if (!res.ok) {
      if (revenueBlocksTableBody) {
        revenueBlocksTableBody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:1.5rem;color:#f87171;">Failed to load revenue blocks: ${escapeHTML(res.data?.error || '')}</td></tr>`;
      }
      return;
    }

    const blocked = Array.isArray(res.data) ? res.data : [];
    if (blockedCountBadge) blockedCountBadge.textContent = `${blocked.length} Blocked`;

    if (!revenueBlocksTableBody) return;
    revenueBlocksTableBody.innerHTML = '';

    if (blocked.length === 0) {
      revenueBlocksTableBody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:1.5rem;color:#94a3b8;">No blocked revenue splits found for this project.</td></tr>`;
      return;
    }

    blocked.forEach(split => {
      const tr = document.createElement('tr');
      tr.id = `split-row-${split.id}`;
      tr.innerHTML = `
        <td>
          <div style="font-weight: 600; color: #f8fafc;">${escapeHTML(split.user_name || split.userName || 'Member')}</div>
          <div style="font-size: 0.75rem; color: #94a3b8;">${escapeHTML(split.user_email || split.userEmail || '')}</div>
        </td>
        <td style="color: #cbd5e1;">${escapeHTML(split.source || split.rule || 'Split')}</td>
        <td style="color: #34d399; font-weight: 700;">₹${Number(split.amount || 0).toFixed(2)}</td>
        <td style="color: #fca5a5; font-size: 0.85rem;">${escapeHTML(split.block_reason || 'Below participation threshold')}</td>
        <td style="text-align: right;">
          <button class="nav-link-btn btn-unblock-row" data-split-id="${split.id}" style="background:#10b981; color:#ffffff; border:none; padding:4px 10px; font-size:0.8rem;">Unblock</button>
        </td>
      `;

      tr.querySelector('.btn-unblock-row')?.addEventListener('click', () => {
        openUnblockModal(split.id);
      });

      revenueBlocksTableBody.appendChild(tr);
    });
  }

  function openUnblockModal(splitId) {
    if (!unblockModal) return;
    if (unblockSplitId) unblockSplitId.value = splitId;
    if (unblockReasonInput) unblockReasonInput.value = '';
    if (unblockModalError) unblockModalError.style.display = 'none';
    unblockModal.style.display = 'flex';
  }

  function closeUnblockModal() {
    if (unblockModal) unblockModal.style.display = 'none';
  }

  if (btnCancelUnblock) {
    btnCancelUnblock.addEventListener('click', closeUnblockModal);
  }

  if (unblockForm) {
    unblockForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const splitId = unblockSplitId?.value;
      const reason = (unblockReasonInput?.value || '').trim();

      // Client-side minimum 10 characters pre-check
      if (!reason || reason.length < 10) {
        if (unblockModalError) {
          unblockModalError.textContent = 'Unblock reason must be at least 10 characters long.';
          unblockModalError.style.display = 'block';
        }
        return;
      }

      const submitBtn = document.getElementById('btnConfirmUnblock');
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Unblocking...';
      }

      const res = await apiFetch(`/api/pointpool/revenue-splits/${splitId}/unblock`, 'PATCH', { reason });
      if (res.ok) {
        closeUnblockModal();
        await loadRevenueBlocks();
        await loadParticipationTable();
      } else {
        if (unblockModalError) {
          unblockModalError.textContent = res.data?.error || 'Failed to unblock revenue split.';
          unblockModalError.style.display = 'block';
        }
      }

      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Confirm Unblock';
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
