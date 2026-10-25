/**
 * MAHI TECH GROUP — SUPER ADMIN PANEL CONTROLLER (STEP 14)
 * Elevated Privilege Layer (Deep Indigo Theme)
 */

// 1. Immediate Synchronous Role Guard (Step 14 Spec)
const currentUser = JSON.parse(localStorage.getItem('user') || '{}');
const authToken = localStorage.getItem('token');

if (!authToken) {
  window.location.replace('/login.html');
} else if (!currentUser || currentUser.role !== 'admin') {
  alert('Access Denied — Insufficient Privileges');
  window.location.href = '/';
}

// 2. Formatting Utility: formatINR (reused from dashboard.js)
function formatINR(val) {
  const num = Number(val) || 0;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2
  }).format(num);
}

// 3. FIFO Toast Notification Manager (reused from dashboard.js)
class ToastManager {
  constructor() {
    this.container = document.getElementById('toastContainer');
    this.queue = [];
    this.activeToasts = [];
    this.maxVisible = 3;
    this.autoDismissMs = 4000;
  }

  show(message, type = 'info') {
    if (this.activeToasts.length >= this.maxVisible) {
      this.queue.push({ message, type });
      return;
    }

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
      <span>${message}</span>
      <button style="background:none;border:none;color:#94a3b8;cursor:pointer;font-size:16px;">&times;</button>
    `;

    toast.querySelector('button').onclick = () => this.dismiss(toast);

    this.container.appendChild(toast);
    this.activeToasts.push(toast);

    const timer = setTimeout(() => {
      this.dismiss(toast);
    }, this.autoDismissMs);

    toast._dismissTimer = timer;
  }

  dismiss(toast) {
    if (toast._isDismissing) return;
    toast._isDismissing = true;
    clearTimeout(toast._dismissTimer);

    toast.classList.add('toast-slide-out');
    setTimeout(() => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
      this.activeToasts = this.activeToasts.filter(t => t !== toast);
      if (this.queue.length > 0) {
        const next = this.queue.shift();
        this.show(next.message, next.type);
      }
    }, 300);
  }
}

const toasts = new ToastManager();

// 4. API Request Helper
async function apiCall(endpoint, method = 'GET', body = null) {
  const headers = {
    'Authorization': `Bearer ${authToken}`
  };
  if (body) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(endpoint, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });

  // Stale/expired session: clear credentials and send to login instead of
  // leaving the panel full of failed requests
  if (res.status === 401) {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.location.replace('/login.html');
    return { ok: false, status: 401, data: { error: 'Session expired — sign in again' } };
  }

  if (res.status === 401 || res.status === 403) {
    if (res.status === 403) {
      toasts.show('Access Forbidden: Admin privileges required', 'error');
    }
  }

  const data = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, data };
}

// 5. Sidebar Navigation Switching
function initNavigation() {
  const navItems = document.querySelectorAll('.sa-nav-item');
  const panes = document.querySelectorAll('.sa-pane');

  navItems.forEach(item => {
    item.addEventListener('click', () => {
      const targetPaneId = item.getAttribute('data-pane');
      if (!targetPaneId) return;

      navItems.forEach(n => n.classList.remove('active'));
      panes.forEach(p => p.classList.remove('active'));

      item.classList.add('active');
      const targetPane = document.getElementById(targetPaneId);
      if (targetPane) {
        targetPane.classList.add('active');
      }

      // Contextual refresh on pane activation
      if (targetPaneId === 'paneOverview') {
        loadOverviewMetrics();
      } else if (targetPaneId === 'paneDirectory' || targetPaneId === 'paneMembers') {
        loadMembersDirectory();
      } else if (targetPaneId === 'panePerformance') {
        loadPerformanceIntelligence();
      } else if (targetPaneId === 'paneTickets') {
        loadTickets();
      } else if (targetPaneId === 'paneIdeation') {
        loadIdeationCommand();
        loadQuotaConfig();
      } else if (targetPaneId === 'paneDisputes') {
        loadDisputes();
      } else if (targetPaneId === 'paneGateway') {
        loadGatewayConfig();
      } else if (targetPaneId === 'paneGovernance') {
        loadGovernanceMembers();
      }
    });
  });
}

// 6. Command Center Overview Controller (Section 1)
async function loadOverviewMetrics() {
  const btnRefresh = document.getElementById('btnRefreshOverview');
  if (btnRefresh) {
    btnRefresh.classList.add('loading');
  }

  try {
    const res = await apiCall('/api/superadmin/overview');
    if (!res.ok) {
      toasts.show('Failed to load Command Center overview metrics', 'error');
      return;
    }

    const d = res.data;

    // Populate Overview Metric Cards
    setVal('statActiveMembers', d.total_active_members);
    setVal('statPendingApps', d.pending_applications);
    setVal('statOpenTickets', d.open_tickets);
    setVal('statActiveProjects', d.active_projects);
    setVal('statRevMonth', formatINR(d.revenue_this_month));
    setVal('statPendingPayouts', d.pending_payouts);
    setVal('statPendingPayoutsTotal', formatINR(d.pending_payouts_total));
    setVal('statOpenDisputes', d.open_disputes);
    setVal('statTotalUsers', d.db_total_users);

    const timeEl = document.getElementById('overviewLastUpdated');
    if (timeEl) {
      timeEl.textContent = `Last refreshed: ${new Date().toLocaleTimeString()}`;
    }

  } catch (err) {
    console.error('Error loading overview metrics:', err);
    toasts.show('Network error while refreshing metrics', 'error');
  } finally {
    if (btnRefresh) {
      btnRefresh.classList.remove('loading');
    }
  }
}

function setVal(elementId, val) {
  const el = document.getElementById(elementId);
  if (el) {
    el.textContent = val !== undefined && val !== null ? val : '0';
  }
}

// ==========================================================================
// 7. SECTION 2: MEMBER DIRECTORY CONTROLLER
// ==========================================================================

let directoryDebounceTimer = null;
let currentSelectedUserId = null;

async function loadMembersDirectory() {
  const tableBody = document.getElementById('membersTableBody');
  if (!tableBody) return;

  const search = document.getElementById('dirSearchInput')?.value.trim() || '';
  const role = document.getElementById('dirRoleFilter')?.value || '';
  const status = document.getElementById('dirStatusFilter')?.value || '';
  const sortBy = document.getElementById('dirSortFilter')?.value || 'created_at';
  const order = document.getElementById('dirOrderFilter')?.value || 'desc';

  tableBody.innerHTML = `<tr><td colspan="8" class="sa-loading-cell">Loading members directory...</td></tr>`;

  try {
    const query = new URLSearchParams({ search, role, status, sort_by: sortBy, order });
    const res = await apiCall(`/api/superadmin/members?${query.toString()}`);

    if (!res.ok) {
      tableBody.innerHTML = `<tr><td colspan="8" class="sa-loading-cell" style="color:var(--sa-danger)">Failed to load directory.</td></tr>`;
      toasts.show('Error fetching member directory', 'error');
      return;
    }

    const members = res.data || [];
    const countEl = document.getElementById('dirTotalCount');
    if (countEl) countEl.textContent = `${members.length} members loaded`;

    if (members.length === 0) {
      tableBody.innerHTML = `<tr><td colspan="8" class="sa-loading-cell">No members matched the criteria.</td></tr>`;
      return;
    }

    tableBody.innerHTML = members.map(m => {
      const initial = (m.name || 'U').charAt(0).toUpperCase();
      const statusClass = (m.status || 'inactive').toLowerCase();
      const formattedEarnings = formatINR(m.total_earnings || 0);
      const activeStr = m.last_active_at ? new Date(m.last_active_at).toLocaleDateString() : 'Never';

      return `
        <tr data-user-id="${m.id}" onclick="openMemberDrawer('${m.id}')">
          <td>
            <div class="sa-user-cell">
              <div class="sa-avatar-sm">${initial}</div>
              <div class="sa-user-meta">
                <span class="sa-user-name">${escapeHtml(m.name || 'Unknown')}</span>
                <span class="sa-user-email">${escapeHtml(m.email || '')}</span>
              </div>
            </div>
          </td>
          <td>
            <span class="sa-badge-role">${escapeHtml(m.role || 'member')}</span>
            ${m.sub_role ? `<div style="font-size:11px;color:var(--sa-text-muted);margin-top:2px;">${escapeHtml(m.sub_role)}</div>` : ''}
          </td>
          <td>
            <span class="sa-badge-status ${statusClass}">
              <span style="width:6px;height:6px;border-radius:50%;background:currentColor;display:inline-block;"></span>
              ${escapeHtml(m.status || 'unknown')}
            </span>
          </td>
          <td style="text-align:center;font-weight:600;">${m.ideas_count || 0}</td>
          <td style="text-align:center;font-weight:600;">${m.projects_count || 0}</td>
          <td style="font-weight:600;color:var(--sa-success);">${formattedEarnings}</td>
          <td style="text-align:center;">${m.meetings_attended || 0}</td>
          <td style="font-size:12px;color:var(--sa-text-muted);">${activeStr}</td>
        </tr>
      `;
    }).join('');

  } catch (err) {
    console.error('Error fetching members:', err);
    tableBody.innerHTML = `<tr><td colspan="8" class="sa-loading-cell" style="color:var(--sa-danger)">Network error loading members directory.</td></tr>`;
  }
}

async function exportMembersCSV() {
  try {
    toasts.show('Preparing member directory CSV export...', 'info');
    const response = await fetch('/api/superadmin/members/export', {
      headers: {
        'Authorization': `Bearer ${authToken}`
      }
    });

    if (!response.ok) {
      toasts.show('Export failed: Access Forbidden or Server Error', 'error');
      return;
    }

    const csvBlob = await response.blob();
    const downloadUrl = URL.createObjectURL(csvBlob);
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = `members-directory-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(downloadUrl);

    toasts.show('Directory exported successfully (CSV)', 'success');
  } catch (err) {
    console.error('Error downloading CSV:', err);
    toasts.show('Network error while exporting CSV', 'error');
  }
}

// Drawer Controller
async function openMemberDrawer(userId) {
  currentSelectedUserId = userId;
  const overlay = document.getElementById('drawerOverlay');
  const drawer = document.getElementById('memberDrawer');

  if (overlay && drawer) {
    overlay.classList.add('active');
    drawer.classList.add('open');
    drawer.setAttribute('aria-hidden', 'false');
  }

  // Set loading state in drawer tabs
  document.getElementById('drawerUserName').textContent = 'Loading...';
  document.getElementById('drawerUserEmail').textContent = '';
  document.getElementById('drawerIdeasBody').innerHTML = `<tr><td colspan="4" class="sa-loading-cell">Loading ideas...</td></tr>`;
  document.getElementById('drawerProjectsBody').innerHTML = `<tr><td colspan="4" class="sa-loading-cell">Loading projects...</td></tr>`;
  document.getElementById('drawerEarningsBody').innerHTML = `<tr><td colspan="4" class="sa-loading-cell">Loading earnings...</td></tr>`;
  document.getElementById('drawerAccessBody').innerHTML = `<tr><td colspan="3" class="sa-loading-cell">Loading access history...</td></tr>`;

  try {
    const res = await apiCall(`/api/superadmin/members/${userId}`);
    if (!res.ok) {
      toasts.show('Failed to fetch member details', 'error');
      return;
    }

    const m = res.data;
    document.getElementById('drawerUserName').textContent = m.name || 'Unknown User';
    document.getElementById('drawerUserEmail').textContent = m.email || '';
    document.getElementById('drawerAvatar').textContent = (m.name || 'U').charAt(0).toUpperCase();

    // Populate Tab 1: Ideas History
    const ideasBody = document.getElementById('drawerIdeasBody');
    if (m.ideas_history && m.ideas_history.length > 0) {
      ideasBody.innerHTML = m.ideas_history.map(idea => `
        <tr>
          <td>#${idea.id}</td>
          <td style="font-weight:500;">${escapeHtml(idea.title || '')}</td>
          <td><span class="sa-badge-status ${idea.status}">${escapeHtml(idea.status || '')}</span></td>
          <td style="font-size:11.5px;color:var(--sa-text-muted);">${new Date(idea.created_at).toLocaleDateString()}</td>
        </tr>
      `).join('');
    } else {
      ideasBody.innerHTML = `<tr><td colspan="4" class="sa-loading-cell">No submitted ideas found.</td></tr>`;
    }

    // Populate Tab 2: Projects & Tasks
    const projBody = document.getElementById('drawerProjectsBody');
    if (m.projects_history && m.projects_history.length > 0) {
      projBody.innerHTML = m.projects_history.map(proj => `
        <tr>
          <td style="font-weight:600;">${escapeHtml(proj.project_title || 'Untitled Project')}</td>
          <td><span class="sa-badge-role">${escapeHtml(proj.role_in_project || 'member')}</span></td>
          <td style="text-align:center;">${proj.tasks_assigned || 0}</td>
          <td style="text-align:center;font-weight:600;color:var(--sa-success);">${proj.tasks_completed || 0}</td>
        </tr>
      `).join('');
    } else {
      projBody.innerHTML = `<tr><td colspan="4" class="sa-loading-cell">No assigned projects found.</td></tr>`;
    }

    // Populate Tab 3: Earnings Ledger
    const earnBody = document.getElementById('drawerEarningsBody');
    if (m.earnings_ledger && m.earnings_ledger.length > 0) {
      earnBody.innerHTML = m.earnings_ledger.map(split => `
        <tr>
          <td style="font-size:11.5px;color:var(--sa-text-muted);">${new Date(split.created_at).toLocaleDateString()}</td>
          <td>Event #${split.revenue_event_id}</td>
          <td style="font-weight:600;color:var(--sa-success);">${formatINR(split.amount)}</td>
          <td><span class="sa-badge-status ${split.status}">${escapeHtml(split.status || 'paid')}</span></td>
        </tr>
      `).join('');
    } else {
      earnBody.innerHTML = `<tr><td colspan="4" class="sa-loading-cell">No earnings records found.</td></tr>`;
    }

    // Populate Tab 4: Access History
    const accessBody = document.getElementById('drawerAccessBody');
    if (m.access_log_recent && m.access_log_recent.length > 0) {
      accessBody.innerHTML = m.access_log_recent.map(log => `
        <tr>
          <td style="font-size:11.5px;color:var(--sa-text-muted);">${new Date(log.created_at || log.timestamp).toLocaleString()}</td>
          <td style="font-weight:500;">${escapeHtml(log.action || '')}</td>
          <td style="font-family:monospace;font-size:11.5px;color:var(--sa-text-dim);">${escapeHtml(log.ip_address || '—')}</td>
        </tr>
      `).join('');
    } else {
      accessBody.innerHTML = `<tr><td colspan="3" class="sa-loading-cell">No recent access log entries.</td></tr>`;
    }

  } catch (err) {
    console.error('Error fetching member drawer details:', err);
    toasts.show('Network error loading member details', 'error');
  }
}

function closeMemberDrawer() {
  const overlay = document.getElementById('drawerOverlay');
  const drawer = document.getElementById('memberDrawer');
  if (overlay && drawer) {
    overlay.classList.remove('active');
    drawer.classList.remove('open');
    drawer.setAttribute('aria-hidden', 'true');
  }
}

// ==========================================================================
// 8. SECTION 3: PERFORMANCE INTELLIGENCE CONTROLLER
// ==========================================================================

async function loadPerformanceIntelligence() {
  await loadPerformanceWeights();
  await loadLeaderboard();
}

async function loadLeaderboard() {
  const tableBody = document.getElementById('leaderboardTableBody');
  if (!tableBody) return;

  tableBody.innerHTML = `<tr><td colspan="6" class="sa-loading-cell">Calculating stealth performance leaderboard...</td></tr>`;

  try {
    const res = await apiCall('/api/superadmin/performance/leaderboard');
    if (!res.ok) {
      tableBody.innerHTML = `<tr><td colspan="6" class="sa-loading-cell" style="color:var(--sa-danger)">Failed to load leaderboard.</td></tr>`;
      toasts.show('Error loading leaderboard data', 'error');
      return;
    }

    const leaders = res.data || [];
    if (leaders.length === 0) {
      tableBody.innerHTML = `<tr><td colspan="6" class="sa-loading-cell">No active members found for scoring.</td></tr>`;
      return;
    }

    tableBody.innerHTML = leaders.map((m, idx) => {
      const rank = idx + 1;
      const rankBadgeClass = rank <= 3 ? `rank-${rank}` : '';
      const scorePct = (Number(m.composite_score || 0) * 100).toFixed(1) + '%';
      const trend = m.trend || 'stable';
      const trendSymbol = trend === 'improving' ? '↑ Improving' : (trend === 'declining' ? '↓ Declining' : '→ Stable');

      return `
        <tr data-user-id="${m.id}" onclick="inspectMemberPerformance('${m.id}')">
          <td style="text-align:center;"><span class="sa-leaderboard-rank ${rankBadgeClass}">${rank}</span></td>
          <td style="font-weight:600;color:#fff;">${escapeHtml(m.name || 'Unknown')}</td>
          <td><span class="sa-badge-role">${escapeHtml(m.role || 'member')}</span></td>
          <td style="font-weight:700;color:var(--sa-primary-hover);font-family:'Outfit',sans-serif;font-size:15px;">${scorePct}</td>
          <td><span class="sa-trend-pill trend-${trend}">${trendSymbol}</span></td>
          <td><button class="sa-btn-xs" onclick="event.stopPropagation(); inspectMemberPerformance('${m.id}')">Inspect</button></td>
        </tr>
      `;
    }).join('');

    // Automatically inspect the top member if available
    if (leaders.length > 0) {
      inspectMemberPerformance(leaders[0].id);
    }

  } catch (err) {
    console.error('Error fetching leaderboard:', err);
    tableBody.innerHTML = `<tr><td colspan="6" class="sa-loading-cell" style="color:var(--sa-danger)">Network error loading leaderboard.</td></tr>`;
  }
}

async function inspectMemberPerformance(userId) {
  const detailTitle = document.getElementById('perfDetailTitle');
  if (detailTitle) detailTitle.textContent = 'Inspecting performance metrics...';

  try {
    const res = await apiCall(`/api/superadmin/performance/${userId}`);
    if (!res.ok) {
      toasts.show('Failed to fetch detailed performance', 'error');
      return;
    }

    const p = res.data;
    if (detailTitle) {
      const scorePct = (Number(p.composite_score || 0) * 100).toFixed(1);
      detailTitle.textContent = `${p.name || 'Member'} — Composite Score: ${scorePct}% (${p.trend})`;
    }

    // Populate KPI subgrid
    setVal('kpiIdeasSub', p.ideas_submitted);
    setVal('kpiIdeasApp', p.ideas_approved);
    setVal('kpiIdeasRej', p.ideas_rejected);
    setVal('kpiIdeasRate', `${p.idea_approval_rate || 0}%`);

    setVal('kpiTasksAssigned', p.tasks_assigned);
    setVal('kpiTasksComp', p.tasks_completed);
    setVal('kpiTasksOverdue', p.tasks_overdue);
    setVal('kpiTasksRate', `${p.task_completion_rate || 0}%`);

    setVal('kpiAvgDays', p.avg_task_completion_days !== null ? `${p.avg_task_completion_days}d` : 'N/A');
    setVal('kpiVotingRate', `${p.voting_participation_rate || 0}%`);
    setVal('kpiMeetingRate', `${p.meeting_attendance_rate || 0}%`);
    setVal('kpiCoworking', p.coworking_sessions_count || 0);

    setVal('kpiRevGen', formatINR(p.revenue_generated || 0));
    setVal('kpiRevEarned', formatINR(p.revenue_earned || 0));

    // Render CSS Bar Chart (last 6 months)
    renderMonthlyBarChart(p.monthly_breakdown || []);

    // Render Activity Heatmap
    renderActivityHeatmap(p.monthly_breakdown || []);

  } catch (err) {
    console.error('Error fetching member performance detail:', err);
    toasts.show('Network error while loading member performance', 'error');
  }
}

function renderMonthlyBarChart(months) {
  const container = document.getElementById('perfBarChart');
  if (!container) return;

  if (!months || months.length === 0) {
    container.innerHTML = `<div style="margin:auto;color:var(--sa-text-muted);font-size:13px;">No historical monthly data recorded.</div>`;
    return;
  }

  // Find max value across all months for proportional height scaling
  let maxVal = 1;
  months.forEach(m => {
    if (m.tasks_completed > maxVal) maxVal = m.tasks_completed;
    if (m.ideas_submitted > maxVal) maxVal = m.ideas_submitted;
    if (m.votes_cast > maxVal) maxVal = m.votes_cast;
  });

  const maxHeightPx = 110;

  container.innerHTML = months.map(m => {
    const tHeight = Math.max(3, Math.round((m.tasks_completed / maxVal) * maxHeightPx));
    const iHeight = Math.max(3, Math.round((m.ideas_submitted / maxVal) * maxHeightPx));
    const vHeight = Math.max(3, Math.round((m.votes_cast / maxVal) * maxHeightPx));

    return `
      <div class="sa-barchart-col">
        <div class="sa-barchart-bars">
          <div class="sa-bar bar-tasks" style="height:${tHeight}px;" title="Tasks Completed: ${m.tasks_completed}"></div>
          <div class="sa-bar bar-ideas" style="height:${iHeight}px;" title="Ideas Submitted: ${m.ideas_submitted}"></div>
          <div class="sa-bar bar-votes" style="height:${vHeight}px;" title="Votes Cast: ${m.votes_cast}"></div>
        </div>
        <span class="sa-barchart-label">${m.month}</span>
      </div>
    `;
  }).join('');
}

function renderActivityHeatmap(months) {
  const grid = document.getElementById('perfHeatmapGrid');
  if (!grid) return;

  // Generate 26 columns x 7 rows (sample activity distribution over 26 weeks)
  const totalWeeks = 26;
  const daysPerWeek = 7;
  let cells = [];

  // Seed intensity loosely mapped from total tasks and votes
  const activitySum = (months || []).reduce((acc, m) => acc + (m.tasks_completed || 0) + (m.votes_cast || 0), 0);

  for (let w = 0; w < totalWeeks; w++) {
    for (let d = 0; d < daysPerWeek; d++) {
      let level = 0;
      if (activitySum > 0) {
        const rand = (w * 7 + d * 13) % 10;
        if (rand > 7) level = 4;
        else if (rand > 5) level = 3;
        else if (rand > 3) level = 2;
        else if (rand > 1) level = 1;
      }
      cells.push(`<div class="sa-heatmap-cell" data-level="${level}" title="Week ${w + 1}, Day ${d + 1}"></div>`);
    }
  }

  grid.innerHTML = cells.join('');
}

async function loadPerformanceWeights() {
  try {
    const res = await apiCall('/api/superadmin/performance/config');
    if (!res.ok) return;

    const cfg = res.data;
    setSliderVal('weightTask', cfg.performance_weight_task);
    setSliderVal('weightIdea', cfg.performance_weight_idea);
    setSliderVal('weightVoting', cfg.performance_weight_voting);
    setSliderVal('weightMeeting', cfg.performance_weight_meeting);
    setSliderVal('weightRevenue', cfg.performance_weight_revenue);

    updateWeightsSumIndicator();
  } catch (err) {
    console.error('Error fetching performance config:', err);
  }
}

function setSliderVal(id, val) {
  const input = document.getElementById(id);
  const label = document.getElementById(`${id}Val`);
  const num = Number(val) || 0;
  if (input) input.value = num;
  if (label) label.textContent = `${Math.round(num * 100)}%`;
}

function updateWeightsSumIndicator() {
  const t = Number(document.getElementById('weightTask')?.value || 0);
  const i = Number(document.getElementById('weightIdea')?.value || 0);
  const v = Number(document.getElementById('weightVoting')?.value || 0);
  const m = Number(document.getElementById('weightMeeting')?.value || 0);
  const r = Number(document.getElementById('weightRevenue')?.value || 0);

  const sum = t + i + v + m + r;
  const sumIndicator = document.getElementById('weightSumDisplay');
  const sumVal = document.getElementById('weightSumVal');
  const saveBtn = document.getElementById('btnSaveWeights');

  const roundedSum = Math.round(sum * 100);
  if (sumVal) sumVal.textContent = `${roundedSum}%`;

  const isValid = Math.abs(sum - 1.0) <= 0.001;

  if (sumIndicator) {
    if (isValid) {
      sumIndicator.className = 'sa-weight-sum-indicator valid';
      sumIndicator.setAttribute('title', 'Weights sum to exactly 100%');
    } else {
      sumIndicator.className = 'sa-weight-sum-indicator invalid';
      sumIndicator.setAttribute('title', 'Weights must total 100% before saving');
    }
  }

  if (saveBtn) {
    saveBtn.disabled = !isValid;
  }
}

async function savePerformanceWeights() {
  const t = Number(document.getElementById('weightTask')?.value || 0);
  const i = Number(document.getElementById('weightIdea')?.value || 0);
  const v = Number(document.getElementById('weightVoting')?.value || 0);
  const m = Number(document.getElementById('weightMeeting')?.value || 0);
  const r = Number(document.getElementById('weightRevenue')?.value || 0);

  const body = {
    performance_weight_task: t,
    performance_weight_idea: i,
    performance_weight_voting: v,
    performance_weight_meeting: m,
    performance_weight_revenue: r
  };

  try {
    toasts.show('Saving performance weight configuration...', 'info');
    const res = await apiCall('/api/superadmin/performance/config', 'PATCH', body);

    if (!res.ok) {
      const msg = res.data?.error || 'Failed to update weight configuration';
      toasts.show(msg, 'error');
      return;
    }

    toasts.show('Performance weights updated. Recalculating scores...', 'success');
    await loadLeaderboard();
  } catch (err) {
    console.error('Error saving weights:', err);
    toasts.show('Network error while saving weights', 'error');
  }
}

// Utility: HTML Escaping
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ==========================================================================
// 9. EVENT LISTENERS SETUP
// ==========================================================================

function initEventListeners() {
  // Directory Search & Filters
  const searchInput = document.getElementById('dirSearchInput');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      clearTimeout(directoryDebounceTimer);
      directoryDebounceTimer = setTimeout(() => {
        loadMembersDirectory();
      }, 300);
    });
  }

  ['dirRoleFilter', 'dirStatusFilter', 'dirSortFilter', 'dirOrderFilter'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('change', () => loadMembersDirectory());
    }
  });

  // Export CSV
  const exportBtn = document.getElementById('btnExportMembers');
  if (exportBtn) {
    exportBtn.addEventListener('click', () => exportMembersCSV());
  }

  // Drawer Close
  const closeBtn = document.getElementById('closeDrawerBtn');
  const overlay = document.getElementById('drawerOverlay');
  if (closeBtn) closeBtn.addEventListener('click', closeMemberDrawer);
  if (overlay) overlay.addEventListener('click', closeMemberDrawer);

  // Drawer Tabs
  const drawerTabs = document.querySelectorAll('.sa-drawer-tabs .sa-tab-btn');
  const drawerTabContents = document.querySelectorAll('.sa-drawer-body .sa-tab-content');

  drawerTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const targetId = tab.getAttribute('data-tab');
      drawerTabs.forEach(t => t.classList.remove('active'));
      drawerTabContents.forEach(c => c.classList.remove('active'));

      tab.classList.add('active');
      const targetContent = document.getElementById(targetId);
      if (targetContent) targetContent.classList.add('active');
    });
  });

  // Drawer Quick Action Buttons
  const editRoleBtn = document.getElementById('drawerEditRoleBtn');
  const openDisputeBtn = document.getElementById('drawerOpenDisputeBtn');
  const blockBtn = document.getElementById('drawerBlockBtn');

  if (openDisputeBtn) {
    openDisputeBtn.addEventListener('click', () => {
      const targetUser = activeDrawerUser;
      closeMemberDrawer();
      document.querySelector('.sa-nav-item[data-pane="paneDisputes"]')?.click();
      openCreateDisputeModal(targetUser?.id);
    });
  }

  if (blockBtn) {
    blockBtn.addEventListener('click', async () => {
      const targetUserId = currentSelectedUserId;
      if (!targetUserId) return;
      closeMemberDrawer();
      document.querySelector('.sa-nav-item[data-pane="paneGovernance"]')?.click();
      await loadGovernanceMembers();
      const sel = document.getElementById('governanceMemberSelect');
      if (sel) sel.value = targetUserId;
      await loadGovernanceHistory(targetUserId);
      blockMemberUI(targetUserId);
    });
  }

  if (editRoleBtn) {
    editRoleBtn.addEventListener('click', () => {
      if (!currentSelectedUserId) return;
      const modal = document.getElementById('roleModalOverlay');
      if (modal) modal.style.display = 'flex';
    });
  }

  // Role Edit Modal
  const cancelRoleBtn = document.getElementById('cancelRoleModalBtn');
  const saveRoleBtn = document.getElementById('saveRoleModalBtn');
  const roleModal = document.getElementById('roleModalOverlay');

  if (cancelRoleBtn) {
    cancelRoleBtn.addEventListener('click', () => {
      if (roleModal) roleModal.style.display = 'none';
    });
  }

  if (saveRoleBtn) {
    saveRoleBtn.addEventListener('click', async () => {
      if (!currentSelectedUserId) return;
      const newRole = document.getElementById('newRoleSelect')?.value;
      const newSubRole = document.getElementById('newSubRoleInput')?.value;

      try {
        const res = await apiCall(`/api/admin/members/${currentSelectedUserId}`, 'PATCH', {
          role: newRole,
          sub_role: newSubRole
        });

        if (!res.ok) {
          toasts.show(res.data?.error || 'Failed to update member role', 'error');
          return;
        }

        toasts.show('Member role updated successfully', 'success');
        if (roleModal) roleModal.style.display = 'none';
        await loadMembersDirectory();
        await openMemberDrawer(currentSelectedUserId);
      } catch (err) {
        console.error('Error updating role:', err);
        toasts.show('Network error while updating role', 'error');
      }
    });
  }

  // Weight Sliders
  ['weightTask', 'weightIdea', 'weightVoting', 'weightMeeting', 'weightRevenue'].forEach(id => {
    const slider = document.getElementById(id);
    if (slider) {
      slider.addEventListener('input', (e) => {
        const label = document.getElementById(`${id}Val`);
        if (label) label.textContent = `${Math.round(e.target.value * 100)}%`;
        updateWeightsSumIndicator();
      });
    }
  });

  const saveWeightsBtn = document.getElementById('btnSaveWeights');
  if (saveWeightsBtn) {
    saveWeightsBtn.addEventListener('click', savePerformanceWeights);
  }

  // --- Layer 3 Event Listeners ---
  // Support Tickets
  const openNewTicketBtn = document.getElementById('btnOpenNewTicketModal');
  const cancelCreateTicketBtn = document.getElementById('btnCancelCreateTicket');
  const submitCreateTicketBtn = document.getElementById('btnSubmitCreateTicket');
  const ticketModal = document.getElementById('createTicketModalOverlay');

  if (openNewTicketBtn) openNewTicketBtn.addEventListener('click', openCreateTicketModal);
  if (cancelCreateTicketBtn) cancelCreateTicketBtn.addEventListener('click', () => {
    if (ticketModal) ticketModal.style.display = 'none';
  });
  if (submitCreateTicketBtn) submitCreateTicketBtn.addEventListener('click', submitCreateTicket);

  const closeTicketBtn = document.getElementById('closeTicketDrawerBtn');
  const ticketOverlay = document.getElementById('ticketDrawerOverlay');
  if (closeTicketBtn) closeTicketBtn.addEventListener('click', closeTicketDrawer);
  if (ticketOverlay) ticketOverlay.addEventListener('click', closeTicketDrawer);

  const sendReplyBtn = document.getElementById('btnSendThreadReply');
  if (sendReplyBtn) sendReplyBtn.addEventListener('click', sendTicketReply);

  const updateStatusBtn = document.getElementById('btnUpdateThreadStatus');
  if (updateStatusBtn) updateStatusBtn.addEventListener('click', updateTicketStatus);

  const escalateUrgentBtn = document.getElementById('btnEscalateThreadUrgent');
  if (escalateUrgentBtn) escalateUrgentBtn.addEventListener('click', escalateTicketUrgent);

  ['ticketStatusFilter', 'ticketPriorityFilter', 'ticketCategoryFilter'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', () => loadTickets());
  });

  const searchTicketsInput = document.getElementById('ticketSearchInput');
  let ticketSearchTimeout = null;
  if (searchTicketsInput) {
    searchTicketsInput.addEventListener('input', () => {
      clearTimeout(ticketSearchTimeout);
      ticketSearchTimeout = setTimeout(() => loadTickets(), 300);
    });
  }

  // Ideation Engine Command
  const cancelKillIdeaBtn = document.getElementById('btnCancelKillIdea');
  const confirmKillIdeaBtn = document.getElementById('btnConfirmKillIdea');
  const killIdeaModal = document.getElementById('killIdeaModalOverlay');
  if (cancelKillIdeaBtn) cancelKillIdeaBtn.addEventListener('click', () => {
    if (killIdeaModal) killIdeaModal.style.display = 'none';
  });
  if (confirmKillIdeaBtn) confirmKillIdeaBtn.addEventListener('click', confirmKillIdea);

  const cancelRestoreIdeaBtn = document.getElementById('btnCancelRestoreIdea');
  const confirmRestoreIdeaBtn = document.getElementById('btnConfirmRestoreIdea');
  const restoreIdeaModal = document.getElementById('restoreIdeaModalOverlay');
  if (cancelRestoreIdeaBtn) cancelRestoreIdeaBtn.addEventListener('click', () => {
    if (restoreIdeaModal) restoreIdeaModal.style.display = 'none';
  });
  if (confirmRestoreIdeaBtn) confirmRestoreIdeaBtn.addEventListener('click', confirmRestoreIdea);

  const saveQuotaBtn = document.getElementById('btnSaveQuota');
  if (saveQuotaBtn) saveQuotaBtn.addEventListener('click', saveQuotaConfig);

  // --- Layer 4 Event Listeners: Dispute Resolution Center ---
  const openDisputeModalBtn = document.getElementById('btnOpenCreateDisputeModal');
  if (openDisputeModalBtn) openDisputeModalBtn.addEventListener('click', () => openCreateDisputeModal());

  const closeCreateDisputeBtn = document.getElementById('btnCloseCreateDispute');
  const cancelCreateDisputeBtn = document.getElementById('btnCancelCreateDispute');
  const modalCreateDispute = document.getElementById('modalCreateDispute');
  const closeCreateDisputeModal = () => { if (modalCreateDispute) modalCreateDispute.classList.remove('active'); };
  if (closeCreateDisputeBtn) closeCreateDisputeBtn.addEventListener('click', closeCreateDisputeModal);
  if (cancelCreateDisputeBtn) cancelCreateDisputeBtn.addEventListener('click', closeCreateDisputeModal);

  const submitCreateDisputeBtn = document.getElementById('btnSubmitCreateDispute');
  if (submitCreateDisputeBtn) submitCreateDisputeBtn.addEventListener('click', submitCreateDispute);

  const closeDetailDisputeBtn = document.getElementById('btnCloseDisputeDetail');
  const modalDisputeDetail = document.getElementById('modalDisputeDetail');
  if (closeDetailDisputeBtn) closeDetailDisputeBtn.addEventListener('click', () => {
    if (modalDisputeDetail) modalDisputeDetail.classList.remove('active');
  });

  const applyStatusBtn = document.getElementById('btnApplyDisputeStatus');
  if (applyStatusBtn) applyStatusBtn.addEventListener('click', () => {
    if (activeDetailDisputeId) applyDisputeStatus(activeDetailDisputeId);
  });

  const togglePartyBtn = document.getElementById('btnToggleAddParty');
  const partyFormWrap = document.getElementById('addPartyFormWrap');
  if (togglePartyBtn && partyFormWrap) {
    togglePartyBtn.addEventListener('click', () => {
      partyFormWrap.style.display = partyFormWrap.style.display === 'none' ? 'block' : 'none';
    });
  }

  const submitPartyBtn = document.getElementById('btnSubmitAddParty');
  if (submitPartyBtn) submitPartyBtn.addEventListener('click', () => {
    if (activeDetailDisputeId) addDisputePartyUI(activeDetailDisputeId);
  });

  const openAgreementBtn = document.getElementById('btnOpenDraftAgreement');
  const cancelAgreementBtn = document.getElementById('btnCancelDraftAgreement');
  const dispatchAgreementBtn = document.getElementById('btnDispatchAgreement');
  const agreementPanel = document.getElementById('draftAgreementPanel');
  if (openAgreementBtn && agreementPanel) openAgreementBtn.addEventListener('click', () => { agreementPanel.style.display = 'block'; });
  if (cancelAgreementBtn && agreementPanel) cancelAgreementBtn.addEventListener('click', () => { agreementPanel.style.display = 'none'; });
  if (dispatchAgreementBtn) dispatchAgreementBtn.addEventListener('click', () => {
    if (activeDetailDisputeId) dispatchAgreementUI(activeDetailDisputeId);
  });

  const openWaiverBtn = document.getElementById('btnOpenDraftWaiver');
  const cancelWaiverBtn = document.getElementById('btnCancelDraftWaiver');
  const dispatchWaiverBtn = document.getElementById('btnDispatchWaiver');
  const waiverPanel = document.getElementById('draftWaiverPanel');
  if (openWaiverBtn && waiverPanel) openWaiverBtn.addEventListener('click', () => { waiverPanel.style.display = 'block'; });
  if (cancelWaiverBtn && waiverPanel) cancelWaiverBtn.addEventListener('click', () => { waiverPanel.style.display = 'none'; });
  if (dispatchWaiverBtn) dispatchWaiverBtn.addEventListener('click', () => {
    if (activeDetailDisputeId) dispatchWaiverUI(activeDetailDisputeId);
  });

  const settleBtn = document.getElementById('btnExecuteSettlement');
  if (settleBtn) settleBtn.addEventListener('click', () => {
    if (activeDetailDisputeId) executeSettlementUI(activeDetailDisputeId);
  });

  ['disputeStatusFilter', 'disputeTypeFilter'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', () => loadDisputes());
  });

  const disputeSearch = document.getElementById('disputeSearchInput');
  let disputeSearchTimeout = null;
  if (disputeSearch) {
    disputeSearch.addEventListener('input', () => {
      clearTimeout(disputeSearchTimeout);
      disputeSearchTimeout = setTimeout(() => loadDisputes(), 300);
    });
  }

  // Layer 5: Gateway Config Listeners
  const btnTestGateway = document.getElementById('btnTestGatewayConnection');
  if (btnTestGateway) btnTestGateway.addEventListener('click', testGatewayConnectionUI);

  const btnSaveGateway = document.getElementById('btnSaveGatewayConfig');
  if (btnSaveGateway) btnSaveGateway.addEventListener('click', saveGatewayConfigUI);

  // Layer 5: Data Governance Listeners
  const govMemberSelect = document.getElementById('governanceMemberSelect');
  if (govMemberSelect) {
    govMemberSelect.addEventListener('change', (e) => {
      loadGovernanceHistory(e.target.value);
    });
  }

  const btnBlock = document.getElementById('btnBlockMember');
  if (btnBlock) btnBlock.addEventListener('click', () => blockMemberUI());

  const btnUnblock = document.getElementById('btnUnblockMember');
  if (btnUnblock) btnUnblock.addEventListener('click', () => unblockMemberUI());

  const btnExportGov = document.getElementById('btnExportGovernanceCSV');
  if (btnExportGov) btnExportGov.addEventListener('click', exportGovernanceCSV);

  const btnOpenGovModal = document.getElementById('btnOpenAddGovernanceModal');
  if (btnOpenGovModal) btnOpenGovModal.addEventListener('click', () => openAddGovernanceModal());

  const btnCloseGovModal = document.getElementById('btnCloseAddGovernance');
  if (btnCloseGovModal) btnCloseGovModal.addEventListener('click', closeAddGovernanceModal);

  const btnCancelGovModal = document.getElementById('btnCancelAddGovernance');
  if (btnCancelGovModal) btnCancelGovModal.addEventListener('click', closeAddGovernanceModal);

  const btnSubmitGovModal = document.getElementById('btnSubmitAddGovernance');
  if (btnSubmitGovModal) btnSubmitGovModal.addEventListener('click', submitAddGovernanceUI);
}

// ===================================================================
// LAYER 3: Section 4 — Support Ticket System Controller
// ===================================================================
let currentSelectedTicketId = null;

async function loadTickets() {
  const status = document.getElementById('ticketStatusFilter')?.value || '';
  const priority = document.getElementById('ticketPriorityFilter')?.value || '';
  const category = document.getElementById('ticketCategoryFilter')?.value || '';
  const search = document.getElementById('ticketSearchInput')?.value || '';

  const params = new URLSearchParams();
  if (status) params.append('status', status);
  if (priority) params.append('priority', priority);
  if (category) params.append('category', category);
  if (search) params.append('search', search);

  const tbody = document.getElementById('ticketsTableBody');
  if (!tbody) return;

  tbody.innerHTML = '<tr><td colspan="8" class="sa-loading-cell">Loading support tickets...</td></tr>';

  try {
    const res = await apiCall(`/api/superadmin/tickets?${params.toString()}`);
    if (!res.ok) {
      toasts.show(res.data?.error || 'Failed to load tickets', 'error');
      tbody.innerHTML = '<tr><td colspan="8" class="sa-empty-cell">Error loading support tickets.</td></tr>';
      return;
    }

    const tickets = Array.isArray(res.data) ? res.data : [];
    if (tickets.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:28px; color:var(--sa-text-muted);">No support tickets found matching current filters.</td></tr>';
      return;
    }

    tbody.innerHTML = tickets.map(t => {
      const priorityClass = `sa-priority-${t.priority || 'normal'}`;
      const statusClass = `sa-status-${t.status || 'open'}`;
      const updatedFormatted = t.updated_at ? new Date(t.updated_at).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' }) : '--';

      return `
        <tr style="cursor:pointer;" onclick="openTicketThread('${t.id}')">
          <td><strong style="color:#a5b4fc; font-family:monospace;">${t.ticket_number}</strong></td>
          <td>
            <div style="font-weight:600; color:#fff;">${t.subject || 'Untitled'}</div>
            <span class="sa-cat-badge">${t.category || 'other'}</span>
          </td>
          <td>
            <div style="color:#f1f5f9;">${t.reporter_name || 'Unknown'}</div>
            <div style="font-size:11px; color:var(--sa-text-muted);">${t.reporter_email || ''}</div>
          </td>
          <td><span class="sa-priority-badge ${priorityClass}">${t.priority}</span></td>
          <td><span class="sa-badge-status ${statusClass}">${t.status}</span></td>
          <td>${t.assignee_name ? `<span style="color:#e2e8f0;">${t.assignee_name}</span>` : '<span style="color:var(--sa-text-muted); font-style:italic;">Unassigned</span>'}</td>
          <td style="font-size:12px; color:var(--sa-text-dim);">${updatedFormatted}</td>
          <td>
            <button class="sa-btn-action sa-btn-action-view" onclick="event.stopPropagation(); openTicketThread('${t.id}')">
              View Thread
            </button>
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error('Error loading tickets:', err);
    tbody.innerHTML = '<tr><td colspan="8" class="sa-empty-cell">Network error while fetching tickets.</td></tr>';
  }
}

async function openTicketThread(ticketId) {
  currentSelectedTicketId = ticketId;
  const drawer = document.getElementById('ticketDrawer');
  const overlay = document.getElementById('ticketDrawerOverlay');
  const msgsContainer = document.getElementById('ticketMessagesContainer');

  if (msgsContainer) msgsContainer.innerHTML = '<div class="sa-loading-cell">Loading conversation thread...</div>';
  if (drawer) drawer.classList.add('open');
  if (overlay) overlay.classList.add('open');

  try {
    const res = await apiCall(`/api/superadmin/tickets/${ticketId}`);
    if (!res.ok) {
      toasts.show(res.data?.error || 'Failed to load ticket details', 'error');
      return;
    }

    const t = res.data;
    const numEl = document.getElementById('drawerTicketNumber');
    const statusEl = document.getElementById('drawerTicketStatus');
    const prioEl = document.getElementById('drawerTicketPriority');
    const subjEl = document.getElementById('drawerTicketSubject');
    const repEl = document.getElementById('drawerTicketReporter');

    if (numEl) numEl.textContent = t.ticket_number;
    if (statusEl) {
      statusEl.textContent = t.status;
      statusEl.className = `sa-badge-status sa-status-${t.status}`;
    }
    if (prioEl) {
      prioEl.textContent = t.priority;
      prioEl.className = `sa-priority-badge sa-priority-${t.priority}`;
    }
    if (subjEl) subjEl.textContent = t.subject;
    if (repEl) repEl.textContent = `Reporter: ${t.reporter_name} (${t.reporter_email})`;

    // Configure status dropdown options (FSM forward only)
    const statusSelect = document.getElementById('threadStatusSelect');
    const updateBtn = document.getElementById('btnUpdateThreadStatus');
    if (statusSelect) {
      if (t.status === 'open') {
        statusSelect.innerHTML = `
          <option value="in_progress">Mark In Progress</option>
          <option value="resolved">Mark Resolved</option>
          <option value="closed">Mark Closed</option>
        `;
        statusSelect.disabled = false;
        if (updateBtn) updateBtn.disabled = false;
      } else if (t.status === 'in_progress') {
        statusSelect.innerHTML = `
          <option value="resolved">Mark Resolved</option>
          <option value="closed">Mark Closed</option>
        `;
        statusSelect.disabled = false;
        if (updateBtn) updateBtn.disabled = false;
      } else if (t.status === 'resolved') {
        statusSelect.innerHTML = `
          <option value="closed">Mark Closed</option>
        `;
        statusSelect.disabled = false;
        if (updateBtn) updateBtn.disabled = false;
      } else {
        statusSelect.innerHTML = `<option value="closed">Closed (Final)</option>`;
        statusSelect.disabled = true;
        if (updateBtn) updateBtn.disabled = true;
      }
    }

    // Render messages
    const messages = Array.isArray(t.messages) ? t.messages : [];
    if (messages.length === 0) {
      msgsContainer.innerHTML = '<div style="padding:24px; text-align:center; color:var(--sa-text-muted);">No messages in this ticket thread yet.</div>';
    } else {
      msgsContainer.innerHTML = messages.map(m => {
        const isInternal = Boolean(m.is_internal);
        const timeFormatted = m.created_at ? new Date(m.created_at).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' }) : '';
        return `
          <div class="ticket-msg ${isInternal ? 'internal' : ''}">
            <div class="ticket-msg-header">
              <span class="ticket-msg-sender">
                ${m.sender_name || 'Member'} (${m.sender_role || 'user'})
                ${isInternal ? '<span class="ticket-msg-badge-internal">INTERNAL NOTE</span>' : ''}
              </span>
              <span class="ticket-msg-time">${timeFormatted}</span>
            </div>
            <div class="ticket-msg-body">${m.body || ''}</div>
          </div>
        `;
      }).join('');
      msgsContainer.scrollTop = msgsContainer.scrollHeight;
    }
  } catch (err) {
    console.error('Error opening ticket thread:', err);
    toasts.show('Network error while opening ticket', 'error');
  }
}

function closeTicketDrawer() {
  const drawer = document.getElementById('ticketDrawer');
  const overlay = document.getElementById('ticketDrawerOverlay');
  if (drawer) drawer.classList.remove('open');
  if (overlay) overlay.classList.remove('open');
  currentSelectedTicketId = null;
}

async function sendTicketReply() {
  if (!currentSelectedTicketId) return;
  const replyInput = document.getElementById('ticketThreadReplyInput');
  const isInternalCheck = document.getElementById('ticketThreadInternalCheck');
  const body = replyInput?.value?.trim();
  const is_internal = isInternalCheck?.checked ? 1 : 0;

  if (!body) {
    toasts.show('Please enter a message body before sending', 'warning');
    return;
  }

  const btn = document.getElementById('btnSendThreadReply');
  if (btn) btn.disabled = true;

  try {
    const res = await apiCall(`/api/superadmin/tickets/${currentSelectedTicketId}/messages`, 'POST', {
      body,
      is_internal
    });

    if (!res.ok) {
      toasts.show(res.data?.error || 'Failed to send message', 'error');
      return;
    }

    toasts.show(is_internal ? 'Internal note added to ticket' : 'Reply sent to ticket thread', 'success');
    if (replyInput) replyInput.value = '';
    if (isInternalCheck) isInternalCheck.checked = false;

    await openTicketThread(currentSelectedTicketId);
    await loadTickets();
  } catch (err) {
    console.error('Error sending ticket reply:', err);
    toasts.show('Network error while sending message', 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function updateTicketStatus() {
  if (!currentSelectedTicketId) return;
  const statusSelect = document.getElementById('threadStatusSelect');
  const newStatus = statusSelect?.value;
  if (!newStatus) return;

  try {
    const res = await apiCall(`/api/superadmin/tickets/${currentSelectedTicketId}`, 'PATCH', {
      status: newStatus
    });

    if (!res.ok) {
      toasts.show(res.data?.error || 'Failed to update ticket status', 'error');
      return;
    }

    toasts.show(`Ticket status updated to ${newStatus}`, 'success');
    await openTicketThread(currentSelectedTicketId);
    await loadTickets();
  } catch (err) {
    console.error('Error updating ticket status:', err);
    toasts.show('Network error while updating ticket status', 'error');
  }
}

async function escalateTicketUrgent() {
  if (!currentSelectedTicketId) return;

  try {
    const res = await apiCall(`/api/superadmin/tickets/${currentSelectedTicketId}`, 'PATCH', {
      priority: 'urgent'
    });

    if (!res.ok) {
      toasts.show(res.data?.error || 'Failed to escalate ticket', 'error');
      return;
    }

    toasts.show('Ticket escalated to URGENT priority', 'success');
    await openTicketThread(currentSelectedTicketId);
    await loadTickets();
  } catch (err) {
    console.error('Error escalating ticket:', err);
    toasts.show('Network error while escalating ticket', 'error');
  }
}

async function openCreateTicketModal() {
  const modal = document.getElementById('createTicketModalOverlay');
  const reporterSelect = document.getElementById('newTicketReporterSelect');

  if (reporterSelect) {
    try {
      const res = await apiCall('/api/superadmin/members?status=active');
      if (res.ok && Array.isArray(res.data)) {
        reporterSelect.innerHTML = res.data.map(u => `
          <option value="${u.id}">${u.name} (${u.role} - ${u.email})</option>
        `).join('');
      } else {
        reporterSelect.innerHTML = `<option value="${currentUser.id}">${currentUser.name || 'Admin'} (Admin)</option>`;
      }
    } catch (e) {
      reporterSelect.innerHTML = `<option value="${currentUser.id}">${currentUser.name || 'Admin'} (Admin)</option>`;
    }
  }

  if (modal) modal.style.display = 'flex';
}

async function submitCreateTicket() {
  const reporter_id = document.getElementById('newTicketReporterSelect')?.value;
  const category = document.getElementById('newTicketCategorySelect')?.value;
  const priority = document.getElementById('newTicketPrioritySelect')?.value;
  const subject = document.getElementById('newTicketSubjectInput')?.value?.trim();
  const body = document.getElementById('newTicketBodyInput')?.value?.trim();

  if (!subject) {
    toasts.show('Subject is required', 'warning');
    return;
  }

  try {
    const res = await apiCall('/api/superadmin/tickets', 'POST', {
      reporter_id,
      category,
      priority,
      subject,
      body
    });

    if (!res.ok) {
      toasts.show(res.data?.error || 'Failed to create ticket', 'error');
      return;
    }

    toasts.show(`Ticket ${res.data.ticket_number} created successfully`, 'success');
    const modal = document.getElementById('createTicketModalOverlay');
    if (modal) modal.style.display = 'none';

    const subjInput = document.getElementById('newTicketSubjectInput');
    const bodyInput = document.getElementById('newTicketBodyInput');
    if (subjInput) subjInput.value = '';
    if (bodyInput) bodyInput.value = '';

    await loadTickets();
  } catch (err) {
    console.error('Error creating ticket:', err);
    toasts.show('Network error while creating ticket', 'error');
  }
}

// ===================================================================
// LAYER 3: Section 5 — Ideation Engine Command Center Controller
// ===================================================================
let currentKillIdeaId = null;
let currentRestoreIdeaId = null;

async function loadIdeationCommand() {
  const tbody = document.getElementById('ideationTableBody');
  if (!tbody) return;

  tbody.innerHTML = '<tr><td colspan="7" class="sa-loading-cell">Loading ideas command roster...</td></tr>';

  try {
    const res = await apiCall('/api/superadmin/ideas');
    if (!res.ok) {
      toasts.show(res.data?.error || 'Failed to load ideation command data', 'error');
      tbody.innerHTML = '<tr><td colspan="7" class="sa-empty-cell">Error loading ideas.</td></tr>';
      return;
    }

    const ideas = Array.isArray(res.data) ? res.data : [];
    if (ideas.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:28px; color:var(--sa-text-muted);">No submitted ideas in the system.</td></tr>';
      return;
    }

    tbody.innerHTML = ideas.map(idea => {
      const isKilled = (idea.status || '').toLowerCase() === 'killed';
      const statusClass = isKilled ? 'sa-status-killed' : `sa-status-${(idea.status || '').toLowerCase()}`;
      const revClockFormatted = idea.revenue_clock_start ? new Date(idea.revenue_clock_start).toLocaleDateString('en-IN') : '<span style="color:var(--sa-text-muted);">Not Started</span>';

      let actionBtn = '';
      if (isKilled) {
        actionBtn = `
          <button class="sa-btn-action sa-btn-action-restore" onclick="openRestoreIdeaModal('${idea.id}', '${(idea.title || '').replace(/'/g, "\\'")}')">
            Restore Idea
          </button>
        `;
      } else {
        actionBtn = `
          <button class="sa-btn-action sa-btn-action-kill" onclick="openKillIdeaModal('${idea.id}', '${(idea.title || '').replace(/'/g, "\\'")}')">
            Kill Switch
          </button>
        `;
      }

      return `
        <tr>
          <td>
            <div style="font-weight:600; color:#fff;">${idea.title || 'Untitled'}</div>
            <div style="font-size:11px; color:var(--sa-text-muted); font-family:monospace;">${idea.id}</div>
            ${isKilled && idea.killed_reason ? `<div style="font-size:11px; color:#fca5a5; margin-top:2px;">Reason: ${idea.killed_reason}</div>` : ''}
          </td>
          <td>
            <div style="color:#f1f5f9;">${idea.owner_name || 'Unknown'}</div>
            <div style="font-size:11px; color:var(--sa-text-muted);">${idea.owner_email || ''}</div>
          </td>
          <td><span class="sa-badge-status ${statusClass}">${idea.status}</span></td>
          <td><strong style="color:#a5b4fc;">${idea.vote_count}</strong> votes</td>
          <td><span class="sa-fanout-pill">${idea.fan_out_summary || '0/9 complete'}</span></td>
          <td style="font-size:12px;">${revClockFormatted}</td>
          <td>${actionBtn}</td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error('Error loading ideation command:', err);
    tbody.innerHTML = '<tr><td colspan="7" class="sa-empty-cell">Network error while fetching ideas.</td></tr>';
  }
}

function openKillIdeaModal(ideaId, ideaTitle) {
  currentKillIdeaId = ideaId;
  const modal = document.getElementById('killIdeaModalOverlay');
  const titleEl = document.getElementById('killIdeaTargetTitle');
  const inputEl = document.getElementById('killIdeaReasonInput');

  if (titleEl) titleEl.textContent = `Killing: "${ideaTitle}"`;
  if (inputEl) inputEl.value = '';
  if (modal) modal.style.display = 'flex';
}

async function confirmKillIdea() {
  if (!currentKillIdeaId) return;
  const reason = document.getElementById('killIdeaReasonInput')?.value?.trim();

  if (!reason) {
    toasts.show('Justification reason is required to activate kill switch', 'warning');
    return;
  }

  const btn = document.getElementById('btnConfirmKillIdea');
  if (btn) btn.disabled = true;

  try {
    const res = await apiCall(`/api/superadmin/ideas/${currentKillIdeaId}/kill`, 'POST', { reason });

    if (!res.ok) {
      toasts.show(res.data?.error || 'Failed to kill idea', 'error');
      return;
    }

    toasts.show('Idea killed and pending tasks cancelled', 'success');
    const modal = document.getElementById('killIdeaModalOverlay');
    if (modal) modal.style.display = 'none';

    await loadIdeationCommand();
  } catch (err) {
    console.error('Error killing idea:', err);
    toasts.show('Network error while executing kill switch', 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

function openRestoreIdeaModal(ideaId, ideaTitle) {
  currentRestoreIdeaId = ideaId;
  const modal = document.getElementById('restoreIdeaModalOverlay');
  const titleEl = document.getElementById('restoreIdeaTargetTitle');
  const inputEl = document.getElementById('restoreIdeaReasonInput');

  if (titleEl) titleEl.textContent = `Restoring: "${ideaTitle}"`;
  if (inputEl) inputEl.value = '';
  if (modal) modal.style.display = 'flex';
}

async function confirmRestoreIdea() {
  if (!currentRestoreIdeaId) return;
  const reason = document.getElementById('restoreIdeaReasonInput')?.value?.trim();

  if (!reason) {
    toasts.show('Restoration reason is required', 'warning');
    return;
  }

  const btn = document.getElementById('btnConfirmRestoreIdea');
  if (btn) btn.disabled = true;

  try {
    const res = await apiCall(`/api/superadmin/ideas/${currentRestoreIdeaId}/restore`, 'POST', { reason });

    if (!res.ok) {
      toasts.show(res.data?.error || 'Failed to restore idea', 'error');
      return;
    }

    toasts.show('Idea successfully restored to previous active state', 'success');
    const modal = document.getElementById('restoreIdeaModalOverlay');
    if (modal) modal.style.display = 'none';

    await loadIdeationCommand();
  } catch (err) {
    console.error('Error restoring idea:', err);
    toasts.show('Network error while restoring idea', 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function loadQuotaConfig() {
  try {
    const res = await apiCall('/api/superadmin/quota/config');
    if (res.ok && res.data) {
      const limitInput = document.getElementById('quotaLimitInput');
      const windowInput = document.getElementById('quotaWindowInput');
      if (limitInput) limitInput.value = res.data.idea_quota_limit || 4;
      if (windowInput) windowInput.value = res.data.idea_quota_window_days || 10;
    }
  } catch (err) {
    console.error('Error loading quota config:', err);
  }
}

async function saveQuotaConfig() {
  const limitInput = document.getElementById('quotaLimitInput');
  const windowInput = document.getElementById('quotaWindowInput');

  const idea_quota_limit = Number(limitInput?.value);
  const idea_quota_window_days = Number(windowInput?.value);

  if (isNaN(idea_quota_limit) || idea_quota_limit < 1) {
    toasts.show('Idea limit must be an integer >= 1', 'warning');
    return;
  }

  if (isNaN(idea_quota_window_days) || idea_quota_window_days < 7 || idea_quota_window_days > 30) {
    toasts.show('Window days must be between 7 and 30 days', 'warning');
    return;
  }

  const btn = document.getElementById('btnSaveQuota');
  if (btn) btn.disabled = true;

  try {
    const res = await apiCall('/api/superadmin/quota/config', 'PATCH', {
      idea_quota_limit,
      idea_quota_window_days
    });

    if (!res.ok) {
      toasts.show(res.data?.error || 'Failed to update quota configuration', 'error');
      return;
    }

    toasts.show('Idea quota configuration updated successfully', 'success');
  } catch (err) {
    console.error('Error saving quota config:', err);
    toasts.show('Network error while saving quota configuration', 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ===================================================================
// SECTION 5: DISPUTE RESOLUTION CENTER CONTROLLER (LAYER 4)
// ===================================================================

let activeDetailDisputeId = null;

async function loadDisputes() {
  const tbody = document.getElementById('disputesTableBody');
  if (!tbody) return;

  const status = document.getElementById('disputeStatusFilter')?.value || '';
  const dispute_type = document.getElementById('disputeTypeFilter')?.value || '';
  const search = document.getElementById('disputeSearchInput')?.value || '';

  const queryParams = new URLSearchParams();
  if (status) queryParams.set('status', status);
  if (dispute_type) queryParams.set('dispute_type', dispute_type);
  if (search) queryParams.set('search', search);

  tbody.innerHTML = '<tr><td colspan="8" class="sa-loading-cell">Loading dispute ledger...</td></tr>';

  try {
    const res = await apiCall(`/api/superadmin/disputes?${queryParams.toString()}`);
    if (!res.ok) {
      tbody.innerHTML = '<tr><td colspan="8" class="sa-empty-cell">Failed to load disputes</td></tr>';
      return;
    }

    const disputes = res.data || [];
    if (disputes.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" class="sa-empty-cell">No disputes matching current filters</td></tr>';
      return;
    }

    tbody.innerHTML = disputes.map(d => {
      const daysOpen = Math.max(0, Math.floor((Date.now() - new Date(d.created_at).getTime()) / (1000 * 60 * 60 * 24)));
      const againstName = d.against_party_name || d.against_party_ext || 'External / Unspecified';
      const typeLabel = (d.dispute_type || 'other').replace(/_/g, ' ').toUpperCase();
      const statusLabel = (d.status || 'open').replace(/_/g, ' ').toUpperCase();

      let badgeColor = '#94a3b8';
      if (d.status === 'open') badgeColor = '#60a5fa';
      else if (d.status === 'under_review') badgeColor = '#f59e0b';
      else if (d.status === 'pending_signatures') badgeColor = '#a855f7';
      else if (d.status === 'settled' || d.status === 'resolved') badgeColor = '#10b981';
      else if (d.status === 'escalated_legal') badgeColor = '#ef4444';

      return `
        <tr>
          <td><strong style="color:#e0e7ff; font-family:'JetBrains Mono',monospace;">${escapeHtml(d.dispute_number)}</strong></td>
          <td><span style="font-size:11px; background:rgba(255,255,255,0.06); padding:3px 6px; border-radius:4px;">${escapeHtml(typeLabel)}</span></td>
          <td>${escapeHtml(d.raised_by_name || 'Member')}</td>
          <td>${escapeHtml(againstName)}</td>
          <td><span class="sa-badge" style="background:${badgeColor}22; color:${badgeColor}; border:1px solid ${badgeColor}44;">${statusLabel}</span></td>
          <td style="color:#94a3b8;">${daysOpen}d</td>
          <td style="font-family:'JetBrains Mono',monospace; color:${d.settlement_amount ? '#34d399' : '#94a3b8'};">${d.settlement_amount ? formatINR(d.settlement_amount) : '—'}</td>
          <td>
            <button class="sa-btn-outline" style="padding:4px 10px; font-size:12px;" onclick="openDisputeDetail('${d.id}')">
              Mediate & View →
            </button>
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error('Error loading disputes:', err);
    tbody.innerHTML = '<tr><td colspan="8" class="sa-empty-cell">Network error while fetching disputes</td></tr>';
  }
}

async function openCreateDisputeModal(preselectedAgainstUserId = null) {
  const modal = document.getElementById('modalCreateDispute');
  if (!modal) return;

  const raisedBySelect = document.getElementById('newDisputeRaisedBySelect');
  const againstPartySelect = document.getElementById('newDisputeAgainstPartySelect');

  // Populate member dropdowns from members directory
  try {
    const res = await apiCall('/api/superadmin/members');
    if (res.ok && res.data?.members) {
      const optionsHtml = res.data.members.map(m => `
        <option value="${m.id}">${escapeHtml(m.name)} (${escapeHtml(m.role)})</option>
      `).join('');

      if (raisedBySelect) {
        raisedBySelect.innerHTML = `<option value="">Select Complainant...</option>` + optionsHtml;
      }
      if (againstPartySelect) {
        againstPartySelect.innerHTML = `<option value="">None / External Party</option>` + optionsHtml;
        if (preselectedAgainstUserId) {
          againstPartySelect.value = preselectedAgainstUserId;
        }
      }
    }
  } catch (e) {}

  modal.classList.add('active');
}

async function submitCreateDispute() {
  const dispute_type = document.getElementById('newDisputeTypeSelect')?.value;
  const raised_by = document.getElementById('newDisputeRaisedBySelect')?.value;
  const against_party = document.getElementById('newDisputeAgainstPartySelect')?.value || null;
  const against_party_ext = document.getElementById('newDisputeAgainstExtInput')?.value || null;
  const description = document.getElementById('newDisputeDescInput')?.value || '';

  if (!dispute_type || !raised_by) {
    toasts.show('Dispute type and complainant are required', 'error');
    return;
  }
  if (!description.trim()) {
    toasts.show('Description statement is required', 'error');
    return;
  }

  const btn = document.getElementById('btnSubmitCreateDispute');
  if (btn) btn.disabled = true;

  try {
    const res = await apiCall('/api/superadmin/disputes', 'POST', {
      dispute_type,
      raised_by,
      against_party,
      against_party_ext,
      description
    });

    if (!res.ok) {
      toasts.show(res.data?.error || 'Failed to create dispute', 'error');
      return;
    }

    toasts.show(`Dispute ${res.data.dispute_number} created successfully`, 'success');
    document.getElementById('modalCreateDispute')?.classList.remove('active');
    document.getElementById('newDisputeDescInput').value = '';
    loadDisputes();
  } catch (err) {
    toasts.show('Error submitting dispute: ' + err.message, 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function openDisputeDetail(disputeId) {
  activeDetailDisputeId = disputeId;
  const modal = document.getElementById('modalDisputeDetail');
  if (!modal) return;

  try {
    const res = await apiCall(`/api/superadmin/disputes/${disputeId}`);
    if (!res.ok) {
      toasts.show('Failed to load dispute details', 'error');
      return;
    }

    const d = res.data;
    document.getElementById('detailDisputeTitle').textContent = `Dispute ${d.dispute_number}`;
    document.getElementById('detailDisputeSub').textContent = `Type: ${(d.dispute_type || '').replace(/_/g, ' ').toUpperCase()} | Opened ${new Date(d.created_at).toLocaleString()}`;
    
    const badge = document.getElementById('detailDisputeStatusBadge');
    if (badge) {
      badge.textContent = (d.status || 'open').replace(/_/g, ' ').toUpperCase();
      badge.className = `sa-badge badge-${d.status}`;
    }

    document.getElementById('detailDisputeStatusSelect').value = d.status === 'open' ? 'under_review' : d.status;
    document.getElementById('detailDisputeDesc').textContent = d.description || 'No description provided.';

    // Populate Parties
    const partiesList = document.getElementById('detailDisputePartiesList');
    const targetBeneficiarySelect = document.getElementById('settleTargetUserSelect');
    
    if (partiesList) {
      partiesList.innerHTML = (d.parties || []).map(p => `
        <div style="background:var(--sa-bg); border:1px solid var(--sa-card-border); padding:6px 12px; border-radius:6px; font-size:12px; display:inline-flex; align-items:center; gap:8px;">
          <strong>${escapeHtml(p.party_name)}</strong>
          <span style="font-size:10px; color:#a5b4fc; text-transform:uppercase;">[${p.party_type}]</span>
        </div>
      `).join('') || '<span style="color:#94a3b8; font-size:12px;">No parties recorded</span>';
    }

    if (targetBeneficiarySelect) {
      targetBeneficiarySelect.innerHTML = `<option value="">Target Beneficiary...</option>` +
        (d.parties || []).filter(p => p.user_id).map(p => `
          <option value="${p.user_id}">${escapeHtml(p.party_name)} (${p.party_type})</option>
        `).join('');
    }

    // Populate Signatures / Agreements list
    renderDisputeSignaturesStream(d);

    // Settlement indicator
    const settleInd = document.getElementById('settlementStatusIndicator');
    if (settleInd) {
      settleInd.textContent = d.settlement_amount ? `Executed: ${formatINR(d.settlement_amount)}` : 'Pending Settlement Execution';
    }

    modal.classList.add('active');
  } catch (err) {
    toasts.show('Error retrieving dispute: ' + err.message, 'error');
  }
}

function renderDisputeSignaturesStream(d) {
  const container = document.getElementById('detailDisputeSignaturesList');
  if (!container) return;

  const agreements = d.agreements || [];
  const waivers = d.waivers || [];

  if (agreements.length === 0 && waivers.length === 0) {
    container.innerHTML = '<div style="padding:16px; text-align:center; color:#94a3b8; font-size:13px; background:rgba(255,255,255,0.02); border-radius:6px;">No agreements or liability waivers drafted yet. Use the buttons above to draft formal terms.</div>';
    return;
  }

  let html = '';

  if (agreements.length > 0) {
    html += '<h5 style="margin:12px 0 6px; color:#e2e8f0; font-size:12px; text-transform:uppercase;">Dispute Agreements</h5>';
    agreements.forEach(ag => {
      html += `
        <div style="background:#0b1120; border:1px solid var(--sa-card-border); border-radius:6px; padding:12px; margin-bottom:10px;">
          <div style="display:flex; justify-content:space-between; margin-bottom:6px; font-size:12px;">
            <strong>Agreement v${ag.version}.0 (Drafted by ${escapeHtml(ag.created_by_name || 'Admin')})</strong>
            <span style="color:#94a3b8;">${new Date(ag.created_at).toLocaleDateString()}</span>
          </div>
          <div style="font-size:12px; color:#94a3b8; max-height:80px; overflow-y:auto; margin-bottom:8px; white-space:pre-wrap;">${escapeHtml(ag.agreement_text)}</div>
          <div style="border-top:1px solid rgba(255,255,255,0.05); padding-top:6px;">
            <span style="font-size:11px; color:#a5b4fc; font-weight:600;">Signatures:</span>
            <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:4px;">
              ${(ag.signatures || []).map(s => `
                <div style="background:var(--sa-bg); border:1px solid var(--sa-card-border); padding:4px 8px; border-radius:4px; font-size:11px;">
                  <span>${escapeHtml(s.signer_name || 'Party')}:</span>
                  <strong style="color:${s.status === 'signed' ? '#34d399' : s.status === 'declined' ? '#f87171' : '#fbbf24'};">${(s.status || 'pending').toUpperCase()}</strong>
                  <button style="margin-left:6px; background:none; border:none; color:#60a5fa; cursor:pointer; font-size:10px; text-decoration:underline;" onclick="copySigningLink('dispute', '${d.id}', '${s.signature_token}')">Copy Link</button>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      `;
    });
  }

  if (waivers.length > 0) {
    html += '<h5 style="margin:16px 0 6px; color:#e2e8f0; font-size:12px; text-transform:uppercase;">Liability Waivers</h5>';
    waivers.forEach(w => {
      html += `
        <div style="background:#0b1120; border:1px solid var(--sa-card-border); border-radius:6px; padding:12px; margin-bottom:10px;">
          <div style="display:flex; justify-content:space-between; margin-bottom:6px; font-size:12px;">
            <strong>Waiver: ${escapeHtml((w.waiver_type || '').replace(/_/g, ' ').toUpperCase())} (Scope: ${escapeHtml((w.scope || 'global').toUpperCase())})</strong>
            <span style="color:#94a3b8;">${new Date(w.created_at).toLocaleDateString()}</span>
          </div>
          <div style="font-size:12px; color:#94a3b8; max-height:80px; overflow-y:auto; margin-bottom:8px; white-space:pre-wrap;">${escapeHtml(w.waiver_text)}</div>
          <div style="border-top:1px solid rgba(255,255,255,0.05); padding-top:6px;">
            <span style="font-size:11px; color:#34d399; font-weight:600;">Signatures:</span>
            <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:4px;">
              ${(w.signatures || []).map(s => `
                <div style="background:var(--sa-bg); border:1px solid var(--sa-card-border); padding:4px 8px; border-radius:4px; font-size:11px;">
                  <span>${escapeHtml(s.signer_name || 'Party')}:</span>
                  <strong style="color:${s.status === 'signed' ? '#34d399' : s.status === 'declined' ? '#f87171' : '#fbbf24'};">${(s.status || 'pending').toUpperCase()}</strong>
                  <button style="margin-left:6px; background:none; border:none; color:#60a5fa; cursor:pointer; font-size:10px; text-decoration:underline;" onclick="copySigningLink('waiver', '${w.id}', '${s.signature_token}')">Copy Link</button>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      `;
    });
  }

  container.innerHTML = html;
}

window.copySigningLink = function (type, docId, token) {
  const link = `${window.location.origin}/sign.html?type=${type}&id=${docId}&token=${token}`;
  navigator.clipboard.writeText(link).then(() => {
    toasts.show('Signing Ceremony Link copied to clipboard!', 'success');
  }).catch(() => {
    prompt('Copy signing link:', link);
  });
};

async function applyDisputeStatus(disputeId) {
  const newStatus = document.getElementById('detailDisputeStatusSelect')?.value;
  if (!newStatus) return;

  try {
    const res = await apiCall(`/api/superadmin/disputes/${disputeId}/status`, 'PATCH', { status: newStatus });
    if (!res.ok) {
      toasts.show(res.data?.error || 'Failed to update dispute status', 'error');
      return;
    }
    toasts.show(`Dispute transitioned to ${newStatus}`, 'success');
    openDisputeDetail(disputeId);
    loadDisputes();
  } catch (err) {
    toasts.show('Error updating status: ' + err.message, 'error');
  }
}

async function addDisputePartyUI(disputeId) {
  const party_name = document.getElementById('partyNameInput')?.value;
  const party_type = document.getElementById('partyRoleSelect')?.value;

  if (!party_name || !party_name.trim()) {
    toasts.show('Party name is required', 'error');
    return;
  }

  try {
    const res = await apiCall(`/api/superadmin/disputes/${disputeId}/parties`, 'POST', { party_name, party_type });
    if (!res.ok) {
      toasts.show(res.data?.error || 'Failed to add party', 'error');
      return;
    }
    toasts.show('Party registered to dispute', 'success');
    document.getElementById('partyNameInput').value = '';
    document.getElementById('addPartyFormWrap').style.display = 'none';
    openDisputeDetail(disputeId);
  } catch (err) {
    toasts.show('Error adding party: ' + err.message, 'error');
  }
}

async function dispatchAgreementUI(disputeId) {
  const agreement_text = document.getElementById('draftAgreementText')?.value;
  if (!agreement_text || !agreement_text.trim()) {
    toasts.show('Agreement terms are required', 'error');
    return;
  }

  const btn = document.getElementById('btnDispatchAgreement');
  if (btn) btn.disabled = true;

  try {
    const res = await apiCall(`/api/superadmin/disputes/${disputeId}/agreement`, 'POST', { agreement_text });
    if (!res.ok) {
      toasts.show(res.data?.error || 'Failed to dispatch agreement', 'error');
      return;
    }
    toasts.show(`Agreement v${res.data?.agreement?.version || 1} dispatched for digital signatures`, 'success');
    document.getElementById('draftAgreementText').value = '';
    document.getElementById('draftAgreementPanel').style.display = 'none';
    openDisputeDetail(disputeId);
    loadDisputes();
  } catch (err) {
    toasts.show('Error dispatching agreement: ' + err.message, 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function dispatchWaiverUI(disputeId) {
  const waiver_text = document.getElementById('draftWaiverText')?.value;
  const waiver_type = document.getElementById('draftWaiverType')?.value;
  const scope = document.getElementById('draftWaiverScope')?.value;

  if (!waiver_text || !waiver_text.trim()) {
    toasts.show('Waiver terms are required', 'error');
    return;
  }

  const btn = document.getElementById('btnDispatchWaiver');
  if (btn) btn.disabled = true;

  try {
    const res = await apiCall(`/api/superadmin/disputes/${disputeId}/waiver`, 'POST', {
      waiver_text,
      waiver_type,
      scope
    });
    if (!res.ok) {
      toasts.show(res.data?.error || 'Failed to dispatch liability waiver', 'error');
      return;
    }
    toasts.show('Liability waiver dispatched for digital signatures', 'success');
    document.getElementById('draftWaiverText').value = '';
    document.getElementById('draftWaiverPanel').style.display = 'none';
    openDisputeDetail(disputeId);
  } catch (err) {
    toasts.show('Error dispatching waiver: ' + err.message, 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function executeSettlementUI(disputeId) {
  const amount = parseFloat(document.getElementById('settleAmountInput')?.value || 0);
  const action = document.getElementById('settleActionSelect')?.value;
  const target_user_id = document.getElementById('settleTargetUserSelect')?.value;
  const notes = document.getElementById('settleNotesInput')?.value || '';

  if (isNaN(amount) || amount < 0) {
    toasts.show('Please provide a valid non-negative settlement amount', 'error');
    return;
  }

  if ((action === 'wallet_credit' || action === 'wallet_debit') && !target_user_id) {
    toasts.show('Please select a target beneficiary member for wallet actions', 'error');
    return;
  }

  if (!confirm(`Are you certain you wish to execute financial settlement of ${formatINR(amount)} via ${action.toUpperCase()}? This action updates member balances and locks settlement.`)) {
    return;
  }

  const btn = document.getElementById('btnExecuteSettlement');
  if (btn) btn.disabled = true;

  try {
    const res = await apiCall(`/api/superadmin/disputes/${disputeId}/settle`, 'POST', {
      action,
      amount,
      target_user_id,
      notes
    });

    if (!res.ok) {
      toasts.show(res.data?.error || 'Failed to execute financial settlement', 'error');
      return;
    }

    toasts.show('Financial settlement executed and recorded successfully!', 'success');
    openDisputeDetail(disputeId);
    loadDisputes();
  } catch (err) {
    toasts.show('Error executing settlement: ' + err.message, 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ==========================================================================
// 10. SECTION 6 & 7: PAYMENT GATEWAY CONFIG & USER DATA GOVERNANCE (LAYER 5)
// ==========================================================================

let allGovernanceMembers = [];
let selectedGovernanceUserId = null;

async function loadGatewayConfig() {
  try {
    const res = await apiCall('/api/superadmin/gateway/config');
    if (!res.ok) {
      toasts.show(res.data?.error || 'Failed to fetch gateway configuration', 'error');
      return;
    }

    const cfg = res.data;
    const modeBadge = document.getElementById('gatewayModeBadge');
    const displayMode = document.getElementById('displayGatewayMode');
    const displayName = document.getElementById('displayGatewayName');
    const displayApiKey = document.getElementById('displayApiKey');
    const displayWebhookSecret = document.getElementById('displayWebhookSecret');
    const displayUpdatedAt = document.getElementById('displayGatewayUpdatedAt');

    const mode = (cfg.mode || 'sandbox').toLowerCase();
    if (displayMode) displayMode.textContent = mode;
    if (modeBadge) {
      modeBadge.textContent = mode.toUpperCase();
      if (mode === 'live') {
        modeBadge.style.background = 'rgba(239, 68, 68, 0.15)';
        modeBadge.style.color = '#ef4444';
        modeBadge.style.borderColor = '#ef4444';
      } else {
        modeBadge.style.background = 'rgba(16, 185, 129, 0.15)';
        modeBadge.style.color = '#10b981';
        modeBadge.style.borderColor = '#10b981';
      }
    }

    if (displayName) displayName.textContent = cfg.gateway_name || 'SIMULATED_GATEWAY_STUB';
    if (displayApiKey) {
      displayApiKey.textContent = cfg.api_key_set ? '••••••••' : 'Not configured';
      displayApiKey.style.color = cfg.api_key_set ? '#94a3b8' : '#f59e0b';
    }
    if (displayWebhookSecret) {
      displayWebhookSecret.textContent = cfg.webhook_secret_set ? '••••••••' : 'Not configured';
      displayWebhookSecret.style.color = cfg.webhook_secret_set ? '#94a3b8' : '#f59e0b';
    }
    if (displayUpdatedAt) {
      displayUpdatedAt.textContent = cfg.updated_at ? new Date(cfg.updated_at).toLocaleString() : '--';
    }

    // Set form controls
    const modeSelect = document.getElementById('gatewayModeSelect');
    const nameInput = document.getElementById('gatewayNameInput');
    const keyInput = document.getElementById('gatewayApiKeyInput');
    const secretInput = document.getElementById('gatewayWebhookSecretInput');

    if (modeSelect) modeSelect.value = mode;
    if (nameInput) nameInput.value = cfg.gateway_name || 'SIMULATED_GATEWAY_STUB';
    if (keyInput) keyInput.value = '';
    if (secretInput) secretInput.value = '';

  } catch (err) {
    console.error('Error loading gateway config:', err);
    toasts.show('Network error loading gateway config', 'error');
  }
}

async function saveGatewayConfigUI() {
  const mode = document.getElementById('gatewayModeSelect')?.value || 'sandbox';
  const gateway_name = document.getElementById('gatewayNameInput')?.value?.trim() || 'SIMULATED_GATEWAY_STUB';
  const api_key = document.getElementById('gatewayApiKeyInput')?.value?.trim();
  const webhook_secret = document.getElementById('gatewayWebhookSecretInput')?.value?.trim();

  if (mode === 'live') {
    const confirmed = confirm('WARNING: You are about to configure the Payment Gateway for LIVE mode. All subsequent transactions will target live production rails. Do you wish to proceed?');
    if (!confirmed) return;
  }

  const payload = { mode, gateway_name };
  if (api_key) payload.api_key = api_key;
  if (webhook_secret) payload.webhook_secret = webhook_secret;

  const btn = document.getElementById('btnSaveGatewayConfig');
  if (btn) btn.disabled = true;

  try {
    const res = await apiCall('/api/superadmin/gateway/config', 'PATCH', payload);
    if (!res.ok) {
      toasts.show(res.data?.error || 'Failed to update gateway configuration', 'error');
      return;
    }

    toasts.show('Gateway configuration updated successfully', 'success');
    await loadGatewayConfig();
  } catch (err) {
    console.error('Error saving gateway config:', err);
    toasts.show('Network error while saving gateway config', 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function testGatewayConnectionUI() {
  const banner = document.getElementById('gatewayTestResultBanner');
  const btn = document.getElementById('btnTestGatewayConnection');
  if (btn) btn.disabled = true;

  try {
    const res = await apiCall('/api/superadmin/gateway/test', 'POST');
    if (!res.ok) {
      toasts.show(res.data?.error || 'Gateway test failed', 'error');
      if (banner) {
        banner.style.display = 'block';
        banner.style.background = 'rgba(239,68,68,0.12)';
        banner.style.color = '#fca5a5';
        banner.style.border = '1px solid #ef4444';
        banner.textContent = `Gateway Connection Failed: ${res.data?.error || 'Network error'}`;
      }
      return;
    }

    const d = res.data;
    toasts.show(`Gateway Ping Successful: ${d.latency_ms}ms`, 'success');
    if (banner) {
      banner.style.display = 'block';
      banner.style.background = 'rgba(16,185,129,0.12)';
      banner.style.color = '#6ee7b7';
      banner.style.border = '1px solid #10b981';
      banner.textContent = `Ping Success! Latency: ${d.latency_ms}ms | Mode: ${d.mode?.toUpperCase()} | Timestamp: ${d.timestamp}`;
    }
  } catch (err) {
    toasts.show('Error testing gateway connection: ' + err.message, 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

// Data Governance Handlers
async function loadGovernanceMembers() {
  try {
    const res = await apiCall('/api/superadmin/members?order=asc');
    if (!res.ok) {
      toasts.show('Failed to fetch members for data governance', 'error');
      return;
    }

    allGovernanceMembers = res.data || [];
    const select = document.getElementById('governanceMemberSelect');
    const modalSelect = document.getElementById('govModalUserSelect');

    if (select) {
      const currentVal = select.value;
      select.innerHTML = '<option value="">Choose a member to inspect governance ledger...</option>';
      allGovernanceMembers.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.textContent = `${m.name || 'Unknown'} (${m.email}) — [${m.status || 'active'}]`;
        select.appendChild(opt);
      });
      if (currentVal) select.value = currentVal;
    }

    if (modalSelect) {
      modalSelect.innerHTML = '<option value="">Select a member...</option>';
      allGovernanceMembers.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.textContent = `${m.name || 'Unknown'} (${m.email})`;
        modalSelect.appendChild(opt);
      });
    }

    if (selectedGovernanceUserId) {
      loadGovernanceHistory(selectedGovernanceUserId);
    }
  } catch (err) {
    console.error('Error loading governance members:', err);
  }
}

async function loadGovernanceHistory(userId) {
  selectedGovernanceUserId = userId;
  const tbody = document.getElementById('governanceTableBody');
  const badge = document.getElementById('governanceMemberStatusBadge');
  const btnBlock = document.getElementById('btnBlockMember');
  const btnUnblock = document.getElementById('btnUnblockMember');

  if (!userId) {
    if (tbody) tbody.innerHTML = '<tr><td colspan="5" class="sa-loading-cell">Select a member above to inspect append-only governance ledger.</td></tr>';
    if (badge) badge.style.display = 'none';
    if (btnBlock) btnBlock.disabled = true;
    if (btnUnblock) btnUnblock.disabled = true;
    return;
  }

  const member = allGovernanceMembers.find(m => m.id === userId);
  const isSuspended = member?.status === 'suspended';

  if (badge) {
    badge.style.display = 'inline-block';
    badge.textContent = (member?.status || 'active').toUpperCase();
    badge.className = `sa-badge ${isSuspended ? 'sa-badge-danger' : 'sa-badge-success'}`;
    if (isSuspended) {
      badge.style.background = 'rgba(239, 68, 68, 0.15)';
      badge.style.color = '#ef4444';
      badge.style.borderColor = '#ef4444';
    } else {
      badge.style.background = 'rgba(16, 185, 129, 0.15)';
      badge.style.color = '#10b981';
      badge.style.borderColor = '#10b981';
    }
  }

  if (btnBlock) btnBlock.disabled = isSuspended;
  if (btnUnblock) btnUnblock.disabled = !isSuspended;

  if (tbody) tbody.innerHTML = '<tr><td colspan="5" class="sa-loading-cell">Loading append-only governance entries...</td></tr>';

  try {
    const res = await apiCall(`/api/superadmin/governance/${userId}`);
    if (!res.ok) {
      if (tbody) tbody.innerHTML = `<tr><td colspan="5" class="sa-loading-cell" style="color:var(--sa-danger)">${res.data?.error || 'Failed to fetch governance history'}</td></tr>`;
      return;
    }

    const rows = res.data || [];
    if (rows.length === 0) {
      if (tbody) tbody.innerHTML = '<tr><td colspan="5" class="sa-loading-cell" style="color:var(--sa-text-muted)">No governance entries recorded yet for this member.</td></tr>';
      return;
    }

    if (tbody) {
      tbody.innerHTML = rows.map(r => {
        const actionBadgeClass = r.action.includes('restrict') || r.action.includes('revoked')
          ? 'color:#ef4444; background:rgba(239,68,68,0.1); border:1px solid rgba(239,68,68,0.3);'
          : 'color:#10b981; background:rgba(16,185,129,0.1); border:1px solid rgba(16,185,129,0.3);';

        const revertedBadge = r.reverted === 1
          ? '<span style="color:#f59e0b; font-size:11px; font-weight:600;">Reverted</span>'
          : '<span style="color:#6ee7b7; font-size:11px; font-weight:600;">Active</span>';

        const requester = r.requested_by_name ? `${escapeHtml(r.requested_by_name)}` : escapeHtml(r.requested_by);

        return `
          <tr>
            <td>
              <span style="font-family:monospace; font-size:12px; padding:3px 8px; border-radius:4px; ${actionBadgeClass}">
                ${escapeHtml(r.action)}
              </span>
            </td>
            <td>
              <div style="font-size:13px; font-weight:500; color:#fff;">${requester}</div>
              <div style="font-size:11px; color:var(--sa-text-muted);">${escapeHtml(r.requested_by_email || '')}</div>
            </td>
            <td style="font-size:13px; color:var(--sa-text-bright); max-width:320px; white-space:pre-wrap;">${escapeHtml(r.notes || '—')}</td>
            <td>${revertedBadge}</td>
            <td style="font-size:12px; color:var(--sa-text-dim);">${new Date(r.created_at).toLocaleString()}</td>
          </tr>
        `;
      }).join('');
    }

  } catch (err) {
    console.error('Error fetching governance entries:', err);
    if (tbody) tbody.innerHTML = '<tr><td colspan="5" class="sa-loading-cell" style="color:var(--sa-danger)">Network error while loading governance log.</td></tr>';
  }
}

async function blockMemberUI(userIdToBlock) {
  const userId = userIdToBlock || selectedGovernanceUserId;
  if (!userId) {
    toasts.show('Please select a member to restrict', 'error');
    return;
  }

  const member = allGovernanceMembers.find(m => m.id === userId);
  const name = member ? member.name : userId;

  const confirmed = confirm(`Are you sure you want to enforce platform restriction and suspend member "${name}"? This will terminate active sessions and restrict account access.`);
  if (!confirmed) return;

  try {
    const res = await apiCall(`/api/superadmin/governance/${userId}/block`, 'POST');
    if (!res.ok) {
      toasts.show(res.data?.error || 'Failed to enforce member restriction', 'error');
      return;
    }

    toasts.show(`Member ${name} restricted and suspended successfully`, 'success');
    await loadGovernanceMembers();
    await loadGovernanceHistory(userId);
  } catch (err) {
    toasts.show('Error blocking member: ' + err.message, 'error');
  }
}

async function unblockMemberUI(userIdToUnblock) {
  const userId = userIdToUnblock || selectedGovernanceUserId;
  if (!userId) {
    toasts.show('Please select a member to unblock', 'error');
    return;
  }

  const member = allGovernanceMembers.find(m => m.id === userId);
  const name = member ? member.name : userId;

  const confirmed = confirm(`Are you sure you want to lift restrictions and restore account "${name}" to active status?`);
  if (!confirmed) return;

  try {
    const res = await apiCall(`/api/superadmin/governance/${userId}/unblock`, 'POST');
    if (!res.ok) {
      toasts.show(res.data?.error || 'Failed to lift member restriction', 'error');
      return;
    }

    toasts.show(`Restrictions lifted for ${name}. Account restored to active status`, 'success');
    await loadGovernanceMembers();
    await loadGovernanceHistory(userId);
  } catch (err) {
    toasts.show('Error unblocking member: ' + err.message, 'error');
  }
}

function openAddGovernanceModal(preselectedUserId) {
  const modal = document.getElementById('modalAddGovernance');
  const userSelect = document.getElementById('govModalUserSelect');
  const notesInput = document.getElementById('govModalNotesInput');
  const actionSelect = document.getElementById('govModalActionSelect');

  if (userSelect && (preselectedUserId || selectedGovernanceUserId)) {
    userSelect.value = preselectedUserId || selectedGovernanceUserId;
  }
  if (notesInput) notesInput.value = '';
  if (actionSelect) actionSelect.value = 'consent_given';
  if (modal) modal.style.display = 'flex';
}

function closeAddGovernanceModal() {
  const modal = document.getElementById('modalAddGovernance');
  if (modal) modal.style.display = 'none';
}

async function submitAddGovernanceUI() {
  const userId = document.getElementById('govModalUserSelect')?.value;
  const action = document.getElementById('govModalActionSelect')?.value;
  const notes = document.getElementById('govModalNotesInput')?.value?.trim() || '';

  if (!userId) {
    toasts.show('Please select a target member', 'error');
    return;
  }
  if (!action) {
    toasts.show('Please select a governance action', 'error');
    return;
  }

  const btn = document.getElementById('btnSubmitAddGovernance');
  if (btn) btn.disabled = true;

  try {
    const res = await apiCall(`/api/superadmin/governance/${userId}`, 'POST', { action, notes });
    if (!res.ok) {
      toasts.show(res.data?.error || 'Failed to commit governance entry', 'error');
      return;
    }

    toasts.show('Regulatory governance record appended successfully', 'success');
    closeAddGovernanceModal();
    const sel = document.getElementById('governanceMemberSelect');
    if (sel) sel.value = userId;
    await loadGovernanceHistory(userId);
  } catch (err) {
    toasts.show('Error saving governance entry: ' + err.message, 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

function exportGovernanceCSV() {
  if (!selectedGovernanceUserId) {
    toasts.show('Please select a member first to export governance ledger', 'info');
    return;
  }
  window.open(`/api/superadmin/members/export?user_id=${selectedGovernanceUserId}`, '_blank');
}

// Global window exposures for inline onclick handlers in generated table markup
window.openTicketThread = openTicketThread;
window.openKillIdeaModal = openKillIdeaModal;
window.openRestoreIdeaModal = openRestoreIdeaModal;
window.openDisputeDetail = openDisputeDetail;
window.blockMemberUI = blockMemberUI;
window.unblockMemberUI = unblockMemberUI;

// 10. Initialize Admin Profile info in sidebar
function initAdminInfo() {
  const nameEl = document.getElementById('adminName');
  const emailEl = document.getElementById('adminEmail');
  const avatarEl = document.getElementById('adminAvatarInitial');

  if (nameEl) nameEl.textContent = currentUser.name || 'System Administrator';
  if (emailEl) emailEl.textContent = currentUser.email || 'admin@mahitechgroup.com';
  if (avatarEl) {
    const initial = (currentUser.name || 'A').charAt(0).toUpperCase();
    avatarEl.textContent = initial;
  }
}

// 11. Bootstrap on DOMContentLoaded
document.addEventListener('DOMContentLoaded', () => {
  initAdminInfo();
  initNavigation();
  initEventListeners();
  loadOverviewMetrics();

  const refreshBtn = document.getElementById('btnRefreshOverview');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      loadOverviewMetrics();
      toasts.show('Command Center metrics refreshed', 'info');
    });
  }
});

