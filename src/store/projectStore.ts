/**
 * 项目（Project）Zustand store（T2-3 渲染端）
 *
 * **职责**：
 *   - 缓存项目列表（按 `archived` 分组）
 *   - 暴露 load / create / update / archive / delete 5 个 action
 *   - 调 `window.api.project.*`，统一处理 `{ ok, data|error }` 响应
 *   - 成功 / 失败都用 `toast` 提示
 *
 * **数据流**：
 *   UI → store action → window.api.project → 主进程 handler → db → 回到 store
 *
 * **不做**：
 *   - 不直接 import `db` / `better-sqlite3` / `drizzle`（PROJECT_IDENTITY.md §2.2）
 *   - 不做任务 / 笔记 / AI / 复盘 store（留给对应卡）
 *   - 二次确认不在 store 内做 —— UI 层在调用 archive / delete 前确认
 *     （PROJECT_IDENTITY.md §6.4）
 *
 * **类型来源**：
 *   - `Project` / `CreateProjectInput` / `UpdateProjectInput` 来自 `@shared/types/project`
 *   - IPC 响应通过 `@shared/schemas/project` 的 Zod 校验（preload 已做）
 */

import { create } from 'zustand';

import type {
  CreateProjectInput,
  Project,
  UpdateProjectInput,
} from '@shared/types/project';

import { toast } from './toastStore';

/** `window.api` 形状（避免 renderer 直接依赖 electron 导入）。 */
interface ApiProjectShape {
  list(filter?: { archived?: boolean }): Promise<
    | { ok: true; data: Project[] }
    | { ok: false; error: { code: string; message: string } }
  >;
  create(input: CreateProjectInput): Promise<
    | { ok: true; data: Project }
    | { ok: false; error: { code: string; message: string } }
  >;
  update(input: { id: string; patch: UpdateProjectInput }): Promise<
    | { ok: true; data: Project }
    | { ok: false; error: { code: string; message: string } }
  >;
  archive(input: { id: string }): Promise<
    | { ok: true; data: Project }
    | { ok: false; error: { code: string; message: string } }
  >;
  delete(input: { id: string }): Promise<
    | { ok: true; data: { deleted: true } }
    | { ok: false; error: { code: string; message: string } }
  >;
}

interface WindowWithApi {
  api?: {
    project?: ApiProjectShape;
  };
}

/** 安全取 window.api.project（避免 SSR / 测试环境 undefined）。 */
function getProjectApi(): ApiProjectShape | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as WindowWithApi;
  return w.api?.project ?? null;
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

/** 过滤：是否显示归档项目。 */
export type ProjectArchiveFilter = 'active' | 'archived' | 'all';

/** store 形状。 */
export interface ProjectState {
  /** 当前过滤下的项目列表（按 createdAt desc，归档在尾部）。 */
  projects: Project[];
  /** 加载中（首屏 load / 任意 action 写操作期间）。 */
  loading: boolean;
  /** 最近一次错误信息（UI 可选显示；toast 已经显示过）。 */
  error: string | null;
  /** 是否显示归档项目。默认 active。 */
  archiveFilter: ProjectArchiveFilter;
  /** 拉取列表（按 archiveFilter）。 */
  load: () => Promise<void>;
  /** 设置归档过滤；自动 reload。 */
  setArchiveFilter: (filter: ProjectArchiveFilter) => void;
  /** 新建项目。 */
  create: (input: CreateProjectInput) => Promise<Project | null>;
  /** 部分更新。 */
  update: (id: string, patch: UpdateProjectInput) => Promise<Project | null>;
  /** 归档（设 archived=true）。 */
  archive: (id: string) => Promise<Project | null>;
  /** 硬删。 */
  delete: (id: string) => Promise<boolean>;
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  projects: [],
  loading: false,
  error: null,
  archiveFilter: 'active',

  async load(): Promise<void> {
    const api = getProjectApi();
    if (!api) {
      set({ projects: [], loading: false, error: null });
      return;
    }
    set({ loading: true, error: null });
    const filter = get().archiveFilter;
    const filterArg: { archived?: boolean } | undefined =
      filter === 'all'
        ? {}
        : filter === 'active'
          ? { archived: false }
          : { archived: true };
    try {
      const result = await api.list(filterArg);
      if (!result.ok) {
        toast.error(`加载项目失败（${result.error.code}）：${result.error.message}`);
        set({ loading: false, error: result.error.message });
        return;
      }
      set({ projects: result.data, loading: false, error: null });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      set({ loading: false, error: message });
    }
  },

  setArchiveFilter(filter: ProjectArchiveFilter): void {
    set({ archiveFilter: filter });
    void get().load();
  },

  async create(input: CreateProjectInput): Promise<Project | null> {
    const api = getProjectApi();
    if (!api) return null;
    try {
      const result = await api.create(input);
      const created = unwrapOrToast(result, '创建项目失败');
      // 按当前 archiveFilter 决定是否插入可见列表
      const filter = get().archiveFilter;
      const visible =
        filter === 'all' ||
        (filter === 'active' && !created.archived) ||
        (filter === 'archived' && created.archived);
      if (visible) {
        // 新建的 createdAt 必然最大；按 desc 插头部
        set({ projects: [created, ...get().projects] });
      }
      toast.success('已新建项目');
      return created;
    } catch {
      return null;
    }
  },

  async update(id: string, patch: UpdateProjectInput): Promise<Project | null> {
    const api = getProjectApi();
    if (!api) return null;
    try {
      const result = await api.update({ id, patch });
      const updated = unwrapOrToast(result, '更新项目失败');
      set({ projects: get().projects.map((p) => (p.id === id ? updated : p)) });
      toast.success('已保存');
      return updated;
    } catch {
      return null;
    }
  },

  async archive(id: string): Promise<Project | null> {
    const api = getProjectApi();
    if (!api) return null;
    try {
      const result = await api.archive({ id });
      const updated = unwrapOrToast(result, '归档失败');
      // 按当前 filter 决定保留还是剔除
      const filter = get().archiveFilter;
      if (filter === 'active') {
        set({ projects: get().projects.filter((p) => p.id !== id) });
      } else {
        set({ projects: get().projects.map((p) => (p.id === id ? updated : p)) });
      }
      toast.success('已归档');
      return updated;
    } catch {
      return null;
    }
  },

  async delete(id: string): Promise<boolean> {
    const api = getProjectApi();
    if (!api) return false;
    try {
      const result = await api.delete({ id });
      unwrapOrToast(result, '删除失败');
      set({ projects: get().projects.filter((p) => p.id !== id) });
      toast.success('已删除');
      return true;
    } catch {
      return false;
    }
  },
}));
