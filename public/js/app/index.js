import { state, currentUser, setPreview, syncDataFromStorage, persistData } from './store.js';
import { getAuthToken } from './api.js';
import { notificationPriority, markNotificationRead } from './notifications.js';
import { icon, notice, pageHead, emptyState, closeDialog, closeDrawer, toast } from './ui.js';
import { shellHTML, mountShell, openNotificationsDrawer, openQuickSearch } from './shell.js';
import { renderLogin, renderRoleSelection, renderSignup, renderApplicationStatus, renderAbout, renderContact, renderLegal } from './views/public.js';
import { renderDashboard, renderWorkspace, renderTasks, renderNotifications, renderProfile, renderWallet, renderSettings, renderSupport, renderTicket, renderFormerMember } from './views/member.js';
import { renderProjects, renderProjectDetail } from './views/projects.js';
import { renderIdeas, renderNewIdea, renderVoting, renderIdeaDetail } from './views/ideas.js';
import { renderMeetings, renderMeetingDetail, renderCoworking } from './views/meetings.js';
import { renderAdminDashboard, renderAdminApplications, renderAdminMembers, renderAdminIdeas, renderAdminProjects, renderAdminRevenue, renderAdminOffboarding, renderAdminConfig, renderAdminMeetings, renderAdminAudit } from './views/admin.js';
import { renderDisputes } from './views/disputes.js';
import { renderSuperadminDashboard, renderSuperadminMembers, renderSuperadminPerformance, renderSuperadminSupport, renderSuperadminIdeas, renderSuperadminGateway, renderSuperadminGovernance, renderSuperadminAudit } from './views/superadmin.js';
import { renderSigning } from './views/signing.js';
import { renderAiCenter } from './views/ai-center.js';

const app = document.querySelector('#app');
let cleanup = null;
let previousPath = null;
let rendering = false;

function route(path, params) {
  if (path === '/login') return renderLogin();
  if (path === '/role-selection') { location.hash = '#/login'; return renderLogin(); }
  if (path === '/signup') return renderSignup();
  if (path === '/application-status') return renderApplicationStatus(params);
  if (path === '/about') return renderAbout();
  if (path === '/contact') return renderContact();
  if (path === '/mentorship') return renderContact(); // Legacy URL: no mentorship product or booking flow.
  if (path === '/legal/terms' || path === '/legal/privacy') return renderLegal(path.endsWith('privacy') ? 'privacy' : 'terms');

  if (path === '/app' || path === '/app/dashboard') return renderDashboard();
  if (path === '/app/workspace') return renderWorkspace();
  if (path === '/app/tasks') return renderTasks();
  if (path === '/app/notifications') return renderNotifications();
  if (path === '/app/ai') return renderAiCenter();
  if (path === '/app/projects') return renderProjects();
  let match = path.match(/^\/app\/projects\/([^/]+)$/); if (match) return renderProjectDetail(match[1]);
  if (path === '/app/ideas') return renderIdeas();
  if (path === '/app/ideas/new') return renderNewIdea(params);
  match = path.match(/^\/app\/ideas\/([^/]+)$/); if (match) return renderIdeaDetail(match[1]);
  if (path === '/app/voting') return renderVoting();
  if (path === '/app/meetings') return renderMeetings();
  match = path.match(/^\/app\/meetings\/([^/]+)$/); if (match) return renderMeetingDetail(match[1]);
  match = path.match(/^\/app\/coworking\/([^/]+)$/); if (match) return renderCoworking(match[1]);
  if (path === '/app/profile') return renderProfile();
  match = path.match(/^\/app\/members\/([^/]+)$/); if (match) return renderProfile(match[1]);
  if (path === '/app/wallet') return renderWallet();
  if (path === '/app/settings') return renderSettings();
  if (path === '/app/support') return renderSupport();
  match = path.match(/^\/app\/support\/([^/]+)$/); if (match) return renderTicket(match[1]);
  if (path === '/app/former-member') return renderFormerMember();

  if (path === '/admin') return renderAdminDashboard();
  if (path === '/admin/applications') return renderAdminApplications();
  if (path === '/admin/members') return renderAdminMembers(params);
  if (path === '/admin/ideas') return renderAdminIdeas();
  if (path === '/admin/projects') return renderAdminProjects();
  if (path === '/admin/revenue') return renderAdminRevenue(params);
  if (path === '/admin/offboarding') return renderAdminOffboarding(params);
  if (path === '/admin/config') return renderAdminConfig(params);
  if (path === '/admin/meetings') return renderAdminMeetings();
  if (path === '/admin/audit') return renderAdminAudit();

  if (path === '/superadmin') return renderSuperadminDashboard();
  if (path === '/superadmin/members') return renderSuperadminMembers();
  if (path === '/superadmin/performance') return renderSuperadminPerformance();
  if (path === '/superadmin/support') return renderSuperadminSupport();
  if (path === '/superadmin/ideas') return renderSuperadminIdeas();
  if (path === '/superadmin/disputes') return renderDisputes();
  if (path === '/superadmin/gateway') return renderSuperadminGateway();
  if (path === '/superadmin/governance') return renderSuperadminGovernance(params);
  if (path === '/superadmin/audit') return renderSuperadminAudit();

  match = path.match(/^\/sign\/(disputes|waivers|agreement|waiver)\/([^/]+)(?:\/([^/]+))?$/);
  if (match) { if (match[3] && !params.has('token')) params.set('token', match[3]); return renderSigning(match[1], match[2], params); }
  return { html: `${pageHead('404 · Route not found', 'This screen is not in the application map.', 'Use the navigation or quick search to return to an implemented workspace screen.')}${emptyState('Unknown application route', 'The route may be incomplete or no longer available.', '<a class="btn btn--primary" href="#/app/dashboard">Return to dashboard</a>', 'search')}` };
}
function isPublic(path) { return ['/login', '/signup', '/application-status', '/about', '/contact', '/mentorship', '/legal/terms', '/legal/privacy'].includes(path); }
function isSigning(path) { return path.startsWith('/sign/'); }
function render() {
  if (rendering) return;
  rendering = true;
  try {
    if (!location.hash) { const user = currentUser(); location.hash = user ? (user.role === 'admin' ? '#/admin' : user.status === 'inactive' ? '#/app/former-member' : '#/app/dashboard') : '#/login'; return; }
    const raw = location.hash.slice(1); const [rawPath, query = ''] = raw.split('?'); const path = (`/${rawPath.replace(/^\/+/, '')}`).replace(/\/$/, '') || '/'; const params = new URLSearchParams(query);
    const user = currentUser();
    const token = getAuthToken();
    if (!isPublic(path) && !isSigning(path) && (!user || !token)) { state.ui.returnTo = location.hash; location.hash = '#/login'; return; }
    if (user && (path.startsWith('/admin') || path.startsWith('/superadmin')) && user.role !== 'admin') { toast('Admin operations require the Admin role.', 'error'); location.hash = user.status === 'inactive' ? '#/app/former-member' : '#/app/dashboard'; return; }
    if (user?.status === 'inactive' && path.startsWith('/app') && !['/app/former-member', `/app/members/${user.id}`, '/app/wallet', '/app/notifications'].includes(path)) { location.hash = '#/app/former-member'; return; }
    if (typeof cleanup === 'function') { try { cleanup(); } catch (error) { console.warn('View cleanup failed', error); } }
    cleanup = null; closeDialog(); closeDrawer(false); state.ui.sidebarOpen = false;
    let view;
    try { view = route(path, params); }
    catch (error) {
      console.error('Route render failed:', path, error);
      view = { html: `${pageHead('Application error', 'This screen could not be rendered.', 'A local frontend error was caught. No backend request was made.')}${notice('Open the browser console for the route error, or retry this route after returning to normal preview mode.', 'danger', 'Render error', 'alert')}<button class="btn btn--outline mt-2" data-action="retry-route">${icon('refresh')} Retry route</button>` };
    }
    const protectedShell = !isPublic(path) && !isSigning(path);
    app.innerHTML = protectedShell ? shellHTML(view, path) : isSigning(path) ? view.html : `<main id="main-content" tabindex="-1">${view.html}</main>`;
    document.title = `${path.startsWith('/superadmin') ? 'Elevated Admin' : path.startsWith('/admin') ? 'Admin' : isSigning(path) ? 'Document review' : path.startsWith('/app') ? 'Workspace' : 'MAHI TECH GROUP'} — MAHI TECH GROUP`;
    const shellCleanup = protectedShell ? mountShell(path) : null;
    let viewCleanup = null;
    if (typeof view.mount === 'function') { const result = view.mount(); if (typeof result === 'function') viewCleanup = result; }
    cleanup = () => { if (typeof shellCleanup === 'function') shellCleanup(); if (typeof viewCleanup === 'function') viewCleanup(); };
    if (previousPath !== path) { window.scrollTo({ top: 0, behavior: 'instant' }); requestAnimationFrame(() => document.querySelector('#main-content')?.focus({ preventScroll: true })); }
    previousPath = path;
  } finally { rendering = false; }
}

window.addEventListener('hashchange', render);
window.addEventListener('app:refresh', render);
window.addEventListener('backend-error', render);
window.addEventListener('storage', event => {
  if (event.key !== 'mtg-frontend-data-v1' || !event.newValue) return;
  if (syncDataFromStorage()) { toast('A local update from another tab was synchronized.', 'info'); window.dispatchEvent(new CustomEvent('app:refresh')); }
});
document.addEventListener('click', event => {
  const skipLink = event.target.closest('.skip-link');
  if (skipLink) { event.preventDefault(); const main = document.querySelector('#main-content'); main?.focus({ preventScroll: true }); main?.scrollIntoView({ block: 'start' }); return; }
  if (event.target.closest('[data-close-dialog]')) closeDialog();
  const action = event.target.closest('[data-action]')?.dataset.action;
  if (action === 'clear-preview') { setPreview('normal'); window.dispatchEvent(new CustomEvent('app:refresh')); }
  if (action === 'retry-route') { state.live.backendError = false; window.dispatchEvent(new CustomEvent('app:refresh')); }
  if (event.target.closest('[data-open-notifications]')) openNotificationsDrawer();
  const notificationLink = event.target.closest('[data-notification-link]');
  if (notificationLink) {
    const note = state.data.notifications.find(item => item.id === notificationLink.dataset.notificationLink);
    if (note && notificationPriority(note) === 'normal') { markNotificationRead(note); persistData(); }
  }
  const anchor = event.target.closest('a[href]');
  if (anchor?.closest('#app-dialog')) closeDialog();
  if (anchor?.closest('#drawer-root')) closeDrawer(false);
});
document.addEventListener('keydown', event => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k' && currentUser() && !document.querySelector('#app-dialog').open) { event.preventDefault(); openQuickSearch(); }
});
const dialog = document.querySelector('#app-dialog');
dialog.addEventListener('cancel', event => { event.preventDefault(); closeDialog(); });
dialog.addEventListener('click', event => { if (event.target === dialog) closeDialog(); });

render();
