/**
 * `MiniMaxProvider` 端到端测试（T3-2 适配器）
 *
 * 覆盖：
 *   - factory + registry 协同：createProviders + getProvider('minimax') 拿到的不是占位
 *   - metadata 字段正确（id / displayName / defaultModel / defaultBaseURL / docsUrl）
 *   - chat 调用走 MiniMax baseURL（`https://api.minimax.chat/v1/chat/completions`）
 *   - chat 从 key 装载器拿（FakeCredentialManager 内存存储，避免 OS keyring 锁竞争）
 *   - 无 key 时产 DEPENDENCY_MISSING error chunk
 *   - testConnection 走 MiniMax /models
 *   - **关键安全**：Authorization header = `Bearer <key>`，URL 不含 key
 *
 * **不**用真 keyring：跨文件并发下 OS Credential Manager 锁竞争会让
 * setKey → getKey 看不到 key（flaky）。真 keyring 行为由
 * tests/credentialManager.test.ts 覆盖。
 * **mock fetch**：覆盖全局 fetch 验证 URL / method / body。
 *
 * @see electron/main/providers/minimaxProvider.ts
 * @see electron/main/providers/factory.ts
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ulid } from 'ulidx';

import { CredentialManager } from '../electron/main/credentials/credentialManager';
import { createProviders } from '../electron/main/providers/factory';
import { getProvider, listProviders } from '../electron/main/providers/registry';
import type { ChatChunk, ProviderId } from '../shared/types/ai';

// ============================================================
//  test fixture
// ============================================================

/**
 * 内存版 CredentialManager：避免跨文件并发时 OS Credential Manager
 * 锁竞争导致 setKey → getKey 看不到 key 的 flake。真 keyring 行为由
 * tests/credentialManager.test.ts 覆盖。
 *
 * 继承真 CredentialManager 只是为了类型兼容（private 方法不需要实现）；
 * 所有 public 方法都被 override 成纯内存操作。
 */
class FakeCredentialManager extends CredentialManager {
  private readonly store = new Map<string, string>();

  public override async getKey(provider: ProviderId): Promise<string | null> {
    return this.store.get(this.accountFor(provider)) ?? null;
  }

  public override async setKey(provider: ProviderId, key: string): Promise<void> {
    if (typeof key !== 'string' || key.length === 0) {
      throw new Error('invalid-key');
    }
    this.store.set(this.accountFor(provider), key);
  }

  public override async hasKey(provider: ProviderId): Promise<boolean> {
    const key = await this.getKey(provider);
    return key !== null && key.length > 0;
  }

  public override async deleteKey(provider: ProviderId): Promise<void> {
    this.store.delete(this.accountFor(provider));
  }
}

/** 每次测试用独立的 service 名（隔离 provider / app 自己的 keyring） */
let testService: string;
/** 每次测试用独立的 FakeCredentialManager（不触 OS keyring） */
let manager: FakeCredentialManager;

beforeEach(() => {
  // 静默 re-register warning（多个测试 / 多个文件共用 registry 模块单例）
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  testService = `minimax-workstation-test-${ulid().toLowerCase()}`;
  manager = new FakeCredentialManager(testService);
});

afterEach(async () => {
  // 清理：内存 store 每个 test 重建（FakeCredentialManager 不需要显式 deleteKey）
  await manager.deleteKey('minimax').catch(() => undefined);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ============================================================
//  factory + registry
// ============================================================

describe('MiniMaxProvider (factory registration)', () => {
  it('createProviders registers a non-placeholder MiniMax adapter', () => {
    const { minimax } = createProviders({ credentialManager: manager });
    expect(minimax).toBeDefined();
    expect(minimax.metadata.id).toBe('minimax');

    // registry 也能拿到
    const fromRegistry = getProvider('minimax');
    expect(fromRegistry).toBe(minimax);
  });

  it('listProviders contains both real adapters in correct order', () => {
    createProviders({ credentialManager: manager });
    const list = listProviders();
    expect(list.map((m) => m.id)).toEqual(['minimax', 'openai-compatible']);
  });

  it('MiniMax metadata has expected fields', () => {
    const { minimax } = createProviders({ credentialManager: manager });
    expect(minimax.metadata).toEqual({
      id: 'minimax',
      displayName: 'MiniMax',
      defaultModel: 'MiniMax-M2',
      defaultBaseURL: 'https://api.minimax.chat/v1',
      docsUrl: 'https://api.minimax.chat/',
    });
  });

  it('class name is MiniMaxProvider (not PlaceholderAdapter)', () => {
    const { minimax } = createProviders({ credentialManager: manager });
    expect(minimax.constructor.name).toBe('MiniMaxProvider');
  });
});

// ============================================================
// ============================================================
//  chat（mock fetch + 内存版 FakeCredentialManager）
// ============================================================

describe('MiniMaxProvider.chat', () => {
  it('calls POST {minimax baseURL}/chat/completions', async () => {
    const { minimax } = createProviders({ credentialManager: manager });
    await manager.setKey('minimax', 'sk-minimax-test-12345');

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller): void {
            controller.enqueue(new TextEncoder().encode('data: {"choices":[{"index":0,"delta":{"content":"hi"}}]}\n\n'));
            controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
            controller.close();
          },
        }),
        { status: 200, headers: { 'content-type': 'text/event-stream' } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const out: ChatChunk[] = [];
    for await (const c of minimax.chat({ messages: [{ role: 'user', content: 'hello' }] })) out.push(c);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.minimax.chat/v1/chat/completions');
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer sk-minimax-test-12345');
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['Accept']).toBe('text/event-stream');
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('MiniMax-M2');
    expect(body.messages).toEqual([{ role: 'user', content: 'hello' }]);
    expect(body.stream).toBe(true);
    // 关键：URL 不含 key
    expect(url).not.toContain('sk-minimax-test-12345');

    // 流式 chunk
    expect(out.some((c) => c.type === 'token')).toBe(true);
    expect(out[out.length - 1]?.type).toBe('done');
  });

  it('emits DEPENDENCY_MISSING error when no key configured', async () => {
    const { minimax } = createProviders({ credentialManager: manager });
    // 无 setKey
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const out: ChatChunk[] = [];
    for await (const c of minimax.chat({ messages: [{ role: 'user', content: 'hi' }] })) out.push(c);

    expect(out).toHaveLength(1);
    expect(out[0]?.type).toBe('error');
    if (out[0]?.type === 'error') {
      expect(out[0].error.code).toBe('DEPENDENCY_MISSING');
      expect(out[0].error.message).toBe('no API key configured');
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reads key from credentialManager lazily (not at construction time)', async () => {
    const { minimax } = createProviders({ credentialManager: manager });
    // 构造时**不**应读 key
    expect(await manager.hasKey('minimax')).toBe(false);

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller): void {
            controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
            controller.close();
          },
        }),
        { status: 200, headers: { 'content-type': 'text/event-stream' } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    // 第一次 chat 时还没 key
    const out1: ChatChunk[] = [];
    for await (const c of minimax.chat({ messages: [{ role: 'user', content: 'hi' }] })) out1.push(c);
    expect(out1[0]?.type).toBe('error');

    // setKey 后第二次 chat 能拿到 key
    await manager.setKey('minimax', 'sk-late-key');
    const out2: ChatChunk[] = [];
    for await (const c of minimax.chat({ messages: [{ role: 'user', content: 'hi' }] })) out2.push(c);
    expect(out2[out2.length - 1]?.type).toBe('done');
  });
});

// ============================================================
// ============================================================
//  testConnection（mock fetch + 内存版 FakeCredentialManager）
// ============================================================

describe('MiniMaxProvider.testConnection', () => {
  it('uses HEAD against minimax baseURL/models', async () => {
    const { minimax } = createProviders({ credentialManager: manager });
    await manager.setKey('minimax', 'sk-test');

    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200, statusText: 'OK' }));
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const result = await minimax.testConnection();
    expect(result).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.minimax.chat/v1/models');
    expect(init.method).toBe('HEAD');
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer sk-test');
  });

  it('returns ok:false with "no API key configured" when no key', async () => {
    const { minimax } = createProviders({ credentialManager: manager });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const result = await minimax.testConnection();
    expect(result).toEqual({ ok: false, error: 'no API key configured' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns ok:false with "invalid api key" on 401', async () => {
    const { minimax } = createProviders({ credentialManager: manager });
    await manager.setKey('minimax', 'sk-bad');

    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 401, statusText: 'Unauthorized' }));
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const result = await minimax.testConnection();
    expect(result).toEqual({ ok: false, error: 'invalid api key' });
  });
});
