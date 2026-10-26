import { createInitialData, roleMeta } from './data.js';

const SESSION_KEY = 'mtg-frontend-session-v1';
const DATA_KEY = 'mtg-frontend-data-v1';
const listeners = new Set();

function safeRead(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}
function safeWrite(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Storage can be unavailable in private contexts. */ }
}

const savedData = safeRead(DATA_KEY);
export const state = {
  data: savedData?.version === 1 ? savedData : createInitialData(),
  session: safeRead(SESSION_KEY),
  ui: { preview: 'normal', sidebarOpen: false, drawer: null, accountOpen: false, canvasTool: 'select' }
};

export function subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); }
export function notify(reason = 'update') { listeners.forEach(listener => listener(reason)); }
export function persistData() { safeWrite(DATA_KEY, state.data); }
export function persistSession() {
  if (state.session) safeWrite(SESSION_KEY, state.session);
  else { try { localStorage.removeItem(SESSION_KEY); } catch { /* noop */ } }
}

export function currentUser() {
  if (!state.session) return null;
  return state.data.users.find(user => user.id === state.session.userId) || null;
}
export function getUser(id) { return state.data.users.find(user => user.id === id) || null; }
export function getProject(id) { return state.data.projects.find(project => project.id === id) || null; }
export function getIdea(id) { return state.data.ideas.find(idea => idea.id === id) || null; }
export function getMeeting(id) { return state.data.meetings.find(meeting => meeting.id === id) || null; }
export function getTicket(id) { return state.data.tickets.find(ticket => ticket.id === id || ticket.number === id) || null; }
export function getDispute(id) { return state.data.disputes.find(dispute => dispute.id === id || dispute.number === id) || null; }

export function loginAs(role, options = {}) {
  const meta = roleMeta[role];
  if (!meta) return false;
  const userId = options.former ? 'u-former' : meta.userId;
  state.session = { userId, role: options.former ? 'designer' : role, elevated: Boolean(options.elevated && role === 'admin'), demo: true, loginAt: new Date().toISOString() };
  persistSession();
  notify('session');
  return true;
}
export function loginFormer() {
  state.session = { userId: 'u-former', role: 'designer', elevated: false, demo: true, former: true, loginAt: new Date().toISOString() };
  persistSession(); notify('session');
}
export function logout() { state.session = null; persistSession(); notify('session'); }
export function resetData() {
  state.data = createInitialData();
  state.ui.preview = 'normal';
  persistData(); notify('data-reset');
}
export function setPreview(preview) { state.ui.preview = preview; notify('preview'); }

export function addAudit(action, resource, module = 'workspace', severity = 'info') {
  state.data.auditLogs.unshift({ id: `a-${Date.now()}`, userId: currentUser()?.id || null, action, resource, module, severity, at: new Date().toISOString() });
}
export function addNotification(userId, type, message, link = '#/app/notifications') {
  state.data.notifications.unshift({ id: `n-${Date.now()}`, userId, type, message, link, readBy: [], at: new Date().toISOString() });
}

export function visibleNotifications() {
  const user = currentUser();
  if (!user) return [];
  return state.data.notifications.filter(note => note.userId === 'all' || note.userId === user.id || (note.userId === 'admin' && user.role === 'admin'));
}
export function unreadNotifications() { return visibleNotifications().filter(note => !note.readBy.includes(currentUser()?.id)); }

export function missingPrerequisites(task, project) {
  if (!task || !project) return [];
  return task.dependsOn.filter(name => project.tasks.find(item => item.name === name)?.status !== 'DONE');
}
export function projectProgress(project) {
  if (!project?.tasks?.length) return 0;
  return Math.round((project.tasks.filter(task => task.status === 'DONE').length / project.tasks.length) * 100);
}
export function userProjects(userId = currentUser()?.id) {
  if (!userId) return [];
  const user = getUser(userId);
  if (user?.role === 'admin') return state.data.projects;
  return state.data.projects.filter(project => project.ownerId === userId || project.tasks.some(task => task.assignedTo === userId));
}
export function userTasks(userId = currentUser()?.id) {
  if (!userId) return [];
  const user = getUser(userId);
  if (user?.role === 'admin') return state.data.projects.flatMap(project => project.tasks);
  return state.data.projects.flatMap(project => project.tasks).filter(task => task.assignedTo === userId);
}
export function pendingVotesFor(userId = currentUser()?.id) {
  return state.data.ideas.filter(idea => idea.status === 'PENDING_REVIEW' && idea.ownerId !== userId && !state.data.votes.some(vote => vote.ideaId === idea.id && vote.voterId === userId));
}
export function userWalletTotal(userId) {
  return state.data.ledger.filter(row => row.userId === userId).reduce((total, row) => total + Number(row.amount || 0), 0);
}

export function escapeHTML(value = '') {
  return String(value).replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
}
export function formatINR(value, decimals = 0) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(Number(value) || 0);
}
export function formatDate(value, options = {}) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return escapeHTML(value);
  const { year = 'numeric', ...rest } = options;
  const formatOptions = { day: 'numeric', month: 'short', ...rest };
  if (year !== false) formatOptions.year = year;
  return new Intl.DateTimeFormat('en-IN', formatOptions).format(date);
}
export function formatDateTime(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(value));
}
export function formatTime(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit' }).format(new Date(value));
}
export function relativeTime(value) {
  if (!value) return '—';
  const diff = new Date(value).getTime() - Date.now();
  const abs = Math.abs(diff);
  const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  if (abs < 3600000) return formatter.format(Math.round(diff / 60000), 'minute');
  if (abs < 86400000) return formatter.format(Math.round(diff / 3600000), 'hour');
  if (abs < 604800000) return formatter.format(Math.round(diff / 86400000), 'day');
  return formatDate(value, { year: 'numeric' });
}
export function titleCase(value = '') { return String(value).toLowerCase().replaceAll('_', ' ').replace(/\b\w/g, letter => letter.toUpperCase()); }
export function statusTone(status = '') {
  const value = String(status).toUpperCase();
  if (['DONE', 'LIVE', 'APPROVED', 'PAID', 'ACTIVE', 'RESOLVED', 'SETTLED', 'SIGNED', 'COMPLETED'].includes(value)) return 'success';
  if (['BLOCKED', 'REJECTED', 'CANCELLED', 'KILLED', 'DECLINED', 'EXPIRED', 'FORFEITED', 'SUSPENDED'].includes(value)) return 'danger';
  if (['PENDING', 'PENDING_REVIEW', 'IN_PROGRESS', 'TESTING', 'ADMIN_REVIEW', 'REVISE', 'UNDER_REVIEW', 'TODO', 'SCHEDULED', 'EXTENDED'].includes(value)) return 'warning';
  if (['INTEGRATION', 'RESEARCH_DEV_PARALLEL', 'OPEN'].includes(value)) return 'info';
  return 'neutral';
}
export function initials(name = '') { return name.split(' ').map(part => part[0]).join('').slice(0, 2).toUpperCase(); }
export function uid(prefix = 'id') { return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`; }

export function downloadCSV(filename, rows) {
  const csv = rows.map(row => row.map(value => `"${String(value ?? '').replaceAll('"', '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}
