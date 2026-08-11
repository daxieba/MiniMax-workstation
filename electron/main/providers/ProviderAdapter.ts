/**
 * Provider 抽象接口（T3-1 基础设施 + T3-4 结构化提取）
 *
 * 与 `PLAN (1).md` 核心接口的 `ProviderAdapter` 对齐。T3-1 阶段**仅定义接口**，
 * 实际 chat / testConnection 由 T3-2 在具体 provider 类里实现；extractJson 由 T3-4
 * 在 `OpenAIChatProvider` 基类里实现。
 *
 * **设计原则**：
 *   - 接口稳定 → T3-2 / 后续 provider 实现严格按此签名实现
 *   - 业务层（handler / 工作区）只通过 `ProviderAdapter` 与 provider 交互
 *   - provider 内部负责从 `CredentialManager` 读 key，**不**依赖业务层传 key
 *   - provider 内部日志 / 错误**不**输出 key 内容
 *
 * **T3-1 阶段**：
 *   - 接口定义本身
 *   - 默认抛 `not implemented` 的 `NotImplementedProviderAdapter` 占位实现
 *   - 由 `registry.ts` 注册两个占位 provider（MiniMax / OpenAI-compatible）
 *
 * **T3-2 阶段**：
 *   - 实现 `MiniMaxProvider` + `OpenAICompatibleProvider`
 *   - 替换 registry 里的占位 adapter
 *   - chat 走 OpenAI Chat Completions 流式协议
 *
 * **T3-4 阶段**：
 *   - `OpenAIChatProvider` 基类实现 `extractJson`（流式收完后剥 markdown fence + Zod 验证 + 重试）
 *   - 错误码复用 chat 的 `CHAT_ERROR_CODES` 体系
 *   - 错误信息 / 日志**不**含 AI 原始输出
 *
 * @used-by electron/main/providers/registry.ts
 *          T3-2 adapters / T3-4 error fallback
 */

import type { z } from 'zod';

import type {
  ChatChunk,
  ChatMessage,
  JsonExtractionInput,
  ProviderMetadata,
} from '../../../shared/types/ai';

/**
 * Chat 调用入参。
 *
 * 字段：
 *   - `messages`    消息序列（system / user / assistant）
 *   - `model?`      覆盖默认模型（可选；默认用 metadata.defaultModel）
 *   - `temperature?` 温度参数（0-2，部分 provider 不支持，会被忽略）
 */
export interface ChatInput {
  messages: ChatMessage[];
  model?: string;
  temperature?: number;
}

/**
 * 连接测试结果。
 *
 * - `ok: true`               → 连接成功
 * - `ok: false, error: '凭据缺失'` → 未配 apiKey（DEPENDENCY_MISSING 场景）
 * - `ok: false, error: 'provider not implemented'` → T3-1 阶段（EXTERNAL_FAILURE）
 * - `ok: false, error: '其他'` → 网络 / 鉴权失败（EXTERNAL_FAILURE）
 *
 * **不**含 apiKey 内容。
 */
export interface ConnectionTestResult {
  ok: boolean;
  error?: string;
}

/**
 * Provider 适配器接口（所有 AI provider 都必须实现）。
 */
export interface ProviderAdapter {
  /** Provider 元数据（id / displayName / defaultModel / defaultBaseURL / docsUrl）。 */
  readonly metadata: ProviderMetadata;

  /**
   * 流式 chat 调用。返回 `AsyncIterable<ChatChunk>`，调用方通过 `for await` 消费。
   *
   * **T3-1 阶段**：默认实现抛 `'not implemented in T3-1, see T3-2'`。
   * **T3-2 阶段**：实现 OpenAI Chat Completions 流式协议（`text/event-stream`）。
   */
  chat(input: ChatInput): AsyncIterable<ChatChunk>;

  /**
   * 测试 provider 连接。验证：key 存在、HTTP 可达、模型可用。
   *
   * **T3-1 阶段**：默认实现抛 `'not implemented in T3-1, see T3-2'`。
   * **T3-2 阶段**：发一个最小 `chat` 请求，捕获 401 / 4xx / 5xx 错误。
   */
  testConnection(): Promise<ConnectionTestResult>;

  /**
   * 结构化提取：让 provider 用 chat 强制 JSON 输出，剥 markdown fence，过 Zod 验证。
   *
   * **T3-4 阶段**：由 `OpenAIChatProvider` 基类实现。错误码复用 `CHAT_ERROR_CODES`：
   *   - 缺 key → `DEPENDENCY_MISSING`
   *   - HTTP 401/403/429/5xx/网络 → `EXTERNAL_FAILURE` 系列
   *   - 协议错 → `PROTOCOL_ERROR`
   *   - 全部重试用尽 + Zod 失败 → `INVALID_OUTPUT`
   *   - 入参错 → `VALIDATION_FAILED`
   *
   * **安全**：错误信息 / 日志**不**含 AI 原始输出。
   *
   * @param input    提取入参（provider / messages / schemaName / systemHint / model / temperature / maxRetries）
   * @param schema   Zod schema（用于验证 AI 返回的对象）
   * @returns 已通过 schema 验证的对象
   */
  extractJson<T>(input: JsonExtractionInput, schema: z.ZodType<T>): Promise<T>;
}

/**
 * 未实现错误消息（T3-1 占位 provider 用）。
 *
 * 集中放这里：T3-1 阶段的两个占位 provider 都抛同一个文案，方便测试断言
 * 和日志检索。
 */
export const NOT_IMPLEMENTED_ERROR_MESSAGE = 'not implemented in T3-1, see T3-2';

/**
 * T3-4 extractJson 错误码集合（类型）。
 *
 * 复用 `CHAT_ERROR_CODES`（OpenAIChatProvider 模块）+ 额外的 `INVALID_OUTPUT`
 * 表示"重试 N 次后 Zod 验证仍失败"。IPC handler 据此映射到 `VALIDATION_FAILED`。
 *
 * **常量定义**见 `electron/main/providers/openaiChatProvider.ts` 的 `EXTRACT_JSON_ERROR_CODES`。
 */
export type ExtractJsonErrorCode =
  | 'INVALID_OUTPUT'
  | 'DEPENDENCY_MISSING'
  | 'INVALID_API_KEY'
  | 'RATE_LIMITED'
  | 'SERVER_ERROR'
  | 'NETWORK_ERROR'
  | 'PROTOCOL_ERROR'
  | 'VALIDATION_FAILED';

/**
 * 占位 Provider 适配器基类（T3-1 阶段用）。
 *
 * 任何 T3-1 阶段注册的 provider 都继承此类，`chat` / `testConnection` / `extractJson`
 * 默认抛 "not implemented"。T3-2 / T3-4 阶段的真实现继承 `OpenAIChatProvider`，
 * **不**继承本类。
 *
 * **设计取舍**：用基类而不是 `NotImplementedProviderAdapter` 工厂，是因为
 * T3-2 阶段的 provider 也想复用基类的 metadata / 工具方法（key 读取、
 * 错误处理）。基类本身不持有任何状态，metadata 由子类提供。
 */
export abstract class BaseProviderAdapter implements ProviderAdapter {
  public abstract readonly metadata: ProviderMetadata;

  /**
   * T3-1 默认实现：抛 `NOT_IMPLEMENTED_ERROR_MESSAGE`。
   * T3-2 子类必须 override。
   *
   * **实现说明**：返回手写的 `AsyncIterable`，第一次 `.next()` 时 reject。
   * 用手写对象而非 `async *`，避免 async generator body 必须有 yield 的限制。
   */
  public chat(_input: ChatInput): AsyncIterable<ChatChunk> {
    return {
      [Symbol.asyncIterator](): AsyncIterator<ChatChunk> {
        const err = new Error(NOT_IMPLEMENTED_ERROR_MESSAGE);
        return {
          async next(): Promise<IteratorResult<ChatChunk>> {
            throw err;
          },
        };
      },
    };
  }

  /**
   * T3-1 默认实现：返回 `Promise.reject(not implemented)`。
   * T3-2 子类必须 override。
   */
  public testConnection(): Promise<ConnectionTestResult> {
    return Promise.reject(new Error(NOT_IMPLEMENTED_ERROR_MESSAGE));
  }

  /**
   * T3-1 / T3-2 默认实现：返回 `Promise.reject(not implemented)`。
   * T3-4 起由 `OpenAIChatProvider` 真正实现。
   */
  public extractJson<T>(
    _input: JsonExtractionInput,
    _schema: z.ZodType<T>,
  ): Promise<T> {
    return Promise.reject(new Error(NOT_IMPLEMENTED_ERROR_MESSAGE));
  }
}
