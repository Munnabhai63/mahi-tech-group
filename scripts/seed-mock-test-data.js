// scripts/seed-mock-test-data.js
import crypto from 'node:crypto';
import { getDatabase, execute, queryOne, queryAll } from '../src/db/database.js';

async function seedTestData() {
  console.log('>>> Seeding rich mock test data for local browser testing...');
  const db = getDatabase();

  const admin = queryOne("SELECT id FROM users WHERE email = 'admin@mahitechgroup.com'");
  const researcher = queryOne("SELECT id FROM users WHERE email = 'researcher@mahitechgroup.com'");
  const developer = queryOne("SELECT id FROM users WHERE email = 'developer@mahitechgroup.com'");
  const producer = queryOne("SELECT id FROM users WHERE email = 'producer@mahitechgroup.com'");
  const designer = queryOne("SELECT id FROM users WHERE email = 'designer@mahitechgroup.com'");

  if (!admin || !researcher || !developer || !producer || !designer) {
    console.error('Missing one or more seed users.');
    return;
  }

  // 1. Seed Ideas (under review, voting active, and approved)
  const idea1Id = crypto.randomUUID();
  execute(`
    INSERT INTO ideas (id, owner_id, title, description, status, submitted_at, voting_deadline, green_percentage)
    VALUES (?, ?, 'AI Cognitive Orchestrator', 'Autonomous multi-agent distributed system with edge computing execution', 'PENDING_REVIEW', CURRENT_TIMESTAMP, datetime('now', '+2 days'), 85.0)
  `, [idea1Id, researcher.id]);

  // 2. Seed Voting Record for Idea 1
  execute(`
    INSERT INTO votes (id, idea_id, voter_id, vote_color, voted_at)
    VALUES (?, ?, ?, 'green', CURRENT_TIMESTAMP)
  `, [crypto.randomUUID(), idea1Id, developer.id]);
  execute(`
    INSERT INTO votes (id, idea_id, voter_id, vote_color, voted_at)
    VALUES (?, ?, ?, 'green', CURRENT_TIMESTAMP)
  `, [crypto.randomUUID(), idea1Id, designer.id]);

  // 3. Seed Review Meeting for Idea 1
  const meetingId = crypto.randomUUID();
  execute(`
    INSERT OR IGNORE INTO review_meetings (id, idea_id, scheduled_at, voting_window_end, status)
    VALUES (?, ?, datetime('now', '+1 days'), datetime('now', '+3 days'), 'SCHEDULED')
  `, [meetingId, idea1Id]);

  // 4. Seed Projects
  const proj1Id = crypto.randomUUID();
  execute(`
    INSERT INTO projects (id, idea_id, org_id, title, owner_id, current_stage, status, created_at)
    VALUES (?, ?, 'DEFAULT_ORG', 'Mahi Cloud Control Engine', ?, 'RESEARCH_DEV_PARALLEL', 'ACTIVE', CURRENT_TIMESTAMP)
  `, [proj1Id, idea1Id, admin.id]);

  const proj2Id = crypto.randomUUID();
  execute(`
    INSERT INTO projects (id, idea_id, org_id, title, owner_id, current_stage, status, created_at)
    VALUES (?, ?, 'DEFAULT_ORG', 'NextGen Unified Mobile App', ?, 'INTEGRATION', 'ACTIVE', CURRENT_TIMESTAMP)
  `, [proj2Id, idea1Id, producer.id]);

  // 5. Seed Tasks across all 4 roles
  execute(`
    INSERT INTO project_tasks (id, project_id, assigned_to, task_name, task_type, status, created_at)
    VALUES (?, ?, ?, 'Build REST & WebSocket Streaming API', 'backend', 'IN_PROGRESS', CURRENT_TIMESTAMP)
  `, [crypto.randomUUID(), proj1Id, developer.id]);

  execute(`
    INSERT INTO project_tasks (id, project_id, assigned_to, task_name, task_type, status, created_at)
    VALUES (?, ?, ?, 'Design Design System & Figma Tokens', 'design', 'IN_PROGRESS', CURRENT_TIMESTAMP)
  `, [crypto.randomUUID(), proj1Id, designer.id]);

  execute(`
    INSERT INTO project_tasks (id, project_id, assigned_to, task_name, task_type, status, created_at)
    VALUES (?, ?, ?, 'Evaluate Distributed Consensus Benchmarks', 'research', 'TODO', CURRENT_TIMESTAMP)
  `, [crypto.randomUUID(), proj1Id, researcher.id]);

  execute(`
    INSERT INTO project_tasks (id, project_id, assigned_to, task_name, task_type, status, created_at)
    VALUES (?, ?, ?, 'Setup Docker Container Canary Pipeline', 'review', 'TODO', CURRENT_TIMESTAMP)
  `, [crypto.randomUUID(), proj1Id, producer.id]);

  // 6. Seed Payment Gateway Config
  execute(`
    INSERT OR REPLACE INTO payment_gateway_config (
      id, mode, gateway_name, api_key_encrypted, webhook_secret_encrypted, auto_approve_below, updated_at
    ) VALUES (
      'singleton', 'sandbox', 'YOUPI_PAYMENT_GATEWAY', 'mock_encrypted_key', 'mock_encrypted_secret', 5000, datetime('now')
    )
  `);

  // 7. Give users wallets and positive balances for testing withdrawals / payouts
  execute("UPDATE users SET wallet_balance = 25000.0 WHERE id = ?", [developer.id]);
  execute("UPDATE users SET wallet_balance = 18000.0 WHERE id = ?", [designer.id]);
  execute("UPDATE users SET wallet_balance = 22000.0 WHERE id = ?", [researcher.id]);
  execute("UPDATE users SET wallet_balance = 30000.0 WHERE id = ?", [producer.id]);

  console.log('✓ Mock test data seeded successfully.');
}

seedTestData().catch(console.error);
