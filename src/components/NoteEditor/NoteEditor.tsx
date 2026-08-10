/**
 * 笔记编辑器组件（T4-1）
 *
 * 编辑 / 新建一条笔记：title + tags + project + linked tasks + markdown textarea + 实时预览。
 *
 * **Props**：
 *   - `mode`             `'create' | 'edit'`
 *   - `draft`            当前编辑草稿
 *   - `onChange`         草稿变化回调（父组件用 useState 管）
 *   - `onSubmit`         保存 / 创建
 *   - `onCancel`         取消
 *   - `onDelete`         删除（仅 edit 模式有）
 *   - `onArchive`        归档（仅 edit 模式有）
 *   - `submitting`       提交中（disable 按钮）
 *   - `projects`         项目下拉候选
 *   - `error`            顶层错误信息（Zod 校验失败等）
 *
 * **不做**：
 *   - 不做自动保存草稿（关窗口会丢 —— 与 ProjectForm / TaskForm 一致）
 *   - 不做图片上传
 *
 * **预览**：
 *   - 同 NoteViewer 用 react-markdown + remark-gfm
 *   - 输入时实时刷新预览（用受控 draft，React 自动 re-render）
 */

import { useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Archive, Eye, Pencil, Save, Trash2, X } from 'lucide-react';

import { NoteTagInput } from '@/components/NoteTagInput/NoteTagInput';
import { NoteTaskPicker } from '@/components/NoteTaskPicker/NoteTaskPicker';
import type { Note } from '@shared/types/note';
import type { Project } from '@shared/types/project';

/** 编辑草稿（与 Note 的差异：没有 id / 时间戳 / source / archived）。 */
export interface NoteDraft {
  title: string;
  content: string;
  tags: string[];
  linkedTaskIds: string[];
  projectId: string | null;
}

export const EMPTY_NOTE_DRAFT: NoteDraft = {
  title: '',
  content: '',
  tags: [],
  linkedTaskIds: [],
  projectId: null,
};

/** 从 Note 派生 NoteDraft（编辑模式下填初值）。 */
export function noteToDraft(note: Note): NoteDraft {
  return {
    title: note.title,
    content: note.content,
    tags: [...note.tags],
    linkedTaskIds: [...note.linkedTaskIds],
    projectId: note.projectId,
  };
}

export interface NoteEditorSubmitPayload {
  /** 'create' 模式：传 create；'edit' 模式：传 update。 */
  create?: {
    title: string;
    content: string;
    tags: string[];
    linkedTaskIds: string[];
    projectId: string | null;
  };
  update?: {
    id: string;
    patch: {
      title?: string;
      content?: string;
      tags?: string[];
      linkedTaskIds?: string[];
      projectId?: string | null;
    };
  };
}

export interface NoteEditorProps {
  mode: 'create' | 'edit';
  draft: NoteDraft;
  onChange: (next: NoteDraft) => void;
  onSubmit: (payload: NoteEditorSubmitPayload) => void | Promise<unknown>;
  onCancel: () => void;
  /** 仅 edit 模式有。删除前 UI 层已确认。 */
  onDelete?: () => void;
  /** 仅 edit 模式有。 */
  onArchive?: () => void;
  submitting?: boolean;
  projects: Project[];
  /** 顶层错误（如 Zod 校验 / IPC 错误信息）。 */
  error?: string | null;
  /** 编辑模式下被编辑的 note id（用于 delete / archive 按钮的 testid）。 */
  editingNoteId?: string;
}

const MAX_TITLE = 512;

export function NoteEditor({
  mode,
  draft,
  onChange,
  onSubmit,
  onCancel,
  onDelete,
  onArchive,
  submitting = false,
  projects,
  error,
  editingNoteId,
}: NoteEditorProps): React.ReactElement {
  const [view, setView] = useState<'edit' | 'preview'>('edit');

  const canSubmit =
    draft.title.trim().length > 0 &&
    draft.title.length <= MAX_TITLE &&
    !submitting;

  const trimmedTitle = draft.title.trim();
  const visibleProjects = useMemo(() => projects.filter((p) => !p.archived), [projects]);

  function handleSubmit(): void {
    if (!canSubmit) return;
    const payload: NoteEditorSubmitPayload =
      mode === 'create'
        ? {
            create: {
              title: trimmedTitle,
              content: draft.content,
              tags: draft.tags,
              linkedTaskIds: draft.linkedTaskIds,
              projectId: draft.projectId,
            },
          }
        : {
            update: {
              id: editingNoteId ?? '',
              patch: {
                title: trimmedTitle,
                content: draft.content,
                tags: draft.tags,
                linkedTaskIds: draft.linkedTaskIds,
                projectId: draft.projectId,
              },
            },
          };
    void onSubmit(payload);
  }

  return (
    <section
      data-testid="note-editor"
      className="flex h-full flex-col gap-3 overflow-hidden rounded-lg border border-line bg-elevated p-4 shadow-card"
    >
      {/* title */}
      <div className="space-y-1">
        <label htmlFor="note-editor-title" className="block text-xs text-secondary">
          标题 *
        </label>
        <input
          id="note-editor-title"
          data-testid="note-editor-title"
          type="text"
          value={draft.title}
          onChange={(e) => onChange({ ...draft, title: e.target.value })}
          maxLength={MAX_TITLE}
          placeholder="给这条笔记起个名字…"
          className="w-full rounded-md border border-line bg-base px-3 py-1.5 text-base text-primary outline-none focus:border-accent"
        />
      </div>

      {/* tags / project / linked tasks */}
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1">
          <label className="block text-xs text-secondary">标签</label>
          <NoteTagInput
            value={draft.tags}
            onChange={(tags) => onChange({ ...draft, tags })}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="note-editor-project" className="block text-xs text-secondary">
            归属项目
          </label>
          <select
            id="note-editor-project"
            data-testid="note-editor-project"
            value={draft.projectId ?? ''}
            onChange={(e) => {
              const v = e.target.value;
              onChange({ ...draft, projectId: v.length === 0 ? null : v });
            }}
            className="w-full rounded-md border border-line bg-base px-2 py-1.5 text-sm text-primary outline-none focus:border-accent"
          >
            <option value="">（无项目）</option>
            {visibleProjects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="space-y-1">
        <label className="block text-xs text-secondary">关联任务</label>
        <NoteTaskPicker
          value={draft.linkedTaskIds}
          onChange={(linkedTaskIds) => onChange({ ...draft, linkedTaskIds })}
        />
      </div>

      {/* markdown body + preview */}
      <div className="flex min-h-0 flex-1 flex-col gap-1">
        <div className="flex items-center justify-between">
          <span className="text-xs text-secondary">正文（Markdown，支持 GFM 表格 / 任务列表 / 代码块）</span>
          <div
            role="tablist"
            aria-label="编辑/预览"
            className="inline-flex rounded-md border border-line bg-base p-0.5 text-xs"
          >
            <button
              type="button"
              role="tab"
              aria-selected={view === 'edit'}
              data-testid="note-editor-view-edit"
              onClick={() => setView('edit')}
              className={[
                'rounded px-2 py-1 transition-colors',
                view === 'edit' ? 'bg-accent text-inverse' : 'text-secondary hover:text-primary',
              ].join(' ')}
            >
              <Pencil className="mr-1 inline h-3 w-3" aria-hidden="true" />
              编辑
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === 'preview'}
              data-testid="note-editor-view-preview"
              onClick={() => setView('preview')}
              className={[
                'rounded px-2 py-1 transition-colors',
                view === 'preview' ? 'bg-accent text-inverse' : 'text-secondary hover:text-primary',
              ].join(' ')}
            >
              <Eye className="mr-1 inline h-3 w-3" aria-hidden="true" />
              预览
            </button>
          </div>
        </div>
        {view === 'edit' ? (
          <textarea
            data-testid="note-editor-content"
            value={draft.content}
            onChange={(e) => onChange({ ...draft, content: e.target.value })}
            placeholder={'# 标题\n\n写点什么…\n\n- 列点\n- **加粗** / *斜体*\n\n```ts\nconst a = 1;\n```'}
            className="min-h-[280px] flex-1 resize-y rounded-md border border-line bg-base px-3 py-2 font-mono text-sm text-primary outline-none focus:border-accent"
            spellCheck={false}
          />
        ) : (
          <div
            data-testid="note-editor-preview"
            data-md="preview"
            className="prose prose-sm min-h-[280px] max-w-none flex-1 overflow-auto rounded-md border border-line bg-base px-4 py-2 text-primary prose-headings:text-primary prose-p:my-2 prose-li:my-0.5 prose-pre:bg-elevated prose-pre:border prose-pre:border-line prose-code:rounded prose-code:bg-elevated prose-code:px-1 prose-code:py-0.5 prose-code:text-accent prose-code:before:content-none prose-code:after:content-none prose-table:border-collapse prose-th:border prose-th:border-line prose-th:bg-elevated prose-th:px-2 prose-th:py-1 prose-td:border prose-td:border-line prose-td:px-2 prose-td:py-1 prose-a:text-accent prose-a:underline"
          >
            {draft.content.trim().length === 0 ? (
              <p className="text-secondary">（还没有内容）</p>
            ) : (
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{draft.content}</ReactMarkdown>
            )}
          </div>
        )}
      </div>

      {error ? (
        <div
          role="alert"
          data-testid="note-editor-error"
          className="rounded-md border border-danger bg-danger-soft/40 px-3 py-2 text-sm text-danger"
        >
          {error}
        </div>
      ) : null}

      {/* actions */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
        <div className="flex items-center gap-2">
          {mode === 'edit' && onDelete ? (
            <button
              type="button"
              data-testid="note-editor-delete"
              onClick={onDelete}
              disabled={submitting}
              className="inline-flex items-center gap-1 rounded-md border border-danger bg-base px-3 py-1.5 text-xs text-danger transition-colors hover:bg-danger hover:text-inverse disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              删除
            </button>
          ) : null}
          {mode === 'edit' && onArchive ? (
            <button
              type="button"
              data-testid="note-editor-archive"
              onClick={onArchive}
              disabled={submitting}
              className="inline-flex items-center gap-1 rounded-md border border-line bg-base px-3 py-1.5 text-xs text-secondary transition-colors hover:text-warning disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Archive className="h-3.5 w-3.5" aria-hidden="true" />
              归档
            </button>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            data-testid="note-editor-cancel"
            onClick={onCancel}
            disabled={submitting}
            className="rounded-md border border-line bg-base px-3 py-1.5 text-sm text-secondary transition-colors hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
          >
            <X className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />
            取消
          </button>
          <button
            type="button"
            data-testid="note-editor-submit"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="inline-flex items-center gap-1 rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-inverse transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Save className="h-3.5 w-3.5" aria-hidden="true" />
            {submitting ? '保存中…' : mode === 'create' ? '创建' : '保存'}
          </button>
        </div>
      </div>
    </section>
  );
}
