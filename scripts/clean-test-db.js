import { execute, queryOne, execRaw } from '../src/db/database.js';

execRaw('PRAGMA foreign_keys = OFF');
execute("DELETE FROM users WHERE email LIKE '%@mahitechgroup.com' OR email LIKE '%@oviaxe.com'");
execRaw('PRAGMA foreign_keys = ON');
console.log('Users remaining:', queryOne('SELECT count(*) as cnt FROM users').cnt);

