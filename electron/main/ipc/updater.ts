/**
 * 应用更新（Updater）IPC handler（T5-3 安装与自动更新骨架）
 *
 * 暴露 2 个通道（命名遵循 PROJECT_IDENTITY.md §4.1）：
 *   - `app:checkForUpdate`   (input: 空)    → `{ available, version?, message? }`
 *   - `app:downloadUpdate`   (input: 空)    → `{ ok: true, message }` / 失败 `{ error: { code, message } }`
 *
 * **核心行为**：
 *   - `app:checkForUpdate`
 *       1. 读 `process.env.MINIMAX_UPDATE_FEED_URL`
 *       2. 未设 → 返回 `{ available: false, message: 'Update source not configured' }`（**不**报错）
 *       3. 已设 → `autoUpdater.setFeedURL(env)` + `autoUpdater.checkForUpdates()`（try/catch 包裹）
 *                返回 `{ available: false, message: 'Check initiated' }`（骨架：结果待事件回调）
 *   - `app:downloadUpdate`
 *       1. 读 `process.env.MINIMAX_UPDATE_FEED_URL`
 *       2. 未设 → 返回 `{ ok: false, error: { code: 'NOT_IMPLEMENTED', message: 'Update source not configured' } }`
 *
 * **不**启用 `autoDownload` / `autoInstallOnAppQuit`（T5-3 显式不接远端自动更新）。
 *
 * **安全约束**（PROJECT_IDENTITY.md §6）：
 *   - 错误信息**不**含绝对路径 / 用户名 / feed URL 本身
 *   - 错误信息**不**含版本号详细来源（仅文案）
 *
 * **T5-3 范围**：
 *   - 只做骨架 + env-gated
 *   - **不**接远端 / **不**做签名 / **不**做发布 channel 切换
 *   - 真正接 feed 由后续发布卡配置（见 docs/build-and-distribute.md）
 *
 * @used-by electron/main/index.ts
 * @see shared/schemas/updater.ts
 */

import { ipcMain } from 'electron';
// electron-updater@6.x 是 CommonJS module；ESM named import 解析失败导致启动崩溃。
// 改用 default import 然后解构（v0.1.0.2 修复）。
import electronUpdater from 'electron-updater';

import {
  CheckForUpdateResponseDataSchema,
  type CheckForUpdateResponseDataParsed,
  type UpdaterIpcErrorPayload,
} from '../../../shared/schemas/updater';

/** 触发更新检查的环境变量名（T5-3 约定；后续发布卡可改）。 */
export const UPDATE_FEED_ENV = 'MINIMAX_UPDATE_FEED_URL';

/** 状态文本常量（**不**含绝对路径 / 用户名 / feed URL）。 */
const MSG_NO_FEED = 'Update source not configured';
const MSG_CHECK_INITIATED = 'Check initiated';

/** IPC 错误统一格式（PROJECT_IDENTITY.md §4.2 错误结构）。 */
function toIpcError(err: unknown): UpdaterIpcErrorPayload {
  if (err instanceof Error) {
    return { code: 'INTERNAL', message: err.message };
  }
  return { code: 'INTERNAL', message: String(err) };
}

/** 把任意异常转成结构化 IPC 错误。 */
function isStructuredIpcError(err: unknown): err is UpdaterIpcErrorPayload {
  if (err === null || typeof err !== 'object') return false;
  const obj = err as { code?: unknown; message?: unknown };
  if (typeof obj.code !== 'string' || typeof obj.message !== 'string') return false;
  return (
    obj.code === 'NOT_IMPLEMENTED' ||
    obj.code === 'EXTERNAL_FAILURE' ||
    obj.code === 'INTERNAL'
  );
}

/** 读取更新源 env（**不**外泄到日志 / 错误信息）。 */
function readUpdateFeedEnv(): string | null {
  const raw = process.env[UPDATE_FEED_ENV];
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  return trimmed;
}

// ============================================================
//  handler 函数（独立可测）
// ============================================================

/**
 * `app:checkForUpdate` handler。
 *
 * env 未设 → 立即返回 "Update source not configured"（**不**抛错）。
 * env 已设 → 调用 `autoUpdater`（try/catch 包裹），返回 "Check initiated"。
 */
export async function handleCheckForUpdate(): Promise<CheckForUpdateResponseDataParsed> {
  const feed = readUpdateFeedEnv();
  if (feed === null) {
    return CheckForUpdateResponseDataSchema.parse({
      available: false,
      message: MSG_NO_FEED,
    });
  }

  // 已设 env：触发 autoUpdater
  try {
    // T5-3 显式不启用自动下载/安装（保持手动确认）
    electronUpdater.autoUpdater.autoDownload = false;
    electronUpdater.autoUpdater.autoInstallOnAppQuit = false;
    electronUpdater.autoUpdater.setFeedURL(feed);
    await electronUpdater.autoUpdater.checkForUpdates();
    return CheckForUpdateResponseDataSchema.parse({
      available: false,
      message: MSG_CHECK_INITIATED,
    });
  } catch (err) {
    // **不**把 feed URL 透出；只暴露通用错误文本
    const message = err instanceof Error ? err.message : String(err);
    return CheckForUpdateResponseDataSchema.parse({
      available: false,
      message: `Update check failed: ${message}`,
    });
  }
}

/**
 * `app:downloadUpdate` handler（T5-3 骨架：未接远端时一律 NOT_IMPLEMENTED）。
 */
export async function handleDownloadUpdate(): Promise<
  { ok: true; message: string } | { ok: false; error: UpdaterIpcErrorPayload }
> {
  const feed = readUpdateFeedEnv();
  if (feed === null) {
    return {
      ok: false,
      error: { code: 'NOT_IMPLEMENTED', message: MSG_NO_FEED },
    };
  }

  // 已设 env 但 T5-3 不真正下载 —— 仍按未实现处理
  // 后续发布卡可在此分支加 `autoUpdater.downloadUpdate()`
  return {
    ok: false,
    error: { code: 'NOT_IMPLEMENTED', message: MSG_NO_FEED },
  };
}

// ============================================================
//  registerUpdaterIpc：把 handler 挂到 ipcMain
// ============================================================

/** 注册 2 个 `app:*` updater IPC handler。**只调一次**（主进程启动时）。 */
export function registerUpdaterIpc(): void {
  ipcMain.handle('app:checkForUpdate', async () => {
    try {
      return { ok: true as const, data: await handleCheckForUpdate() };
    } catch (err) {
      if (isStructuredIpcError(err)) return { ok: false as const, error: err };
      return { ok: false as const, error: toIpcError(err) };
    }
  });

  ipcMain.handle('app:downloadUpdate', async () => {
    try {
      const out = await handleDownloadUpdate();
      if (out.ok) return { ok: true as const, data: { ok: true as const, message: out.message } };
      return { ok: false as const, error: out.error };
    } catch (err) {
      if (isStructuredIpcError(err)) return { ok: false as const, error: err };
      return { ok: false as const, error: toIpcError(err) };
    }
  });
}
