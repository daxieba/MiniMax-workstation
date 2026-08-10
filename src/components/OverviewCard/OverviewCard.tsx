/**
 * 总览卡片容器（T2-4）
 *
 * 总览页里所有 4 个卡片（今日 / 逾期 / 最近收集 / 项目进度）共享同一外壳：
 *   - 标题 + 右上角小元素（如计数）
 *   - loading 骨架
 *   - 空态文案
 *   - 内容 children
 *
 * 父组件只关心数据；空态 / loading 统一在这里。
 *
 * **不做**：
 *   - 不做内嵌操作按钮（操作在子节点里）
 *   - 不做折叠 / 展开（总览页固定全显）
 *
 * @used-by src/pages/Overview
 */

import type { ReactNode } from 'react';

export interface OverviewCardProps {
  /** 卡片标题。 */
  title: string;
  /** 用于 `data-testid="overview-card-{testId}"` 的稳定后缀。 */
  testId: string;
  /** 加载中（覆盖 children 显示骨架）。 */
  loading?: boolean;
  /** 是否为空态（覆盖 children 显示 emptyText）。 */
  isEmpty: boolean;
  /** 空态文案。 */
  emptyText: string;
  /** 标题右侧附加元素（如计数 badge）。 */
  headerExtra?: ReactNode;
  /** 主体内容。 */
  children: ReactNode;
}

/**
 * 总览页卡片容器。
 */
export function OverviewCard({
  title,
  testId,
  loading = false,
  isEmpty,
  emptyText,
  headerExtra,
  children,
}: OverviewCardProps): React.ReactElement {
  return (
    <section
      data-testid={`overview-card-${testId}`}
      className="flex h-full flex-col rounded-lg border border-line bg-elevated p-4 shadow-card"
    >
      <header className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-primary">{title}</h2>
        {headerExtra}
      </header>
      <div className="min-h-0 flex-1">
        {loading ? (
          <p data-testid={`overview-card-${testId}-loading`} className="text-xs text-secondary">
            加载中…
          </p>
        ) : isEmpty ? (
          <p
            data-testid={`overview-card-${testId}-empty`}
            className="rounded-md border border-dashed border-line bg-base px-3 py-4 text-center text-xs text-secondary"
          >
            {emptyText}
          </p>
        ) : (
          children
        )}
      </div>
    </section>
  );
}
