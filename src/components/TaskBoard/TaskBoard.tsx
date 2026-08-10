/**
 * 任务看板容器（T2-3）
 *
 * 把当前 `tasks` 按 `status` 分到 4 列：todo / doing / done / archived。
 *
 * **职责**：
 *   - 接收 `tasks` + 卡片操作回调
 *   - 渲染 4 列（按固定顺序）
 *   - **不**调 store / IPC
 *   - **不**做二次确认（卡片内 / 父页面做）
 *
 * **不做**：
 *   - 不做拖拽（T2-3 不引入拖拽库）
 *   - 不做列内排序（保持传入顺序）
 */

import { useMemo } from 'react';

import type { Task } from '@shared/types/task';
import { TASK_STATUSES, type TaskStatus } from '@shared/types/taskStatus';

import { TaskColumn } from '@/components/TaskColumn/TaskColumn';

export interface TaskBoardProps {
  tasks: Task[];
  onEdit: (id: string) => void;
  /** 状态流转意图（父页面做确认后调 store.transition）。 */
  onTransitionIntent: (id: string, to: Task['status']) => void;
  onArchive: (id: string) => void;
  onDelete: (id: string) => void;
}

const COLUMN_TITLES: Record<TaskStatus, string> = {
  todo: '待处理',
  doing: '进行中',
  done: '已完成',
  archived: '已归档',
};

/**
 * 4 列看板。
 */
export function TaskBoard({
  tasks,
  onEdit,
  onTransitionIntent,
  onArchive,
  onDelete,
}: TaskBoardProps): React.ReactElement {
  // 按 status 分组（一次 memo，渲染稳定）
  const grouped = useMemo(() => {
    const out: Record<TaskStatus, Task[]> = {
      todo: [],
      doing: [],
      done: [],
      archived: [],
    };
    for (const t of tasks) {
      out[t.status].push(t);
    }
    return out;
  }, [tasks]);

  return (
    <div
      data-testid="task-board"
      className="flex h-full min-h-0 gap-3 overflow-x-auto"
    >
      {TASK_STATUSES.map((status) => {
        const list = grouped[status] ?? [];
        return (
          <TaskColumn
            key={status}
            status={status}
            title={COLUMN_TITLES[status]}
            tasks={list}
            onEdit={onEdit}
            onTransitionIntent={onTransitionIntent}
            onArchive={onArchive}
            onDelete={onDelete}
          />
        );
      })}
    </div>
  );
}
