import { DatabaseSync } from 'node:sqlite';
import { config } from '../config.js';

let dbInstance = null;

export function getDatabase() {
  if (!dbInstance) {
    dbInstance = new DatabaseSync(config.DB_PATH);
    dbInstance.exec('PRAGMA journal_mode = WAL;');
    dbInstance.exec('PRAGMA busy_timeout = 5000;');
    dbInstance.exec('PRAGMA foreign_keys = ON;');
    console.log('[DB] WAL mode enabled');
  }
  return dbInstance;
}

export function queryAll(sql, params = []) {
  const db = getDatabase();
  const stmt = db.prepare(sql);
  return stmt.all(...params);
}

export function queryOne(sql, params = []) {
  const db = getDatabase();
  const stmt = db.prepare(sql);
  const row = stmt.get(...params);
  return row || null;
}

export function execute(sql, params = []) {
  const db = getDatabase();
  const stmt = db.prepare(sql);
  return stmt.run(...params);
}

export function execRaw(sql) {
  const db = getDatabase();
  return db.exec(sql);
}
