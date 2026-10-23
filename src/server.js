import { createApp } from './app.js';
import { config } from './config.js';
import { runMigration } from './db/migrate.js';
import { runSeed } from './db/seed.js';
import { startScheduledQuotaReset, stopScheduledQuotaReset } from './jobs/quotaResetJob.js';
import { startScheduledVotingDecision, stopScheduledVotingDecision } from './jobs/votingDecisionJob.js';
import { initWebSocketServer } from './services/wsService.js';

async function startServer() {
  try {
    console.log('>>> Initializing Database Schema & Seed Data...');
    runMigration();
    await runSeed();

    // Start automated background jobs
    startScheduledQuotaReset();
    startScheduledVotingDecision();

    const app = createApp();

    const server = app.listen(config.PORT, () => {
      console.log(`===================================================================`);
      console.log(`  MAHI TECH GROUP PLATFORM — BACKEND SERVER RUNNING`);
      console.log(`  Port: http://localhost:${config.PORT}`);
      console.log(`  Step: 07_FRONTEND_CENTER_DASHBOARD (Real-Time Engine Active)`);
      console.log(`  WebSocket: ws://localhost:${config.PORT}/ws`);
      console.log(`  Environment: local (node:sqlite WAL mode)`);
      console.log(`===================================================================`);
    });

    // Initialize Real-Time WebSocket Server
    const wss = initWebSocketServer(server);

    const shutdown = () => {
      console.log('\n>>> Gracefully shutting down server...');
      stopScheduledQuotaReset();
      stopScheduledVotingDecision();
      wss.close();
      server.close(() => {
        console.log('>>> Server closed cleanly.');
        process.exit(0);
      });
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    return server;
  } catch (err) {
    console.error('Fatal Error during Server Startup:', err);
    process.exit(1);
  }
}

// When run directly
if (process.argv[1] && process.argv[1].endsWith('server.js')) {
  startServer();
}

export { startServer };
