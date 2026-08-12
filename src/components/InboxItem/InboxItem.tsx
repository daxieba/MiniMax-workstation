/**
 * 收集箱单条组件（T2-2 + v0.1.2 i18n）
 *
 * 单条 inbox 渲染：content + kind badge + 时间 + 操作按钮。
 *
 * **v0.1.2 i18n**：kind label / 操作按钮 / 时间格式化 / 状态文本 从 useT() + 当前 lang 派生。
 *
 * **操作按钮**：
 *   - "归档"：调 store.archive
 *   - "转任务"：调父组件 onConvert（父组件负责确认 + 调 store.convertToTask）
 */

import { Archive, ArrowRightCircle, FileText, Link2, StickyNote, ListTodo } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { useT, type Lang } from '@/i18n';
import type { InboxItem as InboxItemData, InboxKind } from '@shared/types/inbox';

interface KindMeta {
  key: 'kindNote' | 'kindTodo' | 'kindFile' | 'kindLink';
  Icon: LucideIcon;
  color: string;
}

const KIND_META: Record<InboxKind, KindMeta> = {
  note: { key: 'kindNote', Icon: StickyNote, color: 'text-secondary' },
  todo: { key: 'kindTodo', Icon: ListTodo, color: 'text-accent' },
  file: { key: 'kindFile', Icon: FileText, color: 'text-secondary' },
  link: { key: 'kindLink', Icon: Link2, color: 'text-accent' },
};

export interface InboxItemProps {
  item: InboxItemData;
  /** 归档按钮点击。 */
  onArchive: (id: string) => void;
  /** 转任务按钮点击（父组件负责确认）。 */
  onConvert: (id: string) => void;
}

/**
 * 收集箱单条组件。
 */
export function InboxItem({ item, onArchive, onConvert }: InboxItemProps): React.ReactElement {
  const t = useT();
  const meta = KIND_META[item.kind];
  const Icon = meta.Icon;
  const isConverted = item.status === 'converted';
  const isArchived = item.status === 'archived';

  const kindLabels: Record<InboxKind, string> = {
    note: t.pages.inbox.kindNote,
    todo: t.pages.inbox.kindTodo,
    file: t.pages.inbox.kindFile,
    link: t.pages.inbox.kindLink,
  };

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
          <span className="text-xs">{kindLabels[item.kind]}</span>
        </div>
        <div className="min-w-0 flex-1">
          <p
            data-testid={`inbox-item-content-${item.id}`}
            className="break-words text-sm text-primary"
          >
            {item.content}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-secondary">
            <span>{formatTime(item.createdAt, currentLang(t))}</span>
            {isConverted && item.convertedTo ? (
              <span data-testid={`inbox-item-converted-${item.id}`} className="text-success">
                {t.pages.inbox.convertedTo(item.convertedTo)}
              </span>
            ) : null}
            {isArchived ? <span className="text-warning">{t.pages.inbox.archived}</span> : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            data-testid={`inbox-item-archive-${item.id}`}
            onClick={() => onArchive(item.id)}
            disabled={isArchived || isConverted}
            className="inline-flex items-center gap-1 rounded-md border border-line bg-base px-2 py-1 text-xs text-secondary transition-colors hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
            title={t.pages.inbox.titleArchive}
          >
            <Archive className="h-3.5 w-3.5" aria-hidden="true" />
            {t.pages.inbox.archiveAction}
          </button>
          <button
            type="button"
            data-testid={`inbox-item-convert-${item.id}`}
            onClick={() => onConvert(item.id)}
            disabled={isConverted}
            className="inline-flex items-center gap-1 rounded-md border border-accent bg-accent-soft px-2 py-1 text-xs text-accent transition-colors hover:bg-accent hover:text-inverse disabled:cursor-not-allowed disabled:opacity-50"
            title={t.pages.inbox.titleConvert}
          >
            <ArrowRightCircle className="h-3.5 w-3.5" aria-hidden="true" />
            {t.pages.inbox.convertAction}
          </button>
        </div>
      </div>
    </article>
  );
}

/** 拿当前 lang（避免 useT() 返回整个对象导致依赖捕获整个 t）。 */
function currentLang(t: ReturnType<typeof useT>): Lang {
  // t 是 zh-CN / en-US 中的一个。从 t.empty 的 'title' 区分（zh 含中文）
  return /\p{Script=Han}/u.test(t.empty.inboxActive.title) ? 'zh-CN' : 'en-US';
}

/**
 * 格式化时间戳（Unix ms）为人类可读短串。语言相关。
 */
function formatTime(ms: number, lang: Lang): string {
  return new Intl.DateTimeFormat(lang, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(ms));
}
