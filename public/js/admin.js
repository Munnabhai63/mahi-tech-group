/**
 * Admin Control Panel Controller — Mahi Tech Group
 * Comprehensive Single-Pane-of-Glass Governance Engine
 */

(function () {
  'use strict';

  // 1. RBAC Check on Entry
  const token = localStorage.getItem('token');
  const user = JSON.parse(localStorage.getItem('user') || '{}');

  if (!token || user.role !== 'admin') {
    alert('Access Denied: Administrator role required to access Governance Control Panel.');
    window.location.href = '/';
    return;
  }

  // Set Topbar Admin Name
  const adminUserNameEl = document.getElementById('adminUserName');
  if (adminUserNameEl) adminUserNameEl.textContent = user.name || 'Admin';

  // Global Toast
  function showToast(msg, isError = false) {
    const toast = document.getElementById('adminToast');
    if (!toast) return;
    toast.textContent = msg;
    toast.style.borderLeftColor = isError ? '#ef4444' : '#22c55e';
    toast.style.display = 'block';
    setTimeout(() => { toast.style.display = 'none'; }, 4000);
  }

  // API Client
  async function apiCall(method, path, body = null) {
    const opts = {
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    };
    if (body) opts.body = JSON.stringify(body);
    try {
      const res = await fetch(path, opts);
      const data = await res.json().catch(() => ({}));
      return { status: res.status, ok: res.ok, data };
    } catch (err) {
      return { status: 0, ok: false, data: { error: err.message } };
    }
  }

  // 2. Navigation Switcher
  const navButtons = document.querySelectorAll('.nav-btn');
  const viewSections = document.querySelectorAll('.view-section');
  const viewTitle = document.getElementById('adminViewTitle');

  const titles = {
    overview: 'Dashboard Overview',
    members: 'Member Management & Approvals',
    ideas: 'Idea Governance & Executive Overrides',
    projects: 'Project Pipeline & Final Review Gates',
    revenue: 'Revenue Entry & Disbursal Ledger',
    offboarding: 'Offboarding Center & Wallet Settlements',
    config: 'System Configuration Parameters',
    meetings: 'Meeting Management & AI Governance',
    audit: 'Immutable Compliance & Audit Logs'
  };

  function switchView(viewName) {
    navButtons.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.view === viewName);
    });
    viewSections.forEach(sec => {
      sec.classList.toggle('active', sec.id === `view-${viewName}`);
    });
    if (viewTitle) viewTitle.textContent = titles[viewName] || 'Admin Control Panel';

    // Lazy load view data
    if (viewName === 'overview') loadOverview();
    else if (viewName === 'members') loadMembersView();
    else if (viewName === 'ideas') loadIdeasView();
    else if (viewName === 'projects') loadProjectsView();
    else if (viewName === 'revenue') loadRevenueView();
    else if (viewName === 'offboarding') loadOffboardingView();
    else if (viewName === 'config') loadConfigView();
    else if (viewName === 'meetings') loadMeetingsView();
    else if (viewName === 'audit') loadAuditLogs();
  }

  navButtons.forEach(btn => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });

  // Modal helpers
  function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.add('open');
  }

  function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.remove('open');
  }

  document.querySelectorAll('.close-modal').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const backdrop = e.target.closest('.modal-backdrop');
      if (backdrop) backdrop.classList.remove('open');
    });
  });

  // ---------------------------------------------------------------------------
  // VIEW 1: DASHBOARD OVERVIEW
  // ---------------------------------------------------------------------------
  async function loadOverview() {
    const res = await apiCall('GET', '/api/admin/dashboard/overview');
    if (!res.ok) {
      showToast(res.data.error || 'Failed to load dashboard overview', true);
      return;
    }

    const { members, projects, pendingApprovals, financials, recentOffboarding } = res.data;

    // Active members
    document.getElementById('overviewActiveMembers').textContent = members.totalActive;
    document.getElementById('overviewMemberRoles').textContent = 
      `Dev: ${members.byRole.developer} | Res: ${members.byRole.researcher} | Des: ${members.byRole.designer} | Prod: ${members.byRole.producer} | Adm: ${members.byRole.admin}`;

    // Active projects
    document.getElementById('overviewActiveProjects').textContent = projects.totalProjects;
    document.getElementById('overviewProjectStages').textContent = 
      `Live: ${projects.byStage.LIVE} | Dev: ${projects.byStage.RESEARCH_DEV_PARALLEL} | Int: ${projects.byStage.INTEGRATION} | QA: ${projects.byStage.TESTING} | Review: ${projects.byStage.ADMIN_REVIEW}`;

    // Pending Approvals
    document.getElementById('overviewTotalPending').textContent = pendingApprovals.totalPending;
    document.getElementById('overviewPendingBreakdown').textContent = 
      `${pendingApprovals.pendingApplications} signups, ${pendingApprovals.pendingIdeaVotes} ideas, ${pendingApprovals.pendingFinalReviews} reviews, ${pendingApprovals.pendingWithdrawals} payouts`;

    // Sidebar badge updates
    updateBadge('badge-pending-members', pendingApprovals.pendingApplications);
    updateBadge('badge-pending-ideas', pendingApprovals.pendingIdeaVotes);
    updateBadge('badge-pending-reviews', pendingApprovals.pendingFinalReviews);
    updateBadge('badge-pending-withdrawals', pendingApprovals.pendingWithdrawals);

    // Financials
    document.getElementById('overviewTotalRevenue').textContent = `₹${parseFloat(financials.totalRevenueGenerated).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
    document.getElementById('overviewPaidWithdrawals').textContent = `Paid: ₹${parseFloat(financials.totalWithdrawalsPaid).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

    // Recent offboardings
    const tbody = document.getElementById('overviewRecentOffboardingsBody');
    if (recentOffboarding && recentOffboarding.length > 0) {
      tbody.innerHTML = recentOffboarding.map(o => `
        <tr>
          <td><strong>${escapeHtml(o.user_name || 'Former Member')}</strong></td>
          <td>${escapeHtml(o.user_email || '')}</td>
          <td>${o.initiated_at ? o.initiated_at.slice(0, 16) : '-'}</td>
          <td><span class="status-badge status-${o.status === 'COMPLETED' ? 'active' : 'pending'}">${o.status}</span></td>
          <td>₹${Number(o.wallet_frozen_amount || 0).toFixed(2)}</td>
          <td>${escapeHtml(o.reason || 'None')}</td>
        </tr>
      `).join('');
    } else {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:#94a3b8;">No offboarding events recorded.</td></tr>';
    }
  }

  function updateBadge(id, count) {
    const badge = document.getElementById(id);
    if (!badge) return;
    if (count > 0) {
      badge.textContent = count;
      badge.style.display = 'inline-block';
    } else {
      badge.style.display = 'none';
    }
  }

  // ---------------------------------------------------------------------------
  // VIEW 2: MEMBER MANAGEMENT & APPROVAL GATE
  // ---------------------------------------------------------------------------
  async function loadMembersView() {
    // 1. Load Pending Applications Queue (Step 01 Amendment)
    const appsRes = await apiCall('GET', '/api/admin/applications/pending');
    const appsTbody = document.getElementById('pendingApplicationsTableBody');
    const appsBadge = document.getElementById('pendingAppsCountBadge');

    if (appsRes.ok && appsRes.data.applications) {
      const apps = appsRes.data.applications;
      appsBadge.textContent = `${apps.length} Pending`;
      if (apps.length > 0) {
        appsTbody.innerHTML = apps.map(a => `
          <tr>
            <td><strong>${escapeHtml(a.name)}</strong></td>
            <td>${escapeHtml(a.email)}</td>
            <td>${escapeHtml(a.phone_number || '-')}</td>
            <td><span class="status-badge status-pending">${a.desired_role} ${a.desired_sub_role ? `(${a.desired_sub_role})` : ''}</span></td>
            <td>${a.created_at ? a.created_at.slice(0, 16) : '-'}</td>
            <td>
              <button class="btn-success btn-approve-app" data-id="${a.id}" data-desired="${a.desired_role}" data-sub="${a.desired_sub_role || ''}">Approve</button>
              <button class="btn-danger btn-reject-app" data-id="${a.id}">Reject</button>
            </td>
          </tr>
        `).join('');

        // Bind Approval Gate Actions
        document.querySelectorAll('.btn-approve-app').forEach(btn => {
          btn.addEventListener('click', () => handleApproveApp(btn.dataset.id, btn.dataset.desired, btn.dataset.sub));
        });
        document.querySelectorAll('.btn-reject-app').forEach(btn => {
          btn.addEventListener('click', () => handleRejectApp(btn.dataset.id));
        });
      } else {
        appsTbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:#94a3b8;">No applications awaiting review.</td></tr>';
      }
    }

    // 2. Load All Active/Inactive Team Members
    const membersRes = await apiCall('GET', '/api/admin/members');
    const membersTbody = document.getElementById('membersTableBody');
    if (membersRes.ok && membersRes.data.members) {
      const members = membersRes.data.members;
      membersTbody.innerHTML = members.map(m => `
        <tr>
          <td><strong>${escapeHtml(m.name)}</strong></td>
          <td>${escapeHtml(m.email)}</td>
          <td>
            <span class="status-badge" style="background:rgba(255,255,255,0.06);">
              ${m.role} ${m.sub_role ? `(${m.sub_role})` : ''}
            </span>
          </td>
          <td><span class="status-badge status-${m.status}">${m.status}</span></td>
          <td>★ ${Number(m.rating_avg || 5.0).toFixed(1)}</td>
          <td>₹${Number(m.wallet_balance || 0).toFixed(2)} ${m.wallet_frozen ? '🔒' : ''}</td>
          <td>
            <button class="btn-action btn-edit-role" data-id="${m.id}" data-name="${escapeHtml(m.name)}" data-role="${m.role}" data-sub="${m.sub_role || ''}">Edit Role</button>
            <a href="/profile.html?id=${m.id}" class="btn-action" style="text-decoration:none;">Profile</a>
            ${m.status === 'active' && m.id !== user.id ? `
              <button class="btn-danger btn-remove-member" data-id="${m.id}" data-name="${escapeHtml(m.name)}">Remove</button>
            ` : ''}
          </td>
        </tr>
      `).join('');

      // Bind edit role
      document.querySelectorAll('.btn-edit-role').forEach(btn => {
        btn.addEventListener('click', () => {
          document.getElementById('editMemberId').value = btn.dataset.id;
          document.getElementById('editMemberName').value = btn.dataset.name;
          document.getElementById('editMemberRole').value = btn.dataset.role;
          const editSubGroup = document.getElementById('editSubRoleGroup');
          if (btn.dataset.role === 'developer') {
            editSubGroup.style.display = 'block';
            document.getElementById('editMemberSubRole').value = btn.dataset.sub || 'backend';
          } else {
            editSubGroup.style.display = 'none';
          }
          openModal('editMemberModal');
        });
      });

      // Bind remove member (triggers full 7-step Step 05 killswitch)
      document.querySelectorAll('.btn-remove-member').forEach(btn => {
        btn.addEventListener('click', async () => {
          const confirmed = confirm(`Are you sure you want to OFFBOARD member "${btn.dataset.name}"?\n\nThis will trigger the full Step 05 7-step kill-switch:\n- Revoke all active sessions immediately\n- Lockout login\n- Reassign uncompleted tasks\n- Freeze current wallet balance`);
          if (!confirmed) return;

          const reason = prompt('Enter mandatory offboarding reason:', 'Administrative Offboarding');
          if (!reason) return;

          const offRes = await apiCall('POST', `/api/admin/members/${btn.dataset.id}/offboard`, { reason });
          if (offRes.ok) {
            showToast(`Member ${btn.dataset.name} successfully offboarded`);
            loadMembersView();
            loadOverview();
          } else {
            showToast(offRes.data.error || 'Offboarding failed', true);
          }
        });
      });
    }
  }

  // Handle Approve Application (Step 01 Amendment)
  async function handleApproveApp(id, desiredRole, desiredSub) {
    const assignedRole = prompt(`Assign role for applicant (default: ${desiredRole}):`, desiredRole) || desiredRole;
    let assignedSub = null;
    if (assignedRole === 'developer') {
      assignedSub = prompt('Assign sub-role (frontend / backend):', desiredSub || 'backend') || 'backend';
    }

    const res = await apiCall('PATCH', `/api/admin/applications/${id}/decide`, {
      decision: 'approve',
      assigned_role: assignedRole,
      assigned_sub_role: assignedSub
    });

    if (res.ok) {
      showToast('Application approved successfully! Member is now active.');
      loadMembersView();
      loadOverview();
    } else {
      showToast(res.data.error || 'Approval failed', true);
    }
  }

  // Handle Reject Application
  async function handleRejectApp(id) {
    const reason = prompt('Enter rejection reason (optional):', 'Application does not meet current requirements');
    const res = await apiCall('PATCH', `/api/admin/applications/${id}/decide`, {
      decision: 'reject',
      rejection_reason: reason
    });

    if (res.ok) {
      showToast('Application rejected.');
      loadMembersView();
      loadOverview();
    } else {
      showToast(res.data.error || 'Rejection failed', true);
    }
  }

  // Add Member Modal toggle sub-role
  const newMemberRoleSelect = document.getElementById('newMemberRole');
  if (newMemberRoleSelect) {
    newMemberRoleSelect.addEventListener('change', () => {
      document.getElementById('subRoleGroup').style.display = 
        newMemberRoleSelect.value === 'developer' ? 'block' : 'none';
    });
  }

  // Add Member Form Submit
  const addMemberForm = document.getElementById('addMemberForm');
  if (addMemberForm) {
    addMemberForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('newMemberName').value.trim();
      const email = document.getElementById('newMemberEmail').value.trim();
      const role = document.getElementById('newMemberRole').value;
      const sub_role = role === 'developer' ? document.getElementById('newMemberSubRole').value : null;
      const temporary_password = document.getElementById('newMemberPass').value || 'MahiTeam2026!';

      const res = await apiCall('POST', '/api/admin/members/add', {
        name, email, role, sub_role, temporary_password
      });

      if (res.ok) {
        showToast(`Member created! Temporary password: ${temporary_password}`);
        closeModal('addMemberModal');
        addMemberForm.reset();
        loadMembersView();
        loadOverview();
      } else {
        showToast(res.data.error || 'Failed to add member', true);
      }
    });
  }

  document.getElementById('btnOpenAddMemberModal')?.addEventListener('click', () => {
    openModal('addMemberModal');
  });

  // Edit Role Form Submit
  const editMemberForm = document.getElementById('editMemberForm');
  const editMemberRoleSelect = document.getElementById('editMemberRole');
  if (editMemberRoleSelect) {
    editMemberRoleSelect.addEventListener('change', () => {
      document.getElementById('editSubRoleGroup').style.display = 
        editMemberRoleSelect.value === 'developer' ? 'block' : 'none';
    });
  }

  if (editMemberForm) {
    editMemberForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = document.getElementById('editMemberId').value;
      const role = document.getElementById('editMemberRole').value;
      const sub_role = role === 'developer' ? document.getElementById('editMemberSubRole').value : null;

      const res = await apiCall('PATCH', `/api/admin/members/${id}`, { role, sub_role });
      if (res.ok) {
        showToast('Member role updated successfully');
        closeModal('editMemberModal');
        loadMembersView();
        loadOverview();
      } else {
        showToast(res.data.error || 'Failed to update role', true);
      }
    });
  }

  // ---------------------------------------------------------------------------
  // VIEW 3: IDEA GOVERNANCE & OVERRIDES
  // ---------------------------------------------------------------------------
  async function loadIdeasView() {
    const res = await apiCall('GET', '/api/ideas');
    if (!res.ok) return;

    const allIdeas = res.data.ideas || [];
    const pendingIdeas = allIdeas.filter(i => i.status === 'PENDING_REVIEW');
    const historicalIdeas = allIdeas.filter(i => i.status !== 'PENDING_REVIEW' && i.status !== 'DRAFT');

    // Pending Table
    const pendingTbody = document.getElementById('pendingIdeasTableBody');
    if (pendingIdeas.length > 0) {
      pendingTbody.innerHTML = pendingIdeas.map(i => `
        <tr>
          <td><strong>${escapeHtml(i.title)}</strong></td>
          <td>${escapeHtml(i.owner_name || 'Member')}</td>
          <td>${Number(i.green_percentage || 0).toFixed(1)}%</td>
          <td>${i.voting_deadline ? i.voting_deadline.slice(0, 16) : '-'}</td>
          <td><span class="status-badge status-pending">IN VOTING</span></td>
          <td>
            <button class="btn-action btn-override-idea" data-id="${i.id}" data-title="${escapeHtml(i.title)}">Override Decision</button>
          </td>
        </tr>
      `).join('');

      document.querySelectorAll('.btn-override-idea').forEach(btn => {
        btn.addEventListener('click', () => {
          document.getElementById('overrideIdeaId').value = btn.dataset.id;
          document.getElementById('overrideIdeaTitle').value = btn.dataset.title;
          openModal('overrideModal');
        });
      });
    } else {
      pendingTbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:#94a3b8;">No ideas currently in pending review.</td></tr>';
    }

    // Historical Table
    const histTbody = document.getElementById('historicalIdeasTableBody');
    if (historicalIdeas.length > 0) {
      histTbody.innerHTML = historicalIdeas.map(i => `
        <tr>
          <td><strong>${escapeHtml(i.title)}</strong></td>
          <td>${escapeHtml(i.owner_name || 'Member')}</td>
          <td><span class="status-badge status-${i.status.toLowerCase()}">${i.status}</span></td>
          <td>${Number(i.green_percentage || 0).toFixed(1)}%</td>
          <td>${i.created_at ? i.created_at.slice(0, 10) : '-'}</td>
        </tr>
      `).join('');
    } else {
      histTbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:#94a3b8;">No historical ideas found.</td></tr>';
    }
  }

  // Override Form Submit
  const overrideForm = document.getElementById('overrideForm');
  if (overrideForm) {
    overrideForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const ideaId = document.getElementById('overrideIdeaId').value;
      const decision = document.getElementById('overrideDecision').value;
      const reason = document.getElementById('overrideReason').value.trim();

      const res = await apiCall('PATCH', `/api/admin/ideas/${ideaId}/override`, { decision, reason });
      if (res.ok) {
        showToast(`Idea decision overridden to: ${decision}`);
        closeModal('overrideModal');
        overrideForm.reset();
        loadIdeasView();
        loadOverview();
      } else {
        showToast(res.data.error || 'Override failed', true);
      }
    });
  }

  // ---------------------------------------------------------------------------
  // VIEW 4: PROJECT PIPELINE & FINAL REVIEW
  // ---------------------------------------------------------------------------
  async function loadProjectsView() {
    const res = await apiCall('GET', '/api/admin/projects/all');
    if (!res.ok) return;

    const projects = res.data.projects || [];
    const tbody = document.getElementById('projectsTableBody');

    if (projects.length > 0) {
      tbody.innerHTML = projects.map(p => `
        <tr>
          <td><strong>${escapeHtml(p.title)}</strong></td>
          <td><span class="status-badge status-${p.current_stage === 'LIVE' ? 'live' : 'pending'}">${p.current_stage}</span></td>
          <td><span class="status-badge status-${p.status.toLowerCase()}">${p.status}</span></td>
          <td>${p.created_at ? p.created_at.slice(0, 10) : '-'}</td>
          <td>
            ${p.current_stage === 'ADMIN_REVIEW' ? `
              <button class="btn-success btn-review-project" data-id="${p.id}" data-title="${escapeHtml(p.title)}">Final Review Gate</button>
            ` : '<span style="color:#64748b; font-size:12px;">In Parallel Progress</span>'}
          </td>
        </tr>
      `).join('');

      document.querySelectorAll('.btn-review-project').forEach(btn => {
        btn.addEventListener('click', () => {
          document.getElementById('reviewProjectId').value = btn.dataset.id;
          document.getElementById('reviewProjectTitle').value = btn.dataset.title;
          openModal('projectReviewModal');
        });
      });
    } else {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:#94a3b8;">No projects active.</td></tr>';
    }
  }

  // Project Final Review Form Submit
  const projectReviewForm = document.getElementById('projectReviewForm');
  if (projectReviewForm) {
    projectReviewForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const projectId = document.getElementById('reviewProjectId').value;
      const approved = document.getElementById('reviewDecision').value === 'true';
      const notes = document.getElementById('reviewNotes').value.trim();

      const res = await apiCall('PATCH', `/api/admin/projects/${projectId}/final-review`, { approved, notes });
      if (res.ok) {
        showToast(approved ? 'Project approved and successfully launched LIVE!' : 'Project rejected back to development/testing.');
        closeModal('projectReviewModal');
        loadProjectsView();
        loadOverview();
      } else {
        showToast(res.data.error || 'Final review submission failed', true);
      }
    });
  }

  // ---------------------------------------------------------------------------
  // VIEW 5: REVENUE & PAYOUTS
  // ---------------------------------------------------------------------------
  async function loadRevenueView() {
    // Populate project dropdown for revenue entry
    const projRes = await apiCall('GET', '/api/admin/projects/all');
    const select = document.getElementById('revProjectSelect');
    if (projRes.ok && projRes.data.projects) {
      select.innerHTML = '<option value="">-- Choose Project --</option>' + 
        projRes.data.projects.map(p => `<option value="${p.id}">${escapeHtml(p.title)} (${p.current_stage})</option>`).join('');
    }

    // Pending Withdrawals
    const withRes = await apiCall('GET', '/api/admin/withdrawals/pending');
    const withTbody = document.getElementById('withdrawalsTableBody');
    if (withRes.ok && withRes.data.withdrawals) {
      const withdrawals = withRes.data.withdrawals;
      if (withdrawals.length > 0) {
        withTbody.innerHTML = withdrawals.map(w => `
          <tr>
            <td><strong>${escapeHtml(w.user_name || 'Member')}</strong></td>
            <td>₹${Number(w.amount).toFixed(2)}</td>
            <td>${w.requested_at ? w.requested_at.slice(0, 16) : '-'}</td>
            <td><span class="status-badge status-pending">${w.status}</span></td>
            <td>
              <button class="btn-success btn-approve-with" data-id="${w.id}">Approve</button>
              <button class="btn-danger btn-reject-with" data-id="${w.id}">Reject</button>
            </td>
          </tr>
        `).join('');

        document.querySelectorAll('.btn-approve-with').forEach(btn => {
          btn.addEventListener('click', async () => {
            const ok = confirm('Confirm approval for gateway disbursement?');
            if (!ok) return;
            const res = await apiCall('PATCH', `/api/admin/withdrawals/${btn.dataset.id}/approve`);
            if (res.ok) {
              showToast('Withdrawal approved and disbursed via gateway!');
              loadRevenueView();
              loadOverview();
            } else {
              showToast(res.data.error || 'Approval failed', true);
            }
          });
        });

        document.querySelectorAll('.btn-reject-with').forEach(btn => {
          btn.addEventListener('click', async () => {
            const reason = prompt('Enter mandatory rejection reason:');
            if (!reason) return;
            const res = await apiCall('PATCH', `/api/admin/withdrawals/${btn.dataset.id}/reject`, { rejection_reason: reason });
            if (res.ok) {
              showToast('Withdrawal request rejected.');
              loadRevenueView();
              loadOverview();
            } else {
              showToast(res.data.error || 'Rejection failed', true);
            }
          });
        });
      } else {
        withTbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:#94a3b8;">No pending withdrawals.</td></tr>';
      }
    }

    // Immutable Ledger
    const ledgerRes = await apiCall('GET', '/api/admin/revenue/ledger');
    const ledgerTbody = document.getElementById('revenueLedgerTableBody');
    if (ledgerRes.ok && ledgerRes.data.splits) {
      const splits = ledgerRes.data.splits;
      if (splits.length > 0) {
        ledgerTbody.innerHTML = splits.map(s => `
          <tr>
            <td><code style="color:#f87171;">${s.id.slice(0, 8)}...</code></td>
            <td>${escapeHtml(s.project_title || 'Project')}</td>
            <td>${escapeHtml(s.user_name || 'Member')}</td>
            <td>₹${Number(s.amount).toFixed(2)}</td>
            <td><span class="status-badge status-approved">${s.rule_applied}</span></td>
            <td>${s.created_at ? s.created_at.slice(0, 16) : '-'}</td>
          </tr>
        `).join('');
      } else {
        ledgerTbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:#94a3b8;">Ledger is empty.</td></tr>';
      }
    }
  }

  // Enter Revenue Form Submit
  const enterRevenueForm = document.getElementById('enterRevenueForm');
  if (enterRevenueForm) {
    enterRevenueForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const projectId = document.getElementById('revProjectSelect').value;
      const amount = parseFloat(document.getElementById('revAmountInput').value);
      const source = document.getElementById('revSourceInput').value.trim();

      const res = await apiCall('POST', `/api/admin/projects/${projectId}/revenue`, { amount, source });
      if (res.ok) {
        showToast(`Revenue event recorded: ₹${amount.toFixed(2)} disbursed to team splits!`);
        enterRevenueForm.reset();
        loadRevenueView();
        loadOverview();
      } else {
        showToast(res.data.error || 'Failed to record revenue', true);
      }
    });
  }

  // ---------------------------------------------------------------------------
  // VIEW 6: OFFBOARDING CENTER & WALLET SETTLEMENT
  // ---------------------------------------------------------------------------
  async function loadOffboardingView() {
    // 1. Frozen Wallets
    const frozenRes = await apiCall('GET', '/api/admin/wallets/frozen');
    const frozenTbody = document.getElementById('frozenWalletsTableBody');
    if (frozenRes.ok && frozenRes.data.frozenWallets) {
      const wallets = frozenRes.data.frozenWallets;
      if (wallets.length > 0) {
        frozenTbody.innerHTML = wallets.map(w => `
          <tr>
            <td><strong>${escapeHtml(w.name)}</strong></td>
            <td>${escapeHtml(w.email)}</td>
            <td>₹${Number(w.wallet_balance).toFixed(2)}</td>
            <td><span class="status-badge status-inactive">FROZEN</span></td>
            <td>
              <button class="btn-success btn-settle-wallet" data-id="${w.id}" data-name="${escapeHtml(w.name)}" data-amount="${Number(w.wallet_balance).toFixed(2)}">Settle Manually</button>
            </td>
          </tr>
        `).join('');

        document.querySelectorAll('.btn-settle-wallet').forEach(btn => {
          btn.addEventListener('click', () => {
            document.getElementById('settleUserId').value = btn.dataset.id;
            document.getElementById('settleUserName').value = btn.dataset.name;
            document.getElementById('settleAmount').value = btn.dataset.amount;
            openModal('settleWalletModal');
          });
        });
      } else {
        frozenTbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:#94a3b8;">No frozen wallets awaiting settlement.</td></tr>';
      }
    }

    // 2. Offboarding History
    const histRes = await apiCall('GET', '/api/admin/offboarding/history');
    const histTbody = document.getElementById('offboardingHistoryTableBody');
    if (histRes.ok && histRes.data.offboardingHistory) {
      const history = histRes.data.offboardingHistory;
      if (history.length > 0) {
        histTbody.innerHTML = history.map(h => `
          <tr>
            <td><strong>${escapeHtml(h.user_name || 'Former Member')}</strong></td>
            <td>${escapeHtml(h.initiated_by_name || 'Admin')}</td>
            <td><span class="status-badge status-${h.status === 'COMPLETED' ? 'active' : 'pending'}">${h.status}</span></td>
            <td>${h.initiated_at ? h.initiated_at.slice(0, 16) : '-'}</td>
            <td>${escapeHtml(h.reason || 'None')}</td>
            <td><button class="btn-action btn-view-checklist" data-id="${h.id}">View 7-Step Audit</button></td>
          </tr>
        `).join('');

        document.querySelectorAll('.btn-view-checklist').forEach(btn => {
          btn.addEventListener('click', async () => {
            const statusRes = await apiCall('GET', `/api/admin/offboarding/${btn.dataset.id}/status`);
            if (statusRes.ok) {
              const checklist = statusRes.data.checklist || [];
              alert(`7-STEP OFFBOARDING CHECKLIST:\n\n` + checklist.map(c => `[${c.status}] Step ${c.step}: ${c.service_name} - ${c.action_required}`).join('\n'));
            }
          });
        });
      } else {
        histTbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:#94a3b8;">No past offboarding records.</td></tr>';
      }
    }
  }

  // Settle Wallet Form Submit
  const settleWalletForm = document.getElementById('settleWalletForm');
  if (settleWalletForm) {
    settleWalletForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const userId = document.getElementById('settleUserId').value;
      const notes = document.getElementById('settleNotes').value.trim();

      const res = await apiCall('POST', `/api/admin/wallets/${userId}/settle`, { notes });
      if (res.ok) {
        showToast('Frozen wallet balance settled and cleared successfully!');
        closeModal('settleWalletModal');
        loadOffboardingView();
        loadOverview();
      } else {
        showToast(res.data.error || 'Settlement failed', true);
      }
    });
  }

  // ---------------------------------------------------------------------------
  // VIEW 7: SYSTEM CONFIGURATION
  // ---------------------------------------------------------------------------
  async function loadConfigView() {
    const res = await apiCall('GET', '/api/admin/config');
    if (!res.ok) return;

    const cfgs = res.data.configs || {};
    document.getElementById('cfgIdeaQuotaLimit').value = cfgs['idea_quota_limit'] || 3;
    document.getElementById('cfgIdeaQuotaWindowDays').value = cfgs['idea_quota_window_days'] || 7;
    document.getElementById('cfgVoteApprovalThreshold').value = cfgs['vote_approval_threshold'] || 75;
    document.getElementById('cfgVoteQuorumPercentage').value = cfgs['vote_quorum_percentage'] || 80;
    document.getElementById('cfgVotingWindowHours').value = cfgs['voting_window_hours'] || 72;
    document.getElementById('cfgRevSplitDurationMonths').value = cfgs['revenue_split_duration_months'] || 5;
  }

  const systemConfigForm = document.getElementById('systemConfigForm');
  if (systemConfigForm) {
    systemConfigForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const limit = parseInt(document.getElementById('cfgIdeaQuotaLimit').value, 10);
      const windowDays = parseInt(document.getElementById('cfgIdeaQuotaWindowDays').value, 10);
      const approvalThreshold = parseFloat(document.getElementById('cfgVoteApprovalThreshold').value);
      const quorumPercentage = parseFloat(document.getElementById('cfgVoteQuorumPercentage').value);
      const windowHours = parseInt(document.getElementById('cfgVotingWindowHours').value, 10);
      const revenueSplitDurationMonths = parseInt(document.getElementById('cfgRevSplitDurationMonths').value, 10);

      // Quota
      await apiCall('PATCH', '/api/admin/config/quota', { limit, windowDays });
      // Voting
      await apiCall('PATCH', '/api/admin/config/voting', { approvalThreshold, quorumPercentage, windowHours });
      // General
      const genRes = await apiCall('PATCH', '/api/admin/config/general', { revenueSplitDurationMonths });

      if (genRes.ok) {
        showToast('All system configuration parameters saved successfully!');
        loadConfigView();
      } else {
        showToast('Configuration partially updated or failed', true);
      }
    });
  }

  // ---------------------------------------------------------------------------
  // VIEW 8: AUDIT LOGS
  // ---------------------------------------------------------------------------
  async function loadAuditLogs() {
    const action = document.getElementById('auditActionFilter').value.trim();
    const startDate = document.getElementById('auditStartDateFilter').value;
    const endDate = document.getElementById('auditEndDateFilter').value;

    let query = '?limit=50';
    if (action) query += `&action=${encodeURIComponent(action)}`;
    if (startDate) query += `&startDate=${encodeURIComponent(startDate)}`;
    if (endDate) query += `&endDate=${encodeURIComponent(endDate)}`;

    const res = await apiCall('GET', `/api/admin/access-logs${query}`);
    const tbody = document.getElementById('auditLogsTableBody');

    if (res.ok && res.data.logs) {
      const logs = res.data.logs;
      if (logs.length > 0) {
        tbody.innerHTML = logs.map(l => `
          <tr>
            <td><code style="color:#94a3b8;">${l.timestamp ? l.timestamp.slice(0, 19) : '-'}</code></td>
            <td><strong>${escapeHtml(l.user_name || 'System / Unauth')}</strong> <span style="font-size:11px; color:#64748b;">(${l.user_role || 'anon'})</span></td>
            <td><span class="status-badge" style="background:rgba(255,255,255,0.05);">${escapeHtml(l.action)}</span></td>
            <td style="max-width:320px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${escapeHtml(l.resource || '')}">${escapeHtml(l.resource || '-')}</td>
            <td><code>${escapeHtml(l.ip_address || '-')}</code></td>
          </tr>
        `).join('');
      } else {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:#94a3b8;">No audit logs match criteria.</td></tr>';
      }
    }
  }

  document.getElementById('btnFilterAuditLogs')?.addEventListener('click', loadAuditLogs);
  document.getElementById('btnResetAuditLogs')?.addEventListener('click', () => {
    document.getElementById('auditActionFilter').value = '';
    document.getElementById('auditStartDateFilter').value = '';
    document.getElementById('auditEndDateFilter').value = '';
    loadAuditLogs();
  });

  // ---------------------------------------------------------------------------
  // VIEW 8: MEETING MANAGEMENT & AI GOVERNANCE
  // ---------------------------------------------------------------------------
  async function loadMeetingsView() {
    const res = await apiCall('GET', '/api/admin/meetings');
    const tbody = document.getElementById('meetingsTableBody');
    if (!tbody) return;

    if (res.ok && res.data.meetings) {
      const meetings = res.data.meetings;
      if (meetings.length > 0) {
        tbody.innerHTML = meetings.map(m => {
          const isLive = m.status === 'LIVE';
          const isScheduled = m.status === 'SCHEDULED';
          const isEnded = m.status === 'ENDED';

          let actions = '';
          if (isScheduled) {
            actions += `<button class="btn-action btn-start-meeting" data-id="${m.id}" style="color: #4ade80;">Start</button> `;
            actions += `<button class="btn-action btn-cancel-meeting" data-id="${m.id}" style="color: #f87171;">Cancel</button> `;
          } else if (isLive) {
            actions += `<button class="btn-action btn-end-meeting" data-id="${m.id}" style="color: #f87171;">End</button> `;
          }

          if (isEnded && m.recording_enabled) {
            if (!m.recording_file_path) {
              actions += `<button class="btn-action btn-upload-recording" data-id="${m.id}" data-title="${escapeHtml(m.title)}">Upload Recording</button> `;
            }
          }

          if (m.notes_id) {
            const isConfirmed = Boolean(m.confirmed_at);
            actions += `<button class="btn-action btn-review-notes" data-id="${m.id}" data-title="${escapeHtml(m.title)}" data-raw="${escapeHtml(m.transcript_raw || '')}" data-en="${escapeHtml(m.notes_english || '')}" data-hi="${escapeHtml(m.notes_hindi || '')}" style="${isConfirmed ? 'color:#4ade80;' : 'color:#facc15;'}">${isConfirmed ? '✓ Confirmed Notes' : '⚡ Review AI Draft'}</button>`;
          }

          return `
            <tr>
              <td><strong>${escapeHtml(m.title)}</strong></td>
              <td><span class="badge" style="font-size:11px;">${m.meeting_type}</span></td>
              <td><span class="status-badge ${isLive ? 'status-live' : isScheduled ? 'status-pending' : 'status-inactive'}">${m.status}</span></td>
              <td>${escapeHtml(m.host_name || 'Admin')}</td>
              <td>${m.attendee_count || 0}</td>
              <td>${m.started_at ? m.started_at.slice(0, 16) : m.scheduled_at ? m.scheduled_at.slice(0, 16) : '-'}</td>
              <td>${actions || '-'}</td>
            </tr>
          `;
        }).join('');

        // Wire event handlers
        document.querySelectorAll('.btn-start-meeting').forEach(btn => {
          btn.addEventListener('click', async () => {
            const mId = btn.dataset.id;
            const sRes = await apiCall('PATCH', `/api/meetings/${mId}/start`);
            if (sRes.ok) {
              showToast('Meeting started! Notification sent to all members.');
              loadMeetingsView();
            } else {
              showToast(sRes.data.error || 'Failed to start meeting', true);
            }
          });
        });

        document.querySelectorAll('.btn-end-meeting').forEach(btn => {
          btn.addEventListener('click', async () => {
            if (!confirm('End this meeting for all participants?')) return;
            const mId = btn.dataset.id;
            const eRes = await apiCall('PATCH', `/api/meetings/${mId}/end`);
            if (eRes.ok) {
              showToast('Meeting ended cleanly. Attendance locked.');
              loadMeetingsView();
            } else {
              showToast(eRes.data.error || 'Failed to end meeting', true);
            }
          });
        });

        document.querySelectorAll('.btn-cancel-meeting').forEach(btn => {
          btn.addEventListener('click', async () => {
            const mId = btn.dataset.id;
            const cRes = await apiCall('PATCH', `/api/meetings/${mId}/cancel`);
            if (cRes.ok) {
              showToast('Meeting cancelled.');
              loadMeetingsView();
            } else {
              showToast(cRes.data.error || 'Failed to cancel meeting', true);
            }
          });
        });

        document.querySelectorAll('.btn-upload-recording').forEach(btn => {
          btn.addEventListener('click', () => {
            document.getElementById('uploadRecMeetingId').value = btn.dataset.id;
            document.getElementById('uploadRecMeetingTitle').value = btn.dataset.title;
            openModal('adminUploadRecordingModal');
          });
        });

        document.querySelectorAll('.btn-review-notes').forEach(btn => {
          btn.addEventListener('click', () => {
            document.getElementById('reviewNotesMeetingId').value = btn.dataset.id;
            document.getElementById('reviewNotesMeetingTitle').value = btn.dataset.title;
            document.getElementById('reviewNotesRaw').value = btn.dataset.raw;
            document.getElementById('reviewNotesEnglish').value = btn.dataset.en;
            document.getElementById('reviewNotesHindi').value = btn.dataset.hi;
            openModal('adminReviewNotesModal');
          });
        });

      } else {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color:#94a3b8;">No meetings created yet.</td></tr>';
      }
    }
  }

  // Admin Launch Meeting Button
  document.getElementById('btnAdminLaunchMeeting')?.addEventListener('click', () => {
    window.location.href = '/#meeting-schedule';
  });

  // Admin Confirm Notes Form
  document.getElementById('adminReviewNotesForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const mId = document.getElementById('reviewNotesMeetingId').value;
    const raw = document.getElementById('reviewNotesRaw').value;
    const en = document.getElementById('reviewNotesEnglish').value;
    const hi = document.getElementById('reviewNotesHindi').value;

    const res = await apiCall('PATCH', `/api/admin/meetings/${mId}/notes/confirm`, {
      transcript_raw: raw,
      notes_english: en,
      notes_hindi: hi
    });

    if (res.ok) {
      showToast('Meeting notes confirmed! Published to meeting participants.');
      closeModal('adminReviewNotesModal');
      loadMeetingsView();
    } else {
      showToast(res.data.error || 'Failed to confirm notes', true);
    }
  });

  // Admin Upload Recording Form
  document.getElementById('adminUploadRecordingForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const mId = document.getElementById('uploadRecMeetingId').value;
    const fileInput = document.getElementById('uploadRecFile');
    if (!fileInput.files || fileInput.files.length === 0) {
      showToast('Please select an audio file', true);
      return;
    }

    const formData = new FormData();
    formData.append('recording', fileInput.files[0]);

    try {
      showToast('Uploading recording file...');
      const res = await fetch(`/api/meetings/${mId}/recording`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${state.token}`
        },
        body: formData
      });

      const data = await res.json();
      if (res.ok) {
        showToast('Recording uploaded! AI Whisper transcription pipeline started.');
        closeModal('adminUploadRecordingModal');
        fileInput.value = '';
        loadMeetingsView();
      } else {
        showToast(data.error || 'Failed to upload recording', true);
      }
    } catch (err) {
      console.error('Recording upload error:', err);
      showToast('Failed to upload recording file', true);
    }
  });

  // Logout
  document.getElementById('adminLogoutBtn')?.addEventListener('click', (e) => {
    e.preventDefault();
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.location.href = '/';
  });

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Initial load
  loadOverview();

})();
