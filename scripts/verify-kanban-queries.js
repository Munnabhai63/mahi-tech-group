import { getDatabase, queryAll } from '../src/db/database.js';
import { getKanbanProjects, getPendingVotesFeed } from '../src/services/dashboardService.js';

const db = getDatabase();

let queryCount = 0;
const queries = [];

// Intercept prepare/all
const origPrepare = db.prepare.bind(db);
db.prepare = function(sql) {
  queryCount++;
  queries.push(sql.trim().replace(/\s+/g, ' ').slice(0, 80));
  return origPrepare(sql);
};

const adminUser = { id: 'de6e2e61-98f9-4d30-bc8b-0ae909ca5da3', role: 'admin' };

console.log('=== KANBAN QUERY COUNT VERIFICATION ===');
queryCount = 0;
queries.length = 0;

const projects = await getKanbanProjects(adminUser, 50, 0);
console.log(`Projects retrieved: ${projects.length}`);
console.log(`Total queries executed for getKanbanProjects: ${queryCount}`);
console.log('Queries:');
queries.forEach((q, idx) => console.log(`  Query ${idx + 1}: ${q}...`));

console.log('\n=== VOTES FEED QUERY COUNT VERIFICATION ===');
queryCount = 0;
queries.length = 0;

const votesFeed = await getPendingVotesFeed('de6e2e61-98f9-4d30-bc8b-0ae909ca5da3', 50, 0);
console.log(`Ideas retrieved: ${votesFeed.length}`);
console.log(`Total queries executed for getPendingVotesFeed: ${queryCount}`);
console.log('Queries:');
queries.forEach((q, idx) => console.log(`  Query ${idx + 1}: ${q}...`));
