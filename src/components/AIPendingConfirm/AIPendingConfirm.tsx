/**
 * AI 待确认区单条（T3-3）
 *
 * 单条 PendingResult 渲染：action badge + content + "确认" / "丢弃" 按钮。
 *
 * 状态：
 *   - `pending`   → 显示"确认 / 丢弃"按钮
 *   - `confirmed` → 显示"已确认"绿色徽章（按钮 disabled）
 *   - `dismissed` → 显示"已丢弃"灰色徽章（按钮 disabled）
 *
 * **不**做"确认后落库" —— `onConfirm` 由父组件 / store 处理，**不**在 T3-3 写 db。
 * T2-3 已落地的 `task:create` / `inbox:convertToTask` 是 T3-3 之后的接入点。
 */

import { Check, Trash2 } from 'lucide-react';

import type { PendingResult, QuickAction } from '@/store/aiStore';

const ACTION_LABEL: Record<QuickAction, string> = {
  summarize: '总结',
  extract_tasks: '提取任务',
  rewrite: '改写',
};

const STATUS_LABEL: Record<PendingResult['status'], { text: string; className: string }> = {
  pending: { text: '待确认', className: 'border-warning text-warning bg-warning-soft/40' },
  confirmed: { text: '已确认', className: 'border-success text-success bg-success-soft/40' },
  dismissed: { text: '已丢弃', className: 'border-line text-secondary bg-base' },
};

const TIME_FORMATTER = new Intl.DateTimeFormat('zh-CN', {
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

function formatTime(ms: number): string {
  return TIME_FORMATTER.format(new Date(ms));
}

export interface AIPendingConfirmProps {
  item: PendingResult;
  onConfirm: (id: string) => void;
  onDismiss: (id: string) => void;
}

/**
 * AI 待确认区单条。
 */
export function AIPendingConfirm({
  item,
  onConfirm,
  onDismiss,
}: AIPendingConfirmProps): React.ReactElement {
  const status = STATUS_LABEL[item.status];
  const isPending = item.status === 'pending';
  return (
    <article
      data-testid={`ai-pending-${item.id}`}
      data-status={item.status}
      className="rounded-md border border-line bg-elevated p-3 shadow-card"
    >
      <header className="mb-2 flex flex-wrap items-center gap-2 text-xs text-secondary">
        <span
          className="rounded-full border border-accent bg-accent-soft px-2 py-0.5 text-accent"
          data-testid={`ai-pending-action-${item.id}`}
        >
          {ACTION_LABEL[item.action]}
        </span>
        <span>{formatTime(item.createdAt)}</span>
        <span
          data-testid={`ai-pending-status-${item.id}`}
          className={`rounded-full border px-2 py-0.5 ${status.className}`}
        >
          {status.text}
        </span>
        {item.streaming ? (
          <span
            data-testid={`ai-pending-streaming-${item.id}`}
            className="rounded-full border border-line bg-base px-2 py-0.5 text-primary"
          >
            接收中…
          </span>
        ) : null}
      </header>
      <pre
        data-testid={`ai-pending-content-${item.id}`}
        className="mb-2 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded border border-line bg-base p-2 font-sans text-sm text-primary"
      >
        {item.content || (item.streaming ? '（等待结果）' : '（空）')}
      </pre>
      {isPending ? (
        <div className="flex items-center gap-2">
          <button
            type="button"
            data-testid={`ai-pending-confirm-${item.id}`}
            onClick={() => onConfirm(item.id)}
            className="inline-flex items-center gap-1 rounded-md border border-success bg-success-soft/40 px-2 py-1 text-xs text-success transition-colors hover:bg-success hover:text-inverse"
          >
            <Check className="h-3 w-3" aria-hidden="true" />
            确认
          </button>
          <button
            type="button"
            data-testid={`ai-pending-dismiss-${item.id}`}
            onClick={() => onDismiss(item.id)}
            className="inline-flex items-center gap-1 rounded-md border border-line bg-base px-2 py-1 text-xs text-secondary transition-colors hover:text-danger"
          >
            <Trash2 className="h-3 w-3" aria-hidden="true" />
            丢弃
          </button>
        </div>
      ) : null}
    </article>
  );
}
