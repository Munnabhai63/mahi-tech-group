# PRD 17 — GitHub Automation Architecture

## Overview
PRD 17 delivers enterprise-grade GitHub App automation for the Mahi Tech Group internal platform. It automates repository provisioning, GitFlow branch branching (`main` → `develop` → 4 role feature branches), role-based sub-team permission mapping, branch protection policies, immutable contributor attribution, and real-time webhook ingestion. A GitHub App was selected over OAuth Apps or Personal Access Tokens (PAT) to guarantee organizational identity persistence, fine-grained repository permissions, ephemeral 1-hour installation access tokens with in-memory caching, and cryptographic HMAC-SHA256 webhook verification.

---

## Architecture Decision

**GitHub App (not OAuth / PAT):**
- **Fine-grained permissions (least privilege)**: Repository administration, team management, and pull request events are constrained strictly to the organization scope without granting broad personal account privileges.
- **Short-lived installation tokens (1-hour, auto-refresh)**: Exchanges RS256 JWTs (`iss = GITHUB_APP_ID`, expiry max 10m) for 1-hour Installation Access Tokens cached in-memory with a 60-second validity guard. Tokens are refreshed automatically.
- **Org-scoped identity (survives installer leaving)**: All repositories and teams belong to the organization (`mahitechgroup`), preventing orphan project risk if an individual developer or admin departs.
- **Webhook HMAC-SHA256 signature verification**: Inbound GitHub deliveries are validated using `crypto.timingSafeEqual()` against raw request buffers prior to JSON parsing, preventing tampering and timing attacks.

---

## New DB Tables (4)

1. `user_github_links`
   - Stores 1-to-1 mapping between platform users and their GitHub identity.
   - Columns: `id`, `user_id` (REFERENCES `users(id)`), `github_username`, `github_node_id`, `linked_at`, `linked_by`.
   - Index: `idx_user_github_links_user_id`.

2. `project_github_repos`
   - Tracks provisioned GitHub repositories and lifecycle status.
   - Columns: `id`, `project_id` (REFERENCES `projects(id)`), `github_repo_id`, `repo_name`, `repo_full_name`, `repo_url`, `default_branch` (default `'main'`), `status` (`CHECK(status IN ('PENDING','ACTIVE','ARCHIVED','FAILED'))`), `created_at`, `updated_at`, `archived_at`.
   - Indexes: `idx_project_github_repos_project_id`, `idx_project_github_repos_status`.

3. `project_github_memberships`
   - Enforces unique assignment per project and permanently preserves contributor history.
   - Constraint: `UNIQUE(project_id, user_id)`.
   - Columns: `id`, `project_id` (REFERENCES `projects(id)`), `user_id` (REFERENCES `users(id)`), `github_username`, `role` (`CHECK(role IN ('researcher','designer','developer','tester','lead','admin'))`), `team_slug`, `status` (`CHECK(status IN ('ACTIVE','REMOVED'))`), `added_at`, `removed_at`, `removed_reason`.
   - Attribution rule: Status transitions to `REMOVED` with `removed_reason` (min 10 chars); rows are **NEVER deleted**.
   - Indexes: `idx_proj_gh_memberships_project_id`, `idx_proj_gh_memberships_user_id`, `idx_proj_gh_memberships_status`.

4. `github_webhook_log`
   - Append-only delivery log for all inbound GitHub webhook events.
   - Columns: `id`, `delivery_id` (UNIQUE), `event_type`, `action`, `repo_full_name`, `sender_login`, `payload` (TEXT NOT NULL), `signature_valid` (`CHECK(signature_valid IN (0,1))`), `processed` (`CHECK(processed IN (0,1))`), `error_message`, `received_at`.
   - Indexes: `idx_gh_webhook_log_event_type`, `idx_gh_webhook_log_received_at`, `idx_gh_webhook_log_processed`.

---

## New DB Triggers (2)

1. `prevent_webhook_log_update`
   - Enforces append-only immutability on `github_webhook_log` with the Decision 11 exception: only `processed` and `error_message` are mutable by asynchronous background processors.
   - Blocks any modification to `delivery_id`, `event_type`, `payload`, `signature_valid`, or `received_at`.
   ```sql
   CREATE TRIGGER IF NOT EXISTS prevent_webhook_log_update
   BEFORE UPDATE ON github_webhook_log
   WHEN OLD.delivery_id != NEW.delivery_id
     OR OLD.event_type != NEW.event_type
     OR OLD.payload != NEW.payload
     OR OLD.signature_valid != NEW.signature_valid
     OR OLD.received_at != NEW.received_at
   BEGIN
     SELECT RAISE(ABORT, 'github_webhook_log is append-only: only processed and error_message fields are mutable');
   END;
   ```

2. `prevent_webhook_log_delete`
   - Unconditionally prevents deletion of any row in `github_webhook_log`.
   ```sql
   CREATE TRIGGER IF NOT EXISTS prevent_webhook_log_delete
   BEFORE DELETE ON github_webhook_log
   BEGIN
     SELECT RAISE(ABORT, 'github_webhook_log rows cannot be deleted');
   END;
   ```

---

## New Backend Files

1. `src/config/github.config.js`
   - Validates required environment variables on startup (`GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY_PATH`, `GITHUB_WEBHOOK_SECRET` >= 32 chars, `GITHUB_ORG_NAME`).
   - Securely reads RSA private key file without exposing secrets in logs or errors. Returns frozen configuration.

2. `src/services/githubAutomation.service.js`
   - Implements 12 core automation functions:
     - `generateJWT()`: Signs short-lived RS256 JWT (10m max exp, 60s clock skew).
     - `getInstallationToken()`: Exchanges JWT for installation token; caches in-memory with 60s validity buffer.
     - `getAuthedOctokit()`: Returns authenticated `@octokit/rest` instance.
     - `createProjectRepo(projectId, projectName)`: Sanitizes repo name (`mahi-<slug>`, max 50 chars), calls GitHub API, persists row in `project_github_repos`.
     - `createGitFlowBranches(repoFullName)`: Provisions `develop` from `main`, then `feature/research`, `feature/design`, `feature/dev`, and `feature/test` from `develop`.
     - `createProjectTeams(projectId, repoFullName)`: Creates 6 role teams (`mahi-<repo>-<role>`) and binds repo permissions.
     - `setBranchProtection(repoFullName)`: Locks `main` (PR review required, stale review dismissal, admin enforcement, no force push, no deletion) and `develop` (PR required, no force push).
     - `addMemberToTeam(projectId, userId, role)`: Verifies user GitHub link, adds user to GitHub team, logs audit trail, records `ACTIVE` row in `project_github_memberships`.
     - `removeMemberFromTeam(projectId, userId, reason)`: Removes user from GitHub team, updates status to `REMOVED`, preserves permanent attribution row, logs audit.
     - `linkUserGitHub(userId, username, nodeId, linkedBy)`: Maps platform user to GitHub account and logs `GITHUB_ACCOUNT_LINKED`.
     - `archiveProjectRepo(projectId)`: Archives GitHub repository, updates DB to `ARCHIVED`, logs `GITHUB_REPO_ARCHIVED`.
     - `setupProjectGitHub(projectId, projectName)`: Sequential orchestrator executing steps 1–4 with rollback to `FAILED` on error.

3. `src/services/githubWebhookProcessor.js`
   - Asynchronous event router handling 5 webhook event categories:
     - `push`: Dispatches platform notifications to Project Leads and Admins.
     - `pull_request` (opened/closed/merged): Creates platform notifications for leads/admins with direct PR URLs.
     - `member` (added/removed): Synchronizes `project_github_memberships` and logs audit events.
     - `repository` (archived/deleted): Updates `project_github_repos` status and alerts admins.
     - `default`: Acknowledges unhandled events cleanly.

4. `src/middleware/githubWebhookVerify.js`
   - Express middleware enforcing cryptographic HMAC-SHA256 signature verification over raw request buffers.
   - Compares signatures using constant-time `crypto.timingSafeEqual()`.
   - Records invalid signature attempts in `github_webhook_log` (`signature_valid = 0`) for security auditing.

5. `src/routes/githubWebhook.routes.js`
   - Mounts `POST /api/github/webhook`.
   - Validates delivery, enforces idempotency on `delivery_id`, records to append-only log, returns HTTP 200 immediately, and triggers non-blocking asynchronous event processing.

6. `src/routes/githubSettings.routes.js`
   - Mounts 9 REST API endpoints under `/api/github/settings` for user linking, project setup, team membership management, and webhook audit log inspection.

---

## GitFlow Branch Structure (per project)

Each provisioned project repository follows strict GitFlow architecture:

```
main (production-ready code, strict branch protection)
  └── develop (integration branch, PR required)
        ├── feature/research (Research deliverables & findings)
        ├── feature/design   (UI/UX prototypes & specifications)
        ├── feature/dev      (Backend/frontend implementation)
        └── feature/test     (QA test suites & verification)
```

---

## Per-Role GitHub Teams (per project)

Each project provisions 6 closed sub-teams under the GitHub organization with granular permissions:

| Role        | Team Slug Pattern              | Permission Level | Access Scope                             |
|-------------|--------------------------------|------------------|------------------------------------------|
| researcher  | `mahi-<project>-researcher`    | `push`           | Write to `feature/research`              |
| designer    | `mahi-<project>-designer`      | `push`           | Write to `feature/design`                |
| developer   | `mahi-<project>-developer`     | `push`           | Write to `feature/dev`                   |
| tester      | `mahi-<project>-tester`        | `push`           | Write to `feature/test`                  |
| lead        | `mahi-<project>-lead`          | `maintain`       | Manage branch merges, PR reviews         |
| admin       | `mahi-<project>-admin`         | `admin`          | Full repository settings & access control|

---

## Branch Protection Rules

### `main` Branch
- Required pull request reviews before merging: `1`
- Dismiss stale pull request approvals when new commits are pushed: `true`
- Enforce restrictions for administrators: `true`
- Allow force pushes: `false`
- Allow branch deletions: `false`

### `develop` Branch
- Required pull request reviews before merging: `1`
- Dismiss stale pull request approvals: `false`
- Enforce restrictions for administrators: `false`
- Allow force pushes: `false`
- Allow branch deletions: `true`

---

## Webhook Events Handled

1. **`push`**
   - Parses pusher name, commit count, target branch, and compare URL.
   - Dispatches platform notification to Project Owner, Project Leads, and Platform Admins.

2. **`pull_request` (opened, closed, merged)**
   - `opened`: Alerts leads and admins with author and branch details.
   - `closed` (unmerged): Logs pull request closure.
   - `closed` (merged): Alerts team that changes have been merged into target branch.

3. **`member` (added, removed)**
   - Synchronizes `project_github_memberships` in the database.
   - On removal, sets `status = 'REMOVED'` preserving attribution history.

4. **`repository` (archived, deleted)**
   - `archived`: Updates `project_github_repos.status = 'ARCHIVED'` and sets `archived_at`.
   - `deleted`: Updates status to `'FAILED'` and dispatches high-priority warning to Admins.

---

## Frontend Views (4)

1. **GitHub Account Linking (`/github-link.html`)**
   - Self-linking card with status badge (Connected / Not Linked).
   - Form fields: GitHub username, GitHub Node ID (with explanatory helper tooltip).
   - Admin-only section: Allows admins to link accounts on behalf of team members.
   - Controller: `public/js/github-link.js`.

2. **Project Repo Panel (`/github-repo-panel.html`)**
   - Embedded into project workspace under the "GitHub" tab.
   - Status badge: `ACTIVE`, `PENDING`, `ARCHIVED`, or `FAILED`.
   - Direct external link: "Open on GitHub" (`target="_blank" rel="noopener noreferrer"`).
   - GitFlow architecture visualizer and branch protection summary.
   - Admin modal: "Initialize GitHub Repository" with loading spinner and error feedback.
   - Controller: `public/js/github-repo-panel.js`.

3. **GitHub Team Members Admin (`/github-members.html`)**
   - Admin-only table listing all GitHub team memberships for a project.
   - Columns: User, Role, GitHub Username, Team Slug, Status (`ACTIVE` or `REMOVED`), Added Date.
   - Add Member form: Filters candidates to project members with linked GitHub accounts.
   - Remove Member modal: Requires mandatory removal reason ($\ge 10$ characters); updates status to `REMOVED` without deleting data.
   - Controller: `public/js/github-members.js`.

4. **Webhook Activity Log (`/github-webhook-log.html`)**
   - Admin-only real-time audit log with 30-second live polling.
   - Filter dropdown: All Events, push, pull_request, member, repository, invalid_signature.
   - Metadata columns: Delivery ID, Event Type, Action, Repository, Sender, Signature Status, Processed Status, Timestamp.
   - Security guarantee: Raw payload column is strictly excluded from all API responses.
   - Controller: `public/js/github-webhook-log.js`.

---

## API Routes (10 Total)

| Method | Path                                                  | Auth Requirement     | Description                                           |
|--------|-------------------------------------------------------|----------------------|-------------------------------------------------------|
| `POST` | `/api/github/webhook`                                 | HMAC-SHA256 Signature| Ingests GitHub webhook deliveries (raw body HMAC)     |
| `POST` | `/api/github/settings/link-account`                   | Authenticated Member | Links caller's user account to their GitHub identity  |
| `GET`  | `/api/github/settings/my-link`                        | Authenticated Member | Fetches caller's linked GitHub account details        |
| `POST` | `/api/github/settings/admin/link-member`              | Platform Admin       | Links member's GitHub account on their behalf         |
| `GET`  | `/api/github/settings/projects/:projectId/repo`       | Project Member/Admin | Retrieves project repository metadata and status      |
| `GET`  | `/api/github/settings/projects/:projectId/members`    | Platform Admin       | Lists all team memberships (active + removed)         |
| `POST` | `/api/github/settings/projects/:projectId/members/:userId/add` | Platform Admin | Adds member to project GitHub role sub-team          |
| `DELETE`| `/api/github/settings/projects/:projectId/members/:userId`    | Platform Admin | Removes member with $\ge 10$-char reason (attribution)|
| `GET`  | `/api/github/settings/webhook-log`                    | Platform Admin       | Paginated webhook delivery log (payload stripped)     |
| `POST` | `/api/github/settings/projects/:projectId/setup`      | Platform Admin       | Full GitHub setup orchestrator (repo, branches, teams)|

---

## Security Properties

- **`crypto.timingSafeEqual()`**: Protects webhook signature comparisons against timing attacks. Length differences are rejected safely before calling `timingSafeEqual`.
- **Raw Body HMAC Verification**: `express.raw({ type: 'application/json' })` parses the exact byte stream before any JSON parsing, preventing parser mutation discrepancies.
- **Audit Logging for Invalid Signatures**: All invalid signature deliveries are captured in `github_webhook_log` (`signature_valid = 0`) to record attack attempts.
- **Payload Stripping**: The `payload` column is omitted from all SQL queries in `/api/github/settings/webhook-log`, blocking client leakage of commit diffs, tokens, or private code snippets.
- **Private Key Isolation**: The RSA private key is loaded into memory on process startup, never written to disk logs, and never returned via API routes.
- **In-Memory Token Cache**: Installation tokens are held in-memory with a 60s expiration guard and never written to database tables.
- **Permanent Attribution**: Removed members transition to `status = 'REMOVED'` in `project_github_memberships`; records are never deleted.
- **Server-Side RBAC**: Roles and user identities are derived strictly from verified JWT claims (`req.user.id`, `req.user.role`); client localStorage values are never trusted.

---

## Decisions Log Reference

- **Decision 10**: GitHub App Architecture, In-Memory Token Caching & Attribution Preservation (see [`docs/decisions.md`](file:///f:/UserData/Downloads/MAHI%20TECH%20GROUP/docs/decisions.md#L100-L109)).
- **Decision 11**: Webhook Ingestion Append-Only Trigger & State Transition Exception (see [`docs/decisions.md`](file:///f:/UserData/Downloads/MAHI%20TECH%20GROUP/docs/decisions.md#L110-L118)).

---

## Test Coverage

PRD 17 test suites verify every layer from schema triggers to end-to-end integration:

| Suite File                                | Scope                                                      | Assertions |
|-------------------------------------------|------------------------------------------------------------|------------|
| `scripts/verify-prd17-batch1.js`          | Schema, Tables, Append-Only Triggers, FKs, Config Loader   | 20 / 20    |
| `scripts/verify-prd17-batch2.js`          | Octokit Auth, Token Cache, Service Functions, Orchestrator | 26 / 26    |
| `scripts/verify-prd17-batch3.js`          | Webhook Verification, HMAC-SHA256, Async Event Handlers    | 25 / 25    |
| `scripts/verify-prd17-batch4.js`          | Frontend Views, 9 REST API Routes, Access Control          | 32 / 32    |
| `scripts/verify-prd17-batch5-integration.js`| Real-world End-to-End Usage Lifecycle (Phases A–H)       | 54 / 54    |
| **Total PRD 17 Assertions**               | **All 5 Batches Complete**                                 | **157 / 157** |
| **Total Full Platform Regression**        | **All 13 Suites Across PRD 15, 16, 17**                    | **469 / 469** |

---

## Commit Hash

- **PRD 17 Feature Seal**: `6558f93`
- **Documentation & Summary Seal**: `ac05852`
