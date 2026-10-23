/**
 * MAHI TECH GROUP — 4 CORNER PANELS & CENTER DASHBOARD ENGINE
 * Step 08 Revision: Researcher (TL), UI/UX Designer (TR), Producer/Tester (BL), Developer (BR)
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
  viewMode: 'spatial', // 'spatial' | 'focus'
  activeDetailProjectId: null,
  canvasProjectId: null,
  canvasRoomId: null,
  canvasState: { objects: {}, tombstones: {}, metadata: {} },
  canvasParticipants: [],
  canvasIsArchived: false,
  activeMeetingId: null,
  activeJitsiApi: null,
  meetingLiveTimerInterval: null,
  currentLiveMeeting: null,
  currentNotesMeetingId: null,
  currentNotesData: null
};

// Seed credentials for authenticating real users per Step 01 RBAC
const ROLE_ACCOUNTS = {
  researcher: { email: 'researcher@mahitechgroup.com', password: 'ResearcherPass123!', role: 'researcher' },
  designer: { email: 'designer@mahitechgroup.com', password: 'DesignerPass123!', role: 'designer' },
  producer: { email: 'producer@mahitechgroup.com', password: 'ProducerPass123!', role: 'producer' },
  developer: { email: 'developer@mahitechgroup.com', password: 'DeveloperPass123!', role: 'developer' },
  admin: { email: 'admin@mahitechgroup.com', password: 'AdminPassword@2026', role: 'admin' }
};

document.addEventListener('DOMContentLoaded', async () => {
  setupEventListeners();
  // Start with UI/UX Designer session by default
  await switchAccount('designer');
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

    // Update meeting admin buttons visibility
    const btnSched = document.getElementById('btnScheduleMeetingModal');
    const btnSchedList = document.getElementById('btnLaunchNewMeetingFromList');
    if (btnSched) btnSched.style.display = (data.user.role === 'admin') ? 'inline-flex' : 'none';
    if (btnSchedList) btnSchedList.style.display = (data.user.role === 'admin') ? 'inline-block' : 'none';

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
      fetchDesignerTasks();
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

    // STEP 11: CO-WORKING CANVAS REAL-TIME EVENTS
    case 'canvas:init':
      handleCanvasInit(data);
      break;

    case 'canvas:user_joined':
      handleCanvasUserJoined(data);
      break;

    case 'canvas:user_left':
      handleCanvasUserLeft(data);
      break;

    case 'canvas:cursor_move':
      handleCanvasCursorMove(data);
      break;

    case 'canvas:object_update':
      handleCanvasObjectUpdate(data);
      break;

    case 'canvas:object_delete':
      handleCanvasObjectDelete(data);
      break;

    case 'canvas:error':
      alert(`Co-working Canvas: ${data.error || 'Operation failed'}`);
      break;

    // STEP 12: MEETING INTEGRATION REAL-TIME EVENTS
    case 'meeting:scheduled':
      handleMeetingScheduled(data);
      break;

    case 'meeting:started':
      handleMeetingStarted(data);
      break;

    case 'meeting:user_joined':
      handleMeetingUserJoined(data);
      break;

    case 'meeting:user_left':
      handleMeetingUserLeft(data);
      break;

    case 'meeting:ended':
      handleMeetingEnded(data);
      break;

    case 'meeting:notes_ready':
      handleMeetingNotesReady(data);
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
    refreshCornerTasks()
  ]);
}

/**
 * Refresh task queues across corner panels
 */
async function refreshCornerTasks() {
  await Promise.allSettled([
    fetchResearcherTasks(),
    fetchResearcherIdeas(),
    fetchDesignerTasks(),
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

    // Helper to populate any role's mini-card with the universal 4 PRD metrics
    function populateCard(prefix) {
      const avatarEl = document.getElementById(`${prefix}MiniAvatar`);
      if (avatarEl) avatarEl.textContent = data.avatar || data.name?.charAt(0) || 'U';
      const nameEl = document.getElementById(`${prefix}MiniName`);
      if (nameEl) nameEl.textContent = data.name;
      const ideasEl = document.getElementById(`${prefix}IdeasCount`);
      if (ideasEl) ideasEl.textContent = data.totalIdeasSubmitted;
      const projEl = document.getElementById(`${prefix}ProjectsBuilt`);
      if (projEl) projEl.textContent = data.totalProjectsBuilt;
      const ratingEl = document.getElementById(`${prefix}RatingAvg`);
      if (ratingEl) ratingEl.textContent = `${data.ratingAverage} ★`;
      const walletEl = document.getElementById(`${prefix}Wallet`);
      if (walletEl) walletEl.textContent = `₹${data.totalRevenueEarned || data.walletBalance || '0.00'}`;
    }

    if (data.role === 'researcher') {
      populateCard('researcher');
    } else if (data.role === 'designer') {
      populateCard('designer');
    } else if (data.role === 'developer') {
      populateCard('developer');
      const subBadge = document.getElementById('developerSubRoleBadge');
      if (subBadge) subBadge.textContent = data.subRole ? data.subRole.toUpperCase() : 'DEVELOPER';
    } else if (data.role === 'producer') {
      populateCard('producer');
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

    // Designer Banners ("Research Ready")
    const desBox = document.getElementById('designerBannersList');
    if (desBox) {
      desBox.innerHTML = '';
      banners.filter(b => b.type === 'RESEARCH_READY').forEach(b => {
        desBox.appendChild(createBannerEl(b, 'research-ready'));
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
 * 9. UI/UX Designer Panel Data & Tasks
 */
async function fetchDesignerTasks() {
  const listEl = document.getElementById('designerTasksList');
  const countEl = document.getElementById('designerTaskCount');
  if (!listEl) return;

  try {
    const res = await apiFetch('/api/projects/my-tasks?role=designer');
    if (!res || !res.tasks) {
      listEl.innerHTML = '<div class="empty-state">No design tasks assigned</div>';
      return;
    }

    if (countEl) countEl.textContent = `${res.tasks.length} active`;

    if (res.tasks.length === 0) {
      listEl.innerHTML = '<div class="empty-state">No design tasks in queue</div>';
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
          <span class="badge badge-role rose">DESIGN</span>
          ${isBlocked ? `
            <span class="task-dep-pill" title="Waiting on prerequisite research">
              🔒 Waiting on: ${escapeHtml(task.depends_on_task_name || 'Deep Research')}
            </span>
          ` : ''}
        </div>
        <div class="task-card-actions">
          ${isTodo ? `
            <button class="btn btn-secondary btn-xs" onclick="updateTaskState('${task.id}', 'IN_PROGRESS')">
              ▶ Start Design
            </button>
            <button class="btn btn-rose btn-xs" onclick="openUploadDesignModal('${task.id}', '${escapeHtml(task.task_name)}')">
              🎨 Upload Deliverables
            </button>
          ` : ''}
          ${isInProgress ? `
            <button class="btn btn-rose btn-xs" onclick="openUploadDesignModal('${task.id}', '${escapeHtml(task.task_name)}')">
              🎨 Upload Deliverables (Mark Done)
            </button>
          ` : ''}
          ${isDone ? `
            <span class="text-muted text-xs">✓ Design deliverables uploaded & pushed</span>
          ` : ''}
        </div>
      `;
      listEl.appendChild(card);
    });
  } catch (err) {
    listEl.innerHTML = '<div class="empty-state text-muted">Design tasks unavailable for this role</div>';
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

window.openUploadDesignModal = function(taskId, taskName) {
  document.getElementById('designTaskId').value = taskId;
  document.getElementById('designTaskNameDisplay').textContent = taskName;
  document.getElementById('uploadDesignModal').style.display = 'flex';
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
    state.activeDetailProjectId = projectId;
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
        addTickerItem(`QA verified for task "${res.task.task_name}" — Advanced to Final Launch Review`);
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

  // Handle Design Deliverables Form (UI/UX Designer Corner)
  document.getElementById('btnCancelUploadDesign').addEventListener('click', () => {
    document.getElementById('uploadDesignModal').style.display = 'none';
  });
  document.getElementById('closeUploadDesignModalBtn').addEventListener('click', () => {
    document.getElementById('uploadDesignModal').style.display = 'none';
  });

  document.getElementById('uploadDesignForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const taskId = document.getElementById('designTaskId').value;
    const fileUrl = document.getElementById('designFileUrl').value;
    const notes = document.getElementById('designNotes').value;

    try {
      const res = await apiFetch(`/api/tasks/${taskId}/upload`, {
        method: 'POST',
        body: JSON.stringify({ file_url: fileUrl, notes, mark_done: true, asset_type: 'design_file' })
      });

      if (res && res.task) {
        document.getElementById('uploadDesignModal').style.display = 'none';
        document.getElementById('uploadDesignForm').reset();
        addTickerItem(`Design deliverables uploaded for task "${res.task.task_name}" — Design complete`);
        await refreshAllData();
      } else {
        alert(`Design upload failed: ${res?.error || 'Error'}`);
      }
    } catch (err) {
      console.error('Error uploading design deliverables:', err);
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

  // STEP 11: Co-working Canvas Actions
  const btnJoinFromModal = document.getElementById('btnJoinCoworkingFromModal');
  if (btnJoinFromModal) {
    btnJoinFromModal.addEventListener('click', () => {
      if (state.activeDetailProjectId) {
        document.getElementById('projectModalBackdrop').style.display = 'none';
        openCoworkingRoom(state.activeDetailProjectId);
      }
    });
  }

  const btnExitCanvas = document.getElementById('btnExitCanvas');
  if (btnExitCanvas) {
    btnExitCanvas.addEventListener('click', exitCoworkingRoom);
  }

  // Toolbar sticky notes & shapes
  document.getElementById('btnAddYellowSticky')?.addEventListener('click', () => addCanvasItem('sticky', '#fef08a'));
  document.getElementById('btnAddBlueSticky')?.addEventListener('click', () => addCanvasItem('sticky', '#bae6fd'));
  document.getElementById('btnAddGreenSticky')?.addEventListener('click', () => addCanvasItem('sticky', '#bbf7d0'));
  document.getElementById('btnAddPinkSticky')?.addEventListener('click', () => addCanvasItem('sticky', '#fbcfe8'));
  document.getElementById('btnAddSpecCard')?.addEventListener('click', () => addCanvasItem('card'));
  document.getElementById('btnAddBoxShape')?.addEventListener('click', () => addCanvasItem('shape'));

  // Canvas surface cursor movement tracking
  let lastCursorSend = 0;
  const canvasContainer = document.getElementById('canvasSurfaceContainer');
  if (canvasContainer) {
    canvasContainer.addEventListener('mousemove', (e) => {
      if (!state.canvasProjectId || state.canvasIsArchived) return;

      const rect = canvasContainer.getBoundingClientRect();
      const x = Math.round(e.clientX - rect.left + canvasContainer.scrollLeft);
      const y = Math.round(e.clientY - rect.top + canvasContainer.scrollTop);

      const now = Date.now();
      if (now - lastCursorSend >= 60) {
        lastCursorSend = now;
        if (state.ws && state.ws.readyState === WebSocket.OPEN) {
          state.ws.send(JSON.stringify({
            action: 'canvas:cursor_move',
            projectId: state.canvasProjectId,
            x,
            y
          }));
        }
      }
    });
  }

  // STEP 12: Meeting Integration Listeners
  document.getElementById('btnOpenMeetingsModal')?.addEventListener('click', () => {
    document.getElementById('meetingsListModalBackdrop').style.display = 'flex';
    fetchMeetingsList();
  });

  document.getElementById('btnCloseMeetingsListModal')?.addEventListener('click', () => {
    document.getElementById('meetingsListModalBackdrop').style.display = 'none';
  });

  const openSchedModal = async () => {
    document.getElementById('scheduleMeetingModalBackdrop').style.display = 'flex';
    // Populate pending ideas dropdown
    const select = document.getElementById('schedLinkedIdea');
    if (select) {
      select.innerHTML = '<option value="">-- Select Pending Idea --</option>';
      try {
        const ideasRes = await apiFetch('/api/ideas/my');
        // Also fetch pending votes feed
        const votesData = await apiFetch('/api/dashboard/votes-feed');
        const pending = votesData?.ideas || [];
        pending.forEach(i => {
          select.innerHTML += `<option value="${i.id}">${escapeHtml(i.title)}</option>`;
        });
      } catch (e) {}
    }
  };

  document.getElementById('btnScheduleMeetingModal')?.addEventListener('click', openSchedModal);
  document.getElementById('btnLaunchNewMeetingFromList')?.addEventListener('click', openSchedModal);

  document.getElementById('btnCloseScheduleMeetingModal')?.addEventListener('click', () => {
    document.getElementById('scheduleMeetingModalBackdrop').style.display = 'none';
  });
  document.getElementById('btnCancelScheduleMeeting')?.addEventListener('click', () => {
    document.getElementById('scheduleMeetingModalBackdrop').style.display = 'none';
  });

  document.getElementById('schedMeetingType')?.addEventListener('change', (e) => {
    const group = document.getElementById('schedLinkedIdeaGroup');
    if (group) group.style.display = (e.target.value === 'idea_review') ? 'block' : 'none';
  });

  document.getElementById('scheduleMeetingForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = document.getElementById('schedMeetingTitle').value.trim();
    const meeting_type = document.getElementById('schedMeetingType').value;
    const linked_idea_id = document.getElementById('schedLinkedIdea').value || null;
    const scheduled_at = document.getElementById('schedMeetingDateTime').value || null;
    const recording_enabled = document.getElementById('schedRecordingEnabled').checked;

    try {
      const res = await apiFetch('/api/meetings', {
        method: 'POST',
        body: JSON.stringify({
          title,
          meeting_type,
          linked_idea_id,
          scheduled_at: scheduled_at ? new Date(scheduled_at).toISOString() : null,
          recording_enabled
        })
      });

      if (res && res.meeting) {
        document.getElementById('scheduleMeetingModalBackdrop').style.display = 'none';
        document.getElementById('scheduleMeetingForm').reset();
        addTickerItem(`Meeting scheduled: "${res.meeting.title}"`);
        fetchMeetingsList();
      } else {
        alert(`Failed to schedule meeting: ${res?.error || 'Error'}`);
      }
    } catch (err) {
      console.error('Error creating meeting:', err);
    }
  });

  document.getElementById('btnLeaveMeeting')?.addEventListener('click', leaveCurrentMeeting);
  document.getElementById('btnEndMeetingForAll')?.addEventListener('click', endCurrentMeeting);

  document.getElementById('btnJoinLiveMeetingBanner')?.addEventListener('click', () => {
    if (state.currentLiveMeeting?.id || state.currentLiveMeeting?.meeting_id) {
      joinMeetingRoom(state.currentLiveMeeting.id || state.currentLiveMeeting.meeting_id);
    }
  });

  document.getElementById('btnDismissLiveMeetingBanner')?.addEventListener('click', () => {
    document.getElementById('liveMeetingBanner').style.display = 'none';
  });

  document.getElementById('btnCloseMeetingNotesModal')?.addEventListener('click', () => {
    document.getElementById('meetingNotesModalBackdrop').style.display = 'none';
  });

  document.getElementById('btnNotesLangEn')?.addEventListener('click', () => switchNotesLang('en'));
  document.getElementById('btnNotesLangHi')?.addEventListener('click', () => switchNotesLang('hi'));
  document.getElementById('btnNotesLangRaw')?.addEventListener('click', () => switchNotesLang('raw'));

  document.getElementById('btnSplitVoteGreen')?.addEventListener('click', () => submitSplitVote('green'));
  document.getElementById('btnSplitVoteRed')?.addEventListener('click', () => submitSplitVote('red'));
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

  // Requirement #2: Conditional DOM rendering of Admin Control Panel button
  let adminNavBtn = document.getElementById('adminPanelNavBtn');
  if (user.role === 'admin') {
    if (!adminNavBtn) {
      adminNavBtn = document.createElement('a');
      adminNavBtn.id = 'adminPanelNavBtn';
      adminNavBtn.href = '/admin.html';
      adminNavBtn.className = 'view-btn';
      adminNavBtn.style.cssText = 'text-decoration: none; display: inline-flex; align-items: center; gap: 4px; padding: 0.4rem 0.75rem; font-size: 0.8rem; background: rgba(239, 68, 68, 0.2); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.4);';
      adminNavBtn.title = 'Open Full Admin Governance Control Panel';
      adminNavBtn.innerHTML = '⚙️ Admin Panel';
      const userProfileBadge = document.querySelector('.user-profile-badge');
      if (userProfileBadge && userProfileBadge.parentNode) {
        userProfileBadge.parentNode.insertBefore(adminNavBtn, userProfileBadge);
      }
    }
  } else {
    // If not admin, ensure element is completely absent from DOM
    if (adminNavBtn && adminNavBtn.parentNode) {
      adminNavBtn.parentNode.removeChild(adminNavBtn);
    }
  }
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

// ===================================================================
// STEP 11: CO-WORKING CANVAS CONTROLLER
// ===================================================================

async function openCoworkingRoom(projectId) {
  if (!projectId) return;

  // RBAC check: Admin exclusion
  if (state.user && state.user.role === 'admin') {
    alert('Access Restricted: Administrator accounts are excluded from the creative peer co-working canvas. Governance oversight is conducted via the Admin Control Panel.');
    return;
  }

  try {
    const res = await apiFetch(`/api/projects/${projectId}/coworking-room`);
    if (!res || !res.room) {
      alert(res?.error || 'Failed to access co-working room.');
      return;
    }

    state.canvasProjectId = projectId;
    state.canvasRoomId = res.room.id;
    state.canvasState = res.canvasState || { objects: {}, tombstones: {}, metadata: {} };
    state.canvasParticipants = res.participants || [];
    state.canvasIsArchived = res.isArchived || false;

    document.getElementById('canvasProjectTitleDisplay').textContent = `${res.projectTitle || 'Project'} — Co-working Canvas`;
    document.getElementById('canvasStageBadge').textContent = res.isArchived ? 'LIVE (ARCHIVED)' : 'ACTIVE WORKSPACE';
    const statusPill = document.getElementById('canvasSaveStatus');
    if (res.isArchived) {
      statusPill.textContent = '🔒 Read-Only / Archived';
      statusPill.className = 'canvas-save-status archived';
      document.getElementById('canvasToolbar').style.display = 'none';
      document.getElementById('canvasSurfaceContainer').classList.add('read-only');
    } else {
      statusPill.textContent = '✓ Live Synced';
      statusPill.className = 'canvas-save-status';
      document.getElementById('canvasToolbar').style.display = 'flex';
      document.getElementById('canvasSurfaceContainer').classList.remove('read-only');
    }

    renderCanvasPresence();
    renderCanvasElements();

    // Show modal
    document.getElementById('coworkingModalBackdrop').style.display = 'flex';

    // Join room on WebSocket
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
      state.ws.send(JSON.stringify({
        action: 'canvas:join',
        projectId
      }));
    }
  } catch (err) {
    console.error('Failed to open coworking room:', err);
    alert('Failed to connect to co-working room');
  }
}

function exitCoworkingRoom() {
  if (state.canvasProjectId && state.ws && state.ws.readyState === WebSocket.OPEN) {
    state.ws.send(JSON.stringify({
      action: 'canvas:leave',
      projectId: state.canvasProjectId
    }));
  }

  document.getElementById('coworkingModalBackdrop').style.display = 'none';
  state.canvasProjectId = null;
  state.canvasRoomId = null;
  state.canvasState = { objects: {}, tombstones: {}, metadata: {} };
  state.canvasParticipants = [];
  document.getElementById('canvasCursorsLayer').innerHTML = '';
  document.getElementById('canvasElementsLayer').innerHTML = '';
}

function addCanvasItem(type, color = '#fef08a') {
  if (state.canvasIsArchived) {
    alert('Canvas is archived in read-only mode.');
    return;
  }
  if (!state.canvasProjectId) return;

  const count = Object.keys(state.canvasState.objects || {}).length;
  if (count >= 500) {
    alert('Canvas capacity reached: maximum 500 active objects.');
    return;
  }

  const container = document.getElementById('canvasSurfaceContainer');
  const scrollLeft = container ? container.scrollLeft : 0;
  const scrollTop = container ? container.scrollTop : 0;

  const offset = (count % 8) * 20;
  const x = scrollLeft + 120 + offset;
  const y = scrollTop + 80 + offset;
  const id = 'elem_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);

  let initialContent = '';
  if (type === 'sticky') initialContent = 'Collaborative idea note...';
  else if (type === 'card') initialContent = 'Feature / Architecture Specification';
  else if (type === 'shape') initialContent = 'Architecture Block';

  const element = {
    id,
    type,
    color,
    content: initialContent,
    x,
    y,
    width: type === 'card' ? 260 : (type === 'shape' ? 160 : 200),
    height: type === 'shape' ? 120 : 150
  };

  // Optimistic local update
  state.canvasState.objects[id] = {
    ...element,
    createdBy: { userId: state.user.id, name: state.user.name, role: state.user.role },
    lastModifiedBy: { userId: state.user.id, name: state.user.name, role: state.user.role }
  };
  renderCanvasElements();

  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    state.ws.send(JSON.stringify({
      action: 'canvas:object_update',
      projectId: state.canvasProjectId,
      object: element
    }));
  }
}

function deleteCanvasItem(id) {
  if (state.canvasIsArchived) return;
  if (!state.canvasProjectId) return;

  delete state.canvasState.objects[id];
  renderCanvasElements();

  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    state.ws.send(JSON.stringify({
      action: 'canvas:object_delete',
      projectId: state.canvasProjectId,
      objectId: id
    }));
  }
}

function updateCanvasItemContent(id, content) {
  if (state.canvasIsArchived) return;
  if (!state.canvasProjectId || !state.canvasState.objects[id]) return;

  const elem = state.canvasState.objects[id];
  elem.content = content;

  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    state.ws.send(JSON.stringify({
      action: 'canvas:object_update',
      projectId: state.canvasProjectId,
      object: { ...elem, content }
    }));
  }
}

function makeElementDraggable(domEl, elem) {
  let isDragging = false;
  let startX = 0;
  let startY = 0;
  let initialLeft = 0;
  let initialTop = 0;

  domEl.addEventListener('mousedown', (e) => {
    if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'BUTTON') return;
    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;
    initialLeft = parseInt(domEl.style.left || '0', 10);
    initialTop = parseInt(domEl.style.top || '0', 10);
    e.preventDefault();

    const onMouseMove = (moveEvent) => {
      if (!isDragging) return;
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      const newX = Math.max(0, initialLeft + dx);
      const newY = Math.max(0, initialTop + dy);
      domEl.style.left = `${newX}px`;
      domEl.style.top = `${newY}px`;
    };

    const onMouseUp = () => {
      if (!isDragging) return;
      isDragging = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);

      const finalX = parseInt(domEl.style.left || '0', 10);
      const finalY = parseInt(domEl.style.top || '0', 10);

      if (finalX !== initialLeft || finalY !== initialTop) {
        elem.x = finalX;
        elem.y = finalY;
        if (state.ws && state.ws.readyState === WebSocket.OPEN) {
          state.ws.send(JSON.stringify({
            action: 'canvas:object_update',
            projectId: state.canvasProjectId,
            object: elem
          }));
        }
      }
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  });
}

function renderCanvasElements() {
  const layer = document.getElementById('canvasElementsLayer');
  if (!layer) return;

  const objects = state.canvasState.objects || {};
  const count = Object.keys(objects).length;
  const countEl = document.getElementById('canvasCapacityPill');
  if (countEl) countEl.textContent = `${count} / 500 items`;

  layer.innerHTML = '';
  Object.values(objects).forEach(elem => {
    if (elem.isDeleted) return;

    const item = document.createElement('div');
    item.id = `canvas-item-${elem.id}`;
    item.className = `canvas-item canvas-item-${elem.type}`;
    item.style.left = `${elem.x}px`;
    item.style.top = `${elem.y}px`;
    if (elem.color && elem.type === 'sticky') item.style.backgroundColor = elem.color;

    const creatorName = elem.createdBy?.name || 'Contributor';
    const modifierName = elem.lastModifiedBy?.name || creatorName;

    item.innerHTML = `
      <div class="canvas-item-header">
        <span>${escapeHtml(creatorName)}</span>
        ${!state.canvasIsArchived ? `<button class="canvas-item-del-btn" title="Delete element" data-id="${elem.id}">&times;</button>` : ''}
      </div>
      <textarea class="canvas-item-body" ${state.canvasIsArchived ? 'readonly' : ''} data-id="${elem.id}">${escapeHtml(elem.content || '')}</textarea>
      <div class="canvas-item-footer">
        v${elem.version || 1} • ${escapeHtml(modifierName)}
      </div>
    `;

    if (!state.canvasIsArchived) {
      makeElementDraggable(item, elem);
    }

    layer.appendChild(item);
  });

  layer.querySelectorAll('.canvas-item-del-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.getAttribute('data-id');
      deleteCanvasItem(id);
    });
  });

  layer.querySelectorAll('.canvas-item-body').forEach(textarea => {
    let inputTimeout;
    textarea.addEventListener('input', () => {
      const id = textarea.getAttribute('data-id');
      const newText = textarea.value;
      clearTimeout(inputTimeout);
      inputTimeout = setTimeout(() => {
        updateCanvasItemContent(id, newText);
      }, 500);
    });
  });
}

function renderCanvasPresence() {
  const container = document.getElementById('canvasPresenceAvatars');
  if (!container) return;

  container.innerHTML = '';
  const participants = state.canvasParticipants || [];
  participants.forEach(p => {
    const pill = document.createElement('div');
    pill.className = 'presence-avatar-pill';
    if (p.role === 'developer') pill.classList.add('dev');
    else if (p.role === 'researcher') pill.classList.add('res');
    else if (p.role === 'designer') pill.classList.add('des');
    else if (p.role === 'producer') pill.classList.add('prod');

    pill.textContent = (p.name || 'U').charAt(0).toUpperCase();
    pill.title = `${p.name} (${p.role})`;
    container.appendChild(pill);
  });
}

function handleCanvasInit(data) {
  state.canvasState = data.canvasState || { objects: {}, tombstones: {}, metadata: {} };
  state.canvasParticipants = data.participants || [];
  state.canvasIsArchived = data.isArchived || false;

  renderCanvasPresence();
  renderCanvasElements();
}

function handleCanvasUserJoined(data) {
  if (data.participants) {
    state.canvasParticipants = data.participants;
    renderCanvasPresence();
  }
  if (data.user) {
    addTickerItem(`🎨 ${data.user.name} (${data.user.role}) joined the Co-working Canvas`);
  }
}

function handleCanvasUserLeft(data) {
  if (data.participants) {
    state.canvasParticipants = data.participants;
    renderCanvasPresence();
  }
  if (data.user) {
    const cursor = document.getElementById(`peer-cursor-${data.user.id}`);
    if (cursor && cursor.parentNode) {
      cursor.parentNode.removeChild(cursor);
    }
    addTickerItem(`🎨 ${data.user.name} left the Co-working Canvas`);
  }
}

function handleCanvasCursorMove(data) {
  if (!state.canvasProjectId) return;
  const { userId, name, role, x, y } = data;
  if (userId === state.user?.id) return;

  const layer = document.getElementById('canvasCursorsLayer');
  if (!layer) return;

  let cursorEl = document.getElementById(`peer-cursor-${userId}`);
  if (!cursorEl) {
    cursorEl = document.createElement('div');
    cursorEl.id = `peer-cursor-${userId}`;
    cursorEl.className = 'live-cursor';

    let roleColor = '#10b981';
    if (role === 'researcher') roleColor = '#06b6d4';
    else if (role === 'designer') roleColor = '#f43f5e';
    else if (role === 'producer') roleColor = '#8b5cf6';

    cursorEl.innerHTML = `
      <svg class="live-cursor-pointer" viewBox="0 0 24 24" fill="${roleColor}">
        <path d="M4 0l16 12-7 2-4 10z"/>
      </svg>
      <span class="live-cursor-label" style="background: ${roleColor};">${escapeHtml(name)} (${escapeHtml(role)})</span>
    `;
    layer.appendChild(cursorEl);
  }

  cursorEl.style.left = `${x}px`;
  cursorEl.style.top = `${y}px`;
}

function handleCanvasObjectUpdate(data) {
  if (!state.canvasProjectId || !data.element) return;
  const elem = data.element;
  state.canvasState.objects[elem.id] = elem;
  renderCanvasElements();
}

function handleCanvasObjectDelete(data) {
  if (!state.canvasProjectId || !data.objectId) return;
  delete state.canvasState.objects[data.objectId];
  renderCanvasElements();
}

// ===================================================================
// STEP 12: MEETING INTEGRATION FUNCTIONS
// ===================================================================

async function fetchMeetingsList() {
  const container = document.getElementById('meetingsListContainer');
  if (!container) return;

  try {
    container.innerHTML = '<div style="text-align: center; padding: 20px; color: #94a3b8;">Loading meetings...</div>';
    const data = await apiFetch('/api/meetings');
    const meetings = data?.meetings || [];

    if (meetings.length === 0) {
      container.innerHTML = '<div style="text-align: center; padding: 20px; color: #94a3b8;">No meetings found.</div>';
      return;
    }

    container.innerHTML = meetings.map(m => {
      const isLive = m.status === 'LIVE';
      const isScheduled = m.status === 'SCHEDULED';
      const isEnded = m.status === 'ENDED';
      const isCancelled = m.status === 'CANCELLED';

      let statusBadge = `<span class="badge ${isLive ? 'badge-green' : isScheduled ? 'badge-amber' : 'badge-outline'}">${m.status}</span>`;
      let actionButtons = '';

      if (isLive) {
        actionButtons += `<button class="btn btn-green btn-xs" onclick="joinMeetingRoom('${m.id}')">Join Live Room</button>`;
      } else if (isScheduled && state.user?.role === 'admin') {
        actionButtons += `<button class="btn btn-primary btn-xs" onclick="startMeetingFromUI('${m.id}')">Start Meeting</button>`;
      }

      if (m.has_confirmed_notes > 0) {
        actionButtons += `<button class="btn btn-secondary btn-xs" onclick="openMeetingNotes('${m.id}')">📝 View Notes</button>`;
      }

      return `
        <div style="background: rgba(0,0,0,0.25); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; padding: 14px; display: flex; justify-content: space-between; align-items: center;">
          <div>
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
              <strong style="color: #fff; font-size: 14px;">${escapeHtml(m.title)}</strong>
              ${statusBadge}
              <span class="badge" style="background: rgba(59,130,246,0.15); color: #60a5fa; border: 1px solid rgba(59,130,246,0.3); font-size: 10px;">${escapeHtml(m.meeting_type)}</span>
              ${m.recording_enabled ? '<span style="font-size: 11px;" title="Recording Enabled">🔴 Rec</span>' : ''}
            </div>
            <div style="font-size: 12px; color: #94a3b8;">
              Host: ${escapeHtml(m.host_name || 'Admin')} • Scheduled: ${m.scheduled_at ? new Date(m.scheduled_at).toLocaleString() : 'Now'} • ${m.attendee_count || 0} attended
            </div>
          </div>
          <div style="display: flex; gap: 6px;">
            ${actionButtons}
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    console.error('Failed to fetch meetings list:', err);
    container.innerHTML = '<div style="color: #ef4444; padding: 12px;">Failed to load meetings.</div>';
  }
}

async function loadJitsiScript(jitsiDomain) {
  if (window.JitsiMeetExternalAPI) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const existing = document.getElementById('jitsiExternalApiScript');
    if (existing) {
      existing.onload = resolve;
      existing.onerror = reject;
      return;
    }
    const script = document.createElement('script');
    script.id = 'jitsiExternalApiScript';
    script.src = `https://${jitsiDomain}/external_api.js`;
    script.onload = () => {
      console.log('[Jitsi] External API library loaded.');
      resolve();
    };
    script.onerror = (e) => {
      console.error('[Jitsi] Failed to load external API script:', e);
      reject(e);
    };
    document.head.appendChild(script);
  });
}

async function joinMeetingRoom(meetingId) {
  try {
    const res = await apiFetch(`/api/meetings/${meetingId}/join`, { method: 'POST' });
    if (!res || !res.meeting) {
      alert(`Could not join meeting: ${res?.error || 'Error'}`);
      return;
    }

    const m = res.meeting;
    state.activeMeetingId = m.id;

    // Close meetings list modal if open
    document.getElementById('meetingsListModalBackdrop').style.display = 'none';
    document.getElementById('liveMeetingBanner').style.display = 'none';

    // Populate Meeting Room UI
    document.getElementById('meetingRoomTitle').textContent = m.title;
    document.getElementById('meetingTypeBadge').textContent = m.meeting_type;
    document.getElementById('meetingHostName').textContent = `Host: ${escapeHtml(m.host_name || 'Admin')}`;

    // Admin Controls
    const endBtn = document.getElementById('btnEndMeetingForAll');
    if (endBtn) {
      endBtn.style.display = (state.user?.role === 'admin') ? 'inline-block' : 'none';
    }

    // Split-Screen Voting Panel
    const jitsiPane = document.getElementById('meetingJitsiPane');
    const votingPane = document.getElementById('meetingVotingPane');

    if (m.split_screen && m.linked_idea_id) {
      jitsiPane.classList.add('split');
      votingPane.style.display = 'flex';
      renderSplitIdeaPanel(m.linked_idea_id);
    } else {
      jitsiPane.classList.remove('split');
      votingPane.style.display = 'none';
    }

    // Show Meeting Room Modal Backdrop
    document.getElementById('meetingRoomModalBackdrop').style.display = 'flex';

    // Start Live Timer
    let seconds = 0;
    clearInterval(state.meetingLiveTimerInterval);
    state.meetingLiveTimerInterval = setInterval(() => {
      seconds++;
      const m = Math.floor(seconds / 60).toString().padStart(2, '0');
      const s = (seconds % 60).toString().padStart(2, '0');
      document.getElementById('meetingLiveTimer').textContent = `${m}:${s}`;
    }, 1000);

    // Mount Jitsi IFrame API
    await loadJitsiScript(m.jitsi_domain);
    const container = document.getElementById('jitsiMeetingContainer');
    container.innerHTML = '';

    const options = {
      roomName: m.jitsi_room_name,
      parentNode: container,
      userInfo: {
        displayName: state.user?.name || 'Mahi Tech Member',
        email: state.user?.email || 'member@mahitechgroup.com'
      },
      configOverwrite: {
        prejoinPageEnabled: false,
        startWithAudioMuted: false,
        startWithVideoMuted: false
      },
      interfaceConfigOverwrite: {
        TOOLBAR_BUTTONS: [
          'microphone', 'camera', 'desktop', 'chat', 'raisehand',
          'tileview', 'settings', 'hangup'
        ]
      }
    };

    if (window.JitsiMeetExternalAPI) {
      state.activeJitsiApi = new window.JitsiMeetExternalAPI(m.jitsi_domain, options);
      if (m.jitsi_password) {
        state.activeJitsiApi.addEventListener('videoConferenceJoined', () => {
          state.activeJitsiApi.executeCommand('password', m.jitsi_password);
        });
      }
      state.activeJitsiApi.addEventListener('readyToClose', () => {
        leaveCurrentMeeting();
      });
    }
  } catch (err) {
    console.error('Error joining meeting room:', err);
    alert('Failed to enter meeting room.');
  }
}

async function renderSplitIdeaPanel(ideaId) {
  try {
    const data = await apiFetch(`/api/ideas/${ideaId}`);
    if (!data || !data.idea) return;
    const idea = data.idea;

    document.getElementById('splitVoteIdeaTitle').textContent = idea.title;
    document.getElementById('splitVoteIdeaDesc').textContent = idea.description || '';
    document.getElementById('splitVoteIdeaOwner').textContent = idea.owner_name || 'Member';
    document.getElementById('splitVoteDeadline').textContent = idea.voting_deadline ? new Date(idea.voting_deadline).toLocaleString() : 'Open';
    document.getElementById('splitVoteStatusMsg').style.display = 'none';

    // Store active idea id on the split panel
    document.getElementById('meetingVotingPane').dataset.activeIdeaId = ideaId;
  } catch (err) {
    console.error('Failed to load linked idea for split screen:', err);
  }
}

async function submitSplitVote(color) {
  const ideaId = document.getElementById('meetingVotingPane').dataset.activeIdeaId;
  const comment = document.getElementById('splitVoteComment').value.trim();
  const statusMsg = document.getElementById('splitVoteStatusMsg');

  if (!ideaId) return;

  try {
    const res = await apiFetch(`/api/ideas/${ideaId}/vote`, {
      method: 'POST',
      body: JSON.stringify({ vote_color: color, comment })
    });

    if (res && res.success) {
      statusMsg.style.display = 'block';
      statusMsg.style.color = color === 'green' ? '#4ade80' : '#f87171';
      statusMsg.textContent = `✓ Vote ${color.toUpperCase()} recorded successfully!`;
      addTickerItem(`Voted ${color.toUpperCase()} on "${document.getElementById('splitVoteIdeaTitle').textContent}"`);
      await fetchSummary();
      await fetchVotesFeed();
    } else {
      statusMsg.style.display = 'block';
      statusMsg.style.color = '#ef4444';
      statusMsg.textContent = `Vote failed: ${res?.error || 'Error'}`;
    }
  } catch (err) {
    console.error('Failed to submit vote in split screen:', err);
  }
}

async function leaveCurrentMeeting() {
  if (state.activeJitsiApi) {
    try { state.activeJitsiApi.dispose(); } catch (e) {}
    state.activeJitsiApi = null;
  }
  clearInterval(state.meetingLiveTimerInterval);
  document.getElementById('meetingRoomModalBackdrop').style.display = 'none';

  if (state.activeMeetingId) {
    try {
      await apiFetch(`/api/meetings/${state.activeMeetingId}/leave`, { method: 'POST' });
    } catch (e) {}
    state.activeMeetingId = null;
  }
}

async function endCurrentMeeting() {
  if (!confirm('Are you sure you want to end this meeting for all participants?')) return;

  if (state.activeMeetingId) {
    try {
      const res = await apiFetch(`/api/meetings/${state.activeMeetingId}/end`, { method: 'PATCH' });
      if (res && res.message) {
        addTickerItem(`Meeting ended by Host`);
      }
    } catch (e) {
      console.error('Failed to end meeting:', e);
    }
  }

  leaveCurrentMeeting();
}

async function startMeetingFromUI(meetingId) {
  try {
    const res = await apiFetch(`/api/meetings/${meetingId}/start`, { method: 'PATCH' });
    if (res && res.meeting) {
      addTickerItem(`Meeting "${res.meeting.title}" is now LIVE`);
      fetchMeetingsList();
      joinMeetingRoom(meetingId);
    } else {
      alert(`Failed to start meeting: ${res?.error || 'Error'}`);
    }
  } catch (err) {
    console.error('Error starting meeting:', err);
  }
}

async function openMeetingNotes(meetingId) {
  try {
    const data = await apiFetch(`/api/meetings/${meetingId}/notes`);
    if (!data || !data.notes) {
      alert('Meeting notes are not confirmed yet or you were not an attendee.');
      return;
    }

    state.currentNotesMeetingId = meetingId;
    state.currentNotesData = data.notes;

    document.getElementById('notesMeetingTitle').textContent = `Meeting ID: ${meetingId.slice(0, 8)}...`;
    document.getElementById('notesMetaModel').textContent = `Model: ${data.notes.ai_model_used || 'OpenAI Whisper + GPT-4o'}`;
    document.getElementById('notesMetaConfirmed').textContent = data.notes.confirmed_at ? `✓ Confirmed ${new Date(data.notes.confirmed_at).toLocaleString()}` : 'Draft';

    switchNotesLang('en');
    document.getElementById('meetingNotesModalBackdrop').style.display = 'flex';
  } catch (err) {
    console.error('Error fetching notes:', err);
    alert('Notes not available or access restricted.');
  }
}

function switchNotesLang(lang) {
  const display = document.getElementById('notesContentDisplay');
  const btnEn = document.getElementById('btnNotesLangEn');
  const btnHi = document.getElementById('btnNotesLangHi');
  const btnRaw = document.getElementById('btnNotesLangRaw');

  btnEn.classList.toggle('active', lang === 'en');
  btnHi.classList.toggle('active', lang === 'hi');
  btnRaw.classList.toggle('active', lang === 'raw');

  if (!state.currentNotesData) return;

  if (lang === 'en') {
    display.textContent = state.currentNotesData.notes_english || 'No English notes generated.';
  } else if (lang === 'hi') {
    display.textContent = state.currentNotesData.notes_hindi || 'कोई हिंदी नोट्स उत्पन्न नहीं हुए।';
  } else if (lang === 'raw') {
    display.textContent = state.currentNotesData.transcript_raw || 'No raw transcript recorded.';
  }
}

// WebSocket Event Handlers for Meetings
function handleMeetingScheduled(data) {
  addTickerItem(`📅 New Meeting Scheduled: "${data.title}"`);
  fetchMeetingsList();
}

function handleMeetingStarted(data) {
  state.currentLiveMeeting = data;
  const banner = document.getElementById('liveMeetingBanner');
  const text = document.getElementById('liveMeetingBannerText');
  if (banner && text) {
    text.textContent = `"${data.title}" is now LIVE — Join now`;
    banner.style.display = 'flex';
  }
  addTickerItem(`🔴 Live Meeting: "${data.title}" has started`);
  fetchMeetingsList();
}

function handleMeetingUserJoined(data) {
  if (state.activeMeetingId === data.meeting_id) {
    const pill = document.getElementById('meetingAttendeeCountPill');
    if (pill) {
      addTickerItem(`👤 ${data.user_name} joined the meeting`);
    }
  }
}

function handleMeetingUserLeft(data) {
  if (state.activeMeetingId === data.meeting_id) {
    addTickerItem(`User left the meeting`);
  }
}

function handleMeetingEnded(data) {
  const banner = document.getElementById('liveMeetingBanner');
  if (banner) banner.style.display = 'none';

  if (state.activeMeetingId === data.meeting_id) {
    alert('The meeting has been ended by the Host.');
    leaveCurrentMeeting();
  }
  fetchMeetingsList();
}

function handleMeetingNotesReady(data) {
  addTickerItem(`📝 AI Meeting Notes published for "${data.title || 'Meeting'}"`);
  fetchMeetingsList();
}

window.openCoworkingRoom = openCoworkingRoom;
window.joinMeetingRoom = joinMeetingRoom;
window.startMeetingFromUI = startMeetingFromUI;
window.openMeetingNotes = openMeetingNotes;


