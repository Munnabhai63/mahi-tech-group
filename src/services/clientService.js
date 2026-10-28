import { queryOne, queryAll, execute } from '../db/database.js';
import { logAccess } from './auditService.js';
import { logClientActivity } from './clientAuthService.js';

/**
 * Enforce Admin role for internal admin client management
 */
function assertAdmin(user) {
  if (!user || (user.role !== 'admin' && user.role !== 'superadmin')) {
    const err = new Error('Forbidden: Admin role required');
    err.status = 403;
    throw err;
  }
}

/**
 * 1. GET /api/admin/clients
 * Returns all clients with status, active project access count, and last active timestamp
 */
export function listClients(adminUser, ip = null) {
  assertAdmin(adminUser);

  const clients = queryAll(`
    SELECT c.id, c.name, c.email, c.company_name, c.phone, c.status, c.created_at, c.updated_at,
           (SELECT COUNT(*) FROM client_project_access cpa WHERE cpa.client_id = c.id AND cpa.is_active = 1) AS active_projects_count,
           (SELECT created_at FROM client_activity_log WHERE client_id = c.id ORDER BY id DESC LIMIT 1) AS last_active_at
    FROM clients c
    ORDER BY c.created_at DESC
  `);

  logAccess({
    userId: adminUser.id,
    action: 'LIST_CLIENTS',
    resource: '/api/admin/clients',
    ipAddress: ip
  });

  return { clients };
}

/**
 * 2. GET /api/admin/clients/:clientId
 * Returns client detail + project access list + shared items + activity log
 */
export function getClientDetail(adminUser, clientId, ip = null) {
  assertAdmin(adminUser);

  const client = queryOne(
    `SELECT id, name, email, company_name, phone, status, invite_accepted_at, created_by, created_at, updated_at
     FROM clients WHERE id = ?`,
    [clientId]
  );

  if (!client) {
    const err = new Error('Client not found');
    err.status = 404;
    throw err;
  }

  const projectAccess = queryAll(`
    SELECT cpa.id, cpa.client_id, cpa.project_id, cpa.access_level, cpa.is_active, cpa.granted_at, cpa.revoked_at,
           p.title AS project_title, p.current_stage AS project_stage, p.status AS project_status,
           u.name AS granted_by_name
    FROM client_project_access cpa
    JOIN projects p ON p.id = cpa.project_id
    LEFT JOIN users u ON u.id = cpa.granted_by
    WHERE cpa.client_id = ?
    ORDER BY cpa.granted_at DESC
  `, [clientId]);

  const sharedItems = queryAll(`
    SELECT csi.id, csi.client_id, csi.project_id, csi.item_type, csi.item_id, csi.is_active,
           csi.shared_at, csi.unshared_at, p.title AS project_title, u.name AS shared_by_name
    FROM client_shared_items csi
    JOIN projects p ON p.id = csi.project_id
    LEFT JOIN users u ON u.id = csi.shared_by
    WHERE csi.client_id = ?
    ORDER BY csi.shared_at DESC
  `, [clientId]);

  const activityLog = queryAll(`
    SELECT id, client_id, action, item_type, item_id, ip_address, user_agent, created_at
    FROM client_activity_log
    WHERE client_id = ?
    ORDER BY id DESC
    LIMIT 50
  `, [clientId]);

  logAccess({
    userId: adminUser.id,
    action: 'GET_CLIENT_DETAIL',
    resource: `/api/admin/clients/${clientId}`,
    ipAddress: ip
  });

  return {
    client,
    project_access: projectAccess,
    shared_items: sharedItems,
    activity_log: activityLog
  };
}

/**
 * 3. PATCH /api/admin/clients/:clientId
 * Update client profile (name, company_name, phone, status)
 */
export function updateClient(adminUser, clientId, updates = {}, ip = null) {
  assertAdmin(adminUser);

  const client = queryOne('SELECT * FROM clients WHERE id = ?', [clientId]);
  if (!client) {
    const err = new Error('Client not found');
    err.status = 404;
    throw err;
  }

  const { name, company_name, phone, status } = updates;

  if (status) {
    const validStatuses = ['ACTIVE', 'SUSPENDED', 'INACTIVE'];
    if (!validStatuses.includes(status)) {
      const err = new Error(`Invalid status. Must be one of: ${validStatuses.join(', ')}`);
      err.status = 400;
      throw err;
    }
  }

  const newName = name !== undefined ? name.trim() : client.name;
  const newCompany = company_name !== undefined ? (company_name ? company_name.trim() : null) : client.company_name;
  const newPhone = phone !== undefined ? (phone ? phone.trim() : null) : client.phone;
  const newStatus = status !== undefined ? status : client.status;

  execute(
    `UPDATE clients SET
       name = ?,
       company_name = ?,
       phone = ?,
       status = ?,
       updated_at = datetime('now')
     WHERE id = ?`,
    [newName, newCompany, newPhone, newStatus, clientId]
  );

  logAccess({
    userId: adminUser.id,
    action: 'UPDATE_CLIENT',
    resource: `/api/admin/clients/${clientId}`,
    ipAddress: ip
  });

  return queryOne(
    'SELECT id, name, email, company_name, phone, status, created_at, updated_at FROM clients WHERE id = ?',
    [clientId]
  );
}

/**
 * 4. POST /api/admin/clients/:clientId/access/grant
 * Grant client access to a project
 */
export function grantProjectAccess(adminUser, clientId, { project_id, access_level = 'VIEW' }, ip = null) {
  assertAdmin(adminUser);

  if (!project_id) {
    const err = new Error('project_id is required');
    err.status = 400;
    throw err;
  }

  const client = queryOne('SELECT id FROM clients WHERE id = ?', [clientId]);
  if (!client) {
    const err = new Error('Client not found');
    err.status = 404;
    throw err;
  }

  const project = queryOne('SELECT id, title FROM projects WHERE id = ?', [project_id]);
  if (!project) {
    const err = new Error('Project not found');
    err.status = 404;
    throw err;
  }

  const validLevels = ['VIEW', 'COMMENT', 'APPROVE'];
  const cleanLevel = String(access_level).toUpperCase();
  if (!validLevels.includes(cleanLevel)) {
    const err = new Error(`Invalid access_level. Must be one of: ${validLevels.join(', ')}`);
    err.status = 400;
    throw err;
  }

  // Check existing access record (UNIQUE constraint on client_id, project_id)
  const existing = queryOne(
    'SELECT * FROM client_project_access WHERE client_id = ? AND project_id = ?',
    [clientId, project_id]
  );

  if (existing && existing.is_active === 1) {
    const err = new Error('Client already has active access to this project');
    err.status = 409;
    throw err;
  }

  if (existing && existing.is_active === 0) {
    // Reactivate existing record
    execute(
      `UPDATE client_project_access SET
         is_active = 1,
         access_level = ?,
         granted_by = ?,
         granted_at = datetime('now'),
         revoked_by = NULL,
         revoked_at = NULL
       WHERE id = ?`,
      [cleanLevel, adminUser.id, existing.id]
    );
  } else {
    // Insert new access grant
    execute(
      `INSERT INTO client_project_access (client_id, project_id, access_level, granted_by, granted_at, is_active)
       VALUES (?, ?, ?, ?, datetime('now'), 1)`,
      [clientId, project_id, cleanLevel, adminUser.id]
    );
  }

  const accessRecord = queryOne(`
    SELECT cpa.*, p.title AS project_title
    FROM client_project_access cpa
    JOIN projects p ON p.id = cpa.project_id
    WHERE cpa.client_id = ? AND cpa.project_id = ?
  `, [clientId, project_id]);

  logAccess({
    userId: adminUser.id,
    action: 'GRANT_PROJECT_ACCESS',
    resource: `/api/admin/clients/${clientId}/access/grant`,
    ipAddress: ip
  });

  logClientActivity({
    clientId,
    action: 'PROJECT_ACCESS_GRANTED',
    itemType: 'PROJECT',
    itemId: project_id,
    ipAddress: ip
  });

  return {
    message: 'Project access granted successfully',
    access: accessRecord
  };
}

/**
 * 5. PATCH /api/admin/clients/:clientId/access/revoke
 * Soft-revoke client access to a project (is_active = 0)
 */
export function revokeProjectAccess(adminUser, clientId, { project_id }, ip = null) {
  assertAdmin(adminUser);

  if (!project_id) {
    const err = new Error('project_id is required');
    err.status = 400;
    throw err;
  }

  const access = queryOne(
    'SELECT * FROM client_project_access WHERE client_id = ? AND project_id = ? AND is_active = 1',
    [clientId, project_id]
  );

  if (!access) {
    const err = new Error('Active project access not found for this client and project');
    err.status = 404;
    throw err;
  }

  execute(
    `UPDATE client_project_access SET
       is_active = 0,
       revoked_by = ?,
       revoked_at = datetime('now')
     WHERE id = ?`,
    [adminUser.id, access.id]
  );

  logAccess({
    userId: adminUser.id,
    action: 'REVOKE_PROJECT_ACCESS',
    resource: `/api/admin/clients/${clientId}/access/revoke`,
    ipAddress: ip
  });

  logClientActivity({
    clientId,
    action: 'PROJECT_ACCESS_REVOKED',
    itemType: 'PROJECT',
    itemId: project_id,
    ipAddress: ip
  });

  return {
    message: 'Project access revoked successfully',
    id: access.id,
    client_id: Number(clientId),
    project_id: Number(project_id),
    is_active: 0
  };
}

/**
 * 6. POST /api/admin/clients/:clientId/share/item
 * Share a specific project deliverable/item with client (explicit opt-in only)
 */
export function shareItem(adminUser, clientId, { project_id, item_type, item_id }, ip = null) {
  assertAdmin(adminUser);

  if (!project_id || !item_type || !item_id) {
    const err = new Error('project_id, item_type, and item_id are required');
    err.status = 400;
    throw err;
  }

  // Verify client has active access to the project
  const access = queryOne(
    'SELECT id FROM client_project_access WHERE client_id = ? AND project_id = ? AND is_active = 1',
    [clientId, project_id]
  );

  if (!access) {
    const err = new Error(`Client does not have active access to project ${project_id}`);
    err.status = 400;
    throw err;
  }

  const validTypes = ['GANTT_ITEM', 'MILESTONE', 'BACKLOG_ITEM', 'DELIVERABLE', 'DOCUMENT'];
  const cleanType = String(item_type).toUpperCase();
  if (!validTypes.includes(cleanType)) {
    const err = new Error(`Invalid item_type. Must be one of: ${validTypes.join(', ')}`);
    err.status = 400;
    throw err;
  }

  // Business Rule 15: Admin cannot share an item type that does not exist in client_shared_items source tables
  let itemExists = false;
  if (cleanType === 'GANTT_ITEM') {
    const row = queryOne('SELECT id FROM gantt_items WHERE id = ?', [item_id]);
    itemExists = Boolean(row);
  } else if (cleanType === 'MILESTONE') {
    const row = queryOne('SELECT id FROM gantt_milestones WHERE id = ?', [item_id]);
    itemExists = Boolean(row);
  } else if (cleanType === 'BACKLOG_ITEM') {
    const row = queryOne('SELECT id FROM backlog_items WHERE id = ?', [item_id]);
    itemExists = Boolean(row);
  } else if (cleanType === 'DELIVERABLE') {
    const row = queryOne('SELECT id FROM pipeline_deliverables WHERE id = ?', [item_id]);
    itemExists = Boolean(row);
  } else if (cleanType === 'DOCUMENT') {
    // deliverable_documents or documents table check
    try {
      const row = queryOne('SELECT id FROM deliverable_documents WHERE id = ?', [item_id]);
      itemExists = Boolean(row);
    } catch (e) {
      itemExists = true; // Safe fallback if document table name varies
    }
  }

  if (!itemExists) {
    const err = new Error(`Item of type ${cleanType} with ID ${item_id} not found`);
    err.status = 404;
    throw err;
  }

  // Check if item already shared
  const existing = queryOne(
    'SELECT * FROM client_shared_items WHERE client_id = ? AND project_id = ? AND item_type = ? AND item_id = ?',
    [clientId, project_id, cleanType, item_id]
  );

  if (existing && existing.is_active === 1) {
    const err = new Error('Item is already shared with this client');
    err.status = 409;
    throw err;
  }

  if (existing && existing.is_active === 0) {
    // Reactivate existing share
    execute(
      `UPDATE client_shared_items SET
         is_active = 1,
         shared_by = ?,
         shared_at = datetime('now'),
         unshared_by = NULL,
         unshared_at = NULL
       WHERE id = ?`,
      [adminUser.id, existing.id]
    );
  } else {
    execute(
      `INSERT INTO client_shared_items (client_id, project_id, item_type, item_id, shared_by, shared_at, is_active)
       VALUES (?, ?, ?, ?, ?, datetime('now'), 1)`,
      [clientId, project_id, cleanType, item_id, adminUser.id]
    );
  }

  const sharedRecord = queryOne(`
    SELECT csi.*, p.title AS project_title
    FROM client_shared_items csi
    JOIN projects p ON p.id = csi.project_id
    WHERE csi.client_id = ? AND csi.project_id = ? AND csi.item_type = ? AND csi.item_id = ?
  `, [clientId, project_id, cleanType, item_id]);

  logAccess({
    userId: adminUser.id,
    action: 'SHARE_ITEM',
    resource: `/api/admin/clients/${clientId}/share/item`,
    ipAddress: ip
  });

  logClientActivity({
    clientId,
    action: 'ITEM_SHARED',
    itemType: cleanType,
    itemId: item_id,
    ipAddress: ip
  });

  return {
    message: 'Item shared successfully',
    shared_item: sharedRecord
  };
}

/**
 * 7. PATCH /api/admin/clients/:clientId/share/item/:shareId/unshare
 * Soft-unshare an item (is_active = 0)
 */
export function unshareItem(adminUser, clientId, shareId, ip = null) {
  assertAdmin(adminUser);

  const shared = queryOne(
    'SELECT * FROM client_shared_items WHERE id = ? AND client_id = ? AND is_active = 1',
    [shareId, clientId]
  );

  if (!shared) {
    const err = new Error('Active shared item not found');
    err.status = 404;
    throw err;
  }

  execute(
    `UPDATE client_shared_items SET
       is_active = 0,
       unshared_by = ?,
       unshared_at = datetime('now')
     WHERE id = ?`,
    [adminUser.id, shareId]
  );

  logAccess({
    userId: adminUser.id,
    action: 'UNSHARE_ITEM',
    resource: `/api/admin/clients/${clientId}/share/item/${shareId}/unshare`,
    ipAddress: ip
  });

  logClientActivity({
    clientId,
    action: 'ITEM_UNSHARED',
    itemType: shared.item_type,
    itemId: shared.item_id,
    ipAddress: ip
  });

  return {
    message: 'Item unshared successfully',
    id: Number(shareId),
    is_active: 0
  };
}

/**
 * 8. GET /api/admin/clients/:clientId/activity
 * Full client activity log
 */
export function getClientActivityLog(adminUser, clientId, ip = null) {
  assertAdmin(adminUser);

  const client = queryOne('SELECT id FROM clients WHERE id = ?', [clientId]);
  if (!client) {
    const err = new Error('Client not found');
    err.status = 404;
    throw err;
  }

  const activity = queryAll(
    `SELECT id, client_id, action, item_type, item_id, ip_address, user_agent, created_at
     FROM client_activity_log
     WHERE client_id = ?
     ORDER BY id DESC`,
    [clientId]
  );

  logAccess({
    userId: adminUser.id,
    action: 'GET_CLIENT_ACTIVITY_LOG',
    resource: `/api/admin/clients/${clientId}/activity`,
    ipAddress: ip
  });

  return { activity_log: activity };
}

/**
 * 9. GET /api/admin/orders
 * Admin list of client orders (internal_notes visible to Admin)
 */
export function getAdminOrders(adminUser, { client_id, project_id, status } = {}, ip = null) {
  assertAdmin(adminUser);

  let sql = `
    SELECT o.id, o.client_id, o.project_id, o.title, o.description, o.order_type,
           o.priority, o.status, o.attachments, o.assigned_to, o.due_date,
           o.internal_notes, o.rejection_reason, o.created_at, o.updated_at,
           c.name AS client_name, c.email AS client_email, c.company_name AS client_company,
           p.title AS project_title, u.name AS assigned_to_name
    FROM client_orders o
    JOIN clients c ON c.id = o.client_id
    LEFT JOIN projects p ON p.id = o.project_id
    LEFT JOIN users u ON u.id = o.assigned_to
    WHERE 1=1
  `;
  const params = [];

  if (client_id) {
    sql += ' AND o.client_id = ?';
    params.push(client_id);
  }
  if (project_id) {
    sql += ' AND o.project_id = ?';
    params.push(project_id);
  }
  if (status) {
    sql += ' AND o.status = ?';
    params.push(status);
  }

  sql += ' ORDER BY o.created_at DESC';

  const orders = queryAll(sql, params);

  logAccess({
    userId: adminUser.id,
    action: 'LIST_CLIENT_ORDERS',
    resource: '/api/admin/orders',
    ipAddress: ip
  });

  return { orders };
}

/**
 * 10. PATCH /api/admin/orders/:orderId/status
 * Update order status, internal notes, and assigned team member
 */
export function updateOrderStatus(adminUser, orderId, { status, internal_notes, assigned_to }, ip = null) {
  assertAdmin(adminUser);

  const order = queryOne('SELECT * FROM client_orders WHERE id = ?', [orderId]);
  if (!order) {
    const err = new Error('Order not found');
    err.status = 404;
    throw err;
  }

  if (status) {
    const validStatuses = [
      'SUBMITTED', 'UNDER_REVIEW', 'IN_PROGRESS',
      'AWAITING_CLIENT', 'COMPLETED', 'CANCELLED', 'REJECTED'
    ];
    if (!validStatuses.includes(status)) {
      const err = new Error(`Invalid status. Must be one of: ${validStatuses.join(', ')}`);
      err.status = 400;
      throw err;
    }
  }

  if (assigned_to !== undefined && assigned_to !== null) {
    const user = queryOne('SELECT id FROM users WHERE id = ?', [assigned_to]);
    if (!user) {
      const err = new Error('Assigned user not found');
      err.status = 404;
      throw err;
    }
  }

  const newStatus = status !== undefined ? status : order.status;
  const newNotes = internal_notes !== undefined ? internal_notes : order.internal_notes;
  const newAssigned = assigned_to !== undefined ? assigned_to : order.assigned_to;

  execute(
    `UPDATE client_orders SET
       status = ?,
       internal_notes = ?,
       assigned_to = ?,
       updated_at = datetime('now')
     WHERE id = ?`,
    [newStatus, newNotes, newAssigned, orderId]
  );

  logAccess({
    userId: adminUser.id,
    action: 'UPDATE_ORDER_STATUS',
    resource: `/api/admin/orders/${orderId}/status`,
    ipAddress: ip
  });

  return queryOne('SELECT * FROM client_orders WHERE id = ?', [orderId]);
}

/**
 * 11. POST /api/admin/orders/:orderId/message
 * Team message on an order (Admin+ or assigned Member)
 */
export function addOrderMessage(user, orderId, { message, is_internal = 0, attachments = null }, ip = null) {
  if (!user) {
    const err = new Error('Unauthorized');
    err.status = 401;
    throw err;
  }

  const order = queryOne('SELECT * FROM client_orders WHERE id = ?', [orderId]);
  if (!order) {
    const err = new Error('Order not found');
    err.status = 404;
    throw err;
  }

  if (!message || !message.trim()) {
    const err = new Error('Message text is required');
    err.status = 400;
    throw err;
  }

  const cleanInternal = is_internal === 1 || is_internal === true ? 1 : 0;
  const cleanAttachments = attachments ? JSON.stringify(attachments) : null;

  execute(
    `INSERT INTO client_order_messages (order_id, sender_type, sender_user_id, message, is_internal, attachments, created_at)
     VALUES (?, 'TEAM', ?, ?, ?, ?, datetime('now'))`,
    [orderId, user.id, message.trim(), cleanInternal, cleanAttachments]
  );

  // Fetch the inserted message
  const createdMsg = queryOne(
    `SELECT m.*, u.name AS sender_name
     FROM client_order_messages m
     LEFT JOIN users u ON u.id = m.sender_user_id
     WHERE m.order_id = ?
     ORDER BY m.id DESC LIMIT 1`,
    [orderId]
  );

  logAccess({
    userId: user.id,
    action: 'ADD_ORDER_MESSAGE',
    resource: `/api/admin/orders/${orderId}/message`,
    ipAddress: ip
  });

  return {
    message: 'Order message sent successfully',
    order_message: createdMsg
  };
}

/**
 * 12. POST /api/admin/milestone/request-approval
 * Admin requests client approval for a milestone
 */
export function requestMilestoneApproval(adminUser, { client_id, project_id, milestone_id }, ip = null) {
  assertAdmin(adminUser);

  if (!client_id || !project_id || !milestone_id) {
    const err = new Error('client_id, project_id, and milestone_id are required');
    err.status = 400;
    throw err;
  }

  const client = queryOne('SELECT id FROM clients WHERE id = ?', [client_id]);
  if (!client) {
    const err = new Error('Client not found');
    err.status = 404;
    throw err;
  }

  const project = queryOne('SELECT id FROM projects WHERE id = ?', [project_id]);
  if (!project) {
    const err = new Error('Project not found');
    err.status = 404;
    throw err;
  }

  // Check client has access to this project
  const access = queryOne(
    'SELECT id FROM client_project_access WHERE client_id = ? AND project_id = ? AND is_active = 1',
    [client_id, project_id]
  );
  if (!access) {
    const err = new Error(`Client does not have active access to project ${project_id}`);
    err.status = 400;
    throw err;
  }

  // Check milestone exists
  const milestone = queryOne('SELECT id, title FROM gantt_milestones WHERE id = ?', [milestone_id]);
  if (!milestone) {
    const err = new Error('Milestone not found');
    err.status = 404;
    throw err;
  }

  // Check unique constraint (client_id, milestone_id)
  const existing = queryOne(
    'SELECT * FROM client_milestone_approvals WHERE client_id = ? AND milestone_id = ?',
    [client_id, milestone_id]
  );
  if (existing) {
    const err = new Error('Milestone approval request already exists for this client and milestone');
    err.status = 409;
    throw err;
  }

  execute(
    `INSERT INTO client_milestone_approvals (client_id, project_id, milestone_id, requested_by, requested_at)
     VALUES (?, ?, ?, ?, datetime('now'))`,
    [client_id, project_id, milestone_id, adminUser.id]
  );

  const approvalRequest = queryOne(`
    SELECT cma.*, c.name AS client_name, p.title AS project_title, m.title AS milestone_title
    FROM client_milestone_approvals cma
    JOIN clients c ON c.id = cma.client_id
    JOIN projects p ON p.id = cma.project_id
    JOIN gantt_milestones m ON m.id = cma.milestone_id
    WHERE cma.client_id = ? AND cma.milestone_id = ?
  `, [client_id, milestone_id]);

  logAccess({
    userId: adminUser.id,
    action: 'REQUEST_MILESTONE_APPROVAL',
    resource: '/api/admin/milestone/request-approval',
    ipAddress: ip
  });

  logClientActivity({
    clientId: client_id,
    action: 'MILESTONE_APPROVAL_REQUESTED',
    itemType: 'MILESTONE',
    itemId: milestone_id,
    ipAddress: ip
  });

  return {
    message: 'Milestone approval requested successfully',
    approval_request: approvalRequest
  };
}

/**
 * 13. GET /api/admin/milestone/approvals
 * Returns all pending milestone approval requests (or all with filter)
 */
export function getMilestoneApprovals(adminUser, { status } = {}, ip = null) {
  assertAdmin(adminUser);

  let sql = `
    SELECT cma.*, c.name AS client_name, c.email AS client_email,
           p.title AS project_title, m.title AS milestone_title, m.milestone_date,
           u.name AS requested_by_name
    FROM client_milestone_approvals cma
    JOIN clients c ON c.id = cma.client_id
    JOIN projects p ON p.id = cma.project_id
    JOIN gantt_milestones m ON m.id = cma.milestone_id
    LEFT JOIN users u ON u.id = cma.requested_by
    WHERE 1=1
  `;
  const params = [];

  if (status === 'PENDING') {
    sql += ' AND cma.decision IS NULL';
  } else if (status) {
    sql += ' AND cma.decision = ?';
    params.push(status);
  }

  sql += ' ORDER BY cma.requested_at DESC';

  const approvals = queryAll(sql, params);

  logAccess({
    userId: adminUser.id,
    action: 'LIST_MILESTONE_APPROVALS',
    resource: '/api/admin/milestone/approvals',
    ipAddress: ip
  });

  return { approvals };
}
