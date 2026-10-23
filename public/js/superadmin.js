/**
 * MAHI TECH GROUP — SUPER ADMIN PANEL CONTROLLER (STEP 14)
 * Elevated Privilege Layer (Deep Indigo Theme)
 */

// 1. Immediate Synchronous Role Guard
const currentUser = JSON.parse(localStorage.getItem('user') || '{}');
const authToken = localStorage.getItem('token');

if (!currentUser || currentUser.role !== 'admin') {
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
      toasts.show('Dispute Resolution Center scheduled for Layer 4 implementation.', 'info');
    });
  }

  if (blockBtn) {
    blockBtn.addEventListener('click', () => {
      toasts.show('Data Governance & Member Eviction scheduled for Layer 5 implementation.', 'info');
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

// Global window exposure for inline onclick handlers in generated table markup
window.openTicketThread = openTicketThread;
window.openKillIdeaModal = openKillIdeaModal;
window.openRestoreIdeaModal = openRestoreIdeaModal;

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

