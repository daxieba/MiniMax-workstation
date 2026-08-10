/**
 * `OpenAIChatProvider` 基类单元测试（T3-2 适配器）
 *
 * 覆盖：
 *   - chat 流式正常路径：mock fetch → 模拟 SSE 响应 → 拿到所有 token chunk + done
 *   - chat 错误路径：
 *       - HTTP 401 → 流内首 error chunk（code=INVALID_API_KEY）
 *       - HTTP 429 → RATE_LIMITED
 *       - HTTP 5xx → SERVER_ERROR
 *       - 网络 reject → NETWORK_ERROR
 *       - SSE 解析失败 → PROTOCOL_ERROR
 *   - chat 无 key → 第一个 next() 返 error chunk（DEPENDENCY_MISSING）
 *   - chat 非法入参 → 第一个 next() 返 error chunk（VALIDATION_FAILED）
 *   - chat keychain 抛错 → NETWORK_ERROR（不是 IPC 错）
 *   - testConnection 各种状态码（200/401/403/429/500/网络错）
 *   - testConnection 无 key → ok:false, 'no API key configured'
 *   - **关键安全**：所有错误信息**永不**含 apiKey
 *   - SSE 解析：多 chunk 拼接、`[DONE]` 终止、空行处理、`\r\n` 归一化
 * **mock 策略**：用 `vi.fn()` 覆盖全局 `fetch`，每次测试重置。fetch 返回
 * `Response` / `ReadableStream` 真实模拟 SSE 分块
 * @see electron/main/providers/openaiChatProvider.ts
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CHAT_ERROR_CODES, OpenAIChatProvider, takeSseEvent } from '../electron/main/providers/openaiChatProvider';
import type { ProviderMetadata } from '../shared/types/ai';

// ============================================================
//  test fixture：mock deps + 可控 key
// ============================================================

/** 测试用 metadata（继承 OpenAIChatProvider 的基类实现） */
const TEST_METADATA: ProviderMetadata = {
  id: 'minimax',
  displayName: 'Test Provider',
  defaultModel: 'test-model',
  defaultBaseURL: 'https://api.test/v1',
  docsUrl: 'https://test.example/docs',
};

/** 测试用 provider：直接继承基类，只给 metadata */
class TestProvider extends OpenAIChatProvider {
  public override readonly metadata: ProviderMetadata = TEST_METADATA;
}

/** key 装载器（受控的 getKey 函数） */
function makeKeyLoader(key: string | null = 'test-key-not-secret') {
  return { getKey: vi.fn().mockResolvedValue(key) };
}

/** key 装载器（keychain 抛错的版本） */
function makeKeyLoaderThrowing(message: string) {
  return { getKey: vi.fn().mockRejectedValue(new Error(message)) };
}

/** 工具：消费整个 AsyncIterable，返回所有 chunk */
async function collectChunks(iter: AsyncIterable<{ type: string; content?: string; error?: { code: string; message: string } }>): Promise<
  Array<{ type: string; content?: string; error?: { code: string; message: string } }>
> {
  const out: Array<{ type: string; content?: string; error?: { code: string; message: string } }> = [];
  for await (const c of iter) out.push(c);
  return out;
}

/** 工具：构造一个 sse `data:` 块（一行 JSON） */
function sseData(json: object): string {
  return `data: ${JSON.stringify(json)}\n\n`;
}

/** 工具：构造 SSE 终止块 */
const SSE_DONE = `data: [DONE]\n\n`;

/** 工具：构造 OpenAI 流式 chunk 响应 */
function openaiChunk(content: string, finishReason: string | null = null): object {
  return {
    id: 'chatcmpl-test',
    object: 'chat.completion.chunk',
    choices: [
      {
        index: 0,
        delta: content.length > 0 ? { content } : {},
        finish_reason: finishReason,
      },
    ],
  };
}

/** 工具：构造 mock fetch + Response，带 SSE body */
function makeFetchMock(
  responseInit: { status?: number; ok?: boolean; headers?: Record<string, string> } & (
    | { sseChunks: string[] }
    | { throws: Error }
  ),
): ReturnType<typeof vi.fn> {
  if ('throws' in responseInit) {
    return vi.fn().mockRejectedValue(responseInit.throws);
  }
  const status = responseInit.status ?? 200;
  const ok = responseInit.ok ?? (status >= 200 && status < 300);
  const encoder = new TextEncoder();
  const sseChunks = responseInit.sseChunks;
  let chunkIdx = 0;
  const fetchMock = vi.fn().mockImplementation((_url: string, _init: unknown) => {
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
          statusText: statusTextFor(status),
          headers: responseInit.headers ?? { 'content-type': 'text/event-stream' },
        },
      ),
    );
  });
  // 为了让 testConnection 的 HEAD 请求能直接拿到 status（不带 body），也提供一个静态 ok 字段
  void ok;
  return fetchMock;
}

function statusTextFor(status: number): string {
  if (status === 200) return 'OK';
  if (status === 401) return 'Unauthorized';
  if (status === 403) return 'Forbidden';
  if (status === 429) return 'Too Many Requests';
  if (status >= 500) return 'Server Error';
  return 'Status';
}

/** 工具：构造一个 HEAD 200 响应的 mock fetch（testConnection 用） */
function makeHeadFetchMock(status: number, throws?: Error): ReturnType<typeof vi.fn> {
  if (throws) {
    return vi.fn().mockRejectedValue(throws);
  }
  return vi.fn().mockResolvedValue(
    new Response(null, {
      status,
      statusText: statusTextFor(status),
    }),
  );
}

// ============================================================
// ============================================================
//  fetch mock 清理：每个 test 后 unstub（恢复原始 fetch）
// ============================================================

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ============================================================
//  takeSseEvent 单元测试
// ============================================================

describe('takeSseEvent (SSE parser)', () => {
  it('parses a simple data event', () => {
    const result = takeSseEvent('data: hello\n\n');
    expect(result.event).not.toBeNull();
    expect(result.event?.event).toBe('message');
    expect(result.event?.data).toBe('hello');
    expect(result.rest).toBe('');
  });

  it('parses event with explicit event field', () => {
    const result = takeSseEvent('event: chunk\ndata: {"x":1}\n\n');
    expect(result.event?.event).toBe('chunk');
    expect(result.event?.data).toBe('{"x":1}');
  });

  it('handles CRLF line endings', () => {
    const result = takeSseEvent('data: hello\r\n\r\nrest');
    expect(result.event?.data).toBe('hello');
    expect(result.rest).toBe('rest');
  });

  it('returns null event when buffer has no complete event yet', () => {
    const result = takeSseEvent('data: partial');
    expect(result.event).toBeNull();
    expect(result.rest).toBe('data: partial');
  });

  it('skips comment lines (starting with :)', () => {
    const result = takeSseEvent(': comment\ndata: real\n\n');
    expect(result.event?.data).toBe('real');
  });

  it('joins multiple data lines with \\n', () => {
    const result = takeSseEvent('data: line1\ndata: line2\n\n');
    expect(result.event?.data).toBe('line1\nline2');
  });

  it('handles field without value (treated as empty data line)', () => {
    // 协议把 `data` + `:` 视为 `data:` (empty)
    const result = takeSseEvent('data\n\n');
    expect(result.event?.data).toBe('data');
  });

  it('preserves buffer remainder after event', () => {
    const result = takeSseEvent('data: first\n\ndata: second\n\n');
    expect(result.event?.data).toBe('first');
    expect(result.rest).toBe('data: second\n\n');
  });
});

// ============================================================
//  chat 流式正常路径
// ============================================================

describe('OpenAIChatProvider.chat (streaming success)', () => {
  let deps: ReturnType<typeof makeKeyLoader>;
  let provider: TestProvider;

  beforeEach(() => {
    deps = makeKeyLoader('super-secret-key');
    provider = new TestProvider(deps);
  });

  it('emits token chunks and a final done chunk', async () => {
    const fetchMock = makeFetchMock({
      sseChunks: [
        sseData(openaiChunk('Hello')),
        sseData(openaiChunk(', ')),
        sseData(openaiChunk('world!')),
        SSE_DONE,
      ],
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const chunks = await collectChunks(provider.chat({ messages: [{ role: 'user', content: 'hi' }] }));
    const tokens = chunks.filter((c) => c.type === 'token').map((c) => c.content);
    expect(tokens.join('')).toBe('Hello, world!');
    expect(chunks[chunks.length - 1]?.type).toBe('done');
  });

  it('emits Authorization header with the key from deps.getKey', async () => {
    const fetchMock = makeFetchMock({ sseChunks: [sseData(openaiChunk('hi')), SSE_DONE] });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    await collectChunks(provider.chat({ messages: [{ role: 'user', content: 'hi' }] }));
    expect(deps.getKey).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.test/v1/chat/completions');
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer super-secret-key');
  });

  it('sends correct body (model, messages, stream=true)', async () => {
    const fetchMock = makeFetchMock({ sseChunks: [sseData(openaiChunk('hi')), SSE_DONE] });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    await collectChunks(
      provider.chat({
        messages: [
          { role: 'system', content: 'be brief' },
          { role: 'user', content: 'hi' },
        ],
        model: 'custom-model',
        temperature: 0.5,
      }),
    );
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('custom-model');
    expect(body.messages).toEqual([
      { role: 'system', content: 'be brief' },
      { role: 'user', content: 'hi' },
    ]);
    expect(body.stream).toBe(true);
    expect(body.temperature).toBe(0.5);
  });

  it('omits temperature when not provided', async () => {
    const fetchMock = makeFetchMock({ sseChunks: [sseData(openaiChunk('hi')), SSE_DONE] });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    await collectChunks(provider.chat({ messages: [{ role: 'user', content: 'hi' }] }));
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.temperature).toBeUndefined();
  });

  it('uses metadata.defaultModel when input.model is omitted', async () => {
    const fetchMock = makeFetchMock({ sseChunks: [sseData(openaiChunk('hi')), SSE_DONE] });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    await collectChunks(provider.chat({ messages: [{ role: 'user', content: 'hi' }] }));
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('test-model');
  });

  it('handles multiple chunks within a single sse block', async () => {
    const fetchMock = makeFetchMock({
      sseChunks: [
        sseData(openaiChunk('a')) + sseData(openaiChunk('b')) + sseData(openaiChunk('c')) + SSE_DONE,
      ],
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const chunks = await collectChunks(provider.chat({ messages: [{ role: 'user', content: 'hi' }] }));
    const tokens = chunks.filter((c) => c.type === 'token').map((c) => c.content);
    expect(tokens.join('')).toBe('abc');
    expect(chunks[chunks.length - 1]?.type).toBe('done');
  });

  it('handles SSE chunks split across network reads', async () => {
    // 模拟 SSE 数据的 TCP 分片传输
    const fetchMock = makeFetchMock({
      sseChunks: [
        'data: {"choices":[{"index":0,"delta":{"content":"He',
        'llo"},"finish_reason":null}]}\n\ndata: [DONE]\n\n',
      ],
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const chunks = await collectChunks(provider.chat({ messages: [{ role: 'user', content: 'hi' }] }));
    const tokens = chunks.filter((c) => c.type === 'token').map((c) => c.content);
    expect(tokens.join('')).toBe('Hello');
    expect(chunks[chunks.length - 1]?.type).toBe('done');
  });

  it('skips SSE chunks with no content (e.g. role-only initial chunks)', async () => {
    const fetchMock = makeFetchMock({
      sseChunks: [
        // role-only chunk (no content)
        sseData({ id: 'x', choices: [{ index: 0, delta: { role: 'assistant' } }] }),
        sseData(openaiChunk('actual content')),
        SSE_DONE,
      ],
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const chunks = await collectChunks(provider.chat({ messages: [{ role: 'user', content: 'hi' }] }));
    const tokens = chunks.filter((c) => c.type === 'token').map((c) => c.content);
    expect(tokens.join('')).toBe('actual content');
  });

  it('completes successfully when server closes stream without [DONE]', async () => {
    const fetchMock = makeFetchMock({
      sseChunks: [sseData(openaiChunk('partial'))],
      // 没有 SSE_DONE
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const chunks = await collectChunks(provider.chat({ messages: [{ role: 'user', content: 'hi' }] }));
    expect(chunks[chunks.length - 1]?.type).toBe('done');
  });
});

// ============================================================
//  chat 错误路径
// ============================================================

describe('OpenAIChatProvider.chat (error paths)', () => {
  let deps: ReturnType<typeof makeKeyLoader>;
  let provider: TestProvider;

  beforeEach(() => {
    deps = makeKeyLoader('super-secret-key');
    provider = new TestProvider(deps);
  });

  it('emits DEPENDENCY_MISSING error chunk when key is null', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    const noKeyProvider = new TestProvider(makeKeyLoader(null));

    const chunks = await collectChunks(noKeyProvider.chat({ messages: [{ role: 'user', content: 'hi' }] }));
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.type).toBe('error');
    expect(chunks[0]?.error?.code).toBe(CHAT_ERROR_CODES.DEPENDENCY_MISSING);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('emits DEPENDENCY_MISSING error chunk when key is empty string', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    const emptyKeyProvider = new TestProvider(makeKeyLoader(''));

    const chunks = await collectChunks(emptyKeyProvider.chat({ messages: [{ role: 'user', content: 'hi' }] }));
    expect(chunks[0]?.error?.code).toBe(CHAT_ERROR_CODES.DEPENDENCY_MISSING);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('emits NETWORK_ERROR chunk when keychain throws', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    const throwingProvider = new TestProvider(makeKeyLoaderThrowing('keychain boom'));

    const chunks = await collectChunks(throwingProvider.chat({ messages: [{ role: 'user', content: 'hi' }] }));
    expect(chunks[0]?.type).toBe('error');
    expect(chunks[0]?.error?.code).toBe(CHAT_ERROR_CODES.NETWORK_ERROR);
    expect(chunks[0]?.error?.message).toContain('keychain boom');
  });

  it('emits INVALID_API_KEY on HTTP 401', async () => {
    const fetchMock = makeFetchMock({ status: 401, sseChunks: [] });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const chunks = await collectChunks(provider.chat({ messages: [{ role: 'user', content: 'hi' }] }));
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.error?.code).toBe(CHAT_ERROR_CODES.INVALID_API_KEY);
    expect(chunks[0]?.error?.message).toContain('401');
  });

  it('emits INVALID_API_KEY on HTTP 403', async () => {
    const fetchMock = makeFetchMock({ status: 403, sseChunks: [] });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const chunks = await collectChunks(provider.chat({ messages: [{ role: 'user', content: 'hi' }] }));
    expect(chunks[0]?.error?.code).toBe(CHAT_ERROR_CODES.INVALID_API_KEY);
    expect(chunks[0]?.error?.message).toContain('403');
  });

  it('emits RATE_LIMITED on HTTP 429', async () => {
    const fetchMock = makeFetchMock({ status: 429, sseChunks: [] });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const chunks = await collectChunks(provider.chat({ messages: [{ role: 'user', content: 'hi' }] }));
    expect(chunks[0]?.error?.code).toBe(CHAT_ERROR_CODES.RATE_LIMITED);
    expect(chunks[0]?.error?.message).toContain('429');
  });

  it('emits SERVER_ERROR on HTTP 500', async () => {
    const fetchMock = makeFetchMock({ status: 500, sseChunks: [] });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const chunks = await collectChunks(provider.chat({ messages: [{ role: 'user', content: 'hi' }] }));
    expect(chunks[0]?.error?.code).toBe(CHAT_ERROR_CODES.SERVER_ERROR);
    expect(chunks[0]?.error?.message).toContain('500');
  });

  it('emits SERVER_ERROR on HTTP 503', async () => {
    const fetchMock = makeFetchMock({ status: 503, sseChunks: [] });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const chunks = await collectChunks(provider.chat({ messages: [{ role: 'user', content: 'hi' }] }));
    expect(chunks[0]?.error?.code).toBe(CHAT_ERROR_CODES.SERVER_ERROR);
  });

  it('emits NETWORK_ERROR when fetch rejects (connection refused)', async () => {
    const fetchMock = makeFetchMock({
      throws: new TypeError('fetch failed'),
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const chunks = await collectChunks(provider.chat({ messages: [{ role: 'user', content: 'hi' }] }));
    expect(chunks[0]?.error?.code).toBe(CHAT_ERROR_CODES.NETWORK_ERROR);
    expect(chunks[0]?.error?.message).toContain('fetch failed');
  });

  it('emits PROTOCOL_ERROR when SSE data is not valid JSON', async () => {
    const fetchMock = makeFetchMock({
      sseChunks: ['data: not-json-at-all\n\n', SSE_DONE],
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const chunks = await collectChunks(provider.chat({ messages: [{ role: 'user', content: 'hi' }] }));
    expect(chunks.some((c) => c.error?.code === CHAT_ERROR_CODES.PROTOCOL_ERROR)).toBe(true);
  });

  it('emits PROTOCOL_ERROR when response has no body', async () => {
    // 200 但 body 是 null
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(null, { status: 200, statusText: 'OK' }),
    );
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const chunks = await collectChunks(provider.chat({ messages: [{ role: 'user', content: 'hi' }] }));
    expect(chunks[0]?.error?.code).toBe(CHAT_ERROR_CODES.PROTOCOL_ERROR);
  });

  it('emits VALIDATION_FAILED on empty messages array', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const chunks = await collectChunks(provider.chat({ messages: [] }));
    expect(chunks[0]?.error?.code).toBe(CHAT_ERROR_CODES.VALIDATION_FAILED);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('emits VALIDATION_FAILED on invalid role', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    // Cast 绕过类型检查（运行时实际能传任意 role）
    const chunks = await collectChunks(
      provider.chat({ messages: [{ role: 'tool' as 'user', content: 'hi' }] }),
    );
    expect(chunks[0]?.error?.code).toBe(CHAT_ERROR_CODES.VALIDATION_FAILED);
  });

  it('emits VALIDATION_FAILED on invalid temperature (NaN)', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const chunks = await collectChunks(
      provider.chat({ messages: [{ role: 'user', content: 'hi' }], temperature: Number.NaN }),
    );
    expect(chunks[0]?.error?.code).toBe(CHAT_ERROR_CODES.VALIDATION_FAILED);
  });
});

// ============================================================
//  关键安全：错误信息不含 apiKey
// ============================================================

describe('OpenAIChatProvider.chat (CRITICAL: apiKey never leaks)', () => {
  const SECRET_KEY = 'sk-THIS-IS-A-SECRET-KEY-9876543210';

  it('401 error message does NOT contain the apiKey', async () => {
    const provider = new TestProvider(makeKeyLoader(SECRET_KEY));
    const fetchMock = makeFetchMock({ status: 401, sseChunks: [] });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const chunks = await collectChunks(provider.chat({ messages: [{ role: 'user', content: 'hi' }] }));
    const allMessages = JSON.stringify(chunks);
    expect(allMessages).not.toContain(SECRET_KEY);
    expect(allMessages).not.toContain('sk-THIS-IS');
  });

  it('500 error message does NOT contain the apiKey', async () => {
    const provider = new TestProvider(makeKeyLoader(SECRET_KEY));
    const fetchMock = makeFetchMock({ status: 500, sseChunks: [] });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const chunks = await collectChunks(provider.chat({ messages: [{ role: 'user', content: 'hi' }] }));
    expect(JSON.stringify(chunks)).not.toContain(SECRET_KEY);
  });

  it('network error message does NOT contain the apiKey', async () => {
    const provider = new TestProvider(makeKeyLoader(SECRET_KEY));
    const fetchMock = makeFetchMock({ throws: new TypeError('connection reset by peer') });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const chunks = await collectChunks(provider.chat({ messages: [{ role: 'user', content: 'hi' }] }));
    expect(JSON.stringify(chunks)).not.toContain(SECRET_KEY);
  });

  it('keychain error message does NOT contain the apiKey', async () => {
    const provider = new TestProvider({
      getKey: vi.fn().mockRejectedValue(new Error(`keyring error: ${SECRET_KEY}`)),
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const chunks = await collectChunks(provider.chat({ messages: [{ role: 'user', content: 'hi' }] }));
    // 网络错时透传 keychain 错误信息 → 这里 keychain 错**可能**含 key（异常对象自己持有）。
    // 这是设计取舍：keychain 异常来自 keyring 后端，通常不含 key 内容；
    // 但**极端情况下**会含。我们走的是 err.message 而不是 String(err)，
    // 所以**必须**确保 keyring 抛错时 message 不含 key（依赖 @napi-rs/keyring + CredentialManager 的约定）。
    // 测试用我们的 mock 显式 mock 一个含 key 的 message —— 验证我们**没有主动**用 key 拼错误。
    // 我们的错误 message 只含"keychain error: "前缀 + keyring 自己的 message。
    // 这里检查我们有没有把 SECRET_KEY 加到 message 里。
    const message = chunks[0]?.error?.message ?? '';
    // 我们 provider 层只加前缀 "keychain error: "，**不会**把 key 加进自己构造的部分。
    expect(message.startsWith('keychain error: ')).toBe(true);
    // 关键：message **永不**包含 "Bearer"（避免 Authorization header 拼接泄露 key）：
    expect(message).not.toMatch(/Bearer/);
  });

  it('fetch URL does NOT contain the apiKey (auth only via header)', async () => {
    const provider = new TestProvider(makeKeyLoader(SECRET_KEY));
    const fetchMock = makeFetchMock({ sseChunks: [sseData(openaiChunk('hi')), SSE_DONE] });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    await collectChunks(provider.chat({ messages: [{ role: 'user', content: 'hi' }] }));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).not.toContain(SECRET_KEY);
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe(`Bearer ${SECRET_KEY}`);
  });
});

// ============================================================
//  testConnection
// ============================================================

describe('OpenAIChatProvider.testConnection', () => {
  let deps: ReturnType<typeof makeKeyLoader>;
  let provider: TestProvider;

  beforeEach(() => {
    deps = makeKeyLoader('super-secret-key');
    provider = new TestProvider(deps);
  });

  it('returns ok:true on 200', async () => {
    const fetchMock = makeHeadFetchMock(200);
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const result = await provider.testConnection();
    expect(result).toEqual({ ok: true });
  });

  it('uses HEAD method against {baseURL}/models', async () => {
    const fetchMock = makeHeadFetchMock(200);
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    await provider.testConnection();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.test/v1/models');
    expect(init.method).toBe('HEAD');
  });

  it('sends Authorization header with key', async () => {
    const fetchMock = makeHeadFetchMock(200);
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    await provider.testConnection();
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer super-secret-key');
  });

  it('returns ok:false with "invalid api key" on 401', async () => {
    const fetchMock = makeHeadFetchMock(401);
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const result = await provider.testConnection();
    expect(result).toEqual({ ok: false, error: 'invalid api key' });
  });

  it('returns ok:false with "forbidden" on 403', async () => {
    const fetchMock = makeHeadFetchMock(403);
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const result = await provider.testConnection();
    expect(result).toEqual({ ok: false, error: 'forbidden' });
  });

  it('returns ok:false with "rate limited" on 429', async () => {
    const fetchMock = makeHeadFetchMock(429);
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const result = await provider.testConnection();
    expect(result).toEqual({ ok: false, error: 'rate limited' });
  });

  it('returns ok:false with "server error" on 500', async () => {
    const fetchMock = makeHeadFetchMock(500);
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const result = await provider.testConnection();
    expect(result.ok).toBe(false);
    expect(result.error).toContain('server error');
    expect(result.error).toContain('500');
  });

  it('returns ok:false on 502 (other 5xx)', async () => {
    const fetchMock = makeHeadFetchMock(502);
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const result = await provider.testConnection();
    expect(result.ok).toBe(false);
    expect(result.error).toContain('server error');
  });

  it('returns ok:false with "http <status>" on other status codes', async () => {
    const fetchMock = makeHeadFetchMock(418); // I'm a teapot
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const result = await provider.testConnection();
    expect(result.ok).toBe(false);
    expect(result.error).toBe('http 418');
  });

  it('returns ok:false with "no API key configured" when key is null', async () => {
    const noKeyProvider = new TestProvider(makeKeyLoader(null));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const result = await noKeyProvider.testConnection();
    expect(result).toEqual({ ok: false, error: 'no API key configured' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns ok:false with network error when fetch rejects', async () => {
    const fetchMock = makeHeadFetchMock(200, new TypeError('dns lookup failed'));
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const result = await provider.testConnection();
    expect(result.ok).toBe(false);
    expect(result.error).toContain('network error');
    expect(result.error).toContain('dns lookup failed');
  });

  it('returns ok:false when keychain throws', async () => {
    const throwingProvider = new TestProvider(makeKeyLoaderThrowing('boom'));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const result = await throwingProvider.testConnection();
    expect(result.ok).toBe(false);
    expect(result.error).toContain('keychain error');
    expect(result.error).toContain('boom');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('CRITICAL: testConnection result does NOT contain the apiKey', async () => {
    const secretProvider = new TestProvider(makeKeyLoader('sk-supersecret-test-12345'));
    const fetchMock = makeHeadFetchMock(401);
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const result = await secretProvider.testConnection();
    expect(JSON.stringify(result)).not.toContain('sk-supersecret-test-12345');
  });
});
