/**
 * Step 09: Frontend User Profile Page Controller
 * Handles profile fetching, tab lazy-loading, financial privacy gating, and former member states.
 */

(function () {
  const urlParams = new URLSearchParams(window.location.search);
  const targetUserId = urlParams.get('id') || 'me';
  let activeTab = urlParams.get('tab') || 'ideas';

  let currentProfileData = null;
  let currentAuthToken = localStorage.getItem('token') || '';

  // Authentication gate: no session means back to the login page
  if (!currentAuthToken) {
    window.location.replace('/login.html');
    return;
  }

  // DOM Elements
  const avatarDisplay = document.getElementById('avatarDisplay');
  const nameDisplay = document.getElementById('nameDisplay');
  const roleBadge = document.getElementById('roleBadge');
  const formerMemberPill = document.getElementById('formerMemberPill');
  const emailDisplay = document.getElementById('emailDisplay');
  const ratingGauge = document.getElementById('ratingGauge');
  const bioDisplay = document.getElementById('bioDisplay');
  const bioActions = document.getElementById('bioActions');
  const btnEditBio = document.getElementById('btnEditBio');

  const statIdeas = document.getElementById('statIdeas');
  const statProjects = document.getElementById('statProjects');
  const statApproval = document.getElementById('statApproval');
  const statEarned = document.getElementById('statEarned');

  const tabButtons = document.querySelectorAll('.tab-btn');
  const tabPanes = {
    ideas: document.getElementById('paneIdeas'),
    projects: document.getElementById('paneProjects'),
    ratings: document.getElementById('paneRatings'),
    earnings: document.getElementById('paneEarnings'),
    settings: document.getElementById('paneSettings')
  };

  const loadedTabs = {};

  async function apiFetch(endpoint, options = {}) {
    const headers = options.headers || {};
    if (currentAuthToken) {
      headers['Authorization'] = `Bearer ${currentAuthToken}`;
    }
    headers['Content-Type'] = 'application/json';

    const res = await fetch(endpoint, { ...options, headers });
    let data = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    return { status: res.status, ok: res.ok, data };
  }

  async function initProfile() {
    // If no token exists, attempt to fetch current user session from /api/users/me
    const profileRes = await apiFetch(`/api/users/${targetUserId}/profile`);

    if (!profileRes.ok) {
      nameDisplay.textContent = 'User Profile Not Found';
      bioDisplay.textContent = profileRes.data?.error || 'Unable to load profile details.';
      return;
    }

    currentProfileData = profileRes.data;
    renderHeader(currentProfileData);
    setupTabs();
    switchTab(activeTab);
    setupUpiIdField(currentProfileData);
    setupGithubField(currentProfileData);
    setupNotificationPrefs();
  }

  /**
   * Payout UPI ID (Settings tab) — populate from own profile and save via API.
   */
  function setupUpiIdField(profileData) {
    const upiInput = document.getElementById('upiIdInput');
    const saveBtn = document.getElementById('saveUpiBtn');
    const feedback = document.getElementById('upiSaveFeedback');
    if (!upiInput || !saveBtn) return;

    const isSelf = profileData?.user?.id === (JSON.parse(localStorage.getItem('user') || '{}').id);
    if (!isSelf) return; // UPI settings only for the owner's own profile

    if (profileData?.user?.upi_id) {
      upiInput.value = profileData.user.upi_id;
    }

    saveBtn.addEventListener('click', async () => {
      const value = upiInput.value.trim();
      feedback.style.display = 'block';
      feedback.style.color = '#94a3b8';
      feedback.textContent = 'Saving...';

      const res = await apiFetch('/api/users/me/profile', {
        method: 'PATCH',
        body: JSON.stringify({ upi_id: value })
      });

      if (res.ok) {
        feedback.style.color = '#10b981';
        feedback.textContent = value ? '✓ UPI ID saved! Payouts will use this address.' : '✓ UPI ID cleared.';
      } else {
        feedback.style.color = '#f87171';
        feedback.textContent = `✗ ${res.data?.error || 'Save failed'}`;
      }
    });
  }

  /**
   * Notification preferences — load mutable types, save muted set.
   */
  function setupNotificationPrefs() {
    const list = document.getElementById('notifPrefsList');
    const saveBtn = document.getElementById('saveNotifPrefsBtn');
    const feedback = document.getElementById('notifPrefsFeedback');
    if (!list || !saveBtn) return;

    let mutableTypes = [];
    let muted = [];

    apiFetch('/api/users/me/notification-preferences').then((res) => {
      if (!res.ok) return;
      mutableTypes = res.data.mutable_types || [];
      muted = res.data.muted_types || [];
      list.innerHTML = mutableTypes.map((t) => `
        <label style="display:flex; align-items:center; gap:10px; font-size:0.85rem; color:#e2e8f0; cursor:pointer;">
          <input type="checkbox" data-type="${t}" ${muted.includes(t) ? '' : 'checked'}>
          <span>${t.replace(/[._]/g, ' ')}</span>
        </label>`).join('');
    });

    saveBtn.addEventListener('click', async () => {
      const checked = Array.from(list.querySelectorAll('input:checked')).map((cb) => cb.dataset.type);
      const mutedTypes = mutableTypes.filter((t) => !checked.includes(t));
      feedback.style.display = 'block';
      feedback.style.color = '#94a3b8';
      feedback.textContent = 'Saving...';
      const res = await apiFetch('/api/users/me/notification-preferences', {
        method: 'PUT',
        body: JSON.stringify({ muted_types: mutedTypes })
      });
      if (res.ok) {
        feedback.style.color = '#10b981';
        feedback.textContent = '✓ Preferences saved.';
      } else {
        feedback.style.color = '#f87171';
        feedback.textContent = `✗ ${res.data?.error || 'Save failed'}`;
      }
    });
  }

  /**
   * GitHub username (Settings tab) — self-serve: save + auto-provision org access.
   */
  function setupGithubField(profileData) {
    const ghInput = document.getElementById('ghUserInput');
    const ghBtn = document.getElementById('saveGhBtn');
    const ghFeedback = document.getElementById('ghSaveFeedback');
    if (!ghInput || !ghBtn) return;

    const me = JSON.parse(localStorage.getItem('user') || '{}');
    if (profileData?.user?.id !== me.id) return;

    if (profileData?.user?.github_username) ghInput.value = profileData.user.github_username;

    ghBtn.addEventListener('click', async () => {
      const value = ghInput.value.trim();
      ghFeedback.style.display = 'block';
      ghFeedback.style.color = '#94a3b8';
      ghFeedback.textContent = 'Saving & requesting access...';

      const res = await apiFetch('/api/users/me/profile', {
        method: 'PATCH',
        body: JSON.stringify({ github_username: value })
      });

      if (res.ok) {
        const gh = res.data.github;
        if (gh && gh.provisioned) {
          ghFeedback.style.color = '#10b981';
          ghFeedback.textContent = `✓ Saved! GitHub org invite sent — check your GitHub notifications/email for @${gh.org}${gh.team ? ` (team: ${gh.team})` : ''}.`;
        } else if (gh) {
          ghFeedback.style.color = '#fbbf24';
          ghFeedback.textContent = `Saved, but access needs Admin help: ${gh.message || gh.reason}`;
        } else {
          ghFeedback.style.color = '#10b981';
          ghFeedback.textContent = '✓ Username saved.';
        }
      } else {
        ghFeedback.style.color = '#f87171';
        ghFeedback.textContent = `✗ ${res.data?.error || 'Save failed'}`;
      }
    });
  }

  function renderHeader(data) {
    const u = data.user;
    const s = data.stats;

    avatarDisplay.textContent = u.avatar || u.name.charAt(0).toUpperCase();
    nameDisplay.textContent = u.name;
    emailDisplay.textContent = u.email;

    // Role badge
    roleBadge.className = `role-badge ${u.role || 'researcher'}`;
    roleBadge.textContent = u.subRole ? `${u.role} (${u.subRole})` : u.role;

    // Rating
    ratingGauge.textContent = `★ ${u.ratingAvg} / 5.0`;

    // Former member check
    if (u.isFormerMember) {
      formerMemberPill.style.display = 'inline-block';
      const leftDate = u.deactivatedAt ? new Date(u.deactivatedAt).toLocaleDateString() : 'Previously';
      formerMemberPill.textContent = `⚠️ Former Member (Left on ${leftDate})`;
    } else {
      formerMemberPill.style.display = 'none';
    }

    // Bio
    bioDisplay.textContent = u.bio || 'No personal bio added yet.';

    // Allow editing only if viewing self and not former member
    if ((targetUserId === 'me' || targetUserId === u.id) && !u.isFormerMember) {
      bioActions.style.display = 'block';
      btnEditBio.addEventListener('click', handleBioEdit);
    }

    // Quick Stats
    statIdeas.textContent = s.ideasSubmitted;
    statProjects.textContent = s.projectsBuilt;
    statApproval.textContent = `${s.approvalRate}%`;
    statEarned.textContent = `₹${parseFloat(s.totalRevenueEarned).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
  }

  function setupTabs() {
    tabButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.getAttribute('data-tab');
        switchTab(tab);
      });
    });
  }

  function switchTab(tabName) {
    activeTab = tabName;
    tabButtons.forEach(b => {
      b.classList.toggle('active', b.getAttribute('data-tab') === tabName);
    });

    Object.keys(tabPanes).forEach(k => {
      tabPanes[k].classList.toggle('active', k === tabName);
    });

    // Update URL query parameter without full reload
    const currentUrl = new URL(window.location);
    currentUrl.searchParams.set('tab', tabName);
    window.history.replaceState({}, '', currentUrl);

    // Lazy load tab data
    if (!loadedTabs[tabName]) {
      loadTabData(tabName);
    }
  }

  async function loadTabData(tabName) {
    if (tabName === 'ideas') {
      const container = document.getElementById('ideasContainer');
      container.innerHTML = '<p style="color: #94a3b8;">Loading ideas history...</p>';
      const res = await apiFetch(`/api/users/${targetUserId}/ideas`);
      if (!res.ok) {
        container.innerHTML = `<p style="color: #ef4444;">Failed to load ideas: ${res.data?.error || 'Unknown error'}</p>`;
        return;
      }
      renderIdeas(res.data.ideas, container);
      loadedTabs['ideas'] = true;
    } else if (tabName === 'projects') {
      const container = document.getElementById('projectsContainer');
      container.innerHTML = '<p style="color: #94a3b8;">Loading projects history...</p>';
      const res = await apiFetch(`/api/users/${targetUserId}/projects`);
      if (!res.ok) {
        container.innerHTML = `<p style="color: #ef4444;">Failed to load projects: ${res.data?.error || 'Unknown error'}</p>`;
        return;
      }
      renderProjects(res.data.projects, container);
      loadedTabs['projects'] = true;
    } else if (tabName === 'ratings') {
      const container = document.getElementById('ratingsContainer');
      container.innerHTML = '<p style="color: #94a3b8;">Loading ratings breakdown...</p>';
      const res = await apiFetch(`/api/users/${targetUserId}/ratings`);
      if (!res.ok) {
        container.innerHTML = `<p style="color: #ef4444;">Failed to load ratings: ${res.data?.error || 'Unknown error'}</p>`;
        return;
      }
      renderRatings(res.data, container);
      loadedTabs['ratings'] = true;
    } else if (tabName === 'earnings') {
      const container = document.getElementById('earningsContainer');
      container.innerHTML = '<p style="color: #94a3b8;">Loading earnings ledger...</p>';
      
      // Try full earnings ledger first (Owner or Admin)
      const res = await apiFetch(`/api/users/${targetUserId}/earnings`);
      if (res.status === 200) {
        renderEarningsFull(res.data, container);
      } else if (res.status === 403) {
        // Privacy rule triggered: fetch aggregate summary for peers
        const summaryRes = await apiFetch(`/api/users/${targetUserId}/earnings-summary`);
        if (summaryRes.ok) {
          renderEarningsSummary(summaryRes.data, container);
        } else {
          container.innerHTML = `<p style="color: #ef4444;">Unable to load earnings information.</p>`;
        }
      } else {
        container.innerHTML = `<p style="color: #ef4444;">Error loading earnings ledger.</p>`;
      }
      loadedTabs['earnings'] = true;
    } else if (tabName === 'settings') {
      setupLanguagePreferences();
      loadedTabs['settings'] = true;
    }
  }

  function setupLanguagePreferences() {
    const radioEn = document.getElementById('radioLangEn');
    const radioHi = document.getElementById('radioLangHi');
    const feedback = document.getElementById('langSaveFeedback');
    const currentPref = localStorage.getItem('mtg_language_preference') || 'en';

    if (currentPref === 'hi' && radioHi) {
      radioHi.checked = true;
    } else if (radioEn) {
      radioEn.checked = true;
    }

    const savePref = (val) => {
      localStorage.setItem('mtg_language_preference', val);
      if (feedback) {
        feedback.style.display = 'block';
        feedback.textContent = val === 'hi' 
          ? '✓ भाषा प्राथमिकता हिंदी सेट की गई! (Language set to Hindi for localized content)' 
          : '✓ Language preference set to English!';
        setTimeout(() => { feedback.style.display = 'none'; }, 3500);
      }
    };

    if (radioEn) radioEn.addEventListener('change', () => savePref('en'));
    if (radioHi) radioHi.addEventListener('change', () => savePref('hi'));
  }

  function renderIdeas(ideas, container) {
    if (!ideas || ideas.length === 0) {
      container.innerHTML = '<div class="privacy-banner"><p>No submitted ideas found in permanent record.</p></div>';
      return;
    }

    let html = `
      <table class="card-list-table">
        <thead>
          <tr>
            <th>Idea Title</th>
            <th>Status</th>
            <th>Green Vote %</th>
            <th>Linked Project</th>
            <th>Submitted On</th>
          </tr>
        </thead>
        <tbody>
    `;

    ideas.forEach(i => {
      const statusClass = `badge-${i.status ? i.status.toLowerCase() : 'draft'}`;
      const projectLink = i.project_id ? `<a href="/" style="color: #3b82f6; text-decoration: none;">${escapeHtml(i.project_title || 'View Project')} (${i.project_stage})</a>` : '<span style="color: #64748b;">None</span>';
      const dateStr = i.created_at ? new Date(i.created_at).toLocaleDateString() : 'N/A';

      html += `
        <tr>
          <td><strong>${escapeHtml(i.title)}</strong></td>
          <td><span class="status-badge ${statusClass}">${i.status}</span></td>
          <td>${i.green_percentage ? `${Number(i.green_percentage).toFixed(1)}%` : '0.0%'}</td>
          <td>${projectLink}</td>
          <td>${dateStr}</td>
        </tr>
      `;
    });

    html += '</tbody></table>';
    container.innerHTML = html;
  }

  function renderProjects(projects, container) {
    if (!projects || projects.length === 0) {
      container.innerHTML = '<div class="privacy-banner"><p>No contributed projects found in workspace ledger.</p></div>';
      return;
    }

    let html = `
      <table class="card-list-table">
        <thead>
          <tr>
            <th>Project Title</th>
            <th>Role Played</th>
            <th>Stage</th>
            <th>Weight</th>
            <th>Tasks (Done / Assigned)</th>
            <th>Started</th>
          </tr>
        </thead>
        <tbody>
    `;

    projects.forEach(p => {
      const ownerBadge = p.isIdeaOwner ? '<span class="idea-owner-tag">💡 Idea Owner</span>' : '';
      const dateStr = p.createdAt ? new Date(p.createdAt).toLocaleDateString() : 'N/A';

      html += `
        <tr>
          <td><strong>${escapeHtml(p.title)}</strong> ${ownerBadge}</td>
          <td><span class="role-badge ${p.role ? p.role.toLowerCase() : 'developer'}">${p.role}</span></td>
          <td><span class="status-badge badge-pending">${p.currentStage}</span></td>
          <td>${p.contributionWeight}%</td>
          <td>${p.completedTasks} / ${p.assignedTasks}</td>
          <td>${dateStr}</td>
        </tr>
      `;
    });

    html += '</tbody></table>';
    container.innerHTML = html;
  }

  function renderRatings(data, container) {
    container.innerHTML = `
      <div class="profile-header-card" style="text-align: center; padding: 3rem 1.5rem;">
        <div style="font-size: 3.5rem; color: #fbbf24; margin-bottom: 0.5rem;">★ ${data.ratingAverage}</div>
        <p style="font-size: 1.1rem; color: #f8fafc; font-weight: 600;">Overall Platform Performance Rating</p>
        <p style="color: #94a3b8; font-size: 0.85rem; margin-top: 0.5rem;">Based on contributions across ${data.totalRatedProjects} verified projects • Scale: ${data.ratingScale}</p>
        <div style="margin-top: 1.5rem; display: inline-block; padding: 0.5rem 1rem; border-radius: 6px; background: rgba(59, 130, 246, 0.1); border: 1px solid rgba(59, 130, 246, 0.3); font-size: 0.8rem; color: #93c5fd;">
          ℹ️ ${data.status}
        </div>
      </div>
    `;
  }

  function renderEarningsFull(data, container) {
    const isFrozen = data.isWalletFrozen;
    const withdrawBtnHtml = isFrozen
      ? `<button class="btn-small" disabled style="opacity: 0.5; cursor: not-allowed;" title="Wallet frozen - contact Admin for settlement">🔒 Wallet Frozen (Settlement Pending)</button>`
      : `<button class="btn-small" style="background: #10b981; color: white; border: none; font-weight: 600;" onclick="alert('Withdrawal flow initiated.')">💳 Request Withdrawal</button>`;

    let timelineHtml = '<p style="color: #94a3b8; font-size: 0.85rem;">No revenue splits recorded yet.</p>';
    if (data.timeline && data.timeline.length > 0) {
      timelineHtml = '<div style="display: flex; gap: 0.75rem; flex-wrap: wrap;">';
      data.timeline.forEach(m => {
        timelineHtml += `
          <div style="background: #0f172a; padding: 0.5rem 0.75rem; border-radius: 6px; border: 1px solid #334155; font-size: 0.85rem;">
            <div style="color: #94a3b8; font-size: 0.75rem;">${m.month}</div>
            <div style="font-weight: 700; color: #34d399;">₹${parseFloat(m.monthly_total).toFixed(2)}</div>
          </div>
        `;
      });
      timelineHtml += '</div>';
    }

    let splitsTableHtml = '<p style="color: #94a3b8;">No individual revenue splits recorded.</p>';
    if (data.splits && data.splits.length > 0) {
      splitsTableHtml = `
        <table class="card-list-table">
          <thead>
            <tr>
              <th>Project</th>
              <th>Amount</th>
              <th>Rule Applied</th>
              <th>Date</th>
            </tr>
          </thead>
          <tbody>
      `;
      data.splits.forEach(s => {
        splitsTableHtml += `
          <tr>
            <td><strong>${escapeHtml(s.project_title || 'Project Split')}</strong></td>
            <td style="color: #34d399; font-weight: 700;">₹${parseFloat(s.amount).toFixed(2)}</td>
            <td><span class="role-badge ${s.rule_applied ? s.rule_applied.toLowerCase().replace(/[^a-z0-9]/g, '-') : 'default'}">${s.rule_applied}</span></td>
            <td>${s.created_at ? new Date(s.created_at).toLocaleDateString() : 'N/A'}</td>
          </tr>
        `;
      });
      splitsTableHtml += '</tbody></table>';
    }

    container.innerHTML = `
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1rem; margin-bottom: 1.5rem;">
        <div class="stat-card" style="text-align: left;">
          <div class="stat-lbl">Lifetime Earned (All Projects)</div>
          <div class="stat-val" style="color: #34d399;">₹${parseFloat(data.totalEarned).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div>
        </div>
        <div class="stat-card" style="text-align: left; display: flex; justify-content: space-between; align-items: center;">
          <div>
            <div class="stat-lbl">Withdrawable Wallet Balance</div>
            <div class="stat-val" style="color: #60a5fa;">₹${parseFloat(data.walletBalance).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div>
          </div>
          <div>${withdrawBtnHtml}</div>
        </div>
      </div>

      <div class="profile-header-card" style="padding: 1.5rem; margin-bottom: 1.5rem;">
        <h3 style="font-size: 1rem; margin-bottom: 0.75rem; color: #f8fafc;">Monthly Revenue Timeline</h3>
        ${timelineHtml}
      </div>

      <div class="profile-header-card" style="padding: 1.5rem;">
        <h3 style="font-size: 1rem; margin-bottom: 0.75rem; color: #f8fafc;">Project Split Audit Ledger</h3>
        ${splitsTableHtml}
      </div>
    `;
  }

  function renderEarningsSummary(data, container) {
    container.innerHTML = `
      <div class="privacy-banner">
        <div class="privacy-icon">🔒</div>
        <h3 style="color: #f8fafc; font-size: 1.25rem; margin-bottom: 0.5rem;">Financial Breakdown Private</h3>
        <p style="margin-bottom: 1.25rem;">${data.privacyNotice}</p>
        <div style="display: inline-block; background: #1e293b; padding: 1rem 2rem; border-radius: 8px; border: 1px solid #334155;">
          <div style="font-size: 0.8rem; color: #94a3b8; text-transform: uppercase;">Verified Lifetime Earnings</div>
          <div style="font-size: 1.8rem; font-weight: 700; color: #34d399; margin-top: 0.25rem;">₹${parseFloat(data.totalRevenueEarned).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div>
          <div style="font-size: 0.8rem; color: #64748b; margin-top: 0.35rem;">Across ${data.projectsContributedCount} active projects</div>
        </div>
      </div>
    `;
  }

  async function handleBioEdit() {
    const currentBio = currentProfileData?.user?.bio || '';
    const newBio = prompt('Enter updated bio statement:', currentBio);
    if (newBio === null) return;

    const res = await apiFetch('/api/users/me/profile', {
      method: 'PATCH',
      body: JSON.stringify({ bio: newBio })
    });

    if (res.ok) {
      bioDisplay.textContent = newBio || 'No personal bio added yet.';
      if (currentProfileData?.user) currentProfileData.user.bio = newBio;
      alert('Profile bio updated successfully.');
    } else {
      alert(`Update failed: ${res.data?.error || 'Unknown error'}`);
    }
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  document.addEventListener('DOMContentLoaded', initProfile);
})();
