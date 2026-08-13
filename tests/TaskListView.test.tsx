/**
 * TaskListView 组件测试（v0.2.0）
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { TaskListView } from '@/components/TaskListView/TaskListView';
import type { Task } from '@shared/types/task';

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'tk-1',
    title: 'Test Task',
    content: '',
    status: 'todo',
    priority: 'medium',
    projectId: null,
    dueDate: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    archived: false,
    linkedNoteIds: [],
    ...overrides,
  } as Task;
}

describe('TaskListView', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('空态：没有 task 时显示空态', () => {
    render(
      <TaskListView
        tasks={[]}
        onEdit={vi.fn()}
        onTransitionIntent={vi.fn()}
        onArchive={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByTestId('task-list-view-empty')).toBeInTheDocument();
  });

  it('渲染 4 个 status 分组（按顺序）', () => {
    const tasks = [
      makeTask({ id: '1', title: 'Todo A', status: 'todo' }),
      makeTask({ id: '2', title: 'Doing A', status: 'doing' }),
      makeTask({ id: '3', title: 'Done A', status: 'done' }),
      makeTask({ id: '4', title: 'Archived A', status: 'archived' }),
    ];
    render(
      <TaskListView
        tasks={tasks}
        onEdit={vi.fn()}
        onTransitionIntent={vi.fn()}
        onArchive={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    // 只匹配 task-list-group-{status}（不匹配 task-list-group-count-* / task-list-items-*）
    const groups = screen.getAllByTestId(/^task-list-group-(todo|doing|done|archived)$/);
    expect(groups).toHaveLength(4);
    // 顺序: todo -> doing -> done -> archived
    expect(groups[0]).toHaveAttribute('data-testid', 'task-list-group-todo');
    expect(groups[1]).toHaveAttribute('data-testid', 'task-list-group-doing');
    expect(groups[2]).toHaveAttribute('data-testid', 'task-list-group-done');
    expect(groups[3]).toHaveAttribute('data-testid', 'task-list-group-archived');
  });

  it('空分组不渲染：3 个 status 都没 task 时只显示 1 个分组', () => {
    const tasks = [makeTask({ id: '1', status: 'todo' })];
    render(
      <TaskListView
        tasks={tasks}
        onEdit={vi.fn()}
        onTransitionIntent={vi.fn()}
        onArchive={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    const groups = screen.getAllByTestId(/^task-list-group-(todo|doing|done|archived)$/);
    expect(groups).toHaveLength(1);
  });

  it('排序：同组内按 priority desc + dueDate asc', () => {
    const tasks = [
      makeTask({ id: 'low-1', title: 'Low', status: 'todo', priority: 'low', dueDate: 100 }),
      makeTask({ id: 'high-1', title: 'High', status: 'todo', priority: 'high', dueDate: 200 }),
      makeTask({ id: 'med-1', title: 'Medium', status: 'todo', priority: 'medium', dueDate: 150 }),
    ];
    render(
      <TaskListView
        tasks={tasks}
        onEdit={vi.fn()}
        onTransitionIntent={vi.fn()}
        onArchive={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    const items = screen.getAllByTestId(/^task-list-item-/);
    expect(items[0]).toHaveAttribute('data-testid', 'task-list-item-high-1');
    expect(items[1]).toHaveAttribute('data-testid', 'task-list-item-med-1');
    expect(items[2]).toHaveAttribute('data-testid', 'task-list-item-low-1');
  });

  it('每组头部显示 count', () => {
    const tasks = [
      makeTask({ id: '1', status: 'todo' }),
      makeTask({ id: '2', status: 'todo' }),
      makeTask({ id: '3', status: 'doing' }),
    ];
    render(
      <TaskListView
        tasks={tasks}
        onEdit={vi.fn()}
        onTransitionIntent={vi.fn()}
        onArchive={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByTestId('task-list-group-count-todo').textContent).toBe('2');
    expect(screen.getByTestId('task-list-group-count-doing').textContent).toBe('1');
  });

  it('点标题触发 onEdit', () => {
    const onEdit = vi.fn();
    render(
      <TaskListView
        tasks={[makeTask({ id: 'tk-1' })]}
        onEdit={onEdit}
        onTransitionIntent={vi.fn()}
        onArchive={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('task-list-edit-tk-1'));
    expect(onEdit).toHaveBeenCalledWith('tk-1');
  });

  it('点删除触发 onDelete', () => {
    const onDelete = vi.fn();
    render(
      <TaskListView
        tasks={[makeTask({ id: 'tk-1' })]}
        onEdit={vi.fn()}
        onTransitionIntent={vi.fn()}
        onArchive={vi.fn()}
        onDelete={onDelete}
      />,
    );
    fireEvent.click(screen.getByTestId('task-list-delete-tk-1'));
    expect(onDelete).toHaveBeenCalledWith('tk-1');
  });

  it('显示 projectNameById 查表的项目名', () => {
    const map = new Map([['p-1', 'Project Alpha']]);
    render(
      <TaskListView
        tasks={[makeTask({ id: 'tk-1', projectId: 'p-1' })]}
        projectNameById={map}
        onEdit={vi.fn()}
        onTransitionIntent={vi.fn()}
        onArchive={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByTestId('task-list-project-tk-1').textContent).toBe('Project Alpha');
  });

  it('显示 dueDate（用 Intl.DateTimeFormat）', () => {
    const due = new Date(2026, 7, 15, 14, 30).getTime(); // 8 月 15 日 14:30
    render(
      <TaskListView
        tasks={[makeTask({ id: 'tk-1', dueDate: due })]}
        onEdit={vi.fn()}
        onTransitionIntent={vi.fn()}
        onArchive={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    const dueEl = screen.getByTestId('task-list-due-tk-1');
    expect(dueEl.textContent).toMatch(/08/);
    expect(dueEl.textContent).toMatch(/15/);
  });
});
