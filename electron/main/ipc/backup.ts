/**
 * 备份 / 导出 / 恢复 / 重置 IPC handler（T5-2 设置页）
 *
 * 暴露 9 个通道（命名遵循 PROJECT_IDENTITY.md §4.1，格式 `namespace:action`）：
 *   - `app:getPaths`           (input: 无)                            → `{ userData, db, backups }`
 *   - `app:listBackups`        (input: 无)                            → `BackupInfo[]`（按 createdAt DESC）
 *   - `app:backupNow`          (input: `{ destPath? }`)               → `{ path, size, createdAt }`
 *   - `app:exportData`         (input: `{ destPath }`)                → `{ path, size, createdAt }`
 *   - `app:restoreBackup`      (input: `{ path, confirm: 'RESTORE' }`) → `{ ok: true, restartRequired: true }`
 *   - `app:importData`         (input: `{ path, confirm: 'RESTORE' }`) → `{ ok: true, restartRequired: true }`
 *   - `app:deleteBackup`       (input: `{ path }`)                    → `{ deleted: true }`
 *   - `app:resetData`          (input: `{ confirm: 'RESET' }`)        → `{ ok: true, restartRequired: true }`
 *
 * **全部遵循 PROJECT_IDENTITY.md §4 IPC 契约**：
 *   - 入口 Zod 校验（共享 schema 在 `shared/schemas/backup.ts`）
 *   - try/catch 全包，错误统一转成 `{ code, message, details? }`
 *   - 不返回原始异常对象
 *   - **不**在错误信息 / 响应中回显绝对路径（最多回显 basename）
 *
 * **错误码**（PROJECT_IDENTITY.md §4.4）：
 *   - `VALIDATION_FAILED`    Zod 校验失败 / confirm 字符串错 / 备份文件格式错
 *   - `NOT_FOUND`            备份文件不存在
 *   - `PERSISTENCE_FAILED`   db 写失败 / 写盘失败 / stat 失败
 *   - `INTERNAL`             未分类
 *
 * **核心逻辑**都委托给 `electron/main/services/backupService.ts`（纯函数模块，
 * 方便单测）。本文件只做"IPC 包装 + 编排"。
 *
 * **范围**（T5-2）：
 *   - 9 个通道 + 服务层
 *   - 不做云备份 / 加密 / 压缩 / NSIS 安装包
 *   - 不做自动定时（依赖 `Settings` 页面 mount 时 `maybeAutoBackup` 触发）
 *
 * @used-by electron/main/index.ts
 * @see electron/main/services/backupService.ts
 * @see shared/schemas/backup.ts
 */

import { app, ipcMain } from 'electron';
import { basename, join } from 'node:path';

import { type WorkstationDb } from '../../../db/client';
import { appMeta } from '../../../db/schema';
import {
  BackupNowInputSchema,
  BackupNowResponseSchema,
  DeleteBackupInputSchema,
  DeleteBackupResponseSchema,
  ExportDataInputSchema,
  ExportDataResponseSchema,
  GetPathsResponseSchema,
  ImportDataInputSchema,
  ImportDataResponseSchema,
  ListBackupsResponseSchema,
  ResetDataInputSchema,
  ResetDataResponseSchema,
  RestoreBackupInputSchema,
  RestoreBackupResponseSchema,
  type BackupNowResponseParsed,
  type DeleteBackupResponseParsed,
  type ExportDataResponseParsed,
  type GetPathsResponseParsed,
  type ImportDataResponseParsed,
  type ListBackupsResponseParsed,
  type ResetDataResponseParsed,
  type RestoreBackupResponseParsed,
} from '../../../shared/schemas/backup';
import {
  BACKUPS_DIR_NAME,
  DEFAULT_KEEP_AUTO,
  applyBackupToDb,
  deleteBackupFile,
  ensureDir,
  exportDataToPath,
  generateBackupFilename,
  listBackups,
  parseBackupFile,
  pruneOldBackups,
  readAppMeta,
  readSchemaVersionFromDb,
  serializeAppMetaValue,
} from '../services/backupService';

/** 依赖注入：注册时由主进程传入 db 客户端。 */
export interface BackupIpcDeps {
  db: WorkstationDb;
  /**
   * 应用版本（package.json）。T5-2 不会改这个值，由 `registerAppIpc` 的 `appVersion`
   * 一起传入。
   */
  appVersion: string;
  /**
   * userData 绝对路径（`app.getPath('userData')`）。由主进程在启动时算好传入。
   */
  userDataDir: string;
  /**
   * db 文件绝对路径（`app.getPath('userData') + '/workstation.db'` 或 dev 路径）。
   * 仅用于 `app:getPaths` 响应 —— **不**在错误信息 / 日志里回显。
   */
  dbPath: string;
  /**
   * 测试钩子：`new Date()` 的 mock 注入点。生产 = `undefined`。
   */
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

/** 工具：把绝对路径转换成"安全展示文本" —— 只回显 basename。
 *  当前未在错误信息中回显（`safeDisplayName` 仅占位）；下个卡可能用到。
 */
function _safeDisplayName(absPath: string): string {
  return basename(absPath);
}
void _safeDisplayName;

// ============================================================
//  handler 函数（独立可测）
// ============================================================

/** `app:getPaths` handler。 */
export async function handleGetPaths(deps: BackupIpcDeps): Promise<GetPathsResponseParsed> {
  try {
    return GetPathsResponseSchema.parse({
      userData: deps.userDataDir,
      db: deps.dbPath,
      backups: join(deps.userDataDir, BACKUPS_DIR_NAME),
    });
  } catch (err) {
    throw toIpcError(err);
  }
}

/** `app:listBackups` handler。 */
export async function handleListBackups(deps: BackupIpcDeps): Promise<ListBackupsResponseParsed> {
  try {
    const dir = join(deps.userDataDir, BACKUPS_DIR_NAME);
    const list = listBackups(dir);
    return ListBackupsResponseSchema.parse(list);
  } catch (err) {
    if (isStructuredIpcError(err)) throw err;
    throw toIpcError(err);
  }
}

/**
 * 内部：执行一次"导出到 destPath" —— 写完直接返回元数据。
 *
 * @returns `{ path, size, createdAt }`
 */
async function doExport(
  deps: BackupIpcDeps,
  destPath: string,
): Promise<BackupNowResponseParsed> {
  const now = (deps.now ?? (() => new Date()))();
  const schemaVersion = readSchemaVersionFromDb(deps.db);
  const { size } = await exportDataToPath(deps.db, destPath, {
    appVersion: deps.appVersion,
    now,
    schemaVersion,
  });
  return BackupNowResponseSchema.parse({
    path: destPath,
    size,
    createdAt: now.getTime(),
  });
}

/** `app:backupNow` handler。 */
export async function handleBackupNow(
  deps: BackupIpcDeps,
  payload: unknown,
): Promise<BackupNowResponseParsed> {
  const parsed = BackupNowInputSchema.safeParse(payload ?? {});
  if (!parsed.success) {
    throw {
      code: 'VALIDATION_FAILED' as const,
      message: 'Invalid backupNow input',
      details: parsed.error.flatten(),
    };
  }

  const backupsDir = join(deps.userDataDir, BACKUPS_DIR_NAME);
  try {
    await ensureDir(backupsDir);
  } catch (err) {
    throw {
      code: 'PERSISTENCE_FAILED' as const,
      message: `Failed to ensure backups dir: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // 决定 destPath
  const now = (deps.now ?? (() => new Date()))();
  const destPath = parsed.data.destPath ?? join(backupsDir, generateBackupFilename('auto', now));

  try {
    const result = await doExport(deps, destPath);

    // 同步更新 `app_meta.last_auto_backup_at`
    deps.db
      .insert(appMeta)
      .values({
        key: 'last_auto_backup_at',
        value: String(result.createdAt),
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: appMeta.key,
        set: { value: String(result.createdAt), updatedAt: now },
      })
      .run();

    // 删除多余自动备份（**不**删手动 / before-restore）
    pruneOldBackups(backupsDir, DEFAULT_KEEP_AUTO);

    return result;
  } catch (err) {
    if (isStructuredIpcError(err)) throw err;
    throw {
      code: 'PERSISTENCE_FAILED' as const,
      message: `Failed to backup: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/** `app:exportData` handler。 */
export async function handleExportData(
  deps: BackupIpcDeps,
  payload: unknown,
): Promise<ExportDataResponseParsed> {
  const parsed = ExportDataInputSchema.safeParse(payload);
  if (!parsed.success) {
    throw {
      code: 'VALIDATION_FAILED' as const,
      message: 'Invalid exportData input',
      details: parsed.error.flatten(),
    };
  }

  const destPath = parsed.data.destPath;
  try {
    return ExportDataResponseSchema.parse(await doExport(deps, destPath));
  } catch (err) {
    if (isStructuredIpcError(err)) throw err;
    throw {
      code: 'PERSISTENCE_FAILED' as const,
      message: `Failed to export: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * 内部：执行"恢复流程" —— 通用 restoreBackup / importData 共享。
 *
 * 1. 二次确认字符串校验（Zod 已做 literal 'RESTORE'，**外加**运行时 === 'RESTORE'）
 * 2. 把当前 db 备份到 `<userData>/backups/before-restore-YYYYMMDD-HHmmss.mmws.json`
 * 3. parse 入参 .mmws.json → Zod 校验
 * 4. 事务：DELETE 业务表 + 重新 insert
 * 5. 标记 `app_meta.last_restore_at`
 * 6. 返回 `restartRequired: true`
 */
async function doRestore(
  deps: BackupIpcDeps,
  path: string,
  confirm: string,
): Promise<RestoreBackupResponseParsed> {
  if (confirm !== 'RESTORE') {
    throw {
      code: 'VALIDATION_FAILED' as const,
      message: 'Invalid confirm string for restore (must be uppercase RESTORE)',
    };
  }

  const now = (deps.now ?? (() => new Date()))();
  const backupsDir = join(deps.userDataDir, BACKUPS_DIR_NAME);
  await ensureDir(backupsDir);

  // 1. 备份当前 db 到 before-restore-*
  const safetyBackupPath = join(backupsDir, generateBackupFilename('before-restore', now));
  try {
    await doExport(deps, safetyBackupPath);
  } catch (err) {
    throw {
      code: 'PERSISTENCE_FAILED' as const,
      message: `Failed to create safety backup before restore: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // 2. parse 入参
  const backup = await parseBackupFile(path);

  // 3. 应用到 db
  try {
    applyBackupToDb(deps.db, backup, { now });
  } catch (err) {
    if (isStructuredIpcError(err)) throw err;
    throw {
      code: 'PERSISTENCE_FAILED' as const,
      message: `Failed to apply backup: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // 4. 标记 `last_restore_at`
  try {
    deps.db
      .insert(appMeta)
      .values({
        key: 'last_restore_at',
        value: serializeAppMetaValue('last_restore_at', now.getTime()),
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: appMeta.key,
        set: {
          value: serializeAppMetaValue('last_restore_at', now.getTime()),
          updatedAt: now,
        },
      })
      .run();
  } catch (err) {
    throw {
      code: 'PERSISTENCE_FAILED' as const,
      message: `Failed to write last_restore_at: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  return RestoreBackupResponseSchema.parse({ ok: true, restartRequired: true });
}

/** `app:restoreBackup` handler。 */
export async function handleRestoreBackup(
  deps: BackupIpcDeps,
  payload: unknown,
): Promise<RestoreBackupResponseParsed> {
  const parsed = RestoreBackupInputSchema.safeParse(payload);
  if (!parsed.success) {
    throw {
      code: 'VALIDATION_FAILED' as const,
      message: 'Invalid restoreBackup input',
      details: parsed.error.flatten(),
    };
  }
  return doRestore(deps, parsed.data.path, parsed.data.confirm);
}

/** `app:importData` handler（语义 = restore from external file）。 */
export async function handleImportData(
  deps: BackupIpcDeps,
  payload: unknown,
): Promise<ImportDataResponseParsed> {
  const parsed = ImportDataInputSchema.safeParse(payload);
  if (!parsed.success) {
    throw {
      code: 'VALIDATION_FAILED' as const,
      message: 'Invalid importData input',
      details: parsed.error.flatten(),
    };
  }
  return ImportDataResponseSchema.parse(
    await doRestore(deps, parsed.data.path, parsed.data.confirm),
  );
}

/** `app:deleteBackup` handler。 */
export async function handleDeleteBackup(
  deps: BackupIpcDeps,
  payload: unknown,
): Promise<DeleteBackupResponseParsed> {
  const parsed = DeleteBackupInputSchema.safeParse(payload);
  if (!parsed.success) {
    throw {
      code: 'VALIDATION_FAILED' as const,
      message: 'Invalid deleteBackup input',
      details: parsed.error.flatten(),
    };
  }
  const backupsDir = join(deps.userDataDir, BACKUPS_DIR_NAME);
  try {
    deleteBackupFile(backupsDir, parsed.data.path);
    return DeleteBackupResponseSchema.parse({ deleted: true });
  } catch (err) {
    if (isStructuredIpcError(err)) {
      // 服务层抛的 NOT_FOUND 透传
      if (err.code === 'NOT_FOUND' || err.code === 'VALIDATION_FAILED') throw err;
    }
    throw {
      code: 'PERSISTENCE_FAILED' as const,
      message: `Failed to delete backup: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/** `app:resetData` handler。 */
export async function handleResetData(
  deps: BackupIpcDeps,
  payload: unknown,
): Promise<ResetDataResponseParsed> {
  const parsed = ResetDataInputSchema.safeParse(payload);
  if (!parsed.success) {
    throw {
      code: 'VALIDATION_FAILED' as const,
      message: 'Invalid resetData input',
      details: parsed.error.flatten(),
    };
  }
  if (parsed.data.confirm !== 'RESET') {
    throw {
      code: 'VALIDATION_FAILED' as const,
      message: 'Invalid confirm string for reset (must be uppercase RESET)',
    };
  }

  // 触发 reset；保留 schemaVersion / setupCompletedAt 由 Zod 白名单保证
  const _now = (deps.now ?? (() => new Date()))();
  void _now;

  try {
    // 事务内 DELETE FROM 业务表。
    // 触发器会同步清空 FTS5 虚表（notes / tasks / inbox_items 表的 DELETE 触发器会
    // 同步移除 FTS5 索引项），所以**不**需要单独 DELETE FTS5 虚表。
    const runInTransaction = deps.db.$client.transaction(() => {
      deps.db.$client.exec(
        'DELETE FROM reviews; DELETE FROM notes; DELETE FROM tasks; DELETE FROM inbox_items; DELETE FROM projects; DELETE FROM ai_configs;',
      );
    });
    runInTransaction();
  } catch (err) {
    throw {
      code: 'PERSISTENCE_FAILED' as const,
      message: `Failed to reset data: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // **不**删 app_meta 的 schemaVersion / setupCompletedAt
  // （**不**写 last_restore_at —— reset 走 last_restore_at 是误导用户）

  return ResetDataResponseSchema.parse({ ok: true, restartRequired: true });
}

/** 工具：暴露给 settings IPC 用 —— 读 `app_meta` 里的 auto_backup_interval_min 等。 */
export function readBackupSettings(
  db: WorkstationDb,
): {
  autoBackupIntervalMin: 0 | 30 | 60 | 120;
  lastAutoBackupAt: number | null;
  lastRestoreAt: number | null;
} {
  const map = readAppMeta(db, [
    'auto_backup_interval_min',
    'last_auto_backup_at',
    'last_restore_at',
  ]);

  const raw = map['auto_backup_interval_min'];
  const parsed = raw === null ? NaN : Number(raw);
  const interval: 0 | 30 | 60 | 120 =
    parsed === 0 || parsed === 30 || parsed === 60 || parsed === 120 ? parsed : 30;

  const lastAutoRaw = map['last_auto_backup_at'];
  const lastAuto: number | null = lastAutoRaw === null || lastAutoRaw === '' ? null : Number(lastAutoRaw);

  const lastRestoreRaw = map['last_restore_at'];
  const lastRestore: number | null =
    lastRestoreRaw === null || lastRestoreRaw === '' ? null : Number(lastRestoreRaw);

  return {
    autoBackupIntervalMin: interval,
    lastAutoBackupAt: Number.isFinite(lastAuto ?? NaN) ? (lastAuto as number) : null,
    lastRestoreAt: Number.isFinite(lastRestore ?? NaN) ? (lastRestore as number) : null,
  };
}

// ============================================================
//  registerBackupIpc：把 handler 挂到 ipcMain
// ============================================================

/**
 * 注册 8 个 `app:*` 备份相关 IPC handler。**只调一次**（主进程启动时）。
 */
export function registerBackupIpc(deps: BackupIpcDeps): void {
  ipcMain.handle('app:getPaths', async () => {
    try {
      return { ok: true as const, data: await handleGetPaths(deps) };
    } catch (err) {
      if (isStructuredIpcError(err)) return { ok: false as const, error: err };
      return { ok: false as const, error: toIpcError(err) };
    }
  });

  ipcMain.handle('app:listBackups', async () => {
    try {
      return { ok: true as const, data: await handleListBackups(deps) };
    } catch (err) {
      if (isStructuredIpcError(err)) return { ok: false as const, error: err };
      return { ok: false as const, error: toIpcError(err) };
    }
  });

  ipcMain.handle('app:backupNow', async (_evt, payload: unknown) => {
    try {
      return { ok: true as const, data: await handleBackupNow(deps, payload) };
    } catch (err) {
      if (isStructuredIpcError(err)) return { ok: false as const, error: err };
      return { ok: false as const, error: toIpcError(err) };
    }
  });

  ipcMain.handle('app:exportData', async (_evt, payload: unknown) => {
    try {
      return { ok: true as const, data: await handleExportData(deps, payload) };
    } catch (err) {
      if (isStructuredIpcError(err)) return { ok: false as const, error: err };
      return { ok: false as const, error: toIpcError(err) };
    }
  });

  ipcMain.handle('app:restoreBackup', async (_evt, payload: unknown) => {
    try {
      return { ok: true as const, data: await handleRestoreBackup(deps, payload) };
    } catch (err) {
      if (isStructuredIpcError(err)) return { ok: false as const, error: err };
      return { ok: false as const, error: toIpcError(err) };
    }
  });

  ipcMain.handle('app:importData', async (_evt, payload: unknown) => {
    try {
      return { ok: true as const, data: await handleImportData(deps, payload) };
    } catch (err) {
      if (isStructuredIpcError(err)) return { ok: false as const, error: err };
      return { ok: false as const, error: toIpcError(err) };
    }
  });

  ipcMain.handle('app:deleteBackup', async (_evt, payload: unknown) => {
    try {
      return { ok: true as const, data: await handleDeleteBackup(deps, payload) };
    } catch (err) {
      if (isStructuredIpcError(err)) return { ok: false as const, error: err };
      return { ok: false as const, error: toIpcError(err) };
    }
  });

  ipcMain.handle('app:resetData', async (_evt, payload: unknown) => {
    try {
      return { ok: true as const, data: await handleResetData(deps, payload) };
    } catch (err) {
      if (isStructuredIpcError(err)) return { ok: false as const, error: err };
      return { ok: false as const, error: toIpcError(err) };
    }
  });
}

/** 工具：从 electron `app` 注入一个 `BackupIpcDeps`（主进程启动时用）。 */
export function buildBackupDepsFromApp(db: WorkstationDb, appVersion: string): BackupIpcDeps {
  const userDataDir = app.getPath('userData');
  // db 路径约定（与 db/client.ts 的 resolveDbPath 一致）
  // dev 模式：`<appPath>/.data/workstation.db`；prod 模式：`<userData>/workstation.db`
  // 这里不调 resolveDbPath（避免依赖 appPath），直接根据 isPackaged 推断
  const isDev = !app.isPackaged;
  const dbPath = isDev
    ? join(app.getAppPath(), '.data', 'workstation.db')
    : join(userDataDir, 'workstation.db');
  return { db, appVersion, userDataDir, dbPath };
}
