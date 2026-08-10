/**
 * TaskBoard 组件测试（T2-3）
 *
 * 覆盖：
 *   - 4 列（todo / doing / done / archived）渲染
 *   - 每列计数正确
 *   - 任务按 status 分到对应列
 *   - 卡片操作回调转发（onEdit / onTransitionIntent / onArchive / onDelete）
 *   - 空态显示
 */

import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { TaskBoard } from '@/components/TaskBoard/TaskBoard';
import type { Task } from '@shared/types/task';

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: '01HXYZ_TASK_' + Math.random().toString(36).slice(2, 8),
    title: 'Task',
    description: null,
    status: 'todo',
    priority: 'medium',
    dueDate: null,
    projectId: null,
    tags: [],
    source: 'manual',
    inboxId: null,
    noteIds: [],
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    completedAt: null,
    ...overrides,
  };
}

const baseProps = {
  onEdit: vi.fn(),
  onTransitionIntent: vi.fn(),
  onArchive: vi.fn(),
  onDelete: vi.fn(),
};

describe('TaskBoard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders 4 columns (todo / doing / done / archived)', () => {
    render(<TaskBoard tasks={[]} {...baseProps} />);
    expect(screen.getByTestId('task-column-todo')).toBeInTheDocument();
    expect(screen.getByTestId('task-column-doing')).toBeInTheDocument();
    expect(screen.getByTestId('task-column-done')).toBeInTheDocument();
    expect(screen.getByTestId('task-column-archived')).toBeInTheDocument();
  });

  it('column counts match task count for each status', () => {
    const tasks: Task[] = [
      makeTask({ id: '01T1', status: 'todo' }),
      makeTask({ id: '01T2', status: 'todo' }),
      makeTask({ id: '01T3', status: 'doing' }),
      makeTask({ id: '01T4', status: 'done', completedAt: 1_700_000_000_000 }),
      makeTask({ id: '01T5', status: 'archived' }),
    ];
    render(<TaskBoard tasks={tasks} {...baseProps} />);
    expect(screen.getByTestId('task-column-count-todo').textContent).toBe('2');
    expect(screen.getByTestId('task-column-count-doing').textContent).toBe('1');
    expect(screen.getByTestId('task-column-count-done').textContent).toBe('1');
    expect(screen.getByTestId('task-column-count-archived').textContent).toBe('1');
  });

  it('distributes tasks to columns by status', () => {
    const tasks: Task[] = [
      makeTask({ id: '01T1', status: 'todo', title: 'A' }),
      makeTask({ id: '01T2', status: 'doing', title: 'B' }),
      makeTask({ id: '01T3', status: 'done', title: 'C' }),
      makeTask({ id: '01T4', status: 'archived', title: 'D' }),
    ];
    render(<TaskBoard tasks={tasks} {...baseProps} />);
    expect(screen.getByTestId('task-card-01T1')).toBeInTheDocument();
    expect(screen.getByTestId('task-card-01T2')).toBeInTheDocument();
    expect(screen.getByTestId('task-card-01T3')).toBeInTheDocument();
    expect(screen.getByTestId('task-card-01T4')).toBeInTheDocument();
  });

  it('shows empty placeholder when a column has no tasks', () => {
    render(<TaskBoard tasks={[makeTask({ id: '01T1', status: 'todo' })]} {...baseProps} />);
    expect(screen.getByTestId('task-column-empty-doing')).toBeInTheDocument();
    expect(screen.getByTestId('task-column-empty-done')).toBeInTheDocument();
    expect(screen.getByTestId('task-column-empty-archived')).toBeInTheDocument();
  });

  it('forwards edit callback with task id', () => {
    const onEdit = vi.fn();
    const tasks = [makeTask({ id: '01T1', status: 'todo' })];
    render(<TaskBoard tasks={tasks} {...baseProps} onEdit={onEdit} />);
    fireEvent.click(screen.getByTestId('task-card-edit-01T1'));
    expect(onEdit).toHaveBeenCalledWith('01T1');
  });

  it('forwards archive callback with task id', () => {
    const onArchive = vi.fn();
    // archive 在 TaskCard 内会先调 window.confirm —— stub 一下
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const tasks = [makeTask({ id: '01T1', status: 'todo' })];
    render(<TaskBoard tasks={tasks} {...baseProps} onArchive={onArchive} />);
    fireEvent.click(screen.getByTestId('task-card-archive-01T1'));
    expect(onArchive).toHaveBeenCalledWith('01T1');
  });

  it('does NOT call onArchive when user cancels confirm', () => {
    const onArchive = vi.fn();
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const tasks = [makeTask({ id: '01T1', status: 'todo' })];
    render(<TaskBoard tasks={tasks} {...baseProps} onArchive={onArchive} />);
    fireEvent.click(screen.getByTestId('task-card-archive-01T1'));
    expect(onArchive).not.toHaveBeenCalled();
  });

  it('forwards delete callback with task id when user confirms', () => {
    const onDelete = vi.fn();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const tasks = [makeTask({ id: '01T1', status: 'todo' })];
    render(<TaskBoard tasks={tasks} {...baseProps} onDelete={onDelete} />);
    fireEvent.click(screen.getByTestId('task-card-delete-01T1'));
    expect(onDelete).toHaveBeenCalledWith('01T1');
  });

  it('does NOT call onDelete when user cancels confirm', () => {
    const onDelete = vi.fn();
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const tasks = [makeTask({ id: '01T1', status: 'todo' })];
    render(<TaskBoard tasks={tasks} {...baseProps} onDelete={onDelete} />);
    fireEvent.click(screen.getByTestId('task-card-delete-01T1'));
    expect(onDelete).not.toHaveBeenCalled();
  });
});
