/**
 * ProjectsTopbar 组件测试（v0.2.1 新增）
 *
 * 验证：
 *   - 渲染所有 3 行：标题 + 视图 tab / 项目 chip 行 + 归档 tab / 状态 chip 行
 *   - 项目 chip 高亮当前选中（aria-pressed=true）
 *   - 状态 chip 高亮当前 statusFilter
 *   - 状态 chip 显示 task count badge
 *   - 点 chip 触发对应回调
 *   - 视图 tab 切换触发 onViewModeChange
 *   - 归档 tab 切换触发 onArchiveFilterChange
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { ProjectsTopbar, type ViewMode } from '@/components/ProjectsTopbar/ProjectsTopbar';
import type { Project } from '@shared/types/project';
import type { TaskStatus } from '@shared/types/taskStatus';

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

const baseProps = {
  totalTaskCount: 0,
  selectedProjectId: undefined as string | null | undefined,
  projects: [] as Project[],
  statusCounts: { todo: 0, doing: 0, done: 0, archived: 0 } as Record<TaskStatus, number>,
  statusFilter: 'all' as const,
  viewMode: 'list' as ViewMode,
  archiveFilter: 'active' as const,
  onSelectProject: vi.fn(),
  onSelectStatus: vi.fn(),
  onViewModeChange: vi.fn(),
  onArchiveFilterChange: vi.fn(),
  onNewTask: vi.fn(),
  onNewProject: vi.fn(),
};

describe('ProjectsTopbar (v0.2.1)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('渲染所有 3 行 + 标题 + 新建按钮', () => {
    render(<ProjectsTopbar {...baseProps} />);
    expect(screen.getByTestId('projects-topbar')).toBeInTheDocument();
    // 行 1
    expect(screen.getByTestId('projects-view-kanban')).toBeInTheDocument();
    expect(screen.getByTestId('projects-view-list')).toBeInTheDocument();
    expect(screen.getByTestId('projects-topbar-new-task')).toBeInTheDocument();
    expect(screen.getByTestId('projects-topbar-new-project')).toBeInTheDocument();
    // 行 2
    expect(screen.getByTestId('projects-topbar-archive-tabs')).toBeInTheDocument();
    expect(screen.getByTestId('projects-project-chip-all')).toBeInTheDocument();
    // 行 3
    expect(screen.getByTestId('projects-topbar-status-row')).toBeInTheDocument();
    expect(screen.getByTestId('projects-status-filter-all')).toBeInTheDocument();
  });

  it('点视图 tab 触发 onViewModeChange', () => {
    const onViewModeChange = vi.fn();
    render(<ProjectsTopbar {...baseProps} onViewModeChange={onViewModeChange} />);
    fireEvent.click(screen.getByTestId('projects-view-kanban'));
    expect(onViewModeChange).toHaveBeenCalledWith('kanban');
  });

  it('点归档 tab 触发 onArchiveFilterChange', () => {
    const onArchiveFilterChange = vi.fn();
    render(<ProjectsTopbar {...baseProps} onArchiveFilterChange={onArchiveFilterChange} />);
    fireEvent.click(screen.getByTestId('projects-archive-tab-archived'));
    expect(onArchiveFilterChange).toHaveBeenCalledWith('archived');
  });

  it('点项目 chip 触发 onSelectProject', () => {
    const onSelectProject = vi.fn();
    render(
      <ProjectsTopbar
        {...baseProps}
        projects={[makeProject({ id: 'p-1', name: 'Alpha' })]}
        onSelectProject={onSelectProject}
      />,
    );
    fireEvent.click(screen.getByTestId('projects-project-chip-p-1'));
    expect(onSelectProject).toHaveBeenCalledWith('p-1');
  });

  it('点"全部任务"chip 触发 onSelectProject(undefined)', () => {
    const onSelectProject = vi.fn();
    render(
      <ProjectsTopbar
        {...baseProps}
        selectedProjectId="p-1"
        projects={[makeProject({ id: 'p-1' })]}
        onSelectProject={onSelectProject}
      />,
    );
    fireEvent.click(screen.getByTestId('projects-project-chip-all'));
    expect(onSelectProject).toHaveBeenCalledWith(undefined);
  });

  it('点"无项目"chip 触发 onSelectProject(null)', () => {
    const onSelectProject = vi.fn();
    render(<ProjectsTopbar {...baseProps} onSelectProject={onSelectProject} />);
    fireEvent.click(screen.getByTestId('projects-project-chip-none'));
    expect(onSelectProject).toHaveBeenCalledWith(null);
  });

  it('点状态 chip 触发 onSelectStatus', () => {
    const onSelectStatus = vi.fn();
    render(<ProjectsTopbar {...baseProps} onSelectStatus={onSelectStatus} />);
    fireEvent.click(screen.getByTestId('projects-status-filter-doing'));
    expect(onSelectStatus).toHaveBeenCalledWith('doing');
  });

  it('项目 chip 高亮当前选中（aria-pressed=true）', () => {
    render(
      <ProjectsTopbar
        {...baseProps}
        selectedProjectId="p-1"
        projects={[makeProject({ id: 'p-1', name: 'Alpha' })]}
      />,
    );
    expect(screen.getByTestId('projects-project-chip-p-1').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('projects-project-chip-all').getAttribute('aria-pressed')).toBe('false');
  });

  it('状态 chip 高亮当前 statusFilter', () => {
    render(<ProjectsTopbar {...baseProps} statusFilter="doing" />);
    expect(screen.getByTestId('projects-status-filter-doing').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('projects-status-filter-all').getAttribute('aria-pressed')).toBe('false');
  });

  it('状态 chip 显示 statusCounts badge', () => {
    render(
      <ProjectsTopbar
        {...baseProps}
        totalTaskCount={11}
        statusCounts={{ todo: 5, doing: 2, done: 3, archived: 1 }}
      />,
    );
    // 全部 chip 数量 = totalTaskCount = 11
    const allChip = screen.getByTestId('projects-status-filter-all');
    expect(allChip.textContent).toMatch(/11/);
    // doing chip 数量 = 2
    const doingChip = screen.getByTestId('projects-status-filter-doing');
    expect(doingChip.textContent).toMatch(/2/);
  });

  it('归档过滤=archived 时不显示"无项目"chip', () => {
    render(<ProjectsTopbar {...baseProps} archiveFilter="archived" />);
    expect(screen.queryByTestId('projects-project-chip-none')).toBeNull();
  });

  it('点新建任务 / 新建项目触发对应回调', () => {
    const onNewTask = vi.fn();
    const onNewProject = vi.fn();
    render(
      <ProjectsTopbar
        {...baseProps}
        onNewTask={onNewTask}
        onNewProject={onNewProject}
      />,
    );
    fireEvent.click(screen.getByTestId('projects-topbar-new-task'));
    fireEvent.click(screen.getByTestId('projects-topbar-new-project'));
    expect(onNewTask).toHaveBeenCalledTimes(1);
    expect(onNewProject).toHaveBeenCalledTimes(1);
  });
});
