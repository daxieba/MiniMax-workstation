/**
 * `ai:extractJson` IPC handler 端到端测试（T3-4）
 *
 * 直接调 `handleAiExtractJson(...)` 函数，喂临时 db + 临时 CredentialManager + 真实 provider 适配器，
 * 用 `vi.stubGlobal` mock fetch。覆盖：
 *   - 3 个 schema 各成功 1 case
 *   - 未知 schemaName → NOT_FOUND（来自 Zod 入参校验 → VALIDATION_FAILED）
 *   - 缺 key → DEPENDENCY_MISSING
 *   - AI 返非 JSON → VALIDATION_FAILED（INVALID_OUTPUT 映射）
 *   - **安全**：响应**不**含 AI 原始输出
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

import { closeDb, createDbClient } from '../db/client';
import { CredentialManager } from '../electron/main/credentials/credentialManager';
import { handleAiExtractJson, type AiIpcDeps } from '../electron/main/ipc/ai';
import { createProviders } from '../electron/main/providers/factory';
import { unregisterProviderForTest } from '../electron/main/providers/registry';

const TMP_ROOT = join(tmpdir(), 'minimax-workstation-extract-json-test');

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
  // 防止污染其他测试文件
  unregisterProviderForTest('minimax');
  unregisterProviderForTest('openai-compatible');
});

interface Fixture {
  deps: AiIpcDeps;
  manager: CredentialManager;
  close: () => void;
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

function makeFixture(): Fixture {
  const dbPath = join(
    TMP_ROOT,
    `extract-json-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
  );
  const { db } = createDbClient(dbPath, resolvePath(__dirname, '..'));
  const manager = new CredentialManager(`minimax-workstation-test-${ulid().toLowerCase()}`);
  createProviders({ credentialManager: manager });
  return {
    deps: { db, credentialManager: manager },
    manager,
    close: () => closeDb(db),
  };
}

/** 构造一个 SSE 响应，body 是单条 data 事件。 */
function makeSseResponseWithContent(content: string): Response {
  const body = `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n\n`;
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller): void {
        controller.enqueue(new TextEncoder().encode(body));
        controller.close();
      },
    }),
    { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
  );
}

describe('handleAiExtractJson (3 schema success paths)', () => {
  it('extracts task_drafts successfully', async () => {
    const f = makeFixture();
    try {
      await f.manager.setKey('minimax', `sk-test-${ulid()}`);
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          makeSseResponseWithContent(
            JSON.stringify({
              tasks: [
                { title: 'First task', priority: 'high' },
                { title: 'Second task' },
              ],
            }),
          ),
        ) as unknown as typeof fetch,
      );

      const result = await handleAiExtractJson(f.deps, {
        provider: 'minimax',
        schemaName: 'task_drafts',
        messages: [{ role: 'user', content: 'extract tasks from this text' }],
      });

      expect(result.data).toEqual({
        tasks: [
          { title: 'First task', priority: 'high' },
          { title: 'Second task' },
        ],
      });
      expect(result.attempts).toBeGreaterThanOrEqual(1);
    } finally {
      await f.manager.deleteKey('minimax').catch(() => undefined);
      f.close();
    }
  });

  it('extracts inbox_items successfully', async () => {
    const f = makeFixture();
    try {
      await f.manager.setKey('minimax', `sk-test-${ulid()}`);
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          makeSseResponseWithContent(
            JSON.stringify({
              items: [
                { content: 'a note', kind: 'note' },
                { content: 'a todo', kind: 'todo' },
                { content: 'https://example.com', kind: 'link' },
              ],
            }),
          ),
        ) as unknown as typeof fetch,
      );

      const result = await handleAiExtractJson(f.deps, {
        provider: 'minimax',
        schemaName: 'inbox_items',
        messages: [{ role: 'user', content: 'extract inbox items' }],
      });

      expect(result.data).toEqual({
        items: [
          { content: 'a note', kind: 'note' },
          { content: 'a todo', kind: 'todo' },
          { content: 'https://example.com', kind: 'link' },
        ],
      });
    } finally {
      await f.manager.deleteKey('minimax').catch(() => undefined);
      f.close();
    }
  });

  it('extracts note_summary successfully', async () => {
    const f = makeFixture();
    try {
      await f.manager.setKey('minimax', `sk-test-${ulid()}`);
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          makeSseResponseWithContent(
            JSON.stringify({
              title: 'My Note',
              summary: 'A concise summary.',
              tags: ['tag1', 'tag2'],
            }),
          ),
        ) as unknown as typeof fetch,
      );

      const result = await handleAiExtractJson(f.deps, {
        provider: 'minimax',
        schemaName: 'note_summary',
        messages: [{ role: 'user', content: 'summarize' }],
      });

      expect(result.data).toEqual({
        title: 'My Note',
        summary: 'A concise summary.',
        tags: ['tag1', 'tag2'],
      });
    } finally {
      await f.manager.deleteKey('minimax').catch(() => undefined);
      f.close();
    }
  });
});

describe('handleAiExtractJson (error paths)', () => {
  it('throws VALIDATION_FAILED on unknown schemaName (Zod rejects)', async () => {
    const f = makeFixture();
    try {
      // schemaName 是 Zod 严格枚举 → 非法值进不来；这里模拟绕过 Zod 路径
      // （直接给一个 Zod schema 里没有的 schemaName）—— 实际是 VALIDATION_FAILED
      const err = await handleAiExtractJson(f.deps, {
        provider: 'minimax',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        schemaName: 'unknown' as any,
        messages: [{ role: 'user', content: 'hi' }],
      }).catch((e) => e);
      expect(err).toBeDefined();
      expect((err as { code: string }).code).toBe('VALIDATION_FAILED');
    } finally {
      f.close();
    }
  });

  it('throws DEPENDENCY_MISSING when no key is configured', async () => {
    const f = makeFixture();
    try {
      // 故意不 setKey
      const err = await handleAiExtractJson(f.deps, {
        provider: 'minimax',
        schemaName: 'task_drafts',
        messages: [{ role: 'user', content: 'hi' }],
      }).catch((e) => e);
      expect(err).toBeDefined();
      expect((err as { code: string }).code).toBe('DEPENDENCY_MISSING');
    } finally {
      f.close();
    }
  });

  it('throws VALIDATION_FAILED when AI returns non-JSON (INVALID_OUTPUT after retries)', async () => {
    const f = makeFixture();
    try {
      await f.manager.setKey('minimax', `sk-test-${ulid()}`);
      // mock 一个每次都返回新 Response 的 fetch（**不**能共享 Response / body）
      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation(() => Promise.resolve(makeSseResponseWithContent('not json at all'))) as unknown as typeof fetch,
      );

      const err = await handleAiExtractJson(f.deps, {
        provider: 'minimax',
        schemaName: 'task_drafts',
        messages: [{ role: 'user', content: 'hi' }],
        maxRetries: 1,
      }).catch((e) => e);
      expect(err).toBeDefined();
      expect((err as { code: string }).code).toBe('VALIDATION_FAILED');
      // 错误 message **不**含 AI 原始输出
      expect((err as { message: string }).message).not.toContain('not json at all');
    } finally {
      await f.manager.deleteKey('minimax').catch(() => undefined);
      f.close();
    }
  });

  it('throws VALIDATION_FAILED on input Zod failure (missing messages)', async () => {
    const f = makeFixture();
    try {
      const err = await handleAiExtractJson(f.deps, {
        provider: 'minimax',
        schemaName: 'task_drafts',
        // 缺 messages
      } as unknown as Parameters<typeof handleAiExtractJson>[1]).catch((e) => e);
      expect(err).toBeDefined();
      expect((err as { code: string }).code).toBe('VALIDATION_FAILED');
    } finally {
      f.close();
    }
  });
});

describe('handleAiExtractJson (CRITICAL: response NEVER leaks AI raw output)', () => {
  it('VALIDATION_FAILED error does NOT include AI raw output', async () => {
    const f = makeFixture();
    const sensitiveRaw = 'SENSITIVE_USER_DATA_XYZ';
    try {
      await f.manager.setKey('minimax', `sk-test-${ulid()}`);
      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation(() => Promise.resolve(makeSseResponseWithContent(sensitiveRaw))) as unknown as typeof fetch,
      );

      const err = await handleAiExtractJson(f.deps, {
        provider: 'minimax',
        schemaName: 'task_drafts',
        messages: [{ role: 'user', content: 'hi' }],
        maxRetries: 1,
      }).catch((e) => e);
      const all = JSON.stringify(err);
      expect(all).not.toContain(sensitiveRaw);
      expect(all).not.toContain('SENSITIVE_USER_DATA');
    } finally {
      await f.manager.deleteKey('minimax').catch(() => undefined);
      f.close();
    }
  });
});
