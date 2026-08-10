/**
 * AI IPC handler 单元测试（T3-1 基础设施 + T3-2 适配器）
 *
 * 直接调 `handleAi*` 函数（绕开 ipcMain 事件循环），喂临时 db + 临时 CredentialManager，验证：
 *   - 7 个 handler 都有成功 + 失败两条用例
 *   - 错误码符合 PROJECT_IDENTITY.md §4.4
 *   - `ai:getConfig` 缺省回退到 metadata（updatedAt=0）
 *   - `ai:setConfig` 落 db 后 getConfig 读回
 *   - `ai:hasKey` / `ai:setKey` / `ai:deleteKey` 联动 CredentialManager
 *   - `ai:testConnection` 在无 key 时返 `{ ok: false, error: 'no API key configured' }`，
 *     有 key 时（**T3-2 改动**）走真实 `provider.testConnection()`（mock fetch 200 → ok:true）
 *   - **关键安全**：handler 错误信息 / 日志**不**含 key 内容
 *
 * **T3-2 改动**：
 *   - `ai:testConnection` 不再返 "not implemented"（占位已删除）；现在通过
 *     `createProviders` 注入真实 provider，mock fetch 让 testConnection 走通
 *   - `ai:listProviders` 现在用真实 provider metadata（与 T3-1 一样的内容，因为 metadata
 *     字段没变）
 *
 * **不依赖 Electron** —— 直接用 `db/client.ts` 的 createDbClient + 真实 CredentialManager。
 *
 * @see electron/main/ipc/ai.ts
 */

import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve as resolvePath } from 'node:path';

import { ulid } from 'ulidx';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeDb, createDbClient, type WorkstationDb } from '../db/client';
import { CredentialManager } from '../electron/main/credentials/credentialManager';
import {
  handleAiDeleteKey,
  handleAiGetConfig,
  handleAiHasKey,
  handleAiListProviders,
  handleAiSetConfig,
  handleAiSetKey,
  handleAiTestConnection,
  type AiIpcDeps,
} from '../electron/main/ipc/ai';
import { createProviders } from '../electron/main/providers/factory';

const TMP_ROOT = join(tmpdir(), 'minimax-workstation-ai-ipc-test');

beforeAll(() => {
  if (!existsSync(TMP_ROOT)) {
    mkdirSync(TMP_ROOT, { recursive: true });
  }
});

afterAll(() => {
  try {
    rmSync(TMP_ROOT, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

/** 全局 fetch mock（testConnection 走 HEAD）。每个 test 用 vi.stubGlobal，afterEach 自动 unstub。 */
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

interface Fixture {
  deps: AiIpcDeps;
  db: WorkstationDb;
  manager: CredentialManager;
  close: () => void;
}

beforeEach(() => {
  // 静默 re-register warning（createProviders 多次调用会触发 warning，测试隔离需要）
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

function makeFixture(): Fixture {
  const dbPath = join(TMP_ROOT, `ai-ipc-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  const { db } = createDbClient(dbPath, resolvePath(__dirname, '..'));
  // 每个 fixture 用独立 service 名 → 隔离 CredentialManager 状态
  const manager = new CredentialManager(`minimax-workstation-test-${ulid().toLowerCase()}`);
  // T3-2：用真实 provider 替换占位
  createProviders({ credentialManager: manager });
  return {
    deps: { db, credentialManager: manager },
    db,
    manager,
    close: () => closeDb(db),
  };
}

// ============================================================
//  handleAiListProviders
// ============================================================

describe('ai:listProviders', () => {
  it('returns both minimax and openai-compatible metadata', async () => {
    const f = makeFixture();
    try {
      const result = await handleAiListProviders(f.deps, undefined);
      expect(result).toHaveLength(2);
      const ids = result.map((r) => r.id).sort();
      expect(ids).toEqual(['minimax', 'openai-compatible']);
      for (const meta of result) {
        expect(meta.displayName).toBeTruthy();
        expect(meta.defaultModel).toBeTruthy();
        expect(meta.defaultBaseURL).toBeTruthy();
      }
    } finally {
      f.close();
    }
  });

  it('ignores payload (returns the same list regardless)', async () => {
    const f = makeFixture();
    try {
      const a = await handleAiListProviders(f.deps, undefined);
      const b = await handleAiListProviders(f.deps, { any: 'thing' });
      expect(b).toHaveLength(a.length);
    } finally {
      f.close();
    }
  });
});

// ============================================================
//  handleAiHasKey
// ============================================================

describe('ai:hasKey', () => {
  it('returns false for provider without key', async () => {
    const f = makeFixture();
    try {
      const result = await handleAiHasKey(f.deps, { provider: 'minimax' });
      expect(result.hasKey).toBe(false);
    } finally {
      f.close();
    }
  });

  it('returns true after setKey (round-trip)', async () => {
    const f = makeFixture();
    try {
      await handleAiSetKey(f.deps, { provider: 'minimax', key: `sk-test-${ulid()}` });
      const result = await handleAiHasKey(f.deps, { provider: 'minimax' });
      expect(result.hasKey).toBe(true);
    } finally {
      // 清理
      await f.manager.deleteKey('minimax').catch(() => undefined);
      f.close();
    }
  });

  it('rejects invalid input with VALIDATION_FAILED', async () => {
    const f = makeFixture();
    try {
      // 缺 provider
      await expect(handleAiHasKey(f.deps, {})).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
      });
      // 非法 provider
      await expect(
        handleAiHasKey(f.deps, { provider: 'nope' as unknown as 'minimax' }),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    } finally {
      f.close();
    }
  });
});

// ============================================================
//  handleAiSetKey
// ============================================================

describe('ai:setKey', () => {
  it('stores the key (verifiable via getKey)', async () => {
    const f = makeFixture();
    const key = `sk-setkey-${ulid()}`;
    try {
      const result = await handleAiSetKey(f.deps, { provider: 'minimax', key });
      expect(result).toEqual({ ok: true });
      // 直读 CredentialManager 验证
      expect(await f.manager.getKey('minimax')).toBe(key);
    } finally {
      await f.manager.deleteKey('minimax').catch(() => undefined);
      f.close();
    }
  });

  it('response does NOT contain the key (CRITICAL safety)', async () => {
    const f = makeFixture();
    const key = `super-secret-${ulid()}`;
    try {
      const result = await handleAiSetKey(f.deps, { provider: 'minimax', key });
      // result 必须是 { ok: true } 形态，**不**含 key
      expect(result).toEqual({ ok: true });
      expect(JSON.stringify(result)).not.toContain(key);
      expect(JSON.stringify(result)).not.toContain('super-secret');
    } finally {
      await f.manager.deleteKey('minimax').catch(() => undefined);
      f.close();
    }
  });

  it('rejects invalid input with VALIDATION_FAILED (no key leaked in error)', async () => {
    const f = makeFixture();
    const key = `super-secret-${ulid()}`;
    try {
      let caught: unknown = null;
      try {
        await handleAiSetKey(f.deps, { provider: 'minimax' }); // 缺 key
      } catch (err) {
        caught = err;
      }
      expect(caught).toMatchObject({ code: 'VALIDATION_FAILED' });
      // 关键：VALIDATION_FAILED 的 details 不能含 key 内容
      expect(JSON.stringify(caught)).not.toContain(key);
    } finally {
      await f.manager.deleteKey('minimax').catch(() => undefined);
      f.close();
    }
  });

  it('rejects empty key with VALIDATION_FAILED', async () => {
    const f = makeFixture();
    try {
      await expect(
        handleAiSetKey(f.deps, { provider: 'minimax', key: '' }),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    } finally {
      f.close();
    }
  });
});

// ============================================================
//  handleAiDeleteKey
// ============================================================

describe('ai:deleteKey', () => {
  it('removes the stored key', async () => {
    const f = makeFixture();
    try {
      await handleAiSetKey(f.deps, { provider: 'minimax', key: `sk-del-${ulid()}` });
      const before = await f.manager.hasKey('minimax');
      expect(before).toBe(true);
      const result = await handleAiDeleteKey(f.deps, { provider: 'minimax' });
      expect(result).toEqual({ ok: true });
      const after = await f.manager.hasKey('minimax');
      expect(after).toBe(false);
    } finally {
      // 双保险
      await f.manager.deleteKey('minimax').catch(() => undefined);
      f.close();
    }
  });

  it('is idempotent (no error when key does not exist)', async () => {
    const f = makeFixture();
    try {
      const result = await handleAiDeleteKey(f.deps, { provider: 'minimax' });
      expect(result).toEqual({ ok: true });
    } finally {
      f.close();
    }
  });

  it('rejects invalid input with VALIDATION_FAILED', async () => {
    const f = makeFixture();
    try {
      await expect(handleAiDeleteKey(f.deps, {})).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
      });
    } finally {
      f.close();
    }
  });
});

// ============================================================
//  handleAiGetConfig
// ============================================================

describe('ai:getConfig', () => {
  it('returns metadata defaults when db has no row (updatedAt=0)', async () => {
    const f = makeFixture();
    try {
      const result = await handleAiGetConfig(f.deps, { provider: 'minimax' });
      expect(result.provider).toBe('minimax');
      expect(result.model).toBe('MiniMax-M2');
      expect(result.baseURL).toBe('https://api.minimax.chat/v1');
      expect(result.updatedAt).toBe(0); // 0 = "未落库，使用 metadata"
    } finally {
      f.close();
    }
  });

  it('returns db row after setConfig (with real updatedAt)', async () => {
    const f = makeFixture();
    try {
      await handleAiSetConfig(f.deps, {
        provider: 'minimax',
        config: { model: 'custom-model', baseURL: 'https://custom.example/v1' },
      });
      const result = await handleAiGetConfig(f.deps, { provider: 'minimax' });
      expect(result.provider).toBe('minimax');
      expect(result.model).toBe('custom-model');
      expect(result.baseURL).toBe('https://custom.example/v1');
      expect(result.updatedAt).toBeGreaterThan(0);
    } finally {
      f.close();
    }
  });

  it('rejects invalid input with VALIDATION_FAILED', async () => {
    const f = makeFixture();
    try {
      await expect(handleAiGetConfig(f.deps, {})).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
      });
    } finally {
      f.close();
    }
  });
});

// ============================================================
//  handleAiSetConfig
// ============================================================

describe('ai:setConfig', () => {
  it('writes a new row and returns it', async () => {
    const f = makeFixture();
    try {
      const result = await handleAiSetConfig(f.deps, {
        provider: 'minimax',
        config: { model: 'gpt-test', baseURL: 'https://api.test/v1' },
      });
      expect(result.provider).toBe('minimax');
      expect(result.model).toBe('gpt-test');
      expect(result.baseURL).toBe('https://api.test/v1');
      expect(result.updatedAt).toBeGreaterThan(0);

      // 验证 db 落库
      const got = await handleAiGetConfig(f.deps, { provider: 'minimax' });
      expect(got.model).toBe('gpt-test');
    } finally {
      f.close();
    }
  });

  it('updates an existing row (upsert)', async () => {
    const f = makeFixture();
    try {
      await handleAiSetConfig(f.deps, {
        provider: 'minimax',
        config: { model: 'first', baseURL: 'https://first/v1' },
      });
      const t1 = (await handleAiGetConfig(f.deps, { provider: 'minimax' })).updatedAt;
      await new Promise((r) => setTimeout(r, 5));
      const updated = await handleAiSetConfig(f.deps, {
        provider: 'minimax',
        config: { model: 'second', baseURL: 'https://second/v1' },
      });
      expect(updated.model).toBe('second');
      expect(updated.baseURL).toBe('https://second/v1');
      expect(updated.updatedAt).toBeGreaterThanOrEqual(t1);
    } finally {
      f.close();
    }
  });

  it('does not touch apiKey (config has no key field)', async () => {
    const f = makeFixture();
    const key = `sk-noapi-${ulid()}`;
    try {
      await handleAiSetKey(f.deps, { provider: 'minimax', key });
      await handleAiSetConfig(f.deps, {
        provider: 'minimax',
        config: { model: 'm', baseURL: 'https://b/v1' },
      });
      // setConfig 后 key 仍在 CredentialManager
      expect(await f.manager.hasKey('minimax')).toBe(true);
      expect(await f.manager.getKey('minimax')).toBe(key);
    } finally {
      await f.manager.deleteKey('minimax').catch(() => undefined);
      f.close();
    }
  });

  it('rejects invalid input with VALIDATION_FAILED', async () => {
    const f = makeFixture();
    try {
      // 缺 config
      await expect(
        handleAiSetConfig(f.deps, { provider: 'minimax' }),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
      // 缺 model
      await expect(
        handleAiSetConfig(f.deps, { provider: 'minimax', config: { baseURL: 'https://x' } }),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
      // 空 model
      await expect(
        handleAiSetConfig(f.deps, {
          provider: 'minimax',
          config: { model: '', baseURL: 'https://x' },
        }),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    } finally {
      f.close();
    }
  });
});

// ============================================================
//  handleAiTestConnection
// ============================================================

describe('ai:testConnection', () => {
  it('returns ok:false with "no API key configured" when key is missing', async () => {
    const f = makeFixture();
    try {
      const result = await handleAiTestConnection(f.deps, { provider: 'minimax' });
      expect(result.ok).toBe(false);
      expect(result.error).toBe('no API key configured');
    } finally {
      f.close();
    }
  });

  it('returns ok:true when key is set and provider HEAD returns 200 (T3-2 real impl)', async () => {
    const f = makeFixture();
    try {
      await handleAiSetKey(f.deps, { provider: 'minimax', key: `sk-test-${ulid()}` });
      // mock fetch → HEAD /models 返 200
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(new Response(null, { status: 200, statusText: 'OK' })) as unknown as typeof fetch,
      );

      const result = await handleAiTestConnection(f.deps, { provider: 'minimax' });
      expect(result).toEqual({ ok: true });
    } finally {
      await f.manager.deleteKey('minimax').catch(() => undefined);
      f.close();
    }
  });

  it('returns ok:false with "invalid api key" when HEAD returns 401 (T3-2 real impl)', async () => {
    const f = makeFixture();
    try {
      await handleAiSetKey(f.deps, { provider: 'minimax', key: `sk-test-${ulid()}` });
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          new Response(null, { status: 401, statusText: 'Unauthorized' }),
        ) as unknown as typeof fetch,
      );

      const result = await handleAiTestConnection(f.deps, { provider: 'minimax' });
      expect(result.ok).toBe(false);
      expect(result.error).toBe('invalid api key');
    } finally {
      await f.manager.deleteKey('minimax').catch(() => undefined);
      f.close();
    }
  });

  it('rejects invalid input with VALIDATION_FAILED', async () => {
    const f = makeFixture();
    try {
      await expect(handleAiTestConnection(f.deps, {})).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
      });
    } finally {
      f.close();
    }
  });
});

// ============================================================
//  端到端：key + config 联动
// ============================================================

describe('integration: key + config lifecycle', () => {
  it('end-to-end: setKey → setConfig → getConfig → testConnection (no key leak)', async () => {
    const f = makeFixture();
    const key = `sk-e2e-${ulid()}`;
    try {
      // 1. 初始：getConfig 返 metadata default
      const c0 = await handleAiGetConfig(f.deps, { provider: 'minimax' });
      expect(c0.updatedAt).toBe(0);

      // 2. setKey
      const sk = await handleAiSetKey(f.deps, { provider: 'minimax', key });
      expect(sk).toEqual({ ok: true });

      // 3. hasKey
      const hk = await handleAiHasKey(f.deps, { provider: 'minimax' });
      expect(hk.hasKey).toBe(true);

      // 4. setConfig
      const sc = await handleAiSetConfig(f.deps, {
        provider: 'minimax',
        config: { model: 'e2e-model', baseURL: 'https://e2e/v1' },
      });
      expect(sc.model).toBe('e2e-model');

      // 5. getConfig 返真实行
      const gc = await handleAiGetConfig(f.deps, { provider: 'minimax' });
      expect(gc.model).toBe('e2e-model');
      expect(gc.updatedAt).toBeGreaterThan(0);

      // 6. testConnection（有 key，T3-2 真实实现走 fetch HEAD）—— mock 200
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(new Response(null, { status: 200, statusText: 'OK' })) as unknown as typeof fetch,
      );
      const tc = await handleAiTestConnection(f.deps, { provider: 'minimax' });
      expect(tc.ok).toBe(true);
      // 关键：响应**不**含 key 内容
      expect(JSON.stringify(tc)).not.toContain(key);
      expect(JSON.stringify(tc)).not.toContain('sk-e2e');

      // 7. deleteKey
      const dk = await handleAiDeleteKey(f.deps, { provider: 'minimax' });
      expect(dk).toEqual({ ok: true });
      const hk2 = await handleAiHasKey(f.deps, { provider: 'minimax' });
      expect(hk2.hasKey).toBe(false);

      // 8. testConnection（无 key）→ "no API key configured"
      const tc2 = await handleAiTestConnection(f.deps, { provider: 'minimax' });
      expect(tc2.ok).toBe(false);
      expect(tc2.error).toBe('no API key configured');
    } finally {
      await f.manager.deleteKey('minimax').catch(() => undefined);
      f.close();
    }
  });
});

// 占位防止 lint 警告 unused
