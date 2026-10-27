/**
 * PRD 17 — Batch 4: GitHub Webhook Activity Log Controller (Admin Only)
 * 
 * STRICT RULES:
 * - Server-side Gate: Non-admin users immediately redirected to /legacy-dashboard.html.
 * - Log is strictly read-only: no edits or deletions.
 * - Invalid signature rows must remain visible (crucial security audit trail).
 * - Payload column is never queried or rendered (data privacy & security).
 * - Auto-refresh polls every 30 seconds and prepends new deliveries deduplicated by delivery_id.
 */

(function () {
  'use strict';

  const PAGE_LIMIT = 50;
  let currentOffset = 0;
  let currentTotal = 0;
  let currentFilter = '';
  let knownDeliveryIds = new Set();
  let pollIntervalId = null;

  let currentUser = null;
  const authToken = localStorage.getItem('token') || '';

  // DOM Elements
  const webhookLogTableBody = document.getElementById('webhookLogTableBody');
  const btnLoadMore = document.getElementById('btnLoadMore');
  const logCountLabel = document.getElementById('logCountLabel');
  const btnManualRefresh = document.getElementById('btnManualRefresh');
  const filterBtns = document.querySelectorAll('.filter-btn');

  async function apiFetch(endpoint) {
    const headers = { 'Content-Type': 'application/json' };
    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }

    try {
      const res = await fetch(endpoint, { method: 'GET', headers });
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

  function createLogRow(log) {
    const tr = document.createElement('tr');
    tr.dataset.deliveryId = log.deliveryId || log.id;

    // 1. Time
    const tdTime = document.createElement('td');
    if (log.receivedAt) {
      const dateObj = new Date(log.receivedAt);
      tdTime.textContent = dateObj.toLocaleDateString() + ' ' + dateObj.toLocaleTimeString();
    } else {
      tdTime.textContent = '—';
    }
    tr.appendChild(tdTime);

    // 2. Event Type
    const tdEvent = document.createElement('td');
    const eventBadge = document.createElement('span');
    eventBadge.className = 'event-type-badge';
    eventBadge.textContent = log.eventType || 'unknown';
    tdEvent.appendChild(eventBadge);
    tr.appendChild(tdEvent);

    // 3. Action
    const tdAction = document.createElement('td');
    tdAction.textContent = log.action || '—';
    tr.appendChild(tdAction);

    // 4. Repo
    const tdRepo = document.createElement('td');
    if (log.repoFullName) {
      const repoSpan = document.createElement('span');
      repoSpan.className = 'repo-text';
      repoSpan.textContent = log.repoFullName;
      tdRepo.appendChild(repoSpan);
    } else {
      tdRepo.textContent = '—';
    }
    tr.appendChild(tdRepo);

    // 5. Sender
    const tdSender = document.createElement('td');
    tdSender.textContent = log.senderLogin ? `@${log.senderLogin}` : '—';
    tr.appendChild(tdSender);

    // 6. Signature
    const tdSig = document.createElement('td');
    const sigBadge = document.createElement('span');
    sigBadge.className = 'badge';
    if (log.signatureValid === 1 || log.signatureValid === true) {
      sigBadge.classList.add('badge-valid');
      sigBadge.textContent = '✅ Valid';
    } else {
      sigBadge.classList.add('badge-invalid');
      sigBadge.textContent = '❌ Invalid';
    }
    tdSig.appendChild(sigBadge);
    tr.appendChild(tdSig);

    // 7. Processed
    const tdProcessed = document.createElement('td');
    const procBadge = document.createElement('span');
    procBadge.className = 'badge';

    if (log.processed === 1 || log.processed === true) {
      procBadge.classList.add('badge-done');
      procBadge.textContent = '✅ Done';
    } else if (log.errorMessage) {
      procBadge.classList.add('badge-error');
      procBadge.textContent = '⚠️ Error';
      procBadge.title = log.errorMessage;
    } else {
      procBadge.classList.add('badge-pending');
      procBadge.textContent = '⏳ Pending';
    }
    tdProcessed.appendChild(procBadge);
    tr.appendChild(tdProcessed);

    // 8. Error
    const tdError = document.createElement('td');
    if (log.errorMessage) {
      tdError.textContent = log.errorMessage.length > 50 
        ? log.errorMessage.substring(0, 48) + '...'
        : log.errorMessage;
      tdError.title = log.errorMessage;
      tdError.style.color = 'var(--color-danger)';
      tdError.style.fontSize = '0.8rem';
    } else {
      tdError.textContent = '—';
      tdError.style.color = 'var(--text-muted)';
    }
    tr.appendChild(tdError);

    return tr;
  }

  async function fetchLogs(offset = 0, isAppend = false) {
    let url = `/api/github/settings/webhook-log?limit=${PAGE_LIMIT}&offset=${offset}`;
    if (currentFilter) {
      url += `&eventType=${encodeURIComponent(currentFilter)}`;
    }

    const res = await apiFetch(url);

    if (!res.ok) {
      if (!isAppend && webhookLogTableBody) {
        webhookLogTableBody.innerHTML = `
          <tr>
            <td colspan="8" class="empty-state" style="color:var(--color-danger);">
              Failed to load logs: ${res.data?.error || 'Unauthorized or server error'}
            </td>
          </tr>
        `;
      }
      return;
    }

    const logs = res.data?.logs || [];
    currentTotal = res.data?.total || 0;

    if (!isAppend) {
      knownDeliveryIds.clear();
      if (webhookLogTableBody) webhookLogTableBody.innerHTML = '';
      currentOffset = 0;
    }

    if (logs.length === 0 && !isAppend) {
      if (webhookLogTableBody) {
        webhookLogTableBody.innerHTML = `
          <tr>
            <td colspan="8" class="empty-state">No webhook activity records match the selected filter.</td>
          </tr>
        `;
      }
      if (btnLoadMore) btnLoadMore.style.display = 'none';
      if (logCountLabel) logCountLabel.textContent = 'Showing 0 events';
      return;
    }

    logs.forEach(log => {
      const delivId = log.deliveryId || log.id;
      if (!knownDeliveryIds.has(delivId)) {
        knownDeliveryIds.add(delivId);
        const row = createLogRow(log);
        webhookLogTableBody.appendChild(row);
      }
    });

    currentOffset = offset + logs.length;

    // Update count label
    if (logCountLabel) {
      logCountLabel.textContent = `Showing ${knownDeliveryIds.size} of ${currentTotal} events`;
    }

    // Toggle Load More button
    if (btnLoadMore) {
      if (currentOffset < currentTotal) {
        btnLoadMore.style.display = 'inline-flex';
      } else {
        btnLoadMore.style.display = 'none';
      }
    }
  }

  async function pollNewLogs() {
    let url = `/api/github/settings/webhook-log?limit=10&offset=0`;
    if (currentFilter) {
      url += `&eventType=${encodeURIComponent(currentFilter)}`;
    }

    const res = await apiFetch(url);
    if (!res.ok || !res.data?.logs) return;

    const newLogs = res.data.logs;
    currentTotal = res.data.total || currentTotal;

    // Prepend any new log row not in knownDeliveryIds
    newLogs.reverse().forEach(log => {
      const delivId = log.deliveryId || log.id;
      if (!knownDeliveryIds.has(delivId)) {
        knownDeliveryIds.add(delivId);
        const row = createLogRow(log);
        if (webhookLogTableBody && webhookLogTableBody.firstChild) {
          webhookLogTableBody.insertBefore(row, webhookLogTableBody.firstChild);
        } else if (webhookLogTableBody) {
          webhookLogTableBody.appendChild(row);
        }
      }
    });

    if (logCountLabel) {
      logCountLabel.textContent = `Showing ${knownDeliveryIds.size} of ${currentTotal} events`;
    }
  }

  async function init() {
    // 1. Strict Server Auth Gate: Must be Admin
    const userRes = await apiFetch('/api/users/me');
    if (!userRes.ok || !userRes.data?.user) {
      alert('Authentication required. Redirecting to login.');
      window.location.href = '/index.html#/login';
      return;
    }

    currentUser = userRes.data.user;
    if (currentUser.role !== 'admin') {
      alert('Access Restricted: Admin privileges required to view GitHub webhook audit logs.');
      window.location.href = '/legacy-dashboard.html';
      return;
    }

    // 2. Initial Fetch
    await fetchLogs(0, false);

    // 3. Filter button click handlers
    filterBtns.forEach(btn => {
      btn.addEventListener('click', async () => {
        filterBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentFilter = btn.dataset.filter || '';
        await fetchLogs(0, false);
      });
    });

    // 4. Load More click handler
    btnLoadMore?.addEventListener('click', async () => {
      await fetchLogs(currentOffset, true);
    });

    // 5. Manual refresh click handler
    btnManualRefresh?.addEventListener('click', async () => {
      await fetchLogs(0, false);
    });

    // 6. Auto-refresh: Poll every 30 seconds
    if (pollIntervalId) clearInterval(pollIntervalId);
    pollIntervalId = setInterval(pollNewLogs, 30000);
  }

  document.addEventListener('DOMContentLoaded', init);
})();
