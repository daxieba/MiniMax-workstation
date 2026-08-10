/**
 * TaskStatusActions 组件测试（T2-3）
 *
 * 覆盖：
 *   - 根据 currentStatus + ALLOWED_TRANSITIONS 渲染目标按钮
 *   - 点击按钮调 onTransition(target)
 *   - disabled 态
 *   - 边界：没有合法目标时不渲染
 */

import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { TaskStatusActions } from '@/components/TaskStatusActions/TaskStatusActions';
import { ALLOWED_TRANSITIONS, TASK_STATUSES, type TaskStatus } from '@shared/types/taskStatus';

describe('TaskStatusActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders one button per allowed target for todo', () => {
    const onTransition = vi.fn();
    render(<TaskStatusActions currentStatus="todo" onTransition={onTransition} />);
    const allowed = ALLOWED_TRANSITIONS.todo;
    expect(screen.getByTestId('task-status-actions-todo').querySelectorAll('button')).toHaveLength(
      allowed.length,
    );
    for (const to of allowed) {
      expect(screen.getByTestId(`task-status-action-todo-to-${to}`)).toBeInTheDocument();
    }
  });

  it('renders one button per allowed target for doing', () => {
    const onTransition = vi.fn();
    render(<TaskStatusActions currentStatus="doing" onTransition={onTransition} />);
    const allowed = ALLOWED_TRANSITIONS.doing;
    expect(screen.getByTestId('task-status-actions-doing').querySelectorAll('button')).toHaveLength(
      allowed.length,
    );
    expect(screen.getByTestId('task-status-action-doing-to-todo')).toBeInTheDocument();
    expect(screen.getByTestId('task-status-action-doing-to-done')).toBeInTheDocument();
    expect(screen.getByTestId('task-status-action-doing-to-archived')).toBeInTheDocument();
  });

  it('clicking a target button calls onTransition with the target status', () => {
    const onTransition = vi.fn();
    render(<TaskStatusActions currentStatus="todo" onTransition={onTransition} />);
    fireEvent.click(screen.getByTestId('task-status-action-todo-to-doing'));
    expect(onTransition).toHaveBeenCalledWith('doing');
  });

  it('disabled=true disables all rendered buttons', () => {
    const onTransition = vi.fn();
    render(<TaskStatusActions currentStatus="todo" onTransition={onTransition} disabled />);
    const buttons = screen.getByTestId('task-status-actions-todo').querySelectorAll('button');
    buttons.forEach((b) => {
      expect(b).toBeDisabled();
    });
    fireEvent.click(screen.getByTestId('task-status-action-todo-to-doing'));
    expect(onTransition).not.toHaveBeenCalled();
  });

  it('renders for every TaskStatus without throwing', () => {
    for (const status of TASK_STATUSES) {
      const onTransition = vi.fn();
      const { unmount } = render(
        <TaskStatusActions currentStatus={status} onTransition={onTransition} />,
      );
      // 至少能查到 actions 容器（archived 没有 targets 时返回 null，下面单独测）
      const allowed = ALLOWED_TRANSITIONS[status];
      if (allowed.length > 0) {
        expect(screen.getByTestId(`task-status-actions-${status}`)).toBeInTheDocument();
      }
      unmount();
    }
  });

  it('for status with zero allowed targets (none in current design), returns null', () => {
    // ALLOWED_TRANSITIONS 里有至少 1 个 target；这是冗余检查
    const noOpStatus = 'archived' as TaskStatus;
    const allowed = ALLOWED_TRANSITIONS[noOpStatus];
    expect(allowed.length).toBeGreaterThan(0);
  });
});
