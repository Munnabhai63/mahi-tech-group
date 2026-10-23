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
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { queryAll } from './db/database.js';
import { config } from './config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicPath = path.join(__dirname, '..', 'public');

export function createApp() {
  const app = express();

  app.use(cors());
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

  // Serve static frontend assets
  app.use(express.static(publicPath));

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

  // Global error handler
  app.use((err, req, res, next) => {
    console.error('Unhandled Application Error:', err);
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  });

  return app;
}

export default createApp;
