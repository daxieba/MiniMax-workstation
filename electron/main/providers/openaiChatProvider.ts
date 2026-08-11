/**
 * OpenAI Chat Completions 流式 provider 基类（T3-2 适配器 + T3-4 结构化提取）
 *
 * **职责**：实现所有走 OpenAI Chat Completions 协议（`POST {baseURL}/chat/completions` + SSE
 * 流）的 provider 的公共逻辑。`MiniMaxProvider` / `OpenAICompatibleProvider` 都继承此类。
 *
 * **设计要点**：
 *   - 只依赖传入的 `metadata` + `deps.getKey` 函数（不直接 import CredentialManager），
 *     方便单测 mock
 *   - **不**引外部 fetch 库（用 Node 18+ 内置 `fetch` + `Response.body` ReadableStream）
 *   - **不**在错误信息 / 日志中输出 key 内容 / AI 原始输出
 *   - chat 走 `text/event-stream`，逐 chunk 通过 `AsyncIterable<ChatChunk>` 暴露
 *   - testConnection 走 `GET {baseURL}/models`（HEAD 减少 payload）做存活 + 鉴权探测
 *   - extractJson 走 chat 内部抽象 `consumeChatToString`（同 chat 走 OpenAI 流式协议），
 *     然后剥 markdown fence + JSON.parse + Zod 验证 + 重试
 *
 * **关键安全约束**（PROJECT_IDENTITY.md §6.1）：
 *   - 所有 catch 分支生成的 Error message **不**含 key
 *   - SSE 解析失败时只透传 provider 自己的错误字段（不含我们这边的 Authorization header）
 *   - 即使 HTTP 401/403/5xx 错误里包含 `Bearer <key>` 回显（极少，但曾发生），我们也只取
 *     `status + statusText` 当 message，**不**复制 body
 *   - T3-4 错误信息**不**含 AI 原始输出（可能含用户敏感数据）
 *
 * **T3-2 范围**：
 *   - 实现 chat（流式 SSE 解析 + 错误归类）
 *   - 实现 testConnection（GET /models 探测）
 *
 * **T3-4 范围**：
 *   - 实现 extractJson（流式收尾 + fence 剥离 + Zod 验证 + 重试）
 *
 * @used-by electron/main/providers/minimaxProvider.ts
 *          electron/main/providers/openaiCompatibleProvider.ts
 *          tests/openaiChatProvider.test.ts
 */

import type { z } from 'zod';

import type {
  ChatChunk,
  ChatMessage,
  JsonExtractionInput,
  ProviderMetadata,
} from '../../../shared/types/ai';
import type {
  ChatInput,
  ConnectionTestResult,
  ExtractJsonErrorCode,
  ProviderAdapter,
} from './ProviderAdapter';

// ============================================================
//  依赖注入接口
// ============================================================

/**
 * `OpenAIChatProvider` 构造时的依赖。
 *
 * 设计原则：基类**不**直接 import `CredentialManager`（避免单测困难 + 减少耦合），
 * 由工厂在主进程入口注入 key 读取器。
 *
 * 字段：
 *   - `getKey` 异步返回 provider 的 API key；未配置时返 `null`（基类据此抛
 *              `DEPENDENCY_MISSING` 错）
 */
export interface OpenAIChatProviderDeps {
  /**
   * 读当前 provider 的 API key。
   *
   * **不抛**"未配置"以外的错（keychain 失败应让上层 handler 转 PERSISTENCE_FAILED）。
   * 返回 `null` → 基类在流内产 `DEPENDENCY_MISSING` error chunk。
   */
  getKey: () => Promise<string | null>;
}

// ============================================================
//  错误分类常量
// ============================================================

/**
 * 错误码常量（与 PROJECT_IDENTITY.md §4.4 对齐 + 适配流式 chat 上下文）。
 *
 * 用途：`ChatChunk` 的 `error.code` 字段统一用这里定义的字符串。T3-4 的兜底层
 * 会基于这些 code 做 IPC 错误码映射。
 */
export const CHAT_ERROR_CODES = {
  /** 未配 API key（DEPENDENCY_MISSING）。 */
  DEPENDENCY_MISSING: 'DEPENDENCY_MISSING',
  /** provider 401 / 403（EXTERNAL_FAILURE / invalid api key）。 */
  INVALID_API_KEY: 'INVALID_API_KEY',
  /** 限流（EXTERNAL_FAILURE / rate limited）。 */
  RATE_LIMITED: 'RATE_LIMITED',
  /** provider 5xx（EXTERNAL_FAILURE / server error）。 */
  SERVER_ERROR: 'SERVER_ERROR',
  /** 网络断开 / DNS 失败 / fetch reject（EXTERNAL_FAILURE / network error）。 */
  NETWORK_ERROR: 'NETWORK_ERROR',
  /** SSE 解析失败 / 协议不匹配（EXTERNAL_FAILURE）。 */
  PROTOCOL_ERROR: 'PROTOCOL_ERROR',
  /** 入参不合法（VALIDATION_FAILED）。 */
  VALIDATION_FAILED: 'VALIDATION_FAILED',
} as const;

export type ChatErrorCode = (typeof CHAT_ERROR_CODES)[keyof typeof CHAT_ERROR_CODES];

/**
 * T3-4 extractJson 专属错误码。
 *
 * 复用 `CHAT_ERROR_CODES` 体系 + 额外的 `INVALID_OUTPUT`（重试用尽 + Zod 失败）。
 * IPC handler 据此映射到 `VALIDATION_FAILED`。
 */
export const EXTRACT_JSON_ERROR_CODES = {
  /** Zod 验证失败且重试用尽（IPC 层映射到 `VALIDATION_FAILED`）。 */
  INVALID_OUTPUT: 'INVALID_OUTPUT',
} as const;

// ============================================================
//  OpenAIChatProvider 基类
// ============================================================

/**
 * OpenAI Chat Completions 公共基类。
 *
 * **继承**：
 *   - 子类必须提供 `metadata: ProviderMetadata`（`ProviderAdapter` 要求）
 *   - 子类**不**需要 override `chat` / `testConnection`（基类已实现完整协议）
 *   - 子类**不**应 override `chat` / `testConnection`（保持两个 provider 一致行为）
 *
 * **chat 实现策略**：用 `async function*`（async generator）。`yield` 出来的值
 * 通过 for-await 被消费方拿到；return 时 JS 自动处理 iterator protocol 的
 * `done: true` 行为。资源清理（reader.cancel）走 `try/finally`。
 */
export abstract class OpenAIChatProvider implements ProviderAdapter {
  public abstract readonly metadata: ProviderMetadata;

  private readonly deps: OpenAIChatProviderDeps;

  public constructor(deps: OpenAIChatProviderDeps) {
    this.deps = deps;
  }

  // ------------------------------------------------------------------
  //  chat（流式 SSE，用 async generator 实现）
  // ------------------------------------------------------------------

  /**
   * 流式 chat（`async function*` 形式）。
   *
   * **事件序列**（成功路径）：
   *   - 0..N 个 `{ type: 'token', content }` —— 文本片段（已拼合 `delta.content`）
   *   - 1 个 `{ type: 'done' }` —— 终止
   *
   * **错误路径**（任意位置产 error chunk，**后**即终止流）：
   *   - 缺 key → `DEPENDENCY_MISSING`
   *   - keychain 抛错 → `NETWORK_ERROR`
   *   - HTTP 401 / 403 → `INVALID_API_KEY`
   *   - HTTP 429 → `RATE_LIMITED`
   *   - HTTP 5xx → `SERVER_ERROR`
   *   - 网络断 → `NETWORK_ERROR`
   *   - SSE 解析失败 → `PROTOCOL_ERROR`
   *   - 入参不合法 → `VALIDATION_FAILED`
   *
   * **安全**：错误 message **不**含 key；URL 也只回显 path，不带 query（key 不会出现在
   * URL 路径上，这是 OpenAI 协议规范保证的）。
   */
  public async *chat(input: ChatInput): AsyncGenerator<ChatChunk, void, undefined> {
    // 1. 入参校验
    const validationError = validateChatInput(this.metadata, input);
    if (validationError) {
      yield { type: 'error', error: { code: validationError.code, message: validationError.message } };
      return;
    }

    const model = input.model ?? this.metadata.defaultModel;

    // 2. 读 key
    let key: string | null;
    try {
      key = await this.deps.getKey();
    } catch (err) {
      // keychain 错 → 当作网络错（流式错误由消费方处理；handler 层会再归类）
      const message = err instanceof Error ? err.message : 'keychain error';
      yield {
        type: 'error',
        error: { code: CHAT_ERROR_CODES.NETWORK_ERROR, message: `keychain error: ${message}` },
      };
      return;
    }
    if (key === null || key.length === 0) {
      yield {
        type: 'error',
        error: { code: CHAT_ERROR_CODES.DEPENDENCY_MISSING, message: 'no API key configured' },
      };
      return;
    }

    // 3. 组请求
    const body: ChatRequestBody = {
      model,
      messages: input.messages,
      stream: true,
    };
    if (typeof input.temperature === 'number') {
      body.temperature = input.temperature;
    }

    const url = joinUrl(this.metadata.defaultBaseURL, '/chat/completions');

    // 4. 发请求
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
          Accept: 'text/event-stream',
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'network error';
      yield {
        type: 'error',
        error: { code: CHAT_ERROR_CODES.NETWORK_ERROR, message: `network error: ${message}` },
      };
      return;
    }

    // 5. 处理 HTTP 错误（4xx / 5xx）
    if (!response.ok) {
      yield* httpErrorToChunks(response.status);
      return;
    }

    if (!response.body) {
      yield {
        type: 'error',
        error: { code: CHAT_ERROR_CODES.PROTOCOL_ERROR, message: 'response has no body' },
      };
      return;
    }

    // 6. 读 SSE 流
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    try {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        let readResult: ReadableStreamReadResult<Uint8Array>;
        try {
          readResult = await reader.read();
        } catch (err) {
          const message = err instanceof Error ? err.message : 'stream read error';
          yield {
            type: 'error',
            error: { code: CHAT_ERROR_CODES.NETWORK_ERROR, message: `network error: ${message}` },
          };
          return;
        }

        if (readResult.done) {
          // 流被服务器关闭但**没**收到 `[DONE]`：按协议视为正常完成
          yield { type: 'done' };
          return;
        }

        buffer += decoder.decode(readResult.value, { stream: true });

        // 解析 buffer 里的所有完整 event
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const parsed = takeSseEvent(buffer);
          if (parsed.event === null) break;
          buffer = parsed.rest;

          if (parsed.event.data === '[DONE]') {
            yield { type: 'done' };
            return;
          }

          const parsed2 = parseChatChunk(parsed.event.data);
          if (parsed2.kind === 'token') {
            yield parsed2.chunk;
          } else if (parsed2.kind === 'skip') {
            // 合法事件但无内容（role-only / usage-only）→ 跳过，继续读
            continue;
          } else {
            // 协议错误 → 终止流
            yield {
              type: 'error',
              error: {
                code: CHAT_ERROR_CODES.PROTOCOL_ERROR,
                message: 'failed to parse sse event',
              },
            };
            return;
          }
        }
      }
    } finally {
      // 无论 yield 中断 / return / throw，都尝试 cancel reader
      try {
        await reader.cancel();
      } catch {
        // ignore
      }
    }
  }

  // ------------------------------------------------------------------
  //  testConnection
  // ------------------------------------------------------------------

  /**
   * 探测 provider 连接 + 鉴权。
   *
   * **实现**：`GET {baseURL}/models`（用 HEAD 减少 payload）。
   *   - 200 → `{ ok: true }`
   *   - 401 → `{ ok: false, error: 'invalid api key' }`（不含 key 内容）
   *   - 403 → `{ ok: false, error: 'forbidden' }`
   *   - 5xx → `{ ok: false, error: 'server error' }`
   *   - 其他 → `{ ok: false, error: 'http <status>' }`
   *   - 网络错 → `{ ok: false, error: 'network error' }`
   *
   * **缺 key** → `{ ok: false, error: 'no API key configured' }`（不抛）。
   *
   * @returns `ConnectionTestResult`，**不**含 key
   */
  public async testConnection(): Promise<ConnectionTestResult> {
    return testConnectionImpl(this.metadata, this.deps);
  }

  // ------------------------------------------------------------------
  //  T3-4：extractJson（结构化提取）
  // ------------------------------------------------------------------

  /**
   * 结构化 JSON 提取（T3-4）。
   *
   * **算法**：
   *   1. 拼 system prompt：业务层 `systemHint`（可选） + 强制 JSON 抽取 hint
   *   2. 走 chat（流式），收尾后取完整文本
   *   3. 剥 markdown fence（```json ... ``` / ``` ... ```）
   *   4. JSON.parse
   *   5. Zod 验证
   *   6. 失败 → 重试 N 次（默认 1 次）；仍失败 → 抛 `INVALID_OUTPUT`
   *
   * **错误码**（与 chat 一致 + `INVALID_OUTPUT`）：
   *   - 缺 key → `DEPENDENCY_MISSING`
   *   - HTTP 401/403 → `INVALID_API_KEY`
   *   - HTTP 429 → `RATE_LIMITED`
   *   - HTTP 5xx → `SERVER_ERROR`
   *   - 网络错 → `NETWORK_ERROR`
   *   - SSE 解析失败 → `PROTOCOL_ERROR`
   *   - 入参错 → `VALIDATION_FAILED`
   *   - 重试 N 次后 Zod 仍失败 → `INVALID_OUTPUT`
   *
   * **安全**：
   *   - 错误信息 / 日志**不**含 AI 原始输出（可能含用户敏感数据）
   *   - 错误信息**不**含 key
   *   - 重试时只在主进程内存里做，**不**写日志
   *
   * **温度**：默认 `temperature=0`（更稳定的 JSON 输出）；调用方可在 input 覆盖。
   *
   * @param input   提取入参
   * @param schema  Zod schema（验证 AI 返回的对象）
   * @returns 通过 schema 验证的对象
   */
  public async extractJson<T>(
    input: JsonExtractionInput,
    schema: z.ZodType<T>,
  ): Promise<T> {
    return extractJsonImpl(this.metadata, this.deps, input, schema);
  }
}

// ============================================================
//  顶层辅助函数
// ============================================================

/** chat 请求 body 类型（OpenAI Chat Completions 协议）。 */
interface ChatRequestBody {
  model: string;
  messages: ChatMessage[];
  stream: true;
  temperature?: number;
}

/** 把 HTTP 错误转成 generator 产出的 chunk 序列（一个 error chunk 就 return）。 */
async function* httpErrorToChunks(
  status: number,
): AsyncGenerator<ChatChunk, void, undefined> {
  if (status === 401 || status === 403) {
    yield {
      type: 'error',
      error: {
        code: CHAT_ERROR_CODES.INVALID_API_KEY,
        message: `invalid api key (http ${status})`,
      },
    };
    return;
  }
  if (status === 429) {
    yield {
      type: 'error',
      error: { code: CHAT_ERROR_CODES.RATE_LIMITED, message: 'rate limited (http 429)' },
    };
    return;
  }
  if (status >= 500 && status < 600) {
    yield {
      type: 'error',
      error: { code: CHAT_ERROR_CODES.SERVER_ERROR, message: `server error (http ${status})` },
    };
    return;
  }
  yield {
    type: 'error',
    error: { code: CHAT_ERROR_CODES.SERVER_ERROR, message: `http ${status}` },
  };
}

/** chat 入参校验。返回 `null` 表示通过；返回 `{ code, message }` 表示错误。 */
function validateChatInput(
  metadata: ProviderMetadata,
  input: ChatInput,
): { code: ChatErrorCode; message: string } | null {
  if (!input || !Array.isArray(input.messages) || input.messages.length === 0) {
    return { code: CHAT_ERROR_CODES.VALIDATION_FAILED, message: 'messages must be a non-empty array' };
  }
  for (const m of input.messages) {
    if (m.role !== 'system' && m.role !== 'user' && m.role !== 'assistant') {
      return { code: CHAT_ERROR_CODES.VALIDATION_FAILED, message: `invalid role: ${String(m.role)}` };
    }
    if (typeof m.content !== 'string') {
      return { code: CHAT_ERROR_CODES.VALIDATION_FAILED, message: 'message content must be a string' };
    }
  }
  if (input.model !== undefined && (typeof input.model !== 'string' || input.model.length === 0)) {
    return { code: CHAT_ERROR_CODES.VALIDATION_FAILED, message: 'model must be a non-empty string when provided' };
  }
  if (
    input.temperature !== undefined &&
    (typeof input.temperature !== 'number' || Number.isNaN(input.temperature))
  ) {
    return { code: CHAT_ERROR_CODES.VALIDATION_FAILED, message: 'temperature must be a number' };
  }
  // 用 metadata 走 sanity check（防止基类被传错 metadata）
  if (!metadata.id || !metadata.defaultBaseURL) {
    return { code: CHAT_ERROR_CODES.VALIDATION_FAILED, message: 'invalid provider metadata' };
  }
  return null;
}

/**
 * 把 `baseURL` + `path` 拼成完整 URL。
 *
 * 规则：
 *   - 去掉 `baseURL` 末尾 `/`、去掉 `path` 开头 `/`
 *   - 不处理 query string（OpenAI 协议不传 key 在 URL 上，query 安全）
 */
function joinUrl(baseURL: string, path: string): string {
  const trimmedBase = baseURL.replace(/\/+$/, '');
  const trimmedPath = path.replace(/^\/+/, '');
  return `${trimmedBase}/${trimmedPath}`;
}

/**
 * testConnection 实现。
 *
 * 用 HEAD 探测 `/models`：200 = 鉴权 OK + 服务可达；401 = key 无效；其他按状态码分类。
 */
async function testConnectionImpl(
  metadata: ProviderMetadata,
  deps: OpenAIChatProviderDeps,
): Promise<ConnectionTestResult> {
  let key: string | null;
  try {
    key = await deps.getKey();
  } catch (err) {
    const message = err instanceof Error ? err.message : 'keychain error';
    return { ok: false, error: `keychain error: ${message}` };
  }
  if (key === null || key.length === 0) {
    return { ok: false, error: 'no API key configured' };
  }

  const url = joinUrl(metadata.defaultBaseURL, '/models');
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'HEAD',
      headers: {
        Authorization: `Bearer ${key}`,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'network error';
    return { ok: false, error: `network error: ${message}` };
  }

  if (response.status === 200) {
    return { ok: true };
  }
  if (response.status === 401) {
    return { ok: false, error: 'invalid api key' };
  }
  if (response.status === 403) {
    return { ok: false, error: 'forbidden' };
  }
  if (response.status === 429) {
    return { ok: false, error: 'rate limited' };
  }
  if (response.status >= 500 && response.status < 600) {
    return { ok: false, error: `server error: ${response.status}` };
  }
  return { ok: false, error: `http ${response.status}` };
}

// ============================================================
//  SSE 解析工具
// ============================================================

/** SSE 单 event 解析结果。 */
interface SseEvent {
  /** event 类型（默认 `message`）。 */
  event: string;
  /** data 行内容（多行按 `\n` 拼合）。 */
  data: string;
}

/** SSE event 解析 + buffer 截取结果。 */
interface SseEventTake {
  event: SseEvent | null;
  /** 剩余未消费的 buffer。 */
  rest: string;
}

/**
 * 从 buffer 里取一个完整 SSE event。
 *
 * SSE 协议：
 *   - event 用空行 `\n\n` 分隔
 *   - 每个 event 是多行 `field: value`，`field` 是 `event` / `data` / `id` / `retry` 等
 *   - `data:` 后面是值（OpenAI 协议里 `data: {json}` 一行；多 data 行用 `\n` 拼合）
 *   - 空行（含 `\r\n\r\n` / `\n\n`）作为 event 分隔
 *
 * @returns `{ event: null, rest }` 时说明 buffer 里**没有**完整 event，需继续读；
 *          `{ event: SseEvent, rest }` 时已取出一个 event。
 */
export function takeSseEvent(buffer: string): SseEventTake {
  // 先用 `\n\n` 切；如果遇到 `\r\n\r\n` 也归一化为 `\n\n`
  const normalized = buffer.replace(/\r\n/g, '\n');
  const sepIndex = normalized.indexOf('\n\n');
  if (sepIndex === -1) {
    return { event: null, rest: buffer };
  }
  const rawEvent = normalized.slice(0, sepIndex);
  const rest = normalized.slice(sepIndex + 2);
  return { event: parseSseEvent(rawEvent), rest };
}

/** 把一个 event 文本（不含分隔空行）解析成 `SseEvent`。 */
function parseSseEvent(raw: string): SseEvent {
  const lines = raw.split('\n');
  let event = 'message';
  const dataLines: string[] = [];
  for (const line of lines) {
    if (line.startsWith(':')) {
      // 注释行，忽略
      continue;
    }
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) {
      // 字段无 `:`：按 SSE 规范视为 field name + empty value；当 data: 处理
      dataLines.push(line);
      continue;
    }
    const field = line.slice(0, colonIdx);
    let value = line.slice(colonIdx + 1);
    if (value.startsWith(' ')) {
      value = value.slice(1);
    }
    if (field === 'event') {
      event = value;
    } else if (field === 'data') {
      dataLines.push(value);
    }
    // 其他字段（id / retry）忽略 —— OpenAI 协议用不到
  }
  return { event, data: dataLines.join('\n') };
}

/**
 * `parseChatChunk` 返回类型（区分"无内容跳过"和"协议解析失败"）。
 *
 *   - `{ kind: 'token', chunk }`    → 产出 token chunk
 *   - `{ kind: 'skip' }`            → SSE 事件合法但**没有** token 内容（跳过；例：role-only
 *                                      起始 chunk、usage-only 终止 chunk）
 *   - `{ kind: 'protocol-error' }`  → JSON 解析失败 / 协议字段不匹配（应终止流）
 */
type ParsedChatChunk =
  | { kind: 'token'; chunk: ChatChunk }
  | { kind: 'skip' }
  | { kind: 'protocol-error' };

/**
 * 把 SSE `data` 字段（OpenAI 协议下是一行 JSON）解析成 `ChatChunk`。
 *
 * OpenAI Chat Completions chunk 形态：
 *   {
 *     "id": "chatcmpl-...",
 *     "object": "chat.completion.chunk",
 *     "choices": [{ "delta": { "content": "Hello" }, "index": 0, "finish_reason": null }]
 *   }
 */
function parseChatChunk(json: string): ParsedChatChunk {
  let obj: unknown;
  try {
    obj = JSON.parse(json);
  } catch {
    return { kind: 'protocol-error' };
  }
  if (!isRecord(obj)) {
    return { kind: 'protocol-error' };
  }
  const choicesRaw = obj['choices'];
  if (!Array.isArray(choicesRaw) || choicesRaw.length === 0) {
    // 可能是 usage-only 的 final chunk（OpenAI stream_options.include_usage=true 时）
    // 这里**不**产 token，直接跳过（业务层不暴露 usage）
    return { kind: 'skip' };
  }
  // 收集所有 choice 的 delta.content
  const parts: string[] = [];
  for (const c of choicesRaw) {
    if (!isRecord(c)) continue;
    const delta = c['delta'];
    if (!isRecord(delta)) continue;
    const content = delta['content'];
    if (typeof content === 'string' && content.length > 0) {
      parts.push(content);
    }
  }
  if (parts.length === 0) {
    // 没有 content 字段（role-only 起始 chunk / 终止 chunk）→ 跳过
    return { kind: 'skip' };
  }
  return { kind: 'token', chunk: { type: 'token', content: parts.join('') } };
}

/** `unknown` → `Record<string, unknown>` 类型守卫。 */
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// ============================================================
//  T3-4 extractJson 实现
// ============================================================

/** extractJson 用的强制 system hint —— 复用同一字符串以方便测试断言。 */
export const EXTRACT_JSON_SYSTEM_HINT =
  'You are a JSON extractor. Output ONLY valid JSON matching the schema. No markdown, no explanations, no preamble, no postscript.';

/**
 * 把 chat 流消费成单个字符串。
 *
 * **复用** `chat()` 的全部错误路径：缺 key / HTTP 401 / SSE 解析失败 → 抛对应错误
 * 码，**不**在错误信息里含 key / AI 原始输出。
 *
 * @returns 累积的完整文本（已拼合所有 token）
 * @throws  任何 chat 的 error chunk 都会被转为 throw，code 走 `CHAT_ERROR_CODES`
 */
async function consumeChatToString(
  metadata: ProviderMetadata,
  deps: OpenAIChatProviderDeps,
  input: ChatInput,
): Promise<string> {
  let out = '';
  const iter = (new OpenAIChatProviderForConsume(metadata, deps)).chat(input);
  for await (const chunk of iter) {
    if (chunk.type === 'token') {
      out += chunk.content;
    } else if (chunk.type === 'done') {
      break;
    } else {
      // error chunk → 抛同 code/message
      const err = new Error(chunk.error.message);
      (err as Error & { code?: string }).code = chunk.error.code;
      throw err;
    }
  }
  return out;
}

/**
 * 内部 `OpenAIChatProvider` 实例（仅供 `consumeChatToString` 复用 chat 流）。
 *
 * 直接 `new`，不暴露给模块外。
 */
class OpenAIChatProviderForConsume extends OpenAIChatProvider {
  public override readonly metadata: ProviderMetadata;
  public constructor(metadata: ProviderMetadata, deps: OpenAIChatProviderDeps) {
    super(deps);
    this.metadata = metadata;
  }
}

/**
 * 剥 markdown code fence（```json ... ``` / ``` ... ```）。
 *
 * 行为：
 *   - 整段以 `\`\`\`` 开头 / 结尾 → 剥
 *   - 首段 fence 后跟可选 `json` / `JSON` 标记 → 剥
 *   - 末尾 fence 前的换行 + 空白 → 剥
 *   - 中间文本原样返回
 *   - 不匹配 → 原样返回
 *
 * **不**做"找第一个 `{` 到最后一个 `}`"这种启发式（容易在文本含 JSON-like 字符时误判）。
 */
export function stripMarkdownFence(text: string): string {
  const trimmed = text.trim();
  // 必须以 ``` 开头
  if (!trimmed.startsWith('```')) return text;
  // 找结束 fence
  const endIdx = trimmed.indexOf('```', 3);
  if (endIdx === -1) return text;
  // 提取中间内容
  let inner = trimmed.slice(3, endIdx);
  // 去掉开头的 language tag（如 ```json / ```JSON / ```typescript）
  // 第一行如果只到换行（或整段无换行），剥掉第一行
  const firstNewline = inner.indexOf('\n');
  if (firstNewline === -1) {
    // 整段就是一个 inline fence（非常少见）
    inner = inner.trim();
  } else {
    const firstLine = inner.slice(0, firstNewline).trim();
    if (firstLine.length > 0 && /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(firstLine)) {
      // 像 language tag → 剥掉
      inner = inner.slice(firstNewline + 1);
    }
  }
  return inner.trim();
}

/**
 * extractJson 实现。
 *
 * 走"chat 收尾 → 剥 fence → JSON.parse → Zod 验证 → 失败重试"流程。
 *
 * **错误抛出**：抛 `Error` 并挂 `code: ExtractJsonErrorCode` 字段（IPC handler 据此归类）。
 */
async function extractJsonImpl<T>(
  metadata: ProviderMetadata,
  deps: OpenAIChatProviderDeps,
  input: JsonExtractionInput,
  schema: z.ZodType<T>,
): Promise<T> {
  // 1. 入参校验
  const validationError = validateExtractJsonInput(metadata, input);
  if (validationError) {
    const err = new Error(validationError.message);
    (err as Error & { code?: string }).code = validationError.code;
    throw err;
  }

  // 2. 拼 system prompt
  const hintParts: string[] = [];
  if (input.systemHint && input.systemHint.trim().length > 0) {
    hintParts.push(input.systemHint);
  }
  hintParts.push(EXTRACT_JSON_SYSTEM_HINT);
  const systemMessage: ChatMessage = { role: 'system', content: hintParts.join('\n\n') };

  const messages: ChatMessage[] = [systemMessage, ...input.messages];
  const model = input.model ?? metadata.defaultModel;
  const temperature = input.temperature ?? 0;
  const maxRetries = input.maxRetries ?? 1;

  // 3. 多次尝试（首次 + maxRetries 次重试）
  let lastParseError: string | null = null;
  const totalAttempts = maxRetries + 1;
  for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
    // 3.1 调 chat
    const rawText = await consumeChatToString(metadata, deps, {
      messages,
      model,
      temperature,
    });

    // 3.2 剥 fence
    const fenced = stripMarkdownFence(rawText);

    // 3.3 JSON.parse
    let parsed: unknown;
    try {
      parsed = JSON.parse(fenced);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'JSON parse error';
      lastParseError = `not valid JSON: ${msg}`;
      // 重试时只把"上次不是 JSON"加到 user 消息尾巴（强制重排）
      // 不在错误信息 / 日志里**含** rawText（安全约束）
      if (attempt < totalAttempts) {
        messages.push({
          role: 'user',
          content: `Your previous reply was ${lastParseError}. Please output ONLY the JSON object, no markdown.`,
        });
        continue;
      }
      // 用尽 → 抛 INVALID_OUTPUT（错误信息**不**含 rawText）
      const outErr = new Error('AI output is not valid JSON after retries');
      (outErr as Error & { code?: string }).code = EXTRACT_JSON_ERROR_CODES.INVALID_OUTPUT;
      throw outErr;
    }

    // 3.4 Zod 验证
    const validation = schema.safeParse(parsed);
    if (validation.success) {
      return validation.data;
    }

    // Zod 失败
    const issueSummary = validation.error.issues
      .slice(0, 3)
      .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
      .join('; ');
    lastParseError = `schema mismatch: ${issueSummary}`;

    if (attempt < totalAttempts) {
      // 重试：把"上次 schema 不匹配"加到 user 消息尾巴（**不**含 rawText）
      messages.push({
        role: 'user',
        content: `Your previous JSON did not match the expected schema (${lastParseError}). Please output ONLY a JSON object that strictly matches the schema.`,
      });
      continue;
    }

    // 用尽 → 抛 INVALID_OUTPUT
    const outErr = new Error('AI output does not match the required schema after retries');
    (outErr as Error & { code?: string }).code = EXTRACT_JSON_ERROR_CODES.INVALID_OUTPUT;
    throw outErr;
  }

  // 实际不会走到这里（循环内 throw 或 return），加兜底让 TS 满意
  const fallback = new Error('extractJson reached unreachable state');
  (fallback as Error & { code?: string }).code = EXTRACT_JSON_ERROR_CODES.INVALID_OUTPUT;
  throw fallback;
}

/** extractJson 入参校验。返回 `null` 表示通过；返回 `{ code, message }` 表示错误。 */
function validateExtractJsonInput(
  metadata: ProviderMetadata,
  input: JsonExtractionInput,
): { code: ExtractJsonErrorCode; message: string } | null {
  if (!input || !Array.isArray(input.messages) || input.messages.length === 0) {
    return {
      code: CHAT_ERROR_CODES.VALIDATION_FAILED,
      message: 'messages must be a non-empty array',
    };
  }
  for (const m of input.messages) {
    if (m.role !== 'system' && m.role !== 'user' && m.role !== 'assistant') {
      return {
        code: CHAT_ERROR_CODES.VALIDATION_FAILED,
        message: `invalid role: ${String(m.role)}`,
      };
    }
    if (typeof m.content !== 'string') {
      return {
        code: CHAT_ERROR_CODES.VALIDATION_FAILED,
        message: 'message content must be a string',
      };
    }
  }
  if (input.model !== undefined && (typeof input.model !== 'string' || input.model.length === 0)) {
    return {
      code: CHAT_ERROR_CODES.VALIDATION_FAILED,
      message: 'model must be a non-empty string when provided',
    };
  }
  if (
    input.temperature !== undefined &&
    (typeof input.temperature !== 'number' || Number.isNaN(input.temperature))
  ) {
    return {
      code: CHAT_ERROR_CODES.VALIDATION_FAILED,
      message: 'temperature must be a number',
    };
  }
  if (input.maxRetries !== undefined) {
    if (
      typeof input.maxRetries !== 'number' ||
      !Number.isInteger(input.maxRetries) ||
      input.maxRetries < 0 ||
      input.maxRetries > 5
    ) {
      return {
        code: CHAT_ERROR_CODES.VALIDATION_FAILED,
        message: 'maxRetries must be an integer in [0, 5]',
      };
    }
  }
  if (
    input.schemaName !== 'inbox_items' &&
    input.schemaName !== 'task_drafts' &&
    input.schemaName !== 'note_summary' &&
    input.schemaName !== 'review_draft'
  ) {
    return {
      code: CHAT_ERROR_CODES.VALIDATION_FAILED,
      message: `unknown schemaName: ${String(input.schemaName)}`,
    };
  }
  if (!metadata.id || !metadata.defaultBaseURL) {
    return {
      code: CHAT_ERROR_CODES.VALIDATION_FAILED,
      message: 'invalid provider metadata',
    };
  }
  return null;
}
