/**
 * `ProviderAdapter.extractJson` 单元测试（T3-4 错误兜底 + Zod 提取）
 *
 * 覆盖：
 *   - 成功：AI 返回合法 JSON（3 种 schema 各 1 case）
 *   - 成功：AI 返回 ```json ... ``` 包裹 → 剥 fence
 *   - 成功：AI 返回 ``` ... ``` 包裹（无 language tag）→ 剥 fence
 *   - 失败：AI 返回非 JSON → 重试 1 次 → 还失败 → 抛 INVALID_OUTPUT
 *   - 失败：Zod 验证失败（结构对但值错）→ 重试 1 次 → 还失败 → 抛 INVALID_OUTPUT
 *   - 401：抛 EXTERNAL_FAILURE（INVALID_API_KEY code）
 *   - 5xx：抛 EXTERNAL_FAILURE（SERVER_ERROR code）
 *   - 缺 key：抛 DEPENDENCY_MISSING
 *   - **关键安全**：错误信息**不**含 AI 原始输出（防敏感泄露）
 *   - **关键安全**：错误信息**不**含 apiKey
 *
 * mock 策略：复用 `openaiChatProvider.test.ts` 的 fetch mock helper。
 *
 * @see electron/main/providers/openaiChatProvider.ts
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import {
  CHAT_ERROR_CODES,
  EXTRACT_JSON_ERROR_CODES,
  OpenAIChatProvider,
  stripMarkdownFence,
} from '../electron/main/providers/openaiChatProvider';
import type { ProviderMetadata } from '../shared/types/ai';

// ============================================================
//  test fixture
// ============================================================

const TEST_METADATA: ProviderMetadata = {
  id: 'minimax',
  displayName: 'Test Provider',
  defaultModel: 'test-model',
  defaultBaseURL: 'https://api.test/v1',
};

class TestProvider extends OpenAIChatProvider {
  public override readonly metadata: ProviderMetadata = TEST_METADATA;
}

function makeKeyLoader(key: string | null = 'test-key-not-secret') {
  return { getKey: vi.fn().mockResolvedValue(key) };
}

// 简单的测试 schema：单一字段 `value: string`
const TestStringSchema = z.object({ value: z.string() });

// 嵌套 schema：用于多形态测试
const TaskDraftsSchema = z.object({
  tasks: z.array(
    z.object({
      title: z.string().min(1),
      priority: z.enum(['low', 'medium', 'high']).optional(),
    }),
  ),
});

const InboxItemsSchema = z.object({
  items: z.array(
    z.object({
      content: z.string().min(1),
      kind: z.enum(['note', 'todo', 'file', 'link']),
    }),
  ),
});

const NoteSummarySchema = z.object({
  title: z.string(),
  summary: z.string(),
  tags: z.array(z.string()),
});

// ============================================================
//  SSE helpers（参考 openaiChatProvider.test.ts）
// ============================================================

function sseData(json: object): string {
  return `data: ${JSON.stringify(json)}\n\n`;
}

const SSE_DONE = `data: [DONE]\n\n`;

function makeFetchMock(
  init:
    | { sseChunks: string[]; status?: number }
    | { throws: Error }
    | { status: number; sseChunks?: string[] },
): ReturnType<typeof vi.fn> {
  const status = 'status' in init ? init.status ?? 200 : 200;
  const encoder = new TextEncoder();
  if ('throws' in init) {
    return vi.fn().mockRejectedValue(init.throws);
  }
  const sseChunks = init.sseChunks ?? [];
  let chunkIdx = 0;
  return vi.fn().mockImplementation((_url: string, _init: unknown) => {
    return Promise.resolve(
      new Response(
        new ReadableStream<Uint8Array>({
          async pull(controller): Promise<void> {
            if (chunkIdx < sseChunks.length) {
              const chunk = sseChunks[chunkIdx];
              chunkIdx += 1;
              if (chunk !== undefined && chunk.length > 0) {
                controller.enqueue(encoder.encode(chunk));
              }
              return;
            }
            controller.close();
          },
        }),
        {
          status,
          statusText: status >= 200 && status < 300 ? 'OK' : 'Error',
          headers: { 'content-type': 'text/event-stream' },
        },
      ),
    );
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ============================================================
//  stripMarkdownFence 单元测试
// ============================================================

describe('stripMarkdownFence', () => {
  it('returns text unchanged when no fence', () => {
    expect(stripMarkdownFence('{"value":"x"}')).toBe('{"value":"x"}');
  });

  it('strips ```json ... ``` wrapper', () => {
    expect(stripMarkdownFence('```json\n{"value":"x"}\n```')).toBe('{"value":"x"}');
  });

  it('strips ``` ... ``` wrapper without language tag', () => {
    expect(stripMarkdownFence('```\n{"value":"x"}\n```')).toBe('{"value":"x"}');
  });

  it('strips ```JSON ... ``` wrapper (uppercase)', () => {
    expect(stripMarkdownFence('```JSON\n{"value":"x"}\n```')).toBe('{"value":"x"}');
  });

  it('preserves content without trailing newline', () => {
    expect(stripMarkdownFence('```json\n{"value":"x"}```')).toBe('{"value":"x"}');
  });

  it('handles extra text outside fence by returning original', () => {
    // 没有 fence 包裹 → 不动
    expect(stripMarkdownFence('prefix ```json\n{"value":"x"}\n``` suffix')).toBe(
      'prefix ```json\n{"value":"x"}\n``` suffix',
    );
  });
});

// ============================================================
//  extractJson：成功路径
// ============================================================

describe('OpenAIChatProvider.extractJson (success paths)', () => {
  let deps: ReturnType<typeof makeKeyLoader>;
  let provider: TestProvider;

  beforeEach(() => {
    deps = makeKeyLoader('test-secret-key-abc');
    provider = new TestProvider(deps);
  });

  it('extracts simple object via JSON.parse', async () => {
    const fetchMock = makeFetchMock({
      sseChunks: [sseData({ choices: [{ delta: { content: '{"value":"hello"}' } }] }), SSE_DONE],
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const result = await provider.extractJson(
      {
        provider: 'minimax',
        messages: [{ role: 'user', content: 'give me a value' }],
        schemaName: 'inbox_items',
      },
      TestStringSchema,
    );
    expect(result).toEqual({ value: 'hello' });
  });

  it('extracts from ```json ... ``` wrapped response', async () => {
    const wrapped = '```json\n{"value":"stripped"}\n```';
    const fetchMock = makeFetchMock({
      sseChunks: [sseData({ choices: [{ delta: { content: wrapped } }] }), SSE_DONE],
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const result = await provider.extractJson(
      {
        provider: 'minimax',
        messages: [{ role: 'user', content: 'give me' }],
        schemaName: 'inbox_items',
      },
      TestStringSchema,
    );
    expect(result).toEqual({ value: 'stripped' });
  });

  it('extracts task_drafts schema', async () => {
    const json = JSON.stringify({
      tasks: [
        { title: 'Task 1', priority: 'high' },
        { title: 'Task 2' },
      ],
    });
    const fetchMock = makeFetchMock({
      sseChunks: [sseData({ choices: [{ delta: { content: json } }] }), SSE_DONE],
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const result = await provider.extractJson(
      {
        provider: 'minimax',
        messages: [{ role: 'user', content: 'extract tasks' }],
        schemaName: 'task_drafts',
      },
      TaskDraftsSchema,
    );
    expect(result.tasks).toHaveLength(2);
    expect(result.tasks[0]?.title).toBe('Task 1');
    expect(result.tasks[0]?.priority).toBe('high');
  });

  it('extracts inbox_items schema', async () => {
    const json = JSON.stringify({
      items: [
        { content: 'note 1', kind: 'note' },
        { content: 'todo 1', kind: 'todo' },
      ],
    });
    const fetchMock = makeFetchMock({
      sseChunks: [sseData({ choices: [{ delta: { content: json } }] }), SSE_DONE],
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const result = await provider.extractJson(
      {
        provider: 'minimax',
        messages: [{ role: 'user', content: 'extract inbox items' }],
        schemaName: 'inbox_items',
      },
      InboxItemsSchema,
    );
    expect(result.items).toHaveLength(2);
    expect(result.items[0]?.kind).toBe('note');
  });

  it('extracts note_summary schema', async () => {
    const json = JSON.stringify({
      title: 'Summary title',
      summary: 'A short summary',
      tags: ['tag1', 'tag2'],
    });
    const fetchMock = makeFetchMock({
      sseChunks: [sseData({ choices: [{ delta: { content: json } }] }), SSE_DONE],
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const result = await provider.extractJson(
      {
        provider: 'minimax',
        messages: [{ role: 'user', content: 'summarize' }],
        schemaName: 'note_summary',
      },
      NoteSummarySchema,
    );
    expect(result.title).toBe('Summary title');
    expect(result.tags).toEqual(['tag1', 'tag2']);
  });

  it('sends temperature=0 by default for stable JSON', async () => {
    const fetchMock = makeFetchMock({
      sseChunks: [sseData({ choices: [{ delta: { content: '{"value":"x"}' } }] }), SSE_DONE],
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    await provider.extractJson(
      {
        provider: 'minimax',
        messages: [{ role: 'user', content: 'give me' }],
        schemaName: 'inbox_items',
      },
      TestStringSchema,
    );
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.temperature).toBe(0);
  });

  it('respects user-provided temperature', async () => {
    const fetchMock = makeFetchMock({
      sseChunks: [sseData({ choices: [{ delta: { content: '{"value":"x"}' } }] }), SSE_DONE],
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    await provider.extractJson(
      {
        provider: 'minimax',
        messages: [{ role: 'user', content: 'give me' }],
        schemaName: 'inbox_items',
        temperature: 0.7,
      },
      TestStringSchema,
    );
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.temperature).toBe(0.7);
  });

  it('prepends a JSON-extractor system hint', async () => {
    const fetchMock = makeFetchMock({
      sseChunks: [sseData({ choices: [{ delta: { content: '{"value":"x"}' } }] }), SSE_DONE],
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    await provider.extractJson(
      {
        provider: 'minimax',
        messages: [{ role: 'user', content: 'user input' }],
        schemaName: 'inbox_items',
      },
      TestStringSchema,
    );
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.messages[0]?.role).toBe('system');
    expect(body.messages[0]?.content).toMatch(/JSON extractor/i);
    expect(body.messages[1]?.role).toBe('user');
    expect(body.messages[1]?.content).toBe('user input');
  });
});

// ============================================================
//  extractJson：失败路径 — 401 / 5xx / 缺 key
// ============================================================

describe('OpenAIChatProvider.extractJson (error: external failures)', () => {
  let provider: TestProvider;

  beforeEach(() => {
    provider = new TestProvider(makeKeyLoader('test-secret-key-abc'));
  });

  it('throws DEPENDENCY_MISSING when no key', async () => {
    const noKeyProvider = new TestProvider(makeKeyLoader(null));
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const err = await noKeyProvider
      .extractJson(
        {
          provider: 'minimax',
          messages: [{ role: 'user', content: 'give me' }],
          schemaName: 'inbox_items',
        },
        TestStringSchema,
      )
      .catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error & { code?: string }).code).toBe(CHAT_ERROR_CODES.DEPENDENCY_MISSING);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws INVALID_API_KEY on HTTP 401', async () => {
    const fetchMock = makeFetchMock({ status: 401, sseChunks: [] });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const err = await provider
      .extractJson(
        {
          provider: 'minimax',
          messages: [{ role: 'user', content: 'give me' }],
          schemaName: 'inbox_items',
        },
        TestStringSchema,
      )
      .catch((e) => e);
    expect((err as Error & { code?: string }).code).toBe(CHAT_ERROR_CODES.INVALID_API_KEY);
  });

  it('throws SERVER_ERROR on HTTP 500', async () => {
    const fetchMock = makeFetchMock({ status: 500, sseChunks: [] });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const err = await provider
      .extractJson(
        {
          provider: 'minimax',
          messages: [{ role: 'user', content: 'give me' }],
          schemaName: 'inbox_items',
        },
        TestStringSchema,
      )
      .catch((e) => e);
    expect((err as Error & { code?: string }).code).toBe(CHAT_ERROR_CODES.SERVER_ERROR);
  });

  it('throws NETWORK_ERROR on fetch reject', async () => {
    const fetchMock = makeFetchMock({ throws: new TypeError('connection reset') });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const err = await provider
      .extractJson(
        {
          provider: 'minimax',
          messages: [{ role: 'user', content: 'give me' }],
          schemaName: 'inbox_items',
        },
        TestStringSchema,
      )
      .catch((e) => e);
    expect((err as Error & { code?: string }).code).toBe(CHAT_ERROR_CODES.NETWORK_ERROR);
  });
});

// ============================================================
//  extractJson：失败路径 — 重试 + Zod 失败
// ============================================================

describe('OpenAIChatProvider.extractJson (error: retry & Zod failure)', () => {
  let provider: TestProvider;

  beforeEach(() => {
    provider = new TestProvider(makeKeyLoader('test-secret-key-abc'));
  });

  it('retries when AI returns non-JSON, succeeds on retry', async () => {
    let callIdx = 0;
    const fetchMock = vi.fn().mockImplementation(() => {
      callIdx += 1;
      const isRetry = callIdx > 1;
      const content = isRetry ? '{"value":"retry-succeeded"}' : 'not json at all';
      return Promise.resolve(
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller): void {
              controller.enqueue(
                new TextEncoder().encode(sseData({ choices: [{ delta: { content } }] })),
              );
              controller.enqueue(new TextEncoder().encode(SSE_DONE));
              controller.close();
            },
          }),
          { status: 200, headers: { 'content-type': 'text/event-stream' } },
        ),
      );
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const result = await provider.extractJson(
      {
        provider: 'minimax',
        messages: [{ role: 'user', content: 'give me' }],
        schemaName: 'inbox_items',
        maxRetries: 1,
      },
      TestStringSchema,
    );
    expect(result).toEqual({ value: 'retry-succeeded' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws INVALID_OUTPUT when AI keeps returning non-JSON after retries', async () => {
    const fetchMock = makeFetchMock({
      sseChunks: [
        sseData({ choices: [{ delta: { content: 'definitely not json' } }] }),
        sseData({ choices: [{ delta: { content: 'still not json' } }] }),
        SSE_DONE,
      ],
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const err = await provider
      .extractJson(
        {
          provider: 'minimax',
          messages: [{ role: 'user', content: 'give me' }],
          schemaName: 'inbox_items',
          maxRetries: 1,
        },
        TestStringSchema,
      )
      .catch((e) => e);
    expect((err as Error & { code?: string }).code).toBe(EXTRACT_JSON_ERROR_CODES.INVALID_OUTPUT);
  });

  it('retries when Zod validation fails, succeeds on retry', async () => {
    let callIdx = 0;
    const fetchMock = vi.fn().mockImplementation(() => {
      callIdx += 1;
      const isRetry = callIdx > 1;
      // 第一次：value 是 number → Zod 失败；第二次：value 是 string → 通过
      const content = isRetry
        ? '{"value":"string-value"}'
        : '{"value":42}';
      return Promise.resolve(
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller): void {
              controller.enqueue(
                new TextEncoder().encode(sseData({ choices: [{ delta: { content } }] })),
              );
              controller.enqueue(new TextEncoder().encode(SSE_DONE));
              controller.close();
            },
          }),
          { status: 200, headers: { 'content-type': 'text/event-stream' } },
        ),
      );
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const result = await provider.extractJson(
      {
        provider: 'minimax',
        messages: [{ role: 'user', content: 'give me' }],
        schemaName: 'inbox_items',
        maxRetries: 1,
      },
      TestStringSchema,
    );
    expect(result).toEqual({ value: 'string-value' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws INVALID_OUTPUT when Zod keeps failing after retries', async () => {
    const fetchMock = makeFetchMock({
      sseChunks: [
        sseData({ choices: [{ delta: { content: '{"value":1}' } }] }),
        sseData({ choices: [{ delta: { content: '{"value":2}' } }] }),
        SSE_DONE,
      ],
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const err = await provider
      .extractJson(
        {
          provider: 'minimax',
          messages: [{ role: 'user', content: 'give me' }],
          schemaName: 'inbox_items',
          maxRetries: 1,
        },
        TestStringSchema,
      )
      .catch((e) => e);
    expect((err as Error & { code?: string }).code).toBe(EXTRACT_JSON_ERROR_CODES.INVALID_OUTPUT);
  });

  it('does not retry when maxRetries=0', async () => {
    const fetchMock = makeFetchMock({
      sseChunks: [
        sseData({ choices: [{ delta: { content: 'not json' } }] }),
        sseData({ choices: [{ delta: { content: 'still not' } }] }),
        SSE_DONE,
      ],
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const err = await provider
      .extractJson(
        {
          provider: 'minimax',
          messages: [{ role: 'user', content: 'give me' }],
          schemaName: 'inbox_items',
          maxRetries: 0,
        },
        TestStringSchema,
      )
      .catch((e) => e);
    expect((err as Error & { code?: string }).code).toBe(EXTRACT_JSON_ERROR_CODES.INVALID_OUTPUT);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

// ============================================================
//  extractJson：关键安全 — 错误信息**不**含 AI 原始输出 / apiKey
// ============================================================

describe('OpenAIChatProvider.extractJson (CRITICAL: no AI raw output / apiKey leak)', () => {
  const SECRET_KEY = 'sk-THIS-IS-SECRET-9876543210';
  const SENSITIVE_AI_OUTPUT = 'SECRET_USER_DATA_12345';

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('INVALID_OUTPUT error message does NOT contain the AI raw output', async () => {
    const provider = new TestProvider(makeKeyLoader(SECRET_KEY));
    const fetchMock = makeFetchMock({
      sseChunks: [
        // 两次都返回带敏感数据的非 JSON
        sseData({ choices: [{ delta: { content: `${SENSITIVE_AI_OUTPUT} not json` } }] }),
        sseData({ choices: [{ delta: { content: `${SENSITIVE_AI_OUTPUT} still not` } }] }),
        SSE_DONE,
      ],
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const err = await provider
      .extractJson(
        {
          provider: 'minimax',
          messages: [{ role: 'user', content: 'give me' }],
          schemaName: 'inbox_items',
          maxRetries: 1,
        },
        TestStringSchema,
      )
      .catch((e) => e);
    const message = (err as Error).message;
    expect(message).not.toContain(SENSITIVE_AI_OUTPUT);
    expect(message).not.toContain('SECRET_USER_DATA');
  });

  it('Zod-failed INVALID_OUTPUT error does NOT contain the AI raw output', async () => {
    const provider = new TestProvider(makeKeyLoader(SECRET_KEY));
    const fetchMock = makeFetchMock({
      sseChunks: [
        // 第一次：结构对但 schema 不匹配（带敏感数据）
        sseData({
          choices: [
            {
              delta: {
                content: JSON.stringify({
                  sensitive_field: SENSITIVE_AI_OUTPUT,
                  // 缺 'value' 字段
                }),
              },
            },
          ],
        }),
        sseData({
          choices: [
            {
              delta: {
                content: JSON.stringify({ other_field: SENSITIVE_AI_OUTPUT }),
              },
            },
          ],
        }),
        SSE_DONE,
      ],
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const err = await provider
      .extractJson(
        {
          provider: 'minimax',
          messages: [{ role: 'user', content: 'give me' }],
          schemaName: 'inbox_items',
          maxRetries: 1,
        },
        TestStringSchema,
      )
      .catch((e) => e);
    const message = (err as Error).message;
    expect(message).not.toContain(SENSITIVE_AI_OUTPUT);
  });

  it('401 error message does NOT contain the apiKey', async () => {
    const provider = new TestProvider(makeKeyLoader(SECRET_KEY));
    const fetchMock = makeFetchMock({ status: 401, sseChunks: [] });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const err = await provider
      .extractJson(
        {
          provider: 'minimax',
          messages: [{ role: 'user', content: 'give me' }],
          schemaName: 'inbox_items',
        },
        TestStringSchema,
      )
      .catch((e) => e);
    const message = (err as Error).message;
    expect(message).not.toContain(SECRET_KEY);
    expect(message).not.toContain('sk-THIS-IS');
  });

  it('500 error message does NOT contain the apiKey', async () => {
    const provider = new TestProvider(makeKeyLoader(SECRET_KEY));
    const fetchMock = makeFetchMock({ status: 500, sseChunks: [] });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const err = await provider
      .extractJson(
        {
          provider: 'minimax',
          messages: [{ role: 'user', content: 'give me' }],
          schemaName: 'inbox_items',
        },
        TestStringSchema,
      )
      .catch((e) => e);
    const message = (err as Error).message;
    expect(message).not.toContain(SECRET_KEY);
  });

  it('fetch URL does NOT contain the apiKey (auth only via header)', async () => {
    const provider = new TestProvider(makeKeyLoader(SECRET_KEY));
    const fetchMock = makeFetchMock({
      sseChunks: [sseData({ choices: [{ delta: { content: '{"value":"x"}' } }] }), SSE_DONE],
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    await provider.extractJson(
      {
        provider: 'minimax',
        messages: [{ role: 'user', content: 'give me' }],
        schemaName: 'inbox_items',
      },
      TestStringSchema,
    );
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).not.toContain(SECRET_KEY);
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe(`Bearer ${SECRET_KEY}`);
  });
});
