import { state, escapeHTML, titleCase, statusTone } from './store.js';

export const icon = (name, className = '') => `<svg class="icon ${className}" aria-hidden="true" focusable="false"><use href="#i-${name}"></use></svg>`;
export const badge = (label, tone = statusTone(label), extra = '') => `<span class="badge badge--${tone} ${extra}">${escapeHTML(titleCase(label))}</span>`;
export const plainBadge = (label, tone = 'neutral') => `<span class="badge badge--${tone} badge--no-dot">${escapeHTML(label)}</span>`;
export function avatar(user, size = '', status = false) {
  if (!user) return '<span class="avatar avatar--sm">?</span>';
  return `<span class="avatar ${size ? `avatar--${size}` : ''}" style="--avatar-bg:${user.color || '#dfe4d4'}" aria-hidden="true">${escapeHTML(user.initials)}${status ? '<i class="avatar__status"></i>' : ''}</span>`;
}
export function person(user, subtitle = '', size = 'sm') {
  return `<div class="person">${avatar(user, size)}<div class="person__meta"><strong>${escapeHTML(user?.name || 'Unassigned')}</strong><span>${escapeHTML(subtitle || (user ? titleCase(user.role) : 'No assignee'))}</span></div></div>`;
}
export const progress = (value, label = '', tone = '') => `${label ? `<div class="progress-label"><span>${escapeHTML(label)}</span><strong>${Number(value)}%</strong></div>` : ''}<div class="progress ${tone ? `progress--${tone}` : ''}" role="progressbar" aria-label="${escapeHTML(label || 'Progress')}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Number(value)}"><span style="width:${Math.max(0, Math.min(100, Number(value) || 0))}%"></span></div>`;
export function statCard(label, value, note, iconName = 'activity', accent = false) {
  return `<article class="stat-card ${accent ? 'stat-card--accent' : ''}"><div class="stat-card__top"><span>${escapeHTML(label)}</span>${icon(iconName)}</div><div class="stat-card__value">${value}</div><div class="stat-card__note">${escapeHTML(note)}</div></article>`;
}
export function pageHead(eyebrow, title, description = '', actions = '', compact = false) {
  return `<header class="page-head ${compact ? 'page-head--compact' : ''}"><div class="page-head__copy"><div class="eyebrow">${escapeHTML(eyebrow)}</div><h1>${title}</h1>${description ? `<p>${description}</p>` : ''}</div>${actions ? `<div class="page-head__actions">${actions}</div>` : ''}</header>`;
}
export function card({ title = '', subtitle = '', actions = '', body = '', footer = '', classes = '', flush = false }) {
  return `<section class="card ${flush ? 'card--flush' : 'card--pad'} ${classes}">${title || actions ? `<div class="card-head ${flush ? '' : 'card-head--no-line'}" ${flush ? '' : 'style="padding:0 0 16px"'}><div>${title ? `<h2>${title}</h2>` : ''}${subtitle ? `<p>${subtitle}</p>` : ''}</div>${actions ? `<div class="card-head__actions">${actions}</div>` : ''}</div>` : ''}<div class="${flush ? 'card-body' : ''}">${body}</div>${footer ? `<div class="card-foot">${footer}</div>` : ''}</section>`;
}
export const notice = (text, tone = 'info', title = '', iconName = 'info') => `<div class="notice notice--${tone}">${icon(iconName)}<div>${title ? `<strong>${title}</strong>` : ''}<p>${text}</p></div></div>`;
export function emptyState(title = 'Nothing here yet', description = 'There is no information to display in this view.', action = '', iconName = 'archive') {
  return `<div class="empty-state"><span class="empty-state__icon">${icon(iconName, 'icon--lg')}</span><h3>${escapeHTML(title)}</h3><p>${escapeHTML(description)}</p>${action}</div>`;
}
export function errorState(title = 'This view could not be loaded', description = 'This is a simulated service error for frontend verification. No request was sent.') {
  return `<div class="error-state">${icon('alert', 'icon--lg')}<div><h3>${escapeHTML(title)}</h3><p>${escapeHTML(description)}</p></div><button class="btn btn--outline btn--sm" data-action="clear-preview">${icon('refresh', 'icon--sm')} Retry</button></div>`;
}
export function loadingState(label = 'Loading workspace') {
  return `<div aria-busy="true" aria-label="${escapeHTML(label)}"><span class="sr-only">${escapeHTML(label)}</span><div class="stat-grid mb-2">${Array(4).fill('<div class="skeleton skeleton-block"></div>').join('')}</div><div class="loading-grid"><div class="card card--pad"><div class="loading-lines"><span class="skeleton"></span><span class="skeleton"></span><span class="skeleton"></span></div><div class="skeleton skeleton-block mt-2"></div></div><div class="card card--pad"><div class="loading-lines"><span class="skeleton"></span><span class="skeleton"></span><span class="skeleton"></span></div><div class="skeleton skeleton-block mt-2"></div></div><div class="card card--pad"><div class="loading-lines"><span class="skeleton"></span><span class="skeleton"></span><span class="skeleton"></span></div><div class="skeleton skeleton-block mt-2"></div></div></div></div>`;
}
export function withPreview(content, empty = {}) {
  if (state.ui.preview === 'loading') return loadingState();
  if (state.ui.preview === 'error') return errorState();
  if (state.ui.preview === 'empty') return emptyState(empty.title || 'No records in this preview', empty.description || 'The empty-state preview hides mock records without changing any data.', empty.action || '', empty.icon || 'archive');
  return content;
}

let lastDialogTrigger = null;
export function openDialog({ title, subtitle = '', content = '', footer = '', wide = false, onMount = null }) {
  const dialog = document.querySelector('#app-dialog');
  lastDialogTrigger = document.activeElement;
  dialog.classList.toggle('app-dialog--wide', wide);
  document.querySelector('#dialog-content').innerHTML = `<div class="dialog-head"><div><h2 id="dialog-title">${title}</h2>${subtitle ? `<p>${subtitle}</p>` : ''}</div><button type="button" class="btn btn--ghost btn--icon btn--sm dialog-close" data-close-dialog aria-label="Close dialog">${icon('x')}</button></div><div class="dialog-body">${content}</div>${footer ? `<div class="dialog-foot">${footer}</div>` : ''}`;
  if (!dialog.open) dialog.showModal();
  document.body.classList.add('is-locked');
  requestAnimationFrame(() => {
    const autofocus = dialog.querySelector('[autofocus]') || dialog.querySelector('input:not([type=hidden]), select, textarea') || dialog.querySelector('button');
    autofocus?.focus({ preventScroll: true });
    if (onMount) onMount(dialog);
  });
  return dialog;
}
export function closeDialog() {
  const dialog = document.querySelector('#app-dialog');
  if (dialog.open) dialog.close();
  if (!document.querySelector('#drawer-root')?.innerHTML) document.body.classList.remove('is-locked');
  if (lastDialogTrigger?.isConnected) lastDialogTrigger.focus({ preventScroll: true });
}
export function confirmDialog({ title, message, confirmLabel = 'Confirm', tone = 'primary', detail = '' }) {
  return new Promise(resolve => {
    openDialog({
      title: escapeHTML(title),
      content: `${notice(escapeHTML(message), tone === 'danger' ? 'danger' : 'warning')}${detail ? `<div class="mt-2 small muted">${detail}</div>` : ''}`,
      footer: `<button class="btn btn--outline" data-confirm="false">Cancel</button><button class="btn ${tone === 'danger' ? 'btn--danger' : 'btn--primary'}" data-confirm="true">${escapeHTML(confirmLabel)}</button>`,
      onMount(dialog) {
        dialog.querySelectorAll('[data-confirm]').forEach(button => button.addEventListener('click', () => { const result = button.dataset.confirm === 'true'; closeDialog(); resolve(result); }, { once: true }));
      }
    });
  });
}

let lastDrawerTrigger = null;
let drawerKeyHandler = null;
export function openDrawer({ title, subtitle = '', content = '', footer = '', wide = false, onMount = null }) {
  closeDrawer(false);
  lastDrawerTrigger = document.activeElement;
  const root = document.querySelector('#drawer-root');
  root.innerHTML = `<div class="drawer-overlay" data-close-drawer></div><section class="drawer ${wide ? 'drawer--wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="drawer-title"><div class="drawer__head"><div><h2 id="drawer-title">${title}</h2>${subtitle ? `<p>${subtitle}</p>` : ''}</div><button class="btn btn--ghost btn--icon btn--sm" data-close-drawer aria-label="Close drawer">${icon('x')}</button></div><div class="drawer__body">${content}</div>${footer ? `<div class="drawer__foot">${footer}</div>` : ''}</section>`;
  document.body.classList.add('is-locked');
  document.querySelector('#app').setAttribute('inert', '');
  const drawer = root.querySelector('.drawer');
  drawerKeyHandler = event => {
    if (document.querySelector('#app-dialog')?.open) return;
    if (event.key === 'Escape') { event.preventDefault(); closeDrawer(); }
    if (event.key === 'Tab') {
      const focusable = [...drawer.querySelectorAll('a[href],button:not([disabled]),input,select,textarea,[tabindex="0"]')];
      if (!focusable.length) return;
      const first = focusable[0], last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  };
  document.addEventListener('keydown', drawerKeyHandler);
  root.querySelectorAll('[data-close-drawer]').forEach(element => element.addEventListener('click', () => closeDrawer()));
  requestAnimationFrame(() => { drawer.querySelector('button, input, a[href]')?.focus(); if (onMount) onMount(drawer); });
  return drawer;
}
export function closeDrawer(restoreFocus = true) {
  const root = document.querySelector('#drawer-root');
  if (!root.innerHTML) return;
  root.innerHTML = '';
  document.querySelector('#app').removeAttribute('inert');
  if (!document.querySelector('#app-dialog').open) document.body.classList.remove('is-locked');
  if (drawerKeyHandler) document.removeEventListener('keydown', drawerKeyHandler);
  drawerKeyHandler = null;
  if (restoreFocus && lastDrawerTrigger?.isConnected) lastDrawerTrigger.focus({ preventScroll: true });
}

export function toast(message, type = 'success', duration = 4500) {
  const region = document.querySelector('#toast-region');
  const element = document.createElement('div');
  element.className = `toast toast--${type}`;
  element.setAttribute('role', type === 'error' ? 'alert' : 'status');
  element.innerHTML = `${icon(type === 'error' ? 'alert' : type === 'info' ? 'info' : 'check')}<span>${escapeHTML(message)}</span><button aria-label="Dismiss notification">${icon('x', 'icon--sm')}</button>`;
  region.append(element);
  while (region.children.length > 3) region.firstElementChild.remove();
  const remove = () => element.remove();
  element.querySelector('button').addEventListener('click', remove);
  setTimeout(remove, duration);
}

export function formValues(form) {
  return Object.fromEntries(new FormData(form).entries());
}
export function setFormError(form, message, fieldName = null) {
  form.querySelectorAll('.field-error').forEach(error => error.remove());
  form.querySelectorAll('[aria-invalid]').forEach(field => field.removeAttribute('aria-invalid'));
  const error = document.createElement('div');
  error.className = 'field-error'; error.setAttribute('role', 'alert'); error.textContent = message;
  if (fieldName && form.elements[fieldName]) {
    const field = form.elements[fieldName]; field.setAttribute('aria-invalid', 'true'); field.closest('.field')?.append(error); field.focus();
  } else form.prepend(error);
}
export function showPlaceholder(title, description) {
  openDialog({ title: escapeHTML(title), subtitle: 'Frontend-only service boundary', content: notice(escapeHTML(description), 'info', 'No service request was sent', 'info'), footer: '<button class="btn btn--primary" data-close-dialog>Understood</button>' });
}

export function bindTabs(root = document) {
  root.querySelectorAll('[data-tabs]').forEach(tablist => {
    if (tablist.dataset.bound) return;
    tablist.dataset.bound = 'true';
    const scope = tablist.closest('[data-tab-scope]') || tablist.parentElement;
    const panels = [...scope.querySelectorAll(':scope > [data-tab-panel], :scope > * > [data-tab-panel]')];
    tablist.querySelectorAll('[data-tab]').forEach((tab, index) => {
      tab.setAttribute('role', 'tab'); tab.tabIndex = tab.getAttribute('aria-selected') === 'true' ? 0 : -1;
      if (!tab.id) tab.id = `tab-${Math.random().toString(36).slice(2, 9)}`;
      const panel = panels.find(item => item.dataset.tabPanel === tab.dataset.tab);
      if (panel) { panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-labelledby', tab.id); }
    });
    tablist.addEventListener('click', event => {
      const tab = event.target.closest('[data-tab]');
      if (!tab) return;
      tablist.querySelectorAll('[data-tab]').forEach(item => { item.setAttribute('aria-selected', String(item === tab)); item.tabIndex = item === tab ? 0 : -1; });
      scope.querySelectorAll(':scope > [data-tab-panel], :scope > * > [data-tab-panel]').forEach(panel => { panel.hidden = panel.dataset.tabPanel !== tab.dataset.tab; });
    });
    tablist.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      const tabs = [...tablist.querySelectorAll('[data-tab]')];
      const current = tabs.indexOf(document.activeElement);
      if (current < 0) return;
      event.preventDefault();
      let next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      tabs[next].focus(); tabs[next].click();
    });
  });
}

export function renderBackendError(title = 'Backend Service Unavailable', message = 'Unable to connect to the live backend server. All operational and financial records require an active server connection.') {
  return `
    <section class="card card--pad" style="border-left: 4px solid var(--danger, #e53e3e); margin: 2rem 0; background: rgba(229, 62, 62, 0.05);">
      <div style="display:flex;align-items:flex-start;gap:1rem;">
        <span class="notification-item__icon" style="color:var(--danger, #e53e3e);font-size:1.5rem;">${icon('alert')}</span>
        <div style="flex:1;">
          <h2 style="font:600 20px var(--font-display);margin:0 0 0.5rem 0;color:var(--text, #111);">${escapeHTML(title)}</h2>
          <p class="muted" style="margin:0 0 1rem 0;">${escapeHTML(message)}</p>
          <div style="display:flex;gap:0.75rem;">
            <button class="btn btn--outline" data-action="retry-route">${icon('refresh')} Retry Connection</button>
            <a class="btn btn--ghost" href="#/login">Return to Sign In</a>
          </div>
        </div>
      </div>
    </section>
  `;
}
