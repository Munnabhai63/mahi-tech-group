import { createInitialData, roleMeta, ensureMemberIdentities } from './data.js';
import { api, getAuthToken, setAuthToken, clearAuthToken } from './api.js';
import { realtime } from './ws.js';

const SESSION_KEY = 'mtg-frontend-session-v1';
const DATA_KEY = 'mtg-frontend-data-v1';
const listeners = new Set();

export function isDemoMode() {
  if (typeof window === 'undefined') return false;
  const hostname = window.location.hostname;
  const isLocal = hostname === 'localhost' || hostname === '127.0.0.1';
  // Strictly prevent demo mode on production domain
  if (!isLocal) return false;
  // Demo mode is ONLY allowed if explicitly passed ?demo=true AND no authenticated token exists
  const hasDemoParam = new URLSearchParams(window.location.search).get('demo') === 'true' ||
                        window.location.hash.includes('demo=true');
  return Boolean(hasDemoParam && !getAuthToken());
}

export function createEmptyData() {
  return {
    version: 1,
    users: [],
    projects: [],
    ideas: [],
    votes: [],
    meetings: [],
    coworking: {},
    tickets: [],
    disputes: [],
    withdrawals: [],
    applications: [],
    offboarding: [],
    auditLogs: [],
    governance: [],
    ledger: [],
    performance: [],
    performanceConfig: {},
    config: {},
    gateway: {},
    notifications: []
  };
}

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
  ui: { preview: 'normal', sidebarOpen: false, drawer: null, accountOpen: false, canvasTool: 'select' },
  live: {
    dashboardSummary: null,
    quota: null,
    myTasks: [],
    pendingVotes: [],
    meetings: [],
    profileData: {},
    walletData: null,
    projectAssets: {},
    disputeData: {},
    isLive: false,
    backendError: false,
    backendErrorMessage: null
  }
};

export function subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); }
export function notify(reason = 'update') { listeners.forEach(listener => listener(reason)); }
export function persistData() { safeWrite(DATA_KEY, state.data); }
export function persistSession() {
  if (state.session) safeWrite(SESSION_KEY, state.session);
  else { try { localStorage.removeItem(SESSION_KEY); } catch { /* noop */ } }
}

export function normalizeUser(user) {
  if (!user) return null;
  return {
    ...user,
    id: user.id,
    name: user.name || 'Member',
    email: user.email || '',
    role: user.role || 'researcher',
    subRole: user.subRole || user.sub_role || null,
    status: user.status || 'active',
    wallet: Number(user.wallet ?? user.wallet_balance ?? 0),
    frozen: Boolean(user.frozen || user.wallet_frozen === 1),
    rating: Number(user.rating ?? user.rating_avg ?? user.ratingAverage ?? 5.0),
    bio: user.bio || '',
    location: user.location || 'India',
    avatar: user.name ? user.name.charAt(0).toUpperCase() : 'U',
    profilePhotoUrl: user.profilePhotoUrl || user.profile_photo_url || null,
    ideas: Number(user.ideas ?? user.totalIdeasSubmitted ?? 0),
    projects: Number(user.projects ?? user.totalProjectsBuilt ?? 0),
    meetings: Number(user.meetings ?? 0),
    totalEarnings: Number(user.totalEarnings ?? user.totalRevenueEarned ?? 0)
  };
}

export function currentUser() {
  if (!state.session) return null;
  if (state.session.user) return normalizeUser(state.session.user);
  const found = state.data.users.find(user => user.id === state.session.userId);
  return found ? normalizeUser(found) : null;
}

export function getUser(id) {
  if (state.session?.user && (state.session.user.id === id || id === 'me')) {
    return normalizeUser(state.session.user);
  }
  const found = state.data.users.find(user => user.id === id);
  return found ? normalizeUser(found) : null;
}

export function getProject(id) { return state.data.projects.find(project => project.id === id) || null; }
export function getIdea(id) { return state.data.ideas.find(idea => idea.id === id) || null; }
export function getMeeting(id) { return state.data.meetings.find(meeting => meeting.id === id) || null; }
export function getTicket(id) { return state.data.tickets.find(ticket => ticket.id === id || ticket.number === id) || null; }
export function getDispute(id) { return state.data.disputes.find(dispute => dispute.id === id || dispute.number === id) || null; }

export function syncDataFromStorage() {
  const incoming = safeRead(DATA_KEY);
  if (incoming?.version !== 1) return false;
  state.data = incoming;
  ensureMemberIdentities(state.data.users);
  notify('external-tab-sync');
  return true;
}

export function ideaQuotaLimitFor(userId) {
  const user = getUser(userId); const memberLimit = Number(user?.ideaQuotaLimit);
  if (Number.isInteger(memberLimit) && memberLimit >= 1) return memberLimit;
  const cornerLimit = Number(state.data.config.cornerQuotas?.[user?.role]);
  if (Number.isInteger(cornerLimit) && cornerLimit >= 1) return cornerLimit;
  return Number(state.data.config.ideaQuota);
}

export async function loginWithCredentials(email, password) {
  const result = await api.post('/api/auth/login', { email, password });
  if (result.token && result.user) {
    setAuthToken(result.token);
    state.session = {
      userId: result.user.id,
      role: result.user.role,
      subRole: result.user.sub_role || null,
      elevated: result.user.role === 'admin',
      demo: false,
      token: result.token,
      user: normalizeUser(result.user),
      loginAt: new Date().toISOString()
    };
    persistSession();
    state.live.isLive = true;
    realtime.connect();
    notify('session');
    return result;
  }
  throw new Error('Invalid login response from server');
}

export async function signupApplicant(payload) {
  // Strip non-backend fields to match exact schema
  const cleanPayload = {
    name: payload.name.trim(),
    email: payload.email.trim().toLowerCase(),
    password: payload.password,
    phone_number: payload.phone_number?.trim() || null,
    desired_role: payload.desired_role,
    desired_sub_role: payload.desired_role === 'developer' ? (payload.desired_sub_role || null) : null
  };
  return await api.post('/api/auth/signup', cleanPayload);
}

export function loginAs(role, options = {}) {
  const meta = roleMeta[role];
  if (!meta) return false;
  if (!state.data.users || state.data.users.length === 0) {
    state.data = createInitialData();
  }
  const userId = options.former ? 'u-former' : meta.userId;
  const foundUser = state.data.users.find(u => u.id === userId);
  const fallbackUser = {
    id: userId,
    name: meta.label,
    email: `${role}@mahitechgroup.local`,
    role: options.former ? 'designer' : role,
    subRole: role === 'developer' ? 'frontend' : null,
    status: options.former ? 'inactive' : 'active',
    wallet: 0,
    rating: 5.0
  };
  state.session = {
    userId,
    role: options.former ? 'designer' : role,
    subRole: foundUser?.subRole || (role === 'developer' ? 'frontend' : null),
    elevated: Boolean(options.elevated && role === 'admin'),
    demo: true,
    user: normalizeUser(foundUser || fallbackUser),
    loginAt: new Date().toISOString()
  };
  persistSession();
  notify('session');
  return true;
}

export function loginFormer() {
  if (!state.data.users || state.data.users.length === 0) {
    state.data = createInitialData();
  }
  const found = state.data.users.find(u => u.id === 'u-former');
  const fallbackUser = {
    id: 'u-former',
    name: 'Devika Rao',
    email: 'devika@demo.mahi',
    role: 'designer',
    status: 'inactive',
    wallet: 0,
    rating: 5.0
  };
  state.session = {
    userId: 'u-former',
    role: 'designer',
    elevated: false,
    demo: true,
    former: true,
    user: normalizeUser(found || fallbackUser),
    loginAt: new Date().toISOString()
  };
  persistSession();
  notify('session');
}

export async function logout() {
  const token = getAuthToken();
  if (token) {
    try {
      await api.post('/api/auth/logout', {}, {
        headers: { 'Authorization': `Bearer ${token}` }
      }).catch(() => {});
    } catch {}
  }
  clearAuthToken();
  realtime.disconnect();
  state.session = null;
  state.live.isLive = false;
  persistSession();
  notify('session');
}

export function resetData() {
  state.data = createInitialData();
  state.ui.preview = 'normal';
  persistData();
  notify('data-reset');
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
  return (task.dependsOn || []).filter(name => project.tasks.find(item => item.name === name)?.status !== 'DONE');
}

export function projectProgress(project) {
  if (!project?.tasks?.length) return 0;
  return Math.round((project.tasks.filter(task => task.status === 'DONE').length / project.tasks.length) * 100);
}

export function userProjects(userId = currentUser()?.id) {
  if (!userId) return [];
  const user = getUser(userId);
  if (user?.role === 'admin') return state.data.projects || [];
  return (state.data.projects || []).filter(project => 
    project.ownerId === userId || 
    (Array.isArray(project.tasks) && project.tasks.some(task => (task.assignedTo || task.assigned_to) === userId))
  );
}

export function userTasks(userId = currentUser()?.id) {
  if (!userId) return [];
  const user = getUser(userId);
  const allTasks = (state.data.projects || []).flatMap(project => Array.isArray(project.tasks) ? project.tasks : []);
  if (user?.role === 'admin') return allTasks;
  return allTasks.filter(task => (task.assignedTo || task.assigned_to) === userId);
}

export function pendingVotesFor(userId = currentUser()?.id) {
  if (state.live.pendingVotes?.length) return state.live.pendingVotes;
  return state.data.ideas.filter(idea => idea.status === 'PENDING_REVIEW' && idea.ownerId !== userId && !state.data.votes.some(vote => vote.ideaId === idea.id && vote.voterId === userId));
}

export function userWalletTotal(userId) {
  return state.data.ledger.filter(row => row.userId === userId).reduce((total, row) => total + Number(row.amount || 0), 0);
}

// ===================================================================
// BACKEND SYNC AND LIVE REFETCH LAYER
// ===================================================================

export async function syncUserData() {
  if (!getAuthToken()) return;
  try {
    const profile = await api.get('/api/users/profile-mini');
    if (profile && state.session) {
      state.session.user = normalizeUser({ ...state.session.user, ...profile });
      persistSession();
      state.live.backendError = false;
      state.live.backendErrorMessage = null;
      notify('user-sync');
    }
  } catch (err) {
    if (err.status === 401) {
      logout();
    } else {
      const wasError = state.live.backendError;
      state.live.backendError = true;
      state.live.backendErrorMessage = err.message || 'Backend connection failed';
      if (!wasError && typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('backend-error'));
      notify('backend-error');
    }
  }
}

export async function fetchLiveDashboard() {
  if (!getAuthToken()) return null;
  try {
    const [summary, kanban, myTasksRes, pendingVotesRes, meetingsRes, bannersRes] = await Promise.allSettled([
      api.get('/api/dashboard/summary'),
      api.get('/api/dashboard/kanban'),
      api.get('/api/projects/my-tasks'),
      api.get('/api/ideas/pending-my-vote'),
      api.get('/api/meetings'),
      api.get('/api/banners/active')
    ]);

    const allRejected = [summary, kanban, myTasksRes, pendingVotesRes, meetingsRes, bannersRes].every(r => r.status === 'rejected');
    if (allRejected) {
      const wasError = state.live.backendError;
      state.live.backendError = true;
      state.live.backendErrorMessage = 'Backend server is unreachable. All operational metrics and pipelines are offline.';
      if (!wasError && typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('backend-error'));
      notify('backend-error');
      return null;
    }

    state.live.backendError = false;
    state.live.backendErrorMessage = null;

    if (summary.status === 'fulfilled') state.live.dashboardSummary = summary.value;
    if (myTasksRes.status === 'fulfilled') state.live.myTasks = myTasksRes.value?.tasks || [];
    if (pendingVotesRes.status === 'fulfilled') {
      state.live.pendingVotes = (pendingVotesRes.value?.pendingIdeas || []).map(item => ({
        ...item,
        id: item.id,
        title: item.title,
        deadline: item.voting_deadline,
        greenPercentage: item.green_percentage || 0
      }));
    }
    if (meetingsRes.status === 'fulfilled') state.live.meetings = meetingsRes.value?.meetings || [];
    if (bannersRes.status === 'fulfilled' && bannersRes.value?.banners) {
      state.live.activeBanners = bannersRes.value.banners;
    }

    if (kanban.status === 'fulfilled' && kanban.value) {
      // Map kanban projects into state.data.projects
      const liveProjects = [];
      Object.entries(kanban.value).forEach(([stage, projects]) => {
        if (Array.isArray(projects)) {
          projects.forEach(p => {
            liveProjects.push({
              id: p.id,
              code: p.title ? p.title.slice(0, 3).toUpperCase() : 'PRJ',
              title: p.title,
              stage: p.current_stage || stage,
              description: p.description || '',
              tasks: p.tasks || []
            });
          });
        }
      });
      if (liveProjects.length) state.data.projects = liveProjects;
    }

    notify('dashboard-fetched');
  } catch (err) {
    const wasError = state.live.backendError;
    state.live.backendError = true;
    state.live.backendErrorMessage = err.message || 'Dashboard fetch error';
    if (!wasError && typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('backend-error'));
    notify('backend-error');
  }
}

export async function fetchLiveQuota() {
  if (!getAuthToken()) return null;
  try {
    const res = await api.get('/api/users/me/quota-status');
    if (res?.quota) {
      state.live.quota = res.quota;
      notify('quota-fetched');
      return res.quota;
    }
  } catch (err) {
    console.warn('[Sync] Quota fetch error:', err);
  }
  return null;
}

export async function fetchLiveWallet() {
  if (!getAuthToken()) return null;
  try {
    const [walletRes, earningsRes] = await Promise.allSettled([
      api.get('/api/users/me/wallet'),
      api.get('/api/users/me/earnings')
    ]);

    if (walletRes.status === 'rejected' && earningsRes.status === 'rejected') {
      state.live.backendError = true;
      state.live.backendErrorMessage = 'Wallet service unreachable. Financial records are offline.';
      if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('backend-error'));
      notify('backend-error');
      return null;
    }

    state.live.backendError = false;
    state.live.backendErrorMessage = null;

    const wallet = walletRes.status === 'fulfilled' ? walletRes.value : {};
    const earnings = earningsRes.status === 'fulfilled' ? earningsRes.value : {};

    state.live.walletData = {
      wallet,
      earnings,
      withdrawals: earnings.withdrawals || [],
      splits: wallet.splits || earnings.splits || [],
      timeline: earnings.timeline || []
    };

    if (wallet.wallet_balance !== undefined && state.session?.user) {
      state.session.user.wallet = Number(wallet.wallet_balance);
      state.session.user.frozen = Boolean(wallet.wallet_frozen);
      persistSession();
    }

    notify('wallet-fetched');
    return state.live.walletData;
  } catch (err) {
    console.warn('[Sync] Wallet fetch error:', err);
  }
  return null;
}

export async function fetchLiveProfile(userId = 'me') {
  if (!getAuthToken()) return null;
  try {
    const targetId = userId === 'me' ? (currentUser()?.id || 'me') : userId;
    const [profileRes, ideasRes, projectsRes, ratingsRes, earningsRes] = await Promise.allSettled([
      api.get(`/api/users/${targetId}/profile`),
      api.get(`/api/users/${targetId}/ideas`),
      api.get(`/api/users/${targetId}/projects`),
      api.get(`/api/users/${targetId}/ratings`),
      api.get(`/api/users/${targetId}/earnings`)
    ]);

    const profileData = {
      profile: profileRes.status === 'fulfilled' ? profileRes.value : null,
      ideas: ideasRes.status === 'fulfilled' ? ideasRes.value?.ideas || [] : [],
      projects: projectsRes.status === 'fulfilled' ? projectsRes.value?.projects || [] : [],
      ratings: ratingsRes.status === 'fulfilled' ? ratingsRes.value : null,
      earnings: earningsRes.status === 'fulfilled' ? earningsRes.value : null
    };

    state.live.profileData[targetId] = profileData;
    notify('profile-fetched');
    return profileData;
  } catch (err) {
    console.warn('[Sync] Profile fetch error:', err);
  }
  return null;
}

export async function fetchProjectAssets(projectId) {
  if (!getAuthToken()) return [];
  try {
    const res = await api.get(`/api/projects/${projectId}/assets`);
    if (res?.assets) {
      state.live.projectAssets[projectId] = res.assets;
      notify('assets-fetched');
      return res.assets;
    }
  } catch (err) {
    console.warn('[Sync] Project assets fetch error:', err);
  }
  return [];
}

export async function fetchAdminApplications() {
  if (!getAuthToken()) return [];
  try {
    const res = await api.get('/api/admin/applications/pending');
    if (res?.applications) {
      const apps = res.applications.map(app => ({
        id: app.id,
        name: app.name,
        email: app.email,
        desiredRole: app.desired_role,
        desiredSubRole: app.desired_sub_role || null,
        status: app.status || 'pending',
        submittedAt: app.created_at,
        note: app.phone_number ? `Phone: ${app.phone_number}` : 'Membership applicant'
      }));
      state.live.adminApplications = apps;
      // Merge with non-pending in local state
      const nonPending = state.data.applications.filter(a => a.status !== 'pending');
      state.data.applications = [...apps, ...nonPending];
      state.live.backendError = false;
      state.live.backendErrorMessage = null;
      notify('admin-applications-fetched');
      return apps;
    }
  } catch (err) {
    state.live.backendError = true;
    state.live.backendErrorMessage = err.message || 'Admin applications unreachable';
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('backend-error'));
    notify('backend-error');
  }
  return state.data.applications;
}

export async function fetchAdminMembers() {
  if (!getAuthToken()) return [];
  try {
    const res = await api.get('/api/admin/members');
    if (res?.members) {
      const members = res.members.map(normalizeUser);
      state.live.adminMembers = members;
      state.data.users = members;
      state.live.backendError = false;
      state.live.backendErrorMessage = null;
      notify('admin-members-fetched');
      return members;
    }
  } catch (err) {
    state.live.backendError = true;
    state.live.backendErrorMessage = err.message || 'Admin members unreachable';
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('backend-error'));
    notify('backend-error');
  }
  return state.data.users;
}

export async function fetchAdminRevenue() {
  if (!getAuthToken()) return null;
  try {
    const [withdrawalsRes, ledgerRes] = await Promise.allSettled([
      api.get('/api/admin/withdrawals/pending'),
      api.get('/api/admin/revenue/ledger')
    ]);

    if (withdrawalsRes.status === 'rejected' && ledgerRes.status === 'rejected') {
      state.live.backendError = true;
      state.live.backendErrorMessage = 'Admin revenue service unreachable';
      if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('backend-error'));
      notify('backend-error');
      return null;
    }

    state.live.backendError = false;
    state.live.backendErrorMessage = null;

    if (withdrawalsRes.status === 'fulfilled' && withdrawalsRes.value?.withdrawals) {
      const pending = withdrawalsRes.value.withdrawals.map(w => ({
        id: w.id,
        userId: w.user_id,
        amount: Number(w.amount || 0),
        status: w.status,
        requestedAt: w.requested_at,
        gatewayTxnId: w.gateway_txn_id || null,
        reviewedAt: w.reviewed_at || null
      }));
      state.data.withdrawals = pending;
    }

    if (ledgerRes.status === 'fulfilled' && ledgerRes.value?.ledger) {
      state.data.ledger = ledgerRes.value.ledger.map(l => ({
        id: l.id,
        eventId: l.event_id,
        userId: l.user_id,
        projectId: l.project_id,
        amount: Number(l.amount || 0),
        gross: Number(l.gross_amount || l.amount || 0),
        rule: l.rule_applied || 'OWNER_50_TEAM_50',
        splitType: l.split_type,
        month: l.month_period,
        source: 'Platform Revenue',
        createdAt: l.created_at
      }));
    }

    notify('admin-revenue-fetched');
    return { withdrawals: state.data.withdrawals, ledger: state.data.ledger };
  } catch (err) {
    console.warn('[Sync] Admin revenue fetch error:', err);
  }
  return null;
}

export async function fetchAdminOffboarding() {
  if (!getAuthToken()) return null;
  try {
    const [historyRes, frozenRes] = await Promise.allSettled([
      api.get('/api/admin/offboarding/history'),
      api.get('/api/admin/wallets/frozen')
    ]);

    if (historyRes.status === 'fulfilled' && historyRes.value?.offboardingHistory) {
      state.data.offboarding = historyRes.value.offboardingHistory.map(h => ({
        id: h.id,
        userId: h.user_id,
        reason: h.reason || 'Member exit',
        status: h.status || 'COMPLETED',
        startedAt: h.started_at,
        completedAt: h.completed_at || h.started_at,
        frozenAmount: Number(h.frozen_amount || 0),
        externalChecks: h.external_checklist ? JSON.parse(h.external_checklist) : [],
        steps: []
      }));
    }

    if (frozenRes.status === 'fulfilled' && frozenRes.value?.frozenWallets) {
      state.live.frozenWallets = frozenRes.value.frozenWallets;
    }

    notify('admin-offboarding-fetched');
  } catch (err) {
    console.warn('[Sync] Admin offboarding fetch error:', err);
  }
  return null;
}

export async function fetchAdminConfig() {
  if (!getAuthToken()) return null;
  try {
    const res = await api.get('/api/admin/config');
    if (res?.configs) {
      const c = res.configs;
      if (c.idea_quota_limit) state.data.config.ideaQuota = parseInt(c.idea_quota_limit, 10);
      if (c.idea_quota_window_days) state.data.config.quotaCycleDays = parseInt(c.idea_quota_window_days, 10);
      if (c.voting_window_hours) state.data.config.votingWindowHours = parseInt(c.voting_window_hours, 10);
      if (c.vote_approval_threshold) state.data.config.approvalThreshold = parseFloat(c.vote_approval_threshold);
      if (c.vote_quorum_percentage) state.data.config.quorumPercentage = parseFloat(c.vote_quorum_percentage);
      if (c.revenue_split_duration_months) state.data.config.revenueSplitMonths = parseInt(c.revenue_split_duration_months, 10);
      if (c.jitsi_domain) state.data.config.jitsiDomain = c.jitsi_domain;
      notify('admin-config-fetched');
      return state.data.config;
    }
  } catch (err) {
    console.warn('[Sync] Admin config fetch error:', err);
  }
  return null;
}

export async function fetchAdminAudit() {
  if (!getAuthToken()) return [];
  try {
    const res = await api.get('/api/admin/access-logs?limit=100');
    if (res?.logs) {
      state.data.auditLogs = res.logs.map(log => ({
        id: log.id,
        userId: log.user_id,
        action: log.action,
        resource: log.resource,
        module: 'admin',
        severity: log.action.includes('critical') || log.action.includes('block') || log.action.includes('kill') ? 'critical' : log.action.includes('reject') ? 'warning' : 'info',
        at: log.timestamp
      }));
      notify('admin-audit-fetched');
      return state.data.auditLogs;
    }
  } catch (err) {
    console.warn('[Sync] Admin audit fetch error:', err);
  }
  return state.data.auditLogs;
}

export async function fetchLiveDisputes() {
  if (!getAuthToken()) return [];
  try {
    const res = await api.get('/api/superadmin/disputes');
    if (Array.isArray(res)) {
      state.data.disputes = res.map(d => ({
        id: d.id,
        number: d.dispute_number || d.number,
        title: d.title,
        disputeType: d.dispute_type || d.disputeType,
        description: d.description,
        raisedBy: d.raised_by || d.raisedBy,
        againstParty: d.against_party || d.againstParty || null,
        againstPartyExt: d.against_party_external || d.againstPartyExt || null,
        linkedTicketId: d.linked_ticket_id || d.linkedTicketId || null,
        linkedProjectId: d.linked_project_id || d.linkedProjectId || null,
        status: d.status,
        createdAt: d.created_at || d.createdAt,
        settlementAmount: d.settlement_amount !== null && d.settlement_amount !== undefined ? Number(d.settlement_amount) : null,
        settlementAction: d.settlement_action || null,
        signatures: d.signatures || [],
        parties: d.parties || [],
        partyIds: d.party_ids || (d.parties ? d.parties.map(p => p.userId).filter(Boolean) : []),
        agreements: d.agreements || [],
        waivers: d.waivers || []
      }));
      notify('disputes-fetched');
      return state.data.disputes;
    }
  } catch (err) {
    console.warn('[Sync] Disputes fetch error:', err);
  }
  return state.data.disputes;
}

export async function fetchDisputeDetail(id) {
  if (!getAuthToken()) return null;
  try {
    const d = await api.get(`/api/superadmin/disputes/${id}`);
    if (d?.id) {
      const mapped = {
        id: d.id,
        number: d.dispute_number || d.number,
        title: d.title,
        disputeType: d.dispute_type || d.disputeType,
        description: d.description,
        raisedBy: d.raised_by || d.raisedBy,
        againstParty: d.against_party || d.againstParty || null,
        againstPartyExt: d.against_party_external || d.againstPartyExt || null,
        linkedTicketId: d.linked_ticket_id || d.linkedTicketId || null,
        linkedProjectId: d.linked_project_id || d.linkedProjectId || null,
        status: d.status,
        createdAt: d.created_at || d.createdAt,
        resolutionNotes: d.resolution_notes || null,
        settlementAmount: d.settlement_amount !== null && d.settlement_amount !== undefined ? Number(d.settlement_amount) : null,
        settlementAction: d.settlement_action || null,
        signatures: d.signatures || [],
        parties: d.parties || [],
        partyIds: d.party_ids || (d.parties ? d.parties.map(p => p.userId).filter(Boolean) : []),
        agreements: (d.agreements || []).map(a => ({
          id: a.id,
          version: a.version_number || a.version || 1,
          status: a.status,
          text: a.agreement_text || a.text,
          createdAt: a.created_at
        })),
        waivers: (d.waivers || []).map(w => ({
          id: w.id,
          type: w.waiver_type || w.type,
          scope: w.scope,
          projectId: w.linked_project_id,
          status: w.status,
          text: w.waiver_text || w.text,
          createdAt: w.created_at
        }))
      };
      const idx = state.data.disputes.findIndex(item => item.id === id);
      if (idx !== -1) state.data.disputes[idx] = mapped;
      else state.data.disputes.unshift(mapped);
      notify('dispute-detail-fetched');
      return mapped;
    }
  } catch (err) {
    console.warn('[Sync] Dispute detail fetch error:', err);
  }
  return null;
}

export async function fetchSuperadminTickets() {
  if (!getAuthToken()) return [];
  try {
    const res = await api.get('/api/superadmin/tickets');
    if (Array.isArray(res)) {
      state.data.tickets = res.map(t => ({
        id: t.id,
        number: t.ticket_number || t.number,
        reporterId: t.reporter_id || t.reporterId,
        assignedTo: t.assigned_to || null,
        subject: t.subject,
        category: t.category,
        priority: t.priority,
        status: t.status,
        createdAt: t.created_at || t.createdAt,
        updatedAt: t.updated_at || t.updatedAt,
        linkedDisputeId: t.linked_dispute_id || t.linkedDisputeId || null,
        messages: (t.messages || []).map(m => ({
          id: m.id,
          userId: m.sender_id || m.userId,
          text: m.body || m.text,
          internal: Boolean(m.is_internal || m.internal),
          at: m.created_at || m.at
        }))
      }));
      notify('tickets-fetched');
      return state.data.tickets;
    }
  } catch (err) {
    console.warn('[Sync] Tickets fetch error:', err);
  }
  return state.data.tickets;
}

export async function fetchSuperadminGovernance(userId) {
  if (!getAuthToken()) return [];
  try {
    const res = await api.get(`/api/superadmin/governance/${userId}`);
    const list = Array.isArray(res) ? res : (Array.isArray(res?.history) ? res.history : []);
    if (list.length > 0 || res?.history) {
      const records = list.map(g => ({
        id: g.id,
        userId: g.user_id,
        action: g.action,
        notes: g.notes || '',
        actorId: g.requested_by || g.admin_id,
        actorName: g.requested_by_name || 'Admin',
        at: g.created_at
      }));
      state.data.governance = state.data.governance.filter(g => g.userId !== userId).concat(records);
      notify('governance-fetched');
      return records;
    }
  } catch (err) {
    console.warn('[Sync] Governance fetch error:', err);
  }
  return [];
}

export async function fetchSuperadminPerformance() {
  if (!getAuthToken()) return null;
  try {
    const [boardRes, configRes] = await Promise.allSettled([
      api.get('/api/superadmin/performance'),
      api.get('/api/superadmin/performance/config')
    ]);

    if (boardRes.status === 'fulfilled' && Array.isArray(boardRes.value)) {
      state.data.performance = boardRes.value.map(p => ({
        userId: p.id || p.user_id || p.userId,
        tasks: p.task_completion_rate ?? p.tasks_score ?? p.tasks ?? 0,
        ideas: p.idea_approval_rate ?? p.ideas_score ?? p.ideas ?? 0,
        voting: p.voting_participation_rate ?? p.voting_score ?? p.voting ?? 0,
        meetings: p.meeting_attendance_rate ?? p.meetings_score ?? p.meetings ?? 0,
        revenue: p.revenue_earned ? Math.min(100, Math.round(p.revenue_earned / 1000)) : (p.revenue_score ?? p.revenue ?? 0),
        composite: p.composite_score ?? 0,
        trend: p.trend || 'stable',
        monthly: (p.monthly_breakdown || []).map(m => m.tasks_completed * 10 + m.ideas_submitted * 15 + m.votes_cast * 5).length ? 
          (p.monthly_breakdown || []).map(m => Math.min(100, m.tasks_completed * 20 + m.ideas_submitted * 25 + m.votes_cast * 10)) : 
          [70, 75, 80, 82, 85, 88]
      }));
    }

    if (configRes.status === 'fulfilled' && configRes.value) {
      const c = configRes.value;
      state.data.performanceConfig = {
        tasks: Math.round(((c.performance_weight_task ?? c.weights?.tasks ?? 0.30) * (c.performance_weight_task !== undefined ? 100 : 1))),
        ideas: Math.round(((c.performance_weight_idea ?? c.weights?.ideas ?? 0.25) * (c.performance_weight_idea !== undefined ? 100 : 1))),
        voting: Math.round(((c.performance_weight_voting ?? c.weights?.voting ?? 0.20) * (c.performance_weight_voting !== undefined ? 100 : 1))),
        meetings: Math.round(((c.performance_weight_meeting ?? c.weights?.meetings ?? 0.15) * (c.performance_weight_meeting !== undefined ? 100 : 1))),
        revenue: Math.round(((c.performance_weight_revenue ?? c.weights?.revenue ?? 0.10) * (c.performance_weight_revenue !== undefined ? 100 : 1)))
      };
    }
    notify('performance-fetched');
  } catch (err) {
    console.warn('[Sync] Performance fetch error:', err);
  }
  return null;
}

// Listen for global refresh events from WebSocket or polling
if (typeof window !== 'undefined') {
  window.addEventListener('app:refresh', () => {
    if (getAuthToken()) {
      syncUserData();
      fetchLiveDashboard();
      fetchLiveQuota();
    }
  });

  window.addEventListener('auth:expired', () => {
    logout();
    window.location.hash = '#/login?session=expired';
    toast('Session expired. Please sign in again.', 'warning');
  });

  // Auto connect realtime if token exists
  if (getAuthToken()) {
    state.live.isLive = true;
    realtime.connect();
    syncUserData();
  }
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
