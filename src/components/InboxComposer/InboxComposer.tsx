/**
 * 收集箱输入组件（T2-2 + T2-3 补全项目选择 + v0.1.1 polish）
 *
 * 顶部快速输入框：textarea + 项目下拉（可选）+ kind 选择 + "添加" 按钮。
 *
 * **设计**：
 *   - kind 选择 4 个：note / todo / file / link
 *   - 提交后清空 + 重新聚焦
 *   - 提交时如果 textarea 为空，按钮 disable
 *   - 项目下拉：用 `useProjectStore` 拉项目列表（只显示未归档的）
 *   - 选中项目后，提交时把 `projectId` 一起带上 → inbox 条目就归属该项目
 *
 * **v0.1.1 polish**：暴露 `useImperativeHandle` `focus()` 方法让父组件从"空态 CTA"
 *   跳到输入框（"录入第一条"按钮 → 焦点跳到这里）。
 *
 * **不做**：
 *   - 不解析 URL（留给 T3-x AI 工作区或 T4-x 知识库）
 *   - 不做文件拖拽（v0.1.1 不做；留给 v0.1.2）
 *
 * **Props**：
 *   - `onSubmit`：必填，外部 store 收到后写 db 并显示 toast
 */

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';

import type { InboxKind } from '@shared/types/inbox';

import { useProjectStore } from '@/store/projectStore';

const KIND_OPTIONS: ReadonlyArray<{ value: InboxKind; label: string }> = [
  { value: 'note', label: '想法' },
  { value: 'todo', label: '待办' },
  { value: 'file', label: '文件' },
  { value: 'link', label: '链接' },
];

export interface InboxComposerHandle {
  /** 把焦点跳到 textarea。 */
  focus: () => void;
}

export interface InboxComposerProps {
  /** 提交时回调。父组件负责调 store.add。返回值忽略。 */
  onSubmit: (input: { content: string; kind: InboxKind; projectId: string | null }) => void | Promise<unknown>;
  /** 提交进行中（按钮 disable / 显示 loading）。 */
  submitting?: boolean;
}

/**
 * 收集箱顶部输入组件。
 */
export const InboxComposer = forwardRef<InboxComposerHandle, InboxComposerProps>(function InboxComposer(
  { onSubmit, submitting = false },
  ref,
): React.ReactElement {
  const [content, setContent] = useState('');
  const [kind, setKind] = useState<InboxKind>('note');
  const [projectId, setProjectId] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // 暴露 focus() 方法给父组件
  useImperativeHandle(ref, () => ({
    focus: (): void => {
      textareaRef.current?.focus();
    },
  }), []);

  // 项目列表（拉取一次；只显示未归档的）
  const projects = useProjectStore((s) => s.projects);
  const projectLoad = useProjectStore((s) => s.load);
  useEffect(() => {
    void projectLoad();
  }, [projectLoad]);

  const visibleProjects = projects.filter((p) => !p.archived);

  // 首次挂载聚焦
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // 提交后清空 + 重新聚焦
  useEffect(() => {
    if (!submitting) {
      // 提交完成后（或空闲时）保持聚焦，方便连续录入
      textareaRef.current?.focus();
    }
  }, [submitting]);

  const trimmed = content.trim();
  const canSubmit = trimmed.length > 0 && !submitting;

  const handleSubmit = (): void => {
    if (!canSubmit) return;
    void onSubmit({ content: trimmed, kind, projectId });
    setContent('');
    // 保留 kind 和 projectId，方便连续录入同类型
  };

  return (
    <form
      data-testid="inbox-composer"
      className="rounded-lg border border-line bg-elevated p-4 shadow-card"
      onSubmit={(e) => {
        e.preventDefault();
        handleSubmit();
      }}
    >
      <div className="flex flex-col gap-2">
        <label htmlFor="inbox-composer-content" className="text-xs text-secondary">
          快速记录
        </label>
        <textarea
          ref={textareaRef}
          id="inbox-composer-content"
          data-testid="inbox-composer-content"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder={'想到什么就写下来：\n• 一句话想法\n• 待办（标"待办"后可在「项目与任务」转任务）\n• 文件路径\n• 链接'}
          rows={3}
          className="w-full resize-y rounded-md border border-line bg-base px-3 py-2 text-sm text-primary outline-none focus:border-accent"
          disabled={submitting}
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2" role="radiogroup" aria-label="条目类型">
              {KIND_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  role="radio"
                  aria-checked={kind === opt.value}
                  data-testid={`inbox-composer-kind-${opt.value}`}
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
            <select
              data-testid="inbox-composer-project"
              value={projectId ?? ''}
              onChange={(e) => {
                const v = e.target.value;
                setProjectId(v.length === 0 ? null : v);
              }}
              className="rounded-md border border-line bg-base px-2 py-1 text-xs text-primary outline-none focus:border-accent"
              aria-label="归属项目"
            >
              <option value="">（无项目）</option>
              {visibleProjects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            data-testid="inbox-composer-submit"
            disabled={!canSubmit}
            className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-inverse transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? '提交中…' : '添加'}
          </button>
        </div>
      </div>
    </form>
  );
});
