/**
 * 应用设置 Zustand store（T5-2 设置页）
 *
 * **职责**：
 *   - 缓存当前 settings（`autoBackupIntervalMin` / `lastAutoBackupAt` / `lastRestoreAt`）
 *   - 暴露 `load()` / `update(patch)` / `maybeAutoBackup()` 三个 action
 *   - 调 `window.api.settings.*`（getSettings / setSettings / maybeAutoBackup）
 *   - 成功 / 失败都用 `toast` 提示
 *
 * **数据流**：
 *   UI → store action → window.api.settings → 主进程 handler → 回到 store
 *
 * **不做**：
 *   - 不直接 import `db` / `better-sqlite3` / `drizzle`（PROJECT_IDENTITY.md §2.2）
 *   - 不做备份列表 / 恢复流程 —— 留给 `backupStore`
 *   - 不引入新依赖
 *
 * **类型来源**：
 *   - `Settings` 来自 `@shared/schemas/appSettings.ts` 的 Zod 推断
 *
 * @see electron/main/ipc/appSettings.ts
 * @see shared/schemas/appSettings.ts
 */

import { create } from 'zustand';

import type {
  AutoBackupIntervalParsed,
  SettingsParsed,
} from '@shared/schemas/appSettings';

import { toast } from './toastStore';

/** `window.api.settings` 形状（避免 renderer 直接依赖 electron 导入）。 */
interface ApiSettingsShape {
  getSettings(): Promise<
    { ok: true; data: SettingsParsed } | { ok: false; error: { code: string; message: string } }
  >;
  setSettings(input: {
    autoBackupIntervalMin?: AutoBackupIntervalParsed;
    lastAutoBackupAt?: number | null;
    lastRestoreAt?: number | null;
  }): Promise<
    { ok: true; data: SettingsParsed } | { ok: false; error: { code: string; message: string } }
  >;
  maybeAutoBackup(): Promise<
    | { ok: true; data: { triggered: boolean; path?: string } }
    | { ok: false; error: { code: string; message: string } }
  >;
}

interface WindowWithApi {
  api?: {
    settings?: ApiSettingsShape;
  };
}

/** 安全取 window.api.settings（避免 SSR / 测试环境 undefined）。 */
function getSettingsApi(): ApiSettingsShape | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as WindowWithApi;
  return w.api?.settings ?? null;
}

/** 默认 settings（与主进程 handler 兜底一致）。 */
const DEFAULT_SETTINGS: SettingsParsed = {
  autoBackupIntervalMin: 30,
  lastAutoBackupAt: null,
  lastRestoreAt: null,
};

/** 把 IPC `{ok, error}` 形态的失败转成抛错 + toast 提示。 */
function unwrapOrToast<T>(
  result: { ok: true; data: T } | { ok: false; error: { code: string; message: string } },
  errorPrefix: string,
): T {
  if (result.ok) return result.data;
  toast.error(`${errorPrefix}（${result.error.code}）：${result.error.message}`);
  throw new Error(`${errorPrefix}: ${result.error.code} ${result.error.message}`);
}

/** store 形状。 */
export interface SettingsState {
  /** 当前 settings。 */
  settings: SettingsParsed;
  /** 加载中。 */
  loading: boolean;
  /** 最近一次错误信息。 */
  error: string | null;
  /** 拉取一次。 */
  load: () => Promise<void>;
  /** 部分字段更新。 */
  update: (
    patch: Partial<{
      autoBackupIntervalMin: AutoBackupIntervalParsed;
      lastAutoBackupAt: number | null;
      lastRestoreAt: number | null;
    }>,
  ) => Promise<SettingsParsed | null>;
  /** 尝试触发自动备份（返回 `triggered` 让 UI 可选 toast）。 */
  maybeAutoBackup: () => Promise<boolean>;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  loading: false,
  error: null,

  async load(): Promise<void> {
    const api = getSettingsApi();
    if (!api) {
      // 测试 / 非 Electron 环境：保持默认
      set({ settings: DEFAULT_SETTINGS, loading: false, error: null });
      return;
    }
    set({ loading: true, error: null });
    try {
      const result = await api.getSettings();
      const data = unwrapOrToast(result, '加载设置失败');
      set({ settings: data, loading: false, error: null });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      set({ loading: false, error: message });
    }
  },

  async update(patch): Promise<SettingsParsed | null> {
    const api = getSettingsApi();
    if (!api) return null;
    set({ loading: true, error: null });
    try {
      const result = await api.setSettings(patch);
      const next = unwrapOrToast(result, '保存设置失败');
      set({ settings: next, loading: false, error: null });
      toast.success('设置已保存');
      return next;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      set({ loading: false, error: message });
      return null;
    }
  },

  async maybeAutoBackup(): Promise<boolean> {
    const api = getSettingsApi();
    if (!api) return false;
    try {
      const result = await api.maybeAutoBackup();
      if (!result.ok) {
        // 静默失败 —— 不打断 UI（用户**没**主动触发）
        return false;
      }
      if (result.data.triggered) {
        toast.success('已自动备份');
        // 触发后刷新一次（更新 lastAutoBackupAt）
        await get().load();
        return true;
      }
      return false;
    } catch {
      return false;
    }
  },
}));

/** 工具：暴露 `SettingsParsed` 给外部使用。 */
export type { SettingsParsed, AutoBackupIntervalParsed } from '@shared/schemas/appSettings';
