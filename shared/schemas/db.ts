/**
 * 共享 Zod schemas（主进程 ↔ 渲染进程 IPC 契约）
 *
 * 用途：
 *   - 渲染端 preload 解析 IPC 响应时用（`safeParse`）
 *   - 共享层任何需要运行时校验的地方
 *
 * 主进程入口校验在 `electron/main/ipc/app.ts` 里直接 `safeParse`。
 * 这里只是**类型 + schema 共享**，方便 preload 解析。
 *
 * 命名（PROJECT_IDENTITY.md §3）：camelCase 变量，PascalCase 类型导出。
 */

import { z } from 'zod';

/** `app:getDbStatus` 成功响应 data schema。 */
export const DbStatusSchema = z.object({
  ready: z.boolean(),
  path: z.string().min(1),
  schemaVersion: z.number().int().nonnegative(),
});

/** `app:getDbStatus` 失败响应 error schema（沿用统一 IPC 错误结构）。 */
export const DbStatusErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
});

/** `app:getVersion` 成功响应 data schema —— 单纯一个字符串。 */
export const AppVersionSchema = z.string().min(1);

/** `app:getAppMeta` 入参 schema。 */
export const AppMetaKeySchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_.-]+$/, 'key must be alphanumeric, underscore, dash or dot');

/** `app:setAppMeta` 入参 schema。 */
export const AppMetaSetInputSchema = z.object({
  key: AppMetaKeySchema,
  value: z.string().max(65536, 'value must be <= 64KB'),
});

/** `app:getAppMeta` 成功响应 data schema。key 不存在时 value 为 null。 */
export const AppMetaValueSchema = z.object({
  key: AppMetaKeySchema,
  value: z.string().nullable(),
});

/** 类型导出。 */
export type DbStatusParsed = z.infer<typeof DbStatusSchema>;
export type AppMetaSetInput = z.infer<typeof AppMetaSetInputSchema>;
export type AppMetaValueParsed = z.infer<typeof AppMetaValueSchema>;
