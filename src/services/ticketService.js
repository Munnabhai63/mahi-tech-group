import crypto from 'node:crypto';
import { queryOne, queryAll, execute } from '../db/database.js';

const VALID_CATEGORIES = new Set(['bug', 'feature_request', 'access_issue', 'billing', 'other']);
const VALID_PRIORITIES = new Set(['low', 'normal', 'high', 'urgent']);
const FSM_ORDER = {
  'open': 1,
  'in_progress': 2,
  'resolved': 3,
  'closed': 4
};

/**
 * Generate sequential, permanent, zero-padded ticket number (e.g. TKT-0001)
 */
export function generateTicketNumber() {
  const row = queryOne("SELECT COUNT(*) as cnt FROM support_tickets");
  let nextNum = (Number(row?.cnt) || 0) + 1;
  let candidate = `TKT-${String(nextNum).padStart(4, '0')}`;

  // Collision safety loop
  while (queryOne("SELECT id FROM support_tickets WHERE ticket_number = ?", [candidate])) {
    nextNum++;
    candidate = `TKT-${String(nextNum).padStart(4, '0')}`;
  }

  return candidate;
}

/**
 * Create a support ticket
 */
export function createTicket({ reporter_id, category = 'other', priority = 'normal', subject, body = '', assigned_to = null }) {
  if (!reporter_id) {
    const err = new Error('Reporter ID is required');
    err.status = 400;
    throw err;
  }
  if (!subject || !subject.trim()) {
    const err = new Error('Subject is required');
    err.status = 400;
    throw err;
  }

  const cleanCategory = VALID_CATEGORIES.has(category) ? category : 'other';
  const cleanPriority = VALID_PRIORITIES.has(priority) ? priority : 'normal';
  const id = crypto.randomUUID();
  const ticket_number = generateTicketNumber();

  execute(`
    INSERT INTO support_tickets (
      id, ticket_number, reporter_id, assigned_to, category, priority, status, subject, updated_at, created_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?, 'open', ?, datetime('now'), datetime('now')
    )
  `, [id, ticket_number, reporter_id, assigned_to, cleanCategory, cleanPriority, subject.trim()]);

  // Insert initial message if body provided
  if (body && body.trim()) {
    const msgId = crypto.randomUUID();
    execute(`
      INSERT INTO ticket_messages (id, ticket_id, sender_id, body, is_internal, created_at)
      VALUES (?, ?, ?, ?, 0, datetime('now'))
    `, [msgId, id, reporter_id, body.trim()]);
  }

  return queryOne(`
    SELECT st.*, u.name as reporter_name, u.email as reporter_email
    FROM support_tickets st
    JOIN users u ON st.reporter_id = u.id
    WHERE st.id = ?
  `, [id]);
}

/**
 * List tickets with filters and search
 */
export function listTickets({ status, priority, category, search, reporter_id = null, limit = 50, offset = 0 } = {}) {
  let sql = `
    SELECT st.*, 
           reporter.name as reporter_name, 
           reporter.email as reporter_email,
           assignee.name as assignee_name,
           (SELECT COUNT(*) FROM ticket_messages WHERE ticket_id = st.id) as message_count,
           (SELECT COUNT(*) FROM ticket_messages WHERE ticket_id = st.id AND is_internal = 0) as public_message_count,
           CAST((julianday(datetime('now')) - julianday(st.created_at)) AS INT) as days_open
    FROM support_tickets st
    JOIN users reporter ON st.reporter_id = reporter.id
    LEFT JOIN users assignee ON st.assigned_to = assignee.id
    WHERE 1=1
  `;
  const params = [];

  if (reporter_id) {
    sql += ` AND st.reporter_id = ?`;
    params.push(reporter_id);
  }

  if (status) {
    sql += ` AND st.status = ?`;
    params.push(status);
  }

  if (priority) {
    sql += ` AND st.priority = ?`;
    params.push(priority);
  }

  if (category) {
    sql += ` AND st.category = ?`;
    params.push(category);
  }

  if (search && search.trim()) {
    const term = `%${search.trim()}%`;
    sql += ` AND (st.subject LIKE ? OR st.ticket_number LIKE ? OR reporter.name LIKE ? OR reporter.email LIKE ?)`;
    params.push(term, term, term, term);
  }

  sql += ` ORDER BY st.updated_at DESC LIMIT ? OFFSET ?`;
  params.push(Number(limit) || 50, Number(offset) || 0);

  const rows = queryAll(sql, params);

  return rows.map(r => ({
    ...r,
    message_count: Number(r.message_count || 0),
    public_message_count: Number(r.public_message_count || 0),
    days_open: Math.max(0, Number(r.days_open || 0)),
    // Overdue flag: open or in_progress and older than 48 hours without resolution
    overdue: Boolean((r.status === 'open' || r.status === 'in_progress') && (new Date() - new Date(r.created_at) > 48 * 3600 * 1000))
  }));
}

/**
 * Get single ticket by ID (supports admin full thread vs member public-only thread)
 */
export function getTicketById(ticketId, { isAdmin = false, userId = null } = {}) {
  const ticket = queryOne(`
    SELECT st.*, 
           reporter.name as reporter_name, 
           reporter.email as reporter_email,
           assignee.name as assignee_name
    FROM support_tickets st
    JOIN users reporter ON st.reporter_id = reporter.id
    LEFT JOIN users assignee ON st.assigned_to = assignee.id
    WHERE st.id = ?
  `, [ticketId]);

  if (!ticket) return null;

  // Access check for regular member
  if (!isAdmin && userId && ticket.reporter_id !== userId) {
    const err = new Error('Access Forbidden: You do not own this ticket');
    err.status = 403;
    throw err;
  }

  // Fetch messages — STRICT internal note isolation
  let messagesSql = `
    SELECT tm.id, tm.ticket_id, tm.sender_id, tm.body, tm.is_internal, tm.created_at,
           u.name as sender_name, u.role as sender_role
    FROM ticket_messages tm
    JOIN users u ON tm.sender_id = u.id
    WHERE tm.ticket_id = ?
  `;
  const msgParams = [ticketId];

  if (!isAdmin) {
    // Zero exceptions: members never receive is_internal = 1 messages
    messagesSql += ` AND tm.is_internal = 0`;
  }

  messagesSql += ` ORDER BY tm.created_at ASC`;
  const messages = queryAll(messagesSql, msgParams);

  return {
    ...ticket,
    messages
  };
}

/**
 * Admin updates ticket attributes (status, priority, assigned_to, category)
 * Enforces forward-only status FSM: open -> in_progress -> resolved -> closed
 * Manually updates updated_at = datetime('now')
 */
export function updateTicket(ticketId, updates = {}) {
  const ticket = queryOne("SELECT * FROM support_tickets WHERE id = ?", [ticketId]);
  if (!ticket) {
    const err = new Error('Ticket not found');
    err.status = 404;
    throw err;
  }

  const { status, priority, assigned_to, category } = updates;

  // FSM Validation
  if (status !== undefined) {
    if (!FSM_ORDER[status]) {
      const err = new Error(`Invalid ticket status: ${status}`);
      err.status = 400;
      throw err;
    }

    if (ticket.status === 'closed') {
      const err = new Error('Cannot reopen or modify closed ticket');
      err.status = 400;
      throw err;
    }

    const currentRank = FSM_ORDER[ticket.status] || 0;
    const nextRank = FSM_ORDER[status];

    if (nextRank <= currentRank) {
      const err = new Error(`Ticket status transitions must be strictly forward (attempted ${ticket.status} -> ${status})`);
      err.status = 400;
      throw err;
    }
  }

  if (priority !== undefined && !VALID_PRIORITIES.has(priority)) {
    const err = new Error(`Invalid ticket priority: ${priority}`);
    err.status = 400;
    throw err;
  }

  if (category !== undefined && !VALID_CATEGORIES.has(category)) {
    const err = new Error(`Invalid ticket category: ${category}`);
    err.status = 400;
    throw err;
  }

  // Execute update with mandatory updated_at = datetime('now')
  execute(`
    UPDATE support_tickets
    SET status = COALESCE(?, status),
        priority = COALESCE(?, priority),
        assigned_to = CASE WHEN ? = 1 THEN ? ELSE assigned_to END,
        category = COALESCE(?, category),
        updated_at = datetime('now')
    WHERE id = ?
  `, [
    status || null,
    priority || null,
    assigned_to !== undefined ? 1 : 0,
    assigned_to || null,
    category || null,
    ticketId
  ]);

  return getTicketById(ticketId, { isAdmin: true });
}

/**
 * Add a message to a ticket thread
 * Non-admins have is_internal forced to 0
 * Manually updates support_tickets.updated_at = datetime('now')
 */
export function addTicketMessage(ticketId, { sender_id, body, is_internal = 0, isAdmin = false }) {
  const ticket = queryOne("SELECT * FROM support_tickets WHERE id = ?", [ticketId]);
  if (!ticket) {
    const err = new Error('Ticket not found');
    err.status = 404;
    throw err;
  }

  if (!body || !body.trim()) {
    const err = new Error('Message body is required');
    err.status = 400;
    throw err;
  }

  // Force is_internal to 0 for non-admins
  const cleanIsInternal = isAdmin && (is_internal === 1 || is_internal === true || is_internal === '1') ? 1 : 0;
  const id = crypto.randomUUID();

  execute(`
    INSERT INTO ticket_messages (id, ticket_id, sender_id, body, is_internal, created_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
  `, [id, ticketId, sender_id, body.trim(), cleanIsInternal]);

  // Mandatory updated_at timestamp update on ticket
  execute(`
    UPDATE support_tickets 
    SET updated_at = datetime('now') 
    WHERE id = ?
  `, [ticketId]);

  return queryOne(`
    SELECT tm.*, u.name as sender_name, u.role as sender_role
    FROM ticket_messages tm
    JOIN users u ON tm.sender_id = u.id
    WHERE tm.id = ?
  `, [id]);
}
