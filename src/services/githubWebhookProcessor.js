import crypto from 'node:crypto';
import { queryOne, queryAll, execute } from '../db/database.js';
import { createNotification } from './notificationService.js';

/**
 * Retrieves recipient user IDs (Leads and Admins) for a given project
 */
function getProjectLeadsAndAdmins(projectId) {
  const recipients = new Set();

  if (projectId) {
    const project = queryOne('SELECT owner_id FROM projects WHERE id = ?', [projectId]);
    if (project?.owner_id) {
      recipients.add(project.owner_id);
    }

    const leads = queryAll(`
      SELECT user_id FROM project_members
      WHERE project_id = ? AND role_in_project IN ('lead', 'admin_reviewer', 'admin')
    `, [projectId]);
    leads.forEach((l) => recipients.add(l.user_id));
  }

  const admins = queryAll("SELECT id FROM users WHERE status = 'active' AND (role = 'admin' OR sub_role = 'admin')");
  admins.forEach((a) => recipients.add(a.id));

  return Array.from(recipients);
}

/**
 * Core event processing router for GitHub webhook deliveries.
 * Runs asynchronously after the immediate HTTP 200 is acknowledged.
 */
export async function processWebhookEvent(eventType, action, payload = {}, logId = null) {
  try {
    const repoFullName = payload.repository?.full_name;
    const repo = repoFullName
      ? queryOne('SELECT * FROM project_github_repos WHERE repo_full_name = ? ORDER BY rowid DESC', [repoFullName])
      : null;
    const projectId = repo?.project_id || null;

    let projectName = repo?.repo_name || repoFullName || 'Project';
    if (projectId) {
      const proj = queryOne('SELECT title FROM projects WHERE id = ?', [projectId]);
      if (proj?.title) {
        projectName = proj.title;
      }
    }

    switch (eventType) {
      case 'push': {
        if (repo && projectId) {
          const branchRef = payload.ref || '';
          const branch = branchRef.replace(/^refs\/heads\//, '') || 'main';
          const pusher = payload.pusher?.name || payload.sender?.login || 'Contributor';
          const commits = Array.isArray(payload.commits) ? payload.commits : [];
          const commitCount = commits.length;
          const compareUrl = payload.compare || payload.repository?.html_url || '';

          const message = `${pusher} pushed ${commitCount} commit(s) to ${branch} in project '${projectName}'`;
          const recipients = getProjectLeadsAndAdmins(projectId);

          for (const userId of recipients) {
            try {
              createNotification({
                userId,
                eventType: 'github_push',
                message,
                link: compareUrl,
              });
            } catch (err) {
              console.error(`Failed to dispatch push notification to ${userId}:`, err.message);
            }
          }
        }
        break;
      }

      case 'pull_request': {
        if (repo && projectId && action) {
          const pr = payload.pull_request || {};
          const title = pr.title || 'Pull Request';
          const htmlUrl = pr.html_url || payload.repository?.html_url || '';
          const login = pr.user?.login || payload.sender?.login || 'Contributor';
          const baseBranch = pr.base?.ref || 'main';
          const isMerged = Boolean(pr.merged);

          let notifType = `github_pr_${action}`;
          let message = `PR '${title}' ${action} by ${login} → ${baseBranch}`;

          if (action === 'closed' && isMerged) {
            notifType = 'github_pr_merged';
            message = `PR '${title}' MERGED into ${baseBranch} by ${login}`;
          }

          if (action === 'opened' || action === 'closed') {
            const recipients = getProjectLeadsAndAdmins(projectId);
            for (const userId of recipients) {
              try {
                createNotification({
                  userId,
                  eventType: notifType,
                  message,
                  link: htmlUrl,
                });
              } catch (err) {
                console.error(`Failed to dispatch PR notification to ${userId}:`, err.message);
              }
            }
          }
        }
        break;
      }

      case 'member': {
        const memberLogin = payload.member?.login || payload.sender?.login;
        if (repo && projectId && memberLogin) {
          const link = queryOne(`
            SELECT ugl.user_id, ugl.github_username
            FROM user_github_links ugl
            JOIN project_github_memberships pgm ON ugl.user_id = pgm.user_id
            WHERE ugl.github_username = ? AND pgm.project_id = ?
          `, [memberLogin, projectId]) || queryOne('SELECT user_id, github_username FROM user_github_links WHERE github_username = ?', [memberLogin]);

          if (link) {
            if (action === 'added') {
              // Verify membership and log confirmation audit
              execute(`
                INSERT INTO access_log (id, user_id, action, resource, target_id, timestamp, created_at)
                VALUES (?, ?, 'GITHUB_WEBHOOK_MEMBER_ADDED', ?, ?, datetime('now'), datetime('now'))
              `, [
                crypto.randomUUID(),
                link.user_id,
                JSON.stringify({ projectId, userId: link.user_id, githubUsername: memberLogin, action: 'member_added' }),
                link.user_id,
              ]);
            } else if (action === 'removed') {
              const activeMembership = queryOne(`
                SELECT id FROM project_github_memberships
                WHERE project_id = ? AND user_id = ? AND status = 'ACTIVE'
              `, [projectId, link.user_id]);

              if (activeMembership) {
                const { removeMemberFromTeam } = await import('./githubAutomation.service.js');
                await removeMemberFromTeam(projectId, link.user_id, 'Removed via GitHub webhook');
              }
            }
          }
        }
        break;
      }

      case 'repository': {
        if (repo && projectId) {
          if (action === 'archived') {
            execute(`
              UPDATE project_github_repos
              SET status = 'ARCHIVED',
                  archived_at = datetime('now'),
                  updated_at = datetime('now')
              WHERE project_id = ? AND status != 'ARCHIVED'
            `, [projectId]);

            execute(`
              INSERT INTO access_log (id, user_id, action, resource, target_id, timestamp, created_at)
              VALUES (?, NULL, 'GITHUB_REPO_ARCHIVED', ?, ?, datetime('now'), datetime('now'))
            `, [crypto.randomUUID(), JSON.stringify({ projectId, repoFullName: repo.repo_full_name, source: 'webhook' }), projectId]);
          } else if (action === 'deleted') {
            execute(`
              UPDATE project_github_repos
              SET status = 'FAILED',
                  updated_at = datetime('now')
              WHERE project_id = ?
            `, [projectId]);

            const admins = queryAll("SELECT id FROM users WHERE status = 'active' AND (role = 'admin' OR sub_role = 'admin')");
            for (const admin of admins) {
              try {
                createNotification({
                  userId: admin.id,
                  eventType: 'github_repo_deleted',
                  message: `⚠️ GitHub repo for project '${projectName}' was DELETED on GitHub. Manual recovery required.`,
                  link: null,
                });
              } catch (err) {}
            }
          }
        }
        break;
      }

      default: {
        // Unhandled event types are acknowledged without error
        break;
      }
    }

    if (logId) {
      execute('UPDATE github_webhook_log SET processed = 1 WHERE id = ?', [logId]);
    }

    return { success: true, processed: true };
  } catch (err) {
    console.error('[GitHub Webhook Processor Error]:', err.message);
    if (logId) {
      try {
        execute('UPDATE github_webhook_log SET error_message = ? WHERE id = ?', [err.message, logId]);
      } catch (e) {}
    }
    throw err;
  }
}

export default {
  processWebhookEvent,
};
