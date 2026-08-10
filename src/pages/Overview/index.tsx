/**
 * 总览页（T2-4 完整实现）
 *
 * 一屏总览用户的"主闭环"状态：
 *   - 顶部：欢迎语 + 今日日期 + 数据加载状态
 *   - 快速输入框（QuickInput）→ 调 `inboxStore.add`
 *   - 4 张数据卡片：
 *       1. 今日重点任务（task: dueDate = 今天 AND status NOT IN done/archived）
 *       2. 逾期任务（task: dueDate < 今天 AND status NOT IN done/archived）
 *       3. 最近收集（inbox: status=active，取最近 5 条）
 *       4. 当前项目进度（project + task 聚合，按最近活动排序）
 *   - 1 张 AI 占位卡片（T3-x 接入）
 *
 * **数据流**（纯前端聚合，不加新 IPC handler）：
 *   - 挂载时调 3 个 store.load()：`useInboxStore` / `useTaskStore` / `useProjectStore`
 *   - 过滤 / 排序 / 切片都在前端 useMemo 里做
 *   - 提交快速输入 → `inboxStore.add`，store 内部显示 toast
 *
 * **不做**：
 *   - 不做"最近 AI 结果"（T3-x 接入）
 *   - 不做日历 / 看板（PLAN §1 总览只列这些）
 *   - 不加新 IPC handler（任务卡硬约束）
 *
 * **依赖**：
 *   - 复用 T2-2 `inboxStore` / T2-3 `taskStore` / T2-3 `projectStore`
 *   - 复用 T2-2 `InboxItem` 视觉风格（kind badge / 时间）
 *   - 不复用 `InboxComposer`：因为它会做 projectStore.load 与项目下拉，超出本卡简化版需要
 *
 * @used-by src/App.tsx (route "/")
 */

import { useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, Inbox as InboxIcon, Sparkles } from 'lucide-react';

import { OverviewCard } from '@/components/OverviewCard/OverviewCard';
import { QuickInput } from '@/components/QuickInput/QuickInput';
import { daysOverdue, isOverdue, isToday, relativeTime } from '@/lib/dateUtils';
import { useInboxStore } from '@/store/inboxStore';
import { useProjectStore } from '@/store/projectStore';
import { useTaskStore } from '@/store/taskStore';
import type { InboxItem, InboxKind } from '@shared/types/inbox';
import type { Project } from '@shared/types/project';
import type { Task, TaskPriority } from '@shared/types/task';
import { TASK_STATUSES } from '@shared/types/taskStatus';

const INBOX_KIND_LABELS: Record<InboxKind, string> = {
  note: '想法',
  todo: '待办',
  file: '文件',
  link: '链接',
};

const PRIORITY_LABELS: Record<TaskPriority, string> = {
  high: '高',
  medium: '中',
  low: '低',
};

const PRIORITY_BADGE_CLASS: Record<TaskPriority, string> = {
  high: 'border-danger/40 bg-danger-soft text-danger',
  medium: 'border-accent/40 bg-accent-soft text-accent',
  low: 'border-line bg-elevated text-secondary',
};

const TIME_FORMATTER = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  weekday: 'long',
});

/** 把任务按 priority desc + dueDate asc 排序。 */
function sortByPriorityThenDueDate(tasks: Task[]): Task[] {
  const priorityOrder: Record<TaskPriority, number> = { high: 0, medium: 1, low: 2 };
  return [...tasks].sort((a, b) => {
    const pa = priorityOrder[a.priority];
    const pb = priorityOrder[b.priority];
    if (pa !== pb) return pa - pb;
    const da = a.dueDate ?? Number.POSITIVE_INFINITY;
    const db = b.dueDate ?? Number.POSITIVE_INFINITY;
    return da - db;
  });
}

/** 状态机白名单：'done' 和 'archived' 视为"已结束"，总览页过滤掉。 */
const ACTIVE_STATUSES: ReadonlyArray<Task['status']> = TASK_STATUSES.filter(
  (s) => s !== 'done' && s !== 'archived',
);

const RECENT_INBOX_LIMIT = 5;

/** 截断文本（用于列表预览）。 */
function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…`;
}

/** 短时间格式（mm-dd HH:mm）。 */
const SHORT_TIME_FORMATTER = new Intl.DateTimeFormat('zh-CN', {
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

function formatShortTime(ms: number): string {
  return SHORT_TIME_FORMATTER.format(new Date(ms));
}

/** 单个任务行（今日 / 逾期共用渲染）。 */
interface TaskRowProps {
  task: Task;
  projectName: string | null;
  showOverdueBadge: boolean;
}

function TaskRow({ task, projectName, showOverdueBadge }: TaskRowProps): React.ReactElement {
  const days = task.dueDate !== null ? daysOverdue(task.dueDate) : 0;
  return (
    <li
      data-testid={`overview-task-row-${task.id}`}
      data-overdue-days={showOverdueBadge && days > 0 ? days : undefined}
      className="flex items-center justify-between gap-2 rounded-md border border-line bg-base px-3 py-2"
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-primary">{task.title}</p>
        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-secondary">
          {projectName ? <span>{projectName}</span> : <span>无项目</span>}
          {task.dueDate !== null ? (
            <span>{formatShortTime(task.dueDate)}</span>
          ) : null}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {showOverdueBadge && days > 0 ? (
          <span
            data-testid={`overview-task-overdue-${task.id}`}
            className="rounded-md border border-danger/40 bg-danger-soft px-1.5 py-0.5 text-[10px] font-medium text-danger"
          >
            逾期 {days} 天
          </span>
        ) : null}
        <span
          data-testid={`overview-task-priority-${task.id}`}
          className={`rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${PRIORITY_BADGE_CLASS[task.priority]}`}
        >
          {PRIORITY_LABELS[task.priority]}
        </span>
      </div>
    </li>
  );
}

/** 单个 inbox 行（用 div，外面由父 ul/li + Link 包裹；避免 li 嵌 li）。 */
function InboxRow({ item }: { item: InboxItem }): React.ReactElement {
  return (
    <div
      data-testid={`overview-inbox-item-${item.id}`}
      className="flex items-center justify-between gap-2 rounded-md border border-line bg-base px-3 py-2"
    >
      <p className="min-w-0 flex-1 truncate text-sm text-primary">{truncate(item.content, 50)}</p>
      <div className="flex shrink-0 items-center gap-1.5 text-[11px] text-secondary">
        <span
          data-testid={`overview-inbox-kind-${item.id}`}
          className="rounded-md border border-line bg-elevated px-1.5 py-0.5 text-[10px] text-secondary"
        >
          {INBOX_KIND_LABELS[item.kind]}
        </span>
        <span>{relativeTime(item.createdAt)}</span>
      </div>
    </div>
  );
}

/** 单个项目进度行。 */
interface ProjectRowProps {
  project: Project;
  total: number;
  done: number;
}

function ProjectRow({ project, total, done }: ProjectRowProps): React.ReactElement {
  const percent = total === 0 ? 0 : Math.round((done / total) * 100);
  return (
    <li
      data-testid={`overview-project-${project.id}`}
      className="rounded-md border border-line bg-base px-3 py-2"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-sm text-primary">{project.name}</p>
        <span
          data-testid={`overview-project-progress-${project.id}`}
          className="shrink-0 text-[11px] text-secondary"
        >
          {done} / {total}
        </span>
      </div>
      <div
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${project.name} 进度`}
        className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-elevated"
      >
        <div
          data-testid={`overview-project-progress-bar-${project.id}`}
          className="h-full bg-accent transition-all"
          style={{ width: `${percent}%` }}
        />
      </div>
    </li>
  );
}

/**
 * 总览页。
 */
export default function OverviewPage(): React.ReactElement {
  // ===== store 订阅 =====
  const tasks = useTaskStore((s) => s.tasks);
  const tasksLoading = useTaskStore((s) => s.loading);
  const taskLoad = useTaskStore((s) => s.load);

  const projects = useProjectStore((s) => s.projects);
  const projectsLoading = useProjectStore((s) => s.loading);
  const projectLoad = useProjectStore((s) => s.load);

  const inboxItems = useInboxStore((s) => s.items);
  const inboxLoading = useInboxStore((s) => s.loading);
  const inboxLoad = useInboxStore((s) => s.load);
  const inboxAdd = useInboxStore((s) => s.add);

  // 首次挂载 → 拉 3 个 store
  useEffect(() => {
    void taskLoad();
    void projectLoad();
    void inboxLoad();
  }, [taskLoad, projectLoad, inboxLoad]);

  // ===== 派生数据 =====

  /** 今日任务（dueDate = 今天 AND status NOT IN done/archived）。 */
  const todayTasks = useMemo<Task[]>(() => {
    return sortByPriorityThenDueDate(
      tasks.filter(
        (t) =>
          t.dueDate !== null &&
          isToday(t.dueDate) &&
          ACTIVE_STATUSES.includes(t.status),
      ),
    );
  }, [tasks]);

  /** 逾期任务（dueDate < 今天 AND status NOT IN done/archived）。 */
  const overdueTasks = useMemo<Task[]>(() => {
    return sortByPriorityThenDueDate(
      tasks.filter(
        (t) =>
          t.dueDate !== null &&
          isOverdue(t.dueDate) &&
          ACTIVE_STATUSES.includes(t.status),
      ),
    );
  }, [tasks]);

  /** 最近 5 条 active inbox。 */
  const recentInbox = useMemo<InboxItem[]>(() => {
    return inboxItems
      .filter((it) => it.status === 'active')
      .slice(0, RECENT_INBOX_LIMIT);
  }, [inboxItems]);

  /** 未归档项目 + 各项目 done/total，按最近任务活动 desc 排序。 */
  const projectProgress = useMemo<
    Array<{ project: Project; total: number; done: number; lastActivity: number }>
  >(() => {
    const activeProjects = projects.filter((p) => !p.archived);
    const rows = activeProjects.map((p) => {
      const projectTasks = tasks.filter((t) => t.projectId === p.id);
      const total = projectTasks.length;
      const done = projectTasks.filter((t) => t.status === 'done').length;
      const lastActivity = projectTasks.reduce(
        (acc, t) => (t.updatedAt > acc ? t.updatedAt : acc),
        0,
      );
      return { project: p, total, done, lastActivity };
    });
    // lastActivity desc；无任务（=0）的项目排在最末
    return rows.sort((a, b) => b.lastActivity - a.lastActivity);
  }, [projects, tasks]);

  // 项目名查表（避免嵌套查找 O(n²)）
  const projectNameById = useMemo<Map<string, string>>(() => {
    const map = new Map<string, string>();
    for (const p of projects) map.set(p.id, p.name);
    return map;
  }, [projects]);

  // ===== 计算 loading 聚合 =====
  const dataLoading = tasksLoading || projectsLoading || inboxLoading;
  const todayDate = useMemo(() => TIME_FORMATTER.format(new Date()), []);

  // ===== 渲染 =====

  return (
    <section className="flex h-full flex-col gap-4 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-primary">总览</h1>
          <p className="mt-0.5 flex items-center gap-1.5 text-sm text-secondary">
            <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
            <span data-testid="overview-today-date">{todayDate}</span>
            {dataLoading ? (
              <span data-testid="overview-loading" className="ml-1 text-xs">
                · 数据加载中…
              </span>
            ) : null}
          </p>
        </div>
        <Link
          to="/inbox"
          className="inline-flex items-center gap-1 rounded-md border border-line bg-elevated px-3 py-1.5 text-xs text-secondary transition-colors hover:text-primary"
        >
          <InboxIcon className="h-3.5 w-3.5" aria-hidden="true" />
          查看全部收集箱
        </Link>
      </header>

      <QuickInput
        submitting={inboxLoading}
        onSubmit={(input) => {
          // 总览页快速输入不绑项目（任务卡规格）
          void inboxAdd({ content: input.content, kind: input.kind, projectId: null });
        }}
      />

      <div className="grid flex-1 grid-cols-1 gap-4 lg:grid-cols-2">
        <OverviewCard
          testId="today"
          title="今日重点任务"
          loading={tasksLoading}
          isEmpty={todayTasks.length === 0}
          emptyText="今天没有重点任务，去收集箱看看？"
          headerExtra={
            <span
              data-testid="overview-today-count"
              className="rounded-md border border-line bg-base px-1.5 py-0.5 text-[10px] text-secondary"
            >
              {todayTasks.length}
            </span>
          }
        >
          <ul className="flex flex-col gap-2" data-testid="overview-today-list">
            {todayTasks.map((t) => (
              <TaskRow
                key={t.id}
                task={t}
                projectName={
                  t.projectId !== null ? projectNameById.get(t.projectId) ?? null : null
                }
                showOverdueBadge={false}
              />
            ))}
          </ul>
        </OverviewCard>

        <OverviewCard
          testId="overdue"
          title="逾期任务"
          loading={tasksLoading}
          isEmpty={overdueTasks.length === 0}
          emptyText="没有逾期任务 👍"
          headerExtra={
            overdueTasks.length > 0 ? (
              <span
                data-testid="overview-overdue-count"
                className="rounded-md border border-danger/40 bg-danger-soft px-1.5 py-0.5 text-[10px] text-danger"
              >
                {overdueTasks.length}
              </span>
            ) : null
          }
        >
          <ul className="flex flex-col gap-2" data-testid="overview-overdue-list">
            {overdueTasks.map((t) => (
              <TaskRow
                key={t.id}
                task={t}
                projectName={
                  t.projectId !== null ? projectNameById.get(t.projectId) ?? null : null
                }
                showOverdueBadge
              />
            ))}
          </ul>
        </OverviewCard>

        <OverviewCard
          testId="inbox"
          title="最近收集"
          loading={inboxLoading}
          isEmpty={recentInbox.length === 0}
          emptyText="收集箱是空的"
          headerExtra={
            <Link
              to="/inbox"
              className="text-[11px] text-accent transition-colors hover:text-accent-hover"
            >
              查看全部
            </Link>
          }
        >
          <ul className="flex flex-col gap-2" data-testid="overview-inbox-list">
            {recentInbox.map((it) => (
              <li key={it.id}>
                <Link
                  to="/inbox"
                  data-testid={`overview-inbox-link-${it.id}`}
                  className="block rounded-md transition-colors hover:bg-elevated"
                >
                  <InboxRow item={it} />
                </Link>
              </li>
            ))}
          </ul>
        </OverviewCard>

        <OverviewCard
          testId="projects"
          title="当前项目进度"
          loading={projectsLoading || tasksLoading}
          isEmpty={projectProgress.length === 0}
          emptyText="还没有项目，去创建一个？"
        >
          <ul className="flex flex-col gap-2" data-testid="overview-projects-list">
            {projectProgress.map((row) => (
              <ProjectRow
                key={row.project.id}
                project={row.project}
                total={row.total}
                done={row.done}
              />
            ))}
          </ul>
        </OverviewCard>
      </div>

      <section
        data-testid="overview-ai-placeholder"
        className="rounded-lg border border-dashed border-line bg-elevated/50 p-4"
      >
        <header className="mb-1 flex items-center gap-2 text-sm font-medium text-primary">
          <Sparkles className="h-4 w-4 text-accent" aria-hidden="true" />
          最近 AI 结果
        </header>
        <p className="text-xs text-secondary">AI 工作区将在 T3-x 接入</p>
      </section>
    </section>
  );
}
