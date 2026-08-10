/**
 * 收集箱（Inbox）Zustand store（T2-2 渲染端）
 *
 * **职责**：
 *   - 缓存当前过滤的 inbox items 列表
 *   - 暴露 load / add / update / archive / convertToTask 5 个 action
 *   - 调 `window.api.inbox.*`，统一处理 `{ ok, data|error }` 响应
 *   - 成功 / 失败都用 `toast` 提示
 *
 * **数据流**：
 *   UI → store action → window.api.inbox → 主进程 handler → db → 回到 store
 *
 * **不做**：
 *   - 不直接 import `db` / `better-sqlite3` / `drizzle`（PROJECT_IDENTITY.md §2.2）
 *   - 不做项目 / 任务 / 笔记 / AI / 复盘 store（留给对应卡）
 *
 * **类型来源**：
 *   - `InboxItem` / `CreateInboxItemInput` / `TaskDraft` 来自 `@shared/types`
 *   - IPC 响应通过 `@shared/schemas/inbox` 的 Zod 校验（preload 已做）
 *
 * **过滤**：
 *   - filter: `'active' | 'archived' | 'all'`
 *   - `'all'` → 调 `inbox:list({})`
 *   - `'active'` → 调 `inbox:list({ status: 'active' })`
 *   - `'archived'` → 调 `inbox:list({ status: 'archived' })`
 *
 * **确认**：
 *   - `convertToTask` 不在此 store 内做 window.confirm —— UI 层在调用前确认
 *     （PROJECT_IDENTITY.md §6.4 要求"删除 / 转换前必须确认"）。
 */

import { create } from 'zustand';

import type {
  CreateInboxItemInput,
  InboxItem,
  InboxKind,
  InboxStatus,
} from '@shared/types/inbox';
import type { TaskDraft } from '@shared/types/task';

import { toast } from './toastStore';

/** `window.api` 形状（避免 renderer 直接依赖 electron 导入）。 */
interface ApiInboxShape {
  list(filter?: { status?: InboxStatus }): Promise<
    | { ok: true; data: InboxItem[] }
    | { ok: false; error: { code: string; message: string } }
  >;
  add(input: CreateInboxItemInput): Promise<
    | { ok: true; data: InboxItem }
    | { ok: false; error: { code: string; message: string } }
  >;
  update(input: {
    id: string;
    patch: Partial<CreateInboxItemInput>;
  }): Promise<
    | { ok: true; data: InboxItem }
    | { ok: false; error: { code: string; message: string } }
  >;
  archive(input: { id: string }): Promise<
    | { ok: true; data: InboxItem }
    | { ok: false; error: { code: string; message: string } }
  >;
  convertToTask(input: {
    inboxId: string;
    taskDraft: TaskDraft;
  }): Promise<
    | { ok: true; data: { inbox: InboxItem; task: unknown } }
    | { ok: false; error: { code: string; message: string } }
  >;
}

interface WindowWithApi {
  api?: {
    inbox?: ApiInboxShape;
  };
}

/** 安全取 window.api.inbox（避免 SSR / 测试环境 undefined）。 */
function getInboxApi(): ApiInboxShape | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as WindowWithApi;
  return w.api?.inbox ?? null;
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

/** 过滤类型。 */
export type InboxFilter = 'active' | 'archived' | 'all';

/** store 形状。 */
export interface InboxState {
  /** 当前过滤下的 inbox items（按 createdAt desc）。 */
  items: InboxItem[];
  /** 加载中（首屏 load / 任意 action 写操作期间）。 */
  loading: boolean;
  /** 最近一次错误信息（string | null），UI 可选显示；toast 已经显示过。 */
  error: string | null;
  /** 当前过滤。 */
  filter: InboxFilter;
  /** 拉取列表（按 filter）。 */
  load: () => Promise<void>;
  /** 设置过滤。会自动重新 load。 */
  setFilter: (filter: InboxFilter) => void;
  /** 新增一条。 */
  add: (input: { content: string; kind: InboxKind; projectId?: string | null }) => Promise<InboxItem | null>;
  /** 部分更新。 */
  update: (id: string, patch: Partial<CreateInboxItemInput>) => Promise<InboxItem | null>;
  /** 归档。 */
  archive: (id: string) => Promise<InboxItem | null>;
  /** 转任务。 */
  convertToTask: (inboxId: string, taskDraft: TaskDraft) => Promise<{
    inbox: InboxItem;
    task: unknown;
  } | null>;
}

export const useInboxStore = create<InboxState>((set, get) => ({
  items: [],
  loading: false,
  error: null,
  filter: 'active',

  async load(): Promise<void> {
    const api = getInboxApi();
    if (!api) {
      // 渲染进程外（测试 / SSR）→ 跳过
      set({ items: [], loading: false, error: null });
      return;
    }
    set({ loading: true, error: null });
    const filter = get().filter;
    const statusArg: { status?: InboxStatus } | undefined =
      filter === 'all' ? {} : { status: filter };
    try {
      const result = await api.list(statusArg);
      if (!result.ok) {
        toast.error(`加载收集箱失败（${result.error.code}）：${result.error.message}`);
        set({ loading: false, error: result.error.message });
        return;
      }
      set({ items: result.data, loading: false, error: null });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      set({ loading: false, error: message });
    }
  },

  setFilter(filter: InboxFilter): void {
    set({ filter });
    // 触发异步 reload；调用方不需 await
    void get().load();
  },

  async add(input: { content: string; kind: InboxKind; projectId?: string | null }): Promise<InboxItem | null> {
    const api = getInboxApi();
    if (!api) return null;
    try {
      const result = await api.add(input);
      const created = unwrapOrToast(result, '添加失败');
      // 乐观地加入 items（按 createdAt desc 排序）
      set({ items: [created, ...get().items] });
      toast.success('已加入收集箱');
      return created;
    } catch {
      return null;
    }
  },

  async update(id: string, patch: Partial<CreateInboxItemInput>): Promise<InboxItem | null> {
    const api = getInboxApi();
    if (!api) return null;
    try {
      const result = await api.update({ id, patch });
      const updated = unwrapOrToast(result, '更新失败');
      set({
        items: get().items.map((it) => (it.id === id ? updated : it)),
      });
      return updated;
    } catch {
      return null;
    }
  },

  async archive(id: string): Promise<InboxItem | null> {
    const api = getInboxApi();
    if (!api) return null;
    try {
      const result = await api.archive({ id });
      const updated = unwrapOrToast(result, '归档失败');
      // 按当前 filter 决定保留还是剔除
      const filter = get().filter;
      if (filter === 'active') {
        set({ items: get().items.filter((it) => it.id !== id) });
      } else if (filter === 'archived') {
        set({
          items: get().items.map((it) => (it.id === id ? updated : it)),
        });
      } else {
        // 'all'：保留在列表里（status 改成 archived）
        set({
          items: get().items.map((it) => (it.id === id ? updated : it)),
        });
      }
      toast.success('已归档');
      return updated;
    } catch {
      return null;
    }
  },

  async convertToTask(
    inboxId: string,
    taskDraft: TaskDraft,
  ): Promise<{ inbox: InboxItem; task: unknown } | null> {
    const api = getInboxApi();
    if (!api) return null;
    try {
      const result = await api.convertToTask({ inboxId, taskDraft });
      const data = unwrapOrToast(result, '转任务失败');
      // 把 inbox 标为 converted；按 filter 决定是否保留在可见列表
      const filter = get().filter;
      if (filter === 'active') {
        set({ items: get().items.filter((it) => it.id !== inboxId) });
      } else if (filter === 'archived' || filter === 'all') {
        set({
          items: get().items.map((it) => (it.id === inboxId ? data.inbox : it)),
        });
      }
      toast.success('已转为任务');
      return data;
    } catch {
      return null;
    }
  },
}));
