/**
 * 收集箱列表组件（T2-2 + v0.1.1 polish + v0.1.2 i18n）
 *
 * 渲染当前过滤下的 items，每个调 InboxItem 子组件。
 *
 * **确认**：
 *   - 转换前**必须**调 `window.confirm`（PROJECT_IDENTITY.md §6.4），
 *     用户取消则不调 onConvert。
 *
 * **空态**（v0.1.1）：用 EmptyState 通用组件，比纯文字更有引导。
 *
 * **v0.1.2 i18n**：empty 状态文案从 useT() 派生；确认弹窗从 actions 命名空间。
 */

import { Inbox } from 'lucide-react';
import { InboxItem } from '@/components/InboxItem/InboxItem';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { useT } from '@/i18n';
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
  /**
   * 点击"立即录入"时聚焦到 InboxComposer 输入框（v0.1.1 polish）。
   * 由父组件 InboxPage 注入 ref。
   */
  onFocusComposer?: () => void;
}

/**
 * 收集箱列表。
 */
export function InboxList({ items, onArchive, onConvert, filter, onFocusComposer }: InboxListProps): React.ReactElement {
  const t = useT();
  if (items.length === 0) {
    const copy =
      filter === 'active'
        ? t.empty.inboxActive
        : filter === 'archived'
          ? t.empty.inboxArchived
          : t.empty.inboxAll;
    // 永远显示 CTA —— onFocusComposer 缺失时给 noop（button 仍渲染，文案仍展示）
    const handleAction = (): void => {
      onFocusComposer?.();
    };
    return (
      <EmptyState
        icon={Inbox}
        title={copy.title}
        description={copy.description}
        actionLabel={copy.cta}
        onAction={handleAction}
      />
    );
  }

  const handleConvert = (id: string): void => {
    // 转换是不可逆操作（会写一条 task + 改 inbox 状态）→ 必须确认
    const item = items.find((it) => it.id === id);
    const summary = item ? truncate(item.content, 60) : '';
    const ok = window.confirm(t.actions.convertConfirm(summary));
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
