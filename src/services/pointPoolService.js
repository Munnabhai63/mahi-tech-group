import crypto from 'node:crypto';
import { queryAll, queryOne, execute } from '../db/database.js';
import { logAccess } from './auditService.js';
import { pushToUser } from './wsService.js';
import {
  isLeadOrAdmin,
  getProjectLeadsAndAdmins,
  getProjectMembers,
  getProjectRoleMembers,
  getAllAdmins,
  sendPipelineNotification
} from './pipelineService.js';

/**
 * Helper to dispatch Point Pool notifications (persisting DB rows and pushing via WebSocket)
 * Ensures broadcast goes ONLY to intended recipients.
 */
export function sendPointPoolNotification({
  recipientUserIds = [],
  eventType,
  message,
  link,
  payload = {}
}) {
  try {
    const timestamp = new Date().toISOString();
    const uniqueIds = Array.from(new Set((recipientUserIds || []).filter(Boolean)));
    const wsPayload = {
      ...payload,
      type: eventType,
      message,
      timestamp
    };

    for (const userId of uniqueIds) {
      try {
        const notifId = crypto.randomUUID();
        execute(`
          INSERT INTO notifications (id, user_id, event_type, message, link, read_status, created_at)
          VALUES (?, ?, ?, ?, ?, 0, CURRENT_TIMESTAMP)
        `, [notifId, userId, eventType, message, link || null]);

        pushToUser(userId, eventType, wsPayload);
      } catch (insertErr) {
        console.error(`[POINT POOL NOTIFICATION INSERT ERROR for ${userId}]:`, insertErr.message);
      }
    }
  } catch (err) {
    console.error('[POINT POOL NOTIFICATION ERROR]:', err.message);
  }
}

/**
 * 1. claimPoint(pointId, userId, userRole)
 *    - Validates point exists and status = UNCLAIMED
 *    - Validates claim_locked_by IS NULL (no existing lock)
 *    - Validates userRole matches stage (same as PRD 15 rule)
 *    - Sets: point status → CLAIMED
 *    - Sets: claim_locked_by = userId, claim_locked_at = NOW
 *    - Sets: assigned_to = userId
 *    - Creates: point_pool_claims record with claimed_by, claimed_at
 *    - Logs: access_log (action = 'point_claimed')
 *    - Returns: { updatedPoint, claimRecord }
 */
export function claimPoint(pointId, userId, userRole) {
  if (!pointId || !userId || !userRole) {
    const err = new Error('pointId, userId, and userRole are required');
    err.status = 400;
    throw err;
  }

  const point = queryOne('SELECT * FROM pipeline_checklist_points WHERE id = ?', [pointId]);
  if (!point) {
    const err = new Error('Point not found');
    err.status = 404;
    throw err;
  }

  if (point.status !== 'UNCLAIMED') {
    const err = new Error(`Point cannot be claimed in status ${point.status}`);
    err.status = 409;
    throw err;
  }

  if (point.claim_locked_by) {
    const err = new Error('Point is already claimed and locked by another member');
    err.status = 409;
    throw err;
  }

  const role = userRole.toLowerCase();
  const isPrivileged = (role === 'admin' || role === 'lead');

  if (!isPrivileged) {
    let allowedRole = false;
    switch (point.stage) {
      case 'RESEARCH':
        allowedRole = (role === 'researcher');
        break;
      case 'DESIGN':
        allowedRole = (role === 'designer');
        break;
      case 'DEV':
        allowedRole = (role === 'developer');
        break;
      case 'TEST':
        allowedRole = (role === 'tester' || role === 'producer');
        break;
      default:
        allowedRole = false;
    }

    if (!allowedRole) {
      const err = new Error(`Role mismatch: ${userRole} cannot claim a ${point.stage} checklist point`);
      err.status = 403;
      throw err;
    }
  }

  const deliverable = queryOne('SELECT project_id, title FROM pipeline_deliverables WHERE id = ?', [point.deliverable_id]);
  const projectId = deliverable?.project_id || '';

  execute(`
    UPDATE pipeline_checklist_points
    SET status = 'CLAIMED',
        claim_locked_by = ?,
        claim_locked_at = CURRENT_TIMESTAMP,
        assigned_to = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [userId, userId, pointId]);

  const claimId = crypto.randomUUID();
  execute(`
    INSERT INTO point_pool_claims (
      id, point_id, project_id, deliverable_id, stage, claimed_by, claimed_at
    ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `, [claimId, pointId, projectId, point.deliverable_id, point.stage, userId]);

  logAccess({
    userId,
    action: 'point_claimed',
    resource: `/api/pointpool/points/${pointId}/claim`,
    targetId: pointId
  });

  const updatedPoint = queryOne('SELECT * FROM pipeline_checklist_points WHERE id = ?', [pointId]);
  const claimRecord = queryOne('SELECT * FROM point_pool_claims WHERE id = ?', [claimId]);

  // EVENT 1 (PRD 16 Layer 5): pointpool_point_claimed
  try {
    const user = queryOne('SELECT name FROM users WHERE id = ?', [userId]);
    const username = user?.name || 'Member';
    const pointTitle = point.point_title;
    const stage = point.stage;

    const recipients = new Set();
    // Project Lead (always)
    const project = queryOne('SELECT owner_id FROM projects WHERE id = ?', [projectId]);
    if (project?.owner_id) recipients.add(project.owner_id);
    const leads = queryAll(`
      SELECT pm.user_id FROM project_members pm
      JOIN users u ON pm.user_id = u.id
      WHERE pm.project_id = ? AND u.status = 'active'
        AND (pm.role_in_project IN ('lead', 'admin_reviewer', 'admin') OR u.role = 'lead' OR u.sub_role = 'lead')
    `, [projectId]);
    leads.forEach(l => recipients.add(l.user_id));

    // Project Admin (always)
    const admins = getAllAdmins();
    admins.forEach(a => recipients.add(a));

    // All other members assigned to the SAME stage
    const stageMembers = getProjectRoleMembers(projectId, stage);
    stageMembers.forEach(mId => {
      if (mId !== userId) recipients.add(mId);
    });

    const message = `${username} claimed point '${pointTitle}' in ${stage}`;
    const link = `/point-pool-board.html?projectId=${projectId}`;

    const payload = {
      type: 'pointpool_point_claimed',
      projectId,
      pointId,
      pointTitle,
      stage,
      claimedBy: { userId, username },
      message
    };

    sendPointPoolNotification({
      recipientUserIds: Array.from(recipients),
      eventType: 'pointpool_point_claimed',
      message,
      link,
      payload
    });
  } catch (notifErr) {
    console.error('[EVENT 1 CLAIM NOTIFICATION ERROR]:', notifErr.message);
  }

  return { updatedPoint, claimRecord };
}

/**
 * 2. releasePoint(pointId, adminOrLeadId, reason)
 *    - Validates point exists
 *    - Validates point status IN (CLAIMED, IN_PROGRESS)
 *    - Validates claim_locked_by IS NOT NULL
 *    - Validates releaser is Lead or Admin
 *    - Validates reason is not empty
 *    - Updates: point status → UNCLAIMED
 *    - Clears: claim_locked_by = NULL, claim_locked_at = NULL
 *    - Clears: assigned_to = NULL, submitted_at = NULL
 *    - Updates: point_pool_claims record for this point
 *      (released_at = NOW, release_reason = reason, released_by = adminOrLeadId)
 *    - Logs: access_log (action = 'point_released')
 *    - Sends notification to previous claimer
 *    - Returns: updated point
 */
export function releasePoint(pointId, adminOrLeadId, reason) {
  if (!pointId || !adminOrLeadId) {
    const err = new Error('pointId and adminOrLeadId are required');
    err.status = 400;
    throw err;
  }

  if (!reason || typeof reason !== 'string' || !reason.trim()) {
    const err = new Error('Release reason is required');
    err.status = 400;
    throw err;
  }

  const point = queryOne('SELECT * FROM pipeline_checklist_points WHERE id = ?', [pointId]);
  if (!point) {
    const err = new Error('Point not found');
    err.status = 404;
    throw err;
  }

  if (!['CLAIMED', 'IN_PROGRESS'].includes(point.status) || !point.claim_locked_by) {
    const err = new Error(`Point in status '${point.status}' without active claim lock cannot be released`);
    err.status = 400;
    throw err;
  }

  const deliverable = queryOne('SELECT project_id, title FROM pipeline_deliverables WHERE id = ?', [point.deliverable_id]);
  const projectId = deliverable?.project_id || '';

  if (!isLeadOrAdmin(adminOrLeadId, projectId)) {
    const err = new Error('Unauthorized: only Lead or Admin can release points');
    err.status = 403;
    throw err;
  }

  const previousClaimer = point.claim_locked_by;

  execute(`
    UPDATE pipeline_checklist_points
    SET status = 'UNCLAIMED',
        claim_locked_by = NULL,
        claim_locked_at = NULL,
        assigned_to = NULL,
        submitted_at = NULL,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [pointId]);

  // Update open claim record in append-only point_pool_claims table
  execute(`
    UPDATE point_pool_claims
    SET released_at = CURRENT_TIMESTAMP,
        release_reason = ?,
        released_by = ?
    WHERE point_id = ? AND released_at IS NULL
  `, [reason.trim(), adminOrLeadId, pointId]);

  logAccess({
    userId: adminOrLeadId,
    action: 'point_released',
    resource: `/api/pointpool/points/${pointId}/release`,
    targetId: pointId
  });

  const updatedPoint = queryOne('SELECT * FROM pipeline_checklist_points WHERE id = ?', [pointId]);

  // EVENT 2 (PRD 16 Layer 5): pointpool_point_released
  try {
    const previousClaimerId = previousClaimer;
    const prevClaimerUser = previousClaimerId ? queryOne('SELECT name FROM users WHERE id = ?', [previousClaimerId]) : null;
    const releaserUser = queryOne('SELECT name FROM users WHERE id = ?', [adminOrLeadId]);
    const releasedByName = releaserUser?.name || 'Lead/Admin';
    const previousClaimerName = prevClaimerUser?.name || 'Member';

    const recipients = new Set();
    if (previousClaimerId) recipients.add(previousClaimerId);

    // All other members assigned to the SAME stage
    const stageMembers = getProjectRoleMembers(projectId, point.stage);
    stageMembers.forEach(mId => {
      if (mId !== adminOrLeadId) recipients.add(mId);
    });

    const message = `${releasedByName} released point '${point.point_title}' — now available in ${point.stage}`;
    const link = `/point-pool-board.html?projectId=${projectId}`;

    const payload = {
      type: 'pointpool_point_released',
      projectId,
      pointId,
      pointTitle: point.point_title,
      stage: point.stage,
      releasedBy: { userId: adminOrLeadId, username: releasedByName },
      previousClaimer: { userId: previousClaimerId, username: previousClaimerName },
      reason: reason.trim(),
      message
    };

    sendPointPoolNotification({
      recipientUserIds: Array.from(recipients),
      eventType: 'pointpool_point_released',
      message,
      link,
      payload
    });
  } catch (notifErr) {
    console.error('[EVENT 2 RELEASE NOTIFICATION ERROR]:', notifErr.message);
  }

  return updatedPoint;
}

/**
 * 3. getPointPool(projectId, userId, userRole)
 *    - Fetches all deliverables for this project
 *    - For each deliverable, fetches all checklist points grouped by stage (RESEARCH/DESIGN/DEV/TEST)
 *    - For each point includes claimer info, weight, status, tool links
 *    - Returns participation summary alongside points
 */
export function getPointPool(projectId, userId = null, userRole = null) {
  if (!projectId) {
    const err = new Error('projectId is required');
    err.status = 400;
    throw err;
  }

  const deliverables = queryAll('SELECT * FROM pipeline_deliverables WHERE project_id = ? ORDER BY created_at ASC', [projectId]);
  const deliverableIds = deliverables.map(d => d.id);

  const stagesList = ['RESEARCH', 'DESIGN', 'DEV', 'TEST'];
  const stages = {
    RESEARCH: [],
    DESIGN: [],
    DEV: [],
    TEST: []
  };

  if (deliverableIds.length > 0) {
    const placeholders = deliverableIds.map(() => '?').join(',');
    const allPoints = queryAll(`
      SELECT pcp.*, u.name as claimer_name, u.email as claimer_email, pd.title as deliverable_title
      FROM pipeline_checklist_points pcp
      JOIN pipeline_deliverables pd ON pcp.deliverable_id = pd.id
      LEFT JOIN users u ON pcp.claim_locked_by = u.id
      WHERE pcp.deliverable_id IN (${placeholders})
      ORDER BY pcp.created_at ASC
    `, deliverableIds);

    const pointIds = allPoints.map(p => p.id);
    let toolLinksByPoint = {};
    if (pointIds.length > 0) {
      const pPlaceholders = pointIds.map(() => '?').join(',');
      const links = queryAll(`
        SELECT ptl.*, u.name as added_by_name
        FROM point_tool_links ptl
        LEFT JOIN users u ON ptl.added_by = u.id
        WHERE ptl.point_id IN (${pPlaceholders}) AND ptl.deleted_at IS NULL
        ORDER BY ptl.created_at ASC
      `, pointIds);

      for (const l of links) {
        if (!toolLinksByPoint[l.point_id]) toolLinksByPoint[l.point_id] = [];
        toolLinksByPoint[l.point_id].push(l);
      }
    }

    for (const pt of allPoints) {
      const stageKey = pt.stage?.toUpperCase();
      if (stages[stageKey]) {
        stages[stageKey].push({
          ...pt,
          tool_links: toolLinksByPoint[pt.id] || []
        });
      }
    }
  }

  // Participation calculation per project member
  const members = queryAll(`
    SELECT DISTINCT u.id, u.name, u.email, u.role
    FROM users u
    WHERE u.id IN (
      SELECT owner_id FROM projects WHERE id = ?
      UNION
      SELECT user_id FROM project_members WHERE project_id = ?
      UNION
      SELECT DISTINCT claim_locked_by FROM pipeline_checklist_points pcp
      JOIN pipeline_deliverables pd ON pcp.deliverable_id = pd.id
      WHERE pd.project_id = ? AND pcp.claim_locked_by IS NOT NULL
    )
  `, [projectId, projectId, projectId]);

  const thresholdConfig = getThreshold(projectId);
  const threshold = Number(thresholdConfig.threshold_pct);

  const participation = [];
  for (const m of members) {
    const stagesPct = {};
    for (const stg of stagesList) {
      stagesPct[stg] = computeParticipationPct(m.id, projectId, stg);
    }
    const overallPct = computeOverallParticipationPct(m.id, projectId, true);
    const blockedRow = queryOne(`
      SELECT 1 FROM revenue_splits rs
      JOIN revenue_events re ON rs.revenue_event_id = re.id
      WHERE re.project_id = ? AND rs.user_id = ? AND rs.is_blocked = 1
      LIMIT 1
    `, [projectId, m.id]);
    const isBlocked = blockedRow ? 1 : 0;

    participation.push({
      userId: m.id,
      user_id: m.id,
      name: m.name,
      userName: m.name,
      user_name: m.name,
      email: m.email,
      role: m.role,
      user_role: m.role,
      stages: stagesPct,
      overallPct,
      overall_pct: overallPct,
      threshold,
      eligible: overallPct >= threshold,
      atRisk: overallPct < (threshold + 10),
      at_risk: overallPct < (threshold + 10),
      isBlocked: Boolean(isBlocked),
      is_blocked: isBlocked
    });
  }

  return { stages, participation };
}

/**
 * 4. getAbandonedPoints(projectId)
 *    - Queries pipeline_checklist_points WHERE:
 *      status IN ('CLAIMED', 'IN_PROGRESS')
 *      AND claim_locked_at < NOW - abandonment_days
 *      AND deliverable.project_id = projectId
 *    - Gets abandonment_days from participation_thresholds for this project (default 7 if not set)
 *    - Returns array of abandoned points with claimer info
 */
export function getAbandonedPoints(projectId) {
  if (!projectId) {
    const err = new Error('projectId is required');
    err.status = 400;
    throw err;
  }

  const thresholdConfig = getThreshold(projectId);
  const days = Number(thresholdConfig.abandonment_days) || 7;

  return queryAll(`
    SELECT pcp.*, 
           COALESCE(u.name, (SELECT u2.name FROM point_pool_claims ppc JOIN users u2 ON ppc.claimed_by = u2.id WHERE ppc.point_id = pcp.id ORDER BY ppc.claimed_at DESC LIMIT 1)) as claimer_name,
           COALESCE(u.email, (SELECT u2.email FROM point_pool_claims ppc JOIN users u2 ON ppc.claimed_by = u2.id WHERE ppc.point_id = pcp.id ORDER BY ppc.claimed_at DESC LIMIT 1)) as claimer_email,
           pd.title as deliverable_title
    FROM pipeline_checklist_points pcp
    JOIN pipeline_deliverables pd ON pcp.deliverable_id = pd.id
    LEFT JOIN users u ON pcp.claim_locked_by = u.id
    WHERE pd.project_id = ?
      AND (
        (pcp.status IN ('CLAIMED', 'IN_PROGRESS')
         AND pcp.claim_locked_at IS NOT NULL
         AND datetime(pcp.claim_locked_at) < datetime('now', '-' || ? || ' days'))
        OR
        (pcp.status = 'UNCLAIMED'
         AND EXISTS (SELECT 1 FROM point_pool_claims ppc WHERE ppc.point_id = pcp.id AND ppc.released_at IS NOT NULL))
      )
    ORDER BY pcp.claim_locked_at ASC
  `, [projectId, days]);
}

/**
 * 5. computeParticipationPct(userId, projectId, stage)
 *    - Formula:
 *      numerator = SUM(pcp.weight) WHERE project_id = projectId AND stage = stage AND status = 'APPROVED' AND claim_locked_by = userId
 *      denominator = SUM(pcp.weight) WHERE project_id = projectId AND stage = stage AND status = 'APPROVED'
 *      IF denominator = 0 → return 0.00
 *      RETURN ROUND((numerator / denominator) * 100, 2)
 */
export function computeParticipationPct(userId, projectId, stage) {
  if (!userId || !projectId || !stage) return 0.00;

  const upperStage = stage.toUpperCase();

  const numRow = queryOne(`
    SELECT COALESCE(SUM(pcp.weight), 0) as total
    FROM pipeline_checklist_points pcp
    JOIN pipeline_deliverables pd ON pcp.deliverable_id = pd.id
    WHERE pd.project_id = ?
      AND pcp.stage = ?
      AND pcp.status = 'APPROVED'
      AND pcp.claim_locked_by = ?
  `, [projectId, upperStage, userId]);

  const denRow = queryOne(`
    SELECT COALESCE(SUM(pcp.weight), 0) as total
    FROM pipeline_checklist_points pcp
    JOIN pipeline_deliverables pd ON pcp.deliverable_id = pd.id
    WHERE pd.project_id = ?
      AND pcp.stage = ?
      AND pcp.status = 'APPROVED'
  `, [projectId, upperStage]);

  const numerator = Number(numRow?.total || 0);
  const denominator = Number(denRow?.total || 0);

  if (denominator === 0) return 0.00;
  return Number(((numerator / denominator) * 100).toFixed(2));
}

/**
 * EVENT 3 (PRD 16 Layer 5): pointpool_participation_warning
 * Deduplicated participation warning for members below threshold.
 */
export function checkAndSendParticipationWarning(userId, projectId, overallPct = null) {
  if (!userId || !projectId) return null;

  try {
    const thresholdConfig = getThreshold(projectId);
    const thresholdPct = Number(thresholdConfig.threshold_pct);

    if (overallPct === null || overallPct === undefined) {
      const numRow = queryOne(`
        SELECT COALESCE(SUM(pcp.weight), 0) as total
        FROM pipeline_checklist_points pcp
        JOIN pipeline_deliverables pd ON pcp.deliverable_id = pd.id
        WHERE pd.project_id = ?
          AND pcp.status = 'APPROVED'
          AND pcp.claim_locked_by = ?
      `, [projectId, userId]);

      const denRow = queryOne(`
        SELECT COALESCE(SUM(pcp.weight), 0) as total
        FROM pipeline_checklist_points pcp
        JOIN pipeline_deliverables pd ON pcp.deliverable_id = pd.id
        WHERE pd.project_id = ?
          AND pcp.status = 'APPROVED'
      `, [projectId]);

      const numerator = Number(numRow?.total || 0);
      const denominator = Number(denRow?.total || 0);
      overallPct = denominator === 0 ? 0.00 : Number(((numerator / denominator) * 100).toFixed(2));
    }

    // At risk if below threshold
    if (overallPct >= thresholdPct) {
      return null;
    }

    // Deduplication check:
    // If a "pointpool_participation_warning" notification already exists for this user + project + read_status=0, do NOT insert another one
    const existingWarning = queryOne(`
      SELECT id FROM notifications
      WHERE user_id = ?
        AND event_type = 'pointpool_participation_warning'
        AND link LIKE ?
        AND read_status = 0
      LIMIT 1
    `, [userId, `%projectId=${projectId}%`]);

    if (existingWarning) {
      return null; // Deduplicated
    }

    const user = queryOne('SELECT name FROM users WHERE id = ?', [userId]);
    const username = user?.name || 'Member';
    const project = queryOne('SELECT title FROM projects WHERE id = ?', [projectId]);
    const projectName = project?.title || 'Project';

    const message = `⚠️ Your participation in project '${projectName}' is ${overallPct}% — below the ${thresholdPct}% threshold. You risk losing revenue eligibility.`;
    const link = `/participation-dashboard.html?projectId=${projectId}`;

    const recipients = new Set([userId]);
    const admins = getAllAdmins();
    admins.forEach(a => recipients.add(a));

    const payload = {
      type: 'pointpool_participation_warning',
      projectId,
      userId,
      username,
      overallPct,
      thresholdPct,
      message
    };

    sendPointPoolNotification({
      recipientUserIds: Array.from(recipients),
      eventType: 'pointpool_participation_warning',
      message,
      link,
      payload
    });

    return payload;
  } catch (err) {
    console.error('[EVENT 3 WARNING NOTIFICATION ERROR]:', err.message);
    return null;
  }
}

/**
 * 6. computeOverallParticipationPct(userId, projectId)
 *    - Same formula as above but WITHOUT stage filter
 *    - Covers ALL stages combined
 *    - Returns overall % rounded to 2 decimal places
 */
export function computeOverallParticipationPct(userId, projectId, skipWarning = false) {
  if (!userId || !projectId) return 0.00;

  const numRow = queryOne(`
    SELECT COALESCE(SUM(pcp.weight), 0) as total
    FROM pipeline_checklist_points pcp
    JOIN pipeline_deliverables pd ON pcp.deliverable_id = pd.id
    WHERE pd.project_id = ?
      AND pcp.status = 'APPROVED'
      AND pcp.claim_locked_by = ?
  `, [projectId, userId]);

  const denRow = queryOne(`
    SELECT COALESCE(SUM(pcp.weight), 0) as total
    FROM pipeline_checklist_points pcp
    JOIN pipeline_deliverables pd ON pcp.deliverable_id = pd.id
    WHERE pd.project_id = ?
      AND pcp.status = 'APPROVED'
  `, [projectId]);

  const numerator = Number(numRow?.total || 0);
  const denominator = Number(denRow?.total || 0);

  const overallPct = denominator === 0 ? 0.00 : Number(((numerator / denominator) * 100).toFixed(2));

  if (!skipWarning) {
    try {
      checkAndSendParticipationWarning(userId, projectId, overallPct);
    } catch (wErr) {}
  }

  return overallPct;
}

/**
 * 7. applyParticipationBlocks(projectId)
 *    - Called automatically by adminApproveLive()
 *    - Gets threshold from participation_thresholds (default 20.00 if not set)
 *    - Gets all project members from project_members table (+ owner)
 *    - For each member:
 *      a. Compute computeOverallParticipationPct(member, project)
 *      b. If pct < threshold:
 *         - Find all revenue_splits WHERE user_id = member
 *           AND revenue_event_id IN (SELECT id FROM revenue_events WHERE project_id = projectId)
 *           AND is_blocked = 0
 *         - UPDATE each split: is_blocked = 1, block_reason = 'Participation below threshold: [X]% < [Y]% required'
 *         - Log each block in access_log
 *         - Add member to blockedMembers array
 *    - Returns: { blockedMembers: [...], checkedCount: N }
 */
export function applyParticipationBlocks(projectId) {
  if (!projectId) {
    const err = new Error('projectId is required');
    err.status = 400;
    throw err;
  }

  const thresholdConfig = getThreshold(projectId);
  const threshold = Number(thresholdConfig.threshold_pct);

  const members = queryAll(`
    SELECT DISTINCT u.id, u.name, u.email
    FROM users u
    WHERE u.id IN (
      SELECT owner_id FROM projects WHERE id = ?
      UNION
      SELECT user_id FROM project_members WHERE project_id = ?
      UNION
      SELECT DISTINCT claim_locked_by FROM pipeline_checklist_points pcp
      JOIN pipeline_deliverables pd ON pcp.deliverable_id = pd.id
      WHERE pd.project_id = ? AND pcp.claim_locked_by IS NOT NULL
    )
  `, [projectId, projectId, projectId]);

  const project = queryOne('SELECT title FROM projects WHERE id = ?', [projectId]);
  const projectTitle = project?.title || 'Project';

  const blockedMembers = [];

  for (const m of members) {
    const pct = computeOverallParticipationPct(m.id, projectId);
    if (pct < threshold) {
      // Find eligible revenue splits to block
      const splits = queryAll(`
        SELECT rs.id, rs.amount 
        FROM revenue_splits rs
        JOIN revenue_events re ON rs.revenue_event_id = re.id
        WHERE rs.user_id = ? AND re.project_id = ? AND rs.is_blocked = 0
      `, [m.id, projectId]);

      const reason = `Participation below threshold: ${pct}% < ${threshold}% required`;

      for (const sp of splits) {
        execute(`
          UPDATE revenue_splits
          SET is_blocked = 1,
              block_reason = ?
          WHERE id = ?
        `, [reason, sp.id]);

        logAccess({
          userId: m.id,
          action: 'revenue_split_blocked_participation',
          resource: `/api/revenue/splits/${sp.id}/block`,
          targetId: sp.id
        });
      }

      blockedMembers.push({
        userId: m.id,
        name: m.name,
        overallPct: pct,
        threshold,
        blockedSplitCount: splits.length
      });

      // EVENT 4 (PRD 16 Layer 5): pointpool_revenue_blocked
      try {
        const message = `🚫 Revenue blocked for ${m.name} in project '${projectTitle}' — participation ${pct}% is below ${threshold}% threshold.`;
        const link = `/participation-dashboard.html?projectId=${projectId}`;

        const recipients = new Set([m.id]);
        const admins = getAllAdmins();
        admins.forEach(a => recipients.add(a));

        const payload = {
          type: 'pointpool_revenue_blocked',
          projectId,
          userId: m.id,
          username: m.name,
          overallPct: pct,
          thresholdPct: threshold,
          message
        };

        sendPointPoolNotification({
          recipientUserIds: Array.from(recipients),
          eventType: 'pointpool_revenue_blocked',
          message,
          link,
          payload
        });
      } catch (notifErr) {
        console.error('[EVENT 4 REVENUE BLOCK NOTIFICATION ERROR]:', notifErr.message);
      }
    }
  }

  return { blockedMembers, checkedCount: members.length };
}

/**
 * 8. unblockRevenueSplit(splitId, adminId, reason)
 *    - Validates splitId exists
 *    - Validates adminId has Admin role
 *    - Validates reason.trim().length >= 10 (mandatory)
 *    - Updates revenue_splits: is_blocked = 0, block_reason = reason, unblocked_by = adminId, unblocked_at = NOW
 *    - Logs: access_log (action = 'revenue_split_unblocked')
 *    - Returns: updated split
 */
export function unblockRevenueSplit(splitId, adminId, reason) {
  if (!splitId || !adminId) {
    const err = new Error('splitId and adminId are required');
    err.status = 400;
    throw err;
  }

  const admin = queryOne('SELECT role FROM users WHERE id = ?', [adminId]);
  if (!admin || admin.role !== 'admin') {
    const err = new Error('Unauthorized: Admin role required to unblock revenue splits');
    err.status = 403;
    throw err;
  }

  if (!reason || typeof reason !== 'string' || reason.trim().length < 10) {
    const err = new Error('Unblock reason must be at least 10 characters');
    err.status = 400;
    throw err;
  }

  const split = queryOne('SELECT * FROM revenue_splits WHERE id = ?', [splitId]);
  if (!split) {
    const err = new Error('Revenue split not found');
    err.status = 404;
    throw err;
  }

  execute(`
    UPDATE revenue_splits
    SET is_blocked = 0,
        block_reason = ?,
        unblocked_by = ?,
        unblocked_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [reason.trim(), adminId, splitId]);

  logAccess({
    userId: adminId,
    action: 'revenue_split_unblocked',
    resource: `/api/pointpool/revenue-splits/${splitId}/unblock`,
    targetId: splitId
  });

  const updatedSplit = queryOne('SELECT * FROM revenue_splits WHERE id = ?', [splitId]);

  // EVENT 5 (PRD 16 Layer 5): pointpool_revenue_unblocked
  try {
    const event = queryOne('SELECT project_id FROM revenue_events WHERE id = ?', [split.revenue_event_id]);
    const projectId = event?.project_id || '';
    const project = projectId ? queryOne('SELECT title FROM projects WHERE id = ?', [projectId]) : null;
    const projectName = project?.title || 'Project';

    const unblockedUser = queryOne('SELECT name FROM users WHERE id = ?', [split.user_id]);
    const username = unblockedUser?.name || 'Member';
    const adminUser = queryOne('SELECT name FROM users WHERE id = ?', [adminId]);
    const adminName = adminUser?.name || 'Admin';

    const message = `✅ Revenue unblocked for ${username} in project '${projectName}' by Admin. Reason: ${reason.trim()}`;
    const link = `/participation-dashboard.html?projectId=${projectId}`;

    const payload = {
      type: 'pointpool_revenue_unblocked',
      projectId,
      userId: split.user_id,
      username,
      unblockedBy: {
        userId: adminId,
        username: adminName
      },
      reason: reason.trim(),
      message
    };

    sendPointPoolNotification({
      recipientUserIds: [split.user_id],
      eventType: 'pointpool_revenue_unblocked',
      message,
      link,
      payload
    });
  } catch (notifErr) {
    console.error('[EVENT 5 UNBLOCK NOTIFICATION ERROR]:', notifErr.message);
  }

  return updatedSplit;
}

/**
 * 9. setThreshold(projectId, thresholdPct, abandonDays, adminId)
 *    - Validates thresholdPct is 0–100
 *    - Validates abandonDays is 1–30
 *    - Validates project exists
 *    - Validates project status != 'LIVE' (threshold frozen after Go-Live)
 *    - UPSERT into participation_thresholds
 *    - Logs: access_log
 *    - Returns: threshold record
 */
export function setThreshold(projectId, thresholdPct, abandonDays, adminId) {
  if (!projectId || !adminId) {
    const err = new Error('projectId and adminId are required');
    err.status = 400;
    throw err;
  }

  const admin = queryOne('SELECT role FROM users WHERE id = ?', [adminId]);
  if (!admin || admin.role !== 'admin') {
    const err = new Error('Unauthorized: Admin role required to set threshold');
    err.status = 403;
    throw err;
  }

  const project = queryOne('SELECT * FROM projects WHERE id = ?', [projectId]);
  if (!project) {
    const err = new Error('Project not found');
    err.status = 404;
    throw err;
  }

  if (project.status === 'LIVE' || project.current_stage === 'LIVE') {
    const err = new Error('Cannot set threshold: project is already LIVE and threshold is frozen');
    err.status = 400;
    throw err;
  }

  const numPct = Number(thresholdPct);
  if (isNaN(numPct) || numPct < 0 || numPct > 100) {
    const err = new Error('thresholdPct must be a number between 0 and 100');
    err.status = 400;
    throw err;
  }

  const numDays = Number(abandonDays);
  if (isNaN(numDays) || !Number.isInteger(numDays) || numDays < 1 || numDays > 30) {
    const err = new Error('abandonDays must be an integer between 1 and 30');
    err.status = 400;
    throw err;
  }

  const existing = queryOne('SELECT id FROM participation_thresholds WHERE project_id = ?', [projectId]);
  if (existing) {
    execute(`
      UPDATE participation_thresholds
      SET threshold_pct = ?,
          abandonment_days = ?,
          set_by = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE project_id = ?
    `, [numPct, numDays, adminId, projectId]);
  } else {
    const id = crypto.randomUUID();
    execute(`
      INSERT INTO participation_thresholds (
        id, project_id, threshold_pct, abandonment_days, set_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `, [id, projectId, numPct, numDays, adminId]);
  }

  logAccess({
    userId: adminId,
    action: 'participation_threshold_set',
    resource: `/api/pointpool/projects/${projectId}/threshold`,
    targetId: projectId
  });

  return getThreshold(projectId);
}

/**
 * 10. getThreshold(projectId)
 *     - Returns participation_thresholds record for project
 *     - If not set → returns default: { threshold_pct: 20.00, abandonment_days: 7 }
 */
export function getThreshold(projectId) {
  if (!projectId) {
    return { threshold_pct: 20.00, abandonment_days: 7, is_default: true };
  }

  const record = queryOne('SELECT * FROM participation_thresholds WHERE project_id = ?', [projectId]);
  if (record) {
    return {
      ...record,
      threshold_pct: Number(record.threshold_pct),
      abandonment_days: Number(record.abandonment_days)
    };
  }

  return {
    project_id: projectId,
    threshold_pct: 20.00,
    abandonment_days: 7,
    is_default: true
  };
}

/**
 * 11. addToolLink(pointId, projectId, userId, toolName, toolUrl)
 *     - Validates pointId exists
 *     - Validates tool_url is a valid URL (must start with http:// or https://)
 *     - Validates toolName is not empty and max 100 chars
 *     - Validates userId is project member or Lead/Admin
 *     - Creates point_tool_links record
 *     - Logs: access_log
 *     - Returns: new tool link
 */
export function addToolLink(pointId, projectId, userId, toolName, toolUrl) {
  if (!pointId || !projectId || !userId || !toolName || !toolUrl) {
    const err = new Error('pointId, projectId, userId, toolName, and toolUrl are required');
    err.status = 400;
    throw err;
  }

  const trimmedName = toolName.trim();
  if (trimmedName.length === 0 || trimmedName.length > 100) {
    const err = new Error('toolName must be between 1 and 100 characters');
    err.status = 400;
    throw err;
  }

  const trimmedUrl = toolUrl.trim();
  if (!trimmedUrl.startsWith('http://') && !trimmedUrl.startsWith('https://')) {
    const err = new Error('toolUrl must start with http:// or https://');
    err.status = 400;
    throw err;
  }

  try {
    new URL(trimmedUrl);
  } catch {
    const err = new Error('Invalid URL format');
    err.status = 400;
    throw err;
  }

  const point = queryOne('SELECT id, deliverable_id FROM pipeline_checklist_points WHERE id = ?', [pointId]);
  if (!point) {
    const err = new Error('Point not found');
    err.status = 404;
    throw err;
  }

  const isPrivileged = isLeadOrAdmin(userId, projectId);
  if (!isPrivileged) {
    const member = queryOne('SELECT user_id FROM project_members WHERE project_id = ? AND user_id = ?', [projectId, userId]);
    const project = queryOne('SELECT owner_id FROM projects WHERE id = ?', [projectId]);
    if (!member && project?.owner_id !== userId) {
      const err = new Error('Unauthorized: only project members or Lead/Admin can attach tools');
      err.status = 403;
      throw err;
    }
  }

  const id = crypto.randomUUID();
  execute(`
    INSERT INTO point_tool_links (
      id, point_id, project_id, added_by, tool_name, tool_url, deleted_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, NULL, CURRENT_TIMESTAMP)
  `, [id, pointId, projectId, userId, trimmedName, trimmedUrl]);

  logAccess({
    userId,
    action: 'point_tool_link_added',
    resource: `/api/pointpool/points/${pointId}/tools`,
    targetId: id
  });

  return queryOne('SELECT * FROM point_tool_links WHERE id = ?', [id]);
}

/**
 * 12. getToolLinks(pointId)
 *     - Returns all point_tool_links WHERE point_id = pointId AND deleted_at IS NULL
 *     - Returns: array of tool links
 */
export function getToolLinks(pointId) {
  if (!pointId) return [];

  return queryAll(`
    SELECT ptl.*, u.name as added_by_name, u.email as added_by_email
    FROM point_tool_links ptl
    LEFT JOIN users u ON ptl.added_by = u.id
    WHERE ptl.point_id = ? AND ptl.deleted_at IS NULL
    ORDER BY ptl.created_at ASC
  `, [pointId]);
}

/**
 * 13. deleteToolLink(toolId, userId)
 *     - Validates toolLink exists and deleted_at IS NULL
 *     - Validates: userId = added_by OR userId is Lead/Admin
 *     - Sets: deleted_at = NOW (soft delete only)
 *     - Logs: access_log
 *     - Returns: success message
 */
export function deleteToolLink(toolId, userId) {
  if (!toolId || !userId) {
    const err = new Error('toolId and userId are required');
    err.status = 400;
    throw err;
  }

  const tool = queryOne('SELECT * FROM point_tool_links WHERE id = ? AND deleted_at IS NULL', [toolId]);
  if (!tool) {
    const err = new Error('Tool link not found or already deleted');
    err.status = 404;
    throw err;
  }

  const isOwner = (tool.added_by === userId);
  const isPrivileged = isLeadOrAdmin(userId, tool.project_id);

  if (!isOwner && !isPrivileged) {
    const err = new Error('Unauthorized: only tool owner or Lead/Admin can delete tool links');
    err.status = 403;
    throw err;
  }

  execute(`
    UPDATE point_tool_links
    SET deleted_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [toolId]);

  logAccess({
    userId,
    action: 'point_tool_link_deleted',
    resource: `/api/pointpool/tools/${toolId}`,
    targetId: toolId
  });

  return { success: true, message: 'Tool link deleted successfully' };
}
