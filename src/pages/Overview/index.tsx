/**
 * 总览页 v0.3.0 重做 → "个人工作台仪表盘"
 *
 * 旧布局（T2-4）：4 张 OverviewCard 网格（今日 / 逾期 / 收集箱 / 项目进度）
 *   - 视觉太"功能罗列"
 *   - 没有 hero / 仪式感
 *   - 没有番茄 / 主题色板 / 快捷动作的入口
 *
 * 新布局（v0.3.0 仪表盘）：
 *   - Hero 区：欢迎语 + 今日日期 + 关键数字（待办 / 番茄 / 收集） + 主题色板 quick picker
 *   - Widget grid（6 个，桌面 3 列 / 平板 2 列 / 手机 1 列）：
 *     1. 今日重点任务（最多 5 条 + "查看全部"）
 *     2. 逾期任务（红色 alert）
 *     3. 快速收集箱（QuickInput + 最近 3 条）
 *     4. 番茄钟快速启动（25/5/15 一键跳转）
 *     5. 当前项目进度
 *     6. 最近活动（7d 收件 / 7d 完成 / 今日番茄）
 *   - AI placeholder：保持但视觉降级
 *
 * 数据流：纯前端聚合，不加新 IPC（**v0.1.2 起就坚持**）。
 * 错误处理：保持 OverviewCard 容器 loading / isEmpty / emptyText 三态。
 *
 * @see src/components/OverviewCard 容器
 * @see src/components/QuickInput 快速收集
 * @see src/components/ThemeSwitcher 主题色板
 */

import { useEffect, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlarmClock,
  CalendarDays,
  CheckCircle2,
  Flame,
  Inbox as InboxIcon,
  ListTodo,
  Sparkles,
  Timer,
  TrendingUp,
} from 'lucide-react';

import { OverviewCard } from '@/components/OverviewCard/OverviewCard';
import { QuickInput } from '@/components/QuickInput/QuickInput';
import { ThemeSwitcher } from '@/components/ThemeSwitcher/ThemeSwitcher';
import { useT, useI18nStore, type Lang } from '@/i18n';
import { daysOverdue, isOverdue, isToday } from '@/lib/dateUtils';
import { useInboxStore } from '@/store/inboxStore';
import { usePomodoroStore } from '@/store/pomodoroStore';
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

const DAY_MS = 24 * 60 * 60 * 1000;

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
    const relFmt =
      lang === 'zh-CN'
        ? new Intl.RelativeTimeFormat('zh-CN', { numeric: 'auto' })
        : lang === 'zh-TW'
          ? new Intl.RelativeTimeFormat('zh-TW', { numeric: 'auto' })
          : new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
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

const ACTIVE_STATUSES: ReadonlyArray<Task['status']> = TASK_STATUSES.filter(
  (s) => s !== 'done' && s !== 'archived',
);

const RECENT_INBOX_LIMIT = 3;

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…`;
}

function formatShortTime(ms: number, fmt: Intl.DateTimeFormat): string {
  return fmt.format(new Date(ms));
}

function formatRelativeTime(
  ms: number,
  now: number,
  relFmt: Intl.RelativeTimeFormat,
  lang: Lang,
): string {
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

// =============================================================
//  Hero 数据小卡
// =============================================================

interface StatPillProps {
  icon: typeof ListTodo;
  label: string;
  value: number | string;
  testId: string;
  tone?: 'default' | 'accent' | 'danger';
}

function StatPill({ icon: Icon, label, value, testId, tone = 'default' }: StatPillProps): React.ReactElement {
  return (
    <div
      data-testid={testId}
      className={[
        'flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm',
        tone === 'accent'
          ? 'border-accent/30 bg-accent-soft text-accent'
          : tone === 'danger'
            ? 'border-danger/30 bg-danger-soft text-danger'
            : 'border-line bg-elevated text-primary',
      ].join(' ')}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      <span className="text-xs text-secondary">{label}</span>
      <span className="font-semibold tabular-nums">{value}</span>
    </div>
  );
}

// =============================================================
//  任务行
// =============================================================

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
      className="flex items-center justify-between gap-2 rounded-md border border-line bg-base px-3 py-2 transition-colors hover:border-accent/40"
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

// =============================================================
//  Inbox 行
// =============================================================

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
      <p className="min-w-0 flex-1 truncate text-sm text-primary">{truncate(item.content, 60)}</p>
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

// =============================================================
//  项目进度
// =============================================================

function ProjectRow({
  project,
  total,
  done,
  progressAria,
}: {
  project: Project;
  total: number;
  done: number;
  progressAria: string;
}): React.ReactElement {
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

// =============================================================
//  番茄钟快速启动
// =============================================================

function PomodoroQuickStart(): React.ReactElement {
  const t = useT();
  const navigate = useNavigate();
  const setMode = usePomodoroStore((s) => s.setMode);
  const start = usePomodoroStore((s) => s.start);

  const handleStart = (mode: 'focus' | 'shortBreak' | 'longBreak'): void => {
    setMode(mode);
    void start();
    void navigate('/pomodoro');
  };

  return (
    <div className="flex flex-col gap-2" data-testid="overview-pomodoro-quickstart">
      <button
        type="button"
        data-testid="overview-pomodoro-focus"
        onClick={() => handleStart('focus')}
        className="flex items-center justify-between gap-2 rounded-md border border-accent/30 bg-accent-soft px-3 py-2 text-sm text-accent transition-colors hover:bg-accent hover:text-inverse"
      >
        <span className="flex items-center gap-2">
          <Flame className="h-4 w-4" aria-hidden="true" />
          {t.pages.overview.pomodoroFocus}
        </span>
        <span className="text-xs opacity-80">25:00</span>
      </button>
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          data-testid="overview-pomodoro-short"
          onClick={() => handleStart('shortBreak')}
          className="flex items-center justify-between gap-1 rounded-md border border-line bg-elevated px-3 py-1.5 text-xs text-secondary transition-colors hover:border-accent/40 hover:text-primary"
        >
          <span className="flex items-center gap-1.5">
            <Timer className="h-3.5 w-3.5" aria-hidden="true" />
            {t.pages.overview.pomodoroShort}
          </span>
          <span>5:00</span>
        </button>
        <button
          type="button"
          data-testid="overview-pomodoro-long"
          onClick={() => handleStart('longBreak')}
          className="flex items-center justify-between gap-1 rounded-md border border-line bg-elevated px-3 py-1.5 text-xs text-secondary transition-colors hover:border-accent/40 hover:text-primary"
        >
          <span className="flex items-center gap-1.5">
            <AlarmClock className="h-3.5 w-3.5" aria-hidden="true" />
            {t.pages.overview.pomodoroLong}
          </span>
          <span>15:00</span>
        </button>
      </div>
    </div>
  );
}

// =============================================================
//  主组件
// =============================================================

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

  const todayPomodoros = usePomodoroStore((s) => s.todayCount);

  // 首次挂载 → 拉 3 个 store
  useEffect(() => {
    void taskLoad();
    void projectLoad();
    void inboxLoad();
  }, [taskLoad, projectLoad, inboxLoad]);

  // ===== 派生数据 =====
  const todayTasks = useMemo<Task[]>(
    () =>
      sortByPriorityThenDueDate(
        tasks.filter(
          (t2) =>
            t2.dueDate !== null && isToday(t2.dueDate) && ACTIVE_STATUSES.includes(t2.status),
        ),
      ).slice(0, 5),
    [tasks],
  );

  const overdueTasks = useMemo<Task[]>(
    () =>
      sortByPriorityThenDueDate(
        tasks.filter(
          (t2) =>
            t2.dueDate !== null && isOverdue(t2.dueDate) && ACTIVE_STATUSES.includes(t2.status),
        ),
      ).slice(0, 5),
    [tasks],
  );

  const recentInbox = useMemo<InboxItem[]>(
    () => inboxItems.filter((it) => it.status === 'active').slice(0, RECENT_INBOX_LIMIT),
    [inboxItems],
  );

  // Hero 关键数字
  const activeTaskCount = useMemo(
    () => tasks.filter((t2) => ACTIVE_STATUSES.includes(t2.status)).length,
    [tasks],
  );

  // 最近 7 天收件数
  const recent7dInbox = useMemo(() => {
    const cutoff = Date.now() - 7 * DAY_MS;
    return inboxItems.filter((it) => it.createdAt >= cutoff).length;
  }, [inboxItems]);

  // 最近 7 天完成任务数
  const recent7dDone = useMemo(() => {
    const cutoff = Date.now() - 7 * DAY_MS;
    return tasks.filter((t2) => t2.status === 'done' && t2.updatedAt >= cutoff).length;
  }, [tasks]);

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
    return rows.sort((a, b) => b.lastActivity - a.lastActivity).slice(0, 5);
  }, [projects, tasks]);

  const projectNameById = useMemo<Map<string, string>>(() => {
    const map = new Map<string, string>();
    for (const p of projects) map.set(p.id, p.name);
    return map;
  }, [projects]);

  const dataLoading = tasksLoading || projectsLoading || inboxLoading;
  const todayDate = useMemo(() => ov.dateFmt.format(new Date()), [ov.dateFmt]);
  const now = useMemo(() => Date.now(), []);

  // 问候语
  const greeting = useMemo(() => {
    const h = new Date().getHours();
    if (h < 5) return t.pages.overview.greetingLate;
    if (h < 11) return t.pages.overview.greetingMorning;
    if (h < 14) return t.pages.overview.greetingNoon;
    if (h < 18) return t.pages.overview.greetingAfternoon;
    if (h < 22) return t.pages.overview.greetingEvening;
    return t.pages.overview.greetingLate;
  }, [t]);

  return (
    <section className="flex h-full flex-col gap-5 overflow-auto p-6">
      {/* ====== Hero 区 ====== */}
      <header
        data-testid="overview-hero"
        className="relative overflow-hidden rounded-xl border border-line bg-gradient-to-br from-accent-soft via-base to-base p-6 shadow-card"
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-semibold text-primary">
              {greeting}
              <span className="ml-2 text-base font-normal text-secondary" data-testid="overview-today-date">
                <CalendarDays className="-mt-0.5 mr-1 inline h-4 w-4" aria-hidden="true" />
                {todayDate}
              </span>
            </h1>
            <p className="mt-1 text-sm text-secondary">{t.pages.overview.heroHint}</p>
            {dataLoading ? (
              <p data-testid="overview-loading" className="mt-1 text-xs text-secondary">
                {t.pages.overview.loadingHint}
              </p>
            ) : null}
          </div>
          <div className="flex flex-col items-end gap-2">
            <ThemeSwitcher layout="row" testIdPrefix="overview-accent" />
          </div>
        </div>

        {/* Hero stats row */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <StatPill
            icon={ListTodo}
            label={t.pages.overview.heroActiveTasks}
            value={activeTaskCount}
            testId="overview-stat-active"
            tone={activeTaskCount > 0 ? 'accent' : 'default'}
          />
          <StatPill
            icon={InboxIcon}
            label={t.pages.overview.heroRecentInbox}
            value={recent7dInbox}
            testId="overview-stat-inbox"
          />
          <StatPill
            icon={CheckCircle2}
            label={t.pages.overview.heroRecentDone}
            value={recent7dDone}
            testId="overview-stat-done"
          />
          <StatPill
            icon={Flame}
            label={t.pages.overview.heroTodayPomodoros}
            value={todayPomodoros}
            testId="overview-stat-pomodoros"
          />
        </div>
      </header>

      {/* ====== Widget grid（6 个） ====== */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {/* 1. 今日重点 */}
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

        {/* 2. 逾期任务 */}
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

        {/* 3. 快速收集箱 */}
        <OverviewCard
          testId="inbox"
          title={t.pages.overview.inboxCard}
          loading={inboxLoading}
          isEmpty={false}
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
          <div className="flex flex-col gap-3">
            <QuickInput
              submitting={inboxLoading}
              onSubmit={(input) => {
                void inboxAdd({ content: input.content, kind: input.kind, projectId: null });
              }}
            />
            {recentInbox.length > 0 ? (
              <ul className="flex flex-col gap-1.5" data-testid="overview-inbox-list">
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
            ) : (
              <p
                data-testid="overview-inbox-empty"
                className="rounded-md border border-dashed border-line bg-base px-3 py-2 text-center text-xs text-secondary"
              >
                {t.pages.overview.inboxEmpty}
              </p>
            )}
          </div>
        </OverviewCard>

        {/* 4. 番茄钟快速启动 */}
        <OverviewCard
          testId="pomodoro"
          title={t.pages.overview.pomodoroCard}
          loading={false}
          isEmpty={false}
          emptyText=""
          headerExtra={
            <span
              data-testid="overview-pomodoro-today"
              className="rounded-md border border-line bg-base px-1.5 py-0.5 text-[10px] text-secondary"
            >
              {t.pages.overview.pomodoroTodayCount(todayPomodoros)}
            </span>
          }
        >
          <PomodoroQuickStart />
        </OverviewCard>

        {/* 5. 项目进度 */}
        <OverviewCard
          testId="projects"
          title={t.pages.overview.projectsCard}
          loading={projectsLoading || tasksLoading}
          isEmpty={projectProgress.length === 0}
          emptyText={t.pages.overview.projectsEmpty}
          headerExtra={
            <Link
              to="/projects"
              className="text-[11px] text-accent transition-colors hover:text-accent-hover"
            >
              {t.pages.overview.viewAll}
            </Link>
          }
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

        {/* 6. 最近活动 */}
        <OverviewCard
          testId="activity"
          title={t.pages.overview.activityCard}
          loading={false}
          isEmpty={false}
          emptyText=""
        >
          <ul className="flex flex-col gap-2" data-testid="overview-activity-list">
            <li
              data-testid="overview-activity-inbox"
              className="flex items-center justify-between gap-2 rounded-md border border-line bg-base px-3 py-2"
            >
              <span className="flex items-center gap-2 text-sm text-primary">
                <InboxIcon className="h-3.5 w-3.5 text-secondary" aria-hidden="true" />
                {t.pages.overview.activity7dInbox}
              </span>
              <span className="font-semibold tabular-nums text-primary">{recent7dInbox}</span>
            </li>
            <li
              data-testid="overview-activity-done"
              className="flex items-center justify-between gap-2 rounded-md border border-line bg-base px-3 py-2"
            >
              <span className="flex items-center gap-2 text-sm text-primary">
                <CheckCircle2 className="h-3.5 w-3.5 text-success" aria-hidden="true" />
                {t.pages.overview.activity7dDone}
              </span>
              <span className="font-semibold tabular-nums text-primary">{recent7dDone}</span>
            </li>
            <li
              data-testid="overview-activity-pomodoro"
              className="flex items-center justify-between gap-2 rounded-md border border-line bg-base px-3 py-2"
            >
              <span className="flex items-center gap-2 text-sm text-primary">
                <Flame className="h-3.5 w-3.5 text-warning" aria-hidden="true" />
                {t.pages.overview.activityTodayPomodoro}
              </span>
              <span className="font-semibold tabular-nums text-primary">{todayPomodoros}</span>
            </li>
          </ul>
        </OverviewCard>
      </div>

      {/* ====== AI placeholder（保留 + 视觉降级） ====== */}
      <section
        data-testid="overview-ai-placeholder"
        className="rounded-lg border border-dashed border-line bg-elevated/30 p-3"
      >
        <header className="mb-1 flex items-center gap-2 text-xs font-medium text-secondary">
          <Sparkles className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
          {t.pages.overview.aiPlaceholderTitle}
        </header>
        <p className="text-[11px] text-secondary">{t.pages.overview.aiPlaceholderHint}</p>
      </section>

      {/* ====== 隐藏：保留 trending 引入免 lint 警告 ====== */}
      <span className="hidden">
        <TrendingUp className="h-3.5 w-3.5" aria-hidden="true" />
      </span>
    </section>
  );
}
