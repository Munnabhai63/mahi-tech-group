/**
 * src/routes/automation.routes.js
 * Workflow Automation Engine REST API (PRD 26 — Layer 4)
 *
 * Implements 22 endpoints across Rules, Run Logs, Errors, Templates, AI Suggestions, Queue, and Stats.
 * Enforces:
 * 1. Admin+ only for all mutations (create, update, delete, toggle, test, approve, reject).
 * 2. Non-admin members can only view rules and run logs that affected/were triggered by them.
 * 3. Dry-run endpoint (/rule/:ruleId/test) strictly simulates without any DB mutation.
 * 4. System templates (is_system_template=1) cannot be deleted.
 * 5. AI suggestion endpoints: suggestion-only, never auto-execute.
 * 6. Admin actions audited in access_log.
 * 7. Static route paths registered before parameterized /:id routes.
 */

import express from 'express';
import { authenticate } from '../middleware/auth.js';
import * as automationService from '../services/automationService.js';

const router = express.Router();

/**
 * Standard error formatter for automation service exceptions
 */
function handleServiceError(res, err) {
  if (err && err.status) {
    return res.status(err.status).json({ error: err.message });
  }
  const msg = err?.message || 'An unexpected automation error occurred';
  if (msg.toLowerCase().includes('not found')) {
    return res.status(404).json({ error: msg });
  }
  if (msg.includes('Forbidden') || msg.includes('Admin privilege required') || msg.includes('permission')) {
    return res.status(403).json({ error: msg });
  }
  if (msg.includes('Unauthorized')) {
    return res.status(401).json({ error: msg });
  }
  return res.status(400).json({ error: msg });
}

// ===================================================================
// 1. AUTOMATION RULE ROUTES
// ===================================================================

/**
 * 1. POST /api/automation/rule/create
 * Body: { name, description, project_id, scope, trigger_module, trigger_event, trigger_conditions, condition_logic, actions }
 * Role: Admin+
 */
router.post('/rule/create', authenticate, (req, res) => {
  try {
    const created = automationService.createRule(req.body || {}, req.user, req.ip);
    return res.status(201).json(created);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * 2. GET /api/automation/rules
 * Query: ?project_id=&scope=&is_active=&trigger_module=
 * Role: Admin+ sees all rules; members see rules that affected them
 */
router.get('/rules', authenticate, (req, res) => {
  try {
    const rules = automationService.getRules(req.query || {}, req.user);
    return res.status(200).json(rules);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * 3. POST /api/automation/rule/:ruleId/test
 * Body: { mock_trigger_data }
 * Dry-run simulation: evaluates conditions & resolves actions without DB mutation
 * Role: Admin+
 */
router.post('/rule/:ruleId/test', authenticate, (req, res) => {
  try {
    const { ruleId } = req.params;
    const { mock_trigger_data } = req.body || {};
    const simulation = automationService.testRuleDryRun(
      Number(ruleId),
      mock_trigger_data || {},
      req.user,
      req.ip
    );
    return res.status(200).json(simulation);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * 4. PATCH /api/automation/rule/:ruleId/toggle
 * Body: { is_active }
 * Role: Admin+
 */
router.patch('/rule/:ruleId/toggle', authenticate, (req, res) => {
  try {
    const { ruleId } = req.params;
    const { is_active } = req.body || {};
    const updated = automationService.toggleRule(Number(ruleId), is_active, req.user, req.ip);
    return res.status(200).json(updated);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * 5. GET /api/automation/rule/:ruleId
 * Returns: Rule detail + last 10 run logs + unacknowledged error count
 * Role: Admin+ (or member if rule affected them)
 */
router.get('/rule/:ruleId', authenticate, (req, res) => {
  try {
    const { ruleId } = req.params;
    const rule = automationService.getRuleDetail(Number(ruleId), req.user);
    return res.status(200).json(rule);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * 6. PATCH /api/automation/rule/:ruleId
 * Body: any editable rule field
 * Role: Admin+
 */
router.patch('/rule/:ruleId', authenticate, (req, res) => {
  try {
    const { ruleId } = req.params;
    const updated = automationService.updateRule(Number(ruleId), req.body || {}, req.user, req.ip);
    return res.status(200).json(updated);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * 7. DELETE /api/automation/rule/:ruleId
 * Role: Admin+
 */
router.delete('/rule/:ruleId', authenticate, (req, res) => {
  try {
    const { ruleId } = req.params;
    const result = automationService.deleteRule(Number(ruleId), req.user, req.ip);
    return res.status(200).json(result);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

// ===================================================================
// 2. RUN LOG & HISTORY ROUTES
// ===================================================================

/**
 * 8. GET /api/automation/logs
 * Query: ?automation_id=&status=&from=&to=&project_id=
 * Role: Admin+ (members only see runs they triggered)
 */
router.get('/logs', authenticate, (req, res) => {
  try {
    const logs = automationService.getRunLogs(req.query || {}, req.user);
    return res.status(200).json(logs);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * 9. GET /api/automation/log/:runLogId
 * Returns: Full run log detail (conditions evaluated, actions executed, variables resolved, errors)
 * Role: Admin+ (or member if triggered by them)
 */
router.get('/log/:runLogId', authenticate, (req, res) => {
  try {
    const { runLogId } = req.params;
    const log = automationService.getRunLogDetail(Number(runLogId), req.user);
    return res.status(200).json(log);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

// ===================================================================
// 3. ERROR ROUTES
// ===================================================================

/**
 * 10. GET /api/automation/errors
 * Query: ?automation_id=&acknowledged=
 * Role: Admin+
 */
router.get('/errors', authenticate, (req, res) => {
  try {
    const errors = automationService.getErrors(req.query || {}, req.user);
    return res.status(200).json(errors);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * 11. PATCH /api/automation/error/:errorId/acknowledge
 * Role: Admin+
 */
router.patch('/error/:errorId/acknowledge', authenticate, (req, res) => {
  try {
    const { errorId } = req.params;
    const ack = automationService.acknowledgeError(Number(errorId), req.user, req.ip);
    return res.status(200).json(ack);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * 12. PATCH /api/automation/error/:errorId/retry
 * Re-queues failed automation run (max 3 attempts)
 * Role: Admin+
 */
router.patch('/error/:errorId/retry', authenticate, (req, res) => {
  try {
    const { errorId } = req.params;
    const retry = automationService.retryError(Number(errorId), req.user, req.ip);
    return res.status(200).json(retry);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

// ===================================================================
// 4. TEMPLATE ROUTES
// ===================================================================

/**
 * 13. GET /api/automation/templates
 * Query: ?category=
 * Role: Admin+
 */
router.get('/templates', authenticate, (req, res) => {
  try {
    const { category } = req.query || {};
    const templates = automationService.getTemplates(category, req.user);
    return res.status(200).json(templates);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * 14. POST /api/automation/template/save
 * Body: { name, description, category, trigger_module, trigger_event, trigger_conditions, actions }
 * Role: Admin+
 */
router.post('/template/save', authenticate, (req, res) => {
  try {
    const saved = automationService.saveTemplate(req.body || {}, req.user, req.ip);
    return res.status(201).json(saved);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * 15. POST /api/automation/template/:templateId/use
 * Body: { project_id, name }
 * Role: Admin+
 */
router.post('/template/:templateId/use', authenticate, (req, res) => {
  try {
    const { templateId } = req.params;
    const createdRule = automationService.useTemplate(Number(templateId), req.body || {}, req.user, req.ip);
    return res.status(201).json(createdRule);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * 16. DELETE /api/automation/template/:templateId
 * Role: Admin+ (system templates cannot be deleted)
 */
router.delete('/template/:templateId', authenticate, (req, res) => {
  try {
    const { templateId } = req.params;
    const result = automationService.deleteTemplate(Number(templateId), req.user, req.ip);
    return res.status(200).json(result);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

// ===================================================================
// 5. AI SUGGESTION ROUTES
// ===================================================================

/**
 * 17. GET /api/automation/suggestions
 * Returns all AI suggestions with status PENDING
 * Role: Admin+
 */
router.get('/suggestions', authenticate, (req, res) => {
  try {
    const suggestions = automationService.getSuggestions(req.user);
    return res.status(200).json(suggestions);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * 18. PATCH /api/automation/suggestion/:suggestionId/approve
 * Creates rule from suggestion; suggestion-only, never auto-executes
 * Role: Admin+
 */
router.patch('/suggestion/:suggestionId/approve', authenticate, (req, res) => {
  try {
    const { suggestionId } = req.params;
    const result = automationService.approveSuggestion(Number(suggestionId), req.user, req.ip);
    return res.status(200).json(result);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * 19. PATCH /api/automation/suggestion/:suggestionId/reject
 * Body: { rejection_reason }
 * Role: Admin+
 */
router.patch('/suggestion/:suggestionId/reject', authenticate, (req, res) => {
  try {
    const { suggestionId } = req.params;
    const { rejection_reason } = req.body || {};
    const result = automationService.rejectSuggestion(Number(suggestionId), rejection_reason, req.user, req.ip);
    return res.status(200).json(result);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

// ===================================================================
// 6. QUEUE ROUTES
// ===================================================================

/**
 * 20. GET /api/automation/queue
 * Query: ?status=&automation_id=
 * Role: Admin+
 */
router.get('/queue', authenticate, (req, res) => {
  try {
    const queue = automationService.getQueue(req.query || {}, req.user);
    return res.status(200).json(queue);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

// ===================================================================
// 7. STATS ROUTES (Static project subpath before generic /stats)
// ===================================================================

/**
 * 21. GET /api/automation/stats/project/:projectId
 * Returns: project-level automation stats
 * Role: Admin+
 */
router.get('/stats/project/:projectId', authenticate, (req, res) => {
  try {
    const { projectId } = req.params;
    const stats = automationService.getProjectStats(Number(projectId), req.user);
    return res.status(200).json(stats);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

/**
 * 22. GET /api/automation/stats
 * Returns: global automation engine stats
 * Role: Admin+
 */
router.get('/stats', authenticate, (req, res) => {
  try {
    const stats = automationService.getStats(req.user);
    return res.status(200).json(stats);
  } catch (err) {
    return handleServiceError(res, err);
  }
});

export default router;
