import { queryOne, queryAll, execute } from '../db/database.js';

/**
 * Helper to verify if user has Admin or Producer/Lead permissions for OKRs
 */
export function isOkrAdmin(user) {
  if (!user) return false;
  const role = user.role;
  return role === 'admin' || role === 'producer' || role === 'superadmin' || role === 'lead';
}

/**
 * Log changes to append-only okr_history table
 */
export function logOkrHistory({ entityType, entityId, changedBy, fieldChanged, oldValue, newValue }) {
  try {
    execute(`
      INSERT INTO okr_history (
        entity_type, entity_id, changed_by, field_changed, old_value, new_value, changed_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, datetime('now')
      )
    `, [
      entityType,
      Number(entityId),
      changedBy,
      fieldChanged,
      oldValue !== null && oldValue !== undefined ? String(oldValue) : null,
      newValue !== null && newValue !== undefined ? String(newValue) : null
    ]);
  } catch (err) {
    console.error('[okrService] Failed to log OKR history:', err.message);
  }
}

/**
 * Detect if linking childId under parentId would create a circular chain (e.g. A -> B -> C -> A)
 * Uses recursive / queue-based ancestor traversal across both okr_objectives and okr_alignment_links
 */
export function wouldCreateCycle(childId, parentId) {
  const cId = Number(childId);
  const pId = Number(parentId);

  if (cId === pId) return true;

  const visited = new Set();
  const queue = [pId];

  while (queue.length > 0) {
    const currentId = queue.shift();
    if (currentId === cId) {
      return true; // Cycle detected: child is an ancestor of parent!
    }
    if (visited.has(currentId)) continue;
    visited.add(currentId);

    // 1. Direct parent in okr_objectives
    const obj = queryOne('SELECT parent_objective_id FROM okr_objectives WHERE id = ?', [currentId]);
    if (obj && obj.parent_objective_id) {
      queue.push(Number(obj.parent_objective_id));
    }

    // 2. All parents in okr_alignment_links
    const links = queryAll('SELECT parent_objective_id FROM okr_alignment_links WHERE child_objective_id = ?', [currentId]);
    for (const link of links) {
      if (link.parent_objective_id) {
        queue.push(Number(link.parent_objective_id));
      }
    }
  }

  return false;
}

/**
 * 1. Create a new Objective
 * Role: Admin+ for COMPANY/TEAM level; Member for own INDIVIDUAL
 */
export function createObjective({
  title,
  description = null,
  level = 'COMPANY',
  project_id = null,
  cycle = 'Q1-2026',
  parent_objective_id = null,
  owner_id = null,
  status = 'ACTIVE',
  user
}) {
  if (!user || !user.id) {
    const err = new Error('Unauthorized: User ID required');
    err.status = 401;
    throw err;
  }

  if (!title || !title.trim()) {
    const err = new Error('Objective title is required');
    err.status = 400;
    throw err;
  }

  const cleanLevel = (level || 'COMPANY').toUpperCase();
  if (!['COMPANY', 'TEAM', 'INDIVIDUAL'].includes(cleanLevel)) {
    const err = new Error("Invalid level. Must be 'COMPANY', 'TEAM', or 'INDIVIDUAL'");
    err.status = 400;
    throw err;
  }

  const isAdmin = isOkrAdmin(user);

  // Role enforcement: Admin+ for COMPANY/TEAM; Member only for own INDIVIDUAL
  if (['COMPANY', 'TEAM'].includes(cleanLevel) && !isAdmin) {
    const err = new Error('Forbidden: Admin or Producer role required for Company and Team objectives');
    err.status = 403;
    throw err;
  }

  let finalOwnerId = owner_id;
  if (cleanLevel === 'INDIVIDUAL') {
    if (!isAdmin) {
      finalOwnerId = user.id; // Force own user ID for regular members
    } else {
      finalOwnerId = owner_id || user.id;
    }
  } else {
    finalOwnerId = owner_id || user.id;
  }

  // Validate owner exists
  const owner = queryOne('SELECT id, name FROM users WHERE id = ?', [finalOwnerId]);
  if (!owner) {
    const err = new Error(`Owner user not found with id: ${finalOwnerId}`);
    err.status = 404;
    throw err;
  }

  // Validate project if supplied
  if (project_id) {
    const project = queryOne('SELECT id, title FROM projects WHERE id = ?', [project_id]);
    if (!project) {
      const err = new Error(`Project not found with id: ${project_id}`);
      err.status = 404;
      throw err;
    }
  }

  // Validate parent objective if supplied
  let finalParentId = null;
  if (parent_objective_id) {
    const parent = queryOne('SELECT id, title, status FROM okr_objectives WHERE id = ?', [Number(parent_objective_id)]);
    if (!parent) {
      const err = new Error(`Parent objective not found with id: ${parent_objective_id}`);
      err.status = 404;
      throw err;
    }
    if (parent.status === 'ARCHIVED') {
      const err = new Error('Cannot align under an archived objective');
      err.status = 400;
      throw err;
    }
    finalParentId = parent.id;
  }

  const cleanStatus = (status || 'ACTIVE').toUpperCase();
  if (!['DRAFT', 'ACTIVE', 'COMPLETED', 'ARCHIVED', 'DROPPED'].includes(cleanStatus)) {
    const err = new Error("Invalid status. Must be DRAFT, ACTIVE, COMPLETED, ARCHIVED, or DROPPED");
    err.status = 400;
    throw err;
  }

  const result = execute(`
    INSERT INTO okr_objectives (
      title, description, level, owner_id, parent_objective_id, project_id, cycle, status, progress_pct, created_by, created_at, updated_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, 0.0, ?, datetime('now'), datetime('now')
    )
  `, [
    title.trim(),
    description ? description.trim() : null,
    cleanLevel,
    finalOwnerId,
    finalParentId,
    project_id ? Number(project_id) : null,
    cycle ? cycle.trim() : 'Q1-2026',
    cleanStatus,
    user.id
  ]);

  const objectiveId = Number(result.lastInsertRowid);

  // If parent_objective_id supplied, create alignment link in okr_alignment_links
  if (finalParentId) {
    try {
      execute(`
        INSERT OR IGNORE INTO okr_alignment_links (
          child_objective_id, parent_objective_id, linked_by, linked_at
        ) VALUES (
          ?, ?, ?, datetime('now')
        )
      `, [objectiveId, finalParentId, user.id]);
    } catch (linkErr) {
      console.error('[okrService] Failed to insert alignment link:', linkErr.message);
    }
  }

  // Log creation in history
  logOkrHistory({
    entityType: 'OBJECTIVE',
    entityId: objectiveId,
    changedBy: user.id,
    fieldChanged: 'created',
    oldValue: null,
    newValue: title.trim()
  });

  return getObjectiveById(objectiveId, user);
}

/**
 * 2. Get list of objectives with filtering & RBAC
 * Rule 8: Member can only see own INDIVIDUAL objectives — Team and Company objectives visible to all
 */
export function getObjectives({ level, cycle, project_id, status, owner_id, user }) {
  if (!user || !user.id) {
    const err = new Error('Unauthorized: User ID required');
    err.status = 401;
    throw err;
  }

  const isAdmin = isOkrAdmin(user);
  const conditions = [];
  const params = [];

  // Visibility filtering: regular members only see their own INDIVIDUAL objectives
  if (!isAdmin) {
    conditions.push("(o.level IN ('COMPANY', 'TEAM') OR (o.level = 'INDIVIDUAL' AND o.owner_id = ?))");
    params.push(user.id);
  }

  if (level) {
    conditions.push('o.level = ?');
    params.push(level.toUpperCase());
  }

  if (cycle) {
    conditions.push('o.cycle = ?');
    params.push(cycle);
  }

  if (project_id) {
    conditions.push('o.project_id = ?');
    params.push(Number(project_id));
  }

  if (status) {
    conditions.push('o.status = ?');
    params.push(status.toUpperCase());
  }

  if (owner_id) {
    // If regular member requests another owner's objectives, check visibility
    if (!isAdmin && owner_id !== user.id) {
      conditions.push('o.owner_id = ? AND o.level != ?');
      params.push(owner_id, 'INDIVIDUAL');
    } else {
      conditions.push('o.owner_id = ?');
      params.push(owner_id);
    }
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const rows = queryAll(`
    SELECT 
      o.*,
      u.name as owner_name,
      u.email as owner_email,
      u.role as owner_role,
      c.name as creator_name,
      p.title as project_title,
      po.title as parent_title,
      (SELECT COUNT(*) FROM okr_key_results kr WHERE kr.objective_id = o.id) as kr_count
    FROM okr_objectives o
    LEFT JOIN users u ON o.owner_id = u.id
    LEFT JOIN users c ON o.created_by = c.id
    LEFT JOIN projects p ON o.project_id = p.id
    LEFT JOIN okr_objectives po ON o.parent_objective_id = po.id
    ${whereClause}
    ORDER BY o.created_at DESC
  `, params);

  return rows;
}

/**
 * 3. Get Objective by ID with key results, parents, and alignment links
 */
export function getObjectiveById(objectiveId, user) {
  if (!user || !user.id) {
    const err = new Error('Unauthorized: User ID required');
    err.status = 401;
    throw err;
  }

  const id = Number(objectiveId);
  const objective = queryOne(`
    SELECT 
      o.*,
      u.name as owner_name,
      u.email as owner_email,
      u.role as owner_role,
      c.name as creator_name,
      p.title as project_title,
      po.title as parent_title
    FROM okr_objectives o
    LEFT JOIN users u ON o.owner_id = u.id
    LEFT JOIN users c ON o.created_by = c.id
    LEFT JOIN projects p ON o.project_id = p.id
    LEFT JOIN okr_objectives po ON o.parent_objective_id = po.id
    WHERE o.id = ?
  `, [id]);

  if (!objective) {
    const err = new Error(`Objective not found with id: ${objectiveId}`);
    err.status = 404;
    throw err;
  }

  // RBAC check: regular members cannot view another member's INDIVIDUAL objective
  if (objective.level === 'INDIVIDUAL' && objective.owner_id !== user.id && !isOkrAdmin(user)) {
    const err = new Error('Forbidden: You do not have permission to view this individual objective');
    err.status = 403;
    throw err;
  }

  // Fetch key results
  const keyResults = queryAll(`
    SELECT 
      kr.*,
      u.name as assignee_name,
      u.email as assignee_email
    FROM okr_key_results kr
    LEFT JOIN users u ON kr.assigned_to = u.id
    WHERE kr.objective_id = ?
    ORDER BY kr.created_at ASC
  `, [id]);

  // Fetch child objectives
  const childObjectives = queryAll(`
    SELECT 
      o.id, o.title, o.level, o.status, o.progress_pct, o.owner_id,
      u.name as owner_name
    FROM okr_objectives o
    LEFT JOIN users u ON o.owner_id = u.id
    WHERE o.parent_objective_id = ?
    ORDER BY o.created_at ASC
  `, [id]);

  // Fetch alignment links
  const alignmentLinks = queryAll(`
    SELECT 
      l.*,
      co.title as child_title,
      po.title as parent_title,
      u.name as linker_name
    FROM okr_alignment_links l
    LEFT JOIN okr_objectives co ON l.child_objective_id = co.id
    LEFT JOIN okr_objectives po ON l.parent_objective_id = po.id
    LEFT JOIN users u ON l.linked_by = u.id
    WHERE l.child_objective_id = ? OR l.parent_objective_id = ?
    ORDER BY l.linked_at DESC
  `, [id, id]);

  return {
    ...objective,
    key_results: keyResults,
    child_objectives: childObjectives,
    alignment_links: alignmentLinks
  };
}

/**
 * 4. Update Objective
 * Role: Admin+ or owner (own INDIVIDUAL only)
 * Auto-logs to okr_history
 */
export function updateObjective(objectiveId, updates = {}, user) {
  if (!user || !user.id) {
    const err = new Error('Unauthorized: User ID required');
    err.status = 401;
    throw err;
  }

  const id = Number(objectiveId);
  const existing = queryOne('SELECT * FROM okr_objectives WHERE id = ?', [id]);
  if (!existing) {
    const err = new Error(`Objective not found with id: ${objectiveId}`);
    err.status = 404;
    throw err;
  }

  // Rule 7: Archived Objectives are read-only
  if (existing.status === 'ARCHIVED') {
    const err = new Error('Archived objectives are read-only and cannot be modified');
    err.status = 400;
    throw err;
  }

  const isAdmin = isOkrAdmin(user);
  if (!isAdmin) {
    // Only owner of INDIVIDUAL objective can edit
    if (existing.level !== 'INDIVIDUAL' || existing.owner_id !== user.id) {
      const err = new Error('Forbidden: You can only edit your own individual objectives');
      err.status = 403;
      throw err;
    }
  }

  const fieldsToUpdate = [];
  const params = [];
  const validFields = ['title', 'description', 'level', 'cycle', 'project_id', 'parent_objective_id', 'owner_id', 'status'];

  for (const field of validFields) {
    if (updates[field] !== undefined) {
      let newVal = updates[field];
      const oldVal = existing[field];

      if (field === 'title') {
        if (!newVal || !newVal.trim()) {
          const err = new Error('Objective title cannot be empty');
          err.status = 400;
          throw err;
        }
        newVal = newVal.trim();
      }

      if (field === 'level') {
        newVal = newVal.toUpperCase();
        if (!['COMPANY', 'TEAM', 'INDIVIDUAL'].includes(newVal)) {
          const err = new Error("Invalid level. Must be 'COMPANY', 'TEAM', or 'INDIVIDUAL'");
          err.status = 400;
          throw err;
        }
        if (['COMPANY', 'TEAM'].includes(newVal) && !isAdmin) {
          const err = new Error('Forbidden: Only Admin+ can assign Company or Team levels');
          err.status = 403;
          throw err;
        }
      }

      if (field === 'status') {
        newVal = newVal.toUpperCase();
        if (!['DRAFT', 'ACTIVE', 'COMPLETED', 'ARCHIVED', 'DROPPED'].includes(newVal)) {
          const err = new Error("Invalid status");
          err.status = 400;
          throw err;
        }
      }

      if (field === 'parent_objective_id') {
        if (newVal !== null) {
          const parentId = Number(newVal);
          if (parentId === id) {
            const err = new Error('Objective cannot be its own parent');
            err.status = 400;
            throw err;
          }
          if (wouldCreateCycle(id, parentId)) {
            const err = new Error(`Circular alignment detected: Objective #${id} is an ancestor of #${parentId} (cannot create circular chain A→B→C→A)`);
            err.status = 400;
            throw err;
          }
          const parent = queryOne('SELECT id, status FROM okr_objectives WHERE id = ?', [parentId]);
          if (!parent) {
            const err = new Error(`Parent objective not found with id: ${parentId}`);
            err.status = 404;
            throw err;
          }
          if (parent.status === 'ARCHIVED') {
            const err = new Error('Cannot align under an archived objective');
            err.status = 400;
            throw err;
          }
          newVal = parentId;

          // Also insert into okr_alignment_links if not already present
          try {
            execute(`
              INSERT OR IGNORE INTO okr_alignment_links (
                child_objective_id, parent_objective_id, linked_by, linked_at
              ) VALUES (
                ?, ?, ?, datetime('now')
              )
            `, [id, parentId, user.id]);
          } catch (linkErr) {
            console.error('[okrService] Failed to insert alignment link on update:', linkErr.message);
          }
        }
      }

      // Check if value actually changed
      if (String(newVal) !== String(oldVal)) {
        fieldsToUpdate.push(`${field} = ?`);
        params.push(newVal);

        // Auto-log to okr_history (Rule 10)
        logOkrHistory({
          entityType: 'OBJECTIVE',
          entityId: id,
          changedBy: user.id,
          fieldChanged: field,
          oldValue: oldVal,
          newValue: newVal
        });
      }
    }
  }

  if (fieldsToUpdate.length === 0) {
    return getObjectiveById(id, user);
  }

  // Rule 11: updated_at manually updated in service on every PATCH
  fieldsToUpdate.push("updated_at = datetime('now')");
  params.push(id);

  execute(`
    UPDATE okr_objectives
    SET ${fieldsToUpdate.join(', ')}
    WHERE id = ?
  `, params);

  return getObjectiveById(id, user);
}

/**
 * 5. Archive Objective
 * Rule: status → ARCHIVED, all KRs frozen
 * Role: Admin+
 */
export function archiveObjective(objectiveId, user) {
  if (!user || !user.id) {
    const err = new Error('Unauthorized: User ID required');
    err.status = 401;
    throw err;
  }

  if (!isOkrAdmin(user)) {
    const err = new Error('Forbidden: Admin or Producer role required to archive objectives');
    err.status = 403;
    throw err;
  }

  const id = Number(objectiveId);
  const existing = queryOne('SELECT * FROM okr_objectives WHERE id = ?', [id]);
  if (!existing) {
    const err = new Error(`Objective not found with id: ${objectiveId}`);
    err.status = 404;
    throw err;
  }

  if (existing.status === 'ARCHIVED') {
    return getObjectiveById(id, user);
  }

  execute(`
    UPDATE okr_objectives
    SET status = 'ARCHIVED', updated_at = datetime('now')
    WHERE id = ?
  `, [id]);

  // Log in history
  logOkrHistory({
    entityType: 'OBJECTIVE',
    entityId: id,
    changedBy: user.id,
    fieldChanged: 'status',
    oldValue: existing.status,
    newValue: 'ARCHIVED'
  });

  return getObjectiveById(id, user);
}

/**
 * 6. Delete Objective
 * Rule: only DRAFT status deletable, cannot be deleted if it has Key Results
 * Role: Admin+
 */
export function deleteObjective(objectiveId, user) {
  if (!user || !user.id) {
    const err = new Error('Unauthorized: User ID required');
    err.status = 401;
    throw err;
  }

  if (!isOkrAdmin(user)) {
    const err = new Error('Forbidden: Admin or Producer role required to delete objectives');
    err.status = 403;
    throw err;
  }

  const id = Number(objectiveId);
  const existing = queryOne('SELECT * FROM okr_objectives WHERE id = ?', [id]);
  if (!existing) {
    const err = new Error(`Objective not found with id: ${objectiveId}`);
    err.status = 404;
    throw err;
  }

  // Only DRAFT status deletable
  if (existing.status !== 'DRAFT') {
    const err = new Error('Only DRAFT objectives can be deleted. Use archive for active objectives.');
    err.status = 400;
    throw err;
  }

  // Rule 6: Cannot be deleted if it has any Key Results
  const krCount = queryOne('SELECT COUNT(*) as count FROM okr_key_results WHERE objective_id = ?', [id]);
  if (krCount && krCount.count > 0) {
    const err = new Error('Objective cannot be deleted because it has Key Results. Delete Key Results first or archive.');
    err.status = 400;
    throw err;
  }

  // Check if has child objectives
  const childCount = queryOne('SELECT COUNT(*) as count FROM okr_objectives WHERE parent_objective_id = ?', [id]);
  if (childCount && childCount.count > 0) {
    const err = new Error('Cannot delete objective with linked child objectives');
    err.status = 400;
    throw err;
  }

  // Check if it has alignment links (since okr_alignment_links has append-only trigger)
  const linkCount = queryOne('SELECT COUNT(*) as count FROM okr_alignment_links WHERE child_objective_id = ? OR parent_objective_id = ?', [id, id]);
  if (linkCount && linkCount.count > 0) {
    const err = new Error('Cannot delete objective that has permanent alignment links recorded in audit ledger. Use archive instead.');
    err.status = 400;
    throw err;
  }

  execute('DELETE FROM okr_objectives WHERE id = ?', [id]);

  return {
    success: true,
    message: 'Objective deleted successfully',
    id
  };
}

/**
 * 7. Create an explicit Alignment Link between Child and Parent Objectives
 * Role: Admin+
 */
export function createAlignmentLink({ child_objective_id, parent_objective_id, user }) {
  if (!user || !user.id) {
    const err = new Error('Unauthorized: User ID required');
    err.status = 401;
    throw err;
  }

  if (!isOkrAdmin(user)) {
    const err = new Error('Forbidden: Admin or Producer role required to link objectives');
    err.status = 403;
    throw err;
  }

  const childId = Number(child_objective_id);
  const parentId = Number(parent_objective_id);

  if (childId === parentId) {
    const err = new Error('Child objective cannot be its own parent');
    err.status = 400;
    throw err;
  }

  // Circular chain detection: check if childId is already an ancestor of parentId (A -> B -> C -> A)
  if (wouldCreateCycle(childId, parentId)) {
    const err = new Error(`Circular alignment detected: Objective #${childId} is already an ancestor of #${parentId} (cannot create circular chain A→B→C→A)`);
    err.status = 400;
    throw err;
  }

  const child = queryOne('SELECT id, status, title FROM okr_objectives WHERE id = ?', [childId]);
  if (!child) {
    const err = new Error(`Child objective not found with id: ${child_objective_id}`);
    err.status = 404;
    throw err;
  }

  const parent = queryOne('SELECT id, status, title FROM okr_objectives WHERE id = ?', [parentId]);
  if (!parent) {
    const err = new Error(`Parent objective not found with id: ${parent_objective_id}`);
    err.status = 404;
    throw err;
  }

  if (child.status === 'ARCHIVED' || parent.status === 'ARCHIVED') {
    const err = new Error('Cannot create alignment links involving archived objectives');
    err.status = 400;
    throw err;
  }

  // Check if link already exists
  const existing = queryOne(
    'SELECT * FROM okr_alignment_links WHERE child_objective_id = ? AND parent_objective_id = ?',
    [childId, parentId]
  );
  if (existing) {
    return existing;
  }

  // Insert into append-only okr_alignment_links
  const result = execute(`
    INSERT INTO okr_alignment_links (
      child_objective_id, parent_objective_id, linked_by, linked_at
    ) VALUES (
      ?, ?, ?, datetime('now')
    )
  `, [childId, parentId, user.id]);

  // Update parent_objective_id on child objective
  execute(`
    UPDATE okr_objectives
    SET parent_objective_id = ?, updated_at = datetime('now')
    WHERE id = ?
  `, [parentId, childId]);

  logOkrHistory({
    entityType: 'OBJECTIVE',
    entityId: childId,
    changedBy: user.id,
    fieldChanged: 'alignment_link_added',
    oldValue: null,
    newValue: `Linked to parent Objective #${parentId} (${parent.title})`
  });

  recalculateObjectiveHierarchy(parentId);

  return queryOne('SELECT * FROM okr_alignment_links WHERE id = ?', [Number(result.lastInsertRowid)]);
}

/**
 * 8. Get Alignment Tree for a specific Objective
 * Returns parent chain up to root + all direct and nested child objectives
 */
export function getObjectiveTree(objectiveId, user) {
  if (!user || !user.id) {
    const err = new Error('Unauthorized: User ID required');
    err.status = 401;
    throw err;
  }

  const target = getObjectiveById(objectiveId, user);

  // Traverse upward to find parent chain
  const parentChain = [];
  let currentParentId = target.parent_objective_id;
  const visited = new Set([target.id]);

  while (currentParentId && !visited.has(currentParentId)) {
    visited.add(currentParentId);
    const parent = queryOne(`
      SELECT o.id, o.title, o.level, o.cycle, o.status, o.progress_pct, o.owner_id, o.parent_objective_id,
             u.name as owner_name
      FROM okr_objectives o
      LEFT JOIN users u ON o.owner_id = u.id
      WHERE o.id = ?
    `, [currentParentId]);

    if (!parent) break;
    parentChain.unshift(parent);
    currentParentId = parent.parent_objective_id;
  }

  // Helper to build recursive children
  function fetchChildren(parentId) {
    const children = queryAll(`
      SELECT o.id, o.title, o.level, o.cycle, o.status, o.progress_pct, o.owner_id,
             u.name as owner_name
      FROM okr_objectives o
      LEFT JOIN users u ON o.owner_id = u.id
      WHERE o.parent_objective_id = ?
      ORDER BY o.created_at ASC
    `, [parentId]);

    return children.map(c => ({
      ...c,
      children: fetchChildren(c.id)
    }));
  }

  const childrenTree = fetchChildren(target.id);

  return {
    objective: target,
    parent_chain: parentChain,
    children: childrenTree,
    alignment_links: target.alignment_links || []
  };
}

/**
 * 9. Get Company-wide Alignment Tree for a given cycle
 * Role: Admin+
 */
export function getCompanyAlignmentTree(cycle = 'Q1-2026', user) {
  if (!user || !user.id) {
    const err = new Error('Unauthorized: User ID required');
    err.status = 401;
    throw err;
  }

  if (!isOkrAdmin(user)) {
    const err = new Error('Forbidden: Admin or Producer role required to view full company alignment');
    err.status = 403;
    throw err;
  }

  const allObjectives = queryAll(`
    SELECT o.id, o.title, o.level, o.cycle, o.status, o.progress_pct, o.owner_id, o.parent_objective_id,
           u.name as owner_name, u.role as owner_role
    FROM okr_objectives o
    LEFT JOIN users u ON o.owner_id = u.id
    WHERE o.cycle = ?
    ORDER BY o.level ASC, o.created_at ASC
  `, [cycle]);

  // Map by id
  const objMap = new Map();
  allObjectives.forEach(o => {
    objMap.set(o.id, { ...o, children: [] });
  });

  const rootObjectives = [];

  allObjectives.forEach(o => {
    if (o.parent_objective_id && objMap.has(o.parent_objective_id)) {
      objMap.get(o.parent_objective_id).children.push(objMap.get(o.id));
    } else {
      rootObjectives.push(objMap.get(o.id));
    }
  });

  return {
    cycle,
    total_objectives: allObjectives.length,
    root_objectives: rootObjectives
  };
}

/**
 * 10. Get all individual OKRs for a specific member
 * Role: Admin+ or own user
 */
export function getMemberObjectives(targetUserId, user) {
  if (!user || !user.id) {
    const err = new Error('Unauthorized: User ID required');
    err.status = 401;
    throw err;
  }

  const isAdmin = isOkrAdmin(user);
  if (!isAdmin && user.id !== targetUserId) {
    const err = new Error('Forbidden: You can only view your own individual objectives');
    err.status = 403;
    throw err;
  }

  const rows = queryAll(`
    SELECT 
      o.*,
      u.name as owner_name,
      p.title as project_title,
      po.title as parent_title,
      (SELECT COUNT(*) FROM okr_key_results kr WHERE kr.objective_id = o.id) as kr_count
    FROM okr_objectives o
    LEFT JOIN users u ON o.owner_id = u.id
    LEFT JOIN projects p ON o.project_id = p.id
    LEFT JOIN okr_objectives po ON o.parent_objective_id = po.id
    WHERE o.owner_id = ? AND o.level = 'INDIVIDUAL'
    ORDER BY o.created_at DESC
  `, [targetUserId]);

  return rows;
}

/**
 * 11. Get Change History for an Objective or Key Result
 * Role: Admin+
 */
export function getOkrHistory(entityType, entityId, user) {
  if (!user || !user.id) {
    const err = new Error('Unauthorized: User ID required');
    err.status = 401;
    throw err;
  }

  if (!isOkrAdmin(user)) {
    const err = new Error('Forbidden: Admin or Producer role required to view audit history');
    err.status = 403;
    throw err;
  }

  const rows = queryAll(`
    SELECT 
      h.*,
      u.name as user_name,
      u.email as user_email
    FROM okr_history h
    LEFT JOIN users u ON h.changed_by = u.id
    WHERE h.entity_type = ? AND h.entity_id = ?
    ORDER BY h.changed_at DESC
  `, [entityType.toUpperCase(), Number(entityId)]);

  return rows;
}

/**
 * 12. Create a Key Result
 * Role: Admin+ or objective owner
 */
export function createKeyResult({
  objective_id,
  title,
  description = null,
  type = 'PERCENTAGE',
  target_value = 100,
  unit = null,
  assigned_to = null,
  due_date = null,
  user
}) {
  if (!user || !user.id) {
    const err = new Error('Unauthorized: User ID required');
    err.status = 401;
    throw err;
  }

  if (!objective_id) {
    const err = new Error('objective_id is required');
    err.status = 400;
    throw err;
  }

  const objId = Number(objective_id);
  const parentObj = queryOne('SELECT * FROM okr_objectives WHERE id = ?', [objId]);
  if (!parentObj) {
    const err = new Error(`Parent objective not found with id: ${objective_id}`);
    err.status = 404;
    throw err;
  }

  // Rule 7: Archived Objectives are read-only — no new KRs
  if (parentObj.status === 'ARCHIVED') {
    const err = new Error('Cannot add Key Results to an archived objective');
    err.status = 400;
    throw err;
  }

  // RBAC: Admin+ or objective owner
  const isAdmin = isOkrAdmin(user);
  if (!isAdmin && parentObj.owner_id !== user.id) {
    const err = new Error('Forbidden: Only Admin+ or the Objective owner can add Key Results');
    err.status = 403;
    throw err;
  }

  if (!title || !title.trim()) {
    const err = new Error('Key Result title is required');
    err.status = 400;
    throw err;
  }

  const cleanType = (type || 'PERCENTAGE').toUpperCase();
  if (!['PERCENTAGE', 'NUMBER', 'BOOLEAN', 'MILESTONE'].includes(cleanType)) {
    const err = new Error("Invalid KR type. Must be 'PERCENTAGE', 'NUMBER', 'BOOLEAN', or 'MILESTONE'");
    err.status = 400;
    throw err;
  }

  let finalTargetValue = Number(target_value);
  if (cleanType === 'BOOLEAN') {
    finalTargetValue = 1;
  } else if (cleanType === 'PERCENTAGE' && (target_value === undefined || target_value === null)) {
    finalTargetValue = 100;
  }

  // Rule 4: KR target_value must be > 0 always
  if (isNaN(finalTargetValue) || finalTargetValue <= 0) {
    const err = new Error('Key Result target_value must be greater than 0');
    err.status = 400;
    throw err;
  }

  let finalUnit = unit ? unit.trim() : null;
  if (!finalUnit && cleanType === 'PERCENTAGE') {
    finalUnit = '%';
  }

  let finalAssignedTo = null;
  if (assigned_to) {
    const assignee = queryOne('SELECT id, name FROM users WHERE id = ?', [assigned_to]);
    if (!assignee) {
      const err = new Error(`Assigned user not found with id: ${assigned_to}`);
      err.status = 404;
      throw err;
    }
    finalAssignedTo = assignee.id;
  }

  const result = execute(`
    INSERT INTO okr_key_results (
      objective_id, title, description, type, target_value, current_value, unit, progress_pct, status, assigned_to, due_date, created_by, created_at, updated_at
    ) VALUES (
      ?, ?, ?, ?, ?, 0.0, ?, 0.0, 'ON_TRACK', ?, ?, ?, datetime('now'), datetime('now')
    )
  `, [
    objId,
    title.trim(),
    description ? description.trim() : null,
    cleanType,
    finalTargetValue,
    finalUnit,
    finalAssignedTo,
    due_date ? String(due_date).trim() : null,
    user.id
  ]);

  const krId = Number(result.lastInsertRowid);

  // Auto-log creation in okr_history (Rule 10)
  logOkrHistory({
    entityType: 'KEY_RESULT',
    entityId: krId,
    changedBy: user.id,
    fieldChanged: 'created',
    oldValue: null,
    newValue: title.trim()
  });

  recalculateObjectiveHierarchy(objId);

  return getKeyResultById(krId, user);
}

/**
 * 13. Get Key Result by ID with check-ins
 * Role: All
 */
export function getKeyResultById(krId, user) {
  if (!user || !user.id) {
    const err = new Error('Unauthorized: User ID required');
    err.status = 401;
    throw err;
  }

  const id = Number(krId);
  const kr = queryOne(`
    SELECT 
      kr.*,
      u.name as assignee_name,
      u.email as assignee_email,
      u.role as assignee_role,
      c.name as creator_name,
      o.title as objective_title,
      o.level as objective_level,
      o.owner_id as objective_owner_id,
      o.status as objective_status
    FROM okr_key_results kr
    LEFT JOIN users u ON kr.assigned_to = u.id
    LEFT JOIN users c ON kr.created_by = c.id
    LEFT JOIN okr_objectives o ON kr.objective_id = o.id
    WHERE kr.id = ?
  `, [id]);

  if (!kr) {
    const err = new Error(`Key Result not found with id: ${krId}`);
    err.status = 404;
    throw err;
  }

  // Rule 8 check on parent objective: if individual objective and not owner/admin
  if (kr.objective_level === 'INDIVIDUAL' && kr.objective_owner_id !== user.id && !isOkrAdmin(user)) {
    const err = new Error('Forbidden: You do not have permission to view Key Results for this individual objective');
    err.status = 403;
    throw err;
  }

  const checkins = queryAll(`
    SELECT 
      ch.*,
      u.name as submitter_name,
      u.email as submitter_email
    FROM okr_checkins ch
    LEFT JOIN users u ON ch.submitted_by = u.id
    WHERE ch.key_result_id = ?
    ORDER BY ch.created_at DESC
  `, [id]);

  return {
    ...kr,
    checkins
  };
}

/**
 * 14. Update Key Result
 * Role: Admin+ or KR assignee (or objective owner)
 * Auto-logs to okr_history
 */
export function updateKeyResult(krId, updates = {}, user) {
  if (!user || !user.id) {
    const err = new Error('Unauthorized: User ID required');
    err.status = 401;
    throw err;
  }

  const id = Number(krId);
  const existing = queryOne(`
    SELECT kr.*, o.status as objective_status, o.owner_id as objective_owner_id
    FROM okr_key_results kr
    JOIN okr_objectives o ON kr.objective_id = o.id
    WHERE kr.id = ?
  `, [id]);

  if (!existing) {
    const err = new Error(`Key Result not found with id: ${krId}`);
    err.status = 404;
    throw err;
  }

  // Rule 7: Archived Objectives are read-only
  if (existing.objective_status === 'ARCHIVED') {
    const err = new Error('Parent objective is archived; Key Results cannot be modified');
    err.status = 400;
    throw err;
  }

  // RBAC: Admin+ or KR assignee or objective owner
  const isAdmin = isOkrAdmin(user);
  const isAssignee = existing.assigned_to === user.id;
  const isOwner = existing.objective_owner_id === user.id;

  if (!isAdmin && !isAssignee && !isOwner) {
    const err = new Error('Forbidden: Only Admin+, KR assignee, or Objective owner can update this Key Result');
    err.status = 403;
    throw err;
  }

  const fieldsToUpdate = [];
  const params = [];
  const validFields = ['title', 'description', 'type', 'target_value', 'unit', 'assigned_to', 'due_date', 'status'];

  let newTargetValue = existing.target_value;

  for (const field of validFields) {
    if (updates[field] !== undefined) {
      let newVal = updates[field];
      const oldVal = existing[field];

      if (field === 'title') {
        if (!newVal || !newVal.trim()) {
          const err = new Error('Key Result title cannot be empty');
          err.status = 400;
          throw err;
        }
        newVal = newVal.trim();
      }

      if (field === 'type') {
        newVal = newVal.toUpperCase();
        if (!['PERCENTAGE', 'NUMBER', 'BOOLEAN', 'MILESTONE'].includes(newVal)) {
          const err = new Error("Invalid KR type. Must be 'PERCENTAGE', 'NUMBER', 'BOOLEAN', or 'MILESTONE'");
          err.status = 400;
          throw err;
        }
      }

      if (field === 'target_value') {
        newVal = Number(newVal);
        if (isNaN(newVal) || newVal <= 0) {
          const err = new Error('Key Result target_value must be greater than 0');
          err.status = 400;
          throw err;
        }
        newTargetValue = newVal;
      }

      if (field === 'status') {
        newVal = newVal.toUpperCase();
        if (!['ON_TRACK', 'AT_RISK', 'OFF_TRACK', 'COMPLETED'].includes(newVal)) {
          const err = new Error("Invalid KR status. Must be ON_TRACK, AT_RISK, OFF_TRACK, or COMPLETED");
          err.status = 400;
          throw err;
        }
      }

      if (field === 'assigned_to') {
        if (newVal !== null) {
          const assignee = queryOne('SELECT id FROM users WHERE id = ?', [newVal]);
          if (!assignee) {
            const err = new Error(`Assigned user not found with id: ${newVal}`);
            err.status = 404;
            throw err;
          }
          newVal = assignee.id;
        }
      }

      if (String(newVal) !== String(oldVal)) {
        fieldsToUpdate.push(`${field} = ?`);
        params.push(newVal);

        // Auto-log to okr_history (Rule 10)
        logOkrHistory({
          entityType: 'KEY_RESULT',
          entityId: id,
          changedBy: user.id,
          fieldChanged: field,
          oldValue: oldVal,
          newValue: newVal
        });
      }
    }
  }

  // If target_value changed, recompute progress_pct
  if (updates.target_value !== undefined && newTargetValue > 0) {
    const recomputedPct = Math.min(100.0, Math.max(0.0, (existing.current_value / newTargetValue) * 100));
    fieldsToUpdate.push("progress_pct = ?");
    params.push(recomputedPct);
  }

  if (fieldsToUpdate.length === 0) {
    return getKeyResultById(id, user);
  }

  // Rule 11: updated_at manually updated in service on every PATCH
  fieldsToUpdate.push("updated_at = datetime('now')");
  params.push(id);

  execute(`
    UPDATE okr_key_results
    SET ${fieldsToUpdate.join(', ')}
    WHERE id = ?
  `, params);

  // Recalculate parent objective progress bottom-up if target_value or current_value changed
  if (updates.target_value !== undefined || updates.current_value !== undefined) {
    recalculateObjectiveHierarchy(existing.objective_id);
  }

  return getKeyResultById(id, user);
}

/**
 * 15. Delete Key Result
 * Rule: only if parent objective is DRAFT
 * Role: Admin+
 */
export function deleteKeyResult(krId, user) {
  if (!user || !user.id) {
    const err = new Error('Unauthorized: User ID required');
    err.status = 401;
    throw err;
  }

  if (!isOkrAdmin(user)) {
    const err = new Error('Forbidden: Admin or Producer role required to delete Key Results');
    err.status = 403;
    throw err;
  }

  const id = Number(krId);
  const existing = queryOne(`
    SELECT kr.*, o.status as objective_status
    FROM okr_key_results kr
    JOIN okr_objectives o ON kr.objective_id = o.id
    WHERE kr.id = ?
  `, [id]);

  if (!existing) {
    const err = new Error(`Key Result not found with id: ${krId}`);
    err.status = 404;
    throw err;
  }

  // Rule: only if parent objective is DRAFT
  if (existing.objective_status !== 'DRAFT') {
    const err = new Error('Key Result can only be deleted if its parent objective is in DRAFT status. Archive or update status instead.');
    err.status = 400;
    throw err;
  }

  // Cannot delete if it has check-ins (since okr_checkins is append-only)
  const checkinCount = queryOne('SELECT COUNT(*) as count FROM okr_checkins WHERE key_result_id = ?', [id]);
  if (checkinCount && checkinCount.count > 0) {
    const err = new Error('Key Result cannot be deleted because it has recorded check-ins');
    err.status = 400;
    throw err;
  }

  execute('DELETE FROM okr_key_results WHERE id = ?', [id]);

  // Recalculate parent objective progress bottom-up
  recalculateObjectiveHierarchy(existing.objective_id);

  // Log in history
  logOkrHistory({
    entityType: 'KEY_RESULT',
    entityId: id,
    changedBy: user.id,
    fieldChanged: 'deleted',
    oldValue: existing.title,
    newValue: null
  });

  return {
    success: true,
    message: 'Key Result deleted successfully',
    id
  };
}

/**
 * 16. Recalculate Objective Hierarchy Bottom-Up (Layer 4)
 * Rule 3: Objective progress_pct = average of all its Key Result progress_pct values
 * Rule 4: If Objective has child Objectives (via alignment_links), its progress = weighted average of own KRs + child objective progress
 * Auto-updates status: progress >= 100 -> COMPLETED, progress < 100 on completed -> ACTIVE
 * Propagates automatically up the parent chain (Child -> Mid -> Root)
 */
export function recalculateObjectiveHierarchy(objectiveId, visited = new Set()) {
  const objId = Number(objectiveId);
  if (!objId || isNaN(objId) || visited.has(objId)) return;
  visited.add(objId);

  const objective = queryOne('SELECT id, status, level FROM okr_objectives WHERE id = ?', [objId]);
  if (!objective) return;

  // 1. Fetch own Key Results
  const keyResults = queryAll('SELECT id, progress_pct FROM okr_key_results WHERE objective_id = ?', [objId]);
  const hasKRs = keyResults.length > 0;
  let krAvg = 0;
  if (hasKRs) {
    const krSum = keyResults.reduce((acc, kr) => acc + (Number(kr.progress_pct) || 0), 0);
    krAvg = krSum / keyResults.length;
  }

  // 2. Fetch all child objectives aligned under this objective
  const childObjectives = queryAll(`
    SELECT DISTINCT id, progress_pct FROM okr_objectives 
    WHERE (parent_objective_id = ? OR id IN (SELECT child_objective_id FROM okr_alignment_links WHERE parent_objective_id = ?))
      AND id != ?
      AND status != 'ARCHIVED'
  `, [objId, objId, objId]);
  const hasChildren = childObjectives.length > 0;
  let childAvg = 0;
  if (hasChildren) {
    const childSum = childObjectives.reduce((acc, child) => acc + (Number(child.progress_pct) || 0), 0);
    childAvg = childSum / childObjectives.length;
  }

  // 3. Compute combined progress_pct
  let computedProgress = 0;
  if (hasKRs && hasChildren) {
    // Weighted average of own KRs (50%) + child objectives (50%)
    computedProgress = (krAvg + childAvg) / 2;
  } else if (hasKRs) {
    computedProgress = krAvg;
  } else if (hasChildren) {
    computedProgress = childAvg;
  } else {
    computedProgress = 0;
  }

  const finalProgress = Math.round(Math.min(100.0, Math.max(0.0, computedProgress)) * 100) / 100;

  // Auto status update: if progress >= 100 and status was ACTIVE -> COMPLETED
  let newStatus = objective.status;
  if (finalProgress >= 100 && objective.status === 'ACTIVE') {
    newStatus = 'COMPLETED';
  } else if (finalProgress < 100 && objective.status === 'COMPLETED') {
    newStatus = 'ACTIVE';
  }

  execute(`
    UPDATE okr_objectives
    SET progress_pct = ?, status = ?, updated_at = datetime('now')
    WHERE id = ?
  `, [finalProgress, newStatus, objId]);

  // 4. Propagate up the parent chain
  const parents = queryAll(`
    SELECT DISTINCT parent_id FROM (
      SELECT parent_objective_id as parent_id FROM okr_objectives WHERE id = ? AND parent_objective_id IS NOT NULL
      UNION
      SELECT parent_objective_id as parent_id FROM okr_alignment_links WHERE child_objective_id = ?
    ) WHERE parent_id IS NOT NULL AND parent_id != ?
  `, [objId, objId, objId]);

  for (const p of parents) {
    recalculateObjectiveHierarchy(Number(p.parent_id), visited);
  }
}

/**
 * 17. Submit Check-in on a Key Result (Layer 4)
 * Rule 1: KR progress_pct = (current_value ÷ target_value) × 100 — capped at 100.00
 * Rule 2: BOOLEAN type: current_value = 0 → 0%, current_value = 1 → 100%
 * Rule 5: BOOLEAN KR accepts only 0 or 1 as new_value — service rejects anything else
 * Rule 7: KR status auto-updates:
 *         progress >= 100 -> COMPLETED;
 *         progress < 30 and due_date within 7 days -> OFF_TRACK;
 *         else ON_TRACK or AT_RISK (based on confidence field)
 * Rule 10: Auto-logged to okr_history
 * Bottom-Up Rollup: Automatically recalculates parent Objective progress_pct and propagates up parent chain
 * Role: KR assignee or Admin+ or parent Objective owner
 */
export function submitCheckin({
  key_result_id,
  new_value,
  confidence = 'MEDIUM',
  note = null,
  user
}) {
  if (!user || !user.id) {
    const err = new Error('Unauthorized: User ID required');
    err.status = 401;
    throw err;
  }

  if (!key_result_id) {
    const err = new Error('key_result_id is required');
    err.status = 400;
    throw err;
  }

  const krId = Number(key_result_id);
  const kr = queryOne(`
    SELECT 
      kr.*,
      o.id as obj_id,
      o.title as obj_title,
      o.status as obj_status,
      o.owner_id as obj_owner_id,
      o.level as obj_level,
      o.parent_objective_id
    FROM okr_key_results kr
    JOIN okr_objectives o ON kr.objective_id = o.id
    WHERE kr.id = ?
  `, [krId]);

  if (!kr) {
    const err = new Error(`Key Result not found with id: ${key_result_id}`);
    err.status = 404;
    throw err;
  }

  // Rule 7: Archived Objectives are read-only — no new check-ins
  if (kr.obj_status === 'ARCHIVED') {
    const err = new Error('Parent objective is archived; cannot submit check-ins');
    err.status = 400;
    throw err;
  }

  // RBAC: KR assignee, Admin+, or parent Objective owner
  const isAdmin = isOkrAdmin(user);
  const isAssignee = kr.assigned_to === user.id;
  const isOwner = kr.obj_owner_id === user.id;

  if (!isAdmin && !isAssignee && !isOwner) {
    const err = new Error('Forbidden: Only the assigned member, Objective owner, or Admin+ can submit check-ins');
    err.status = 403;
    throw err;
  }

  if (new_value === undefined || new_value === null || String(new_value).trim() === '' || isNaN(Number(new_value))) {
    const err = new Error('Check-in new_value must be a valid number');
    err.status = 400;
    throw err;
  }

  const numVal = Number(new_value);

  // Rule 5: BOOLEAN KR accepts only 0 or 1 as new_value — service rejects anything else
  if (kr.type === 'BOOLEAN') {
    if (numVal !== 0 && numVal !== 1) {
      const err = new Error('BOOLEAN Key Result accepts only 0 or 1 as new_value');
      err.status = 400;
      throw err;
    }
  } else {
    // Non-negative check
    if (numVal < 0) {
      const err = new Error('Check-in new_value cannot be negative');
      err.status = 400;
      throw err;
    }
  }

  const cleanConfidence = (confidence || 'MEDIUM').toUpperCase();
  if (!['HIGH', 'MEDIUM', 'LOW'].includes(cleanConfidence)) {
    const err = new Error("Invalid confidence. Must be 'HIGH', 'MEDIUM', or 'LOW'");
    err.status = 400;
    throw err;
  }

  const cleanNote = note ? String(note).trim() : null;
  const previousValue = Number(kr.current_value) || 0;

  // 1. Insert into append-only okr_checkins
  const checkinResult = execute(`
    INSERT INTO okr_checkins (
      key_result_id, submitted_by, previous_value, new_value, confidence, note, created_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?, datetime('now')
    )
  `, [
    krId,
    user.id,
    previousValue,
    numVal,
    cleanConfidence,
    cleanNote
  ]);

  const checkinId = Number(checkinResult.lastInsertRowid);

  // 2. Compute KR progress_pct (Rules 1 & 2)
  let krProgress = 0;
  if (kr.type === 'BOOLEAN') {
    krProgress = numVal === 1 ? 100.0 : 0.0;
  } else {
    krProgress = (numVal / kr.target_value) * 100;
  }
  krProgress = Math.round(Math.min(100.0, Math.max(0.0, krProgress)) * 100) / 100;

  // 3. Compute Auto KR status (Rule 7)
  let krStatus = 'ON_TRACK';
  if (krProgress >= 100) {
    krStatus = 'COMPLETED';
  } else {
    const hasDueDate = Boolean(kr.due_date);
    const dueTime = hasDueDate ? new Date(kr.due_date).getTime() : NaN;
    const now = Date.now();
    const isWithin7DaysOrPast = !isNaN(dueTime) && (dueTime - now <= 7 * 24 * 60 * 60 * 1000);

    if (krProgress < 30 && isWithin7DaysOrPast) {
      krStatus = 'OFF_TRACK';
    } else if (cleanConfidence === 'LOW') {
      krStatus = 'AT_RISK';
    } else {
      krStatus = 'ON_TRACK';
    }
  }

  // 4. Update okr_key_results table
  execute(`
    UPDATE okr_key_results
    SET current_value = ?, progress_pct = ?, status = ?, updated_at = datetime('now')
    WHERE id = ?
  `, [numVal, krProgress, krStatus, krId]);

  // 5. Auto-log to okr_history (Rule 10)
  logOkrHistory({
    entityType: 'KEY_RESULT',
    entityId: krId,
    changedBy: user.id,
    fieldChanged: 'checkin_submitted',
    oldValue: `${previousValue}`,
    newValue: `${numVal}`
  });

  // 6. Full bottom-up recalculation chain (KR -> Objective -> parent Objective chain)
  recalculateObjectiveHierarchy(kr.obj_id);

  // 7. Return detailed response
  const updatedKr = getKeyResultById(krId, user);
  const updatedParentObjective = queryOne('SELECT id, title, progress_pct, status FROM okr_objectives WHERE id = ?', [kr.obj_id]);
  const checkinRecord = queryOne(`
    SELECT ch.*, u.name as submitter_name, u.email as submitter_email
    FROM okr_checkins ch
    LEFT JOIN users u ON ch.submitted_by = u.id
    WHERE ch.id = ?
  `, [checkinId]);

  return {
    checkin: checkinRecord,
    key_result: updatedKr,
    parent_objective: updatedParentObjective
  };
}

/**
 * 18. Get all check-ins for a Key Result
 * Role: All (Rule 8: If individual objective, only owner or Admin+)
 */
export function getCheckinsByKrId(krId, user) {
  if (!user || !user.id) {
    const err = new Error('Unauthorized: User ID required');
    err.status = 401;
    throw err;
  }

  const id = Number(krId);
  const kr = queryOne(`
    SELECT kr.*, o.level as objective_level, o.owner_id as objective_owner_id
    FROM okr_key_results kr
    JOIN okr_objectives o ON kr.objective_id = o.id
    WHERE kr.id = ?
  `, [id]);

  if (!kr) {
    const err = new Error(`Key Result not found with id: ${krId}`);
    err.status = 404;
    throw err;
  }

  // Rule 8: If individual objective, only owner or Admin+ can view
  if (kr.objective_level === 'INDIVIDUAL' && kr.objective_owner_id !== user.id && !isOkrAdmin(user)) {
    const err = new Error('Forbidden: You do not have permission to view check-ins for this individual objective');
    err.status = 403;
    throw err;
  }

  const checkins = queryAll(`
    SELECT 
      ch.*,
      u.name as submitter_name,
      u.email as submitter_email,
      u.role as submitter_role
    FROM okr_checkins ch
    LEFT JOIN users u ON ch.submitted_by = u.id
    WHERE ch.key_result_id = ?
    ORDER BY ch.created_at ASC, ch.id ASC
  `, [id]);

  return checkins;
}

/**
 * 19. Get OKR Dashboard summary
 * Role: All (filtered by role)
 */
export function getOkrDashboard(cycle, user) {
  if (!user || !user.id) {
    const err = new Error('Unauthorized: User ID required');
    err.status = 401;
    throw err;
  }

  const targetCycle = cycle || 'Q1-2026';

  // 1. Company Objectives
  const companyObjectives = queryAll(`
    SELECT o.*, u.name as owner_name,
      (SELECT COUNT(*) FROM okr_key_results kr WHERE kr.objective_id = o.id) as kr_count
    FROM okr_objectives o
    LEFT JOIN users u ON o.owner_id = u.id
    WHERE o.level = 'COMPANY' AND o.cycle = ?
    ORDER BY o.created_at DESC
  `, [targetCycle]);

  // 2. Team Objectives
  const teamObjectives = queryAll(`
    SELECT o.*, u.name as owner_name, p.title as project_title,
      (SELECT COUNT(*) FROM okr_key_results kr WHERE kr.objective_id = o.id) as kr_count
    FROM okr_objectives o
    LEFT JOIN users u ON o.owner_id = u.id
    LEFT JOIN projects p ON o.project_id = p.id
    WHERE o.level = 'TEAM' AND o.cycle = ?
    ORDER BY o.created_at DESC
  `, [targetCycle]);

  // 3. My Objectives (INDIVIDUAL level owned by this user)
  const myObjectives = queryAll(`
    SELECT o.*, u.name as owner_name,
      (SELECT COUNT(*) FROM okr_key_results kr WHERE kr.objective_id = o.id) as kr_count
    FROM okr_objectives o
    LEFT JOIN users u ON o.owner_id = u.id
    WHERE o.level = 'INDIVIDUAL' AND o.owner_id = ? AND o.cycle = ?
    ORDER BY o.created_at DESC
  `, [user.id, targetCycle]);

  // Overall company health score (average of all COMPANY level objective progress)
  const companyProgressAvg = companyObjectives.length > 0
    ? Math.round((companyObjectives.reduce((acc, o) => acc + (Number(o.progress_pct) || 0), 0) / companyObjectives.length) * 100) / 100
    : 0;

  const teamProgressAvg = teamObjectives.length > 0
    ? Math.round((teamObjectives.reduce((acc, o) => acc + (Number(o.progress_pct) || 0), 0) / teamObjectives.length) * 100) / 100
    : 0;

  const myProgressAvg = myObjectives.length > 0
    ? Math.round((myObjectives.reduce((acc, o) => acc + (Number(o.progress_pct) || 0), 0) / myObjectives.length) * 100) / 100
    : 0;

  return {
    cycle: targetCycle,
    health_score: companyProgressAvg,
    summary: {
      total_company: companyObjectives.length,
      total_team: teamObjectives.length,
      total_my: myObjectives.length,
      company_progress_avg: companyProgressAvg,
      team_progress_avg: teamProgressAvg,
      my_progress_avg: myProgressAvg
    },
    company_objectives: companyObjectives,
    team_objectives: teamObjectives,
    my_objectives: myObjectives
  };
}
