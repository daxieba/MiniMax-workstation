/**
 * 应用设置（App Settings）IPC handler（T5-2 设置页）
 *
 * 暴露 3 个通道（命名遵循 PROJECT_IDENTITY.md §4.1）：
 *   - `app:getSettings`      (input: 无)              → `Settings`
 *   - `app:setSettings`      (input: `Partial<Settings>`) → `Settings`（合并后）
 *   - `app:maybeAutoBackup`  (input: 无)              → `{ triggered: boolean, path?: string }`
 *
 * **全部遵循 PROJECT_IDENTITY.md §4 IPC 契约**：
 *   - 入口 Zod 校验（共享 schema 在 `shared/schemas/appSettings.ts`）
 *   - try/catch 全包，错误统一转成 `{ code, message }`
 *   - 不返回原始异常对象
 *
 * **复用 `app_meta` 表**（T1-3 已建）—— **不**新建 settings 表。
 * 存的 key：
 *   - `auto_backup_interval_min`  字符串 '0' / '30' / '60' / '120'
 *   - `last_auto_backup_at`       字符串（Unix ms 数字）或 'null'
 *   - `last_restore_at`           字符串（Unix ms 数字）或 'null'
 *
 * **自动备份触发**：
 *   - 渲染端在 `Settings` 页面 mount 时调一次 `maybeAutoBackup()`
 *   - 内部判断：`now - lastAutoBackupAt >= interval * 60_000`（interval > 0）→ 触发
 *   - **不**在主进程做 setInterval（依赖用户每次进设置页触发一次，足够简单）
 *
 * @used-by electron/main/index.ts
 * @see electron/main/ipc/backup.ts（共享 `readBackupSettings`）
 * @see shared/schemas/appSettings.ts
 */

import { ipcMain } from 'electron';
import { join as pathJoin } from 'node:path';

import { type WorkstationDb } from '../../../db/client';
import { appMeta } from '../../../db/schema';
import {
  MaybeAutoBackupResponseSchema,
  SetSettingsInputSchema,
  type MaybeAutoBackupResponseParsed,
  type SettingsParsed,
} from '../../../shared/schemas/appSettings';
import {
  type BackupIpcDeps,
  readBackupSettings,
} from './backup';
import {
  DEFAULT_KEEP_AUTO,
  ensureDir,
  exportDataToPath,
  generateBackupFilename,
  pruneOldBackups,
  readSchemaVersionFromDb,
  serializeAppMetaValue,
} from '../services/backupService';

/** 依赖注入：注册时由主进程传入 db 客户端。 */
export interface AppSettingsIpcDeps {
  db: WorkstationDb;
  appVersion: string;
  userDataDir: string;
  dbPath: string;
  /** 测试钩子：`new Date()` 的 mock 注入点。生产 = `undefined`。 */
  now?: () => Date;
}

/** IPC 错误统一格式（PROJECT_IDENTITY.md §4.2）。 */
export interface IpcErrorPayload {
  code: 'VALIDATION_FAILED' | 'NOT_FOUND' | 'PERSISTENCE_FAILED' | 'INTERNAL';
  message: string;
  details?: unknown;
}

/** 把任意异常转成 IPC 错误对象。 */
function toIpcError(err: unknown): IpcErrorPayload {
  if (err instanceof Error) {
    return { code: 'INTERNAL', message: err.message };
  }
  return { code: 'INTERNAL', message: String(err) };
}

/** 判断 err 是否为已结构化的 IPC 错误。 */
function isStructuredIpcError(err: unknown): err is IpcErrorPayload {
  if (err === null || typeof err !== 'object') return false;
  const obj = err as { code?: unknown; message?: unknown };
  if (typeof obj.code !== 'string' || typeof obj.message !== 'string') return false;
  return (
    obj.code === 'VALIDATION_FAILED' ||
    obj.code === 'NOT_FOUND' ||
    obj.code === 'PERSISTENCE_FAILED' ||
    obj.code === 'INTERNAL'
  );
}

// ============================================================
//  handler 函数（独立可测）
// ============================================================

/**
 * 读 settings —— 默认值 + 用户覆盖合并。
 *
 * 默认：
 *   - `autoBackupIntervalMin` = 30
 *   - `lastAutoBackupAt` = null
 *   - `lastRestoreAt` = null
 */
export function readSettings(db: WorkstationDb): SettingsParsed {
  return readBackupSettings(db) as SettingsParsed;
}

/** `app:getSettings` handler。 */
export async function handleGetSettings(deps: AppSettingsIpcDeps): Promise<SettingsParsed> {
  try {
    return readSettings(deps.db);
  } catch (err) {
    if (isStructuredIpcError(err)) throw err;
    throw toIpcError(err);
  }
}

/**
 * 把 Settings 部分字段写到 `app_meta`。
 *
 * 写入字段：
 *   - `auto_backup_interval_min`   → JSON.stringify(数字)
 *   - `last_auto_backup_at`        → JSON.stringify(数字 | null)
 *   - `last_restore_at`            → JSON.stringify(数字 | null)
 */
function writeAppMetaFromSettings(
  db: WorkstationDb,
  next: SettingsParsed,
  now: Date,
): void {
  const entries: Array<{ key: string; value: string }> = [
    {
      key: 'auto_backup_interval_min',
      value: serializeAppMetaValue('auto_backup_interval_min', next.autoBackupIntervalMin),
    },
  ];
  if (next.lastAutoBackupAt !== null) {
    entries.push({
      key: 'last_auto_backup_at',
      value: serializeAppMetaValue('last_auto_backup_at', next.lastAutoBackupAt),
    });
  }
  if (next.lastRestoreAt !== null) {
    entries.push({
      key: 'last_restore_at',
      value: serializeAppMetaValue('last_restore_at', next.lastRestoreAt),
    });
  }
  for (const e of entries) {
    db.insert(appMeta)
      .values({ key: e.key, value: e.value, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: appMeta.key,
        set: { value: e.value, updatedAt: now },
      })
      .run();
  }
}

/** `app:setSettings` handler（patch 语义）。 */
export async function handleSetSettings(
  deps: AppSettingsIpcDeps,
  payload: unknown,
): Promise<SettingsParsed> {
  const parsed = SetSettingsInputSchema.safeParse(payload);
  if (!parsed.success) {
    throw {
      code: 'VALIDATION_FAILED' as const,
      message: 'Invalid setSettings input',
      details: parsed.error.flatten(),
    };
  }
  const now = (deps.now ?? (() => new Date()))();
  const current = readSettings(deps.db);
  const next: SettingsParsed = {
    autoBackupIntervalMin:
      parsed.data.autoBackupIntervalMin ?? current.autoBackupIntervalMin,
    lastAutoBackupAt:
      parsed.data.lastAutoBackupAt === undefined
        ? current.lastAutoBackupAt
        : parsed.data.lastAutoBackupAt,
    lastRestoreAt:
      parsed.data.lastRestoreAt === undefined
        ? current.lastRestoreAt
        : parsed.data.lastRestoreAt,
  };

  try {
    writeAppMetaFromSettings(deps.db, next, now);
  } catch (err) {
    throw {
      code: 'PERSISTENCE_FAILED' as const,
      message: `Failed to write settings: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  return next;
}

/**
 * `app:maybeAutoBackup` handler。
 *
 * 行为：
 *   - 读 `autoBackupIntervalMin` + `lastAutoBackupAt`
 *   - 如果 `interval > 0 && (now - lastAutoBackupAt) >= interval * 60_000` → 触发
 *   - 触发时调 `app:backupNow` 共享逻辑（直接调 `handleBackupNow`）
 *   - 否则返回 `{ triggered: false }`
 */
export async function handleMaybeAutoBackup(
  deps: AppSettingsIpcDeps,
): Promise<MaybeAutoBackupResponseParsed> {
  try {
    const settings = readSettings(deps.db);
    const interval = settings.autoBackupIntervalMin;
    if (interval === 0) {
      return MaybeAutoBackupResponseSchema.parse({ triggered: false });
    }
    const now = (deps.now ?? (() => new Date()))();
    const last = settings.lastAutoBackupAt;
    const sinceLastMs = last === null ? Number.POSITIVE_INFINITY : now.getTime() - last;
    const intervalMs = interval * 60_000;
    if (sinceLastMs < intervalMs) {
      return MaybeAutoBackupResponseSchema.parse({ triggered: false });
    }

    // 触发自动备份
    const backupsDir = pathJoin(deps.userDataDir, 'backups');
    await ensureDir(backupsDir);
    const destPath = pathJoin(backupsDir, generateBackupFilename('auto', now));

    // 构造 `BackupIpcDeps` 调 `handleBackupNow`（共享写入 + prune 逻辑）
    const backupDeps: BackupIpcDeps = {
      db: deps.db,
      appVersion: deps.appVersion,
      userDataDir: deps.userDataDir,
      dbPath: deps.dbPath,
      ...(deps.now !== undefined ? { now: deps.now } : {}),
    };
    const result = await handleBackupNowWithDest(backupDeps, destPath);
    return MaybeAutoBackupResponseSchema.parse({ triggered: true, path: result.path });
  } catch (err) {
    if (isStructuredIpcError(err)) throw err;
    throw toIpcError(err);
  }
}

/**
 * 内部：触发自动备份到指定路径（不通过 IPC 通道，直接调底层逻辑）。
 *
 * 跟 `handleBackupNow` 区别：本函数**已知 destPath**，不做 destPath 解析。
 */
async function handleBackupNowWithDest(
  deps: BackupIpcDeps,
  destPath: string,
): Promise<{ path: string; size: number; createdAt: number }> {
  const now = (deps.now ?? (() => new Date()))();

  // 用 `exportDataToPath` 直接写（**不**走 `handleBackupNow` 避免它再算 destPath）
  const schemaVersion = readSchemaVersionFromDb(deps.db);
  const { size } = await exportDataToPath(deps.db, destPath, {
    appVersion: deps.appVersion,
    now,
    schemaVersion,
  });

  // 同步更新 `app_meta.last_auto_backup_at`
  deps.db
    .insert(appMeta)
    .values({
      key: 'last_auto_backup_at',
      value: String(now.getTime()),
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: appMeta.key,
      set: { value: String(now.getTime()), updatedAt: now },
    })
    .run();

  // 删除多余自动备份
  const backupsDir = pathJoin(deps.userDataDir, 'backups');
  pruneOldBackups(backupsDir, DEFAULT_KEEP_AUTO);

  return { path: destPath, size, createdAt: now.getTime() };
}

// ============================================================
//  registerAppSettingsIpc：把 handler 挂到 ipcMain
// ============================================================

/** 注册 3 个 `app:*` 设置 IPC handler。**只调一次**（主进程启动时）。 */
export function registerAppSettingsIpc(deps: AppSettingsIpcDeps): void {
  ipcMain.handle('app:getSettings', async () => {
    try {
      return { ok: true as const, data: await handleGetSettings(deps) };
    } catch (err) {
      if (isStructuredIpcError(err)) return { ok: false as const, error: err };
      return { ok: false as const, error: toIpcError(err) };
    }
  });

  ipcMain.handle('app:setSettings', async (_evt, payload: unknown) => {
    try {
      return { ok: true as const, data: await handleSetSettings(deps, payload) };
    } catch (err) {
      if (isStructuredIpcError(err)) return { ok: false as const, error: err };
      return { ok: false as const, error: toIpcError(err) };
    }
  });

  ipcMain.handle('app:maybeAutoBackup', async () => {
    try {
      return { ok: true as const, data: await handleMaybeAutoBackup(deps) };
    } catch (err) {
      if (isStructuredIpcError(err)) return { ok: false as const, error: err };
      return { ok: false as const, error: toIpcError(err) };
    }
  });
}

/** 工具：从 electron `app` 注入一个 `AppSettingsIpcDeps`。 */
export function buildAppSettingsDepsFromApp(
  db: WorkstationDb,
  appVersion: string,
  userDataDir: string,
  dbPath: string,
): AppSettingsIpcDeps {
  return { db, appVersion, userDataDir, dbPath };
}
