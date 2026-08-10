/**
 * Inbox IPC handler 单元测试（T2-2）
 *
 * 直接调 `handleInbox*` 函数（绕开 ipcMain 事件循环），喂临时 db，验证：
 *   - 每个 handler 都有成功 + 失败两条用例
 *   - 错误码符合 PROJECT_IDENTITY.md §4.4
 *     (VALIDATION_FAILED / NOT_FOUND / CONFLICT / PERSISTENCE_FAILED)
 *   - `inbox:convertToTask` 在事务内：写 task + 标 inbox converted
 *   - 失败时事务回滚（task 写失败 → inbox 状态不变）
 *
 * **不依赖 Electron** —— 直接用 `db/client.ts` 的 createDbClient。
 *
 * @see electron/main/ipc/inbox.ts
 */

import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve as resolvePath } from 'node:path';

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeDb, createDbClient, type WorkstationDb } from '../db/client';
import { inboxItems, projects, tasks } from '../db/schema';
import {
  handleInboxAdd,
  handleInboxArchive,
  handleInboxConvertToTask,
  handleInboxList,
  handleInboxUpdate,
  type InboxIpcDeps,
} from '../electron/main/ipc/inbox';
import { ulid } from 'ulidx';

const TMP_ROOT = join(tmpdir(), 'minimax-workstation-inbox-ipc-test');

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
  deps: InboxIpcDeps;
  db: WorkstationDb;
  dbPath: string;
  close: () => void;
}

/** 每个 test 一个独立 db。 */
function makeFixture(): Fixture {
  const dbPath = join(TMP_ROOT, `inbox-ipc-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  const { db } = createDbClient(dbPath, resolvePath(__dirname, '..'));
  return {
    deps: { db },
    db,
    dbPath,
    close: () => closeDb(db),
  };
}

describe('inbox:list', () => {
  it('returns empty list when no items', async () => {
    const f = makeFixture();
    try {
      const result = await handleInboxList(f.deps, {});
      expect(result).toEqual([]);
    } finally {
      f.close();
    }
  });

  it('returns items in createdAt desc order, filtered by status', async () => {
    const f = makeFixture();
    try {
      const a = await handleInboxAdd(f.deps, { content: 'first', kind: 'note' });
      // 加 1ms 间隔保证 createdAt 不同
      await new Promise((r) => setTimeout(r, 5));
      const b = await handleInboxAdd(f.deps, { content: 'second', kind: 'todo' });
      await new Promise((r) => setTimeout(r, 5));
      const c = await handleInboxAdd(f.deps, { content: 'third', kind: 'link' });
      // 把 b 归档
      await handleInboxArchive(f.deps, { id: b.id });

      const active = await handleInboxList(f.deps, { status: 'active' });
      expect(active.map((x) => x.content)).toEqual([c.content, a.content]);

      const archived = await handleInboxList(f.deps, { status: 'archived' });
      expect(archived.map((x) => x.content)).toEqual([b.content]);

      const all = await handleInboxList(f.deps, {});
      // createdAt desc: c(最新) → b → a(最早)
      expect(all.map((x) => x.content)).toEqual([c.content, b.content, a.content]);
    } finally {
      f.close();
    }
  });

  it('rejects invalid filter with VALIDATION_FAILED', async () => {
    const f = makeFixture();
    try {
      await expect(handleInboxList(f.deps, { status: 'nonsense' })).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
      });
    } finally {
      f.close();
    }
  });
});

describe('inbox:add', () => {
  it('creates an item with defaults and returns the row', async () => {
    const f = makeFixture();
    try {
      const result = await handleInboxAdd(f.deps, { content: 'remember milk', kind: 'note' });
      expect(result.id).toHaveLength(26);
      expect(result.content).toBe('remember milk');
      expect(result.kind).toBe('note');
      expect(result.source).toBe('manual');
      expect(result.status).toBe('active');
      expect(result.convertedTo).toBeNull();
      expect(result.projectId).toBeNull();
      expect(result.tags).toEqual([]);
      expect(result.deletedAt).toBeNull();
      expect(result.createdAt).toBeGreaterThan(0);
      expect(result.updatedAt).toBe(result.createdAt);
    } finally {
      f.close();
    }
  });

  it('persists the row to db', async () => {
    const f = makeFixture();
    try {
      const created = await handleInboxAdd(f.deps, { content: 'persist me', kind: 'todo', tags: ['a', 'b'] });
      const row = f.db.select().from(inboxItems).where(eq(inboxItems.id, created.id)).get();
      expect(row).toBeDefined();
      expect(row?.content).toBe('persist me');
      expect(row?.kind).toBe('todo');
      expect(row?.tags).toEqual(['a', 'b']);
    } finally {
      f.close();
    }
  });

  it('rejects invalid input with VALIDATION_FAILED', async () => {
    const f = makeFixture();
    try {
      // 缺 kind
      await expect(handleInboxAdd(f.deps, { content: 'x' })).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
      });
      // 空 content
      await expect(handleInboxAdd(f.deps, { content: '', kind: 'note' })).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
      });
      // 非法 kind
      await expect(handleInboxAdd(f.deps, { content: 'x', kind: 'nope' })).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
      });
    } finally {
      f.close();
    }
  });
});

describe('inbox:update', () => {
  it('patches the specified fields and bumps updatedAt', async () => {
    const f = makeFixture();
    try {
      const created = await handleInboxAdd(f.deps, { content: 'old content', kind: 'note' });
      await new Promise((r) => setTimeout(r, 5));
      const updated = await handleInboxUpdate(f.deps, {
        id: created.id,
        patch: { content: 'new content', tags: ['x'] },
      });
      expect(updated.content).toBe('new content');
      expect(updated.tags).toEqual(['x']);
      expect(updated.kind).toBe('note');
      expect(updated.updatedAt).toBeGreaterThanOrEqual(created.updatedAt);
    } finally {
      f.close();
    }
  });

  it('returns NOT_FOUND for unknown id', async () => {
    const f = makeFixture();
    try {
      await expect(
        handleInboxUpdate(f.deps, { id: 'NONEXISTENT', patch: { content: 'x' } }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    } finally {
      f.close();
    }
  });

  it('rejects invalid payload with VALIDATION_FAILED', async () => {
    const f = makeFixture();
    try {
      const created = await handleInboxAdd(f.deps, { content: 'c', kind: 'note' });
      await expect(
        handleInboxUpdate(f.deps, { id: created.id, patch: { kind: 'nope' } }),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    } finally {
      f.close();
    }
  });
});

describe('inbox:archive', () => {
  it('marks the item status=archived and returns updated row', async () => {
    const f = makeFixture();
    try {
      const created = await handleInboxAdd(f.deps, { content: 'arch me', kind: 'note' });
      const archived = await handleInboxArchive(f.deps, { id: created.id });
      expect(archived.status).toBe('archived');
      expect(archived.id).toBe(created.id);

      const row = f.db.select().from(inboxItems).where(eq(inboxItems.id, created.id)).get();
      expect(row?.status).toBe('archived');
    } finally {
      f.close();
    }
  });

  it('returns NOT_FOUND for unknown id', async () => {
    const f = makeFixture();
    try {
      await expect(handleInboxArchive(f.deps, { id: 'NOPE' })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    } finally {
      f.close();
    }
  });

  it('rejects invalid payload with VALIDATION_FAILED', async () => {
    const f = makeFixture();
    try {
      await expect(handleInboxArchive(f.deps, { id: '' })).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
      });
    } finally {
      f.close();
    }
  });
});

describe('inbox:convertToTask', () => {
  it('writes a task and marks inbox converted in one transaction', async () => {
    const f = makeFixture();
    try {
      const inbox = await handleInboxAdd(f.deps, { content: 'do this thing', kind: 'todo' });
      const result = await handleInboxConvertToTask(f.deps, {
        inboxId: inbox.id,
        taskDraft: { title: 'Do this thing', priority: 'high', tags: ['urgent'] },
      });

      expect(result.inbox.status).toBe('converted');
      expect(result.inbox.convertedTo).toMatch(/^task:/);
      const newTaskId = result.inbox.convertedTo!.slice('task:'.length);
      expect(newTaskId).toHaveLength(26);
      expect(result.task.id).toBe(newTaskId);
      expect(result.task.title).toBe('Do this thing');
      expect(result.task.status).toBe('todo');
      expect(result.task.priority).toBe('high');
      expect(result.task.source).toBe('inbox');
      expect(result.task.inboxId).toBe(inbox.id);
      expect(result.task.tags).toEqual(['urgent']);
      expect(result.task.completedAt).toBeNull();

      // db 状态校验
      const taskRow = f.db.select().from(tasks).where(eq(tasks.id, newTaskId)).get();
      expect(taskRow).toBeDefined();
      const inboxRow = f.db.select().from(inboxItems).where(eq(inboxItems.id, inbox.id)).get();
      expect(inboxRow?.status).toBe('converted');
      expect(inboxRow?.convertedTo).toBe(`task:${newTaskId}`);
    } finally {
      f.close();
    }
  });

  it('parses TaskDraft.dueDate from ISO string', async () => {
    const f = makeFixture();
    try {
      const inbox = await handleInboxAdd(f.deps, { content: 'has due', kind: 'todo' });
      const result = await handleInboxConvertToTask(f.deps, {
        inboxId: inbox.id,
        taskDraft: { title: 'with due', dueDate: '2026-12-01T10:00:00Z' },
      });
      const expected = Date.parse('2026-12-01T10:00:00Z');
      expect(result.task.dueDate).toBe(expected);
    } finally {
      f.close();
    }
  });

  it('rolls back the transaction when task insert fails (FK violation on projectId)', async () => {
    const f = makeFixture();
    try {
      const inbox = await handleInboxAdd(f.deps, { content: 'fk fail', kind: 'todo' });
      const fakeProjectId = ulid();

      await expect(
        handleInboxConvertToTask(f.deps, {
          inboxId: inbox.id,
          taskDraft: { title: 'will fail', projectId: fakeProjectId },
        }),
      ).rejects.toMatchObject({ code: 'PERSISTENCE_FAILED' });

      // 事务回滚：inbox 状态保持 active；没有 task 被写入
      const inboxRow = f.db.select().from(inboxItems).where(eq(inboxItems.id, inbox.id)).get();
      expect(inboxRow?.status).toBe('active');
      expect(inboxRow?.convertedTo).toBeNull();

      const taskRows = f.db.select().from(tasks).all();
      expect(taskRows).toHaveLength(0);
    } finally {
      f.close();
    }
  });

  it('returns NOT_FOUND for unknown inboxId', async () => {
    const f = makeFixture();
    try {
      await expect(
        handleInboxConvertToTask(f.deps, {
          inboxId: 'NOPE',
          taskDraft: { title: 't' },
        }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    } finally {
      f.close();
    }
  });

  it('returns CONFLICT when inbox is already converted', async () => {
    const f = makeFixture();
    try {
      const inbox = await handleInboxAdd(f.deps, { content: 'twice', kind: 'todo' });
      await handleInboxConvertToTask(f.deps, { inboxId: inbox.id, taskDraft: { title: 'first' } });
      await expect(
        handleInboxConvertToTask(f.deps, { inboxId: inbox.id, taskDraft: { title: 'second' } }),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
    } finally {
      f.close();
    }
  });

  it('rejects missing title with VALIDATION_FAILED', async () => {
    const f = makeFixture();
    try {
      const inbox = await handleInboxAdd(f.deps, { content: 'no title', kind: 'todo' });
      await expect(
        handleInboxConvertToTask(f.deps, { inboxId: inbox.id, taskDraft: {} }),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    } finally {
      f.close();
    }
  });

  it('rejects invalid priority with VALIDATION_FAILED', async () => {
    const f = makeFixture();
    try {
      const inbox = await handleInboxAdd(f.deps, { content: 'bad prio', kind: 'todo' });
      await expect(
        handleInboxConvertToTask(f.deps, {
          inboxId: inbox.id,
          taskDraft: { title: 't', priority: 'urgent' as unknown as 'high' },
        }),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    } finally {
      f.close();
    }
  });

  it('uses real projectId when FK is valid (sanity check)', async () => {
    const f = makeFixture();
    try {
      const projectId = ulid();
      f.db
        .insert(projects)
        .values({ id: projectId, name: 'Test', createdAt: new Date(), updatedAt: new Date() })
        .run();

      const inbox = await handleInboxAdd(f.deps, { content: 'with project', kind: 'todo' });
      const result = await handleInboxConvertToTask(f.deps, {
        inboxId: inbox.id,
        taskDraft: { title: 't', projectId },
      });
      expect(result.task.projectId).toBe(projectId);
    } finally {
      f.close();
    }
  });
});
