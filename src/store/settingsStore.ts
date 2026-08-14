/**
 * 应用设置 Zustand store（T5-2 设置页 + v0.4.0 5 个新偏好）
 *
 * **职责**：
 *   - 缓存当前 settings（备份 3 字段 + v0.4.0 新增 5 个偏好）
 *   - 暴露 `load()` / `update(patch)` / `maybeAutoBackup()` 三个 action
 *   - 调 `window.api.settings.*`（getSettings / setSettings / maybeAutoBackup）
 *   - v0.4.0 新增的 5 个偏好走 `app:setAppMeta` / `app:getAppMeta` 持久化
 *     （不复用主进程 settings IPC —— 那是给备份相关的"业务"字段用的）
 *   - 成功 / 失败都用 `toast` 提示
 *
 * **数据流**：
 *   UI → store action → window.api.app.* → 主进程 handler → 回到 store
 *
 * **不做**：
 *   - 不直接 import `db` / `better-sqlite3` / `drizzle`（PROJECT_IDENTITY.md §2.2）
 *   - 不做备份列表 / 恢复流程 —— 留给 `backupStore`
 *   - 不引入新依赖
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

/** `window.api.app` 形状（settings + getAppMeta + setAppMeta + getVersion）。 */
interface ApiAppShape {
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
  getAppMeta(
    key: string,
  ): Promise<
    | { ok: true; data: { key: string; value: string | null } }
    | { ok: false; error: { code: string; message: string } }
  >;
  setAppMeta(
    key: string,
    value: string,
  ): Promise<
    | { ok: true; data: { key: string; value: string | null } }
    | { ok: false; error: { code: string; message: string } }
  >;
}

interface WindowWithApi {
  api?: {
    app?: ApiAppShape;
  };
}

/** 安全取 window.api.app。 */
function getAppApi(): ApiAppShape | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as WindowWithApi;
  return w.api?.app ?? null;
}

/** 默认 settings（与主进程 handler 兜底一致）。 */
const DEFAULT_SETTINGS: SettingsParsed = {
  autoBackupIntervalMin: 30,
  lastAutoBackupAt: null,
  lastRestoreAt: null,
};

// =============================================================
//  v0.4.0: 5 个新偏好（用 app_meta key/value 持久化）
// =============================================================

/** 关闭按钮行为。 */
export type CloseAction = 'minimize' | 'quit';
/** 数据导出默认格式。 */
export type ExportFormat = 'json' | 'csv' | 'markdown';
/** 周起始日。 */
export type WeekStart = 'monday' | 'sunday';
/** v0.4.0: 新建任务默认优先级。 */
export type DefaultTaskPriority = 'low' | 'medium' | 'high';
/** v0.4.0: 新建任务默认状态。 */
export type DefaultTaskStatus = 'todo' | 'doing';

export interface UserPrefs {
  // 通知偏好
  notifyTaskOverdue: boolean;
  notifyTaskOverdueLeadMin: number;
  notifyPomodoroComplete: boolean;
  // 启动行为
  openOnBoot: boolean;
  restoreLastPage: boolean;
  // 番茄偏好
  pomodoroAutoStartBreak: boolean;
  pomodoroAutoStartFocus: boolean;
  pomodoroSoundOn: boolean;
  // 关闭行为
  closeAction: CloseAction;
  // 数据导出
  exportFormat: ExportFormat;
  // 周起始
  weekStart: WeekStart;
  // v0.4.0: 任务默认
  defaultTaskPriority: DefaultTaskPriority;
  defaultTaskStatus: DefaultTaskStatus;
  defaultDueOffsetDays: number;
}

const DEFAULT_USER_PREFS: UserPrefs = {
  notifyTaskOverdue: true,
  notifyTaskOverdueLeadMin: 0,
  notifyPomodoroComplete: true,
  openOnBoot: false,
  restoreLastPage: true,
  pomodoroAutoStartBreak: false,
  pomodoroAutoStartFocus: false,
  pomodoroSoundOn: true,
  closeAction: 'minimize',
  exportFormat: 'json',
  weekStart: 'monday',
  // v0.4.0
  defaultTaskPriority: 'medium',
  defaultTaskStatus: 'todo',
  defaultDueOffsetDays: 0,
};

/** 5+3 套新偏好的 app_meta key。 */
const PREFS_META_KEYS = {
  notifyTaskOverdue: 'prefs.notify.taskOverdue',
  notifyTaskOverdueLeadMin: 'prefs.notify.taskOverdueLeadMin',
  notifyPomodoroComplete: 'prefs.notify.pomodoroComplete',
  openOnBoot: 'prefs.startup.openOnBoot',
  restoreLastPage: 'prefs.startup.restoreLastPage',
  pomodoroAutoStartBreak: 'prefs.pomodoro.autoStartBreak',
  pomodoroAutoStartFocus: 'prefs.pomodoro.autoStartFocus',
  pomodoroSoundOn: 'prefs.pomodoro.soundOn',
  closeAction: 'prefs.close.action',
  exportFormat: 'prefs.export.format',
  weekStart: 'prefs.week.start',
  // v0.4.0
  defaultTaskPriority: 'prefs.task.defaultPriority',
  defaultTaskStatus: 'prefs.task.defaultStatus',
  defaultDueOffsetDays: 'prefs.task.dueOffsetDays',
} as const;

function parseBool(v: string | null, def: boolean): boolean {
  if (v === null) return def;
  return v === 'true' || v === '1';
}

function parseInt(v: string | null, def: number, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  if (v === null) return def;
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  if (n < min) return min;
  if (n > max) return max;
  return Math.round(n);
}

function parseEnum<T extends string>(v: string | null, def: T, allowed: readonly T[]): T {
  if (v === null) return def;
  return (allowed as readonly string[]).includes(v) ? (v as T) : def;
}

/** 把 IPC `{ok, error}` 形态的失败转成抛错 + toast 提示。 */
function unwrapOrToast<T>(
  result: { ok: true; data: T } | { ok: false; error: { code: string; message: string } },
  errorPrefix: string,
): T {
  if (result.ok) return result.data;
  toast.error(`${errorPrefix}（${result.error.code}）：${result.error.message}`);
  throw new Error(`${errorPrefix}: ${result.error.code} ${result.error.message}`);
}

/** 解析 prefs：把 11 个 app_meta value 解析成 UserPrefs 对象。 */
function parsePrefs(
  values: Partial<Record<keyof typeof PREFS_META_KEYS, string | null>>,
): UserPrefs {
  return {
    notifyTaskOverdue: parseBool(values.notifyTaskOverdue ?? null, DEFAULT_USER_PREFS.notifyTaskOverdue),
    notifyTaskOverdueLeadMin: parseInt(
      values.notifyTaskOverdueLeadMin ?? null,
      DEFAULT_USER_PREFS.notifyTaskOverdueLeadMin,
      0,
      60,
    ),
    notifyPomodoroComplete: parseBool(
      values.notifyPomodoroComplete ?? null,
      DEFAULT_USER_PREFS.notifyPomodoroComplete,
    ),
    openOnBoot: parseBool(values.openOnBoot ?? null, DEFAULT_USER_PREFS.openOnBoot),
    restoreLastPage: parseBool(values.restoreLastPage ?? null, DEFAULT_USER_PREFS.restoreLastPage),
    pomodoroAutoStartBreak: parseBool(
      values.pomodoroAutoStartBreak ?? null,
      DEFAULT_USER_PREFS.pomodoroAutoStartBreak,
    ),
    pomodoroAutoStartFocus: parseBool(
      values.pomodoroAutoStartFocus ?? null,
      DEFAULT_USER_PREFS.pomodoroAutoStartFocus,
    ),
    pomodoroSoundOn: parseBool(values.pomodoroSoundOn ?? null, DEFAULT_USER_PREFS.pomodoroSoundOn),
    closeAction: parseEnum(values.closeAction ?? null, DEFAULT_USER_PREFS.closeAction, [
      'minimize',
      'quit',
    ] as const),
    exportFormat: parseEnum(values.exportFormat ?? null, DEFAULT_USER_PREFS.exportFormat, [
      'json',
      'csv',
      'markdown',
    ] as const),
    weekStart: parseEnum(values.weekStart ?? null, DEFAULT_USER_PREFS.weekStart, [
      'monday',
      'sunday',
    ] as const),
    // v0.4.0: 任务默认
    defaultTaskPriority: parseEnum(
      values.defaultTaskPriority ?? null,
      DEFAULT_USER_PREFS.defaultTaskPriority,
      ['low', 'medium', 'high'] as const,
    ),
    defaultTaskStatus: parseEnum(
      values.defaultTaskStatus ?? null,
      DEFAULT_USER_PREFS.defaultTaskStatus,
      ['todo', 'doing'] as const,
    ),
    defaultDueOffsetDays: parseInt(
      values.defaultDueOffsetDays ?? null,
      DEFAULT_USER_PREFS.defaultDueOffsetDays,
      0,
      30,
    ),
  };
}

/** store 形状。 */
export interface SettingsState {
  /** 当前 settings（备份相关）。 */
  settings: SettingsParsed;
  /** v0.4.0: 用户偏好（5 套新选项）。 */
  prefs: UserPrefs;
  /** 加载中。 */
  loading: boolean;
  /** 最近一次错误信息。 */
  error: string | null;
  /** 拉取一次。 */
  load: () => Promise<void>;
  /** 部分字段更新（settings 字段）。 */
  update: (
    patch: Partial<{
      autoBackupIntervalMin: AutoBackupIntervalParsed;
      lastAutoBackupAt: number | null;
      lastRestoreAt: number | null;
    }>,
  ) => Promise<SettingsParsed | null>;
  /** v0.4.0: 更新单个 pref 字段。 */
  updatePref: <K extends keyof UserPrefs>(key: K, value: UserPrefs[K]) => Promise<void>;
  /** 尝试触发自动备份（返回 `triggered` 让 UI 可选 toast）。 */
  maybeAutoBackup: () => Promise<boolean>;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  prefs: DEFAULT_USER_PREFS,
  loading: false,
  error: null,

  async load(): Promise<void> {
    const api = getAppApi();
    if (!api) {
      set({ settings: DEFAULT_SETTINGS, prefs: DEFAULT_USER_PREFS, loading: false, error: null });
      return;
    }
    set({ loading: true, error: null });
    try {
      const [settingsRes, ...prefsRes] = await Promise.all([
        api.getSettings(),
        ...Object.values(PREFS_META_KEYS).map((k) => api.getAppMeta(k)),
      ]);
      const settingsData = unwrapOrToast(settingsRes, '加载设置失败');
      // prefsRes 按 PREFS_META_KEYS 顺序
      const prefMap: Partial<Record<keyof typeof PREFS_META_KEYS, string | null>> = {};
      const keys = Object.keys(PREFS_META_KEYS) as Array<keyof typeof PREFS_META_KEYS>;
      keys.forEach((k, i) => {
        const r = prefsRes[i];
        if (r && r.ok) prefMap[k] = r.data.value;
      });
      set({
        settings: settingsData,
        prefs: parsePrefs(prefMap),
        loading: false,
        error: null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      set({ loading: false, error: message });
    }
  },

  async update(patch): Promise<SettingsParsed | null> {
    const api = getAppApi();
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

  async updatePref<K extends keyof UserPrefs>(key: K, value: UserPrefs[K]): Promise<void> {
    // v0.4.0: 数值字段在写入前先 sanitize（clamp 到合法区间），避免 UI 选了一个
    // 越界值后 store / IPC / 渲染端数据不一致。
    let sanitized: UserPrefs[K] = value;
    if (typeof value === 'number') {
      if (key === 'defaultDueOffsetDays') {
        sanitized = Math.max(0, Math.min(30, Math.round(value))) as UserPrefs[K];
      } else if (key === 'notifyTaskOverdueLeadMin') {
        sanitized = Math.max(0, Math.min(60, Math.round(value))) as UserPrefs[K];
      }
    }
    const api = getAppApi();
    if (!api) {
      // 测试 / 非 Electron 环境：本地更新
      set({ prefs: { ...get().prefs, [key]: sanitized } });
      return;
    }
    try {
      const stringValue = String(sanitized);
      const result = await api.setAppMeta(PREFS_META_KEYS[key], stringValue);
      unwrapOrToast(result, '保存偏好失败');
      set({ prefs: { ...get().prefs, [key]: sanitized } });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(`保存失败：${message}`);
    }
  },

  async maybeAutoBackup(): Promise<boolean> {
    const api = getAppApi();
    if (!api) return false;
    try {
      const result = await api.maybeAutoBackup();
      if (!result.ok) {
        return false;
      }
      if (result.data.triggered) {
        toast.success('已自动备份');
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
