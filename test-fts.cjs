const Database = require('better-sqlite3');
const db = new Database('.data/workstation.db', { readonly: true });
const tables = db.prepare("SELECT name, type FROM sqlite_master WHERE name LIKE '%_fts%' OR name LIKE 'notes_ai' OR name LIKE 'inbox_items_ai' OR name LIKE 'tasks_ai' ORDER BY name").all();
console.log('FTS objects:');
for (const t of tables) console.log(' ', t.type, t.name);
db.close();
