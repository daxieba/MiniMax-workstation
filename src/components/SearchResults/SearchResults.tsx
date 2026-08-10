/**
 * 搜索结果列表组件（T4-2 知识沉淀第二阶段）
 *
 * 接收 `SearchResult[]`，按 kind 分组渲染。每条：
 *   - 顶部：kind 徽章 + 标题
 *   - 中部：snippet（带 `<mark>` 高亮，**XSS 安全**）
 *   - 底部：相关度 score（百分比）
 *   - 点击：触发 onSelect(id, kind)，由父组件路由到详情
 *
 * **snippet 渲染策略（XSS 关键）**：
 *   - 主进程 FTS5 `snippet()` 输出的 `<mark>` 标签是已知 tag，原文不转义
 *   - 客户端渲染时**先 HTML escape 整个字符串**，再把 `&lt;mark&gt;` /
 *     `&lt;/mark&gt;` 还原为 `<mark>` / `</mark>` —— 这样原文里的
 *     `<script>` 会被转成 `&lt;script&gt;`，不会被浏览器当 HTML 解析
 *
 * **不做**：
 *   - 不分页（搜索是单页 limit=20 一次返回）
 *   - 不做点击后自动跳到详情（路由由 Knowledge 页 onSelect 决定）
 *   - 不做高亮颜色定制（用浏览器默认黄色 mark）
 *
 * **Props**：
 *   - `results`   搜索结果
 *   - `onSelect`  点击回调（id, kind）
 *   - `testIdPrefix`  测试 ID 前缀
 */

import { FileText, ListTodo, Inbox as InboxIcon } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import type { SearchResult } from '@shared/schemas/search';

import { useSearchStore } from '@/store/searchStore';

/** kind → 徽章颜色 + 图标。 */
const KIND_META: Record<
  SearchResult['kind'],
  { label: string; color: string; Icon: LucideIcon }
> = {
  note: { label: '笔记', color: 'bg-accent-soft text-accent', Icon: FileText },
  task: { label: '任务', color: 'bg-info-soft text-info', Icon: ListTodo },
  inbox: { label: '收集箱', color: 'bg-warning-soft text-warning', Icon: InboxIcon },
};

/**
 * 把字符串做 HTML escape，但保留 `<mark>` / `</mark>` 标签。
 *
 * 算法：
 *   1. 整个字符串先 escape：`<` → `&lt;`, `>` → `&gt;`, `&` → `&amp;`, `"` → `&quot;`, `'` → `&#39;`
 *   2. 再把已 escape 后的 `&lt;mark&gt;` 和 `&lt;/mark&gt;` 还原为 `<mark>` / `</mark>`
 *
 * 这样原文里的 `<script>` 会被 escape 掉，但 FTS5 wrap 的 `<mark>` 仍正常。
 */
function escapeSnippetPreservingMark(raw: string): string {
  const escaped = raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
  // 还原 mark 标签（escape 后的字面量）
  return escaped.replace(/&lt;\/?mark&gt;/g, (m) => {
    if (m === '&lt;mark&gt;') return '<mark>';
    return '</mark>';
  });
}

function formatScore(score: number): string {
  return `${Math.round(score * 100)}%`;
}

export interface SearchResultsProps {
  results: SearchResult[];
  onSelect: (id: string, kind: SearchResult['kind']) => void;
  testIdPrefix?: string;
}

/**
 * 搜索结果列表。
 */
export function SearchResults({
  results,
  onSelect,
  testIdPrefix = 'search-results',
}: SearchResultsProps): React.ReactElement {
  const error = useSearchStore((s) => s.error);

  if (error) {
    return (
      <div
        role="alert"
        data-testid={`${testIdPrefix}-error`}
        className="rounded-md border border-danger bg-danger-soft/40 px-3 py-2 text-sm text-danger"
      >
        搜索失败：{error}
      </div>
    );
  }

  if (results.length === 0) {
    return (
      <div
        data-testid={`${testIdPrefix}-empty`}
        className="rounded-md border border-dashed border-line bg-base p-6 text-center text-sm text-secondary"
      >
        没有匹配的结果。试试不同的关键词，或切换 scope。
      </div>
    );
  }

  return (
    <ul
      data-testid={testIdPrefix}
      className="flex flex-col gap-2"
      role="list"
    >
      {results.map((r) => {
        const meta = KIND_META[r.kind];
        const Icon = meta.Icon;
        return (
          <li
            key={`${r.kind}-${r.id}`}
            data-testid={`${testIdPrefix}-item-${r.kind}-${r.id}`}
            className="rounded-md border border-line bg-elevated p-3 transition-colors hover:border-accent"
          >
            <button
              type="button"
              onClick={() => onSelect(r.id, r.kind)}
              data-testid={`${testIdPrefix}-item-click-${r.kind}-${r.id}`}
              className="flex w-full flex-col items-start gap-2 text-left"
            >
              <div className="flex w-full items-center justify-between gap-2">
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <span
                    data-testid={`${testIdPrefix}-kind-${r.kind}-${r.id}`}
                    className={['inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium', meta.color].join(' ')}
                  >
                    <Icon className="h-3 w-3" aria-hidden={true} />
                    {meta.label}
                  </span>
                  <span
                    data-testid={`${testIdPrefix}-title-${r.kind}-${r.id}`}
                    className="truncate text-sm font-medium text-primary"
                  >
                    {r.title}
                  </span>
                </div>
                <span
                  data-testid={`${testIdPrefix}-score-${r.kind}-${r.id}`}
                  className="shrink-0 text-[10px] text-secondary"
                  title="相关度"
                >
                  {formatScore(r.score)}
                </span>
              </div>
              <p
                data-testid={`${testIdPrefix}-snippet-${r.kind}-${r.id}`}
                className="text-xs leading-relaxed text-secondary"
                // snippet 来自主进程 FTS5 snippet() 输出 + 已 trim 到 100 字符
                // XSS 安全：escapeSnippetPreservingMark 把原文 escape 后只还原 <mark>
                dangerouslySetInnerHTML={{ __html: escapeSnippetPreservingMark(r.snippet) }}
              />
              {/* 给子组件一个 CSS 钩子：高亮背景色 */}
              <style>{`
                [data-testid^="${testIdPrefix}-snippet-"] mark {
                  background-color: rgba(250, 204, 21, 0.35);
                  color: inherit;
                  padding: 0 2px;
                  border-radius: 2px;
                }
              `}</style>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
