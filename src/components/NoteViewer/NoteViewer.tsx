/**
 * 笔记只读视图组件（T4-1）
 *
 * 渲染一条 note：标题 + 标签 + 项目 + 关联任务 + markdown 正文（react-markdown + remark-gfm）。
 *
 * **安全**：
 *   - `react-markdown` 默认不解析 HTML（不会执行 `<script>` 等）—— 比手写 markdown 解析器更安全
 *   - 不引入 `rehype-raw` / `dangerouslySetInnerHTML` —— 不开 raw HTML 通道
 *
 * **Props**：
 *   - `note`                单条 note
 *   - `projectName`         note.projectId 对应的项目名
 *   - `linkedTasks`         [{ id, title }] 关联任务（父组件从 taskStore 计算 + 过滤）
 *
 * **不做**：
 *   - 不做编辑（编辑走 NoteEditor）
 *   - 不做复制 / 导出
 */

import { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { FileText, FolderOpen, Link2, Tag as TagIcon } from 'lucide-react';

import type { Note } from '@shared/types/note';

const TIME_FORMATTER = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

function formatTime(ms: number): string {
  return TIME_FORMATTER.format(new Date(ms));
}

export interface LinkedTaskRef {
  id: string;
  title: string;
}

export interface NoteViewerProps {
  note: Note;
  projectName: string | null;
  linkedTasks: LinkedTaskRef[];
}

export function NoteViewer({ note, projectName, linkedTasks }: NoteViewerProps): React.ReactElement {
  // 标记关联任务里"找不到"的（taskStore 缺失但 linkedTaskIds 里有）
  const linkedIds = useMemo(() => new Set(linkedTasks.map((t) => t.id)), [linkedTasks]);
  const missingIds = note.linkedTaskIds.filter((id) => !linkedIds.has(id));

  return (
    <article
      data-testid={`note-viewer-${note.id}`}
      className="flex h-full flex-col gap-4 overflow-auto rounded-lg border border-line bg-elevated p-5 shadow-card"
    >
      <header className="space-y-2 border-b border-line pb-3">
        <div className="flex items-start gap-2">
          <FileText className="mt-1 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
          <h1
            data-testid={`note-viewer-title-${note.id}`}
            className="flex-1 text-2xl font-semibold text-primary"
          >
            {note.title}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-secondary">
          {note.tags.length > 0 ? (
            <span
              className="inline-flex flex-wrap items-center gap-1"
              data-testid={`note-viewer-tags-${note.id}`}
            >
              <TagIcon className="h-3 w-3" aria-hidden="true" />
              {note.tags.map((t) => (
                <span
                  key={t}
                  className="rounded-full border border-accent bg-accent-soft px-1.5 py-0.5 text-[10px] text-accent"
                >
                  {t}
                </span>
              ))}
            </span>
          ) : null}
          {projectName !== null ? (
            <span
              className="inline-flex items-center gap-1"
              data-testid={`note-viewer-project-${note.id}`}
            >
              <FolderOpen className="h-3 w-3" aria-hidden="true" />
              {projectName}
            </span>
          ) : null}
          {(linkedTasks.length > 0 || missingIds.length > 0) ? (
            <span
              className="inline-flex items-center gap-1"
              data-testid={`note-viewer-linked-${note.id}`}
            >
              <Link2 className="h-3 w-3" aria-hidden="true" />
              {linkedTasks.length > 0
                ? linkedTasks.map((t) => (
                    <span
                      key={t.id}
                      className="rounded-full border border-success bg-success-soft/40 px-1.5 py-0.5 text-[10px] text-success"
                    >
                      {t.title}
                    </span>
                  ))
                : null}
              {missingIds.length > 0 ? (
                <span className="rounded-full border border-line bg-base px-1.5 py-0.5 text-[10px] text-secondary">
                  + {missingIds.length} 个已删除
                </span>
              ) : null}
            </span>
          ) : null}
          <span data-testid={`note-viewer-updated-${note.id}`} className="ml-auto">
            更新于 {formatTime(note.updatedAt)}
          </span>
        </div>
        {note.archived ? (
          <span className="inline-block rounded-full border border-warning bg-warning-soft/40 px-2 py-0.5 text-xs text-warning">
            已归档
          </span>
        ) : null}
      </header>

      {/*
        React-Markdown 默认不解析 raw HTML（safe by default）
        remark-gfm 启用 GFM：表格 / 任务列表 / 删除线 / autolink
        Tailwind 通过 [data-md] 容器限定样式作用范围（避免全局污染）
      */}
      <div
        data-testid={`note-viewer-content-${note.id}`}
        data-md="content"
        className="prose prose-sm max-w-none text-primary prose-headings:text-primary prose-p:my-2 prose-li:my-0.5 prose-pre:bg-base prose-pre:border prose-pre:border-line prose-code:rounded prose-code:bg-base prose-code:px-1 prose-code:py-0.5 prose-code:text-accent prose-code:before:content-none prose-code:after:content-none prose-table:border-collapse prose-th:border prose-th:border-line prose-th:bg-base prose-th:px-2 prose-th:py-1 prose-td:border prose-td:border-line prose-td:px-2 prose-td:py-1 prose-a:text-accent prose-a:underline"
      >
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{note.content}</ReactMarkdown>
      </div>
    </article>
  );
}
