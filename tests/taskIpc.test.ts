/**
 * Task IPC handler 单元测试（T2-3）
 *
 * 直接调 `handleTask*` 函数（绕开 ipcMain 事件循环），喂临时 db，验证：
 *   - 每个 handler 都有成功 + 失败两条用例
 *   - 错误码符合 PROJECT_IDENTITY.md §4.4
 *     (VALIDATION_FAILED / NOT_FOUND / CONFLICT / PERSISTENCE_FAILED)
 *   - **状态机强制**：`task:transition` 非法流转抛 CONFLICT
 *   - **`completedAt` 联动**：转 done 填时间，转出 done 清空
 *   - 7 个 handler + 状态机 + completedAt 联动
 *
 * **不依赖 Electron** —— 直接用 `db/client.ts` 的 createDbClient。
 *
 * @see electron/main/ipc/task.ts
 */

import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve as resolvePath } from 'node:path';

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeDb, createDbClient, type WorkstationDb } from '../db/client';
import { projects, tasks, type TaskRow } from '../db/schema';
import {
  handleTaskArchive,
  handleTaskCreate,
  handleTaskDelete,
  handleTaskGet,
  handleTaskList,
  handleTaskTransition,
  handleTaskUpdate,
  type TaskIpcDeps,
} from '../electron/main/ipc/task';
import type { TaskStatus } from '../shared/types/taskStatus';
import { ulid } from 'ulidx';

const TMP_ROOT = join(tmpdir(), 'minimax-workstation-task-ipc-test');

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
  deps: TaskIpcDeps;
  db: WorkstationDb;
  close: () => void;
}

function makeFixture(): Fixture {
  const dbPath = join(TMP_ROOT, `task-ipc-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  const { db } = createDbClient(dbPath, resolvePath(__dirname, '..'));
  return {
    deps: { db },
    db,
    close: () => closeDb(db),
  };
}

/** 工具：直接在 db 里建一个 task 行（绕开 IPC，用于状态机测试）。 */
function seedTask(db: WorkstationDb, overrides: Partial<TaskRow> = {}): TaskRow {
  const id = overrides.id ?? ulid();
  const now = new Date();
  const row: TaskRow = {
    id,
    title: overrides.title ?? 'seed',
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

// ============================================================
//  task:list
// ============================================================

describe('task:list', () => {
  it('returns empty list when no tasks', async () => {
    const f = makeFixture();
    try {
      const result = await handleTaskList(f.deps, {});
      expect(result).toEqual([]);
    } finally {
      f.close();
    }
  });

  it('orders by createdAt desc and filters by status/priority/projectId', async () => {
    const f = makeFixture();
    try {
      const p1 = ulid();
      f.db
        .insert(projects)
        .values({ id: p1, name: 'P1', createdAt: new Date(), updatedAt: new Date() })
        .run();

      const t1 = seedTask(f.db, { title: 'low todo', priority: 'low', status: 'todo', projectId: p1 });
      await new Promise((r) => setTimeout(r, 5));
      const t2 = seedTask(f.db, { title: 'high doing', priority: 'high', status: 'doing', projectId: p1 });
      await new Promise((r) => setTimeout(r, 5));
      const t3 = seedTask(f.db, { title: 'high todo none', priority: 'high', status: 'todo', projectId: null });

      const all = await handleTaskList(f.deps, {});
      expect(all.map((x) => x.id)).toEqual([t3.id, t2.id, t1.id]);

      const onlyTodo = await handleTaskList(f.deps, { status: 'todo' });
      expect(onlyTodo.map((x) => x.id).sort()).toEqual([t1.id, t3.id].sort());

      const onlyHigh = await handleTaskList(f.deps, { priority: 'high' });
      expect(onlyHigh.map((x) => x.id).sort()).toEqual([t2.id, t3.id].sort());

      const onlyP1 = await handleTaskList(f.deps, { projectId: p1 });
      expect(onlyP1.map((x) => x.id).sort()).toEqual([t1.id, t2.id].sort());

      const onlyNone = await handleTaskList(f.deps, { projectId: null });
      expect(onlyNone.map((x) => x.id)).toEqual([t3.id]);
    } finally {
      f.close();
    }
  });

  it('rejects invalid filter with VALIDATION_FAILED', async () => {
    const f = makeFixture();
    try {
      await expect(handleTaskList(f.deps, { status: 'nonsense' as TaskStatus })).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
      });
    } finally {
      f.close();
    }
  });
});

// ============================================================
//  task:get
// ============================================================

describe('task:get', () => {
  it('returns the task by id', async () => {
    const f = makeFixture();
    try {
      const seeded = seedTask(f.db, { title: 'get me' });
      const result = await handleTaskGet(f.deps, { id: seeded.id });
      expect(result.id).toBe(seeded.id);
      expect(result.title).toBe('get me');
      expect(result.status).toBe('todo');
    } finally {
      f.close();
    }
  });

  it('returns NOT_FOUND for unknown id', async () => {
    const f = makeFixture();
    try {
      await expect(handleTaskGet(f.deps, { id: 'NOPE' })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    } finally {
      f.close();
    }
  });

  it('rejects invalid payload with VALIDATION_FAILED', async () => {
    const f = makeFixture();
    try {
      await expect(handleTaskGet(f.deps, { id: '' })).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
      });
    } finally {
      f.close();
    }
  });
});

// ============================================================
//  task:create
// ============================================================

describe('task:create', () => {
  it('creates a task with defaults and returns the row', async () => {
    const f = makeFixture();
    try {
      const result = await handleTaskCreate(f.deps, { title: 'New Task' });
      expect(result.id).toHaveLength(26);
      expect(result.title).toBe('New Task');
      expect(result.status).toBe('todo');
      expect(result.priority).toBe('medium');
      expect(result.description).toBeNull();
      expect(result.projectId).toBeNull();
      expect(result.tags).toEqual([]);
      expect(result.source).toBe('manual');
      expect(result.completedAt).toBeNull();
      expect(result.createdAt).toBeGreaterThan(0);
    } finally {
      f.close();
    }
  });

  it('creates with status=done and sets completedAt to a recent timestamp', async () => {
    const f = makeFixture();
    try {
      const before = Date.now();
      const result = await handleTaskCreate(f.deps, { title: 'Done at start', status: 'done' });
      const after = Date.now();
      expect(result.status).toBe('done');
      expect(result.completedAt).not.toBeNull();
      expect(result.completedAt!).toBeGreaterThanOrEqual(before);
      expect(result.completedAt!).toBeLessThanOrEqual(after);
    } finally {
      f.close();
    }
  });

  it('rejects invalid input with VALIDATION_FAILED', async () => {
    const f = makeFixture();
    try {
      await expect(handleTaskCreate(f.deps, {})).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
      });
      await expect(
        handleTaskCreate(f.deps, { title: 'x', status: 'nonsense' as TaskStatus }),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    } finally {
      f.close();
    }
  });
});

// ============================================================
//  task:update
// ============================================================

describe('task:update', () => {
  it('patches specified fields and bumps updatedAt', async () => {
    const f = makeFixture();
    try {
      const seeded = seedTask(f.db, { title: 'old' });
      await new Promise((r) => setTimeout(r, 5));
      const updated = await handleTaskUpdate(f.deps, {
        id: seeded.id,
        patch: { title: 'new', tags: ['a', 'b'] },
      });
      expect(updated.title).toBe('new');
      expect(updated.tags).toEqual(['a', 'b']);
      expect(updated.status).toBe('todo');
      expect(updated.updatedAt).toBeGreaterThanOrEqual(seeded.updatedAt.getTime());
    } finally {
      f.close();
    }
  });

  it('returns NOT_FOUND for unknown id', async () => {
    const f = makeFixture();
    try {
      await expect(
        handleTaskUpdate(f.deps, { id: 'NOPE', patch: { title: 'x' } }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    } finally {
      f.close();
    }
  });

  it('rejects invalid payload with VALIDATION_FAILED', async () => {
    const f = makeFixture();
    try {
      const seeded = seedTask(f.db, { title: 'ok' });
      await expect(
        handleTaskUpdate(f.deps, { id: seeded.id, patch: { title: '' } }),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    } finally {
      f.close();
    }
  });

  it('enforces state machine on status patch (todo -> done is CONFLICT)', async () => {
    const f = makeFixture();
    try {
      const seeded = seedTask(f.db, { status: 'todo' });
      await expect(
        handleTaskUpdate(f.deps, {
          id: seeded.id,
          patch: { status: 'done' },
        }),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
    } finally {
      f.close();
    }
  });

  it('allows todo -> doing in update and keeps completedAt unchanged', async () => {
    const f = makeFixture();
    try {
      const seeded = seedTask(f.db, { status: 'todo', completedAt: null });
      const updated = await handleTaskUpdate(f.deps, {
        id: seeded.id,
        patch: { status: 'doing' },
      });
      expect(updated.status).toBe('doing');
      expect(updated.completedAt).toBeNull();
    } finally {
      f.close();
    }
  });
});

// ============================================================
//  task:transition
// ============================================================

describe('task:transition', () => {
  it('todo -> doing succeeds, completedAt stays null', async () => {
    const f = makeFixture();
    try {
      const seeded = seedTask(f.db, { status: 'todo' });
      const updated = await handleTaskTransition(f.deps, { id: seeded.id, to: 'doing' });
      expect(updated.status).toBe('doing');
      expect(updated.completedAt).toBeNull();
    } finally {
      f.close();
    }
  });

  it('todo -> done is illegal (CONFLICT) — must go through doing', async () => {
    const f = makeFixture();
    try {
      const seeded = seedTask(f.db, { status: 'todo' });
      await expect(
        handleTaskTransition(f.deps, { id: seeded.id, to: 'done' }),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
    } finally {
      f.close();
    }
  });

  it('doing -> done succeeds, completedAt is set to recent timestamp', async () => {
    const f = makeFixture();
    try {
      const seeded = seedTask(f.db, { status: 'doing' });
      const before = Date.now();
      const updated = await handleTaskTransition(f.deps, { id: seeded.id, to: 'done' });
      const after = Date.now();
      expect(updated.status).toBe('done');
      expect(updated.completedAt).not.toBeNull();
      expect(updated.completedAt!).toBeGreaterThanOrEqual(before);
      expect(updated.completedAt!).toBeLessThanOrEqual(after);

      // db 落盘校验
      const row = f.db.select().from(tasks).where(eq(tasks.id, seeded.id)).get();
      expect(row?.completedAt).not.toBeNull();
    } finally {
      f.close();
    }
  });

  it('done -> todo (reopen) succeeds, completedAt is cleared', async () => {
    // 注：T2-1 状态机定义的"重开"路径是 done -> todo（不是 done -> doing）
    // 这是 ALLOWED_TRANSITIONS 单一真源：done: ['todo', 'archived']
    const f = makeFixture();
    try {
      const completedAt = new Date(Date.now() - 1000);
      const seeded = seedTask(f.db, { status: 'done', completedAt });
      const updated = await handleTaskTransition(f.deps, { id: seeded.id, to: 'todo' });
      expect(updated.status).toBe('todo');
      expect(updated.completedAt).toBeNull();

      const row = f.db.select().from(tasks).where(eq(tasks.id, seeded.id)).get();
      expect(row?.completedAt).toBeNull();
    } finally {
      f.close();
    }
  });

  it('done -> doing is illegal per state machine (CONFLICT)', async () => {
    // T2-1 状态机规定 done 不能直接转 doing；必须先 done -> todo -> doing
    const f = makeFixture();
    try {
      const seeded = seedTask(f.db, { status: 'done', completedAt: new Date() });
      await expect(
        handleTaskTransition(f.deps, { id: seeded.id, to: 'doing' }),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
    } finally {
      f.close();
    }
  });

  it('done -> todo succeeds and clears completedAt', async () => {
    const f = makeFixture();
    try {
      const completedAt = new Date();
      const seeded = seedTask(f.db, { status: 'done', completedAt });
      const updated = await handleTaskTransition(f.deps, { id: seeded.id, to: 'todo' });
      expect(updated.status).toBe('todo');
      expect(updated.completedAt).toBeNull();
    } finally {
      f.close();
    }
  });

  it('done -> archived succeeds and clears completedAt', async () => {
    const f = makeFixture();
    try {
      const completedAt = new Date();
      const seeded = seedTask(f.db, { status: 'done', completedAt });
      const updated = await handleTaskTransition(f.deps, { id: seeded.id, to: 'archived' });
      expect(updated.status).toBe('archived');
      expect(updated.completedAt).toBeNull();
    } finally {
      f.close();
    }
  });

  it('archived -> todo succeeds and restores from archive', async () => {
    const f = makeFixture();
    try {
      const seeded = seedTask(f.db, { status: 'archived' });
      const updated = await handleTaskTransition(f.deps, { id: seeded.id, to: 'todo' });
      expect(updated.status).toBe('todo');
    } finally {
      f.close();
    }
  });

  it('identity transition (todo -> todo) is CONFLICT', async () => {
    const f = makeFixture();
    try {
      const seeded = seedTask(f.db, { status: 'todo' });
      await expect(
        handleTaskTransition(f.deps, { id: seeded.id, to: 'todo' }),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
    } finally {
      f.close();
    }
  });

  it('archived -> doing is illegal (CONFLICT)', async () => {
    const f = makeFixture();
    try {
      const seeded = seedTask(f.db, { status: 'archived' });
      await expect(
        handleTaskTransition(f.deps, { id: seeded.id, to: 'doing' }),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
    } finally {
      f.close();
    }
  });

  it('returns NOT_FOUND for unknown id', async () => {
    const f = makeFixture();
    try {
      await expect(
        handleTaskTransition(f.deps, { id: 'NOPE', to: 'doing' }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    } finally {
      f.close();
    }
  });

  it('rejects invalid payload with VALIDATION_FAILED', async () => {
    const f = makeFixture();
    try {
      await expect(
        handleTaskTransition(f.deps, { id: '', to: 'doing' }),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
      await expect(
        handleTaskTransition(f.deps, { id: 'x', to: 'nonsense' as TaskStatus }),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    } finally {
      f.close();
    }
  });
});

// ============================================================
//  task:archive
// ============================================================

describe('task:archive', () => {
  it('transitions any non-archived task to archived', async () => {
    const f = makeFixture();
    try {
      const todo = seedTask(f.db, { status: 'todo' });
      const doing = seedTask(f.db, { status: 'doing' });
      const done = seedTask(f.db, { status: 'done', completedAt: new Date() });

      const r1 = await handleTaskArchive(f.deps, { id: todo.id });
      expect(r1.status).toBe('archived');

      const r2 = await handleTaskArchive(f.deps, { id: doing.id });
      expect(r2.status).toBe('archived');

      const r3 = await handleTaskArchive(f.deps, { id: done.id });
      expect(r3.status).toBe('archived');
      expect(r3.completedAt).toBeNull();
    } finally {
      f.close();
    }
  });

  it('returns NOT_FOUND for unknown id', async () => {
    const f = makeFixture();
    try {
      await expect(handleTaskArchive(f.deps, { id: 'NOPE' })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    } finally {
      f.close();
    }
  });

  it('rejects archive from archived (identity transition -> CONFLICT)', async () => {
    const f = makeFixture();
    try {
      const seeded = seedTask(f.db, { status: 'archived' });
      await expect(handleTaskArchive(f.deps, { id: seeded.id })).rejects.toMatchObject({
        code: 'CONFLICT',
      });
    } finally {
      f.close();
    }
  });
});

// ============================================================
//  task:delete
// ============================================================

describe('task:delete', () => {
  it('hard-deletes the task and returns { deleted: true }', async () => {
    const f = makeFixture();
    try {
      const seeded = seedTask(f.db, { title: 'del' });
      const result = await handleTaskDelete(f.deps, { id: seeded.id });
      expect(result).toEqual({ deleted: true });

      const row = f.db.select().from(tasks).where(eq(tasks.id, seeded.id)).get();
      expect(row).toBeUndefined();
    } finally {
      f.close();
    }
  });

  it('returns NOT_FOUND for unknown id', async () => {
    const f = makeFixture();
    try {
      await expect(handleTaskDelete(f.deps, { id: 'NOPE' })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    } finally {
      f.close();
    }
  });

  it('rejects invalid payload with VALIDATION_FAILED', async () => {
    const f = makeFixture();
    try {
      await expect(handleTaskDelete(f.deps, { id: '' })).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
      });
    } finally {
      f.close();
    }
  });
});
