import { queryOne, queryAll } from '../db/database.js';
import { getUserQuotaStatus } from './quotaService.js';
import { getOnlineUsersCount } from './wsService.js';

/**
 * Returns top Quick Stats Bar summary metrics
 */
export function getDashboardSummary(user) {
  const isAdmin = user.role === 'admin';

  // 1. Active Projects Count
  let activeProjectsCount = 0;
  if (isAdmin) {
    const row = queryOne("SELECT COUNT(*) as count FROM projects WHERE status IN ('ACTIVE', 'LIVE')");
    activeProjectsCount = row ? Number(row.count) : 0;
  } else {
    const row = queryOne(`
      SELECT COUNT(DISTINCT p.id) as count
      FROM projects p
      LEFT JOIN project_members pm ON p.id = pm.project_id AND pm.user_id = ? AND pm.removed_at IS NULL
      WHERE p.status IN ('ACTIVE', 'LIVE') AND (p.owner_id = ? OR pm.user_id = ?)
    `, [user.id, user.id, user.id]);
    activeProjectsCount = row ? Number(row.count) : 0;
  }

  // 2. Pending Votes Count (ideas in PENDING_REVIEW not yet voted by this user, and not owned by user)
  const pendingVotesRow = queryOne(`
    SELECT COUNT(*) as count
    FROM ideas i
    WHERE i.status = 'PENDING_REVIEW'
      AND i.owner_id != ?
      AND NOT EXISTS (SELECT 1 FROM votes v WHERE v.idea_id = i.id AND v.voter_id = ?)
  `, [user.id, user.id]);
  const pendingVotesCount = pendingVotesRow ? Number(pendingVotesRow.count) : 0;

  // 3. Quota Status
  let quotaRemaining = 0;
  let quotaWeeklyLimit = 3;
  try {
    const quota = getUserQuotaStatus(user.id);
    quotaRemaining = quota.remaining;
    quotaWeeklyLimit = quota.weeklyLimit;
  } catch (err) {
    quotaRemaining = 0;
  }

  // 4. Team Members Online
  const teamOnlineCount = getOnlineUsersCount();

  // 5. Unread Notifications Count
  const notifRow = queryOne('SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND read_status = 0', [user.id]);
  const unreadNotificationsCount = notifRow ? Number(notifRow.count) : 0;

  // 6. User Wallet Balance
  const userRow = queryOne('SELECT wallet_balance, wallet_frozen FROM users WHERE id = ?', [user.id]);
  const walletBalance = userRow ? Number(userRow.wallet_balance || 0) : 0;
  const isWalletFrozen = userRow ? userRow.wallet_frozen === 1 : false;

  return {
    activeProjectsCount,
    pendingVotesCount,
    myQuotaRemaining: quotaRemaining,
    myQuotaWeeklyLimit: quotaWeeklyLimit,
    teamOnlineCount: Math.max(teamOnlineCount, 1), // At least current user is online
    unreadNotificationsCount,
    walletBalance,
    isWalletFrozen,
    userRole: user.role,
    userName: user.name
  };
}

/**
 * Returns projects formatted for the Kanban Board
 * Grouped into the 5 stages per PRD Step 4/7
 * High-performance batched implementation (3 queries max, eliminates 1 + 2N queries)
 */
export function getKanbanProjects(user, { limit = 50, offset = 0 } = {}) {
  const isAdmin = user.role === 'admin';

  let projectsQuery = `
    SELECT p.*, COALESCE(u.name, 'Unknown Owner') as owner_name, COALESCE(u.email, '') as owner_email
    FROM projects p
    LEFT JOIN users u ON p.owner_id = u.id
    WHERE p.status IN ('ACTIVE', 'LIVE')
  `;
  const params = [];

  if (!isAdmin) {
    projectsQuery += `
      AND (
        p.owner_id = ?
        OR EXISTS (
          SELECT 1 FROM project_members pm
          WHERE pm.project_id = p.id AND pm.user_id = ? AND pm.removed_at IS NULL
        )
      )
    `;
    params.push(user.id, user.id);
  }

  projectsQuery += ' ORDER BY p.created_at DESC LIMIT ? OFFSET ?';
  params.push(Number(limit) || 50, Number(offset) || 0);
  const projects = queryAll(projectsQuery, params);

  // Define the standard 5 Kanban stages
  const columns = {
    RESEARCH_DEV_PARALLEL: { title: 'Research & Dev Parallel', stage: 'RESEARCH_DEV_PARALLEL', items: [] },
    INTEGRATION: { title: 'Integration', stage: 'INTEGRATION', items: [] },
    TESTING: { title: 'Testing & QA', stage: 'TESTING', items: [] },
    ADMIN_REVIEW: { title: 'Admin Final Review', stage: 'ADMIN_REVIEW', items: [] },
    LIVE: { title: 'Live & Monetizing', stage: 'LIVE', items: [] }
  };

  if (projects.length === 0) {
    return {
      totalProjects: 0,
      columns
    };
  }

  // Step 2: Single batched query for ALL members of returned projects
  const projectIds = projects.map(p => p.id);
  const placeholders = projectIds.map(() => '?').join(',');

  const allMembers = queryAll(`
    SELECT pm.id, pm.project_id, pm.user_id, u.name, u.email, u.role, pm.role_in_project, pm.contribution_weight
    FROM project_members pm
    JOIN users u ON pm.user_id = u.id
    WHERE pm.project_id IN (${placeholders}) AND pm.removed_at IS NULL
    ORDER BY pm.joined_at ASC
  `, projectIds);

  const membersByProject = new Map();
  for (const m of allMembers) {
    if (!membersByProject.has(m.project_id)) {
      membersByProject.set(m.project_id, []);
    }
    membersByProject.get(m.project_id).push({
      id: m.id,
      user_id: m.user_id,
      name: m.name,
      email: m.email,
      role: m.role,
      role_in_project: m.role_in_project,
      contribution_weight: m.contribution_weight
    });
  }

  // Step 3: Single batched query for ALL tasks of returned projects
  const allTasks = queryAll(`
    SELECT id, project_id, status FROM project_tasks
    WHERE project_id IN (${placeholders})
  `, projectIds);

  const tasksByProject = new Map();
  for (const t of allTasks) {
    if (!tasksByProject.has(t.project_id)) {
      tasksByProject.set(t.project_id, []);
    }
    tasksByProject.get(t.project_id).push(t);
  }

  // Step 4: Map members and tasks to projects in memory
  for (const proj of projects) {
    const members = membersByProject.get(proj.id) || [];
    const tasks = tasksByProject.get(proj.id) || [];
    const totalTasks = tasks.length;
    const completedTasks = tasks.filter(t => t.status === 'DONE').length;
    const percentComplete = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

    const kanbanItem = {
      id: proj.id,
      title: proj.title,
      current_stage: proj.current_stage,
      status: proj.status,
      owner_id: proj.owner_id,
      owner_name: proj.owner_name,
      owner_email: proj.owner_email,
      revenue_clock_start: proj.revenue_clock_start,
      created_at: proj.created_at,
      members,
      taskSummary: {
        totalTasks,
        completedTasks,
        percentComplete
      }
    };

    if (columns[proj.current_stage]) {
      columns[proj.current_stage].items.push(kanbanItem);
    } else {
      columns.RESEARCH_DEV_PARALLEL.items.push(kanbanItem);
    }
  }

  return {
    totalProjects: projects.length,
    columns
  };
}

/**
 * Returns ideas currently in PENDING_REVIEW with live voting percentages
 * High-performance batched implementation (2 queries max, eliminates 1 + N queries)
 */
export function getPendingVotesFeed(user, { limit = 50, offset = 0 } = {}) {
  const ideas = queryAll(`
    SELECT i.*, u.name as owner_name, u.email as owner_email,
           rm.voting_window_end, rm.status as meeting_status
    FROM ideas i
    JOIN users u ON i.owner_id = u.id
    LEFT JOIN review_meetings rm ON i.id = rm.idea_id
    WHERE i.status = 'PENDING_REVIEW'
    ORDER BY i.created_at DESC
    LIMIT ? OFFSET ?
  `, [Number(limit) || 50, Number(offset) || 0]);

  if (ideas.length === 0) return [];

  // Step 2: Single batched query for votes
  const ideaIds = ideas.map(i => i.id);
  const placeholders = ideaIds.map(() => '?').join(',');

  const allVotes = queryAll(`
    SELECT idea_id, voter_id, vote_color FROM votes
    WHERE idea_id IN (${placeholders})
  `, ideaIds);

  const votesByIdea = new Map();
  for (const v of allVotes) {
    if (!votesByIdea.has(v.idea_id)) {
      votesByIdea.set(v.idea_id, []);
    }
    votesByIdea.get(v.idea_id).push(v);
  }

  // Step 3: Map votes to ideas in JS memory
  return ideas.map(idea => {
    const votes = votesByIdea.get(idea.id) || [];
    const greenVotes = votes.filter(v => v.vote_color === 'green').length;
    const redVotes = votes.filter(v => v.vote_color === 'red').length;
    const totalVotes = votes.length;
    const greenPercentage = totalVotes > 0 ? Math.round((greenVotes / totalVotes) * 100) : 0;

    const userVote = votes.find(v => v.voter_id === user.id);
    const hasVoted = Boolean(userVote);
    const isOwner = idea.owner_id === user.id;

    return {
      id: idea.id,
      title: idea.title,
      description: idea.description,
      owner_id: idea.owner_id,
      owner_name: idea.owner_name,
      attachment_url: idea.attachment_url,
      created_at: idea.created_at,
      voting_window_end: idea.voting_window_end,
      greenVotes,
      redVotes,
      totalVotes,
      greenPercentage,
      hasVoted,
      userVoteColor: userVote ? userVote.vote_color : null,
      isOwner,
      canVote: !hasVoted && !isOwner
    };
  });
}
