/**
 * 设置页（T5-2）
 *
 * 布局：5 个 section（外观 / AI / 备份 / 备份文件列表 / 危险区）。
 *
 * Section 1：外观
 *   - 主题：当前主题显示 + "切换"按钮（调 themeStore.cycle）
 *   - 数据目录：显示**目录名**（basename，如 `workstation.db`，**不**含绝对路径）
 *             + "复制路径"按钮（用 navigator.clipboard.writeText 复制完整绝对路径）
 *
 * Section 2：AI（**只**做入口，不重写 AI 工作区）
 *   - 当前 provider 显示（aiStore.provider）+ "配置"按钮（跳 /ai）
 *
 * Section 3：备份
 *   - 自动备份频率：下拉 0 / 30 / 60 / 120 分钟
 *   - 上次自动备份 / 上次恢复：YYYY-MM-DD HH:mm
 *   - "立即备份"按钮 → backupStore.backupNow()
 *   - "导出到..."按钮 → dialog.showSaveDialog → backupStore.exportData(path)
 *   - "从备份恢复"按钮 → dialog.showOpenDialog → 二次确认 RESTORE → restoreBackup
 *
 * Section 4：备份文件列表
 *   - 表格：filename | size (KB) | createdAt | 操作
 *   - 每行"删除"按钮（deleteBackup）
 *   - 每行"恢复"按钮（点 → 二次确认 RESTORE → restoreBackup）
 *   - 空状态：显示"暂无备份"
 *
 * Section 5：危险区
 *   - "重置所有数据"按钮 → 二次确认 RESET → resetData
 *
 * 底部：版本号（来自 window.api.app.getVersion()，无新增 IPC）
 *
 * 二次确认（PROJECT_IDENTITY.md §6.4）：
 *   - restore / reset → 弹 dialog 让用户输入大写字符串
 *   - delete 单个备份 → **不**需要（只是删备份文件，不是删数据）
 *
 * 错误：红色 alert 条
 * 加载：Loader2 旋转图标 + disable
 *
 * 自动备份触发：mount 时调 `settingsStore.maybeAutoBackup()`，静默失败
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Bot,
  Copy,
  Database,
  Download,
  ExternalLink,
  FileText,
  FolderOpen,
  HardDrive,
  Languages,
  Loader2,
  RefreshCw,
  Settings as SettingsIcon,
  Trash2,
  Upload,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { LanguageSwitcher } from '@/components/LanguageSwitcher/LanguageSwitcher';
import { useT } from '@/i18n';
import { useAiStore } from '@/store/aiStore';
import { useBackupStore } from '@/store/backupStore';
import { useSettingsStore } from '@/store/settingsStore';
import { toast } from '@/store/toastStore';

import type { AutoBackupIntervalParsed } from '@shared/schemas/appSettings';
import type { BackupInfoParsed } from '@shared/schemas/backup';

// ============================================================
//  工具
// ============================================================

const DATETIME_FORMATTER = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

function formatDateTime(ms: number): string {
  return DATETIME_FORMATTER.format(new Date(ms));
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function basenameOf(p: string): string {
  // 跨平台 basename
  const norm = p.replace(/[\\/]+$/, '');
  const idx = Math.max(norm.lastIndexOf('/'), norm.lastIndexOf('\\'));
  return idx >= 0 ? norm.slice(idx + 1) : norm;
}

interface WindowWithApiVersion {
  api?: {
    app?: {
      getVersion(): Promise<string>;
    };
    settings?: {
      getSettings(): Promise<{ ok: true; data: { autoBackupIntervalMin: AutoBackupIntervalParsed } } | { ok: false; error: { code: string; message: string } }>;
    };
  };
}

async function fetchAppVersion(): Promise<string> {
  if (typeof window === 'undefined') return '0.0.0';
  const w = window as unknown as WindowWithApiVersion;
  if (!w.api?.app?.getVersion) return '0.0.0';
  try {
    return await w.api.app.getVersion();
  } catch {
    return '0.0.0';
  }
}

// ============================================================
//  二次确认 dialog（inline，**不**用 window.prompt / window.confirm）
// ============================================================

interface ConfirmDialogProps {
  /** dialog 标题。 */
  title: string;
  /** 必须输入的大写字符串（`RESTORE` / `RESET`）。 */
  required: string;
  /** 描述文字。 */
  description: string;
  /** 危险样式（红色按钮）。 */
  destructive?: boolean;
  /** 提交。 */
  onSubmit: () => void;
  /** 取消。 */
  onCancel: () => void;
}

function ConfirmDangerDialog({
  title,
  required,
  description,
  destructive,
  onSubmit,
  onCancel,
}: ConfirmDialogProps): React.ReactElement {
  const [value, setValue] = useState<string>('');
  const matches = value === required;

  return (
    <div
      data-testid="settings-confirm-dialog"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="flex w-full max-w-md flex-col gap-3 rounded-lg border border-line bg-base p-4 shadow-card">
        <h2 className="text-base font-semibold text-primary">{title}</h2>
        <p className="text-sm text-secondary">{description}</p>
        <p className="text-xs text-secondary">
          请输入大写 <code className="rounded bg-elevated px-1 py-0.5 font-mono">{required}</code> 以确认：
        </p>
        <input
          type="text"
          data-testid="settings-confirm-dialog-input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={required}
          className="rounded-md border border-line bg-elevated px-2 py-1 text-sm text-primary outline-none focus:border-accent"
          autoFocus
        />
        <div className="flex items-center justify-end gap-2 border-t border-line pt-3">
          <button
            type="button"
            data-testid="settings-confirm-dialog-cancel"
            onClick={onCancel}
            className="rounded-md border border-line bg-base px-3 py-1.5 text-sm text-secondary transition-colors hover:text-primary"
          >
            取消
          </button>
          <button
            type="button"
            data-testid="settings-confirm-dialog-submit"
            onClick={onSubmit}
            disabled={!matches}
            className={[
              'rounded-md px-4 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
              destructive
                ? 'bg-danger text-inverse hover:bg-danger/90'
                : 'bg-accent text-inverse hover:bg-accent-hover',
            ].join(' ')}
          >
            确认
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
//  主题切换
// ============================================================

interface ThemeStoreLike {
  mode: string;
  cycle?: () => void;
  nextMode?: () => string;
}

function useThemeStoreSafely(): ThemeStoreLike {
  // 主题切换通过 `themeStore.cycle()` / 自定义 hook
  // 这里**不**改 themeStore，**不**新增 API；用 `applyThemeMode` 走已有流程
  // 为简化 + 测试稳定，渲染端直接调 nativeTheme IPC 走 `setThemeSource`
  return {
    mode: 'system',
  };
}

function useThemeCycle(): { mode: string; cycle: () => void } {
  // 简化实现：调 `window.api.app.setThemeSource` 走 light → dark → system 循环
  const [mode, setMode] = useState<string>('system');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const w = window as unknown as {
      api?: {
        app?: {
          getThemeSource(): Promise<'light' | 'dark' | 'system'>;
          setThemeSource(
            s: 'light' | 'dark' | 'system',
          ): Promise<
            | { ok: true; data: { source: 'light' | 'dark' | 'system'; resolved: 'light' | 'dark' } }
            | { ok: false; error: { code: string; message: string } }
          >;
        };
      };
    };
    let cancelled = false;
    void (async (): Promise<void> => {
      try {
        const cur = await w.api?.app?.getThemeSource();
        if (!cancelled && cur) setMode(cur);
      } catch {
        // ignore
      }
    })();
    return (): void => {
      cancelled = true;
    };
  }, []);

  const cycle = useCallback((): void => {
    const order: Array<'light' | 'dark' | 'system'> = ['light', 'dark', 'system'];
    const idx = order.indexOf(mode as 'light' | 'dark' | 'system');
    const next = order[(idx + 1 + order.length) % order.length] ?? 'system';
    setMode(next);
    if (typeof window === 'undefined') return;
    const w = window as unknown as {
      api?: {
        app?: {
          setThemeSource(
            s: 'light' | 'dark' | 'system',
          ): Promise<
            | { ok: true; data: { source: 'light' | 'dark' | 'system'; resolved: 'light' | 'dark' } }
            | { ok: false; error: { code: string; message: string } }
          >;
        };
      };
    };
    void w.api?.app?.setThemeSource(next);
    // 同步到 localStorage
    try {
      localStorage.setItem('minimax.theme.mode', next);
    } catch {
      // ignore
    }
  }, [mode]);

  return { mode, cycle };
}

void useThemeStoreSafely;

// ============================================================
//  Settings 主组件
// ============================================================

export default function SettingsPage(): React.ReactElement {
  const t = useT();
  const navigate = useNavigate();
  const { mode: themeMode, cycle: cycleTheme } = useThemeCycle();

  // settings store
  const settings = useSettingsStore((s) => s.settings);
  const settingsLoading = useSettingsStore((s) => s.loading);
  const settingsError = useSettingsStore((s) => s.error);
  const settingsLoad = useSettingsStore((s) => s.load);
  const settingsUpdate = useSettingsStore((s) => s.update);
  const settingsMaybeAutoBackup = useSettingsStore((s) => s.maybeAutoBackup);

  // backup store
  const backups = useBackupStore((s) => s.backups);
  const paths = useBackupStore((s) => s.paths);
  const backupsLoading = useBackupStore((s) => s.loading);
  const backupsError = useBackupStore((s) => s.error);
  const backupLoadPaths = useBackupStore((s) => s.loadPaths);
  const backupLoadBackups = useBackupStore((s) => s.loadBackups);
  const backupNow = useBackupStore((s) => s.backupNow);
  const exportDataAction = useBackupStore((s) => s.exportData);
  const restoreBackupAction = useBackupStore((s) => s.restoreBackup);
  const importDataAction = useBackupStore((s) => s.importData);
  const deleteBackupAction = useBackupStore((s) => s.deleteBackup);
  const resetDataAction = useBackupStore((s) => s.resetData);

  // ai store（只读 provider）
  const aiProvider = useAiStore((s) => s.provider);

  // 版本号
  const [appVersion, setAppVersion] = useState<string>('0.0.0');

  // T5-3：更新检查状态
  const [updaterMessage, setUpdaterMessage] = useState<string | null>(null);
  const [updaterAvailable, setUpdaterAvailable] = useState<boolean>(false);
  const [updaterChecking, setUpdaterChecking] = useState<boolean>(false);

  // 二次确认 dialog
  const [confirmDialog, setConfirmDialog] = useState<
    | {
        title: string;
        description: string;
        required: string;
        destructive: boolean;
        onSubmit: () => void;
      }
    | null
  >(null);

  // 挂载：拉 settings / paths / backups + 触发自动备份 + 拉版本号
  useEffect(() => {
    void settingsLoad();
    void backupLoadPaths();
    void backupLoadBackups();
    void settingsMaybeAutoBackup();
    void fetchAppVersion().then(setAppVersion);
  }, [settingsLoad, backupLoadPaths, backupLoadBackups, settingsMaybeAutoBackup]);

  // ---- 操作 handlers ----

  const handleIntervalChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>): void => {
      const raw = e.target.value;
      const num = Number(raw) as AutoBackupIntervalParsed;
      if (num === 0 || num === 30 || num === 60 || num === 120) {
        void settingsUpdate({ autoBackupIntervalMin: num });
      }
    },
    [settingsUpdate],
  );

  const handleCopyDbPath = useCallback((): void => {
    const fullPath = paths?.db ?? '';
    if (fullPath.length === 0) {
      toast.info('路径未加载');
      return;
    }
    if (typeof navigator === 'undefined' || !navigator.clipboard) {
      toast.error('当前环境不支持剪贴板');
      return;
    }
    void navigator.clipboard
      .writeText(fullPath)
      .then(() => {
        toast.success('已复制绝对路径到剪贴板');
      })
      .catch(() => {
        toast.error('复制失败');
      });
  }, [paths]);

  const handleBackupNow = useCallback((): void => {
    void backupNow();
  }, [backupNow]);

  const handleExport = useCallback(async (): Promise<void> => {
    const w = window as unknown as {
      api?: {
        dialog?: {
          showSaveDialog(input: {
            title?: string;
            defaultPath?: string;
            filters?: Array<{ name: string; extensions: string[] }>;
          }): Promise<
            | { ok: true; data: { path: string | null } }
            | { ok: false; error: { code: string; message: string } }
          >;
        };
      };
    };
    const api = w.api?.dialog;
    if (!api) {
      toast.error('系统 dialog 不可用');
      return;
    }
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const res = await api.showSaveDialog({
      title: '导出工作台数据',
      defaultPath: `workstation-${date}.mmws.json`,
      filters: [{ name: 'Workstation Backup', extensions: ['mmws.json'] }],
    });
    if (!res.ok) {
      toast.error(`打开保存对话框失败（${res.error.code}）：${res.error.message}`);
      return;
    }
    if (res.data.path === null) {
      return; // 用户取消
    }
    await exportDataAction(res.data.path);
  }, [exportDataAction]);

  const handleDeleteBackup = useCallback(
    (b: BackupInfoParsed): void => {
      // **不**需要二次确认（只是删备份文件）
      void deleteBackupAction(b.path);
    },
    [deleteBackupAction],
  );

  const handleRestoreFromList = useCallback(
    (b: BackupInfoParsed): void => {
      setConfirmDialog({
        title: `从备份恢复：${b.filename}`,
        description: `此操作会用该备份覆盖当前所有数据。备份时间：${formatDateTime(b.createdAt)}。`,
        required: 'RESTORE',
        destructive: true,
        onSubmit: () => {
          setConfirmDialog(null);
          void restoreBackupAction(b.path, 'RESTORE');
        },
      });
    },
    [restoreBackupAction],
  );

  const handleReset = useCallback((): void => {
    setConfirmDialog({
      title: '重置所有数据',
      description:
        '此操作会清空所有 projects / tasks / notes / reviews / aiConfigs / inbox_items。' +
        'app_meta 中的 schemaVersion / setupCompletedAt 会保留。**不可恢复**，请先备份。',
      required: 'RESET',
      destructive: true,
      onSubmit: () => {
        setConfirmDialog(null);
        void resetDataAction('RESET');
      },
    });
  }, [resetDataAction]);

  const handleImport = useCallback(async (): Promise<void> => {
    const w = window as unknown as {
      api?: {
        dialog?: {
          showOpenDialog(input: {
            title?: string;
            filters?: Array<{ name: string; extensions: string[] }>;
            properties?: Array<'openFile'>;
          }): Promise<
            | { ok: true; data: { path: string | null; paths: string[] } }
            | { ok: false; error: { code: string; message: string } }
          >;
        };
      };
    };
    const api = w.api?.dialog;
    if (!api) {
      toast.error('系统 dialog 不可用');
      return;
    }
    const res = await api.showOpenDialog({
      title: '选择要导入的 .mmws.json 文件',
      filters: [{ name: 'Workstation Backup', extensions: ['mmws.json'] }],
      properties: ['openFile'],
    });
    if (!res.ok) {
      toast.error(`打开选择对话框失败（${res.error.code}）：${res.error.message}`);
      return;
    }
    const path = res.data.path;
    if (path === null) return;
    setConfirmDialog({
      title: '导入并覆盖',
      description: '导入会用文件数据覆盖当前所有内容（与"恢复"相同语义）。',
      required: 'RESTORE',
      destructive: true,
      onSubmit: () => {
        setConfirmDialog(null);
        void importDataAction(path, 'RESTORE');
      },
    });
  }, [importDataAction]);

  // T5-3：检查更新（骨架，env-gated，**不**接远端）
  const handleCheckUpdate = useCallback(async (): Promise<void> => {
    if (typeof window === 'undefined') return;
    const w = window as unknown as {
      api?: {
        app?: {
          checkForUpdate(): Promise<
            | { ok: true; data: { available: boolean; version?: string; message?: string } }
            | { ok: false; error: { code: string; message: string } }
          >;
        };
      };
    };
    const fn = w.api?.app?.checkForUpdate;
    if (!fn) {
      setUpdaterMessage('更新功能不可用');
      return;
    }
    setUpdaterChecking(true);
    setUpdaterAvailable(false);
    setUpdaterMessage(null);
    try {
      const res = await fn();
      if (res.ok) {
        setUpdaterAvailable(res.data.available);
        setUpdaterMessage(res.data.message ?? null);
      } else {
        setUpdaterMessage(`检查更新失败（${res.error.code}）：${res.error.message}`);
      }
    } catch (err) {
      setUpdaterMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setUpdaterChecking(false);
    }
  }, []);

  // T5-3：下载更新（骨架：未启用时仅提示）
  const handleDownloadUpdate = useCallback((): void => {
    if (!updaterAvailable) {
      toast.info('当前没有可下载的更新');
      return;
    }
    void (async (): Promise<void> => {
      if (typeof window === 'undefined') return;
      const w = window as unknown as {
        api?: {
          app?: {
            downloadUpdate(): Promise<
              | { ok: true; data: { ok: true; message: string } }
              | { ok: false; error: { code: string; message: string } }
            >;
          };
        };
      };
      const fn = w.api?.app?.downloadUpdate;
      if (!fn) {
        toast.error('更新功能不可用');
        return;
      }
      const res = await fn();
      if (res.ok) {
        toast.info(res.data.message);
      } else {
        toast.error(`下载更新失败（${res.error.code}）：${res.error.message}`);
      }
    })();
  }, [updaterAvailable]);

  // 派生：db 文件 basename（**不**显示绝对路径以防用户名泄露）
  const dbBasename = useMemo<string>(() => {
    const full = paths?.db;
    if (!full) return 'workstation.db';
    return basenameOf(full);
  }, [paths?.db]);

  const backupsDir = useMemo<string>(() => {
    return paths?.backups ?? '';
  }, [paths?.backups]);

  return (
    <section className="flex h-full flex-col">
      <header className="border-b border-line bg-elevated/40 px-6 py-4">
        <h1 className="text-2xl font-semibold text-primary">{t.pages.settings.title}</h1>
        <p className="text-sm text-secondary">{t.settings.sections.appearance} · {t.settings.sections.ai} · {t.settings.sections.backup}</p>
      </header>

      <div className="flex-1 overflow-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-6">
          {(settingsError !== null || backupsError !== null) && (
            <div
              role="alert"
              data-testid="settings-error-alert"
              className="rounded-md border border-danger bg-danger-soft/40 px-3 py-2 text-sm text-danger"
            >
              {settingsError ?? backupsError}
            </div>
          )}

          {/* ====== Section 1: 外观 ====== */}
          <section
            data-testid="settings-section-appearance"
            className="rounded-lg border border-line bg-base p-4 shadow-card"
          >
            <h2 className="mb-3 flex items-center gap-2 text-base font-semibold text-primary">
              <SettingsIcon className="h-4 w-4" aria-hidden="true" />
              {t.settings.sections.appearance}
            </h2>
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="text-primary">{t.settings.sections.appearance}</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-secondary">
                    {themeMode === 'system' ? t.settings.theme.system : themeMode === 'dark' ? t.settings.theme.dark : t.settings.theme.light}
                  </span>
                  <button
                    type="button"
                    data-testid="settings-theme-cycle"
                    onClick={cycleTheme}
                    className="rounded-md border border-line bg-elevated px-3 py-1 text-xs text-primary transition-colors hover:border-accent hover:text-accent"
                  >
                    {t.common.confirm}
                  </button>
                </div>
              </div>
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="text-primary">{t.settings.dbDirectory}</span>
                <div className="flex items-center gap-2">
                  <span
                    data-testid="settings-db-basename"
                    className="font-mono text-xs text-secondary"
                    title={paths?.db ?? ''}
                  >
                    {dbBasename}
                  </span>
                  <button
                    type="button"
                    data-testid="settings-db-copy"
                    onClick={handleCopyDbPath}
                    className="inline-flex items-center gap-1 rounded-md border border-line bg-elevated px-2 py-1 text-xs text-primary transition-colors hover:border-accent hover:text-accent"
                  >
                    <Copy className="h-3 w-3" aria-hidden="true" />
                    {t.common.copy}
                  </button>
                </div>
              </div>
            </div>
          </section>

          {/* ====== Section 1.5: 语言 (v0.1.2) ====== */}
          <section
            data-testid="settings-section-language"
            className="rounded-lg border border-line bg-base p-4 shadow-card"
          >
            <h2 className="mb-3 flex items-center gap-2 text-base font-semibold text-primary">
              <Languages className="h-4 w-4" aria-hidden="true" />
              {t.settings.sections.language}
            </h2>
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="text-primary">{t.settings.language.label}</span>
              <LanguageSwitcher testId="settings-language-switcher" />
            </div>
          </section>

          {/* ====== Section 2: AI ====== */}
          <section
            data-testid="settings-section-ai"
            className="rounded-lg border border-line bg-base p-4 shadow-card"
          >
            <h2 className="mb-3 flex items-center gap-2 text-base font-semibold text-primary">
              <Bot className="h-4 w-4" aria-hidden="true" />
              AI
            </h2>
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="text-primary">AI provider</span>
              <div className="flex items-center gap-2">
                <span
                  data-testid="settings-ai-provider"
                  className="font-mono text-xs text-secondary"
                >
                  {aiProvider}
                </span>
                <button
                  type="button"
                  data-testid="settings-ai-configure"
                  onClick={() => navigate('/ai')}
                  className="inline-flex items-center gap-1 rounded-md border border-line bg-elevated px-2 py-1 text-xs text-primary transition-colors hover:border-accent hover:text-accent"
                >
                  <ExternalLink className="h-3 w-3" aria-hidden="true" />
                  配置
                </button>
              </div>
            </div>
          </section>

          {/* ====== Section 3: 备份 ====== */}
          <section
            data-testid="settings-section-backup"
            className="rounded-lg border border-line bg-base p-4 shadow-card"
          >
            <h2 className="mb-3 flex items-center gap-2 text-base font-semibold text-primary">
              <HardDrive className="h-4 w-4" aria-hidden="true" />
              备份
            </h2>
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2 text-sm">
                <label htmlFor="settings-interval" className="text-primary">
                  自动备份频率
                </label>
                <select
                  id="settings-interval"
                  data-testid="settings-interval"
                  value={settings.autoBackupIntervalMin}
                  onChange={handleIntervalChange}
                  disabled={settingsLoading}
                  className="rounded-md border border-line bg-elevated px-2 py-1 text-sm text-primary outline-none focus:border-accent disabled:opacity-50"
                >
                  <option value={0}>关闭</option>
                  <option value={30}>30 分钟</option>
                  <option value={60}>1 小时</option>
                  <option value={120}>2 小时</option>
                </select>
              </div>
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="text-primary">上次自动备份</span>
                <span
                  data-testid="settings-last-auto"
                  className="font-mono text-xs text-secondary"
                >
                  {settings.lastAutoBackupAt === null
                    ? '从未'
                    : formatDateTime(settings.lastAutoBackupAt)}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="text-primary">上次恢复</span>
                <span
                  data-testid="settings-last-restore"
                  className="font-mono text-xs text-secondary"
                >
                  {settings.lastRestoreAt === null ? '从未' : formatDateTime(settings.lastRestoreAt)}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
                <button
                  type="button"
                  data-testid="settings-backup-now"
                  onClick={handleBackupNow}
                  disabled={backupsLoading}
                  className="inline-flex items-center gap-1 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-inverse transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {backupsLoading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <Database className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                  立即备份
                </button>
                <button
                  type="button"
                  data-testid="settings-export"
                  onClick={() => void handleExport()}
                  disabled={backupsLoading}
                  className="inline-flex items-center gap-1 rounded-md border border-line bg-elevated px-3 py-1.5 text-sm text-primary transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
                >
                  <Download className="h-3.5 w-3.5" aria-hidden="true" />
                  导出到…
                </button>
                <button
                  type="button"
                  data-testid="settings-import"
                  onClick={() => void handleImport()}
                  disabled={backupsLoading}
                  className="inline-flex items-center gap-1 rounded-md border border-line bg-elevated px-3 py-1.5 text-sm text-primary transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
                >
                  <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                  从备份恢复
                </button>
              </div>
            </div>
          </section>

          {/* ====== Section 4: 备份文件列表 ====== */}
          <section
            data-testid="settings-section-backup-list"
            className="rounded-lg border border-line bg-base p-4 shadow-card"
          >
            <h2 className="mb-3 flex items-center gap-2 text-base font-semibold text-primary">
              <FileText className="h-4 w-4" aria-hidden="true" />
              备份文件
              <span className="text-xs text-secondary">（{backups.length}）</span>
              {backupsDir.length > 0 ? (
                <span
                  className="ml-auto font-mono text-[10px] text-secondary"
                  title={backupsDir}
                >
                  {basenameOf(backupsDir)}
                </span>
              ) : null}
            </h2>
            {backups.length === 0 ? (
              <p
                data-testid="settings-backup-empty"
                className="rounded-md border border-dashed border-line bg-elevated/40 px-3 py-6 text-center text-sm text-secondary"
              >
                暂无备份
              </p>
            ) : (
              <div
                data-testid="settings-backup-list"
                className="max-h-72 overflow-auto rounded-md border border-line bg-elevated"
              >
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 bg-elevated text-secondary">
                    <tr>
                      <th className="px-2 py-1.5 font-medium">文件</th>
                      <th className="px-2 py-1.5 font-medium">大小</th>
                      <th className="px-2 py-1.5 font-medium">创建时间</th>
                      <th className="px-2 py-1.5 text-right font-medium">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {backups.map((b) => (
                      <tr
                        key={b.path}
                        data-testid={`settings-backup-row-${b.filename}`}
                        className="text-primary"
                      >
                        <td className="px-2 py-1.5">
                          <span className="font-mono text-[11px]">{b.filename}</span>
                        </td>
                        <td className="px-2 py-1.5 text-secondary">
                          {formatSize(b.size)}
                        </td>
                        <td className="px-2 py-1.5 text-secondary">
                          {formatDateTime(b.createdAt)}
                        </td>
                        <td className="px-2 py-1.5">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              type="button"
                              data-testid={`settings-backup-restore-${b.filename}`}
                              onClick={() => handleRestoreFromList(b)}
                              className="rounded border border-line bg-base px-2 py-0.5 text-[11px] text-primary transition-colors hover:border-accent hover:text-accent"
                            >
                              恢复
                            </button>
                            <button
                              type="button"
                              data-testid={`settings-backup-delete-${b.filename}`}
                              onClick={() => handleDeleteBackup(b)}
                              className="inline-flex items-center gap-1 rounded border border-line bg-base px-2 py-0.5 text-[11px] text-danger transition-colors hover:border-danger"
                            >
                              <Trash2 className="h-3 w-3" aria-hidden="true" />
                              删除
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* ====== Section 5: 危险区 ====== */}
          <section
            data-testid="settings-section-danger"
            className="rounded-lg border-2 border-danger/60 bg-danger-soft/10 p-4"
          >
            <h2 className="mb-3 flex items-center gap-2 text-base font-semibold text-danger">
              <AlertTriangle className="h-4 w-4" aria-hidden="true" />
              危险操作
            </h2>
            <div className="space-y-3">
              <p className="text-xs text-secondary">
                重置会清空所有 projects / inbox / tasks / notes / reviews / aiConfigs。
                <br />
                <code className="rounded bg-elevated px-1 py-0.5 font-mono">app_meta</code> 中的{' '}
                <code className="rounded bg-elevated px-1 py-0.5 font-mono">schemaVersion</code> /
                <code className="ml-0.5 rounded bg-elevated px-1 py-0.5 font-mono">setupCompletedAt</code>{' '}
                会保留。FTS5 虚表同步清空。
              </p>
              <button
                type="button"
                data-testid="settings-reset"
                onClick={handleReset}
                className="inline-flex items-center gap-1 rounded-md border border-danger bg-danger px-3 py-1.5 text-sm font-medium text-inverse transition-colors hover:bg-danger/90"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                重置所有数据
              </button>
            </div>
          </section>

          {/* ====== 底部：版本号（v0.2.1 i18n 化） ====== */}
          <footer
            data-testid="settings-footer"
            className="flex items-center justify-between border-t border-line pt-3 text-xs text-secondary"
          >
            <span>
              <FolderOpen className="mr-1 inline h-3 w-3" aria-hidden="true" />
              {t.settings.dbDirectory}：<span className="font-mono">{basenameOf(paths?.userData ?? 'userData')}</span>
            </span>
            <span>
              {t.settings.versionLabel}：
              <span className="font-mono" data-testid="settings-version">{appVersion}</span>
            </span>
          </footer>

          {/* ====== Section 6: 更新（T5-3 骨架 + v0.2.1 i18n 化） ====== */}
          <section
            data-testid="settings-section-updater"
            className="rounded-lg border border-line bg-base p-4 shadow-card"
          >
            <h2 className="mb-3 flex items-center gap-2 text-base font-semibold text-primary">
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              {t.settings.sections.updates}
            </h2>
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="text-primary">{t.settings.updates.currentVersion}</span>
                <span
                  data-testid="settings-current-version"
                  className="font-mono text-xs text-secondary"
                >
                  {appVersion}
                </span>
              </div>
              {updaterMessage !== null ? (
                <div
                  data-testid="settings-update-message"
                  className="rounded-md border border-line bg-elevated/40 px-3 py-2 text-xs text-secondary"
                >
                  {updaterMessage}
                </div>
              ) : null}
              <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
                <button
                  type="button"
                  data-testid="settings-check-update"
                  onClick={() => void handleCheckUpdate()}
                  disabled={updaterChecking}
                  className="inline-flex items-center gap-1 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-inverse transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {updaterChecking ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                  {updaterChecking ? t.settings.updates.checking : t.settings.updates.check}
                </button>
                <button
                  type="button"
                  data-testid="settings-download-update"
                  onClick={handleDownloadUpdate}
                  disabled={!updaterAvailable}
                  className="inline-flex items-center gap-1 rounded-md border border-line bg-elevated px-3 py-1.5 text-sm text-primary transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Download className="h-3.5 w-3.5" aria-hidden="true" />
                  {t.settings.updates.download}
                </button>
              </div>
            </div>
          </section>
        </div>
      </div>

      {/* 二次确认 dialog */}
      {confirmDialog ? (
        <ConfirmDangerDialog
          title={confirmDialog.title}
          description={confirmDialog.description}
          required={confirmDialog.required}
          destructive={confirmDialog.destructive}
          onSubmit={confirmDialog.onSubmit}
          onCancel={() => setConfirmDialog(null)}
        />
      ) : null}
    </section>
  );
}
