/**
 * App IPC storage info 单元测试（v0.4.0）
 *
 * 调 `handleAppGetStorageInfo`（绕开 ipcMain），验证：
 *   - 返回 db 文件大小（>0 因为 db client 刚创建）
 *   - 返回 dbPath / userDataDir 字符串
 *   - 文件不存在时 size = 0（构造一个不存在的路径）
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { join, resolve as resolvePath } from 'node:path';
import { tmpdir } from 'node:os';
import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs';

import { closeDb, createDbClient, type WorkstationDb } from '../db/client';
import { handleAppGetStorageInfo, type AppIpcDeps } from '../electron/main/ipc/app';

const TMP_ROOT = join(tmpdir(), 'minimax-workstation-storage-ipc-test');

beforeAll(() => {
  if (!existsSync(TMP_ROOT)) mkdirSync(TMP_ROOT, { recursive: true });
});
afterAll(() => {
  try { rmSync(TMP_ROOT, { recursive: true, force: true }); } catch { /* ignore */ }
});

function makeFixture(): { deps: AppIpcDeps; db: WorkstationDb; close: () => void } {
  const dbPath = join(TMP_ROOT, `app-ipc-storage-${Date.now()}.db`);
  // 用项目根作为 appPath，让 createDbClient 能定位 db/migrations/
  const { db } = createDbClient(dbPath, resolvePath(__dirname, '..'));
  return {
    deps: {
      db,
      dbStatus: { ready: true, path: dbPath, schemaVersion: 1 },
      appVersion: '0.4.0',
      userDataDir: TMP_ROOT,
    },
    db,
    close: () => closeDb(db),
  };
}

describe('App IPC getStorageInfo', () => {
  it('returns db size + path + userDataDir', async () => {
    const f = makeFixture();
    try {
      const info = await handleAppGetStorageInfo(f.deps);
      expect(info.dbPath).toContain('minimax-workstation-storage-ipc-test');
      expect(info.userDataDir).toBe(TMP_ROOT);
      // db 刚 create → 文件存在 → size > 0
      expect(info.dbSizeBytes).toBeGreaterThan(0);
      // 跟实际 stat 一致
      expect(info.dbSizeBytes).toBe(statSync(f.deps.dbStatus.path).size);
    } finally { f.close(); }
  });

  it('returns dbSizeBytes = 0 when file does not exist', async () => {
    const f = makeFixture();
    try {
      const phantomPath = join(TMP_ROOT, 'does-not-exist.db');
      const info = await handleAppGetStorageInfo({
        ...f.deps,
        dbStatus: { ...f.deps.dbStatus, path: phantomPath },
      });
      expect(info.dbSizeBytes).toBe(0);
      expect(info.dbPath).toBe(phantomPath);
    } finally { f.close(); }
  });
});
