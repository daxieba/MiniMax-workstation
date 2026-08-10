/**
 * Provider registry 单元测试（T3-1 基础设施 + T3-2 适配器）
 *
 * 覆盖：
 *   - 默认已注册两个真实 provider（MiniMax + OpenAI-compatible）
 *   - listProviders 返回 metadata 列表
 *   - getProvider 拿存在的 provider / 拿不存在的返 undefined
 *   - registerProvider 可注册自定义 provider（test 内部用）
 *   - getProviderMetadata 拿 metadata
 *   - listProviders 顺序：minimax → openai-compatible
 *
 * **T3-2 改动**：
 *   - 移除 `ensurePlaceholderProvidersRegistered`（已删除）
 *   - 改用 `createProviders` 注入真实 provider
 *   - 删除 "not implemented" 占位行为测试（已迁到 `openaiChatProvider.test.ts`）
 *
 * @see electron/main/providers/registry.ts
 * @see electron/main/providers/ProviderAdapter.ts
 * @see electron/main/providers/factory.ts
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ulid } from 'ulidx';

import { CredentialManager } from '../electron/main/credentials/credentialManager';
import { MiniMaxProvider } from '../electron/main/providers/minimaxProvider';
import { OpenAICompatibleProvider } from '../electron/main/providers/openaiCompatibleProvider';
import {
  type ProviderAdapter,
} from '../electron/main/providers/ProviderAdapter';
import { createProviders } from '../electron/main/providers/factory';
import {
  getProvider,
  getProviderMetadata,
  listProviders,
  registerProvider,
} from '../electron/main/providers/registry';
import type { ChatChunk, ProviderId, ProviderMetadata } from '../shared/types/ai';

// ============================================================
//  真实 provider 注册（每个 test 前重新初始化）
// ============================================================
// 解决：registry 是模块级单例，测试间会污染。
// 每个 test 构造独立 CredentialManager（独立 service 名）→ createProviders 重新注册。

beforeEach(() => {
  // 静默 re-register warning（多次调用 createProviders 会有重复注册，但测试隔离需要）
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const manager = new CredentialManager(`minimax-workstation-test-${ulid().toLowerCase()}`);
  createProviders({ credentialManager: manager });
});

// ============================================================
//  真实 provider
// ============================================================

describe('registry.real providers', () => {
  it('has both minimax and openai-compatible registered by default', () => {
    const ids = listProviders().map((m) => m.id).sort();
    expect(ids).toEqual(['minimax', 'openai-compatible']);
  });

  it('minimax metadata has expected fields', () => {
    const meta = getProviderMetadata('minimax');
    expect(meta).toBeDefined();
    expect(meta?.id).toBe('minimax');
    expect(meta?.displayName).toBe('MiniMax');
    expect(meta?.defaultModel).toBe('MiniMax-M2');
    expect(meta?.defaultBaseURL).toBe('https://api.minimax.chat/v1');
    expect(typeof meta?.docsUrl).toBe('string');
  });

  it('openai-compatible metadata has expected fields', () => {
    const meta = getProviderMetadata('openai-compatible');
    expect(meta).toBeDefined();
    expect(meta?.id).toBe('openai-compatible');
    expect(meta?.displayName).toBe('OpenAI Compatible');
    expect(meta?.defaultModel).toBe('gpt-4o-mini');
    expect(meta?.defaultBaseURL).toBe('https://api.openai.com/v1');
    expect(typeof meta?.docsUrl).toBe('string');
  });

  it('getProvider returns the adapter for known provider', () => {
    const a = getProvider('minimax');
    expect(a).toBeDefined();
    expect(a?.metadata.id).toBe('minimax');
  });

  it('getProvider returns undefined for unknown provider id', () => {
    // 类型层面 ProviderId 是 union，但 runtime 可能传非法值
    const got = getProvider('nope' as unknown as ProviderId);
    expect(got).toBeUndefined();
  });

  it('getProvider("minimax") returns a real MiniMaxProvider instance (T3-2 not placeholder)', () => {
    // T3-2：registry 里的 minimax 必须是 MiniMaxProvider 真实例，
    // 不是 T3-1 阶段的 BaseProviderAdapter 占位。
    const a = getProvider('minimax');
    expect(a).toBeDefined();
    expect(a).toBeInstanceOf(MiniMaxProvider);
  });

  it('getProvider("openai-compatible") returns a real OpenAICompatibleProvider instance (T3-2 not placeholder)', () => {
    // T3-2：registry 里的 openai-compatible 必须是 OpenAICompatibleProvider 真实例。
    const a = getProvider('openai-compatible');
    expect(a).toBeDefined();
    expect(a).toBeInstanceOf(OpenAICompatibleProvider);
  });
});

// ============================================================
//  自定义 provider 注册（验证 registerProvider 行为）
// ============================================================

describe('registry.registerProvider', () => {
  it('registers a new provider with custom metadata (overrides existing)', () => {
    const customMeta: ProviderMetadata = {
      id: 'minimax', // 用 'minimax' 这个合法 id 来测试覆盖
      displayName: 'Custom Override',
      defaultModel: 'custom-model',
      defaultBaseURL: 'https://custom.example/v1',
    };
    const customAdapter: ProviderAdapter = {
      metadata: customMeta,
      chat(): AsyncIterable<ChatChunk> {
        return {
          [Symbol.asyncIterator](): AsyncIterator<ChatChunk> {
            const err = new Error('custom chat');
            return {
              async next(): Promise<IteratorResult<ChatChunk>> {
                throw err;
              },
            };
          },
        };
      },
      async testConnection() {
        return { ok: true };
      },
      extractJson() {
        return Promise.reject(new Error('custom extractJson'));
      },
    };
    registerProvider(customAdapter);
    const got = getProvider('minimax');
    expect(got?.metadata.displayName).toBe('Custom Override');
    expect(got?.metadata.defaultModel).toBe('custom-model');
    // 验证 listProviders 包含覆盖后的版本
    const minimax = listProviders().find((m) => m.id === 'minimax');
    expect(minimax?.displayName).toBe('Custom Override');
  });

  it('registered provider chat() can be called', async () => {
    // 用合法 id 覆盖
    const customAdapter: ProviderAdapter = {
      metadata: {
        id: 'openai-compatible',
        displayName: 'Test',
        defaultModel: 'x',
        defaultBaseURL: 'https://x',
      },
      chat(): AsyncIterable<ChatChunk> {
        return {
          [Symbol.asyncIterator](): AsyncIterator<ChatChunk> {
            const err = new Error('custom-e2e-chat');
            return {
              async next(): Promise<IteratorResult<ChatChunk>> {
                throw err;
              },
            };
          },
        };
      },
      async testConnection() {
        return { ok: true };
      },
      extractJson() {
        return Promise.reject(new Error('custom-e2e-extract'));
      },
    };
    registerProvider(customAdapter);
    const a = getProvider('openai-compatible');
    expect(a).toBe(customAdapter);
    const iter = a!.chat({ messages: [{ role: 'user', content: 'hi' }] })[Symbol.asyncIterator]();
    await expect(iter.next()).rejects.toThrow('custom-e2e-chat');
  });
});

describe('registry.listProviders order', () => {
  it('returns providers in registration order (Map preserves insertion)', () => {
    const list = listProviders();
    expect(list.length).toBe(2);
    // 默认注册顺序：minimax 在前（factory.createProviders 的顺序）
    expect(list[0]?.id).toBe('minimax');
    expect(list[1]?.id).toBe('openai-compatible');
  });
});

// ============================================================
//  重复 createProviders 调用（registry 替换语义）
// ============================================================

describe('registry.repeated createProviders', () => {
  it('re-registering the same provider ids replaces the adapter (no throw, getProvider still works)', () => {
    // 第一次注册（beforeEach 已做过一次）→ 拿 adapter A
    const before = getProvider('minimax');
    expect(before).toBeInstanceOf(MiniMaxProvider);

    // 第二次 createProviders：传新 manager → 应该**替换**而不是抛错
    // （registry.registerProvider 同 id 走 Map.set 覆盖 + warning，不抛）
    const otherManager = new CredentialManager(
      `minimax-workstation-test-${ulid().toLowerCase()}`,
    );
    expect(() => createProviders({ credentialManager: otherManager })).not.toThrow();

    // 替换后 getProvider 仍返有效 adapter（且 class 不变）
    const after = getProvider('minimax');
    expect(after).toBeDefined();
    expect(after).toBeInstanceOf(MiniMaxProvider);
    // getProviderMetadata 仍可用
    const meta = getProviderMetadata('openai-compatible');
    expect(meta?.id).toBe('openai-compatible');
    expect(meta?.defaultBaseURL).toBe('https://api.openai.com/v1');
  });
});
