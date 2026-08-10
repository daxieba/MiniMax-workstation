/**
 * 应用设置（App Settings）IPC 共享 Zod schemas（T5-2 设置页）
 *
 * **不**新建 settings 表 —— 复用 `app_meta`（T1-3）key/value 存储：
 *   - `auto_backup_interval_min`  整数字符串（'0' / '30' / '60' / '120'）
 *   - `last_auto_backup_at`       整数字符串（Unix 毫秒）或 'null'
 *   - `last_restore_at`           整数字符串（Unix 毫秒）或 'null'
 *
 * 业务层（handler / store）负责把 `app_meta.value` 字符串解析 / 序列化。
 * schema 层只关心 IPC 边界的 `{ ok, data }` 形状。
 *
 * @see electron/main/ipc/appSettings.ts
 * @see shared/schemas/db.ts (AppMetaValueSchema)
 */

import { z } from 'zod';

/** 自动备份间隔（分钟）的合法值集合。0 = 关闭自动备份。 */
export const AutoBackupIntervalSchema = z.union([z.literal(0), z.literal(30), z.literal(60), z.literal(120)]);

/**
 * 应用设置（T5-2）：
 *
 * - `autoBackupIntervalMin`  0 / 30 / 60 / 120（0 = 关闭）
 * - `lastAutoBackupAt`       最近一次自动备份时间（Unix ms，null = 从未）
 * - `lastRestoreAt`          最近一次恢复时间（Unix ms，null = 从未）
 */
export const SettingsSchema = z
  .object({
    autoBackupIntervalMin: AutoBackupIntervalSchema,
    lastAutoBackupAt: z.number().int().nonnegative().nullable(),
    lastRestoreAt: z.number().int().nonnegative().nullable(),
  })
  .strict();

/** `app:setSettings` 入参 schema —— 任意字段可缺省（patch 语义）。 */
export const SetSettingsInputSchema = z
  .object({
    autoBackupIntervalMin: AutoBackupIntervalSchema.optional(),
    lastAutoBackupAt: z.number().int().nonnegative().nullable().optional(),
    lastRestoreAt: z.number().int().nonnegative().nullable().optional(),
  })
  .strict();

/** `app:getSettings` 成功响应 data schema。 */
export const GetSettingsResponseSchema = SettingsSchema;

/** `app:setSettings` 成功响应 data schema（返回合并后的最新 settings）。 */
export const SetSettingsResponseSchema = SettingsSchema;

/**
 * `app:maybeAutoBackup` 成功响应 data schema。
 *
 * - `triggered`  本次是否触发了自动备份
 * - `path`       触发时返回新备份路径（未触发时**不**出现）
 */
export const MaybeAutoBackupResponseSchema = z
  .object({
    triggered: z.boolean(),
    path: z.string().min(1).max(4096).optional(),
  })
  .strict();

/** 类型导出。 */
export type AutoBackupIntervalParsed = z.infer<typeof AutoBackupIntervalSchema>;
export type SettingsParsed = z.infer<typeof SettingsSchema>;
export type SetSettingsInputParsed = z.infer<typeof SetSettingsInputSchema>;
export type MaybeAutoBackupResponseParsed = z.infer<typeof MaybeAutoBackupResponseSchema>;
