import crypto from 'node:crypto';
import { queryAll, queryOne, execute } from '../db/database.js';
import { logAccess } from './auditService.js';
import { pushToUser, pushToProject, pushToGlobal } from './wsService.js';

/**
 * Helper to verify if user is Lead or Admin for a given project
 */
export function isLeadOrAdmin(userId, projectId = null) {
  if (!userId) return false;
  const user = queryOne('SELECT id, role, sub_role FROM users WHERE id = ?', [userId]);
  if (!user) return false;
  if (user.role === 'admin' || user.role === 'lead' || user.sub_role === 'lead') return true;
  if (projectId) {
    const project = queryOne('SELECT id, owner_id FROM projects WHERE id = ?', [projectId]);
    if (project && project.owner_id === userId) return true;
    const member = queryOne('SELECT role_in_project FROM project_members WHERE project_id = ? AND user_id = ?', [projectId, userId]);
    if (member && (member.role_in_project === 'admin_reviewer' || member.role_in_project === 'lead')) return true;
  }
  return false;
}

/**
 * Helper to query all users with Lead or Admin role in a project
 */
export function getProjectLeadsAndAdmins(projectId) {
  const ids = new Set();
  const admins = queryAll("SELECT id FROM users WHERE role = 'admin' AND status = 'active'");
  for (const a of admins) ids.add(a.id);

  if (projectId) {
    const project = queryOne("SELECT owner_id FROM projects WHERE id = ?", [projectId]);
    if (project && project.owner_id) ids.add(project.owner_id);

    const leads = queryAll(`
      SELECT pm.user_id 
      FROM project_members pm
      JOIN users u ON pm.user_id = u.id
      WHERE pm.project_id = ? 
        AND u.status = 'active'
        AND (pm.role_in_project IN ('lead', 'admin_reviewer', 'admin') OR u.role = 'lead' OR u.sub_role = 'lead')
    `, [projectId]);
    for (const l of leads) ids.add(l.user_id);
  }
  return Array.from(ids);
}

/**
 * Helper to query all members in a project
 */
export function getProjectMembers(projectId) {
  const ids = new Set();
  if (projectId) {
    const project = queryOne("SELECT owner_id FROM projects WHERE id = ?", [projectId]);
    if (project && project.owner_id) ids.add(project.owner_id);

    const members = queryAll(`
      SELECT pm.user_id 
      FROM project_members pm
      JOIN users u ON pm.user_id = u.id
      WHERE pm.project_id = ? AND u.status = 'active'
    `, [projectId]);
    for (const m of members) ids.add(m.user_id);
  }
  return Array.from(ids);
}

/**
 * Helper to query members in a project whose role matches a given stage or role
 */
export function getProjectRoleMembers(projectId, stageOrRole) {
  if (!projectId || !stageOrRole) return [];
  const s = stageOrRole.toUpperCase();
  let targetRole = 'researcher';
  if (s === 'DESIGN' || s === 'DESIGNER') targetRole = 'designer';
  else if (s === 'DEV' || s === 'DEVELOPER') targetRole = 'developer';
  else if (s === 'TEST' || s === 'TESTER') targetRole = 'tester';

  const ids = new Set();
  const members = queryAll(`
    SELECT pm.user_id, u.role, u.sub_role, pm.role_in_project
    FROM project_members pm
    JOIN users u ON pm.user_id = u.id
    WHERE pm.project_id = ? AND u.status = 'active'
  `, [projectId]);

  for (const m of members) {
    const r = (m.role || '').toLowerCase();
    const sr = (m.sub_role || '').toLowerCase();
    const rip = (m.role_in_project || '').toLowerCase();

    if (targetRole === 'researcher') {
      if (r === 'researcher' || sr === 'researcher' || rip.includes('research')) ids.add(m.user_id);
    } else if (targetRole === 'designer') {
      if (r === 'designer' || sr === 'designer' || rip.includes('design')) ids.add(m.user_id);
    } else if (targetRole === 'developer') {
      if (r === 'developer' || sr === 'developer' || rip.includes('dev')) ids.add(m.user_id);
    } else if (targetRole === 'tester') {
      if (r === 'tester' || sr === 'tester' || rip.includes('test') || (r === 'producer' && sr === 'tester')) ids.add(m.user_id);
    }
  }

  const owner = queryOne(`
    SELECT p.owner_id, u.role, u.sub_role 
    FROM projects p 
    JOIN users u ON p.owner_id = u.id 
    WHERE p.id = ? AND u.status = 'active'
  `, [projectId]);
  if (owner) {
    const r = (owner.role || '').toLowerCase();
    const sr = (owner.sub_role || '').toLowerCase();
    if (targetRole === 'researcher' && (r === 'researcher' || sr === 'researcher')) ids.add(owner.owner_id);
    if (targetRole === 'designer' && (r === 'designer' || sr === 'designer')) ids.add(owner.owner_id);
    if (targetRole === 'developer' && (r === 'developer' || sr === 'developer')) ids.add(owner.owner_id);
    if (targetRole === 'tester' && (r === 'tester' || sr === 'tester' || (r === 'producer' && sr === 'tester'))) ids.add(owner.owner_id);
  }

  return Array.from(ids);
}

/**
 * Helper to query all active platform admins
 */
export function getAllAdmins() {
  const admins = queryAll("SELECT id FROM users WHERE role = 'admin' AND status = 'active'");
  return admins.map(a => a.id);
}

/**
 * Dispatches notification DB record creation and real-time WebSocket broadcast
 */
export function sendPipelineNotification({
  recipientUserIds = [],
  eventType,
  message,
  link,
  projectId = null,
  deliverableId = null
}) {
  try {
    const timestamp = new Date().toISOString();
    const uniqueIds = Array.from(new Set((recipientUserIds || []).filter(Boolean)));
    const wsPayload = {
      type: eventType,
      projectId,
      deliverableId,
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
        console.error(`[PIPELINE NOTIFICATION INSERT ERROR for ${userId}]:`, insertErr.message);
      }
    }

    if (projectId) {
      pushToProject(projectId, eventType, wsPayload);
    }
    pushToGlobal(eventType, wsPayload);

  } catch (err) {
    console.error('[PIPELINE NOTIFICATION ERROR]:', err.message);
  }
}

/**
 * 1. createDeliverable(projectId, title, description, createdBy)
 *    - Validates project exists
 *    - Creates pipeline_deliverables record
 *    - current_stage = 'RESEARCH', status = 'ACTIVE'
 *    - Logs to access_log
 *    - Returns new deliverable
 */
export function createDeliverable(projectId, title, description = '', createdBy) {
  if (!projectId || !title || !createdBy) {
    throw new Error('projectId, title, and createdBy are required');
  }

  const project = queryOne('SELECT id FROM projects WHERE id = ?', [projectId]);
  if (!project) {
    throw new Error('Project not found');
  }

  const id = crypto.randomUUID();
  execute(`
    INSERT INTO pipeline_deliverables (
      id, project_id, title, description, current_stage, status, created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'RESEARCH', 'ACTIVE', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `, [id, projectId, title.trim(), description ? description.trim() : '', createdBy]);

  logAccess({
    userId: createdBy,
    action: 'pipeline_deliverable_created',
    resource: `/api/pipeline/deliverables/${id}`,
    targetId: id
  });

  return queryOne('SELECT * FROM pipeline_deliverables WHERE id = ?', [id]);
}

/**
 * 2. addChecklistPoint(deliverableId, stage, pointTitle, pointDescription, weight, createdBy)
 *    - Validates deliverable exists
 *    - Validates stage is one of: RESEARCH|DESIGN|DEV|TEST
 *    - Validates weight is 1-10
 *    - Stage must be current_stage of deliverable OR an open addendum target stage
 *    - Creates pipeline_checklist_points record
 *    - status = 'UNCLAIMED'
 *    - Logs to access_log
 *    - Returns new point
 */
export function addChecklistPoint(deliverableId, stage, pointTitle, pointDescription = '', weight = 5, createdBy) {
  if (!deliverableId || !stage || !pointTitle || !createdBy) {
    throw new Error('deliverableId, stage, pointTitle, and createdBy are required');
  }

  const validStages = ['RESEARCH', 'DESIGN', 'DEV', 'TEST'];
  const upperStage = stage.toUpperCase();
  if (!validStages.includes(upperStage)) {
    throw new Error(`Invalid stage: ${stage}. Must be one of ${validStages.join(', ')}`);
  }

  const numWeight = Number(weight);
  if (!Number.isInteger(numWeight) || numWeight < 1 || numWeight > 10) {
    throw new Error('Weight must be an integer between 1 and 10');
  }

  const deliverable = queryOne('SELECT * FROM pipeline_deliverables WHERE id = ?', [deliverableId]);
  if (!deliverable) {
    throw new Error('Deliverable not found');
  }

  // Stage must be current_stage of deliverable OR an open addendum target stage
  const isCurrentStage = (deliverable.current_stage === upperStage);
  const openAddendum = queryOne(
    `SELECT id FROM pipeline_addendum_requests 
     WHERE deliverable_id = ? AND target_stage = ? AND status = 'OPEN' LIMIT 1`,
    [deliverableId, upperStage]
  );

  if (!isCurrentStage && !openAddendum) {
    throw new Error(`Cannot add point to stage ${upperStage}. Deliverable is currently in ${deliverable.current_stage} and no open addendum exists for this stage.`);
  }

  const id = crypto.randomUUID();
  execute(`
    INSERT INTO pipeline_checklist_points (
      id, deliverable_id, stage, point_title, point_description, weight,
      status, created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'UNCLAIMED', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `, [id, deliverableId, upperStage, pointTitle.trim(), pointDescription ? pointDescription.trim() : '', numWeight, createdBy]);

  logAccess({
    userId: createdBy,
    action: 'pipeline_point_added',
    resource: `/api/pipeline/points/${id}`,
    targetId: id
  });

  return queryOne('SELECT * FROM pipeline_checklist_points WHERE id = ?', [id]);
}

/**
 * 3. claimPoint(pointId, userId, userRole)
 *    - Validates point exists and is UNCLAIMED
 *    - Validates userRole matches point's stage:
 *      RESEARCH → researcher
 *      DESIGN → designer
 *      DEV → developer
 *      TEST → tester / producer
 *      Lead/Admin can claim any stage
 *    - UNCLAIMED → CLAIMED, assigned_to = userId
 *    - Logs to access_log
 *    - Returns updated point
 */
export function claimPoint(pointId, userId, userRole) {
  if (!pointId || !userId || !userRole) {
    throw new Error('pointId, userId, and userRole are required');
  }

  const point = queryOne('SELECT * FROM pipeline_checklist_points WHERE id = ?', [pointId]);
  if (!point) {
    throw new Error('Point not found');
  }
  if (point.status !== 'UNCLAIMED') {
    throw new Error(`Point cannot be claimed in status ${point.status}`);
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
      throw new Error(`Role mismatch: ${userRole} cannot claim a ${point.stage} checklist point`);
    }
  }

  execute(`
    UPDATE pipeline_checklist_points 
    SET status = 'CLAIMED', assigned_to = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [userId, pointId]);

  logAccess({
    userId,
    action: 'pipeline_point_claimed',
    resource: `/api/pipeline/points/${pointId}`,
    targetId: pointId
  });

  return queryOne('SELECT * FROM pipeline_checklist_points WHERE id = ?', [pointId]);
}

/**
 * 4. startPoint(pointId, userId)
 *    - Validates point is CLAIMED
 *    - Validates userId = assigned_to
 *    - CLAIMED → IN_PROGRESS
 *    - Logs to access_log
 *    - Returns updated point
 */
export function startPoint(pointId, userId) {
  if (!pointId || !userId) {
    throw new Error('pointId and userId are required');
  }

  const point = queryOne('SELECT * FROM pipeline_checklist_points WHERE id = ?', [pointId]);
  if (!point) {
    throw new Error('Point not found');
  }
  if (point.status !== 'CLAIMED' && point.status !== 'REVISION_NEEDED') {
    throw new Error(`Point cannot be started in status ${point.status}`);
  }
  if (point.assigned_to !== userId) {
    throw new Error('Only the assigned member can start this point');
  }

  execute(`
    UPDATE pipeline_checklist_points 
    SET status = 'IN_PROGRESS', updated_at = CURRENT_TIMESTAMP 
    WHERE id = ?
  `, [pointId]);

  logAccess({
    userId,
    action: 'pipeline_point_started',
    resource: `/api/pipeline/points/${pointId}`,
    targetId: pointId
  });

  return queryOne('SELECT * FROM pipeline_checklist_points WHERE id = ?', [pointId]);
}

/**
 * 5. submitPoint(pointId, userId, assetUrl, toolLink, notes)
 *    - Validates point is IN_PROGRESS
 *    - Validates userId = assigned_to
 *    - IN_PROGRESS → SUBMITTED
 *    - Sets submitted_at = NOW
 *    - Logs to access_log
 *    - Returns updated point
 */
export function submitPoint(pointId, userId, assetUrl = null, toolLink = null, notes = null) {
  if (!pointId || !userId) {
    throw new Error('pointId and userId are required');
  }

  const point = queryOne('SELECT * FROM pipeline_checklist_points WHERE id = ?', [pointId]);
  if (!point) {
    throw new Error('Point not found');
  }
  if (point.status !== 'IN_PROGRESS' && point.status !== 'REVISION_NEEDED') {
    throw new Error(`Point cannot be submitted in status ${point.status}`);
  }
  if (point.assigned_to !== userId) {
    throw new Error('Only the assigned member can submit this point');
  }

  let updatedDesc = point.point_description || '';
  if (notes && notes.trim()) {
    updatedDesc = updatedDesc ? `${updatedDesc}\n[Notes: ${notes.trim()}]` : `[Notes: ${notes.trim()}]`;
  }

  execute(`
    UPDATE pipeline_checklist_points 
    SET status = 'SUBMITTED',
        submitted_at = CURRENT_TIMESTAMP,
        asset_url = COALESCE(?, asset_url),
        tool_link = COALESCE(?, tool_link),
        point_description = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [assetUrl || null, toolLink || null, updatedDesc, pointId]);

  logAccess({
    userId,
    action: 'pipeline_point_submitted',
    resource: `/api/pipeline/points/${pointId}`,
    targetId: pointId
  });

  const updatedPoint = queryOne('SELECT * FROM pipeline_checklist_points WHERE id = ?', [pointId]);

  // EVENT 1: Point Submitted
  try {
    const deliverable = queryOne('SELECT project_id, title FROM pipeline_deliverables WHERE id = ?', [point.deliverable_id]);
    const projectId = deliverable ? deliverable.project_id : null;
    const submitter = queryOne('SELECT name FROM users WHERE id = ?', [userId]);
    const submitterName = submitter?.name || 'Member';
    const leadsAndAdmins = getProjectLeadsAndAdmins(projectId);

    sendPipelineNotification({
      recipientUserIds: leadsAndAdmins,
      eventType: 'pipeline_point_submitted',
      message: `${submitterName} submitted point: ${point.point_title} — ready for review`,
      link: `/projects/${projectId}?tab=pipeline`,
      projectId,
      deliverableId: point.deliverable_id
    });
  } catch (notifErr) {
    console.error('[EVENT 1 NOTIFICATION ERROR]:', notifErr.message);
  }

  return updatedPoint;
}

/**
 * 6. approvePoint(pointId, approverId)
 *    - Validates point is SUBMITTED
 *    - Validates approver is Lead or Admin
 *    - SUBMITTED → APPROVED
 *    - Sets approved_at = NOW, approved_by = approverId
 *    - Calls computeStagePercent() after approval
 *    - Logs to access_log
 *    - Returns { updatedPoint, stagePercent }
 */
export function approvePoint(pointId, approverId) {
  if (!pointId || !approverId) {
    throw new Error('pointId and approverId are required');
  }

  const point = queryOne('SELECT * FROM pipeline_checklist_points WHERE id = ?', [pointId]);
  if (!point) {
    throw new Error('Point not found');
  }
  if (point.status !== 'SUBMITTED') {
    throw new Error(`Point cannot be approved in status ${point.status}`);
  }

  const deliverable = queryOne('SELECT project_id FROM pipeline_deliverables WHERE id = ?', [point.deliverable_id]);
  const projectId = deliverable ? deliverable.project_id : null;
  if (!isLeadOrAdmin(approverId, projectId)) {
    throw new Error('Unauthorized: only Lead or Admin can approve checklist points');
  }

  execute(`
    UPDATE pipeline_checklist_points 
    SET status = 'APPROVED',
        approved_at = CURRENT_TIMESTAMP,
        approved_by = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [approverId, pointId]);

  const updatedPoint = queryOne('SELECT * FROM pipeline_checklist_points WHERE id = ?', [pointId]);
  const stagePercent = computeStagePercent(point.deliverable_id, point.stage);

  logAccess({
    userId: approverId,
    action: 'pipeline_point_approved',
    resource: `/api/pipeline/points/${pointId}`,
    targetId: pointId
  });

  // EVENT 2: Point Approved & EVENT 4: Stage Reached 100%
  try {
    const deliverable = queryOne('SELECT project_id, title FROM pipeline_deliverables WHERE id = ?', [point.deliverable_id]);
    const projectId = deliverable ? deliverable.project_id : null;

    if (point.assigned_to) {
      sendPipelineNotification({
        recipientUserIds: [point.assigned_to],
        eventType: 'pipeline_point_approved',
        message: `Your point '${point.point_title}' has been approved ✅`,
        link: `/projects/${projectId}?tab=pipeline`,
        projectId,
        deliverableId: point.deliverable_id
      });
    }

    if (Number(stagePercent) === 100) {
      const leadsAndAdmins = getProjectLeadsAndAdmins(projectId);
      sendPipelineNotification({
        recipientUserIds: leadsAndAdmins,
        eventType: 'pipeline_stage_complete',
        message: `${point.stage} stage is 100% complete — handoff ready for deliverable: ${deliverable?.title || 'Deliverable'}`,
        link: `/projects/${projectId}?tab=pipeline`,
        projectId,
        deliverableId: point.deliverable_id
      });
    }
  } catch (notifErr) {
    console.error('[EVENT 2/4 NOTIFICATION ERROR]:', notifErr.message);
  }

  return { updatedPoint, stagePercent };
}

/**
 * 7. revisionPoint(pointId, approverId, reason)
 *    - Validates point is SUBMITTED
 *    - Validates approver is Lead or Admin
 *    - SUBMITTED → IN_PROGRESS (back to work)
 *    - Stores revision reason in point_description addendum
 *    - Logs to access_log
 *    - Returns updated point
 */
export function revisionPoint(pointId, approverId, reason = '') {
  if (!pointId || !approverId) {
    throw new Error('pointId and approverId are required');
  }

  const point = queryOne('SELECT * FROM pipeline_checklist_points WHERE id = ?', [pointId]);
  if (!point) {
    throw new Error('Point not found');
  }
  if (point.status !== 'SUBMITTED') {
    throw new Error(`Point cannot be sent to revision in status ${point.status}`);
  }

  const deliverable = queryOne('SELECT project_id FROM pipeline_deliverables WHERE id = ?', [point.deliverable_id]);
  const projectId = deliverable ? deliverable.project_id : null;
  if (!isLeadOrAdmin(approverId, projectId)) {
    throw new Error('Unauthorized: only Lead or Admin can request revision on checklist points');
  }

  const revNote = reason ? reason.trim() : 'Revision requested';
  const updatedDesc = point.point_description 
    ? `${point.point_description}\n[Revision Requested: ${revNote}]`
    : `[Revision Requested: ${revNote}]`;

  execute(`
    UPDATE pipeline_checklist_points 
    SET status = 'IN_PROGRESS',
        point_description = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [updatedDesc, pointId]);

  logAccess({
    userId: approverId,
    action: 'pipeline_point_revision_requested',
    resource: `/api/pipeline/points/${pointId}`,
    targetId: pointId
  });

  const updatedPoint = queryOne('SELECT * FROM pipeline_checklist_points WHERE id = ?', [pointId]);

  // EVENT 3: Point Sent to Revision
  try {
    if (point.assigned_to) {
      sendPipelineNotification({
        recipientUserIds: [point.assigned_to],
        eventType: 'pipeline_point_revision',
        message: `Revision requested on your point '${point.point_title}': ${revNote}`,
        link: `/projects/${projectId}?tab=pipeline`,
        projectId,
        deliverableId: point.deliverable_id
      });
    }
  } catch (notifErr) {
    console.error('[EVENT 3 NOTIFICATION ERROR]:', notifErr.message);
  }

  return updatedPoint;
}

/**
 * 8. computeStagePercent(deliverableId, stage)
 *    - Fetches all checklist points for this deliverable + stage
 *    - Formula:
 *      pct = SUM(weight WHERE status='APPROVED') / SUM(weight of ALL points) * 100
 *    - Returns rounded to 2 decimal places
 *    - If no points exist → returns 0.00
 *    - NEVER uses slider or manual input — pure math only
 */
export function computeStagePercent(deliverableId, stage) {
  if (!deliverableId || !stage) return 0.00;

  const points = queryAll(
    'SELECT weight, status FROM pipeline_checklist_points WHERE deliverable_id = ? AND stage = ?',
    [deliverableId, stage.toUpperCase()]
  );

  if (!points || points.length === 0) {
    return 0.00;
  }

  const totalWeight = points.reduce((sum, p) => sum + Number(p.weight || 0), 0);
  if (totalWeight === 0) {
    return 0.00;
  }

  const approvedWeight = points
    .filter(p => p.status === 'APPROVED')
    .reduce((sum, p) => sum + Number(p.weight || 0), 0);

  const pct = (approvedWeight / totalWeight) * 100;
  return Number(pct.toFixed(2));
}

/**
 * 9. approveHandoff(deliverableId, fromStage, toStage, handoffNotes, approverId)
 *    - Validates approver is Lead or Admin
 *    - Validates fromStage % = 100.00 (call computeStagePercent)
 *    - Validates toStage is the next logical stage:
 *      RESEARCH→DESIGN, DESIGN→DEV, DEV→TEST, TEST→COMPLETE
 *    - Validates no open addendum requests against fromStage
 *    - Builds snapshot_json of all approved points in fromStage
 *    - Inserts into pipeline_stage_handoffs (append-only)
 *    - Updates deliverable current_stage = toStage
 *    - Logs to access_log
 *    - Returns handoff record
 */
export function approveHandoff(deliverableId, fromStage, toStage, handoffNotes = '', approverId) {
  if (!deliverableId || !fromStage || !toStage || !approverId) {
    throw new Error('deliverableId, fromStage, toStage, and approverId are required');
  }

  const deliverable = queryOne('SELECT * FROM pipeline_deliverables WHERE id = ?', [deliverableId]);
  if (!deliverable) {
    throw new Error('Deliverable not found');
  }

  if (!isLeadOrAdmin(approverId, deliverable.project_id)) {
    throw new Error('Unauthorized: only Lead or Admin can approve stage handoffs');
  }

  const upperFrom = fromStage.toUpperCase();
  const upperTo = toStage.toUpperCase();

  const validTransitions = {
    'RESEARCH': 'DESIGN',
    'DESIGN': 'DEV',
    'DEV': 'TEST',
    'TEST': 'COMPLETE'
  };

  if (validTransitions[upperFrom] !== upperTo) {
    throw new Error(`Invalid stage transition: cannot handoff from ${upperFrom} to ${upperTo}`);
  }

  if (deliverable.current_stage !== upperFrom) {
    throw new Error(`Deliverable current stage is ${deliverable.current_stage}, cannot handoff from ${upperFrom}`);
  }

  const completionPct = computeStagePercent(deliverableId, upperFrom);
  if (completionPct < 100.00) {
    throw new Error(`Cannot handoff: ${upperFrom} is only ${completionPct}% complete (100.00% required)`);
  }

  const openAddendums = queryOne(
    `SELECT COUNT(*) as count FROM pipeline_addendum_requests 
     WHERE deliverable_id = ? AND target_stage = ? AND status = 'OPEN'`,
    [deliverableId, upperFrom]
  );
  if (openAddendums && openAddendums.count > 0) {
    throw new Error(`Cannot handoff: ${openAddendums.count} open addendum request(s) exist for stage ${upperFrom}`);
  }

  const existingHandoff = queryOne(
    'SELECT id FROM pipeline_stage_handoffs WHERE deliverable_id = ? AND from_stage = ?',
    [deliverableId, upperFrom]
  );
  if (existingHandoff) {
    throw new Error(`Handoff for stage ${upperFrom} has already been recorded`);
  }

  const stagePoints = queryAll(
    'SELECT * FROM pipeline_checklist_points WHERE deliverable_id = ? AND stage = ? ORDER BY created_at ASC',
    [deliverableId, upperFrom]
  );
  const snapshotJson = JSON.stringify(stagePoints);

  const handoffId = crypto.randomUUID();
  execute(`
    INSERT INTO pipeline_stage_handoffs (
      id, deliverable_id, from_stage, to_stage, stage_completion_pct,
      handoff_notes, approved_by, snapshot_json, created_at
    ) VALUES (?, ?, ?, ?, 100.00, ?, ?, ?, CURRENT_TIMESTAMP)
  `, [handoffId, deliverableId, upperFrom, upperTo, handoffNotes ? handoffNotes.trim() : '', approverId, snapshotJson]);

  const newDelivStatus = (upperTo === 'COMPLETE') ? 'COMPLETE' : deliverable.status;
  execute(`
    UPDATE pipeline_deliverables 
    SET current_stage = ?, status = ?, updated_at = CURRENT_TIMESTAMP 
    WHERE id = ?
  `, [upperTo, newDelivStatus, deliverableId]);

  logAccess({
    userId: approverId,
    action: 'pipeline_stage_handoff_approved',
    resource: `/api/pipeline/deliverables/${deliverableId}/handoff`,
    targetId: handoffId
  });

  const createdHandoff = queryOne('SELECT * FROM pipeline_stage_handoffs WHERE id = ?', [handoffId]);

  // EVENT 5: Handoff Approved & EVENT 9: All Deliverables Complete
  try {
    let nextStageRecipients = [];
    if (upperTo === 'COMPLETE') {
      nextStageRecipients = getProjectMembers(deliverable.project_id);
    } else {
      nextStageRecipients = getProjectRoleMembers(deliverable.project_id, upperTo);
    }

    sendPipelineNotification({
      recipientUserIds: nextStageRecipients,
      eventType: 'pipeline_handoff_approved',
      message: `${upperFrom} stage approved — ${upperTo} stage is now unlocked for deliverable: ${deliverable.title}`,
      link: `/projects/${deliverable.project_id}?tab=pipeline`,
      projectId: deliverable.project_id,
      deliverableId
    });

    if (upperTo === 'COMPLETE') {
      const allDelivs = queryAll('SELECT id, status FROM pipeline_deliverables WHERE project_id = ?', [deliverable.project_id]);
      const allComplete = allDelivs.length > 0 && allDelivs.every(d => d.status === 'COMPLETE');
      if (allComplete) {
        const proj = queryOne('SELECT id, title FROM projects WHERE id = ?', [deliverable.project_id]);
        const platformAdmins = getAllAdmins();
        sendPipelineNotification({
          recipientUserIds: platformAdmins,
          eventType: 'pipeline_project_ready_for_live',
          message: `🚀 All deliverables complete — project '${proj?.title || 'Project'}' is ready for Go-Live approval`,
          link: '/admin/pipeline',
          projectId: deliverable.project_id,
          deliverableId
        });
      }
    }
  } catch (notifErr) {
    console.error('[EVENT 5/9 NOTIFICATION ERROR]:', notifErr.message);
  }

  return createdHandoff;
}

/**
 * 10. raiseAddendum(deliverableId, requestingStage, targetStage, pointTitle, reason, type, raisedBy)
 *     - type must be ADDENDUM or BUG_TICKET
 *     - If BUG_TICKET: requestingStage must be TEST, targetStage must be DEV
 *     - Validates deliverable exists
 *     - Creates pipeline_addendum_requests record
 *     - status = 'OPEN'
 *     - Logs to access_log
 *     - Returns new addendum record
 */
export function raiseAddendum(deliverableId, requestingStage, targetStage, pointTitle, reason, type = 'ADDENDUM', raisedBy) {
  if (!deliverableId || !requestingStage || !targetStage || !pointTitle || !reason || !raisedBy) {
    throw new Error('deliverableId, requestingStage, targetStage, pointTitle, reason, and raisedBy are required');
  }

  const deliverable = queryOne('SELECT * FROM pipeline_deliverables WHERE id = ?', [deliverableId]);
  if (!deliverable) {
    throw new Error('Deliverable not found');
  }

  const upperType = (type || 'ADDENDUM').toUpperCase();
  if (upperType !== 'ADDENDUM' && upperType !== 'BUG_TICKET') {
    throw new Error('type must be ADDENDUM or BUG_TICKET');
  }

  const upperReq = requestingStage.toUpperCase();
  const upperTgt = targetStage.toUpperCase();

  if (upperType === 'BUG_TICKET') {
    if (upperReq !== 'TEST' || upperTgt !== 'DEV') {
      throw new Error('Bug tickets can only be raised from TEST stage to DEV stage');
    }
  }

  const addendumId = crypto.randomUUID();
  execute(`
    INSERT INTO pipeline_addendum_requests (
      id, deliverable_id, requesting_stage, target_stage, point_title,
      reason, status, raised_by, type, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'OPEN', ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `, [addendumId, deliverableId, upperReq, upperTgt, pointTitle.trim(), reason.trim(), raisedBy, upperType]);

  // If BUG_TICKET, find targeted DEV point and set status to REVISION_NEEDED
  if (upperType === 'BUG_TICKET') {
    execute(`
      UPDATE pipeline_checklist_points 
      SET status = 'REVISION_NEEDED', updated_at = CURRENT_TIMESTAMP 
      WHERE deliverable_id = ? AND stage = 'DEV' AND (point_title = ? OR id = ?)
    `, [deliverableId, pointTitle.trim(), pointTitle.trim()]);
  }

  logAccess({
    userId: raisedBy,
    action: upperType === 'BUG_TICKET' ? 'pipeline_bug_ticket_raised' : 'pipeline_addendum_raised',
    resource: `/api/pipeline/deliverables/${deliverableId}/addendum`,
    targetId: addendumId
  });

  const createdAddendum = queryOne('SELECT * FROM pipeline_addendum_requests WHERE id = ?', [addendumId]);

  // EVENT 6: Addendum Request Raised & EVENT 8: Bug Ticket Raised
  try {
    if (upperType === 'BUG_TICKET') {
      const devMembers = getProjectRoleMembers(deliverable.project_id, 'DEV');
      const leadsAndAdmins = getProjectLeadsAndAdmins(deliverable.project_id);
      const recipients = Array.from(new Set([...devMembers, ...leadsAndAdmins]));

      sendPipelineNotification({
        recipientUserIds: recipients,
        eventType: 'pipeline_bug_ticket_raised',
        message: `🐛 Bug ticket raised against DEV point '${pointTitle.trim()}' by Tester — revision required`,
        link: `/projects/${deliverable.project_id}?tab=pipeline`,
        projectId: deliverable.project_id,
        deliverableId
      });
    } else {
      const targetRoleMembers = getProjectRoleMembers(deliverable.project_id, upperTgt);
      const leadsAndAdmins = getProjectLeadsAndAdmins(deliverable.project_id);
      const recipients = Array.from(new Set([...targetRoleMembers, ...leadsAndAdmins]));

      sendPipelineNotification({
        recipientUserIds: recipients,
        eventType: 'pipeline_addendum_raised',
        message: `Addendum requested on ${upperTgt} stage by ${upperReq}: '${pointTitle.trim()}'`,
        link: `/projects/${deliverable.project_id}?tab=pipeline`,
        projectId: deliverable.project_id,
        deliverableId
      });
    }
  } catch (notifErr) {
    console.error('[EVENT 6/8 NOTIFICATION ERROR]:', notifErr.message);
  }

  return createdAddendum;
}

/**
 * 11. fulfillAddendum(addendumId, pointId, resolverId)
 *     - Validates addendum is OPEN
 *     - Validates resolver is Lead or Admin
 *     - Validates pointId exists and is APPROVED
 *     - Status → FULFILLED
 *     - Sets resolved_by, resolved_at
 *     - Logs to access_log
 *     - Returns updated addendum
 */
export function fulfillAddendum(addendumId, pointId, resolverId) {
  if (!addendumId || !pointId || !resolverId) {
    throw new Error('addendumId, pointId, and resolverId are required');
  }

  const addendum = queryOne('SELECT * FROM pipeline_addendum_requests WHERE id = ?', [addendumId]);
  if (!addendum) {
    throw new Error('Addendum not found');
  }
  if (addendum.status !== 'OPEN') {
    throw new Error(`Addendum is already ${addendum.status}`);
  }

  const deliverable = queryOne('SELECT project_id FROM pipeline_deliverables WHERE id = ?', [addendum.deliverable_id]);
  const projectId = deliverable ? deliverable.project_id : null;
  if (!isLeadOrAdmin(resolverId, projectId)) {
    throw new Error('Unauthorized: only Lead or Admin can fulfill addendums');
  }

  const point = queryOne('SELECT * FROM pipeline_checklist_points WHERE id = ?', [pointId]);
  if (!point) {
    throw new Error('Checklist point not found');
  }
  if (point.status !== 'APPROVED') {
    throw new Error('Checklist point must be APPROVED to fulfill addendum');
  }

  execute(`
    UPDATE pipeline_addendum_requests 
    SET status = 'FULFILLED', resolved_by = ?, resolved_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP 
    WHERE id = ?
  `, [resolverId, addendumId]);

  logAccess({
    userId: resolverId,
    action: 'pipeline_addendum_fulfilled',
    resource: `/api/pipeline/addendum/${addendumId}/fulfill`,
    targetId: addendumId
  });

  const updatedAddendum = queryOne('SELECT * FROM pipeline_addendum_requests WHERE id = ?', [addendumId]);

  // EVENT 7: Addendum Fulfilled
  try {
    const requestingMembers = getProjectRoleMembers(projectId, addendum.requesting_stage);
    sendPipelineNotification({
      recipientUserIds: requestingMembers,
      eventType: 'pipeline_addendum_fulfilled',
      message: `Addendum fulfilled — '${addendum.point_title}' added and approved in ${addendum.target_stage} stage`,
      link: `/projects/${projectId}?tab=pipeline`,
      projectId,
      deliverableId: addendum.deliverable_id
    });
  } catch (notifErr) {
    console.error('[EVENT 7 NOTIFICATION ERROR]:', notifErr.message);
  }

  return updatedAddendum;
}

/**
 * 12. rejectAddendum(addendumId, reason, resolverId)
 *     - Validates addendum is OPEN
 *     - Validates resolver is Admin only
 *     - Status → REJECTED
 *     - Sets resolved_by, resolved_at
 *     - Logs to access_log
 *     - Returns updated addendum
 */
export function rejectAddendum(addendumId, reason, resolverId) {
  if (!addendumId || !reason || !resolverId) {
    throw new Error('addendumId, reason, and resolverId are required');
  }

  const addendum = queryOne('SELECT * FROM pipeline_addendum_requests WHERE id = ?', [addendumId]);
  if (!addendum) {
    throw new Error('Addendum not found');
  }
  if (addendum.status !== 'OPEN') {
    throw new Error(`Addendum is already ${addendum.status}`);
  }

  const user = queryOne('SELECT role FROM users WHERE id = ?', [resolverId]);
  if (!user || user.role !== 'admin') {
    throw new Error('Unauthorized: only Admin can reject addendums');
  }

  const updatedReason = `${addendum.reason}\n[Rejected: ${reason.trim()}]`;

  execute(`
    UPDATE pipeline_addendum_requests 
    SET status = 'REJECTED', reason = ?, resolved_by = ?, resolved_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP 
    WHERE id = ?
  `, [updatedReason, resolverId, addendumId]);

  logAccess({
    userId: resolverId,
    action: 'pipeline_addendum_rejected',
    resource: `/api/pipeline/addendum/${addendumId}/reject`,
    targetId: addendumId
  });

  return queryOne('SELECT * FROM pipeline_addendum_requests WHERE id = ?', [addendumId]);
}

/**
 * 13. adminApproveLive(projectId, adminId, approvalNotes)
 *     - Validates adminId has Admin role
 *     - Fetches all deliverables for project
 *     - Validates ALL deliverables status = 'COMPLETE'
 *     - Validates zero open addendum requests across all deliverables
 *     - Updates ALL deliverables status = 'LIVE'
 *     - Updates project stage = 'LIVE' in projects table
 *     - Logs immutable entry in access_log
 *     - Returns updated project
 */
export function adminApproveLive(projectId, adminId, approvalNotes = '') {
  if (!projectId || !adminId) {
    throw new Error('projectId and adminId are required');
  }

  const admin = queryOne('SELECT role FROM users WHERE id = ?', [adminId]);
  if (!admin || admin.role !== 'admin') {
    throw new Error('Unauthorized: Admin role required for Live approval');
  }

  const project = queryOne('SELECT * FROM projects WHERE id = ?', [projectId]);
  if (!project) {
    throw new Error('Project not found');
  }

  const deliverables = queryAll('SELECT * FROM pipeline_deliverables WHERE project_id = ?', [projectId]);
  if (!deliverables || deliverables.length === 0) {
    throw new Error('Cannot approve Live: No deliverables found for this project');
  }

  const incomplete = deliverables.filter(d => d.status !== 'COMPLETE');
  if (incomplete.length > 0) {
    throw new Error(`Cannot approve Live: Deliverable '${incomplete[0].title}' is not COMPLETE (status: ${incomplete[0].status})`);
  }

  const openAddendums = queryOne(`
    SELECT COUNT(*) as count 
    FROM pipeline_addendum_requests ar 
    JOIN pipeline_deliverables d ON ar.deliverable_id = d.id 
    WHERE d.project_id = ? AND ar.status = 'OPEN'
  `, [projectId]);

  if (openAddendums && openAddendums.count > 0) {
    throw new Error(`Cannot approve Live: ${openAddendums.count} open addendum/bug ticket request(s) exist`);
  }

  execute(`
    UPDATE pipeline_deliverables 
    SET status = 'LIVE', current_stage = 'LIVE', updated_at = CURRENT_TIMESTAMP 
    WHERE project_id = ?
  `, [projectId]);

  execute(`
    UPDATE projects 
    SET current_stage = 'LIVE', status = 'LIVE', updated_at = CURRENT_TIMESTAMP 
    WHERE id = ?
  `, [projectId]);

  logAccess({
    userId: adminId,
    action: 'pipeline_admin_approved_live',
    resource: `/api/admin/projects/${projectId}/pipeline/approve-live`,
    targetId: projectId
  });

  const updatedProject = queryOne('SELECT * FROM projects WHERE id = ?', [projectId]);

  // EVENT 10: Go-Live Approved
  try {
    const allMembers = getProjectMembers(projectId);
    sendPipelineNotification({
      recipientUserIds: allMembers,
      eventType: 'pipeline_project_live',
      message: `🎉 Project '${project.title}' has gone LIVE! Admin approval granted.`,
      link: `/projects/${projectId}`,
      projectId,
      deliverableId: null
    });
  } catch (notifErr) {
    console.error('[EVENT 10 NOTIFICATION ERROR]:', notifErr.message);
  }

  return updatedProject;
}

/**
 * 14. getDeliverableDetail(deliverableId)
 *     - Returns full pipeline tree:
 *       deliverable + all 4 stages' checklist points
 *       + all handoff records + all addendum records
 *       + computed % per stage
 */
export function getDeliverableDetail(deliverableId) {
  if (!deliverableId) {
    throw new Error('deliverableId is required');
  }

  const deliverable = queryOne('SELECT * FROM pipeline_deliverables WHERE id = ?', [deliverableId]);
  if (!deliverable) {
    throw new Error('Deliverable not found');
  }

  const allPoints = queryAll(
    'SELECT * FROM pipeline_checklist_points WHERE deliverable_id = ? ORDER BY created_at ASC',
    [deliverableId]
  );

  const stagesList = ['RESEARCH', 'DESIGN', 'DEV', 'TEST'];
  const stages = {};
  const summary = {};

  for (const stg of stagesList) {
    const points = allPoints.filter(p => p.stage === stg);
    const pct = computeStagePercent(deliverableId, stg);
    stages[stg] = {
      stage: stg,
      points,
      completion_pct: pct
    };
    summary[stg] = pct;
  }

  const handoffs = queryAll(
    'SELECT * FROM pipeline_stage_handoffs WHERE deliverable_id = ? ORDER BY created_at ASC',
    [deliverableId]
  );

  const addendums = queryAll(
    'SELECT * FROM pipeline_addendum_requests WHERE deliverable_id = ? ORDER BY created_at ASC',
    [deliverableId]
  );

  return {
    deliverable,
    stages,
    summary,
    handoffs,
    addendums
  };
}
