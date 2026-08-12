/**
 * Stats 组件测试（v0.1.3）
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import StatsPage from '@/pages/Stats';
import { useInboxStore } from '@/store/inboxStore';
import { useProjectStore } from '@/store/projectStore';
import { usePomodoroStore } from '@/store/pomodoroStore';
import { useReviewStore } from '@/store/reviewStore';
import { useTaskStore } from '@/store/taskStore';
import type { InboxItem } from '@shared/types/inbox';
import type { Project } from '@shared/types/project';
import type { Review, ReviewDraft as _ReviewDraft } from '@shared/types/review';
void (null as _ReviewDraft | null);
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

function makeInbox(overrides: Partial<InboxItem> = {}): InboxItem {
  return {
    id: 'ib-1',
    content: 'Test',
    kind: 'note',
    status: 'active',
    projectId: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    convertedTo: null,
    ...overrides,
  } as InboxItem;
}

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'p-1',
    name: 'P1',
    description: null,
    archived: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  } as Project;
}

function makeReview(date: string): Review {
  return {
    id: `r-${date}`,
    date,
    completed: [],
    uncompleted: [],
    blockers: '',
    topThree: [],
    aiDraft: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  } as Review;
}

function renderStats(): void {
  render(
    <MemoryRouter>
      <StatsPage />
    </MemoryRouter>,
  );
}

describe('Stats', () => {
  beforeEach(() => {
    useTaskStore.setState({ tasks: [], loading: false, error: null });
    useInboxStore.setState({ items: [], loading: false, error: null });
    useProjectStore.setState({ projects: [], loading: false, error: null });
    useReviewStore.setState({ recent: [], loading: false, error: null });
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
  });

  it('没有数据时显示空态', () => {
    renderStats();
    expect(screen.getByTestId('stats-empty')).toBeInTheDocument();
  });

  it('有数据时显示 6 个指标卡 + 每日活动 + 按项目', () => {
    useTaskStore.setState({ tasks: [makeTask({ id: 'tk-1', status: 'done', updatedAt: Date.now() })] });
    useInboxStore.setState({ items: [makeInbox()] });
    useReviewStore.setState({ recent: [makeReview(new Date().toISOString().slice(0, 10))] });
    useProjectStore.setState({ projects: [makeProject()] });
    renderStats();
    expect(screen.getByTestId('stat-tasks-done')).toBeInTheDocument();
    expect(screen.getByTestId('stat-inbox')).toBeInTheDocument();
    expect(screen.getByTestId('stat-reviews')).toBeInTheDocument();
    expect(screen.getByTestId('stat-completion')).toBeInTheDocument();
    expect(screen.getByTestId('stat-pomodoros')).toBeInTheDocument();
    expect(screen.getByTestId('stat-streak')).toBeInTheDocument();
    expect(screen.getByTestId('stat-daily')).toBeInTheDocument();
    expect(screen.getByTestId('stat-by-project')).toBeInTheDocument();
  });

  it('今日番茄数渲染', () => {
    useTaskStore.setState({ tasks: [makeTask()] });
    usePomodoroStore.setState({ todayCount: 5 });
    renderStats();
    expect(screen.getByTestId('stat-pomodoros').textContent).toContain('5');
  });

  it('切换时间范围（7d / 30d / all）', () => {
    useTaskStore.setState({ tasks: [makeTask()] });
    renderStats();
    expect(screen.getByTestId('stats-range-7d')).toBeInTheDocument();
    expect(screen.getByTestId('stats-range-30d')).toBeInTheDocument();
    expect(screen.getByTestId('stats-range-all')).toBeInTheDocument();
  });
});
