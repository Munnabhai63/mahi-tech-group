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

      // If switching to overview, refresh metrics
      if (targetPaneId === 'paneOverview') {
        loadOverviewMetrics();
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

// 7. Initialize Admin Profile info in sidebar
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

// 8. Bootstrap on DOMContentLoaded
document.addEventListener('DOMContentLoaded', () => {
  initAdminInfo();
  initNavigation();
  loadOverviewMetrics();

  const refreshBtn = document.getElementById('btnRefreshOverview');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      loadOverviewMetrics();
      toasts.show('Command Center metrics refreshed', 'info');
    });
  }
});
