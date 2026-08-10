/**
 * 任务列（T2-3）
 *
 * 看板里的一列。显示列标题 + 当前列里的任务卡片列表。
 *
 * **不做**：
 *   - 不做拖拽（T2-3 不引入拖拽库；按列过滤由父组件 TaskBoard 决定）
 */

import type { Task } from '@shared/types/task';
import type { TaskStatus } from '@shared/types/taskStatus';

import { TaskCard } from '@/components/TaskCard/TaskCard';

export interface TaskColumnProps {
  status: TaskStatus;
  /** 列标题（中文），由父组件传入；状态机文字常量从 `STATUS_LABELS` 取 */
  title: string;
  tasks: Task[];
  /** 卡片操作回调（来自父组件，详见 TaskCard）。 */
  onEdit: (id: string) => void;
  onTransitionIntent: (id: string, to: Task['status']) => void;
  onArchive: (id: string) => void;
  onDelete: (id: string) => void;
}

/**
 * 单列容器：标题 + 卡片列表。
 */
export function TaskColumn({
  status,
  title,
  tasks,
  onEdit,
  onTransitionIntent,
  onArchive,
  onDelete,
}: TaskColumnProps): React.ReactElement {
  return (
    <section
      data-testid={`task-column-${status}`}
      aria-label={title}
      className="flex h-full min-w-[18rem] flex-1 flex-col gap-2 rounded-md border border-line bg-elevated/40 p-2"
    >
      <header className="flex items-center justify-between px-1">
        <h3 className="text-sm font-medium text-primary">{title}</h3>
        <span
          data-testid={`task-column-count-${status}`}
          className="rounded-full bg-base px-2 py-0.5 text-xs text-secondary"
        >
          {tasks.length}
        </span>
      </header>
      <div className="flex flex-1 flex-col gap-2 overflow-auto">
        {tasks.length === 0 ? (
          <p
            data-testid={`task-column-empty-${status}`}
            className="rounded border border-dashed border-line bg-base p-3 text-center text-xs text-secondary"
          >
            暂无
          </p>
        ) : (
          tasks.map((t) => (
            <TaskCard
              key={t.id}
              task={t}
              onEdit={onEdit}
              onTransitionIntent={onTransitionIntent}
              onArchive={onArchive}
              onDelete={onDelete}
            />
          ))
        )}
      </div>
    </section>
  );
}
