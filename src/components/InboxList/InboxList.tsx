/**
 * 收集箱列表组件（T2-2 + v0.1.1 polish）
 *
 * 渲染当前过滤下的 items，每个调 InboxItem 子组件。
 *
 * **确认**：
 *   - 转换前**必须**调 `window.confirm`（PROJECT_IDENTITY.md §6.4），
 *     用户取消则不调 onConvert。
 *
 * **空态**（v0.1.1）：用 EmptyState 通用组件，比纯文字更有引导。
 *
 * **不做**：
 *   - 不做分页 / 无限滚动（第一版数据量小；如需后续卡加）
 *   - 不做多选 / 批量操作
 */

import { Inbox } from 'lucide-react';
import { InboxItem } from '@/components/InboxItem/InboxItem';
import { EmptyState } from '@/components/EmptyState/EmptyState';
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

const EMPTY_COPY: Record<'active' | 'archived' | 'all', { title: string; description: string; cta: string }> = {
  active: {
    title: '收件箱是空的',
    description: '随手把想法 / 任务 / 链接丢进来，AI 帮你识别结构化。也可以拖文件到窗口。',
    cta: '录入第一条',
  },
  archived: {
    title: '没有已归档的项',
    description: '归档的收集项会出现在这里，方便回查。',
    cta: '回到活跃项',
  },
  all: {
    title: '收件箱空空如也',
    description: '从录入第一条开始 —— 想到什么就记什么。',
    cta: '录入第一条',
  },
};

/**
 * 收集箱列表。
 */
export function InboxList({ items, onArchive, onConvert, filter, onFocusComposer }: InboxListProps): React.ReactElement {
  if (items.length === 0) {
    const copy = EMPTY_COPY[filter];
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
