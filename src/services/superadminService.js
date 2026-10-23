import { queryOne, queryAll, execute } from '../db/database.js';

/**
 * Super Admin Service — Step 14
 * Handles high-privilege metrics, data governance, performance intelligence,
 * dispute workflows, and gateway controls.
 */

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
