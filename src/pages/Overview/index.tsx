/**
 * 总览页（T2-4 完整实现 + v0.1.2 i18n）
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
 * **v0.1.2 i18n**：标题 / 卡片 / 优先级 / kind / 逾期文案 / 时间格式 / 相对时间 全部派生自 useT()。
 *
 * **数据流**（纯前端聚合，不加新 IPC handler）。
 *
 * **不做**：
 *   - 不做"最近 AI 结果"（T3-x 接入）
 *   - 不做日历 / 看板（PLAN §1 总览只列这些）
 *   - 不加新 IPC handler（任务卡硬约束）
 */

import { useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, Inbox as InboxIcon, Sparkles } from 'lucide-react';

import { OverviewCard } from '@/components/OverviewCard/OverviewCard';
import { QuickInput } from '@/components/QuickInput/QuickInput';
import { useT, useI18nStore, type Lang } from '@/i18n';
import { daysOverdue, isOverdue, isToday } from '@/lib/dateUtils';
import { useInboxStore } from '@/store/inboxStore';
import { useProjectStore } from '@/store/projectStore';
import { useTaskStore } from '@/store/taskStore';
import type { InboxItem, InboxKind } from '@shared/types/inbox';
import type { Project } from '@shared/types/project';
import type { Task, TaskPriority } from '@shared/types/task';
import { TASK_STATUSES } from '@shared/types/taskStatus';

const PRIORITY_BADGE_CLASS: Record<TaskPriority, string> = {
  high: 'border-danger/40 bg-danger-soft text-danger',
  medium: 'border-accent/40 bg-accent-soft text-accent',
  low: 'border-line bg-elevated text-secondary',
};

/** 拿当前 lang 派生日期 / 相对时间 / kind 标签。 */
function useOverviewI18n() {
  const t = useT();
  const lang = useI18nStore((s) => s.lang);
  return useMemo(() => {
    const dateFmt = new Intl.DateTimeFormat(lang, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      weekday: 'long',
    });
    const shortTimeFmt = new Intl.DateTimeFormat(lang, {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
    const relFmt = lang === 'zh-CN' ? new Intl.RelativeTimeFormat('zh-CN', { numeric: 'auto' }) : new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
    return {
      lang,
      t,
      dateFmt,
      shortTimeFmt,
      relFmt,
      kindLabels: {
        note: t.pages.overview.kindNote,
        todo: t.pages.overview.kindTodo,
        file: t.pages.overview.kindFile,
        link: t.pages.overview.kindLink,
      } satisfies Record<InboxKind, string>,
      priorityLabels: {
        high: t.pages.overview.priorityHigh,
        medium: t.pages.overview.priorityMedium,
        low: t.pages.overview.priorityLow,
      } satisfies Record<TaskPriority, string>,
    };
  }, [t, lang]);
}

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

function formatShortTime(ms: number, fmt: Intl.DateTimeFormat): string {
  return fmt.format(new Date(ms));
}

function formatRelativeTime(ms: number, now: number, relFmt: Intl.RelativeTimeFormat, lang: Lang): string {
  const diffMs = ms - now;
  const absSec = Math.abs(diffMs) / 1000;
  if (absSec < 60) return lang === 'zh-CN' ? '刚刚' : 'just now';
  if (absSec < 3600) {
    const m = Math.round(diffMs / 60000);
    return relFmt.format(m, 'minute');
  }
  if (absSec < 86400) {
    const h = Math.round(diffMs / 3600000);
    return relFmt.format(h, 'hour');
  }
  if (absSec < 86400 * 30) {
    const d = Math.round(diffMs / 86400000);
    return relFmt.format(d, 'day');
  }
  const mo = Math.round(diffMs / (86400000 * 30));
  return relFmt.format(mo, 'month');
}

/** 单个任务行（今日 / 逾期共用渲染）。 */
interface TaskRowProps {
  task: Task;
  projectName: string | null;
  showOverdueBadge: boolean;
  shortTimeFmt: Intl.DateTimeFormat;
  priorityLabels: Record<TaskPriority, string>;
  noProjectLabel: string;
  overdueLabel: (days: number) => string;
}

function TaskRow({
  task,
  projectName,
  showOverdueBadge,
  shortTimeFmt,
  priorityLabels,
  noProjectLabel,
  overdueLabel,
}: TaskRowProps): React.ReactElement {
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
          {projectName ? <span>{projectName}</span> : <span>{noProjectLabel}</span>}
          {task.dueDate !== null ? (
            <span>{formatShortTime(task.dueDate, shortTimeFmt)}</span>
          ) : null}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {showOverdueBadge && days > 0 ? (
          <span
            data-testid={`overview-task-overdue-${task.id}`}
            className="rounded-md border border-danger/40 bg-danger-soft px-1.5 py-0.5 text-[10px] font-medium text-danger"
          >
            {overdueLabel(days)}
          </span>
        ) : null}
        <span
          data-testid={`overview-task-priority-${task.id}`}
          className={`rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${PRIORITY_BADGE_CLASS[task.priority]}`}
        >
          {priorityLabels[task.priority]}
        </span>
      </div>
    </li>
  );
}

/** 单个 inbox 行。 */
function InboxRow({
  item,
  kindLabel,
  relTime,
}: {
  item: InboxItem;
  kindLabel: string;
  relTime: string;
}): React.ReactElement {
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
          {kindLabel}
        </span>
        <span>{relTime}</span>
      </div>
    </div>
  );
}

/** 单个项目进度行。 */
interface ProjectRowProps {
  project: Project;
  total: number;
  done: number;
  progressAria: string;
}

function ProjectRow({ project, total, done, progressAria }: ProjectRowProps): React.ReactElement {
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
        aria-label={progressAria}
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
  const ov = useOverviewI18n();
  const t = ov.t;

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
  const todayTasks = useMemo<Task[]>(() => {
    return sortByPriorityThenDueDate(
      tasks.filter(
        (t2) =>
          t2.dueDate !== null &&
          isToday(t2.dueDate) &&
          ACTIVE_STATUSES.includes(t2.status),
      ),
    );
  }, [tasks]);

  const overdueTasks = useMemo<Task[]>(() => {
    return sortByPriorityThenDueDate(
      tasks.filter(
        (t2) =>
          t2.dueDate !== null &&
          isOverdue(t2.dueDate) &&
          ACTIVE_STATUSES.includes(t2.status),
      ),
    );
  }, [tasks]);

  const recentInbox = useMemo<InboxItem[]>(() => {
    return inboxItems
      .filter((it) => it.status === 'active')
      .slice(0, RECENT_INBOX_LIMIT);
  }, [inboxItems]);

  const projectProgress = useMemo<
    Array<{ project: Project; total: number; done: number; lastActivity: number }>
  >(() => {
    const activeProjects = projects.filter((p) => !p.archived);
    const rows = activeProjects.map((p) => {
      const projectTasks = tasks.filter((t2) => t2.projectId === p.id);
      const total = projectTasks.length;
      const done = projectTasks.filter((t2) => t2.status === 'done').length;
      const lastActivity = projectTasks.reduce(
        (acc, t2) => (t2.updatedAt > acc ? t2.updatedAt : acc),
        0,
      );
      return { project: p, total, done, lastActivity };
    });
    return rows.sort((a, b) => b.lastActivity - a.lastActivity);
  }, [projects, tasks]);

  const projectNameById = useMemo<Map<string, string>>(() => {
    const map = new Map<string, string>();
    for (const p of projects) map.set(p.id, p.name);
    return map;
  }, [projects]);

  const dataLoading = tasksLoading || projectsLoading || inboxLoading;
  const todayDate = useMemo(() => ov.dateFmt.format(new Date()), [ov.dateFmt]);
  const now = useMemo(() => Date.now(), []);

  return (
    <section className="flex h-full flex-col gap-4 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-primary">{t.pages.overview.title}</h1>
          <p className="mt-0.5 flex items-center gap-1.5 text-sm text-secondary">
            <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
            <span data-testid="overview-today-date">{todayDate}</span>
            {dataLoading ? (
              <span data-testid="overview-loading" className="ml-1 text-xs">
                {t.pages.overview.loadingHint}
              </span>
            ) : null}
          </p>
        </div>
        <Link
          to="/inbox"
          className="inline-flex items-center gap-1 rounded-md border border-line bg-elevated px-3 py-1.5 text-xs text-secondary transition-colors hover:text-primary"
        >
          <InboxIcon className="h-3.5 w-3.5" aria-hidden="true" />
          {t.pages.overview.viewAllInbox}
        </Link>
      </header>

      <QuickInput
        submitting={inboxLoading}
        onSubmit={(input) => {
          void inboxAdd({ content: input.content, kind: input.kind, projectId: null });
        }}
      />

      <div className="grid flex-1 grid-cols-1 gap-4 lg:grid-cols-2">
        <OverviewCard
          testId="today"
          title={t.pages.overview.todayCard}
          loading={tasksLoading}
          isEmpty={todayTasks.length === 0}
          emptyText={t.pages.overview.todayEmpty}
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
            {todayTasks.map((t2) => (
              <TaskRow
                key={t2.id}
                task={t2}
                projectName={
                  t2.projectId !== null ? projectNameById.get(t2.projectId) ?? null : null
                }
                showOverdueBadge={false}
                shortTimeFmt={ov.shortTimeFmt}
                priorityLabels={ov.priorityLabels}
                noProjectLabel={t.pages.overview.noProject}
                overdueLabel={t.pages.overview.overdueDays}
              />
            ))}
          </ul>
        </OverviewCard>

        <OverviewCard
          testId="overdue"
          title={t.pages.overview.overdueCard}
          loading={tasksLoading}
          isEmpty={overdueTasks.length === 0}
          emptyText={t.pages.overview.overdueEmpty}
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
            {overdueTasks.map((t2) => (
              <TaskRow
                key={t2.id}
                task={t2}
                projectName={
                  t2.projectId !== null ? projectNameById.get(t2.projectId) ?? null : null
                }
                showOverdueBadge
                shortTimeFmt={ov.shortTimeFmt}
                priorityLabels={ov.priorityLabels}
                noProjectLabel={t.pages.overview.noProject}
                overdueLabel={t.pages.overview.overdueDays}
              />
            ))}
          </ul>
        </OverviewCard>

        <OverviewCard
          testId="inbox"
          title={t.pages.overview.inboxCard}
          loading={inboxLoading}
          isEmpty={recentInbox.length === 0}
          emptyText={t.pages.overview.inboxEmpty}
          headerExtra={
            <Link
              to="/inbox"
              className="text-[11px] text-accent transition-colors hover:text-accent-hover"
            >
              {t.pages.overview.viewAll}
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
                  <InboxRow
                    item={it}
                    kindLabel={ov.kindLabels[it.kind]}
                    relTime={formatRelativeTime(it.createdAt, now, ov.relFmt, ov.lang)}
                  />
                </Link>
              </li>
            ))}
          </ul>
        </OverviewCard>

        <OverviewCard
          testId="projects"
          title={t.pages.overview.projectsCard}
          loading={projectsLoading || tasksLoading}
          isEmpty={projectProgress.length === 0}
          emptyText={t.pages.overview.projectsEmpty}
        >
          <ul className="flex flex-col gap-2" data-testid="overview-projects-list">
            {projectProgress.map((row) => (
              <ProjectRow
                key={row.project.id}
                project={row.project}
                total={row.total}
                done={row.done}
                progressAria={`${row.project.name} progress`}
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
          {t.pages.overview.aiPlaceholderTitle}
        </header>
        <p className="text-xs text-secondary">{t.pages.overview.aiPlaceholderHint}</p>
      </section>
    </section>
  );
}
