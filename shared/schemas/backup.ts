/**
 * 备份 / 导出 / 恢复 / 重置 IPC 共享 Zod schemas（T5-2 设置页）
 *
 * `.mmws.json` 文件结构（导出 / 恢复共用）：
 *
 * ```ts
 * {
 *   meta: {
 *     formatVersion: 1,
 *     exportedAt: 1700000000000,
 *     appVersion: '0.1.0',
 *     schemaVersion: 6,
 *   },
 *   data: {
 *     projects:     [...],
 *     inbox_items:  [...],
 *     tasks:        [...],
 *     notes:        [...],
 *     reviews:      [...],
 *     ai_configs:   [...],
 *     app_meta:     [{ key, value, createdAt, updatedAt }, ...],
 *   },
 * }
 * ```
 *
 * **安全约束（PROJECT_IDENTITY.md §6）**：
 *   - 全部 `.strict()` —— 拒绝任何额外字段
 *   - `data.app_meta` 严格白名单：只允许 `schemaVersion` / `setupCompletedAt` /
 *     `auto_backup_interval_min` / `last_auto_backup_at` / `last_restore_at`
 *   - **不**含 `apiKey`（`aiConfigs` 表本身就不存 key —— CredentialManager 持有）
 *   - **不**含 userData / db 绝对路径（meta 仅含 `appVersion` 字符串 + `schemaVersion`）
 *   - **不**含 FTS5 虚表行（导出时跳过）
 *   - formatVersion **必须**等于 1（不兼容的格式走严格拒绝）
 *   - 单文件大小限制 50MB（在 handler 层做检查）
 *
 * @see electron/main/services/backupService.ts
 * @see electron/main/ipc/backup.ts
 */

import { z } from 'zod';

// ============================================================
//  业务表 row schemas（与 db schema 字段严格对齐）
// ============================================================

/** 单行 `projects` 导出 schema（导出时 Date → Unix ms，archived 0/1）。 */
const ProjectRowExportSchema = z
  .object({
    id: z.string().min(1).max(64),
    name: z.string().min(1).max(256),
    description: z.string().max(4096).nullable(),
    color: z.string().max(32).nullable(),
    archived: z.union([z.literal(0), z.literal(1)]),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
  })
  .strict();

/** 单行 `inbox_items` 导出 schema。 */
const InboxItemRowExportSchema = z
  .object({
    id: z.string().min(1).max(64),
    content: z.string().min(1).max(65536),
    kind: z.enum(['note', 'todo', 'file', 'link']),
    source: z.enum(['manual', 'ai', 'inbox']),
    status: z.enum(['active', 'archived', 'converted']),
    convertedTo: z.string().min(1).max(256).nullable(),
    projectId: z.string().min(1).max(64).nullable(),
    tags: z.array(z.string().min(1).max(64)).max(256),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
    deletedAt: z.number().int().nonnegative().nullable(),
  })
  .strict();

/** 单行 `tasks` 导出 schema。 */
const TaskRowExportSchema = z
  .object({
    id: z.string().min(1).max(64),
    title: z.string().min(1).max(512),
    description: z.string().max(65536).nullable(),
    status: z.enum(['todo', 'doing', 'done', 'archived']),
    priority: z.enum(['low', 'medium', 'high']),
    dueDate: z.number().int().nonnegative().nullable(),
    projectId: z.string().min(1).max(64).nullable(),
    tags: z.array(z.string().min(1).max(64)).max(256),
    source: z.enum(['manual', 'ai', 'inbox']),
    inboxId: z.string().min(1).max(64).nullable(),
    noteIds: z.array(z.string().min(1).max(64)).max(256),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
    completedAt: z.number().int().nonnegative().nullable(),
  })
  .strict();

/** 单行 `notes` 导出 schema。 */
const NoteRowExportSchema = z
  .object({
    id: z.string().min(1).max(64),
    title: z.string().min(1).max(512),
    content: z.string().max(1_048_576),
    tags: z.array(z.string().min(1).max(64)).max(256),
    linkedTaskIds: z.array(z.string().min(1).max(64)).max(256),
    projectId: z.string().min(1).max(64).nullable(),
    source: z.enum(['manual', 'ai', 'inbox']),
    archived: z.union([z.literal(0), z.literal(1)]),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
  })
  .strict();

/** 单行 `reviews` 导出 schema。 */
const ReviewItemExportSchema = z
  .object({
    taskId: z.string().max(64),
    title: z.string().min(1).max(512),
    reason: z.string().max(1024).optional(),
  })
  .strict();

const ReviewDraftExportSchema = z
  .object({
    completed: z.array(z.string().min(1).max(512)).max(256),
    uncompleted: z
      .array(
        z
          .object({
            title: z.string().min(1).max(512),
            reason: z.string().max(1024).optional(),
          })
          .strict(),
      )
      .max(256),
    blockers: z.string().max(4096),
    topThree: z.array(z.string().min(1).max(256)).max(16),
  })
  .strict();

const ReviewRowExportSchema = z
  .object({
    id: z.string().min(1).max(64),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
    completed: z.array(ReviewItemExportSchema).max(256),
    uncompleted: z.array(ReviewItemExportSchema).max(256),
    blockers: z.string().max(4096),
    topThree: z.array(z.string().min(1).max(256)).max(16),
    aiDraft: ReviewDraftExportSchema.nullable(),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
  })
  .strict();

/** 单行 `ai_configs` 导出 schema（**严格不**含 apiKey 字段）。 */
const AiConfigRowExportSchema = z
  .object({
    provider: z.string().min(1).max(64),
    model: z.string().min(1).max(128),
    baseURL: z.string().min(1).max(1024),
    updatedAt: z.number().int().nonnegative(),
  })
  .strict();

/**
 * 单行 `app_meta` 导出 schema。
 *
 * `key` 严格白名单 —— 只允许这 5 个 key 出现在备份里：
 *   - `schemaVersion`         schema 迁移版本
 *   - `setupCompletedAt`      首次启动时间
 *   - `auto_backup_interval_min`  T5-2 自动备份间隔
 *   - `last_auto_backup_at`   T5-2 上次自动备份时间
 *   - `last_restore_at`       T5-2 上次恢复时间
 *
 * 任何其他 key → Zod 拒绝（防止备份文件带敏感信息 / 未知状态）。
 */
export const APP_META_KEYS = [
  'schemaVersion',
  'setupCompletedAt',
  'auto_backup_interval_min',
  'last_auto_backup_at',
  'last_restore_at',
] as const;

const AppMetaRowExportSchema = z
  .object({
    key: z.enum(APP_META_KEYS),
    value: z.string().min(0).max(65536),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
  })
  .strict();

// ============================================================
//  MmwsBackupFile —— 整个 .mmws.json 文件结构
// ============================================================

/** 备份文件 meta 段。 */
export const BackupMetaSchema = z
  .object({
    /** 格式版本（**必须**等于 1）。 */
    formatVersion: z.literal(1),
    /** 导出时间（Unix ms）。 */
    exportedAt: z.number().int().positive(),
    /** 应用版本（来自 package.json，1..64 字符）。 */
    appVersion: z.string().min(1).max(64),
    /** db schema 版本（来自 `__drizzle_migrations` 行数）。 */
    schemaVersion: z.number().int().min(0).max(1000),
  })
  .strict();

/** 备份文件 data 段 —— 全部业务表 + app_meta。 */
export const BackupDataSchema = z
  .object({
    projects: z.array(ProjectRowExportSchema).max(10_000),
    inbox_items: z.array(InboxItemRowExportSchema).max(100_000),
    tasks: z.array(TaskRowExportSchema).max(100_000),
    notes: z.array(NoteRowExportSchema).max(100_000),
    reviews: z.array(ReviewRowExportSchema).max(10_000),
    ai_configs: z.array(AiConfigRowExportSchema).max(64),
    app_meta: z.array(AppMetaRowExportSchema).max(64),
  })
  .strict();

/** 整个 .mmws.json 文件 schema。 */
export const MmwsBackupFileSchema = z
  .object({
    meta: BackupMetaSchema,
    data: BackupDataSchema,
  })
  .strict();

// ============================================================
//  IPC 入参 / 响应 schemas
// ============================================================

/** 备份文件信息（`app:listBackups` 返回的列表元素）。 */
export const BackupInfoSchema = z
  .object({
    filename: z.string().min(1).max(256),
    path: z.string().min(1).max(4096),
    size: z.number().int().nonnegative(),
    createdAt: z.number().int().positive(),
  })
  .strict();

/** `app:listBackups` 成功响应 data schema。 */
export const ListBackupsResponseSchema = z.array(BackupInfoSchema).max(10_000);

/**
 * `app:backupNow` 入参 schema。
 *
 * - `destPath`  可选 —— 自定义目标绝对路径；省略时主进程落到
 *               `<userData>/backups/auto-YYYYMMDD-HHmmss.mmws.json`
 */
export const BackupNowInputSchema = z
  .object({
    destPath: z.string().min(1).max(4096).optional(),
  })
  .strict();

/** `app:backupNow` 成功响应 data schema。 */
export const BackupNowResponseSchema = z
  .object({
    path: z.string().min(1).max(4096),
    size: z.number().int().nonnegative(),
    createdAt: z.number().int().positive(),
  })
  .strict();

/** `app:exportData` 入参 schema（**必须**用户选路径）。 */
export const ExportDataInputSchema = z
  .object({
    destPath: z.string().min(1).max(4096),
  })
  .strict();

/** `app:exportData` 成功响应 data schema。 */
export const ExportDataResponseSchema = BackupNowResponseSchema;

/**
 * `app:restoreBackup` 入参 schema。
 *
 * `confirm` **必须**大写字符串 `RESTORE`（二次确认机制）—— 业务层
 * 校验，不是 Zod 校验（避免拼写错误时给出"应该是什么"的提示）。
 */
export const RestoreBackupInputSchema = z
  .object({
    path: z.string().min(1).max(4096),
    confirm: z.literal('RESTORE'),
  })
  .strict();

/** `app:restoreBackup` 成功响应 data schema。 */
export const RestoreBackupResponseSchema = z
  .object({
    ok: z.literal(true),
    restartRequired: z.literal(true),
  })
  .strict();

/** `app:importData` 入参 schema（与 restore 同义 —— 从外部 .mmws.json 恢复）。 */
export const ImportDataInputSchema = RestoreBackupInputSchema;

/** `app:importData` 成功响应 data schema。 */
export const ImportDataResponseSchema = RestoreBackupResponseSchema;

/** `app:deleteBackup` 入参 schema（**不**需要二次确认 —— 只是删备份文件）。 */
export const DeleteBackupInputSchema = z
  .object({
    path: z.string().min(1).max(4096),
  })
  .strict();

/** `app:deleteBackup` 成功响应 data schema。 */
export const DeleteBackupResponseSchema = z
  .object({
    deleted: z.literal(true),
  })
  .strict();

/**
 * `app:resetData` 入参 schema。
 *
 * `confirm` **必须**大写字符串 `RESET`（二次确认机制）。
 */
export const ResetDataInputSchema = z
  .object({
    confirm: z.literal('RESET'),
  })
  .strict();

/** `app:resetData` 成功响应 data schema。 */
export const ResetDataResponseSchema = z
  .object({
    ok: z.literal(true),
    restartRequired: z.literal(true),
  })
  .strict();

/**
 * `app:getPaths` 成功响应 data schema。
 *
 * 三个绝对路径（userData / db / backups）。**注意**：渲染端拿到这些路径
 * 后**只**回显目录名（basename）给用户看，**不**显示完整路径以防用户名泄露。
 */
export const GetPathsResponseSchema = z
  .object({
    userData: z.string().min(1).max(4096),
    db: z.string().min(1).max(4096),
    backups: z.string().min(1).max(4096),
  })
  .strict();

// ============================================================
//  类型导出
// ============================================================

export type ProjectRowExportParsed = z.infer<typeof ProjectRowExportSchema>;
export type InboxItemRowExportParsed = z.infer<typeof InboxItemRowExportSchema>;
export type TaskRowExportParsed = z.infer<typeof TaskRowExportSchema>;
export type NoteRowExportParsed = z.infer<typeof NoteRowExportSchema>;
export type ReviewRowExportParsed = z.infer<typeof ReviewRowExportSchema>;
export type AiConfigRowExportParsed = z.infer<typeof AiConfigRowExportSchema>;
export type AppMetaRowExportParsed = z.infer<typeof AppMetaRowExportSchema>;
export type BackupMetaParsed = z.infer<typeof BackupMetaSchema>;
export type BackupDataParsed = z.infer<typeof BackupDataSchema>;
export type MmwsBackupFileParsed = z.infer<typeof MmwsBackupFileSchema>;
export type BackupInfoParsed = z.infer<typeof BackupInfoSchema>;
export type BackupNowInputParsed = z.infer<typeof BackupNowInputSchema>;
export type BackupNowResponseParsed = z.infer<typeof BackupNowResponseSchema>;
export type ExportDataInputParsed = z.infer<typeof ExportDataInputSchema>;
export type ExportDataResponseParsed = z.infer<typeof ExportDataResponseSchema>;
export type RestoreBackupInputParsed = z.infer<typeof RestoreBackupInputSchema>;
export type RestoreBackupResponseParsed = z.infer<typeof RestoreBackupResponseSchema>;
export type ImportDataInputParsed = z.infer<typeof ImportDataInputSchema>;
export type ImportDataResponseParsed = z.infer<typeof ImportDataResponseSchema>;
export type DeleteBackupInputParsed = z.infer<typeof DeleteBackupInputSchema>;
export type DeleteBackupResponseParsed = z.infer<typeof DeleteBackupResponseSchema>;
export type ResetDataInputParsed = z.infer<typeof ResetDataInputSchema>;
export type ResetDataResponseParsed = z.infer<typeof ResetDataResponseSchema>;
export type GetPathsResponseParsed = z.infer<typeof GetPathsResponseSchema>;
export type ListBackupsResponseParsed = z.infer<typeof ListBackupsResponseSchema>;
