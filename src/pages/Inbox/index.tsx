/**
 * 收集箱页（T2-2 完整实现）
 *
 * 结构：
 *   - 顶部：标题 + 计数 + 过滤切换（active / archived / all）
 *   - 中部：InboxComposer（输入组件）
 *   - 下部：InboxList（按当前 filter 过滤的列表）
 *
 * 数据源：`useInboxStore`（Zustand）。
 *   - 挂载时 load
 *   - 切换 filter → store 自动重 load
 *   - 添加 / 归档 / 转任务都走 store action
 */

import { useEffect } from 'react';

import { InboxComposer } from '@/components/InboxComposer/InboxComposer';
import { InboxList } from '@/components/InboxList/InboxList';
import { type InboxFilter, useInboxStore } from '@/store/inboxStore';

const FILTERS: ReadonlyArray<{ value: InboxFilter; label: string }> = [
  { value: 'active', label: '活跃' },
  { value: 'archived', label: '已归档' },
  { value: 'all', label: '全部' },
];

export default function InboxPage(): React.ReactElement {
  const items = useInboxStore((s) => s.items);
  const loading = useInboxStore((s) => s.loading);
  const error = useInboxStore((s) => s.error);
  const filter = useInboxStore((s) => s.filter);
  const load = useInboxStore((s) => s.load);
  const setFilter = useInboxStore((s) => s.setFilter);
  const add = useInboxStore((s) => s.add);
  const archive = useInboxStore((s) => s.archive);
  const convertToTask = useInboxStore((s) => s.convertToTask);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="flex h-full flex-col gap-4 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-primary">收集箱</h1>
          <p className="text-sm text-secondary">
            快速记录、归档、转为任务。共 {items.length} 条。
          </p>
        </div>
        <div role="tablist" aria-label="过滤" className="inline-flex rounded-md border border-line bg-elevated p-1">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              role="tab"
              aria-selected={filter === f.value}
              data-testid={`inbox-filter-${f.value}`}
              onClick={() => setFilter(f.value)}
              className={[
                'rounded px-3 py-1 text-xs transition-colors',
                filter === f.value
                  ? 'bg-accent text-inverse'
                  : 'text-secondary hover:text-primary',
              ].join(' ')}
            >
              {f.label}
            </button>
          ))}
        </div>
      </header>

      <InboxComposer
        onSubmit={(input) => {
          // 透传 projectId 到 store.add
          return add({ content: input.content, kind: input.kind, projectId: input.projectId });
        }}
        submitting={loading}
      />

      {error ? (
        <div
          role="alert"
          data-testid="inbox-error"
          className="rounded-md border border-danger bg-danger-soft/40 px-3 py-2 text-sm text-danger"
        >
          {error}
        </div>
      ) : null}

      <div className="flex-1 overflow-auto">
        <InboxList items={items} filter={filter} onArchive={archive} onConvert={(id) => {
          // 用 inbox content 作为 task title（截断到 80 字）。后续 T3-x AI 工作区可改更智能。
          const it = items.find((x) => x.id === id);
          const title = (it?.content ?? '').slice(0, 80);
          void convertToTask(id, { title });
        }} />
      </div>
    </section>
  );
}
