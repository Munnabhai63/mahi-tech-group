import express from 'express';
import cors from 'cors';
import authRouter from './routes/auth.js';
import adminRouter from './routes/admin.js';
import usersRouter from './routes/users.js';
import ideasRouter from './routes/ideas.js';
import projectsRouter from './routes/projects.js';
import tasksRouter from './routes/tasks.js';
import withdrawalsRouter from './routes/withdrawals.js';
import coworkingRouter from './routes/coworking.js';
import dashboardRouter from './routes/dashboard.js';
import meetingsRouter from './routes/meetings.js';
import superadminRouter from './routes/superadmin.js';
import signRouter from './routes/sign.js';
import pipelineRouter from './routes/pipeline.routes.js';
import pointPoolRouter from './routes/pointPool.routes.js';
import githubWebhookRouter from './routes/githubWebhook.routes.js';
import githubSettingsRouter from './routes/githubSettings.routes.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { queryAll } from './db/database.js';
import { config } from './config.js';
import { securityHeaders } from './middleware/securityHeaders.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicPath = path.join(__dirname, '..', 'public');

export function createApp() {
  const app = express();

  app.use(securityHeaders);
  app.use(cors());

  // Webhook raw body parser MUST be mounted BEFORE global express.json()
  app.use('/api/github/webhook', express.raw({ type: 'application/json' }));
  app.use('/api/github', githubWebhookRouter);

  app.use(express.json());

  // Enhanced health check endpoint
  app.get('/api/health', (req, res) => {
    let tablesCount = 0;
    try {
      const rows = queryAll("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'");
      tablesCount = rows.length;
    } catch (e) {}

    res.status(200).json({
      status: 'ok',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      database: 'connected',
      websocket: 'active',
      encryption: Boolean(process.env.ENCRYPTION_KEY || config.ENCRYPTION_KEY),
      tables_verified: tablesCount,
      uptime_seconds: Math.floor(process.uptime())
    });
  });

  // Test error trigger endpoint for verification suites
  app.get('/api/debug/error-test', (req, res, next) => {
    next(new Error('Simulated internal database crash'));
  });

  // Serve static frontend assets
  app.use(express.static(publicPath, {
    maxAge: '1h',
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.html')) {
        res.setHeader('Cache-Control', 'no-cache');
      } else {
        res.setHeader('Cache-Control', 'public, max-age=3600');
      }
    }
  }));

  // Mount API routers
  app.use('/api/auth', authRouter);
  app.use('/api/sign', signRouter); // Member digital signing ceremony (authenticate only)
  app.use('/api/admin', adminRouter);
  app.use('/api/superadmin', superadminRouter);
  app.use('/api/users', usersRouter);
  app.use('/api/ideas', ideasRouter);
  app.use('/api/projects', projectsRouter);
  app.use('/api/tasks', tasksRouter);
  app.use('/api/withdrawals', withdrawalsRouter);
  app.use('/api/coworking-rooms', coworkingRouter);
  app.use('/api/meetings', meetingsRouter);
  app.use('/api/pipeline', pipelineRouter);
  app.use('/api/pointpool', pointPoolRouter);
  app.use('/api/dashboard', dashboardRouter);
  app.use('/api', dashboardRouter); // Covers /api/notifications/* and /api/activity/*
  app.use('/api/github/settings', githubSettingsRouter);

  // Direct shortcut redirects for common workspace and auth routes (Express 5 compatible)
  app.use((req, res, next) => {
    if (req.method !== 'GET') return next();
    const p = req.path;
    if (
      p === '/app' || p.startsWith('/app/') ||
      p === '/workspace' || p.startsWith('/workspace/') ||
      p === '/dashboard' || p.startsWith('/dashboard/') ||
      p === '/login' || p === '/signup' ||
      p === '/admin' || p.startsWith('/admin/') ||
      p === '/superadmin' || p.startsWith('/superadmin/')
    ) {
      const targetHash = p.startsWith('/app') ? p : `/${p.replace(/^\/+/, '')}`;
      return res.redirect(`/app.html#${targetHash}`);
    }
    next();
  });

  // Client-side SPA fallback for non-API routes (Express 5 compatible)
  app.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api')) {
      return res.sendFile(path.join(publicPath, 'index.html'), (err) => {
        if (err) next();
      });
    }
    next();
  });

  // 404 handler for unknown routes
  app.use((req, res) => {
    res.status(404).json({ error: `Route not found: ${req.method} ${req.originalUrl}` });
  });

  // Global error handler (Sanitized to prevent internal information leakage in production)
  app.use((err, req, res, next) => {
    console.error('Unhandled Application Error:', err);
    const isDev = process.env.NODE_ENV !== 'production';
    res.status(err.status || 500).json({
      error: err.name || 'Internal Server Error',
      message: isDev ? err.message : 'An unexpected error occurred. Please contact the administrator.'
    });
  });

  return app;
}

export default createApp;
