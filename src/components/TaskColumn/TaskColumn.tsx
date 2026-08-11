/**
 * 任务列（T2-3 + v0.1.1 拖拽支持）
 *
 * 看板里的一列。显示列标题 + 当前列里的任务卡片列表。
 *
 * **v0.1.1 polish**：本列作为拖拽 drop target，接收 task.id 直接改状态。
 *   - dragover：preventDefault + 高亮
 *   - drop：读 dataTransfer.getData('text/task-id') → 调 onDropTask(id, status)
 *   - 不引入第三方拖拽库（HTML5 native DnD 够用）
 *
 * **不做**：
 *   - 不做跨列排序（保持传入顺序）
 *   - 不做列内拖拽
 */

import { useState } from 'react';

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
  /**
   * v0.1.1：拖拽 drop 回调。
   * 父组件负责直接调 store.transition（不弹 confirm，因为拖拽 = 明确意图）。
   * 同列拖到自己 = 忽略（无意义）。
   */
  onDropTask?: ((id: string, to: TaskStatus) => void) | undefined;
}

/** dataTransfer key：约定任务 id 放在这个 key 下。 */
export const TASK_DRAG_MIME = 'text/x-task-id';

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
  onDropTask,
}: TaskColumnProps): React.ReactElement {
  const [isDragOver, setIsDragOver] = useState(false);

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>): void => {
    if (!onDropTask) return;
    // 只在拖的是 task 时才接受
    if (e.dataTransfer.types.includes(TASK_DRAG_MIME)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    }
  };

  const handleDragEnter = (e: React.DragEvent<HTMLDivElement>): void => {
    if (!onDropTask) return;
    if (e.dataTransfer.types.includes(TASK_DRAG_MIME)) {
      e.preventDefault();
      setIsDragOver(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>): void => {
    // 只在离开整个容器时取消（避免子元素闪烁）
    if (e.currentTarget === e.target) {
      setIsDragOver(false);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>): void => {
    if (!onDropTask) return;
    e.preventDefault();
    setIsDragOver(false);
    const id = e.dataTransfer.getData(TASK_DRAG_MIME);
    if (!id) return;
    onDropTask(id, status);
  };

  return (
    <section
      data-testid={`task-column-${status}`}
      aria-label={title}
      className={[
        'flex h-full min-w-[18rem] flex-1 flex-col gap-2 rounded-md border bg-elevated/40 p-2 transition-colors',
        isDragOver ? 'border-accent bg-accent-soft/30' : 'border-line',
      ].join(' ')}
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
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
            {isDragOver ? '松开放到这里' : '暂无'}
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
