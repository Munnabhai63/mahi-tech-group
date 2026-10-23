import crypto from 'node:crypto';
import { queryOne, queryAll, execute } from '../db/database.js';
import { logAccess } from './auditService.js';
import { createNotification } from './notificationService.js';
import { pushToUser } from './wsService.js';

/**
 * Calculate the exact 5-month boundary timestamp from a project's revenue_clock_start.
 * Calendar-based calculation: project start date + 5 calendar months.
 */
export function calculateFiveMonthBoundary(startDateStr) {
  const start = new Date(startDateStr);
  const boundary = new Date(start.getTime());
  boundary.setMonth(boundary.getMonth() + 5);
  return boundary;
}

/**
 * Determine which revenue rule applies for a given project and event date:
 * - If eventDate < 5-month boundary -> 'OWNER_50_TEAM_50'
 * - If eventDate >= 5-month boundary -> 'TEAM_100'
 */
export function evaluateRevenueSplitRule(project, eventDateStr) {
  const clockStart = project.revenue_clock_start || project.created_at;
  const boundary = calculateFiveMonthBoundary(clockStart);
  const eventDate = new Date(eventDateStr);

  const isUnder5Months = eventDate.getTime() < boundary.getTime();
  const ruleApplied = isUnder5Months ? 'OWNER_50_TEAM_50' : 'TEAM_100';

  return {
    ruleApplied,
    isUnder5Months,
    clockStart,
    boundary: boundary.toISOString(),
    eventDate: eventDate.toISOString()
  };
}

/**
 * Record a new Revenue Event and calculate atomic split distributions.
 * Strictly adheres to PRD Section 4:
 * 1. Admin enters revenue amount for project.
 * 2. 5-month boundary evaluated from project's own revenue_clock_start.
 * 3. Split calculated (Owner 50% / Team 50% vs Team 100%).
 * 4. Wallets credited (frozen wallets routed to pending_settlements instead of active balance).
 * 5. Immutable ledger entries appended.
 */
export function recordRevenueEvent({ projectId, amount, source = 'Direct Platform Revenue', eventDate, adminUserId, ipAddress = null }) {
  const numAmount = Number(amount);
  if (isNaN(numAmount) || numAmount === 0) {
    return { success: false, status: 400, error: 'Revenue amount must be a nonzero number' };
  }

  if (!projectId || !eventDate) {
    return { success: false, status: 400, error: 'projectId and eventDate are required' };
  }

  // Validate Project
  const project = queryOne('SELECT * FROM projects WHERE id = ?', [projectId]);
  if (!project) {
    return { success: false, status: 404, error: 'Project not found' };
  }

  // Edge case safety: Project must have an owner_id on record
  if (!project.owner_id) {
    return { success: false, status: 400, error: 'Integrity Error: Project has no idea owner on record' };
  }

  const ownerUser = queryOne('SELECT id, name, status, wallet_frozen FROM users WHERE id = ?', [project.owner_id]);
  if (!ownerUser) {
    return { success: false, status: 400, error: 'Integrity Error: Project idea owner user record not found' };
  }

  // Evaluate the 5-month rule
  const ruleEval = evaluateRevenueSplitRule(project, eventDate);
  const { ruleApplied, isUnder5Months, boundary } = ruleEval;

  // Query active (non-removed) team members for this project
  const teamMembers = queryAll(`
    SELECT pm.*, u.name, u.status as user_status, u.wallet_frozen
    FROM project_members pm
    JOIN users u ON pm.user_id = u.id
    WHERE pm.project_id = ? AND pm.removed_at IS NULL
  `, [projectId]);

  if (teamMembers.length === 0) {
    return { success: false, status: 400, error: 'Cannot distribute revenue: Project has no active team members' };
  }

  let ownerShare = 0.0;
  let teamPool = 0.0;

  if (isUnder5Months) {
    ownerShare = Number((numAmount * 0.50).toFixed(2));
    teamPool = Number((numAmount - ownerShare).toFixed(2)); // Ensures penny-perfect rounding
  } else {
    ownerShare = 0.0;
    teamPool = numAmount;
  }

  // Calculate weighted split across active team members
  const totalWeight = teamMembers.reduce((sum, m) => sum + Number(m.contribution_weight || 0), 0);
  const memberSplits = [];

  for (let i = 0; i < teamMembers.length; i++) {
    const member = teamMembers[i];
    let memberShare = 0;

    if (totalWeight > 0) {
      memberShare = Number(((teamPool * Number(member.contribution_weight || 0)) / totalWeight).toFixed(2));
    } else {
      // Default to equal split if all weights are zero
      memberShare = Number((teamPool / teamMembers.length).toFixed(2));
    }

    memberSplits.push({
      member,
      amount: memberShare
    });
  }

  // Adjust any rounding penny discrepancy on the last team member
  const allocatedTeam = memberSplits.reduce((sum, s) => sum + s.amount, 0);
  const diff = Number((teamPool - allocatedTeam).toFixed(2));
  if (diff !== 0 && memberSplits.length > 0) {
    memberSplits[memberSplits.length - 1].amount = Number((memberSplits[memberSplits.length - 1].amount + diff).toFixed(2));
  }

  // Insert Revenue Event into Immutable Ledger
  const eventId = crypto.randomUUID();
  execute(`
    INSERT INTO revenue_events (
      id, project_id, amount, source, entered_by, event_date, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `, [
    eventId,
    projectId,
    numAmount,
    source,
    adminUserId,
    eventDate
  ]);

  const createdSplits = [];
  const pendingSettlements = [];

  // Helper to credit wallet or route to pending_settlements if wallet is frozen
  function creditOrHold({ userId, userName, splitId, amount, rule, splitType, isOwnerRoyalty = false }) {
    const user = queryOne('SELECT id, name, wallet_frozen, wallet_balance, status FROM users WHERE id = ?', [userId]);
    const isFrozen = user?.wallet_frozen === 1;

    execute(`
      INSERT INTO revenue_splits (
        id, revenue_event_id, user_id, amount, rule_applied, split_type, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `, [
      splitId,
      eventId,
      userId,
      amount,
      rule,
      splitType
    ]);

    createdSplits.push({
      id: splitId,
      userId,
      userName: user ? user.name : userName,
      amount,
      ruleApplied: rule,
      splitType,
      walletFrozen: isFrozen
    });

    if (isFrozen) {
      // PRD Section 4.3: Frozen wallet does NOT get credited to active balance.
      // Route to pending_settlements for Admin manual disposition.
      const settlementId = crypto.randomUUID();
      execute(`
        INSERT INTO pending_settlements (
          id, revenue_split_id, user_id, amount, status, created_at
        ) VALUES (?, ?, ?, ?, 'PENDING', CURRENT_TIMESTAMP)
      `, [
        settlementId,
        splitId,
        userId,
        amount
      ]);

      pendingSettlements.push({
        settlementId,
        userId,
        userName: user.name,
        amount,
        notice: `Former member ${user.name} was due ₹${amount.toFixed(2)} from this split — manual settlement required.`
      });
    } else {
      // Normal active member: Credit wallet balance
      execute(
        'UPDATE users SET wallet_balance = wallet_balance + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [amount, userId]
      );

      if (amount > 0) {
        try {
          createNotification({
            userId,
            eventType: 'revenue.credited',
            message: `You earned ₹${amount.toFixed(2)} from "${project.title}" (${splitType === 'OWNER_ROYALTY' ? '50% Idea Royalty' : 'Contributor Cut'})`,
            link: '/wallet'
          });
          pushToUser(userId, 'revenue.credited', {
            amount,
            splitType,
            projectId: project.id,
            projectTitle: project.title
          });
        } catch (e) {
          // Non-blocking notification error
        }
      }
    }
  }

  // 1. Process Owner Royalty Cut (if under 5 months)
  if (ownerShare > 0) {
    creditOrHold({
      userId: project.owner_id,
      userName: ownerUser.name,
      splitId: crypto.randomUUID(),
      amount: ownerShare,
      rule: ruleApplied,
      splitType: 'OWNER_ROYALTY',
      isOwnerRoyalty: true
    });
  }

  // 2. Process Team Contributor Cuts
  for (const s of memberSplits) {
    creditOrHold({
      userId: s.member.user_id,
      userName: s.member.name,
      splitId: crypto.randomUUID(),
      amount: s.amount,
      rule: ruleApplied,
      splitType: 'TEAM_CONTRIBUTOR',
      isOwnerRoyalty: false
    });
  }

  logAccess({
    userId: adminUserId,
    action: 'revenue_event_recorded',
    resource: `/api/admin/projects/${projectId}/revenue (amount: ₹${numAmount}, rule: ${ruleApplied}, splits: ${createdSplits.length})`,
    ipAddress
  });

  const createdEvent = queryOne('SELECT * FROM revenue_events WHERE id = ?', [eventId]);

  return {
    success: true,
    status: 201,
    event: createdEvent,
    ruleApplied,
    isUnder5Months,
    fiveMonthBoundary: boundary,
    ownerShare,
    teamPool,
    splits: createdSplits,
    pendingSettlements
  };
}

/**
 * Record an Offsetting / Reversing Ledger Entry (Accounting standard for refunds/corrections)
 * Does NOT edit or delete the historical row.
 */
export function recordReversingEntry({ originalEventId, reason, adminUserId, ipAddress = null }) {
  const original = queryOne('SELECT * FROM revenue_events WHERE id = ?', [originalEventId]);
  if (!original) {
    return { success: false, status: 404, error: 'Original revenue event not found' };
  }

  const originalSplits = queryAll('SELECT * FROM revenue_splits WHERE revenue_event_id = ?', [originalEventId]);
  const reversalEventId = crypto.randomUUID();
  const reversingAmount = -Math.abs(Number(original.amount));

  execute(`
    INSERT INTO revenue_events (
      id, project_id, amount, source, entered_by, event_date, created_at
    ) VALUES (?, ?, ?, ?, ?, DATE('now'), CURRENT_TIMESTAMP)
  `, [
    reversalEventId,
    original.project_id,
    reversingAmount,
    `REVERSAL: ${reason || 'Correction/Refund'} (Ref: ${originalEventId})`,
    adminUserId
  ]);

  const reversalSplits = [];
  for (const origSplit of originalSplits) {
    const revSplitId = crypto.randomUUID();
    const negAmount = -Math.abs(Number(origSplit.amount));

    execute(`
      INSERT INTO revenue_splits (
        id, revenue_event_id, user_id, amount, rule_applied, split_type, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `, [
      revSplitId,
      reversalEventId,
      origSplit.user_id,
      negAmount,
      origSplit.rule_applied,
      origSplit.split_type
    ]);

    // Deduct offset from wallet
    execute(
      'UPDATE users SET wallet_balance = wallet_balance + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [negAmount, origSplit.user_id]
    );

    reversalSplits.push({ id: revSplitId, userId: origSplit.user_id, amount: negAmount });
  }

  logAccess({
    userId: adminUserId,
    action: 'revenue_event_reversed',
    resource: `/api/admin/projects/${original.project_id}/revenue/reversal (original: ${originalEventId}, reversing: ${reversalEventId})`,
    ipAddress
  });

  return {
    success: true,
    status: 201,
    reversalEventId,
    reversingAmount,
    reversalSplits
  };
}

/**
 * Get user's wallet summary, balance, and split history
 */
export function getUserWallet(userId) {
  const user = queryOne('SELECT id, name, email, wallet_balance, wallet_frozen FROM users WHERE id = ?', [userId]);
  if (!user) {
    return { success: false, status: 404, error: 'User not found' };
  }

  const splits = queryAll(`
    SELECT rs.*, re.event_date, re.source, p.title as project_title
    FROM revenue_splits rs
    JOIN revenue_events re ON rs.revenue_event_id = re.id
    JOIN projects p ON re.project_id = p.id
    WHERE rs.user_id = ?
    ORDER BY rs.created_at DESC
  `, [userId]);

  const pendingSettlements = queryAll(`
    SELECT ps.*, re.event_date, p.title as project_title
    FROM pending_settlements ps
    JOIN revenue_splits rs ON ps.revenue_split_id = rs.id
    JOIN revenue_events re ON rs.revenue_event_id = re.id
    JOIN projects p ON re.project_id = p.id
    WHERE ps.user_id = ?
    ORDER BY ps.created_at DESC
  `, [userId]);

  return {
    success: true,
    status: 200,
    wallet: {
      userId: user.id,
      name: user.name,
      wallet_balance: Number(user.wallet_balance || 0),
      wallet_frozen: user.wallet_frozen === 1,
      totalSplitsCount: splits.length,
      splits,
      pendingSettlements
    }
  };
}

/**
 * Get comprehensive earnings breakdown per project for the user
 */
export function getUserEarnings(userId) {
  const user = queryOne('SELECT id, name FROM users WHERE id = ?', [userId]);
  if (!user) {
    return { success: false, status: 404, error: 'User not found' };
  }

  const projectEarnings = queryAll(`
    SELECT p.id as project_id, p.title as project_title,
           SUM(CASE WHEN rs.split_type = 'OWNER_ROYALTY' THEN rs.amount ELSE 0 END) as owner_royalty_total,
           SUM(CASE WHEN rs.split_type = 'TEAM_CONTRIBUTOR' THEN rs.amount ELSE 0 END) as team_contributor_total,
           SUM(rs.amount) as total_earned,
           COUNT(rs.id) as events_count
    FROM revenue_splits rs
    JOIN revenue_events re ON rs.revenue_event_id = re.id
    JOIN projects p ON re.project_id = p.id
    WHERE rs.user_id = ?
    GROUP BY p.id, p.title
    ORDER BY total_earned DESC
  `, [userId]);

  const overallTotal = projectEarnings.reduce((sum, p) => sum + Number(p.total_earned || 0), 0);

  return {
    success: true,
    status: 200,
    userId,
    userName: user.name,
    overallTotalEarned: Number(overallTotal.toFixed(2)),
    projectEarnings
  };
}

/**
 * View the full immutable ledger (Admin audit view)
 */
export function getImmutableLedger({ projectId = null, limit = 100 }) {
  let sql = `
    SELECT re.id as event_id, re.project_id, p.title as project_title,
           re.amount as event_amount, re.source, re.event_date, re.created_at as event_created_at,
           u_admin.name as entered_by_name,
           rs.id as split_id, rs.user_id, u_rec.name as recipient_name,
           rs.amount as split_amount, rs.rule_applied, rs.split_type
    FROM revenue_events re
    JOIN projects p ON re.project_id = p.id
    LEFT JOIN users u_admin ON re.entered_by = u_admin.id
    JOIN revenue_splits rs ON rs.revenue_event_id = re.id
    JOIN users u_rec ON rs.user_id = u_rec.id
  `;
  const params = [];

  if (projectId) {
    sql += ' WHERE re.project_id = ?';
    params.push(projectId);
  }

  sql += ' ORDER BY re.created_at DESC, rs.created_at ASC LIMIT ?';
  params.push(limit);

  const rows = queryAll(sql, params);

  return {
    success: true,
    status: 200,
    count: rows.length,
    ledger: rows
  };
}
