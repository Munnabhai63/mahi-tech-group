import express from 'express';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { queryOne, execute, getDatabase, seedDefaultExpenseCategories, seedBuiltInAutomationTemplates, seedDefaultWikiSpace, seedDefaultOkrCycle } from '../db/database.js';
import { config } from '../config.js';
import { logAccess } from '../services/auditService.js';

const router = express.Router();

/**
 * GET /api/setup/status
 * Returns whether system requires first-run setup (0 users in DB)
 */
router.get('/status', (req, res) => {
  try {
    const userCountRow = queryOne('SELECT COUNT(*) as count FROM users');
    const userCount = userCountRow ? Number(userCountRow.count) : 0;
    const needsSetup = userCount === 0;

    return res.status(200).json({
      needsSetup,
      userCount,
      company_name: 'Mahi Tech Group',
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to inspect setup status', message: err.message });
  }
});

/**
 * POST /api/setup
 * Creates initial Super Admin account, configures company settings,
 * generates .env guidance (without storing secrets in DB), and seeds defaults.
 */
router.post('/', async (req, res) => {
  try {
    const ipAddress = req.ip || req.socket.remoteAddress;
    const userCountRow = queryOne('SELECT COUNT(*) as count FROM users');
    const userCount = userCountRow ? Number(userCountRow.count) : 0;

    if (userCount > 0) {
      return res.status(403).json({
        error: 'Setup Forbidden',
        message: 'First-run setup has already been completed on this platform.'
      });
    }

    const { name, email, password, company_name, platform_url } = req.body || {};

    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Admin full name is required' });
    }

    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return res.status(400).json({ error: 'A valid admin email address is required' });
    }

    if (!password || typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters long' });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const adminName = name.trim();
    const company = (company_name && typeof company_name === 'string' && company_name.trim()) || 'Mahi Tech Group';
    const platform = (platform_url && typeof platform_url === 'string' && platform_url.trim()) || 'http://localhost:3000';

    const passwordHash = await bcrypt.hash(password, config.BCRYPT_SALT_ROUNDS);
    const adminId = crypto.randomUUID();

    // 1. Create Super Admin user record with role 'admin' and status 'active'
    execute(`
      INSERT INTO users (
        id, name, email, password_hash, role, status,
        rating_avg, idea_quota_used, quota_reset_date, wallet_balance,
        wallet_frozen, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'admin', 'active', 5.0, 0, null, 0.0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `, [adminId, adminName, normalizedEmail, passwordHash]);

    // 2. Persist company configuration in system_config
    try {
      execute(`
        INSERT OR REPLACE INTO system_config (key, value, updated_at)
        VALUES ('company_name', ?, CURRENT_TIMESTAMP)
      `, [company]);
      execute(`
        INSERT OR REPLACE INTO system_config (key, value, updated_at)
        VALUES ('platform_url', ?, CURRENT_TIMESTAMP)
      `, [platform]);
    } catch (e) {}

    // 3. Seed real default data
    const db = getDatabase();
    seedDefaultExpenseCategories(db);
    seedBuiltInAutomationTemplates(db);
    seedDefaultWikiSpace(db);
    seedDefaultOkrCycle(db);

    // 4. Generate recommended .env configuration guidance (Never store these generated runtime secrets in DB)
    const suggestedJwtSecret = crypto.randomBytes(32).toString('hex');
    const suggestedSessionSecret = crypto.randomBytes(32).toString('hex');
    const suggestedEncryptionKey = crypto.randomBytes(32).toString('hex');

    const envSnippet = `# ===================================================================
# MAHI TECH GROUP — PRODUCTION ENVIRONMENT CONFIGURATION
# Generated during First-Run Setup on ${new Date().toISOString()}
# IMPORTANT: Keep this file secure and NEVER check it into git or store in DB!
# ===================================================================

PORT=3000
NODE_ENV=production
PLATFORM_URL=${platform}
COMPANY_NAME="${company}"

# Cryptographic Master Secrets (High Entropy)
JWT_SECRET=${suggestedJwtSecret}
SESSION_SECRET=${suggestedSessionSecret}
ENCRYPTION_KEY=${suggestedEncryptionKey}

# Database Configuration
DB_PATH=./data/mahi.db
`;

    // 5. Issue initial JWT session for instant login
    const sessionId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const token = jwt.sign(
      { userId: adminId, sessionId, role: 'admin', email: normalizedEmail },
      config.JWT_SECRET,
      { expiresIn: config.JWT_EXPIRES_IN }
    );

    const deviceInfo = req.headers['user-agent'] || 'First-Run Setup Installer';
    execute(
      `INSERT INTO sessions (id, user_id, token, device_info, ip_address, created_at, expires_at, is_revoked)
       VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, 0)`,
      [sessionId, adminId, token, deviceInfo, ipAddress, expiresAt]
    );

    logAccess({
      userId: adminId,
      action: 'first_run_setup_completed',
      resource: '/api/setup',
      ipAddress
    });

    return res.status(201).json({
      success: true,
      message: 'First-run setup completed successfully. Super Admin initialized.',
      admin: {
        id: adminId,
        name: adminName,
        email: normalizedEmail,
        role: 'admin',
        company_name: company,
        platform_url: platform
      },
      token,
      env_guidance: 'Copy and save the generated .env configuration into your server root directory. Secrets are never persisted in the database.',
      env_snippet: envSnippet
    });
  } catch (err) {
    console.error('[Setup Route] First-run setup failed:', err);
    return res.status(500).json({ error: 'Setup execution failed', message: err.message });
  }
});

export default router;
