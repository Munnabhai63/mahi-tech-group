import { queryOne, queryAll, execute } from '../db/database.js';
import { logAccess } from './auditService.js';

/**
 * Checks whether a user possesses administrative privileges
 */
export function isAdmin(user) {
  return Boolean(user && (user.role === 'admin' || user.role === 'superadmin'));
}

/**
 * Logs changes to the append-only time_entry_history table
 */
export function logTimeEntryHistory(entryId, changedBy, fieldChanged, oldValue, newValue) {
  try {
    const nowISO = new Date().toISOString();
    execute(`
      INSERT INTO time_entry_history (
        entry_id, changed_by, field_changed, old_value, new_value, changed_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `, [
      entryId,
      changedBy,
      fieldChanged,
      oldValue !== null && oldValue !== undefined ? String(oldValue) : null,
      newValue !== null && newValue !== undefined ? String(newValue) : null,
      nowISO
    ]);
  } catch (err) {
    console.error(`[TIME TRACKER] Failed to log history for entry ${entryId}:`, err.message);
    throw err;
  }
}

/**
 * Resolves billable rate according to PRD 22 priority hierarchy:
 * 1. PROJECT_OVERRIDE for (user_id, project_id)
 * 2. PROJECT_OVERRIDE project default (project_id, user_id IS NULL)
 * 3. MEMBER_DEFAULT for user_id
 * 4. Fallback 0.0 INR
 *
 * Checks temporal bounds: effective_from <= targetDate AND (effective_to IS NULL OR effective_to >= targetDate)
 */
export function resolveBillableRate(userId, projectId, targetDate = new Date().toISOString()) {
  const targetDay = targetDate.includes('T') ? targetDate.split('T')[0] : targetDate;

  // 1. PROJECT_OVERRIDE for user on project
  if (userId && projectId) {
    const override = queryOne(`
      SELECT rate_per_hour, currency
      FROM billable_rates
      WHERE rate_type = 'PROJECT_OVERRIDE'
        AND user_id = ?
        AND project_id = ?
        AND date(effective_from) <= date(?)
        AND (effective_to IS NULL OR date(effective_to) >= date(?))
      ORDER BY date(effective_from) DESC, id DESC
      LIMIT 1
    `, [userId, projectId, targetDay, targetDay]);

    if (override) {
      return {
        rate: Number(override.rate_per_hour) || 0.0,
        currency: override.currency || 'INR',
        source: 'PROJECT_MEMBER_OVERRIDE'
      };
    }
  }

  // 2. PROJECT_OVERRIDE general for project (user_id IS NULL)
  if (projectId) {
    const projectDefault = queryOne(`
      SELECT rate_per_hour, currency
      FROM billable_rates
      WHERE rate_type = 'PROJECT_OVERRIDE'
        AND (user_id IS NULL OR user_id = '')
        AND project_id = ?
        AND date(effective_from) <= date(?)
        AND (effective_to IS NULL OR date(effective_to) >= date(?))
      ORDER BY date(effective_from) DESC, id DESC
      LIMIT 1
    `, [projectId, targetDay, targetDay]);

    if (projectDefault) {
      return {
        rate: Number(projectDefault.rate_per_hour) || 0.0,
        currency: projectDefault.currency || 'INR',
        source: 'PROJECT_DEFAULT_OVERRIDE'
      };
    }
  }

  // 3. MEMBER_DEFAULT for user
  if (userId) {
    const memberDefault = queryOne(`
      SELECT rate_per_hour, currency
      FROM billable_rates
      WHERE rate_type = 'MEMBER_DEFAULT'
        AND user_id = ?
        AND (project_id IS NULL OR project_id = '')
        AND date(effective_from) <= date(?)
        AND (effective_to IS NULL OR date(effective_to) >= date(?))
      ORDER BY date(effective_from) DESC, id DESC
      LIMIT 1
    `, [userId, targetDay, targetDay]);

    if (memberDefault) {
      return {
        rate: Number(memberDefault.rate_per_hour) || 0.0,
        currency: memberDefault.currency || 'INR',
        source: 'MEMBER_DEFAULT'
      };
    }
  }

  // 4. Fallback if no rate configured
  return {
    rate: 0.0,
    currency: 'INR',
    source: 'DEFAULT_ZERO'
  };
}

/**
 * Checks for overlapping time intervals for a user.
 * Rule: Two intervals [startA, endA] and [startB, endB] overlap if startA < endB AND endA > startB.
 */
export function checkTimeOverlap(userId, startTime, endTime, excludeEntryId = null) {
  if (!userId || !startTime) return null;

  if (endTime) {
    // Both start and end provided: check overlap with closed entries or currently active running timers
    return queryOne(`
      SELECT * FROM time_entries
      WHERE user_id = ?
        AND (? IS NULL OR id != ?)
        AND status != 'DELETED'
        AND (
          (end_time IS NOT NULL AND datetime(start_time) < datetime(?) AND datetime(end_time) > datetime(?))
          OR
          (end_time IS NULL AND id IN (SELECT time_entry_id FROM active_timers WHERE user_id = ?) AND datetime(?) > datetime(start_time))
        )
      LIMIT 1
    `, [userId, excludeEntryId, excludeEntryId, endTime, startTime, userId, endTime]);
  } else {
    // Live timer starting at startTime: check if startTime falls inside an existing closed entry
    return queryOne(`
      SELECT * FROM time_entries
      WHERE user_id = ?
        AND (? IS NULL OR id != ?)
        AND status != 'DELETED'
        AND (
          (end_time IS NOT NULL AND datetime(start_time) <= datetime(?) AND datetime(end_time) > datetime(?))
          OR
          (end_time IS NULL AND id IN (SELECT time_entry_id FROM active_timers WHERE user_id = ?))
        )
      LIMIT 1
    `, [userId, excludeEntryId, excludeEntryId, startTime, startTime, userId]);
  }
}

/**
 * Validates whether a time entry can be edited by the requesting user
 * Rule:
 * - Admin+ can edit anytime
 * - Owner can edit MANUAL entries within 24 hours (86,400 seconds) of creation only
 * - Timer-stopped entries are immediately locked for non-admins
 */
export function canEditTimeEntry(entry, currentUser) {
  if (isAdmin(currentUser)) {
    return { allowed: true };
  }

  if (entry.user_id !== currentUser.id) {
    return { allowed: false, reason: 'Forbidden: You can only edit your own time entries' };
  }

  if (entry.source_type === 'TIMER') {
    return { allowed: false, reason: 'Timer-stopped entries are locked immediately and cannot be edited by members' };
  }

  if (entry.source_type === 'MANUAL') {
    const createdAtMs = new Date(entry.created_at).getTime();
    const nowMs = Date.now();
    const ageSeconds = (nowMs - createdAtMs) / 1000;
    if (ageSeconds > 86400) {
      return { allowed: false, reason: 'Edit window expired: Manual entries can only be edited within 24 hours of creation' };
    }
  }

  return { allowed: true };
}

// ===================================================================
// TIMER SERVICE (LAYER 2)
// ===================================================================

/**
 * Starts an active live timer for a user
 * Rules:
 * - Exactly one active timer per user (enforced in code + active_timers UNIQUE lock table)
 * - Overlapping intervals blocked
 * - Billable rate snapshotted at start time
 */
export function startTimer({ project_id, source_ref_type, source_ref_id, description, task_description, is_billable }, currentUser) {
  if (!currentUser || !currentUser.id) {
    const err = new Error('Unauthorized');
    err.status = 401;
    throw err;
  }

  if (!project_id) {
    const err = new Error('project_id is required to start a timer');
    err.status = 400;
    throw err;
  }

  const project = queryOne('SELECT id, title FROM projects WHERE id = ?', [project_id]);
  if (!project) {
    const err = new Error('Project not found');
    err.status = 404;
    throw err;
  }

  // 1. Service check for active running timer
  const existingLock = queryOne('SELECT * FROM active_timers WHERE user_id = ?', [currentUser.id]);
  if (existingLock) {
    const err = new Error('User already has an active running timer');
    err.status = 409;
    throw err;
  }

  const nowISO = new Date().toISOString();

  // 2. Overlap check
  const overlap = checkTimeOverlap(currentUser.id, nowISO, null);
  if (overlap) {
    const err = new Error('Timer start overlaps with an existing time entry');
    err.status = 409;
    throw err;
  }

  // 3. Resolve billable rate snapshot
  const isBillableNum = is_billable === true || is_billable === 1 || is_billable === '1' ? 1 : 0;
  const rateInfo = resolveBillableRate(currentUser.id, project_id, nowISO);
  const billableRate = rateInfo.rate;
  const timerDesc = description !== undefined ? description : task_description;

  // 4. Insert into time_entries
  execute(`
    INSERT INTO time_entries (
      user_id, project_id, source_type, source_ref_type, source_ref_id,
      description, start_time, end_time, duration_minutes,
      is_billable, billable_rate, billable_amount, status,
      created_at, updated_at
    ) VALUES (
      ?, ?, 'TIMER', ?, ?,
      ?, ?, NULL, NULL,
      ?, ?, 0.0, 'PENDING',
      ?, ?
    )
  `, [
    currentUser.id,
    project_id,
    source_ref_type || null,
    source_ref_id || null,
    timerDesc ? String(timerDesc).trim() : 'Live Timer Session',
    nowISO,
    isBillableNum,
    billableRate,
    nowISO,
    nowISO
  ]);

  const newEntry = queryOne(`
    SELECT * FROM time_entries
    WHERE user_id = ? AND source_type = 'TIMER'
    ORDER BY id DESC LIMIT 1
  `, [currentUser.id]);

  if (!newEntry) {
    const err = new Error('Failed to create time entry');
    err.status = 500;
    throw err;
  }

  // 5. Acquire lock in active_timers table
  try {
    execute(`
      INSERT INTO active_timers (user_id, time_entry_id, started_at)
      VALUES (?, ?, ?)
    `, [currentUser.id, newEntry.id, nowISO]);
  } catch (lockErr) {
    // Rollback created entry if lock fails
    execute('DELETE FROM time_entries WHERE id = ?', [newEntry.id]);
    const err = new Error('User already has an active running timer');
    err.status = 409;
    throw err;
  }

  // 6. Log audit history
  logTimeEntryHistory(newEntry.id, currentUser.id, 'status', null, 'TIMER_STARTED');

  return {
    success: true,
    message: 'Timer started successfully',
    time_entry: newEntry,
    timer: {
      timer_id: newEntry.id,
      time_entry_id: newEntry.id,
      project_id: newEntry.project_id,
      project_title: project.title,
      description: newEntry.description,
      is_billable: newEntry.is_billable,
      billable_rate: newEntry.billable_rate,
      start_time: newEntry.start_time,
      started_at: nowISO,
      elapsed_seconds: 0
    }
  };
}

/**
 * Stops an active live timer for the user
 * Rules:
 * - Calculates duration_minutes = ROUND((end_time - start_time) in seconds / 60)
 * - Calculates billable_amount = (duration_minutes / 60) * billable_rate
 * - Removes lock from active_timers (DELETE permitted)
 * - Manually sets updated_at
 * - Writes audit log to time_entry_history
 */
export function stopTimer({ time_entry_id, end_time }, currentUser) {
  if (!currentUser || !currentUser.id) {
    const err = new Error('Unauthorized');
    err.status = 401;
    throw err;
  }

  // 1. Check lock table
  const activeLock = queryOne('SELECT * FROM active_timers WHERE user_id = ?', [currentUser.id]);
  if (!activeLock) {
    const err = new Error('No active timer found for user');
    err.status = 404;
    throw err;
  }

  const entryId = time_entry_id ? Number(time_entry_id) : activeLock.time_entry_id;
  if (activeLock.time_entry_id !== entryId && !isAdmin(currentUser)) {
    const err = new Error('Forbidden: Cannot stop another active timer');
    err.status = 403;
    throw err;
  }

  // 2. Fetch target entry
  const entry = queryOne('SELECT * FROM time_entries WHERE id = ?', [entryId]);
  if (!entry) {
    const err = new Error('Time entry not found');
    err.status = 404;
    throw err;
  }

  if (entry.user_id !== currentUser.id && !isAdmin(currentUser)) {
    const err = new Error('Forbidden: You can only stop your own timer');
    err.status = 403;
    throw err;
  }

  const stopTime = end_time ? new Date(end_time).toISOString() : new Date().toISOString();
  const startTimeMs = new Date(entry.start_time).getTime();
  const stopTimeMs = new Date(stopTime).getTime();

  if (stopTimeMs < startTimeMs) {
    const err = new Error('End time cannot be earlier than start time');
    err.status = 400;
    throw err;
  }

  // 3. Calculate duration and billable amount
  const durationMinutes = Math.max(0, Math.round((stopTimeMs - startTimeMs) / 60000));
  const billableRate = Number(entry.billable_rate) || 0.0;
  const billableAmount = entry.is_billable === 1
    ? Number(((durationMinutes / 60) * billableRate).toFixed(2))
    : 0.0;

  // 4. Overlap check with existing closed entries
  const overlap = checkTimeOverlap(entry.user_id, entry.start_time, stopTime, entry.id);
  if (overlap) {
    const err = new Error('Timer session interval overlaps with an existing time entry');
    err.status = 409;
    throw err;
  }

  const nowISO = new Date().toISOString();

  // 5. Update time_entries (manually updating updated_at)
  execute(`
    UPDATE time_entries
    SET end_time = ?,
        duration_minutes = ?,
        billable_amount = ?,
        updated_at = ?
    WHERE id = ?
  `, [stopTime, durationMinutes, billableAmount, nowISO, entry.id]);

  // 6. Release active_timers lock
  execute('DELETE FROM active_timers WHERE user_id = ?', [entry.user_id]);

  // 7. Write audit log to time_entry_history (append-only)
  logTimeEntryHistory(entry.id, currentUser.id, 'end_time', null, stopTime);
  logTimeEntryHistory(entry.id, currentUser.id, 'duration_minutes', null, String(durationMinutes));
  logTimeEntryHistory(entry.id, currentUser.id, 'billable_amount', '0.0', String(billableAmount));
  logTimeEntryHistory(entry.id, currentUser.id, 'status', 'PENDING', 'TIMER_STOPPED');

  const updatedEntry = queryOne('SELECT * FROM time_entries WHERE id = ?', [entry.id]);

  return {
    success: true,
    message: 'Timer stopped successfully',
    time_entry: updatedEntry
  };
}

/**
 * Returns current running timer status for logged in user (or null)
 */
export function getTimerStatus(userId) {
  if (!userId) return { active: false, timer: null };

  const active = queryOne(`
    SELECT at.id as lock_id, at.started_at, at.time_entry_id,
           te.id as entry_id, te.project_id, te.source_type, te.source_ref_type,
           te.source_ref_id, te.description, te.start_time, te.is_billable,
           te.billable_rate, te.status,
           p.title as project_title
    FROM active_timers at
    JOIN time_entries te ON te.id = at.time_entry_id
    LEFT JOIN projects p ON p.id = te.project_id
    WHERE at.user_id = ?
  `, [userId]);

  if (!active) {
    return { active: false, timer: null };
  }

  const elapsedSeconds = Math.max(0, Math.round((Date.now() - new Date(active.start_time).getTime()) / 1000));

  return {
    active: true,
    timer: {
      ...active,
      elapsed_seconds: elapsedSeconds
    }
  };
}

/**
 * Cron helper: auto-closes dangling timers that passed 23:59:59 of their start day
 * Rule: Timer auto-closes at 23:59:59 of the started day
 */
export function autoCloseDanglingTimers() {
  const activeTimers = queryAll(`
    SELECT at.id as lock_id, at.user_id, at.time_entry_id, at.started_at,
           te.start_time, te.is_billable, te.billable_rate
    FROM active_timers at
    JOIN time_entries te ON te.id = at.time_entry_id
  `);

  let closedCount = 0;
  const now = new Date();

  for (const t of activeTimers) {
    const startDateStr = t.start_time.split('T')[0];
    const endOfDayStr = `${startDateStr}T23:59:59.000Z`;
    const endOfDayTime = new Date(endOfDayStr).getTime();

    // If current time is past 23:59:59 of the started day
    if (now.getTime() > endOfDayTime) {
      const startTimeMs = new Date(t.start_time).getTime();
      const durationMinutes = Math.max(0, Math.round((endOfDayTime - startTimeMs) / 60000));
      const billableRate = Number(t.billable_rate) || 0.0;
      const billableAmount = t.is_billable === 1
        ? Number(((durationMinutes / 60) * billableRate).toFixed(2))
        : 0.0;
      const nowISO = new Date().toISOString();

      execute(`
        UPDATE time_entries
        SET end_time = ?,
            duration_minutes = ?,
            billable_amount = ?,
            updated_at = ?
        WHERE id = ?
      `, [endOfDayStr, durationMinutes, billableAmount, nowISO, t.time_entry_id]);

      execute('DELETE FROM active_timers WHERE id = ?', [t.lock_id]);

      logTimeEntryHistory(t.time_entry_id, t.user_id, 'end_time', null, endOfDayStr);
      logTimeEntryHistory(t.time_entry_id, t.user_id, 'status', 'PENDING', 'AUTO_CLOSED_DAY_END');

      closedCount++;
    }
  }

  return { auto_closed_count: closedCount };
}

// ===================================================================
// BILLABLE RATE CONFIGURATION (FOUNDATION)
// ===================================================================

/**
 * Sets a billable rate (append-only)
 * Role: Admin+
 */
export function setBillableRate({
  rate_type,
  user_id,
  project_id,
  rate_per_hour,
  hourly_rate,
  currency,
  effective_from,
  effective_to
}, currentUser) {
  if (!isAdmin(currentUser)) {
    const err = new Error('Forbidden: Admin role required to configure billable rates');
    err.status = 403;
    throw err;
  }

  if (!rate_type || !['MEMBER_DEFAULT', 'PROJECT_OVERRIDE'].includes(rate_type)) {
    const err = new Error('Valid rate_type (MEMBER_DEFAULT | PROJECT_OVERRIDE) is required');
    err.status = 400;
    throw err;
  }

  if (rate_type === 'MEMBER_DEFAULT' && !user_id) {
    const err = new Error('user_id is required for MEMBER_DEFAULT rate');
    err.status = 400;
    throw err;
  }

  if (rate_type === 'PROJECT_OVERRIDE' && !project_id) {
    const err = new Error('project_id is required for PROJECT_OVERRIDE rate');
    err.status = 400;
    throw err;
  }

  const resolvedRate = rate_per_hour !== undefined ? rate_per_hour : hourly_rate;
  const rateNum = Number(resolvedRate);
  if (isNaN(rateNum) || rateNum < 0) {
    const err = new Error('rate_per_hour must be a non-negative number');
    err.status = 400;
    throw err;
  }

  const effectiveFromDate = effective_from
    ? (effective_from.includes('T') ? effective_from.split('T')[0] : effective_from)
    : new Date().toISOString().split('T')[0];

  const effectiveToDate = effective_to
    ? (effective_to.includes('T') ? effective_to.split('T')[0] : effective_to)
    : null;

  const nowISO = new Date().toISOString();

  execute(`
    INSERT INTO billable_rates (
      rate_type, user_id, project_id, rate_per_hour, currency,
      effective_from, effective_to, set_by, created_at
    ) VALUES (
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?
    )
  `, [
    rate_type,
    user_id || null,
    project_id || null,
    rateNum,
    currency ? String(currency).trim().toUpperCase() : 'INR',
    effectiveFromDate,
    effectiveToDate,
    currentUser.id,
    nowISO
  ]);

  const created = queryOne(`
    SELECT * FROM billable_rates
    WHERE set_by = ?
    ORDER BY id DESC LIMIT 1
  `, [currentUser.id]);

  return {
    success: true,
    message: 'Billable rate configured successfully',
    rate: created
  };
}

/**
 * Retrieves all billable rates history for a specific member
 * Role: Admin+
 */
export function getMemberRates(userId, currentUser) {
  if (!isAdmin(currentUser)) {
    const err = new Error('Forbidden: Admin role required to view billable rates');
    err.status = 403;
    throw err;
  }

  const rates = queryAll(`
    SELECT br.*, u.name as member_name, p.title as project_title, s.name as setter_name
    FROM billable_rates br
    LEFT JOIN users u ON u.id = br.user_id
    LEFT JOIN projects p ON p.id = br.project_id
    LEFT JOIN users s ON s.id = br.set_by
    WHERE br.user_id = ?
    ORDER BY date(br.effective_from) DESC, br.id DESC
  `, [userId]);

  return { user_id: userId, rates };
}

/**
 * Retrieves all billable rate overrides for a project
 * Role: Admin+
 */
export function getProjectRates(projectId, currentUser) {
  if (!isAdmin(currentUser)) {
    const err = new Error('Forbidden: Admin role required to view project billable rates');
    err.status = 403;
    throw err;
  }

  const rates = queryAll(`
    SELECT br.*, u.name as member_name, p.title as project_title, s.name as setter_name
    FROM billable_rates br
    LEFT JOIN users u ON u.id = br.user_id
    LEFT JOIN projects p ON p.id = br.project_id
    LEFT JOIN users s ON s.id = br.set_by
    WHERE br.project_id = ?
    ORDER BY date(br.effective_from) DESC, br.id DESC
  `, [projectId]);

  return { project_id: projectId, rates };
}

/**
 * Fetches a single time entry by ID with access checks
 */
export function getTimeEntryById(entryId, currentUser) {
  const entry = queryOne(`
    SELECT te.*, p.title as project_title, u.name as user_name
    FROM time_entries te
    LEFT JOIN projects p ON p.id = te.project_id
    LEFT JOIN users u ON u.id = te.user_id
    WHERE te.id = ?
  `, [entryId]);

  if (!entry) {
    const err = new Error('Time entry not found');
    err.status = 404;
    throw err;
  }

  if (entry.user_id !== currentUser.id && !isAdmin(currentUser)) {
    const err = new Error('Forbidden: Access denied to other members time entries');
    err.status = 403;
    throw err;
  }

  return entry;
}

// ===================================================================
// MANUAL TIME ENTRY & TIMESHEET SERVICE (LAYER 3)
// ===================================================================

/**
 * Creates a manual time entry for the authenticated user
 * Rules:
 * - end_time >= start_time validation
 * - source_ref_type must be BACKLOG_ITEM | GANTT_ITEM | PIPELINE_POINT | NULL
 * - Overlap check mandatory before INSERT (409 Conflict)
 * - Server-side duration_minutes = ROUND((end_time - start_time) / 60)
 * - Billable rate snapshotted at start_time via resolveBillableRate
 * - Billable amount snapshotted at creation time
 * - Status defaults to PENDING
 * - Audit row written to time_entry_history (status: MANUAL_CREATED)
 * - updated_at manually set
 */
export function createManualEntry({
  project_id,
  start_time,
  end_time,
  description,
  task_description,
  is_billable,
  source_ref_type,
  source_ref_id
}, currentUser) {
  if (!currentUser || !currentUser.id) {
    const err = new Error('Unauthorized');
    err.status = 401;
    throw err;
  }

  if (!project_id) {
    const err = new Error('project_id is required');
    err.status = 400;
    throw err;
  }

  if (!start_time || !end_time) {
    const err = new Error('start_time and end_time are required');
    err.status = 400;
    throw err;
  }

  const project = queryOne('SELECT id, title FROM projects WHERE id = ?', [project_id]);
  if (!project) {
    const err = new Error('Project not found');
    err.status = 404;
    throw err;
  }

  const startMs = new Date(start_time).getTime();
  const endMs = new Date(end_time).getTime();
  if (isNaN(startMs) || isNaN(endMs)) {
    const err = new Error('Invalid ISO date format for start_time or end_time');
    err.status = 400;
    throw err;
  }

  if (endMs < startMs) {
    const err = new Error('end_time must be greater than or equal to start_time');
    err.status = 400;
    throw err;
  }

  // Validate source_ref_type linkage
  const validSourceRefTypes = ['BACKLOG_ITEM', 'GANTT_ITEM', 'PIPELINE_POINT'];
  const refType = source_ref_type ? String(source_ref_type).trim().toUpperCase() : null;
  if (refType && !validSourceRefTypes.includes(refType)) {
    const err = new Error(`source_ref_type must be one of: ${validSourceRefTypes.join(', ')} or NULL`);
    err.status = 400;
    throw err;
  }

  const startISO = new Date(start_time).toISOString();
  const endISO = new Date(end_time).toISOString();

  // Mandatory overlap check before INSERT
  const overlap = checkTimeOverlap(currentUser.id, startISO, endISO);
  if (overlap) {
    const err = new Error('Time entry interval overlaps with an existing time entry');
    err.status = 409;
    throw err;
  }

  // Server-side duration calculation
  const durationMinutes = Math.max(0, Math.round((endMs - startMs) / 60000));

  // Billable rate snapshotting via resolveBillableRate
  const isBillableNum = (is_billable === true || is_billable === 1 || is_billable === '1' || is_billable === 'true') ? 1 : 0;
  const rateInfo = resolveBillableRate(currentUser.id, project_id, startISO);
  const billableRate = rateInfo.rate;
  const billableAmount = isBillableNum === 1
    ? Number(((durationMinutes / 60) * billableRate).toFixed(2))
    : 0.0;

  const nowISO = new Date().toISOString();

  execute(`
    INSERT INTO time_entries (
      user_id, project_id, source_type, source_ref_type, source_ref_id,
      description, start_time, end_time, duration_minutes,
      is_billable, billable_rate, billable_amount, status,
      created_at, updated_at
    ) VALUES (
      ?, ?, 'MANUAL', ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, 'PENDING',
      ?, ?
    )
  `, [
    currentUser.id,
    project_id,
    refType || null,
    source_ref_id ? Number(source_ref_id) : null,
    (description !== undefined ? description : task_description) ? String(description !== undefined ? description : task_description).trim() : 'Manual Time Log',
    startISO,
    endISO,
    durationMinutes,
    isBillableNum,
    billableRate,
    billableAmount,
    nowISO,
    nowISO
  ]);

  const newEntry = queryOne(`
    SELECT te.*, p.title as project_title, u.name as user_name
    FROM time_entries te
    LEFT JOIN projects p ON p.id = te.project_id
    LEFT JOIN users u ON u.id = te.user_id
    WHERE te.user_id = ?
    ORDER BY te.id DESC LIMIT 1
  `, [currentUser.id]);

  // Log creation audit row in time_entry_history (append-only)
  logTimeEntryHistory(newEntry.id, currentUser.id, 'status', null, 'MANUAL_CREATED');

  return {
    success: true,
    message: 'Manual time entry created successfully',
    time_entry: newEntry
  };
}

/**
 * Updates an existing time entry
 * Rules:
 * - 24-hour edit window for MANUAL entries: (NOW - created_at) <= 86400 seconds
 * - TIMER entries member-locked (403 immediately)
 * - Admin override always permitted regardless of age or source_type
 * - Field-level audit trail for every changed field written to time_entry_history
 * - Overlap check excluding self
 * - updated_at manually updated
 */
export function updateTimeEntry(entryId, updates = {}, currentUser) {
  if (!currentUser || !currentUser.id) {
    const err = new Error('Unauthorized');
    err.status = 401;
    throw err;
  }

  const entry = queryOne('SELECT * FROM time_entries WHERE id = ?', [entryId]);
  if (!entry) {
    const err = new Error('Time entry not found');
    err.status = 404;
    throw err;
  }

  if (entry.status === 'DELETED') {
    const err = new Error('Cannot edit a deleted time entry');
    err.status = 400;
    throw err;
  }

  // 24hr window & permissions check
  const perm = canEditTimeEntry(entry, currentUser);
  if (!perm.allowed) {
    const err = new Error(perm.reason);
    err.status = 403;
    throw err;
  }

  const descCandidate = updates.description !== undefined ? updates.description : updates.task_description;
  let newStart = updates.start_time !== undefined ? new Date(updates.start_time).toISOString() : entry.start_time;
  let newEnd = updates.end_time !== undefined ? new Date(updates.end_time).toISOString() : entry.end_time;
  let newDesc = descCandidate !== undefined ? String(descCandidate).trim() : entry.description;
  let newIsBillable = updates.is_billable !== undefined
    ? ((updates.is_billable === true || updates.is_billable === 1 || updates.is_billable === '1' || updates.is_billable === 'true') ? 1 : 0)
    : entry.is_billable;

  let startChanged = updates.start_time !== undefined && newStart !== entry.start_time;
  let endChanged = updates.end_time !== undefined && newEnd !== entry.end_time;
  let descChanged = descCandidate !== undefined && newDesc !== entry.description;
  let billableChanged = updates.is_billable !== undefined && newIsBillable !== entry.is_billable;

  let newDuration = entry.duration_minutes;
  let newBillableAmount = entry.billable_amount;

  if (startChanged || endChanged) {
    const startMs = new Date(newStart).getTime();
    const endMs = new Date(newEnd).getTime();
    if (isNaN(startMs) || isNaN(endMs)) {
      const err = new Error('Invalid ISO date format for start_time or end_time');
      err.status = 400;
      throw err;
    }
    if (endMs < startMs) {
      const err = new Error('end_time must be greater than or equal to start_time');
      err.status = 400;
      throw err;
    }

    // Overlap check (excluding self)
    const overlap = checkTimeOverlap(entry.user_id, newStart, newEnd, entry.id);
    if (overlap) {
      const err = new Error('Updated time interval overlaps with an existing time entry');
      err.status = 409;
      throw err;
    }

    newDuration = Math.max(0, Math.round((endMs - startMs) / 60000));
  }

  // Recalculate billable_amount if duration or is_billable changed (rate stays snapshotted)
  if (startChanged || endChanged || billableChanged) {
    const rate = Number(entry.billable_rate) || 0.0;
    newBillableAmount = newIsBillable === 1
      ? Number(((newDuration / 60) * rate).toFixed(2))
      : 0.0;
  }

  // Field-level audit trail: log every modified field
  if (descChanged) {
    logTimeEntryHistory(entry.id, currentUser.id, 'description', entry.description, newDesc);
  }
  if (startChanged) {
    logTimeEntryHistory(entry.id, currentUser.id, 'start_time', entry.start_time, newStart);
  }
  if (endChanged) {
    logTimeEntryHistory(entry.id, currentUser.id, 'end_time', entry.end_time, newEnd);
  }
  if (startChanged || endChanged) {
    if (newDuration !== entry.duration_minutes) {
      logTimeEntryHistory(entry.id, currentUser.id, 'duration_minutes', entry.duration_minutes, newDuration);
    }
  }
  if (billableChanged) {
    logTimeEntryHistory(entry.id, currentUser.id, 'is_billable', entry.is_billable, newIsBillable);
  }
  if (newBillableAmount !== entry.billable_amount) {
    logTimeEntryHistory(entry.id, currentUser.id, 'billable_amount', entry.billable_amount, newBillableAmount);
  }

  const nowISO = new Date().toISOString();

  // Manually update updated_at
  execute(`
    UPDATE time_entries
    SET description = ?,
        start_time = ?,
        end_time = ?,
        duration_minutes = ?,
        is_billable = ?,
        billable_amount = ?,
        updated_at = ?
    WHERE id = ?
  `, [
    newDesc,
    newStart,
    newEnd,
    newDuration,
    newIsBillable,
    newBillableAmount,
    nowISO,
    entry.id
  ]);

  const updatedEntry = queryOne(`
    SELECT te.*, p.title as project_title, u.name as user_name
    FROM time_entries te
    LEFT JOIN projects p ON p.id = te.project_id
    LEFT JOIN users u ON u.id = te.user_id
    WHERE te.id = ?
  `, [entry.id]);

  return {
    success: true,
    message: 'Time entry updated successfully',
    time_entry: updatedEntry
  };
}

/**
 * Soft deletes a time entry (Admin only)
 * Rules:
 * - Admin only (403 for members)
 * - Soft delete only: status = 'DELETED' and updated_at = datetime('now')
 * - Do NOT hard delete the row (preserves referential integrity for time_entry_history)
 * - Do NOT use PRAGMA foreign_keys = OFF anywhere
 * - Audit rows in time_entry_history written before status update
 */
export function deleteTimeEntry(entryId, reason, currentUser) {
  if (!isAdmin(currentUser)) {
    const err = new Error('Forbidden: Admin role required to delete time entries');
    err.status = 403;
    throw err;
  }

  const entry = queryOne('SELECT * FROM time_entries WHERE id = ?', [entryId]);
  if (!entry) {
    const err = new Error('Time entry not found');
    err.status = 404;
    throw err;
  }

  if (entry.status === 'DELETED') {
    return {
      success: true,
      message: 'Time entry is already deleted',
      deleted_id: Number(entryId)
    };
  }

  // Audit rows written to time_entry_history before soft delete
  logTimeEntryHistory(entry.id, currentUser.id, 'status', entry.status, 'DELETED');
  logTimeEntryHistory(entry.id, currentUser.id, 'deletion_reason', null, reason ? String(reason).trim() : 'Deleted by admin');

  // If this entry has an active timer lock, release it
  execute('DELETE FROM active_timers WHERE time_entry_id = ?', [entry.id]);

  const nowISO = new Date().toISOString();

  // Soft delete: status = 'DELETED' and manual updated_at
  execute(`
    UPDATE time_entries
    SET status = 'DELETED',
        updated_at = ?
    WHERE id = ?
  `, [nowISO, entry.id]);

  return {
    success: true,
    message: 'Time entry deleted successfully',
    deleted_id: Number(entryId)
  };
}

/**
 * Retrieves own time entries for the authenticated user
 * Filters supported: project_id, from, to, status
 * Excludes status = 'DELETED' by default
 */
export function getMyTimeEntries(filters = {}, currentUser) {
  if (!currentUser || !currentUser.id) {
    const err = new Error('Unauthorized');
    err.status = 401;
    throw err;
  }

  const { project_id, from, to, status } = filters;
  const conditions = ['te.user_id = ?'];
  const params = [currentUser.id];

  // Exclude DELETED by default unless explicitly filtered
  if (status) {
    conditions.push('te.status = ?');
    params.push(status);
  } else {
    conditions.push("te.status != 'DELETED'");
  }

  if (project_id) {
    conditions.push('te.project_id = ?');
    params.push(project_id);
  }

  if (from) {
    conditions.push('date(te.start_time) >= date(?)');
    params.push(from.includes('T') ? from.split('T')[0] : from);
  }

  if (to) {
    conditions.push('date(te.start_time) <= date(?)');
    params.push(to.includes('T') ? to.split('T')[0] : to);
  }

  const whereClause = conditions.join(' AND ');
  const entries = queryAll(`
    SELECT te.*, p.title as project_title, u.name as user_name
    FROM time_entries te
    LEFT JOIN projects p ON p.id = te.project_id
    LEFT JOIN users u ON u.id = te.user_id
    WHERE ${whereClause}
    ORDER BY datetime(te.start_time) DESC, te.id DESC
  `, params);

  return {
    success: true,
    count: entries.length,
    entries
  };
}

/**
 * Retrieves all time entries for a project (Admin only)
 * Filters supported: user_id, from, to, status
 * Excludes status = 'DELETED' by default
 */
export function getProjectTimeEntries(projectId, filters = {}, currentUser) {
  if (!isAdmin(currentUser)) {
    const err = new Error('Forbidden: Admin role required to view project time entries');
    err.status = 403;
    throw err;
  }

  if (!projectId) {
    const err = new Error('projectId is required');
    err.status = 400;
    throw err;
  }

  const { user_id, from, to, status } = filters;
  const conditions = ['te.project_id = ?'];
  const params = [projectId];

  // Exclude DELETED by default unless explicitly filtered
  if (status) {
    conditions.push('te.status = ?');
    params.push(status);
  } else {
    conditions.push("te.status != 'DELETED'");
  }

  if (user_id) {
    conditions.push('te.user_id = ?');
    params.push(user_id);
  }

  if (from) {
    conditions.push('date(te.start_time) >= date(?)');
    params.push(from.includes('T') ? from.split('T')[0] : from);
  }

  if (to) {
    conditions.push('date(te.start_time) <= date(?)');
    params.push(to.includes('T') ? to.split('T')[0] : to);
  }

  const whereClause = conditions.join(' AND ');
  const entries = queryAll(`
    SELECT te.*, p.title as project_title, u.name as user_name
    FROM time_entries te
    LEFT JOIN projects p ON p.id = te.project_id
    LEFT JOIN users u ON u.id = te.user_id
    WHERE ${whereClause}
    ORDER BY datetime(te.start_time) DESC, te.id DESC
  `, params);

  return {
    success: true,
    project_id: projectId,
    count: entries.length,
    entries
  };
}

// ===================================================================
// APPROVAL WORKFLOW & REPORT ENGINE (LAYER 4)
// ===================================================================

/**
 * Submits an existing time entry for approval
 * Rules:
 * - Entry must exist, not be DELETED
 * - Must belong to currentUser (or Admin)
 * - Timer must not be currently running
 * - Entry status must be PENDING (cannot submit APPROVED or REJECTED)
 * - Prevent duplicate pending request: if entry already has a pending approval request -> 409 Conflict
 * - Inserts into append-only time_approval_requests table
 * - Logs audit row to time_entry_history (status: APPROVAL_REQUESTED)
 */
export function requestApproval(entryId, currentUser) {
  if (!currentUser || !currentUser.id) {
    const err = new Error('Unauthorized');
    err.status = 401;
    throw err;
  }

  if (!entryId) {
    const err = new Error('entryId is required');
    err.status = 400;
    throw err;
  }

  const entry = queryOne('SELECT * FROM time_entries WHERE id = ?', [entryId]);
  if (!entry) {
    const err = new Error('Time entry not found');
    err.status = 404;
    throw err;
  }

  if (entry.status === 'DELETED') {
    const err = new Error('Cannot submit a deleted time entry for approval');
    err.status = 400;
    throw err;
  }

  if (entry.user_id !== currentUser.id && !isAdmin(currentUser)) {
    const err = new Error('Forbidden: You can only submit your own time entries for approval');
    err.status = 403;
    throw err;
  }

  if (entry.end_time === null) {
    const err = new Error('Cannot submit an active running timer for approval');
    err.status = 400;
    throw err;
  }

  if (entry.status === 'APPROVED') {
    const err = new Error('Time entry is already approved');
    err.status = 400;
    throw err;
  }

  if (entry.status === 'REJECTED') {
    const err = new Error('Rejected entries cannot be resubmitted. Please create a new entry');
    err.status = 400;
    throw err;
  }

  if (entry.status !== 'PENDING') {
    const err = new Error(`Time entry must be in PENDING status (current: ${entry.status})`);
    err.status = 400;
    throw err;
  }

  // Prevent duplicate pending request: if entry already has a pending approval request
  const existingPending = queryOne(`
    SELECT tar.id
    FROM time_approval_requests tar
    JOIN time_entries te ON te.id = tar.entry_id
    WHERE tar.entry_id = ?
      AND te.status = 'PENDING'
    LIMIT 1
  `, [entry.id]);

  if (existingPending) {
    const err = new Error('Entry already has a pending approval request');
    err.status = 409;
    throw err;
  }

  const nowISO = new Date().toISOString();

  // Insert into append-only time_approval_requests
  execute(`
    INSERT INTO time_approval_requests (
      entry_id, requested_by, requested_at, decision, created_at
    ) VALUES (
      ?, ?, ?, 'PENDING', ?
    )
  `, [
    entry.id,
    currentUser.id,
    nowISO,
    nowISO
  ]);

  const requestRow = queryOne(`
    SELECT * FROM time_approval_requests
    WHERE entry_id = ?
    ORDER BY id DESC LIMIT 1
  `, [entry.id]);

  // Log audit row in time_entry_history (append-only)
  logTimeEntryHistory(entry.id, currentUser.id, 'status', 'PENDING', 'APPROVAL_REQUESTED');

  return {
    success: true,
    message: 'Time entry submitted for approval successfully',
    approval_request: requestRow
  };
}

/**
 * Approves a time entry (Admin only)
 * Rules:
 * - Admin only (403 for members)
 * - Updates time_entries status to 'APPROVED', approved_by, approved_at, and updated_at
 * - time_approval_requests is append-only (trigger blocked) — do not update it
 * - Logs audit row in time_entry_history
 * - Logs event in access_log
 */
export function approveTimeEntry(requestId, currentUser) {
  if (!isAdmin(currentUser)) {
    const err = new Error('Forbidden: Admin role required to approve time entries');
    err.status = 403;
    throw err;
  }

  if (!requestId) {
    const err = new Error('requestId is required');
    err.status = 400;
    throw err;
  }

  const request = queryOne('SELECT * FROM time_approval_requests WHERE id = ?', [requestId]);
  if (!request) {
    const err = new Error('Approval request not found');
    err.status = 404;
    throw err;
  }

  const entry = queryOne('SELECT * FROM time_entries WHERE id = ?', [request.entry_id]);
  if (!entry) {
    const err = new Error('Time entry not found');
    err.status = 404;
    throw err;
  }

  if (entry.status === 'DELETED') {
    const err = new Error('Cannot approve a deleted time entry');
    err.status = 400;
    throw err;
  }

  if (entry.status === 'APPROVED') {
    const err = new Error('Time entry is already approved');
    err.status = 400;
    throw err;
  }

  if (entry.status === 'REJECTED') {
    const err = new Error('Time entry is already rejected and cannot be approved');
    err.status = 400;
    throw err;
  }

  const nowISO = new Date().toISOString();

  // Audit row logged in time_entry_history
  logTimeEntryHistory(entry.id, currentUser.id, 'status', entry.status, 'APPROVED');

  // Update time_entries status and manually set updated_at
  execute(`
    UPDATE time_entries
    SET status = 'APPROVED',
        approved_by = ?,
        approved_at = ?,
        updated_at = ?
    WHERE id = ?
  `, [currentUser.id, nowISO, nowISO, entry.id]);

  // Log in access_log
  logAccess({
    userId: currentUser.id,
    action: 'TIME_ENTRY_APPROVED',
    resource: 'time_entries',
    targetId: entry.id
  });

  const updatedEntry = queryOne(`
    SELECT te.*, p.title as project_title, u.name as user_name
    FROM time_entries te
    LEFT JOIN projects p ON p.id = te.project_id
    LEFT JOIN users u ON u.id = te.user_id
    WHERE te.id = ?
  `, [entry.id]);

  return {
    success: true,
    message: 'Time entry approved successfully',
    time_entry: updatedEntry
  };
}

/**
 * Rejects a time entry (Admin only)
 * Rules:
 * - Admin only (403 for members)
 * - Requires decision_note (min 10 characters)
 * - Updates time_entries status to 'REJECTED', rejection_reason, and updated_at
 * - Rejected entries cannot be resubmitted
 * - Logs audit row in time_entry_history
 * - Logs event in access_log
 */
export function rejectTimeEntry(requestId, decisionNote, currentUser) {
  if (!isAdmin(currentUser)) {
    const err = new Error('Forbidden: Admin role required to reject time entries');
    err.status = 403;
    throw err;
  }

  if (!requestId) {
    const err = new Error('requestId is required');
    err.status = 400;
    throw err;
  }

  if (!decisionNote || typeof decisionNote !== 'string' || decisionNote.trim().length < 10) {
    const err = new Error('decision_note is required and must be at least 10 characters');
    err.status = 400;
    throw err;
  }

  const request = queryOne('SELECT * FROM time_approval_requests WHERE id = ?', [requestId]);
  if (!request) {
    const err = new Error('Approval request not found');
    err.status = 404;
    throw err;
  }

  const entry = queryOne('SELECT * FROM time_entries WHERE id = ?', [request.entry_id]);
  if (!entry) {
    const err = new Error('Time entry not found');
    err.status = 404;
    throw err;
  }

  if (entry.status === 'DELETED') {
    const err = new Error('Cannot reject a deleted time entry');
    err.status = 400;
    throw err;
  }

  if (entry.status === 'REJECTED') {
    const err = new Error('Time entry is already rejected');
    err.status = 400;
    throw err;
  }

  if (entry.status === 'APPROVED') {
    const err = new Error('Time entry is already approved and cannot be rejected');
    err.status = 400;
    throw err;
  }

  const trimmedNote = decisionNote.trim();
  const nowISO = new Date().toISOString();

  // Audit rows logged in time_entry_history
  logTimeEntryHistory(entry.id, currentUser.id, 'status', entry.status, 'REJECTED');
  logTimeEntryHistory(entry.id, currentUser.id, 'rejection_reason', entry.rejection_reason, trimmedNote);

  // Update time_entries status, rejection_reason, and manually set updated_at
  execute(`
    UPDATE time_entries
    SET status = 'REJECTED',
        rejection_reason = ?,
        updated_at = ?
    WHERE id = ?
  `, [trimmedNote, nowISO, entry.id]);

  // Log in access_log
  logAccess({
    userId: currentUser.id,
    action: 'TIME_ENTRY_REJECTED',
    resource: 'time_entries',
    targetId: entry.id
  });

  const updatedEntry = queryOne(`
    SELECT te.*, p.title as project_title, u.name as user_name
    FROM time_entries te
    LEFT JOIN projects p ON p.id = te.project_id
    LEFT JOIN users u ON u.id = te.user_id
    WHERE te.id = ?
  `, [entry.id]);

  return {
    success: true,
    message: 'Time entry rejected successfully',
    time_entry: updatedEntry
  };
}

/**
 * Returns all PENDING approval requests (Admin only)
 */
export function getPendingApprovals(currentUser) {
  if (!isAdmin(currentUser)) {
    const err = new Error('Forbidden: Admin role required to view approval queue');
    err.status = 403;
    throw err;
  }

  const requests = queryAll(`
    SELECT tar.id as request_id, tar.entry_id, tar.requested_by, tar.requested_at,
           te.project_id, te.description, te.duration_minutes, te.is_billable,
           te.billable_rate, te.billable_amount, te.start_time, te.end_time,
           te.status as entry_status,
           u.name as member_name, u.email as member_email,
           p.title as project_title
    FROM time_approval_requests tar
    JOIN time_entries te ON te.id = tar.entry_id
    JOIN users u ON u.id = tar.requested_by
    LEFT JOIN projects p ON p.id = te.project_id
    WHERE te.status = 'PENDING'
      AND te.status != 'DELETED'
    ORDER BY datetime(tar.requested_at) ASC, tar.id ASC
  `);

  return {
    success: true,
    count: requests.length,
    requests
  };
}

/**
 * Retrieves full team time report aggregated per member (Admin only)
 * Filters: project_id, from, to
 * Excludes status = 'DELETED'
 */
export function getTeamTimeReport(filters = {}, currentUser) {
  if (!isAdmin(currentUser)) {
    const err = new Error('Forbidden: Admin role required to view team time reports');
    err.status = 403;
    throw err;
  }

  const { project_id, from, to } = filters;
  const conditions = ["te.status != 'DELETED'", "te.end_time IS NOT NULL"];
  const params = [];

  if (project_id) {
    conditions.push('te.project_id = ?');
    params.push(project_id);
  }

  if (from) {
    conditions.push('date(te.start_time) >= date(?)');
    params.push(from.includes('T') ? from.split('T')[0] : from);
  }

  if (to) {
    conditions.push('date(te.start_time) <= date(?)');
    params.push(to.includes('T') ? to.split('T')[0] : to);
  }

  const whereClause = conditions.join(' AND ');

  const memberRows = queryAll(`
    SELECT u.id as user_id,
           u.name,
           u.email,
           COUNT(te.id) as entries_count,
           COALESCE(SUM(te.duration_minutes), 0) as total_duration_minutes,
           COALESCE(SUM(CASE WHEN te.is_billable = 1 THEN te.duration_minutes ELSE 0 END), 0) as billable_duration_minutes,
           COALESCE(SUM(CASE WHEN te.is_billable = 0 THEN te.duration_minutes ELSE 0 END), 0) as non_billable_duration_minutes,
           COALESCE(SUM(te.billable_amount), 0.0) as total_billable_amount
    FROM users u
    JOIN time_entries te ON te.user_id = u.id
    WHERE ${whereClause}
    GROUP BY u.id
    ORDER BY u.name ASC
  `, params);

  let grandTotalMinutes = 0;
  let grandBillableMinutes = 0;
  let grandNonBillableMinutes = 0;
  let grandBillableAmount = 0.0;
  let grandEntriesCount = 0;

  const members = memberRows.map(row => {
    const totalMinutes = Number(row.total_duration_minutes) || 0;
    const billableMinutes = Number(row.billable_duration_minutes) || 0;
    const nonBillableMinutes = Number(row.non_billable_duration_minutes) || 0;
    const billableAmt = Number(row.total_billable_amount) || 0.0;
    const count = Number(row.entries_count) || 0;

    grandTotalMinutes += totalMinutes;
    grandBillableMinutes += billableMinutes;
    grandNonBillableMinutes += nonBillableMinutes;
    grandBillableAmount += billableAmt;
    grandEntriesCount += count;

    return {
      user_id: row.user_id,
      name: row.name,
      email: row.email,
      total_hrs: Number((totalMinutes / 60).toFixed(2)),
      billable_hrs: Number((billableMinutes / 60).toFixed(2)),
      non_billable_hrs: Number((nonBillableMinutes / 60).toFixed(2)),
      billable_amount: Number(billableAmt.toFixed(2)),
      entries_count: count
    };
  });

  return {
    success: true,
    filters: {
      project_id: project_id || null,
      from: from || null,
      to: to || null
    },
    summary: {
      member_count: members.length,
      entries_count: grandEntriesCount,
      total_hrs: Number((grandTotalMinutes / 60).toFixed(2)),
      billable_hrs: Number((grandBillableMinutes / 60).toFixed(2)),
      non_billable_hrs: Number((grandNonBillableMinutes / 60).toFixed(2)),
      billable_amount: Number(grandBillableAmount.toFixed(2))
    },
    members
  };
}

/**
 * Retrieves own time report for the authenticated member
 * Filters: project_id, from, to
 * Excludes status = 'DELETED'
 */
export function getMyTimeReport(filters = {}, currentUser) {
  if (!currentUser || !currentUser.id) {
    const err = new Error('Unauthorized');
    err.status = 401;
    throw err;
  }

  const { project_id, from, to } = filters;
  const conditions = [
    'te.user_id = ?',
    "te.status != 'DELETED'",
    'te.end_time IS NOT NULL'
  ];
  const params = [currentUser.id];

  if (project_id) {
    conditions.push('te.project_id = ?');
    params.push(project_id);
  }

  if (from) {
    conditions.push('date(te.start_time) >= date(?)');
    params.push(from.includes('T') ? from.split('T')[0] : from);
  }

  if (to) {
    conditions.push('date(te.start_time) <= date(?)');
    params.push(to.includes('T') ? to.split('T')[0] : to);
  }

  const whereClause = conditions.join(' AND ');

  const agg = queryOne(`
    SELECT COUNT(te.id) as entries_count,
           COALESCE(SUM(te.duration_minutes), 0) as total_duration_minutes,
           COALESCE(SUM(CASE WHEN te.is_billable = 1 THEN te.duration_minutes ELSE 0 END), 0) as billable_duration_minutes,
           COALESCE(SUM(CASE WHEN te.is_billable = 0 THEN te.duration_minutes ELSE 0 END), 0) as non_billable_duration_minutes,
           COALESCE(SUM(te.billable_amount), 0.0) as total_billable_amount
    FROM time_entries te
    WHERE ${whereClause}
  `, params);

  const totalMinutes = Number(agg?.total_duration_minutes) || 0;
  const billableMinutes = Number(agg?.billable_duration_minutes) || 0;
  const nonBillableMinutes = Number(agg?.non_billable_duration_minutes) || 0;
  const billableAmt = Number(agg?.total_billable_amount) || 0.0;
  const entriesCount = Number(agg?.entries_count) || 0;

  // Breakdown by project
  const projectBreakdown = queryAll(`
    SELECT p.id as project_id,
           p.title as project_title,
           COUNT(te.id) as entries_count,
           COALESCE(SUM(te.duration_minutes), 0) as duration_minutes,
           COALESCE(SUM(CASE WHEN te.is_billable = 1 THEN te.duration_minutes ELSE 0 END), 0) as billable_minutes,
           COALESCE(SUM(te.billable_amount), 0.0) as billable_amount
    FROM time_entries te
    LEFT JOIN projects p ON p.id = te.project_id
    WHERE ${whereClause}
    GROUP BY te.project_id
    ORDER BY duration_minutes DESC
  `, params).map(p => ({
    project_id: p.project_id,
    project_title: p.project_title || 'Unassigned',
    entries_count: Number(p.entries_count) || 0,
    total_hrs: Number(((Number(p.duration_minutes) || 0) / 60).toFixed(2)),
    billable_hrs: Number(((Number(p.billable_minutes) || 0) / 60).toFixed(2)),
    billable_amount: Number((Number(p.billable_amount) || 0).toFixed(2))
  }));

  return {
    success: true,
    user_id: currentUser.id,
    summary: {
      entries_count: entriesCount,
      total_hrs: Number((totalMinutes / 60).toFixed(2)),
      billable_hrs: Number((billableMinutes / 60).toFixed(2)),
      non_billable_hrs: Number((nonBillableMinutes / 60).toFixed(2)),
      billable_amount: Number(billableAmt.toFixed(2))
    },
    by_project: projectBreakdown
  };
}

/**
 * Creates a point-in-time snapshot of the report data (Admin only)
 * Stored in append-only time_report_snapshots table
 */
export function createReportSnapshot({ project_id, report_type, period_start, period_end }, currentUser) {
  if (!isAdmin(currentUser)) {
    const err = new Error('Forbidden: Admin role required to create report snapshots');
    err.status = 403;
    throw err;
  }

  const validReportTypes = ['WEEKLY', 'MONTHLY', 'CUSTOM'];
  const type = report_type ? String(report_type).trim().toUpperCase() : null;
  if (!type || !validReportTypes.includes(type)) {
    const err = new Error(`report_type must be one of: ${validReportTypes.join(', ')}`);
    err.status = 400;
    throw err;
  }

  if (!period_start || !period_end) {
    const err = new Error('period_start and period_end are required');
    err.status = 400;
    throw err;
  }

  const startDay = period_start.includes('T') ? period_start.split('T')[0] : period_start;
  const endDay = period_end.includes('T') ? period_end.split('T')[0] : period_end;

  let targetProjectId = project_id ? String(project_id) : null;
  if (targetProjectId) {
    const proj = queryOne('SELECT id, title FROM projects WHERE id = ?', [targetProjectId]);
    if (!proj) {
      const err = new Error('Project not found');
      err.status = 404;
      throw err;
    }
  }

  // Generate team report data to freeze
  const teamReport = getTeamTimeReport({
    project_id: targetProjectId,
    from: startDay,
    to: endDay
  }, currentUser);

  const snapshotDataString = JSON.stringify(teamReport.members);
  const nowISO = new Date().toISOString();

  // Insert into append-only time_report_snapshots
  execute(`
    INSERT INTO time_report_snapshots (
      project_id, report_type, period_start, period_end, snapshot_data, taken_by, created_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?
    )
  `, [
    targetProjectId,
    type,
    startDay,
    endDay,
    snapshotDataString,
    currentUser.id,
    nowISO
  ]);

  const createdSnapshot = queryOne(`
    SELECT trs.*, u.name as taken_by_name, p.title as project_title
    FROM time_report_snapshots trs
    LEFT JOIN users u ON u.id = trs.taken_by
    LEFT JOIN projects p ON p.id = trs.project_id
    WHERE trs.taken_by = ?
    ORDER BY trs.id DESC LIMIT 1
  `, [currentUser.id]);

  return {
    success: true,
    message: 'Report snapshot created successfully',
    snapshot: {
      ...createdSnapshot,
      snapshot_data: JSON.parse(createdSnapshot.snapshot_data)
    }
  };
}

/**
 * Retrieves report snapshots for a project or company-wide (Admin only)
 */
export function getReportSnapshots(projectId, currentUser) {
  if (!isAdmin(currentUser)) {
    const err = new Error('Forbidden: Admin role required to view report snapshots');
    err.status = 403;
    throw err;
  }

  let snapshots;
  if (projectId && projectId !== 'all') {
    snapshots = queryAll(`
      SELECT trs.*, u.name as taken_by_name, p.title as project_title
      FROM time_report_snapshots trs
      LEFT JOIN users u ON u.id = trs.taken_by
      LEFT JOIN projects p ON p.id = trs.project_id
      WHERE trs.project_id = ?
      ORDER BY trs.id DESC
    `, [String(projectId)]);
  } else {
    snapshots = queryAll(`
      SELECT trs.*, u.name as taken_by_name, p.title as project_title
      FROM time_report_snapshots trs
      LEFT JOIN users u ON u.id = trs.taken_by
      LEFT JOIN projects p ON p.id = trs.project_id
      ORDER BY trs.id DESC
    `);
  }

  const parsed = snapshots.map(s => {
    try {
      return {
        ...s,
        snapshot_data: JSON.parse(s.snapshot_data)
      };
    } catch {
      return s;
    }
  });

  return {
    success: true,
    count: parsed.length,
    snapshots: parsed
  };
}

/**
 * Generates export data in CSV format and audits in access_log (Admin only)
 */
export function exportTimeReportData(projectId, filters = {}, currentUser) {
  if (!isAdmin(currentUser)) {
    const err = new Error('Forbidden: Admin role required to export time reports');
    err.status = 403;
    throw err;
  }

  const conditions = ["te.status != 'DELETED'"];
  const params = [];

  if (projectId && projectId !== 'all') {
    conditions.push('te.project_id = ?');
    params.push(String(projectId));
  }

  if (filters.from) {
    conditions.push('date(te.start_time) >= date(?)');
    params.push(filters.from.includes('T') ? filters.from.split('T')[0] : filters.from);
  }

  if (filters.to) {
    conditions.push('date(te.start_time) <= date(?)');
    params.push(filters.to.includes('T') ? filters.to.split('T')[0] : filters.to);
  }

  const whereClause = conditions.join(' AND ');

  const rows = queryAll(`
    SELECT te.id as entry_id,
           u.name as member_name,
           u.email as member_email,
           COALESCE(p.title, 'No Project') as project_title,
           te.description,
           te.start_time,
           te.end_time,
           te.duration_minutes,
           te.is_billable,
           te.billable_rate,
           te.billable_amount,
           te.status,
           te.created_at
    FROM time_entries te
    LEFT JOIN users u ON u.id = te.user_id
    LEFT JOIN projects p ON p.id = te.project_id
    WHERE ${whereClause}
    ORDER BY datetime(te.start_time) DESC, te.id DESC
  `, params);

  // Audit log in access_log
  logAccess({
    userId: currentUser.id,
    action: 'TIME_REPORT_EXPORT',
    resource: 'time_report',
    targetId: projectId !== 'all' ? String(projectId) : null
  });

  // Helper to escape CSV values
  const escapeCsv = (val) => {
    if (val === null || val === undefined) return '';
    const str = String(val);
    if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const headers = [
    'Entry ID',
    'Member Name',
    'Member Email',
    'Project Title',
    'Description',
    'Start Time',
    'End Time',
    'Duration (Minutes)',
    'Duration (Hours)',
    'Billable',
    'Billable Rate (INR)',
    'Billable Amount (INR)',
    'Status',
    'Created At'
  ];

  const csvRows = [headers.join(',')];

  for (const r of rows) {
    const durationMins = r.duration_minutes !== null ? Number(r.duration_minutes) : '';
    const durationHours = r.duration_minutes !== null ? (durationMins / 60).toFixed(2) : '';
    const isBillableStr = r.is_billable === 1 ? 'Yes' : 'No';

    const line = [
      escapeCsv(r.entry_id),
      escapeCsv(r.member_name),
      escapeCsv(r.member_email),
      escapeCsv(r.project_title),
      escapeCsv(r.description),
      escapeCsv(r.start_time),
      escapeCsv(r.end_time),
      escapeCsv(durationMins),
      escapeCsv(durationHours),
      escapeCsv(isBillableStr),
      escapeCsv(Number(r.billable_rate || 0).toFixed(2)),
      escapeCsv(Number(r.billable_amount || 0).toFixed(2)),
      escapeCsv(r.status),
      escapeCsv(r.created_at)
    ];
    csvRows.push(line.join(','));
  }

  const csvContent = csvRows.join('\r\n');

  return {
    csv: csvContent,
    rows
  };
}
