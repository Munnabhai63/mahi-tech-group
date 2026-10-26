import { state, currentUser, persistSession, setPreview } from './store.js';
import { icon, pageHead, emptyState, closeDialog, closeDrawer, toast } from './ui.js';
import { shellHTML, mountShell, openNotificationsDrawer, openQuickSearch } from './shell.js';
import { renderLogin, renderSignup, renderApplicationStatus, renderAbout, renderContact, renderLegal } from './views/public.js';
import { renderDashboard, renderWorkspace, renderTasks, renderNotifications, renderProfile, renderWallet, renderSettings, renderSupport, renderTicket, renderFormerMember } from './views/member.js';
import { renderProjects, renderProjectDetail } from './views/projects.js';
import { renderIdeas, renderNewIdea, renderVoting, renderIdeaDetail } from './views/ideas.js';
import { renderMeetings, renderMeetingDetail, renderCoworking } from './views/meetings.js';
import { renderAdminDashboard, renderAdminApplications, renderAdminMembers, renderAdminIdeas, renderAdminProjects, renderAdminRevenue, renderAdminOffboarding, renderAdminConfig, renderAdminMeetings, renderAdminAudit } from './views/admin.js';
import { renderDisputes } from './views/disputes.js';
import { renderSuperadminDashboard, renderSuperadminMembers, renderSuperadminPerformance, renderSuperadminSupport, renderSuperadminIdeas, renderSuperadminGateway, renderSuperadminGovernance, renderSuperadminAudit } from './views/superadmin.js';
import { renderSigning } from './views/signing.js';

const app = document.querySelector('#app');
let cleanup = null;
let previousPath = null;
let rendering = false;

function isRealAuth() {
  return Boolean(localStorage.getItem('token'));
}

function isPublic(path) {
  return ['/login', '/signup', '/application-status', '/about', '/contact', '/legal/terms', '/legal/privacy'].includes(path);
}

function isSigning(path) {
  return path.startsWith('/sign/');
}

function route(path, params) {
  if (path === '/login') return renderLogin();
  if (path === '/signup') return renderSignup();
  if (path === '/application-status') return renderApplicationStatus(params);
  if (path === '/about') return renderAbout();
  if (path === '/contact') return renderContact();
  if (path === '/legal/terms' || path === '/legal/privacy') return renderLegal(path.endsWith('privacy') ? 'privacy' : 'terms');

  if (path === '/app' || path === '/app/dashboard') return renderDashboard();
  if (path === '/app/workspace') return renderWorkspace();
  if (path === '/app/tasks') return renderTasks();
  if (path === '/app/notifications') return renderNotifications();
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
  if (path === '/admin/members') return renderAdminMembers();
  if (path === '/admin/ideas') return renderAdminIdeas();
  if (path === '/admin/projects') return renderAdminProjects();
  if (path === '/admin/revenue') return renderAdminRevenue();
  if (path === '/admin/offboarding') return renderAdminOffboarding();
  if (path === '/admin/config') return renderAdminConfig();
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

  return { html: pageHead('404', 'Route not found', 'Use navigation to return.') + emptyState('Unknown route', 'This screen is not available.', '<a class="btn btn--primary" href="#/app/dashboard">Return to dashboard</a>', 'search') };
}

function render() {
  if (rendering) return;
  rendering = true;
  try {
    const path = location.hash.replace('#', '') || '/app/dashboard';
    const params = new URLSearchParams(path.split('?')[1] || '');
    const user = currentUser();

    // Route guard: non-public routes require real JWT authentication
    if (!isPublic(path) && !isSigning(path) && !isRealAuth()) {
      state.session = null;
      persistSession();
      location.hash = '#/login';
      return;
    }

    // Admin role check
    if (user && (path.startsWith('/admin') || path.startsWith('/superadmin')) && user.role !== 'admin') {
      toast('Admin access requires the Admin role.', 'error');
      location.hash = '#/app/dashboard';
      return;
    }

    // Former member check
    if (user && user.status === 'inactive' && path.startsWith('/app') && !['/app/former-member', '/app/wallet', '/app/notifications'].includes(path)) {
      location.hash = '#/app/former-member';
      return;
    }

    // Cleanup previous view
    if (typeof cleanup === 'function') { try { cleanup(); } catch (e) { console.warn('cleanup', e); } }
    cleanup = null;
    closeDialog();
    closeDrawer(false);
    state.ui.sidebarOpen = false;

    // Render view
    let view;
    try { view = route(path, params); }
    catch (error) {
      console.error('Route render failed:', path, error);
      view = { html: pageHead('Error', 'Render failed', 'Please try again.') };
    }

    // Mount view
    const protectedShell = !isPublic(path) && !isSigning(path);
    app.innerHTML = protectedShell ? shellHTML(view, path) : isSigning(path) ? view.html : '<main id="main-content" tabindex="-1">' + view.html + '</main>';
    document.title = (path.startsWith('/superadmin') ? 'Elevated Admin' : path.startsWith('/admin') ? 'Admin' : path.startsWith('/app') ? 'Workspace' : 'MAHI TECH GROUP') + ' — MAHI TECH GROUP';

    const shellCleanup = protectedShell ? mountShell(path) : null;
    let viewCleanup = null;
    if (typeof view.mount === 'function') { const result = view.mount(); if (typeof result === 'function') viewCleanup = result; }
    cleanup = function () { if (typeof shellCleanup === 'function') shellCleanup(); if (typeof viewCleanup === 'function') viewCleanup(); };
    if (previousPath !== path) { window.scrollTo({ top: 0, behavior: 'instant' }); }
    previousPath = path;
  } finally { rendering = false; }
}

window.addEventListener('hashchange', render);
window.addEventListener('app:refresh', render);

document.addEventListener('click', function (event) {
  const skipLink = event.target.closest('.skip-link');
  if (skipLink) { event.preventDefault(); var main = document.querySelector('#main-content'); if (main) { main.focus({ preventScroll: true }); main.scrollIntoView({ block: 'start' }); } return; }
  if (event.target.closest('[data-close-dialog]')) closeDialog();
  var action = event.target.closest('[data-action]') ? event.target.closest('[data-action]').dataset.action : null;
  if (action === 'retry-route') window.dispatchEvent(new CustomEvent('app:refresh'));
  if (event.target.closest('[data-open-notifications]')) openNotificationsDrawer();
  var anchor = event.target.closest('a[href]');
  if (anchor && anchor.closest('#app-dialog')) closeDialog();
  if (anchor && anchor.closest('#drawer-root')) closeDrawer(false);
});

document.addEventListener('keydown', function (event) {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k' && currentUser() && !document.querySelector('#app-dialog').open) {
    event.preventDefault();
    openQuickSearch();
  }
});

var dialog = document.querySelector('#app-dialog');
if (dialog) {
  dialog.addEventListener('cancel', function (event) { event.preventDefault(); closeDialog(); });
  dialog.addEventListener('click', function (event) { if (event.target === dialog) closeDialog(); });
}

render();
