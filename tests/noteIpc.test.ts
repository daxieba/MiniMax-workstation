/**
 * Note IPC handler 单元测试（T4-1）
 *
 * 直接调 `handleNote*` 函数（绕开 ipcMain 事件循环），喂临时 db，验证：
 *   - 每个 handler 都有成功 + 失败两条用例
 *   - 错误码符合 PROJECT_IDENTITY.md §4.4
 *     (VALIDATION_FAILED / NOT_FOUND / PERSISTENCE_FAILED)
 *   - 8 个 handler + 标签 JSON 序列化 + 关联任务增删
 *
 * **不依赖 Electron** —— 直接用 `db/client.ts` 的 createDbClient。
 *
 * @see electron/main/ipc/note.ts
 */

import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve as resolvePath } from 'node:path';

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ulid } from 'ulidx';

import { closeDb, createDbClient, type WorkstationDb } from '../db/client';
import { notes, projects, type NoteRow } from '../db/schema';
import {
  handleNoteArchive,
  handleNoteCreate,
  handleNoteDelete,
  handleNoteGet,
  handleNoteLinkToTask,
  handleNoteList,
  handleNoteUnlinkFromTask,
  handleNoteUpdate,
  type NoteIpcDeps,
} from '../electron/main/ipc/note';

const TMP_ROOT = join(tmpdir(), 'minimax-workstation-note-ipc-test');

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
  deps: NoteIpcDeps;
  db: WorkstationDb;
  close: () => void;
}

function makeFixture(): Fixture {
  const dbPath = join(TMP_ROOT, `note-ipc-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  const { db } = createDbClient(dbPath, resolvePath(__dirname, '..'));
  return {
    deps: { db },
    db,
    close: () => closeDb(db),
  };
}

/** 工具：直接在 db 里建一个 note 行（绕开 IPC）。 */
function seedNote(db: WorkstationDb, overrides: Partial<NoteRow> = {}): NoteRow {
  const id = overrides.id ?? ulid();
  const now = new Date();
  const row: NoteRow = {
    id,
    title: overrides.title ?? 'seed',
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

// ============================================================
//  note:list
// ============================================================

describe('note:list', () => {
  it('returns empty list when no notes', async () => {
    const f = makeFixture();
    try {
      const result = await handleNoteList(f.deps, {});
      expect(result).toEqual([]);
    } finally {
      f.close();
    }
  });

  it('orders by updatedAt desc', async () => {
    const f = makeFixture();
    try {
      const a = seedNote(f.db, { title: 'A' });
      await new Promise((r) => setTimeout(r, 5));
      const b = seedNote(f.db, { title: 'B' });
      await new Promise((r) => setTimeout(r, 5));
      const c = seedNote(f.db, { title: 'C' });

      const all = await handleNoteList(f.deps, {});
      // 默认过滤 archived=undefined → 全部返回（按 updatedAt desc）
      expect(all.map((x) => x.id)).toEqual([c.id, b.id, a.id]);
    } finally {
      f.close();
    }
  });

  it('filters by archived=true', async () => {
    const f = makeFixture();
    try {
      const active = seedNote(f.db, { title: 'active' });
      seedNote(f.db, { title: 'archived', archived: 1 });

      const archived = await handleNoteList(f.deps, { archived: true });
      expect(archived).toHaveLength(1);
      expect(archived[0]?.title).toBe('archived');

      const onlyActive = await handleNoteList(f.deps, { archived: false });
      expect(onlyActive).toHaveLength(1);
      expect(onlyActive[0]?.id).toBe(active.id);
    } finally {
      f.close();
    }
  });

  it('filters by projectId (null = no project, id = specific)', async () => {
    const f = makeFixture();
    try {
      const p1 = ulid();
      f.db
        .insert(projects)
        .values({ id: p1, name: 'P1', createdAt: new Date(), updatedAt: new Date() })
        .run();

      seedNote(f.db, { title: 'p1 note', projectId: p1 });
      seedNote(f.db, { title: 'no project', projectId: null });

      const onlyP1 = await handleNoteList(f.deps, { projectId: p1 });
      expect(onlyP1).toHaveLength(1);
      expect(onlyP1[0]?.title).toBe('p1 note');

      const onlyNone = await handleNoteList(f.deps, { projectId: null });
      expect(onlyNone).toHaveLength(1);
      expect(onlyNone[0]?.title).toBe('no project');
    } finally {
      f.close();
    }
  });

  it('filters by tag (LIKE on JSON array)', async () => {
    const f = makeFixture();
    try {
      seedNote(f.db, { title: 'frontend', tags: ['前端', 'react'] });
      seedNote(f.db, { title: 'backend', tags: ['后端', 'db'] });

      const frontend = await handleNoteList(f.deps, { tag: '前端' });
      expect(frontend).toHaveLength(1);
      expect(frontend[0]?.title).toBe('frontend');
    } finally {
      f.close();
    }
  });

  it('rejects invalid filter with VALIDATION_FAILED', async () => {
    const f = makeFixture();
    try {
      await expect(
        handleNoteList(f.deps, { archived: 'yes' as unknown as boolean }),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    } finally {
      f.close();
    }
  });
});

// ============================================================
//  note:get
// ============================================================

describe('note:get', () => {
  it('returns the note by id', async () => {
    const f = makeFixture();
    try {
      const seeded = seedNote(f.db, { title: 'get me' });
      const result = await handleNoteGet(f.deps, { id: seeded.id });
      expect(result.id).toBe(seeded.id);
      expect(result.title).toBe('get me');
      expect(result.archived).toBe(false);
    } finally {
      f.close();
    }
  });

  it('returns NOT_FOUND for unknown id', async () => {
    const f = makeFixture();
    try {
      await expect(handleNoteGet(f.deps, { id: 'NOPE' })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    } finally {
      f.close();
    }
  });

  it('rejects invalid payload with VALIDATION_FAILED', async () => {
    const f = makeFixture();
    try {
      await expect(handleNoteGet(f.deps, { id: '' })).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
      });
    } finally {
      f.close();
    }
  });
});

// ============================================================
//  note:create
// ============================================================

describe('note:create', () => {
  it('creates a note with defaults and returns the row', async () => {
    const f = makeFixture();
    try {
      const result = await handleNoteCreate(f.deps, {
        title: 'New Note',
        content: '# Hello',
      });
      expect(result.id).toHaveLength(26);
      expect(result.title).toBe('New Note');
      expect(result.content).toBe('# Hello');
      expect(result.tags).toEqual([]);
      expect(result.linkedTaskIds).toEqual([]);
      expect(result.projectId).toBeNull();
      expect(result.source).toBe('manual');
      expect(result.archived).toBe(false);
      expect(result.createdAt).toBeGreaterThan(0);
    } finally {
      f.close();
    }
  });

  it('persists tags and linkedTaskIds as JSON arrays', async () => {
    const f = makeFixture();
    try {
      const result = await handleNoteCreate(f.deps, {
        title: 'Tagged',
        content: 'body',
        tags: ['前端', 'P0'],
        linkedTaskIds: ['T_1', 'T_2'],
      });
      expect(result.tags).toEqual(['前端', 'P0']);
      expect(result.linkedTaskIds).toEqual(['T_1', 'T_2']);

      // db 落盘校验（raw row）
      const row = f.db.select().from(notes).where(eq(notes.id, result.id)).get();
      expect(row?.tags).toEqual(['前端', 'P0']);
      expect(row?.linkedTaskIds).toEqual(['T_1', 'T_2']);
    } finally {
      f.close();
    }
  });

  it('rejects empty title with VALIDATION_FAILED', async () => {
    const f = makeFixture();
    try {
      await expect(handleNoteCreate(f.deps, { title: '', content: 'x' })).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
      });
    } finally {
      f.close();
    }
  });
});

// ============================================================
//  note:update
// ============================================================

describe('note:update', () => {
  it('patches specified fields and bumps updatedAt', async () => {
    const f = makeFixture();
    try {
      const seeded = seedNote(f.db, { title: 'old' });
      await new Promise((r) => setTimeout(r, 5));
      const updated = await handleNoteUpdate(f.deps, {
        id: seeded.id,
        patch: { title: 'new', tags: ['a', 'b'] },
      });
      expect(updated.title).toBe('new');
      expect(updated.tags).toEqual(['a', 'b']);
      expect(updated.updatedAt).toBeGreaterThanOrEqual(seeded.updatedAt.getTime());
    } finally {
      f.close();
    }
  });

  it('returns NOT_FOUND for unknown id', async () => {
    const f = makeFixture();
    try {
      await expect(
        handleNoteUpdate(f.deps, { id: 'NOPE', patch: { title: 'x' } }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    } finally {
      f.close();
    }
  });

  it('rejects invalid payload with VALIDATION_FAILED', async () => {
    const f = makeFixture();
    try {
      const seeded = seedNote(f.db, { title: 'ok' });
      await expect(
        handleNoteUpdate(f.deps, { id: seeded.id, patch: { title: '' } }),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    } finally {
      f.close();
    }
  });
});

// ============================================================
//  note:archive
// ============================================================

describe('note:archive', () => {
  it('marks the note archived=1 and returns updated row', async () => {
    const f = makeFixture();
    try {
      const seeded = seedNote(f.db, { title: 'arch me' });
      const archived = await handleNoteArchive(f.deps, { id: seeded.id });
      expect(archived.archived).toBe(true);
      expect(archived.id).toBe(seeded.id);

      const row = f.db.select().from(notes).where(eq(notes.id, seeded.id)).get();
      expect(row?.archived).toBe(1);
    } finally {
      f.close();
    }
  });

  it('returns NOT_FOUND for unknown id', async () => {
    const f = makeFixture();
    try {
      await expect(handleNoteArchive(f.deps, { id: 'NOPE' })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    } finally {
      f.close();
    }
  });

  it('rejects invalid payload with VALIDATION_FAILED', async () => {
    const f = makeFixture();
    try {
      await expect(handleNoteArchive(f.deps, { id: '' })).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
      });
    } finally {
      f.close();
    }
  });
});

// ============================================================
//  note:delete
// ============================================================

describe('note:delete', () => {
  it('hard-deletes the note and returns { deleted: true }', async () => {
    const f = makeFixture();
    try {
      const seeded = seedNote(f.db, { title: 'del' });
      const result = await handleNoteDelete(f.deps, { id: seeded.id });
      expect(result).toEqual({ deleted: true });

      const row = f.db.select().from(notes).where(eq(notes.id, seeded.id)).get();
      expect(row).toBeUndefined();
    } finally {
      f.close();
    }
  });

  it('returns NOT_FOUND for unknown id', async () => {
    const f = makeFixture();
    try {
      await expect(handleNoteDelete(f.deps, { id: 'NOPE' })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    } finally {
      f.close();
    }
  });

  it('rejects invalid payload with VALIDATION_FAILED', async () => {
    const f = makeFixture();
    try {
      await expect(handleNoteDelete(f.deps, { id: '' })).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
      });
    } finally {
      f.close();
    }
  });
});

// ============================================================
//  note:linkToTask
// ============================================================

describe('note:linkToTask', () => {
  it('adds a taskId to linkedTaskIds and returns updated note', async () => {
    const f = makeFixture();
    try {
      const seeded = seedNote(f.db, { title: 'n' });
      const updated = await handleNoteLinkToTask(f.deps, {
        noteId: seeded.id,
        taskId: 'T_1',
      });
      expect(updated.linkedTaskIds).toEqual(['T_1']);
    } finally {
      f.close();
    }
  });

  it('is idempotent: re-adding the same taskId is no-op', async () => {
    const f = makeFixture();
    try {
      const seeded = seedNote(f.db, { title: 'n', linkedTaskIds: ['T_1'] });
      const updated = await handleNoteLinkToTask(f.deps, {
        noteId: seeded.id,
        taskId: 'T_1',
      });
      expect(updated.linkedTaskIds).toEqual(['T_1']);
    } finally {
      f.close();
    }
  });

  it('appends new taskIds to the end (preserves order)', async () => {
    const f = makeFixture();
    try {
      const seeded = seedNote(f.db, { title: 'n', linkedTaskIds: ['T_1'] });
      const updated = await handleNoteLinkToTask(f.deps, {
        noteId: seeded.id,
        taskId: 'T_2',
      });
      expect(updated.linkedTaskIds).toEqual(['T_1', 'T_2']);
    } finally {
      f.close();
    }
  });

  it('returns NOT_FOUND for unknown note', async () => {
    const f = makeFixture();
    try {
      await expect(
        handleNoteLinkToTask(f.deps, { noteId: 'NOPE', taskId: 'T_1' }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    } finally {
      f.close();
    }
  });

  it('does NOT verify task existence (taskStore contract)', async () => {
    // 业务约定：主进程不去校验 taskId 是否存在
    // 任务被硬删后，linkedTaskIds 仍保留 id；UI 层做"任务不存在"提示
    const f = makeFixture();
    try {
      const seeded = seedNote(f.db, { title: 'n' });
      // taskId 故意是一个完全虚构的 id
      const updated = await handleNoteLinkToTask(f.deps, {
        noteId: seeded.id,
        taskId: 'T_GHOST',
      });
      expect(updated.linkedTaskIds).toEqual(['T_GHOST']);
    } finally {
      f.close();
    }
  });

  it('rejects invalid payload with VALIDATION_FAILED', async () => {
    const f = makeFixture();
    try {
      await expect(
        handleNoteLinkToTask(f.deps, { noteId: '', taskId: 'T_1' }),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    } finally {
      f.close();
    }
  });
});

// ============================================================
//  note:unlinkFromTask
// ============================================================

describe('note:unlinkFromTask', () => {
  it('removes the taskId from linkedTaskIds', async () => {
    const f = makeFixture();
    try {
      const seeded = seedNote(f.db, { title: 'n', linkedTaskIds: ['T_1', 'T_2'] });
      const updated = await handleNoteUnlinkFromTask(f.deps, {
        noteId: seeded.id,
        taskId: 'T_1',
      });
      expect(updated.linkedTaskIds).toEqual(['T_2']);
    } finally {
      f.close();
    }
  });

  it('is no-op when taskId is not in linkedTaskIds', async () => {
    const f = makeFixture();
    try {
      const seeded = seedNote(f.db, { title: 'n', linkedTaskIds: ['T_1'] });
      const updated = await handleNoteUnlinkFromTask(f.deps, {
        noteId: seeded.id,
        taskId: 'T_OTHER',
      });
      expect(updated.linkedTaskIds).toEqual(['T_1']);
    } finally {
      f.close();
    }
  });

  it('handles empty linkedTaskIds gracefully', async () => {
    const f = makeFixture();
    try {
      const seeded = seedNote(f.db, { title: 'n' });
      const updated = await handleNoteUnlinkFromTask(f.deps, {
        noteId: seeded.id,
        taskId: 'T_1',
      });
      expect(updated.linkedTaskIds).toEqual([]);
    } finally {
      f.close();
    }
  });

  it('returns NOT_FOUND for unknown note', async () => {
    const f = makeFixture();
    try {
      await expect(
        handleNoteUnlinkFromTask(f.deps, { noteId: 'NOPE', taskId: 'T_1' }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    } finally {
      f.close();
    }
  });

  it('rejects invalid payload with VALIDATION_FAILED', async () => {
    const f = makeFixture();
    try {
      await expect(
        handleNoteUnlinkFromTask(f.deps, { noteId: 'x', taskId: '' }),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    } finally {
      f.close();
    }
  });
});
