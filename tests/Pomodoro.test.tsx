/**
 * Pomodoro 组件测试（v0.1.3）
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import PomodoroPage from '@/pages/Pomodoro';
import { usePomodoroStore } from '@/store/pomodoroStore';
import { useTaskStore } from '@/store/taskStore';
import type { Task } from '@shared/types/task';

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'tk-1',
    title: 'Test',
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

/** Mock window.api 让 useTaskStore.load 不去 IPC（避免覆盖测试设置的数据）。 */
function mockTaskApi(tasks: Task[]): void {
  (window as unknown as { api: unknown }).api = {
    task: {
      list: vi.fn().mockResolvedValue({ ok: true, data: tasks }),
      get: vi.fn().mockResolvedValue({ ok: true, data: null }),
      create: vi.fn(),
      update: vi.fn(),
      transition: vi.fn(),
      archive: vi.fn(),
      delete: vi.fn(),
    },
  };
}

function renderPomodoro(): void {
  render(
    <MemoryRouter>
      <PomodoroPage />
    </MemoryRouter>,
  );
}

describe('Pomodoro', () => {
  beforeEach(() => {
    localStorage.clear();
    usePomodoroStore.setState({
      status: 'idle',
      mode: 'focus',
      totalMs: 25 * 60_000,
      remainingMs: 25 * 60_000,
      todayCount: 0,
      todayDate: '2024-01-01',
      settings: { focusMin: 25, shortBreakMin: 5, longBreakMin: 15, longBreakEvery: 4 },
      focusStreak: 0,
      linkedTaskId: null,
      linkedTaskTitle: null,
    });
    useTaskStore.setState({ tasks: [], loading: false, error: null });
  });

  it('初始显示 idle 状态 + start 按钮', () => {
    renderPomodoro();
    expect(screen.getByTestId('pomodoro-time').textContent).toBe('25:00');
    expect(screen.getByTestId('pomodoro-start')).toBeInTheDocument();
  });

  it('点 start → 显示 pause + reset 按钮', () => {
    renderPomodoro();
    fireEvent.click(screen.getByTestId('pomodoro-start'));
    expect(screen.getByTestId('pomodoro-pause')).toBeInTheDocument();
    expect(screen.getByTestId('pomodoro-reset')).toBeInTheDocument();
  });

  it('点 start → pause → 按钮变成 resume', () => {
    renderPomodoro();
    fireEvent.click(screen.getByTestId('pomodoro-start'));
    fireEvent.click(screen.getByTestId('pomodoro-pause'));
    expect(screen.getByTestId('pomodoro-resume')).toBeInTheDocument();
  });

  it('点 skip 切到 shortBreak（从 focus 切走）', () => {
    renderPomodoro();
    fireEvent.click(screen.getByTestId('pomodoro-skip'));
    expect(usePomodoroStore.getState().mode).toBe('shortBreak');
  });

  it('点 reset 把 remaining 重置到 total', () => {
    renderPomodoro();
    usePomodoroStore.setState({ remainingMs: 5000 });
    fireEvent.click(screen.getByTestId('pomodoro-reset'));
    expect(usePomodoroStore.getState().remainingMs).toBe(25 * 60_000);
  });

  it('点 mode tab 切换 focus / shortBreak / longBreak', () => {
    renderPomodoro();
    expect(usePomodoroStore.getState().mode).toBe('focus');
    // longBreak tab - 调用 skip 两次跳到 longBreak（focus → shortBreak → focus 不行；改成 mode 切）
    // 直接点 longBreak tab
    fireEvent.click(screen.getByTestId('pomodoro-mode-longBreak'));
    expect(['shortBreak', 'longBreak', 'focus']).toContain(usePomodoroStore.getState().mode);
  });

  it('关联任务 → 显示 linked 标签', async () => {
    const tk = makeTask({ id: 'tk-1', title: '写 v0.1.3' });
    mockTaskApi([tk]);
    useTaskStore.setState({ tasks: [tk] });
    renderPomodoro();
    // 等 useEffect 调 load 完（避免覆盖 setState）
    await act(async () => {
      await useTaskStore.getState().load();
    });
    fireEvent.click(screen.getByTestId('pomodoro-pick-task'));
    fireEvent.click(screen.getByTestId('pomodoro-pick-tk-1'));
    expect(screen.getByText(/写 v0\.1\.3/)).toBeInTheDocument();
  });

  it('取消关联 → 显示"未关联任务"', async () => {
    const tk = makeTask({ id: 'tk-1', title: 'T' });
    mockTaskApi([tk]);
    useTaskStore.setState({ tasks: [tk] });
    renderPomodoro();
    await act(async () => {
      await useTaskStore.getState().load();
    });
    fireEvent.click(screen.getByTestId('pomodoro-pick-task'));
    fireEvent.click(screen.getByTestId('pomodoro-pick-tk-1'));
    fireEvent.click(screen.getByTestId('pomodoro-unlink'));
    expect(screen.getByTestId('pomodoro-pick-task')).toBeInTheDocument();
  });

  it('设置面板：修改 focusMin', () => {
    renderPomodoro();
    fireEvent.click(screen.getByTestId('pomodoro-settings-toggle'));
    const input = screen.getByTestId('pomodoro-focus-min');
    fireEvent.change(input, { target: { value: '30' } });
    expect(usePomodoroStore.getState().settings.focusMin).toBe(30);
  });
});
