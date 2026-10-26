import { roleMeta } from './data.js';
import { state, currentUser, getUser, userTasks, pendingVotesFor, visibleNotifications, unreadNotifications, persistData, logout, setPreview, formatDateTime, relativeTime, escapeHTML, titleCase } from './store.js';
import { icon, badge, avatar, person, openDialog, closeDialog, openDrawer, closeDrawer, toast } from './ui.js';
import { api, getAuthToken } from './api.js';
import { groupedNotificationHTML, markNotificationRead, markNormalNotificationsViewed } from './notifications.js';

const memberNav = [
  ['Workspace', [
    ['#/app/dashboard', 'Dashboard', 'grid'], ['#/app/workspace', 'My discipline', 'briefcase'], ['#/app/tasks', 'Task queue', 'check-square', 'tasks'], ['#/app/ai', 'AI review', 'activity']
  ]],
  ['Collaboration', [
    ['#/app/projects', 'Projects', 'folder'], ['#/app/ideas', 'Ideas', 'bulb'], ['#/app/voting', 'Voting', 'vote', 'votes'], ['#/app/meetings', 'Meetings', 'video']
  ]],
  ['Account', [
    ['#/app/notifications', 'Notifications', 'bell', 'notifications'], ['#/app/support', 'Support', 'support'], ['#/app/profile', 'Profile', 'user'], ['#/app/wallet', 'Wallet', 'wallet'], ['#/app/settings', 'Settings', 'settings']
  ]]
];
const adminNav = [
  ['Overview', [['#/admin', 'Admin dashboard', 'grid']]],
  ['Operations', [['#/admin/applications', 'Applications', 'user-plus', 'applications'], ['#/admin/members', 'Members', 'users'], ['#/admin/ideas', 'Idea decisions', 'bulb'], ['#/admin/projects', 'Project gates', 'folder'], ['#/admin/meetings', 'Meeting control', 'video']]],
  ['Finance & lifecycle', [['#/admin/revenue', 'Revenue & payouts', 'wallet', 'payouts'], ['#/admin/offboarding', 'Offboarding', 'archive']]],
  ['System', [['#/admin/config', 'Configuration', 'settings'], ['#/admin/audit', 'Access log', 'clipboard']]]
];
const elevatedNav = [
  ['Command', [['#/superadmin', 'Overview', 'grid']]],
  ['Intelligence', [['#/superadmin/members', 'Member directory', 'users'], ['#/superadmin/performance', 'Performance', 'chart'], ['#/superadmin/support', 'Support operations', 'support', 'support'], ['#/superadmin/ideas', 'Ideation controls', 'bulb']]],
  ['Risk & finance', [['#/superadmin/disputes', 'Disputes & waivers', 'alert', 'disputes'], ['#/superadmin/gateway', 'Gateway controls', 'card', 'payouts'], ['#/superadmin/governance', 'Data governance', 'database']]],
  ['Records', [['#/superadmin/audit', 'Unified audit', 'clipboard']]]
];
const formerNav = [['Former member', [['#/app/former-member', 'Read-only overview', 'lock'], ['#/app/members/u-former', 'Historical profile', 'user'], ['#/app/wallet', 'Wallet history', 'wallet'], ['#/app/notifications', 'Notifications', 'bell', 'notifications']]]];
function countFor(key) {
  const user = currentUser();
  const counts = {
    tasks: userTasks().filter(task => task.status !== 'DONE').length,
    votes: pendingVotesFor().length,
    notifications: unreadNotifications().length,
    applications: state.data.applications.filter(app => app.status === 'pending').length,
    payouts: state.data.withdrawals.filter(item => item.status === 'PENDING').length,
    support: state.data.tickets.filter(ticket => ['open', 'in_progress'].includes(ticket.status)).length,
    disputes: state.data.disputes.filter(dispute => dispute.status !== 'closed').length
  };
  return counts[key] || 0;
}
function activeHref(href, path) {
  const route = href.slice(1);
  if (['#/admin', '#/superadmin', '#/app/dashboard'].includes(href)) return path === route;
  if (href === '#/app/profile') return path === '/app/profile' || path.startsWith('/app/members/');
  return path === route || path.startsWith(`${route}/`);
}
function navigation(path) {
  const user = currentUser();
  const sections = user.status === 'inactive' ? formerNav.map(([label, links]) => [label, links.map(([href, text, iconName, countKey]) => [href.replace('u-former', user.id), text, iconName, countKey])]) : path.startsWith('/superadmin') ? elevatedNav : path.startsWith('/admin') ? adminNav : memberNav;
  return sections.map(([label, links]) => `<div class="nav-label">${label}</div>${links.map(([href, text, iconName, countKey]) => { const active = activeHref(href, path); const count = countKey ? countFor(countKey) : 0; return `<a class="nav-link ${active ? 'is-active' : ''}" href="${href}" ${active ? 'aria-current="page"' : ''}>${icon(iconName)}<span>${text}</span>${countKey && count ? `<span class="nav-link__count" aria-label="${count} items">${count}</span>` : ''}</a>`; }).join('')}`).join('');
}
function titleFor(path) {
  const exact = {
    '/app/dashboard': 'Dashboard', '/app/workspace': 'My discipline', '/app/tasks': 'Task queue', '/app/ai': 'AI review center', '/app/projects': 'Project pipeline', '/app/ideas': 'Ideation', '/app/ideas/new': 'Idea editor', '/app/voting': 'Voting queue', '/app/meetings': 'Meetings', '/app/notifications': 'Notifications', '/app/support': 'Member support', '/app/profile': 'My profile', '/app/wallet': 'Wallet & settlements', '/app/settings': 'Settings', '/app/former-member': 'Former-member history',
    '/admin': 'Admin dashboard', '/admin/applications': 'Applications', '/admin/members': 'Member administration', '/admin/ideas': 'Idea governance', '/admin/projects': 'Project gates', '/admin/revenue': 'Revenue & payouts', '/admin/offboarding': 'Offboarding', '/admin/config': 'Configuration', '/admin/meetings': 'Meeting administration', '/admin/audit': 'Access log',
    '/superadmin': 'Elevated overview', '/superadmin/members': 'Member intelligence', '/superadmin/performance': 'Performance intelligence', '/superadmin/support': 'Support operations', '/superadmin/ideas': 'Ideation controls', '/superadmin/disputes': 'Disputes & waivers', '/superadmin/gateway': 'Gateway controls', '/superadmin/governance': 'Data governance', '/superadmin/audit': 'Unified audit'
  };
  if (exact[path]) return exact[path];
  if (path.startsWith('/app/projects/')) return 'Project detail';
  if (path.startsWith('/app/ideas/')) return 'Idea detail';
  if (path.startsWith('/app/meetings/')) return 'Meeting room';
  if (path.startsWith('/app/coworking/')) return 'Co-working canvas';
  if (path.startsWith('/app/members/')) return 'Member profile';
  if (path.startsWith('/app/support/')) return 'Support thread';
  return 'MAHI workspace';
}
export function shellHTML(view, path) {
  const user = currentUser(); const elevated = path.startsWith('/superadmin'); const admin = path.startsWith('/admin');
  const zone = elevated ? 'Elevated Admin' : admin ? 'Admin operations' : user.status === 'inactive' ? 'Read-only history' : `${roleMeta[user.role]?.label || titleCase(user.role)} workspace`;
  return `<div class="app-shell"><aside class="sidebar ${state.ui.sidebarOpen ? 'is-open' : ''}" id="app-sidebar" aria-label="Application navigation"><div class="sidebar__brand"><a class="access-brand" href="/" aria-label="MAHI TECH GROUP homepage"><span class="brand-mark">M/</span><span class="brand-copy"><strong>MAHI TECH GROUP</strong><span>Collaborative workspace</span></span></a><button class="btn btn--ghost btn--icon btn--sm sidebar__close" id="close-sidebar" aria-label="Close navigation">${icon('x')}</button></div><nav class="sidebar__nav">${navigation(path)}${user.role === 'admin' && !path.startsWith('/admin') && !path.startsWith('/superadmin') ? `<div class="nav-label">Administration</div><a class="nav-link" href="#/admin">${icon('shield')}<span>Admin operations</span></a><a class="nav-link nav-link--elevated" href="#/superadmin">${icon('key')}<span>Elevated zone</span></a>` : ''}${path.startsWith('/admin') || path.startsWith('/superadmin') ? `<div class="nav-label">Switch area</div><a class="nav-link" href="#/app/dashboard">${icon('grid')}<span>Member workspace</span></a>${path.startsWith('/admin') ? `<a class="nav-link nav-link--elevated" href="#/superadmin">${icon('key')}<span>Elevated zone</span></a>` : `<a class="nav-link" href="#/admin">${icon('shield')}<span>Core Admin</span></a>`}` : ''}</nav><div class="sidebar__foot"><a class="sidebar__home" href="/">${icon('home')} MAHI TECH GROUP homepage</a><div class="sidebar__version">FRONTEND INVENTORY · LOCAL MOCK DATA</div></div></aside><button class="mobile-overlay ${state.ui.sidebarOpen ? 'is-open' : ''}" id="sidebar-overlay" aria-label="Close navigation"></button><div class="shell-body"><header class="topbar"><button class="btn btn--outline btn--icon btn--sm topbar__menu" id="open-sidebar" aria-label="Open navigation" aria-controls="app-sidebar" aria-expanded="${state.ui.sidebarOpen}">${icon('menu')}</button><div class="topbar__title"><span class="crumb">${escapeHTML(zone)}</span><strong>${escapeHTML(titleFor(path))}</strong></div><div class="topbar__actions"><span class="prototype-badge">Demo data</span><button class="quick-search" id="quick-search" aria-label="Search workspace">${icon('search')}<span>Quick search</span><kbd>⌘ K</kbd></button><button class="btn btn--outline btn--icon btn--sm notification-btn" data-open-notifications aria-label="Open notifications">${icon('bell', 'icon--sm')}${unreadNotifications().length ? '<span class="notification-dot"></span>' : ''}</button><button class="account-button" id="account-menu" aria-label="Open account menu">${avatar(user, 'sm')}<span class="account-button__copy"><strong>${escapeHTML(user.name)}</strong><span>${escapeHTML(user.subRole || user.role)}</span></span>${icon('chevron-down')}</button></div></header><main class="workspace" id="main-content" tabindex="-1"><div class="prototype-strip">${icon('info')}<span>Frontend-only preview · mutations stay in this browser.</span><label class="sr-only" for="preview-mode">Preview interface state</label><select class="select preview-select" id="preview-mode"><option value="normal" ${state.ui.preview === 'normal' ? 'selected' : ''}>Normal state</option><option value="loading" ${state.ui.preview === 'loading' ? 'selected' : ''}>Loading state</option><option value="empty" ${state.ui.preview === 'empty' ? 'selected' : ''}>Empty state</option><option value="error" ${state.ui.preview === 'error' ? 'selected' : ''}>Error state</option></select></div>${view.html}</main></div></div>`;
}
export function mountShell(path) {
  const sidebar = document.querySelector('#app-sidebar'); const shellBody = document.querySelector('.shell-body'); const openButton = document.querySelector('#open-sidebar'); const closeButton = document.querySelector('#close-sidebar'); const overlay = document.querySelector('#sidebar-overlay'); const media = window.matchMedia('(max-width: 980px)');
  const syncSidebarAccessibility = () => {
    const mobileOpen = media.matches && state.ui.sidebarOpen;
    if (sidebar) { sidebar.inert = media.matches && !mobileOpen; if (media.matches && !mobileOpen) sidebar.setAttribute('aria-hidden', 'true'); else sidebar.removeAttribute('aria-hidden'); }
    if (shellBody) shellBody.inert = mobileOpen;
  };
  const setSidebar = (open, restoreFocus = true) => {
    const wasOpen = state.ui.sidebarOpen; state.ui.sidebarOpen = open;
    sidebar?.classList.toggle('is-open', open); overlay?.classList.toggle('is-open', open); openButton?.setAttribute('aria-expanded', String(open)); syncSidebarAccessibility();
    if (media.matches && open) closeButton?.focus(); else if (media.matches && wasOpen && restoreFocus) openButton?.focus();
  };
  const onKeydown = event => {
    if (event.key === 'Escape' && media.matches && state.ui.sidebarOpen) { event.preventDefault(); setSidebar(false); return; }
    if (event.key !== 'Tab' || !media.matches || !state.ui.sidebarOpen || !sidebar) return;
    const focusable = [...sidebar.querySelectorAll('a[href],button:not([disabled]),select,input,textarea,[tabindex]:not([tabindex="-1"])')].filter(element => !element.hidden);
    const first = focusable[0]; const last = focusable.at(-1); if (!first) return;
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };
  openButton?.addEventListener('click', () => setSidebar(true)); closeButton?.addEventListener('click', () => setSidebar(false)); overlay?.addEventListener('click', () => setSidebar(false));
  document.querySelectorAll('.sidebar__nav a').forEach(link => link.addEventListener('click', () => setSidebar(false, false)));
  document.querySelector('#preview-mode')?.addEventListener('change', event => { setPreview(event.target.value); window.dispatchEvent(new CustomEvent('app:refresh')); });
  document.querySelector('#quick-search')?.addEventListener('click', openQuickSearch);
  document.querySelector('#account-menu')?.addEventListener('click', openAccountDrawer);
  document.addEventListener('keydown', onKeydown); media.addEventListener('change', syncSidebarAccessibility); syncSidebarAccessibility();
  return () => { document.removeEventListener('keydown', onKeydown); media.removeEventListener('change', syncSidebarAccessibility); if (shellBody) shellBody.inert = false; };
}
export function openNotificationsDrawer() {
  const user = currentUser(); if (!user) return; const notes = visibleNotifications();
  openDrawer({
    title: 'Notifications',
    subtitle: `${unreadNotifications().length} unread · Today / Earlier`,
    content: `${notes.length ? groupedNotificationHTML(notes, user, { drawer: true }) : '<div class="empty-state"><h3>No notifications</h3><p>Your workspace is up to date.</p></div>'}`,
    footer: `<a class="btn btn--outline" href="#/app/notifications">Open full inbox</a><button class="btn btn--primary" id="drawer-read-all" ${unreadNotifications().length ? '' : 'disabled'}>Mark all read</button>`,
    onMount(drawer) {
      drawer.querySelectorAll('[data-drawer-read]').forEach(button => button.addEventListener('click', async () => {
        const noteId = button.dataset.drawerRead;
        if (getAuthToken()) {
          try { await api.patch(`/api/notifications/${noteId}/read`); } catch (e) {}
        }
        const note = notes.find(item => item.id === noteId);
        markNotificationRead(note, user);
        persistData();
        closeDrawer();
        toast('Notification marked read.', 'info');
        window.dispatchEvent(new CustomEvent('app:refresh'));
      }));
      drawer.querySelector('#drawer-read-all')?.addEventListener('click', async () => {
        if (getAuthToken()) {
          try { await api.post('/api/notifications/mark-all-read'); } catch (e) {}
        }
        notes.forEach(note => markNotificationRead(note, user));
        persistData();
        closeDrawer();
        toast('All notifications marked read.', 'info');
        window.dispatchEvent(new CustomEvent('app:refresh'));
      });
      markNormalNotificationsViewed(user);
    }
  });
}
function openAccountDrawer() {
  const user = currentUser();
  const token = getAuthToken();
  openDrawer({
    title: token ? 'User Account' : 'Demo account',
    subtitle: token ? 'Authenticated workspace session' : 'Local identity and workspace areas',
    content: `<section class="card card--pad">${person(user, user.email, '')}<div class="cluster mt-2">${badge(user.status)}${badge(user.role, 'neutral')}${user.frozen ? badge('wallet frozen', 'danger') : ''}</div><dl class="definition-list mt-3"><dt>Session</dt><dd>${token ? 'Authenticated JWT' : 'Browser-only demo'}</dd><dt>Authentication</dt><dd>${token ? 'Verified' : 'Not verified'}</dd><dt>Data</dt><dd>${token ? 'Live backend' : 'Local mock fixtures'}</dd></dl></section><div class="stack mt-2"><a class="btn btn--outline btn--full" href="#/app/profile">${icon('user')} Open my profile</a><a class="btn btn--outline btn--full" href="#/app/settings">${icon('settings')} Settings & local cache</a>${user.role === 'admin' ? `<a class="btn btn--outline btn--full" href="#/admin">${icon('shield')} Admin operations</a><a class="btn btn--outline btn--full" href="#/superadmin">${icon('key')} Elevated Admin zone</a>` : ''}<a class="btn btn--ghost btn--full" href="/">${icon('home')} Public homepage</a><button class="btn btn--danger btn--full" id="logout-demo">${icon('log-out')} ${token ? 'Sign out' : 'Log out'}</button></div>`,
    onMount(drawer) {
      drawer.querySelector('#logout-demo').addEventListener('click', async () => {
        closeDrawer();
        await logout();
        location.hash = '#/login';
        toast(token ? 'Signed out successfully.' : 'Session ended.', 'info');
      });
    }
  });
}
function searchItems() {
  const user = currentUser(); const admin = user.role === 'admin';
  const routes = (admin ? [...memberNav, ...adminNav, ...elevatedNav] : memberNav).flatMap(([, links]) => links).map(([href, label, iconName]) => ({ label, meta: 'Workspace screen', href, icon: iconName, search: `${label} screen` }));
  const projects = state.data.projects.filter(project => admin || project.ownerId === user.id || project.tasks.some(task => task.assignedTo === user.id)).map(project => ({ label: project.title, meta: `Project · ${project.code}`, href: `#/app/projects/${project.id}`, icon: 'folder', search: `${project.title} ${project.code}` }));
  const ideas = state.data.ideas.map(idea => ({ label: idea.title, meta: `Idea · ${titleCase(idea.status)}`, href: `#/app/ideas/${idea.id}`, icon: 'bulb', search: `${idea.title} ${idea.status}` }));
  const meetings = state.data.meetings.filter(meeting => admin || meeting.participantIds.includes(user.id)).map(meeting => ({ label: meeting.title, meta: `Meeting · ${titleCase(meeting.status)}`, href: `#/app/meetings/${meeting.id}`, icon: 'video', search: meeting.title }));
  const members = state.data.users.map(member => ({ label: member.name, meta: `Member · ${titleCase(member.role)}`, href: `#/app/members/${member.id}`, icon: 'user', search: `${member.name} ${member.role}` }));
  return [...routes, ...projects, ...ideas, ...meetings, ...members];
}
export function openQuickSearch() {
  if (!currentUser()) return;
  const items = searchItems();
  openDialog({ title: 'Quick search', subtitle: 'Navigate local screens and mock records', wide: true, content: `<div class="field field--search"><label for="command-query">Search workspace</label><div class="input-wrap">${icon('search')}<input class="input" id="command-query" autocomplete="off" placeholder="Screen, project, idea, meeting, or member" autofocus></div></div><div id="command-results" class="stack mt-2"></div>`, onMount(dialog) {
    const input = dialog.querySelector('#command-query'); const results = dialog.querySelector('#command-results');
    const draw = () => { const query = input.value.trim().toLowerCase(); const matches = items.filter(item => !query || `${item.label} ${item.search}`.toLowerCase().includes(query)).slice(0, 12); results.innerHTML = matches.length ? matches.map(item => `<a class="list-row list-row--button" href="${item.href}"><span class="notification-item__icon">${icon(item.icon)}</span><span class="list-row__main"><strong>${escapeHTML(item.label)}</strong><p>${escapeHTML(item.meta)}</p></span>${icon('arrow-up-right', 'icon--sm')}</a>`).join('') : '<div class="empty-state"><h3>No matching records</h3><p>Try a different screen or record name.</p></div>'; };
    input.addEventListener('input', draw); draw();
  } });
}
