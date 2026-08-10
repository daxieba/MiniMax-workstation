/**
 * AI IPC 共享 Zod schemas（T3-1 基础设施）
 *
 * 与 `shared/types/ai.ts` 对应，提供 IPC 边界的运行时校验。
 *
 * **职责**：
 *   - 主进程入口校验入参（`safeParse`）
 *   - 预加载脚本解析响应数据（`safeParse`）
 *   - 渲染进程 store 收到响应后再次校验（保持端到端契约稳定）
 *
 * **不做**：
 *   - 业务规则（凭据缺失检测、模型可用性检查）—— 留给主进程 handler
 *   - db 读写 —— 留给主进程
 *   - 实际 chat 调用 —— 留给 T3-2
 *
 * @see shared/types/ai.ts
 */

import { z } from 'zod';

import type {
  AiAction,
  AiConfig,
  ChatChunk,
  ChatMessage,
  JsonExtractionInput,
  ProviderMetadata,
} from '../types/ai';

/**
 * `ProviderId` Zod schema —— IPC 边界的 provider 标识校验。
 *
 * 严格枚举 `'minimax' | 'openai-compatible'`。
 * 任何不在枚举内的字符串 → `VALIDATION_FAILED`。
 */
export const ProviderIdSchema = z.enum(['minimax', 'openai-compatible']);

/**
 * `ProviderMetadata` IPC 边界 schema。
 *
 * 与 `ProviderMetadata` 接口字段一致。
 * `docsUrl` 可选（部分 provider 不一定提供申请链接）。
 */
export const ProviderMetadataSchema = z.object({
  id: ProviderIdSchema,
  displayName: z.string().min(1).max(128),
  defaultModel: z.string().min(1).max(256),
  defaultBaseURL: z.string().min(1).max(2048),
  docsUrl: z.string().url().max(2048).optional(),
}) satisfies z.ZodType<ProviderMetadata>;

/**
 * `ProviderMetadata[]` schema（`ai:listProviders` 响应）。
 */
export const ProviderMetadataListSchema = z.array(ProviderMetadataSchema);

/**
 * `AiConfig` IPC 边界 schema。
 *
 * **关键安全约束**（PROJECT_IDENTITY.md §6.1）：**不**包含 `apiKey` 字段。
 * 任何传入 schema 的 `apiKey` / `key` 字段会被 `.strict()` 拒收。
 */
export const AiConfigSchema = z
  .object({
    provider: ProviderIdSchema,
    model: z.string().min(1).max(256),
    baseURL: z.string().min(1).max(2048),
    updatedAt: z.number().int().nonnegative(),
  })
  .strict() satisfies z.ZodType<AiConfig>;

/**
 * `ai:setConfig` 入参 schema。
 *
 * 入参**不**带 `updatedAt`（由主进程设置当前时间）。
 * 入参**不**带 `provider`（provider 是 IPC 通道的入参字段）。
 */
export const AiSetConfigInputSchema = z
  .object({
    provider: ProviderIdSchema,
    config: z
      .object({
        model: z.string().min(1).max(256),
        baseURL: z.string().min(1).max(2048),
      })
      .strict(),
  })
  .strict();

/**
 * `ai:setKey` 入参 schema。
 *
 * **安全约束**（PROJECT_IDENTITY.md §6.1）：
 *   - `key` 字段**不**出现在 `AiConfigSchema` / `AiSetConfigInputSchema`
 *   - 唯一携带 key 的 IPC 通道就是 `ai:setKey`，且只接受 `provider + key`
 *   - 响应**不**回显 key（仅 `{ ok: true }`）
 */
export const AiSetKeyInputSchema = z
  .object({
    provider: ProviderIdSchema,
    key: z.string().min(1).max(4096),
  })
  .strict();

/**
 * `ai:hasKey` / `ai:deleteKey` / `ai:getConfig` / `ai:testConnection` 入参 schema。
 *
 * 单一 `provider` 字段。
 */
export const AiProviderInputSchema = z
  .object({
    provider: ProviderIdSchema,
  })
  .strict();

/**
 * `ai:setKey` / `ai:deleteKey` 成功响应 schema。
 */
export const AiOkResponseSchema = z.object({
  ok: z.literal(true),
});

/**
 * `ai:hasKey` 成功响应 schema。
 */
export const AiHasKeyResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({ hasKey: z.boolean() }),
});

/**
 * `ai:listProviders` 成功响应 schema。
 */
export const AiListProvidersResponseSchema = z.object({
  ok: z.literal(true),
  data: ProviderMetadataListSchema,
});

/**
 * `ai:getConfig` 成功响应 schema。
 */
export const AiGetConfigResponseSchema = z.object({
  ok: z.literal(true),
  data: AiConfigSchema,
});

/**
 * `ai:setConfig` 成功响应 schema。
 */
export const AiSetConfigResponseSchema = z.object({
  ok: z.literal(true),
  data: AiConfigSchema,
});

/**
 * `ai:testConnection` 成功响应 schema。
 *
 * `{ ok, error? }` 形式 —— `ok: true` 表示连接成功；
 * `ok: false` 表示凭据缺失 / 网络失败 / provider 未实现，**不带** key 内容。
 */
export const AiTestConnectionInputSchema = AiProviderInputSchema;
export const AiTestConnectionDataSchema = z.object({
  ok: z.boolean(),
  error: z.string().optional(),
});
export const AiTestConnectionResponseSchema = z.object({
  ok: z.literal(true),
  data: AiTestConnectionDataSchema,
});

/**
 * `ChatMessage` schema（仅作主进程内部 ProviderAdapter 调用入参 / T3-2+ 的
 * 流式 handler 入参校验）。**T3-1 阶段不在 IPC 暴露 chat 通道**。
 */
export const ChatMessageSchema = z
  .object({
    role: z.enum(['system', 'user', 'assistant']),
    content: z.string().min(0).max(1_000_000),
  })
  .strict() satisfies z.ZodType<ChatMessage>;

/**
 * `ChatChunk` schema —— T3-2 之后的流式 handler 用。T3-1 阶段仅在 ProviderAdapter
 * 返回类型里出现。
 */
export const ChatChunkSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('token'), content: z.string() }).strict(),
  z.object({ type: z.literal('done') }).strict(),
  z
    .object({
      type: z.literal('error'),
      error: z.object({ code: z.string(), message: z.string() }),
    })
    .strict(),
]) satisfies z.ZodType<ChatChunk, z.ZodTypeDef, unknown>;

/**
 * `ai:chat` 请求 schema（T3-3 IPC 边界）。
 *
 * 字段：
 *   - `requestId`  本次 chat 的唯一 id（用于把 `ai:chat:chunk` 推回正确的调用方 + 取消）
 *   - `provider`   provider id
 *   - `messages`   chat messages（system / user / assistant），至少一条
 *   - `systemHint` 可选 —— 业务层拼一个 system prompt（不含 key / 用户敏感信息）
 *   - `model`      可选 —— 覆盖 provider 默认 model
 *
 * **安全**：schema 内**不**含 `apiKey` 字段，渲染进程拿不到 key。
 */
export const ChatRequestSchema = z
  .object({
    requestId: z.string().min(1).max(128),
    provider: ProviderIdSchema,
    messages: z.array(ChatMessageSchema).min(1).max(1024),
    systemHint: z.string().min(0).max(32_000).optional(),
    model: z.string().min(1).max(256).optional(),
  })
  .strict();

/**
 * `ai:chat:chunk` 推送事件 payload schema（T3-3 IPC 边界）。
 *
 * 字段：
 *   - `requestId` 与 `ChatRequestSchema.requestId` 对齐 —— 渲染端用其路由到正确的回调
 *   - `chunk`     `ChatChunk`（token / done / error）
 *
 * **错误信息**：`error.message` **不**含 key（由主进程 / provider 保证）。
 */
export const ChatChunkEnvelopeSchema = z
  .object({
    requestId: z.string().min(1).max(128),
    chunk: ChatChunkSchema,
  })
  .strict();

/**
 * `ai:chat:cancel` 请求 schema（T3-3 IPC 边界）。
 *
 * 字段：
 *   - `requestId` 与发起 chat 时用的一致
 */
export const ChatCancelRequestSchema = z
  .object({
    requestId: z.string().min(1).max(128),
  })
  .strict();

/**
 * `AiAction` schema（仅业务层内部用，T3-1 不暴露 IPC）。
 */
export const AiActionSchema = z.enum([
  'chat',
  'summarize',
  'extract_tasks',
  'create_note',
  'rewrite',
  'search_knowledge',
]) satisfies z.ZodType<AiAction>;

// ============================================================
//  T3-4 结构化提取（Zod 校验 + 错误兜底）
// ============================================================

/**
 * 结构化提取 schema 名 Zod schema（T3-4 + T5-1）。
 *
 * 当前范围：
 *   - `inbox_items`    → 收集箱条目提取（T3-4）
 *   - `task_drafts`    → 任务草稿提取（T3-4）
 *   - `note_summary`   → 笔记摘要（T3-4，留 T4-x 接入）
 *   - `review_draft`   → 每日复盘草稿（T5-1）
 */
export const JsonExtractionSchemaNameSchema = z.enum([
  'inbox_items',
  'task_drafts',
  'note_summary',
  'review_draft',
]);

/**
 * 任务草稿 Zod schema（schema = `task_drafts`）。
 *
 * 字段：
 *   - `title`        必填，1..256 字符
 *   - `description`  可选，0..4096 字符
 *   - `priority`     可选，枚举
 */
export const ExtractedTaskSchema = z
  .object({
    title: z.string().min(1).max(256),
    description: z.string().max(4096).optional(),
    priority: z.enum(['low', 'medium', 'high']).optional(),
  })
  .strict();

/**
 * `ExtractedTasks` Zod schema（顶层 `{ tasks: ExtractedTask[] }`）。
 */
export const ExtractedTasksSchema = z.object({
  tasks: z.array(ExtractedTaskSchema).max(256),
});

/**
 * 收集箱条目 Zod schema（schema = `inbox_items`）。
 */
export const ExtractedInboxItemSchema = z
  .object({
    content: z.string().min(1).max(65536),
    kind: z.enum(['note', 'todo', 'file', 'link']),
  })
  .strict();

/**
 * `ExtractedInboxItems` Zod schema（顶层 `{ items: ExtractedInboxItem[] }`）。
 */
export const ExtractedInboxItemsSchema = z.object({
  items: z.array(ExtractedInboxItemSchema).max(256),
});

/**
 * `NoteSummary` Zod schema（schema = `note_summary`）。
 */
export const NoteSummarySchema = z.object({
  title: z.string().min(1).max(256),
  summary: z.string().min(1).max(8192),
  tags: z.array(z.string().min(1).max(64)).max(64),
});

/**
 * `ReviewDraft` Zod schema（schema = `review_draft`，T5-1）。
 *
 * 字段：
 *   - `completed`   完成项标题列表（纯字符串，AI 不知道 taskId）
 *   - `uncompleted` 未完成项 + 可选原因
 *   - `blockers`    阻塞（自由文本，0..4096 字符）
 *   - `topThree`    明日三件事（纯字符串，最多 100 条防御性边界）
 *
 * **边界**（spec 强制）：
 *   - `completed` / `topThree` 数组 max 100 长度
 *   - 字符串 max 4096
 *   - `uncompleted.reason` max 1024
 *   - `.strict()` 拒绝任何额外字段
 */
export const ReviewDraftSchema = z
  .object({
    completed: z.array(z.string().min(1).max(4096)).max(100),
    uncompleted: z
      .array(
        z
          .object({
            title: z.string().min(1).max(4096),
            reason: z.string().max(1024).optional(),
          })
          .strict(),
      )
      .max(100),
    blockers: z.string().max(4096),
    topThree: z.array(z.string().min(1).max(4096)).max(100),
  })
  .strict();

/**
 * 结构化提取 schema 名字 → Zod schema 实例的注册表（T3-4 + T5-1）。
 *
 * 主进程 `handleAiExtractJson` 据 `schemaName` 查本表拿 schema；
 * 渲染端 store 也可同步引用本表做类型约束。
 *
 * **不**对外暴露 `unknown` / 任意 schema 注册（防止渲染进程注入自定义 schema 绕过 IPC
 * 边界 → 主进程 Zod 校验）。表里 4 个 schema 是固定的。
 */
export const SCHEMA_REGISTRY: Record<JsonExtractionInput['schemaName'], z.ZodTypeAny> = {
  inbox_items: ExtractedInboxItemsSchema,
  task_drafts: ExtractedTasksSchema,
  note_summary: NoteSummarySchema,
  review_draft: ReviewDraftSchema,
};

/**
 * `ai:extractJson` 请求 schema（T3-4 IPC 边界）。
 *
 * 字段：
 *   - `provider`    provider id
 *   - `messages`    chat messages（至少一条；provider 内部会强加 JSON 抽取 system hint）
 *   - `schemaName`  走 SCHEMA_REGISTRY 选 Zod schema
 *   - `systemHint`  可选 —— 业务层追加的引导
 *   - `model`       可选 —— 覆盖 default
 *   - `temperature` 可选 —— 默认 0
 *   - `maxRetries`  可选 —— 默认 1
 *
 * **安全**：**不**含 `apiKey` 字段。
 */
export const ExtractJsonRequestSchema = z.object({
  provider: ProviderIdSchema,
  messages: z.array(ChatMessageSchema).min(1).max(1024),
  schemaName: JsonExtractionSchemaNameSchema,
  systemHint: z.string().min(0).max(32_000).optional(),
  model: z.string().min(1).max(256).optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxRetries: z.number().int().min(0).max(5).optional(),
});

/**
 * `ai:extractJson` 成功响应 schema（T3-4 IPC 边界）。
 *
 * **设计取舍**：
 *   - 响应 data 字段类型为 `unknown` —— 实际是 schema 校验后的对象，但具体形状由
 *     `schemaName` 决定。渲染端用 `ExtractedTasksSchema` / `ExtractedInboxItemsSchema` /
 *     `NoteSummarySchema` 在 store 端**再次**做精确校验。
 *   - 响应**不**带 `aiRawOutput` 字段（避免 AI 原始输出经 IPC 回到渲染端 / 日志）。
 */
/**
 * `ai:extractJson` 成功响应 data schema（T3-4 IPC 边界）。
 *
 * 内部类型别名 `ExtractJsonResponseData`（必填 data 字段）—— 渲染端 store 据此
 * 强约束 `data` 必存在。
 *
 * **设计取舍**：
 *   - 响应 data 字段类型为 `unknown` —— 实际是 schema 校验后的对象，但具体形状由
 *     `schemaName` 决定。渲染端用 `ExtractedTasksSchema` / `ExtractedInboxItemsSchema` /
 *     `NoteSummarySchema` 在 store 端**再次**做精确校验。
 *   - 响应**不**带 `aiRawOutput` 字段（避免 AI 原始输出经 IPC 回到渲染端 / 日志）。
 */
export interface ExtractJsonResponseData {
  data: unknown;
  attempts: number;
}

/**
 * `ai:extractJson` 成功响应 data schema（zod 形式）。
 *
 * 运行时校验用 `z.custom<ExtractJsonResponseData>()` —— 显式声明 schema 输出类型，
 * 避免 zod 3.x `z.unknown()` 在 object 内被推断为 optional
 * （[zod#635](https://github.com/colinhacks/zod/issues/635)）。
 *
 * 校验内容：
 *   - `data` 字段非 undefined（值可以是任意 unknown —— store 端用对应 Zod schema 再校验）
 *   - `attempts` 字段是 1..6 的整数
 */
export const ExtractJsonResponseDataSchema: z.ZodType<ExtractJsonResponseData, z.ZodTypeDef, unknown> =
  z.custom<ExtractJsonResponseData>((v): v is ExtractJsonResponseData => {
    if (v === null || typeof v !== 'object') return false;
    const obj = v as Record<string, unknown>;
    // data 字段必须存在（即使是 undefined 也算；但实际上我们要求非 undefined）
    if (!('data' in obj)) return false;
    if (typeof obj['data'] === 'undefined') return false;
    if (typeof obj['attempts'] !== 'number') return false;
    if (!Number.isInteger(obj['attempts'])) return false;
    if ((obj['attempts'] as number) < 1 || (obj['attempts'] as number) > 6) return false;
    return true;
  });

export const ExtractJsonResponseSchema = z.object({
  ok: z.literal(true),
  data: ExtractJsonResponseDataSchema,
});

/** 类型导出（z.infer 形式）。 */
export type ProviderIdParsed = z.infer<typeof ProviderIdSchema>;
export type ProviderMetadataParsed = z.infer<typeof ProviderMetadataSchema>;
export type AiConfigParsed = z.infer<typeof AiConfigSchema>;
export type AiSetConfigInputParsed = z.infer<typeof AiSetConfigInputSchema>;
export type AiSetKeyInputParsed = z.infer<typeof AiSetKeyInputSchema>;
export type AiProviderInputParsed = z.infer<typeof AiProviderInputSchema>;
export type ChatMessageParsed = z.infer<typeof ChatMessageSchema>;
export type ChatChunkParsed = z.infer<typeof ChatChunkSchema>;
export type AiActionParsed = z.infer<typeof AiActionSchema>;
export type ChatRequestParsed = z.infer<typeof ChatRequestSchema>;
export type ChatChunkEnvelopeParsed = z.infer<typeof ChatChunkEnvelopeSchema>;
export type ChatCancelRequestParsed = z.infer<typeof ChatCancelRequestSchema>;
export type JsonExtractionSchemaNameParsed = z.infer<typeof JsonExtractionSchemaNameSchema>;
export type ExtractedTaskParsed = z.infer<typeof ExtractedTaskSchema>;
export type ExtractedTasksParsed = z.infer<typeof ExtractedTasksSchema>;
export type ExtractedInboxItemParsed = z.infer<typeof ExtractedInboxItemSchema>;
export type ExtractedInboxItemsParsed = z.infer<typeof ExtractedInboxItemsSchema>;
export type NoteSummaryParsed = z.infer<typeof NoteSummarySchema>;
export type ReviewDraftParsed = z.infer<typeof ReviewDraftSchema>;
export type ExtractJsonRequestParsed = z.infer<typeof ExtractJsonRequestSchema>;
export type ExtractJsonResponseDataParsed = z.infer<typeof ExtractJsonResponseDataSchema>;
export type ExtractJsonResponseParsed = z.infer<typeof ExtractJsonResponseSchema>;
