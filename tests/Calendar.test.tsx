/**
 * Calendar 组件测试（v0.1.3）
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import CalendarPage from '@/pages/Calendar';
import { useTaskStore } from '@/store/taskStore';
import type { Task } from '@shared/types/task';

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'tk-1',
    title: 'Test task',
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

function renderCalendar(): void {
  render(
    <MemoryRouter>
      <CalendarPage />
    </MemoryRouter>,
  );
}

describe('Calendar', () => {
  beforeEach(() => {
    useTaskStore.setState({ tasks: [], loading: false, error: null });
  });

  it('没有任务时显示空态', () => {
    renderCalendar();
    expect(screen.getByTestId('calendar-empty')).toBeInTheDocument();
  });

  it('有任务时显示月历 grid', () => {
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    useTaskStore.setState({
      tasks: [
        makeTask({ id: 'tk-1', title: 'Today task', dueDate: today.getTime() }),
      ],
    });
    renderCalendar();
    expect(screen.getByTestId('calendar-page')).toBeInTheDocument();
    expect(screen.getByTestId('calendar-grid-wrap')).toBeInTheDocument();
    // 当天日期的 count badge
    const key = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    expect(screen.getByTestId(`calendar-day-count-${key}`).textContent).toBe('1');
  });

  it('点击日期 → 右侧详情显示该日任务', () => {
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    useTaskStore.setState({
      tasks: [
        makeTask({ id: 'tk-1', title: 'Today task A', dueDate: today.getTime() }),
        makeTask({ id: 'tk-2', title: 'Today task B', dueDate: today.getTime() }),
      ],
    });
    renderCalendar();
    const key = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    fireEvent.click(screen.getByTestId(`calendar-day-${key}`));
    expect(screen.getByTestId('calendar-task-tk-1')).toBeInTheDocument();
    expect(screen.getByTestId('calendar-task-tk-2')).toBeInTheDocument();
  });

  it('已归档任务不显示在日历上', () => {
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    useTaskStore.setState({
      tasks: [
        makeTask({ id: 'tk-1', title: 'Active', dueDate: today.getTime() }),
        makeTask({ id: 'tk-2', title: 'Archived', status: 'archived', dueDate: today.getTime() }),
      ],
    });
    renderCalendar();
    const key = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    expect(screen.getByTestId(`calendar-day-count-${key}`).textContent).toBe('1');
  });

  it('点击上一月 / 下一月 切换月份', () => {
    renderCalendar();
    const initialLabel = screen.getByTestId('calendar-month-label').textContent;
    fireEvent.click(screen.getByTestId('calendar-prev'));
    const newLabel = screen.getByTestId('calendar-month-label').textContent;
    expect(newLabel).not.toBe(initialLabel);
  });
});
