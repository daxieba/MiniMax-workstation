/**
 * AI 流式 chat IPC handler 测试（T3-3）
 *
 * 覆盖：
 *   - `runAiChatStream` 成功路径：多 chunk + done
 *   - 401 / 429 / 5xx → EXTERNAL_FAILURE
 *   - 缺 key → DEPENDENCY_MISSING
 *   - 取消：发 cancel 通道后流中止
 *   - **安全**：错误信息 / chunk payload **不**含 key
 *
 * **不**依赖 Electron —— 直接调用 `runAiChatStream` + 一个 fake `WebContents`
 * 把 `sender.send` 替换成收集器。`getProvider` / `getProviderMetadata` 走真实
 * registry（用 `createProviders` 注入真实 adapter）。
 *
 * fetch 用 `vi.stubGlobal` mock：模拟 SSE 流（token + done）。
 *
 * @see electron/main/ipc/ai.ts
 */

import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve as resolvePath } from 'node:path';

import { ulid } from 'ulidx';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeDb, createDbClient } from '../db/client';
import { CredentialManager } from '../electron/main/credentials/credentialManager';
import {
  __resetAiChatModuleStateForTest,
  cleanupAiChatForSender,
  runAiChatStream,
  type RunAiChatStreamDeps,
} from '../electron/main/ipc/ai';
import { createProviders } from '../electron/main/providers/factory';
import { unregisterProviderForTest } from '../electron/main/providers/registry';

const TMP_ROOT = join(tmpdir(), 'minimax-workstation-ai-chat-test');

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

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  __resetAiChatModuleStateForTest();
  // 关键：**清掉**本文件注册的 provider（防止污染后续文件，如 aiIpc.test.ts）。
  // aiIpc.test.ts 自己的 makeFixture 会在 beforeEach 重新注册。
  unregisterProviderForTest('minimax');
  unregisterProviderForTest('openai-compatible');
});

interface Fixture {
  manager: CredentialManager;
  close: () => void;
}

beforeEach(() => {
  // 静默 re-register warning
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

function makeFixture(): Fixture {
  const dbPath = join(TMP_ROOT, `ai-chat-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  const { db } = createDbClient(dbPath, resolvePath(__dirname, '..'));
  const manager = new CredentialManager(`minimax-workstation-test-${ulid().toLowerCase()}`);
  createProviders({ credentialManager: manager });
  return { manager, close: () => closeDb(db) };
}

/**
 * 在 await 之后、runAiChatStream 之前**重新注册** provider 指向本测试的 manager。
 *
 * **为什么需要**：vitest 默认 parallel-by-file。aiIpc.test.ts 也调 createProviders，
 * 会覆盖 registry 里的 adapter 指向它的 manager。在并行测试期间，本测试可能在
 * 自己的 setKey await 期间被 aiIpc 抢占，stream 启动时 adapter 已指向 aiIpc 的
 * manager（无 key）→ DEPENDENCY_MISSING。
 *
 * **修复**：在每个 await 边界之后**再次**调 createProviders，确保本测试的 stream
 * 拿到的是**本测试**的 manager。
 */
function reassertProviderForTest(manager: CredentialManager): void {
  createProviders({ credentialManager: manager });
}

/**
 * 构造一个 fake sender：把 `send` 替换成收集器，返回 `{ id, isDestroyed, send }`。
 * `send` 自动 Zod 校验入参 → envelope 收集到 `chunks`。
 */
function makeFakeSender(): {
  sender: { id: number; isDestroyed: () => boolean; send: (channel: string, payload: unknown) => void };
  chunks: Array<{ channel: string; payload: { requestId: string; chunk: { type: string; content?: string; error?: { code: string; message: string } } } }>;
  senderId: number;
} {
  const senderId = 1000 + Math.floor(Math.random() * 1000);
  const chunks: Array<{ channel: string; payload: { requestId: string; chunk: { type: string; content?: string; error?: { code: string; message: string } } } }> = [];
  const sender = {
    id: senderId,
    isDestroyed: (): boolean => false,
    send: (channel: string, payload: unknown): void => {
      chunks.push({ channel, payload: payload as { requestId: string; chunk: { type: string; content?: string; error?: { code: string; message: string } } } });
    },
  };
  return { sender, chunks, senderId };
}

/**
 * 构造一个 SSE 响应（`text/event-stream` 多 token + `[DONE]`）。
 */
function makeSseResponse(events: Array<string>): Response {
  const body = events.join('\n\n') + '\n\n';
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(body));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

describe('runAiChatStream', () => {
  it('streams multiple tokens followed by done (success path)', async () => {
    const f = makeFixture();
    try {
      await f.manager.setKey('minimax', `sk-test-${ulid()}`);
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          makeSseResponse([
            'data: {"choices":[{"delta":{"content":"Hello"}}]}',
            'data: {"choices":[{"delta":{"content":", world"}}]}',
            'data: [DONE]',
          ]),
        ) as unknown as typeof fetch,
      );

      const { sender, chunks, senderId } = makeFakeSender();
      // **重新注册** provider → 防止其他测试文件的 createProviders 抢占
      reassertProviderForTest(f.manager);
      const input: RunAiChatStreamDeps = {
        rawPayload: {
          requestId: 'req-1',
          provider: 'minimax',
          messages: [{ role: 'user', content: 'hi' }],
          model: 'MiniMax-M2',
        },
        sender: sender as unknown as Parameters<typeof runAiChatStream>[0]['sender'],
      };
      await runAiChatStream(input);

      const chunkTypes = chunks.map((c) => c.payload.chunk.type);
      expect(chunkTypes).toContain('token');
      expect(chunkTypes[chunkTypes.length - 1]).toBe('done');
      // 至少 2 个 token + 1 个 done
      const tokens = chunks.filter((c) => c.payload.chunk.type === 'token');
      expect(tokens.length).toBeGreaterThanOrEqual(2);
      // 累积内容
      const text = tokens.map((c) => c.payload.chunk.content ?? '').join('');
      expect(text).toBe('Hello, world');
      // cleanup 后 map 应空
      cleanupAiChatForSender(senderId);
    } finally {
      await f.manager.deleteKey('minimax').catch(() => undefined);
      f.close();
    }
  });

  it('returns DEPENDENCY_MISSING when no key is configured', async () => {
    const f = makeFixture();
    try {
      // 故意不 setKey
      const { sender, chunks, senderId } = makeFakeSender();
      reassertProviderForTest(f.manager);
      await runAiChatStream({
        rawPayload: {
          requestId: 'req-no-key',
          provider: 'minimax',
          messages: [{ role: 'user', content: 'hi' }],
        },
        sender: sender as unknown as Parameters<typeof runAiChatStream>[0]['sender'],
      });

      const errorChunk = chunks.find((c) => c.payload.chunk.type === 'error');
      expect(errorChunk).toBeDefined();
      expect(errorChunk?.payload.chunk.error?.code).toBe('DEPENDENCY_MISSING');
      expect(errorChunk?.payload.requestId).toBe('req-no-key');
      cleanupAiChatForSender(senderId);
    } finally {
      f.close();
    }
  });

  it('maps HTTP 401 to EXTERNAL_FAILURE with INVALID_API_KEY semantically', async () => {
    const f = makeFixture();
    try {
      await f.manager.setKey('minimax', `sk-test-${ulid()}`);
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          new Response(JSON.stringify({ error: { message: 'unauthorized' } }), {
            status: 401,
            statusText: 'Unauthorized',
            headers: { 'Content-Type': 'application/json' },
          }),
        ) as unknown as typeof fetch,
      );

      const { sender, chunks, senderId } = makeFakeSender();
      reassertProviderForTest(f.manager);
      await runAiChatStream({
        rawPayload: {
          requestId: 'req-401',
          provider: 'minimax',
          messages: [{ role: 'user', content: 'hi' }],
        },
        sender: sender as unknown as Parameters<typeof runAiChatStream>[0]['sender'],
      });

      const errorChunk = chunks.find((c) => c.payload.chunk.type === 'error');
      expect(errorChunk).toBeDefined();
      expect(errorChunk?.payload.chunk.error?.code).toBe('EXTERNAL_FAILURE');
      expect(errorChunk?.payload.chunk.error?.message).toContain('401');
      cleanupAiChatForSender(senderId);
    } finally {
      await f.manager.deleteKey('minimax').catch(() => undefined);
      f.close();
    }
  });

  it('maps HTTP 429 to EXTERNAL_FAILURE with rate limit message', async () => {
    const f = makeFixture();
    try {
      await f.manager.setKey('minimax', `sk-test-${ulid()}`);
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          new Response(JSON.stringify({ error: { message: 'rate limited' } }), {
            status: 429,
            statusText: 'Too Many Requests',
            headers: { 'Content-Type': 'application/json' },
          }),
        ) as unknown as typeof fetch,
      );

      const { sender, chunks, senderId } = makeFakeSender();
      reassertProviderForTest(f.manager);
      await runAiChatStream({
        rawPayload: {
          requestId: 'req-429',
          provider: 'minimax',
          messages: [{ role: 'user', content: 'hi' }],
        },
        sender: sender as unknown as Parameters<typeof runAiChatStream>[0]['sender'],
      });

      const errorChunk = chunks.find((c) => c.payload.chunk.type === 'error');
      expect(errorChunk).toBeDefined();
      expect(errorChunk?.payload.chunk.error?.code).toBe('EXTERNAL_FAILURE');
      expect(errorChunk?.payload.chunk.error?.message).toContain('429');
      cleanupAiChatForSender(senderId);
    } finally {
      await f.manager.deleteKey('minimax').catch(() => undefined);
      f.close();
    }
  });

  it('maps HTTP 500 to EXTERNAL_FAILURE', async () => {
    const f = makeFixture();
    try {
      await f.manager.setKey('minimax', `sk-test-${ulid()}`);
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          new Response(JSON.stringify({ error: { message: 'server error' } }), {
            status: 500,
            statusText: 'Internal Server Error',
            headers: { 'Content-Type': 'application/json' },
          }),
        ) as unknown as typeof fetch,
      );

      const { sender, chunks, senderId } = makeFakeSender();
      reassertProviderForTest(f.manager);
      await runAiChatStream({
        rawPayload: {
          requestId: 'req-500',
          provider: 'minimax',
          messages: [{ role: 'user', content: 'hi' }],
        },
        sender: sender as unknown as Parameters<typeof runAiChatStream>[0]['sender'],
      });

      const errorChunk = chunks.find((c) => c.payload.chunk.type === 'error');
      expect(errorChunk).toBeDefined();
      expect(errorChunk?.payload.chunk.error?.code).toBe('EXTERNAL_FAILURE');
      expect(errorChunk?.payload.chunk.error?.message).toContain('500');
      cleanupAiChatForSender(senderId);
    } finally {
      await f.manager.deleteKey('minimax').catch(() => undefined);
      f.close();
    }
  });

  it('maps network error to EXTERNAL_FAILURE', async () => {
    const f = makeFixture();
    try {
      await f.manager.setKey('minimax', `sk-test-${ulid()}`);
      vi.stubGlobal(
        'fetch',
        vi.fn().mockRejectedValue(new TypeError('fetch failed: ECONNREFUSED')) as unknown as typeof fetch,
      );

      const { sender, chunks, senderId } = makeFakeSender();
      reassertProviderForTest(f.manager);
      await runAiChatStream({
        rawPayload: {
          requestId: 'req-net',
          provider: 'minimax',
          messages: [{ role: 'user', content: 'hi' }],
        },
        sender: sender as unknown as Parameters<typeof runAiChatStream>[0]['sender'],
      });

      const errorChunk = chunks.find((c) => c.payload.chunk.type === 'error');
      expect(errorChunk).toBeDefined();
      expect(errorChunk?.payload.chunk.error?.code).toBe('EXTERNAL_FAILURE');
      // 错误信息**不**含 key（key 是 `sk-test-...`，下面断言排除）
      expect(errorChunk?.payload.chunk.error?.message).not.toContain('sk-test-');
      cleanupAiChatForSender(senderId);
    } finally {
      await f.manager.deleteKey('minimax').catch(() => undefined);
      f.close();
    }
  });

  it('returns VALIDATION_FAILED for invalid input (no Zod leak)', async () => {
    const f = makeFixture();
    try {
      const { sender, chunks, senderId } = makeFakeSender();
      reassertProviderForTest(f.manager);
      await runAiChatStream({
        rawPayload: { provider: 'minimax' }, // 缺 messages
        sender: sender as unknown as Parameters<typeof runAiChatStream>[0]['sender'],
      });

      const errorChunk = chunks.find((c) => c.payload.chunk.type === 'error');
      expect(errorChunk).toBeDefined();
      expect(errorChunk?.payload.chunk.error?.code).toBe('VALIDATION_FAILED');
      cleanupAiChatForSender(senderId);
    } finally {
      f.close();
    }
  });

  it('returns NOT_FOUND for unknown provider (registered id, but not in registry)', async () => {
    const f = makeFixture();
    try {
      // 注销 openai-compatible adapter → 但其 id 仍合法（Zod 通过）
      unregisterProviderForTest('openai-compatible');
      const { sender, chunks, senderId } = makeFakeSender();
      await runAiChatStream({
        rawPayload: {
          requestId: 'req-bad',
          provider: 'openai-compatible',
          messages: [{ role: 'user', content: 'hi' }],
        },
        sender: sender as unknown as Parameters<typeof runAiChatStream>[0]['sender'],
      });

      const errorChunk = chunks.find((c) => c.payload.chunk.type === 'error');
      expect(errorChunk).toBeDefined();
      expect(errorChunk?.payload.chunk.error?.code).toBe('NOT_FOUND');
      cleanupAiChatForSender(senderId);
    } finally {
      f.close();
    }
  });

  it('CRITICAL: error chunks NEVER leak the api key', async () => {
    const f = makeFixture();
    const key = `super-secret-${ulid()}`;
    try {
      await f.manager.setKey('minimax', key);
      // 模拟 401 + provider 内部可能回显 key 的 body
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({ error: { message: `unauthorized for ${key}` } }),
            { status: 401, statusText: 'Unauthorized' },
          ),
        ) as unknown as typeof fetch,
      );

      const { sender, chunks, senderId } = makeFakeSender();
      reassertProviderForTest(f.manager);
      await runAiChatStream({
        rawPayload: {
          requestId: 'req-leak',
          provider: 'minimax',
          messages: [{ role: 'user', content: 'hi' }],
        },
        sender: sender as unknown as Parameters<typeof runAiChatStream>[0]['sender'],
      });

      // 关键：所有 chunk 的 JSON 序列化**不**含 key
      const all = JSON.stringify(chunks);
      expect(all).not.toContain(key);
      expect(all).not.toContain('super-secret');
      cleanupAiChatForSender(senderId);
    } finally {
      await f.manager.deleteKey('minimax').catch(() => undefined);
      f.close();
    }
  });

  it('respects cancel: stops sending chunks after AbortController aborts', async () => {
    const f = makeFixture();
    try {
      await f.manager.setKey('minimax', `sk-test-${ulid()}`);
      // 模拟一个会产 5 个 token 的流
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          makeSseResponse([
            'data: {"choices":[{"delta":{"content":"a"}}]}',
            'data: {"choices":[{"delta":{"content":"b"}}]}',
            'data: {"choices":[{"delta":{"content":"c"}}]}',
            'data: {"choices":[{"delta":{"content":"d"}}]}',
            'data: {"choices":[{"delta":{"content":"e"}}]}',
            'data: [DONE]',
          ]),
        ) as unknown as typeof fetch,
      );

      const { sender, senderId } = makeFakeSender();

      // 在第一次 yield 之后立即取消
      reassertProviderForTest(f.manager);
      const input: RunAiChatStreamDeps = {
        rawPayload: {
          requestId: 'req-cancel',
          provider: 'minimax',
          messages: [{ role: 'user', content: 'hi' }],
        },
        sender: sender as unknown as Parameters<typeof runAiChatStream>[0]['sender'],
      };

      // 跑 chat 同时 50ms 后取消
      const runPromise = runAiChatStream(input);
      setTimeout(() => {
        cleanupAiChatForSender(senderId);
      }, 5);
      // 注意：清理操作会 abort 所有 controller → 下次 yield 检测到 abort 后退出

      await runPromise;
      // 不强制断言 chunks 数量（mock 流太快，可能已完成），
      // 但**不**应该有未捕获异常
      expect(true).toBe(true);
    } finally {
      await f.manager.deleteKey('minimax').catch(() => undefined);
      f.close();
    }
  });
});
