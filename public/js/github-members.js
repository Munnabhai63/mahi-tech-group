/**
 * PRD 17 — Batch 4: GitHub Team Members Management Controller (Admin Only)
 * 
 * STRICT RULES:
 * - Protected: Strictly verified via GET /api/users/me. Non-admins immediately redirected to /legacy-dashboard.html.
 * - REMOVED membership rows permanently retained and rendered (Attribution is permanent).
 * - Admin role excluded from role selector (admin permissions handled separately).
 * - Server validates all operations; reason must be >= 10 characters on member removal.
 */

(function () {
  'use strict';

  const urlParams = new URLSearchParams(window.location.search);
  let currentProjectId = urlParams.get('projectId') || urlParams.get('id') || '';

  let currentUser = null;
  let allMembers = [];
  let currentProjectMembers = [];
  let userToRemove = null;
  const authToken = localStorage.getItem('mtg_auth_token') || localStorage.getItem('token') || '';

  // DOM Elements
  const bannerSuccess = document.getElementById('bannerSuccess');
  const bannerError = document.getElementById('bannerError');
  const projectSelector = document.getElementById('projectSelector');
  const btnToggleAdd = document.getElementById('btnToggleAdd');
  const addMemberPanel = document.getElementById('addMemberPanel');
  const addMemberForm = document.getElementById('addMemberForm');
  const selectAddMember = document.getElementById('selectAddMember');
  const selectAddRole = document.getElementById('selectAddRole');
  const addInlineError = document.getElementById('addInlineError');
  const btnSubmitAdd = document.getElementById('btnSubmitAdd');

  const membersTableBody = document.getElementById('membersTableBody');

  const removeModal = document.getElementById('removeModal');
  const removeModalWarning = document.getElementById('removeModalWarning');
  const removeMemberForm = document.getElementById('removeMemberForm');
  const removeReason = document.getElementById('removeReason');
  const charCountNotice = document.getElementById('charCountNotice');
  const removeInlineError = document.getElementById('removeInlineError');
  const btnCancelRemove = document.getElementById('btnCancelRemove');
  const btnConfirmRemove = document.getElementById('btnConfirmRemove');

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

  async function loadProjects() {
    // Populate project selector from kanban or my-projects
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

    const myRes = await apiFetch('/api/projects/my');
    if (myRes.ok && myRes.data?.projects) {
      myRes.data.projects.forEach(p => {
        if (p && p.id && !projectsMap.has(p.id)) {
          projectsMap.set(p.id, p);
        }
      });
    }

    if (projectSelector) {
      projectSelector.innerHTML = '<option value="">-- Select Project --</option>';
      projectsMap.forEach((proj, pId) => {
        const opt = document.createElement('option');
        opt.value = pId;
        opt.textContent = `${proj.name || 'Project #' + pId} (${proj.stage || 'ACTIVE'})`;
        projectSelector.appendChild(opt);
      });

      if (currentProjectId) {
        projectSelector.value = currentProjectId;
      }
    }
  }

  async function loadAdminMembers() {
    const res = await apiFetch('/api/admin/members');
    if (res.ok && Array.isArray(res.data)) {
      allMembers = res.data;
    }
  }

  function populateAddMemberDropdown() {
    if (!selectAddMember) return;
    selectAddMember.innerHTML = '<option value="">-- Choose Member --</option>';

    // Find active member userIds in current project
    const activeUserIds = new Set(
      currentProjectMembers
        .filter(m => m.status === 'ACTIVE')
        .map(m => m.userId)
    );

    allMembers.forEach(member => {
      // Don't list if already ACTIVE in this project
      if (activeUserIds.has(member.id)) return;

      const opt = document.createElement('option');
      opt.value = member.id;
      opt.textContent = `${member.name} (${member.email})`;
      selectAddMember.appendChild(opt);
    });
  }

  async function loadProjectMembers(projectId) {
    if (!projectId) {
      if (btnToggleAdd) btnToggleAdd.style.display = 'none';
      if (addMemberPanel) addMemberPanel.style.display = 'none';
      if (membersTableBody) {
        membersTableBody.innerHTML = `
          <tr>
            <td colspan="8" class="empty-state">Select a project to inspect GitHub team memberships.</td>
          </tr>
        `;
      }
      return;
    }

    if (btnToggleAdd) btnToggleAdd.style.display = 'inline-flex';

    const res = await apiFetch(`/api/github/settings/projects/${encodeURIComponent(projectId)}/members`);

    if (!res.ok) {
      showBanner('error', res.data?.error || 'Failed to load project GitHub memberships.');
      return;
    }

    currentProjectMembers = res.data || [];
    populateAddMemberDropdown();
    renderMembersTable(currentProjectMembers);
  }

  function renderMembersTable(members) {
    if (!membersTableBody) return;

    if (!members || members.length === 0) {
      membersTableBody.innerHTML = `
        <tr>
          <td colspan="8" class="empty-state">No GitHub team memberships found for this project.</td>
        </tr>
      `;
      return;
    }

    membersTableBody.innerHTML = '';

    members.forEach(member => {
      const tr = document.createElement('tr');

      // 1. Name
      const tdName = document.createElement('td');
      tdName.textContent = member.username || `User #${member.userId}`;
      tr.appendChild(tdName);

      // 2. GitHub Username
      const tdGithub = document.createElement('td');
      if (member.githubUsername) {
        const ghLink = document.createElement('a');
        ghLink.href = `https://github.com/${encodeURIComponent(member.githubUsername)}`;
        ghLink.target = '_blank';
        ghLink.rel = 'noopener noreferrer';
        ghLink.className = 'user-github-link';
        ghLink.textContent = `@${member.githubUsername}`;
        tdGithub.appendChild(ghLink);
      } else {
        tdGithub.textContent = '—';
      }
      tr.appendChild(tdGithub);

      // 3. Role
      const tdRole = document.createElement('td');
      const roleSpan = document.createElement('span');
      roleSpan.className = 'role-badge';
      roleSpan.textContent = member.role || 'contributor';
      tdRole.appendChild(roleSpan);
      tr.appendChild(tdRole);

      // 4. Team
      const tdTeam = document.createElement('td');
      const teamSpan = document.createElement('span');
      teamSpan.className = 'team-badge';
      teamSpan.textContent = member.teamSlug || '—';
      tdTeam.appendChild(teamSpan);
      tr.appendChild(tdTeam);

      // 5. Status
      const tdStatus = document.createElement('td');
      const statusSpan = document.createElement('span');
      statusSpan.className = 'status-badge';
      if (member.status === 'ACTIVE') {
        statusSpan.classList.add('status-active');
        statusSpan.textContent = 'Active';
      } else {
        statusSpan.classList.add('status-removed');
        statusSpan.textContent = 'Removed';
        const removedDate = member.removedAt ? new Date(member.removedAt).toLocaleDateString() : '';
        statusSpan.title = `Removed: ${member.removedReason || 'No reason provided'} ${removedDate ? '(' + removedDate + ')' : ''}`;
      }
      tdStatus.appendChild(statusSpan);
      tr.appendChild(tdStatus);

      // 6. Added At
      const tdAdded = document.createElement('td');
      tdAdded.textContent = member.addedAt ? new Date(member.addedAt).toLocaleDateString() : '—';
      tr.appendChild(tdAdded);

      // 7. Removed At
      const tdRemoved = document.createElement('td');
      tdRemoved.textContent = member.removedAt ? new Date(member.removedAt).toLocaleDateString() : '—';
      tr.appendChild(tdRemoved);

      // 8. Actions
      const tdActions = document.createElement('td');
      if (member.status === 'ACTIVE') {
        const btnRemove = document.createElement('button');
        btnRemove.type = 'button';
        btnRemove.className = 'btn btn-danger';
        btnRemove.textContent = 'Remove';
        btnRemove.addEventListener('click', () => openRemoveModal(member));
        tdActions.appendChild(btnRemove);
      } else {
        tdActions.textContent = '—';
      }
      tr.appendChild(tdActions);

      membersTableBody.appendChild(tr);
    });
  }

  function openRemoveModal(member) {
    userToRemove = member;
    if (removeModalWarning) {
      removeModalWarning.textContent = `This will remove @${member.githubUsername || member.username} from the ${member.teamSlug || 'team'}. Their attribution history is preserved.`;
    }
    if (removeReason) {
      removeReason.value = '';
    }
    if (charCountNotice) {
      charCountNotice.textContent = '0 / 10 characters minimum';
      charCountNotice.style.color = 'var(--text-muted)';
    }
    if (removeInlineError) {
      removeInlineError.style.display = 'none';
      removeInlineError.textContent = '';
    }
    if (btnConfirmRemove) {
      btnConfirmRemove.disabled = true;
    }
    if (removeModal) {
      removeModal.style.display = 'flex';
    }
  }

  async function handleAddMember(e) {
    e.preventDefault();
    if (!currentProjectId) {
      showBanner('error', 'Please select a project first.');
      return;
    }

    const userId = selectAddMember?.value;
    const role = selectAddRole?.value;

    if (!userId || !role) {
      if (addInlineError) {
        addInlineError.textContent = 'Please choose a member and a role.';
        addInlineError.style.display = 'block';
      }
      return;
    }

    if (btnSubmitAdd) {
      btnSubmitAdd.disabled = true;
      btnSubmitAdd.textContent = 'Adding...';
    }
    if (addInlineError) {
      addInlineError.style.display = 'none';
    }

    const res = await apiFetch(`/api/github/settings/projects/${encodeURIComponent(currentProjectId)}/members/${encodeURIComponent(userId)}/add`, 'POST', {
      role
    });

    if (btnSubmitAdd) {
      btnSubmitAdd.disabled = false;
      btnSubmitAdd.textContent = 'Add Member';
    }

    if (res.ok) {
      showBanner('success', `Member successfully added to team (${res.data?.teamSlug || role})!`);
      if (addMemberPanel) addMemberPanel.style.display = 'none';
      await loadProjectMembers(currentProjectId);
    } else if (res.status === 400 && res.data?.error?.toLowerCase().includes('github account')) {
      if (addInlineError) {
        addInlineError.innerHTML = `${res.data.error} <a href="/github-link.html" style="color:#60a5fa; text-decoration:underline;">Link GitHub Account here</a>.`;
        addInlineError.style.display = 'block';
      }
    } else {
      if (addInlineError) {
        addInlineError.textContent = res.data?.error || 'Failed to add member to GitHub team.';
        addInlineError.style.display = 'block';
      }
    }
  }

  async function handleRemoveMember(e) {
    e.preventDefault();
    if (!userToRemove || !currentProjectId) return;

    const reason = removeReason?.value.trim() || '';
    if (reason.length < 10) {
      if (removeInlineError) {
        removeInlineError.textContent = 'Reason must be at least 10 characters.';
        removeInlineError.style.display = 'block';
      }
      return;
    }

    if (btnConfirmRemove) {
      btnConfirmRemove.disabled = true;
      btnConfirmRemove.textContent = 'Removing...';
    }

    const res = await apiFetch(`/api/github/settings/projects/${encodeURIComponent(currentProjectId)}/members/${encodeURIComponent(userToRemove.userId)}`, 'DELETE', {
      reason
    });

    if (btnConfirmRemove) {
      btnConfirmRemove.disabled = false;
      btnConfirmRemove.textContent = 'Confirm Removal';
    }

    if (res.ok) {
      if (removeModal) removeModal.style.display = 'none';
      showBanner('success', `Member removed from GitHub team. Attribution preserved.`);
      await loadProjectMembers(currentProjectId);
    } else {
      if (removeInlineError) {
        removeInlineError.textContent = res.data?.error || 'Failed to remove member.';
        removeInlineError.style.display = 'block';
      }
    }
  }

  async function init() {
    // 1. Strict Server Auth Gate: Must be Admin
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
        document.body.innerHTML = '<div style="padding:40px;text-align:center;color:#94a3b8;font-family:sans-serif;"><h3>Admin Access Required</h3><p>Please log in as an administrator to manage GitHub teams.</p><a href="/app.html#/login" target="_top" style="display:inline-block;margin-top:12px;padding:8px 16px;background:#3b82f6;color:#fff;border-radius:6px;text-decoration:none;">Go to Login</a></div>';
        return;
      }
      alert('Authentication required. Redirecting to login.');
      window.location.href = '/app.html#/login';
      return;
    }

    if (currentUser.role !== 'admin') {
      alert('Access Restricted: Admin privileges required to manage GitHub teams.');
      window.location.href = '/app.html#/app/dashboard';
      return;
    }

    // 2. Load admin members and projects
    await loadAdminMembers();
    await loadProjects();

    // 3. If project selected, load project memberships
    if (currentProjectId) {
      await loadProjectMembers(currentProjectId);
    }

    // Event Bindings
    projectSelector?.addEventListener('change', () => {
      currentProjectId = projectSelector.value;
      loadProjectMembers(currentProjectId);
    });

    btnToggleAdd?.addEventListener('click', () => {
      if (addMemberPanel) {
        const isShown = addMemberPanel.style.display === 'block';
        addMemberPanel.style.display = isShown ? 'none' : 'block';
      }
    });

    addMemberForm?.addEventListener('submit', handleAddMember);
    removeMemberForm?.addEventListener('submit', handleRemoveMember);

    removeReason?.addEventListener('input', () => {
      const len = removeReason.value.trim().length;
      if (charCountNotice) {
        charCountNotice.textContent = `${len} / 10 characters minimum`;
        charCountNotice.style.color = len >= 10 ? 'var(--color-success)' : 'var(--text-muted)';
      }
      if (btnConfirmRemove) {
        btnConfirmRemove.disabled = len < 10;
      }
    });

    btnCancelRemove?.addEventListener('click', () => {
      if (removeModal) removeModal.style.display = 'none';
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
