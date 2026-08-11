/**
 * 备份 Zustand store（T5-2 设置页）
 *
 * **职责**：
 *   - 缓存备份文件列表（`backups`） + 路径信息（`paths`） + 最近一次动作
 *   - 暴露 7 个 action：loadBackups / backupNow / exportData / importData /
 *     restoreBackup / deleteBackup / resetData
 *   - 调 `window.api.app.*`（getPaths / listBackups / backupNow / exportData /
 *     restoreBackup / importData / deleteBackup / resetData）
 *   - 成功 → `toast.success`；失败 → `toast.error`
 *   - restore/reset 成功后 `toast.info`（或 success）提示"请重启应用"
 *
 * **数据流**：
 *   UI → store action → window.api.app → 主进程 handler → 回到 store
 *
 * **不做**：
 *   - 不直接 import `db` / `better-sqlite3` / `drizzle`（PROJECT_IDENTITY.md §2.2）
 *   - 不做 settings / note / kb / review / search store（留给对应卡）
 *   - 不引入新依赖
 *
 * @see electron/main/ipc/backup.ts
 * @see shared/schemas/backup.ts
 */

import { create } from 'zustand';

import type {
  BackupInfoParsed,
  BackupNowResponseParsed,
  DeleteBackupResponseParsed,
  ExportDataResponseParsed,
  GetPathsResponseParsed,
  ImportDataResponseParsed,
  ListBackupsResponseParsed,
  ResetDataResponseParsed,
  RestoreBackupResponseParsed,
} from '@shared/schemas/backup';

import { toast } from './toastStore';

/** `window.api.app` 形状（备份 / 导出 / 恢复相关）。 */
interface ApiBackupShape {
  getPaths(): Promise<
    | { ok: true; data: GetPathsResponseParsed }
    | { ok: false; error: { code: string; message: string } }
  >;
  listBackups(): Promise<
    | { ok: true; data: ListBackupsResponseParsed }
    | { ok: false; error: { code: string; message: string } }
  >;
  backupNow(input?: { destPath?: string }): Promise<
    | { ok: true; data: BackupNowResponseParsed }
    | { ok: false; error: { code: string; message: string } }
  >;
  exportData(input: { destPath: string }): Promise<
    | { ok: true; data: ExportDataResponseParsed }
    | { ok: false; error: { code: string; message: string } }
  >;
  restoreBackup(input: { path: string; confirm: 'RESTORE' }): Promise<
    | { ok: true; data: RestoreBackupResponseParsed }
    | { ok: false; error: { code: string; message: string } }
  >;
  importData(input: { path: string; confirm: 'RESTORE' }): Promise<
    | { ok: true; data: ImportDataResponseParsed }
    | { ok: false; error: { code: string; message: string } }
  >;
  deleteBackup(input: { path: string }): Promise<
    | { ok: true; data: DeleteBackupResponseParsed }
    | { ok: false; error: { code: string; message: string } }
  >;
  resetData(input: { confirm: 'RESET' }): Promise<
    | { ok: true; data: ResetDataResponseParsed }
    | { ok: false; error: { code: string; message: string } }
  >;
}

interface WindowWithApi {
  api?: {
    app?: ApiBackupShape;
  };
}

/** 安全取 window.api.app。 */
function getBackupApi(): ApiBackupShape | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as WindowWithApi;
  return w.api?.app ?? null;
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

/** 最近一次备份相关动作（用于 UI 知道是哪个动作触发了 restart 提示）。 */
export type BackupAction = 'backup' | 'export' | 'restore' | 'import' | 'delete' | 'reset' | null;

/** store 形状。 */
export interface BackupState {
  /** 备份文件列表（按 createdAt DESC）。 */
  backups: BackupInfoParsed[];
  /** 主进程路径信息（userData / db / backups 绝对路径）。 */
  paths: GetPathsResponseParsed | null;
  /** 加载中。 */
  loading: boolean;
  /** 最近一次错误信息。 */
  error: string | null;
  /** 最近一次触发的备份动作（用于"请重启"提示）。 */
  lastAction: BackupAction;

  // ---- actions ----
  loadPaths: () => Promise<void>;
  loadBackups: () => Promise<void>;
  backupNow: (destPath?: string) => Promise<BackupNowResponseParsed | null>;
  exportData: (destPath: string) => Promise<ExportDataResponseParsed | null>;
  restoreBackup: (path: string, confirm: 'RESTORE') => Promise<RestoreBackupResponseParsed | null>;
  importData: (path: string, confirm: 'RESTORE') => Promise<ImportDataResponseParsed | null>;
  deleteBackup: (path: string) => Promise<DeleteBackupResponseParsed | null>;
  resetData: (confirm: 'RESET') => Promise<ResetDataResponseParsed | null>;
}

export const useBackupStore = create<BackupState>((set, get) => ({
  backups: [],
  paths: null,
  loading: false,
  error: null,
  lastAction: null,

  async loadPaths(): Promise<void> {
    const api = getBackupApi();
    if (!api) return;
    try {
      const result = await api.getPaths();
      if (result.ok) {
        set({ paths: result.data });
      }
    } catch {
      // 静默：UI fallback 到 "未知"
    }
  },

  async loadBackups(): Promise<void> {
    const api = getBackupApi();
    if (!api) {
      set({ backups: [], loading: false, error: null });
      return;
    }
    set({ loading: true, error: null });
    try {
      const result = await api.listBackups();
      const list = unwrapOrToast(result, '加载备份列表失败');
      set({ backups: list, loading: false, error: null });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      set({ loading: false, error: message, backups: [] });
    }
  },

  async backupNow(destPath?: string): Promise<BackupNowResponseParsed | null> {
    const api = getBackupApi();
    if (!api) return null;
    set({ loading: true, error: null, lastAction: 'backup' });
    try {
      const input: { destPath?: string } = {};
      if (destPath !== undefined) input.destPath = destPath;
      const result = await api.backupNow(input);
      const data = unwrapOrToast(result, '备份失败');
      set({ loading: false });
      toast.success('已备份');
      // 刷新列表
      void get().loadBackups();
      return data;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      set({ loading: false, error: message });
      return null;
    }
  },

  async exportData(destPath: string): Promise<ExportDataResponseParsed | null> {
    const api = getBackupApi();
    if (!api) return null;
    set({ loading: true, error: null, lastAction: 'export' });
    try {
      const result = await api.exportData({ destPath });
      const data = unwrapOrToast(result, '导出失败');
      set({ loading: false });
      toast.success('已导出');
      return data;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      set({ loading: false, error: message });
      return null;
    }
  },

  async restoreBackup(
    path: string,
    confirm: 'RESTORE',
  ): Promise<RestoreBackupResponseParsed | null> {
    const api = getBackupApi();
    if (!api) return null;
    set({ loading: true, error: null, lastAction: 'restore' });
    try {
      const result = await api.restoreBackup({ path, confirm });
      const data = unwrapOrToast(result, '恢复失败');
      set({ loading: false });
      toast.info('已恢复数据，请重启应用使新数据生效');
      return data;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      set({ loading: false, error: message });
      return null;
    }
  },

  async importData(
    path: string,
    confirm: 'RESTORE',
  ): Promise<ImportDataResponseParsed | null> {
    const api = getBackupApi();
    if (!api) return null;
    set({ loading: true, error: null, lastAction: 'import' });
    try {
      const result = await api.importData({ path, confirm });
      const data = unwrapOrToast(result, '导入失败');
      set({ loading: false });
      toast.info('已导入数据，请重启应用使新数据生效');
      return data;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      set({ loading: false, error: message });
      return null;
    }
  },

  async deleteBackup(path: string): Promise<DeleteBackupResponseParsed | null> {
    const api = getBackupApi();
    if (!api) return null;
    set({ loading: true, error: null, lastAction: 'delete' });
    try {
      const result = await api.deleteBackup({ path });
      const data = unwrapOrToast(result, '删除失败');
      set({ loading: false });
      toast.success('已删除');
      // 刷新列表
      void get().loadBackups();
      return data;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      set({ loading: false, error: message });
      return null;
    }
  },

  async resetData(confirm: 'RESET'): Promise<ResetDataResponseParsed | null> {
    const api = getBackupApi();
    if (!api) return null;
    set({ loading: true, error: null, lastAction: 'reset' });
    try {
      const result = await api.resetData({ confirm });
      const data = unwrapOrToast(result, '重置失败');
      set({ loading: false });
      toast.info('已重置数据，请重启应用');
      return data;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      set({ loading: false, error: message });
      return null;
    }
  },
}));
