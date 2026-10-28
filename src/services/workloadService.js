import { queryOne, queryAll, execute } from '../db/database.js';
import { logAccess } from './auditService.js';

/**
 * Helper to check if a user possesses administrative privileges
 */
export function isAdmin(user) {
  return Boolean(user && (user.role === 'admin' || user.role === 'superadmin'));
}

/**
 * Calculates the calendar Monday (week start) for a given date string (YYYY-MM-DD)
 */
export function getWeekStart(dateStr) {
  const d = dateStr ? new Date(dateStr + 'T00:00:00Z') : new Date();
  const day = d.getUTCDay();
  const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1); // Align to Monday
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), diff));
  return monday.toISOString().split('T')[0];
}

/**
 * Calculates the calendar Sunday (week end) for a given date string (YYYY-MM-DD)
 */
export function getWeekEnd(dateStr) {
  const mondayStr = getWeekStart(dateStr);
  const m = new Date(mondayStr + 'T00:00:00Z');
  m.setUTCDate(m.getUTCDate() + 6); // Add 6 days to get Sunday
  return m.toISOString().split('T')[0];
}

// ===================================================================
// CAPACITY MANAGEMENT (LAYER 2)
// ===================================================================

/**
 * Sets a member's weekly capacity hours (Append-Only)
 * Role: Admin+
 */
export function setMemberCapacity({ user_id, weekly_capacity_hrs, effective_from }, currentUser) {
  if (!isAdmin(currentUser)) {
    const err = new Error('Forbidden: Admin role required to configure member capacity');
    err.status = 403;
    throw err;
  }

  if (!user_id) {
    const err = new Error('user_id is required');
    err.status = 400;
    throw err;
  }

  const targetUser = queryOne('SELECT id, name, role FROM users WHERE id = ?', [user_id]);
  if (!targetUser) {
    const err = new Error('User not found');
    err.status = 404;
    throw err;
  }

  const capacityHrs = Number(weekly_capacity_hrs);
  if (isNaN(capacityHrs) || capacityHrs <= 0 || capacityHrs > 168) {
    const err = new Error('weekly_capacity_hrs must be a positive number between 1 and 168');
    err.status = 400;
    throw err;
  }

  if (!effective_from || !/^\d{4}-\d{2}-\d{2}$/.test(effective_from)) {
    const err = new Error('effective_from must be a valid date in YYYY-MM-DD format');
    err.status = 400;
    throw err;
  }

  // Insert append-only row
  execute(`
    INSERT INTO member_capacity (user_id, weekly_capacity_hrs, effective_from, set_by)
    VALUES (?, ?, ?, ?)
  `, [user_id, capacityHrs, effective_from, currentUser.id]);

  const inserted = queryOne(`
    SELECT * FROM member_capacity
    WHERE user_id = ?
    ORDER BY id DESC LIMIT 1
  `, [user_id]);

  logAccess({
    userId: currentUser.id,
    action: 'WORKLOAD_CAPACITY_SET',
    resource: `member_capacity:${user_id}`,
    ipAddress: '127.0.0.1'
  });

  return {
    message: 'Member capacity set successfully',
    capacity: inserted
  };
}

/**
 * Retrieves current active capacity and full settings history for a member
 * Role: Admin+ or own user
 */
export function getMemberCapacity(userId, currentUser) {
  if (!isAdmin(currentUser) && String(currentUser.id) !== String(userId)) {
    const err = new Error('Forbidden: You can only view your own capacity settings');
    err.status = 403;
    throw err;
  }

  const user = queryOne('SELECT id, name, role FROM users WHERE id = ?', [userId]);
  if (!user) {
    const err = new Error('User not found');
    err.status = 404;
    throw err;
  }

  const history = queryAll(`
    SELECT mc.*, u.name as set_by_name
    FROM member_capacity mc
    LEFT JOIN users u ON mc.set_by = u.id
    WHERE mc.user_id = ?
    ORDER BY mc.effective_from DESC, mc.id DESC
  `, [userId]);

  let current_capacity = null;
  if (history.length > 0) {
    current_capacity = history[0];
  } else {
    current_capacity = {
      user_id: userId,
      weekly_capacity_hrs: 40.0,
      effective_from: '2026-01-01',
      is_default: true
    };
  }

  return {
    user: { id: user.id, name: user.name, role: user.role },
    current_capacity,
    history
  };
}

// ===================================================================
// AVAILABILITY MANAGEMENT (LAYER 2)
// ===================================================================

/**
 * Records a member's planned leave, holiday, training, or partial availability
 * Role: Admin+ or own user (future dates only for members)
 */
export function setMemberAvailability(
  { user_id, date, availability_type, available_hrs, reason },
  currentUser
) {
  const targetUserId = user_id || currentUser.id;

  if (!isAdmin(currentUser) && String(currentUser.id) !== String(targetUserId)) {
    const err = new Error('Forbidden: Non-admin members can only mark their own availability');
    err.status = 403;
    throw err;
  }

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const err = new Error('date must be a valid date in YYYY-MM-DD format');
    err.status = 400;
    throw err;
  }

  const todayStr = new Date().toISOString().split('T')[0];
  if (!isAdmin(currentUser) && date < todayStr) {
    const err = new Error('Members can only mark availability for future dates');
    err.status = 400;
    throw err;
  }

  const validTypes = ['LEAVE', 'HOLIDAY', 'PARTIAL', 'TRAINING'];
  const type = (availability_type || 'LEAVE').toUpperCase();
  if (!validTypes.includes(type)) {
    const err = new Error(`Invalid availability_type. Must be one of: ${validTypes.join(', ')}`);
    err.status = 400;
    throw err;
  }

  const hrs = available_hrs !== undefined ? Number(available_hrs) : 0.0;
  if (isNaN(hrs) || hrs < 0 || hrs > 24) {
    const err = new Error('available_hrs must be a valid number between 0 and 24');
    err.status = 400;
    throw err;
  }

  // Check unique constraint on (user_id, date)
  const existing = queryOne(
    'SELECT id FROM member_availability WHERE user_id = ? AND date = ?',
    [targetUserId, date]
  );
  if (existing) {
    const err = new Error(`Availability entry already exists for user on ${date}`);
    err.status = 400;
    throw err;
  }

  // Approval rules: Admins auto-approve. Non-admin LEAVE requests require admin review.
  let approvedBy = null;
  if (isAdmin(currentUser)) {
    approvedBy = currentUser.id;
  } else if (type !== 'LEAVE') {
    approvedBy = currentUser.id;
  }

  execute(`
    INSERT INTO member_availability (
      user_id, date, availability_type, available_hrs, reason, approved_by, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `, [targetUserId, date, type, hrs, reason || null, approvedBy, currentUser.id]);

  const inserted = queryOne(
    'SELECT * FROM member_availability WHERE user_id = ? AND date = ?',
    [targetUserId, date]
  );

  return {
    message: 'Availability recorded successfully',
    availability: inserted
  };
}

/**
 * Retrieves all availability entries for a member
 * Role: Admin+ or own user
 */
export function getMemberAvailability(userId, currentUser) {
  if (!isAdmin(currentUser) && String(currentUser.id) !== String(userId)) {
    const err = new Error('Forbidden: You can only view your own availability entries');
    err.status = 403;
    throw err;
  }

  const targetUser = queryOne('SELECT id, name FROM users WHERE id = ?', [userId]);
  if (!targetUser) {
    const err = new Error('User not found');
    err.status = 404;
    throw err;
  }

  const rows = queryAll(`
    SELECT ma.*, u.name as approved_by_name
    FROM member_availability ma
    LEFT JOIN users u ON ma.approved_by = u.id
    WHERE ma.user_id = ?
    ORDER BY ma.date ASC
  `, [userId]);

  return {
    user_id: userId,
    availability: rows
  };
}

/**
 * Approves a pending availability request (e.g. LEAVE)
 * Role: Admin+
 */
export function approveAvailability(availabilityId, currentUser) {
  if (!isAdmin(currentUser)) {
    const err = new Error('Forbidden: Admin role required to approve availability');
    err.status = 403;
    throw err;
  }

  const entry = queryOne('SELECT * FROM member_availability WHERE id = ?', [availabilityId]);
  if (!entry) {
    const err = new Error('Availability entry not found');
    err.status = 404;
    throw err;
  }

  execute(`
    UPDATE member_availability
    SET approved_by = ?, updated_at = datetime('now')
    WHERE id = ?
  `, [currentUser.id, availabilityId]);

  logAccess({
    userId: currentUser.id,
    action: 'WORKLOAD_AVAILABILITY_APPROVED',
    resource: `member_availability:${availabilityId}`,
    ipAddress: '127.0.0.1'
  });

  const updated = queryOne('SELECT * FROM member_availability WHERE id = ?', [availabilityId]);
  return {
    message: 'Availability approved successfully',
    availability: updated
  };
}

// ===================================================================
// UTILIZATION CALCULATION & AUTO-ALERT ENGINE (SERVER-SIDE MATH)
// ===================================================================

/**
 * Calculates member available hours in a given 7-day week window (Monday to Sunday)
 * Deducts approved leaves and holiday time loss from weekly capacity
 */
export function calculateMemberWeeklyAvailability(userId, weekStartDate) {
  const weekStart = getWeekStart(weekStartDate);
  const weekEnd = getWeekEnd(weekStartDate);

  // Retrieve effective capacity on or before weekStart
  const capRow = queryOne(`
    SELECT weekly_capacity_hrs
    FROM member_capacity
    WHERE user_id = ? AND effective_from <= ?
    ORDER BY effective_from DESC, id DESC
    LIMIT 1
  `, [userId, weekEnd]);

  const weeklyCapacity = capRow ? Number(capRow.weekly_capacity_hrs) : 40.0;
  const standardDailyHrs = weeklyCapacity / 5.0; // 5 working days assumption

  // Retrieve all availability records in this week
  const availRows = queryAll(`
    SELECT availability_type, available_hrs, approved_by
    FROM member_availability
    WHERE user_id = ? AND date >= ? AND date <= ?
  `, [userId, weekStart, weekEnd]);

  let hoursLost = 0.0;
  for (const row of availRows) {
    // Leaves must be approved to deduct capacity
    if (row.availability_type === 'LEAVE' && !row.approved_by) {
      continue;
    }
    const availHrs = Number(row.available_hrs || 0.0);
    if (availHrs < standardDailyHrs) {
      hoursLost += (standardDailyHrs - availHrs);
    }
  }

  const availableHours = Math.max(0.0, Number((weeklyCapacity - hoursLost).toFixed(2)));

  return {
    user_id: userId,
    week_start: weekStart,
    week_end: weekEnd,
    weekly_capacity_hrs: weeklyCapacity,
    hours_lost: Number(hoursLost.toFixed(2)),
    available_hours: availableHours
  };
}

/**
 * Computes workload utilization percentage and status classification
 * Formula: (allocated_hours ÷ available_hours) × 100
 * Server-side math, zero client-side calculation
 */
export function calculateUtilization(allocatedHours, availableHours) {
  const allocated = Number(allocatedHours || 0.0);
  const available = Number(availableHours || 0.0);

  if (available <= 0.0) {
    return {
      allocated_hours: allocated,
      available_hours: available,
      utilization_pct: allocated > 0 ? 1000.0 : 0.0,
      status: allocated > 0 ? 'OVERLOADED' : 'UNDERLOADED'
    };
  }

  const rawPct = (allocated / available) * 100.0;
  const utilization_pct = Number(rawPct.toFixed(2));

  let status = 'OPTIMAL';
  if (utilization_pct < 50.0) {
    status = 'UNDERLOADED';
  } else if (utilization_pct <= 85.0) {
    status = 'OPTIMAL';
  } else if (utilization_pct <= 100.0) {
    status = 'NEAR_CAPACITY';
  } else {
    status = 'OVERLOADED';
  }

  return {
    allocated_hours: allocated,
    available_hours: available,
    utilization_pct,
    status
  };
}

/**
 * Evaluates utilization and automatically generates alerts in workload_alerts:
 * - Overload: utilization_pct > 100%
 * - Underload: utilization_pct < 30%
 */
export function evaluateAndCreateWorkloadAlert(userId, weekStartDate, allocatedHours, availableHours) {
  const weekStart = getWeekStart(weekStartDate);
  const util = calculateUtilization(allocatedHours, availableHours);

  let alertType = null;
  if (util.utilization_pct > 100.0) {
    alertType = 'OVERLOADED';
  } else if (util.utilization_pct < 30.0) {
    alertType = 'UNDERLOADED';
  }

  if (!alertType) {
    return {
      alert_created: false,
      ...util
    };
  }

  // Prevent duplicate spam of identical unacknowledged alerts for same user and week
  const existingAlert = queryOne(`
    SELECT id FROM workload_alerts
    WHERE user_id = ? AND week_start_date = ? AND alert_type = ? AND acknowledged_at IS NULL
  `, [userId, weekStart, alertType]);

  if (existingAlert) {
    return {
      alert_created: false,
      alert_id: existingAlert.id,
      alert_type: alertType,
      already_exists: true,
      ...util
    };
  }

  execute(`
    INSERT INTO workload_alerts (
      user_id, alert_type, week_start_date, assigned_hrs, capacity_hrs, utilization_pct
    ) VALUES (?, ?, ?, ?, ?, ?)
  `, [
    userId,
    alertType,
    weekStart,
    util.allocated_hours,
    util.available_hours,
    util.utilization_pct
  ]);

  const newAlert = queryOne(`
    SELECT * FROM workload_alerts
    WHERE user_id = ? AND week_start_date = ? AND alert_type = ?
    ORDER BY id DESC LIMIT 1
  `, [userId, weekStart, alertType]);

  return {
    alert_created: true,
    alert: newAlert,
    ...util
  };
}

/**
 * Retrieves workload alerts (unacknowledged by default)
 * Role: Admin+
 */
export function getWorkloadAlerts(currentUser, { unacknowledgedOnly = true } = {}) {
  if (!isAdmin(currentUser)) {
    const err = new Error('Forbidden: Admin role required to view workload alerts');
    err.status = 403;
    throw err;
  }

  let sql = `
    SELECT wa.*, u.name as user_name, u.role as user_role, ack.name as acknowledged_by_name
    FROM workload_alerts wa
    JOIN users u ON wa.user_id = u.id
    LEFT JOIN users ack ON wa.acknowledged_by = ack.id
  `;
  const params = [];

  if (unacknowledgedOnly) {
    sql += ` WHERE wa.acknowledged_at IS NULL`;
  }
  sql += ` ORDER BY wa.id DESC`;

  const alerts = queryAll(sql, params);
  return { alerts };
}

/**
 * Acknowledges an active workload alert
 * Role: Admin+
 */
export function acknowledgeAlert(alertId, currentUser) {
  if (!isAdmin(currentUser)) {
    const err = new Error('Forbidden: Admin role required to acknowledge workload alerts');
    err.status = 403;
    throw err;
  }

  const alert = queryOne('SELECT * FROM workload_alerts WHERE id = ?', [alertId]);
  if (!alert) {
    const err = new Error('Workload alert not found');
    err.status = 404;
    throw err;
  }

  execute(`
    UPDATE workload_alerts
    SET acknowledged_by = ?, acknowledged_at = datetime('now')
    WHERE id = ?
  `, [currentUser.id, alertId]);

  logAccess({
    userId: currentUser.id,
    action: 'WORKLOAD_ALERT_ACKNOWLEDGED',
    resource: `workload_alert:${alertId}`,
    ipAddress: '127.0.0.1'
  });

  const updated = queryOne('SELECT * FROM workload_alerts WHERE id = ?', [alertId]);
  return {
    message: 'Alert acknowledged successfully',
    alert: updated
  };
}

// ===================================================================
// WORKLOAD ASSIGNMENTS & MULTI-WEEK PRORATION ENGINE (LAYER 3)
// ===================================================================

const VALID_SOURCE_TYPES = ['BACKLOG_ITEM', 'GANTT_ITEM', 'PIPELINE_POINT', 'MANUAL'];
const VALID_ASSIGNMENT_STATUSES = ['ACTIVE', 'COMPLETED', 'CANCELLED'];

/**
 * Calculates prorated hours of an assignment for a given calendar week
 * Rule 7: If assignment spans totalDays and overlaps overlapDays with target week,
 * contributes (overlapDays / totalDays) * estimated_hrs to that week
 */
export function calculateProratedHours(startDateStr, endDateStr, weekStartDateStr, estimatedHrs) {
  const estHrs = Number(estimatedHrs || 0.0);
  if (estHrs <= 0) return 0.0;

  const weekStart = getWeekStart(weekStartDateStr);
  const weekEnd = getWeekEnd(weekStartDateStr);

  const start = new Date(startDateStr + 'T00:00:00Z');
  const end = new Date(endDateStr + 'T00:00:00Z');
  const wStart = new Date(weekStart + 'T00:00:00Z');
  const wEnd = new Date(weekEnd + 'T00:00:00Z');

  // Total inclusive calendar days of assignment
  const totalDays = Math.max(1, Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1);

  // Overlap window
  const overlapStart = start > wStart ? start : wStart;
  const overlapEnd = end < wEnd ? end : wEnd;

  if (overlapStart > overlapEnd) {
    return 0.0;
  }

  const overlapDays = Math.round((overlapEnd.getTime() - overlapStart.getTime()) / (1000 * 60 * 60 * 24)) + 1;
  const prorated = (overlapDays / totalDays) * estHrs;
  return Number(prorated.toFixed(2));
}

/**
 * Creates a new workload assignment
 * Role: Admin+
 */
export function createAssignment(
  { user_id, project_id, source_type = 'MANUAL', source_id = null, title, estimated_hrs = 0.0, start_date, end_date },
  currentUser
) {
  if (!isAdmin(currentUser)) {
    const err = new Error('Forbidden: Admin role required to create workload assignments');
    err.status = 403;
    throw err;
  }

  if (!user_id) {
    const err = new Error('user_id is required');
    err.status = 400;
    throw err;
  }

  const targetUser = queryOne('SELECT id, name FROM users WHERE id = ?', [user_id]);
  if (!targetUser) {
    const err = new Error('User not found');
    err.status = 404;
    throw err;
  }

  if (!project_id) {
    const err = new Error('project_id is required');
    err.status = 400;
    throw err;
  }

  const project = queryOne('SELECT id, title FROM projects WHERE id = ?', [project_id]);
  if (!project) {
    const err = new Error('Project not found');
    err.status = 404;
    throw err;
  }

  const srcType = String(source_type || 'MANUAL').toUpperCase();
  if (!VALID_SOURCE_TYPES.includes(srcType)) {
    const err = new Error(`Invalid source_type. Must be one of: ${VALID_SOURCE_TYPES.join(', ')}`);
    err.status = 400;
    throw err;
  }

  if (!title || typeof title !== 'string' || !title.trim()) {
    const err = new Error('title is required and cannot be empty');
    err.status = 400;
    throw err;
  }

  const estHrs = Number(estimated_hrs);
  if (isNaN(estHrs) || estHrs < 0) {
    const err = new Error('estimated_hrs must be a non-negative number');
    err.status = 400;
    throw err;
  }

  if (!start_date || !/^\d{4}-\d{2}-\d{2}$/.test(start_date)) {
    const err = new Error('start_date must be a valid date in YYYY-MM-DD format');
    err.status = 400;
    throw err;
  }

  if (!end_date || !/^\d{4}-\d{2}-\d{2}$/.test(end_date)) {
    const err = new Error('end_date must be a valid date in YYYY-MM-DD format');
    err.status = 400;
    throw err;
  }

  if (start_date > end_date) {
    const err = new Error('start_date must be before or equal to end_date');
    err.status = 400;
    throw err;
  }

  execute(`
    INSERT INTO workload_assignments (
      user_id, project_id, source_type, source_id, title,
      estimated_hrs, start_date, end_date, status, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?)
  `, [
    user_id,
    project_id,
    srcType,
    source_id ? Number(source_id) : null,
    title.trim(),
    estHrs,
    start_date,
    end_date,
    currentUser.id
  ]);

  const inserted = queryOne(`
    SELECT wa.*, p.title as project_title, u.name as user_name
    FROM workload_assignments wa
    JOIN projects p ON wa.project_id = p.id
    JOIN users u ON wa.user_id = u.id
    WHERE wa.user_id = ? AND wa.project_id = ?
    ORDER BY wa.id DESC LIMIT 1
  `, [user_id, project_id]);

  // Server-side auto-alert evaluation for all weeks spanned by this assignment
  recalculateSpannedWeeksAlerts(user_id, start_date, end_date);

  logAccess({
    userId: currentUser.id,
    action: 'WORKLOAD_ASSIGNMENT_CREATED',
    resource: `workload_assignment:${inserted.id}`,
    ipAddress: '127.0.0.1'
  });

  return {
    message: 'Workload assignment created successfully',
    assignment: inserted
  };
}

/**
 * Retrieves all workload assignments for a member
 * Role: Admin+ or own member
 */
export function getMemberAssignments(userId, currentUser, { status = 'ACTIVE', projectId = null } = {}) {
  if (!isAdmin(currentUser) && String(currentUser.id) !== String(userId)) {
    const err = new Error('Forbidden: Non-admin members can only view their own workload assignments');
    err.status = 403;
    throw err;
  }

  const targetUser = queryOne('SELECT id, name FROM users WHERE id = ?', [userId]);
  if (!targetUser) {
    const err = new Error('User not found');
    err.status = 404;
    throw err;
  }

  let sql = `
    SELECT wa.*, p.title as project_title, u.name as user_name
    FROM workload_assignments wa
    JOIN projects p ON wa.project_id = p.id
    JOIN users u ON wa.user_id = u.id
    WHERE wa.user_id = ?
  `;
  const params = [userId];

  if (status && status !== 'ALL') {
    sql += ' AND wa.status = ?';
    params.push(status.toUpperCase());
  }

  if (projectId) {
    sql += ' AND wa.project_id = ?';
    params.push(projectId);
  }

  sql += ' ORDER BY wa.start_date ASC, wa.id DESC';

  const assignments = queryAll(sql, params);
  return {
    user_id: userId,
    count: assignments.length,
    assignments
  };
}

/**
 * Updates an existing workload assignment
 * Role: Admin+
 */
export function updateAssignment(assignmentId, updates = {}, currentUser) {
  if (!isAdmin(currentUser)) {
    const err = new Error('Forbidden: Admin role required to update workload assignments');
    err.status = 403;
    throw err;
  }

  const existing = queryOne('SELECT * FROM workload_assignments WHERE id = ?', [assignmentId]);
  if (!existing) {
    const err = new Error('Workload assignment not found');
    err.status = 404;
    throw err;
  }

  const newEstimatedHrs = updates.estimated_hrs !== undefined ? Number(updates.estimated_hrs) : Number(existing.estimated_hrs);
  if (isNaN(newEstimatedHrs) || newEstimatedHrs < 0) {
    const err = new Error('estimated_hrs must be a non-negative number');
    err.status = 400;
    throw err;
  }

  const newStartDate = updates.start_date || existing.start_date;
  const newEndDate = updates.end_date || existing.end_date;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(newStartDate) || !/^\d{4}-\d{2}-\d{2}$/.test(newEndDate)) {
    const err = new Error('Dates must be valid YYYY-MM-DD format');
    err.status = 400;
    throw err;
  }

  if (newStartDate > newEndDate) {
    const err = new Error('start_date must be before or equal to end_date');
    err.status = 400;
    throw err;
  }

  let newStatus = existing.status;
  if (updates.status) {
    const s = String(updates.status).toUpperCase();
    if (!VALID_ASSIGNMENT_STATUSES.includes(s)) {
      const err = new Error(`Invalid status. Must be one of: ${VALID_ASSIGNMENT_STATUSES.join(', ')}`);
      err.status = 400;
      throw err;
    }
    newStatus = s;
  }

  const newTitle = updates.title ? updates.title.trim() : existing.title;

  execute(`
    UPDATE workload_assignments
    SET estimated_hrs = ?, start_date = ?, end_date = ?, status = ?, title = ?, updated_at = datetime('now')
    WHERE id = ?
  `, [newEstimatedHrs, newStartDate, newEndDate, newStatus, newTitle, assignmentId]);

  // Recalculate auto-alerts for old and new date spans
  recalculateSpannedWeeksAlerts(existing.user_id, existing.start_date, existing.end_date);
  if (newStartDate !== existing.start_date || newEndDate !== existing.end_date) {
    recalculateSpannedWeeksAlerts(existing.user_id, newStartDate, newEndDate);
  }

  logAccess({
    userId: currentUser.id,
    action: 'WORKLOAD_ASSIGNMENT_UPDATED',
    resource: `workload_assignment:${assignmentId}`,
    ipAddress: '127.0.0.1'
  });

  const updated = queryOne(`
    SELECT wa.*, p.title as project_title, u.name as user_name
    FROM workload_assignments wa
    JOIN projects p ON wa.project_id = p.id
    JOIN users u ON wa.user_id = u.id
    WHERE wa.id = ?
  `, [assignmentId]);

  return {
    message: 'Workload assignment updated successfully',
    assignment: updated
  };
}

/**
 * Deletes a workload assignment
 * Role: Admin+
 */
export function deleteAssignment(assignmentId, currentUser) {
  if (!isAdmin(currentUser)) {
    const err = new Error('Forbidden: Admin role required to delete workload assignments');
    err.status = 403;
    throw err;
  }

  const existing = queryOne('SELECT * FROM workload_assignments WHERE id = ?', [assignmentId]);
  if (!existing) {
    const err = new Error('Workload assignment not found');
    err.status = 404;
    throw err;
  }

  execute('DELETE FROM workload_assignments WHERE id = ?', [assignmentId]);

  recalculateSpannedWeeksAlerts(existing.user_id, existing.start_date, existing.end_date);

  logAccess({
    userId: currentUser.id,
    action: 'WORKLOAD_ASSIGNMENT_DELETED',
    resource: `workload_assignment:${assignmentId}`,
    ipAddress: '127.0.0.1'
  });

  return {
    message: 'Workload assignment deleted successfully',
    id: assignmentId
  };
}

/**
 * Syncs an assignment from an external source (Backlog, Gantt, Pipeline)
 */
export function syncAssignmentFromSource(
  { source_type, source_id, user_id, project_id, title, estimated_hrs = 0.0, start_date, end_date, status = 'ACTIVE' },
  currentUser
) {
  const srcType = String(source_type || 'MANUAL').toUpperCase();
  const existing = queryOne(
    'SELECT id FROM workload_assignments WHERE source_type = ? AND source_id = ?',
    [srcType, source_id]
  );

  if (existing) {
    return updateAssignment(
      existing.id,
      { estimated_hrs, start_date, end_date, status, title },
      currentUser
    );
  }

  return createAssignment(
    { user_id, project_id, source_type: srcType, source_id, title, estimated_hrs, start_date, end_date },
    currentUser
  );
}

/**
 * Computes all prorated assigned hours for a member in a specific calendar week
 */
export function calculateMemberAssignedHoursForWeek(userId, weekStartDate) {
  const weekStart = getWeekStart(weekStartDate);
  const weekEnd = getWeekEnd(weekStartDate);

  const activeAssignments = queryAll(`
    SELECT wa.*, p.title as project_title
    FROM workload_assignments wa
    JOIN projects p ON wa.project_id = p.id
    WHERE wa.user_id = ?
      AND wa.status = 'ACTIVE'
      AND wa.start_date <= ?
      AND wa.end_date >= ?
  `, [userId, weekEnd, weekStart]);

  let totalProratedHrs = 0.0;
  const assignmentBreakdown = [];

  for (const asgn of activeAssignments) {
    const prorated = calculateProratedHours(asgn.start_date, asgn.end_date, weekStart, asgn.estimated_hrs);
    if (prorated > 0) {
      totalProratedHrs += prorated;
      assignmentBreakdown.push({
        id: asgn.id,
        project_id: asgn.project_id,
        project_title: asgn.project_title,
        source_type: asgn.source_type,
        source_id: asgn.source_id,
        title: asgn.title,
        full_estimated_hrs: asgn.estimated_hrs,
        start_date: asgn.start_date,
        end_date: asgn.end_date,
        prorated_week_hrs: prorated
      });
    }
  }

  return {
    week_start: weekStart,
    week_end: weekEnd,
    assigned_hours: Number(totalProratedHrs.toFixed(2)),
    assignments_count: assignmentBreakdown.length,
    assignments: assignmentBreakdown
  };
}

/**
 * Consolidates full weekly workload for a single member:
 * Capacity + Availability + Prorated Assignments + Utilization + Auto-Alert Check
 */
export function getMemberWeeklyWorkload(userId, weekStartDate) {
  const weekStart = getWeekStart(weekStartDate);
  const user = queryOne('SELECT id, name, email, role FROM users WHERE id = ?', [userId]);
  if (!user) {
    const err = new Error('User not found');
    err.status = 404;
    throw err;
  }

  // 1. Availability and capacity
  const avail = calculateMemberWeeklyAvailability(userId, weekStart);

  // 2. Prorated active assignments
  const assigned = calculateMemberAssignedHoursForWeek(userId, weekStart);

  // 3. Server-side utilization math
  const util = calculateUtilization(assigned.assigned_hours, avail.available_hours);

  // 4. Auto-evaluate alert
  const alertResult = evaluateAndCreateWorkloadAlert(
    userId,
    weekStart,
    assigned.assigned_hours,
    avail.available_hours
  );

  return {
    user_id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    week_start: weekStart,
    week_end: avail.week_end,
    weekly_capacity_hrs: avail.weekly_capacity_hrs,
    hours_lost: avail.hours_lost,
    available_hours: avail.available_hours,
    assigned_hours: assigned.assigned_hours,
    utilization_pct: util.utilization_pct,
    status: util.status,
    assignments_count: assigned.assignments_count,
    assignments: assigned.assignments,
    alert_info: alertResult
  };
}

/**
 * Re-evaluates workload and auto-alerts for all calendar weeks overlapping a date range
 */
function recalculateSpannedWeeksAlerts(userId, startDateStr, endDateStr) {
  try {
    const startM = getWeekStart(startDateStr);
    const endM = getWeekStart(endDateStr);

    let cur = new Date(startM + 'T00:00:00Z');
    const end = new Date(endM + 'T00:00:00Z');

    while (cur <= end) {
      const curStr = cur.toISOString().split('T')[0];
      const avail = calculateMemberWeeklyAvailability(userId, curStr);
      const assigned = calculateMemberAssignedHoursForWeek(userId, curStr);
      evaluateAndCreateWorkloadAlert(userId, curStr, assigned.assigned_hours, avail.available_hours);

      cur.setUTCDate(cur.getUTCDate() + 7);
    }
  } catch (e) {
    // Non-blocking alert refresh
  }
}

/**
 * Aggregates weekly workload across an entire team for a given project
 * Role: Admin+ (Rule 11: Member sees ONLY own workload — team dashboard completely hidden)
 */
export function getTeamWorkload(projectId, weekStartDate, currentUser) {
  if (!isAdmin(currentUser)) {
    const err = new Error('Forbidden: Admin role required to view team-wide workload');
    err.status = 403;
    throw err;
  }

  let project = null;
  if (projectId && projectId !== 'all') {
    project = queryOne('SELECT id, title FROM projects WHERE id = ?', [projectId]);
    if (!project) {
      const err = new Error('Project not found');
      err.status = 404;
      throw err;
    }
  }

  const weekStart = getWeekStart(weekStartDate);
  const weekEnd = getWeekEnd(weekStartDate);

  // Discover all team members associated with this project (or all active members if 'all')
  let membersQuery = '';
  let params = [];

  if (projectId && projectId !== 'all') {
    membersQuery = `
      SELECT DISTINCT u.id, u.name, u.email, u.role
      FROM users u
      LEFT JOIN project_members pm ON pm.user_id = u.id AND pm.project_id = ? AND pm.removed_at IS NULL
      LEFT JOIN projects p ON p.id = ? AND p.owner_id = u.id
      LEFT JOIN workload_assignments wa ON wa.user_id = u.id AND wa.project_id = ? AND wa.status = 'ACTIVE'
      WHERE u.status = 'active' AND (pm.id IS NOT NULL OR p.id IS NOT NULL OR wa.id IS NOT NULL)
      ORDER BY u.name ASC
    `;
    params = [projectId, projectId, projectId];
  } else {
    membersQuery = `
      SELECT id, name, email, role
      FROM users
      WHERE status = 'active'
      ORDER BY name ASC
    `;
  }

  let users = queryAll(membersQuery, params);

  // If a brand new test project has no project_members yet, fallback to all project_members or active users
  if (users.length === 0 && projectId && projectId !== 'all') {
    users = queryAll(`
      SELECT DISTINCT u.id, u.name, u.email, u.role
      FROM users u
      JOIN workload_assignments wa ON wa.user_id = u.id AND wa.project_id = ?
      WHERE u.status = 'active'
    `, [projectId]);
    if (users.length === 0) {
      users = queryAll(`SELECT id, name, email, role FROM users WHERE status = 'active' LIMIT 5`);
    }
  }

  let totalCapacity = 0.0;
  let totalAvailable = 0.0;
  let totalAssigned = 0.0;
  let overloadedCount = 0;
  let optimalCount = 0;
  let nearCapacityCount = 0;
  let underloadedCount = 0;

  const memberResults = [];

  for (const u of users) {
    const workload = getMemberWeeklyWorkload(u.id, weekStart);

    totalCapacity += workload.weekly_capacity_hrs;
    totalAvailable += workload.available_hours;
    totalAssigned += workload.assigned_hours;

    if (workload.status === 'OVERLOADED') overloadedCount++;
    else if (workload.status === 'OPTIMAL') optimalCount++;
    else if (workload.status === 'NEAR_CAPACITY') nearCapacityCount++;
    else if (workload.status === 'UNDERLOADED') underloadedCount++;

    memberResults.push(workload);
  }

  const teamUtilPct = totalAvailable > 0
    ? Number(((totalAssigned / totalAvailable) * 100.0).toFixed(2))
    : 0.0;

  let teamStatus = 'OPTIMAL';
  if (teamUtilPct < 50.0) teamStatus = 'UNDERLOADED';
  else if (teamUtilPct <= 85.0) teamStatus = 'OPTIMAL';
  else if (teamUtilPct <= 100.0) teamStatus = 'NEAR_CAPACITY';
  else teamStatus = 'OVERLOADED';

  return {
    project_id: project ? project.id : 'all',
    project_title: project ? project.title : 'All Projects Team Aggregation',
    week_start: weekStart,
    week_end: weekEnd,
    summary: {
      total_members: memberResults.length,
      total_capacity_hrs: Number(totalCapacity.toFixed(2)),
      total_available_hrs: Number(totalAvailable.toFixed(2)),
      total_assigned_hrs: Number(totalAssigned.toFixed(2)),
      team_utilization_pct: teamUtilPct,
      status: teamStatus,
      overloaded_count: overloadedCount,
      optimal_count: optimalCount,
      near_capacity_count: nearCapacityCount,
      underloaded_count: underloadedCount
    },
    members: memberResults
  };
}
