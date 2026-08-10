const Database = require('better-sqlite3');
const db = new Database('.data/workstation.db', { readonly: true });
const ver = db.prepare('SELECT sqlite_version() AS v').get();
console.log('SQLite version:', ver);
// 检查所有 FTS 虚拟表
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%_fts' ORDER BY name").all();
for (const t of tables) console.log('  ', t.name);
db.close();
