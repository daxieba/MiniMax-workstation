/**
 * 任务列表视图（v0.2.0 新增）
 *
 * 跟 `TaskBoard` 平行：用同一组 `tasks` + 操作回调，但渲染成"按 status 分组的单列列表"，
 * 一页能看完全部任务，不用横向滚动。
 *
 * 排序：每组内按 priority desc (high > medium > low) + dueDate asc 排。
 *
 * **不做**：
 *   - 不做跨组拖拽（看板模式才支持拖拽）
 *   - 不做列内排序（v0.2.x 不需要）
 *   - 不做虚拟滚动（数据量小；后续如真大量再做）
 */
import { useMemo } from 'react';
import { Archive, Calendar, Circle, CircleCheck, Flag, Pencil, Trash2 } from 'lucide-react';

import type { Task, TaskPriority } from '@shared/types/task';
import { TASK_STATUSES, type TaskStatus } from '@shared/types/taskStatus';

import { useI18nStore, useT } from '@/i18n';
import { TaskStatusActions } from '@/components/TaskStatusActions/TaskStatusActions';

const PRIORITY_BADGE: Record<TaskPriority, { label: string; cls: string }> = {
  high: { label: 'high', cls: 'border-danger/40 bg-danger-soft text-danger' },
  medium: { label: 'medium', cls: 'border-accent/40 bg-accent-soft text-accent' },
  low: { label: 'low', cls: 'border-line bg-elevated text-secondary' },
};

const STATUS_ICON: Record<TaskStatus, typeof Circle> = {
  todo: Circle,
  doing: Circle,
  done: CircleCheck,
  archived: Archive,
};

export interface TaskListViewProps {
  tasks: Task[];
  /** projectId → project name 查表（避免每个 task 嵌套查找）。 */
  projectNameById?: Map<string, string>;
  onEdit: (id: string) => void;
  /** 状态流转（父页面做确认后调 store.transition）。 */
  onTransitionIntent: (id: string, to: Task['status']) => void;
  onArchive: (id: string) => void;
  onDelete: (id: string) => void;
}

/** 按 priority desc + dueDate asc 排序（无 dueDate 排最后）。 */
function sortTasks(tasks: Task[]): Task[] {
  const priorityOrder: Record<TaskPriority, number> = { high: 0, medium: 1, low: 2 };
  return [...tasks].sort((a, b) => {
    const pa = priorityOrder[a.priority];
    const pb = priorityOrder[b.priority];
    if (pa !== pb) return pa - pb;
    const da = a.dueDate ?? Number.POSITIVE_INFINITY;
    const db = b.dueDate ?? Number.POSITIVE_INFINITY;
    if (da !== db) return da - db;
    // 都相同按 createdAt desc（新的在前）
    return b.createdAt - a.createdAt;
  });
}

/** 格式 dueDate (Unix ms) 为 "08-15 14:30" 或 "08-15"（已过期会标红样式由父级决定）。 */
function formatDueDate(ms: number, lang: 'zh-CN' | 'zh-TW' | 'en-US'): string {
  const d = new Date(ms);
  const fmt = new Intl.DateTimeFormat(lang, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return fmt.format(d);
}

export function TaskListView({
  tasks,
  projectNameById,
  onEdit,
  onTransitionIntent,
  onArchive,
  onDelete,
}: TaskListViewProps): React.ReactElement {
  const t = useT();
  const lang = useI18nStore((s) => s.lang);

  const grouped = useMemo(() => {
    const out: Record<TaskStatus, Task[]> = {
      todo: [],
      doing: [],
      done: [],
      archived: [],
    };
    for (const task of tasks) {
      out[task.status].push(task);
    }
    // 每组排序
    for (const s of TASK_STATUSES) {
      out[s] = sortTasks(out[s]);
    }
    return out;
  }, [tasks]);

  // 状态 label（用 t.pages.projects.*）
  const STATUS_LABELS: Record<TaskStatus, string> = {
    todo: t.pages.projects.statusTodo,
    doing: t.pages.projects.statusDoing,
    done: t.pages.projects.statusDone,
    archived: t.pages.projects.statusArchived,
  };

  // 整体空态
  if (tasks.length === 0) {
    return (
      <div
        data-testid="task-list-view-empty"
        className="flex h-full items-center justify-center rounded-md border border-dashed border-line bg-base p-6 text-sm text-secondary"
      >
        {t.pages.projects.title}
      </div>
    );
  }

  return (
    <div
      data-testid="task-list-view"
      className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto"
    >
      {TASK_STATUSES.map((status) => {
        const list = grouped[status] ?? [];
        if (list.length === 0) return null;
        const Icon = STATUS_ICON[status];
        return (
          <section
            key={status}
            data-testid={`task-list-group-${status}`}
            className="rounded-md border border-line bg-base"
          >
            <header className="flex items-center justify-between gap-2 border-b border-line bg-elevated/40 px-3 py-2">
              <h3 className="flex items-center gap-2 text-sm font-medium text-primary">
                <Icon className="h-3.5 w-3.5 text-secondary" aria-hidden="true" />
                {STATUS_LABELS[status]}
              </h3>
              <span
                data-testid={`task-list-group-count-${status}`}
                className="rounded-full bg-base px-2 py-0.5 text-xs text-secondary"
              >
                {list.length}
              </span>
            </header>
            <ul data-testid={`task-list-items-${status}`} className="divide-y divide-line">
              {list.map((task) => {
                const badge = PRIORITY_BADGE[task.priority];
                const projectName = task.projectId ? projectNameById?.get(task.projectId) : null;
                const dueLabel = task.dueDate !== null ? formatDueDate(task.dueDate, lang) : null;
                return (
                  <li
                    key={task.id}
                    data-testid={`task-list-item-${task.id}`}
                    className="group flex items-center gap-3 px-3 py-2 text-sm transition-colors hover:bg-elevated/40"
                  >
                    {/* 状态流转按钮：点开 TaskStatusActions 的 menu 触发 */}
                    <TaskStatusActions
                      currentStatus={task.status}
                      onTransition={(to) => onTransitionIntent(task.id, to)}
                    />

                    {/* 标题 */}
                    <button
                      type="button"
                      data-testid={`task-list-edit-${task.id}`}
                      onClick={() => onEdit(task.id)}
                      className="min-w-0 flex-1 truncate text-left text-primary hover:text-accent"
                    >
                      {task.title}
                    </button>

                    {/* 项目 */}
                    {projectName ? (
                      <span
                        data-testid={`task-list-project-${task.id}`}
                        className="hidden max-w-[140px] truncate rounded border border-line bg-elevated px-1.5 py-0.5 text-[10px] text-secondary md:inline-block"
                      >
                        {projectName}
                      </span>
                    ) : null}

                    {/* 优先级 */}
                    <span
                      data-testid={`task-list-priority-${task.id}`}
                      className={`rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${badge.cls}`}
                      title={`priority: ${task.priority}`}
                    >
                      <Flag className="mr-0.5 inline h-2.5 w-2.5" aria-hidden="true" />
                      {task.priority}
                    </span>

                    {/* dueDate */}
                    {dueLabel ? (
                      <span
                        data-testid={`task-list-due-${task.id}`}
                        className="hidden items-center gap-1 rounded border border-line bg-elevated px-1.5 py-0.5 text-[10px] text-secondary sm:inline-flex"
                      >
                        <Calendar className="h-2.5 w-2.5" aria-hidden="true" />
                        {dueLabel}
                      </span>
                    ) : null}

                    {/* 操作按钮（hover 显示） */}
                    <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                      <button
                        type="button"
                        data-testid={`task-list-edit-btn-${task.id}`}
                        onClick={() => onEdit(task.id)}
                        className="rounded p-1 text-secondary hover:text-primary"
                        title={t.common.edit}
                        aria-label={t.common.edit}
                      >
                        <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                      {task.status !== 'archived' ? (
                        <button
                          type="button"
                          data-testid={`task-list-archive-${task.id}`}
                          onClick={() => onArchive(task.id)}
                          className="rounded p-1 text-secondary hover:text-warning"
                          title={t.common.archive}
                          aria-label={t.common.archive}
                        >
                          <Archive className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      ) : null}
                      <button
                        type="button"
                        data-testid={`task-list-delete-${task.id}`}
                        onClick={() => onDelete(task.id)}
                        className="rounded p-1 text-secondary hover:text-danger"
                        title={t.common.delete}
                        aria-label={t.common.delete}
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
