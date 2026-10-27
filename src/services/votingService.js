import crypto from 'node:crypto';
import { queryOne, queryAll, execute } from '../db/database.js';
import { logAccess } from './auditService.js';
import { triggerProjectFanout } from './fanoutService.js';
import { broadcastEvent } from './wsService.js';
import { createNotification } from './notificationService.js';

export function getVotingConfig() {
  const thresholdRow = queryOne("SELECT value FROM system_config WHERE key = 'vote_approval_threshold'");
  const quorumRow = queryOne("SELECT value FROM system_config WHERE key = 'vote_quorum_percentage'");
  const windowRow = queryOne("SELECT value FROM system_config WHERE key = 'voting_window_hours'");

  return {
    approvalThreshold: thresholdRow ? parseFloat(thresholdRow.value) : 70.0,
    quorumPercentage: quorumRow ? parseFloat(quorumRow.value) : 70.0,
    votingWindowHours: windowRow ? parseInt(windowRow.value, 10) : 48
  };
}

export function getIdeaVotingSummary(ideaId) {
  const idea = queryOne('SELECT * FROM ideas WHERE id = ?', [ideaId]);
  if (!idea) {
    throw new Error('Idea not found');
  }

  // Eligible voters = active users excluding the idea owner
  const eligibleRow = queryOne(
    "SELECT COUNT(*) as count FROM users WHERE status = 'active' AND id != ?",
    [idea.owner_id]
  );
  const eligibleVoters = eligibleRow ? eligibleRow.count : 0;

  const votes = queryAll(`
    SELECT v.*, u.name as voter_name, u.role as voter_role
    FROM votes v
    JOIN users u ON v.voter_id = u.id
    WHERE v.idea_id = ?
    ORDER BY v.voted_at ASC
  `, [ideaId]);

  const totalVotesCast = votes.length;
  const greenVotes = votes.filter(v => v.vote_color === 'green').length;
  const redVotes = votes.filter(v => v.vote_color === 'red').length;

  const greenPercentage = totalVotesCast > 0 ? (greenVotes / totalVotesCast) * 100 : 0.0;
  const participationRate = eligibleVoters > 0 ? (totalVotesCast / eligibleVoters) * 100 : 0.0;

  const meeting = queryOne(
    'SELECT * FROM review_meetings WHERE idea_id = ? ORDER BY created_at DESC LIMIT 1',
    [ideaId]
  );

  return {
    idea,
    eligibleVoters,
    totalVotesCast,
    greenVotes,
    redVotes,
    greenPercentage: Math.round(greenPercentage * 100) / 100,
    participationRate: Math.round(participationRate * 100) / 100,
    meeting,
    votes
  };
}

export function castVote({
  ideaId,
  voterId,
  scoreFeasibility = null,
  scoreMarket = null,
  scoreCapacity = null,
  voteColor,
  comment = null,
  ipAddress = null
}) {
  const idea = queryOne('SELECT * FROM ideas WHERE id = ?', [ideaId]);
  if (!idea) {
    return { success: false, status: 404, error: 'Idea not found' };
  }

  if (idea.status !== 'PENDING_REVIEW') {
    return {
      success: false,
      status: 400,
      error: `Cannot vote on idea. Current status is '${idea.status}' (Voting only allowed for 'PENDING_REVIEW')`
    };
  }

  // NON-NEGOTIABLE RULE: Idea owner cannot vote on their own idea
  if (idea.owner_id === voterId) {
    return {
      success: false,
      status: 403,
      error: 'Forbidden: Idea owners cannot vote on their own ideas'
    };
  }

  // Window Deadline check
  if (idea.voting_deadline) {
    const deadline = new Date(idea.voting_deadline);
    if (new Date() > deadline) {
      return { success: false, status: 400, error: 'Voting window for this idea has closed' };
    }
  }

  // Duplicate vote check
  const existingVote = queryOne(
    'SELECT id FROM votes WHERE idea_id = ? AND voter_id = ?',
    [ideaId, voterId]
  );
  if (existingVote) {
    return { success: false, status: 409, error: 'User has already voted on this idea' };
  }

  if (!['green', 'red'].includes(voteColor)) {
    return { success: false, status: 400, error: "vote_color must be either 'green' or 'red'" };
  }

  const scores = [scoreFeasibility, scoreMarket, scoreCapacity];
  for (const s of scores) {
    if (s !== null && (s < 0 || s > 10 || !Number.isInteger(s))) {
      return { success: false, status: 400, error: 'Scores must be integers between 0 and 10' };
    }
  }

  const voteId = crypto.randomUUID();
  execute(`
    INSERT INTO votes (
      id, idea_id, voter_id, score_feasibility, score_market, score_capacity,
      vote_color, comment, voted_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `, [
    voteId,
    ideaId,
    voterId,
    scoreFeasibility,
    scoreMarket,
    scoreCapacity,
    voteColor,
    comment ? comment.trim() : null
  ]);

  // Recalculate green percentage
  const totalRow = queryOne('SELECT COUNT(*) as total FROM votes WHERE idea_id = ?', [ideaId]);
  const greenRow = queryOne("SELECT COUNT(*) as green FROM votes WHERE idea_id = ? AND vote_color = 'green'", [ideaId]);

  const totalVotes = totalRow.total;
  const greenVotes = greenRow.green;
  const greenPercentage = Math.round(((greenVotes / totalVotes) * 100) * 100) / 100;

  execute(
    'UPDATE ideas SET green_percentage = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [greenPercentage, ideaId]
  );

  // Broadcast live green percentage update across all connected clients (Section 3.2 & Section 4.2)
  broadcastEvent('org:global', 'vote.cast', {
    ideaId,
    voterId,
    voteColor,
    greenPercentage,
    totalVotesCast: totalVotes,
    greenVotes
  });

  logAccess({
    userId: voterId,
    action: 'vote_cast',
    resource: `/api/ideas/${ideaId}/vote (color: ${voteColor})`,
    ipAddress
  });

  return {
    success: true,
    voteId,
    ideaId,
    voteColor,
    greenPercentage,
    totalVotesCast: totalVotes,
    greenVotes
  };
}

export function evaluateVotingDecision(ideaId, simulatedDate = null) {
  const summary = getIdeaVotingSummary(ideaId);
  const { idea, eligibleVoters, totalVotesCast, greenPercentage, participationRate, meeting } = summary;
  const { approvalThreshold, quorumPercentage } = getVotingConfig();

  if (idea.status !== 'PENDING_REVIEW') {
    return { action: 'ALREADY_DECIDED', status: idea.status };
  }

  // Step A: Quorum Check
  if (participationRate < quorumPercentage) {
    // If not extended yet, extend by 24 hours
    if (meeting && meeting.status !== 'EXTENDED') {
      const currentEnd = new Date(meeting.voting_window_end);
      const extendedEnd = new Date(currentEnd.getTime() + 24 * 60 * 60 * 1000).toISOString();

      execute(
        'UPDATE review_meetings SET status = ?, voting_window_end = ? WHERE id = ?',
        ['EXTENDED', extendedEnd, meeting.id]
      );
      execute(
        'UPDATE ideas SET voting_deadline = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [extendedEnd, ideaId]
      );

      logAccess({
        action: 'voting_window_extended',
        resource: `review_meeting:${meeting.id} (idea:${ideaId}) participation: ${participationRate}% < ${quorumPercentage}%`
      });

      return {
        action: 'EXTENDED',
        reason: `Quorum not met (${participationRate}% < ${quorumPercentage}%). Window extended 24 hours.`,
        newDeadline: extendedEnd,
        participationRate
      };
    }
  }

  // Step B: Decision Logic
  let newStatus;
  const safeGreen = Math.round(parseFloat(greenPercentage || 0) * 100) / 100;
  const safeThreshold = Math.round(parseFloat(approvalThreshold || 70.0) * 100) / 100;
  // Threshold is inclusive — exactly 70% = APPROVED, not undefined
  if (safeGreen >= safeThreshold) {
    newStatus = 'APPROVED';
  } else if (safeGreen >= 50.0) {
    newStatus = 'REVISE';
  } else {
    newStatus = 'REJECTED';
  }

  execute(
    'UPDATE ideas SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [newStatus, ideaId]
  );

  if (meeting) {
    execute(
      "UPDATE review_meetings SET status = 'COMPLETED' WHERE id = ?",
      [meeting.id]
    );
  }

  logAccess({
    action: `voting_decision_${newStatus.toLowerCase()}`,
    resource: `/api/ideas/${ideaId}/decision (green: ${greenPercentage}%, threshold: ${approvalThreshold}%)`
  });

  let projectData = null;
  if (newStatus === 'APPROVED') {
    projectData = triggerProjectFanout(ideaId);
    broadcastEvent('org:global', 'idea.approved', {
      ideaId,
      title: idea.title,
      greenPercentage
    });
    broadcastEvent('role:researcher', 'banner.new', {
      type: 'IDEA_APPROVED',
      title: 'Idea Approved by Supermajority',
      message: `"${idea.title}" was approved by team vote and has entered parallel fan-out!`,
      ideaId: idea.id,
      projectId: projectData?.project?.id
    });
    broadcastEvent('org:global', 'banner.new', {
      targetRole: 'researcher',
      type: 'IDEA_APPROVED',
      title: 'Idea Approved by Supermajority',
      message: `"${idea.title}" was approved by team vote and has entered parallel fan-out!`,
      ideaId: idea.id,
      projectId: projectData?.project?.id
    });
    createNotification({
      userId: idea.owner_id,
      eventType: 'idea.approved',
      message: `Your idea "${idea.title}" was approved with ${greenPercentage}% green votes!`,
      link: `/projects/${ideaId}`
    });
  }

  return {
    action: 'DECIDED',
    status: newStatus,
    greenPercentage,
    participationRate,
    project: projectData ? projectData.project : null
  };
}

export function adminOverrideDecision({ ideaId, adminUserId, decision, reason, ipAddress = null }) {
  const validDecisions = ['APPROVED', 'REVISE', 'REJECTED'];
  if (!decision || !validDecisions.includes(decision)) {
    return { success: false, status: 400, error: `decision must be one of: ${validDecisions.join(', ')}` };
  }

  // Reason is strictly mandatory
  if (!reason || typeof reason !== 'string' || !reason.trim()) {
    return { success: false, status: 400, error: 'A clear reason is strictly mandatory for Admin override/veto' };
  }

  const idea = queryOne('SELECT * FROM ideas WHERE id = ?', [ideaId]);
  if (!idea) {
    return { success: false, status: 404, error: 'Idea not found' };
  }

  execute(
    'UPDATE ideas SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [decision, ideaId]
  );

  execute(
    "UPDATE review_meetings SET status = 'COMPLETED' WHERE idea_id = ?",
    [ideaId]
  );

  logAccess({
    userId: adminUserId,
    action: 'admin_override_veto',
    resource: `/api/admin/ideas/${ideaId}/override (decision: ${decision}, reason: "${reason.trim()}")`,
    ipAddress
  });

  let projectData = null;
  if (decision === 'APPROVED') {
    projectData = triggerProjectFanout(ideaId, adminUserId);
    broadcastEvent('org:global', 'idea.approved', {
      ideaId,
      title: idea.title,
      greenPercentage: idea.green_percentage || 100.0
    });
    broadcastEvent('role:researcher', 'banner.new', {
      type: 'IDEA_APPROVED',
      title: 'Idea Approved by Supermajority',
      message: `"${idea.title}" was approved by team vote and has entered parallel fan-out!`,
      ideaId: idea.id,
      projectId: projectData?.project?.id
    });
    broadcastEvent('org:global', 'banner.new', {
      targetRole: 'researcher',
      type: 'IDEA_APPROVED',
      title: 'Idea Approved by Supermajority',
      message: `"${idea.title}" was approved by team vote and has entered parallel fan-out!`,
      ideaId: idea.id,
      projectId: projectData?.project?.id
    });
  }

  const updatedIdea = queryOne('SELECT * FROM ideas WHERE id = ?', [ideaId]);

  return {
    success: true,
    idea: updatedIdea,
    override: {
      decision,
      reason: reason.trim(),
      adminUserId
    },
    project: projectData ? projectData.project : null
  };
}
