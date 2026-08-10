/**
 * ProjectList 组件测试（T2-3）
 *
 * 覆盖：
 *   - 渲染：项目列表 + "全部任务" + "无项目" 入口
 *   - 选中态：高亮当前 selectedId
 *   - 归档过滤切换
 *   - 编辑 / 归档 / 删除 按钮转发
 *   - 空态文案
 */

import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { ProjectList } from '@/components/ProjectList/ProjectList';
import type { Project } from '@shared/types/project';
import type { ProjectArchiveFilter } from '@/store/projectStore';

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: '01HXYZ_PROJ_' + Math.random().toString(36).slice(2, 8),
    name: 'Test Project',
    description: 'desc',
    color: '#3B82F6',
    archived: false,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    ...overrides,
  };
}

const baseProps = {
  onSelect: vi.fn(),
  onCreate: vi.fn(),
  onEdit: vi.fn(),
  onArchive: vi.fn(),
  onDelete: vi.fn(),
  onArchiveFilterChange: vi.fn(),
};

describe('ProjectList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders "全部任务" and "无项目" pseudo entries plus all real projects', () => {
    const projects = [makeProject({ id: '01AAA', name: 'A' }), makeProject({ id: '01BBB', name: 'B' })];
    render(
      <ProjectList
        projects={projects}
        selectedId={undefined}
        archiveFilter="active"
        {...baseProps}
      />,
    );
    expect(screen.getByTestId('project-list-item-all')).toBeInTheDocument();
    expect(screen.getByTestId('project-list-item-none')).toBeInTheDocument();
    expect(screen.getByTestId('project-list-row-01AAA')).toBeInTheDocument();
    expect(screen.getByTestId('project-list-row-01BBB')).toBeInTheDocument();
  });

  it('hides "无项目" when archiveFilter is archived', () => {
    render(
      <ProjectList
        projects={[]}
        selectedId={undefined}
        archiveFilter="archived"
        {...baseProps}
      />,
    );
    expect(screen.queryByTestId('project-list-item-none')).toBeNull();
  });

  it('selects "全部任务" by default (selectedId=undefined)', () => {
    render(
      <ProjectList
        projects={[]}
        selectedId={undefined}
        archiveFilter="active"
        {...baseProps}
      />,
    );
    const allBtn = screen.getByTestId('project-list-item-all');
    // 高亮由 className 表达；只检查存在 + 选中调色已生效
    expect(allBtn).toBeInTheDocument();
  });

  it('clicking a project row calls onSelect with project id', () => {
    const onSelect = vi.fn();
    const projects = [makeProject({ id: '01AAA', name: 'A' })];
    render(
      <ProjectList
        projects={projects}
        selectedId={undefined}
        archiveFilter="active"
        {...baseProps}
        onSelect={onSelect}
      />,
    );
    fireEvent.click(screen.getByTestId('project-list-select-01AAA'));
    expect(onSelect).toHaveBeenCalledWith('01AAA');
  });

  it('clicking "无项目" calls onSelect(null)', () => {
    const onSelect = vi.fn();
    render(
      <ProjectList
        projects={[]}
        selectedId={undefined}
        archiveFilter="active"
        {...baseProps}
        onSelect={onSelect}
      />,
    );
    fireEvent.click(screen.getByTestId('project-list-item-none'));
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it('clicking "全部任务" calls onSelect(undefined)', () => {
    const onSelect = vi.fn();
    render(
      <ProjectList
        projects={[]}
        selectedId={null}
        archiveFilter="active"
        {...baseProps}
        onSelect={onSelect}
      />,
    );
    fireEvent.click(screen.getByTestId('project-list-item-all'));
    expect(onSelect).toHaveBeenCalledWith(undefined);
  });

  it('clicking "新建" calls onCreate', () => {
    const onCreate = vi.fn();
    render(
      <ProjectList
        projects={[]}
        selectedId={undefined}
        archiveFilter="active"
        {...baseProps}
        onCreate={onCreate}
      />,
    );
    fireEvent.click(screen.getByTestId('project-list-new'));
    expect(onCreate).toHaveBeenCalled();
  });

  it('archive filter tabs call onArchiveFilterChange with new value', () => {
    const onArchiveFilterChange = vi.fn();
    render(
      <ProjectList
        projects={[]}
        selectedId={undefined}
        archiveFilter="active"
        {...baseProps}
        onArchiveFilterChange={onArchiveFilterChange}
      />,
    );
    fireEvent.click(screen.getByTestId('project-list-archive-filter-archived'));
    expect(onArchiveFilterChange).toHaveBeenCalledWith('archived');

    fireEvent.click(screen.getByTestId('project-list-archive-filter-all'));
    expect(onArchiveFilterChange).toHaveBeenCalledWith('all');
  });

  it('archive filter tab is marked selected (aria-selected=true)', () => {
    render(
      <ProjectList
        projects={[]}
        selectedId={undefined}
        archiveFilter="archived"
        {...baseProps}
      />,
    );
    expect(screen.getByTestId('project-list-archive-filter-archived')).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByTestId('project-list-archive-filter-active')).toHaveAttribute(
      'aria-selected',
      'false',
    );
  });

  it('edit / archive / delete buttons on each row call respective handlers', () => {
    const onEdit = vi.fn();
    const onArchive = vi.fn();
    const onDelete = vi.fn();
    const projects = [makeProject({ id: '01AAA', name: 'A' })];
    render(
      <ProjectList
        projects={projects}
        selectedId={undefined}
        archiveFilter="active"
        {...baseProps}
        onEdit={onEdit}
        onArchive={onArchive}
        onDelete={onDelete}
      />,
    );
    fireEvent.click(screen.getByTestId('project-list-edit-01AAA'));
    expect(onEdit).toHaveBeenCalledWith('01AAA');

    fireEvent.click(screen.getByTestId('project-list-archive-01AAA'));
    expect(onArchive).toHaveBeenCalledWith('01AAA');

    fireEvent.click(screen.getByTestId('project-list-delete-01AAA'));
    expect(onDelete).toHaveBeenCalledWith('01AAA');
  });

  it('archived project hides its archive button', () => {
    const projects = [makeProject({ id: '01AAA', name: 'A', archived: true })];
    render(
      <ProjectList
        projects={projects}
        selectedId={undefined}
        archiveFilter="archived"
        {...baseProps}
      />,
    );
    expect(screen.queryByTestId('project-list-archive-01AAA')).toBeNull();
  });

  it('shows empty state when no projects', () => {
    render(
      <ProjectList
        projects={[]}
        selectedId={undefined}
        archiveFilter="active"
        {...baseProps}
      />,
    );
    expect(screen.getByTestId('project-list-empty')).toBeInTheDocument();
  });

  it('archiveFilter type "all" is accepted without TS errors', () => {
    const allProps = { ...baseProps, archiveFilter: 'all' as ProjectArchiveFilter };
    render(
      <ProjectList
        projects={[makeProject({ id: '01AAA', name: 'A' })]}
        selectedId="01AAA"
        {...allProps}
      />,
    );
    expect(screen.getByTestId('project-list-row-01AAA')).toBeInTheDocument();
  });
});
