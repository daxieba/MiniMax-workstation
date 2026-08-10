/**
 * 笔记（Note）Zustand store（T4-1 渲染端）
 *
 * **职责**：
 *   - 缓存当前过滤的 notes 列表
 *   - 暴露 load / get / create / update / archive / delete / linkToTask / unlinkFromTask 8 个 action
 *   - 调 `window.api.note.*`，统一处理 `{ ok, data|error }` 响应
 *   - 成功 / 失败都用 `toast` 提示
 *
 * **数据流**：
 *   UI → store action → window.api.note → 主进程 handler → db → 回到 store
 *
 * **不做**：
 *   - 不直接 import `db` / `better-sqlite3` / `drizzle`（PROJECT_IDENTITY.md §2.2）
 *   - 不做项目 / 任务 / AI / 复盘 store（留给对应卡）
 *   - 二次确认不在 store 内做 —— UI 层在调用 delete 前确认
 *
 * **类型来源**：
 *   - `Note` / `CreateNoteInput` / `UpdateNoteInput` / `NoteListFilter` 来自 `@shared/types/note`
 *   - IPC 响应通过 `@shared/schemas/note` 的 Zod 校验（preload 已做）
 *
 * **状态**：
 *   - `notes`         列表
 *   - `loading`       加载中
 *   - `error`         最近一次错误信息
 *   - `filter`        列表过滤
 *
 * @see electron/main/ipc/note.ts
 * @see shared/types/note.ts
 */

import { create } from 'zustand';

import type { CreateNoteInput, Note, NoteListFilter, UpdateNoteInput } from '@shared/types/note';

import { toast } from './toastStore';

/** `window.api` 形状（避免 renderer 直接依赖 electron 导入）。 */
interface ApiNoteShape {
  list(
    filter?: NoteListFilter,
  ): Promise<{ ok: true; data: Note[] } | { ok: false; error: { code: string; message: string } }>;
  get(input: {
    id: string;
  }): Promise<{ ok: true; data: Note } | { ok: false; error: { code: string; message: string } }>;
  create(
    input: CreateNoteInput,
  ): Promise<{ ok: true; data: Note } | { ok: false; error: { code: string; message: string } }>;
  update(input: {
    id: string;
    patch: UpdateNoteInput;
  }): Promise<{ ok: true; data: Note } | { ok: false; error: { code: string; message: string } }>;
  archive(input: {
    id: string;
  }): Promise<{ ok: true; data: Note } | { ok: false; error: { code: string; message: string } }>;
  delete(input: {
    id: string;
  }): Promise<
    { ok: true; data: { deleted: true } } | { ok: false; error: { code: string; message: string } }
  >;
  linkToTask(input: {
    noteId: string;
    taskId: string;
  }): Promise<{ ok: true; data: Note } | { ok: false; error: { code: string; message: string } }>;
  unlinkFromTask(input: {
    noteId: string;
    taskId: string;
  }): Promise<{ ok: true; data: Note } | { ok: false; error: { code: string; message: string } }>;
  export(input: {
    ids: string[];
    targetDir?: string;
  }): Promise<
    | { ok: true; data: { files: Array<{ id: string; path: string }> } }
    | { ok: false; error: { code: string; message: string } }
  >;
}

interface WindowWithApi {
  api?: {
    note?: ApiNoteShape;
  };
}

/** 安全取 window.api.note（避免 SSR / 测试环境 undefined）。 */
function getNoteApi(): ApiNoteShape | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as WindowWithApi;
  return w.api?.note ?? null;
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

/** store 形状。 */
export interface NoteState {
  /** 当前过滤下的 notes（按 updatedAt desc）。 */
  notes: Note[];
  /** 加载中（首屏 load / 任意 action 写操作期间）。 */
  loading: boolean;
  /** 最近一次错误信息（UI 可选显示；toast 已经显示过）。 */
  error: string | null;
  /** 当前过滤。 */
  filter: NoteListFilter;
  /** 拉取列表（按 filter）。 */
  load: () => Promise<void>;
  /** 设置过滤；自动 reload。 */
  setFilter: (filter: NoteListFilter) => void;
  /** 拉单个（必要时单点刷新）。 */
  get: (id: string) => Promise<Note | null>;
  /** 新建笔记。 */
  create: (input: CreateNoteInput) => Promise<Note | null>;
  /** 部分更新。 */
  update: (id: string, patch: UpdateNoteInput) => Promise<Note | null>;
  /** 归档（设 archived=true）。 */
  archive: (id: string) => Promise<Note | null>;
  /** 硬删。 */
  delete: (id: string) => Promise<boolean>;
  /** 关联任务（去重加进 linkedTaskIds）。 */
  linkToTask: (noteId: string, taskId: string) => Promise<Note | null>;
  /** 取消关联任务。 */
  unlinkFromTask: (noteId: string, taskId: string) => Promise<Note | null>;
  /**
   * 导出选中的笔记为 `.md` 文件（T4-3）。
   * 返回成功写入的文件路径列表；部分 id 找不到会跳过（不报错）。
   * UI 在调用前**必须**做"删除前确认"语义的非破坏确认（身份卡 §6.4）。
   */
  export: (
    ids: string[],
    targetDir?: string,
  ) => Promise<Array<{ id: string; path: string }> | null>;
}

/**
 * 判断新建的 note 是否应该出现在当前 filter 视图里。
 *
 * 默认 filter（无 archived 字段）= 不显示归档；
 * 有 projectId 时强制 projectId 相等；
 * 有 tag 时 tags 数组里必须包含。
 */
function noteMatchesFilter(note: Note, filter: NoteListFilter): boolean {
  if (filter.archived !== undefined && note.archived !== filter.archived) return false;
  if (filter.projectId !== undefined && note.projectId !== filter.projectId) return false;
  if (filter.tag !== undefined && !note.tags.includes(filter.tag)) return false;
  return true;
}

export const useNoteStore = create<NoteState>((set, get) => ({
  notes: [],
  loading: false,
  error: null,
  filter: {},

  async load(): Promise<void> {
    const api = getNoteApi();
    if (!api) {
      // 渲染进程外（测试 / SSR）→ 跳过
      set({ notes: [], loading: false, error: null });
      return;
    }
    set({ loading: true, error: null });
    const filter = get().filter;
    try {
      const result = await api.list(filter);
      if (!result.ok) {
        toast.error(`加载笔记失败（${result.error.code}）：${result.error.message}`);
        set({ loading: false, error: result.error.message });
        return;
      }
      set({ notes: result.data, loading: false, error: null });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      set({ loading: false, error: message });
    }
  },

  setFilter(filter: NoteListFilter): void {
    set({ filter });
    void get().load();
  },

  async get(id: string): Promise<Note | null> {
    const api = getNoteApi();
    if (!api) return null;
    try {
      const result = await api.get({ id });
      const note = unwrapOrToast(result, '获取笔记失败');
      // 替换 / 插入
      const existing = get().notes.find((n) => n.id === id);
      if (existing) {
        set({ notes: get().notes.map((n) => (n.id === id ? note : n)) });
      } else {
        set({ notes: [note, ...get().notes] });
      }
      return note;
    } catch {
      return null;
    }
  },

  async create(input: CreateNoteInput): Promise<Note | null> {
    const api = getNoteApi();
    if (!api) return null;
    try {
      const result = await api.create(input);
      const created = unwrapOrToast(result, '创建笔记失败');
      // 按当前 filter 决定是否插入到可见列表
      const filter = get().filter;
      if (noteMatchesFilter(created, filter)) {
        set({ notes: [created, ...get().notes] });
      }
      toast.success('已新建笔记');
      return created;
    } catch {
      return null;
    }
  },

  async update(id: string, patch: UpdateNoteInput): Promise<Note | null> {
    const api = getNoteApi();
    if (!api) return null;
    try {
      const result = await api.update({ id, patch });
      const updated = unwrapOrToast(result, '更新笔记失败');
      const filter = get().filter;
      if (noteMatchesFilter(updated, filter)) {
        // 替换或插入
        const existing = get().notes.find((n) => n.id === id);
        if (existing) {
          set({ notes: get().notes.map((n) => (n.id === id ? updated : n)) });
        } else {
          set({ notes: [updated, ...get().notes] });
        }
      } else {
        // patch 让 note 移出当前 filter 视图
        set({ notes: get().notes.filter((n) => n.id !== id) });
      }
      toast.success('已保存');
      return updated;
    } catch {
      return null;
    }
  },

  async archive(id: string): Promise<Note | null> {
    const api = getNoteApi();
    if (!api) return null;
    try {
      const result = await api.archive({ id });
      const updated = unwrapOrToast(result, '归档失败');
      // 按当前 filter 决定保留还是剔除
      const filter = get().filter;
      if (noteMatchesFilter(updated, filter)) {
        set({ notes: get().notes.map((n) => (n.id === id ? updated : n)) });
      } else {
        set({ notes: get().notes.filter((n) => n.id !== id) });
      }
      toast.success('已归档');
      return updated;
    } catch {
      return null;
    }
  },

  async delete(id: string): Promise<boolean> {
    const api = getNoteApi();
    if (!api) return false;
    try {
      const result = await api.delete({ id });
      unwrapOrToast(result, '删除失败');
      set({ notes: get().notes.filter((n) => n.id !== id) });
      toast.success('已删除');
      return true;
    } catch {
      return false;
    }
  },

  async linkToTask(noteId: string, taskId: string): Promise<Note | null> {
    const api = getNoteApi();
    if (!api) return null;
    try {
      const result = await api.linkToTask({ noteId, taskId });
      const updated = unwrapOrToast(result, '关联任务失败');
      set({ notes: get().notes.map((n) => (n.id === noteId ? updated : n)) });
      return updated;
    } catch {
      return null;
    }
  },

  async unlinkFromTask(noteId: string, taskId: string): Promise<Note | null> {
    const api = getNoteApi();
    if (!api) return null;
    try {
      const result = await api.unlinkFromTask({ noteId, taskId });
      const updated = unwrapOrToast(result, '取消关联失败');
      set({ notes: get().notes.map((n) => (n.id === noteId ? updated : n)) });
      return updated;
    } catch {
      return null;
    }
  },

  /**
   * 导出笔记为 `.md` 文件（T4-3）。
   *
   * 行为：
   *   - 调 `window.api.note.export({ ids, targetDir? })`
   *   - 成功 → toast 提示 + 返回 files 列表
   *   - 失败 → toast 错误 + 返回 null
   *
   * **安全**：导出文件**不**含敏感字段（API Key / provider / inbox / task）——
   * 由主进程 handler 强制保证（详见 `electron/main/ipc/note.ts` 的 `renderNoteToMarkdown`）。
   */
  async export(
    ids: string[],
    targetDir?: string,
  ): Promise<Array<{ id: string; path: string }> | null> {
    const api = getNoteApi();
    if (!api) return null;
    if (ids.length === 0) {
      toast.error('请先选择要导出的笔记');
      return null;
    }
    try {
      const input: { ids: string[]; targetDir?: string } = { ids };
      if (targetDir !== undefined) {
        input.targetDir = targetDir;
      }
      const result = await api.export(input);
      const data = unwrapOrToast(result, '导出失败');
      toast.success(`已导出 ${data.files.length} 条笔记`);
      return data.files;
    } catch {
      return null;
    }
  },
}));
