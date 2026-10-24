import { queryOne, queryAll, execute } from '../db/database.js';
import { broadcastEvent } from './wsService.js';
import { logAccess } from './auditService.js';

/**
 * Super Admin Service — Step 14
 * Handles high-privilege metrics, data governance, performance intelligence,
 * dispute workflows, and gateway controls.
 */

// ===================================================================
// LAYER 1: Command Center Overview
// ===================================================================

export function getCommandCenterOverview() {
  const activeMembers = queryOne("SELECT COUNT(*) as cnt FROM users WHERE status = 'active'");
  const pendingApps = queryOne("SELECT COUNT(*) as cnt FROM users WHERE status = 'pending'");
  
  // Safe check for support_tickets table (created in Layer 3)
  const hasTickets = queryOne("SELECT name FROM sqlite_master WHERE type='table' AND name='support_tickets'");
  const openTickets = hasTickets ? queryOne("SELECT COUNT(*) as cnt FROM support_tickets WHERE status = 'open'") : null;

  const activeProjects = queryOne("SELECT COUNT(*) as cnt FROM projects WHERE status NOT IN ('LIVE','CANCELLED')");
  
  // revenue_this_month: current calendar month (YYYY-MM)
  const revMonth = queryOne(`
    SELECT COALESCE(SUM(amount), 0) as total 
    FROM revenue_events 
    WHERE strftime('%Y-%m', event_date) = strftime('%Y-%m', 'now')
  `);

  // pending payouts & total (status = 'PENDING')
  const pendingPayouts = queryOne(`
    SELECT COUNT(*) as cnt, COALESCE(SUM(amount), 0) as total 
    FROM withdrawals 
    WHERE UPPER(status) = 'PENDING'
  `);

  // Safe check for disputes table (created in Layer 4)
  const hasDisputes = queryOne("SELECT name FROM sqlite_master WHERE type='table' AND name='disputes'");
  const openDisputes = hasDisputes ? queryOne("SELECT COUNT(*) as cnt FROM disputes WHERE status != 'closed'") : null;

  const totalUsers = queryOne("SELECT COUNT(*) as cnt FROM users");

  return {
    total_active_members: Number(activeMembers?.cnt || 0),
    pending_applications: Number(pendingApps?.cnt || 0),
    open_tickets: Number(openTickets?.cnt || 0),
    active_projects: Number(activeProjects?.cnt || 0),
    revenue_this_month: Number(revMonth?.total || 0),
    pending_payouts: Number(pendingPayouts?.cnt || 0),
    pending_payouts_total: Number(pendingPayouts?.total || 0),
    open_disputes: Number(openDisputes?.cnt || 0),
    db_total_users: Number(totalUsers?.cnt || 0)
  };
}

// ===================================================================
// LAYER 2: Full Member Directory
// ===================================================================

export function getAllMembers({ status = null, role = null, search = null, sort_by = 'created_at', order = 'DESC' } = {}) {
  let sql = `
    SELECT 
      u.id, u.name, u.email, u.phone_number, u.role, u.sub_role,
      u.desired_role, u.status, u.created_at, u.last_active_at,
      u.avatar_url, u.bio, u.wallet_frozen,
      (SELECT COUNT(*) FROM ideas i WHERE i.owner_id = u.id) as ideas_count,
      (SELECT COUNT(*) FROM project_members pm WHERE pm.user_id = u.id) as projects_count,
      COALESCE((SELECT SUM(amount) FROM revenue_splits rs WHERE rs.user_id = u.id), 0.0) as total_earnings,
      (SELECT COUNT(*) FROM meeting_attendance ma WHERE ma.user_id = u.id) as meetings_attended
    FROM users u
    WHERE 1=1
  `;
  const params = [];

  if (status) {
    sql += ' AND u.status = ?';
    params.push(status);
  }

  if (role) {
    sql += ' AND u.role = ?';
    params.push(role);
  }

  if (search && search.trim()) {
    sql += ' AND (u.name LIKE ? OR u.email LIKE ? OR u.phone_number LIKE ?)';
    const term = `%${search.trim()}%`;
    params.push(term, term, term);
  }

  const allowedSort = [
    'name', 'email', 'role', 'status', 'created_at', 'last_active_at',
    'ideas_count', 'projects_count', 'total_earnings', 'meetings_attended'
  ];
  const safeSort = allowedSort.includes(sort_by) ? sort_by : 'created_at';
  const safeOrder = String(order).toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

  sql += ` ORDER BY ${safeSort} ${safeOrder}`;

  const rows = queryAll(sql, params);
  return rows.map(r => ({
    id: r.id,
    name: r.name,
    email: r.email,
    phone_number: r.phone_number,
    role: r.role,
    sub_role: r.sub_role,
    desired_role: r.desired_role,
    status: r.status,
    created_at: r.created_at,
    last_active_at: r.last_active_at,
    avatar_url: r.avatar_url,
    bio: r.bio,
    wallet_frozen: Number(r.wallet_frozen || 0),
    ideas_count: Number(r.ideas_count || 0),
    projects_count: Number(r.projects_count || 0),
    total_earnings: Number(r.total_earnings || 0),
    meetings_attended: Number(r.meetings_attended || 0)
  }));
}

export function getMemberDetail(userId) {
  const members = getAllMembers();
  const member = members.find(m => m.id === userId);
  if (!member) return null;

  const ideas_history = queryAll(`
    SELECT id, title, status, created_at
    FROM ideas
    WHERE owner_id = ?
    ORDER BY created_at DESC
  `, [userId]);

  const projects_history = queryAll(`
    SELECT 
      p.id as project_id,
      p.title as project_title,
      pm.role_in_project,
      (SELECT COUNT(*) FROM project_tasks pt WHERE pt.project_id = p.id AND pt.assigned_to = pm.user_id) as tasks_assigned,
      (SELECT COUNT(*) FROM project_tasks pt WHERE pt.project_id = p.id AND pt.assigned_to = pm.user_id AND pt.status = 'DONE') as tasks_completed
    FROM project_members pm
    JOIN projects p ON pm.project_id = p.id
    WHERE pm.user_id = ?
    ORDER BY pm.joined_at DESC
  `, [userId]);

  const earnings_ledger = queryAll(`
    SELECT rs.id, rs.amount, rs.rule_applied, rs.split_type, rs.created_at, re.event_date, re.source, p.title as project_title
    FROM revenue_splits rs
    JOIN revenue_events re ON rs.revenue_event_id = re.id
    LEFT JOIN projects p ON re.project_id = p.id
    WHERE rs.user_id = ?
    ORDER BY rs.created_at DESC
  `, [userId]);

  const attendance_history = queryAll(`
    SELECT ma.id, ma.meeting_id, ma.joined_at, ma.left_at, m.title as meeting_title, m.meeting_type
    FROM meeting_attendance ma
    JOIN meetings m ON ma.meeting_id = m.id
    WHERE ma.user_id = ?
    ORDER BY ma.joined_at DESC
  `, [userId]);

  const access_log_recent = queryAll(`
    SELECT id, user_id, action, resource, ip_address, timestamp
    FROM access_log
    WHERE user_id = ?
    ORDER BY timestamp DESC
    LIMIT 100
  `, [userId]);

  return {
    ...member,
    ideas_history,
    projects_history: projects_history.map(ph => ({
      ...ph,
      tasks_assigned: Number(ph.tasks_assigned || 0),
      tasks_completed: Number(ph.tasks_completed || 0)
    })),
    earnings_ledger: earnings_ledger.map(el => ({
      ...el,
      amount: Number(el.amount || 0)
    })),
    attendance_history,
    access_log_recent
  };
}

export function exportMembersCSV({ userId = null, adminId = null } = {}) {
  let members = getAllMembers({ sort_by: 'created_at', order: 'DESC' });
  if (userId) {
    members = members.filter(m => m.id === userId);
  }

  // Record governance action if exporting data for a user
  if (adminId && userId) {
    const entryId = crypto.randomUUID();
    execute(`
      INSERT INTO user_data_governance (
        id, user_id, action, requested_by, notes, reverted, created_at
      ) VALUES (?, ?, 'data_export_delivered', ?, 'Member data export delivered in CSV format', 0, datetime('now'))
    `, [entryId, userId, adminId]);
  }

  const headers = [
    'ID', 'Name', 'Email', 'Phone Number', 'Role', 'Sub Role',
    'Desired Role', 'Status', 'Created At', 'Last Active At',
    'Wallet Frozen', 'Ideas Count', 'Projects Count', 'Total Earnings', 'Meetings Attended'
  ];

  const escapeCSV = (val) => {
    if (val === null || val === undefined) return '""';
    let str = String(val);
    // Neutralize spreadsheet formula injection (cells starting with =, +, -, @, tab or CR)
    if (/^[=+\-@\t\r]/.test(str)) {
      str = `'${str}`;
    }
    return `"${str.replace(/"/g, '""')}"`;
  };

  const rows = [headers.join(',')];
  for (const m of members) {
    const row = [
      escapeCSV(m.id),
      escapeCSV(m.name),
      escapeCSV(m.email),
      escapeCSV(m.phone_number),
      escapeCSV(m.role),
      escapeCSV(m.sub_role),
      escapeCSV(m.desired_role),
      escapeCSV(m.status),
      escapeCSV(m.created_at),
      escapeCSV(m.last_active_at),
      escapeCSV(m.wallet_frozen),
      escapeCSV(m.ideas_count),
      escapeCSV(m.projects_count),
      escapeCSV(m.total_earnings),
      escapeCSV(m.meetings_attended)
    ];
    rows.push(row.join(','));
  }

  return rows.join('\r\n');
}

// ===================================================================
// LAYER 2: Performance Intelligence (Stealth)
// ===================================================================

export function getPerformanceConfig() {
  const taskRow = queryOne("SELECT value FROM system_config WHERE key = 'performance_weight_task'");
  const ideaRow = queryOne("SELECT value FROM system_config WHERE key = 'performance_weight_idea'");
  const votingRow = queryOne("SELECT value FROM system_config WHERE key = 'performance_weight_voting'");
  const meetingRow = queryOne("SELECT value FROM system_config WHERE key = 'performance_weight_meeting'");
  const revenueRow = queryOne("SELECT value FROM system_config WHERE key = 'performance_weight_revenue'");

  return {
    performance_weight_task: taskRow ? Number(taskRow.value) : 0.30,
    performance_weight_idea: ideaRow ? Number(ideaRow.value) : 0.25,
    performance_weight_voting: votingRow ? Number(votingRow.value) : 0.20,
    performance_weight_meeting: meetingRow ? Number(meetingRow.value) : 0.15,
    performance_weight_revenue: revenueRow ? Number(revenueRow.value) : 0.10
  };
}

export function updatePerformanceConfig(weights) {
  const wTask = Number(weights.performance_weight_task);
  const wIdea = Number(weights.performance_weight_idea);
  const wVoting = Number(weights.performance_weight_voting);
  const wMeeting = Number(weights.performance_weight_meeting);
  const wRevenue = Number(weights.performance_weight_revenue);

  const sum = wTask + wIdea + wVoting + wMeeting + wRevenue;
  if (Math.abs(sum - 1.00) > 0.001) {
    const err = new Error('Weights must sum to exactly 1.00');
    err.status = 400;
    err.received_sum = Number(sum.toFixed(2));
    throw err;
  }

  const updates = [
    { key: 'performance_weight_task', value: String(wTask) },
    { key: 'performance_weight_idea', value: String(wIdea) },
    { key: 'performance_weight_voting', value: String(wVoting) },
    { key: 'performance_weight_meeting', value: String(wMeeting) },
    { key: 'performance_weight_revenue', value: String(wRevenue) }
  ];

  for (const u of updates) {
    execute("INSERT OR REPLACE INTO system_config (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)", [u.key, u.value]);
  }

  return getPerformanceConfig();
}

export function getUserPerformance(userId) {
  const user = queryOne("SELECT id, name, role, status FROM users WHERE id = ?", [userId]);
  if (!user) return null;

  const weights = getPerformanceConfig();

  // Ideas metrics
  const ideasSub = queryOne("SELECT COUNT(*) as cnt FROM ideas WHERE owner_id = ? AND status != 'DRAFT'", [userId]);
  const ideasApp = queryOne("SELECT COUNT(*) as cnt FROM ideas WHERE owner_id = ? AND status = 'APPROVED'", [userId]);
  const ideasRej = queryOne("SELECT COUNT(*) as cnt FROM ideas WHERE owner_id = ? AND status = 'REJECTED'", [userId]);
  
  const ideas_submitted = Number(ideasSub?.cnt || 0);
  const ideas_approved = Number(ideasApp?.cnt || 0);
  const ideas_rejected = Number(ideasRej?.cnt || 0);
  const idea_approval_rate = ideas_submitted > 0 ? Number(((ideas_approved / ideas_submitted) * 100).toFixed(1)) : 0.0;

  // Task metrics
  const tasksAssignedRow = queryOne("SELECT COUNT(*) as cnt FROM project_tasks WHERE assigned_to = ?", [userId]);
  const tasksCompletedRow = queryOne("SELECT COUNT(*) as cnt FROM project_tasks WHERE assigned_to = ? AND status = 'DONE'", [userId]);
  const tasksOverdueRow = queryOne("SELECT COUNT(*) as cnt FROM project_tasks WHERE assigned_to = ? AND status = 'BLOCKED'", [userId]);
  const avgDaysRow = queryOne(`
    SELECT AVG(julianday(COALESCE(completed_at, created_at)) - julianday(created_at)) as avg_days
    FROM project_tasks
    WHERE assigned_to = ? AND status = 'DONE'
  `, [userId]);

  const tasks_assigned = Number(tasksAssignedRow?.cnt || 0);
  const tasks_completed = Number(tasksCompletedRow?.cnt || 0);
  const tasks_overdue = Number(tasksOverdueRow?.cnt || 0);
  const task_completion_rate = tasks_assigned > 0 ? Number(((tasks_completed / tasks_assigned) * 100).toFixed(1)) : 0.0;
  const avg_task_completion_days = avgDaysRow?.avg_days !== null && avgDaysRow?.avg_days !== undefined 
    ? Number(Number(avgDaysRow.avg_days).toFixed(1)) 
    : null;

  // Voting metrics
  const votableIdeasRow = queryOne("SELECT COUNT(*) as cnt FROM ideas WHERE status IN ('APPROVED', 'REJECTED', 'REVISE', 'PENDING_REVIEW')");
  const votesCastRow = queryOne("SELECT COUNT(*) as cnt FROM votes WHERE voter_id = ?", [userId]);
  const total_votable = Number(votableIdeasRow?.cnt || 0);
  const votes_cast = Number(votesCastRow?.cnt || 0);
  const voting_participation_rate = total_votable > 0 
    ? Number(Math.min(100, (votes_cast / total_votable) * 100).toFixed(1)) 
    : 0.0;

  // Meeting metrics
  const totalMeetingsRow = queryOne("SELECT COUNT(*) as cnt FROM meetings");
  const attendedRow = queryOne("SELECT COUNT(*) as cnt FROM meeting_attendance WHERE user_id = ?", [userId]);
  const total_meetings = Number(totalMeetingsRow?.cnt || 0);
  const meetings_attended = Number(attendedRow?.cnt || 0);
  const meeting_attendance_rate = total_meetings > 0 
    ? Number(Math.min(100, (meetings_attended / total_meetings) * 100).toFixed(1)) 
    : 0.0;

  // Coworking metrics
  const coworkingRow = queryOne("SELECT COUNT(*) as cnt FROM room_participants WHERE user_id = ?", [userId]);
  const coworking_sessions_count = Number(coworkingRow?.cnt || 0);

  // Revenue metrics
  const revGenRow = queryOne(`
    SELECT COALESCE(SUM(re.amount), 0) as total
    FROM revenue_events re
    JOIN projects p ON re.project_id = p.id
    WHERE p.owner_id = ?
  `, [userId]);
  const revEarnedRow = queryOne("SELECT COALESCE(SUM(amount), 0) as total FROM revenue_splits WHERE user_id = ?", [userId]);
  const maxTeamRevRow = queryOne(`
    SELECT COALESCE(MAX(team_sum), 0) as max_rev 
    FROM (SELECT SUM(amount) as team_sum FROM revenue_splits GROUP BY user_id)
  `);

  const revenue_generated = Number(revGenRow?.total || 0);
  const revenue_earned = Number(revEarnedRow?.total || 0);
  const max_team_revenue = Number(maxTeamRevRow?.max_rev || 0);
  const revenue_ratio = max_team_revenue > 0 ? Math.min(1.0, revenue_earned / max_team_revenue) : 0.0;

  // Composite Score (0.00 to 1.00)
  const taskComponent = (task_completion_rate / 100) * weights.performance_weight_task;
  const ideaComponent = (idea_approval_rate / 100) * weights.performance_weight_idea;
  const votingComponent = (voting_participation_rate / 100) * weights.performance_weight_voting;
  const meetingComponent = (meeting_attendance_rate / 100) * weights.performance_weight_meeting;
  const revenueComponent = revenue_ratio * weights.performance_weight_revenue;

  const rawComposite = taskComponent + ideaComponent + votingComponent + meetingComponent + revenueComponent;
  const composite_score = Number(Math.max(0, Math.min(1, rawComposite)).toFixed(2));

  // Monthly breakdown: last 6 calendar months
  const monthly_breakdown = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const monthKey = `${yyyy}-${mm}`;

    const mTasks = queryOne("SELECT COUNT(*) as cnt FROM project_tasks WHERE assigned_to = ? AND status = 'DONE' AND strftime('%Y-%m', COALESCE(completed_at, created_at)) = ?", [userId, monthKey]);
    const mIdeas = queryOne("SELECT COUNT(*) as cnt FROM ideas WHERE owner_id = ? AND strftime('%Y-%m', created_at) = ?", [userId, monthKey]);
    const mVotes = queryOne("SELECT COUNT(*) as cnt FROM votes WHERE voter_id = ? AND strftime('%Y-%m', voted_at) = ?", [userId, monthKey]);

    monthly_breakdown.push({
      month: monthKey,
      tasks_completed: Number(mTasks?.cnt || 0),
      ideas_submitted: Number(mIdeas?.cnt || 0),
      votes_cast: Number(mVotes?.cnt || 0)
    });
  }

  // Trend logic: last 3 months vs prev 3 months
  const recent3Sum = monthly_breakdown.slice(3).reduce((acc, m) => acc + m.tasks_completed + m.ideas_submitted + m.votes_cast, 0);
  const prev3Sum = monthly_breakdown.slice(0, 3).reduce((acc, m) => acc + m.tasks_completed + m.ideas_submitted + m.votes_cast, 0);
  const recentAvg = recent3Sum / 3;
  const prevAvg = prev3Sum / 3;
  const diff = recentAvg - prevAvg;

  let trend = 'stable';
  if (diff > 0.05) trend = 'improving';
  else if (diff < -0.05) trend = 'declining';

  return {
    id: user.id,
    name: user.name,
    role: user.role,
    status: user.status,
    ideas_submitted,
    ideas_approved,
    ideas_rejected,
    idea_approval_rate,
    tasks_assigned,
    tasks_completed,
    tasks_overdue,
    task_completion_rate,
    avg_task_completion_days,
    voting_participation_rate,
    meeting_attendance_rate,
    coworking_sessions_count,
    revenue_generated,
    revenue_earned,
    composite_score,
    trend,
    monthly_breakdown
  };
}

export function getAllPerformance() {
  const activeUsers = queryAll("SELECT id FROM users WHERE status = 'active'");
  const list = [];
  for (const u of activeUsers) {
    const perf = getUserPerformance(u.id);
    if (perf) {
      const { monthly_breakdown, ...summary } = perf;
      list.push(summary);
    }
  }
  list.sort((a, b) => b.composite_score - a.composite_score);
  return list;
}

export function getPerformanceLeaderboard() {
  const all = getAllPerformance();
  return all.map((item, idx) => ({
    rank: idx + 1,
    id: item.id,
    name: item.name,
    role: item.role,
    composite_score: item.composite_score,
    trend: item.trend
  }));
}

// ===================================================================
// LAYER 3: Ideation Engine Command Center
// ===================================================================

/**
 * List all ideas with vote counts, owner name, revenue clock start, fan-out summary
 */
export function listAllIdeasCommand() {
  const ideas = queryAll(`
    SELECT i.*, 
           u.name as owner_name, 
           u.email as owner_email,
           p.revenue_clock_start,
           p.id as project_id,
           (SELECT COUNT(*) FROM votes WHERE idea_id = i.id) as vote_count,
           (SELECT COUNT(*) FROM project_tasks pt WHERE pt.project_id = p.id) as tasks_total,
           (SELECT COUNT(*) FROM project_tasks pt WHERE pt.project_id = p.id AND pt.status IN ('DONE','completed')) as tasks_completed,
           kb.name as killed_by_name
    FROM ideas i
    JOIN users u ON i.owner_id = u.id
    LEFT JOIN projects p ON p.idea_id = i.id
    LEFT JOIN users kb ON i.killed_by = kb.id
    ORDER BY i.created_at DESC
  `);

  return ideas.map(idea => {
    const total = Number(idea.tasks_total || 0);
    const completed = Number(idea.tasks_completed || 0);
    return {
      ...idea,
      vote_count: Number(idea.vote_count || 0),
      tasks_total: total,
      tasks_completed: completed,
      fan_out_summary: `${completed}/${total > 0 ? total : 9} complete`
    };
  });
}

/**
 * Get full idea detail including votes, all tasks, and revenue accrued
 */
export function getIdeaDetailCommand(ideaId) {
  const idea = queryOne(`
    SELECT i.*, 
           u.name as owner_name, 
           u.email as owner_email,
           p.id as project_id,
           p.title as project_title,
           p.current_stage as project_stage,
           p.revenue_clock_start,
           kb.name as killed_by_name
    FROM ideas i
    JOIN users u ON i.owner_id = u.id
    LEFT JOIN projects p ON p.idea_id = i.id
    LEFT JOIN users kb ON i.killed_by = kb.id
    WHERE i.id = ?
  `, [ideaId]);

  if (!idea) return null;

  // Votes
  const votes = queryAll(`
    SELECT v.*, u.name as voter_name, u.role as voter_role
    FROM votes v
    JOIN users u ON v.voter_id = u.id
    WHERE v.idea_id = ?
    ORDER BY v.voted_at DESC
  `, [ideaId]);

  // Tasks (project_tasks links to the idea only via projects.idea_id)
  const tasks = queryAll(`
    SELECT pt.*, u.name as assignee_name
    FROM project_tasks pt
    LEFT JOIN users u ON pt.assigned_to = u.id
    WHERE pt.project_id = ?
    ORDER BY pt.created_at ASC
  `, [idea.project_id || '']);

  // Revenue accrued
  const revRow = queryOne(`
    SELECT COALESCE(SUM(amount), 0) as total
    FROM revenue_events
    WHERE project_id = ?
  `, [idea.project_id || '']);

  return {
    ...idea,
    votes,
    tasks,
    revenue_accrued: Number(revRow?.total || 0)
  };
}

/**
 * Idea Kill Switch
 * Cancels pending tasks, updates status to 'killed', logs access, broadcasts WS
 */
export function killIdea(ideaId, reason, adminId) {
  if (!reason || !reason.trim()) {
    const err = new Error('Reason is required to kill an idea');
    err.status = 400;
    throw err;
  }

  const idea = queryOne("SELECT * FROM ideas WHERE id = ?", [ideaId]);
  if (!idea) {
    const err = new Error('Idea not found');
    err.status = 404;
    throw err;
  }

  const currentStatus = (idea.status || '').toLowerCase();
  if (currentStatus === 'killed' || currentStatus === 'archived') {
    const err = new Error(`Cannot kill an idea that is already ${idea.status}`);
    err.status = 409;
    throw err;
  }

  const preKillStatus = idea.status;
  const now = new Date().toISOString();

  // Update idea
  execute(`
    UPDATE ideas
    SET status = 'killed',
        killed_reason = ?,
        killed_at = datetime('now'),
        killed_by = ?,
        pre_kill_status = ?,
        updated_at = datetime('now')
    WHERE id = ?
  `, [reason.trim(), adminId, preKillStatus, ideaId]);

  // Cancel any non-completed tasks belonging to this idea's projects
  // (project_tasks has no idea_id column — the idea link lives on projects.idea_id)
  execute(`
    UPDATE project_tasks
    SET status = 'cancelled'
    WHERE project_id IN (SELECT id FROM projects WHERE idea_id = ?)
      AND status NOT IN ('DONE', 'completed')
  `, [ideaId]);

  // Log access
  logAccess({
    userId: adminId,
    action: 'superadmin_idea_kill',
    resource: `/api/superadmin/ideas/${ideaId}/kill`,
    targetId: ideaId
  });

  // Emit WebSocket event
  broadcastEvent('org:global', 'idea_killed', {
    ideaId,
    reason: reason.trim(),
    killedBy: adminId,
    timestamp: now
  });

  return {
    ideaId,
    status: 'killed',
    reason: reason.trim()
  };
}

/**
 * Restore a killed idea back to pre-kill status
 */
export function restoreIdea(ideaId, reason, adminId) {
  if (!reason || !reason.trim()) {
    const err = new Error('Reason is required to restore an idea');
    err.status = 400;
    throw err;
  }

  const idea = queryOne("SELECT * FROM ideas WHERE id = ?", [ideaId]);
  if (!idea) {
    const err = new Error('Idea not found');
    err.status = 404;
    throw err;
  }

  if ((idea.status || '').toLowerCase() !== 'killed') {
    const err = new Error('Cannot restore an idea that was never killed');
    err.status = 409;
    throw err;
  }

  const targetStatus = idea.pre_kill_status || 'APPROVED';

  execute(`
    UPDATE ideas
    SET status = ?,
        killed_reason = NULL,
        killed_at = NULL,
        killed_by = NULL,
        updated_at = datetime('now')
    WHERE id = ?
  `, [targetStatus, ideaId]);

  // Log access
  logAccess({
    userId: adminId,
    action: 'superadmin_idea_restore',
    resource: `/api/superadmin/ideas/${ideaId}/restore`,
    targetId: ideaId
  });

  return {
    ideaId,
    status: targetStatus,
    reason: reason.trim()
  };
}

/**
 * Read current idea quota config
 */
export function getQuotaConfig() {
  const limitRow = queryOne("SELECT value FROM system_config WHERE key = 'idea_quota_limit'");
  const windowRow = queryOne("SELECT value FROM system_config WHERE key = 'idea_quota_window_days'");

  return {
    idea_quota_limit: Number(limitRow?.value || 4),
    idea_quota_window_days: Number(windowRow?.value || 10)
  };
}

/**
 * Update idea quota config with strict validation
 * limit >= 1, window_days >= 7 and <= 30
 */
export function updateQuotaConfig(updates = {}, adminId) {
  const { idea_quota_limit, idea_quota_window_days } = updates;

  if (idea_quota_limit !== undefined) {
    const limitNum = Number(idea_quota_limit);
    if (isNaN(limitNum) || limitNum < 1) {
      const err = new Error('idea_quota_limit must be an integer >= 1');
      err.status = 400;
      throw err;
    }
  }

  if (idea_quota_window_days !== undefined) {
    const winNum = Number(idea_quota_window_days);
    if (isNaN(winNum) || winNum < 7 || winNum > 30) {
      const err = new Error('idea_quota_window_days must be between 7 and 30 days');
      err.status = 400;
      throw err;
    }
  }

  if (idea_quota_limit !== undefined) {
    execute(`
      INSERT INTO system_config (key, value, updated_by, updated_at)
      VALUES ('idea_quota_limit', ?, ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = datetime('now')
    `, [String(idea_quota_limit), adminId]);
  }

  if (idea_quota_window_days !== undefined) {
    execute(`
      INSERT INTO system_config (key, value, updated_by, updated_at)
      VALUES ('idea_quota_window_days', ?, ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = datetime('now')
    `, [String(idea_quota_window_days), adminId]);
  }

  logAccess({
    userId: adminId,
    action: 'superadmin_quota_config_update',
    resource: '/api/superadmin/quota/config'
  });

  return getQuotaConfig();
}

/**
 * Super Admin System Integrity Check
 * Verifies all 7 append-only triggers, schema tables, config keys, and metrics.
 * Logs action='superadmin_integrity_check' in access_log.
 */
export function getSystemIntegrity(adminId, ipAddress = null) {
  const triggerRows = queryAll("SELECT name FROM sqlite_master WHERE type = 'trigger'");
  const triggerNames = new Set(triggerRows.map(r => r.name));

  const append_only_triggers = {
    prevent_dispute_signature_delete: triggerNames.has('prevent_dispute_signature_delete'),
    prevent_dispute_signature_update: triggerNames.has('prevent_dispute_signature_update'),
    prevent_waiver_signature_delete: triggerNames.has('prevent_waiver_signature_delete'),
    prevent_waiver_signature_update: triggerNames.has('prevent_waiver_signature_update'),
    prevent_governance_delete: triggerNames.has('prevent_governance_delete'),
    prevent_governance_update: triggerNames.has('prevent_governance_update'),
    prevent_meeting_attendance_delete: triggerNames.has('prevent_meeting_attendance_delete')
  };

  const tableRows = queryAll("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
  const schema_tables = tableRows.map(r => r.name);

  const configRows = queryAll("SELECT key FROM system_config ORDER BY key");
  const system_config_keys = configRows.map(r => r.key);

  const activeMembersRow = queryOne("SELECT COUNT(*) as cnt FROM users WHERE status = 'active'");
  const pendingAppsRow = queryOne("SELECT COUNT(*) as cnt FROM users WHERE status = 'pending'");
  const openDisputesRow = queryOne("SELECT COUNT(*) as cnt FROM disputes WHERE status != 'closed'");
  const openTicketsRow = queryOne("SELECT COUNT(*) as cnt FROM support_tickets WHERE status = 'open'");

  logAccess({
    userId: adminId,
    targetId: 'system_integrity',
    action: 'superadmin_integrity_check',
    resource: '/api/superadmin/system/integrity',
    ipAddress
  });

  return {
    append_only_triggers,
    schema_tables,
    system_config_keys,
    active_members: activeMembersRow ? Number(activeMembersRow.cnt) : 0,
    pending_applications: pendingAppsRow ? Number(pendingAppsRow.cnt) : 0,
    open_disputes: openDisputesRow ? Number(openDisputesRow.cnt) : 0,
    open_tickets: openTicketsRow ? Number(openTicketsRow.cnt) : 0
  };
}

