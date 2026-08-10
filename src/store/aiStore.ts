/**
 * AI 工作区 Zustand store（T3-3 渲染端 + T3-4 结构化提取）
 *
 * **职责**：
 *   - 管理 AI 工作区状态：当前 provider / model / 聊天消息 / 待确认结果 / 加载中
 *   - 暴露 loadProviders / refreshHasKey / setProvider / setModel / sendMessage /
 *     runAction / runStructuredAction / confirmPending / dismissPending
 *   - 调 `window.api.ai.*`（listProviders / hasKey / setKey / deleteKey / getConfig /
 *     setConfig / testConnection / **chat** / **extractJson**）
 *   - 成功 / 失败都用 `toast` 提示
 *   - **不**写 db（落库走 T2-3 的 task:create / inbox:convertToTask，**不**在 T3-3 加 db IPC）
 *
 * **数据流**：
 *   UI → store action → window.api.ai → 主进程 handler → 回到 store
 *
 * **流式 chat**：
 *   - `sendMessage` / `runAction` 通过 `window.api.ai.chat` 订阅 chunk 推流
 *   - 每个 token 累加到对应 assistant 消息的 `content` 字段
 *   - `done` chunk → 标记该消息完成（loading=false）
 *   - `error` chunk → 标记该消息失败，toast 错误
 *   - 单次 action（summarize / extractTasks / rewrite）完成后**额外**把结果加进
 *     `pendingResults` 列表（"待确认区"），用户手动 confirm 后才落库（confirm 流程在 UI 层）
 *
 * **T3-4 结构化提取**：
 *   - `runStructuredAction({ schemaName, input })` 走 `window.api.ai.extractJson`
 *   - 成功 → 把解析结果（items / tasks / summary）写进 `pendingResults` 对应 `structured`
 *     字段，**不**落 db
 *   - 失败 → toast 错误
 *   - `PendingResult` 增加 `schemaName` 字段，区分走 chat 的（'extract_tasks' action）
 *     和走 extractJson 的（schemaName='task_drafts'/'inbox_items'/'note_summary'）
 *
 * **不做**：
 *   - 不直接 import `db` / `better-sqlite3` / `drizzle`（PROJECT_IDENTITY.md §2.2）
 *   - 不做 note / kb / review / search store（留给对应卡）
 *   - 不引入新依赖
 *
 * **类型来源**：
 *   - `ChatMessage` / `ProviderId` / `JsonExtractionSchemaName` 来自 `@shared/types/ai`
 *   - IPC 响应通过 `@shared/schemas/ai` 的 Zod 校验（preload 已做）
 */

import { create } from 'zustand';

import {
  ExtractedInboxItemsSchema,
  ExtractedTasksSchema,
  NoteSummarySchema,
  ReviewDraftSchema,
} from '@shared/schemas/ai';
import type {
  ChatMessage,
  ExtractedInboxItems,
  ExtractedTasks,
  JsonExtractionSchemaName,
  NoteSummary,
  ProviderId,
  ReviewDraft,
} from '@shared/types/ai';

import { toast } from './toastStore';

/** `window.api.ai` 形状（避免 renderer 直接依赖 electron 导入）。 */
interface ApiAiShape {
  listProviders(): Promise<
    | { ok: true; data: Array<{ id: ProviderId; displayName: string; defaultModel: string; defaultBaseURL: string; docsUrl?: string }> }
    | { ok: false; error: { code: string; message: string } }
  >;
  hasKey(input: { provider: ProviderId }): Promise<
    | { ok: true; data: { hasKey: boolean } }
    | { ok: false; error: { code: string; message: string } }
  >;
  setKey(input: { provider: ProviderId; key: string }): Promise<
    | { ok: true; data: { ok: true } }
    | { ok: false; error: { code: string; message: string } }
  >;
  deleteKey(input: { provider: ProviderId }): Promise<
    | { ok: true; data: { ok: true } }
    | { ok: false; error: { code: string; message: string } }
  >;
  getConfig(input: { provider: ProviderId }): Promise<
    | { ok: true; data: { provider: ProviderId; model: string; baseURL: string; updatedAt: number } }
    | { ok: false; error: { code: string; message: string } }
  >;
  setConfig(input: { provider: ProviderId; config: { model: string; baseURL: string } }): Promise<
    | { ok: true; data: { provider: ProviderId; model: string; baseURL: string; updatedAt: number } }
    | { ok: false; error: { code: string; message: string } }
  >;
  testConnection(input: { provider: ProviderId }): Promise<
    | { ok: true; data: { ok: boolean; error?: string } }
    | { ok: false; error: { code: string; message: string } }
  >;
  chat(
    input: {
      provider: ProviderId;
      messages: ChatMessage[];
      systemHint?: string;
      model?: string;
      requestId?: string;
    },
    callbacks: {
      onChunk: (chunk: { type: 'token'; content: string }) => void;
      onDone: () => void;
      onError: (err: { code: string; message: string }) => void;
    },
  ): () => void;
  extractJson(input: {
    provider: ProviderId;
    schemaName: JsonExtractionSchemaName;
    messages: ChatMessage[];
    systemHint?: string;
    model?: string;
    temperature?: number;
    maxRetries?: number;
  }): Promise<
    | { ok: true; data: { data: unknown; attempts: number } }
    | { ok: false; error: { code: string; message: string } }
  >;
}

interface WindowWithApi {
  api?: {
    ai?: ApiAiShape;
  };
}

/** 安全取 window.api.ai。 */
function getAiApi(): ApiAiShape | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as WindowWithApi;
  return w.api?.ai ?? null;
}

/** 把 IPC `{ok, error}` 形态的失败转成抛错 + toast 提示。 */
function unwrapOrToast<T>(
  result:
    | { ok: true; data: T }
    | { ok: false; error: { code: string; message: string } },
  errorPrefix: string,
): T {
  if (result.ok) return result.data;
  toast.error(`${errorPrefix}（${result.error.code}）：${result.error.message}`);
  throw new Error(`${errorPrefix}: ${result.error.code} ${result.error.message}`);
}

// ============================================================
//  AI 单次 action（业务层 4 个：chat / summarize / extract_tasks / rewrite）
// ============================================================

/**
 * AI 业务动作（T3-3 范围只包含 4 个）。
 *
 * - `chat`            自由对话（不进 pendingResults）
 * - `summarize`       文本总结（结果进 pendingResults）
 * - `extract_tasks`   提取任务草稿（结果进 pendingResults，T3-3 仅展示文本，T3-4+ 接 task:create）
 * - `rewrite`         改写 / 翻译（结果进 pendingResults）
 *
 * **不在 T3-3 范围**：`create_note` / `search_knowledge` —— 留 T4-x。
 */
export type QuickAction = 'summarize' | 'extract_tasks' | 'rewrite';

/** 待确认区单条。 */
export interface PendingResult {
  /** 内部 id（用 ulid 字符串，本卡不引 ulidx 库以免新增依赖；用 `Date.now + counter` 也可）。 */
  id: string;
  /** 触发它的 quick action。 */
  action: QuickAction;
  /** AI 返回的完整文本。 */
  content: string;
  /** 创建时间（Unix ms）。 */
  createdAt: number;
  /** 状态：'pending' 待用户确认 / 'confirmed' 已落库 / 'dismissed' 用户丢弃。 */
  status: 'pending' | 'confirmed' | 'dismissed';
  /** 是否正在流式接收（用于 UI 显示加载占位）。 */
  streaming: boolean;
  /** 原始用户输入（仅展示用，**不**落 db）。 */
  sourceInput?: string;
  /**
   * T3-4：结构化提取 schema 名。
   *
   * - `undefined` → 走 chat 流式（`runAction` 的结果）
   * - `task_drafts` / `inbox_items` / `note_summary` → 走 `runStructuredAction` 的结果，
   *   `structured` 字段必有
   */
  schemaName?: JsonExtractionSchemaName | undefined;
  /**
   * T3-4：结构化提取结果。
   *
   * 仅当 `schemaName` 有值时**必填**。具体类型由 `schemaName` 决定（discriminated union）。
   */
  structured?: ExtractedTasks | ExtractedInboxItems | NoteSummary | ReviewDraft | undefined;
  /**
   * T3-4：provider 重试次数（仅 structured action 有效）。
   * UI 可选展示。
   */
  attempts?: number | undefined;
}

/** 聊天消息（包含流式累积状态）。 */
export interface ChatMessageWithMeta extends ChatMessage {
  /** 内部 id（用于 React key）。 */
  id: string;
  /** 是否正在流式累积（最后一条 assistant）。 */
  streaming?: boolean;
  /** 创建时间。 */
  createdAt: number;
}

/** store 形状。 */
export interface AiState {
  /** 已注册 provider 列表（id + displayName + defaultModel + defaultBaseURL + docsUrl）。 */
  providers: Array<{
    id: ProviderId;
    displayName: string;
    defaultModel: string;
    defaultBaseURL: string;
    docsUrl?: string;
  }>;
  /** 当前选中的 provider。 */
  provider: ProviderId;
  /** 当前 model（可能等于 provider 的 defaultModel）。 */
  model: string;
  /** 当前 provider 是否已配 key（实时刷新）。 */
  hasKey: boolean;
  /** 聊天消息（自由对话，**不**进 pendingResults）。 */
  messages: ChatMessageWithMeta[];
  /** 待确认区结果（单次 action 的结果）。 */
  pendingResults: PendingResult[];
  /** 加载中（listProviders / 任何 chat / action 期间）。 */
  loading: boolean;
  /** 最近一次错误信息（UI 可选显示；toast 已经显示过）。 */
  error: string | null;
  /** 当前正在进行的 chat 取消函数（用于切换 / 重新发起时取消上一次）。 */
  cancelCurrent: (() => void) | null;

  // ---- actions ----
  /** 拉取 provider 列表（启动时一次）。 */
  loadProviders: () => Promise<void>;
  /** 刷新 hasKey（切换 provider / setKey / deleteKey 后调）。 */
  refreshHasKey: () => Promise<void>;
  /** 设置 provider（同时切 model 为新 provider 的 defaultModel + 刷 hasKey）。 */
  setProvider: (provider: ProviderId) => void;
  /** 设置 model。 */
  setModel: (model: string) => void;
  /** 设置 key（用完即丢）。 */
  setKey: (key: string) => Promise<void>;
  /** 删除 key。 */
  deleteKey: () => Promise<void>;
  /** 拉 config。 */
  loadConfig: () => Promise<void>;
  /** 写 config。 */
  saveConfig: (model: string) => Promise<void>;
  /** 测试连接。 */
  testConnection: () => Promise<boolean>;
  /** 自由对话：发送一条 user 消息 + 流式累积 assistant 响应。 */
  sendMessage: (content: string) => Promise<void>;
  /** 单次 action：summarize / rewrite。结果进 pendingResults。 */
  runAction: (action: QuickAction, input: string) => Promise<void>;
  /**
   * T3-4：结构化提取 action。
   *
   * 调 `window.api.ai.extractJson`（主进程：chat + 剥 fence + Zod 验证 + 重试），
   * 把结果写进 `pendingResults`（带 `schemaName` + `structured` 字段）。
   *
   * `action` 决定 `pendingResults[i].action` 字段（用于 `AIPendingConfirm` 标签）；
   * `schemaName` 决定提取 schema。
   *
   * 本 store**不**落 db；落库由 UI 在用户确认后调 `task:create` / `inbox:add` 等。
   */
  runStructuredAction: (
    action: QuickAction,
    schemaName: JsonExtractionSchemaName,
    input: string,
  ) => Promise<void>;
  /** 取消当前 chat。 */
  cancelChat: () => void;
  /** 清空聊天消息。 */
  clearMessages: () => void;
  /** 确认一条 pending（UI 自行完成落库；本 store 仅改 status）。 */
  confirmPending: (id: string) => void;
  /** 丢弃一条 pending。 */
  dismissPending: (id: string) => void;
  /** 清空所有 pending。 */
  clearPending: () => void;
}

// 自增 id 计数器（测试中可被 stub）。
let messageCounter = 0;
let pendingCounter = 0;

/** 生成 chat message id。 */
function nextMessageId(): string {
  messageCounter += 1;
  return `m_${Date.now().toString(36)}_${messageCounter}`;
}

/** 生成 pending result id。 */
function nextPendingId(): string {
  pendingCounter += 1;
  return `p_${Date.now().toString(36)}_${pendingCounter}`;
}

/** 单次 action 的 system hint（不含 key / 不含用户敏感信息）。 */
function buildActionSystemHint(action: QuickAction): string {
  switch (action) {
    case 'summarize':
      return '你是一个简洁的总结助手。请用中文把用户提供的文本总结为不超过 200 字的要点。';
    case 'extract_tasks':
      return '你是一个任务提取助手。请从用户提供的文本中提取可执行的任务，输出为 Markdown 项目符号列表，每行一个任务，格式：`- [标题]（可选简短说明）`。';
    case 'rewrite':
      return '你是一个改写助手。请用更清晰流畅的中文重写用户提供的文本，保持原意不变。';
  }
}

/** T3-4 + T5-1：结构化提取的 system hint。 */
function buildStructuredSystemHint(schemaName: JsonExtractionSchemaName): string {
  switch (schemaName) {
    case 'task_drafts':
      return '从用户提供的内容中提取可执行的任务，输出为 JSON 格式。';
    case 'inbox_items':
      return '从用户提供的内容中提取可作为 inbox 条目的事项（想法 / 待办 / 文件 / 链接），输出为 JSON 格式。';
    case 'note_summary':
      return '总结用户提供的内容为标题 + 摘要 + 标签，输出为 JSON 格式。';
    case 'review_draft':
      return '基于用户提供的"完成/未完成任务"和"收集箱条目"，生成结构化的每日复盘草稿（completed/uncompleted/blockers/topThree），输出为 JSON 格式。';
  }
}

/**
 * T3-4：渲染端用对应 Zod schema 再校验一次 IPC 返回的 data。
 *
 * IPC 主进程已用 Zod 校验过，但渲染端**额外**做一次防御性校验（防止 IPC 边界 bug）。
 */
function validateExtractedResult(
  schemaName: JsonExtractionSchemaName,
  raw: unknown,
):
  | { ok: true; data: ExtractedTasks | ExtractedInboxItems | NoteSummary | ReviewDraft }
  | { ok: false; error: string } {
  switch (schemaName) {
    case 'task_drafts': {
      const r = ExtractedTasksSchema.safeParse(raw);
      if (r.success) return { ok: true, data: r.data };
      return { ok: false, error: r.error.issues.map((i) => i.message).join('; ') };
    }
    case 'inbox_items': {
      const r = ExtractedInboxItemsSchema.safeParse(raw);
      if (r.success) return { ok: true, data: r.data };
      return { ok: false, error: r.error.issues.map((i) => i.message).join('; ') };
    }
    case 'note_summary': {
      const r = NoteSummarySchema.safeParse(raw);
      if (r.success) return { ok: true, data: r.data };
      return { ok: false, error: r.error.issues.map((i) => i.message).join('; ') };
    }
    case 'review_draft': {
      const r = ReviewDraftSchema.safeParse(raw);
      if (r.success) return { ok: true, data: r.data };
      return { ok: false, error: r.error.issues.map((i) => i.message).join('; ') };
    }
  }
}

export const useAiStore = create<AiState>((set, get) => ({
  providers: [],
  provider: 'minimax',
  model: 'MiniMax-M2',
  hasKey: false,
  messages: [],
  pendingResults: [],
  loading: false,
  error: null,
  cancelCurrent: null,

  async loadProviders(): Promise<void> {
    const api = getAiApi();
    if (!api) return;
    set({ loading: true, error: null });
    try {
      const result = await api.listProviders();
      const list = unwrapOrToast(result, '加载 provider 列表失败');
      set({ providers: list, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  async refreshHasKey(): Promise<void> {
    const api = getAiApi();
    if (!api) return;
    const { provider } = get();
    try {
      const result = await api.hasKey({ provider });
      if (result.ok) {
        set({ hasKey: result.data.hasKey });
      }
    } catch {
      // 静默：UI 用旧值
    }
  },

  setProvider(provider: ProviderId): void {
    const prev = get();
    // 切 provider 时先取消正在进行的 chat
    if (prev.cancelCurrent) {
      try {
        prev.cancelCurrent();
      } catch {
        // ignore
      }
    }
    // 找新 provider 的 defaultModel
    const meta = prev.providers.find((p) => p.id === provider);
    const newModel = meta?.defaultModel ?? prev.model;
    set({
      provider,
      model: newModel,
      cancelCurrent: null,
      loading: false,
    });
    void get().refreshHasKey();
  },

  setModel(model: string): void {
    set({ model });
  },

  async setKey(key: string): Promise<void> {
    const api = getAiApi();
    if (!api) return;
    const { provider } = get();
    try {
      const result = await api.setKey({ provider, key });
      unwrapOrToast(result, '设置 API Key 失败');
      set({ hasKey: true });
      toast.success('API Key 已保存');
    } catch {
      // already toasted
    }
  },

  async deleteKey(): Promise<void> {
    const api = getAiApi();
    if (!api) return;
    const { provider } = get();
    try {
      const result = await api.deleteKey({ provider });
      unwrapOrToast(result, '删除 API Key 失败');
      set({ hasKey: false });
      toast.success('API Key 已删除');
    } catch {
      // already toasted
    }
  },

  async loadConfig(): Promise<void> {
    const api = getAiApi();
    if (!api) return;
    const { provider } = get();
    try {
      const result = await api.getConfig({ provider });
      if (result.ok) {
        set({ model: result.data.model });
      }
    } catch {
      // ignore
    }
  },

  async saveConfig(model: string): Promise<void> {
    const api = getAiApi();
    if (!api) return;
    const { provider } = get();
    // 取现有 baseURL（如果存在）作为 baseURL；用 provider 的 defaultBaseURL 作 fallback
    let baseURL = '';
    try {
      const r = await api.getConfig({ provider });
      if (r.ok) baseURL = r.data.baseURL;
    } catch {
      // ignore
    }
    if (!baseURL) {
      const meta = get().providers.find((p) => p.id === provider);
      baseURL = meta?.defaultBaseURL ?? '';
    }
    try {
      const result = await api.setConfig({ provider, config: { model, baseURL } });
      unwrapOrToast(result, '保存配置失败');
      toast.success('模型已保存');
    } catch {
      // already toasted
    }
  },

  async testConnection(): Promise<boolean> {
    const api = getAiApi();
    if (!api) return false;
    const { provider } = get();
    try {
      const result = await api.testConnection({ provider });
      if (!result.ok) {
        toast.error(`测试连接失败（${result.error.code}）：${result.error.message}`);
        return false;
      }
      if (result.data.ok) {
        toast.success('连接成功');
        return true;
      }
      toast.error(`连接失败：${result.data.error ?? '未知错误'}`);
      return false;
    } catch {
      return false;
    }
  },

  cancelChat(): void {
    const c = get().cancelCurrent;
    if (c) {
      try {
        c();
      } catch {
        // ignore
      }
      set({ cancelCurrent: null, loading: false });
    }
  },

  clearMessages(): void {
    get().cancelChat();
    set({ messages: [] });
  },

  async sendMessage(content: string): Promise<void> {
    const api = getAiApi();
    if (!api) return;
    const trimmed = content.trim();
    if (trimmed.length === 0) return;
    if (!get().hasKey) {
      toast.error('未配置 API Key');
      return;
    }
    // 取消上次进行中的 chat
    const prev = get().cancelCurrent;
    if (prev) {
      try {
        prev();
      } catch {
        // ignore
      }
    }

    // 1. 加 user 消息 + 占位 assistant 消息
    const userMsg: ChatMessageWithMeta = {
      id: nextMessageId(),
      role: 'user',
      content: trimmed,
      createdAt: Date.now(),
    };
    const assistantId = nextMessageId();
    const assistantMsg: ChatMessageWithMeta = {
      id: assistantId,
      role: 'assistant',
      content: '',
      streaming: true,
      createdAt: Date.now(),
    };
    set({
      messages: [...get().messages, userMsg, assistantMsg],
      loading: true,
      error: null,
      cancelCurrent: null,
    });

    // 2. 准备 messages 入参（只用已存在的，assistant 占位不传）
    const { messages, provider, model } = get();
    const inputMessages: ChatMessage[] = messages
      .filter((m) => m.id !== assistantId)
      .map((m) => ({ role: m.role, content: m.content }));

    // 3. 调 chat
    let accumulated = '';
    const cancel = api.chat(
      { provider, messages: inputMessages, model },
      {
        onChunk: (chunk) => {
          if (chunk.type === 'token') {
            accumulated += chunk.content;
            set({
              messages: get().messages.map((m) =>
                m.id === assistantId ? { ...m, content: accumulated } : m,
              ),
            });
          }
        },
        onDone: () => {
          set({
            messages: get().messages.map((m) =>
              m.id === assistantId ? { ...m, streaming: false } : m,
            ),
            loading: false,
            cancelCurrent: null,
          });
        },
        onError: (err) => {
          toast.error(`对话失败（${err.code}）：${err.message}`);
          set({
            messages: get().messages.map((m) =>
              m.id === assistantId ? { ...m, streaming: false, content: m.content || '(无响应)' } : m,
            ),
            loading: false,
            error: err.message,
            cancelCurrent: null,
          });
        },
      },
    );
    set({ cancelCurrent: cancel });
  },

  async runAction(action: QuickAction, input: string): Promise<void> {
    const api = getAiApi();
    if (!api) return;
    const trimmed = input.trim();
    if (trimmed.length === 0) {
      toast.error('输入不能为空');
      return;
    }
    if (!get().hasKey) {
      toast.error('未配置 API Key');
      return;
    }
    // 取消上次进行中的 chat
    const prev = get().cancelCurrent;
    if (prev) {
      try {
        prev();
      } catch {
        // ignore
      }
    }

    // 1. 加占位 pending（status='pending' + content='' 流式累积）
    const pendingId = nextPendingId();
    const placeholder: PendingResult = {
      id: pendingId,
      action,
      content: '',
      createdAt: Date.now(),
      status: 'pending',
      streaming: true,
      sourceInput: trimmed,
    };
    set({
      pendingResults: [placeholder, ...get().pendingResults],
      loading: true,
      error: null,
      cancelCurrent: null,
    });

    // 2. 拼 messages：单条 user message
    const { provider, model } = get();
    const systemHint = buildActionSystemHint(action);
    const messages: ChatMessage[] = [{ role: 'user', content: trimmed }];

    // 3. 调 chat
    let accumulated = '';
    const cancel = api.chat(
      { provider, messages, systemHint, model },
      {
        onChunk: (chunk) => {
          if (chunk.type === 'token') {
            accumulated += chunk.content;
            set({
              pendingResults: get().pendingResults.map((p) =>
                p.id === pendingId ? { ...p, content: accumulated } : p,
              ),
            });
          }
        },
        onDone: () => {
          set({
            loading: false,
            cancelCurrent: null,
            pendingResults: get().pendingResults.map((p) =>
              p.id === pendingId ? { ...p, streaming: false } : p,
            ),
          });
          toast.success(`${action} 完成，请确认`);
        },
        onError: (err) => {
          toast.error(`${action} 失败（${err.code}）：${err.message}`);
          set({
            pendingResults: get().pendingResults.map((p) =>
              p.id === pendingId
                ? { ...p, content: p.content || '(无响应)', status: 'dismissed' as const, streaming: false }
                : p,
            ),
            loading: false,
            error: err.message,
            cancelCurrent: null,
          });
        },
      },
    );
    set({ cancelCurrent: cancel });
  },

  /**
   * T3-4：结构化提取。
   *
   * 流程：
   *   1. 校验入参 + hasKey
   *   2. 加占位 pending（status='pending', streaming=false —— 走 IPC 同步等待，**不**流式）
   *   3. 调 `window.api.ai.extractJson(...)`
   *   4. 成功 → 用对应 Zod schema 再校验一次（IPC 边界防御）→ 写进 pending.structured
   *   5. 失败 → toast 错误 + 标 pending 为 dismissed
   *
   * **不**流式 —— `extractJson` 走 chat 收完才返回。
   */
  async runStructuredAction(
    action: QuickAction,
    schemaName: JsonExtractionSchemaName,
    input: string,
  ): Promise<void> {
    const api = getAiApi();
    if (!api) return;
    const trimmed = input.trim();
    if (trimmed.length === 0) {
      toast.error('输入不能为空');
      return;
    }
    if (!get().hasKey) {
      toast.error('未配置 API Key');
      return;
    }

    // 1. 加占位 pending
    const pendingId = nextPendingId();
    const placeholder: PendingResult = {
      id: pendingId,
      action,
      content: '',
      createdAt: Date.now(),
      status: 'pending',
      streaming: false,
      sourceInput: trimmed,
      schemaName,
    };
    set({
      pendingResults: [placeholder, ...get().pendingResults],
      loading: true,
      error: null,
      cancelCurrent: null,
    });

    // 2. 拼 messages + systemHint
    const { provider, model } = get();
    const systemHint = buildStructuredSystemHint(schemaName);
    const messages: ChatMessage[] = [{ role: 'user', content: trimmed }];

    // 3. 调 extractJson
    try {
      const result = await api.extractJson({
        provider,
        schemaName,
        messages,
        systemHint,
        model,
      });
      if (!result.ok) {
        toast.error(`${action} 失败（${result.error.code}）：${result.error.message}`);
        set({
          pendingResults: get().pendingResults.map((p) =>
            p.id === pendingId ? { ...p, status: 'dismissed' as const } : p,
          ),
          loading: false,
          error: result.error.message,
        });
        return;
      }

      // 4. 用对应 Zod schema 再校验一次（防御性）
      const validated = validateExtractedResult(schemaName, result.data.data);
      if (!validated.ok) {
        toast.error(`${action} 失败（VALIDATION_FAILED）：返回数据不匹配 schema`);
        set({
          pendingResults: get().pendingResults.map((p) =>
            p.id === pendingId ? { ...p, status: 'dismissed' as const } : p,
          ),
          loading: false,
          error: 'return value does not match schema',
        });
        return;
      }

      // 5. 写进 pending.structured
      set({
        pendingResults: get().pendingResults.map((p) =>
          p.id === pendingId
            ? {
                ...p,
                structured: validated.data,
                content: JSON.stringify(validated.data, null, 2),
                attempts: result.data.attempts,
              }
            : p,
        ),
        loading: false,
      });
      toast.success(`${action} 完成，请确认`);
    } catch (err) {
      // extractJson 理论上不抛（IPC 失败走 {ok:false}），但防御一下
      const message = err instanceof Error ? err.message : String(err);
      toast.error(`${action} 失败：${message}`);
      set({
        pendingResults: get().pendingResults.map((p) =>
          p.id === pendingId ? { ...p, status: 'dismissed' as const } : p,
        ),
        loading: false,
        error: message,
      });
    }
  },

  confirmPending(id: string): void {
    set({
      pendingResults: get().pendingResults.map((p) =>
        p.id === id ? { ...p, status: 'confirmed' } : p,
      ),
    });
  },

  dismissPending(id: string): void {
    set({
      pendingResults: get().pendingResults.map((p) =>
        p.id === id ? { ...p, status: 'dismissed' } : p,
      ),
    });
  },

  clearPending(): void {
    set({ pendingResults: [] });
  },
}));

/** 重置内部计数器（仅供测试）。 */
export function __resetAiStoreCounterForTest(): void {
  messageCounter = 0;
  pendingCounter = 0;
}
