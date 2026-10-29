import { queryAll } from '../src/db/database.js';

console.log('--- 1. ideas (status = PENDING_REVIEW) ---');
console.log(queryAll("EXPLAIN QUERY PLAN SELECT * FROM ideas WHERE status = 'PENDING_REVIEW'"));

console.log('--- 2. notifications (user_id = ? AND read_status = 0) ---');
console.log(queryAll("EXPLAIN QUERY PLAN SELECT * FROM notifications WHERE user_id = 'u1' AND read_status = 0"));

console.log('--- 3. access_log (user_id = ? AND action = ?) ---');
console.log(queryAll("EXPLAIN QUERY PLAN SELECT * FROM access_log WHERE user_id = 'u1' AND action = 'login'"));

console.log('--- 4. pipeline_checklist_points (deliverable_id = ? AND stage = ? AND status = ?) ---');
console.log(queryAll("EXPLAIN QUERY PLAN SELECT * FROM pipeline_checklist_points WHERE deliverable_id = 'd1' AND stage = 'DEV' AND status = 'CLAIMED'"));

console.log('--- 5. projects (status = ? AND owner_id = ?) ---');
console.log(queryAll("EXPLAIN QUERY PLAN SELECT * FROM projects WHERE status = 'ACTIVE' AND owner_id = 'u1'"));

console.log('--- 6. project_tasks (project_id = ? AND assigned_to = ? AND status = ?) ---');
console.log(queryAll("EXPLAIN QUERY PLAN SELECT * FROM project_tasks WHERE project_id = 'p1' AND assigned_to = 'u1' AND status = 'TODO'"));
