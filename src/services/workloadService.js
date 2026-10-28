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
