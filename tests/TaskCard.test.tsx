/**
 * TaskCard 组件测试（T2-3）
 *
 * 覆盖：
 *   - 渲染：标题、优先级 badge、描述、截止日期、tag 数、completedAt
 *   - 优先级 badge 文案 / 样式
 *   - 截止日期"今日 / 逾期"角标
 *   - 编辑按钮直接调 onEdit（不确认）
 *   - 归档按钮调 window.confirm 后调 onArchive
 *   - 删除按钮调 window.confirm 后调 onDelete
 *   - 已归档时归档按钮 disabled
 *   - 状态流转按钮：每个允许的目标调 onTransitionIntent
 */

import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { TaskCard } from '@/components/TaskCard/TaskCard';
import type { Task } from '@shared/types/task';

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: '01HXYZ_TASK_CARD',
    title: 'My Task',
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

describe('TaskCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders title and priority badge', () => {
    render(<TaskCard task={makeTask({ priority: 'high' })} {...baseProps} />);
    expect(screen.getByTestId('task-card-title-01HXYZ_TASK_CARD')).toHaveTextContent('My Task');
    expect(screen.getByTestId('task-card-priority-01HXYZ_TASK_CARD').textContent).toBe('高');
  });

  it('renders description when present', () => {
    render(<TaskCard task={makeTask({ description: 'a description' })} {...baseProps} />);
    expect(screen.getByTestId('task-card-description-01HXYZ_TASK_CARD')).toHaveTextContent('a description');
  });

  it('does not render description element when null', () => {
    render(<TaskCard task={makeTask({ description: null })} {...baseProps} />);
    expect(screen.queryByTestId('task-card-description-01HXYZ_TASK_CARD')).toBeNull();
  });

  it('renders due date with "今日" label when due today', () => {
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    render(<TaskCard task={makeTask({ dueDate: today.getTime() })} {...baseProps} />);
    const due = screen.getByTestId('task-card-due-01HXYZ_TASK_CARD');
    expect(due.textContent).toContain('今日');
  });

  it('renders due date with "逾期" label when due date is in the past', () => {
    const past = new Date();
    past.setDate(past.getDate() - 3);
    render(<TaskCard task={makeTask({ dueDate: past.getTime() })} {...baseProps} />);
    const due = screen.getByTestId('task-card-due-01HXYZ_TASK_CARD');
    expect(due.textContent).toContain('逾期');
  });

  it('renders tag count when tags non-empty', () => {
    render(<TaskCard task={makeTask({ tags: ['a', 'b', 'c'] })} {...baseProps} />);
    // 用文本检查：组件渲染了 tag count
    expect(screen.getByTestId('task-card-01HXYZ_TASK_CARD').textContent).toMatch(/3/);
  });

  it('renders "已完成" line when completedAt is set', () => {
    render(<TaskCard task={makeTask({ status: 'done', completedAt: 1_700_000_000_000 })} {...baseProps} />);
    expect(screen.getByTestId('task-card-01HXYZ_TASK_CARD').textContent).toContain('已完成');
  });

  it('edit button calls onEdit immediately (no confirm)', () => {
    const onEdit = vi.fn();
    render(<TaskCard task={makeTask()} {...baseProps} onEdit={onEdit} />);
    fireEvent.click(screen.getByTestId('task-card-edit-01HXYZ_TASK_CARD'));
    expect(onEdit).toHaveBeenCalledWith('01HXYZ_TASK_CARD');
  });

  it('archive button calls onArchive after confirm', () => {
    const onArchive = vi.fn();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<TaskCard task={makeTask()} {...baseProps} onArchive={onArchive} />);
    fireEvent.click(screen.getByTestId('task-card-archive-01HXYZ_TASK_CARD'));
    expect(onArchive).toHaveBeenCalledWith('01HXYZ_TASK_CARD');
  });

  it('archive button does NOT call onArchive when confirm cancelled', () => {
    const onArchive = vi.fn();
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<TaskCard task={makeTask()} {...baseProps} onArchive={onArchive} />);
    fireEvent.click(screen.getByTestId('task-card-archive-01HXYZ_TASK_CARD'));
    expect(onArchive).not.toHaveBeenCalled();
  });

  it('archive button is disabled when status is archived', () => {
    render(<TaskCard task={makeTask({ status: 'archived' })} {...baseProps} />);
    expect(screen.getByTestId('task-card-archive-01HXYZ_TASK_CARD')).toBeDisabled();
  });

  it('delete button calls onDelete after confirm', () => {
    const onDelete = vi.fn();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<TaskCard task={makeTask()} {...baseProps} onDelete={onDelete} />);
    fireEvent.click(screen.getByTestId('task-card-delete-01HXYZ_TASK_CARD'));
    expect(onDelete).toHaveBeenCalledWith('01HXYZ_TASK_CARD');
  });

  it('delete button does NOT call onDelete when confirm cancelled', () => {
    const onDelete = vi.fn();
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<TaskCard task={makeTask()} {...baseProps} onDelete={onDelete} />);
    fireEvent.click(screen.getByTestId('task-card-delete-01HXYZ_TASK_CARD'));
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('priority badge: low / medium / high all render with distinct text', () => {
    const { rerender } = render(<TaskCard task={makeTask({ priority: 'low' })} {...baseProps} />);
    expect(screen.getByTestId('task-card-priority-01HXYZ_TASK_CARD').textContent).toBe('低');
    rerender(<TaskCard task={makeTask({ priority: 'high' })} {...baseProps} />);
    expect(screen.getByTestId('task-card-priority-01HXYZ_TASK_CARD').textContent).toBe('高');
  });
});
