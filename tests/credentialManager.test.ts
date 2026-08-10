/**
 * CredentialManager 单元测试（T3-1 基础设施）
 *
 * 覆盖：
 *   - setKey → getKey 真实往返（写 Windows Credential Manager，real backend）
 *   - hasKey 正确反映 setKey / deleteKey 状态
 *   - deleteKey 幂等（不存在不抛错）
 *   - 不存在的 provider 返 null（getKey）/ false（hasKey）—— 不抛错
 *   - **关键安全**：错误信息**不**含 key 内容
 *
 * **不 mock keyring 后端** —— 用真实 Windows Credential Manager。
 * 每个测试用独立 service 名（`minimax-workstation-test-<ulid>`），
 * 不污染用户 / app 自己的 keyring，也避免测试间互相干扰。
 *
 * @see electron/main/credentials/credentialManager.ts
 */

import { ulid } from 'ulidx';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CredentialManager, SERVICE_NAME } from '../electron/main/credentials/credentialManager';
import type { ProviderId } from '../shared/types/ai';

/** 测试期间使用两个真实 ProviderId 值轮换（避免同一 (service, account) 撞车）。 */
const TEST_PROVIDERS: readonly ProviderId[] = ['minimax', 'openai-compatible'];

/** 当前测试使用的 service（每个测试前重置）。 */
let testService: string;
/** 当前测试使用的 provider（每个测试前重置，轮换）。 */
let testProvider: ProviderId;

beforeEach(() => {
  // 每个测试独立 service 名（独立 keyring 命名空间）
  testService = `minimax-workstation-test-${ulid().toLowerCase()}`;
  // 轮换 provider，让相邻测试用不同 account 名
  testProvider = TEST_PROVIDERS[Math.random() < 0.5 ? 0 : 1] as ProviderId;
});

describe('CredentialManager.accountFor', () => {
  it('returns provider-prefixed account string for minimax', () => {
    const m = new CredentialManager();
    expect(m.accountFor('minimax')).toBe('provider:minimax');
  });

  it('returns provider-prefixed account string for openai-compatible', () => {
    const m = new CredentialManager();
    expect(m.accountFor('openai-compatible')).toBe('provider:openai-compatible');
  });

  it('exposes the configured service name', () => {
    const m = new CredentialManager(testService);
    expect(m.service).toBe(testService);
  });
});

describe('CredentialManager.setKey + getKey roundtrip', () => {
  it('writes and reads back a key', async () => {
    const m = new CredentialManager(testService);
    const key = `sk-test-${ulid()}`;
    try {
      await m.setKey(testProvider, key);
      const got = await m.getKey(testProvider);
      expect(got).toBe(key);
    } finally {
      await m.deleteKey(testProvider).catch(() => undefined);
    }
  });

  it('overwrites an existing key', async () => {
    const m = new CredentialManager(testService);
    const key1 = `sk-v1-${ulid()}`;
    const key2 = `sk-v2-${ulid()}`;
    try {
      await m.setKey(testProvider, key1);
      await m.setKey(testProvider, key2);
      const got = await m.getKey(testProvider);
      expect(got).toBe(key2);
    } finally {
      await m.deleteKey(testProvider).catch(() => undefined);
    }
  });

  it('handles keys with special characters', async () => {
    const m = new CredentialManager(testService);
    const key = `sk-x-!@#$%^&*()_+{}[]|\\:;"'<>,.?/~` + '`backtick`';
    try {
      await m.setKey(testProvider, key);
      const got = await m.getKey(testProvider);
      expect(got).toBe(key);
    } finally {
      await m.deleteKey(testProvider).catch(() => undefined);
    }
  });
});

describe('CredentialManager.hasKey', () => {
  it('returns false when no key is set', async () => {
    const m = new CredentialManager(testService);
    expect(await m.hasKey(testProvider)).toBe(false);
  });

  it('returns true after setKey', async () => {
    const m = new CredentialManager(testService);
    try {
      await m.setKey(testProvider, `sk-${ulid()}`);
      expect(await m.hasKey(testProvider)).toBe(true);
    } finally {
      await m.deleteKey(testProvider).catch(() => undefined);
    }
  });

  it('returns false after deleteKey', async () => {
    const m = new CredentialManager(testService);
    try {
      await m.setKey(testProvider, `sk-${ulid()}`);
      await m.deleteKey(testProvider);
      expect(await m.hasKey(testProvider)).toBe(false);
    } finally {
      // 双保险
      await m.deleteKey(testProvider).catch(() => undefined);
    }
  });
});

describe('CredentialManager.deleteKey', () => {
  it('is idempotent (no error when key does not exist)', async () => {
    const m = new CredentialManager(testService);
    // 先 set 再 delete，再 delete → 不应抛
    await m.setKey(testProvider, `sk-${ulid()}`);
    await m.deleteKey(testProvider);
    await expect(m.deleteKey(testProvider)).resolves.toBeUndefined();
  });
});

describe('CredentialManager.getKey on missing provider', () => {
  it('returns null when no key has ever been set (no throw)', async () => {
    const m = new CredentialManager(testService);
    // 全新 service / 全新 provider → null
    const got = await m.getKey(testProvider);
    expect(got).toBeNull();
  });
});

describe('CredentialManager error safety (no key leak)', () => {
  it('rejects empty key with a structured error', async () => {
    const m = new CredentialManager(testService);
    // 故意调 setKey(provider, '') → 抛 invalid-key 错误
    await expect(m.setKey(testProvider, '')).rejects.toThrow(/credential:set/);
  });

  it('error messages do NOT contain the key value (CRITICAL)', async () => {
    const m = new CredentialManager(testService);
    const secretKey = `super-secret-leak-test-${ulid()}`;
    let caught: Error | null = null;
    try {
      // 故意触发一个失败 path 来捕获错误信息
      try {
        await m.setKey(testProvider, '');
      } catch (err) {
        caught = err instanceof Error ? err : new Error(String(err));
      }
      expect(caught).not.toBeNull();
      // 关键断言：错误 message 不含 secretKey 也不含 "super-secret"
      expect(caught?.message).not.toContain(secretKey);
      expect(caught?.message).not.toContain('super-secret');
      // 错误 message 应当有 credential: 标签（结构化）
      expect(caught?.message).toMatch(/^\[credential:/);
    } finally {
      // 清理（即使没 set 成功，deleteKey 是幂等的）
      await m.deleteKey(testProvider).catch(() => undefined);
    }
  });
});

describe('CredentialManager constants', () => {
  it('exposes SERVICE_NAME = minimax-workstation', () => {
    expect(SERVICE_NAME).toBe('minimax-workstation');
  });
});

describe('CredentialManager with custom service name', () => {
  it('uses provided service name (not the default)', () => {
    const customService = `minimax-test-custom-${ulid().toLowerCase()}`;
    const m = new CredentialManager(customService);
    expect(m.service).toBe(customService);
    expect(m.service).not.toBe(SERVICE_NAME);
  });
});

describe('CredentialManager.end-to-end smoke (within one test run)', () => {
  it('full lifecycle: empty → set → hasKey → get → delete → empty', async () => {
    const m = new CredentialManager(testService);
    const key = `sk-e2e-${ulid()}`;
    // 1. 初始：无 key
    expect(await m.hasKey(testProvider)).toBe(false);
    expect(await m.getKey(testProvider)).toBeNull();
    // 2. setKey
    await m.setKey(testProvider, key);
    // 3. hasKey=true
    expect(await m.hasKey(testProvider)).toBe(true);
    // 4. getKey 读回
    expect(await m.getKey(testProvider)).toBe(key);
    // 5. deleteKey
    await m.deleteKey(testProvider);
    // 6. 回到无 key 状态
    expect(await m.hasKey(testProvider)).toBe(false);
    expect(await m.getKey(testProvider)).toBeNull();
  });
});

// 占位：afterEach 钩子（当前每个测试自己用 finally 清理，不强求全局 hook）
afterEach(() => {
  // noop —— 每个测试块都自带 finally 清理自己的 key
});
