/**
 * 收集箱列表组件（T2-2）
 *
 * 渲染当前过滤下的 items，每个调 InboxItem 子组件。
 *
 * **确认**：
 *   - 转换前**必须**调 `window.confirm`（PROJECT_IDENTITY.md §6.4），
 *     用户取消则不调 onConvert。
 *
 * **不做**：
 *   - 不做分页 / 无限滚动（第一版数据量小；如需后续卡加）
 *   - 不做多选 / 批量操作
 */

import { InboxItem } from '@/components/InboxItem/InboxItem';
import type { InboxItem as InboxItemData } from '@shared/types/inbox';

export interface InboxListProps {
  items: InboxItemData[];
  /** 归档按钮。 */
  onArchive: (id: string) => void;
  /**
   * 转任务按钮。父组件负责把 TaskDraft 准备好并调 store.convertToTask。
   * 列表组件在内部已加 `window.confirm` 二次确认。
   */
  onConvert: (id: string) => void;
  /** 当前过滤，用于空态文案。 */
  filter: 'active' | 'archived' | 'all';
}

const EMPTY_TEXT: Record<'active' | 'archived' | 'all', string> = {
  active: '没有待处理的收集项。在上方输入框录入第一条。',
  archived: '还没有归档的收集项。',
  all: '还没有任何收集项。在上方输入框录入第一条。',
};

/**
 * 收集箱列表。
 */
export function InboxList({ items, onArchive, onConvert, filter }: InboxListProps): React.ReactElement {
  if (items.length === 0) {
    return (
      <div
        data-testid="inbox-list-empty"
        className="rounded-md border border-dashed border-line bg-base p-6 text-center text-sm text-secondary"
      >
        {EMPTY_TEXT[filter]}
      </div>
    );
  }

  const handleConvert = (id: string): void => {
    // 转换是不可逆操作（会写一条 task + 改 inbox 状态）→ 必须确认
    const item = items.find((it) => it.id === id);
    const summary = item ? truncate(item.content, 60) : '这条收集项';
    const ok = window.confirm(`确认将 "${summary}" 转成任务吗？\n\n（会写入一条新任务，收集项标记为已转换。）`);
    if (ok) onConvert(id);
  };

  return (
    <div data-testid="inbox-list" className="flex flex-col gap-2">
      {items.map((it) => (
        <InboxItem key={it.id} item={it} onArchive={onArchive} onConvert={handleConvert} />
      ))}
    </div>
  );
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…`;
}
