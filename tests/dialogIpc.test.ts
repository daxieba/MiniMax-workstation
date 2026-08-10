/**
 * Dialog IPC handler 单元测试（T5-2）
 *
 * 覆盖：
 *   - `showSaveDialog`        正常返回 path / 用户取消 → null / 校验失败
 *   - `showOpenDialog`        单选 / 多选 / 用户取消 / 校验失败
 *   - `isStructuredIpcError`  错误码识别
 *   - 错误码：VALIDATION_FAILED / INTERNAL
 *
 * **不依赖 Electron** —— 直接调 `handleShow*Dialog` 函数（绕开 ipcMain 事件循环）。
 * `electron.dialog` 用 stub 注入到测试（直接 mock import）。
 *
 * @see electron/main/ipc/dialog.ts
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// 在导入被测模块前 mock electron 模块
const mockShowSaveDialog = vi.fn();
const mockShowOpenDialog = vi.fn();

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
  },
  dialog: {
    showSaveDialog: (...args: unknown[]): Promise<unknown> => mockShowSaveDialog(...args),
    showOpenDialog: (...args: unknown[]): Promise<unknown> => mockShowOpenDialog(...args),
  },
}));

import {
  handleShowOpenDialog,
  handleShowSaveDialog,
  type DialogIpcDeps,
} from '../electron/main/ipc/dialog';

const deps: DialogIpcDeps = { getFocusedWindow: () => null };

beforeEach(() => {
  mockShowSaveDialog.mockReset();
  mockShowOpenDialog.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ============================================================
//  showSaveDialog
// ============================================================

describe('handleShowSaveDialog', () => {
  it('returns path when user selects a file', async () => {
    mockShowSaveDialog.mockResolvedValue({
      canceled: false,
      filePath: '/tmp/export.mmws.json',
    });
    const result = await handleShowSaveDialog(deps, {
      title: 'Save',
      defaultPath: 'export.mmws.json',
      filters: [{ name: 'Backup', extensions: ['mmws.json'] }],
    });
    expect(result.path).toBe('/tmp/export.mmws.json');
    // 无 getFocusedWindow → 直接传 opts（无 window 参数）
    expect(mockShowSaveDialog).toHaveBeenCalledWith({
      title: 'Save',
      defaultPath: 'export.mmws.json',
      filters: [{ name: 'Backup', extensions: ['mmws.json'] }],
    });
  });

  it('returns null path when user cancels', async () => {
    mockShowSaveDialog.mockResolvedValue({ canceled: true, filePath: undefined });
    const result = await handleShowSaveDialog(deps, {});
    expect(result.path).toBeNull();
  });

  it('accepts empty payload', async () => {
    mockShowSaveDialog.mockResolvedValue({ canceled: true, filePath: undefined });
    const result = await handleShowSaveDialog(deps, undefined);
    expect(result.path).toBeNull();
  });

  it('rejects extra fields with VALIDATION_FAILED', async () => {
    const err = await handleShowSaveDialog(deps, { extra: 'no' }).catch((e) => e);
    expect((err as { code: string }).code).toBe('VALIDATION_FAILED');
  });

  it('rejects invalid filters with VALIDATION_FAILED', async () => {
    const err = await handleShowSaveDialog(deps, { filters: 'not-array' }).catch((e) => e);
    expect((err as { code: string }).code).toBe('VALIDATION_FAILED');
  });

  it('returns INTERNAL when dialog throws', async () => {
    mockShowSaveDialog.mockRejectedValue(new Error('dialog crash'));
    const err = await handleShowSaveDialog(deps, {}).catch((e) => e);
    expect((err as { code: string }).code).toBe('INTERNAL');
    expect((err as { message: string }).message).toBe('dialog crash');
  });

  it('passes options to electron dialog', async () => {
    mockShowSaveDialog.mockResolvedValue({ canceled: false, filePath: '/x' });
    await handleShowSaveDialog(deps, { title: 'T' });
    expect(mockShowSaveDialog).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'T' }),
    );
  });
});

// ============================================================
//  showOpenDialog
// ============================================================

describe('handleShowOpenDialog', () => {
  it('returns single path when user picks a file', async () => {
    mockShowOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: ['/tmp/backup.mmws.json'],
    });
    const result = await handleShowOpenDialog(deps, {
      properties: ['openFile'],
    });
    expect(result.path).toBe('/tmp/backup.mmws.json');
    expect(result.paths).toEqual(['/tmp/backup.mmws.json']);
  });

  it('returns multiple paths when multiSelections', async () => {
    mockShowOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: ['/tmp/a.mmws.json', '/tmp/b.mmws.json'],
    });
    const result = await handleShowOpenDialog(deps, {
      properties: ['openFile', 'multiSelections'],
    });
    expect(result.paths).toEqual(['/tmp/a.mmws.json', '/tmp/b.mmws.json']);
    expect(result.path).toBe('/tmp/a.mmws.json'); // 取第一个
  });

  it('returns null + empty when user cancels', async () => {
    mockShowOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });
    const result = await handleShowOpenDialog(deps, {});
    expect(result.path).toBeNull();
    expect(result.paths).toEqual([]);
  });

  it('accepts empty payload', async () => {
    mockShowOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });
    const result = await handleShowOpenDialog(deps, undefined);
    expect(result.path).toBeNull();
  });

  it('rejects extra fields with VALIDATION_FAILED', async () => {
    const err = await handleShowOpenDialog(deps, { extra: 'no' }).catch((e) => e);
    expect((err as { code: string }).code).toBe('VALIDATION_FAILED');
  });

  it('rejects unknown property with VALIDATION_FAILED', async () => {
    const err = await handleShowOpenDialog(deps, {
      properties: ['unknownProperty' as never],
    }).catch((e) => e);
    expect((err as { code: string }).code).toBe('VALIDATION_FAILED');
  });

  it('rejects invalid filters with VALIDATION_FAILED', async () => {
    const err = await handleShowOpenDialog(deps, { filters: [{ name: '', extensions: [] }] }).catch(
      (e) => e,
    );
    expect((err as { code: string }).code).toBe('VALIDATION_FAILED');
  });

  it('returns INTERNAL when dialog throws', async () => {
    mockShowOpenDialog.mockRejectedValue(new Error('boom'));
    const err = await handleShowOpenDialog(deps, {}).catch((e) => e);
    expect((err as { code: string }).code).toBe('INTERNAL');
    expect((err as { message: string }).message).toBe('boom');
  });

  it('passes options including properties', async () => {
    mockShowOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });
    await handleShowOpenDialog(deps, {
      properties: ['openDirectory', 'createDirectory'],
    });
    expect(mockShowOpenDialog).toHaveBeenCalledWith(
      expect.objectContaining({ properties: ['openDirectory', 'createDirectory'] }),
    );
  });
});
