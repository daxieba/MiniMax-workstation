/**
 * 项目与任务页（T2-3 完整实现）
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
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import { Plus } from 'lucide-react';

import { ProjectForm, type ProjectFormSubmitPayload } from '@/components/ProjectForm/ProjectForm';
import { ProjectList } from '@/components/ProjectList/ProjectList';
import { TaskBoard } from '@/components/TaskBoard/TaskBoard';
import { TaskForm, type TaskFormSubmitPayload } from '@/components/TaskForm/TaskForm';
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

/** 选中的"项目"显示文案。 */
function describeSelected(
  selectedId: string | null | undefined,
  projects: Project[],
): string {
  if (selectedId === undefined) return '全部任务';
  if (selectedId === null) return '无项目';
  const p = projects.find((x) => x.id === selectedId);
  return p ? p.name : '未知项目';
}

export default function ProjectsPage(): React.ReactElement {
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

  // ====== 项目操作 ======

  const handleCreateProject = useCallback((): void => {
    setProjectFormMode('create');
    setProjectFormTarget(undefined);
    setProjectFormOpen(true);
  }, []);

  const handleEditProject = useCallback((id: string): void => {
    const p = projects.find((x) => x.id === id);
    if (!p) return;
    setProjectFormMode('edit');
    setProjectFormTarget(p);
    setProjectFormOpen(true);
  }, [projects]);

  const handleArchiveProject = useCallback(
    async (id: string): Promise<void> => {
      const p = projects.find((x) => x.id === id);
      if (!p) return;
      const ok = window.confirm(`确认归档项目 "${p.name}" 吗？\n\n（项目下的任务不受影响，可随时恢复。）`);
      if (!ok) return;
      await projectArchive(id);
    },
    [projectArchive, projects],
  );

  const handleDeleteProject = useCallback(
    async (id: string): Promise<void> => {
      const p = projects.find((x) => x.id === id);
      if (!p) return;
      const ok = window.confirm(
        `确认删除项目 "${p.name}" 吗？\n\n` +
          `（如果项目下还有任务或收集项，删除会失败。请先转交/删除/归档。\n` +
          `这是不可恢复操作。）`,
      );
      if (!ok) return;
      const success = await projectDelete(id);
      if (success && selectedId === id) {
        setSelectedId(undefined);
      }
    },
    [projectDelete, projects, selectedId],
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
      const t = tasks.find((x) => x.id === id);
      if (!t) return;
      setTaskFormMode('edit');
      setTaskFormTarget(t);
      setTaskFormOpen(true);
    },
    [tasks],
  );

  const handleTaskTransitionIntent = useCallback(
    async (id: string, to: TaskStatus): Promise<void> => {
      const t = tasks.find((x) => x.id === id);
      if (!t) return;
      const fromLabel = STATUS_LABELS[t.status];
      const toLabel = STATUS_LABELS[to];
      const ok = window.confirm(`确认将任务 "${truncate(t.title, TRUNCATE_MAX)}" 从「${fromLabel}」流转到「${toLabel}」吗？`);
      if (!ok) return;
      await taskTransition(id, to);
    },
    [taskTransition, tasks],
  );

  // v0.1.1: 拖拽直接调 store.transition（不弹 confirm）—— 拖到目标列 = 明确意图
  // 状态机 forward-only（todo → doing → done → archived），跨级 / 反向会被 store.transition 拒绝
  const handleTaskDropped = useCallback(
    async (id: string, to: TaskStatus): Promise<void> => {
      const t = tasks.find((x) => x.id === id);
      if (!t) return;
      // 同列拖到自己 = 忽略
      if (t.status === to) return;
      // 状态机不允许的流转（反向）→ 不静默失败，弹 toast 让用户知道
      const allowed = ALLOWED_TRANSITIONS[t.status];
      if (!allowed.includes(to)) {
        toast.error(`不允许从「${STATUS_LABELS[t.status]}」直接跳到「${STATUS_LABELS[to]}」（状态机不兼容）`);
        return;
      }
      try {
        await taskTransition(id, to);
        toast.success(`已移到「${STATUS_LABELS[to]}」`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        toast.error(`流转失败：${msg}`);
      }
    },
    [taskTransition, tasks],
  );

  const handleArchiveTask = useCallback(
    async (id: string): Promise<void> => {
      const t = tasks.find((x) => x.id === id);
      if (!t) return;
      if (t.status === 'archived') return;
      const ok = window.confirm(`确认归档任务 "${truncate(t.title, TRUNCATE_MAX)}" 吗？`);
      if (!ok) return;
      await taskArchive(id);
    },
    [taskArchive, tasks],
  );

  const handleDeleteTask = useCallback(
    async (id: string): Promise<void> => {
      const t = tasks.find((x) => x.id === id);
      if (!t) return;
      const ok = window.confirm(`确认删除任务 "${truncate(t.title, TRUNCATE_MAX)}" 吗？\n\n（这是不可恢复操作。）`);
      if (!ok) return;
      await taskDelete(id);
    },
    [taskDelete, tasks],
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
          <h1 className="text-2xl font-semibold text-primary">项目与任务</h1>
          <p className="text-sm text-secondary">
            当前视图：<span data-testid="projects-selected-label" className="font-medium text-primary">{describeSelected(selectedId, projects)}</span>
            {' · '}
            共 {tasks.length} 条任务
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
            新建任务
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
            <p data-testid="projects-loading" className="text-xs text-secondary">加载中…</p>
          ) : null}

          <div className="min-h-0 flex-1">
            <TaskBoard
              tasks={tasks}
              onEdit={handleEditTask}
              onTransitionIntent={handleTaskTransitionIntent}
              onArchive={handleArchiveTask}
              onDelete={handleDeleteTask}
              onDropTask={handleTaskDropped}
            />
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

const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: '待处理',
  doing: '进行中',
  done: '已完成',
  archived: '已归档',
};
