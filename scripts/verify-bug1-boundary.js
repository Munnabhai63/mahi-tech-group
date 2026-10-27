import crypto from 'node:crypto';
import { execute, queryOne } from '../src/db/database.js';
import { evaluateVotingDecision } from '../src/services/votingService.js';

console.log('=== VERIFYING BUG FIX 1: VOTING THRESHOLD BOUNDARY (70.00% >= 70.0%) ===');

// Setup test idea with 10 real votes: 7 green, 3 red = exactly 70.00%
const ideaId = crypto.randomUUID();
const ownerId = crypto.randomUUID();
const meetingId = crypto.randomUUID();

execute(`
  INSERT INTO users (id, name, email, password_hash, role, status)
  VALUES (?, 'Test Owner', ?, 'hash', 'researcher', 'active')
`, [ownerId, `boundary.owner.${Date.now()}@test.com`]);

execute(`
  INSERT INTO ideas (id, owner_id, title, description, status, green_percentage)
  VALUES (?, ?, 'Boundary Test Idea', 'Testing exactly 70.00% threshold', 'PENDING_REVIEW', 70.00)
`, [ideaId, ownerId]);

execute(`
  INSERT INTO review_meetings (id, idea_id, scheduled_at, voting_window_end, status)
  VALUES (?, ?, CURRENT_TIMESTAMP, datetime('now', '+1 day'), 'SCHEDULED')
`, [meetingId, ideaId]);

// Cast 7 green votes and 3 red votes
for (let i = 0; i < 7; i++) {
  const voterId = crypto.randomUUID();
  execute(`INSERT INTO users (id, name, email, password_hash, role, status) VALUES (?, ?, ?, 'hash', 'developer', 'active')`,
    [voterId, `Voter Green ${i}`, `voter.green.${i}.${Date.now()}@test.com`]);
  execute(`INSERT INTO votes (id, idea_id, voter_id, vote_color, voted_at) VALUES (?, ?, ?, 'green', CURRENT_TIMESTAMP)`,
    [crypto.randomUUID(), ideaId, voterId]);
}

for (let i = 0; i < 3; i++) {
  const voterId = crypto.randomUUID();
  execute(`INSERT INTO users (id, name, email, password_hash, role, status) VALUES (?, ?, ?, 'hash', 'developer', 'active')`,
    [voterId, `Voter Red ${i}`, `voter.red.${i}.${Date.now()}@test.com`]);
  execute(`INSERT INTO votes (id, idea_id, voter_id, vote_color, voted_at) VALUES (?, ?, ?, 'red', CURRENT_TIMESTAMP)`,
    [crypto.randomUUID(), ideaId, voterId]);
}

// Ensure threshold is set to 70.0% and quorum is 0% for pure boundary testing
execute("UPDATE system_config SET value = '70.0' WHERE key = 'vote_approval_threshold'");
execute("UPDATE system_config SET value = '0.0' WHERE key = 'vote_quorum_percentage'");

const result = evaluateVotingDecision(ideaId);
console.log('evaluateVotingDecision result:', JSON.stringify(result, null, 2));

const updatedIdea = queryOne('SELECT id, status, green_percentage FROM ideas WHERE id = ?', [ideaId]);
console.log('Database idea record:', JSON.stringify(updatedIdea, null, 2));

execute("UPDATE system_config SET value = '70.0' WHERE key = 'vote_quorum_percentage'");

if (result.status === 'APPROVED' && updatedIdea.status === 'APPROVED') {
  console.log('✅ VERIFICATION SUCCESS: green_percentage = 70.00 correctly returns APPROVED status!');
  process.exit(0);
} else {
  console.error('❌ VERIFICATION FAILED: expected APPROVED but got', result.status);
  process.exit(1);
}
