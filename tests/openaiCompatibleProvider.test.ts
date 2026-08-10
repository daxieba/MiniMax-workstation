/**
 * `OpenAICompatibleProvider` 端到端测试（T3-2 适配器）
 *
 * 与 minimaxProvider.test.ts 对称：
 *   - factory + registry 协同
 *   - metadata 字段正确（OpenAI 官方默认值）
 *   - chat 走 OpenAI 官方 baseURL（`https://api.openai.com/v1/chat/completions`）
 *   - chat 从 key 装载器拿（FakeCredentialManager 内存存储，避免 OS keyring 锁竞争）
 *   - 无 key 时产 DEPENDENCY_MISSING
 *   - testConnection 走 `/models`
 *   - **关键安全**：URL 不含 key
 *
 * **不**用真 keyring：跨文件并发下 OS Credential Manager 锁竞争会让
 * setKey → getKey 看不到 key（flaky）。真 keyring 行为由
 * tests/credentialManager.test.ts 覆盖。
 *
 * @see electron/main/providers/openaiCompatibleProvider.ts
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ulid } from 'ulidx';

import { CredentialManager } from '../electron/main/credentials/credentialManager';
import { createProviders } from '../electron/main/providers/factory';
import { getProvider, listProviders } from '../electron/main/providers/registry';
import type { ChatChunk, ProviderId } from '../shared/types/ai';

/**
 * 内存版 CredentialManager：避免跨文件并发时 OS Credential Manager
 * 锁竞争导致 setKey → getKey 看不到 key 的 flake。
 * 继承真类只为类型兼容（private 方法不需实现）。
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

let testService: string;
let manager: FakeCredentialManager;

beforeEach(() => {
  // 静默 re-register warning（多个测试 / 多个文件共用 registry 模块单例）
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  testService = `minimax-workstation-test-${ulid().toLowerCase()}`;
  manager = new FakeCredentialManager(testService);
});

afterEach(async () => {
  // 内存 store 每个 test 重建（FakeCredentialManager 不需要显式 deleteKey）
  await manager.deleteKey('openai-compatible').catch(() => undefined);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ============================================================
//  factory + registry
// ============================================================

describe('OpenAICompatibleProvider (factory registration)', () => {
  it('createProviders registers a non-placeholder OpenAI-compatible adapter', () => {
    const { openaiCompatible } = createProviders({ credentialManager: manager });
    expect(openaiCompatible).toBeDefined();
    expect(openaiCompatible.metadata.id).toBe('openai-compatible');

    const fromRegistry = getProvider('openai-compatible');
    expect(fromRegistry).toBe(openaiCompatible);
  });

  it('listProviders contains both adapters', () => {
    createProviders({ credentialManager: manager });
    const ids = listProviders().map((m) => m.id);
    expect(ids).toContain('minimax');
    expect(ids).toContain('openai-compatible');
  });

  it('OpenAI-compatible metadata has expected fields', () => {
    const { openaiCompatible } = createProviders({ credentialManager: manager });
    expect(openaiCompatible.metadata).toEqual({
      id: 'openai-compatible',
      displayName: 'OpenAI Compatible',
      defaultModel: 'gpt-4o-mini',
      defaultBaseURL: 'https://api.openai.com/v1',
      docsUrl: 'https://platform.openai.com/api-keys',
    });
  });

  it('class name is OpenAICompatibleProvider', () => {
    const { openaiCompatible } = createProviders({ credentialManager: manager });
    expect(openaiCompatible.constructor.name).toBe('OpenAICompatibleProvider');
  });
});

// ============================================================
//  chat
// ============================================================

describe('OpenAICompatibleProvider.chat', () => {
  it('calls POST {openai baseURL}/chat/completions', async () => {
    const { openaiCompatible } = createProviders({ credentialManager: manager });
    await manager.setKey('openai-compatible', 'sk-openai-test-67890');

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller): void {
            controller.enqueue(new TextEncoder().encode('data: {"choices":[{"index":0,"delta":{"content":"ok"}}]}\n\n'));
            controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
            controller.close();
          },
        }),
        { status: 200, headers: { 'content-type': 'text/event-stream' } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const out: ChatChunk[] = [];
    for await (const c of openaiCompatible.chat({ messages: [{ role: 'user', content: 'hi' }] })) out.push(c);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer sk-openai-test-67890');
    expect(headers['Content-Type']).toBe('application/json');
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('gpt-4o-mini');
    expect(body.stream).toBe(true);
    // 关键：URL 不含 key
    expect(url).not.toContain('sk-openai-test-67890');

    expect(out.some((c) => c.type === 'token')).toBe(true);
    expect(out[out.length - 1]?.type).toBe('done');
  });

  it('emits DEPENDENCY_MISSING when no key configured', async () => {
    const { openaiCompatible } = createProviders({ credentialManager: manager });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const out: ChatChunk[] = [];
    for await (const c of openaiCompatible.chat({ messages: [{ role: 'user', content: 'hi' }] })) out.push(c);

    expect(out[0]?.type).toBe('error');
    if (out[0]?.type === 'error') {
      expect(out[0].error.code).toBe('DEPENDENCY_MISSING');
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses input.model override when provided', async () => {
    const { openaiCompatible } = createProviders({ credentialManager: manager });
    await manager.setKey('openai-compatible', 'sk-test');

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

    const out: ChatChunk[] = [];
    for await (const c of openaiCompatible.chat({
      messages: [{ role: 'user', content: 'hi' }],
      model: 'gpt-4o',
      temperature: 0.7,
    })) out.push(c);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('gpt-4o');
    expect(body.temperature).toBe(0.7);
    expect(out[out.length - 1]?.type).toBe('done');
  });
});

// ============================================================
//  testConnection
// ============================================================

describe('OpenAICompatibleProvider.testConnection', () => {
  it('uses HEAD against OpenAI baseURL/models', async () => {
    const { openaiCompatible } = createProviders({ credentialManager: manager });
    await manager.setKey('openai-compatible', 'sk-test');

    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200, statusText: 'OK' }));
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const result = await openaiCompatible.testConnection();
    expect(result).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.openai.com/v1/models');
    expect(init.method).toBe('HEAD');
  });

  it('returns ok:false with "no API key configured" when no key', async () => {
    const { openaiCompatible } = createProviders({ credentialManager: manager });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const result = await openaiCompatible.testConnection();
    expect(result).toEqual({ ok: false, error: 'no API key configured' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
