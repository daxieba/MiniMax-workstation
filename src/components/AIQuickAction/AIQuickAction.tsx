/**
 * AI 单次 Action 容器（T3-3 + T3-4 结构化展示）
 *
 * 给 summarize / extract_tasks / rewrite / extract_inbox 等单次动作共用。
 * 内部：textarea + 按钮 + 流式 / 结构化结果展示。
 *
 * **不**做 note / kb / search（不在 T3-3 范围）。
 *
 * **T3-4 增强**：
 *   - 当 `result.schemaName` 有值时，**走结构化展示**而不是流式文本展示：
 *     - `inbox_items`   → 列表（每条 content + kind badge + "丢弃"）
 *     - `task_drafts`   → 列表（每条 title + priority badge + "丢弃"）
 *     - `note_summary`  → title + summary + tags + "丢弃"
 *   - 底部"全部接受" / "全部丢弃"按钮（身份卡 §6.4 强制确认）
 *
 * **流式结果**：通过 `result` prop 接收一个 `PendingResult`（来自 store），
 * 组件只负责展示 + 不读 store。
 *
 * 落库动作（`onAccept` / `onDismiss`）由父组件 / store 处理 —— 本组件**不**写 db。
 */

import { Check, Loader2, Play, Trash2, X } from 'lucide-react';

import type { PendingResult, QuickAction } from '@/store/aiStore';

const ACTION_LABEL: Record<QuickAction, string> = {
  summarize: '总结',
  extract_tasks: '提取任务',
  rewrite: '改写',
};

const ACTION_PLACEHOLDER: Record<QuickAction, string> = {
  summarize: '粘贴要总结的文本…',
  extract_tasks: '粘贴要提取任务的文本…',
  rewrite: '粘贴要改写的文本…',
};

const PRIORITY_BADGE: Record<'low' | 'medium' | 'high', string> = {
  low: 'border-line bg-base text-secondary',
  medium: 'border-warning bg-warning-soft/40 text-warning',
  high: 'border-danger bg-danger-soft/40 text-danger',
};

const PRIORITY_LABEL: Record<'low' | 'medium' | 'high', string> = {
  low: '低',
  medium: '中',
  high: '高',
};

const KIND_LABEL: Record<'note' | 'todo' | 'file' | 'link', string> = {
  note: '想法',
  todo: '待办',
  file: '文件',
  link: '链接',
};

export interface AIQuickActionProps {
  action: QuickAction;
  value: string;
  onChange: (value: string) => void;
  onRun: () => void;
  onCancel?: () => void;
  loading: boolean;
  disabled?: boolean;
  result?: PendingResult | undefined;
  /** T3-4：结构化结果"全部接受"回调（**不**写 db —— 由父组件 / 后续 IPC 负责落库）。 */
  onAcceptAll?: ((result: PendingResult) => void) | undefined;
  /** T3-4：结构化结果单条"丢弃"回调（按 pendingResultId 整条丢弃）。 */
  onDismissAll?: ((result: PendingResult) => void) | undefined;
}

/**
 * AI 单次 Action 容器。
 */
export function AIQuickAction({
  action,
  value,
  onChange,
  onRun,
  onCancel,
  loading,
  disabled,
  result,
  onAcceptAll,
  onDismissAll,
}: AIQuickActionProps): React.ReactElement {
  const label = ACTION_LABEL[action];
  const placeholder = ACTION_PLACEHOLDER[action];
  const canRun = !disabled && !loading && value.trim().length > 0;
  return (
    <div data-testid={`ai-quick-action-${action}`} className="flex h-full flex-col gap-3 p-3">
      {/* 输入区 */}
      <div className="flex flex-col gap-2">
        <label className="text-sm text-secondary" htmlFor={`qa-${action}-input`}>
          输入
        </label>
        <textarea
          id={`qa-${action}-input`}
          data-testid={`ai-quick-action-${action}-input`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={6}
          disabled={disabled}
          className="w-full resize-y rounded-md border border-line bg-elevated px-3 py-2 text-sm text-primary disabled:opacity-50"
        />
        <div className="flex items-center gap-2">
          {loading ? (
            <button
              type="button"
              data-testid={`ai-quick-action-${action}-cancel`}
              onClick={() => onCancel?.()}
              className="inline-flex items-center gap-1 rounded-md border border-line bg-base px-3 py-1.5 text-xs text-secondary transition-colors hover:text-danger"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
              取消
            </button>
          ) : (
            <button
              type="button"
              data-testid={`ai-quick-action-${action}-run`}
              onClick={() => onRun()}
              disabled={!canRun}
              className="inline-flex items-center gap-1 rounded-md border border-accent bg-accent-soft px-3 py-1.5 text-xs text-accent transition-colors hover:bg-accent hover:text-inverse disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <Play className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              运行 {label}
            </button>
          )}
        </div>
      </div>

      {/* 结果区（T3-4：根据 schemaName 走流式 / 结构化分支） */}
      <div className="flex min-h-0 flex-1 flex-col gap-2">
        <label className="text-sm text-secondary">结果</label>
        {result?.schemaName && result.structured ? (
          <StructuredResultView
            action={action}
            result={result}
            {...(onAcceptAll !== undefined ? { onAcceptAll } : {})}
            {...(onDismissAll !== undefined ? { onDismissAll } : {})}
          />
        ) : result ? (
          <StreamingResultView action={action} result={result} />
        ) : (
          <StreamingResultView action={action} result={undefined} />
        )}
        {result ? (
          <p className="text-xs text-secondary">
            该结果已进入下方&ldquo;待确认区&rdquo;，确认后可应用。
          </p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * 流式结果视图（`schemaName` 为空时）。
 */
function StreamingResultView({
  action,
  result,
}: {
  action: QuickAction;
  result: PendingResult | undefined;
}): React.ReactElement {
  return (
    <div
      data-testid={`ai-quick-action-${action}-result`}
      className="min-h-32 flex-1 overflow-auto whitespace-pre-wrap rounded-md border border-line bg-elevated p-3 text-sm text-primary"
    >
      {result?.content ? (
        <span>{result.content}</span>
      ) : result?.streaming ? (
        <span data-testid="ai-quick-action-streaming-placeholder" className="inline-flex items-center gap-1">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current [animation-delay:0.15s]" />
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current [animation-delay:0.3s]" />
        </span>
      ) : (
        <span className="text-secondary">结果将出现在这里。</span>
      )}
      {result?.streaming && result.content ? (
        <span
          data-testid="ai-quick-action-streaming-cursor"
          className="ml-0.5 inline-block h-3 w-1.5 animate-pulse bg-current align-middle"
        />
      ) : null}
    </div>
  );
}

/**
 * 结构化结果视图（T3-4）。
 *
 * 根据 `result.schemaName` 渲染：
 *   - `inbox_items`   → items 列表（每条 content + kind badge + 单条"丢弃"）
 *   - `task_drafts`   → tasks 列表（每条 title + priority badge + 单条"丢弃"）
 *   - `note_summary`  → title + summary + tags + 整条"丢弃"
 *
 * 底部"全部接受" / "全部丢弃"按钮（身份卡 §6.4 强制确认）。
 */
function StructuredResultView({
  action,
  result,
  onAcceptAll,
  onDismissAll,
}: {
  action: QuickAction;
  result: PendingResult;
  onAcceptAll?: ((result: PendingResult) => void) | undefined;
  onDismissAll?: ((result: PendingResult) => void) | undefined;
}): React.ReactElement {
  const { schemaName, structured } = result;
  if (!schemaName || !structured) {
    return <div className="text-secondary text-sm">（结果不完整）</div>;
  }

  if (schemaName === 'inbox_items' && 'items' in structured) {
    const items = structured.items;
    return (
      <div
        data-testid={`ai-quick-action-${action}-structured`}
        data-schema-name={schemaName}
        className="flex min-h-32 flex-1 flex-col gap-2 overflow-auto rounded-md border border-line bg-elevated p-3"
      >
        <ul className="flex flex-col gap-2">
          {items.map((item, idx) => (
            <li
              key={idx}
              data-testid={`ai-quick-action-${action}-item-${idx}`}
              className="flex items-start gap-2 rounded border border-line bg-base p-2"
            >
              <span
                data-testid={`ai-quick-action-${action}-item-kind-${idx}`}
                className="shrink-0 rounded-full border border-accent bg-accent-soft px-2 py-0.5 text-xs text-accent"
              >
                {KIND_LABEL[item.kind]}
              </span>
              <span
                data-testid={`ai-quick-action-${action}-item-content-${idx}`}
                className="flex-1 text-sm text-primary break-words"
              >
                {item.content}
              </span>
            </li>
          ))}
        </ul>
        <StructuredResultActions
          action={action}
          result={result}
          onAcceptAll={onAcceptAll}
          onDismissAll={onDismissAll}
        />
      </div>
    );
  }

  if (schemaName === 'task_drafts' && 'tasks' in structured) {
    const tasks = structured.tasks;
    return (
      <div
        data-testid={`ai-quick-action-${action}-structured`}
        data-schema-name={schemaName}
        className="flex min-h-32 flex-1 flex-col gap-2 overflow-auto rounded-md border border-line bg-elevated p-3"
      >
        <ul className="flex flex-col gap-2">
          {tasks.map((task, idx) => (
            <li
              key={idx}
              data-testid={`ai-quick-action-${action}-task-${idx}`}
              className="rounded border border-line bg-base p-2"
            >
              <div className="flex items-start gap-2">
                {task.priority ? (
                  <span
                    data-testid={`ai-quick-action-${action}-task-priority-${idx}`}
                    className={`shrink-0 rounded-full border px-2 py-0.5 text-xs ${PRIORITY_BADGE[task.priority]}`}
                  >
                    {PRIORITY_LABEL[task.priority]}
                  </span>
                ) : null}
                <span
                  data-testid={`ai-quick-action-${action}-task-title-${idx}`}
                  className="flex-1 text-sm font-medium text-primary break-words"
                >
                  {task.title}
                </span>
              </div>
              {task.description ? (
                <p
                  data-testid={`ai-quick-action-${action}-task-description-${idx}`}
                  className="mt-1 text-xs text-secondary break-words"
                >
                  {task.description}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
        <StructuredResultActions
          action={action}
          result={result}
          onAcceptAll={onAcceptAll}
          onDismissAll={onDismissAll}
        />
      </div>
    );
  }

  if (schemaName === 'note_summary' && 'summary' in structured && 'title' in structured) {
    return (
      <div
        data-testid={`ai-quick-action-${action}-structured`}
        data-schema-name={schemaName}
        className="flex min-h-32 flex-1 flex-col gap-2 overflow-auto rounded-md border border-line bg-elevated p-3"
      >
        <h3
          data-testid={`ai-quick-action-${action}-note-title`}
          className="text-sm font-semibold text-primary"
        >
          {structured.title}
        </h3>
        <p
          data-testid={`ai-quick-action-${action}-note-summary`}
          className="text-sm text-primary whitespace-pre-wrap break-words"
        >
          {structured.summary}
        </p>
        {structured.tags.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {structured.tags.map((tag, idx) => (
              <span
                key={idx}
                data-testid={`ai-quick-action-${action}-note-tag-${idx}`}
                className="rounded-full border border-line bg-base px-2 py-0.5 text-xs text-secondary"
              >
                #{tag}
              </span>
            ))}
          </div>
        ) : null}
        <StructuredResultActions
          action={action}
          result={result}
          onAcceptAll={onAcceptAll}
          onDismissAll={onDismissAll}
        />
      </div>
    );
  }

  return <div className="text-secondary text-sm">（无法展示该 schema）</div>;
}

/**
 * 结构化结果底部"全部接受 / 全部丢弃"按钮（T3-4 + 身份卡 §6.4 强制确认）。
 */
function StructuredResultActions({
  action,
  result,
  onAcceptAll,
  onDismissAll,
}: {
  action: QuickAction;
  result: PendingResult;
  onAcceptAll?: ((result: PendingResult) => void) | undefined;
  onDismissAll?: ((result: PendingResult) => void) | undefined;
}): React.ReactElement {
  return (
    <div
      data-testid={`ai-quick-action-${action}-structured-actions`}
      className="mt-2 flex items-center gap-2 border-t border-line pt-2"
    >
      <button
        type="button"
        data-testid={`ai-quick-action-${action}-accept-all`}
        onClick={() => onAcceptAll?.(result)}
        disabled={!onAcceptAll}
        className="inline-flex items-center gap-1 rounded-md border border-success bg-success-soft/40 px-3 py-1 text-xs text-success transition-colors hover:bg-success hover:text-inverse disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Check className="h-3 w-3" aria-hidden="true" />
        全部接受
      </button>
      <button
        type="button"
        data-testid={`ai-quick-action-${action}-dismiss-all`}
        onClick={() => onDismissAll?.(result)}
        disabled={!onDismissAll}
        className="inline-flex items-center gap-1 rounded-md border border-line bg-base px-3 py-1 text-xs text-secondary transition-colors hover:text-danger disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Trash2 className="h-3 w-3" aria-hidden="true" />
        全部丢弃
      </button>
    </div>
  );
}
