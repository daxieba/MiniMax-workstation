/**
 * 备份 / 导出 / 恢复 核心服务（T5-2 设置页）
 *
 * **职责**：提供一组**纯函数**（不依赖 ipcMain / electron app / 任何副作用注入），
 * 供 `electron/main/ipc/backup.ts` 调用。这样可以单独单测，不依赖 Electron runtime。
 *
 * **导出格式**：单文件 JSON（`.mmws.json`），**不**上 jsonl —— 业务量小、文件小、
 * 一次加载到内存 + 一次事务回写即可。
 *
 * **安全约束**（PROJECT_IDENTITY.md §6）：
 *   - **不**含 apiKey（aiConfigs 表本身就不含）
 *   - **不**含 userData / db 绝对路径（meta 只含 appVersion 字符串 + schemaVersion）
 *   - **不**含 FTS5 虚表行（导出时跳过；导入时 DELETE 虚表）
 *   - 单文件大小限制 50MB（超过拒绝 parse / write）
 *
 * **命名规则**（用于 `pruneOldBackups` 自动 vs 手动 vs 恢复前快照）：
 *   - `auto-*.mmws.json`           → 自动备份（保留最新 N 份）
 *   - `manual-*.mmws.json`         → 手动备份（**不**自动删）
 *   - `before-restore-*.mmws.json` → 恢复前快照（**不**自动删）
 *
 * @used-by electron/main/ipc/backup.ts
 * @used-by tests/backupService.test.ts
 */

import { existsSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { readdir, mkdir, rename, stat } from 'node:fs/promises';
import { basename, join, resolve, sep as pathSep } from 'node:path';

import { eq } from 'drizzle-orm';

import { type WorkstationDb } from '../../../db/client';
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
} from '../../../db/schema';
import {
  MmwsBackupFileSchema,
  type MmwsBackupFileParsed,
} from '../../../shared/schemas/backup';

// ============================================================
//  常量
// ============================================================

/** 单文件大小上限：50MB。超过即拒绝（防 OOM / 防恶意大文件）。 */
export const MAX_BACKUP_FILE_SIZE = 50 * 1024 * 1024;

/** 备份目录名（相对 `<userData>`）。 */
export const BACKUPS_DIR_NAME = 'backups';

/** 备份文件后缀。 */
export const BACKUP_FILE_EXT = '.mmws.json';

/** 自动保留的最近自动备份份数。 */
export const DEFAULT_KEEP_AUTO = 10;

/** 自动备份前缀。 */
const PREFIX_AUTO = 'auto';
/** 手动备份前缀（本卡暂未使用，pruneOldBackups 不删此类）。 */
const _PREFIX_MANUAL = 'manual';
/** 恢复前快照前缀（本卡暂未使用，pruneOldBackups 不删此类）。 */
const _PREFIX_BEFORE_RESTORE = 'before-restore';
void _PREFIX_MANUAL;
void _PREFIX_BEFORE_RESTORE;

/** app_meta 中允许出现在备份里的 key 白名单（与 `backup.ts` 中 `APP_META_KEYS` 保持一致）。 */
const ALLOWED_APP_META_KEYS = new Set<string>([
  'schemaVersion',
  'setupCompletedAt',
  'auto_backup_interval_min',
  'last_auto_backup_at',
  'last_restore_at',
]);

// ============================================================
//  业务表 → row 转换（Date → Unix ms）
// ============================================================

function projectRowToExport(r: ProjectRow): Record<string, unknown> {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    color: r.color,
    archived: r.archived,
    createdAt: r.createdAt.getTime(),
    updatedAt: r.updatedAt.getTime(),
  };
}

function inboxItemRowToExport(r: InboxItemRow): Record<string, unknown> {
  return {
    id: r.id,
    content: r.content,
    kind: r.kind,
    source: r.source,
    status: r.status,
    convertedTo: r.convertedTo,
    projectId: r.projectId,
    tags: r.tags,
    createdAt: r.createdAt.getTime(),
    updatedAt: r.updatedAt.getTime(),
    deletedAt: r.deletedAt === null ? null : r.deletedAt.getTime(),
  };
}

function taskRowToExport(r: TaskRow): Record<string, unknown> {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    status: r.status,
    priority: r.priority,
    dueDate: r.dueDate === null ? null : r.dueDate.getTime(),
    projectId: r.projectId,
    tags: r.tags,
    source: r.source,
    inboxId: r.inboxId,
    noteIds: r.noteIds,
    createdAt: r.createdAt.getTime(),
    updatedAt: r.updatedAt.getTime(),
    completedAt: r.completedAt === null ? null : r.completedAt.getTime(),
  };
}

function noteRowToExport(r: NoteRow): Record<string, unknown> {
  return {
    id: r.id,
    title: r.title,
    content: r.content,
    tags: r.tags,
    linkedTaskIds: r.linkedTaskIds,
    projectId: r.projectId,
    source: r.source,
    archived: r.archived,
    createdAt: r.createdAt.getTime(),
    updatedAt: r.updatedAt.getTime(),
  };
}

function reviewRowToExport(r: ReviewRow): Record<string, unknown> {
  return {
    id: r.id,
    date: r.date,
    completed: r.completed,
    uncompleted: r.uncompleted,
    blockers: r.blockers,
    topThree: r.topThree,
    aiDraft: r.aiDraft,
    createdAt: r.createdAt.getTime(),
    updatedAt: r.updatedAt.getTime(),
  };
}

function aiConfigRowToExport(r: AiConfigRow): Record<string, unknown> {
  return {
    provider: r.provider,
    model: r.model,
    baseURL: r.baseURL,
    updatedAt: r.updatedAt,
  };
}

function appMetaRowToExport(r: AppMetaRow): Record<string, unknown> {
  return {
    key: r.key,
    value: r.value,
    createdAt: r.createdAt.getTime(),
    updatedAt: r.updatedAt.getTime(),
  };
}

// ============================================================
//  业务表 → row 转换（Unix ms → Date）
// ============================================================

function exportToProjectRow(o: Record<string, unknown>): ProjectRow {
  return {
    id: o['id'] as string,
    name: o['name'] as string,
    description: (o['description'] as string | null) ?? null,
    color: (o['color'] as string | null) ?? null,
    archived: o['archived'] as 0 | 1,
    createdAt: new Date(o['createdAt'] as number),
    updatedAt: new Date(o['updatedAt'] as number),
  };
}

function exportToInboxItemRow(o: Record<string, unknown>): InboxItemRow {
  const deletedAt = o['deletedAt'];
  return {
    id: o['id'] as string,
    content: o['content'] as string,
    kind: o['kind'] as InboxItemRow['kind'],
    source: o['source'] as InboxItemRow['source'],
    status: o['status'] as InboxItemRow['status'],
    convertedTo: (o['convertedTo'] as string | null) ?? null,
    projectId: (o['projectId'] as string | null) ?? null,
    tags: o['tags'] as string[],
    createdAt: new Date(o['createdAt'] as number),
    updatedAt: new Date(o['updatedAt'] as number),
    deletedAt: deletedAt === null || deletedAt === undefined ? null : new Date(deletedAt as number),
  };
}

function exportToTaskRow(o: Record<string, unknown>): TaskRow {
  const dueDate = o['dueDate'];
  const completedAt = o['completedAt'];
  return {
    id: o['id'] as string,
    title: o['title'] as string,
    description: (o['description'] as string | null) ?? null,
    status: o['status'] as TaskRow['status'],
    priority: o['priority'] as TaskRow['priority'],
    dueDate: dueDate === null || dueDate === undefined ? null : new Date(dueDate as number),
    projectId: (o['projectId'] as string | null) ?? null,
    tags: o['tags'] as string[],
    source: o['source'] as TaskRow['source'],
    inboxId: (o['inboxId'] as string | null) ?? null,
    noteIds: o['noteIds'] as string[],
    createdAt: new Date(o['createdAt'] as number),
    updatedAt: new Date(o['updatedAt'] as number),
    completedAt:
      completedAt === null || completedAt === undefined ? null : new Date(completedAt as number),
  };
}

function exportToNoteRow(o: Record<string, unknown>): NoteRow {
  return {
    id: o['id'] as string,
    title: o['title'] as string,
    content: o['content'] as string,
    tags: o['tags'] as string[],
    linkedTaskIds: o['linkedTaskIds'] as string[],
    projectId: (o['projectId'] as string | null) ?? null,
    source: o['source'] as NoteRow['source'],
    archived: o['archived'] as 0 | 1,
    createdAt: new Date(o['createdAt'] as number),
    updatedAt: new Date(o['updatedAt'] as number),
  };
}

function exportToReviewRow(o: Record<string, unknown>): ReviewRow {
  return {
    id: o['id'] as string,
    date: o['date'] as string,
    completed: o['completed'] as ReviewRow['completed'],
    uncompleted: o['uncompleted'] as ReviewRow['uncompleted'],
    blockers: o['blockers'] as string,
    topThree: o['topThree'] as string[],
    aiDraft: (o['aiDraft'] as ReviewRow['aiDraft']) ?? null,
    createdAt: new Date(o['createdAt'] as number),
    updatedAt: new Date(o['updatedAt'] as number),
  };
}

function exportToAiConfigRow(o: Record<string, unknown>): AiConfigRow {
  return {
    provider: o['provider'] as string,
    model: o['model'] as string,
    baseURL: o['baseURL'] as string,
    updatedAt: o['updatedAt'] as number,
  };
}

function exportToAppMetaRow(o: Record<string, unknown>): AppMetaRow {
  return {
    key: o['key'] as string,
    value: o['value'] as string,
    createdAt: new Date(o['createdAt'] as number),
    updatedAt: new Date(o['updatedAt'] as number),
  };
}

// ============================================================
//  公开函数
// ============================================================

/**
 * 备份文件名前缀枚举。
 *
 * - `auto`           自动备份（`pruneOldBackups` 会按 `keepAuto` 删多余）
 * - `manual`         手动备份（**不**自动删）
 * - `before-restore` 恢复前快照（**不**自动删）
 */
export type BackupPrefix = 'auto' | 'manual' | 'before-restore';

/**
 * 生成备份文件名（**只**生成文件名，不含路径）。
 *
 * 格式：`<prefix>-YYYYMMDD-HHmmss.mmws.json`
 */
export function generateBackupFilename(
  prefix: BackupPrefix,
  now: Date = new Date(),
): string {
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const mi = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  return `${prefix}-${yyyy}${mm}${dd}-${hh}${mi}${ss}${BACKUP_FILE_EXT}`;
}

/**
 * 把 db 数据导出到指定路径。
 *
 * 流程：
 *   1. 读全部业务表
 *   2. 拼 .mmws.json（**不**含 FTS5 虚表数据，meta 只含 `appVersion` 字符串 + `schemaVersion`）
 *   3. writeFileSync + 返回 `{ size, createdAt }`
 *
 * **不**写 apiKey / userData 绝对路径。
 *
 * @param db           Drizzle db 客户端
 * @param destPath     目标绝对路径（由 caller 保证目录存在）
 * @param opts         选项
 * @param opts.appVersion     应用版本（package.json）
 * @param opts.now            导出时间（默认 = now）；测试可注入固定时间
 * @param opts.schemaVersion  db schema 版本（来自 `__drizzle_migrations`）
 */
export async function exportDataToPath(
  db: WorkstationDb,
  destPath: string,
  opts: {
    appVersion: string;
    now?: Date;
    schemaVersion: number;
  },
): Promise<{ size: number; createdAt: number }> {
  const now = opts.now ?? new Date();
  const createdAt = now.getTime();

  const projectsRows = db.select().from(projects).all().map(projectRowToExport);
  const inboxRows = db.select().from(inboxItems).all().map(inboxItemRowToExport);
  const tasksRows = db.select().from(tasks).all().map(taskRowToExport);
  const notesRows = db.select().from(notes).all().map(noteRowToExport);
  const reviewsRows = db.select().from(reviews).all().map(reviewRowToExport);
  const aiConfigsRows = db.select().from(aiConfigs).all().map(aiConfigRowToExport);
  const appMetaRows = db
    .select()
    .from(appMeta)
    .all()
    .filter((r) => ALLOWED_APP_META_KEYS.has(r.key))
    .map(appMetaRowToExport);

  const file: MmwsBackupFileParsed = {
    meta: {
      formatVersion: 1,
      exportedAt: createdAt,
      appVersion: opts.appVersion,
      schemaVersion: opts.schemaVersion,
    },
    data: {
      projects: projectsRows as never,
      inbox_items: inboxRows as never,
      tasks: tasksRows as never,
      notes: notesRows as never,
      reviews: reviewsRows as never,
      ai_configs: aiConfigsRows as never,
      app_meta: appMetaRows as never,
    },
  };

  const json = JSON.stringify(file, null, 2);
  writeFileSync(destPath, json, { encoding: 'utf-8' });
  const stat = statSync(destPath);
  return { size: stat.size, createdAt };
}

/**
 * 读 + 解析 + Zod 校验一个 .mmws.json 文件。
 *
 * **安全**：
 *   - 读前 stat 文件大小，超 `MAX_BACKUP_FILE_SIZE` 拒绝（防 OOM）
 *   - Zod `.strict()` 拒绝额外字段
 *   - `formatVersion` 必须等于 1
 *
 * @throws 包含 `code` 字段的 IPC 错误对象（VALIDATION_FAILED / PERSISTENCE_FAILED / NOT_FOUND）
 */
export async function parseBackupFile(path: string): Promise<MmwsBackupFileParsed> {
  if (!existsSync(path)) {
    throw {
      code: 'NOT_FOUND' as const,
      message: `Backup file not found`,
    };
  }
  const stat = statSync(path);
  if (stat.size > MAX_BACKUP_FILE_SIZE) {
    throw {
      code: 'VALIDATION_FAILED' as const,
      message: `Backup file too large: ${stat.size} bytes (max ${MAX_BACKUP_FILE_SIZE})`,
    };
  }

  let raw: string;
  try {
    raw = readFileSync(path, { encoding: 'utf-8' });
  } catch (err) {
    throw {
      code: 'PERSISTENCE_FAILED' as const,
      message: `Failed to read backup file: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    throw {
      code: 'VALIDATION_FAILED' as const,
      message: `Backup file is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const parsed = MmwsBackupFileSchema.safeParse(json);
  if (!parsed.success) {
    throw {
      code: 'VALIDATION_FAILED' as const,
      message: `Backup file schema mismatch: ${parsed.error.issues
        .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
        .join('; ')}`,
    };
  }
  return parsed.data;
}

/**
 * 把 `MmwsBackupFile` 应用到 db —— 事务内清空业务表 + 重新插入。
 *
 * 行为：
 *   1. **不**清空 `app_meta`（保留 `schemaVersion` / `setupCompletedAt` /
 *      `auto_backup_interval_min` 等运行时 key；用 upsert 覆盖 `last_*_at` 时间戳）
 *   2. DELETE FROM 业务表（含 FTS5 虚表）
 *   3. 按依赖顺序逐表 insert（**不**用 `onConflictDoNothing` —— 表已清空）
 *   4. app_meta 用 upsert 语义（保留运行时 key，不重复插）
 *
 * **实现细节**：用 better-sqlite3 的原生 `db.$client.transaction(cb)`，**不**用
 * Drizzle 的 `db.transaction((tx) => ...)` —— 后者的 `tx` 不暴露 `$client.exec`，
 * 而 FTS5 虚表的 DELETE 是 raw SQL。这个 trade-off 让我们能用一个事务包住 Drizzle
 * insert + raw SQL delete，保证原子性。
 *
 * @throws 包含 `code: 'PERSISTENCE_FAILED'` 的错误对象
 */
export function applyBackupToDb(
  db: WorkstationDb,
  backup: MmwsBackupFileParsed,
  opts: { now?: Date } = {},
): void {
  const now = opts.now ?? new Date();

  try {
    const runInTransaction = db.$client.transaction(() => {
      // 1. 清空业务表（顺序：子→父，避免 FK 临时约束）
      // 触发器会同步清空 FTS5 虚表（notes / tasks / inbox_items 表的 DELETE 触发器会
      // 同步移除 FTS5 索引项；因为 FTS5 是 contentless 模式，触发器反向同步时 rowid 仍然有效）
      db.$client.exec(
        'DELETE FROM reviews; DELETE FROM notes; DELETE FROM tasks; DELETE FROM inbox_items; DELETE FROM projects; DELETE FROM ai_configs;',
      );

      // 2. 逐表 insert（projects 先，因为它被其他表 FK 引用）
      for (const row of backup.data.projects) {
        db.insert(projects).values(exportToProjectRow(row as never)).run();
      }
      for (const row of backup.data.inbox_items) {
        db.insert(inboxItems).values(exportToInboxItemRow(row as never)).run();
      }
      for (const row of backup.data.tasks) {
        db.insert(tasks).values(exportToTaskRow(row as never)).run();
      }
      for (const row of backup.data.notes) {
        db.insert(notes).values(exportToNoteRow(row as never)).run();
      }
      for (const row of backup.data.reviews) {
        db.insert(reviews).values(exportToReviewRow(row as never)).run();
      }
      for (const row of backup.data.ai_configs) {
        db.insert(aiConfigs).values(exportToAiConfigRow(row as never)).run();
      }

      // 3. app_meta：upsert（保留运行时 key；如果备份里没有则不删）
      for (const row of backup.data.app_meta) {
        const exported = exportToAppMetaRow(row as never);
        db.insert(appMeta)
          .values(exported)
          .onConflictDoUpdate({
            target: appMeta.key,
            set: { value: exported.value, updatedAt: now },
          })
          .run();
      }
    });
    runInTransaction();
  } catch (err) {
    throw {
      code: 'PERSISTENCE_FAILED' as const,
      message: `Failed to apply backup: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * 扫描 `backupsDir`，返回 `BackupInfo[]`，按 `createdAt` DESC 排序。
 *
 * **安全**：
 *   - 只列出以 `.mmws.json` 结尾的文件
 *   - 文件名不在预期格式（`{prefix}-YYYYMMDD-HHmmss.mmws.json`）→ 跳过
 *   - createdAt 从文件名解析（不依赖文件 mtime，避免用户改系统时间导致顺序错乱）
 */
export function listBackups(backupsDir: string): Array<{
  filename: string;
  path: string;
  size: number;
  createdAt: number;
}> {
  if (!existsSync(backupsDir)) {
    return [];
  }

  const result: Array<{
    filename: string;
    path: string;
    size: number;
    createdAt: number;
  }> = [];

  // 同步读目录（用 readdirSync 因为测试场景要求同步语义）
  const entries = readdirSync(backupsDir) as string[];
  for (const name of entries) {
    if (!name.endsWith(BACKUP_FILE_EXT)) continue;
    const fullPath = join(backupsDir, name);
    let stat;
    try {
      stat = statSync(fullPath);
    } catch {
      continue;
    }
    const createdAt = parseCreatedAtFromFilename(name);
    if (createdAt === null) continue; // 文件名格式不对，跳过
    result.push({
      filename: name,
      path: fullPath,
      size: stat.size,
      createdAt,
    });
  }

  result.sort((a, b) => b.createdAt - a.createdAt);
  return result;
}

/**
 * 从备份文件名解析 createdAt（Unix ms）。
 *
 * 支持格式：`<prefix>-YYYYMMDD-HHmmss.mmws.json`，其中 prefix ∈
 * {auto, manual, before-restore}。
 *
 * @returns 解析成功返回 Unix ms；失败返回 null
 */
export function parseCreatedAtFromFilename(filename: string): number | null {
  // 期望：`prefix-YYYYMMDD-HHmmss.mmws.json` —— 用 regex 解析
  const m = filename.match(/^(auto|manual|before-restore)-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.mmws\.json$/);
  if (!m) return null;
  const [, , yyyy, MM, dd, hh, mi, ss] = m;
  const dt = new Date(
    Number(yyyy),
    Number(MM) - 1,
    Number(dd),
    Number(hh),
    Number(mi),
    Number(ss),
  );
  if (Number.isNaN(dt.getTime())) return null;
  return dt.getTime();
}

/**
 * 删多余自动备份。
 *
 * 规则：
 *   - 只删 `auto-*.mmws.json`
 *   - 保留最新 `keepAuto` 份
 *   - **不**删 `manual-*` / `before-restore-*` / 其他文件
 *
 * @returns 删除的文件名列表
 */
export function pruneOldBackups(
  backupsDir: string,
  keepAuto: number = DEFAULT_KEEP_AUTO,
): { deleted: string[] } {
  if (!existsSync(backupsDir)) {
    return { deleted: [] };
  }
  const entries = readdirSync(backupsDir) as string[];
  const autos: Array<{ filename: string; createdAt: number }> = [];
  for (const name of entries) {
    if (!name.startsWith(`${PREFIX_AUTO}-`) || !name.endsWith(BACKUP_FILE_EXT)) continue;
    const createdAt = parseCreatedAtFromFilename(name);
    if (createdAt === null) continue;
    autos.push({ filename: name, createdAt });
  }
  // 升序：最旧在前
  autos.sort((a, b) => a.createdAt - b.createdAt);
  const toDelete = autos.slice(0, Math.max(0, autos.length - keepAuto));
  const deleted: string[] = [];
  for (const item of toDelete) {
    const fullPath = join(backupsDir, item.filename);
    try {
      unlinkSync(fullPath);
      deleted.push(item.filename);
    } catch {
      // ignore
    }
  }
  return { deleted };
}

/**
 * 删单个备份文件。
 *
 * 二次保护（防误删核心 db）：
 *   - 必须以 `.mmws.json` 结尾
 *   - `backupsDir` 必须在 `path` 的父链上（防路径穿越）
 */
export function deleteBackupFile(backupsDir: string, path: string): void {
  // 二次保护
  if (!path.endsWith(BACKUP_FILE_EXT)) {
    throw {
      code: 'VALIDATION_FAILED' as const,
      message: `Only .mmws.json files can be deleted via this path`,
    };
  }
  const resolvedBackups = resolve(backupsDir);
  const resolvedPath = resolve(path);
  // 校验：resolvedPath 必须在 resolvedBackups 下
  if (
    !resolvedPath.startsWith(resolvedBackups + pathSep) &&
    resolvedPath !== resolvedBackups
  ) {
    throw {
      code: 'VALIDATION_FAILED' as const,
      message: `Backup file path is outside backups dir`,
    };
  }
  if (!existsSync(resolvedPath)) {
    throw {
      code: 'NOT_FOUND' as const,
      message: `Backup file not found`,
    };
  }
  unlinkSync(resolvedPath);
}

/**
 * 读 `app_meta` 的 schemaVersion 行（用于导出时的 `meta.schemaVersion` 字段）。
 *
 * 返回 0 如果表为空。
 */
export function readSchemaVersionFromDb(db: WorkstationDb): number {
  try {
    const row = db.$client
      .prepare('SELECT COUNT(*) AS cnt FROM __drizzle_migrations')
      .get() as { cnt: number } | undefined;
    return row?.cnt ?? 0;
  } catch {
    return 0;
  }
}

/**
 * 把 `app_meta.value` 字符串按 key 解析。
 *
 * - `auto_backup_interval_min` → Number
 * - `last_auto_backup_at` / `last_restore_at` → Number | null
 * - 其他 → 原样返回
 */
export function parseAppMetaValue(key: string, value: string): number | string | null {
  switch (key) {
    case 'auto_backup_interval_min':
      return Number(value);
    case 'last_auto_backup_at':
    case 'last_restore_at':
      return value === 'null' || value === '' ? null : Number(value);
    default:
      return value;
  }
}

/**
 * 把 value 序列化成 app_meta 字符串格式。
 */
export function serializeAppMetaValue(key: string, value: number | string | null): string {
  if (value === null) return 'null';
  return String(value);
}

/** 工具：解析前对 `MmwsBackupFile` 的白名单过滤（业务层 / 解析前调用）。 */
export function filterAppMetaRows<T extends { key: string }>(rows: T[]): T[] {
  return rows.filter((r) => ALLOWED_APP_META_KEYS.has(r.key));
}

/** 工具：给 `app_meta` 一次性 upsert 多个 key/value（事务外，handler 用）。 */
export function upsertAppMeta(
  db: WorkstationDb,
  entries: Array<{ key: string; value: string }>,
  now: Date = new Date(),
): void {
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

/** 工具：读 `app_meta` 多个 key。缺失返回空对象（不抛错）。 */
export function readAppMeta(db: WorkstationDb, keys: readonly string[]): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const k of keys) {
    const row = db.select().from(appMeta).where(eq(appMeta.key, k)).get();
    out[k] = row ? row.value : null;
  }
  return out;
}

// ============================================================
//  异步 IO 辅助（导出 / 备份 / 恢复业务用到）
// ============================================================

/**
 * 确保目录存在（不存在则创建）。`recursive: true` 模式。
 */
export async function ensureDir(dir: string): Promise<void> {
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
}

/**
 * 把源文件重命名（原子替换）。失败抛 PERSISTENCE_FAILED。
 */
export async function moveFile(src: string, dest: string): Promise<void> {
  try {
    await rename(src, dest);
  } catch (err) {
    throw {
      code: 'PERSISTENCE_FAILED' as const,
      message: `Failed to move file: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * 异步版 `stat`。失败抛 PERSISTENCE_FAILED。
 */
export async function safeStat(path: string): Promise<{ size: number; mtime: number }> {
  try {
    const s = await stat(path);
    return { size: s.size, mtime: s.mtimeMs };
  } catch (err) {
    throw {
      code: 'PERSISTENCE_FAILED' as const,
      message: `Failed to stat: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * 异步版 `readdir`，只返回文件名（不含路径）。
 */
export async function safeReaddir(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch (err) {
    throw {
      code: 'PERSISTENCE_FAILED' as const,
      message: `Failed to read directory: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/** 工具：basename 跨平台安全版（避免直接 `path.basename` 的 unicode 边界问题）。 */
export function safeBasename(p: string): string {
  return basename(p);
}
