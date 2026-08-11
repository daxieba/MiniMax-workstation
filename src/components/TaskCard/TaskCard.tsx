/**
 * 任务卡片（T2-3）
 *
 * 看板里单条任务的渲染。
 *
 * **组成**：
 *   - 标题
 *   - 优先级 badge（low / medium / high）
 *   - 截止日期（如有，含"今日 / 逾期"角标）
 *   - 状态流转按钮（调 TaskStatusActions；点击**不**做确认，由父组件 onTransitionHandler 做）
 *   - 归档 / 删除按钮
 *
 * **二次确认**（PROJECT_IDENTITY.md §6.4）：
 *   - 删除 / 归档：内联 `window.confirm`
 *   - 状态流转：父组件在 onTransitionHandler 中做（按钮点击只调 onTransitionIntent）
 *
 * **不做**：
 *   - 不内联编辑（编辑走 TaskForm，弹 dialog）
 *   - 不做拖拽
 */

import { Archive, Calendar, Edit3, Tag, Trash2 } from 'lucide-react';

import type { Task, TaskPriority } from '@shared/types/task';

import { TaskStatusActions } from '@/components/TaskStatusActions/TaskStatusActions';
import { TASK_DRAG_MIME } from '@/components/TaskColumn/TaskColumn';

export interface TaskCardProps {
  task: Task;
  /** 点击编辑按钮（打开 TaskForm）。 */
  onEdit: (id: string) => void;
  /** 状态流转意图（父组件负责确认 + 调 store.transition）。 */
  onTransitionIntent: (id: string, to: Task['status']) => void;
  /** 归档（父组件负责确认 + 调 store.archive）。 */
  onArchive: (id: string) => void;
  /** 删除（父组件负责确认 + 调 store.delete）。 */
  onDelete: (id: string) => void;
}

const PRIORITY_META: Record<
  TaskPriority,
  { label: string; className: string }
> = {
  low: { label: '低', className: 'bg-elevated text-secondary border-line' },
  medium: { label: '中', className: 'bg-accent-soft text-accent border-accent/40' },
  high: { label: '高', className: 'bg-danger-soft text-danger border-danger/40' },
};

const TIME_FORMATTER = new Intl.DateTimeFormat('zh-CN', {
  month: '2-digit',
  day: '2-digit',
});

/** 把 Unix ms 截到天（用于"今日 / 逾期"判断）。 */
function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** 计算截止日期展示文案。 */
function describeDueDate(dueDate: number): { text: string; className: string } {
  const now = startOfDay(Date.now());
  const due = startOfDay(dueDate);
  const diffDays = Math.round((due - now) / (24 * 60 * 60 * 1000));
  if (diffDays < 0) {
    return { text: `逾期 ${Math.abs(diffDays)} 天 · ${TIME_FORMATTER.format(new Date(dueDate))}`, className: 'text-danger' };
  }
  if (diffDays === 0) {
    return { text: `今日截止 · ${TIME_FORMATTER.format(new Date(dueDate))}`, className: 'text-warning' };
  }
  if (diffDays <= 3) {
    return { text: `${diffDays} 天后 · ${TIME_FORMATTER.format(new Date(dueDate))}`, className: 'text-warning' };
  }
  return { text: TIME_FORMATTER.format(new Date(dueDate)), className: 'text-secondary' };
}

const TRUNCATE_MAX = 60;
function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…`;
}

/**
 * 任务卡片。
 */
export function TaskCard({
  task,
  onEdit,
  onTransitionIntent,
  onArchive,
  onDelete,
}: TaskCardProps): React.ReactElement {
  const prio = PRIORITY_META[task.priority];
  const isArchived = task.status === 'archived';
  const isDone = task.status === 'done';
  const dueInfo = task.dueDate ? describeDueDate(task.dueDate) : null;

  const handleDelete = (): void => {
    const ok = window.confirm(`确认删除任务 "${truncate(task.title, TRUNCATE_MAX)}" 吗？\n\n（会从数据库硬删，无法恢复。）`);
    if (ok) onDelete(task.id);
  };

  const handleArchive = (): void => {
    if (isArchived) return;
    const ok = window.confirm(`确认归档任务 "${truncate(task.title, TRUNCATE_MAX)}" 吗？`);
    if (ok) onArchive(task.id);
  };

  return (
    <article
      data-testid={`task-card-${task.id}`}
      draggable={!isArchived}
      onDragStart={(e) => {
        // 把 task.id 放到 dataTransfer —— TaskColumn drop 时读
        e.dataTransfer.setData(TASK_DRAG_MIME, task.id);
        // text/plain fallback：让 drop 目标能用 getData('text/plain') 也能读到
        e.dataTransfer.setData('text/plain', task.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      className={[
        'rounded-md border bg-elevated p-3 shadow-card transition-shadow',
        !isArchived ? 'cursor-grab active:cursor-grabbing hover:shadow-elevated' : '',
        isArchived ? 'border-line opacity-70' : 'border-line',
        isDone ? 'border-success/30' : '',
      ].join(' ')}
    >
      <div className="flex items-start justify-between gap-2">
        <p
          data-testid={`task-card-title-${task.id}`}
          className="break-words text-sm font-medium text-primary"
        >
          {task.title}
        </p>
        <span
          data-testid={`task-card-priority-${task.id}`}
          className={`shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${prio.className}`}
        >
          {prio.label}
        </span>
      </div>

      {task.description ? (
        <p
          data-testid={`task-card-description-${task.id}`}
          className="mt-1 break-words text-xs text-secondary"
        >
          {task.description}
        </p>
      ) : null}

      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        {dueInfo ? (
          <span
            data-testid={`task-card-due-${task.id}`}
            className={`inline-flex items-center gap-1 ${dueInfo.className}`}
          >
            <Calendar className="h-3 w-3" aria-hidden="true" />
            {dueInfo.text}
          </span>
        ) : null}
        {task.tags.length > 0 ? (
          <span className="inline-flex items-center gap-1 text-secondary">
            <Tag className="h-3 w-3" aria-hidden="true" />
            {task.tags.length}
          </span>
        ) : null}
        {task.completedAt ? (
          <span className="inline-flex items-center gap-1 text-success">
            ✓ 已完成 {TIME_FORMATTER.format(new Date(task.completedAt))}
          </span>
        ) : null}
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <TaskStatusActions
          currentStatus={task.status}
          onTransition={(to) => onTransitionIntent(task.id, to)}
        />
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            data-testid={`task-card-edit-${task.id}`}
            onClick={() => onEdit(task.id)}
            className="inline-flex items-center gap-1 rounded-md border border-line bg-base px-2 py-1 text-xs text-secondary transition-colors hover:text-primary"
            title="编辑"
          >
            <Edit3 className="h-3.5 w-3.5" aria-hidden="true" />
            编辑
          </button>
          <button
            type="button"
            data-testid={`task-card-archive-${task.id}`}
            onClick={handleArchive}
            disabled={isArchived}
            className="inline-flex items-center gap-1 rounded-md border border-line bg-base px-2 py-1 text-xs text-secondary transition-colors hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
            title="归档"
          >
            <Archive className="h-3.5 w-3.5" aria-hidden="true" />
            归档
          </button>
          <button
            type="button"
            data-testid={`task-card-delete-${task.id}`}
            onClick={handleDelete}
            className="inline-flex items-center gap-1 rounded-md border border-line bg-base px-2 py-1 text-xs text-danger transition-colors hover:border-danger hover:bg-danger-soft/30"
            title="删除"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            删除
          </button>
        </div>
      </div>
    </article>
  );
}
