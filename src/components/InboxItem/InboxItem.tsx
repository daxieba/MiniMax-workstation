/**
 * 收集箱单条组件（T2-2）
 *
 * 单条 inbox 渲染：content + kind badge + 时间 + 操作按钮。
 *
 * **不做**：
 *   - 不内联编辑（编辑走 `inbox:update`，本卡 T2-2 不做 UI；归档/转换覆盖主要场景）
 *   - 不展示项目名（项目选择 UI 在 T2-3 才做）
 *
 * **操作按钮**：
 *   - "归档"：调 store.archive
 *   - "转任务"：调父组件 onConvert（父组件负责确认 + 调 store.convertToTask）
 */

import { Archive, ArrowRightCircle, FileText, Link2, StickyNote, ListTodo } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import type { InboxItem as InboxItemData, InboxKind } from '@shared/types/inbox';

const KIND_META: Record<InboxKind, { label: string; Icon: LucideIcon; color: string }> = {
  note: { label: '想法', Icon: StickyNote, color: 'text-secondary' },
  todo: { label: '待办', Icon: ListTodo, color: 'text-accent' },
  file: { label: '文件', Icon: FileText, color: 'text-secondary' },
  link: { label: '链接', Icon: Link2, color: 'text-accent' },
};

export interface InboxItemProps {
  item: InboxItemData;
  /** 归档按钮点击。 */
  onArchive: (id: string) => void;
  /** 转任务按钮点击（父组件负责确认）。 */
  onConvert: (id: string) => void;
}

const TIME_FORMATTER = new Intl.DateTimeFormat('zh-CN', {
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

/**
 * 格式化时间戳（Unix ms）为人类可读短串。
 */
function formatTime(ms: number): string {
  return TIME_FORMATTER.format(new Date(ms));
}

/**
 * 收集箱单条组件。
 */
export function InboxItem({ item, onArchive, onConvert }: InboxItemProps): React.ReactElement {
  const meta = KIND_META[item.kind];
  const Icon = meta.Icon;
  const isConverted = item.status === 'converted';
  const isArchived = item.status === 'archived';

  return (
    <article
      data-testid={`inbox-item-${item.id}`}
      className={[
        'rounded-md border bg-elevated p-3 shadow-card',
        isConverted ? 'border-success/40 opacity-80' : 'border-line',
      ].join(' ')}
    >
      <div className="flex items-start gap-3">
        <div className={`mt-0.5 flex shrink-0 items-center gap-1 ${meta.color}`}>
          <Icon className="h-4 w-4" aria-hidden="true" />
          <span className="text-xs">{meta.label}</span>
        </div>
        <div className="min-w-0 flex-1">
          <p
            data-testid={`inbox-item-content-${item.id}`}
            className="break-words text-sm text-primary"
          >
            {item.content}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-secondary">
            <span>{formatTime(item.createdAt)}</span>
            {isConverted && item.convertedTo ? (
              <span data-testid={`inbox-item-converted-${item.id}`} className="text-success">
                已转任务：{item.convertedTo}
              </span>
            ) : null}
            {isArchived ? <span className="text-warning">已归档</span> : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            data-testid={`inbox-item-archive-${item.id}`}
            onClick={() => onArchive(item.id)}
            disabled={isArchived || isConverted}
            className="inline-flex items-center gap-1 rounded-md border border-line bg-base px-2 py-1 text-xs text-secondary transition-colors hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
            title="归档"
          >
            <Archive className="h-3.5 w-3.5" aria-hidden="true" />
            归档
          </button>
          <button
            type="button"
            data-testid={`inbox-item-convert-${item.id}`}
            onClick={() => onConvert(item.id)}
            disabled={isConverted}
            className="inline-flex items-center gap-1 rounded-md border border-accent bg-accent-soft px-2 py-1 text-xs text-accent transition-colors hover:bg-accent hover:text-inverse disabled:cursor-not-allowed disabled:opacity-50"
            title="转任务"
          >
            <ArrowRightCircle className="h-3.5 w-3.5" aria-hidden="true" />
            转任务
          </button>
        </div>
      </div>
    </article>
  );
}
