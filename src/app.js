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
import paymentsRouter from './routes/payments.js';
import legalRouter from './routes/legal.js';
import githubWebhookRouter from './routes/githubWebhook.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { securityHeaders } from './middleware/securityHeaders.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicPath = path.join(__dirname, '..', 'public');

export function createApp() {
  const app = express();

  // Only trust X-Forwarded-* headers when explicitly running behind a reverse proxy
  if (config.TRUST_PROXY) {
    app.set('trust proxy', 1);
  }

  app.use(securityHeaders);

  // Cross-origin requests are opt-in: list origins in CORS_ORIGIN (comma-separated).
  // The frontend is served same-origin by this server, so by default no CORS is allowed.
  if (config.CORS_ORIGIN) {
    const origins = config.CORS_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean);
    app.use(cors({ origin: origins }));
  }

  // Raw body capture for HMAC verification (YouPI payment webhooks)
  app.use(express.json({
    limit: '1mb',
    verify: (req, res, buf) => {
      req.rawBody = buf;
    }
  }));

  // Health check endpoint (no internal configuration details exposed)
  app.get('/api/health', (req, res) => {
    res.status(200).json({
      status: 'ok',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      uptime_seconds: Math.floor(process.uptime())
    });
  });

  // Test error trigger endpoint for verification suites (development only)
  if (process.env.NODE_ENV !== 'production') {
    app.get('/api/debug/error-test', (req, res, next) => {
      next(new Error('Simulated internal database crash'));
    });
  }

  // Serve static frontend assets
  app.use(express.static(publicPath));
  // Uploaded attachments (task files, meeting recordings) — authenticated UX flows fetch them by URL
  app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

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
  app.use('/api/dashboard', dashboardRouter);
  app.use('/api/payments', paymentsRouter); // YouPI collections + HMAC webhook (self-authenticating)
  app.use('/api/legal', legalRouter); // Legal onboarding gate (public doc reads, signed acceptances)
  app.use('/api/github', githubWebhookRouter); // GitHub PR↔task sync (HMAC self-authenticating)
  app.use('/api', dashboardRouter); // Covers /api/notifications/* and /api/activity/*

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
