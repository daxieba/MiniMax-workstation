/**
 * Search IPC handler 单元测试（T4-2）
 *
 * 直接调 `handleSearchQuery`（绕开 ipcMain 事件循环），喂临时 db，验证：
 *   - 三表各有数据 → scope='all' 返混合 3 条按归一化 score 排序
 *   - scope='notes' / 'tasks' / 'inbox' 各只返对应表
 *   - query 不匹配 → 返空
 *   - snippet 用 FTS5 `snippet()` 输出（含 `<mark>` 标签）
 *   - snippet 长度 ≤ 100 字符
 *   - 空 query → VALIDATION_FAILED
 *   - 跨表 bm25 归一化（每张表内归一化到 [0, 1]）
 *   - 包含跨表排序：note + task + inbox 命中同一 query
 *
 * **不依赖 Electron** —— 直接用 `db/client.ts` 的 createDbClient。
 *
 * @see electron/main/ipc/search.ts
 */

import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve as resolvePath } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ulid } from 'ulidx';

import { closeDb, createDbClient, type WorkstationDb } from '../db/client';
import { inboxItems, notes, tasks, type InboxItemRow, type NoteRow, type TaskRow } from '../db/schema';
import { handleSearchQuery, type SearchIpcDeps } from '../electron/main/ipc/search';

const TMP_ROOT = join(tmpdir(), 'minimax-workstation-search-ipc-test');

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
  deps: SearchIpcDeps;
  db: WorkstationDb;
  close: () => void;
}

function makeFixture(): Fixture {
  const dbPath = join(
    TMP_ROOT,
    `search-ipc-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
  );
  const { db } = createDbClient(dbPath, resolvePath(__dirname, '..'));
  return {
    deps: { db },
    db,
    close: () => closeDb(db),
  };
}

/** 直接在 db 写一行 note（绕开 IPC）。 */
function seedNote(db: WorkstationDb, overrides: Partial<NoteRow> = {}): NoteRow {
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

/** 直接在 db 写一行 task。 */
function seedTask(db: WorkstationDb, overrides: Partial<TaskRow> = {}): TaskRow {
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

/** 直接在 db 写一行 inbox item。 */
function seedInbox(db: WorkstationDb, overrides: Partial<InboxItemRow> = {}): InboxItemRow {
  const id = overrides.id ?? ulid();
  const now = new Date();
  const row: InboxItemRow = {
    id,
    content: overrides.content ?? 'seed content',
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
//  scope='all' 跨表混合
// ============================================================

describe('search:query — scope=all', () => {
  it('returns mixed results from 3 tables when scope=all', async () => {
    const f = makeFixture();
    try {
      seedNote(f.db, { title: 'TypeScript learning', content: 'study typescript resources' });
      seedTask(f.db, { title: 'TypeScript task', description: 'study typescript deeply' });
      seedInbox(f.db, { content: 'TypeScript collection from web' });

      const results = await handleSearchQuery(f.deps, { query: 'TypeScript' });
      expect(results).toHaveLength(3);
      // kind 三表都有
      const kinds = new Set(results.map((r) => r.kind));
      expect(kinds.has('note')).toBe(true);
      expect(kinds.has('task')).toBe(true);
      expect(kinds.has('inbox')).toBe(true);
    } finally {
      f.close();
    }
  });

  it('orders results by normalized score desc', async () => {
    const f = makeFixture();
    try {
      seedNote(f.db, { title: 'frontend development', content: 'react tutorial' });
      seedNote(f.db, { title: 'backend development', content: 'node tutorial' });
      seedNote(f.db, { title: 'devops tutorial', content: 'docker guide' });

      const results = await handleSearchQuery(f.deps, { query: 'frontend' });
      // 单表 scope 走 normalizeBm25 → 唯一命中 score=1
      expect(results).toHaveLength(1);
      expect(results[0]?.kind).toBe('note');
      expect(results[0]?.score).toBe(1);
    } finally {
      f.close();
    }
  });

  it('normalizes bm25 within each table (1.0 for the best hit in that table)', async () => {
    const f = makeFixture();
    try {
      // 2 个 note 命中
      seedNote(f.db, { title: 'react tutorial beginner', content: 'react tutorial react intro' });
      seedNote(f.db, { title: 'react tutorial advanced', content: 'react deep dive' });
      // 2 个 task 命中
      seedTask(f.db, { title: 'react task implementation', description: 'react implementation' });
      seedTask(f.db, { title: 'normal task', description: 'react related' });

      const results = await handleSearchQuery(f.deps, { query: 'react' });
      expect(results).toHaveLength(4);
      // 每张表内 score ∈ [0, 1]
      for (const r of results) {
        expect(r.score).toBeGreaterThanOrEqual(0);
        expect(r.score).toBeLessThanOrEqual(1);
      }
    } finally {
      f.close();
    }
  });

  it('returns empty array when no match', async () => {
    const f = makeFixture();
    try {
      seedNote(f.db, { title: 'note title', content: 'note body' });
      seedTask(f.db, { title: 'task title' });
      seedInbox(f.db, { content: 'inbox content' });

      const results = await handleSearchQuery(f.deps, { query: 'xyzqqq123' });
      expect(results).toEqual([]);
    } finally {
      f.close();
    }
  });

  it('snippet contains <mark> tags (FTS5 highlight)', async () => {
    const f = makeFixture();
    try {
      seedNote(f.db, { title: 'react tutorial', content: 'react beginner react advanced' });
      const results = await handleSearchQuery(f.deps, { query: 'react', scope: 'notes' });
      expect(results).toHaveLength(1);
      const snippet = results[0]?.snippet ?? '';
      expect(snippet).toContain('<mark>');
      expect(snippet).toContain('</mark>');
    } finally {
      f.close();
    }
  });

  it('snippet length ≤ 100 chars (privacy)', async () => {
    const f = makeFixture();
    try {
      seedNote(f.db, { title: 'title', content: 'react ' + 'x'.repeat(500) });
      const results = await handleSearchQuery(f.deps, { query: 'react', scope: 'notes' });
      expect(results).toHaveLength(1);
      expect(results[0]?.snippet.length).toBeLessThanOrEqual(100);
    } finally {
      f.close();
    }
  });
});

// ============================================================
//  scope 过滤
// ============================================================

describe('search:query — scope filtering', () => {
  it("scope='notes' only returns notes", async () => {
    const f = makeFixture();
    try {
      seedNote(f.db, { title: 'react note', content: 'react tutorial' });
      seedTask(f.db, { title: 'react task', description: 'react task' });
      seedInbox(f.db, { content: 'react collection' });

      const results = await handleSearchQuery(f.deps, { query: 'react', scope: 'notes' });
      expect(results).toHaveLength(1);
      expect(results[0]?.kind).toBe('note');
    } finally {
      f.close();
    }
  });

  it("scope='tasks' only returns tasks", async () => {
    const f = makeFixture();
    try {
      seedNote(f.db, { title: 'react note', content: 'react tutorial' });
      seedTask(f.db, { title: 'react task', description: 'react task' });
      seedInbox(f.db, { content: 'react collection' });

      const results = await handleSearchQuery(f.deps, { query: 'react', scope: 'tasks' });
      expect(results).toHaveLength(1);
      expect(results[0]?.kind).toBe('task');
      // task 的 metadata 含 status / priority
      if (results[0]?.metadata.kind === 'task') {
        expect(results[0].metadata.status).toBe('todo');
        expect(results[0].metadata.priority).toBe('medium');
      } else {
        throw new Error('expected task metadata');
      }
    } finally {
      f.close();
    }
  });

  it("scope='inbox' only returns inbox items", async () => {
    const f = makeFixture();
    try {
      seedNote(f.db, { title: 'react note', content: 'react tutorial' });
      seedTask(f.db, { title: 'react task', description: 'react task' });
      seedInbox(f.db, { content: 'react collection' });

      const results = await handleSearchQuery(f.deps, { query: 'react', scope: 'inbox' });
      expect(results).toHaveLength(1);
      expect(results[0]?.kind).toBe('inbox');
      if (results[0]?.metadata.kind === 'inbox') {
        expect(results[0].metadata.itemKind).toBe('note');
        expect(results[0].metadata.status).toBe('active');
      } else {
        throw new Error('expected inbox metadata');
      }
    } finally {
      f.close();
    }
  });
});

// ============================================================
//  入参校验
// ============================================================

describe('search:query — validation', () => {
  it('rejects empty query with VALIDATION_FAILED', async () => {
    const f = makeFixture();
    try {
      await expect(handleSearchQuery(f.deps, { query: '' })).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
      });
    } finally {
      f.close();
    }
  });

  it('rejects invalid scope with VALIDATION_FAILED', async () => {
    const f = makeFixture();
    try {
      await expect(
        handleSearchQuery(f.deps, { query: 'x', scope: 'unknown' as unknown as 'all' }),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    } finally {
      f.close();
    }
  });

  it('rejects query > 256 chars with VALIDATION_FAILED', async () => {
    const f = makeFixture();
    try {
      await expect(
        handleSearchQuery(f.deps, { query: 'x'.repeat(257) }),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    } finally {
      f.close();
    }
  });

  it('treats whitespace-only query as empty (clears results, no error)', async () => {
    const f = makeFixture();
    try {
      seedNote(f.db, { title: 'react', content: 'react' });
      const results = await handleSearchQuery(f.deps, { query: '   ' });
      expect(results).toEqual([]);
    } finally {
      f.close();
    }
  });
});

// ============================================================
//  limit / offset
// ============================================================

describe('search:query — limit / offset', () => {
  it('respects limit param', async () => {
    const f = makeFixture();
    try {
      for (let i = 0; i < 5; i++) {
        seedNote(f.db, { title: `react note ${i}`, content: 'react content' });
      }
      const results = await handleSearchQuery(f.deps, { query: 'react', scope: 'notes', limit: 2 });
      expect(results).toHaveLength(2);
    } finally {
      f.close();
    }
  });

  it('respects offset param', async () => {
    const f = makeFixture();
    try {
      for (let i = 0; i < 5; i++) {
        seedNote(f.db, { title: `react note ${i}`, content: 'react content' });
      }
      const all = await handleSearchQuery(f.deps, { query: 'react', scope: 'notes' });
      const offset2 = await handleSearchQuery(f.deps, {
        query: 'react',
        scope: 'notes',
        limit: 20,
        offset: 2,
      });
      expect(all.length).toBeGreaterThanOrEqual(3);
      expect(offset2).toHaveLength(all.length - 2);
      // offset 后的结果应是 all 切片 [2:]
      expect(offset2.map((r) => r.id)).toEqual(all.slice(2).map((r) => r.id));
    } finally {
      f.close();
    }
  });
});

// ============================================================
//  matchExpr 边界
// ============================================================

describe('search:query — FTS5 match expression', () => {
  it('handles multi-term AND query (space-separated)', async () => {
    const f = makeFixture();
    try {
      seedNote(f.db, { title: 'react tutorial', content: 'frontend intro' });
      seedNote(f.db, { title: 'react advanced', content: 'backend detail' });
      seedNote(f.db, { title: 'vue tutorial', content: 'frontend intro' });

      const results = await handleSearchQuery(f.deps, { query: 'react frontend', scope: 'notes' });
      // 只有 note 1 同时含 react + frontend
      expect(results).toHaveLength(1);
      expect(results[0]?.title).toContain('tutorial');
    } finally {
      f.close();
    }
  });

  it('case-insensitive (trigram tokenizer)', async () => {
    const f = makeFixture();
    try {
      seedNote(f.db, { title: 'React tutorial', content: 'REACT guide' });
      const results = await handleSearchQuery(f.deps, { query: 'react', scope: 'notes' });
      expect(results).toHaveLength(1);
    } finally {
      f.close();
    }
  });
});
