import { queryOne, queryAll, execute } from '../db/database.js';
import { logClientActivity } from './clientAuthService.js';

/**
 * 1. GET /api/client/projects
 * Returns all projects client has active access to (no internal data)
 */
export function getClientProjects(client, ip = null, userAgent = null) {
  if (!client || !client.id) {
    const err = new Error('Unauthorized: Client session required');
    err.status = 401;
    throw err;
  }

  const projects = queryAll(`
    SELECT p.id, p.title, p.current_stage, p.status, p.created_at,
           cpa.access_level, cpa.granted_at
    FROM projects p
    JOIN client_project_access cpa ON cpa.project_id = p.id AND cpa.client_id = ? AND cpa.is_active = 1
    ORDER BY cpa.granted_at DESC
  `, [client.id]);

  logClientActivity({
    clientId: client.id,
    action: 'VIEW_PROJECT',
    itemType: 'PROJECT_LIST',
    ipAddress: ip,
    userAgent
  });

  return { projects };
}

/**
 * 2. GET /api/client/project/:projectId/overview
 * Returns project overview with shared milestones, shared gantt items, and shared backlog items
 * ONLY items in client_shared_items (is_active=1) are returned
 */
export function getClientProjectOverview(client, projectId, ip = null, userAgent = null) {
  if (!client || !client.id) {
    const err = new Error('Unauthorized: Client session required');
    err.status = 401;
    throw err;
  }

  // Mandatory Guard: Client must have active access to this project
  const access = queryOne(
    'SELECT access_level, is_active FROM client_project_access WHERE client_id = ? AND project_id = ? AND is_active = 1',
    [client.id, projectId]
  );

  if (!access) {
    const err = new Error('Forbidden: Access to this project is not granted or has been revoked');
    err.status = 403;
    throw err;
  }

  // Project record (sanitized: no internal financials, no internal revenue metrics)
  const project = queryOne(
    'SELECT id, title, current_stage, status, created_at FROM projects WHERE id = ?',
    [projectId]
  );

  if (!project) {
    const err = new Error('Project not found');
    err.status = 404;
    throw err;
  }

  // Shared milestones + approval status
  const sharedMilestones = queryAll(`
    SELECT m.id, m.project_id, m.title, m.milestone_date, m.status, m.achieved_at,
           cma.id AS approval_id, cma.decision, cma.decision_note, cma.requested_at, cma.decided_at
    FROM gantt_milestones m
    JOIN client_shared_items csi ON csi.item_id = m.id AND csi.item_type = 'MILESTONE' AND csi.client_id = ? AND csi.is_active = 1
    LEFT JOIN client_milestone_approvals cma ON cma.milestone_id = m.id AND cma.client_id = ?
    WHERE m.project_id = ?
    ORDER BY m.milestone_date ASC
  `, [client.id, client.id, projectId]);

  // Shared gantt items
  const sharedGanttItems = queryAll(`
    SELECT g.id, g.project_id, g.title, g.description, g.type, g.start_date, g.end_date, g.progress_pct, g.status
    FROM gantt_items g
    JOIN client_shared_items csi ON csi.item_id = g.id AND csi.item_type IN ('GANTT_ITEM', 'GANTT_VIEW') AND csi.client_id = ? AND csi.is_active = 1
    WHERE g.project_id = ?
    ORDER BY g.start_date ASC
  `, [client.id, projectId]);

  // Shared backlog items
  const sharedBacklogItems = queryAll(`
    SELECT b.id, b.project_id, b.title, b.description, b.status, b.priority
    FROM backlog_items b
    JOIN client_shared_items csi ON csi.item_id = b.id AND csi.item_type = 'BACKLOG_ITEM' AND csi.client_id = ? AND csi.is_active = 1
    WHERE b.project_id = ?
    ORDER BY b.id ASC
  `, [client.id, projectId]);

  // Other shared deliverables / documents
  const sharedDeliverables = queryAll(`
    SELECT csi.id AS shared_item_id, csi.item_type, csi.item_id, csi.shared_at
    FROM client_shared_items csi
    WHERE csi.client_id = ? AND csi.project_id = ? AND csi.is_active = 1 AND csi.item_type IN ('DELIVERABLE', 'DOCUMENT')
    ORDER BY csi.shared_at DESC
  `, [client.id, projectId]);

  logClientActivity({
    clientId: client.id,
    action: 'VIEW_PROJECT',
    itemType: 'PROJECT',
    itemId: projectId,
    ipAddress: ip,
    userAgent
  });

  return {
    project,
    access_level: access.access_level,
    shared_milestones: sharedMilestones,
    shared_gantt_items: sharedGanttItems,
    shared_backlog_items: sharedBacklogItems,
    shared_deliverables: sharedDeliverables
  };
}

/**
 * 3. GET /api/client/project/:projectId/timeline
 * Returns shared gantt items only (no internal items)
 */
export function getClientProjectTimeline(client, projectId, ip = null, userAgent = null) {
  if (!client || !client.id) {
    const err = new Error('Unauthorized: Client session required');
    err.status = 401;
    throw err;
  }

  // Mandatory Guard: Client must have active access to this project
  const access = queryOne(
    'SELECT access_level FROM client_project_access WHERE client_id = ? AND project_id = ? AND is_active = 1',
    [client.id, projectId]
  );

  if (!access) {
    const err = new Error('Forbidden: Access to this project is not granted or has been revoked');
    err.status = 403;
    throw err;
  }

  // Shared gantt items only
  const timelineItems = queryAll(`
    SELECT g.id, g.project_id, g.title, g.description, g.type, g.start_date, g.end_date, g.progress_pct, g.status
    FROM gantt_items g
    JOIN client_shared_items csi ON csi.item_id = g.id AND csi.item_type IN ('GANTT_ITEM', 'GANTT_VIEW') AND csi.client_id = ? AND csi.is_active = 1
    WHERE g.project_id = ?
    ORDER BY g.start_date ASC, g.id ASC
  `, [client.id, projectId]);

  logClientActivity({
    clientId: client.id,
    action: 'VIEW_PROJECT',
    itemType: 'PROJECT_TIMELINE',
    itemId: projectId,
    ipAddress: ip,
    userAgent
  });

  return {
    project_id: projectId,
    timeline_items: timelineItems
  };
}

/**
 * 4. GET /api/client/project/:projectId/milestones
 * Returns shared milestones + approval status
 */
export function getClientProjectMilestones(client, projectId, ip = null, userAgent = null) {
  if (!client || !client.id) {
    const err = new Error('Unauthorized: Client session required');
    err.status = 401;
    throw err;
  }

  // Mandatory Guard: Client must have active access to this project
  const access = queryOne(
    'SELECT access_level FROM client_project_access WHERE client_id = ? AND project_id = ? AND is_active = 1',
    [client.id, projectId]
  );

  if (!access) {
    const err = new Error('Forbidden: Access to this project is not granted or has been revoked');
    err.status = 403;
    throw err;
  }

  // Shared milestones + approval status
  const milestones = queryAll(`
    SELECT m.id, m.project_id, m.title, m.milestone_date, m.status, m.achieved_at,
           cma.id AS approval_id, cma.decision, cma.decision_note, cma.requested_at, cma.decided_at
    FROM gantt_milestones m
    JOIN client_shared_items csi ON csi.item_id = m.id AND csi.item_type = 'MILESTONE' AND csi.client_id = ? AND csi.is_active = 1
    LEFT JOIN client_milestone_approvals cma ON cma.milestone_id = m.id AND cma.client_id = ?
    WHERE m.project_id = ?
    ORDER BY m.milestone_date ASC, m.id ASC
  `, [client.id, client.id, projectId]);

  logClientActivity({
    clientId: client.id,
    action: 'VIEW_PROJECT',
    itemType: 'PROJECT_MILESTONES',
    itemId: projectId,
    ipAddress: ip,
    userAgent
  });

  return {
    project_id: projectId,
    milestones
  };
}

/**
 * 5. POST /api/client/orders/submit
 * Submits a new client request/order
 * Body: { project_id, title, description, order_type, priority, attachments }
 */
export function submitClientOrder(client, data, ip = null, userAgent = null) {
  if (!client || !client.id) {
    const err = new Error('Unauthorized: Client session required');
    err.status = 401;
    throw err;
  }

  const { project_id = null, title, description, order_type = 'NEW_REQUEST', priority = 'MEDIUM', attachments = null } = data || {};

  if (!title || typeof title !== 'string' || !title.trim()) {
    const err = new Error('Order title is required');
    err.status = 400;
    throw err;
  }

  if (!description || typeof description !== 'string' || !description.trim()) {
    const err = new Error('Order description is required');
    err.status = 400;
    throw err;
  }

  // If project_id provided, verify active project access
  if (project_id) {
    const access = queryOne(
      'SELECT id FROM client_project_access WHERE client_id = ? AND project_id = ? AND is_active = 1',
      [client.id, project_id]
    );
    if (!access) {
      const err = new Error('Forbidden: Access to this project is not granted or has been revoked');
      err.status = 403;
      throw err;
    }
  }

  const validTypes = ['NEW_REQUEST', 'CHANGE_REQUEST', 'BUG_REPORT', 'FEEDBACK', 'APPROVAL_REQUEST'];
  if (order_type && !validTypes.includes(order_type)) {
    const err = new Error(`Invalid order_type. Must be one of: ${validTypes.join(', ')}`);
    err.status = 400;
    throw err;
  }

  const validPriorities = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];
  if (priority && !validPriorities.includes(priority)) {
    const err = new Error(`Invalid priority. Must be one of: ${validPriorities.join(', ')}`);
    err.status = 400;
    throw err;
  }

  const attachmentsStr = attachments
    ? (typeof attachments === 'string' ? attachments : JSON.stringify(attachments))
    : null;

  execute(`
    INSERT INTO client_orders (client_id, project_id, title, description, order_type, priority, status, attachments, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'SUBMITTED', ?, datetime('now'), datetime('now'))
  `, [client.id, project_id, title.trim(), description.trim(), order_type, priority, attachmentsStr]);

  const newOrder = queryOne(`
    SELECT id, client_id, project_id, title, description, order_type, priority, status, attachments, due_date, rejection_reason, created_at, updated_at
    FROM client_orders
    WHERE client_id = ?
    ORDER BY id DESC LIMIT 1
  `, [client.id]);

  // Mandatory Security Rule: internal_notes must NEVER be returned in any shape
  if (newOrder && 'internal_notes' in newOrder) {
    delete newOrder.internal_notes;
  }

  logClientActivity({
    clientId: client.id,
    action: 'SUBMIT_ORDER',
    itemType: 'ORDER',
    itemId: newOrder.id,
    ipAddress: ip,
    userAgent
  });

  return {
    message: 'Order submitted successfully',
    order: newOrder
  };
}

/**
 * 6. GET /api/client/orders
 * Returns own orders (no internal_notes field ever)
 */
export function getClientOrders(client, ip = null, userAgent = null) {
  if (!client || !client.id) {
    const err = new Error('Unauthorized: Client session required');
    err.status = 401;
    throw err;
  }

  // Explicitly exclude internal_notes from query
  const orders = queryAll(`
    SELECT id, client_id, project_id, title, description, order_type, priority, status, attachments, due_date, rejection_reason, created_at, updated_at
    FROM client_orders
    WHERE client_id = ?
    ORDER BY created_at DESC
  `, [client.id]);

  // Defensive strip
  for (const o of orders) {
    if ('internal_notes' in o) {
      delete o.internal_notes;
    }
  }

  return { orders };
}

/**
 * 7. GET /api/client/orders/:orderId
 * Returns order detail + messages (is_internal=0 only)
 */
export function getClientOrderDetail(client, orderId, ip = null, userAgent = null) {
  if (!client || !client.id) {
    const err = new Error('Unauthorized: Client session required');
    err.status = 401;
    throw err;
  }

  const order = queryOne(`
    SELECT id, client_id, project_id, title, description, order_type, priority, status, attachments, due_date, rejection_reason, created_at, updated_at
    FROM client_orders
    WHERE id = ?
  `, [orderId]);

  if (!order) {
    const err = new Error('Order not found');
    err.status = 404;
    throw err;
  }

  // Client isolation: Client can only view their own orders
  if (order.client_id !== client.id) {
    const err = new Error('Forbidden: You do not have access to this order');
    err.status = 403;
    throw err;
  }

  // Defensive strip
  if ('internal_notes' in order) {
    delete order.internal_notes;
  }

  // Mandatory Security Rule: WHERE is_internal = 0 is mandatory
  const messages = queryAll(`
    SELECT com.id, com.order_id, com.sender_type, com.sender_client_id, com.sender_user_id,
           com.message, com.attachments, com.created_at,
           CASE
             WHEN com.sender_type = 'CLIENT' THEN c.name
             ELSE COALESCE(u.name, 'Mahi Tech Support')
           END AS sender_name
    FROM client_order_messages com
    LEFT JOIN clients c ON c.id = com.sender_client_id
    LEFT JOIN users u ON u.id = com.sender_user_id
    WHERE com.order_id = ? AND com.is_internal = 0
    ORDER BY com.created_at ASC
  `, [orderId]);

  return {
    order,
    messages
  };
}

/**
 * 8. POST /api/client/orders/:orderId/message
 * Adds a message to an order
 * Body: { message, attachments }
 * sender_type=CLIENT, is_internal is ALWAYS 0 for client messages
 */
export function addClientOrderMessage(client, orderId, data, ip = null, userAgent = null) {
  if (!client || !client.id) {
    const err = new Error('Unauthorized: Client session required');
    err.status = 401;
    throw err;
  }

  const { message, attachments = null } = data || {};

  if (!message || typeof message !== 'string' || !message.trim()) {
    const err = new Error('Message text is required');
    err.status = 400;
    throw err;
  }

  const order = queryOne('SELECT id, client_id FROM client_orders WHERE id = ?', [orderId]);

  if (!order) {
    const err = new Error('Order not found');
    err.status = 404;
    throw err;
  }

  if (order.client_id !== client.id) {
    const err = new Error('Forbidden: You do not have access to this order');
    err.status = 403;
    throw err;
  }

  const attachmentsStr = attachments
    ? (typeof attachments === 'string' ? attachments : JSON.stringify(attachments))
    : null;

  // Insert message (sender_type='CLIENT', is_internal=0)
  execute(`
    INSERT INTO client_order_messages (order_id, sender_type, sender_client_id, sender_user_id, message, is_internal, attachments, created_at)
    VALUES (?, 'CLIENT', ?, NULL, ?, 0, ?, datetime('now'))
  `, [orderId, client.id, message.trim(), attachmentsStr]);

  // Standing Rule: updated_at manually updated in SQLite on row mutation
  execute("UPDATE client_orders SET updated_at = datetime('now') WHERE id = ?", [orderId]);

  const createdMessage = queryOne(`
    SELECT id, order_id, sender_type, sender_client_id, sender_user_id, message, is_internal, attachments, created_at
    FROM client_order_messages
    WHERE order_id = ? AND sender_client_id = ?
    ORDER BY id DESC LIMIT 1
  `, [orderId, client.id]);

  logClientActivity({
    clientId: client.id,
    action: 'SEND_MESSAGE',
    itemType: 'ORDER_MESSAGE',
    itemId: createdMessage.id,
    ipAddress: ip,
    userAgent
  });

  return {
    message: 'Message sent successfully',
    order_message: createdMessage
  };
}

/**
 * 9. PATCH /api/client/milestone/approval/:approvalId
 * Client approves or rejects a milestone approval request
 * Body: { decision, decision_note }
 * rule: decision = APPROVED or REJECTED; updates gantt_milestones.status; logs to client_activity_log
 */
export function decideMilestoneApproval(client, approvalId, data, ip = null, userAgent = null) {
  if (!client || !client.id) {
    const err = new Error('Unauthorized: Client session required');
    err.status = 401;
    throw err;
  }

  const { decision, decision_note = null } = data || {};

  if (!decision || (decision !== 'APPROVED' && decision !== 'REJECTED')) {
    const err = new Error("Invalid decision. Must be either 'APPROVED' or 'REJECTED'");
    err.status = 400;
    throw err;
  }

  const approval = queryOne(
    'SELECT id, client_id, project_id, milestone_id, decision, decision_note, requested_at, decided_at FROM client_milestone_approvals WHERE id = ?',
    [approvalId]
  );

  if (!approval) {
    const err = new Error('Milestone approval request not found');
    err.status = 404;
    throw err;
  }

  // Client isolation: Client can only decide their own approval requests
  if (approval.client_id !== client.id) {
    const err = new Error('Forbidden: You do not have permission to decide this approval request');
    err.status = 403;
    throw err;
  }

  // Check if already decided (trigger also enforces immutability once decided)
  if (approval.decision !== null) {
    const err = new Error('Approval request has already been decided');
    err.status = 400;
    throw err;
  }

  // Update milestone approval decision
  execute(`
    UPDATE client_milestone_approvals
    SET decision = ?, decision_note = ?, decided_at = datetime('now')
    WHERE id = ? AND client_id = ?
  `, [decision, decision_note ? decision_note.trim() : null, approvalId, client.id]);

  // Update underlying gantt_milestones record
  if (decision === 'APPROVED') {
    execute(`
      UPDATE gantt_milestones
      SET status = 'ACHIEVED', achieved_at = datetime('now'), updated_at = datetime('now')
      WHERE id = ?
    `, [approval.milestone_id]);
  } else if (decision === 'REJECTED') {
    execute(`
      UPDATE gantt_milestones
      SET status = 'REJECTED', updated_at = datetime('now')
      WHERE id = ?
    `, [approval.milestone_id]);
  }

  const updatedApproval = queryOne('SELECT * FROM client_milestone_approvals WHERE id = ?', [approvalId]);

  logClientActivity({
    clientId: client.id,
    action: decision === 'APPROVED' ? 'APPROVE_MILESTONE' : 'REJECT_MILESTONE',
    itemType: 'MILESTONE',
    itemId: approval.milestone_id,
    ipAddress: ip,
    userAgent
  });

  return {
    message: `Milestone approval ${decision.toLowerCase()} successfully`,
    approval: updatedApproval
  };
}

/**
 * 10. POST /api/client/feedback/submit
 * Submits deliverable feedback
 * Body: { project_id, item_type, item_id, rating, feedback_text }
 * rule: item must be in client_shared_items for this client (is_active=1)
 */
export function submitClientFeedback(client, data, ip = null, userAgent = null) {
  if (!client || !client.id) {
    const err = new Error('Unauthorized: Client session required');
    err.status = 401;
    throw err;
  }

  const { project_id, item_type, item_id, rating = null, feedback_text = null } = data || {};

  if (!project_id) {
    const err = new Error('project_id is required');
    err.status = 400;
    throw err;
  }

  if (!item_type || typeof item_type !== 'string') {
    const err = new Error('item_type is required');
    err.status = 400;
    throw err;
  }

  if (item_id === undefined || item_id === null) {
    const err = new Error('item_id is required');
    err.status = 400;
    throw err;
  }

  if (rating !== null && rating !== undefined) {
    const numRating = Number(rating);
    if (!Number.isInteger(numRating) || numRating < 1 || numRating > 5) {
      const err = new Error('Rating must be an integer between 1 and 5');
      err.status = 400;
      throw err;
    }
  }

  // Check project access
  const projectAccess = queryOne(
    'SELECT id FROM client_project_access WHERE client_id = ? AND project_id = ? AND is_active = 1',
    [client.id, project_id]
  );

  if (!projectAccess) {
    const err = new Error('Forbidden: Access to this project is not granted or has been revoked');
    err.status = 403;
    throw err;
  }

  // Mandatory Security Rule: Pre-insert check verifying item is explicitly shared with client
  const sharedItem = queryOne(`
    SELECT id FROM client_shared_items
    WHERE client_id = ? AND project_id = ? AND item_type = ? AND item_id = ? AND is_active = 1
  `, [client.id, project_id, item_type, item_id]);

  if (!sharedItem) {
    const err = new Error('Forbidden: Feedback can only be submitted on items explicitly shared with your account');
    err.status = 403;
    throw err;
  }

  execute(`
    INSERT INTO client_deliverable_feedback (client_id, project_id, item_type, item_id, rating, feedback_text, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'SUBMITTED', datetime('now'))
  `, [
    client.id,
    project_id,
    item_type,
    item_id,
    rating ? Number(rating) : null,
    feedback_text ? feedback_text.trim() : null
  ]);

  const createdFeedback = queryOne(`
    SELECT * FROM client_deliverable_feedback
    WHERE client_id = ? AND project_id = ? AND item_id = ?
    ORDER BY id DESC LIMIT 1
  `, [client.id, project_id, item_id]);

  logClientActivity({
    clientId: client.id,
    action: 'LEAVE_FEEDBACK',
    itemType: item_type,
    itemId: item_id,
    ipAddress: ip,
    userAgent
  });

  return {
    message: 'Feedback submitted successfully',
    feedback: createdFeedback
  };
}
