#!/usr/bin/env node
/* eslint-env node */
/**
 * 临时验证脚本（T2-1 验收用，跑完可删）
 * 检查 .data/workstation.db 里 3 张业务表都建好了，列、外键符合预期。
 */
const Database = require('better-sqlite3');
const path = require('node:path');
const dbPath = path.resolve(__dirname, '.data', 'workstation.db');
const db = new Database(dbPath);

const tables = db
  .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
  .all();
console.log('Tables:', tables.map((t) => t.name).join(', '));

for (const t of ['projects', 'inbox_items', 'tasks']) {
  const cols = db.prepare(`PRAGMA table_info(${t})`).all();
  console.log(`\n[${t}] columns:`);
  for (const c of cols) {
    const flags = [
      c.pk ? 'PK' : '',
      c.notnull ? 'NOT NULL' : '',
      c.dflt_value !== null ? `DEFAULT ${c.dflt_value}` : '',
    ]
      .filter(Boolean)
      .join(' ');
    console.log(`  ${c.name}: ${c.type} ${flags}`);
  }
  const fks = db.prepare(`PRAGMA foreign_key_list(${t})`).all();
  if (fks.length) {
    console.log(`[${t}] FKs:`);
    for (const fk of fks) {
      console.log(`  ${fk.from} -> ${fk.table}.${fk.to} (on_delete=${fk.on_delete}, on_update=${fk.on_update})`);
    }
  }
}

db.close();
