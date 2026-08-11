/**
 * TaskColumn 组件测试（T2-3 + v0.1.1 拖拽）
 *
 * v0.1.1 polish 测试：
 *   - drop 接收 text/x-task-id → 调 onDropTask(id, status)
 *   - dragover 时显示 isDragOver 视觉态
 *   - 不传 onDropTask 时拖拽不生效（preventDefault 也不调）
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { TaskColumn, TASK_DRAG_MIME } from '@/components/TaskColumn/TaskColumn';
import type { Task } from '@shared/types/task';

// jsdom 不实现 DataTransfer —— 用最小 mock object（覆盖 setData / getData / types）
function makeDataTransfer(initial: Record<string, string> = {}): {
  data: Record<string, string>;
  types: string[];
  setData: (k: string, v: string) => void;
  getData: (k: string) => string;
} {
  const data: Record<string, string> = { ...initial };
  return {
    data,
    get types(): string[] {
      return Object.keys(data);
    },
    setData: (k: string, v: string): void => {
      data[k] = v;
    },
    getData: (k: string): string => {
      return data[k] ?? '';
    },
  };
}

function makeTask(id: string, status: Task['status']): Task {
  return {
    id,
    title: `task ${id}`,
    description: null,
    status,
    priority: 'medium',
    dueDate: null,
    projectId: null,
    tags: [],
    source: 'manual',
    inboxId: null,
    noteIds: [],
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
    completedAt: null,
  };
}

describe('TaskColumn (v0.1.1 拖拽)', () => {
  it('renders tasks with the column title', () => {
    const tasks = [makeTask('t1', 'todo'), makeTask('t2', 'todo')];
    render(
      <TaskColumn
        status="todo"
        title="待处理"
        tasks={tasks}
        onEdit={() => undefined}
        onTransitionIntent={() => undefined}
        onArchive={() => undefined}
        onDelete={() => undefined}
      />,
    );
    expect(screen.getByText('待处理')).toBeInTheDocument();
    expect(screen.getByTestId('task-card-t1')).toBeInTheDocument();
    expect(screen.getByTestId('task-card-t2')).toBeInTheDocument();
  });

  it('drop a task with text/x-task-id → calls onDropTask(id, status)', () => {
    const onDropTask = vi.fn();
    render(
      <TaskColumn
        status="doing"
        title="进行中"
        tasks={[]}
        onEdit={() => undefined}
        onTransitionIntent={() => undefined}
        onArchive={() => undefined}
        onDelete={() => undefined}
        onDropTask={onDropTask}
      />,
    );
    const column = screen.getByTestId('task-column-doing');
    const dt = makeDataTransfer({ [TASK_DRAG_MIME]: '01HXYZ' });
    fireEvent.drop(column, { dataTransfer: dt });
    expect(onDropTask).toHaveBeenCalledWith('01HXYZ', 'doing');
  });

  it('drop with non-task mime → does not call onDropTask', () => {
    const onDropTask = vi.fn();
    render(
      <TaskColumn
        status="done"
        title="已完成"
        tasks={[]}
        onEdit={() => undefined}
        onTransitionIntent={() => undefined}
        onArchive={() => undefined}
        onDelete={() => undefined}
        onDropTask={onDropTask}
      />,
    );
    const column = screen.getByTestId('task-column-done');
    const dt = makeDataTransfer({ 'text/plain': 'random text' });
    fireEvent.drop(column, { dataTransfer: dt });
    expect(onDropTask).not.toHaveBeenCalled();
  });

  it('without onDropTask prop → drop is no-op (no error)', () => {
    // 关键：没传 onDropTask 时不挂 drag listeners，避免旧 API 误触
    expect(() => {
      render(
        <TaskColumn
          status="todo"
          title="待处理"
          tasks={[]}
          onEdit={() => undefined}
          onTransitionIntent={() => undefined}
          onArchive={() => undefined}
          onDelete={() => undefined}
          // 注意：onDropTask 没传
        />,
      );
      const column = screen.getByTestId('task-column-todo');
      const dt = makeDataTransfer({ [TASK_DRAG_MIME]: '01HXYZ' });
      // 不应该 throw
      fireEvent.drop(column, { dataTransfer: dt });
    }).not.toThrow();
  });

  it('empty column shows "暂无" placeholder when no drag-over', () => {
    render(
      <TaskColumn
        status="archived"
        title="已归档"
        tasks={[]}
        onEdit={() => undefined}
        onTransitionIntent={() => undefined}
        onArchive={() => undefined}
        onDelete={() => undefined}
        onDropTask={vi.fn()}
      />,
    );
    expect(screen.getByTestId('task-column-empty-archived').textContent).toContain('暂无');
  });

  it('empty column shows "松开放到这里" when drag-over (with onDropTask)', () => {
    render(
      <TaskColumn
        status="todo"
        title="待处理"
        tasks={[]}
        onEdit={() => undefined}
        onTransitionIntent={() => undefined}
        onArchive={() => undefined}
        onDelete={() => undefined}
        onDropTask={vi.fn()}
      />,
    );
    const column = screen.getByTestId('task-column-todo');
    const dt = makeDataTransfer({ [TASK_DRAG_MIME]: '01HXYZ' });
    // dragEnter 触发 isDragOver
    fireEvent.dragEnter(column, { dataTransfer: dt });
    expect(screen.getByTestId('task-column-empty-todo').textContent).toContain('松开放到这里');
  });
});
