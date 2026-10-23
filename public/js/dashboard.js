/**
 * MAHI TECH GROUP — 4 CORNER PANELS & CENTER DASHBOARD ENGINE
 * Step 08: Researcher (TL), Developer (TR), Admin (BL), Producer (BR)
 * Flanking the Shared Real-Time Consensus & Revenue Center Dashboard.
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
  notifications: [],
  devSubroleFilter: 'all',
  activeResearcherTab: 'res-tasks',
  viewMode: 'spatial' // 'spatial' | 'focus'
};

// Seed credentials for authenticating real users per Step 01 RBAC
const ROLE_ACCOUNTS = {
  admin: { email: 'admin@mahitechgroup.com', password: 'AdminPassword@2026', role: 'admin' },
  researcher: { email: 'researcher@mahitechgroup.com', password: 'ResearcherPass123!', role: 'researcher' },
  developer: { email: 'developer@mahitechgroup.com', password: 'DeveloperPass123!', role: 'developer' },
  producer: { email: 'producer@mahitechgroup.com', password: 'ProducerPass123!', role: 'producer' }
};

document.addEventListener('DOMContentLoaded', async () => {
  setupEventListeners();
  // Start with Admin session by default
  await switchAccount('admin');
});

/**
 * Switch active session & reconnect WebSocket
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
      console.warn(`Could not login with default ${roleKey} account.`);
      return;
    }

    const data = await res.json();
    state.token = data.token;
    state.user = data.user;
    localStorage.setItem('token', state.token);

    updateUserBadge(data.user);
    highlightActiveCornerPanel(data.user.role);

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
 * Highlight and focus the corner panel corresponding to the user's role
 */
function highlightActiveCornerPanel(role) {
  document.querySelectorAll('.corner-panel').forEach(panel => {
    panel.classList.remove('panel-active');
  });

  const targetPanelId = `${role}CornerPanel`;
  const targetPanel = document.getElementById(targetPanelId);
  if (targetPanel) {
    targetPanel.classList.add('panel-active');
  }
}

/**
 * Connect to WebSocket Server with JWT Token
 */
function connectWebSocket() {
  if (state.ws) {
    try { state.ws.close(); } catch (e) {}
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws?token=${state.token}`;

  updateWsStatus('reconnecting', 'Connecting...');
  state.ws = new WebSocket(wsUrl);

  state.ws.onopen = () => {
    state.wsConnected = true;
    state.reconnectAttempts = 0;
    updateWsStatus('live', 'Live Connected');

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

  state.ws.onerror = () => {
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
 * Fallback Polling (Every 10 seconds if WS drops)
 */
function startPollingFallback() {
  if (state.pollingInterval) return;
  state.pollingInterval = setInterval(async () => {
    console.log('[Polling Fallback] Refreshing data via HTTP...');
    await refreshAllData();
  }, 10000);
}

/**
 * Dispatcher for incoming WebSocket events
 */
function handleWebSocketMessage(msg) {
  const { channel, event, data } = msg;

  switch (event) {
    case 'connected':
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
      handleLiveVoteUpdate(data);
      addTickerItem(`New vote cast on idea #${data.ideaId.substring(0, 8)} (${data.greenPercentage}% Green)`);
      break;

    case 'idea.submitted':
      fetchSummary();
      fetchVotesFeed();
      fetchResearcherIdeas();
      addTickerItem(`New Idea Submitted: "${data.title}" by ${data.owner_name}`);
      break;

    case 'idea.approved':
      fetchSummary();
      fetchVotesFeed();
      fetchKanban();
      fetchDeveloperTasks();
      fetchResearcherIdeas();
      addTickerItem(`🎉 Idea Approved: "${data.title}" (${data.greenPercentage}% Green) — Parallel fanout initiated`);
      break;

    case 'task.unblocked':
    case 'task.updated':
      fetchKanban();
      fetchSummary();
      fetchRoleBanners();
      refreshCornerTasks();
      addTickerItem(`Task "${data.task?.task_name || data.taskName || 'Update'}" updated`);
      break;

    case 'project.stage_changed':
      fetchKanban();
      fetchSummary();
      fetchRoleBanners();
      fetchAdminApprovals();
      addTickerItem(`Project transitioned to stage: ${data.newStage}`);
      break;

    case 'notification.new':
      handleNewNotification(data);
      break;

    case 'revenue.credited':
      fetchSummary();
      fetchAdminStats();
      addTickerItem(`💰 Revenue Credited: ₹${data.amount} on "${data.projectTitle}"`);
      break;

    case 'activity.new':
      addTickerItem(data.message);
      break;

    default:
      console.log('WS Event:', event, data);
  }
}

/**
 * Live Vote Progress Bar Update
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

    barFill.parentElement.style.boxShadow = '0 0 12px rgba(16, 185, 129, 0.6)';
    setTimeout(() => {
      barFill.parentElement.style.boxShadow = 'none';
    }, 1200);
  } else {
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
}

/**
 * Ticker Bar Update
 */
function addTickerItem(text) {
  const container = document.getElementById('tickerContent');
  if (!container) return;

  const span = document.createElement('span');
  span.className = 'ticker-item';
  span.textContent = `• ${text}`;
  container.prepend(span);

  while (container.children.length > 5) {
    container.removeChild(container.lastChild);
  }
}

/**
 * Comprehensive Data Refresh
 */
async function refreshAllData() {
  await Promise.allSettled([
    fetchSummary(),
    fetchKanban(),
    fetchVotesFeed(),
    fetchNotifications(),
    fetchMiniProfiles(),
    fetchRoleBanners(),
    refreshCornerTasks(),
    fetchAdminApprovals(),
    fetchAdminStats()
  ]);
}

/**
 * Refresh task queues across corner panels
 */
async function refreshCornerTasks() {
  await Promise.allSettled([
    fetchResearcherTasks(),
    fetchResearcherIdeas(),
    fetchDeveloperTasks(),
    fetchProducerTasks()
  ]);
}

/**
 * 1. Fetch Summary Stats (Center Dashboard)
 */
async function fetchSummary() {
  try {
    const data = await apiFetch('/api/dashboard/summary');
    if (!data) return;

    document.getElementById('statActiveProjects').textContent = data.activeProjectsCount || 0;
    document.getElementById('statPendingVotes').textContent = data.pendingVotesCount || 0;

    const quota = data.quotaStatus;
    if (quota) {
      document.getElementById('statQuotaRemaining').textContent = `${quota.remaining} / ${quota.weeklyLimit}`;
      const badge = document.getElementById('researcherQuotaBadge');
      if (badge) badge.textContent = `${quota.remaining}/${quota.weeklyLimit}`;
    }

    if (data.walletSummary) {
      const balance = Number(data.walletSummary.balance || 0).toFixed(2);
      document.getElementById('statWalletBalance').textContent = `₹${balance}`;
    }
  } catch (err) {
    console.error('Failed to fetch dashboard summary:', err);
  }
}

/**
 * 2. Fetch Active Projects Pipeline (Kanban Board)
 */
async function fetchKanban() {
  try {
    const data = await apiFetch('/api/dashboard/kanban');
    if (!data) return;

    const columns = data.columns || data.stages || {};
    state.activeProjects = columns;

    const stages = ['RESEARCH_DEV_PARALLEL', 'INTEGRATION', 'TESTING', 'ADMIN_REVIEW', 'LIVE'];

    stages.forEach(stageKey => {
      const colEl = document.getElementById(`col-${stageKey}`);
      const countEl = document.getElementById(`count-${stageKey}`);
      if (!colEl) return;

      colEl.innerHTML = '';
      const colObj = columns[stageKey];
      const projects = Array.isArray(colObj) ? colObj : (colObj?.items || []);
      if (countEl) countEl.textContent = projects.length;

      if (projects.length === 0) {
        colEl.innerHTML = '<div class="empty-column-state">No active projects</div>';
        return;
      }

      projects.forEach(project => {
        const card = document.createElement('div');
        card.className = 'project-card';
        card.id = `project-card-${project.id}`;

        const completed = project.completed_tasks_count || 0;
        const total = project.total_tasks_count || 8;
        const progressPct = total > 0 ? Math.round((completed / total) * 100) : 0;

        card.innerHTML = `
          <div class="project-header">
            <span class="project-title">${escapeHtml(project.title)}</span>
            <span class="badge ${project.status === 'ACTIVE' ? 'badge-green' : 'badge-amber'}">${escapeHtml(project.status)}</span>
          </div>
          <div class="project-desc">${escapeHtml(project.description || 'No description provided')}</div>
          
          <div class="task-progress-wrap">
            <div class="task-progress-label">
              <span>Task Progress</span>
              <span class="progress-pct">${completed}/${total} (${progressPct}%)</span>
            </div>
            <div class="progress-track">
              <div class="progress-bar-fill" style="width: ${progressPct}%"></div>
            </div>
          </div>

          <div class="project-footer">
            <div class="project-meta">
              <span>👤 ${escapeHtml(project.owner_name || 'Owner')}</span>
            </div>
            <button class="btn btn-secondary btn-xs" onclick="openProjectDetail('${project.id}')">View Workflows</button>
          </div>
        `;

        colEl.appendChild(card);
      });
    });
  } catch (err) {
    console.error('Failed to fetch kanban data:', err);
  }
}

/**
 * 3. Fetch Pending Votes Feed (Center Dashboard)
 */
async function fetchVotesFeed() {
  try {
    const data = await apiFetch('/api/dashboard/votes-feed');
    if (!data || !data.ideas) return;

    state.pendingIdeas = data.ideas;
    const listEl = document.getElementById('votesFeedList');
    const badgeEl = document.getElementById('votesBadge');

    if (!listEl) return;
    badgeEl.textContent = `${data.totalPending || data.ideas.length} Awaiting`;

    if (data.ideas.length === 0) {
      listEl.innerHTML = '<div class="empty-state">No ideas currently awaiting team votes</div>';
      return;
    }

    listEl.innerHTML = '';
    data.ideas.forEach(idea => {
      const card = document.createElement('div');
      card.className = 'vote-card';
      card.id = `vote-card-${idea.id}`;

      const greenPct = idea.greenPercentage || 0;
      const canVote = idea.canVote !== false && state.user && state.user.id !== idea.owner_id;

      card.innerHTML = `
        <div class="vote-card-header">
          <div>
            <span class="vote-card-title">${escapeHtml(idea.title)}</span>
            <div class="vote-card-owner">By ${escapeHtml(idea.owner_name)} • Closes ${formatDate(idea.voting_deadline)}</div>
          </div>
          <span class="badge badge-purple">${escapeHtml(idea.category || 'General')}</span>
        </div>

        <div class="vote-progress-wrap">
          <div class="vote-progress-labels">
            <span class="label-green">Approval Threshold: 70% Supermajority</span>
            <span class="vote-pct-text" id="vote-pct-${idea.id}">${greenPct}% Green</span>
          </div>
          <div class="progress-track-lg">
            <div class="progress-bar-fill-green" id="vote-fill-${idea.id}" style="width: ${greenPct}%"></div>
          </div>
          <div class="vote-tally-line" id="vote-count-${idea.id}">
            ${idea.totalVotesCast || 0} votes cast (${idea.greenVotes || 0} green)
          </div>
        </div>

        <div class="vote-card-actions">
          ${canVote ? `
            <button class="btn btn-primary btn-sm w-100" onclick="openVoteModal('${idea.id}', '${escapeHtml(idea.title)}', '${escapeHtml(idea.description)}')">
              🗳️ Cast Vote
            </button>
          ` : `
            <span class="text-muted text-xs">${idea.owner_id === state.user?.id ? 'Own Idea (Cannot Vote)' : 'Voted'}</span>
          `}
        </div>
      `;

      listEl.appendChild(card);
    });
  } catch (err) {
    console.error('Failed to fetch votes feed:', err);
  }
}

/**
 * 4. Fetch Profile Summary Mini-Cards (Section 7)
 */
async function fetchMiniProfiles() {
  try {
    const data = await apiFetch('/api/users/profile-mini');
    if (!data) return;

    // Populate Researcher Mini-Card
    const rAvatar = document.getElementById('researcherMiniAvatar');
    if (rAvatar) {
      if (data.role === 'researcher') {
        rAvatar.textContent = data.avatar;
        document.getElementById('researcherMiniName').textContent = data.name;
        document.getElementById('researcherIdeasCount').textContent = data.totalIdeasSubmitted;
        document.getElementById('researcherRatingAvg').textContent = `${data.ratingAverage} ★`;
        document.getElementById('researcherQuotaRemaining').textContent = `${data.quotaRemaining}/${data.quotaWeeklyLimit}`;
      }
    }

    // Populate Developer Mini-Card
    const dAvatar = document.getElementById('developerMiniAvatar');
    if (dAvatar) {
      if (data.role === 'developer') {
        dAvatar.textContent = data.avatar;
        document.getElementById('developerMiniName').textContent = data.name;
        document.getElementById('developerProjectsBuilt').textContent = data.totalProjectsBuilt;
        document.getElementById('developerRatingAvg').textContent = `${data.ratingAverage} ★`;
        document.getElementById('developerWallet').textContent = `₹${data.walletBalance}`;
        const subBadge = document.getElementById('developerSubRoleBadge');
        if (subBadge) subBadge.textContent = data.subRole ? data.subRole.toUpperCase() : 'DEVELOPER';
      }
    }

    // Populate Producer Mini-Card
    const pAvatar = document.getElementById('producerMiniAvatar');
    if (pAvatar) {
      if (data.role === 'producer') {
        pAvatar.textContent = data.avatar;
        document.getElementById('producerMiniName').textContent = data.name;
        document.getElementById('producerTasksTested').textContent = data.totalTasksCompleted;
        document.getElementById('producerRatingAvg').textContent = `${data.ratingAverage} ★`;
        document.getElementById('producerWallet').textContent = `₹${data.walletBalance}`;
      }
    }

    // Populate Admin Mini-Card
    const aAvatar = document.getElementById('adminMiniAvatar');
    if (aAvatar) {
      if (data.role === 'admin') {
        aAvatar.textContent = data.avatar;
        document.getElementById('adminMiniName').textContent = data.name;
      }
    }
  } catch (err) {
    console.error('Failed to fetch mini profile:', err);
  }
}

/**
 * 5. Fetch Role-Specific Alert Banners (Section 8)
 */
async function fetchRoleBanners() {
  try {
    const res = await apiFetch('/api/banners/active');
    if (!res || !res.banners) return;

    const banners = res.banners;

    // Researcher Banners
    const rBox = document.getElementById('researcherBannersList');
    if (rBox) {
      rBox.innerHTML = '';
      banners.filter(b => b.type === 'IDEA_APPROVED').forEach(b => {
        rBox.appendChild(createBannerEl(b, 'idea-approved'));
      });
    }

    // Developer Banners ("Research Ready")
    const dBox = document.getElementById('developerBannersList');
    if (dBox) {
      dBox.innerHTML = '';
      banners.filter(b => b.type === 'RESEARCH_READY').forEach(b => {
        dBox.appendChild(createBannerEl(b, 'research-ready'));
      });
    }

    // Producer Banners ("Dev Build Ready")
    const pBox = document.getElementById('producerBannersList');
    if (pBox) {
      pBox.innerHTML = '';
      banners.filter(b => b.type === 'BUILD_READY').forEach(b => {
        pBox.appendChild(createBannerEl(b, 'build-ready'));
      });
    }

    // Admin Banners ("Final Review Pending", "Withdrawals Pending")
    const aBox = document.getElementById('adminBannersList');
    if (aBox) {
      aBox.innerHTML = '';
      banners.filter(b => b.type === 'ADMIN_REVIEW_PENDING' || b.type === 'WITHDRAWALS_PENDING').forEach(b => {
        aBox.appendChild(createBannerEl(b, 'review-ready'));
      });
    }
  } catch (err) {
    console.error('Failed to fetch role banners:', err);
  }
}

function createBannerEl(b, typeClass) {
  const el = document.createElement('div');
  el.className = `corner-alert-banner ${typeClass}`;
  el.innerHTML = `
    <div class="banner-content">
      <span class="banner-title">${escapeHtml(b.title)}</span>
      <span class="banner-msg">${escapeHtml(b.message)}</span>
    </div>
  `;
  return el;
}

/**
 * 6. Researcher Panel Data & Flows
 */
async function fetchResearcherTasks() {
  const listEl = document.getElementById('researcherTasksList');
  if (!listEl) return;

  try {
    const res = await apiFetch('/api/projects/my-tasks?role=researcher');
    if (!res || !res.tasks) {
      listEl.innerHTML = '<div class="empty-state">No research tasks assigned</div>';
      return;
    }

    if (res.tasks.length === 0) {
      listEl.innerHTML = '<div class="empty-state">No research tasks currently active</div>';
      return;
    }

    listEl.innerHTML = '';
    res.tasks.forEach(task => {
      const card = document.createElement('div');
      card.className = 'corner-task-card';
      const isDone = task.status === 'DONE';

      card.innerHTML = `
        <div class="task-card-header">
          <span class="task-project-name">${escapeHtml(task.project_title || 'Project')}</span>
          <span class="task-status-pill ${task.status}">${task.status}</span>
        </div>
        <div class="task-card-name">${escapeHtml(task.task_name)}</div>
        <div class="task-card-actions">
          ${!isDone ? `
            <button class="btn btn-cyan btn-xs" onclick="openUploadResearchModal('${task.id}', '${escapeHtml(task.task_name)}')">
              📄 Upload Research (Mark Done)
            </button>
          ` : `
            <span class="text-muted text-xs">✓ Research Document Uploaded</span>
          `}
        </div>
      `;
      listEl.appendChild(card);
    });
  } catch (err) {
    listEl.innerHTML = '<div class="empty-state text-muted">Tasks unavailable for this role</div>';
  }
}

async function fetchResearcherIdeas() {
  const listEl = document.getElementById('researcherMyIdeasList');
  if (!listEl) return;

  try {
    const res = await apiFetch('/api/ideas/my');
    if (!res || !res.ideas) {
      listEl.innerHTML = '<div class="empty-state">No ideas submitted yet</div>';
      return;
    }

    if (res.ideas.length === 0) {
      listEl.innerHTML = '<div class="empty-state">No ideas in your submission log</div>';
      return;
    }

    listEl.innerHTML = '';
    res.ideas.forEach(idea => {
      const card = document.createElement('div');
      card.className = 'corner-task-card';
      let statusClass = 'badge-purple';
      if (idea.status === 'APPROVED') statusClass = 'badge-green';
      if (idea.status === 'REJECTED') statusClass = 'badge-rose';

      card.innerHTML = `
        <div class="task-card-header">
          <span class="task-card-name">${escapeHtml(idea.title)}</span>
          <span class="badge ${statusClass}">${escapeHtml(idea.status)}</span>
        </div>
        <div class="task-card-meta">
          <span class="text-muted text-xs">Category: ${escapeHtml(idea.category || 'General')}</span>
        </div>
      `;
      listEl.appendChild(card);
    });
  } catch (err) {
    listEl.innerHTML = '<div class="empty-state text-muted">Ideas log restricted</div>';
  }
}

/**
 * 7. Developer Panel Data & Tasks
 */
async function fetchDeveloperTasks() {
  const listEl = document.getElementById('developerTasksList');
  const countEl = document.getElementById('devTaskCount');
  if (!listEl) return;

  try {
    let url = '/api/projects/my-tasks?role=developer';
    if (state.devSubroleFilter !== 'all') {
      url += `&task_type=${state.devSubroleFilter}`;
    }

    const res = await apiFetch(url);
    if (!res || !res.tasks) {
      listEl.innerHTML = '<div class="empty-state">No dev tasks assigned</div>';
      return;
    }

    if (countEl) countEl.textContent = `${res.tasks.length} active`;

    if (res.tasks.length === 0) {
      listEl.innerHTML = '<div class="empty-state">No development tasks in queue</div>';
      return;
    }

    listEl.innerHTML = '';
    res.tasks.forEach(task => {
      const card = document.createElement('div');
      card.className = 'corner-task-card';

      const isBlocked = task.status === 'BLOCKED';
      const isTodo = task.status === 'TODO';
      const isInProgress = task.status === 'IN_PROGRESS';
      const isDone = task.status === 'DONE';

      card.innerHTML = `
        <div class="task-card-header">
          <span class="task-project-name">${escapeHtml(task.project_title || 'Project')}</span>
          <span class="task-status-pill ${task.status}">${task.status}</span>
        </div>
        <div class="task-card-name">${escapeHtml(task.task_name)}</div>
        <div class="task-card-meta">
          <span class="badge badge-role ${task.task_type === 'frontend' ? 'cyan' : 'emerald'}">${task.task_type.toUpperCase()}</span>
          ${isBlocked ? `
            <span class="task-dep-pill" title="Waiting on prerequisite task">
              🔒 Waiting on: ${escapeHtml(task.depends_on_task_name || 'Prerequisite')}
            </span>
          ` : ''}
        </div>
        <div class="task-card-actions">
          ${isTodo ? `
            <button class="btn btn-secondary btn-xs" onclick="updateTaskState('${task.id}', 'IN_PROGRESS')">
              ▶ Start Task
            </button>
          ` : ''}
          ${isInProgress ? `
            <button class="btn btn-green btn-xs" onclick="updateTaskState('${task.id}', 'DONE')">
              🚀 Mark Complete (Push to Center)
            </button>
          ` : ''}
          ${isDone ? `
            <span class="text-muted text-xs">✓ Work completed & pushed</span>
          ` : ''}
        </div>
      `;
      listEl.appendChild(card);
    });
  } catch (err) {
    listEl.innerHTML = '<div class="empty-state text-muted">Dev tasks unavailable for this role</div>';
  }
}

/**
 * 8. Producer / QA Panel Data & Tasks
 */
async function fetchProducerTasks() {
  const listEl = document.getElementById('producerTasksList');
  const countEl = document.getElementById('producerTaskCount');
  if (!listEl) return;

  try {
    const res = await apiFetch('/api/projects/my-tasks?role=producer');
    if (!res || !res.tasks) {
      listEl.innerHTML = '<div class="empty-state">No QA tasks assigned</div>';
      return;
    }

    if (countEl) countEl.textContent = `${res.tasks.length} active`;

    if (res.tasks.length === 0) {
      listEl.innerHTML = '<div class="empty-state">No QA tasks currently in testing queue</div>';
      return;
    }

    listEl.innerHTML = '';
    res.tasks.forEach(task => {
      const card = document.createElement('div');
      card.className = 'corner-task-card';

      const isBlocked = task.status === 'BLOCKED';
      const isDone = task.status === 'DONE';

      card.innerHTML = `
        <div class="task-card-header">
          <span class="task-project-name">${escapeHtml(task.project_title || 'Project')}</span>
          <span class="task-status-pill ${task.status}">${task.status}</span>
        </div>
        <div class="task-card-name">${escapeHtml(task.task_name)}</div>
        <div class="task-card-meta">
          ${isBlocked ? `
            <span class="task-dep-pill" title="Waiting on dev completion">
              🔒 Waiting on Dev Build: ${escapeHtml(task.depends_on_task_name || 'Dev Task')}
            </span>
          ` : ''}
        </div>
        <div class="task-card-actions">
          ${!isDone && !isBlocked ? `
            <button class="btn btn-green btn-xs" onclick="openTestReportModal('${task.id}', '${escapeHtml(task.task_name)}')">
              🧪 Submit Test Report (Mark Done)
            </button>
          ` : ''}
          ${isDone ? `
            <span class="text-muted text-xs">✓ Testing verified & passed</span>
          ` : ''}
        </div>
      `;
      listEl.appendChild(card);
    });
  } catch (err) {
    listEl.innerHTML = '<div class="empty-state text-muted">Testing tasks restricted</div>';
  }
}

/**
 * 9. Admin Approvals Queue & Team Health Stats
 */
async function fetchAdminApprovals() {
  const listEl = document.getElementById('adminApprovalsList');
  const countEl = document.getElementById('adminPendingCount');
  if (!listEl) return;

  if (state.user?.role !== 'admin') {
    listEl.innerHTML = '<div class="empty-state text-muted">Approvals restricted to Admin</div>';
    return;
  }

  try {
    const [withdrawalsRes, projectsRes] = await Promise.all([
      apiFetch('/api/admin/withdrawals/pending'),
      apiFetch('/api/admin/projects/all')
    ]);

    const withdrawals = withdrawalsRes?.withdrawals || [];
    const reviewProjects = (projectsRes?.projects || []).filter(p => p.current_stage === 'ADMIN_REVIEW');

    const totalPending = withdrawals.length + reviewProjects.length;
    if (countEl) countEl.textContent = `${totalPending} pending`;

    if (totalPending === 0) {
      listEl.innerHTML = '<div class="empty-state">No pending approvals required</div>';
      return;
    }

    listEl.innerHTML = '';

    // Render Pending Withdrawals
    withdrawals.forEach(w => {
      const item = document.createElement('div');
      item.className = 'approval-item';
      item.innerHTML = `
        <div class="approval-meta">
          <span class="approval-title">Payout: ₹${w.amount}</span>
          <span class="approval-sub">Requester: ${escapeHtml(w.user_name || 'Member')}</span>
        </div>
        <button class="btn btn-green btn-xs" onclick="approveWithdrawalQuick('${w.id}')">Approve</button>
      `;
      listEl.appendChild(item);
    });

    // Render Projects Awaiting Final Review
    reviewProjects.forEach(p => {
      const item = document.createElement('div');
      item.className = 'approval-item';
      item.innerHTML = `
        <div class="approval-meta">
          <span class="approval-title">Launch Review: ${escapeHtml(p.title)}</span>
          <span class="approval-sub">QA Verified • Ready for LIVE</span>
        </div>
        <button class="btn btn-primary btn-xs" onclick="approveProjectFinal('${p.id}')">Approve Launch</button>
      `;
      listEl.appendChild(item);
    });
  } catch (err) {
    console.error('Failed to fetch admin approvals:', err);
  }
}

async function fetchAdminStats() {
  if (state.user?.role !== 'admin') return;

  try {
    const [membersRes, projectsRes] = await Promise.all([
      apiFetch('/api/admin/members'),
      apiFetch('/api/admin/projects/all')
    ]);

    const activeMembers = (membersRes?.members || []).filter(m => m.status === 'active').length;
    const liveProjects = (projectsRes?.projects || []).filter(p => p.current_stage === 'LIVE').length;

    const mEl = document.getElementById('adminMembersCount');
    const pEl = document.getElementById('adminLiveProjects');
    if (mEl) mEl.textContent = activeMembers;
    if (pEl) pEl.textContent = liveProjects;
  } catch (err) {
    console.error('Failed to fetch admin stats:', err);
  }
}

/**
 * Task State Actions
 */
window.updateTaskState = async function(taskId, newStatus) {
  try {
    const res = await apiFetch(`/api/tasks/${taskId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status: newStatus })
    });

    if (res && res.message) {
      addTickerItem(res.message);
      await refreshAllData();
    } else if (res && res.error) {
      alert(`Action rejected: ${res.error}`);
    }
  } catch (err) {
    console.error('Error updating task state:', err);
  }
};

/**
 * Quick Admin Approvals
 */
window.approveWithdrawalQuick = async function(wId) {
  try {
    const res = await apiFetch(`/api/admin/withdrawals/${wId}/approve`, { method: 'POST' });
    if (res && res.message) {
      addTickerItem(res.message);
      await fetchAdminApprovals();
      await fetchSummary();
    } else if (res && res.error) {
      alert(`Approval error: ${res.error}`);
    }
  } catch (err) {
    console.error('Error approving payout:', err);
  }
};

window.approveProjectFinal = async function(projectId) {
  try {
    const res = await apiFetch(`/api/admin/projects/${projectId}/final-review`, {
      method: 'PATCH',
      body: JSON.stringify({ approved: true, notes: 'Approved via Admin Quick-Access Corner' })
    });

    if (res && res.message) {
      addTickerItem(res.message);
      await refreshAllData();
    } else if (res && res.error) {
      alert(`Review rejection: ${res.error}`);
    }
  } catch (err) {
    console.error('Error approving project final review:', err);
  }
};

/**
 * Modal Openers
 */
window.openUploadResearchModal = function(taskId, taskName) {
  document.getElementById('researchTaskId').value = taskId;
  document.getElementById('researchTaskNameDisplay').textContent = taskName;
  document.getElementById('uploadResearchModal').style.display = 'flex';
};

window.openTestReportModal = function(taskId, taskName) {
  document.getElementById('qaTaskId').value = taskId;
  document.getElementById('qaTaskNameDisplay').textContent = taskName;
  document.getElementById('testReportModal').style.display = 'flex';
};

window.openProjectDetail = async function(projectId) {
  try {
    const res = await apiFetch(`/api/projects/${projectId}`);
    if (!res || !res.project) return;

    const p = res.project;
    document.getElementById('modalProjectTitle').textContent = p.title;
    document.getElementById('modalProjectStage').textContent = p.current_stage;
    document.getElementById('modalOwnerName').textContent = p.owner_name || 'Owner';
    document.getElementById('modalProjectStatus').textContent = p.status;
    document.getElementById('modalClockStart').textContent = formatDate(p.created_at);

    const tbody = document.getElementById('modalTasksTableBody');
    tbody.innerHTML = '';
    (res.tasks || []).forEach(t => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>${escapeHtml(t.task_name)}</strong></td>
        <td><span class="badge ${t.task_type === 'testing' ? 'purple' : 'cyan'}">${t.task_type}</span></td>
        <td>${escapeHtml(t.assigned_to_name || 'Unassigned')}</td>
        <td>${escapeHtml(t.depends_on_task_name || 'None')}</td>
        <td><span class="task-status-pill ${t.status}">${t.status}</span></td>
      `;
      tbody.appendChild(tr);
    });

    const mBody = document.getElementById('modalMembersTableBody');
    mBody.innerHTML = '';
    (res.members || []).forEach(m => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escapeHtml(m.user_name)}</td>
        <td>${escapeHtml(m.role_in_project)}</td>
        <td><strong>${m.contribution_weight}%</strong></td>
      `;
      mBody.appendChild(tr);
    });

    const completed = (res.tasks || []).filter(t => t.status === 'DONE').length;
    const total = (res.tasks || []).length;
    const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
    document.getElementById('modalProgressText').textContent = `${completed} / ${total} tasks (${pct}%)`;

    document.getElementById('projectModalBackdrop').style.display = 'flex';
  } catch (err) {
    console.error('Failed to open project detail modal:', err);
  }
};

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
 * Notifications
 */
async function fetchNotifications() {
  try {
    const res = await apiFetch('/api/notifications');
    if (!res || !res.notifications) return;

    state.notifications = res.notifications;
    renderNotificationsList();

    const badge = document.getElementById('notifBadge');
    const sideCount = document.getElementById('sideNotifCount');
    const unread = res.unreadCount || 0;

    badge.textContent = unread;
    badge.style.display = unread > 0 ? 'inline-block' : 'none';
    if (sideCount) sideCount.textContent = `${unread} Unread`;
  } catch (err) {
    console.error('Failed to fetch notifications:', err);
  }
}

function renderNotificationsList() {
  const notifList = document.getElementById('notifList');
  const sideList = document.getElementById('sideNotifList');

  const content = state.notifications.length === 0
    ? '<div class="empty-state">No notifications recorded</div>'
    : state.notifications.map(n => `
      <div class="notification-item ${n.is_read ? 'read' : 'unread'}">
        <div class="notif-header">
          <span class="notif-type">${escapeHtml(n.type)}</span>
          <span class="notif-time">${formatDate(n.created_at)}</span>
        </div>
        <div class="notif-message">${escapeHtml(n.message)}</div>
      </div>
    `).join('');

  if (notifList) notifList.innerHTML = content;
  if (sideList) sideList.innerHTML = content;
}

/**
 * Helper: API fetch wrapper
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

  // Layout View Mode Switcher
  const btnSpatial = document.getElementById('btnSpatialView');
  const btnFocus = document.getElementById('btnFocusView');
  const workspaceMain = document.getElementById('workspaceMain');

  if (btnSpatial && btnFocus && workspaceMain) {
    btnSpatial.addEventListener('click', () => {
      btnSpatial.classList.add('active');
      btnFocus.classList.remove('active');
      workspaceMain.classList.remove('focus-mode');
    });

    btnFocus.addEventListener('click', () => {
      btnFocus.classList.add('active');
      btnSpatial.classList.remove('active');
      workspaceMain.classList.add('focus-mode');
    });
  }

  // Refresh Board Button
  document.getElementById('refreshKanbanBtn').addEventListener('click', () => refreshAllData());

  // Researcher Tabs
  document.querySelectorAll('.corner-tab').forEach(tabBtn => {
    tabBtn.addEventListener('click', () => {
      document.querySelectorAll('.corner-tab').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.corner-tab-pane').forEach(p => p.classList.remove('active'));
      tabBtn.classList.add('active');
      const paneId = `pane-${tabBtn.dataset.tab}`;
      const pane = document.getElementById(paneId);
      if (pane) pane.classList.add('active');
    });
  });

  // Developer Sub-role Filter
  document.querySelectorAll('.subrole-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.subrole-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.devSubroleFilter = btn.dataset.filter;
      fetchDeveloperTasks();
    });
  });

  // Open Submit Idea Modal
  document.getElementById('btnOpenSubmitIdeaModal').addEventListener('click', () => {
    document.getElementById('submitIdeaModal').style.display = 'flex';
  });

  document.getElementById('btnCancelSubmitIdea').addEventListener('click', () => {
    document.getElementById('submitIdeaModal').style.display = 'none';
  });
  document.getElementById('closeSubmitIdeaModalBtn').addEventListener('click', () => {
    document.getElementById('submitIdeaModal').style.display = 'none';
  });

  // Handle Idea Submission Form
  document.getElementById('submitIdeaForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = document.getElementById('newIdeaTitle').value;
    const category = document.getElementById('newIdeaCategory').value;
    const attachmentUrl = document.getElementById('newIdeaAttachment').value;
    const desc = document.getElementById('newIdeaDesc').value;

    try {
      // 1. Create draft
      const draftRes = await apiFetch('/api/ideas/draft', {
        method: 'POST',
        body: JSON.stringify({ title, description: desc, category, attachment_url: attachmentUrl })
      });

      if (!draftRes || !draftRes.idea) {
        alert(draftRes?.error || 'Failed to save draft');
        return;
      }

      // 2. Submit draft (triggers quota check & review meeting)
      const submitRes = await apiFetch(`/api/ideas/${draftRes.idea.id}/submit`, {
        method: 'POST'
      });

      if (submitRes && submitRes.idea) {
        document.getElementById('submitIdeaModal').style.display = 'none';
        document.getElementById('submitIdeaForm').reset();
        addTickerItem(`Idea submitted: "${title}"`);
        await refreshAllData();
      } else {
        alert(`Quota or submission error: ${submitRes?.error || 'Rejected'}`);
      }
    } catch (err) {
      console.error('Error submitting idea:', err);
    }
  });

  // Handle Upload Research Form
  document.getElementById('uploadResearchForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const taskId = document.getElementById('researchTaskId').value;
    const fileUrl = document.getElementById('researchFileUrl').value;
    const notes = document.getElementById('researchNotes').value;

    try {
      const res = await apiFetch(`/api/tasks/${taskId}/upload`, {
        method: 'POST',
        body: JSON.stringify({ file_url: fileUrl, notes, mark_done: true, asset_type: 'pdf_doc' })
      });

      if (res && res.task) {
        document.getElementById('uploadResearchModal').style.display = 'none';
        document.getElementById('uploadResearchForm').reset();
        addTickerItem(`Research uploaded for task "${res.task.task_name}" — Dev unblocked`);
        await refreshAllData();
      } else {
        alert(`Upload failed: ${res?.error || 'Error'}`);
      }
    } catch (err) {
      console.error('Error uploading research:', err);
    }
  });

  document.getElementById('btnCancelUploadResearch').addEventListener('click', () => {
    document.getElementById('uploadResearchModal').style.display = 'none';
  });
  document.getElementById('closeUploadResearchModalBtn').addEventListener('click', () => {
    document.getElementById('uploadResearchModal').style.display = 'none';
  });

  // Handle Test Report Form
  document.getElementById('testReportForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const taskId = document.getElementById('qaTaskId').value;
    const reportUrl = document.getElementById('qaReportUrl').value;
    const notes = document.getElementById('qaNotes').value;

    try {
      const res = await apiFetch(`/api/tasks/${taskId}/upload`, {
        method: 'POST',
        body: JSON.stringify({ file_url: reportUrl, notes, mark_done: true, asset_type: 'pdf_doc' })
      });

      if (res && res.task) {
        document.getElementById('testReportModal').style.display = 'none';
        document.getElementById('testReportForm').reset();
        addTickerItem(`QA verified for task "${res.task.task_name}" — Advanced to Admin Review`);
        await refreshAllData();
      } else {
        alert(`QA report submission failed: ${res?.error || 'Error'}`);
      }
    } catch (err) {
      console.error('Error submitting test report:', err);
    }
  });

  document.getElementById('btnCancelTestReport').addEventListener('click', () => {
    document.getElementById('testReportModal').style.display = 'none';
  });
  document.getElementById('closeTestReportModalBtn').addEventListener('click', () => {
    document.getElementById('testReportModal').style.display = 'none';
  });

  // Admin Quick Action: Add Member Modal
  document.getElementById('btnAdminAddMember').addEventListener('click', () => {
    document.getElementById('adminAddMemberModal').style.display = 'flex';
  });
  document.getElementById('btnCancelAddMember').addEventListener('click', () => {
    document.getElementById('adminAddMemberModal').style.display = 'none';
  });
  document.getElementById('closeAddMemberModalBtn').addEventListener('click', () => {
    document.getElementById('adminAddMemberModal').style.display = 'none';
  });

  document.getElementById('adminAddMemberForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('newMemberName').value;
    const email = document.getElementById('newMemberEmail').value;
    const role = document.getElementById('newMemberRole').value;
    const subRole = document.getElementById('newMemberSubRole').value || null;
    const password = document.getElementById('newMemberPassword').value;

    try {
      const res = await apiFetch('/api/admin/members/add', {
        method: 'POST',
        body: JSON.stringify({ name, email, role, sub_role: subRole, temporary_password: password })
      });

      if (res && res.user) {
        document.getElementById('adminAddMemberModal').style.display = 'none';
        document.getElementById('adminAddMemberForm').reset();
        addTickerItem(`New member added: ${name} (${role})`);
        await fetchAdminStats();
      } else {
        alert(`Add member error: ${res?.error || 'Failed'}`);
      }
    } catch (err) {
      console.error('Error adding member:', err);
    }
  });

  // Admin Quick Action: Killswitch Offboard Modal
  document.getElementById('btnAdminKillswitch').addEventListener('click', async () => {
    const selectEl = document.getElementById('offboardMemberSelect');
    selectEl.innerHTML = '<option value="">Loading members...</option>';
    document.getElementById('adminOffboardModal').style.display = 'flex';

    try {
      const res = await apiFetch('/api/admin/members');
      if (res && res.members) {
        selectEl.innerHTML = res.members
          .filter(m => m.status === 'active' && m.id !== state.user?.id)
          .map(m => `<option value="${m.id}">${escapeHtml(m.name)} (${m.role} - ${m.email})</option>`)
          .join('');
      }
    } catch (e) {}
  });

  document.getElementById('btnCancelOffboard').addEventListener('click', () => {
    document.getElementById('adminOffboardModal').style.display = 'none';
  });
  document.getElementById('closeOffboardModalBtn').addEventListener('click', () => {
    document.getElementById('adminOffboardModal').style.display = 'none';
  });

  document.getElementById('adminOffboardForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const memberId = document.getElementById('offboardMemberSelect').value;
    const reason = document.getElementById('offboardReason').value;

    if (!memberId) return alert('Please select a member');

    try {
      const res = await apiFetch(`/api/admin/members/${memberId}/offboard`, {
        method: 'POST',
        body: JSON.stringify({ reason })
      });

      if (res && res.offboarding) {
        document.getElementById('adminOffboardModal').style.display = 'none';
        document.getElementById('adminOffboardForm').reset();
        addTickerItem(`⚠️ Offboarding killswitch executed for member`);
        await refreshAllData();
      } else {
        alert(`Offboarding error: ${res?.error || 'Failed'}`);
      }
    } catch (err) {
      console.error('Error offboarding member:', err);
    }
  });

  // Admin Quick Action: Record Revenue Modal
  document.getElementById('btnAdminRevenue').addEventListener('click', async () => {
    const selectEl = document.getElementById('revProjectSelect');
    selectEl.innerHTML = '<option value="">Loading live projects...</option>';
    document.getElementById('adminRevenueModal').style.display = 'flex';

    try {
      const res = await apiFetch('/api/admin/projects/all');
      if (res && res.projects) {
        selectEl.innerHTML = res.projects
          .map(p => `<option value="${p.id}">${escapeHtml(p.title)} (${p.current_stage})</option>`)
          .join('');
      }
    } catch (e) {}
  });

  document.getElementById('btnCancelRevenue').addEventListener('click', () => {
    document.getElementById('adminRevenueModal').style.display = 'none';
  });
  document.getElementById('closeRevenueModalBtn').addEventListener('click', () => {
    document.getElementById('adminRevenueModal').style.display = 'none';
  });

  document.getElementById('adminRevenueForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const projectId = document.getElementById('revProjectSelect').value;
    const amount = parseFloat(document.getElementById('revAmount').value);
    const source = document.getElementById('revSource').value;

    if (!projectId) return alert('Please select a project');

    try {
      const res = await apiFetch(`/api/admin/projects/${projectId}/revenue`, {
        method: 'POST',
        body: JSON.stringify({ amount, source })
      });

      if (res && res.revenueEvent) {
        document.getElementById('adminRevenueModal').style.display = 'none';
        document.getElementById('adminRevenueForm').reset();
        addTickerItem(`Gross revenue recorded: ₹${amount}`);
        await refreshAllData();
      } else {
        alert(`Revenue recording error: ${res?.error || 'Failed'}`);
      }
    } catch (err) {
      console.error('Error recording revenue:', err);
    }
  });

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

  // Modal Closers for Project Detail & Voting
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
  if (indicator) indicator.className = `status-indicator ${status}`;
  if (statusText) statusText.textContent = text;
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
