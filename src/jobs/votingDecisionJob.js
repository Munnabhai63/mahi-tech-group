import { queryAll } from '../db/database.js';
import { evaluateVotingDecision } from '../services/votingService.js';

export function runVotingDecisionJob(simulatedNow = null) {
  const nowStr = simulatedNow || new Date().toISOString();
  console.log(`[VOTING DECISION JOB] Checking closed voting windows at: ${nowStr}`);

  // Query review meetings whose voting_window_end has passed and are not COMPLETED
  const meetings = queryAll(`
    SELECT rm.*, i.title, i.status as idea_status
    FROM review_meetings rm
    JOIN ideas i ON rm.idea_id = i.id
    WHERE rm.voting_window_end <= ?
      AND rm.status != 'COMPLETED'
      AND i.status = 'PENDING_REVIEW'
  `, [nowStr]);

  const results = [];
  for (const m of meetings) {
    console.log(`[VOTING DECISION JOB] Evaluating idea: ${m.title} (${m.idea_id})`);
    const decision = evaluateVotingDecision(m.idea_id, simulatedNow);
    results.push({ ideaId: m.idea_id, title: m.title, result: decision });
    console.log(`[VOTING DECISION JOB] Decision result for ${m.idea_id}:`, decision);
  }

  console.log(`[VOTING DECISION JOB] Processed ${results.length} review meeting(s).`);
  return results;
}

let votingIntervalHandle = null;

export function startScheduledVotingDecision(intervalMs = 60 * 60 * 1000) {
  if (votingIntervalHandle) {
    clearInterval(votingIntervalHandle);
  }

  runVotingDecisionJob();

  votingIntervalHandle = setInterval(() => {
    runVotingDecisionJob();
  }, intervalMs);

  return votingIntervalHandle;
}

export function stopScheduledVotingDecision() {
  if (votingIntervalHandle) {
    clearInterval(votingIntervalHandle);
    votingIntervalHandle = null;
  }
}
