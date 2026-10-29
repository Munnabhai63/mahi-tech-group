/**
 * MAHI TECH GROUP - Unified Toast & Notification Service
 * Replaces disruptive alert() calls with beautiful, accessible, stacked toasts.
 */

export function showToast(message, type = 'info', duration = 4000) {
  if (typeof document === 'undefined') return;

  let region = document.querySelector('#toast-region');
  if (!region) {
    region = document.createElement('div');
    region.id = 'toast-region';
    region.className = 'toast-region';
    region.setAttribute('role', 'region');
    region.setAttribute('aria-live', 'polite');
    region.setAttribute('aria-label', 'Notifications');
    document.body.appendChild(region);
  }

  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;
  toast.setAttribute('role', type === 'error' ? 'alert' : 'status');

  const icons = {
    success: '✔',
    error: '✖',
    warning: '⚠',
    info: 'ℹ'
  };

  toast.innerHTML = `
    <span class="toast-icon" aria-hidden="true">${icons[type] || icons.info}</span>
    <span class="toast-msg">${escapeHtml(message)}</span>
    <button class="toast-close" type="button" aria-label="Dismiss notification">&times;</button>
  `;

  region.appendChild(toast);

  while (region.children.length > 3) {
    region.firstElementChild.remove();
  }

  const dismiss = () => {
    toast.classList.add('toast--exit');
    setTimeout(() => toast.remove(), 200);
  };

  toast.querySelector('.toast-close')?.addEventListener('click', dismiss);
  setTimeout(dismiss, duration);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Global hooks so all scripts can access showToast and alert() is safely redirected
if (typeof window !== 'undefined') {
  window.showToast = showToast;
  window.toast = showToast;
  window.alert = function(msg) {
    const isError = typeof msg === 'string' && (
      msg.toLowerCase().includes('failed') || 
      msg.toLowerCase().includes('error') || 
      msg.toLowerCase().includes('denied') || 
      msg.toLowerCase().includes('restricted') ||
      msg.toLowerCase().includes('rejected')
    );
    const isSuccess = typeof msg === 'string' && (
      msg.toLowerCase().includes('success') ||
      msg.toLowerCase().includes('confirmed') ||
      msg.toLowerCase().includes('completed')
    );
    showToast(msg, isError ? 'error' : isSuccess ? 'success' : 'info');
  };
}
