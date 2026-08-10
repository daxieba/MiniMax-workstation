/**
 * 总览页快速输入框（T2-4）
 *
 * 总览页顶部用的轻量版 InboxComposer：
 *   - textarea + kind 选择 + 提交按钮
 *   - **不**做项目选择（T2-3 在 Inbox 页已经做了；总览页快速输入不绑项目）
 *   - 提交后由父组件调 `inboxStore.add`
 *
 * 与 `InboxComposer` 的关系：
 *   - 复用其"输入 + kind 选择"逻辑（这里是简化版）
 *   - InboxComposer 含项目下拉，会触发 projectStore.load；总览页只做核心输入，避免副作用扩散
 *
 * **不做**：
 *   - 不解析 URL（留给 T3-x AI 工作区或 T4-x 知识库）
 *   - 不做文件拖拽（第一版不做；PLAN §明确不做）
 *   - 不绑项目（说明见上）
 *
 * @used-by src/pages/Overview
 */

import { useEffect, useRef, useState } from 'react';

import type { InboxKind } from '@shared/types/inbox';

const KIND_OPTIONS: ReadonlyArray<{ value: InboxKind; label: string }> = [
  { value: 'note', label: '想法' },
  { value: 'todo', label: '待办' },
  { value: 'file', label: '文件' },
  { value: 'link', label: '链接' },
];

export interface QuickInputProps {
  /**
   * 提交时回调。父组件负责调 `inboxStore.add` 并显示 toast。
   * 父组件可以异步返回（提交中由 `submitting` 控制按钮态）。
   */
  onSubmit: (input: { content: string; kind: InboxKind }) => void | Promise<unknown>;
  /** 提交进行中（按钮 disable / 显示 loading）。 */
  submitting?: boolean;
}

/**
 * 总览页快速输入框。
 */
export function QuickInput({ onSubmit, submitting = false }: QuickInputProps): React.ReactElement {
  const [content, setContent] = useState('');
  const [kind, setKind] = useState<InboxKind>('note');
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // 首次挂载聚焦
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const trimmed = content.trim();
  const canSubmit = trimmed.length > 0 && !submitting;

  const handleSubmit = (): void => {
    if (!canSubmit) return;
    void onSubmit({ content: trimmed, kind });
    setContent('');
    // 保留 kind，方便连续录入同类型
  };

  return (
    <form
      data-testid="overview-quick-input"
      className="rounded-lg border border-line bg-elevated p-4 shadow-card"
      onSubmit={(e) => {
        e.preventDefault();
        handleSubmit();
      }}
    >
      <div className="flex flex-col gap-2">
        <label htmlFor="overview-quick-input-content" className="text-xs text-secondary">
          快速记录
        </label>
        <textarea
          ref={textareaRef}
          id="overview-quick-input-content"
          data-testid="overview-quick-input-content"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="一句话想法 / 待办 / 文件路径 / 链接"
          rows={2}
          className="w-full resize-y rounded-md border border-line bg-base px-3 py-2 text-sm text-primary outline-none focus:border-accent"
          disabled={submitting}
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="条目类型">
            {KIND_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                role="radio"
                aria-checked={kind === opt.value}
                data-testid={`overview-quick-input-kind-${opt.value}`}
                onClick={() => setKind(opt.value)}
                className={[
                  'rounded-md border px-3 py-1 text-xs transition-colors',
                  kind === opt.value
                    ? 'border-accent bg-accent-soft text-accent'
                    : 'border-line bg-base text-secondary hover:text-primary',
                ].join(' ')}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <button
            type="submit"
            data-testid="overview-quick-input-submit"
            disabled={!canSubmit}
            className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-inverse transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? '提交中…' : '添加'}
          </button>
        </div>
      </div>
    </form>
  );
}
