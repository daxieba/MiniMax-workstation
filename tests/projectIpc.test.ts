/**
 * Project IPC handler 单元测试（T2-3）
 *
 * 直接调 `handleProject*` 函数（绕开 ipcMain 事件循环），喂临时 db，验证：
 *   - 每个 handler 都有成功 + 失败两条用例
 *   - 错误码符合 PROJECT_IDENTITY.md §4.4
 *     (VALIDATION_FAILED / NOT_FOUND / PERSISTENCE_FAILED)
 *   - `project:list` 排序：未归档按 createdAt desc 在前
 *   - `project:archive` 设 `archived=1`
 *   - `project:delete` 硬删
 *
 * **不依赖 Electron** —— 直接用 `db/client.ts` 的 createDbClient。
 *
 * @see electron/main/ipc/project.ts
 */

import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve as resolvePath } from 'node:path';

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeDb, createDbClient, type WorkstationDb } from '../db/client';
import { projects, tasks, inboxItems } from '../db/schema';
import {
  handleProjectArchive,
  handleProjectCreate,
  handleProjectDelete,
  handleProjectList,
  handleProjectUpdate,
  type ProjectIpcDeps,
} from '../electron/main/ipc/project';
import { ulid } from 'ulidx';

const TMP_ROOT = join(tmpdir(), 'minimax-workstation-project-ipc-test');

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
  deps: ProjectIpcDeps;
  db: WorkstationDb;
  close: () => void;
}

function makeFixture(): Fixture {
  const dbPath = join(TMP_ROOT, `project-ipc-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  const { db } = createDbClient(dbPath, resolvePath(__dirname, '..'));
  return {
    deps: { db },
    db,
    close: () => closeDb(db),
  };
}

describe('project:list', () => {
  it('returns empty list when no projects', async () => {
    const f = makeFixture();
    try {
      const result = await handleProjectList(f.deps, {});
      expect(result).toEqual([]);
    } finally {
      f.close();
    }
  });

  it('orders active projects by createdAt desc, archived last', async () => {
    const f = makeFixture();
    try {
      const a = await handleProjectCreate(f.deps, { name: 'A' });
      await new Promise((r) => setTimeout(r, 5));
      const b = await handleProjectCreate(f.deps, { name: 'B' });
      await new Promise((r) => setTimeout(r, 5));
      const c = await handleProjectCreate(f.deps, { name: 'C' });
      await handleProjectArchive(f.deps, { id: a.id });

      // 全部：active 在前 (desc)，archived 在后
      const all = await handleProjectList(f.deps, {});
      expect(all.map((x) => x.name)).toEqual([c.name, b.name, a.name]);

      // 只 active
      const active = await handleProjectList(f.deps, { archived: false });
      expect(active.map((x) => x.name)).toEqual([c.name, b.name]);

      // 只 archived
      const archived = await handleProjectList(f.deps, { archived: true });
      expect(archived.map((x) => x.name)).toEqual([a.name]);
    } finally {
      f.close();
    }
  });

  it('rejects invalid filter with VALIDATION_FAILED', async () => {
    const f = makeFixture();
    try {
      await expect(handleProjectList(f.deps, { archived: 'yes' as unknown as boolean })).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
      });
    } finally {
      f.close();
    }
  });
});

describe('project:create', () => {
  it('creates a project with defaults and returns the row', async () => {
    const f = makeFixture();
    try {
      const result = await handleProjectCreate(f.deps, { name: 'My Project', color: '#3B82F6' });
      expect(result.id).toHaveLength(26);
      expect(result.name).toBe('My Project');
      expect(result.color).toBe('#3B82F6');
      expect(result.description).toBeNull();
      expect(result.archived).toBe(false);
      expect(result.createdAt).toBeGreaterThan(0);
      expect(result.updatedAt).toBe(result.createdAt);
    } finally {
      f.close();
    }
  });

  it('persists the row to db', async () => {
    const f = makeFixture();
    try {
      const created = await handleProjectCreate(f.deps, { name: 'Persist', description: 'desc' });
      const row = f.db.select().from(projects).where(eq(projects.id, created.id)).get();
      expect(row).toBeDefined();
      expect(row?.name).toBe('Persist');
      expect(row?.description).toBe('desc');
      expect(row?.archived).toBe(0);
    } finally {
      f.close();
    }
  });

  it('rejects invalid input with VALIDATION_FAILED', async () => {
    const f = makeFixture();
    try {
      // 缺 name
      await expect(handleProjectCreate(f.deps, {})).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
      });
      // 空 name
      await expect(handleProjectCreate(f.deps, { name: '' })).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
      });
      // 非法 color
      await expect(handleProjectCreate(f.deps, { name: 'x', color: 'not-hex' })).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
      });
    } finally {
      f.close();
    }
  });
});

describe('project:update', () => {
  it('patches the specified fields and bumps updatedAt', async () => {
    const f = makeFixture();
    try {
      const created = await handleProjectCreate(f.deps, { name: 'old name' });
      await new Promise((r) => setTimeout(r, 5));
      const updated = await handleProjectUpdate(f.deps, {
        id: created.id,
        patch: { name: 'new name', color: '#FF0000' },
      });
      expect(updated.name).toBe('new name');
      expect(updated.color).toBe('#FF0000');
      expect(updated.updatedAt).toBeGreaterThanOrEqual(created.updatedAt);
    } finally {
      f.close();
    }
  });

  it('returns NOT_FOUND for unknown id', async () => {
    const f = makeFixture();
    try {
      await expect(
        handleProjectUpdate(f.deps, { id: 'NONEXISTENT', patch: { name: 'x' } }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    } finally {
      f.close();
    }
  });

  it('rejects invalid payload with VALIDATION_FAILED', async () => {
    const f = makeFixture();
    try {
      const created = await handleProjectCreate(f.deps, { name: 'ok' });
      await expect(
        handleProjectUpdate(f.deps, { id: created.id, patch: { name: '' } }),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    } finally {
      f.close();
    }
  });
});

describe('project:archive', () => {
  it('marks the project archived=1 and returns updated row', async () => {
    const f = makeFixture();
    try {
      const created = await handleProjectCreate(f.deps, { name: 'arch me' });
      const archived = await handleProjectArchive(f.deps, { id: created.id });
      expect(archived.archived).toBe(true);
      expect(archived.id).toBe(created.id);

      const row = f.db.select().from(projects).where(eq(projects.id, created.id)).get();
      expect(row?.archived).toBe(1);
    } finally {
      f.close();
    }
  });

  it('returns NOT_FOUND for unknown id', async () => {
    const f = makeFixture();
    try {
      await expect(handleProjectArchive(f.deps, { id: 'NOPE' })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    } finally {
      f.close();
    }
  });

  it('rejects invalid payload with VALIDATION_FAILED', async () => {
    const f = makeFixture();
    try {
      await expect(handleProjectArchive(f.deps, { id: '' })).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
      });
    } finally {
      f.close();
    }
  });
});

describe('project:delete', () => {
  it('hard-deletes the project and returns { deleted: true }', async () => {
    const f = makeFixture();
    try {
      const created = await handleProjectCreate(f.deps, { name: 'del me' });
      const result = await handleProjectDelete(f.deps, { id: created.id });
      expect(result).toEqual({ deleted: true });

      const row = f.db.select().from(projects).where(eq(projects.id, created.id)).get();
      expect(row).toBeUndefined();
    } finally {
      f.close();
    }
  });

  it('returns NOT_FOUND for unknown id', async () => {
    const f = makeFixture();
    try {
      await expect(handleProjectDelete(f.deps, { id: 'NOPE' })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    } finally {
      f.close();
    }
  });

  it('rejects delete when project has tasks (FK violation -> PERSISTENCE_FAILED)', async () => {
    const f = makeFixture();
    try {
      const projectId = ulid();
      const taskId = ulid();
      const now = new Date();
      f.db.insert(projects).values({ id: projectId, name: 'P', createdAt: now, updatedAt: now }).run();
      f.db.insert(tasks).values({
        id: taskId,
        title: 't',
        status: 'todo',
        priority: 'medium',
        projectId,
        tags: [],
        source: 'manual',
        noteIds: [],
        createdAt: now,
        updatedAt: now,
      }).run();

      await expect(handleProjectDelete(f.deps, { id: projectId })).rejects.toMatchObject({
        code: 'PERSISTENCE_FAILED',
      });

      // 行还在
      const row = f.db.select().from(projects).where(eq(projects.id, projectId)).get();
      expect(row).toBeDefined();
    } finally {
      f.close();
    }
  });

  it('rejects delete when project has inbox items (FK violation -> PERSISTENCE_FAILED)', async () => {
    const f = makeFixture();
    try {
      const projectId = ulid();
      const inboxId = ulid();
      const now = new Date();
      f.db.insert(projects).values({ id: projectId, name: 'P', createdAt: now, updatedAt: now }).run();
      f.db.insert(inboxItems).values({
        id: inboxId,
        content: 'c',
        kind: 'note',
        source: 'manual',
        status: 'active',
        projectId,
        tags: [],
        createdAt: now,
        updatedAt: now,
      }).run();

      await expect(handleProjectDelete(f.deps, { id: projectId })).rejects.toMatchObject({
        code: 'PERSISTENCE_FAILED',
      });
    } finally {
      f.close();
    }
  });

  it('rejects invalid payload with VALIDATION_FAILED', async () => {
    const f = makeFixture();
    try {
      await expect(handleProjectDelete(f.deps, { id: '' })).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
      });
    } finally {
      f.close();
    }
  });
});
