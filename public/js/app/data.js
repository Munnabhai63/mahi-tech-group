// Operational domain taxonomies and blueprint metadata
export const roleMeta = {
  researcher: { label: 'Researcher', icon: 'book', description: 'Frame opportunities, submit ideas, and complete deep research.' },
  designer: { label: 'UI/UX Designer', icon: 'pen', description: 'Turn research into flows, interfaces, and design deliverables.' },
  developer: { label: 'Developer', icon: 'grid', description: 'Build frontend or backend tracks and resolve task dependencies.' },
  producer: { label: 'Producer / Tester', icon: 'check-square', description: 'Prepare test plans, validate builds, and report quality gates.' },
  admin: { label: 'Admin', icon: 'shield', description: 'Coordinate people, projects, approvals, meetings, and payouts.' }
};

export const stageMeta = {
  RESEARCH_DEV_PARALLEL: { label: 'Parallel tracks', short: 'Parallel', icon: 'layers', tone: 'info' },
  INTEGRATION: { label: 'Integration', short: 'Integration', icon: 'link', tone: 'violet' },
  TESTING: { label: 'Testing', short: 'Testing', icon: 'check-square', tone: 'warning' },
  ADMIN_REVIEW: { label: 'Admin review', short: 'Final review', icon: 'eye', tone: 'warning' },
  LIVE: { label: 'Live', short: 'Live', icon: 'globe', tone: 'success' }
};

export const taskBlueprints = [
  { name: 'Deep Research', type: 'research', role: 'researcher', dependsOn: [] },
  { name: 'Backend Architecture Setup', type: 'backend', role: 'developer', subRole: 'backend', dependsOn: ['Deep Research'] },
  { name: 'Frontend UI Scaffolding', type: 'frontend', role: 'developer', subRole: 'frontend', dependsOn: ['Deep Research'] },
  { name: 'UI/UX Design', type: 'design', role: 'designer', dependsOn: ['Deep Research'] },
  { name: 'Test Plan Preparation', type: 'testing', role: 'producer', dependsOn: ['Deep Research'] },
  { name: 'Frontend API Integration', type: 'frontend', role: 'developer', subRole: 'frontend', dependsOn: ['Backend Architecture Setup'] },
  { name: 'Feature Logic Lock', type: 'backend', role: 'developer', subRole: 'backend', dependsOn: ['Backend Architecture Setup'] },
  { name: 'Full QA Testing', type: 'testing', role: 'producer', dependsOn: ['Deep Research', 'Backend Architecture Setup', 'Frontend UI Scaffolding', 'UI/UX Design', 'Test Plan Preparation', 'Frontend API Integration', 'Feature Logic Lock'] },
  { name: 'Admin Final Review', type: 'review', role: 'admin', dependsOn: ['Deep Research', 'Backend Architecture Setup', 'Frontend UI Scaffolding', 'UI/UX Design', 'Test Plan Preparation', 'Frontend API Integration', 'Feature Logic Lock', 'Full QA Testing'] }
];

function usernameBase(value) {
  return String(value || '').trim().toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '');
}

export function ensureMemberIdentities(users = []) {
  if (!Array.isArray(users)) return [];
  const used = new Set();
  users.forEach((user, index) => {
    const base = usernameBase(user.username) || usernameBase(user.name) || `member.${index + 1}`;
    let username = base; let suffix = 2;
    while (used.has(username)) username = `${base}.${suffix++}`;
    user.username = username; used.add(username);
  });
  return users;
}

export function createMemberIdentity(name, users = [], preferredId = null) {
  let id = preferredId;
  if (!id || users.some(user => user.id === id)) {
    let sequence = users.length + 1;
    do { id = `u-member-${String(sequence++).padStart(3, '0')}`; } while (users.some(user => user.id === id));
  }
  const base = usernameBase(name) || 'member';
  let username = base; let suffix = 2;
  const claimed = new Set(users.map(user => usernameBase(user.username)).filter(Boolean));
  while (claimed.has(username)) username = `${base}.${suffix++}`;
  return { id, username };
}

export function createInitialData() {
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
    revenueEvents: [],
    performance: [],
    performanceConfig: { tasks: 30, ideas: 25, voting: 20, meetings: 15, revenue: 10 },
    config: { ideaQuota: 2, cornerQuotas: { researcher: 2, designer: 2, developer: 2, producer: 2, admin: 2 }, quotaCycleDays: 7, votingWindowHours: 48, approvalThreshold: 70, quorumPercentage: 70, revenueSplitMonths: 5, ownerSplit: 50, teamSplit: 50, orgName: 'MAHI TECH GROUP', orgEmail: 'no-reply@mahitechgroup.com' },
    gateway: {},
    aiConfig: { confidenceThreshold: 75, digestFrequencyHours: 24, features: { reply: true, meeting_summary: true, research_summary: true, idea_prescore: true, notification_digest: true, standup: true, task_breakdown: true } },
    aiSuggestions: [],
    aiInteractions: [],
    standups: [],
    uiPreferences: {},
    notifications: []
  };
}

export const signingDocuments = {};
