// 临时验收脚本：检查 0005 迁移落地 + 触发器 + FTS 虚拟表
const Database = require('better-sqlite3');
const path = require('node:path');

const dbPath = path.join(__dirname, '.data', 'workstation.db');
const db = new Database(dbPath, { readonly: true });

console.log('=== FTS VIRTUAL TABLES ===');
const ftsTables = db
  .prepare(
    "SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name LIKE '%_fts' ORDER BY name"
  )
  .all();
for (const t of ftsTables) {
  console.log(`\n[${t['name']}]`);
  console.log(t['sql']);
}

console.log('\n=== FTS TRIGGERS ===');
const triggers = db
  .prepare(
    "SELECT name, tbl_name, sql FROM sqlite_master WHERE type = 'trigger' AND (name LIKE 'notes_%' OR name LIKE 'inbox_items_%' OR name LIKE 'tasks_%') ORDER BY name"
  )
  .all();
for (const tr of triggers) {
  console.log(`\n[${tr['name']}] ON ${tr['tbl_name']}`);
  console.log(tr['sql']);
}

console.log('\n=== MIGRATIONS APPLIED ===');
const mig = db
  .prepare('SELECT id, hash, created_at FROM __drizzle_migrations ORDER BY id')
  .all();
for (const m of mig) {
  console.log(`  id=${m['id']}  hash=${m['hash']}  created_at=${m['created_at']}`);
}
