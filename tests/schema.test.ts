/**
 * 业务表 schema 验证测试（T2-1）
 *
 * 覆盖：
 *   - 3 张业务表（projects / inbox_items / tasks）迁移后能创建
 *   - 字段结构：必填 / 可空 / 默认值
 *   - 外键约束：inbox_items.project_id → projects.id；tasks.project_id → projects.id；tasks.inbox_id → inbox_items.id
 *   - 插入 / 读取 round-trip：text / integer / JSON (tags / noteIds) 都正确还原
 *   - JSON 列：`tags` / `noteIds` 默认 `[]`；应用层 JSON 序列化后能正确存取
 *
 * **不依赖业务 IPC handler**（T2-2 / T2-3 范围）—— 只验证 db schema 层。
 *
 * 用临时目录（`tests/.tmp/`）隔离，每个 test 独立 db。
 *
 * @see db/schema/{project,inbox,task}.ts
 * @see db/migrations/0002_init_business_tables.sql
 */

import { eq } from 'drizzle-orm';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve as resolvePath } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { closeDb, createDbClient } from '../db/client';
import { inboxItems, projects, tasks } from '../db/schema';
import type { InboxItemRow, ProjectRow, TaskRow } from '../db/schema';

const TMP_ROOT = join(tmpdir(), 'minimax-workstation-schema-test');

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

/** ulidx 生成 26 字符 ULID。 */
async function nextId(): Promise<string> {
  const { ulid } = await import('ulidx');
  return ulid();
}

/** 当前时间（毫秒 Date，用于 timestamp_ms 列）。 */
function now(): Date {
  return new Date();
}

describe('T2-1 schema: 3 business tables exist after migration', () => {
  let dbPath: string;

  beforeEach(() => {
    dbPath = join(TMP_ROOT, `schema-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  });

  it('creates 3 business tables (projects, inbox_items, tasks)', () => {
    const { db, info } = createDbClient(dbPath, resolvePath(__dirname, '..'));
    try {
      expect(info.migrated).toBe(true);
      // 至少 2 个迁移（0001 + 0002）
      expect(info.schemaVersion).toBeGreaterThanOrEqual(2);

      const tableNames = db.$client
        .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        .all()
        .map((r) => (r as { name: string }).name);

      expect(tableNames).toContain('app_meta');
      expect(tableNames).toContain('projects');
      expect(tableNames).toContain('inbox_items');
      expect(tableNames).toContain('tasks');
    } finally {
      closeDb(db);
    }
  });
});

describe('T2-1 schema: projects table', () => {
  let dbPath: string;

  beforeEach(() => {
    dbPath = join(TMP_ROOT, `projects-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  });

  it('inserts and reads back a minimal project', async () => {
    const { db } = createDbClient(dbPath, resolvePath(__dirname, '..'));
    try {
      const id = await nextId();
      const t = now();
      db.insert(projects)
        .values({
          id,
          name: 'My Project',
          description: null,
          color: null,
          archived: 0,
          createdAt: t,
          updatedAt: t,
        })
        .run();

      const row = db.select().from(projects).where(eq(projects.id, id)).get();
      expect(row).toBeDefined();
      expect(row?.name).toBe('My Project');
      expect(row?.description).toBeNull();
      expect(row?.color).toBeNull();
      expect(row?.archived).toBe(0);
      expect(row?.createdAt.getTime()).toBe(t.getTime());
      expect(row?.updatedAt.getTime()).toBe(t.getTime());
    } finally {
      closeDb(db);
    }
  });

  it('defaults archived to 0', async () => {
    const { db } = createDbClient(dbPath, resolvePath(__dirname, '..'));
    try {
      const id = await nextId();
      db.insert(projects)
        .values({ id, name: 'No Archived Flag', createdAt: now(), updatedAt: now() })
        .run();

      const row: ProjectRow | undefined = db
        .select()
        .from(projects)
        .where(eq(projects.id, id))
        .get();
      expect(row?.archived).toBe(0);
    } finally {
      closeDb(db);
    }
  });
});

describe('T2-1 schema: inbox_items table', () => {
  let dbPath: string;

  beforeEach(() => {
    dbPath = join(TMP_ROOT, `inbox-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  });

  it('inserts and reads back with defaults (source=manual, status=active, tags=[])', async () => {
    const { db } = createDbClient(dbPath, resolvePath(__dirname, '..'));
    try {
      const id = await nextId();
      const t = now();
      db.insert(inboxItems)
        .values({
          id,
          content: 'something to remember',
          kind: 'note',
          // source / status / tags 用列默认值
          createdAt: t,
          updatedAt: t,
        })
        .run();

      const row: InboxItemRow | undefined = db
        .select()
        .from(inboxItems)
        .where(eq(inboxItems.id, id))
        .get();

      expect(row).toBeDefined();
      expect(row?.content).toBe('something to remember');
      expect(row?.kind).toBe('note');
      expect(row?.source).toBe('manual');
      expect(row?.status).toBe('active');
      expect(row?.convertedTo).toBeNull();
      expect(row?.projectId).toBeNull();
      expect(row?.tags).toEqual([]);
      expect(row?.deletedAt).toBeNull();
    } finally {
      closeDb(db);
    }
  });

  it('round-trips tags as JSON array', async () => {
    const { db } = createDbClient(dbPath, resolvePath(__dirname, '..'));
    try {
      const id = await nextId();
      const t = now();
      const myTags = ['urgent', 'review', 'q3'];
      db.insert(inboxItems)
        .values({
          id,
          content: 'with tags',
          kind: 'todo',
          tags: myTags,
          createdAt: t,
          updatedAt: t,
        })
        .run();

      const row = db.select().from(inboxItems).where(eq(inboxItems.id, id)).get();
      expect(row?.tags).toEqual(myTags);
    } finally {
      closeDb(db);
    }
  });

  it('foreign key: project_id references projects.id (rejects orphan)', async () => {
    const { db } = createDbClient(dbPath, resolvePath(__dirname, '..'));
    try {
      const fakeProjectId = await nextId();
      const id = await nextId();
      const t = now();
      // project_id 指向不存在的 projects.id
      expect(() =>
        db
          .insert(inboxItems)
          .values({
            id,
            content: 'orphan',
            kind: 'note',
            projectId: fakeProjectId,
            createdAt: t,
            updatedAt: t,
          })
          .run(),
      ).toThrow(/FOREIGN KEY/i);
    } finally {
      closeDb(db);
    }
  });

  it('foreign key: project_id valid when project exists', async () => {
    const { db } = createDbClient(dbPath, resolvePath(__dirname, '..'));
    try {
      const projectId = await nextId();
      const t = now();
      db.insert(projects)
        .values({ id: projectId, name: 'Inbox FK Project', createdAt: t, updatedAt: t })
        .run();

      const id = await nextId();
      db.insert(inboxItems)
        .values({
          id,
          content: 'linked',
          kind: 'note',
          projectId,
          createdAt: t,
          updatedAt: t,
        })
        .run();

      const row = db.select().from(inboxItems).where(eq(inboxItems.id, id)).get();
      expect(row?.projectId).toBe(projectId);
    } finally {
      closeDb(db);
    }
  });
});

describe('T2-1 schema: tasks table', () => {
  let dbPath: string;

  beforeEach(() => {
    dbPath = join(TMP_ROOT, `tasks-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  });

  it('inserts and reads back with defaults (status=todo, priority=medium, tags=[], noteIds=[])', async () => {
    const { db } = createDbClient(dbPath, resolvePath(__dirname, '..'));
    try {
      const id = await nextId();
      const t = now();
      db.insert(tasks)
        .values({
          id,
          title: 'My first task',
          // status / priority / tags / noteIds / source 用列默认值
          createdAt: t,
          updatedAt: t,
        })
        .run();

      const row: TaskRow | undefined = db.select().from(tasks).where(eq(tasks.id, id)).get();

      expect(row).toBeDefined();
      expect(row?.title).toBe('My first task');
      expect(row?.description).toBeNull();
      expect(row?.status).toBe('todo');
      expect(row?.priority).toBe('medium');
      expect(row?.dueDate).toBeNull();
      expect(row?.projectId).toBeNull();
      expect(row?.tags).toEqual([]);
      expect(row?.source).toBe('manual');
      expect(row?.inboxId).toBeNull();
      expect(row?.noteIds).toEqual([]);
      expect(row?.completedAt).toBeNull();
    } finally {
      closeDb(db);
    }
  });

  it('round-trips noteIds and tags as JSON arrays', async () => {
    const { db } = createDbClient(dbPath, resolvePath(__dirname, '..'));
    try {
      const id = await nextId();
      const t = now();
      db.insert(tasks)
        .values({
          id,
          title: 'with arrays',
          tags: ['bug', 'p0'],
          noteIds: ['note_1', 'note_2', 'note_3'],
          createdAt: t,
          updatedAt: t,
        })
        .run();

      const row = db.select().from(tasks).where(eq(tasks.id, id)).get();
      expect(row?.tags).toEqual(['bug', 'p0']);
      expect(row?.noteIds).toEqual(['note_1', 'note_2', 'note_3']);
    } finally {
      closeDb(db);
    }
  });

  it('round-trips dueDate and completedAt as Date', async () => {
    const { db } = createDbClient(dbPath, resolvePath(__dirname, '..'));
    try {
      const id = await nextId();
      const t = now();
      const due = new Date(t.getTime() + 7 * 24 * 3600 * 1000);
      const completed = new Date(t.getTime() + 1000);
      db.insert(tasks)
        .values({
          id,
          title: 'with dates',
          status: 'done',
          dueDate: due,
          completedAt: completed,
          createdAt: t,
          updatedAt: t,
        })
        .run();

      const row = db.select().from(tasks).where(eq(tasks.id, id)).get();
      expect(row?.dueDate?.getTime()).toBe(due.getTime());
      expect(row?.completedAt?.getTime()).toBe(completed.getTime());
    } finally {
      closeDb(db);
    }
  });

  it('foreign key: project_id and inbox_id', async () => {
    const { db } = createDbClient(dbPath, resolvePath(__dirname, '..'));
    try {
      const projectId = await nextId();
      const inboxId = await nextId();
      const t = now();

      db.insert(projects)
        .values({ id: projectId, name: 'Task FK Project', createdAt: t, updatedAt: t })
        .run();
      db.insert(inboxItems)
        .values({
          id: inboxId,
          content: 'source',
          kind: 'todo',
          createdAt: t,
          updatedAt: t,
        })
        .run();

      const taskId = await nextId();
      db.insert(tasks)
        .values({
          id: taskId,
          title: 'linked',
          projectId,
          source: 'inbox',
          inboxId,
          createdAt: t,
          updatedAt: t,
        })
        .run();

      const row = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
      expect(row?.projectId).toBe(projectId);
      expect(row?.inboxId).toBe(inboxId);
      expect(row?.source).toBe('inbox');
    } finally {
      closeDb(db);
    }
  });

  it('foreign key: orphan project_id is rejected', async () => {
    const { db } = createDbClient(dbPath, resolvePath(__dirname, '..'));
    try {
      const fakeProjectId = await nextId();
      const id = await nextId();
      const t = now();
      expect(() =>
        db
          .insert(tasks)
          .values({
            id,
            title: 'orphan',
            projectId: fakeProjectId,
            createdAt: t,
            updatedAt: t,
          })
          .run(),
      ).toThrow(/FOREIGN KEY/i);
    } finally {
      closeDb(db);
    }
  });

  it('foreign key: orphan inbox_id is rejected', async () => {
    const { db } = createDbClient(dbPath, resolvePath(__dirname, '..'));
    try {
      const fakeInboxId = await nextId();
      const id = await nextId();
      const t = now();
      expect(() =>
        db
          .insert(tasks)
          .values({
            id,
            title: 'orphan-inbox',
            source: 'inbox',
            inboxId: fakeInboxId,
            createdAt: t,
            updatedAt: t,
          })
          .run(),
      ).toThrow(/FOREIGN KEY/i);
    } finally {
      closeDb(db);
    }
  });
});
