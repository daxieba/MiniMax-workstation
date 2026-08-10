/**
 * 搜索栏组件（T4-2 知识沉淀第二阶段）
 *
 * 提供 query 输入框 + scope 下拉 + "搜索" 按钮 + 清除按钮。
 *
 * **设计**：
 *   - 输入框按 Enter → 立即触发搜索
 *   - scope 切换 → 立即触发搜索（用当前 query）
 *   - query 变化 → **不**自动搜索（避免每键击都打 IPC；UI 层可选 debounce）
 *   - "清除"按钮：清空 query + results
 *
 * **状态来源**：
 *   - query / scope / loading 全部从 `useSearchStore` 取
 *   - setQuery / setScope / search / clear 全部从 store 调
 *
 * **不做**：
 *   - 不做 debounce（保持简单；如需要可以包一层 useEffect）
 *   - 不做搜索历史 / 联想词（留给后续卡）
 *
 * **样式**：
 *   - 用 Tailwind，跟项目其他组件对齐
 *   - 用 lucide-react 的 Search / X 图标
 */

import { Search, X } from 'lucide-react';

import type { SearchScope } from '@shared/types/search';

import { useSearchStore } from '@/store/searchStore';

const SCOPE_OPTIONS: ReadonlyArray<{ value: SearchScope; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'notes', label: '笔记' },
  { value: 'tasks', label: '任务' },
  { value: 'inbox', label: '收集箱' },
];

export interface SearchBarProps {
  /** 测试 ID 前缀（默认 'search-bar'）。 */
  testIdPrefix?: string;
}

/**
 * 搜索栏：query 输入 + scope 下拉 + 触发 / 清除按钮。
 */
export function SearchBar({ testIdPrefix = 'search-bar' }: SearchBarProps): React.ReactElement {
  const query = useSearchStore((s) => s.query);
  const scope = useSearchStore((s) => s.scope);
  const loading = useSearchStore((s) => s.loading);
  const setQuery = useSearchStore((s) => s.setQuery);
  const setScope = useSearchStore((s) => s.setScope);
  const search = useSearchStore((s) => s.search);
  const clear = useSearchStore((s) => s.clear);

  const hasQuery = query.trim().length > 0;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void search();
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      clear();
    }
  };

  const handleScopeChange = (next: SearchScope): void => {
    setScope(next);
    // scope 变化立即重搜（用当前 query）
    void useSearchStore.getState().search();
  };

  return (
    <div
      data-testid={testIdPrefix}
      className="flex w-full flex-wrap items-center gap-2 rounded-md border border-line bg-elevated p-2"
    >
      {/* 输入框 */}
      <div className="relative min-w-[200px] flex-1">
        <Search
          className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-secondary"
          aria-hidden="true"
        />
        <input
          type="text"
          data-testid={`${testIdPrefix}-input`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="搜索笔记、任务、收集箱…"
          aria-label="搜索"
          className="w-full rounded-md border border-line bg-base py-1.5 pl-8 pr-2 text-sm text-primary outline-none focus:border-accent"
        />
      </div>

      {/* scope 下拉 */}
      <div
        role="tablist"
        aria-label="搜索范围"
        className="inline-flex rounded-md border border-line bg-base p-0.5 text-xs"
      >
        {SCOPE_OPTIONS.map((opt) => {
          const active = scope === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              role="tab"
              aria-selected={active}
              data-testid={`${testIdPrefix}-scope-${opt.value}`}
              onClick={() => handleScopeChange(opt.value)}
              className={[
                'rounded px-2 py-1 transition-colors',
                active ? 'bg-accent text-inverse' : 'text-secondary hover:text-primary',
              ].join(' ')}
            >
              {opt.label}
            </button>
          );
        })}
      </div>

      {/* 搜索按钮 */}
      <button
        type="button"
        data-testid={`${testIdPrefix}-submit`}
        onClick={() => void search()}
        disabled={!hasQuery || loading}
        className="inline-flex items-center gap-1 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-inverse transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading ? '搜索中…' : '搜索'}
      </button>

      {/* 清除按钮 */}
      <button
        type="button"
        data-testid={`${testIdPrefix}-clear`}
        onClick={clear}
        disabled={!hasQuery && useSearchStore.getState().results.length === 0}
        aria-label="清除搜索"
        className="inline-flex items-center justify-center rounded-md border border-line bg-base p-1.5 text-secondary transition-colors hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
      >
        <X className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}
