/**
 * ProjectsPage 顶栏 + 视图模式测试（v0.2.1 重构）
 *
 * 验证：
 *   - 渲染顶栏：标题 + 视图 tab（看板/列表）+ 新建任务/项目按钮
 *   - 项目 chip 行：全部任务 / 无项目 / 各项目（按 archiveFilter 过滤）
 *   - 状态 chip 行：全部 / 待处理 / 进行中 / 已完成 / 已归档
 *   - 归档 tab：active / archived / all
 *   - 默认视图 = List（一页看全）
 *   - localStorage 持久化：viewMode + statusFilter 刷新后保留
 *   - 切到 Kanban：渲染 TaskBoard（4 列横排）
 *   - 切到 List：渲染 TaskListView（按 status 分组）
 *   - 状态 chip 切换：渲染只包含对应 status 的分组
 *   - aria-selected / aria-pressed 状态标记
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import ProjectsPage from '@/pages/Projects';
import { useInboxStore } from '@/store/inboxStore';
import { useProjectStore } from '@/store/projectStore';
import { useTaskStore } from '@/store/taskStore';
import type { Task } from '@shared/types/task';
import type { Project } from '@shared/types/project';
import type { TaskPriority } from '@shared/types/task';
import type { TaskStatus } from '@shared/types/taskStatus';

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

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'p-1',
    name: 'Project Alpha',
    description: null,
    color: '#3b82f6',
    archived: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  } as Project;
}

const VIEW_KEY = 'minimax.workstation.projects.view';
const STATUS_KEY = 'minimax.workstation.projects.statusFilter';

/**
 * 给 window.api 装 mock：让 ProjectsPage mount 时的 useEffect → load() 不动 store 里的数据。
 * 默认 list 走 store 现有 state（这样 store.setState 不会被覆盖）。
 */
function installApiMock(): void {
  const g = globalThis as unknown as { window: Window & { api: Record<string, unknown> } };
  g.window.api = g.window.api ?? {};
  g.window.api.task = {
    list: async (filter?: { projectId?: string | null | undefined; status?: TaskStatus | undefined; priority?: TaskPriority | undefined }) => {
      const all = useTaskStore.getState().tasks;
      const filtered = all.filter((t) => {
        if (filter?.status !== undefined && t.status !== filter.status) return false;
        if (filter?.projectId !== undefined) {
          if (filter.projectId === null && t.projectId !== null) return false;
          if (filter.projectId !== null && t.projectId !== filter.projectId) return false;
        }
        return true;
      });
      return { ok: true as const, data: filtered };
    },
  };
  g.window.api.project = {
    list: async (filter?: { archived?: boolean }) => {
      const all = useProjectStore.getState().projects;
      const filtered = filter?.archived === undefined
        ? all
        : all.filter((p) => p.archived === filter.archived);
      return { ok: true as const, data: filtered };
    },
  };
  g.window.api.inbox = { list: async () => ({ ok: true as const, data: [] }) };
}

function renderPage(): void {
  render(
    <MemoryRouter>
      <ProjectsPage />
    </MemoryRouter>,
  );
}

describe('ProjectsPage topbar + view mode (v0.2.1)', () => {
  beforeEach(() => {
    localStorage.clear();
    useTaskStore.setState({ tasks: [], loading: false, error: null });
    useProjectStore.setState({ projects: [], loading: false, error: null });
    useInboxStore.setState({ items: [], loading: false, error: null });
    installApiMock();
  });

  // ===== 顶栏渲染 =====

  it('渲染顶栏：标题 + 视图 tab + 新建任务/项目按钮', () => {
    renderPage();
    expect(screen.getByTestId('projects-topbar')).toBeInTheDocument();
    expect(screen.getByTestId('projects-view-kanban')).toBeInTheDocument();
    expect(screen.getByTestId('projects-view-list')).toBeInTheDocument();
    expect(screen.getByTestId('projects-topbar-new-task')).toBeInTheDocument();
    expect(screen.getByTestId('projects-topbar-new-project')).toBeInTheDocument();
  });

  it('项目 chip 行：显示"全部任务"和"无项目"伪项目 chip', () => {
    renderPage();
    expect(screen.getByTestId('projects-project-chip-all')).toBeInTheDocument();
    expect(screen.getByTestId('projects-project-chip-none')).toBeInTheDocument();
  });

  it('归档 tab：active / archived / all 三个 tab', () => {
    renderPage();
    expect(screen.getByTestId('projects-archive-tab-active')).toBeInTheDocument();
    expect(screen.getByTestId('projects-archive-tab-archived')).toBeInTheDocument();
    expect(screen.getByTestId('projects-archive-tab-all')).toBeInTheDocument();
  });

  it('状态 chip 行：5 个 chip（全部/待处理/进行中/已完成/已归档）', () => {
    renderPage();
    expect(screen.getByTestId('projects-status-filter-all')).toBeInTheDocument();
    expect(screen.getByTestId('projects-status-filter-todo')).toBeInTheDocument();
    expect(screen.getByTestId('projects-status-filter-doing')).toBeInTheDocument();
    expect(screen.getByTestId('projects-status-filter-done')).toBeInTheDocument();
    expect(screen.getByTestId('projects-status-filter-archived')).toBeInTheDocument();
  });

  it('项目列表渲染 chip：每个项目一个 chip + 颜色点', () => {
    useProjectStore.setState({
      projects: [
        makeProject({ id: 'p-1', name: 'Alpha', color: '#ff0000' }),
        makeProject({ id: 'p-2', name: 'Beta', color: '#00ff00' }),
      ],
    });
    renderPage();
    expect(screen.getByTestId('projects-project-chip-p-1')).toBeInTheDocument();
    expect(screen.getByTestId('projects-project-chip-p-2')).toBeInTheDocument();
  });

  // ===== 视图模式 =====

  it('默认视图是 List（一页看全）', () => {
    renderPage();
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

  it('点 List tab 切回 TaskListView', () => {
    renderPage();
    act(() => {
      fireEvent.click(screen.getByTestId('projects-view-kanban'));
    });
    expect(screen.getByTestId('task-board')).toBeInTheDocument();
    act(() => {
      fireEvent.click(screen.getByTestId('projects-view-list'));
    });
    expect(screen.getByTestId('task-list-view-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('task-board')).toBeNull();
  });

  it('localStorage 持久化 viewMode：选了 Kanban 后刷新保留', () => {
    localStorage.setItem(VIEW_KEY, 'kanban');
    renderPage();
    expect(screen.getByTestId('task-board')).toBeInTheDocument();
  });

  it('localStorage 持久化 viewMode：选了 List 后刷新保留', () => {
    localStorage.setItem(VIEW_KEY, 'list');
    renderPage();
    expect(screen.getByTestId('task-list-view-empty')).toBeInTheDocument();
  });

  it('点 view 切换后写 localStorage', () => {
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

  // ===== 项目 chip 切换 =====

  it('点项目 chip 切换后，chip 高亮（aria-pressed=true）', () => {
    useProjectStore.setState({
      projects: [makeProject({ id: 'p-1', name: 'Alpha' })],
    });
    renderPage();
    const chip = screen.getByTestId('projects-project-chip-p-1');
    expect(chip.getAttribute('aria-pressed')).toBe('false');
    act(() => {
      fireEvent.click(chip);
    });
    expect(chip.getAttribute('aria-pressed')).toBe('true');
  });

  it('默认"全部任务" chip 选中', () => {
    renderPage();
    const all = screen.getByTestId('projects-project-chip-all');
    expect(all.getAttribute('aria-pressed')).toBe('true');
  });

  // ===== 状态 chip 切换 =====

  it('点状态 chip 切换后，chip 高亮（aria-pressed=true）', () => {
    renderPage();
    const chip = screen.getByTestId('projects-status-filter-doing');
    expect(chip.getAttribute('aria-pressed')).toBe('false');
    act(() => {
      fireEvent.click(chip);
    });
    expect(chip.getAttribute('aria-pressed')).toBe('true');
  });

  it('localStorage 持久化 statusFilter', () => {
    renderPage();
    act(() => {
      fireEvent.click(screen.getByTestId('projects-status-filter-done'));
    });
    expect(localStorage.getItem(STATUS_KEY)).toBe('done');
  });

  it('localStorage 持久化 statusFilter 恢复：默认状态过滤 archived 时只显示 archived 任务', () => {
    useTaskStore.setState({
      tasks: [
        makeTask({ id: 'tk-todo', status: 'todo' }),
        makeTask({ id: 'tk-archived', status: 'archived' }),
      ],
    });
    localStorage.setItem(STATUS_KEY, 'archived');
    renderPage();
    // List 视图 + archived 过滤：只看到 archived 任务
    expect(screen.getByTestId('task-list-item-tk-archived')).toBeInTheDocument();
    expect(screen.queryByTestId('task-list-item-tk-todo')).toBeNull();
  });
});
