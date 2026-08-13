/**
 * 项目与任务页（T2-3 完整实现 + v0.1.2 i18n）
 *
 * 布局：
 *   - 左侧：项目列表（ProjectList）+ 顶部"+ 新建项目" + 归档过滤
 *   - 右侧：选中项目（或"全部" / "无项目"）的任务看板（TaskBoard）
 *   - 顶部：当前视图标题 + "+ 新建任务"按钮
 *
 * 数据源：
 *   - `useProjectStore`（项目列表）
 *   - `useTaskStore`（任务列表 + 过滤）
 *
 * 二次确认：
 *   - 删除 / 归档项目、删除任务：在各自的子组件里调 `window.confirm` 确认
 *   - 状态流转：子组件按钮不确认；父页面在 onTransitionIntent 内做确认
 *
 * **v0.1.2 i18n**：标题 / 按钮 / 状态机 label / 确认提示 从 useT() 派生。
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import { Plus } from 'lucide-react';

import { ProjectForm, type ProjectFormSubmitPayload } from '@/components/ProjectForm/ProjectForm';
import { ProjectList } from '@/components/ProjectList/ProjectList';
import { TaskBoard } from '@/components/TaskBoard/TaskBoard';
import { TaskForm, type TaskFormSubmitPayload } from '@/components/TaskForm/TaskForm';
import { TaskListView } from '@/components/TaskListView/TaskListView';
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

/** 把当前选中的 id 转成 task filter 用的 projectId 参数。 */
function projectIdForFilter(id: string | null | undefined): string | null | undefined {
  return id;
}

export default function ProjectsPage(): React.ReactElement {
  const t = useT();

  // store 状态
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

  // 视图级状态
  const [selectedId, setSelectedId] = useState<string | null | undefined>(undefined);
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

  // v0.2.0: 视图模式（看板 / 列表），localStorage 记住
  type ViewMode = 'kanban' | 'list';
  const VIEW_STORAGE_KEY = 'minimax.workstation.projects.view';
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    try {
      const v = localStorage.getItem(VIEW_STORAGE_KEY);
      return v === 'kanban' ? 'kanban' : 'list';
    } catch {
      return 'list';
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, viewMode);
    } catch {
      // ignore
    }
  }, [viewMode]);

  // 选中的"项目"显示文案。
  const describeSelected = useCallback(
    (id: string | null | undefined, list: Project[]): string => {
      if (id === undefined) return t.pages.projects.allTasks;
      if (id === null) return t.pages.projects.noProject;
      const p = list.find((x) => x.id === id);
      return p ? p.name : t.pages.projects.unknownProject;
    },
    [t],
  );

  // 首次挂载：拉项目 + 拉任务
  useEffect(() => {
    void useProjectStore.getState().load();
    void useTaskStore.getState().load();
  }, []);

  // 选中项目变化 → 更新 task filter（仅在 selectedId 变化时）
  useEffect(() => {
    setTaskFilter({ projectId: projectIdForFilter(selectedId) });
  }, [selectedId, setTaskFilter]);

  // 用于 TaskForm 项目下拉的可见项目（只显示未归档）
  const visibleProjectsForSelect = useMemo(
    () => projects.filter((p) => !p.archived),
    [projects],
  );

  // v0.2.0: List 视图用 projectId → name 查表（避免每个 task 嵌套查找）
  const projectNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of projects) map.set(p.id, p.name);
    return map;
  }, [projects]);

  // ====== 项目操作 ======

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
      if (success && selectedId === id) {
        setSelectedId(undefined);
      }
    },
    [projectDelete, projects, selectedId, t],
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

  // ====== 任务操作 ======

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

  // v0.1.1: 拖拽直接调 store.transition（不弹 confirm）—— 拖到目标列 = 明确意图
  // 状态机 forward-only（todo → doing → done → archived），跨级 / 反向会被 store.transition 拒绝
  const handleTaskDropped = useCallback(
    async (id: string, to: TaskStatus): Promise<void> => {
      const t2 = tasks.find((x) => x.id === id);
      if (!t2) return;
      // 同列拖到自己 = 忽略
      if (t2.status === to) return;
      // 状态机不允许的流转（反向）→ 不静默失败，弹 toast 让用户知道
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
          // 新建时如果当前是具体项目，把 projectId 一起填
          const input = { ...payload.create };
          if (typeof selectedId === 'string' && input.projectId === undefined) {
            input.projectId = selectedId;
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
    [selectedId, taskCreate, taskUpdate],
  );

  return (
    <section className="flex h-full flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-elevated/40 px-6 py-4">
        <div>
          <h1 className="text-2xl font-semibold text-primary">{t.pages.projects.title}</h1>
          <p className="text-sm text-secondary">
            {t.pages.projects.currentView}
            <span data-testid="projects-selected-label" className="font-medium text-primary">{describeSelected(selectedId, projects)}</span>
            {' · '}
            {t.pages.projects.taskCount(tasks.length)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            data-testid="projects-new-task"
            onClick={handleCreateTask}
            className="inline-flex items-center gap-1 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-inverse transition-colors hover:bg-accent-hover"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            {t.pages.projects.newTask}
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <ProjectList
          projects={projects}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onCreate={handleCreateProject}
          onEdit={handleEditProject}
          onArchive={handleArchiveProject}
          onDelete={handleDeleteProject}
          archiveFilter={archiveFilter}
          onArchiveFilterChange={setArchiveFilter}
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

          {/* v0.2.0: 视图模式 tab 切换（看板 / 列表） */}
          <div
            role="tablist"
            aria-label="view mode"
            data-testid="projects-view-tabs"
            className="inline-flex shrink-0 rounded-md border border-line bg-elevated p-0.5"
          >
            <button
              type="button"
              role="tab"
              data-testid="projects-view-kanban"
              aria-selected={viewMode === 'kanban'}
              onClick={() => setViewMode('kanban')}
              className={[
                'rounded px-3 py-1 text-xs transition-colors',
                viewMode === 'kanban' ? 'bg-accent text-inverse' : 'text-secondary hover:text-primary',
              ].join(' ')}
            >
              {t.pages.projects.viewKanban}
            </button>
            <button
              type="button"
              role="tab"
              data-testid="projects-view-list"
              aria-selected={viewMode === 'list'}
              onClick={() => setViewMode('list')}
              className={[
                'rounded px-3 py-1 text-xs transition-colors',
                viewMode === 'list' ? 'bg-accent text-inverse' : 'text-secondary hover:text-primary',
              ].join(' ')}
            >
              {t.pages.projects.viewList}
            </button>
          </div>

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
                onEdit={handleEditTask}
                onTransitionIntent={handleTaskTransitionIntent}
                onArchive={handleArchiveTask}
                onDelete={handleDeleteTask}
              />
            )}
          </div>
        </main>
      </div>

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
