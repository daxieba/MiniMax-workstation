// 一次性 db 状态检查脚本（仅用于 T1-3 验收）
const Db = require('better-sqlite3');
const db = new Db('.data/workstation.db', { readonly: true });
const tables = db
  .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
  .all();
console.log('tables:', tables);
const migrations = db.prepare('SELECT * FROM __drizzle_migrations').all();
console.log('migrations:', migrations);
const meta = db.prepare('SELECT * FROM app_meta').all();
console.log('app_meta rows:', meta);
console.log('PRAGMA journal_mode:', db.pragma('journal_mode', { simple: true }));
console.log('PRAGMA foreign_keys:', db.pragma('foreign_keys', { simple: true }));
db.close();
