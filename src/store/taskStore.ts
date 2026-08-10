/**
 * 任务（Task）Zustand store（T2-3 渲染端）
 *
 * **职责**：
 *   - 缓存任务列表（含过滤）
 *   - 暴露 load / get / create / update / transition / archive / delete 7 个 action
 *   - 调 `window.api.task.*`，统一处理 `{ ok, data|error }` 响应
 *   - 成功 / 失败都用 `toast` 提示
 *
 * **数据流**：
 *   UI → store action → window.api.task → 主进程 handler → db → 回到 store
 *
 * **状态机**：
 *   - 状态流转由 `task:transition` 在主进程强制（`transition()` 函数 + 抛 `CONFLICT`）
 *   - `completedAt` 联动由主进程维护
 *   - 渲染端在调用 transition / archive / update(status) 之前**必须**二次确认
 *     （PROJECT_IDENTITY.md §6.4）
 *
 * **不做**：
 *   - 不直接 import `db` / `better-sqlite3` / `drizzle`（PROJECT_IDENTITY.md §2.2）
 *   - 不做项目 / 笔记 / AI / 复盘 store（留给对应卡）
 *
 * **类型来源**：
 *   - `Task` / `CreateTaskInput` / `UpdateTaskInput` / `TaskStatus` 来自 `@shared/types/task` / `@shared/types/taskStatus`
 *   - IPC 响应通过 `@shared/schemas/task` 的 Zod 校验（preload 已做）
 */

import { create } from 'zustand';

import type {
  CreateTaskInput,
  Task,
  TaskPriority,
  UpdateTaskInput,
} from '@shared/types/task';
import type { TaskStatus } from '@shared/types/taskStatus';

import { toast } from './toastStore';

/** `window.api` 形状（避免 renderer 直接依赖 electron 导入）。 */
interface ApiTaskShape {
  list(filter?: {
    status?: TaskStatus | undefined;
    priority?: TaskPriority | undefined;
    projectId?: string | null | undefined;
  }): Promise<
    | { ok: true; data: Task[] }
    | { ok: false; error: { code: string; message: string } }
  >;
  get(input: { id: string }): Promise<
    | { ok: true; data: Task }
    | { ok: false; error: { code: string; message: string } }
  >;
  create(input: CreateTaskInput): Promise<
    | { ok: true; data: Task }
    | { ok: false; error: { code: string; message: string } }
  >;
  update(input: { id: string; patch: UpdateTaskInput }): Promise<
    | { ok: true; data: Task }
    | { ok: false; error: { code: string; message: string } }
  >;
  transition(input: { id: string; to: TaskStatus }): Promise<
    | { ok: true; data: Task }
    | { ok: false; error: { code: string; message: string } }
  >;
  archive(input: { id: string }): Promise<
    | { ok: true; data: Task }
    | { ok: false; error: { code: string; message: string } }
  >;
  delete(input: { id: string }): Promise<
    | { ok: true; data: { deleted: true } }
    | { ok: false; error: { code: string; message: string } }
  >;
}

interface WindowWithApi {
  api?: {
    task?: ApiTaskShape;
  };
}

/** 安全取 window.api.task（避免 SSR / 测试环境 undefined）。 */
function getTaskApi(): ApiTaskShape | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as WindowWithApi;
  return w.api?.task ?? null;
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

/**
 * 任务列表过滤。
 *
 * 三个维度（自由组合）：
 *   - `status`    按状态过滤；省略 → 全部
 *   - `priority`  按优先级过滤
 *   - `projectId` 按项目过滤；`null` 显式匹配"无项目"；`undefined` 全部
 */
export interface TaskFilter {
  status?: TaskStatus | undefined;
  priority?: TaskPriority | undefined;
  projectId?: string | null | undefined;
}

/** store 形状。 */
export interface TaskState {
  /** 当前过滤下的任务列表（按 createdAt desc）。 */
  tasks: Task[];
  /** 加载中。 */
  loading: boolean;
  /** 最近一次错误信息。 */
  error: string | null;
  /** 当前过滤。 */
  filter: TaskFilter;
  /** 拉取列表（按 filter）。 */
  load: () => Promise<void>;
  /** 设置过滤；自动 reload。 */
  setFilter: (filter: TaskFilter) => void;
  /** 拉单个（必要时单点刷新）。 */
  get: (id: string) => Promise<Task | null>;
  /** 新建任务。 */
  create: (input: CreateTaskInput) => Promise<Task | null>;
  /** 部分更新（含 status 时走状态机）。 */
  update: (id: string, patch: UpdateTaskInput) => Promise<Task | null>;
  /** 状态流转（主进程强制合法性）。 */
  transition: (id: string, to: TaskStatus) => Promise<Task | null>;
  /** 归档。 */
  archive: (id: string) => Promise<Task | null>;
  /** 硬删。 */
  delete: (id: string) => Promise<boolean>;
}

export const useTaskStore = create<TaskState>((set, get) => ({
  tasks: [],
  loading: false,
  error: null,
  filter: {},

  async load(): Promise<void> {
    const api = getTaskApi();
    if (!api) {
      set({ tasks: [], loading: false, error: null });
      return;
    }
    set({ loading: true, error: null });
    const filter = get().filter;
    try {
      const result = await api.list(filter);
      if (!result.ok) {
        toast.error(`加载任务失败（${result.error.code}）：${result.error.message}`);
        set({ loading: false, error: result.error.message });
        return;
      }
      set({ tasks: result.data, loading: false, error: null });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      set({ loading: false, error: message });
    }
  },

  setFilter(filter: TaskFilter): void {
    set({ filter });
    void get().load();
  },

  async get(id: string): Promise<Task | null> {
    const api = getTaskApi();
    if (!api) return null;
    try {
      const result = await api.get({ id });
      const task = unwrapOrToast(result, '获取任务失败');
      // 替换 / 插入
      const existing = get().tasks.find((t) => t.id === id);
      if (existing) {
        set({ tasks: get().tasks.map((t) => (t.id === id ? task : t)) });
      } else {
        set({ tasks: [task, ...get().tasks] });
      }
      return task;
    } catch {
      return null;
    }
  },

  async create(input: CreateTaskInput): Promise<Task | null> {
    const api = getTaskApi();
    if (!api) return null;
    try {
      const result = await api.create(input);
      const created = unwrapOrToast(result, '创建任务失败');
      // 按当前 filter 决定是否插入到可见列表
      const filter = get().filter;
      const visible =
        (filter.status === undefined || filter.status === created.status) &&
        (filter.priority === undefined || filter.priority === created.priority) &&
        (filter.projectId === undefined ||
          (filter.projectId === null && created.projectId === null) ||
          filter.projectId === created.projectId);
      if (visible) {
        set({ tasks: [created, ...get().tasks] });
      }
      toast.success('已创建任务');
      return created;
    } catch {
      return null;
    }
  },

  async update(id: string, patch: UpdateTaskInput): Promise<Task | null> {
    const api = getTaskApi();
    if (!api) return null;
    try {
      const result = await api.update({ id, patch });
      const updated = unwrapOrToast(result, '更新任务失败');
      set({ tasks: get().tasks.map((t) => (t.id === id ? updated : t)) });
      toast.success('已保存');
      return updated;
    } catch {
      return null;
    }
  },

  async transition(id: string, to: TaskStatus): Promise<Task | null> {
    const api = getTaskApi();
    if (!api) return null;
    try {
      const result = await api.transition({ id, to });
      const updated = unwrapOrToast(result, '状态流转失败');
      set({ tasks: get().tasks.map((t) => (t.id === id ? updated : t)) });
      toast.success('状态已更新');
      return updated;
    } catch {
      return null;
    }
  },

  async archive(id: string): Promise<Task | null> {
    const api = getTaskApi();
    if (!api) return null;
    try {
      const result = await api.archive({ id });
      const updated = unwrapOrToast(result, '归档失败');
      set({ tasks: get().tasks.map((t) => (t.id === id ? updated : t)) });
      toast.success('已归档');
      return updated;
    } catch {
      return null;
    }
  },

  async delete(id: string): Promise<boolean> {
    const api = getTaskApi();
    if (!api) return false;
    try {
      const result = await api.delete({ id });
      unwrapOrToast(result, '删除失败');
      set({ tasks: get().tasks.filter((t) => t.id !== id) });
      toast.success('已删除');
      return true;
    } catch {
      return false;
    }
  },
}));
