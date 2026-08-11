/**
 * 系统文件对话框（Dialog）IPC handler（T5-2 设置页 / 通用 dialog 通道）
 *
 * 暴露 2 个通道（命名遵循 PROJECT_IDENTITY.md §4.1，格式 `namespace:action`）：
 *   - `dialog:showSaveDialog` (input: `{ title?, defaultPath?, filters? }`) → `{ path: string | null }`
 *   - `dialog:showOpenDialog` (input: `{ title?, defaultPath?, filters?, properties? }`) → `{ path: string | null, paths: string[] }`
 *
 * **全部遵循 PROJECT_IDENTITY.md §4 IPC 契约**：
 *   - 入口 Zod 校验（共享 schema 在 `shared/schemas/dialog.ts`）
 *   - try/catch 全包，错误统一转成 `{ code, message }`
 *   - 不返回原始异常对象
 *
 * **错误码**（PROJECT_IDENTITY.md §4.4）：
 *   - `VALIDATION_FAILED`  Zod 校验失败
 *   - `INTERNAL`           系统 dialog 抛错
 *
 * **行为**：
 *   - 调 `electron.dialog.showSaveDialog` / `showOpenDialog`（**异步** API）
 *   - 用户取消 → `path: null` / `paths: []`（**不**报错 —— 遵循 Electron 原生语义）
 *   - 多选 (`properties: ['multiSelections']`) 时 `paths` 返回全部，`path` 取第一个
 *
 * **范围**（T5-2）：
 *   - 仅做"用户选文件 / 选保存位置"两个最常用的 dialog
 *   - 不做 `showMessageBox` / `showErrorBox`（这些由 renderer 的 `alert` 替代）
 *   - 不做文件夹选择（合并到 `showOpenDialog` 的 `openDirectory` property）
 */

import { dialog, ipcMain } from 'electron';

import {
  ShowOpenDialogInputSchema,
  ShowOpenDialogResponseSchema,
  ShowSaveDialogInputSchema,
  ShowSaveDialogResponseSchema,
  type ShowOpenDialogResponseParsed,
  type ShowSaveDialogResponseParsed,
} from '../../../shared/schemas/dialog';

/** 依赖注入：本卡不需要 db，纯 dialog 通道。 */
export interface DialogIpcDeps {
  /** 当前聚焦窗口（用于让 dialog 居中显示）。测试可注入 undefined。 */
  getFocusedWindow?: () => Electron.BrowserWindow | null | undefined;
}

/** IPC 错误统一格式（PROJECT_IDENTITY.md §4.2）。 */
export interface IpcErrorPayload {
  code: 'VALIDATION_FAILED' | 'INTERNAL';
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
  return obj.code === 'VALIDATION_FAILED' || obj.code === 'INTERNAL';
}

/**
 * `dialog:showSaveDialog` handler。
 *
 * 入参字段全 optional —— 最简用法是 `await api.showSaveDialog({})`。
 *
 * 用户取消 → `{ path: null }`（**不**报错）。
 */
export async function handleShowSaveDialog(
  _deps: DialogIpcDeps,
  payload: unknown,
): Promise<ShowSaveDialogResponseParsed> {
  const parsed = ShowSaveDialogInputSchema.safeParse(payload ?? {});
  if (!parsed.success) {
    throw {
      code: 'VALIDATION_FAILED' as const,
      message: 'Invalid show save dialog input',
      details: parsed.error.flatten(),
    };
  }

  const input = parsed.data;
  const opts: Electron.SaveDialogOptions = {};
  if (input.title !== undefined) opts.title = input.title;
  if (input.defaultPath !== undefined) opts.defaultPath = input.defaultPath;
  if (input.filters !== undefined) opts.filters = input.filters;

  let result: Electron.SaveDialogReturnValue;
  try {
    const win = _deps.getFocusedWindow?.() ?? null;
    if (win !== null && win !== undefined) {
      result = await dialog.showSaveDialog(win, opts);
    } else {
      result = await dialog.showSaveDialog(opts);
    }
  } catch (err) {
    if (isStructuredIpcError(err)) throw err;
    throw toIpcError(err);
  }

  const response: ShowSaveDialogResponseParsed = {
    path: result.canceled ? null : result.filePath,
  };
  return ShowSaveDialogResponseSchema.parse(response);
}

/**
 * `dialog:showOpenDialog` handler。
 *
 * - `properties: ['multiSelections']` → `paths` 多个，`path` 取第一个
 * - `properties: ['openFile']`（默认） → `path` 单选，`paths = [path]`
 * - `properties: ['openDirectory']` → 选目录
 *
 * 用户取消 → `{ path: null, paths: [] }`（**不**报错）。
 */
export async function handleShowOpenDialog(
  _deps: DialogIpcDeps,
  payload: unknown,
): Promise<ShowOpenDialogResponseParsed> {
  const parsed = ShowOpenDialogInputSchema.safeParse(payload ?? {});
  if (!parsed.success) {
    throw {
      code: 'VALIDATION_FAILED' as const,
      message: 'Invalid show open dialog input',
      details: parsed.error.flatten(),
    };
  }

  const input = parsed.data;
  const opts: Electron.OpenDialogOptions = {};
  if (input.title !== undefined) opts.title = input.title;
  if (input.defaultPath !== undefined) opts.defaultPath = input.defaultPath;
  if (input.filters !== undefined) opts.filters = input.filters;
  if (input.properties !== undefined) opts.properties = input.properties;

  let result: Electron.OpenDialogReturnValue;
  try {
    const win = _deps.getFocusedWindow?.() ?? null;
    if (win !== null && win !== undefined) {
      result = await dialog.showOpenDialog(win, opts);
    } else {
      result = await dialog.showOpenDialog(opts);
    }
  } catch (err) {
    if (isStructuredIpcError(err)) throw err;
    throw toIpcError(err);
  }

  if (result.canceled || result.filePaths.length === 0) {
    return ShowOpenDialogResponseSchema.parse({ path: null, paths: [] });
  }
  const first = result.filePaths[0];
  return ShowOpenDialogResponseSchema.parse({
    path: first === undefined ? null : first,
    paths: result.filePaths,
  });
}

/**
 * 注册 2 个 `dialog:*` IPC handler。**只调一次**（主进程启动时）。
 */
export function registerDialogIpc(deps: DialogIpcDeps): void {
  ipcMain.handle('dialog:showSaveDialog', async (_evt, payload: unknown) => {
    try {
      return { ok: true as const, data: await handleShowSaveDialog(deps, payload) };
    } catch (err) {
      if (isStructuredIpcError(err)) return { ok: false as const, error: err };
      return { ok: false as const, error: toIpcError(err) };
    }
  });

  ipcMain.handle('dialog:showOpenDialog', async (_evt, payload: unknown) => {
    try {
      return { ok: true as const, data: await handleShowOpenDialog(deps, payload) };
    } catch (err) {
      if (isStructuredIpcError(err)) return { ok: false as const, error: err };
      return { ok: false as const, error: toIpcError(err) };
    }
  });
}
