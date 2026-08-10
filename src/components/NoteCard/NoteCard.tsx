/**
 * 笔记单条卡片组件（T4-1）
 *
 * 笔记列表中的一项：标题、标签（最多展示 3 个 + "…"）、项目、关联任务数、时间。
 *
 * **Props**：
 *   - `note`            单条 note
 *   - `projectName`     note.projectId 对应的项目名（父组件从 projectStore 传）；note.projectId=null 时为 null
 *   - `linkedTaskCount` 关联任务数（父组件从 taskStore 数出来）
 *   - `selected`        是否被选中
 *   - `onClick`         单击 → 选中
 *
 * **不做**：
 *   - 不在这里编辑 / 删除（父页面提供按钮）
 *   - 不在这里渲染 markdown 内容（列表只显示摘要 + 标题）
 */

import { FileText, FolderOpen, Link2, Tag as TagIcon } from 'lucide-react';

import type { Note } from '@shared/types/note';

const TIME_FORMATTER = new Intl.DateTimeFormat('zh-CN', {
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

function formatTime(ms: number): string {
  return TIME_FORMATTER.format(new Date(ms));
}

/** 取 markdown 文本的第一段非空文本做摘要。 */
function preview(content: string, max: number): string {
  const stripped = content
    .replace(/^#{1,6}\s+/gm, '') // 去标题前缀
    .replace(/[*_`>]/g, '') // 去常见 markdown 符号
    .replace(/\s+/g, ' ')
    .trim();
  if (stripped.length === 0) return '';
  if (stripped.length <= max) return stripped;
  return `${stripped.slice(0, max)}…`;
}

const MAX_VISIBLE_TAGS = 3;
const PREVIEW_MAX = 80;

export interface NoteCardProps {
  note: Note;
  projectName: string | null;
  linkedTaskCount: number;
  selected: boolean;
  onClick: () => void;
}

export function NoteCard({
  note,
  projectName,
  linkedTaskCount,
  selected,
  onClick,
}: NoteCardProps): React.ReactElement {
  const visibleTags = note.tags.slice(0, MAX_VISIBLE_TAGS);
  const hiddenTagCount = note.tags.length - visibleTags.length;
  const text = preview(note.content, PREVIEW_MAX);

  return (
    <button
      type="button"
      data-testid={`note-card-${note.id}`}
      onClick={onClick}
      className={[
        'flex w-full flex-col items-start gap-1.5 rounded-md border p-3 text-left text-sm transition-colors',
        selected
          ? 'border-accent bg-accent-soft text-accent'
          : 'border-line bg-elevated text-primary hover:border-accent/50',
      ].join(' ')}
    >
      <div className="flex w-full items-start gap-2">
        <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-secondary" aria-hidden="true" />
        <h3
          data-testid={`note-card-title-${note.id}`}
          className="line-clamp-1 flex-1 text-sm font-medium"
        >
          {note.title}
        </h3>
      </div>
      {text.length > 0 ? (
        <p
          data-testid={`note-card-preview-${note.id}`}
          className="line-clamp-2 w-full text-xs text-secondary"
        >
          {text}
        </p>
      ) : null}
      <div className="flex w-full flex-wrap items-center gap-x-2 gap-y-1 text-xs text-secondary">
        {note.tags.length > 0 ? (
          <span className="inline-flex items-center gap-1" data-testid={`note-card-tags-${note.id}`}>
            <TagIcon className="h-3 w-3" aria-hidden="true" />
            {visibleTags.map((t) => (
              <span
                key={t}
                className="rounded-full border border-line bg-base px-1.5 py-0.5 text-[10px] text-primary"
              >
                {t}
              </span>
            ))}
            {hiddenTagCount > 0 ? (
              <span className="text-[10px] text-secondary">+{hiddenTagCount}</span>
            ) : null}
          </span>
        ) : null}
        {projectName !== null ? (
          <span
            className="inline-flex items-center gap-1"
            data-testid={`note-card-project-${note.id}`}
          >
            <FolderOpen className="h-3 w-3" aria-hidden="true" />
            {projectName}
          </span>
        ) : null}
        {linkedTaskCount > 0 ? (
          <span
            className="inline-flex items-center gap-1"
            data-testid={`note-card-linked-${note.id}`}
          >
            <Link2 className="h-3 w-3" aria-hidden="true" />
            {linkedTaskCount}
          </span>
        ) : null}
        <span className="ml-auto" data-testid={`note-card-time-${note.id}`}>
          {formatTime(note.updatedAt)}
        </span>
      </div>
      {note.archived ? (
        <span
          data-testid={`note-card-archived-${note.id}`}
          className="rounded-full border border-warning bg-warning-soft/40 px-1.5 py-0.5 text-[10px] text-warning"
        >
          已归档
        </span>
      ) : null}
    </button>
  );
}
