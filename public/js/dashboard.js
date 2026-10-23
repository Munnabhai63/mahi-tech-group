/**
 * MAHI TECH GROUP — CENTER DASHBOARD FRONTEND ENGINE
 * Real-Time WebSocket state synchronization, Kanban Pipeline, and Live Voting Feeds.
 */

// Application State
const state = {
  token: null,
  user: null,
  ws: null,
  wsConnected: false,
  reconnectAttempts: 0,
  pollingInterval: null,
  activeProjects: [],
  pendingIdeas: [],
  notifications: []
};

// Test credentials for role switching during evaluation
const ROLE_ACCOUNTS = {
  admin: { email: 'admin@mahitechgroup.com', password: 'AdminPassword@2026', role: 'admin' },
  researcher: { email: 'researcher@mahitechgroup.com', password: 'ResearcherPass123!', role: 'researcher' },
  developer: { email: 'developer@mahitechgroup.com', password: 'DeveloperPass123!', role: 'developer' },
  producer: { email: 'producer@mahitechgroup.com', password: 'ProducerPass123!', role: 'producer' }
};

document.addEventListener('DOMContentLoaded', async () => {
  setupEventListeners();
  // Initialize with Admin account by default
  await switchAccount('admin');
});

/**
 * Switch active test session & reconnect WebSocket
 */
async function switchAccount(roleKey) {
  const credentials = ROLE_ACCOUNTS[roleKey];
  if (!credentials) return;

  try {
    updateWsStatus('reconnecting', 'Authenticating...');
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: credentials.email, password: credentials.password })
    });

    if (!res.ok) {
      console.warn(`Could not login with default ${roleKey} account, checking existing token...`);
      return;
    }

    const data = await res.json();
    state.token = data.token;
    state.user = data.user;
    localStorage.setItem('token', state.token);

    updateUserBadge(data.user);

    // Initial Full Refresh
    await refreshAllData();

    // Connect WebSocket
    connectWebSocket();
  } catch (err) {
    console.error('Login error during switchAccount:', err);
    updateWsStatus('disconnected', 'Login Failed');
  }
}

/**
 * Connect to WebSocket Server with JWT Token
 */
function connectWebSocket() {
  if (state.ws) {
    try {
      state.ws.close();
    } catch (e) {}
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws?token=${state.token}`;

  updateWsStatus('reconnecting', 'Connecting...');
  state.ws = new WebSocket(wsUrl);

  state.ws.onopen = () => {
    state.wsConnected = true;
    state.reconnectAttempts = 0;
    updateWsStatus('live', 'Live Connected');

    // Clear fallback polling if active
    if (state.pollingInterval) {
      clearInterval(state.pollingInterval);
      state.pollingInterval = null;
    }
  };

  state.ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      handleWebSocketMessage(msg);
    } catch (err) {
      console.error('Error parsing WS message:', err);
    }
  };

  state.ws.onclose = () => {
    state.wsConnected = false;
    updateWsStatus('reconnecting', 'Reconnecting...');
    startPollingFallback();
    scheduleReconnect();
  };

  state.ws.onerror = (err) => {
    state.wsConnected = false;
    updateWsStatus('disconnected', 'WS Error (Polling active)');
  };
}

/**
 * Exponential backoff reconnect
 */
function scheduleReconnect() {
  const delay = Math.min(1000 * Math.pow(1.5, state.reconnectAttempts), 15000);
  state.reconnectAttempts++;
  setTimeout(() => {
    if (!state.wsConnected && state.token) {
      connectWebSocket();
    }
  }, delay);
}

/**
 * Fallback Polling (Every 10 seconds if WS drops per PRD Section 4.3)
 */
function startPollingFallback() {
  if (state.pollingInterval) return;
  state.pollingInterval = setInterval(async () => {
    console.log('[Polling Fallback] Refreshing data via HTTP...');
    await refreshAllData();
  }, 10000);
}

/**
 * Dispatcher for incoming WebSocket events (PRD Section 4.2)
 */
function handleWebSocketMessage(msg) {
  const { channel, event, data, timestamp } = msg;

  switch (event) {
    case 'connected':
      console.log('WS Handshake:', data.message);
      if (data.onlineCount) {
        document.getElementById('statTeamOnline').textContent = data.onlineCount;
      }
      break;

    case 'presence.update':
      if (data.onlineCount !== undefined) {
        document.getElementById('statTeamOnline').textContent = data.onlineCount;
      }
      if (data.joinedUser) {
        addTickerItem(`${data.joinedUser.name} (${data.joinedUser.role}) joined the workspace`);
      }
      break;

    case 'vote.cast':
      // Live update without refresh (PRD Section 3.2 Non-Negotiable)
      handleLiveVoteUpdate(data);
      addTickerItem(`New vote cast on idea #${data.ideaId.substring(0, 8)} (${data.greenPercentage}% Green)`);
      break;

    case 'idea.submitted':
      fetchSummary();
      fetchVotesFeed();
      addTickerItem(`New Idea Submitted: "${data.title}" by ${data.owner_name}`);
      break;

    case 'idea.approved':
      fetchSummary();
      fetchVotesFeed();
      fetchKanban();
      addTickerItem(`🎉 Idea Approved: "${data.title}" (${data.greenPercentage}% Green) — Parallel fanout initiated`);
      break;

    case 'task.unblocked':
      fetchKanban();
      fetchSummary();
      addTickerItem(`Task "${data.taskName}" unblocked for active work`);
      break;

    case 'project.stage_changed':
      fetchKanban();
      fetchSummary();
      addTickerItem(`Project transitioned to stage: ${data.newStage}`);
      break;

    case 'notification.new':
      handleNewNotification(data);
      break;

    case 'revenue.credited':
      fetchSummary();
      addTickerItem(`💰 Revenue Credited: ₹${data.amount} on "${data.projectTitle}"`);
      break;

    case 'activity.new':
      addTickerItem(data.message);
      break;

    default:
      console.log('Unhandled WS Event:', event, data);
  }
}

/**
 * Live Vote Progress Bar Update without page reload
 */
function handleLiveVoteUpdate(data) {
  const { ideaId, greenPercentage, totalVotesCast, greenVotes } = data;

  const barFill = document.getElementById(`vote-fill-${ideaId}`);
  const percentText = document.getElementById(`vote-pct-${ideaId}`);
  const votesCountText = document.getElementById(`vote-count-${ideaId}`);

  if (barFill && percentText) {
    barFill.style.width = `${greenPercentage}%`;
    percentText.textContent = `${greenPercentage}% Green`;
    if (votesCountText) {
      votesCountText.textContent = `${totalVotesCast} votes cast (${greenVotes} green)`;
    }

    // Flash green glow on live update
    barFill.parentElement.style.boxShadow = '0 0 12px rgba(16, 185, 129, 0.6)';
    setTimeout(() => {
      barFill.parentElement.style.boxShadow = 'none';
    }, 1200);
  } else {
    // Idea card not in DOM, refresh feed
    fetchVotesFeed();
  }

  fetchSummary();
}

/**
 * Append incoming notification and update badge
 */
function handleNewNotification(notif) {
  state.notifications.unshift(notif);
  renderNotificationsList();

  const badge = document.getElementById('notifBadge');
  const sideCount = document.getElementById('sideNotifCount');
  const currentCount = parseInt(badge.textContent || '0', 10) + 1;

  badge.textContent = currentCount;
  badge.style.display = 'inline-block';
  if (sideCount) sideCount.textContent = `${currentCount} Unread`;

  // Visual pulse on bell
  const bell = document.getElementById('notifBellBtn');
  bell.classList.add('pulse-alert');
  setTimeout(() => bell.classList.remove('pulse-alert'), 1000);
}

/**
 * Refresh All Dashboard Data Components
 */
async function refreshAllData() {
  await Promise.all([
    fetchSummary(),
    fetchKanban(),
    fetchVotesFeed(),
    fetchNotifications(),
    fetchActivity()
  ]);
}

/**
 * 1. Fetch Quick Stats Bar Data
 */
async function fetchSummary() {
  try {
    const res = await apiFetch('/api/dashboard/summary');
    if (!res) return;

    document.getElementById('statActiveProjects').textContent = res.activeProjectsCount;
    document.getElementById('statPendingVotes').textContent = res.pendingVotesCount;
    document.getElementById('statQuotaRemaining').textContent = `${res.myQuotaRemaining} / ${res.myQuotaWeeklyLimit}`;
    document.getElementById('statTeamOnline').textContent = res.teamOnlineCount;
    document.getElementById('statWalletBalance').textContent = `₹${res.walletBalance.toFixed(2)}`;

    const walletSubtext = document.getElementById('statWalletSubtext');
    if (res.isWalletFrozen) {
      walletSubtext.textContent = '⚠️ Wallet Frozen (Offboarded/Settlement)';
      walletSubtext.style.color = 'var(--rose)';
    } else {
      walletSubtext.textContent = 'Available for withdrawal';
      walletSubtext.style.color = 'var(--text-muted)';
    }
  } catch (err) {
    console.error('Failed to fetch dashboard summary:', err);
  }
}

/**
 * 2. Fetch Active Projects Kanban Board
 */
async function fetchKanban() {
  try {
    const res = await apiFetch('/api/dashboard/kanban');
    if (!res) return;

    const stages = ['RESEARCH_DEV_PARALLEL', 'INTEGRATION', 'TESTING', 'ADMIN_REVIEW', 'LIVE'];

    stages.forEach(stageKey => {
      const col = res.columns[stageKey];
      const countEl = document.getElementById(`count-${stageKey}`);
      const bodyEl = document.getElementById(`col-${stageKey}`);

      if (countEl && col) countEl.textContent = col.items.length;
      if (bodyEl && col) {
        bodyEl.innerHTML = '';
        if (col.items.length === 0) {
          bodyEl.innerHTML = '<div class="empty-state">No projects in this stage</div>';
          return;
        }

        col.items.forEach(proj => {
          bodyEl.appendChild(createProjectCard(proj));
        });
      }
    });
  } catch (err) {
    console.error('Failed to fetch Kanban board:', err);
  }
}

/**
 * Create a Kanban Project Card DOM Element
 */
function createProjectCard(proj) {
  const card = document.createElement('div');
  card.className = 'project-card';
  card.dataset.id = proj.id;

  const stageClassMap = {
    RESEARCH_DEV_PARALLEL: 'badge-parallel',
    INTEGRATION: 'badge-integration',
    TESTING: 'badge-testing',
    ADMIN_REVIEW: 'badge-review',
    LIVE: 'badge-live'
  };

  const stageLabels = {
    RESEARCH_DEV_PARALLEL: 'Parallel Research/Dev',
    INTEGRATION: 'Integration',
    TESTING: 'QA Testing',
    ADMIN_REVIEW: 'Admin Review',
    LIVE: 'Live & Monetizing'
  };

  const stageBadgeClass = stageClassMap[proj.current_stage] || 'badge-parallel';
  const stageLabel = stageLabels[proj.current_stage] || proj.current_stage;

  // Member avatars preview
  const memberAvatarsHtml = (proj.members || [])
    .slice(0, 4)
    .map(m => `<div class="member-avatar-mini" title="${escapeHtml(m.name)} (${m.role_in_project})">${m.name ? m.name.charAt(0) : 'U'}</div>`)
    .join('');

  const extraCount = (proj.members || []).length > 4 ? `<div class="member-avatar-mini">+${proj.members.length - 4}</div>` : '';

  card.innerHTML = `
    <div class="card-title-row">
      <h4 class="project-card-title">${escapeHtml(proj.title)}</h4>
      <span class="stage-badge ${stageBadgeClass}">${stageLabel}</span>
    </div>

    <div class="progress-container">
      <div class="progress-label-row">
        <span>Progress</span>
        <span>${proj.taskSummary.completedTasks} / ${proj.taskSummary.totalTasks} Tasks (${proj.taskSummary.percentComplete}%)</span>
      </div>
      <div class="progress-track">
        <div class="progress-fill" style="width: ${proj.taskSummary.percentComplete}%"></div>
      </div>
    </div>

    <div class="card-footer">
      <div class="owner-chip" title="Idea Owner">
        <span>👤 ${escapeHtml(proj.owner_name)}</span>
      </div>
      <div class="member-avatars-row">
        ${memberAvatarsHtml}
        ${extraCount}
      </div>
    </div>
  `;

  card.addEventListener('click', () => openProjectModal(proj.id));
  return card;
}

/**
 * 3. Fetch Pending Votes Feed (PRD Section 3.2)
 */
async function fetchVotesFeed() {
  try {
    const res = await apiFetch('/api/dashboard/votes-feed');
    if (!res) return;

    const listEl = document.getElementById('votesFeedList');
    const badgeEl = document.getElementById('votesBadge');

    badgeEl.textContent = `${res.count} Awaiting`;
    listEl.innerHTML = '';

    if (!res.ideas || res.ideas.length === 0) {
      listEl.innerHTML = '<div class="empty-state">No ideas currently awaiting votes</div>';
      return;
    }

    res.ideas.forEach(idea => {
      const item = document.createElement('div');
      item.className = 'vote-item-card';
      item.id = `vote-card-${idea.id}`;

      let actionHtml = '';
      if (idea.isOwner) {
        actionHtml = `<span class="badge" title="Owner cannot vote per PRD Step 3">🔒 Idea Owner</span>`;
      } else if (idea.hasVoted) {
        actionHtml = `<span class="badge ${idea.userVoteColor === 'green' ? 'badge-pulse' : ''}">Voted ${idea.userVoteColor.toUpperCase()}</span>`;
      } else {
        actionHtml = `
          <button class="btn btn-green btn-sm" onclick="openVoteModal('${idea.id}', '${escapeHtml(idea.title)}', '${escapeHtml(idea.description)}')">
            Vote Now
          </button>
        `;
      }

      item.innerHTML = `
        <div class="vote-item-header">
          <div>
            <div class="vote-item-title">${escapeHtml(idea.title)}</div>
            <div class="vote-owner-tag">By ${escapeHtml(idea.owner_name)}</div>
          </div>
          <div>${actionHtml}</div>
        </div>

        <div class="vote-bar-wrap">
          <div class="vote-bar-labels">
            <span class="vote-percentage-text" id="vote-pct-${idea.id}">${idea.greenPercentage}% Green</span>
            <span class="text-muted" id="vote-count-${idea.id}">${idea.totalVotes} votes cast</span>
          </div>
          <div class="vote-bar-track">
            <div class="vote-bar-fill" id="vote-fill-${idea.id}" style="width: ${idea.greenPercentage}%"></div>
          </div>
        </div>
      `;

      listEl.appendChild(item);
    });
  } catch (err) {
    console.error('Failed to fetch votes feed:', err);
  }
}

/**
 * 4. Fetch User Notifications (PRD Section 3.3)
 */
async function fetchNotifications() {
  try {
    const res = await apiFetch('/api/notifications/my?limit=25');
    if (!res) return;

    state.notifications = res.notifications || [];
    const unreadCount = res.unreadCount || 0;

    const notifBadge = document.getElementById('notifBadge');
    const sideCount = document.getElementById('sideNotifCount');

    if (unreadCount > 0) {
      notifBadge.textContent = unreadCount;
      notifBadge.style.display = 'inline-block';
      if (sideCount) sideCount.textContent = `${unreadCount} Unread`;
    } else {
      notifBadge.style.display = 'none';
      if (sideCount) sideCount.textContent = '0 Unread';
    }

    renderNotificationsList();
  } catch (err) {
    console.error('Failed to fetch notifications:', err);
  }
}

/**
 * Render Notifications in Dropdown & Side Feed
 */
function renderNotificationsList() {
  const dropdownList = document.getElementById('notifList');
  const sideList = document.getElementById('sideNotifList');

  const contentHtml = state.notifications.length === 0
    ? '<div class="empty-state">No notifications recorded</div>'
    : state.notifications.map(n => `
        <div class="notif-item ${n.read_status === 0 ? 'unread' : ''}" onclick="markAsRead('${n.id}')">
          ${n.read_status === 0 ? '<span class="notif-dot"></span>' : ''}
          <div class="notif-body">
            <div class="notif-msg">${escapeHtml(n.message)}</div>
            <div class="notif-time">${formatDate(n.created_at)}</div>
          </div>
        </div>
      `).join('');

  if (dropdownList) dropdownList.innerHTML = contentHtml;
  if (sideList) sideList.innerHTML = contentHtml;
}

/**
 * Mark notification as read
 */
async function markAsRead(notifId) {
  try {
    await apiFetch(`/api/notifications/${notifId}/read`, { method: 'PATCH' });
    const target = state.notifications.find(n => n.id === notifId);
    if (target) target.read_status = 1;
    renderNotificationsList();
    fetchSummary();
  } catch (err) {
    console.error('Failed to mark notification as read:', err);
  }
}

/**
 * 5. Fetch Recent Team Activity Ticker
 */
async function fetchActivity() {
  try {
    const res = await apiFetch('/api/activity/recent?limit=15');
    if (!res || !res.activities || res.activities.length === 0) return;

    const tickerContent = document.getElementById('tickerContent');
    const items = res.activities.map(a => `<span class="ticker-item">${escapeHtml(a.message)}</span>`);
    tickerContent.innerHTML = items.join(' &nbsp; • &nbsp; ');
  } catch (err) {
    console.error('Failed to fetch activity ticker:', err);
  }
}

/**
 * Add a single item to the live ticker banner
 */
function addTickerItem(message) {
  const tickerContent = document.getElementById('tickerContent');
  if (!tickerContent) return;
  const newItem = `<span class="ticker-item" style="color: #60a5fa; font-weight: 600;">⚡ ${escapeHtml(message)}</span>`;
  tickerContent.innerHTML = `${newItem} &nbsp; • &nbsp; ${tickerContent.innerHTML}`;
}

/**
 * Project Detail Modal
 */
async function openProjectModal(projectId) {
  try {
    const res = await apiFetch(`/api/projects/${projectId}`);
    if (!res || !res.project) return;

    const p = res.project;
    document.getElementById('modalProjectTitle').textContent = p.title;
    document.getElementById('modalProjectStage').textContent = p.current_stage;
    document.getElementById('modalOwnerName').textContent = p.owner_name;
    document.getElementById('modalProjectStatus').textContent = p.status;
    document.getElementById('modalClockStart').textContent = p.revenue_clock_start || 'N/A';

    // Tasks Table
    const tasksBody = document.getElementById('modalTasksTableBody');
    tasksBody.innerHTML = (res.tasks || []).map(t => `
      <tr>
        <td><strong>${escapeHtml(t.task_name)}</strong></td>
        <td>${t.task_type}</td>
        <td>${t.assigned_to_name ? escapeHtml(t.assigned_to_name) : '<em>Unassigned</em>'}</td>
        <td>${t.depends_on_task_name ? escapeHtml(t.depends_on_task_name) : '<em>None (Initial Parallel)</em>'}</td>
        <td><span class="badge ${t.status === 'DONE' ? 'badge-pulse' : ''}">${t.status}</span></td>
      </tr>
    `).join('');

    // Members Table
    const membersBody = document.getElementById('modalMembersTableBody');
    membersBody.innerHTML = (res.members || []).map(m => `
      <tr>
        <td>${escapeHtml(m.name)}</td>
        <td>${m.role_in_project}</td>
        <td><strong>${m.contribution_weight}%</strong></td>
      </tr>
    `).join('');

    const completed = (res.tasks || []).filter(t => t.status === 'DONE').length;
    const total = (res.tasks || []).length;
    const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
    document.getElementById('modalProgressText').textContent = `${completed} / ${total} tasks (${pct}%)`;

    document.getElementById('projectModalBackdrop').style.display = 'flex';
  } catch (err) {
    console.error('Failed to open project detail modal:', err);
  }
}

/**
 * Open Vote Modal
 */
window.openVoteModal = function(ideaId, title, desc) {
  document.getElementById('voteIdeaId').value = ideaId;
  document.getElementById('voteModalIdeaTitle').textContent = `Vote on: ${title}`;
  document.getElementById('voteModalIdeaDesc').textContent = desc || 'Evaluate this idea for feasibility, market potential, and team capacity.';
  document.getElementById('voteModalBackdrop').style.display = 'flex';
};

/**
 * Submit Vote
 */
async function submitVote(voteColor) {
  const ideaId = document.getElementById('voteIdeaId').value;
  const feasibility = parseInt(document.getElementById('voteFeasibility').value, 10);
  const market = parseInt(document.getElementById('voteMarket').value, 10);
  const capacity = parseInt(document.getElementById('voteCapacity').value, 10);
  const comment = document.getElementById('voteComment').value;

  try {
    const res = await apiFetch(`/api/ideas/${ideaId}/vote`, {
      method: 'POST',
      body: JSON.stringify({
        vote_color: voteColor,
        score_feasibility: feasibility,
        score_market: market,
        score_capacity: capacity,
        comment
      })
    });

    if (res && res.success) {
      document.getElementById('voteModalBackdrop').style.display = 'none';
      await fetchVotesFeed();
      await fetchSummary();
    } else if (res && res.error) {
      alert(`Vote rejected: ${res.error}`);
    }
  } catch (err) {
    console.error('Error casting vote:', err);
  }
}

/**
 * Helper: API fetch wrapper with Auth Bearer token
 */
async function apiFetch(endpoint, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };

  if (state.token) {
    headers['Authorization'] = `Bearer ${state.token}`;
  }

  const res = await fetch(endpoint, { ...options, headers });
  if (res.status === 401) {
    console.warn('Session expired or unauthorized.');
    return null;
  }
  return res.json();
}

/**
 * Event Listeners & UI Hooks
 */
function setupEventListeners() {
  // Role Selector
  const roleSelect = document.getElementById('roleSelect');
  roleSelect.addEventListener('change', (e) => switchAccount(e.target.value));

  // Refresh Board Button
  document.getElementById('refreshKanbanBtn').addEventListener('click', () => refreshAllData());

  // Notifications Bell
  const bellBtn = document.getElementById('notifBellBtn');
  const dropdown = document.getElementById('notifDropdown');
  bellBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    dropdown.classList.toggle('active');
  });

  document.addEventListener('click', () => dropdown.classList.remove('active'));

  // Mark all read
  document.getElementById('markAllReadBtn').addEventListener('click', async () => {
    await apiFetch('/api/notifications/mark-all-read', { method: 'POST' });
    await fetchNotifications();
  });

  // Modal Closers
  document.getElementById('closeProjectModalBtn').addEventListener('click', () => {
    document.getElementById('projectModalBackdrop').style.display = 'none';
  });

  document.getElementById('closeVoteModalBtn').addEventListener('click', () => {
    document.getElementById('voteModalBackdrop').style.display = 'none';
  });

  // Vote Actions
  document.getElementById('btnVoteGreen').addEventListener('click', () => submitVote('green'));
  document.getElementById('btnVoteRed').addEventListener('click', () => submitVote('red'));
}

function updateWsStatus(status, text) {
  const indicator = document.getElementById('wsIndicator');
  const statusText = document.getElementById('wsStatusText');
  indicator.className = `status-indicator ${status}`;
  statusText.textContent = text;
}

function updateUserBadge(user) {
  document.getElementById('userNameDisplay').textContent = user.name;
  document.getElementById('userRoleDisplay').textContent = user.role.toUpperCase();
  document.getElementById('userAvatar').textContent = user.name.charAt(0);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' ' + d.toLocaleDateString();
}
