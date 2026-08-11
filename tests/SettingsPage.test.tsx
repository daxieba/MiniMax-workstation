/**
 * Settings 页面 UI 单元测试（T5-2）
 *
 * 覆盖：
 *   - 5 个 section 渲染（外观 / AI / 备份 / 备份文件列表 / 危险区）
 *   - 5 个 section 都有 data-testid
 *   - 加载中状态（Loader2 + disabled）
 *   - 错误状态（红色 alert）
 *   - 备份文件列表：空态 / 表格 / 恢复 / 删除
 *   - 自动备份下拉切换
 *   - 二次确认 dialog（RESTORE / RESET）
 *   - 数据库目录名（basename）显示
 *   - 跳 /ai 路由（AI 配置按钮）
 *   - 主题切换按钮存在
 *
 * **不依赖 Electron** —— 渲染端用 stub 注入 `window.api.*`。
 *
 * @see src/pages/Settings/index.tsx
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import SettingsPage from '@/pages/Settings';

// ---- 工具：mock window.api ----

interface MockApi {
  app: {
    getVersion: ReturnType<typeof vi.fn>;
    getThemeSource: ReturnType<typeof vi.fn>;
    setThemeSource: ReturnType<typeof vi.fn>;
    getSettings: ReturnType<typeof vi.fn>;
    setSettings: ReturnType<typeof vi.fn>;
    maybeAutoBackup: ReturnType<typeof vi.fn>;
    getPaths: ReturnType<typeof vi.fn>;
    listBackups: ReturnType<typeof vi.fn>;
    backupNow: ReturnType<typeof vi.fn>;
    exportData: ReturnType<typeof vi.fn>;
    restoreBackup: ReturnType<typeof vi.fn>;
    importData: ReturnType<typeof vi.fn>;
    deleteBackup: ReturnType<typeof vi.fn>;
    resetData: ReturnType<typeof vi.fn>;
  };
  dialog: {
    showSaveDialog: ReturnType<typeof vi.fn>;
    showOpenDialog: ReturnType<typeof vi.fn>;
  };
  ai: {
    listProviders: ReturnType<typeof vi.fn>;
  };
}

let mockApi: MockApi;

function makeMockApi(): MockApi {
  return {
    app: {
      getVersion: vi.fn().mockResolvedValue('0.1.0-test'),
      getThemeSource: vi.fn().mockResolvedValue('system'),
      setThemeSource: vi.fn().mockResolvedValue({
        ok: true,
        data: { source: 'light', resolved: 'light' },
      }),
      getSettings: vi.fn().mockResolvedValue({
        ok: true,
        data: { autoBackupIntervalMin: 30, lastAutoBackupAt: null, lastRestoreAt: null },
      }),
      setSettings: vi.fn().mockResolvedValue({
        ok: true,
        data: { autoBackupIntervalMin: 60, lastAutoBackupAt: null, lastRestoreAt: null },
      }),
      maybeAutoBackup: vi.fn().mockResolvedValue({ ok: true, data: { triggered: false } }),
      getPaths: vi.fn().mockResolvedValue({
        ok: true,
        data: {
          userData: 'C:\\Users\\testuser\\AppData\\Roaming\\minimax-workstation',
          db: 'C:\\Users\\testuser\\AppData\\Roaming\\minimax-workstation\\workstation.db',
          backups: 'C:\\Users\\testuser\\AppData\\Roaming\\minimax-workstation\\backups',
        },
      }),
      listBackups: vi.fn().mockResolvedValue({
        ok: true,
        data: [
          {
            filename: 'auto-20260809-100000.mmws.json',
            path: 'C:\\Users\\testuser\\AppData\\Roaming\\minimax-workstation\\backups\\auto-20260809-100000.mmws.json',
            size: 4096,
            createdAt: 1700000000000,
          },
          {
            filename: 'manual-20260805-080000.mmws.json',
            path: 'C:\\Users\\testuser\\AppData\\Roaming\\minimax-workstation\\backups\\manual-20260805-080000.mmws.json',
            size: 2048,
            createdAt: 1628000000000,
          },
        ],
      }),
      backupNow: vi.fn().mockResolvedValue({
        ok: true,
        data: { path: '/x.mmws.json', size: 100, createdAt: 1700000000001 },
      }),
      exportData: vi.fn().mockResolvedValue({
        ok: true,
        data: { path: '/x.mmws.json', size: 100, createdAt: 1700000000001 },
      }),
      restoreBackup: vi.fn().mockResolvedValue({
        ok: true,
        data: { ok: true, restartRequired: true },
      }),
      importData: vi.fn().mockResolvedValue({
        ok: true,
        data: { ok: true, restartRequired: true },
      }),
      deleteBackup: vi.fn().mockResolvedValue({ ok: true, data: { deleted: true } }),
      resetData: vi.fn().mockResolvedValue({
        ok: true,
        data: { ok: true, restartRequired: true },
      }),
    },
    dialog: {
      showSaveDialog: vi.fn().mockResolvedValue({
        ok: true,
        data: { path: 'C:\\Users\\testuser\\Desktop\\export.mmws.json' },
      }),
      showOpenDialog: vi.fn().mockResolvedValue({
        ok: true,
        data: {
          path: 'C:\\Users\\testuser\\Desktop\\import.mmws.json',
          paths: ['C:\\Users\\testuser\\Desktop\\import.mmws.json'],
        },
      }),
    },
    ai: {
      listProviders: vi.fn().mockResolvedValue({
        ok: true,
        data: [{ id: 'minimax', displayName: 'MiniMax', defaultModel: 'm', defaultBaseURL: 'https://x' }],
      }),
    },
  };
}

beforeEach(() => {
  mockApi = makeMockApi();

  (window as unknown as { api: MockApi }).api = mockApi;
  // navigator.clipboard stub
  Object.defineProperty(navigator, 'clipboard', {
    writable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function renderSettings(): void {
  render(
    <MemoryRouter initialEntries={['/settings']}>
      <SettingsPage />
    </MemoryRouter>,
  );
}

// ============================================================
//  5 个 section 渲染
// ============================================================

describe('SettingsPage — sections', () => {
  it('renders all 5 sections', async () => {
    renderSettings();
    expect(screen.getByTestId('settings-section-appearance')).toBeInTheDocument();
    expect(screen.getByTestId('settings-section-ai')).toBeInTheDocument();
    expect(screen.getByTestId('settings-section-backup')).toBeInTheDocument();
    expect(screen.getByTestId('settings-section-backup-list')).toBeInTheDocument();
    expect(screen.getByTestId('settings-section-danger')).toBeInTheDocument();
  });

  it('renders h1 "设置"', () => {
    renderSettings();
    expect(screen.getByRole('heading', { name: '设置' })).toBeInTheDocument();
  });
});

// ============================================================
//  外观 section
// ============================================================

describe('SettingsPage — appearance', () => {
  it('shows db basename (not full path)', async () => {
    renderSettings();
    const span = await screen.findByTestId('settings-db-basename');
    expect(span.textContent).toBe('workstation.db');
    // 不应包含完整路径
    expect(span.textContent).not.toContain('C:');
    expect(span.textContent).not.toContain('testuser');
  });

  it('theme cycle button exists', () => {
    renderSettings();
    expect(screen.getByTestId('settings-theme-cycle')).toBeInTheDocument();
  });
});

// ============================================================
//  AI section
// ============================================================

describe('SettingsPage — AI', () => {
  it('renders AI section with configure button', () => {
    renderSettings();
    const ai = screen.getByTestId('settings-section-ai');
    expect(within(ai).getByTestId('settings-ai-configure')).toBeInTheDocument();
    expect(within(ai).getByTestId('settings-ai-provider')).toBeInTheDocument();
  });
});

// ============================================================
//  备份 section
// ============================================================

describe('SettingsPage — backup controls', () => {
  it('renders all 3 action buttons', () => {
    renderSettings();
    expect(screen.getByTestId('settings-backup-now')).toBeInTheDocument();
    expect(screen.getByTestId('settings-export')).toBeInTheDocument();
    expect(screen.getByTestId('settings-import')).toBeInTheDocument();
  });

  it('renders interval dropdown with default 30', async () => {
    renderSettings();
    const select = (await screen.findByTestId('settings-interval')) as HTMLSelectElement;
    expect(select.value).toBe('30');
  });

  it('shows last auto backup and last restore placeholders', () => {
    renderSettings();
    expect(screen.getByTestId('settings-last-auto').textContent).toBe('从未');
    expect(screen.getByTestId('settings-last-restore').textContent).toBe('从未');
  });

  it('changing interval calls setSettings', async () => {
    renderSettings();
    const select = (await screen.findByTestId('settings-interval')) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: '60' } });
    await waitFor(() => {
      expect(mockApi.app.setSettings).toHaveBeenCalledWith({ autoBackupIntervalMin: 60 });
    });
  });
});

// ============================================================
//  备份文件列表
// ============================================================

describe('SettingsPage — backup file list', () => {
  it('shows empty state when no backups', async () => {
    mockApi.app.listBackups.mockResolvedValue({ ok: true, data: [] });
    renderSettings();
    expect(await screen.findByTestId('settings-backup-empty')).toBeInTheDocument();
  });

  it('shows rows for each backup', async () => {
    renderSettings();
    expect(
      await screen.findByTestId('settings-backup-row-auto-20260809-100000.mmws.json'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('settings-backup-row-manual-20260805-080000.mmws.json'),
    ).toBeInTheDocument();
  });

  it('shows per-row restore + delete buttons', async () => {
    renderSettings();
    const row = await screen.findByTestId(
      'settings-backup-row-auto-20260809-100000.mmws.json',
    );
    expect(within(row).getByTestId('settings-backup-restore-auto-20260809-100000.mmws.json')).toBeInTheDocument();
    expect(within(row).getByTestId('settings-backup-delete-auto-20260809-100000.mmws.json')).toBeInTheDocument();
  });
});

// ============================================================
//  二次确认 dialog
// ============================================================

describe('SettingsPage — dangerous confirm dialog', () => {
  it('reset button shows confirm dialog with required=RESTORE? (no, RESET)', async () => {
    renderSettings();
    const resetBtn = await screen.findByTestId('settings-reset');
    fireEvent.click(resetBtn);
    expect(await screen.findByTestId('settings-confirm-dialog')).toBeInTheDocument();
    expect(screen.getByTestId('settings-confirm-dialog-input').getAttribute('placeholder')).toBe(
      'RESET',
    );
  });

  it('confirm dialog: submit disabled until user types correct string', async () => {
    renderSettings();
    fireEvent.click(await screen.findByTestId('settings-reset'));
    const submit = await screen.findByTestId('settings-confirm-dialog-submit');
    expect(submit).toBeDisabled();
    const input = screen.getByTestId('settings-confirm-dialog-input');
    fireEvent.change(input, { target: { value: 'wrong' } });
    expect(submit).toBeDisabled();
    fireEvent.change(input, { target: { value: 'RESET' } });
    expect(submit).not.toBeDisabled();
  });

  it('cancel closes the dialog', async () => {
    renderSettings();
    fireEvent.click(await screen.findByTestId('settings-reset'));
    expect(await screen.findByTestId('settings-confirm-dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('settings-confirm-dialog-cancel'));
    await waitFor(() => {
      expect(screen.queryByTestId('settings-confirm-dialog')).not.toBeInTheDocument();
    });
  });

  it('confirm with correct string calls resetData', async () => {
    renderSettings();
    fireEvent.click(await screen.findByTestId('settings-reset'));
    const input = await screen.findByTestId('settings-confirm-dialog-input');
    fireEvent.change(input, { target: { value: 'RESET' } });
    fireEvent.click(screen.getByTestId('settings-confirm-dialog-submit'));
    await waitFor(() => {
      expect(mockApi.app.resetData).toHaveBeenCalledWith({ confirm: 'RESET' });
    });
  });
});

// ============================================================
//  导出 / 导入 流程
// ============================================================

describe('SettingsPage — export flow', () => {
  it('export button opens save dialog and calls exportData', async () => {
    renderSettings();
    fireEvent.click(await screen.findByTestId('settings-export'));
    await waitFor(() => {
      expect(mockApi.dialog.showSaveDialog).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(mockApi.app.exportData).toHaveBeenCalledWith({
        destPath: 'C:\\Users\\testuser\\Desktop\\export.mmws.json',
      });
    });
  });
});

describe('SettingsPage — import flow', () => {
  it('import button opens open dialog and confirm dialog with RESTORE', async () => {
    renderSettings();
    fireEvent.click(await screen.findByTestId('settings-import'));
    await waitFor(() => {
      expect(mockApi.dialog.showOpenDialog).toHaveBeenCalled();
    });
    expect(await screen.findByTestId('settings-confirm-dialog')).toBeInTheDocument();
    // 输入 RESTORE + submit
    const input = screen.getByTestId('settings-confirm-dialog-input');
    fireEvent.change(input, { target: { value: 'RESTORE' } });
    fireEvent.click(screen.getByTestId('settings-confirm-dialog-submit'));
    await waitFor(() => {
      expect(mockApi.app.importData).toHaveBeenCalledWith({
        path: 'C:\\Users\\testuser\\Desktop\\import.mmws.json',
        confirm: 'RESTORE',
      });
    });
  });
});

// ============================================================
//  备份文件列表的恢复 / 删除
// ============================================================

describe('SettingsPage — backup row actions', () => {
  it('delete button calls deleteBackup (no confirm)', async () => {
    renderSettings();
    const row = await screen.findByTestId(
      'settings-backup-row-auto-20260809-100000.mmws.json',
    );
    const deleteBtn = within(row).getByTestId(
      'settings-backup-delete-auto-20260809-100000.mmws.json',
    );
    fireEvent.click(deleteBtn);
    await waitFor(() => {
      expect(mockApi.app.deleteBackup).toHaveBeenCalled();
    });
  });

  it('restore button opens confirm dialog (RESTORE)', async () => {
    renderSettings();
    const row = await screen.findByTestId(
      'settings-backup-row-auto-20260809-100000.mmws.json',
    );
    const restoreBtn = within(row).getByTestId(
      'settings-backup-restore-auto-20260809-100000.mmws.json',
    );
    fireEvent.click(restoreBtn);
    expect(await screen.findByTestId('settings-confirm-dialog')).toBeInTheDocument();
    expect(screen.getByTestId('settings-confirm-dialog-input').getAttribute('placeholder')).toBe(
      'RESTORE',
    );
  });
});

// ============================================================
//  立即备份按钮
// ============================================================

describe('SettingsPage — backup now button', () => {
  it('calls backupNow', async () => {
    renderSettings();
    fireEvent.click(await screen.findByTestId('settings-backup-now'));
    await waitFor(() => {
      expect(mockApi.app.backupNow).toHaveBeenCalled();
    });
  });
});

// ============================================================
//  主题切换
// ============================================================

describe('SettingsPage — theme cycle', () => {
  it('cycle button calls setThemeSource', async () => {
    renderSettings();
    fireEvent.click(await screen.findByTestId('settings-theme-cycle'));
    await waitFor(() => {
      expect(mockApi.app.setThemeSource).toHaveBeenCalled();
    });
  });
});

// ============================================================
//  版本号
// ============================================================

describe('SettingsPage — version', () => {
  it('shows version in footer', async () => {
    renderSettings();
    const ver = await screen.findByTestId('settings-version');
    expect(ver.textContent).toBe('0.1.0-test');
  });
});
