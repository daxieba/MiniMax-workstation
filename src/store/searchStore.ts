/**
 * 全文搜索（Search）Zustand store（T4-2 渲染端）
 *
 * **职责**：
 *   - 缓存当前 query / scope / results
 *   - 暴露 setQuery / setScope / search / clear 4 个 action
 *   - 调 `window.api.search.query`，统一处理 `{ ok, data|error }` 响应
 *   - 成功 / 失败都用 `toast` 提示
 *
 * **数据流**：
 *   UI → store action → window.api.search → 主进程 handler → db FTS5 → 回到 store
 *
 * **不做**：
 *   - 不直接 import `db` / `better-sqlite3` / `drizzle`（PROJECT_IDENTITY.md §2.2）
 *   - 不做 debounce（UI 层用 SearchBar 组件内做，避免 store 复杂度）
 *   - 不做 AI 摘要 / 导出 —— T4-3
 *
 * **类型来源**：
 *   - `SearchResult` 来自 `@shared/schemas/search`
 *   - `SearchScope` 来自 `@shared/types/search`
 *
 * **状态**：
 *   - `query`     当前搜索词
 *   - `scope`     当前范围（默认 'all'）
 *   - `results`   最近一次搜索结果
 *   - `loading`   搜索中
 *   - `error`     最近一次错误信息
 *
 * @see electron/main/ipc/search.ts
 * @see shared/schemas/search.ts
 */

import { create } from 'zustand';

import type { SearchResult } from '@shared/schemas/search';
import type { SearchScope } from '@shared/types/search';

import { toast } from './toastStore';

/** `window.api` 形状（避免 renderer 直接依赖 electron 导入）。 */
interface ApiSearchShape {
  query(input: {
    query: string;
    scope?: SearchScope;
    limit?: number;
    offset?: number;
  }): Promise<
    | { ok: true; data: SearchResult[] }
    | { ok: false; error: { code: string; message: string } }
  >;
}

interface WindowWithApi {
  api?: {
    search?: ApiSearchShape;
  };
}

/** 安全取 window.api.search（避免 SSR / 测试环境 undefined）。 */
function getSearchApi(): ApiSearchShape | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as WindowWithApi;
  return w.api?.search ?? null;
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

/** store 形状。 */
export interface SearchState {
  /** 当前搜索词（用户在输入框看到的原文）。 */
  query: string;
  /** 当前范围。 */
  scope: SearchScope;
  /** 最近一次搜索结果。 */
  results: SearchResult[];
  /** 搜索中。 */
  loading: boolean;
  /** 最近一次错误信息。 */
  error: string | null;
  /** 设置搜索词（不自动 search，由 UI 决定何时触发）。 */
  setQuery: (query: string) => void;
  /** 设置 scope（不自动 search）。 */
  setScope: (scope: SearchScope) => void;
  /** 触发一次搜索（用当前 query + scope）。 */
  search: () => Promise<void>;
  /** 清空结果（query 保持不变）。 */
  clear: () => void;
}

export const useSearchStore = create<SearchState>((set, get) => ({
  query: '',
  scope: 'all',
  results: [],
  loading: false,
  error: null,

  setQuery(query: string): void {
    set({ query });
  },

  setScope(scope: SearchScope): void {
    set({ scope });
  },

  async search(): Promise<void> {
    const { query, scope } = get();
    const trimmed = query.trim();
    if (trimmed.length === 0) {
      // 空 query → 不调 IPC，直接清结果
      set({ results: [], error: null, loading: false });
      return;
    }
    const api = getSearchApi();
    if (!api) {
      // 渲染进程外（测试 / SSR）→ 跳过
      set({ results: [], loading: false, error: null });
      return;
    }
    set({ loading: true, error: null });
    try {
      const result = await api.query({ query: trimmed, scope, limit: 20 });
      const data = unwrapOrToast(result, '搜索失败');
      set({ results: data, loading: false, error: null });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      set({ loading: false, error: message, results: [] });
    }
  },

  clear(): void {
    set({ results: [], error: null, loading: false });
  },
}));
