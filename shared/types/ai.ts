/**
 * AI 相关共享类型（T3-1 基础设施）
 *
 * **职责**：定义 Provider / 配置 / 消息 / chunk / action 的 TS 类型。
 *
 * **不写**：db 读写、IPC handler、UI 组件 —— 这些归 T3-1 业务层 / T3-2 适配器 / T3-3 UI。
 *
 * **命名**（PROJECT_IDENTITY.md §3.1）：类型 PascalCase、字段 camelCase、provider id
 * 走 kebab-case（`'openai-compatible'`）。
 *
 * **安全约束**（PROJECT_IDENTITY.md §6.1）：
 *   - API Key **永不**进入本文件的任何类型（`AiConfig` 故意不包含 `apiKey` 字段）
 *   - 凭据走主进程 `CredentialManager`（electron/main/credentials/credentialManager.ts）
 *   - 渲染进程只能拿到 `AiConfig`（model / baseURL），拿不到 key
 *
 * **T3-1 范围**：
 *   - 仅定义类型，**不**实现具体 provider 的 chat / extractJson
 *   - 具体适配器由 T3-2 提供（MiniMax + OpenAI-compatible）
 *   - UI 由 T3-3 提供
 *   - AI 错误兜底 / Zod 提取由 T3-4 提供
 *
 * @used-by shared/schemas/ai.ts / electron/main/providers/ProviderAdapter.ts /
 *          electron/main/ipc/ai.ts / electron/preload/index.ts (T3-3)
 */

/**
 * Provider 标识。
 *
 * 第一版仅支持两个 provider（与 T3-2 一致）：
 *   - `'minimax'`           → MiniMax 官方
 *   - `'openai-compatible'` → 任意 OpenAI 兼容接口
 *
 * **T3-1 阶段**：`ProviderId` 只是字符串字面量联合，**不**承载任何运行时信息。
 * 运行时元数据走 `ProviderMetadata`（来自 registry）。
 */
export type ProviderId = 'minimax' | 'openai-compatible';

/**
 * Provider 元数据（registry 暴露给 UI / 业务层用）。
 *
 * 字段说明：
 *   - `id`             字符串字面量，与 `ProviderId` 对齐
 *   - `displayName`    UI 展示名（中文 / 品牌名）
 *   - `defaultModel`   首次配置时的默认模型
 *   - `defaultBaseURL` 首次配置时的默认 baseURL
 *   - `docsUrl`        用户配置时跳转到该 provider 的 API key 申请页（可选）
 */
export interface ProviderMetadata {
  /** Provider id（与 `ProviderId` 字面量一致）。 */
  id: ProviderId;
  /** UI 展示名。 */
  displayName: string;
  /** 默认模型（首次配置时的占位）。 */
  defaultModel: string;
  /** 默认 baseURL（首次配置时的占位）。 */
  defaultBaseURL: string;
  /** 申请 API key 的官方页面 URL（可选；缺省时为 `string | undefined` 以兼容 Zod `.optional()`）。 */
  docsUrl?: string | undefined;
}

/**
 * AI 配置（不含 apiKey）。
 *
 * **关键安全约束**（PROJECT_IDENTITY.md §6.1）：
 *   - `AiConfig` 是 IPC 边界上**唯一**的 provider 配置类型
 *   - **故意**不包含 `apiKey` 字段 → 渲染进程拿不到 key
 *   - `provider` 用作 `aiConfigs` 表主键 + 决定 `model` / `baseURL` 默认值
 *
 * 持久化：
 *   - 走 `aiConfigs` 表（`db/schema/aiConfig.ts`）
 *   - apiKey 单独走 `CredentialManager`（Windows Credential Manager）
 */
export interface AiConfig {
  /** Provider id（主键）。 */
  provider: ProviderId;
  /** 模型名（业务层可改）。 */
  model: string;
  /** API baseURL（业务层可改）。 */
  baseURL: string;
  /** 最近一次更新时间（Unix 毫秒）。 */
  updatedAt: number;
}

/**
 * Chat 消息（OpenAI-compatible 协议对齐）。
 *
 * 字段对应 OpenAI Chat Completions API 的 `messages[]` 项：
 *   - `role`    `system` | `user` | `assistant`
 *   - `content` 消息文本
 *
 * **T3-1 阶段**：仅支持纯文本 content，不支持多模态 / function calls。
 * 多模态留到后续版本。
 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * Chat 流式响应 chunk。
 *
 * 三种类型：
 *   - `token`  增量文本片段（多次）
 *   - `done`   流结束（一次，可能带 usage / 终止原因等 metadata）
 *   - `error`  错误（一次，之后流关闭）
 *
 * **T3-1 阶段**：`done` 块的 `content` 字段不存在；`error` 块走 `error: { code, message }`。
 * T3-2 会扩展 `done` 块携带 `usage` / `finishReason` 等。
 */
export type ChatChunk =
  | { type: 'token'; content: string }
  | { type: 'done' }
  | { type: 'error'; error: { code: string; message: string } };

/**
 * AI 业务动作（业务层定义要做什么）。
 *
 * 与 `PLAN (1).md` 核心接口的 `AiAction` 保持一致：
 *   - `chat`             自由对话
 *   - `summarize`        文本总结
 *   - `extract_tasks`    提取任务草稿
 *   - `create_note`      生成笔记
 *   - `rewrite`          改写 / 翻译
 *   - `search_knowledge` 知识库检索
 *
 * **T3-1 阶段**：仅定义类型，**不**在 ProviderAdapter 上实现这些动作。
 * 具体动作由 T3-2 / T3-4 在主进程编排 Provider 调用 + Zod 提取。
 */
export type AiAction =
  | 'chat'
  | 'summarize'
  | 'extract_tasks'
  | 'create_note'
  | 'rewrite'
  | 'search_knowledge';

/**
 * 结构化提取 schema 名（T3-4 错误兜底 + Zod 提取 + T5-1 复盘草稿）。
 *
 * 每种 schema 对应 `shared/schemas/ai.ts` 的一个 Zod schema，IPC 层根据
 * 这个名字选 schema 来验证 AI 返回的 JSON。
 *
 * 当前范围：
 *   - `inbox_items`   → 收集箱条目提取（提取用户输入文本里可作为 inbox 条目的事项）
 *   - `task_drafts`   → 任务草稿提取（与 `extract_tasks` action 对齐）
 *   - `note_summary`  → 笔记摘要（留 T4-x AI 工作区接入，本卡**仅**提供底层能力）
 *   - `review_draft`  → 每日复盘草稿（T5-1：完成/未完成/阻塞/明日 3 件事）
 *
 * **T3-4 阶段**：只暴露类型 + schema 注册；T3-4 IPC 自身**不**落库（落库由调用方
 * 在确认后走 `inbox:add` / `task:create` 等业务 IPC）。
 */
export type JsonExtractionSchemaName =
  | 'inbox_items'
  | 'task_drafts'
  | 'note_summary'
  | 'review_draft';

/**
 * 结构化提取入参（T3-4 错误兜底 + Zod 提取）。
 *
 * 字段：
 *   - `provider`    provider id（IPC 通道以外的另一种传 provider 方式 —— 本字段优先）
 *   - `messages`    chat messages（system / user / assistant）；provider 内部会强制追加
 *                   一个 JSON 抽取专用 system hint，**不**复用 `messages[0].role==='system'`
 *   - `schemaName`  走 `SCHEMA_REGISTRY[schemaName]` 选 Zod schema
 *   - `systemHint`  可选 —— 业务层追加在 provider 强制 hint **之前**的引导
 *                   （例：'提取这个聊天记录中的任务'）
 *   - `model`       可选 —— 覆盖 provider default model
 *   - `temperature` 可选 —— 默认 0（更稳定的 JSON 输出）
 *   - `maxRetries`  可选 —— Zod 验证失败重试次数，默认 1（一次重试）
 *
 * **安全**：**不**含 `apiKey` / 用户敏感字段。
 *
 * **类型说明**（PROJECT_IDENTITY.md §3.2 + tsconfig `exactOptionalPropertyTypes`）：
 *   可选字段显式标注 `| undefined` —— Zod `.optional().parse()` 会把缺失字段
 *   显式设为 `undefined`，与"不设该字段"在严格类型上不同。
 */
export interface JsonExtractionInput {
  provider: ProviderId;
  messages: ChatMessage[];
  schemaName: JsonExtractionSchemaName;
  systemHint?: string | undefined;
  model?: string | undefined;
  temperature?: number | undefined;
  maxRetries?: number | undefined;
}

/**
 * 提取出的任务草稿（schema = `task_drafts`）。
 *
 * 与 PLAN (1).md 核心接口的 `TaskDraft` 保持兼容。本卡**只**做提取，**不**落库。
 *
 * **类型说明**（`exactOptionalPropertyTypes`）：可选字段显式标注 `| undefined`，
 * 与 zod `.optional()` 推断对齐。
 */
export interface ExtractedTask {
  title: string;
  description?: string | undefined;
  priority?: 'low' | 'medium' | 'high' | undefined;
}

/**
 * 提取出的任务草稿列表（schema = `task_drafts`）。
 */
export interface ExtractedTasks {
  tasks: ExtractedTask[];
}

/**
 * 收集箱条目（schema = `inbox_items`）。
 */
export interface ExtractedInboxItem {
  content: string;
  kind: 'note' | 'todo' | 'file' | 'link';
}

/**
 * 收集箱条目列表（schema = `inbox_items`）。
 */
export interface ExtractedInboxItems {
  items: ExtractedInboxItem[];
}

/**
 * 笔记摘要（schema = `note_summary`）。
 */
export interface NoteSummary {
  title: string;
  summary: string;
  tags: string[];
}

/**
 * 复盘草稿（schema = `review_draft`，T5-1）。
 *
 * **Re-export**：本类型在 `shared/types/review.ts` 里有更详细定义；这里
 * 再 export 一次方便 `aiStore` 在 generic 位置引用。
 */
export interface ReviewDraft {
  completed: string[];
  uncompleted: Array<{ title: string; reason?: string | undefined }>;
  blockers: string;
  topThree: string[];
}
