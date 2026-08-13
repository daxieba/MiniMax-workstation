/**
 * 项目与任务页顶栏（v0.2.1 新增）
 *
 * 替代 v0.2.0 之前的「左侧 ProjectList 1/4 + 右侧 TaskBoard 3/4」布局 —— 那种布局
 * 4 列 Kanban 在 1280px 以下会被挤到出现横向滚动条，List 视图也白白损失 1/4 宽度。
 *
 * 新布局（顶栏一整条）：
 *   - 行 1：标题 + 任务数 + [看板|列表] + [+ 新建任务] [+ 新建项目]
 *   - 行 2：「项目」chip 横向滚动（全部任务 / 无项目 / 各项目 / 显示归档）
 *   - 行 3：「状态」chip（全部 / 待处理 / 进行中 / 已完成 / 已归档）
 *
 * 视觉：
 *   - chip 选中：蓝底白字
 *   - chip 未选中：透明底 + 边线 + 次级文字色
 *   - chip hover：边线变 accent
 *
 * **职责**：
 *   - 渲染顶栏
 *   - 触发回调（不改 store / 不调 IPC）
 *
 * **不做**：
 *   - 不做项目管理菜单（编辑/归档/删除）—— 弹 popover 太重；保留 hover 提示在 ProjectChip
 *     上，菜单留给 ProjectChip 自身的菜单（v0.2.2 再做）
 *   - 不做项目搜索
 *
 * **v0.2.1 设计权衡**：
 *   - 顶栏 3 行可能看起来"多"，但实际每个 row 只在「任务多」场景下撑开，平时 1 行高度
 *   - chip 用 `flex-nowrap` + `overflow-x-auto`，多项目横向滚动
 */
import { Archive, Folder, Pencil, Plus, Trash2 } from 'lucide-react';

import { useT } from '@/i18n';
import type { Project } from '@shared/types/project';
import type { ProjectArchiveFilter } from '@/store/projectStore';
import {
  TASK_STATUSES,
  type TaskStatus,
} from '@shared/types/taskStatus';

import type { TaskListStatusFilter } from '@/components/TaskListView/TaskListView';

export type ViewMode = 'kanban' | 'list';

export interface ProjectsTopbarProps {
  /** 任务总数（用于标题副文案 + 状态 chip badge）。 */
  totalTaskCount: number;
  /** 当前选中的 projectId：`undefined` = 全部任务；`null` = 无项目；其他 = 项目 id。 */
  selectedProjectId: string | null | undefined;
  /** 项目列表（已按当前 archiveFilter 过滤）。 */
  projects: Project[];
  /** 各 status 的任务数（chip badge 用）。 */
  statusCounts: Record<TaskStatus, number>;
  /** 状态过滤（顶栏状态 chip 当前选中）。 */
  statusFilter: TaskListStatusFilter;
  /** 视图模式（看板 / 列表）。 */
  viewMode: ViewMode;
  /** 归档过滤（控制是否显示"已归档"项目 chip）。 */
  archiveFilter: ProjectArchiveFilter;
  // === 回调 ===
  onSelectProject: (id: string | null | undefined) => void;
  onSelectStatus: (filter: TaskListStatusFilter) => void;
  onViewModeChange: (mode: ViewMode) => void;
  onArchiveFilterChange: (filter: ProjectArchiveFilter) => void;
  onNewTask: () => void;
  onNewProject: () => void;
  /**
   * v0.2.1: 项目操作回调。
   * 父页面 ProjectsPage 实现：编辑（弹 ProjectForm）/ 归档（确认 + store.archive）/ 删除（确认 + store.delete）。
   * 这些操作挂在 chip 选中态，hover 时显示操作按钮组。
   */
  onEditProject?: (id: string) => void;
  onArchiveProject?: (id: string) => void;
  onDeleteProject?: (id: string) => void;
}

// ============================================================
//  chip 视觉规范
// ============================================================

const CHIP_BASE =
  'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1 text-xs transition-colors';

const CHIP_ACTIVE = 'border-accent bg-accent text-inverse';
const CHIP_INACTIVE = 'border-line bg-elevated text-secondary hover:border-accent hover:text-accent';
const CHIP_GHOST = 'border-transparent text-secondary hover:border-line hover:text-primary';

// ============================================================
//  子组件：项目 chip
// ============================================================

interface ProjectChipProps {
  /** chip 文本。 */
  label: string;
  /** 是否选中。 */
  active: boolean;
  /** 项目色点（项目 chip 用）。 */
  color?: string | null;
  /** 数量 badge（"全部任务" / "无项目" 也可加 count）。 */
  count?: number;
  /** 选中的回调。 */
  onClick: () => void;
  /** 额外 data-testid。 */
  testId: string;
  /** 是否 ghost 样式（无选中样式，仅文字+hover）。 */
  ghost?: boolean;
}

function Chip({
  label,
  active,
  color,
  count,
  onClick,
  testId,
  ghost = false,
}: ProjectChipProps): React.ReactElement {
  return (
    <button
      type="button"
      data-testid={testId}
      data-active={active ? 'true' : 'false'}
      onClick={onClick}
      className={[
        CHIP_BASE,
        ghost
          ? CHIP_GHOST
          : active
            ? CHIP_ACTIVE
            : CHIP_INACTIVE,
      ].join(' ')}
      aria-pressed={active}
    >
      {color ? (
        <span
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: color }}
          aria-hidden="true"
        />
      ) : null}
      <span className="max-w-[12rem] truncate">{label}</span>
      {typeof count === 'number' ? (
        <span
          className={[
            'rounded-full px-1.5 text-[10px]',
            active ? 'bg-inverse/20' : 'bg-base text-secondary',
          ].join(' ')}
        >
          {count}
        </span>
      ) : null}
    </button>
  );
}

// ============================================================
//  主组件
// ============================================================

export function ProjectsTopbar({
  totalTaskCount,
  selectedProjectId,
  projects,
  statusCounts,
  statusFilter,
  viewMode,
  archiveFilter,
  onSelectProject,
  onSelectStatus,
  onViewModeChange,
  onArchiveFilterChange,
  onNewTask,
  onNewProject,
  onEditProject,
  onArchiveProject,
  onDeleteProject,
}: ProjectsTopbarProps): React.ReactElement {
  const t = useT();

  // 归档过滤 chip 标签
  const ARCHIVE_TABS: ReadonlyArray<{
    value: ProjectArchiveFilter;
    label: string;
    testId: string;
  }> = [
    { value: 'active', label: t.pages.knowledge.archiveFilterActive, testId: 'projects-archive-tab-active' },
    { value: 'archived', label: t.pages.knowledge.archiveFilterArchived, testId: 'projects-archive-tab-archived' },
    { value: 'all', label: '全部', testId: 'projects-archive-tab-all' },
  ];

  // 状态过滤 chip 配置
  const STATUS_TABS: ReadonlyArray<{
    value: TaskListStatusFilter;
    label: string;
    testId: string;
  }> = [
    {
      value: 'all',
      label: t.pages.projects.statusAll,
      testId: 'projects-status-filter-all',
    },
    ...TASK_STATUSES.map((s) => ({
      value: s as TaskListStatusFilter,
      label:
        s === 'todo'
          ? t.pages.projects.statusTodo
          : s === 'doing'
            ? t.pages.projects.statusDoing
            : s === 'done'
              ? t.pages.projects.statusDone
              : t.pages.projects.statusArchived,
      testId: `projects-status-filter-${s}`,
    })),
  ];

  // 当前选中的 project（用于 chip 高亮判断）
  const selectedProject =
    typeof selectedProjectId === 'string'
      ? projects.find((p) => p.id === selectedProjectId)
      : null;

  return (
    <div
      data-testid="projects-topbar"
      className="flex flex-col gap-3 border-b border-line bg-elevated/40 px-6 py-4"
    >
      {/* 行 1：标题 + 任务数 + 视图 tab + 新建 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-semibold text-primary">
            {t.pages.projects.title}
          </h1>
          <p className="text-xs text-secondary">
            <span data-testid="projects-topbar-count">
              {t.pages.projects.taskCount(totalTaskCount)}
            </span>
            {selectedProject ? (
              <>
                <span className="mx-1.5 text-line">·</span>
                <span data-testid="projects-topbar-selected" className="text-primary">
                  {selectedProject.name}
                </span>
              </>
            ) : null}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* 视图模式 tab */}
          <div
            role="tablist"
            aria-label="view mode"
            data-testid="projects-view-tabs"
            className="inline-flex shrink-0 rounded-md border border-line bg-base p-0.5"
          >
            <button
              type="button"
              role="tab"
              data-testid="projects-view-kanban"
              aria-selected={viewMode === 'kanban'}
              onClick={() => onViewModeChange('kanban')}
              className={[
                'rounded px-3 py-1 text-xs transition-colors',
                viewMode === 'kanban'
                  ? 'bg-accent text-inverse'
                  : 'text-secondary hover:text-primary',
              ].join(' ')}
            >
              {t.pages.projects.viewKanban}
            </button>
            <button
              type="button"
              role="tab"
              data-testid="projects-view-list"
              aria-selected={viewMode === 'list'}
              onClick={() => onViewModeChange('list')}
              className={[
                'rounded px-3 py-1 text-xs transition-colors',
                viewMode === 'list'
                  ? 'bg-accent text-inverse'
                  : 'text-secondary hover:text-primary',
              ].join(' ')}
            >
              {t.pages.projects.viewList}
            </button>
          </div>

          {/* 新建任务 */}
          <button
            type="button"
            data-testid="projects-topbar-new-task"
            onClick={onNewTask}
            className="inline-flex shrink-0 items-center gap-1 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-inverse transition-colors hover:bg-accent-hover"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            {t.pages.projects.newTask}
          </button>

          {/* 新建项目（次要操作） */}
          <button
            type="button"
            data-testid="projects-topbar-new-project"
            onClick={onNewProject}
            title={t.pages.projects.newProject}
            aria-label={t.pages.projects.newProject}
            className="inline-flex shrink-0 items-center gap-1 rounded-md border border-line bg-elevated px-2.5 py-1.5 text-sm text-primary transition-colors hover:border-accent hover:text-accent"
          >
            <Folder className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* 行 2：项目 chip 行 + 归档过滤 tab */}
      <div className="flex flex-wrap items-center gap-2">
        <span
          data-testid="projects-topbar-projects-label"
          className="shrink-0 text-[11px] uppercase tracking-wide text-secondary"
        >
          {t.pages.projects.projectsLabel}
        </span>

        {/* 归档过滤 tab（active/archived/all） */}
        <div
          role="tablist"
          aria-label="archive filter"
          data-testid="projects-topbar-archive-tabs"
          className="inline-flex shrink-0 rounded-full border border-line bg-base p-0.5 text-[11px]"
        >
          {ARCHIVE_TABS.map((tab) => (
            <button
              key={tab.value}
              type="button"
              role="tab"
              data-testid={tab.testId}
              aria-selected={archiveFilter === tab.value}
              onClick={() => onArchiveFilterChange(tab.value)}
              className={[
                'rounded-full px-2 py-0.5 transition-colors',
                archiveFilter === tab.value
                  ? 'bg-elevated text-primary'
                  : 'text-secondary hover:text-primary',
              ].join(' ')}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto">
          {/* 全部任务（伪项目） */}
          <Chip
            label={t.pages.projects.allTasks}
            active={selectedProjectId === undefined}
            onClick={() => onSelectProject(undefined)}
            testId="projects-project-chip-all"
            ghost
          />
          {/* 无项目（伪项目）—— 仅在 active / all 视图出现 */}
          {archiveFilter !== 'archived' ? (
            <Chip
              label={t.pages.projects.noProject}
              active={selectedProjectId === null}
              onClick={() => onSelectProject(null)}
              testId="projects-project-chip-none"
              ghost
            />
          ) : null}
          {/* 各项目 chip（v0.2.1: 选中态右侧出现操作按钮组） */}
          {projects.map((p) => {
            const isActive = selectedProjectId === p.id;
            const showActions = isActive && (onEditProject || onArchiveProject || onDeleteProject);
            return (
              <div
                key={p.id}
                className="flex shrink-0 items-center gap-0.5"
                data-testid={`projects-project-chip-wrap-${p.id}`}
              >
                <Chip
                  label={p.name}
                  color={p.color}
                  active={isActive}
                  onClick={() => onSelectProject(p.id)}
                  testId={`projects-project-chip-${p.id}`}
                />
                {showActions ? (
                  <div
                    data-testid={`projects-project-chip-actions-${p.id}`}
                    className="flex items-center gap-0.5"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {onEditProject ? (
                      <button
                        type="button"
                        data-testid={`projects-project-edit-${p.id}`}
                        onClick={() => onEditProject(p.id)}
                        title={t.pages.projects.editProject}
                        aria-label={t.pages.projects.editProject}
                        className="rounded-full p-1 text-secondary hover:bg-elevated hover:text-accent"
                      >
                        <Pencil className="h-3 w-3" aria-hidden="true" />
                      </button>
                    ) : null}
                    {onArchiveProject && !p.archived ? (
                      <button
                        type="button"
                        data-testid={`projects-project-archive-${p.id}`}
                        onClick={() => onArchiveProject(p.id)}
                        title={t.pages.projects.archiveProject}
                        aria-label={t.pages.projects.archiveProject}
                        className="rounded-full p-1 text-secondary hover:bg-elevated hover:text-warning"
                      >
                        <Archive className="h-3 w-3" aria-hidden="true" />
                      </button>
                    ) : null}
                    {onDeleteProject ? (
                      <button
                        type="button"
                        data-testid={`projects-project-delete-${p.id}`}
                        onClick={() => onDeleteProject(p.id)}
                        title={t.pages.projects.deleteProject}
                        aria-label={t.pages.projects.deleteProject}
                        className="rounded-full p-1 text-secondary hover:bg-elevated hover:text-danger"
                      >
                        <Trash2 className="h-3 w-3" aria-hidden="true" />
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      {/* 行 3：状态 chip 行 */}
      <div
        className="flex flex-wrap items-center gap-1.5"
        data-testid="projects-topbar-status-row"
      >
        <span
          data-testid="projects-topbar-status-label"
          className="shrink-0 text-[11px] uppercase tracking-wide text-secondary"
        >
          {t.pages.projects.statusFilterLabel}
        </span>
        {STATUS_TABS.map((tab) => {
          const count =
            tab.value === 'all'
              ? totalTaskCount
              : statusCounts[tab.value as TaskStatus] ?? 0;
          return (
            <Chip
              key={tab.value}
              label={tab.label}
              count={count}
              active={statusFilter === tab.value}
              onClick={() => onSelectStatus(tab.value)}
              testId={tab.testId}
            />
          );
        })}
      </div>
    </div>
  );
}
