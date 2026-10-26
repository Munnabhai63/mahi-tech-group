| METHOD | Full Path | Auth Middleware | Handler File |
|---|---|---|---|
| `GET` | `/api/activity/recent` | authenticate | `src/routes/dashboard.js` |
| `GET` | `/api/admin/access-logs` | authenticate, requireRole('admin') | `src/routes/admin.js` |
| `PATCH` | `/api/admin/applications/:id/decide` | authenticate, requireRole('admin'), requirePermission('application.review') | `src/routes/admin.js` |
| `GET` | `/api/admin/applications/pending` | authenticate, requireRole('admin'), requirePermission('application.review') | `src/routes/admin.js` |
| `GET` | `/api/admin/config` | authenticate, requireRole('admin') | `src/routes/admin.js` |
| `PATCH` | `/api/admin/config/general` | authenticate, requireRole('admin') | `src/routes/admin.js` |
| `PATCH` | `/api/admin/config/quota` | authenticate, requireRole('admin') | `src/routes/admin.js` |
| `PATCH` | `/api/admin/config/voting` | authenticate, requireRole('admin') | `src/routes/admin.js` |
| `GET` | `/api/admin/corners-overview` | authenticate, requireRole('admin') | `src/routes/admin.js` |
| `GET` | `/api/admin/dashboard/overview` | authenticate, requireRole('admin') | `src/routes/admin.js` |
| `GET` | `/api/admin/ideas/:id/history` | authenticate, requireRole('admin') | `src/routes/admin.js` |
| `PATCH` | `/api/admin/ideas/:id/override` | authenticate, requireRole('admin') | `src/routes/admin.js` |
| `GET` | `/api/admin/meetings` | authenticate, requireRole('admin') | `src/routes/admin.js` |
| `PATCH` | `/api/admin/meetings/:id/notes/confirm` | authenticate, requireRole('admin') | `src/routes/admin.js` |
| `GET` | `/api/admin/members` | authenticate, requireRole('admin'), requirePermission('member.add') | `src/routes/admin.js` |
| `PATCH` | `/api/admin/members/:id` | authenticate, requireRole('admin') | `src/routes/admin.js` |
| `POST` | `/api/admin/members/:id/offboard` | authenticate, requireRole('admin'), requirePermission('member.remove') | `src/routes/admin.js` |
| `PATCH` | `/api/admin/members/:id/status` | authenticate, requireRole('admin'), requirePermission('member.remove') | `src/routes/admin.js` |
| `POST` | `/api/admin/members/add` | authenticate, requireRole('admin'), requirePermission('member.add') | `src/routes/admin.js` |
| `PATCH` | `/api/admin/offboarding/:id/checklist` | authenticate, requireRole('admin'), requirePermission('member.remove') | `src/routes/admin.js` |
| `GET` | `/api/admin/offboarding/:id/status` | authenticate, requireRole('admin'), requirePermission('member.remove') | `src/routes/admin.js` |
| `GET` | `/api/admin/offboarding/history` | authenticate, requireRole('admin'), requirePermission('member.remove') | `src/routes/admin.js` |
| `PATCH` | `/api/admin/projects/:id/final-review` | authenticate, requireRole('admin') | `src/routes/admin.js` |
| `PATCH` | `/api/admin/projects/:id/members/:memberId/weight` | authenticate, requireRole('admin'), requirePermission('project.launch_approve') | `src/routes/admin.js` |
| `PATCH` | `/api/admin/projects/:id/reassign` | authenticate, requireRole('admin') | `src/routes/admin.js` |
| `POST` | `/api/admin/projects/:id/revenue` | authenticate, requireRole('admin'), requirePermission('revenue.manual_entry') | `src/routes/admin.js` |
| `POST` | `/api/admin/projects/:id/revenue/reversal` | authenticate, requireRole('admin'), requirePermission('revenue.manual_entry') | `src/routes/admin.js` |
| `GET` | `/api/admin/projects/all` | authenticate, requireRole('admin') | `src/routes/admin.js` |
| `GET` | `/api/admin/revenue/ledger` | authenticate, requireRole('admin'), requirePermission('revenue.manual_entry') | `src/routes/admin.js` |
| `POST` | `/api/admin/wallets/:user_id/settle` | authenticate, requireRole('admin') | `src/routes/admin.js` |
| `GET` | `/api/admin/wallets/frozen` | authenticate, requireRole('admin'), requirePermission('member.remove') | `src/routes/admin.js` |
| `PATCH` | `/api/admin/withdrawals/:id/approve` | authenticate, requireRole('admin'), requirePermission('payout.approve') | `src/routes/admin.js` |
| `POST` | `/api/admin/withdrawals/:id/approve` | authenticate, requireRole('admin'), requirePermission('payout.approve') | `src/routes/admin.js` |
| `PATCH` | `/api/admin/withdrawals/:id/reject` | authenticate, requireRole('admin'), requirePermission('payout.approve') | `src/routes/admin.js` |
| `POST` | `/api/admin/withdrawals/:id/reject` | authenticate, requireRole('admin'), requirePermission('payout.approve') | `src/routes/admin.js` |
| `GET` | `/api/admin/withdrawals/pending` | authenticate, requireRole('admin'), requirePermission('payout.approve') | `src/routes/admin.js` |
| `POST` | `/api/auth/login` | None (Public) | `src/routes/auth.js` |
| `POST` | `/api/auth/logout` | authenticate | `src/routes/auth.js` |
| `POST` | `/api/auth/refresh` | authenticate | `src/routes/auth.js` |
| `POST` | `/api/auth/signup` | None (Public) | `src/routes/auth.js` |
| `GET` | `/api/banners/active` | authenticate | `src/routes/dashboard.js` |
| `POST` | `/api/coworking-rooms/:id/join` | authenticate | `src/routes/coworking.js` |
| `POST` | `/api/coworking-rooms/:id/leave` | authenticate | `src/routes/coworking.js` |
| `PATCH` | `/api/coworking-rooms/:id/snapshot` | authenticate | `src/routes/coworking.js` |
| `GET` | `/api/dashboard/banners/active` | authenticate | `src/routes/dashboard.js` |
| `GET` | `/api/dashboard/kanban` | authenticate | `src/routes/dashboard.js` |
| `GET` | `/api/dashboard/summary` | authenticate | `src/routes/dashboard.js` |
| `GET` | `/api/dashboard/votes-feed` | authenticate | `src/routes/dashboard.js` |
| `GET` | `/api/debug/error-test` | None (Public) | `src/app.js` |
| `GET` | `/api/health` | None (Public) | `src/app.js` |
| `POST` | `/api/ideas` | authenticate, requirePermission('idea.submit') | `src/routes/ideas.js` |
| `GET` | `/api/ideas/:id` | authenticate | `src/routes/ideas.js` |
| `PATCH` | `/api/ideas/:id/draft` | authenticate | `src/routes/ideas.js` |
| `GET` | `/api/ideas/:id/meeting` | authenticate | `src/routes/ideas.js` |
| `POST` | `/api/ideas/:id/submit` | authenticate, requirePermission('idea.submit') | `src/routes/ideas.js` |
| `POST` | `/api/ideas/:id/vote` | authenticate, requirePermission('idea.vote') | `src/routes/ideas.js` |
| `GET` | `/api/ideas/:id/votes` | authenticate | `src/routes/ideas.js` |
| `POST` | `/api/ideas/draft` | authenticate, requirePermission('idea.submit') | `src/routes/ideas.js` |
| `GET` | `/api/ideas/my` | authenticate | `src/routes/ideas.js` |
| `GET` | `/api/ideas/pending-my-vote` | authenticate | `src/routes/ideas.js` |
| `GET` | `/api/meetings` | authenticate | `src/routes/meetings.js` |
| `POST` | `/api/meetings` | authenticate | `src/routes/meetings.js` |
| `GET` | `/api/meetings/:id` | authenticate | `src/routes/meetings.js` |
| `PATCH` | `/api/meetings/:id/cancel` | authenticate | `src/routes/meetings.js` |
| `PATCH` | `/api/meetings/:id/end` | authenticate | `src/routes/meetings.js` |
| `POST` | `/api/meetings/:id/join` | authenticate | `src/routes/meetings.js` |
| `POST` | `/api/meetings/:id/leave` | authenticate | `src/routes/meetings.js` |
| `GET` | `/api/meetings/:id/notes` | authenticate | `src/routes/meetings.js` |
| `POST` | `/api/meetings/:id/recording` | authenticate | `src/routes/meetings.js` |
| `PATCH` | `/api/meetings/:id/start` | authenticate | `src/routes/meetings.js` |
| `GET` | `/api/notifications` | authenticate | `src/routes/dashboard.js` |
| `PATCH` | `/api/notifications/:id/read` | authenticate | `src/routes/dashboard.js` |
| `POST` | `/api/notifications/mark-all-read` | authenticate | `src/routes/dashboard.js` |
| `GET` | `/api/notifications/my` | authenticate | `src/routes/dashboard.js` |
| `POST` | `/api/notifications/send` | authenticate | `src/routes/dashboard.js` |
| `GET` | `/api/projects/:id` | authenticate | `src/routes/projects.js` |
| `PATCH` | `/api/projects/:id` | authenticate | `src/routes/projects.js` |
| `GET` | `/api/projects/:id/assets` | authenticate | `src/routes/projects.js` |
| `POST` | `/api/projects/:id/assets` | authenticate | `src/routes/projects.js` |
| `GET` | `/api/projects/:id/coworking-room` | authenticate | `src/routes/projects.js` |
| `POST` | `/api/projects/:id/coworking-room/create` | authenticate | `src/routes/projects.js` |
| `POST` | `/api/projects/auto-create` | authenticate | `src/routes/projects.js` |
| `GET` | `/api/projects/my` | authenticate | `src/routes/projects.js` |
| `GET` | `/api/projects/my-tasks` | authenticate | `src/routes/projects.js` |
| `POST` | `/api/sign/disputes/:id` | authenticate | `src/routes/sign.js` |
| `GET` | `/api/sign/disputes/:id/:token` | authenticate | `src/routes/sign.js` |
| `POST` | `/api/sign/waivers/:id` | authenticate | `src/routes/sign.js` |
| `GET` | `/api/sign/waivers/:id/:token` | authenticate | `src/routes/sign.js` |
| `GET` | `/api/superadmin/disputes` | authenticate, requireRole('admin') | `src/routes/superadmin.js` |
| `POST` | `/api/superadmin/disputes` | authenticate, requireRole('admin') | `src/routes/superadmin.js` |
| `GET` | `/api/superadmin/disputes/:id` | authenticate, requireRole('admin') | `src/routes/superadmin.js` |
| `POST` | `/api/superadmin/disputes/:id/agreement` | authenticate, requireRole('admin') | `src/routes/superadmin.js` |
| `POST` | `/api/superadmin/disputes/:id/parties` | authenticate, requireRole('admin') | `src/routes/superadmin.js` |
| `POST` | `/api/superadmin/disputes/:id/settle` | authenticate, requireRole('admin') | `src/routes/superadmin.js` |
| `GET` | `/api/superadmin/disputes/:id/signatures` | authenticate, requireRole('admin') | `src/routes/superadmin.js` |
| `PATCH` | `/api/superadmin/disputes/:id/status` | authenticate, requireRole('admin') | `src/routes/superadmin.js` |
| `POST` | `/api/superadmin/disputes/:id/waiver` | authenticate, requireRole('admin') | `src/routes/superadmin.js` |
| `GET` | `/api/superadmin/gateway/config` | authenticate, requireRole('admin') | `src/routes/superadmin.js` |
| `PATCH` | `/api/superadmin/gateway/config` | authenticate, requireRole('admin') | `src/routes/superadmin.js` |
| `POST` | `/api/superadmin/gateway/test` | authenticate, requireRole('admin') | `src/routes/superadmin.js` |
| `GET` | `/api/superadmin/governance/:userId` | authenticate, requireRole('admin') | `src/routes/superadmin.js` |
| `POST` | `/api/superadmin/governance/:userId` | authenticate, requireRole('admin') | `src/routes/superadmin.js` |
| `POST` | `/api/superadmin/governance/:userId/block` | authenticate, requireRole('admin') | `src/routes/superadmin.js` |
| `POST` | `/api/superadmin/governance/:userId/unblock` | authenticate, requireRole('admin') | `src/routes/superadmin.js` |
| `GET` | `/api/superadmin/ideas` | authenticate, requireRole('admin') | `src/routes/superadmin.js` |
| `GET` | `/api/superadmin/ideas/:id` | authenticate, requireRole('admin') | `src/routes/superadmin.js` |
| `POST` | `/api/superadmin/ideas/:id/kill` | authenticate, requireRole('admin') | `src/routes/superadmin.js` |
| `POST` | `/api/superadmin/ideas/:id/restore` | authenticate, requireRole('admin') | `src/routes/superadmin.js` |
| `GET` | `/api/superadmin/members` | authenticate, requireRole('admin') | `src/routes/superadmin.js` |
| `GET` | `/api/superadmin/members/:id` | authenticate, requireRole('admin') | `src/routes/superadmin.js` |
| `GET` | `/api/superadmin/members/export` | authenticate, requireRole('admin') | `src/routes/superadmin.js` |
| `GET` | `/api/superadmin/overview` | authenticate, requireRole('admin') | `src/routes/superadmin.js` |
| `GET` | `/api/superadmin/performance` | authenticate, requireRole('admin') | `src/routes/superadmin.js` |
| `GET` | `/api/superadmin/performance/:userId` | authenticate, requireRole('admin') | `src/routes/superadmin.js` |
| `GET` | `/api/superadmin/performance/config` | authenticate, requireRole('admin') | `src/routes/superadmin.js` |
| `PATCH` | `/api/superadmin/performance/config` | authenticate, requireRole('admin') | `src/routes/superadmin.js` |
| `GET` | `/api/superadmin/performance/leaderboard` | authenticate, requireRole('admin') | `src/routes/superadmin.js` |
| `GET` | `/api/superadmin/quota/config` | authenticate, requireRole('admin') | `src/routes/superadmin.js` |
| `PATCH` | `/api/superadmin/quota/config` | authenticate, requireRole('admin') | `src/routes/superadmin.js` |
| `GET` | `/api/superadmin/system/integrity` | authenticate, requireRole('admin') | `src/routes/superadmin.js` |
| `GET` | `/api/superadmin/tickets` | authenticate, requireRole('admin') | `src/routes/superadmin.js` |
| `POST` | `/api/superadmin/tickets` | authenticate, requireRole('admin') | `src/routes/superadmin.js` |
| `GET` | `/api/superadmin/tickets/:id` | authenticate, requireRole('admin') | `src/routes/superadmin.js` |
| `PATCH` | `/api/superadmin/tickets/:id` | authenticate, requireRole('admin') | `src/routes/superadmin.js` |
| `PATCH` | `/api/superadmin/tickets/:id/link-dispute` | authenticate, requireRole('admin') | `src/routes/superadmin.js` |
| `POST` | `/api/superadmin/tickets/:id/messages` | authenticate, requireRole('admin') | `src/routes/superadmin.js` |
| `PATCH` | `/api/tasks/:id/status` | authenticate | `src/routes/tasks.js` |
| `POST` | `/api/tasks/:id/upload` | authenticate | `src/routes/tasks.js` |
| `GET` | `/api/users/:id/earnings` | authenticate | `src/routes/users.js` |
| `GET` | `/api/users/:id/earnings-summary` | authenticate | `src/routes/users.js` |
| `GET` | `/api/users/:id/ideas` | authenticate | `src/routes/users.js` |
| `GET` | `/api/users/:id/profile` | authenticate | `src/routes/users.js` |
| `GET` | `/api/users/:id/profile-mini` | authenticate | `src/routes/users.js` |
| `GET` | `/api/users/:id/projects` | authenticate | `src/routes/users.js` |
| `GET` | `/api/users/:id/ratings` | authenticate | `src/routes/users.js` |
| `GET` | `/api/users/me` | authenticate | `src/routes/users.js` |
| `GET` | `/api/users/me/earnings` | authenticate | `src/routes/users.js` |
| `PATCH` | `/api/users/me/password` | authenticate | `src/routes/users.js` |
| `PATCH` | `/api/users/me/profile` | authenticate | `src/routes/users.js` |
| `GET` | `/api/users/me/quota-status` | authenticate | `src/routes/users.js` |
| `GET` | `/api/users/me/wallet` | authenticate | `src/routes/users.js` |
| `GET` | `/api/users/profile-mini` | authenticate | `src/routes/users.js` |
| `GET` | `/api/users/tickets` | authenticate | `src/routes/users.js` |
| `POST` | `/api/users/tickets` | authenticate | `src/routes/users.js` |
| `GET` | `/api/users/tickets/:id` | authenticate | `src/routes/users.js` |
| `POST` | `/api/users/tickets/:id/messages` | authenticate | `src/routes/users.js` |
| `POST` | `/api/withdrawals/request` | authenticate | `src/routes/withdrawals.js` |
