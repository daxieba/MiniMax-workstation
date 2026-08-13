/**
 * 项目与任务页（T2-3 完整实现 + v0.1.2 i18n + v0.2.0 List/Kanban + v0.2.1 顶栏 chip 化）
 *
 * **v0.2.1 重构**：
 *   旧布局 = 左侧 ProjectList 1/4 + 右侧 TaskBoard/List 3/4。
 *   - 4 列 Kanban 在 1280px 宽度下被挤到出现横向滚动条
 *   - List 视图白白损失 1/4 宽度给左侧项目栏
 *   新布局 = 顶栏 3 行 + 主区全宽 TaskBoard / TaskListView：
 *     - 行 1：标题 + 任务数 + [看板|列表] + [+ 新建任务] [+ 新建项目]
 *     - 行 2：「项目」chip 行（横向滚动） + 归档过滤 tab
 *     - 行 3：「状态」chip（全部 / 待处理 / 进行中 / 已完成 / 已归档）
 *
 * **状态过滤**：
 *   - 默认 'all'，localStorage 记住 `minimax.workstation.projects.statusFilter`
 *   - 跟 projectId 是**正交**关系：先 projectId 过滤，再 status 过滤（TaskListView 内部做）
 *
 * **数据源**：
 *   - `useProjectStore`（项目列表 + archiveFilter）
 *   - `useTaskStore`（任务列表 + projectId 过滤）
 *
 * **不做**：
 *   - 不做项目管理菜单（编辑/归档/删除在 ProjectChip 上右键 / 长按 —— v0.2.2 再做）
 *   - 不做项目搜索
 */
import { useCallback, useEffect, useMemo, useState } from 'react';

import { ProjectForm, type ProjectFormSubmitPayload } from '@/components/ProjectForm/ProjectForm';
import { ProjectsTopbar, type ViewMode } from '@/components/ProjectsTopbar/ProjectsTopbar';
import { TaskBoard } from '@/components/TaskBoard/TaskBoard';
import { TaskForm, type TaskFormSubmitPayload } from '@/components/TaskForm/TaskForm';
import { TaskListView, type TaskListStatusFilter } from '@/components/TaskListView/TaskListView';
import { useT } from '@/i18n';
import { useProjectStore } from '@/store/projectStore';
import { useTaskStore } from '@/store/taskStore';
import { toast } from '@/store/toastStore';
import type { Project } from '@shared/types/project';
import type { Task } from '@shared/types/task';
import type { TaskStatus } from '@shared/types/taskStatus';
import { ALLOWED_TRANSITIONS } from '@shared/types/taskStatus';

const TRUNCATE_MAX = 60;
function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…`;
}

// localStorage key —— 跟前缀 `minimax.workstation.projects.*` 对齐
const VIEW_STORAGE_KEY = 'minimax.workstation.projects.view';
const STATUS_STORAGE_KEY = 'minimax.workstation.projects.statusFilter';

function loadViewMode(): ViewMode {
  try {
    const v = localStorage.getItem(VIEW_STORAGE_KEY);
    return v === 'kanban' ? 'kanban' : 'list';
  } catch {
    return 'list';
  }
}

function loadStatusFilter(): TaskListStatusFilter {
  try {
    const v = localStorage.getItem(STATUS_STORAGE_KEY);
    if (v === 'todo' || v === 'doing' || v === 'done' || v === 'archived') return v;
    return 'all';
  } catch {
    return 'all';
  }
}

export default function ProjectsPage(): React.ReactElement {
  const t = useT();

  // ===== store =====
  const projects = useProjectStore((s) => s.projects);
  const projectsLoading = useProjectStore((s) => s.loading);
  const archiveFilter = useProjectStore((s) => s.archiveFilter);
  const setArchiveFilter = useProjectStore((s) => s.setArchiveFilter);
  const projectCreate = useProjectStore((s) => s.create);
  const projectUpdate = useProjectStore((s) => s.update);
  const projectArchive = useProjectStore((s) => s.archive);
  const projectDelete = useProjectStore((s) => s.delete);

  const tasks = useTaskStore((s) => s.tasks);
  const tasksLoading = useTaskStore((s) => s.loading);
  const tasksError = useTaskStore((s) => s.error);
  const setTaskFilter = useTaskStore((s) => s.setFilter);
  const taskCreate = useTaskStore((s) => s.create);
  const taskUpdate = useTaskStore((s) => s.update);
  const taskTransition = useTaskStore((s) => s.transition);
  const taskArchive = useTaskStore((s) => s.archive);
  const taskDelete = useTaskStore((s) => s.delete);

  // ===== 视图级 state =====
  const [selectedProjectId, setSelectedProjectId] = useState<string | null | undefined>(undefined);
  const [viewMode, setViewMode] = useState<ViewMode>(loadViewMode);
  const [statusFilter, setStatusFilterState] = useState<TaskListStatusFilter>(loadStatusFilter);

  const [projectFormOpen, setProjectFormOpen] = useState(false);
  const [projectFormMode, setProjectFormMode] = useState<'create' | 'edit'>('create');
  const [projectFormTarget, setProjectFormTarget] = useState<Project | undefined>(undefined);
  const [taskFormOpen, setTaskFormOpen] = useState(false);
  const [taskFormMode, setTaskFormMode] = useState<'create' | 'edit'>('create');
  const [taskFormTarget, setTaskFormTarget] = useState<Task | undefined>(undefined);

  // 状态机 label（i18n 派生）
  const STATUS_LABELS = useMemo<Record<TaskStatus, string>>(
    () => ({
      todo: t.pages.projects.statusTodo,
      doing: t.pages.projects.statusDoing,
      done: t.pages.projects.statusDone,
      archived: t.pages.projects.statusArchived,
    }),
    [t],
  );

  // 持久化：viewMode + statusFilter
  useEffect(() => {
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, viewMode);
    } catch {
      // ignore
    }
  }, [viewMode]);
  useEffect(() => {
    try {
      localStorage.setItem(STATUS_STORAGE_KEY, statusFilter);
    } catch {
      // ignore
    }
  }, [statusFilter]);

  // 首次挂载：拉项目 + 拉任务
  useEffect(() => {
    void useProjectStore.getState().load();
    void useTaskStore.getState().load();
  }, []);

  // 选中项目变化 → 更新 task filter
  useEffect(() => {
    setTaskFilter({ projectId: selectedProjectId });
  }, [selectedProjectId, setTaskFilter]);

  // 用于 TaskForm 项目下拉的可见项目（只显示未归档）
  const visibleProjectsForSelect = useMemo(
    () => projects.filter((p) => !p.archived),
    [projects],
  );

  // v0.2.0: projectId → name 查表
  const projectNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of projects) map.set(p.id, p.name);
    return map;
  }, [projects]);

  // v0.2.1: 各 status 任务数（顶栏状态 chip badge 用）
  const statusCounts = useMemo<Record<TaskStatus, number>>(() => {
    const out: Record<TaskStatus, number> = { todo: 0, doing: 0, done: 0, archived: 0 };
    for (const task of tasks) {
      out[task.status] = (out[task.status] ?? 0) + 1;
    }
    return out;
  }, [tasks]);

  // ===== handlers =====

  const handleSelectProject = useCallback((id: string | null | undefined): void => {
    setSelectedProjectId(id);
  }, []);

  const handleSelectStatus = useCallback((filter: TaskListStatusFilter): void => {
    setStatusFilterState(filter);
  }, []);

  const handleViewModeChange = useCallback((mode: ViewMode): void => {
    setViewMode(mode);
  }, []);

  const handleArchiveFilterChange = useCallback(
    (filter: typeof archiveFilter): void => {
      setArchiveFilter(filter);
    },
    [setArchiveFilter],
  );

  const handleCreateProject = useCallback((): void => {
    setProjectFormMode('create');
    setProjectFormTarget(undefined);
    setProjectFormOpen(true);
  }, []);

  const handleEditProject = useCallback(
    (id: string): void => {
      const p = projects.find((x) => x.id === id);
      if (!p) return;
      setProjectFormMode('edit');
      setProjectFormTarget(p);
      setProjectFormOpen(true);
    },
    [projects],
  );

  const handleArchiveProject = useCallback(
    async (id: string): Promise<void> => {
      const p = projects.find((x) => x.id === id);
      if (!p) return;
      const ok = window.confirm(t.actions.archiveProjectConfirm(p.name));
      if (!ok) return;
      await projectArchive(id);
    },
    [projectArchive, projects, t],
  );

  const handleDeleteProject = useCallback(
    async (id: string): Promise<void> => {
      const p = projects.find((x) => x.id === id);
      if (!p) return;
      const ok = window.confirm(t.actions.deleteProjectConfirm(p.name));
      if (!ok) return;
      const success = await projectDelete(id);
      if (success && selectedProjectId === id) {
        setSelectedProjectId(undefined);
      }
    },
    [projectDelete, projects, selectedProjectId, t],
  );

  const handleProjectFormSubmit = useCallback(
    async (payload: ProjectFormSubmitPayload): Promise<void> => {
      try {
        if (payload.create) {
          await projectCreate(payload.create);
        } else if (payload.update) {
          await projectUpdate(payload.update.id, payload.update.patch);
        }
        setProjectFormOpen(false);
      } catch {
        // toast 已在 store 里打
      }
    },
    [projectCreate, projectUpdate],
  );

  const handleCreateTask = useCallback((): void => {
    setTaskFormMode('create');
    setTaskFormTarget(undefined);
    setTaskFormOpen(true);
  }, []);

  const handleEditTask = useCallback(
    (id: string): void => {
      const t2 = tasks.find((x) => x.id === id);
      if (!t2) return;
      setTaskFormMode('edit');
      setTaskFormTarget(t2);
      setTaskFormOpen(true);
    },
    [tasks],
  );

  const handleTaskTransitionIntent = useCallback(
    async (id: string, to: TaskStatus): Promise<void> => {
      const t2 = tasks.find((x) => x.id === id);
      if (!t2) return;
      const fromLabel = STATUS_LABELS[t2.status];
      const toLabel = STATUS_LABELS[to];
      const ok = window.confirm(t.actions.transitionConfirm(truncate(t2.title, TRUNCATE_MAX), fromLabel, toLabel));
      if (!ok) return;
      await taskTransition(id, to);
    },
    [taskTransition, tasks, STATUS_LABELS, t],
  );

  // 拖拽直接调 store.transition（不弹 confirm）—— 拖到目标列 = 明确意图
  const handleTaskDropped = useCallback(
    async (id: string, to: TaskStatus): Promise<void> => {
      const t2 = tasks.find((x) => x.id === id);
      if (!t2) return;
      if (t2.status === to) return;
      const allowed = ALLOWED_TRANSITIONS[t2.status];
      if (!allowed.includes(to)) {
        toast.error(t.toasts.invalidTransition(STATUS_LABELS[t2.status], STATUS_LABELS[to]));
        return;
      }
      try {
        await taskTransition(id, to);
        toast.success(t.toasts.transitionOk(STATUS_LABELS[to]));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        toast.error(t.toasts.transitionFailed(msg));
      }
    },
    [taskTransition, tasks, STATUS_LABELS, t],
  );

  const handleArchiveTask = useCallback(
    async (id: string): Promise<void> => {
      const t2 = tasks.find((x) => x.id === id);
      if (!t2) return;
      if (t2.status === 'archived') return;
      const ok = window.confirm(t.actions.archiveConfirm(truncate(t2.title, TRUNCATE_MAX)));
      if (!ok) return;
      await taskArchive(id);
    },
    [taskArchive, tasks, t],
  );

  const handleDeleteTask = useCallback(
    async (id: string): Promise<void> => {
      const t2 = tasks.find((x) => x.id === id);
      if (!t2) return;
      const ok = window.confirm(t.actions.deleteConfirm(truncate(t2.title, TRUNCATE_MAX)));
      if (!ok) return;
      await taskDelete(id);
    },
    [taskDelete, tasks, t],
  );

  const handleTaskFormSubmit = useCallback(
    async (payload: TaskFormSubmitPayload): Promise<void> => {
      try {
        if (payload.create) {
          const input = { ...payload.create };
          if (typeof selectedProjectId === 'string' && input.projectId === undefined) {
            input.projectId = selectedProjectId;
          }
          await taskCreate(input);
        } else if (payload.update) {
          await taskUpdate(payload.update.id, payload.update.patch);
        }
        setTaskFormOpen(false);
      } catch {
        // toast 已在 store 里打
      }
    },
    [selectedProjectId, taskCreate, taskUpdate],
  );

  return (
    <section className="flex h-full flex-col">
      <ProjectsTopbar
        totalTaskCount={tasks.length}
        selectedProjectId={selectedProjectId}
        projects={projects}
        statusCounts={statusCounts}
        statusFilter={statusFilter}
        viewMode={viewMode}
        archiveFilter={archiveFilter}
        onSelectProject={handleSelectProject}
        onSelectStatus={handleSelectStatus}
        onViewModeChange={handleViewModeChange}
        onArchiveFilterChange={handleArchiveFilterChange}
        onNewTask={handleCreateTask}
        onNewProject={handleCreateProject}
        onEditProject={handleEditProject}
        onArchiveProject={handleArchiveProject}
        onDeleteProject={handleDeleteProject}
      />

      <main className="flex min-h-0 flex-1 flex-col gap-3 p-4">
        {tasksError ? (
          <div
            role="alert"
            data-testid="projects-error"
            className="rounded-md border border-danger bg-danger-soft/40 px-3 py-2 text-sm text-danger"
          >
            {tasksError}
          </div>
        ) : null}

        {projectsLoading || tasksLoading ? (
          <p data-testid="projects-loading" className="text-xs text-secondary">{t.common.loading}</p>
        ) : null}

        <div className="min-h-0 flex-1">
          {viewMode === 'kanban' ? (
            <TaskBoard
              tasks={tasks}
              onEdit={handleEditTask}
              onTransitionIntent={handleTaskTransitionIntent}
              onArchive={handleArchiveTask}
              onDelete={handleDeleteTask}
              onDropTask={handleTaskDropped}
            />
          ) : (
            <TaskListView
              tasks={tasks}
              projectNameById={projectNameById}
              statusFilter={statusFilter}
              emptyHint={t.pages.projects.empty.noTasksHint}
              onEdit={handleEditTask}
              onTransitionIntent={handleTaskTransitionIntent}
              onArchive={handleArchiveTask}
              onDelete={handleDeleteTask}
            />
          )}
        </div>
      </main>

      <ProjectForm
        open={projectFormOpen}
        mode={projectFormMode}
        project={projectFormTarget}
        submitting={projectsLoading}
        onSubmit={handleProjectFormSubmit}
        onClose={() => setProjectFormOpen(false)}
      />

      <TaskForm
        open={taskFormOpen}
        mode={taskFormMode}
        task={taskFormTarget}
        projects={visibleProjectsForSelect}
        submitting={tasksLoading}
        onSubmit={handleTaskFormSubmit}
        onClose={() => setTaskFormOpen(false)}
      />
    </section>
  );
}
