import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { queryOne, queryAll, execute } from '../db/database.js';
import { config } from '../config.js';
import {
  isClientIpLockedOut,
  recordFailedClientLogin,
  clearFailedClientLogins
} from '../middleware/clientAuth.js';

/**
 * Service to log client activities into append-only client_activity_log
 */
export function logClientActivity({
  clientId,
  action,
  itemType = null,
  itemId = null,
  ipAddress = null,
  userAgent = null
}) {
  try {
    execute(
      `INSERT INTO client_activity_log (client_id, action, item_type, item_id, ip_address, user_agent, created_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
      [clientId, action, itemType, itemId, ipAddress, userAgent]
    );
  } catch (err) {
    console.error('Failed to write client_activity_log:', err.message);
  }
}

/**
 * Invite a new client (Admin only)
 * Creates client in INVITED status, generates 32-byte crypto token expiring in 72h
 */
export async function inviteClient(adminUser, { name, email, company_name = null, phone = null }) {
  if (!adminUser || (adminUser.role !== 'admin' && adminUser.role !== 'superadmin')) {
    const err = new Error('Forbidden: Only administrators can invite clients');
    err.status = 403;
    throw err;
  }

  if (!name || !email) {
    const err = new Error('Name and email are required');
    err.status = 400;
    throw err;
  }

  const normalizedEmail = email.toLowerCase().trim();
  const existing = queryOne('SELECT id FROM clients WHERE email = ?', [normalizedEmail]);
  if (existing) {
    const err = new Error('Client with this email already exists');
    err.status = 409;
    throw err;
  }

  // Minimum 32 bytes cryptographically random hex token (64 hex characters)
  const inviteToken = crypto.randomBytes(32).toString('hex');
  // Token expires in 72 hours
  const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();

  // Create an unmatchable bcrypt placeholder hash until invite is accepted
  const placeholderHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);

  execute(
    `INSERT INTO clients (
      name, email, company_name, phone, password_hash,
      status, invite_token, invite_token_expires_at, created_by,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'INVITED', ?, ?, ?, datetime('now'), datetime('now'))`,
    [
      name.trim(),
      normalizedEmail,
      company_name ? company_name.trim() : null,
      phone ? phone.trim() : null,
      placeholderHash,
      inviteToken,
      expiresAt,
      adminUser.id
    ]
  );

  const client = queryOne(
    `SELECT id, name, email, company_name, phone, status, created_at, updated_at
     FROM clients WHERE email = ?`,
    [normalizedEmail]
  );

  return {
    client,
    invite_token: inviteToken,
    invite_token_expires_at: expiresAt
  };
}

/**
 * Resend an invite to an existing client (Admin only)
 */
export async function resendInvite(adminUser, clientId) {
  if (!adminUser || (adminUser.role !== 'admin' && adminUser.role !== 'superadmin')) {
    const err = new Error('Forbidden: Only administrators can resend invitations');
    err.status = 403;
    throw err;
  }

  const client = queryOne('SELECT * FROM clients WHERE id = ?', [clientId]);
  if (!client) {
    const err = new Error('Client not found');
    err.status = 404;
    throw err;
  }

  if (client.status === 'ACTIVE' && !client.invite_token) {
    const err = new Error('Client has already accepted their invitation and is active');
    err.status = 400;
    throw err;
  }

  const inviteToken = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();

  execute(
    `UPDATE clients SET
       invite_token = ?,
       invite_token_expires_at = ?,
       updated_at = datetime('now')
     WHERE id = ?`,
    [inviteToken, expiresAt, clientId]
  );

  return {
    message: 'Invitation resent successfully',
    invite_token: inviteToken,
    invite_token_expires_at: expiresAt
  };
}

/**
 * Accept invite and set initial password
 * Validates token, checks expiry, sets password hash, clears token, sets ACTIVE
 */
export async function acceptInvite({ invite_token, new_password }, ip = null, userAgent = null) {
  if (!invite_token || !new_password) {
    const err = new Error('Invite token and new password are required');
    err.status = 400;
    throw err;
  }

  if (new_password.length < 8) {
    const err = new Error('Password must be at least 8 characters long');
    err.status = 400;
    throw err;
  }

  const client = queryOne('SELECT * FROM clients WHERE invite_token = ?', [invite_token.trim()]);
  if (!client) {
    const err = new Error('Invalid or already used invitation token');
    err.status = 400;
    throw err;
  }

  // Server-side check: enforce invite token expiry
  if (!client.invite_token_expires_at || new Date(client.invite_token_expires_at) <= new Date()) {
    const err = new Error('Invitation token has expired. Please contact administrator for a new invite.');
    err.status = 400;
    throw err;
  }

  const passwordHash = await bcrypt.hash(new_password, config.BCRYPT_SALT_ROUNDS);

  execute(
    `UPDATE clients SET
       password_hash = ?,
       invite_token = NULL,
       invite_accepted_at = datetime('now'),
       status = 'ACTIVE',
       updated_at = datetime('now')
     WHERE id = ?`,
    [passwordHash, client.id]
  );

  // Log activity
  logClientActivity({
    clientId: client.id,
    action: 'INVITE_ACCEPTED',
    ipAddress: ip,
    userAgent
  });

  return {
    message: 'Invitation accepted successfully. You can now log in.',
    client: {
      id: client.id,
      name: client.name,
      email: client.email,
      status: 'ACTIVE'
    }
  };
}

/**
 * Client Login
 * Enforces rate limiting, status checks, password validation, and issues Client JWT
 */
export async function clientLogin({ email, password }, ip = null, userAgent = null) {
  // Check lockout status for the client IP
  if (isClientIpLockedOut(ip)) {
    const err = new Error('Too many failed login attempts. Account temporarily locked for 15 minutes.');
    err.status = 429;
    throw err;
  }

  if (!email || !password) {
    const err = new Error('Email and password are required');
    err.status = 400;
    throw err;
  }

  const normalizedEmail = email.toLowerCase().trim();
  const client = queryOne('SELECT * FROM clients WHERE email = ?', [normalizedEmail]);

  if (!client) {
    recordFailedClientLogin(ip);
    const err = new Error('Invalid email or password');
    err.status = 401;
    throw err;
  }

  if (client.status === 'INVITED') {
    const err = new Error('Account has not been activated. Please accept your invite first.');
    err.status = 400;
    throw err;
  }

  if (client.status === 'SUSPENDED') {
    recordFailedClientLogin(ip);
    logClientActivity({
      clientId: client.id,
      action: 'FAILED_LOGIN',
      ipAddress: ip,
      userAgent
    });
    const err = new Error('Account has been suspended. Please contact administrator.');
    err.status = 403;
    throw err;
  }

  if (client.status !== 'ACTIVE') {
    const err = new Error('Account is inactive. Please contact administrator.');
    err.status = 403;
    throw err;
  }

  const isMatch = await bcrypt.compare(password, client.password_hash);
  if (!isMatch) {
    recordFailedClientLogin(ip);
    logClientActivity({
      clientId: client.id,
      action: 'FAILED_LOGIN',
      ipAddress: ip,
      userAgent
    });
    const err = new Error('Invalid email or password');
    err.status = 401;
    throw err;
  }

  // Clear rate-limiting records on successful login
  clearFailedClientLogins(ip);

  // Update client timestamp
  execute("UPDATE clients SET updated_at = datetime('now') WHERE id = ?", [client.id]);

  // Log successful login
  logClientActivity({
    clientId: client.id,
    action: 'LOGIN',
    ipAddress: ip,
    userAgent
  });

  // Client JWT with strictly required payload
  const token = jwt.sign(
    {
      clientId: client.id,
      email: client.email,
      role: 'CLIENT'
    },
    config.CLIENT_JWT_SECRET,
    { expiresIn: config.CLIENT_JWT_EXPIRES_IN || '7d' }
  );

  return {
    token,
    client: {
      id: client.id,
      name: client.name,
      email: client.email,
      company_name: client.company_name,
      phone: client.phone,
      status: client.status,
      role: 'CLIENT'
    }
  };
}

/**
 * Client Logout
 */
export function clientLogout(client, ip = null, userAgent = null) {
  if (client?.id) {
    logClientActivity({
      clientId: client.id,
      action: 'LOGOUT',
      ipAddress: ip,
      userAgent
    });
  }
  return { message: 'Logged out successfully' };
}

/**
 * Get Client Profile
 */
export function getClientProfile(clientId) {
  const client = queryOne(
    `SELECT id, name, email, company_name, phone, status, created_at, updated_at
     FROM clients WHERE id = ?`,
    [clientId]
  );

  if (!client) {
    const err = new Error('Client profile not found');
    err.status = 404;
    throw err;
  }

  return {
    ...client,
    role: 'CLIENT'
  };
}

/**
 * Update client status (Admin only)
 */
export function updateClientStatus(adminUser, clientId, status) {
  if (!adminUser || (adminUser.role !== 'admin' && adminUser.role !== 'superadmin')) {
    const err = new Error('Forbidden: Only administrators can update client status');
    err.status = 403;
    throw err;
  }

  const validStatuses = ['ACTIVE', 'SUSPENDED', 'INACTIVE'];
  if (!validStatuses.includes(status)) {
    const err = new Error(`Invalid status. Must be one of: ${validStatuses.join(', ')}`);
    err.status = 400;
    throw err;
  }

  const client = queryOne('SELECT id FROM clients WHERE id = ?', [clientId]);
  if (!client) {
    const err = new Error('Client not found');
    err.status = 404;
    throw err;
  }

  execute(
    "UPDATE clients SET status = ?, updated_at = datetime('now') WHERE id = ?",
    [status, clientId]
  );

  return queryOne(
    'SELECT id, name, email, company_name, phone, status, updated_at FROM clients WHERE id = ?',
    [clientId]
  );
}
