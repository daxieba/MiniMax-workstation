/**
 * 复盘（Review）Zustand store（T5-1 每日复盘）
 *
 * **职责**：
 *   - 缓存当前日期的复盘（`current`） + 最近 N 条列表（`recent`）
 *   - 缓存 AI 草稿（`aiDraft`，内存；用户采纳后清空）
 *   - 暴露 loadByDate / loadRecent / upsertReview / updateReview /
 *     generateDraft / acceptDraft / discardDraft
 *   - 调 `window.api.review.*`，统一处理 `{ ok, data|error }` 响应
 *   - 成功 / 失败都用 `toast` 提示
 *
 * **数据流**：
 *   UI → store action → window.api.review → 主进程 handler → db → 回到 store
 *
 * **不做**：
 *   - 不直接 import `db` / `better-sqlite3` / `drizzle`（PROJECT_IDENTITY.md §2.2）
 *   - 不做任务 / 笔记 / AI / 收集箱 store（留给对应卡）
 *
 * **草稿语义**：
 *   - `generateDraft` 仅把结果存到 `aiDraft`（内存）—— **不**自动入库
 *   - `acceptDraft` 把 `aiDraft` 数据写到 `current` 的 4 段字段（仅本地 store），
 *     并把 `aiDraft` 设为 `null`；**不**自动保存，需要用户再点"保存"
 *   - `discardDraft` 仅清空 `aiDraft`
 *   - 真正的"采纳并入库"路径是 `acceptDraft` + `upsertReview` 两次调用
 *
 * **类型来源**：
 *   - `Review` / `ReviewDraft` 来自 `@shared/types/review`
 *   - IPC 响应通过 `@shared/schemas/review` 的 Zod 校验（preload 已做）
 *
 * @see electron/main/ipc/review.ts
 * @see shared/schemas/review.ts
 */

import { create } from 'zustand';

import type { Review, ReviewDraft } from '@shared/types/review';

import { toast } from './toastStore';

/** `window.api.review` 形状（避免 renderer 直接依赖 electron 导入）。 */
interface ApiReviewShape {
  getByDate(date: string): Promise<
    | { ok: true; data: Review | null }
    | { ok: false; error: { code: string; message: string } }
  >;
  upsert(input: {
    date: string;
    completed: Array<{ taskId: string; title: string }>;
    uncompleted: Array<{ taskId: string; title: string; reason?: string }>;
    blockers: string;
    topThree: string[];
  }): Promise<
    | { ok: true; data: Review }
    | { ok: false; error: { code: string; message: string } }
  >;
  update(input: {
    id: string;
    patch: {
      completed?: Array<{ taskId: string; title: string }>;
      uncompleted?: Array<{ taskId: string; title: string; reason?: string }>;
      blockers?: string;
      topThree?: string[];
      aiDraft?: ReviewDraft | null;
    };
  }): Promise<
    | { ok: true; data: Review }
    | { ok: false; error: { code: string; message: string } }
  >;
  listRecent(input?: { limit?: number }): Promise<
    | { ok: true; data: Review[] }
    | { ok: false; error: { code: string; message: string } }
  >;
  generateDraft(input: {
    date: string;
    provider: 'minimax' | 'openai-compatible';
    model?: string;
  }): Promise<
    | { ok: true; data: ReviewDraft }
    | { ok: false; error: { code: string; message: string } }
  >;
}

interface WindowWithApi {
  api?: {
    review?: ApiReviewShape;
  };
}

/** 安全取 window.api.review（避免 SSR / 测试环境 undefined）。 */
function getReviewApi(): ApiReviewShape | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as WindowWithApi;
  return w.api?.review ?? null;
}

/** 把 IPC `{ok, error}` 形态的失败转成抛错 + toast 提示。 */
function unwrapOrToast<T>(
  result: { ok: true; data: T } | { ok: false; error: { code: string; message: string } },
  errorPrefix: string,
): T {
  if (result.ok) return result.data;
  toast.error(`${errorPrefix}（${result.error.code}）：${result.error.message}`);
  throw new Error(`${errorPrefix}: ${result.error.code} ${result.error.message}`);
}

/**
 * upsert 入参（按 date 唯一键）。
 * 4 段固定字段：completed / uncompleted / blockers / topThree。
 */
export interface ReviewUpsertInput {
  date: string;
  completed: Array<{ taskId: string; title: string }>;
  uncompleted: Array<{ taskId: string; title: string; reason?: string }>;
  blockers: string;
  topThree: string[];
}

/**
 * update 入参（patch 语义；date 不可改）。
 */
export interface ReviewUpdateInput {
  id: string;
  patch: {
    completed?: Array<{ taskId: string; title: string }>;
    uncompleted?: Array<{ taskId: string; title: string; reason?: string }>;
    blockers?: string;
    topThree?: string[];
    aiDraft?: ReviewDraft | null;
  };
}

/** store 形状。 */
export interface ReviewState {
  /** 当前选中的复盘（按 `currentDate` 拉的）。 */
  current: Review | null;
  /** 当前选中日期（`YYYY-MM-DD`）。 */
  currentDate: string;
  /** 最近 N 条列表（按 date DESC）。 */
  recent: Review[];
  /** AI 草稿（内存；用户采纳/丢弃后清空）。 */
  aiDraft: ReviewDraft | null;
  /** 加载中。 */
  loading: boolean;
  /** 最近一次错误信息。 */
  error: string | null;
  /** 按日期加载。自动设 currentDate。 */
  loadByDate: (date: string) => Promise<void>;
  /** 加载最近 N 条列表。 */
  loadRecent: (limit?: number) => Promise<void>;
  /** Upsert（按 date 唯一键）。 */
  upsertReview: (input: ReviewUpsertInput) => Promise<Review | null>;
  /** Patch update。 */
  updateReview: (input: ReviewUpdateInput) => Promise<Review | null>;
  /** 生成 AI 草稿（不入库；存到 aiDraft）。 */
  generateDraft: (date: string, provider: string, model?: string) => Promise<ReviewDraft | null>;
  /**
   * 采纳 AI 草稿（仅本地：把 aiDraft 数据写到 current 的 4 段字段，并清空 aiDraft）。
   * **不**自动保存 —— 需要用户再点"保存"。
   */
  acceptDraft: () => void;
  /**
   * 丢弃 AI 草稿（仅清空 aiDraft）。
   */
  discardDraft: () => void;
}

export const useReviewStore = create<ReviewState>((set, get) => ({
  current: null,
  currentDate: '',
  recent: [],
  aiDraft: null,
  loading: false,
  error: null,

  async loadByDate(date: string): Promise<void> {
    const api = getReviewApi();
    if (!api) {
      set({ current: null, currentDate: date, loading: false, error: null });
      return;
    }
    set({ loading: true, error: null, currentDate: date });
    try {
      const result = await api.getByDate(date);
      const data = unwrapOrToast(result, '加载复盘失败');
      set({ current: data, loading: false, error: null });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      set({ loading: false, error: message, current: null });
    }
  },

  async loadRecent(limit?: number): Promise<void> {
    const api = getReviewApi();
    if (!api) {
      set({ recent: [], loading: false, error: null });
      return;
    }
    set({ loading: true, error: null });
    try {
      const input: { limit?: number } = {};
      if (limit !== undefined) input.limit = limit;
      const result = await api.listRecent(input);
      const data = unwrapOrToast(result, '加载最近复盘失败');
      set({ recent: data, loading: false, error: null });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      set({ loading: false, error: message, recent: [] });
    }
  },

  async upsertReview(input: ReviewUpsertInput): Promise<Review | null> {
    const api = getReviewApi();
    if (!api) return null;
    try {
      const result = await api.upsert(input);
      const saved = unwrapOrToast(result, '保存复盘失败');
      set({ current: saved, currentDate: input.date });
      // 同步进 recent 列表（去重 / 插到头部）
      const recent = get().recent.filter((r) => r.id !== saved.id);
      set({ recent: [saved, ...recent] });
      toast.success('已保存');
      return saved;
    } catch {
      return null;
    }
  },

  async updateReview(input: ReviewUpdateInput): Promise<Review | null> {
    const api = getReviewApi();
    if (!api) return null;
    try {
      const result = await api.update(input);
      const updated = unwrapOrToast(result, '更新复盘失败');
      set({ current: updated });
      // 同步进 recent 列表
      const recent = get().recent.filter((r) => r.id !== updated.id);
      set({ recent: [updated, ...recent] });
      return updated;
    } catch {
      return null;
    }
  },

  async generateDraft(
    date: string,
    provider: string,
    model?: string,
  ): Promise<ReviewDraft | null> {
    const api = getReviewApi();
    if (!api) return null;
    set({ loading: true, error: null });
    try {
      const input: { date: string; provider: 'minimax' | 'openai-compatible'; model?: string } = {
        date,
        // 已经在 schema 里 enum('minimax', 'openai-compatible')，运行时再做一次窄化
        provider: provider === 'openai-compatible' ? 'openai-compatible' : 'minimax',
      };
      if (model !== undefined) input.model = model;
      const result = await api.generateDraft(input);
      const draft = unwrapOrToast(result, '生成草稿失败');
      set({ aiDraft: draft, loading: false, error: null });
      return draft;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      set({ loading: false, error: message });
      return null;
    }
  },

  acceptDraft(): void {
    const { aiDraft, current } = get();
    if (!aiDraft) {
      toast.info('当前没有可采纳的草稿');
      return;
    }
    if (!current) {
      // 没有 current 行（当天还没复盘）：仅更新 aiDraft = null，等用户填好 4 段后点保存
      set({ aiDraft: null });
      toast.success('已采纳草稿，请填好 4 段后保存');
      return;
    }
    // 把 aiDraft 数据写到 current 的 4 段字段（taskId 留空 —— AI 不知道 taskId）
    const next: Review = {
      ...current,
      completed: aiDraft.completed.map((title) => ({ taskId: '', title })),
      uncompleted: aiDraft.uncompleted.map((u) => ({
        taskId: '',
        title: u.title,
        ...(u.reason !== undefined ? { reason: u.reason } : {}),
      })),
      blockers: aiDraft.blockers,
      topThree: aiDraft.topThree.slice(0, 3),
    };
    set({ current: next, aiDraft: null });
    toast.success('已采纳草稿（本地），请检查后保存');
  },

  discardDraft(): void {
    set({ aiDraft: null });
  },
}));
