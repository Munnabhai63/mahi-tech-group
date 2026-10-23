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
 */
export function getKanbanProjects(user) {
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

  projectsQuery += ' ORDER BY p.created_at DESC';
  const projects = queryAll(projectsQuery, params);

  // Define the standard 5 Kanban stages
  const columns = {
    RESEARCH_DEV_PARALLEL: { title: 'Research & Dev Parallel', stage: 'RESEARCH_DEV_PARALLEL', items: [] },
    INTEGRATION: { title: 'Integration', stage: 'INTEGRATION', items: [] },
    TESTING: { title: 'Testing & QA', stage: 'TESTING', items: [] },
    ADMIN_REVIEW: { title: 'Admin Final Review', stage: 'ADMIN_REVIEW', items: [] },
    LIVE: { title: 'Live & Monetizing', stage: 'LIVE', items: [] }
  };

  for (const proj of projects) {
    // Fetch members
    const members = queryAll(`
      SELECT pm.id, pm.user_id, u.name, u.email, u.role, pm.role_in_project, pm.contribution_weight
      FROM project_members pm
      JOIN users u ON pm.user_id = u.id
      WHERE pm.project_id = ? AND pm.removed_at IS NULL
      ORDER BY pm.joined_at ASC
    `, [proj.id]);

    // Fetch tasks progress
    const tasks = queryAll('SELECT id, status FROM project_tasks WHERE project_id = ?', [proj.id]);
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
      // Fallback
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
 */
export function getPendingVotesFeed(user) {
  const ideas = queryAll(`
    SELECT i.*, u.name as owner_name, u.email as owner_email,
           rm.voting_window_end, rm.status as meeting_status
    FROM ideas i
    JOIN users u ON i.owner_id = u.id
    LEFT JOIN review_meetings rm ON i.id = rm.idea_id
    WHERE i.status = 'PENDING_REVIEW'
    ORDER BY i.created_at DESC
  `);

  return ideas.map(idea => {
    // Get votes breakdown
    const votes = queryAll('SELECT voter_id, vote_color FROM votes WHERE idea_id = ?', [idea.id]);
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
