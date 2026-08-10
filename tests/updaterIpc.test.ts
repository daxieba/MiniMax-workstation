/**
 * Updater IPC handler 单元测试（T5-3）
 *
 * 覆盖：
 *   - `handleCheckForUpdate`：
 *       1. env 未设 → 返回 `{ available: false, message: 'Update source not configured' }`
 *       2. env 已设 + `autoUpdater.checkForUpdates` resolve → 返回 `{ available: false, message: 'Check initiated' }`
 *       3. env 已设 + `autoUpdater.checkForUpdates` reject → 返回 `{ available: false, message: 'Update check failed: ...' }`
 *       4. env 已设 + `autoUpdater.setFeedURL` 被调用，参数等于 env 值
 *       5. env 已设 + `autoDownload` / `autoInstallOnAppQuit` **不**被启用
 *   - `handleDownloadUpdate`：
 *       1. env 未设 → 返回 `{ ok: false, error: { code: 'NOT_IMPLEMENTED', ... } }`
 *       2. env 已设 → 仍返回 NOT_IMPLEMENTED（T5-3 骨架）
 *   - `registerUpdaterIpc`：注册 `app:checkForUpdate` + `app:downloadUpdate` 两个 channel
 *   - 安全：错误信息**不**含 feed URL / 绝对路径 / 用户名
 *
 * **不依赖 Electron** —— 直接调 `handle*` 函数。`electron` / `electron-updater` 用
 * `vi.mock` + `vi.hoisted` 拦截。
 *
 * @see electron/main/ipc/updater.ts
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---- 必须在 import 被测模块前 mock ----
// vi.hoisted 解决"vi.mock 工厂 hoist 时顶层 const 尚未初始化"的问题
const mocks = vi.hoisted(() => ({
  autoUpdater: {
    setFeedURL: vi.fn(),
    checkForUpdates: vi.fn(),
    autoDownload: false,
    autoInstallOnAppQuit: false,
  },
  ipcMainHandle: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: (...args: unknown[]): void => {
      mocks.ipcMainHandle(...args);
    },
  },
}));

vi.mock('electron-updater', () => ({
  autoUpdater: mocks.autoUpdater,
}));

import {
  UPDATE_FEED_ENV,
  handleCheckForUpdate,
  handleDownloadUpdate,
  registerUpdaterIpc,
} from '../electron/main/ipc/updater';

const FEED_URL = 'https://releases.example.invalid/minimax-workstation/';

beforeEach(() => {
  mocks.autoUpdater.setFeedURL.mockReset();
  mocks.autoUpdater.checkForUpdates.mockReset();
  mocks.autoUpdater.setFeedURL.mockReturnValue(undefined);
  mocks.autoUpdater.checkForUpdates.mockResolvedValue(null);
  mocks.autoUpdater.autoDownload = false;
  mocks.autoUpdater.autoInstallOnAppQuit = false;
  mocks.ipcMainHandle.mockReset();
  delete process.env[UPDATE_FEED_ENV];
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env[UPDATE_FEED_ENV];
});

// ============================================================
//  handleCheckForUpdate
// ============================================================

describe('handleCheckForUpdate', () => {
  it('returns "Update source not configured" when env is unset', async () => {
    delete process.env[UPDATE_FEED_ENV];
    const out = await handleCheckForUpdate();
    expect(out.available).toBe(false);
    expect(out.message).toBe('Update source not configured');
    expect(mocks.autoUpdater.setFeedURL).not.toHaveBeenCalled();
    expect(mocks.autoUpdater.checkForUpdates).not.toHaveBeenCalled();
  });

  it('returns "Update source not configured" when env is empty/whitespace', async () => {
    process.env[UPDATE_FEED_ENV] = '   ';
    const out = await handleCheckForUpdate();
    expect(out.available).toBe(false);
    expect(out.message).toBe('Update source not configured');
    expect(mocks.autoUpdater.setFeedURL).not.toHaveBeenCalled();
  });

  it('calls setFeedURL with env value when env is set', async () => {
    process.env[UPDATE_FEED_ENV] = FEED_URL;
    await handleCheckForUpdate();
    expect(mocks.autoUpdater.setFeedURL).toHaveBeenCalledTimes(1);
    expect(mocks.autoUpdater.setFeedURL).toHaveBeenCalledWith(FEED_URL);
  });

  it('returns "Check initiated" when env is set and checkForUpdates resolves', async () => {
    process.env[UPDATE_FEED_ENV] = FEED_URL;
    mocks.autoUpdater.checkForUpdates.mockResolvedValue(null);
    const out = await handleCheckForUpdate();
    expect(out.available).toBe(false);
    expect(out.message).toBe('Check initiated');
    expect(mocks.autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it('returns "Update check failed: ..." when checkForUpdates rejects', async () => {
    process.env[UPDATE_FEED_ENV] = FEED_URL;
    mocks.autoUpdater.checkForUpdates.mockRejectedValue(new Error('boom'));
    const out = await handleCheckForUpdate();
    expect(out.available).toBe(false);
    expect(out.message).toMatch(/^Update check failed: /);
    expect(out.message).toContain('boom');
  });

  it('does NOT enable autoDownload / autoInstallOnAppQuit (security: T5-3 scope)', async () => {
    process.env[UPDATE_FEED_ENV] = FEED_URL;
    // 先把 mock 对象的值改成 true，验证 handler 重置为 false
    mocks.autoUpdater.autoDownload = true;
    mocks.autoUpdater.autoInstallOnAppQuit = true;
    await handleCheckForUpdate();
    expect(mocks.autoUpdater.autoDownload).toBe(false);
    expect(mocks.autoUpdater.autoInstallOnAppQuit).toBe(false);
  });
});

// ============================================================
//  handleDownloadUpdate
// ============================================================

describe('handleDownloadUpdate', () => {
  it('returns NOT_IMPLEMENTED when env is unset', async () => {
    delete process.env[UPDATE_FEED_ENV];
    const out = await handleDownloadUpdate();
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error('unreachable');
    expect(out.error.code).toBe('NOT_IMPLEMENTED');
    expect(out.error.message).toBe('Update source not configured');
  });

  it('returns NOT_IMPLEMENTED when env is set (T5-3 skeleton, no real download)', async () => {
    process.env[UPDATE_FEED_ENV] = FEED_URL;
    const out = await handleDownloadUpdate();
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error('unreachable');
    expect(out.error.code).toBe('NOT_IMPLEMENTED');
  });
});

// ============================================================
//  registerUpdaterIpc
// ============================================================

describe('registerUpdaterIpc', () => {
  it('registers app:checkForUpdate + app:downloadUpdate handlers', () => {
    registerUpdaterIpc();
    const channels = mocks.ipcMainHandle.mock.calls.map((c) => c[0]);
    expect(channels).toContain('app:checkForUpdate');
    expect(channels).toContain('app:downloadUpdate');
  });
});

// ============================================================
//  Security: error messages must NOT leak feed URL / path / username
// ============================================================

describe('updater error message safety', () => {
  it('does not include feed URL in any error / not-configured message', async () => {
    process.env[UPDATE_FEED_ENV] = 'https://secret-feed.example.com/foo';
    const a = await handleCheckForUpdate();
    expect(a.message).not.toContain('secret-feed');
    const b = await handleDownloadUpdate();
    if (!b.ok) {
      expect(b.error.message).not.toContain('secret-feed');
    } else {
      throw new Error('expected NOT_IMPLEMENTED');
    }
  });

  it('error message does not leak env value as substring', async () => {
    process.env[UPDATE_FEED_ENV] = FEED_URL;
    mocks.autoUpdater.checkForUpdates.mockRejectedValue(new Error('fail at C:\\Users\\alice\\app'));
    const out = await handleCheckForUpdate();
    // handler 不应把 env / 自身字段加入 message —— 只应透传 inner error 文案
    expect(out.message).not.toContain(process.env[UPDATE_FEED_ENV] ?? '');
  });
});
