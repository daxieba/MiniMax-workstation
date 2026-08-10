/**
 * 笔记 AI 摘要面板（T4-3 知识沉淀第三阶段）
 *
 * 放在 NoteEditor 底部 / NoteViewer 下方，让用户对当前笔记做一次 AI 摘要。
 *
 * **数据流**：
 *   UI → aiStore.runStructuredAction({ action: 'summarize', schemaName: 'note_summary' })
 *      → 主进程 extractJson → NoteSummarySchema 校验 → 回到 store → 写 pendingResults
 *   UI 找到当前 schemaName='note_summary' 的 pending → 渲染"可编辑预览"
 *   用户点"应用到笔记" → 调 noteStore.update 把 title / content / tags 写回
 *   用户点"丢弃" → aiStore.dismissPending
 *
 * **不做**（PROJECT_IDENTITY.md §11.3 越界检查）：
 *   - 不直接 import `db` / 任何 fs / http
 *   - 不写 aiStore 本身 —— 通过 props / store action 调
 *   - 不渲染 NoteEditor 全文（只展示 AI 摘要结果）
 *
 * **二次确认**（PROJECT_IDENTITY.md §6.4）：
 *   - "应用到笔记"会**覆盖**原 title / content / tags → **必须**二次确认
 *   - "丢弃"无破坏性，**不**需要确认
 *
 * **测试**（tests/NoteAIPanel.test.tsx）：
 *   - 触发 AI 摘要 → 调 runStructuredAction（mock aiStore）
 *   - 展示结果：title / summary / tags
 *   - "应用到笔记" → 调 noteStore.update
 *   - "丢弃" → 调 dismissPending
 *   - 没传 note → 不渲染 / 显示"请先选中笔记"
 */

import { useEffect, useRef, useState } from 'react';
import { Check, Loader2, RefreshCw, Sparkles, Trash2, X } from 'lucide-react';

import type { NoteSummary } from '@shared/types/ai';
import type { Note } from '@shared/types/note';

import type { PendingResult } from '@/store/aiStore';

export interface NoteAIPanelProps {
  /** 当前笔记（无 → 不渲染）。 */
  note: Note | null;
  /** 最近一次 note_summary 的 pending（来自 aiStore.pendingResults）。 */
  pending: PendingResult | null;
  /** store action：触发 AI 摘要。 */
  onSummarize: (noteContent: string) => void;
  /** store action：应用到笔记（input 含 title / content / tags）。 */
  onApply: (patch: { title: string; content: string; tags: string[] }) => void;
  /** store action：丢弃 pending。 */
  onDismiss: () => void;
  /** AI 摘要是否在跑（用于显示 loading / disable 按钮）。 */
  loading?: boolean;
  /** 已配 API Key（false → 提示去 AI 工作区配 key）。 */
  hasKey?: boolean;
}

const SUMMARY_MAX_TITLE = 256;
const SUMMARY_MAX_CONTENT = 8192;
const SUMMARY_MAX_TAGS = 64;

/**
 * 把 NoteSummary 渲染成"应用到笔记"的 payload：
 *   - title        → title
 *   - summary      → content（AI 摘要作为新正文）
 *   - tags         → tags
 */
export function buildApplyPatch(summary: NoteSummary): {
  title: string;
  content: string;
  tags: string[];
} {
  const title = summary.title.trim().slice(0, SUMMARY_MAX_TITLE) || '(无标题)';
  const content = summary.summary.slice(0, SUMMARY_MAX_CONTENT);
  const tags = summary.tags
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && t.length <= 64)
    .slice(0, SUMMARY_MAX_TAGS);
  return { title, content, tags };
}

/** 序列化 summary 用于 effect 依赖对比（避免每渲染都重置编辑态）。 */
function serializeSummary(summary: NoteSummary): string {
  return `${summary.title}\u0000${summary.summary}\u0000${summary.tags.join('\u0001')}`;
}

export function NoteAIPanel({
  note,
  pending,
  onSummarize,
  onApply,
  onDismiss,
  loading = false,
  hasKey = true,
}: NoteAIPanelProps): React.ReactElement {
  // 本地可编辑的"预览" —— 用户在"应用到笔记"前可改
  const [editTitle, setEditTitle] = useState<string>('');
  const [editSummary, setEditSummary] = useState<string>('');
  const [editTagsText, setEditTagsText] = useState<string>('');

  // pending 变化时同步本地编辑态（用 ref 记录上次 seen 的 summary，避免循环）
  const summary: NoteSummary | null =
    pending?.structured !== undefined && pending.schemaName === 'note_summary'
      ? (pending.structured as NoteSummary)
      : null;
  const lastSummaryKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!summary) {
      lastSummaryKeyRef.current = null;
      return;
    }
    const key = serializeSummary(summary);
    if (key === lastSummaryKeyRef.current) return;
    lastSummaryKeyRef.current = key;
    setEditTitle(summary.title);
    setEditSummary(summary.summary);
    setEditTagsText(summary.tags.join(', '));
  }, [summary]);

  // 应用前确认（PROJECT_IDENTITY.md §6.4）
  function handleApply(): void {
    if (!note || !summary) return;
    const finalSummary: NoteSummary = {
      title: editTitle.trim() || note.title,
      summary: editSummary.trim(),
      tags: editTagsText
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
    };
    const ok = window.confirm(
      `确认把 AI 摘要应用到笔记 "${note.title}" 吗？\n\n` +
        `这将覆盖：\n` +
        `  · 标题 → ${finalSummary.title}\n` +
        `  · 正文 → ${finalSummary.summary.slice(0, 60)}${finalSummary.summary.length > 60 ? '…' : ''}\n` +
        `  · 标签 → ${finalSummary.tags.length === 0 ? '(清空)' : finalSummary.tags.join(', ')}\n\n` +
        `（不可撤销，建议先备份。）`,
    );
    if (!ok) return;
    onApply(buildApplyPatch(finalSummary));
  }

  if (!note) {
    return (
      <div
        data-testid="note-ai-panel-empty"
        className="rounded-md border border-dashed border-line bg-elevated/40 p-3 text-xs text-secondary"
      >
        请先在左侧选择一条笔记，再使用 AI 摘要。
      </div>
    );
  }

  const canRun = !loading && hasKey;
  const canApply = summary !== null && !loading;

  return (
    <section
      data-testid="note-ai-panel"
      data-note-id={note.id}
      className="flex flex-col gap-2 rounded-md border border-line bg-elevated p-3"
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-1 text-sm font-medium text-primary">
          <Sparkles className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
          AI 摘要
        </h3>
        <div className="flex items-center gap-1">
          {summary ? (
            <button
              type="button"
              data-testid="note-ai-panel-dismiss"
              onClick={onDismiss}
              className="inline-flex items-center gap-1 rounded-md border border-line bg-base px-2 py-1 text-xs text-secondary transition-colors hover:text-danger"
            >
              <X className="h-3 w-3" aria-hidden="true" />
              丢弃
            </button>
          ) : null}
          <button
            type="button"
            data-testid="note-ai-panel-summarize"
            onClick={() => onSummarize(note.content)}
            disabled={!canRun}
            className="inline-flex items-center gap-1 rounded-md border border-accent bg-accent-soft px-2 py-1 text-xs text-accent transition-colors hover:bg-accent hover:text-inverse disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? (
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
            ) : (
              <RefreshCw className="h-3 w-3" aria-hidden="true" />
            )}
            {summary ? '重新摘要' : 'AI 摘要'}
          </button>
        </div>
      </header>

      {!hasKey ? (
        <p
          data-testid="note-ai-panel-no-key"
          className="rounded border border-warning bg-warning-soft/40 px-2 py-1 text-xs text-warning"
        >
          未配置 API Key。请到 AI 工作区设置。
        </p>
      ) : null}

      {summary ? (
        <div data-testid="note-ai-panel-result" className="flex flex-col gap-2">
          {/* title */}
          <div className="space-y-1">
            <label htmlFor="note-ai-panel-edit-title" className="block text-xs text-secondary">
              标题
            </label>
            <input
              id="note-ai-panel-edit-title"
              data-testid="note-ai-panel-edit-title"
              type="text"
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              maxLength={SUMMARY_MAX_TITLE}
              className="w-full rounded-md border border-line bg-base px-2 py-1 text-sm text-primary outline-none focus:border-accent"
            />
          </div>

          {/* summary */}
          <div className="space-y-1">
            <label htmlFor="note-ai-panel-edit-summary" className="block text-xs text-secondary">
              摘要（将作为正文写入）
            </label>
            <textarea
              id="note-ai-panel-edit-summary"
              data-testid="note-ai-panel-edit-summary"
              value={editSummary}
              onChange={(e) => setEditSummary(e.target.value)}
              maxLength={SUMMARY_MAX_CONTENT}
              rows={4}
              className="w-full resize-y rounded-md border border-line bg-base px-2 py-1 text-sm text-primary outline-none focus:border-accent"
            />
          </div>

          {/* tags (comma-separated input) */}
          <div className="space-y-1">
            <label htmlFor="note-ai-panel-edit-tags" className="block text-xs text-secondary">
              标签（逗号分隔）
            </label>
            <input
              id="note-ai-panel-edit-tags"
              data-testid="note-ai-panel-edit-tags"
              type="text"
              value={editTagsText}
              onChange={(e) => setEditTagsText(e.target.value)}
              placeholder="例：前端, react, 状态管理"
              className="w-full rounded-md border border-line bg-base px-2 py-1 text-sm text-primary outline-none focus:border-accent"
            />
          </div>

          <div className="flex items-center gap-2 border-t border-line pt-2">
            <button
              type="button"
              data-testid="note-ai-panel-apply"
              onClick={handleApply}
              disabled={!canApply}
              className="inline-flex items-center gap-1 rounded-md border border-success bg-success-soft/40 px-3 py-1 text-xs text-success transition-colors hover:bg-success hover:text-inverse disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Check className="h-3 w-3" aria-hidden="true" />
              应用到笔记
            </button>
            <button
              type="button"
              data-testid="note-ai-panel-dismiss-2"
              onClick={onDismiss}
              className="inline-flex items-center gap-1 rounded-md border border-line bg-base px-2 py-1 text-xs text-secondary transition-colors hover:text-danger"
            >
              <Trash2 className="h-3 w-3" aria-hidden="true" />
              丢弃
            </button>
          </div>
        </div>
      ) : loading ? (
        <p data-testid="note-ai-panel-loading" className="text-xs text-secondary">
          AI 正在生成摘要…
        </p>
      ) : (
        <p data-testid="note-ai-panel-hint" className="text-xs text-secondary">
          点击「AI 摘要」让 AI 把当前笔记总结为 标题 + 摘要 + 标签，可编辑后再应用到笔记。
        </p>
      )}
    </section>
  );
}
