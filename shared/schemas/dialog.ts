/**
 * 系统文件对话框（Dialog）IPC 共享 Zod schemas（T5-2 设置页 / 通用 dialog 通道）
 *
 * 用途：
 *   - `dialog:showSaveDialog` 让用户选文件保存位置（T5-2 导出用）
 *   - `dialog:showOpenDialog` 让用户选文件打开位置（T5-2 恢复 / 导入用）
 *
 * **安全（PROJECT_IDENTITY.md §6.3）**：
 *   - 入参走 Zod 严格 `.strict()` 校验（拒绝额外字段）
 *   - 响应只回 `{ ok, data: { path | null } }` —— **不**回 `bookmark` 等额外元数据
 *     （避免跨端差异 / 路径隐私泄露）
 *   - 用户取消 → `path: null`（**不**报错，遵循 Electron 原生语义）
 *
 * **不做**：
 *   - 不在 schema 层做路径白名单（业务层 handler 负责安全路径校验）
 *
 * @see electron/main/ipc/dialog.ts
 */

import { z } from 'zod';

/**
 * 文件类型过滤器（与 Electron `Electron.FileDialogFilter` 字段对齐）。
 *
 * - `name`        用户在 dialog 下拉里看到的过滤名（必填，1..128 字符）
 * - `extensions`  扩展名列表（不含点，如 `['md', 'markdown']`）；1..32 个，每个 1..32 字符
 */
export const DialogFilterSchema = z
  .object({
    name: z.string().min(1).max(128),
    extensions: z.array(z.string().min(1).max(32)).min(1).max(32),
  })
  .strict();

/** Dialog filters 列表。1..16 个。 */
export const DialogFiltersSchema = z.array(DialogFilterSchema).min(1).max(16);

/**
 * `dialog:showSaveDialog` 入参 schema。
 *
 * 字段全 optional —— 最简用法是不传任何字段（让 Electron 走默认）。
 *
 * - `title`        dialog 标题（1..256 字符）
 * - `defaultPath`  默认保存路径（1..2048 字符）
 * - `filters`      文件类型过滤器
 */
export const ShowSaveDialogInputSchema = z
  .object({
    title: z.string().min(1).max(256).optional(),
    defaultPath: z.string().min(1).max(2048).optional(),
    filters: DialogFiltersSchema.optional(),
  })
  .strict();

/**
 * `dialog:showSaveDialog` 成功响应 data schema。
 *
 * - `path`  用户选定的绝对路径（用户取消时为 `null`）
 */
export const ShowSaveDialogResponseSchema = z.object({
  path: z.string().min(1).max(4096).nullable(),
});

/**
 * `dialog:showOpenDialog` 入参 schema。
 *
 * 字段全 optional：
 *
 * - `title`        dialog 标题
 * - `defaultPath`  默认打开路径
 * - `filters`      文件类型过滤器
 * - `properties`   Electron 数组，如 `['openFile', 'multiSelections']`；
 *                  **允许**值集合见下
 */
export const DialogPropertySchema = z.enum([
  'openFile',
  'openDirectory',
  'multiSelections',
  'showHiddenFiles',
  'createDirectory',
  'promptToCreate',
  'noResolveAliases',
  'treatPackageAsDirectory',
  'dontAddToRecent',
]);

export const ShowOpenDialogInputSchema = z
  .object({
    title: z.string().min(1).max(256).optional(),
    defaultPath: z.string().min(1).max(2048).optional(),
    filters: DialogFiltersSchema.optional(),
    properties: z.array(DialogPropertySchema).max(16).optional(),
  })
  .strict();

/**
 * `dialog:showOpenDialog` 成功响应 data schema。
 *
 * - `path`   单选时返回该路径（多选时**仍**返回第一个，作为单选 fallback）
 * - `paths`  多选时返回全部路径；单选时是 `[path]` 形式（**或**空数组如果用户取消）
 *
 * 业务层（handler）根据入参的 `properties` 决定填哪个字段。
 */
export const ShowOpenDialogResponseSchema = z.object({
  path: z.string().min(1).max(4096).nullable(),
  paths: z.array(z.string().min(1).max(4096)).max(4096),
});

/** 类型导出（z.infer 形式）。 */
export type DialogFilterParsed = z.infer<typeof DialogFilterSchema>;
export type DialogFiltersParsed = z.infer<typeof DialogFiltersSchema>;
export type ShowSaveDialogInputParsed = z.infer<typeof ShowSaveDialogInputSchema>;
export type ShowSaveDialogResponseParsed = z.infer<typeof ShowSaveDialogResponseSchema>;
export type ShowOpenDialogInputParsed = z.infer<typeof ShowOpenDialogInputSchema>;
export type ShowOpenDialogResponseParsed = z.infer<typeof ShowOpenDialogResponseSchema>;
