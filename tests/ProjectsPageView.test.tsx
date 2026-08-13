/**
 * ProjectsPage 视图模式测试（v0.2.0）
 *
 * 验证：
 *   - 默认视图：List（一页看全）
 *   - 切换到 Kanban：渲染 TaskBoard（4 列横排）
 *   - 切回 List：渲染 TaskListView（按 status 分组）
 *   - localStorage 持久化：刷新后保留上次的视图
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import ProjectsPage from '@/pages/Projects';
import { useInboxStore } from '@/store/inboxStore';
import { useProjectStore } from '@/store/projectStore';
import { useTaskStore } from '@/store/taskStore';
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

const VIEW_KEY = 'minimax.workstation.projects.view';

function renderPage(): void {
  render(
    <MemoryRouter>
      <ProjectsPage />
    </MemoryRouter>,
  );
}

describe('ProjectsPage view mode (v0.2.0)', () => {
  beforeEach(() => {
    localStorage.clear();
    useTaskStore.setState({ tasks: [], loading: false, error: null });
    useProjectStore.setState({ projects: [], loading: false, error: null });
    useInboxStore.setState({ items: [], loading: false, error: null });
  });

  it('默认视图是 List（一页看全）', () => {
    renderPage();
    // 0 task 时 TaskListView 渲染 empty 态（testid=task-list-view-empty），不渲染 task-list-view
    expect(screen.getByTestId('task-list-view-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('task-board')).toBeNull();
  });

  it('点 Kanban tab 切到 TaskBoard', () => {
    renderPage();
    act(() => {
      fireEvent.click(screen.getByTestId('projects-view-kanban'));
    });
    expect(screen.getByTestId('task-board')).toBeInTheDocument();
    expect(screen.queryByTestId('task-list-view-empty')).toBeNull();
  });

  it('点 List tab 切到 TaskListView', () => {
    renderPage();
    // 先切到 Kanban
    act(() => {
      fireEvent.click(screen.getByTestId('projects-view-kanban'));
    });
    expect(screen.getByTestId('task-board')).toBeInTheDocument();
    // 再切回 List
    act(() => {
      fireEvent.click(screen.getByTestId('projects-view-list'));
    });
    expect(screen.getByTestId('task-list-view-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('task-board')).toBeNull();
  });

  it('localStorage 持久化：选了 Kanban 后刷新保留', () => {
    localStorage.setItem(VIEW_KEY, 'kanban');
    renderPage();
    expect(screen.getByTestId('task-board')).toBeInTheDocument();
  });

  it('localStorage 持久化：选了 List 后刷新保留', () => {
    localStorage.setItem(VIEW_KEY, 'list');
    renderPage();
    expect(screen.getByTestId('task-list-view-empty')).toBeInTheDocument();
  });

  it('点切换后写 localStorage', () => {
    renderPage();
    act(() => {
      fireEvent.click(screen.getByTestId('projects-view-kanban'));
    });
    expect(localStorage.getItem(VIEW_KEY)).toBe('kanban');
  });

  it('Kanban / List tab 标记 aria-selected', () => {
    renderPage();
    const kanban = screen.getByTestId('projects-view-kanban');
    const list = screen.getByTestId('projects-view-list');
    expect(list.getAttribute('aria-selected')).toBe('true');
    expect(kanban.getAttribute('aria-selected')).toBe('false');
    act(() => {
      fireEvent.click(kanban);
    });
    expect(kanban.getAttribute('aria-selected')).toBe('true');
    expect(list.getAttribute('aria-selected')).toBe('false');
  });

  it('List 视图切换到 List tab 后渲染 TaskListView empty 态', () => {
    // v0.2.0 注：测试不验证 task 渲染细节（ProjectsPage mount 时 useEffect 触发 load()，
    // 在 jsdom 里 load() 会重置 tasks=[]）。TaskListView 自身的渲染逻辑在
    // tests/TaskListView.test.tsx 里覆盖（更纯净、不被 ProjectsPage 的副作用影响）。
    renderPage();
    expect(screen.getByTestId('task-list-view-empty')).toBeInTheDocument();
  });
});
