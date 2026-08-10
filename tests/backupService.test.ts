/**
 * 备份服务（`electron/main/services/backupService.ts`）单元测试（T5-2）
 *
 * 覆盖：
 *   - `exportDataToPath`         写文件 / size 正确 / meta 字段齐全
 *   - `parseBackupFile`          parse 成功 / 文件不存在 / 大小超限 / JSON 错 / schema 错
 *   - `applyBackupToDb`          事务回写 + 业务表清空 + FTS5 同步清空 + app_meta 保留
 *   - `pruneOldBackups`          只删 auto-*.mmws.json / 保留 manual / 保留 before-restore
 *   - `listBackups`              按 createdAt DESC / 跳过多余文件
 *   - `generateBackupFilename`   前缀 + 时间格式
 *   - `parseCreatedAtFromFilename` 正反例
 *   - `serializeAppMetaValue` / `parseAppMetaValue`
 *   - `deleteBackupFile`         路径穿越保护 / .mmws.json 后缀校验
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve as resolvePath, sep as pathSep } from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ulid } from 'ulidx';

import { closeDb, createDbClient, type WorkstationDb } from '../db/client';
import {
  aiConfigs,
  appMeta,
  inboxItems,
  notes,
  projects,
  reviews,
  tasks,
  type AiConfigRow,
  type AppMetaRow,
  type InboxItemRow,
  type NoteRow,
  type ProjectRow,
  type ReviewRow,
  type TaskRow,
} from '../db/schema';
import {
  BACKUP_FILE_EXT,
  MAX_BACKUP_FILE_SIZE,
  applyBackupToDb,
  deleteBackupFile,
  exportDataToPath,
  filterAppMetaRows,
  generateBackupFilename,
  listBackups,
  parseAppMetaValue,
  parseBackupFile,
  parseCreatedAtFromFilename,
  pruneOldBackups,
  readSchemaVersionFromDb,
  serializeAppMetaValue,
} from '../electron/main/services/backupService';

const TMP_ROOT = join(tmpdir(), 'minimax-workstation-backup-service-test');

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

interface DbFixture {
  deps: { db: WorkstationDb };
  db: WorkstationDb;
  close: () => void;
}

function makeDbFixture(): DbFixture {
  const dbPath = join(
    TMP_ROOT,
    `backup-svc-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
  );
  const { db } = createDbClient(dbPath, resolvePath(__dirname, '..'));
  return {
    deps: { db },
    db,
    close: () => closeDb(db),
  };
}

// ============================================================
//  种子工具（建一行到 db）
// ============================================================

function seedProject(db: WorkstationDb, overrides: Partial<ProjectRow> = {}): ProjectRow {
  const now = new Date();
  const row: ProjectRow = {
    id: overrides.id ?? ulid(),
    name: overrides.name ?? 'seed-project',
    description: overrides.description ?? null,
    color: overrides.color ?? null,
    archived: overrides.archived ?? 0,
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
  };
  db.insert(projects).values(row).run();
  return row;
}

function seedInbox(db: WorkstationDb, overrides: Partial<InboxItemRow> = {}): InboxItemRow {
  const now = new Date();
  const row: InboxItemRow = {
    id: overrides.id ?? ulid(),
    content: overrides.content ?? 'seed-inbox',
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

function seedTask(db: WorkstationDb, overrides: Partial<TaskRow> = {}): TaskRow {
  const now = new Date();
  const row: TaskRow = {
    id: overrides.id ?? ulid(),
    title: overrides.title ?? 'seed-task',
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

function seedNote(db: WorkstationDb, overrides: Partial<NoteRow> = {}): NoteRow {
  const now = new Date();
  const row: NoteRow = {
    id: overrides.id ?? ulid(),
    title: overrides.title ?? 'seed-note',
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

function seedReview(db: WorkstationDb, overrides: Partial<ReviewRow> = {}): ReviewRow {
  const now = new Date();
  const row: ReviewRow = {
    id: overrides.id ?? ulid(),
    date: overrides.date ?? '2026-08-09',
    completed: overrides.completed ?? [],
    uncompleted: overrides.uncompleted ?? [],
    blockers: overrides.blockers ?? '',
    topThree: overrides.topThree ?? [],
    aiDraft: overrides.aiDraft ?? null,
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
  };
  db.insert(reviews).values(row).run();
  return row;
}

function seedAiConfig(db: WorkstationDb, overrides: Partial<AiConfigRow> = {}): AiConfigRow {
  const row: AiConfigRow = {
    provider: overrides.provider ?? 'minimax',
    model: overrides.model ?? 'MiniMax-M2',
    baseURL: overrides.baseURL ?? 'https://api.minimax.chat/v1',
    updatedAt: overrides.updatedAt ?? Date.now(),
  };
  db.insert(aiConfigs).values(row).run();
  return row;
}

function seedAppMeta(db: WorkstationDb, overrides: Partial<AppMetaRow> = {}): AppMetaRow {
  const now = new Date();
  const row: AppMetaRow = {
    key: overrides.key ?? 'schemaVersion',
    value: overrides.value ?? '1',
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
  };
  db.insert(appMeta).values(row).run();
  return row;
}

// ============================================================
//  generateBackupFilename
// ============================================================

describe('generateBackupFilename', () => {
  it('formats auto prefix with date', () => {
    const name = generateBackupFilename('auto', new Date(2026, 7, 9, 12, 34, 56));
    expect(name).toBe('auto-20260809-123456.mmws.json');
  });

  it('formats manual prefix', () => {
    const name = generateBackupFilename('manual', new Date(2026, 0, 1, 0, 0, 0));
    expect(name).toBe('manual-20260101-000000.mmws.json');
  });

  it('formats before-restore prefix', () => {
    const name = generateBackupFilename('before-restore', new Date(2026, 11, 31, 23, 59, 59));
    expect(name).toBe('before-restore-20261231-235959.mmws.json');
  });
});

// ============================================================
//  parseCreatedAtFromFilename
// ============================================================

describe('parseCreatedAtFromFilename', () => {
  it('parses valid auto filename', () => {
    const ts = parseCreatedAtFromFilename('auto-20260809-123456.mmws.json');
    expect(ts).not.toBeNull();
    expect(ts).toBe(new Date(2026, 7, 9, 12, 34, 56).getTime());
  });

  it('parses manual filename', () => {
    const ts = parseCreatedAtFromFilename('manual-20260101-000000.mmws.json');
    expect(ts).not.toBeNull();
    expect(ts).toBe(new Date(2026, 0, 1, 0, 0, 0).getTime());
  });

  it('returns null for unknown prefix', () => {
    expect(parseCreatedAtFromFilename('foo-20260809-123456.mmws.json')).toBeNull();
  });

  it('returns null for non-mmws.json suffix', () => {
    expect(parseCreatedAtFromFilename('auto-20260809-123456.json')).toBeNull();
  });

  it('returns null for malformed date', () => {
    expect(parseCreatedAtFromFilename('auto-20260809-99.mmws.json')).toBeNull();
  });
});

// ============================================================
//  serialize/parse AppMetaValue
// ============================================================

describe('serialize/parseAppMetaValue', () => {
  it('serializes numbers as strings', () => {
    expect(serializeAppMetaValue('auto_backup_interval_min', 30)).toBe('30');
  });

  it('serializes null as "null" string', () => {
    expect(serializeAppMetaValue('last_auto_backup_at', null)).toBe('null');
  });

  it('parses interval', () => {
    expect(parseAppMetaValue('auto_backup_interval_min', '30')).toBe(30);
  });

  it('parses last_*_at timestamp', () => {
    expect(parseAppMetaValue('last_auto_backup_at', '1700000000000')).toBe(1700000000000);
  });

  it('parses last_*_at null string as null', () => {
    expect(parseAppMetaValue('last_auto_backup_at', 'null')).toBeNull();
  });
});

// ============================================================
//  filterAppMetaRows
// ============================================================

describe('filterAppMetaRows', () => {
  it('keeps only allowed keys', () => {
    const rows = [
      { key: 'schemaVersion', value: '6' },
      { key: 'unknownKey', value: 'x' },
      { key: 'setupCompletedAt', value: '1' },
    ];
    const out = filterAppMetaRows(rows);
    expect(out.map((r) => r.key)).toEqual(['schemaVersion', 'setupCompletedAt']);
  });
});

// ============================================================
//  exportDataToPath
// ============================================================

describe('exportDataToPath', () => {
  it('writes .mmws.json with valid structure', async () => {
    const f = makeDbFixture();
    try {
      seedProject(f.db);
      seedInbox(f.db);
      seedTask(f.db);
      seedNote(f.db);
      seedReview(f.db);
      seedAiConfig(f.db);
      seedAppMeta(f.db, { key: 'schemaVersion', value: '6' });

      const dest = join(TMP_ROOT, `export-${Date.now()}.mmws.json`);
      const result = await exportDataToPath(f.db, dest, {
        appVersion: '0.1.0',
        schemaVersion: readSchemaVersionFromDb(f.db),
        now: new Date('2026-08-09T12:00:00Z'),
      });

      expect(result.size).toBeGreaterThan(0);
      expect(existsSync(dest)).toBe(true);

      const raw = readFileSync(dest, 'utf-8');
      const parsed = JSON.parse(raw) as {
        meta: { formatVersion: number; appVersion: string; schemaVersion: number; exportedAt: number };
        data: { projects: unknown[]; inbox_items: unknown[]; tasks: unknown[]; notes: unknown[]; reviews: unknown[]; ai_configs: unknown[]; app_meta: unknown[] };
      };
      expect(parsed.meta.formatVersion).toBe(1);
      expect(parsed.meta.appVersion).toBe('0.1.0');
      expect(parsed.meta.schemaVersion).toBeGreaterThanOrEqual(1);
      expect(parsed.meta.exportedAt).toBe(new Date('2026-08-09T12:00:00Z').getTime());
      expect(parsed.data.projects).toHaveLength(1);
      expect(parsed.data.inbox_items).toHaveLength(1);
      expect(parsed.data.tasks).toHaveLength(1);
      expect(parsed.data.notes).toHaveLength(1);
      expect(parsed.data.reviews).toHaveLength(1);
      expect(parsed.data.ai_configs).toHaveLength(1);
      expect(parsed.data.app_meta).toHaveLength(1);
    } finally {
      f.close();
    }
  });

  it('does NOT include apiKey in ai_configs', async () => {
    const f = makeDbFixture();
    try {
      seedAiConfig(f.db, { provider: 'minimax' });
      const dest = join(TMP_ROOT, `export-nokey-${Date.now()}.mmws.json`);
      await exportDataToPath(f.db, dest, {
        appVersion: '0.1.0',
        schemaVersion: 0,
      });
      const raw = readFileSync(dest, 'utf-8');
      expect(raw).not.toMatch(/apiKey/i);
      expect(raw).not.toMatch(/api_key/i);
    } finally {
      f.close();
    }
  });

  it('does NOT include userData absolute path in meta', async () => {
    const f = makeDbFixture();
    try {
      const dest = join(TMP_ROOT, `export-nopath-${Date.now()}.mmws.json`);
      await exportDataToPath(f.db, dest, {
        appVersion: '0.1.0',
        schemaVersion: 0,
      });
      const raw = readFileSync(dest, 'utf-8');
      expect(raw).not.toMatch(/C:\\Users\\/);
      expect(raw).not.toMatch(/\/Users\//);
    } finally {
      f.close();
    }
  });

  it('skips unknown app_meta keys', async () => {
    const f = makeDbFixture();
    try {
      seedAppMeta(f.db, { key: 'schemaVersion', value: '6' });
      seedAppMeta(f.db, { key: 'somethingSecret', value: 'SECRET' });
      const dest = join(TMP_ROOT, `export-filtered-${Date.now()}.mmws.json`);
      await exportDataToPath(f.db, dest, {
        appVersion: '0.1.0',
        schemaVersion: 0,
      });
      const raw = readFileSync(dest, 'utf-8');
      expect(raw).not.toMatch(/somethingSecret/);
      expect(raw).not.toMatch(/SECRET/);
    } finally {
      f.close();
    }
  });
});

// ============================================================
//  parseBackupFile
// ============================================================

describe('parseBackupFile', () => {
  it('parses a valid backup file', async () => {
    const path = join(TMP_ROOT, `valid-${Date.now()}.mmws.json`);
    const sample = {
      meta: {
        formatVersion: 1,
        exportedAt: 1700000000000,
        appVersion: '0.1.0',
        schemaVersion: 6,
      },
      data: {
        projects: [],
        inbox_items: [],
        tasks: [],
        notes: [],
        reviews: [],
        ai_configs: [],
        app_meta: [],
      },
    };
    writeFileSync(path, JSON.stringify(sample), 'utf-8');
    const out = await parseBackupFile(path);
    expect(out.meta.formatVersion).toBe(1);
  });

  it('rejects missing file with NOT_FOUND', async () => {
    await expect(parseBackupFile(join(TMP_ROOT, 'does-not-exist.mmws.json'))).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('rejects invalid JSON with VALIDATION_FAILED', async () => {
    const path = join(TMP_ROOT, `bad-${Date.now()}.mmws.json`);
    writeFileSync(path, 'not-json', 'utf-8');
    await expect(parseBackupFile(path)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  });

  it('rejects wrong formatVersion with VALIDATION_FAILED', async () => {
    const path = join(TMP_ROOT, `bad-version-${Date.now()}.mmws.json`);
    const sample = {
      meta: { formatVersion: 2, exportedAt: 1, appVersion: 'x', schemaVersion: 1 },
      data: {
        projects: [],
        inbox_items: [],
        tasks: [],
        notes: [],
        reviews: [],
        ai_configs: [],
        app_meta: [],
      },
    };
    writeFileSync(path, JSON.stringify(sample), 'utf-8');
    await expect(parseBackupFile(path)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  });

  it('rejects extra fields with VALIDATION_FAILED', async () => {
    const path = join(TMP_ROOT, `extra-${Date.now()}.mmws.json`);
    const sample = {
      meta: { formatVersion: 1, exportedAt: 1, appVersion: 'x', schemaVersion: 1 },
      data: {
        projects: [],
        inbox_items: [],
        tasks: [],
        notes: [],
        reviews: [],
        ai_configs: [],
        app_meta: [],
        extraField: 'no',
      },
    };
    writeFileSync(path, JSON.stringify(sample), 'utf-8');
    await expect(parseBackupFile(path)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  });

  it('rejects too-large file with VALIDATION_FAILED', async () => {
    const path = join(TMP_ROOT, `big-${Date.now()}.mmws.json`);
    // 写一个文件 size 大于 MAX_BACKUP_FILE_SIZE 的"假文件"——用稀疏大文件
    // 实际生产中不会构造这种大文件，这里直接用 stat 模拟：写一个标头 + 60MB 填充
    const padding = 'x'.repeat(MAX_BACKUP_FILE_SIZE + 1024);
    writeFileSync(path, padding, 'utf-8');
    await expect(parseBackupFile(path)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  });
});

// ============================================================
//  applyBackupToDb
// ============================================================

describe('applyBackupToDb', () => {
  it('replaces business tables and syncs FTS5', () => {
    const f = makeDbFixture();
    try {
      // 1. seed existing
      seedProject(f.db, { name: 'old-project' });
      seedInbox(f.db, { content: 'old-inbox' });
      seedTask(f.db, { title: 'old-task' });
      seedNote(f.db, { title: 'old-note' });
      // 触发 FTS5 同步
      const ftsBefore = f.db.$client
        .prepare('SELECT COUNT(*) AS cnt FROM notes_fts')
        .get() as { cnt: number };
      expect(ftsBefore.cnt).toBe(1);

      // 2. 构造 backup file (只有新数据)
      const backup = {
        meta: {
          formatVersion: 1 as const,
          exportedAt: 1700000000000,
          appVersion: '0.1.0',
          schemaVersion: 6,
        },
        data: {
          projects: [
            {
              id: 'P_NEW',
              name: 'new-project',
              description: null,
              color: null,
              archived: 0,
              createdAt: 1700000000000,
              updatedAt: 1700000000000,
            },
          ],
          inbox_items: [],
          tasks: [],
          notes: [
            {
              id: 'N_NEW',
              title: 'new-note',
              content: 'fresh body',
              tags: [],
              linkedTaskIds: [],
              projectId: null,
              source: 'manual' as const,
              archived: 0,
              createdAt: 1700000000000,
              updatedAt: 1700000000000,
            },
          ],
          reviews: [],
          ai_configs: [],
          app_meta: [
            {
              key: 'schemaVersion' as const,
              value: '6',
              createdAt: 1700000000000,
              updatedAt: 1700000000000,
            },
          ],
        },
      };

      // 3. apply
      applyBackupToDb(f.db, backup as never);

      // 4. 验证：业务表已替换
      const projectsAfter = f.db.select().from(projects).all();
      expect(projectsAfter).toHaveLength(1);
      expect(projectsAfter[0]?.name).toBe('new-project');
      // 旧 project 不应存在
      expect(projectsAfter.find((p) => p.name === 'old-project')).toBeUndefined();

      // 5. FTS5 同步清空
      const ftsAfter = f.db.$client
        .prepare("SELECT COUNT(*) AS cnt FROM notes_fts")
        .get() as { cnt: number };
      expect(ftsAfter.cnt).toBe(1); // 新 note 触发了 FTS5 同步
      // 旧 "old-note" 不应在 FTS5
      const oldHit = f.db.$client
        .prepare("SELECT COUNT(*) AS cnt FROM notes_fts WHERE notes_fts MATCH 'old'")
        .get() as { cnt: number };
      expect(oldHit.cnt).toBe(0);
    } finally {
      f.close();
    }
  });

  it('keeps schemaVersion / setupCompletedAt in app_meta (upsert)', () => {
    const f = makeDbFixture();
    try {
      seedAppMeta(f.db, { key: 'setupCompletedAt', value: '1700000000000' });
      seedAppMeta(f.db, { key: 'schemaVersion', value: '5' });

      const backup = {
        meta: {
          formatVersion: 1 as const,
          exportedAt: 1700000000001,
          appVersion: '0.1.0',
          schemaVersion: 6,
        },
        data: {
          projects: [],
          inbox_items: [],
          tasks: [],
          notes: [],
          reviews: [],
          ai_configs: [],
          app_meta: [
            {
              key: 'schemaVersion' as const,
              value: '6',
              createdAt: 1700000000000,
              updatedAt: 1700000000000,
            },
          ],
        },
      };
      applyBackupToDb(f.db, backup as never);

      const rows = f.db.select().from(appMeta).all();
      const byKey = new Map(rows.map((r) => [r.key, r.value]));
      expect(byKey.get('schemaVersion')).toBe('6');
      expect(byKey.get('setupCompletedAt')).toBe('1700000000000'); // 保留
    } finally {
      f.close();
    }
  });
});

// ============================================================
//  pruneOldBackups
// ============================================================

describe('pruneOldBackups', () => {
  let dir: string;
  beforeEach(() => {
    dir = join(TMP_ROOT, `prune-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(dir, { recursive: true });
  });

  it('keeps most recent N auto backups, deletes older', () => {
    // 建 15 个 auto 备份，递增时间（8月1日~8月15日）
    for (let i = 1; i <= 15; i += 1) {
      const dd = String(i).padStart(2, '0');
      const name = `auto-202608${dd}-000000.mmws.json`;
      writeFileSync(join(dir, name), '{}', 'utf-8');
    }
    // 加一个 manual（**不**应删）
    writeFileSync(join(dir, 'manual-20260809-000000.mmws.json'), '{}', 'utf-8');
    // 加一个 before-restore（**不**应删）
    writeFileSync(join(dir, 'before-restore-20260809-000000.mmws.json'), '{}', 'utf-8');

    const out = pruneOldBackups(dir, 10);
    expect(out.deleted).toHaveLength(5);
    const remaining = listBackups(dir);
    expect(remaining.filter((b) => b.filename.startsWith('auto-'))).toHaveLength(10);
    expect(remaining.find((b) => b.filename.startsWith('manual-'))).toBeDefined();
    expect(remaining.find((b) => b.filename.startsWith('before-restore-'))).toBeDefined();
  });

  it('does nothing when fewer than keepAuto', () => {
    for (let i = 1; i <= 3; i += 1) {
      const dd = String(i).padStart(2, '0');
      writeFileSync(join(dir, `auto-202608${dd}-000000.mmws.json`), '{}', 'utf-8');
    }
    const out = pruneOldBackups(dir, 10);
    expect(out.deleted).toEqual([]);
  });

  it('returns empty when dir does not exist', () => {
    const out = pruneOldBackups(join(TMP_ROOT, 'nope-no-dir'), 10);
    expect(out.deleted).toEqual([]);
  });
});

// ============================================================
//  listBackups
// ============================================================

describe('listBackups', () => {
  it('returns empty when no backups', () => {
    const dir = join(TMP_ROOT, `list-empty-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    expect(listBackups(dir)).toEqual([]);
  });

  it('returns parsed entries sorted by createdAt DESC', () => {
    const dir = join(TMP_ROOT, `list-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'auto-20260805-100000.mmws.json'), 'a', 'utf-8');
    writeFileSync(join(dir, 'auto-20260809-120000.mmws.json'), 'a', 'utf-8');
    writeFileSync(join(dir, 'auto-20260807-080000.mmws.json'), 'a', 'utf-8');
    const out = listBackups(dir);
    expect(out).toHaveLength(3);
    // DESC: 8/9, 8/7, 8/5
    expect(out[0]!.filename).toContain('20260809');
    expect(out[1]!.filename).toContain('20260807');
    expect(out[2]!.filename).toContain('20260805');
  });

  it('skips files with wrong filename format', () => {
    const dir = join(TMP_ROOT, `list-skip-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'auto-20260805-100000.mmws.json'), 'a', 'utf-8');
    writeFileSync(join(dir, 'random.json'), 'a', 'utf-8');
    writeFileSync(join(dir, 'no-suffix'), 'a', 'utf-8');
    const out = listBackups(dir);
    expect(out).toHaveLength(1);
  });
});

// ============================================================
//  deleteBackupFile
// ============================================================

describe('deleteBackupFile', () => {
  it('removes the file', () => {
    const dir = join(TMP_ROOT, `del-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const file = join(dir, 'auto-20260809-100000.mmws.json');
    writeFileSync(file, '{}', 'utf-8');
    deleteBackupFile(dir, file);
    expect(existsSync(file)).toBe(false);
  });

  it('rejects non-mmws.json file', () => {
    const dir = join(TMP_ROOT, `del-noext-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const file = join(dir, 'auto-20260809-100000.json');
    writeFileSync(file, '{}', 'utf-8');
    expect(() => deleteBackupFile(dir, file)).toThrow();
  });

  it('rejects path outside backups dir (path traversal)', () => {
    const dir = join(TMP_ROOT, `del-traverse-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const outside = join(TMP_ROOT, `outside-${Date.now()}.mmws.json`);
    writeFileSync(outside, '{}', 'utf-8');
    expect(() => deleteBackupFile(dir, outside)).toThrow();
  });

  it('throws NOT_FOUND for non-existing file', () => {
    const dir = join(TMP_ROOT, `del-nf-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const file = join(dir, 'auto-20260809-100000.mmws.json');
    expect(() => deleteBackupFile(dir, file)).toThrow();
  });
});

// ============================================================
//  readSchemaVersionFromDb
// ============================================================

describe('readSchemaVersionFromDb', () => {
  it('returns count of __drizzle_migrations', () => {
    const f = makeDbFixture();
    try {
      const v = readSchemaVersionFromDb(f.db);
      expect(v).toBeGreaterThan(0);
    } finally {
      f.close();
    }
  });
});

void BACKUP_FILE_EXT;
void pathSep;
