import { state, currentUser, persistData, unreadNotifications, escapeHTML, formatDateTime, relativeTime } from './store.js';
import { icon, plainBadge } from './ui.js';

export function notificationPriority(note) {
  if (note?.priority === 'critical' || note?.priority === 'normal') return note.priority;
  if (['wallet', 'offboarding', 'account'].includes(note?.type)) return 'critical';
  return /\b(rejected|revise|revision|frozen|offboard(?:ed|ing)?|urgent|high-priority|settlement|suspended)\b/i.test(note?.message || '') ? 'critical' : 'normal';
}
export function notificationIcon(type) {
  return ({ meeting: 'video', vote: 'vote', support: 'support', signature: 'pen', wallet: 'wallet', revenue: 'wallet', idea: 'bulb', account: 'user', offboarding: 'archive', task: 'check-square' })[type] || 'bell';
}
export function highPriorityVisualEnabled(user = currentUser()) {
  return state.data.uiPreferences?.[user?.id]?.highPriorityVisual !== false;
}

export function notificationItemHTML(note, user = currentUser(), { drawer = false } = {}) {
  const unread = !note.readBy.includes(user.id); const priority = notificationPriority(note); const critical = priority === 'critical';
  return `<article class="notification-item ${unread ? 'is-unread' : ''} ${critical && highPriorityVisualEnabled(user) ? 'notification-item--critical' : ''}" data-read="${!unread}" data-notification-id="${note.id}" data-priority="${priority}">
    <span class="notification-item__icon">${icon(notificationIcon(note.type))}</span>
    <div class="list-row__main"><div class="cluster">${critical ? plainBadge('Critical', 'danger') : ''}${note.type ? plainBadge(note.type.replaceAll('_', ' '), 'neutral') : ''}</div><p>${escapeHTML(note.message)}</p><time title="${formatDateTime(note.at)}">${drawer ? relativeTime(note.at) : `${formatDateTime(note.at)} · ${relativeTime(note.at)}`}</time><div class="cluster mt-1"><a class="link-btn small" href="${note.link}" data-notification-link="${note.id}">Open related view</a>${unread ? `<button class="link-btn small" ${drawer ? 'data-drawer-read' : 'data-mark-read'}="${note.id}">${critical ? 'Dismiss / mark read' : 'Mark read'}</button>` : ''}</div></div>
  </article>`;
}

export function groupedNotificationHTML(notes, user = currentUser(), options = {}) {
  if (!notes.length) return '';
  const today = new Date(); const groups = { Today: [], Earlier: [] };
  notes.forEach(note => { const date = new Date(note.at); const isToday = date.getFullYear() === today.getFullYear() && date.getMonth() === today.getMonth() && date.getDate() === today.getDate(); groups[isToday ? 'Today' : 'Earlier'].push(note); });
  return Object.entries(groups).filter(([, items]) => items.length).map(([label, items]) => `<section class="notification-group"><h2 class="notification-group__title">${label} <span>${items.length}</span></h2>${items.map(note => notificationItemHTML(note, user, options)).join('')}</section>`).join('');
}

export function markNotificationRead(note, user = currentUser()) {
  if (!note || !user) return;
  if (!note.readBy.includes(user.id)) note.readBy.push(user.id);
}

export function markNormalNotificationsViewed(user = currentUser(), delay = 900) {
  const candidates = (state.data.notifications || []).filter(note => {
    const visible = note.userId === 'all' || note.userId === user?.id || (note.userId === 'admin' && user?.role === 'admin');
    return visible && notificationPriority(note) === 'normal' && !note.readBy.includes(user?.id);
  });
  if (!candidates.length) return null;
  return setTimeout(() => {
    candidates.forEach(note => {
      if (note.readBy.includes(user.id)) return;
      markNotificationRead(note, user);
      document.querySelectorAll(`[data-notification-id="${note.id}"]`).forEach(element => { element.classList.remove('is-unread'); element.dataset.read = 'true'; });
      document.querySelectorAll(`[data-mark-read="${note.id}"],[data-drawer-read="${note.id}"]`).forEach(button => button.remove());
    });
    persistData();
    const count = unreadNotifications().length;
    document.querySelectorAll('.notification-dot').forEach(badge => { badge.textContent = count > 99 ? '99+' : String(count); badge.hidden = count === 0; badge.setAttribute('aria-label', `${count} unread notifications`); });
  }, delay);
}
