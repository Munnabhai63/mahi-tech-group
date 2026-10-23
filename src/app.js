import express from 'express';
import cors from 'cors';
import authRouter from './routes/auth.js';
import adminRouter from './routes/admin.js';
import usersRouter from './routes/users.js';
import ideasRouter from './routes/ideas.js';
import projectsRouter from './routes/projects.js';
import tasksRouter from './routes/tasks.js';
import withdrawalsRouter from './routes/withdrawals.js';

export function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json());

  // Health check endpoint
  app.get('/api/health', (req, res) => {
    res.status(200).json({
      status: 'ok',
      service: 'Mahi Tech Group Platform - Step 06 Revenue Split Engine',
      timestamp: new Date().toISOString()
    });
  });

  // Mount API routers
  app.use('/api/auth', authRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api/users', usersRouter);
  app.use('/api/ideas', ideasRouter);
  app.use('/api/projects', projectsRouter);
  app.use('/api/tasks', tasksRouter);
  app.use('/api/withdrawals', withdrawalsRouter);

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
