/**
 * 应用更新（Updater）IPC 共享 Zod schemas（T5-3 安装与自动更新骨架）
 *
 * 暴露 2 个通道（命名遵循 PROJECT_IDENTITY.md §4.1，格式 `app:action`）：
 *   - `app:checkForUpdate`   (input: 无)    → `{ available: boolean, version?: string, message?: string }`
 *   - `app:downloadUpdate`   (input: 无)    → `{ ok: true, message: string }`（成功语义占位）
 *
 * **设计原则（T5-3 范围）**：
 *   - **不**接远端更新服务器（publish feed 由后续发布卡配置）
 *   - 通过环境变量 `MINIMAX_UPDATE_FEED_URL` 决定是否启用更新源
 *   - 主进程 handler 内部 try/catch 全包，错误转成统一 `{ code, message }` 形态
 *   - 响应**不**含绝对路径 / API Key / 用户名（PROJECT_IDENTITY.md §6.1 / §6.5）
 *
 * **错误码**：
 *   - `NOT_IMPLEMENTED`     更新源未配置（env 缺失 / 接远端未开启）—— T5-3 显式使用
 *   - `EXTERNAL_FAILURE`    `autoUpdater.checkForUpdates()` 抛错
 *   - `INTERNAL`            未分类
 *
 * **不**写入 `db` / **不**修改任何 schema / 迁移。**不**改 PROJECT_IDENTITY 的错误码枚举
 * （`NOT_IMPLEMENTED` 是新增，仅本卡 updater IPC 使用，不影响其他卡）。
 *
 * @see electron/main/ipc/updater.ts
 */

import { z } from 'zod';

// ============================================================
//  响应 data schema
// ============================================================

/**
 * `app:checkForUpdate` 成功响应 data schema。
 *
 * - `available`  是否发现新版本（骨架阶段固定 `false`）
 * - `version`    可选 —— 新版本号（远端接通后由 updater 事件填入）
 * - `message`    可选 —— 给 UI 展示的提示文本（"Update source not configured" / "Check in progress"）
 */
export const CheckForUpdateResponseDataSchema = z
  .object({
    available: z.boolean(),
    version: z.string().min(1).max(64).optional(),
    message: z.string().min(1).max(256).optional(),
  })
  .strict();

/**
 * `app:downloadUpdate` 成功响应 data schema（T5-3 骨架阶段基本不会触发）。
 */
export const DownloadUpdateResponseDataSchema = z
  .object({
    ok: z.literal(true),
    message: z.string().min(1).max(256),
  })
  .strict();

// ============================================================
//  入参 schema
// ============================================================

/**
 * `app:checkForUpdate` 入参 schema —— 无入参。
 * 仍用空对象 schema 保持 IPC 边界一致（`safeParse(undefined)` 也能通过）。
 */
export const CheckForUpdateInputSchema = z
  .object({})
  .strict();

/** `app:downloadUpdate` 入参 schema —— 无入参。 */
export const DownloadUpdateInputSchema = z
  .object({})
  .strict();

// ============================================================
//  类型导出
// ============================================================

export type CheckForUpdateResponseDataParsed = z.infer<typeof CheckForUpdateResponseDataSchema>;
export type DownloadUpdateResponseDataParsed = z.infer<typeof DownloadUpdateResponseDataSchema>;
export type CheckForUpdateInputParsed = z.infer<typeof CheckForUpdateInputSchema>;
export type DownloadUpdateInputParsed = z.infer<typeof DownloadUpdateInputSchema>;

/** `app:downloadUpdate` 失败响应 error 段 —— 沿用统一 IPC 错误结构。 */
export interface UpdaterIpcErrorPayload {
  code: 'NOT_IMPLEMENTED' | 'EXTERNAL_FAILURE' | 'INTERNAL';
  message: string;
}
