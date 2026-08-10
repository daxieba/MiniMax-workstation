/**
 * FTS5 迁移 + 触发器同步测试（T4-2）
 *
 * 验证：
 *   - 0005 迁移成功创建 3 张 FTS5 虚拟表 + 6 个触发器
 *   - INSERT notes / inbox / task → 对应 _fts 自动同步
 *   - UPDATE → _fts 自动更新
 *   - DELETE → _fts 自动移除
 *   - 跨表：写 3 张 source 表都能各自同步
 *   - 应用层不感知 FTS5 存在（直接 db.insert 即可，触发器自动跑）
 *
 * @see db/migrations/0005_init_fts5.sql
 */

import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve as resolvePath } from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ulid } from 'ulidx';

import { closeDb, createDbClient, type WorkstationDb } from '../db/client';
import { inboxItems, notes, tasks, type InboxItemRow, type NoteRow, type TaskRow } from '../db/schema';

const TMP_ROOT = join(tmpdir(), 'minimax-workstation-fts-migration-test');

beforeAll(() => {
  if (!existsSync(TMP_ROOT)) {
    mkdirSync(TMP_ROOT, { recursive: true });
  }
});

afterAll(() => {
  try {
    rmSync(TMP_ROOT, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

interface Fixture {
  db: WorkstationDb;
  close: () => void;
}

function makeFixture(): Fixture {
  const dbPath = join(
    TMP_ROOT,
    `fts-migration-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
  );
  const { db } = createDbClient(dbPath, resolvePath(__dirname, '..'));
  return {
    db,
    close: () => closeDb(db),
  };
}

function seedNoteRow(db: WorkstationDb, overrides: Partial<NoteRow> = {}): NoteRow {
  const id = overrides.id ?? ulid();
  const now = new Date();
  const row: NoteRow = {
    id,
    title: overrides.title ?? 'seed note',
    content: overrides.content ?? 'body',
    tags: overrides.tags ?? [],
    linkedTaskIds: overrides.linkedTaskIds ?? [],
    projectId: overrides.projectId ?? null,
    source: overrides.source ?? 'manual',
    archived: overrides.archived ?? 0,
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
  };
  db.insert(notes).values(row).run();
  return row;
}

function seedTaskRow(db: WorkstationDb, overrides: Partial<TaskRow> = {}): TaskRow {
  const id = overrides.id ?? ulid();
  const now = new Date();
  const row: TaskRow = {
    id,
    title: overrides.title ?? 'seed task',
    description: overrides.description ?? null,
    status: overrides.status ?? 'todo',
    priority: overrides.priority ?? 'medium',
    dueDate: overrides.dueDate ?? null,
    projectId: overrides.projectId ?? null,
    tags: overrides.tags ?? [],
    source: overrides.source ?? 'manual',
    inboxId: overrides.inboxId ?? null,
    noteIds: overrides.noteIds ?? [],
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
    completedAt: overrides.completedAt ?? null,
  };
  db.insert(tasks).values(row).run();
  return row;
}

function seedInboxRow(db: WorkstationDb, overrides: Partial<InboxItemRow> = {}): InboxItemRow {
  const id = overrides.id ?? ulid();
  const now = new Date();
  const row: InboxItemRow = {
    id,
    content: overrides.content ?? 'seed inbox',
    kind: overrides.kind ?? 'note',
    source: overrides.source ?? 'manual',
    status: overrides.status ?? 'active',
    convertedTo: overrides.convertedTo ?? null,
    projectId: overrides.projectId ?? null,
    tags: overrides.tags ?? [],
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
    deletedAt: overrides.deletedAt ?? null,
  };
  db.insert(inboxItems).values(row).run();
  return row;
}

// ============================================================
//  迁移后的 schema 校验
// ============================================================

describe('0005_init_fts5 migration', () => {
  let f: Fixture;
  beforeEach(() => {
    f = makeFixture();
  });

  it('creates 3 FTS5 virtual tables + 6 triggers after migration', () => {
    try {
      const client = f.db.$client;
      const tables = client
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND (name = 'notes_fts' OR name = 'inbox_fts' OR name = 'tasks_fts') ORDER BY name",
        )
        .all() as Array<{ name: string }>;
      expect(tables.map((t) => t.name)).toEqual(['inbox_fts', 'notes_fts', 'tasks_fts']);

      const triggers = client
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='trigger' AND (name LIKE 'notes_%' OR name LIKE 'inbox_items_%' OR name LIKE 'tasks_%') AND (name LIKE '%_ai' OR name LIKE '%_ad' OR name LIKE '%_au') ORDER BY name",
        )
        .all() as Array<{ name: string }>;
      const triggerNames = triggers.map((t) => t.name);
      expect(triggerNames).toContain('notes_ai');
      expect(triggerNames).toContain('notes_ad');
      expect(triggerNames).toContain('notes_au');
      expect(triggerNames).toContain('inbox_items_ai');
      expect(triggerNames).toContain('inbox_items_ad');
      expect(triggerNames).toContain('inbox_items_au');
      expect(triggerNames).toContain('tasks_ai');
      expect(triggerNames).toContain('tasks_ad');
      expect(triggerNames).toContain('tasks_au');
    } finally {
      f.close();
    }
  });

  it('uses trigram tokenizer (SQLite 3.34+ for CJK support)', () => {
    try {
      const client = f.db.$client;
      const row = client
        .prepare(
          "SELECT sql FROM sqlite_master WHERE type='table' AND name='notes_fts'",
        )
        .get() as { sql: string };
      expect(row.sql).toContain('trigram');
    } finally {
      f.close();
    }
  });
});

// ============================================================
//  触发器：notes ↔ notes_fts
// ============================================================

describe('notes ↔ notes_fts trigger sync', () => {
  let f: Fixture;
  beforeEach(() => {
    f = makeFixture();
  });

  it('insert note → notes_fts auto-indexed', () => {
    try {
      const seeded = seedNoteRow(f.db, { title: 'react tutorial', content: 'react intro' });
      const rows = f.db.$client
        .prepare("SELECT rowid FROM notes_fts WHERE notes_fts MATCH 'react'")
        .all() as Array<{ rowid: number }>;
      expect(rows).toHaveLength(1);
      expect(rows[0]?.rowid).toBeGreaterThan(0);
      // 验证 rowid 与 source notes.rowid 一致（用 contentless 模式用 rowid 关联）
      const sourceRow = f.db.$client
        .prepare('SELECT rowid FROM notes WHERE id = ?')
        .get(seeded.id) as { rowid: number };
      expect(rows[0]?.rowid).toBe(sourceRow.rowid);
    } finally {
      f.close();
    }
  });

  it('update note → notes_fts auto-updated (old entry removed, new indexed)', () => {
    try {
      const seeded = seedNoteRow(f.db, { title: 'react tutorial', content: 'react intro' });
      // 改 title 和 content（不再含 "react"）
      f.db
        .update(notes)
        .set({ title: 'vue tutorial', content: 'vue intro', updatedAt: new Date() })
        .where(eqNoteId(seeded.id))
        .run();

      // 搜 "react" 应 0 hit
      const reactHits = f.db.$client
        .prepare("SELECT rowid FROM notes_fts WHERE notes_fts MATCH 'react'")
        .all() as Array<{ rowid: number }>;
      expect(reactHits).toHaveLength(0);

      // 搜 "vue" 应 1 hit
      const vueHits = f.db.$client
        .prepare("SELECT rowid FROM notes_fts WHERE notes_fts MATCH 'vue'")
        .all() as Array<{ rowid: number }>;
      expect(vueHits).toHaveLength(1);
    } finally {
      f.close();
    }
  });

  it('delete note → notes_fts entry removed', () => {
    try {
      const seeded = seedNoteRow(f.db, { title: 'react tutorial', content: 'react intro' });
      expect(
        f.db.$client.prepare("SELECT rowid FROM notes_fts WHERE notes_fts MATCH 'react'").all(),
      ).toHaveLength(1);

      f.db.delete(notes).where(eqNoteId(seeded.id)).run();

      expect(
        f.db.$client.prepare("SELECT rowid FROM notes_fts WHERE notes_fts MATCH 'react'").all(),
      ).toHaveLength(0);
    } finally {
      f.close();
    }
  });
});

// ============================================================
//  触发器：inbox_items ↔ inbox_fts
// ============================================================

describe('inbox_items ↔ inbox_fts trigger sync', () => {
  let f: Fixture;
  beforeEach(() => {
    f = makeFixture();
  });

  it('insert inbox item → inbox_fts auto-indexed', () => {
    try {
      seedInboxRow(f.db, { content: 'react learning from web' });
      const rows = f.db.$client
        .prepare("SELECT rowid FROM inbox_fts WHERE inbox_fts MATCH 'react'")
        .all() as Array<{ rowid: number }>;
      expect(rows).toHaveLength(1);
    } finally {
      f.close();
    }
  });

  it('update inbox → inbox_fts auto-updated', () => {
    try {
      const seeded = seedInboxRow(f.db, { content: 'react learning' });
      f.db.update(inboxItems).set({ content: 'vue learning', updatedAt: new Date() }).where(eqInboxId(seeded.id)).run();

      expect(
        f.db.$client.prepare("SELECT rowid FROM inbox_fts WHERE inbox_fts MATCH 'react'").all(),
      ).toHaveLength(0);
      expect(
        f.db.$client.prepare("SELECT rowid FROM inbox_fts WHERE inbox_fts MATCH 'vue'").all(),
      ).toHaveLength(1);
    } finally {
      f.close();
    }
  });

  it('delete inbox → inbox_fts entry removed', () => {
    try {
      const seeded = seedInboxRow(f.db, { content: 'react learning' });
      expect(
        f.db.$client.prepare("SELECT rowid FROM inbox_fts WHERE inbox_fts MATCH 'react'").all(),
      ).toHaveLength(1);

      f.db.delete(inboxItems).where(eqInboxId(seeded.id)).run();

      expect(
        f.db.$client.prepare("SELECT rowid FROM inbox_fts WHERE inbox_fts MATCH 'react'").all(),
      ).toHaveLength(0);
    } finally {
      f.close();
    }
  });
});

// ============================================================
//  触发器：tasks ↔ tasks_fts
// ============================================================

describe('tasks ↔ tasks_fts trigger sync', () => {
  let f: Fixture;
  beforeEach(() => {
    f = makeFixture();
  });

  it('insert task → tasks_fts auto-indexed (title + description)', () => {
    try {
      seedTaskRow(f.db, { title: 'react task', description: 'react implementation details' });
      const titleHits = f.db.$client
        .prepare("SELECT rowid FROM tasks_fts WHERE tasks_fts MATCH 'react'")
        .all() as Array<{ rowid: number }>;
      const descHits = f.db.$client
        .prepare("SELECT rowid FROM tasks_fts WHERE tasks_fts MATCH 'implementation'")
        .all() as Array<{ rowid: number }>;
      expect(titleHits).toHaveLength(1);
      expect(descHits).toHaveLength(1);
    } finally {
      f.close();
    }
  });

  it('update task → tasks_fts auto-updated', () => {
    try {
      const seeded = seedTaskRow(f.db, { title: 'react task', description: 'react implementation' });
      // 改 title + description 都不再含 "react"
      f.db
        .update(tasks)
        .set({ title: 'vue task', description: 'vue implementation', updatedAt: new Date() })
        .where(eqTaskId(seeded.id))
        .run();

      expect(
        f.db.$client.prepare("SELECT rowid FROM tasks_fts WHERE tasks_fts MATCH 'react'").all(),
      ).toHaveLength(0);
      expect(
        f.db.$client.prepare("SELECT rowid FROM tasks_fts WHERE tasks_fts MATCH 'vue'").all(),
      ).toHaveLength(1);
    } finally {
      f.close();
    }
  });

  it('delete task → tasks_fts entry removed', () => {
    try {
      const seeded = seedTaskRow(f.db, { title: 'react task' });
      expect(
        f.db.$client.prepare("SELECT rowid FROM tasks_fts WHERE tasks_fts MATCH 'react'").all(),
      ).toHaveLength(1);

      f.db.delete(tasks).where(eqTaskId(seeded.id)).run();

      expect(
        f.db.$client.prepare("SELECT rowid FROM tasks_fts WHERE tasks_fts MATCH 'react'").all(),
      ).toHaveLength(0);
    } finally {
      f.close();
    }
  });
});

// ============================================================
//  跨表同步
// ============================================================

describe('cross-table sync consistency', () => {
  it('writing all 3 source tables keeps 3 FTS indices in sync', () => {
    const f = makeFixture();
    try {
      // 同一 query 词在 3 张 source 表
      const note = seedNoteRow(f.db, { title: 'react note', content: 'react content' });
      const task = seedTaskRow(f.db, { title: 'react task', description: 'react impl' });
      const inbox = seedInboxRow(f.db, { content: 'react collected' });

      // 每张 _fts 表都应能搜到
      expect(
        f.db.$client.prepare("SELECT rowid FROM notes_fts WHERE notes_fts MATCH 'react'").all(),
      ).toHaveLength(1);
      expect(
        f.db.$client.prepare("SELECT rowid FROM tasks_fts WHERE tasks_fts MATCH 'react'").all(),
      ).toHaveLength(1);
      expect(
        f.db.$client.prepare("SELECT rowid FROM inbox_fts WHERE inbox_fts MATCH 'react'").all(),
      ).toHaveLength(1);

      // 删 source → 3 张 _fts 同步
      f.db.delete(notes).where(eqNoteId(note.id)).run();
      f.db.delete(tasks).where(eqTaskId(task.id)).run();
      f.db.delete(inboxItems).where(eqInboxId(inbox.id)).run();

      expect(
        f.db.$client.prepare("SELECT rowid FROM notes_fts WHERE notes_fts MATCH 'react'").all(),
      ).toHaveLength(0);
      expect(
        f.db.$client.prepare("SELECT rowid FROM tasks_fts WHERE tasks_fts MATCH 'react'").all(),
      ).toHaveLength(0);
      expect(
        f.db.$client.prepare("SELECT rowid FROM inbox_fts WHERE inbox_fts MATCH 'react'").all(),
      ).toHaveLength(0);
    } finally {
      f.close();
    }
  });
});

// ============================================================
//  helper：drizzle 的 eq 在动态场景
// ============================================================

import { eq } from 'drizzle-orm';

function eqNoteId(id: string) {
  return eq(notes.id, id);
}
function eqTaskId(id: string) {
  return eq(tasks.id, id);
}
function eqInboxId(id: string) {
  return eq(inboxItems.id, id);
}
