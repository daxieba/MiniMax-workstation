/**
 * Backup / Restore / Reset IPC handler 端到端测试（T5-2）
 *
 * 覆盖：
 *   - `app:getPaths`           返回 userData / db / backups 三路径
 *   - `app:listBackups`        扫描 *.mmws.json / createdAt DESC
 *   - `app:backupNow`          默认路径 + 自定义路径 + prune 旧文件
 *   - `app:exportData`         写 .mmws.json
 *   - `app:restoreBackup`      confirm 校验 / 备份当前 db / 应用到 db
 *   - `app:importData`         与 restoreBackup 同义
 *   - `app:deleteBackup`       删文件
 *   - `app:resetData`          confirm 校验 / 清空业务表 / 保留 app_meta
 *
 * **不依赖 Electron** —— 直接调 `handle*` 函数（绕开 ipcMain）。
 * electron `app` 模块用 stub 注入（不需要真实 app）。
 *
 * @see electron/main/ipc/backup.ts
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
  type BackupIpcDeps,
  handleBackupNow,
  handleDeleteBackup,
  handleExportData,
  handleGetPaths,
  handleImportData,
  handleListBackups,
  handleResetData,
  handleRestoreBackup,
} from '../electron/main/ipc/backup';

const TMP_ROOT = join(tmpdir(), 'minimax-workstation-backup-ipc-test');
const USER_DATA = join(TMP_ROOT, 'userData');
const BACKUPS_DIR = join(USER_DATA, 'backups');

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
  deps: BackupIpcDeps;
  db: WorkstationDb;
  close: () => void;
}

function makeFixture(): Fixture {
  const dbPath = join(
    TMP_ROOT,
    `backup-ipc-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
  );
  const { db } = createDbClient(dbPath, resolvePath(__dirname, '..'));
  return {
    deps: {
      db,
      appVersion: '0.1.0-test',
      userDataDir: USER_DATA,
      dbPath,
    },
    db,
    close: () => closeDb(db),
  };
}

function seedProject(db: WorkstationDb, overrides: Partial<ProjectRow> = {}): ProjectRow {
  const now = new Date();
  const row: ProjectRow = {
    id: overrides.id ?? ulid(),
    name: overrides.name ?? 'p1',
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
    content: overrides.content ?? 'inbox',
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
    title: overrides.title ?? 't1',
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
    title: overrides.title ?? 'n1',
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
    model: overrides.model ?? 'm',
    baseURL: overrides.baseURL ?? 'https://x',
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

beforeEach(() => {
  // 清掉 userData/backups 内容
  if (existsSync(BACKUPS_DIR)) {
    rmSync(BACKUPS_DIR, { recursive: true, force: true });
  }
  mkdirSync(BACKUPS_DIR, { recursive: true });
});

// ============================================================
//  getPaths
// ============================================================

describe('handleGetPaths', () => {
  it('returns userData / db / backups absolute paths', async () => {
    const f = makeFixture();
    try {
      const out = await handleGetPaths(f.deps);
      expect(out.userData).toBe(USER_DATA);
      expect(out.db.length).toBeGreaterThan(0);
      expect(out.backups).toBe(BACKUPS_DIR);
    } finally {
      f.close();
    }
  });
});

// ============================================================
//  listBackups
// ============================================================

describe('handleListBackups', () => {
  it('returns empty when no backups', async () => {
    const f = makeFixture();
    try {
      const out = await handleListBackups(f.deps);
      expect(out).toEqual([]);
    } finally {
      f.close();
    }
  });

  it('returns existing backups sorted by createdAt DESC', async () => {
    const f = makeFixture();
    try {
      writeFileSync(join(BACKUPS_DIR, 'auto-20260805-100000.mmws.json'), '{}', 'utf-8');
      writeFileSync(join(BACKUPS_DIR, 'auto-20260809-120000.mmws.json'), '{}', 'utf-8');
      const out = await handleListBackups(f.deps);
      expect(out).toHaveLength(2);
      expect(out[0]!.filename).toContain('20260809');
      expect(out[1]!.filename).toContain('20260805');
    } finally {
      f.close();
    }
  });
});

// ============================================================
//  backupNow
// ============================================================

describe('handleBackupNow', () => {
  it('writes a backup file to default path', async () => {
    const f = makeFixture();
    try {
      seedProject(f.db, { name: 'p1' });
      seedInbox(f.db);
      seedTask(f.db);
      seedNote(f.db);
      const out = await handleBackupNow(f.deps, {});
      expect(out.path).toContain('backups');
      expect(out.path).toMatch(/auto-\d{8}-\d{6}\.mmws\.json$/);
      expect(existsSync(out.path)).toBe(true);
      expect(out.size).toBeGreaterThan(0);
    } finally {
      f.close();
    }
  });

  it('writes to custom destPath when provided', async () => {
    const f = makeFixture();
    try {
      const custom = join(BACKUPS_DIR, 'custom.mmws.json');
      const out = await handleBackupNow(f.deps, { destPath: custom });
      expect(out.path).toBe(custom);
      expect(existsSync(custom)).toBe(true);
    } finally {
      f.close();
    }
  });

  it('updates last_auto_backup_at in app_meta', async () => {
    const f = makeFixture();
    try {
      seedProject(f.db);
      await handleBackupNow(f.deps, {});
      const rows = f.db.select().from(appMeta).all();
      const last = rows.find((r) => r.key === 'last_auto_backup_at');
      expect(last).toBeDefined();
      expect(Number(last?.value)).toBeGreaterThan(0);
    } finally {
      f.close();
    }
  });

  it('prunes old auto backups (keeps latest 10)', async () => {
    const f = makeFixture();
    try {
      // 写 12 个旧 auto 备份
      for (let i = 1; i <= 12; i += 1) {
        const dd = String(i).padStart(2, '0');
        writeFileSync(join(BACKUPS_DIR, `auto-202608${dd}-000000.mmws.json`), '{}', 'utf-8');
      }
      // 再触发一次新备份
      await handleBackupNow(f.deps, {});
      // 旧 auto 备份应被删到 10 个
      const files = await handleListBackups(f.deps);
      const autos = files.filter((b) => b.filename.startsWith('auto-'));
      expect(autos.length).toBeLessThanOrEqual(10);
    } finally {
      f.close();
    }
  });

  it('rejects extra fields with VALIDATION_FAILED', async () => {
    const f = makeFixture();
    try {
      const err = await handleBackupNow(f.deps, { extra: 'no' }).catch((e) => e);
      expect((err as { code: string }).code).toBe('VALIDATION_FAILED');
    } finally {
      f.close();
    }
  });
});

// ============================================================
//  exportData
// ============================================================

describe('handleExportData', () => {
  it('requires destPath (VALIDATION_FAILED when missing)', async () => {
    const f = makeFixture();
    try {
      const err = await handleExportData(f.deps, {}).catch((e) => e);
      expect((err as { code: string }).code).toBe('VALIDATION_FAILED');
    } finally {
      f.close();
    }
  });

  it('writes a valid .mmws.json', async () => {
    const f = makeFixture();
    try {
      seedProject(f.db);
      seedInbox(f.db);
      seedTask(f.db);
      seedNote(f.db);
      seedReview(f.db);
      seedAiConfig(f.db);
      const dest = join(BACKUPS_DIR, 'export.mmws.json');
      const out = await handleExportData(f.deps, { destPath: dest });
      expect(out.path).toBe(dest);
      expect(existsSync(dest)).toBe(true);
      const raw = JSON.parse(readFileSync(dest, 'utf-8')) as {
        meta: { formatVersion: number };
        data: { projects: unknown[]; notes: unknown[] };
      };
      expect(raw.meta.formatVersion).toBe(1);
      expect(raw.data.projects).toHaveLength(1);
      expect(raw.data.notes).toHaveLength(1);
    } finally {
      f.close();
    }
  });
});

// ============================================================
//  restoreBackup
// ============================================================

describe('handleRestoreBackup', () => {
  it('rejects invalid confirm string with VALIDATION_FAILED', async () => {
    const f = makeFixture();
    try {
      const err = await handleRestoreBackup(f.deps, { path: '/x', confirm: 'wrong' }).catch(
        (e) => e,
      );
      expect((err as { code: string }).code).toBe('VALIDATION_FAILED');
    } finally {
      f.close();
    }
  });

  it('rejects lowercase RESTORE with VALIDATION_FAILED (Zod literal)', async () => {
    const f = makeFixture();
    try {
      const err = await handleRestoreBackup(f.deps, { path: '/x', confirm: 'restore' }).catch(
        (e) => e,
      );
      expect((err as { code: string }).code).toBe('VALIDATION_FAILED');
    } finally {
      f.close();
    }
  });

  it('returns NOT_FOUND for non-existing backup', async () => {
    const f = makeFixture();
    try {
      const err = await handleRestoreBackup(f.deps, {
        path: join(BACKUPS_DIR, 'nope.mmws.json'),
        confirm: 'RESTORE',
      }).catch((e) => e);
      expect((err as { code: string }).code).toBe('NOT_FOUND');
    } finally {
      f.close();
    }
  });

  it('rolls back db and writes safety backup before applying', async () => {
    const f = makeFixture();
    try {
      // seed current
      seedProject(f.db, { name: 'before' });
      seedInbox(f.db);
      seedTask(f.db);
      seedNote(f.db);

      // 写一个 backup file（仅含 1 个 project 名为 'after'）
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
              id: 'P_AFTER',
              name: 'after',
              description: null,
              color: null,
              archived: 0,
              createdAt: 1700000000000,
              updatedAt: 1700000000000,
            },
          ],
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
      const backupPath = join(BACKUPS_DIR, 'restore.mmws.json');
      writeFileSync(backupPath, JSON.stringify(backup), 'utf-8');

      const out = await handleRestoreBackup(f.deps, { path: backupPath, confirm: 'RESTORE' });
      expect(out.ok).toBe(true);
      expect(out.restartRequired).toBe(true);

      // 业务表已替换
      const projectsAfter = f.db.select().from(projects).all();
      expect(projectsAfter).toHaveLength(1);
      expect(projectsAfter[0]?.name).toBe('after');

      // safety backup 已写
      const beforeRestoreFiles = (await handleListBackups(f.deps)).filter((b) =>
        b.filename.startsWith('before-restore-'),
      );
      expect(beforeRestoreFiles).toHaveLength(1);
    } finally {
      f.close();
    }
  });

  it('keeps schemaVersion / setupCompletedAt in app_meta after restore', async () => {
    const f = makeFixture();
    try {
      seedAppMeta(f.db, { key: 'setupCompletedAt', value: '1700000000000' });
      seedAppMeta(f.db, { key: 'schemaVersion', value: '5' });

      const backup = {
        meta: { formatVersion: 1 as const, exportedAt: 1, appVersion: 'x', schemaVersion: 6 },
        data: {
          projects: [],
          inbox_items: [],
          tasks: [],
          notes: [],
          reviews: [],
          ai_configs: [],
          app_meta: [
            { key: 'schemaVersion' as const, value: '6', createdAt: 1, updatedAt: 1 },
          ],
        },
      };
      const backupPath = join(BACKUPS_DIR, 'restore-schema.mmws.json');
      writeFileSync(backupPath, JSON.stringify(backup), 'utf-8');

      await handleRestoreBackup(f.deps, { path: backupPath, confirm: 'RESTORE' });

      const byKey = new Map(f.db.select().from(appMeta).all().map((r) => [r.key, r.value]));
      expect(byKey.get('setupCompletedAt')).toBe('1700000000000'); // 保留
      expect(byKey.get('schemaVersion')).toBe('6'); // 覆盖
    } finally {
      f.close();
    }
  });
});

// ============================================================
//  importData (与 restoreBackup 同义，独立覆盖)
// ============================================================

describe('handleImportData', () => {
  it('requires RESTORE confirm', async () => {
    const f = makeFixture();
    try {
      const err = await handleImportData(f.deps, { path: '/x', confirm: 'wrong' }).catch(
        (e) => e,
      );
      expect((err as { code: string }).code).toBe('VALIDATION_FAILED');
    } finally {
      f.close();
    }
  });

  it('returns NOT_FOUND for non-existing file', async () => {
    const f = makeFixture();
    try {
      const err = await handleImportData(f.deps, {
        path: join(BACKUPS_DIR, 'missing.mmws.json'),
        confirm: 'RESTORE',
      }).catch((e) => e);
      expect((err as { code: string }).code).toBe('NOT_FOUND');
    } finally {
      f.close();
    }
  });
});

// ============================================================
//  deleteBackup
// ============================================================

describe('handleDeleteBackup', () => {
  it('removes the file', async () => {
    const f = makeFixture();
    try {
      const file = join(BACKUPS_DIR, 'to-delete.mmws.json');
      writeFileSync(file, '{}', 'utf-8');
      const out = await handleDeleteBackup(f.deps, { path: file });
      expect(out.deleted).toBe(true);
      expect(existsSync(file)).toBe(false);
    } finally {
      f.close();
    }
  });

  it('rejects non-mmws.json extension with VALIDATION_FAILED', async () => {
    const f = makeFixture();
    try {
      const file = join(BACKUPS_DIR, 'to-delete.json');
      writeFileSync(file, '{}', 'utf-8');
      const err = await handleDeleteBackup(f.deps, { path: file }).catch((e) => e);
      expect((err as { code: string }).code).toBe('VALIDATION_FAILED');
    } finally {
      f.close();
    }
  });
});

// ============================================================
//  resetData
// ============================================================

describe('handleResetData', () => {
  it('rejects invalid confirm string', async () => {
    const f = makeFixture();
    try {
      const err = await handleResetData(f.deps, { confirm: 'wrong' }).catch((e) => e);
      expect((err as { code: string }).code).toBe('VALIDATION_FAILED');
    } finally {
      f.close();
    }
  });

  it('rejects lowercase RESET (Zod literal)', async () => {
    const f = makeFixture();
    try {
      const err = await handleResetData(f.deps, { confirm: 'reset' }).catch((e) => e);
      expect((err as { code: string }).code).toBe('VALIDATION_FAILED');
    } finally {
      f.close();
    }
  });

  it('clears all business tables and keeps app_meta', async () => {
    const f = makeFixture();
    try {
      seedProject(f.db);
      seedInbox(f.db);
      seedTask(f.db);
      seedNote(f.db);
      seedReview(f.db);
      seedAiConfig(f.db);
      seedAppMeta(f.db, { key: 'schemaVersion', value: '6' });
      seedAppMeta(f.db, { key: 'setupCompletedAt', value: '1700000000000' });

      const out = await handleResetData(f.deps, { confirm: 'RESET' });
      expect(out.ok).toBe(true);
      expect(out.restartRequired).toBe(true);

      // 业务表全空
      expect(f.db.select().from(projects).all()).toEqual([]);
      expect(f.db.select().from(inboxItems).all()).toEqual([]);
      expect(f.db.select().from(tasks).all()).toEqual([]);
      expect(f.db.select().from(notes).all()).toEqual([]);
      expect(f.db.select().from(reviews).all()).toEqual([]);
      expect(f.db.select().from(aiConfigs).all()).toEqual([]);

      // app_meta 保留
      const byKey = new Map(f.db.select().from(appMeta).all().map((r) => [r.key, r.value]));
      expect(byKey.get('schemaVersion')).toBe('6');
      expect(byKey.get('setupCompletedAt')).toBe('1700000000000');
    } finally {
      f.close();
    }
  });

  it('syncs FTS5 virtual tables (no leftover entries)', async () => {
    const f = makeFixture();
    try {
      seedNote(f.db, { title: 'some note' });
      // 确认 FTS5 已同步
      const before = f.db.$client
        .prepare('SELECT COUNT(*) AS cnt FROM notes_fts')
        .get() as { cnt: number };
      expect(before.cnt).toBe(1);

      await handleResetData(f.deps, { confirm: 'RESET' });

      const after = f.db.$client
        .prepare('SELECT COUNT(*) AS cnt FROM notes_fts')
        .get() as { cnt: number };
      expect(after.cnt).toBe(0);
    } finally {
      f.close();
    }
  });
});

void pathSep;
