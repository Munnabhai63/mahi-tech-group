/**
 * MAHI TECH GROUP - Unified Network Offline & Connectivity Handler
 * Listens for online/offline events, manages global offline banner,
 * disables/enables forms with accessible tooltips.
 */

(function initOfflineHandler() {
  if (typeof window === 'undefined') return;

  function updateNetworkState(isOnline) {
    let banner = document.querySelector('#offline-banner');

    if (!isOnline) {
      if (!banner) {
        banner = document.createElement('div');
        banner.id = 'offline-banner';
        banner.className = 'offline-banner';
        banner.setAttribute('role', 'alert');
        banner.setAttribute('aria-live', 'assertive');
        banner.innerHTML = `
          <span class="offline-icon">⚡</span>
          <span>You are currently offline. Live operations and changes cannot be saved until connection is restored.</span>
        `;
        document.body.prepend(banner);
      }

      // Disable forms with tooltip
      document.querySelectorAll('form button[type="submit"], form input[type="submit"]').forEach(btn => {
        if (!btn.disabled) {
          btn.dataset.offlineDisabled = 'true';
          btn.dataset.prevTitle = btn.getAttribute('title') || '';
          btn.disabled = true;
          btn.setAttribute('title', 'Cannot submit while offline');
        }
      });
    } else {
      if (banner) {
        banner.remove();
      }

      // Re-enable previously disabled forms
      document.querySelectorAll('[data-offline-disabled="true"]').forEach(btn => {
        btn.disabled = false;
        if (btn.dataset.prevTitle) {
          btn.setAttribute('title', btn.dataset.prevTitle);
        } else {
          btn.removeAttribute('title');
        }
        delete btn.dataset.offlineDisabled;
        delete btn.dataset.prevTitle;
      });

      if (typeof window.showToast === 'function') {
        window.showToast('Network connection restored.', 'success');
      } else if (typeof window.toast === 'function') {
        window.toast('Network connection restored.', 'success');
      }
    }
  }

  window.addEventListener('offline', () => updateNetworkState(false));
  window.addEventListener('online', () => updateNetworkState(true));

  // Initial check on load
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => updateNetworkState(false));
    } else {
      updateNetworkState(false);
    }
  }

  window.updateNetworkState = updateNetworkState;
})();
