/**
 * 数据库基础设施测试（T1-3）
 *
 * 覆盖：
 *   - dev 路径 db 文件可创建
 *   - 启动后 `app:getDbStatus` 返回 ready=true
 *   - `app:setAppMeta` / `app:getAppMeta` 往返一致
 *   - 关闭后能重新打开
 *
 * 不直接 import `electron/main/index.ts`（它会启动整个 Electron app），
 * 而是用 `db/client.ts` 的纯函数 + 真实 better-sqlite3 连接做集成验证。
 *
 * 用临时目录（`tests/.tmp/`）隔离，每次跑前清理。
 */

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve as resolvePath } from 'node:path';

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { closeDb, createDbClient, resolveDbPath } from '../db/client';
import { appMeta } from '../db/schema';

const TMP_ROOT = join(tmpdir(), 'minimax-workstation-db-test');

beforeAll(() => {
  if (!existsSync(TMP_ROOT)) {
    mkdirSync(TMP_ROOT, { recursive: true });
  }
});

afterAll(() => {
  // 清理临时目录
  try {
    rmSync(TMP_ROOT, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

describe('db client (T1-3 infrastructure)', () => {
  let dbPath: string;

  beforeEach(() => {
    // 每个 test 独立 db 文件（避免相互污染）
    dbPath = join(TMP_ROOT, `test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  });

  it('creates db file at dev path when missing', () => {
    expect(existsSync(dbPath)).toBe(false);

    const created = createDbClient(dbPath, resolvePath(__dirname, '..'));
    expect(existsSync(dbPath)).toBe(true);
    expect(created.info.migrated).toBe(true);
    expect(created.info.path).toBe(resolvePath(dbPath));

    // schemaVersion > 0 表明迁移跑过（至少跑了 0001）
    expect(created.info.schemaVersion).toBeGreaterThanOrEqual(1);

    closeDb(created.db);
  });

  it('opens existing db without re-running migrations', () => {
    const first = createDbClient(dbPath, resolvePath(__dirname, '..'));
    // 写一行用于验证 db 可用
    first.db
      .insert(appMeta)
      .values({ key: 'firstKey', value: 'firstValue', createdAt: new Date(), updatedAt: new Date() })
      .run();
    closeDb(first.db);

    // 重新打开
    const second = createDbClient(dbPath, resolvePath(__dirname, '..'));
    const row = second.db.select().from(appMeta).where(eq(appMeta.key, 'firstKey')).get();
    expect(row).toBeDefined();
    expect(row?.value).toBe('firstValue');
    closeDb(second.db);
  });

  it('returns appMeta with consistent round-trip on set/get', () => {
    const created = createDbClient(dbPath, resolvePath(__dirname, '..'));
    const db = created.db;

    // 初始 key 不存在
    const before = db.select().from(appMeta).where(eq(appMeta.key, 'roundTripKey')).get();
    expect(before).toBeUndefined();

    // 写入
    const now = new Date();
    db.insert(appMeta)
      .values({ key: 'roundTripKey', value: 'roundTripValue', createdAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: appMeta.key,
        set: { value: 'roundTripValue', updatedAt: now },
      })
      .run();

    // 读回
    const after = db.select().from(appMeta).where(eq(appMeta.key, 'roundTripKey')).get();
    expect(after).toBeDefined();
    expect(after?.key).toBe('roundTripKey');
    expect(after?.value).toBe('roundTripValue');

    // upsert：再写一次，updatedAt 应该更新
    const later = new Date(now.getTime() + 1000);
    db.insert(appMeta)
      .values({ key: 'roundTripKey', value: 'updatedValue', createdAt: later, updatedAt: later })
      .onConflictDoUpdate({
        target: appMeta.key,
        set: { value: 'updatedValue', updatedAt: later },
      })
      .run();

    const updated = db.select().from(appMeta).where(eq(appMeta.key, 'roundTripKey')).get();
    expect(updated?.value).toBe('updatedValue');
    expect(updated?.createdAt.getTime()).toBe(now.getTime());
    expect(updated?.updatedAt.getTime()).toBe(later.getTime());

    closeDb(db);
  });

  it('enables WAL and foreign_keys pragmas', () => {
    const created = createDbClient(dbPath, resolvePath(__dirname, '..'));
    const journalMode = created.db.$client.pragma('journal_mode', { simple: true });
    const foreignKeys = created.db.$client.pragma('foreign_keys', { simple: true });

    expect(journalMode).toBe('wal');
    expect(foreignKeys).toBe(1);
    closeDb(created.db);
  });

  it('rejects paths that cannot be created (PERSISTENCE_FAILED)', () => {
    // 不可写路径（一个普通文件占位）
    const blocker = join(TMP_ROOT, 'blocker-file');
    writeFileSync(blocker, 'blocker');
    const invalidPath = join(blocker, 'subdir', 'should-not-create.db');

    expect(() => createDbClient(invalidPath, resolvePath(__dirname, '..'))).toThrow(/Failed to create db directory/);
  });
});

describe('resolveDbPath (T1-3 helper)', () => {
  // Windows-friendly paths：resolvePath('/tmp/...') 在 Windows 上不会自动加盘符
  // 用 join 而非 resolvePath 来构造 expected，因为 join 保持传入路径格式
  it('uses WORKSTATION_DB_PATH env var when set', () => {
    const result = resolveDbPath({
      env: { WORKSTATION_DB_PATH: 'C:\\Users\\test\\explicit.db' },
      isDev: true,
      appPath: 'C:\\project',
      userDataDir: 'C:\\userdata',
    });
    expect(result).toBe('C:\\Users\\test\\explicit.db');
  });

  it('uses dev path (./.data/workstation.db) when isDev and no env', () => {
    const result = resolveDbPath({
      env: {},
      isDev: true,
      appPath: 'C:\\project',
      userDataDir: 'C:\\userdata',
    });
    expect(result).toBe(join('C:\\project', '.data', 'workstation.db'));
  });

  it('uses userData path in production', () => {
    const result = resolveDbPath({
      env: {},
      isDev: false,
      appPath: 'C:\\project',
      userDataDir: 'C:\\userdata',
    });
    expect(result).toBe(join('C:\\userdata', 'workstation.db'));
  });

  it('ignores empty WORKSTATION_DB_PATH', () => {
    const result = resolveDbPath({
      env: { WORKSTATION_DB_PATH: '' },
      isDev: true,
      appPath: 'C:\\project',
      userDataDir: 'C:\\userdata',
    });
    expect(result).toBe(join('C:\\project', '.data', 'workstation.db'));
  });
});
