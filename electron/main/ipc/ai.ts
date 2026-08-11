/**
 * AI IPC handler（T3-1 基础设施 + T3-3 流式 chat + T3-4 结构化提取）
 *
 * 暴露 10 个通道（命名遵循 PROJECT_IDENTITY.md §4.1，格式 `namespace:action`）：
 *   - `ai:listProviders`   ()                        → `ProviderMetadata[]`
 *   - `ai:hasKey`          ({ provider })            → `{ hasKey: boolean }`
 *   - `ai:setKey`          ({ provider, key })       → `{ ok: true }`（响应不回显 key）
 *   - `ai:deleteKey`       ({ provider })            → `{ ok: true }`
 *   - `ai:getConfig`       ({ provider })            → `AiConfig`（缺省回退到 metadata）
 *   - `ai:setConfig`       ({ provider, config })    → `AiConfig`
 *   - `ai:testConnection`  ({ provider })            → `{ ok, error? }`
 *   - `ai:chat`            (流式 / `ipcMain.on` + `event.sender.send` 推 chunk)
 *   - `ai:chat:cancel`     ({ requestId })            → 取消一个进行中的 chat
 *   - `ai:extractJson`     (input)                   → 已通过 Zod 验证的对象 + attempts
 *
 * 全部遵循 PROJECT_IDENTITY.md §4 IPC 契约：
 *   - 入口过 Zod（共享 schema 在 `shared/schemas/ai.ts`）
 *   - try/catch 全包，错误统一转成 `{ code, message, details? }`
 *   - **不**返回原始异常对象
 *   - **不**在日志 / 错误信息中打印 key 内容（PROJECT_IDENTITY.md §6.1）
 *
 * 错误码（PROJECT_IDENTITY.md §4.4）：
 *   - `VALIDATION_FAILED`  Zod 校验失败 / extractJson 重试用尽（INVALID_OUTPUT）
 *   - `NOT_FOUND`          provider / config 不存在 / 未知 schemaName
 *   - `DEPENDENCY_MISSING` 凭据未配置（`ai:testConnection` 在 hasKey=false 时返）
 *   - `EXTERNAL_FAILURE`   provider 调用失败（testConnection / 流式 chat）
 *   - `PERSISTENCE_FAILED` db 操作失败
 *   - `INTERNAL`           未分类
 *
 * **范围**：
 *   - T3-1:  key 管理 + config 管理 + provider 元数据查询 + testConnection 占位
 *   - T3-2:  真实 provider 适配器
 *   - T3-3:  **新增 `ai:chat` 流式 chat + `ai:chat:cancel` 取消**
 *            错误处理 401/429/5xx/网络 → EXTERNAL_FAILURE，缺 key → DEPENDENCY_MISSING
 *   - T3-4:  **新增 `ai:extractJson` 结构化提取 + 错误兜底**
 *            重试 N 次（默认 1）后 Zod 仍失败 → `INVALID_OUTPUT` → IPC 映射 `VALIDATION_FAILED`
 *            错误信息**不**含 AI 原始输出（可能含用户敏感数据）+ **不**含 key
 *   - **不**做 note / kb / review / search IPC（留给 T4-x）
 *
 * **流式设计**（T3-3）：
 *   - `ipcMain.on('ai:chat', ...)` 而非 `ipcMain.handle`（handle 不支持长连接流）
 *   - 每个 chunk 通过 `event.sender.send('ai:chat:chunk', envelope)` 推回渲染端
 *   - 渲染端按 `envelope.requestId` 路由到正确的回调
 *   - 取消：`ipcMain.on('ai:chat:cancel', ...)` 把 `requestId` 标记 cancelled，
 *     流式迭代器下次 yield 时中止（清理 reader + 不再 send）
 *   - **安全**：错误 chunk 的 message **不**含 key
 *
 * **测试策略**（tests/aiIpc.test.ts / tests/aiChatIpc.test.ts / tests/extractJsonIpc.test.ts）：
 *   - 10 个 handler 函数以 named export 暴露（handleAi*），
 *     测试直接传 `deps` + `payload` 调用，绕开 ipcMain 的事件循环
 *   - `registerAiIpc(deps)` 只在主进程启动时调一次
 *   - T3-3 额外提供 `collectChatChunks(...)` 工具：把流式 chunk 收到数组里便于断言
 */

import { eq } from 'drizzle-orm';
import type { IpcMainEvent, WebContents } from 'electron';
import { ipcMain } from 'electron';

import { type WorkstationDb } from '../../../db/client';
import { aiConfigs, type AiConfigRow } from '../../../db/schema';
import {
  AiConfigSchema,
  AiGetConfigResponseSchema,
  AiHasKeyResponseSchema,
  AiListProvidersResponseSchema,
  AiOkResponseSchema,
  AiProviderInputSchema,
  AiSetConfigInputSchema,
  AiSetConfigResponseSchema,
  AiSetKeyInputSchema,
  AiTestConnectionDataSchema,
  AiTestConnectionResponseSchema,
  ChatCancelRequestSchema,
  ChatChunkEnvelopeSchema,
  ChatRequestSchema,
  ExtractJsonRequestSchema,
  ExtractJsonResponseDataSchema,
  ExtractJsonResponseSchema,
  ProviderMetadataListSchema,
  SCHEMA_REGISTRY,
  type AiConfigParsed,
  type AiSetConfigInputParsed,
  type ChatRequestParsed,
  type ExtractJsonRequestParsed,
} from '../../../shared/schemas/ai';
import type {
  AiConfig,
  ChatChunk,
  ChatMessage,
  ProviderId,
  ProviderMetadata,
} from '../../../shared/types/ai';
import { type CredentialManager } from '../credentials/credentialManager';
import {
  getProvider,
  getProviderMetadata,
  listProviders,
} from '../providers/registry';
import { CHAT_ERROR_CODES, EXTRACT_JSON_ERROR_CODES } from '../providers/openaiChatProvider';

/** 依赖注入：注册时由主进程传入 db 客户端 + CredentialManager。 */
export interface AiIpcDeps {
  db: WorkstationDb;
  credentialManager: CredentialManager;
}

/** IPC 错误统一格式（PROJECT_IDENTITY.md §4.2）。 */
export interface IpcErrorPayload {
  code:
    | 'VALIDATION_FAILED'
    | 'NOT_FOUND'
    | 'DEPENDENCY_MISSING'
    | 'EXTERNAL_FAILURE'
    | 'PERSISTENCE_FAILED'
    | 'INTERNAL';
  message: string;
  details?: unknown;
}

/** 把任意异常转成 IPC 错误对象。 */
function toIpcError(err: unknown): IpcErrorPayload {
  if (err instanceof Error) {
    return { code: 'INTERNAL', message: err.message };
  }
  return { code: 'INTERNAL', message: String(err) };
}

/** 把 db 错误归类到 PERSISTENCE_FAILED。 */
function toPersistenceError(err: unknown, fallbackMessage: string): IpcErrorPayload {
  if (err instanceof Error) {
    return { code: 'PERSISTENCE_FAILED', message: `${fallbackMessage}: ${err.message}` };
  }
  return { code: 'PERSISTENCE_FAILED', message: `${fallbackMessage}: ${String(err)}` };
}

/** 判断 err 是否为已结构化的 IPC 错误。 */
function isStructuredIpcError(err: unknown): err is IpcErrorPayload {
  if (err === null || typeof err !== 'object') return false;
  const obj = err as { code?: unknown; message?: unknown };
  if (typeof obj.code !== 'string' || typeof obj.message !== 'string') return false;
  return (
    obj.code === 'VALIDATION_FAILED' ||
    obj.code === 'NOT_FOUND' ||
    obj.code === 'DEPENDENCY_MISSING' ||
    obj.code === 'EXTERNAL_FAILURE' ||
    obj.code === 'PERSISTENCE_FAILED' ||
    obj.code === 'INTERNAL'
  );
}

/**
 * 把 db 行（`AiConfigRow`）转成 IPC DTO（`AiConfigParsed`）。
 *
 * 转换点：`updatedAt` Date → number (Unix ms)。
 */
function rowToAiConfig(row: AiConfigRow): AiConfigParsed {
  const item: AiConfig = {
    provider: row.provider as ProviderId,
    model: row.model,
    baseURL: row.baseURL,
    updatedAt: row.updatedAt,
  };
  return AiConfigSchema.parse(item);
}

/**
 * 从 registry metadata 构造一个**缺省** AiConfig（首次配置时用）。
 *
 * @returns AiConfig；provider 不存在时返回 `undefined`（handler 据此 NOT_FOUND）
 */
function defaultAiConfigFor(provider: ProviderId): AiConfigParsed | undefined {
  const meta = getProviderMetadata(provider);
  if (!meta) return undefined;
  const item: AiConfig = {
    provider: meta.id,
    model: meta.defaultModel,
    baseURL: meta.defaultBaseURL,
    updatedAt: 0, // 0 = "未落库，使用 metadata 默认值"
  };
  return AiConfigSchema.parse(item);
}

// ============================================================
//  handler 函数（独立可测）
// ============================================================

/** `ai:listProviders` handler。 */
export async function handleAiListProviders(
  _deps: AiIpcDeps,
  _payload: unknown,
): Promise<ProviderMetadata[]> {
  try {
    const items = listProviders();
    return ProviderMetadataListSchema.parse(items);
  } catch (err) {
    if (isStructuredIpcError(err)) throw err;
    throw toIpcError(err);
  }
}

/** `ai:hasKey` handler。 */
export async function handleAiHasKey(
  deps: AiIpcDeps,
  payload: unknown,
): Promise<{ hasKey: boolean }> {
  const parsed = AiProviderInputSchema.safeParse(payload);
  if (!parsed.success) {
    throw {
      code: 'VALIDATION_FAILED' as const,
      message: 'Invalid ai:hasKey input',
      details: parsed.error.flatten(),
    };
  }
  const { provider } = parsed.data;

  // 先确认 provider 在 registry 里（防御性）
  const meta = getProviderMetadata(provider);
  if (!meta) {
    throw {
      code: 'NOT_FOUND' as const,
      message: `Provider not found: ${provider}`,
    };
  }

  try {
    const hasKey = await deps.credentialManager.hasKey(provider);
    return { hasKey };
  } catch (err) {
    if (isStructuredIpcError(err)) throw err;
    throw toIpcError(err);
  }
}

/** `ai:setKey` handler —— **不**回显 key。 */
export async function handleAiSetKey(
  deps: AiIpcDeps,
  payload: unknown,
): Promise<{ ok: true }> {
  const parsed = AiSetKeyInputSchema.safeParse(payload);
  if (!parsed.success) {
    throw {
      code: 'VALIDATION_FAILED' as const,
      message: 'Invalid ai:setKey input',
      details: parsed.error.flatten(),
    };
  }
  const { provider, key } = parsed.data;

  const meta = getProviderMetadata(provider);
  if (!meta) {
    throw {
      code: 'NOT_FOUND' as const,
      message: `Provider not found: ${provider}`,
    };
  }

  try {
    // 注意：日志 / 错误**禁止**含 key 内容
    await deps.credentialManager.setKey(provider, key);
    return { ok: true as const };
  } catch (err) {
    if (isStructuredIpcError(err)) throw err;
    throw toIpcError(err);
  }
}

/** `ai:deleteKey` handler。 */
export async function handleAiDeleteKey(
  deps: AiIpcDeps,
  payload: unknown,
): Promise<{ ok: true }> {
  const parsed = AiProviderInputSchema.safeParse(payload);
  if (!parsed.success) {
    throw {
      code: 'VALIDATION_FAILED' as const,
      message: 'Invalid ai:deleteKey input',
      details: parsed.error.flatten(),
    };
  }
  const { provider } = parsed.data;

  const meta = getProviderMetadata(provider);
  if (!meta) {
    throw {
      code: 'NOT_FOUND' as const,
      message: `Provider not found: ${provider}`,
    };
  }

  try {
    await deps.credentialManager.deleteKey(provider);
    return { ok: true as const };
  } catch (err) {
    if (isStructuredIpcError(err)) throw err;
    throw toIpcError(err);
  }
}

/**
 * `ai:getConfig` handler。
 *
 * 缺省回退：db 查不到行 → 返回 metadata default（`updatedAt=0` 表示"未落库"）。
 * 渲染端 UI 看到 `updatedAt=0` 时显示"使用默认配置"，不写入。
 */
export async function handleAiGetConfig(
  deps: AiIpcDeps,
  payload: unknown,
): Promise<AiConfigParsed> {
  const parsed = AiProviderInputSchema.safeParse(payload);
  if (!parsed.success) {
    throw {
      code: 'VALIDATION_FAILED' as const,
      message: 'Invalid ai:getConfig input',
      details: parsed.error.flatten(),
    };
  }
  const { provider } = parsed.data;

  const meta = getProviderMetadata(provider);
  if (!meta) {
    throw {
      code: 'NOT_FOUND' as const,
      message: `Provider not found: ${provider}`,
    };
  }

  try {
    const row = deps.db.select().from(aiConfigs).where(eq(aiConfigs.provider, provider)).get();
    if (row) {
      return rowToAiConfig(row);
    }
    // 缺省回退到 metadata
    const fallback = defaultAiConfigFor(provider);
    if (!fallback) {
      throw {
        code: 'NOT_FOUND' as const,
        message: `Provider not found: ${provider}`,
      };
    }
    return fallback;
  } catch (err) {
    if (isStructuredIpcError(err)) throw err;
    throw toPersistenceError(err, 'Failed to read ai_config');
  }
}

/** `ai:setConfig` handler（upsert）。 */
export async function handleAiSetConfig(
  deps: AiIpcDeps,
  payload: unknown,
): Promise<AiConfigParsed> {
  const parsed = AiSetConfigInputSchema.safeParse(payload);
  if (!parsed.success) {
    throw {
      code: 'VALIDATION_FAILED' as const,
      message: 'Invalid ai:setConfig input',
      details: parsed.error.flatten(),
    };
  }
  const { provider, config }: AiSetConfigInputParsed = parsed.data;

  const meta = getProviderMetadata(provider);
  if (!meta) {
    throw {
      code: 'NOT_FOUND' as const,
      message: `Provider not found: ${provider}`,
    };
  }

  const now = Date.now();
  try {
    // upsert：drizzle 的 onConflictDoUpdate 走 PK 冲突
    deps.db
      .insert(aiConfigs)
      .values({
        provider,
        model: config.model,
        baseURL: config.baseURL,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: aiConfigs.provider,
        set: {
          model: config.model,
          baseURL: config.baseURL,
          updatedAt: now,
        },
      })
      .run();

    const row = deps.db.select().from(aiConfigs).where(eq(aiConfigs.provider, provider)).get();
    if (!row) {
      throw {
        code: 'INTERNAL' as const,
        message: 'ai_config was written but cannot be read back',
      };
    }
    return rowToAiConfig(row);
  } catch (err) {
    if (isStructuredIpcError(err)) throw err;
    throw toPersistenceError(err, 'Failed to write ai_config');
  }
}

/**
 * `ai:testConnection` handler。
 *
 * 行为（T3-1 阶段）：
 *   - hasKey=false → `{ ok: false, error: 'no API key configured' }` (DEPENDENCY_MISSING)
 *   - hasKey=true, provider 实现可调 → 调 `provider.testConnection()`，T3-1 阶段
 *     占位实现返 `{ ok: false, error: 'not implemented in T3-1, see T3-2' }` (EXTERNAL_FAILURE)
 *
 * **安全**：测试期间**不**回显 key。
 */
export async function handleAiTestConnection(
  deps: AiIpcDeps,
  payload: unknown,
): Promise<{ ok: boolean; error?: string | undefined }> {
  const parsed = AiProviderInputSchema.safeParse(payload);
  if (!parsed.success) {
    throw {
      code: 'VALIDATION_FAILED' as const,
      message: 'Invalid ai:testConnection input',
      details: parsed.error.flatten(),
    };
  }
  const { provider } = parsed.data;

  const meta = getProviderMetadata(provider);
  if (!meta) {
    throw {
      code: 'NOT_FOUND' as const,
      message: `Provider not found: ${provider}`,
    };
  }

  // 1. 先检查 key 是否存在
  let hasKey = false;
  try {
    hasKey = await deps.credentialManager.hasKey(provider);
  } catch (err) {
    throw toIpcError(err);
  }
  if (!hasKey) {
    // DEPENDENCY_MISSING 是 IPC 错误码语义，但 ai:testConnection 的成功响应
    // 本身就允许 `ok: false` —— 渲染端不当作 IPC 失败，而是当作"测试结果"。
    return { ok: false, error: 'no API key configured' };
  }

  // 2. 调 provider.testConnection()
  const adapter = getProvider(provider);
  if (!adapter) {
    return { ok: false, error: `Provider not registered: ${provider}` };
  }
  try {
    const result = await adapter.testConnection();
    return AiTestConnectionDataSchema.parse(result);
  } catch (err) {
    // T3-1 占位实现走 Promise.reject 路径 → 转成 ok:false 响应
    // 不抛 EXTERNAL_FAILURE，避免渲染端误判为 IPC 错误
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

/**
 * `ai:extractJson` handler（T3-4 结构化提取）。
 *
 * 行为：
 *   1. Zod 校验入参
 *   2. 查 SCHEMA_REGISTRY 拿 Zod schema（schemaName 未知 → NOT_FOUND）
 *   3. 拿 provider adapter（未注册 → NOT_FOUND）
 *   4. 调 `provider.extractJson(input, schema)` —— 内部已完成重试 + Zod 验证
 *   5. 把 extractJson 抛的 `Error & { code }` 映射到 IPC 错误码
 *      - `INVALID_OUTPUT`（重试用尽 + Zod 失败）→ `VALIDATION_FAILED`
 *      - `DEPENDENCY_MISSING` → `DEPENDENCY_MISSING`
 *      - `INVALID_API_KEY` / `RATE_LIMITED` / `SERVER_ERROR` / `NETWORK_ERROR` / `PROTOCOL_ERROR`
 *        → `EXTERNAL_FAILURE`
 *      - `VALIDATION_FAILED` → `VALIDATION_FAILED`
 *      - 其它 → `INTERNAL`
 *
 * **安全**：
 *   - 错误信息**不**含 AI 原始输出（来自 provider.extractJson 的承诺）
 *   - 错误信息**不**含 key
 *   - 错误信息**不**含具体 schema 路径（避免信息泄露）
 */
export async function handleAiExtractJson(
  deps: AiIpcDeps,
  payload: unknown,
): Promise<{ data: unknown; attempts: number }> {
  // 1. 入参 Zod
  const parsed = ExtractJsonRequestSchema.safeParse(payload);
  if (!parsed.success) {
    throw {
      code: 'VALIDATION_FAILED' as const,
      message: 'Invalid ai:extractJson input',
      details: parsed.error.flatten(),
    };
  }
  const input: ExtractJsonRequestParsed = parsed.data;

  // 2. schema 查表
  const schema = SCHEMA_REGISTRY[input.schemaName];
  if (!schema) {
    // 理论上 `JsonExtractionSchemaNameSchema` 已限缩，但运行时仍防御一下
    throw {
      code: 'NOT_FOUND' as const,
      message: `Unknown schemaName: ${input.schemaName}`,
    };
  }

  // 3. provider 查 registry
  const adapter = getProvider(input.provider);
  if (!adapter) {
    throw {
      code: 'NOT_FOUND' as const,
      message: `Provider not registered: ${input.provider}`,
    };
  }

  // 4. 调 provider.extractJson
  //    不用 void 装，直接 await；重试在 provider 内部完成，attempts 通过包装抛出
  //    错误码的方式让 handler 取不到 → 我们用一个轻量包装：通过子 hint 字符串解析
  //    实际上 provider 的 attempts 不透传（减少耦合）；handler 直接返回 attempts=1
  //    （占位：重试细节在 provider 内部完成；attempts 字段对 UI 仅作调试展示）
  try {
    // provider 内部已通过 Zod 验证；这里把 schema 强制 cast 成 z.ZodType<unknown>
    // 然后再 safeParse 在 IPC 边界做一次"出/入双向"校验（防御 provider 内部 bug）
    const data = (await adapter.extractJson(
      input,
      schema as Parameters<typeof adapter.extractJson>[1],
    )) as unknown;
    // 5. 出口再用 schema 校验一次（IPC 边界防御）—— 已通过的不会失败
    schema.parse(data);
    return { data, attempts: 1 };
  } catch (err) {
    throw mapExtractJsonError(err);
  }
}

/**
 * 把 provider.extractJson 抛的错统一映射成 IPC 错误对象。
 *
 * provider 在错误对象上挂 `code`（`ExtractJsonErrorCode` 联合）。
 * 此函数读 `code` 字段映射到 IPC 错误码：
 *   - `INVALID_OUTPUT`（重试用尽）→ `VALIDATION_FAILED`
 *   - `DEPENDENCY_MISSING` → `DEPENDENCY_MISSING`
 *   - `INVALID_API_KEY` / `RATE_LIMITED` / `SERVER_ERROR` / `NETWORK_ERROR` / `PROTOCOL_ERROR`
 *     → `EXTERNAL_FAILURE`
 *   - `VALIDATION_FAILED` → `VALIDATION_FAILED`
 *   - 其它 → `INTERNAL`
 */
function mapExtractJsonError(err: unknown): IpcErrorPayload {
  if (isStructuredIpcError(err)) return err;
  const code =
    err !== null && typeof err === 'object' && 'code' in err
      ? (err as { code?: unknown }).code
      : undefined;
  if (typeof code === 'string') {
    if (code === EXTRACT_JSON_ERROR_CODES.INVALID_OUTPUT) {
      return {
        code: 'VALIDATION_FAILED',
        message: err instanceof Error ? err.message : 'AI output validation failed',
      };
    }
    if (code === CHAT_ERROR_CODES.DEPENDENCY_MISSING) {
      return {
        code: 'DEPENDENCY_MISSING',
        message: err instanceof Error ? err.message : 'Dependency missing',
      };
    }
    if (code === CHAT_ERROR_CODES.VALIDATION_FAILED) {
      return {
        code: 'VALIDATION_FAILED',
        message: err instanceof Error ? err.message : 'Validation failed',
      };
    }
    if (
      code === CHAT_ERROR_CODES.INVALID_API_KEY ||
      code === CHAT_ERROR_CODES.RATE_LIMITED ||
      code === CHAT_ERROR_CODES.SERVER_ERROR ||
      code === CHAT_ERROR_CODES.NETWORK_ERROR ||
      code === CHAT_ERROR_CODES.PROTOCOL_ERROR
    ) {
      return {
        code: 'EXTERNAL_FAILURE',
        message: err instanceof Error ? err.message : `Provider call failed (${code})`,
      };
    }
  }
  // 兜底
  if (err instanceof Error) {
    return { code: 'INTERNAL', message: err.message };
  }
  return { code: 'INTERNAL', message: String(err) };
}

// ============================================================
//  registerAiIpc：把 handler 挂到 ipcMain（主进程启动时调一次）
// ============================================================

/**
 * 注册 8 个 `ai:*` IPC handler（T3-4 加 `ai:extractJson`，共 9 个：8 handle + 1 流式 on）。
 *
 * 调用方：`electron/main/index.ts` 的 `app.whenReady()` 阶段。
 */
export function registerAiIpc(deps: AiIpcDeps): void {
  ipcMain.handle('ai:listProviders', async (_evt, payload: unknown) => {
    try {
      const data = await handleAiListProviders(deps, payload);
      return { ok: true as const, data: AiListProvidersResponseSchema.shape.data.parse(data) };
    } catch (err) {
      if (isStructuredIpcError(err)) return { ok: false as const, error: err };
      return { ok: false as const, error: toIpcError(err) };
    }
  });

  ipcMain.handle('ai:hasKey', async (_evt, payload: unknown) => {
    try {
      const data = await handleAiHasKey(deps, payload);
      return { ok: true as const, data: AiHasKeyResponseSchema.shape.data.parse(data) };
    } catch (err) {
      if (isStructuredIpcError(err)) return { ok: false as const, error: err };
      return { ok: false as const, error: toIpcError(err) };
    }
  });

  ipcMain.handle('ai:setKey', async (_evt, payload: unknown) => {
    try {
      const data = await handleAiSetKey(deps, payload);
      return AiOkResponseSchema.parse(data);
    } catch (err) {
      if (isStructuredIpcError(err)) return { ok: false as const, error: err };
      return { ok: false as const, error: toIpcError(err) };
    }
  });

  ipcMain.handle('ai:deleteKey', async (_evt, payload: unknown) => {
    try {
      const data = await handleAiDeleteKey(deps, payload);
      return AiOkResponseSchema.parse(data);
    } catch (err) {
      if (isStructuredIpcError(err)) return { ok: false as const, error: err };
      return { ok: false as const, error: toIpcError(err) };
    }
  });

  ipcMain.handle('ai:getConfig', async (_evt, payload: unknown) => {
    try {
      const data = await handleAiGetConfig(deps, payload);
      return { ok: true as const, data: AiGetConfigResponseSchema.shape.data.parse(data) };
    } catch (err) {
      if (isStructuredIpcError(err)) return { ok: false as const, error: err };
      return { ok: false as const, error: toIpcError(err) };
    }
  });

  ipcMain.handle('ai:setConfig', async (_evt, payload: unknown) => {
    try {
      const data = await handleAiSetConfig(deps, payload);
      return { ok: true as const, data: AiSetConfigResponseSchema.shape.data.parse(data) };
    } catch (err) {
      if (isStructuredIpcError(err)) return { ok: false as const, error: err };
      return { ok: false as const, error: toIpcError(err) };
    }
  });

  ipcMain.handle('ai:testConnection', async (_evt, payload: unknown) => {
    try {
      const data = await handleAiTestConnection(deps, payload);
      return { ok: true as const, data: AiTestConnectionResponseSchema.shape.data.parse(data) };
    } catch (err) {
      if (isStructuredIpcError(err)) return { ok: false as const, error: err };
      return { ok: false as const, error: toIpcError(err) };
    }
  });

  // ---- T3-3 新增：流式 chat + cancel ----
  // 用 ipcMain.on（不是 handle）—— handle 不支持长连接流。
  // 每个发起 chat 的 WebContents 拥有独立的 AbortController map，
  // 由 cancel 通道把 requestId 标记为 cancelled，下次 yield 时退出。
  // 模块级状态在文件顶部定义，registerAiIpc 与 runAiChatStream 共享。

  ipcMain.on('ai:chat', (event: IpcMainEvent, rawPayload: unknown) => {
    // 异步跑，**不**阻塞主进程
    void runAiChatStream({
      rawPayload,
      sender: event.sender,
    });
  });

  ipcMain.on('ai:chat:cancel', (event: IpcMainEvent, rawPayload: unknown) => {
    const parsed = ChatCancelRequestSchema.safeParse(rawPayload);
    if (!parsed.success) {
      // 取消请求本身的入参不合法 → 静默忽略（不打扰用户）
      return;
    }
    cancelAiChat(event.sender.id, parsed.data.requestId);
  });

  // ---- T3-4 新增：结构化提取 ----
  ipcMain.handle('ai:extractJson', async (_evt, payload: unknown) => {
    try {
      const result = await handleAiExtractJson(deps, payload);
      // 出口再用 schema 校验（防御 provider 内部 bug）
      return ExtractJsonResponseSchema.parse({
        ok: true as const,
        data: ExtractJsonResponseDataSchema.parse({
          data: result.data,
          attempts: result.attempts,
        }),
      });
    } catch (err) {
      if (isStructuredIpcError(err)) return { ok: false as const, error: err };
      return { ok: false as const, error: toIpcError(err) };
    }
  });
}

// ============================================================
//  T3-3 流式 chat 核心实现（独立可测）
// ============================================================

/**
 * T3-3 模块级状态：senderId → (requestId → AbortController)。
 *
 * 用 module-scope 是为了让 `runAiChatStream` / cancel / cleanup 三个入口共享同一份 map，
 * 而不必每次 registerAiIpc 重新分配（导致旧引用与新引用分裂）。
 *
 * **测试**：`__resetAiChatModuleStateForTest()` 在测试 `beforeEach` 调一下，
 * 避免跨 case 的控制器残留。
 */
const aiChatControllersBySender = new Map<number, Map<string, AbortController>>();

/** 测试辅助：清空所有 controller + map。 */
export function __resetAiChatModuleStateForTest(): void {
  for (const inner of aiChatControllersBySender.values()) {
    for (const c of inner.values()) {
      c.abort();
    }
  }
  aiChatControllersBySender.clear();
}

/** 拿 / 创建某个 sender 的 controller map。 */
function getOrCreateSenderMap(senderId: number): Map<string, AbortController> {
  let map = aiChatControllersBySender.get(senderId);
  if (!map) {
    map = new Map();
    aiChatControllersBySender.set(senderId, map);
  }
  return map;
}

/** 取消一个 sender 的指定 requestId 的 chat。 */
function cancelAiChat(senderId: number, requestId: string): void {
  const map = aiChatControllersBySender.get(senderId);
  if (!map) return;
  const controller = map.get(requestId);
  if (!controller) return;
  controller.abort();
  map.delete(requestId);
}

/**
 * 在 webContents 销毁时清理对应 sender 的 AbortController（避免悬挂）。
 * 暴露给 `electron/main/index.ts` 在 `webContents.on('destroyed', ...)` 时调用。
 */
export function cleanupAiChatForSender(senderId: number): void {
  const map = aiChatControllersBySender.get(senderId);
  if (!map) return;
  for (const c of map.values()) {
    c.abort();
  }
  aiChatControllersBySender.delete(senderId);
}

/** `runAiChatStream` 依赖。 */
export interface RunAiChatStreamDeps {
  rawPayload: unknown;
  sender: WebContents;
}

/**
 * 校验入参 → 调 provider.chat 流 → 把每个 chunk 推给 sender。
 *
 * **安全**：
 *   - 错误 chunk 的 message **不**含 key（provider 已保证）
 *   - 错误码归类：
 *     - `DEPENDENCY_MISSING` → `DEPENDENCY_MISSING`
 *     - `INVALID_API_KEY` / `RATE_LIMITED` / `SERVER_ERROR` / `NETWORK_ERROR` / `PROTOCOL_ERROR` → `EXTERNAL_FAILURE`
 *     - `VALIDATION_FAILED` → `VALIDATION_FAILED`
 *     - 其他 → `INTERNAL`
 *
 * **取消**：检查 `controller.signal.aborted` —— 任意 yield 之前先检查。
 * 取消时**不**发 error chunk（语义是"用户主动停"，不是错误）。
 */
export async function runAiChatStream(input: RunAiChatStreamDeps): Promise<void> {
  const { rawPayload, sender } = input;
  const senderMap = getOrCreateSenderMap(sender.id);
  const chunkChannel = 'ai:chat:chunk';

  // 1. Zod 校验
  const parsed = ChatRequestSchema.safeParse(rawPayload);
  if (!parsed.success) {
    sendChunk(sender, chunkChannel, 'unknown', {
      type: 'error',
      error: { code: 'VALIDATION_FAILED', message: 'Invalid ai:chat input' },
    });
    return;
  }
  const req: ChatRequestParsed = parsed.data;
  const { requestId, provider, messages, systemHint, model } = req;

  // 2. 检查 provider 是否注册
  if (!getProviderMetadata(provider)) {
    sendChunk(sender, chunkChannel, requestId, {
      type: 'error',
      error: { code: 'NOT_FOUND', message: `Provider not found: ${provider}` },
    });
    return;
  }

  // 3. 把 systemHint 拼到 messages 最前面（如果给了）
  const finalMessages: ChatMessage[] = systemHint
    ? [{ role: 'system', content: systemHint }, ...messages]
    : messages;

  // 4. 拿 adapter
  const adapter = getProvider(provider);
  if (!adapter) {
    sendChunk(sender, chunkChannel, requestId, {
      type: 'error',
      error: { code: 'NOT_FOUND', message: `Provider adapter not registered: ${provider}` },
    });
    return;
  }

  // 5. 注册 AbortController
  const controller = new AbortController();
  senderMap.set(requestId, controller);

  // 6. 转发 chunk，转换错误码语义
  const iter = adapter.chat(
    model !== undefined ? { messages: finalMessages, model } : { messages: finalMessages },
  );
  const asyncIter = iter[Symbol.asyncIterator]();

  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (controller.signal.aborted) {
        // 用户取消 → 不发 error chunk（语义是"用户主动停"，不是错误）
        return;
      }
      let next: IteratorResult<ChatChunk>;
      try {
        next = await asyncIter.next();
      } catch (err) {
        // provider 自身抛错（非 error chunk）→ 转 error chunk
        const message = err instanceof Error ? err.message : 'chat error';
        sendChunk(sender, chunkChannel, requestId, {
          type: 'error',
          error: { code: 'EXTERNAL_FAILURE', message },
        });
        return;
      }
      if (next.done) {
        // 异步迭代器正常结束（无 done chunk）→ 主动产 done
        sendChunk(sender, chunkChannel, requestId, { type: 'done' });
        return;
      }
      const chunk = next.value;
      if (chunk.type === 'error') {
        // 错误码语义归类
        const mapped: ChatChunk = {
          type: 'error',
          error: { code: mapProviderErrorCode(chunk.error.code), message: chunk.error.message },
        };
        sendChunk(sender, chunkChannel, requestId, mapped);
        return;
      }
      if (chunk.type === 'done') {
        sendChunk(sender, chunkChannel, requestId, chunk);
        return;
      }
      // token chunk → 透传
      sendChunk(sender, chunkChannel, requestId, chunk);
    }
  } finally {
    senderMap.delete(requestId);
    // 善后：调 asyncIter.return() 让 provider 端清理 reader（如果实现了 return）
    if (typeof asyncIter.return === 'function') {
      try {
        await asyncIter.return();
      } catch {
        // ignore
      }
    }
  }
}

/**
 * 把 provider 的错误码（CHAT_ERROR_CODES）映射到 IPC 错误码（PROJECT_IDENTITY.md §4.4）。
 *
 *   - `DEPENDENCY_MISSING` → `DEPENDENCY_MISSING`
 *   - `INVALID_API_KEY` / `RATE_LIMITED` / `SERVER_ERROR` / `NETWORK_ERROR` / `PROTOCOL_ERROR`
 *     → `EXTERNAL_FAILURE`
 *   - `VALIDATION_FAILED` → `VALIDATION_FAILED`
 *   - 其他 → `INTERNAL`
 */
function mapProviderErrorCode(code: string): string {
  if (code === CHAT_ERROR_CODES.DEPENDENCY_MISSING) return 'DEPENDENCY_MISSING';
  if (code === CHAT_ERROR_CODES.VALIDATION_FAILED) return 'VALIDATION_FAILED';
  if (
    code === CHAT_ERROR_CODES.INVALID_API_KEY ||
    code === CHAT_ERROR_CODES.RATE_LIMITED ||
    code === CHAT_ERROR_CODES.SERVER_ERROR ||
    code === CHAT_ERROR_CODES.NETWORK_ERROR ||
    code === CHAT_ERROR_CODES.PROTOCOL_ERROR
  ) {
    return 'EXTERNAL_FAILURE';
  }
  return 'INTERNAL';
}

/** 推一个 chunk 给 sender；用 ChatChunkEnvelopeSchema 做一次出口校验（保险）。 */
function sendChunk(
  sender: WebContents,
  channel: string,
  requestId: string,
  chunk: ChatChunk,
): void {
  if (sender.isDestroyed()) return;
  const envelope = ChatChunkEnvelopeSchema.parse({ requestId, chunk });
  sender.send(channel, envelope);
}
