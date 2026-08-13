/**
 * 统计页（v0.1.3 新功能）
 *
 * **指标**：
 *   - 完成任务数（task.status='done' 切到 done 的 created/updated）
 *   - 收集箱条数
 *   - 复盘天数
 *   - 任务完成率
 *   - 番茄数（来自 usePomodoroStore.todayCount）
 *   - 连续复盘天数
 *
 * **视图**：
 *   - 顶部 4 个指标卡片
 *   - 中间 每日活动柱状图（近 7 / 30 天）
 *   - 底部 按项目分布
 *
 * **数据源**：纯前端聚合（task / inbox / review / project 已有 store）
 *
 * **不做**：
 *   - 不调新 IPC（task.updatedAt / inbox.createdAt / review.date 已有）
 *   - 不做长期趋势（v0.1.x 看 7/30 天够用）
 *   - 不做导出图表
 */
import { useEffect, useMemo, useRef, useState } from 'react';

import { EmptyState } from '@/components/EmptyState/EmptyState';
import { BarChart3 } from 'lucide-react';

import { useT } from '@/i18n';
import { useInboxStore } from '@/store/inboxStore';
import { useProjectStore } from '@/store/projectStore';
import { usePomodoroStore } from '@/store/pomodoroStore';
import { useReviewStore } from '@/store/reviewStore';
import { useTaskStore } from '@/store/taskStore';

type Range = '7d' | '30d' | 'all';

const DAY_MS = 24 * 60 * 60 * 1000;

interface DayBucket {
  dateKey: string;
  tasksDone: number;
  inboxAdded: number;
  pomodoros: number;
}

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function StatsPage(): React.ReactElement {
  const t = useT();
  const [range, setRange] = useState<Range>('7d');

  const tasks = useTaskStore((s) => s.tasks);
  const inbox = useInboxStore((s) => s.items);
  const reviews = useReviewStore((s) => s.recent);
  const projects = useProjectStore((s) => s.projects);
  const todayPomodoros = usePomodoroStore((s) => s.todayCount);

  // v0.2.1 bug fix: 之前写在 render body 里（无 useEffect 包裹），每次 render 都触发，
  //   loadRecent 调 IPC → setState reviews → re-render → 又调 → 死循环 / 大量无效 IPC。
  //   现在：只在 mount 时调一次。
  const reviewLoadRecentRef = useRef(useReviewStore.getState().loadRecent);
  useEffect(() => {
    void reviewLoadRecentRef.current(60);
  }, []);

  const rangeMs = range === '7d' ? 7 * DAY_MS : range === '30d' ? 30 * DAY_MS : null;
  const cutoff = rangeMs === null ? 0 : Date.now() - rangeMs;

  // 任务完成：updatedAt 在 [cutoff, now] 且 status === 'done'
  const tasksDone = useMemo(
    () => tasks.filter((tk) => tk.status === 'done' && (rangeMs === null || tk.updatedAt >= cutoff)),
    [tasks, rangeMs, cutoff],
  );

  // 收集箱：createdAt 在 [cutoff, now]（active + archived + converted）
  const inboxAdded = useMemo(
    () => inbox.filter((it) => rangeMs === null || it.createdAt >= cutoff),
    [inbox, rangeMs, cutoff],
  );

  // 复盘：直接 reviews 是 [{date, ...}] 列表
  const reviewsInRange = useMemo(
    () => reviews.filter((r) => (rangeMs === null || new Date(r.date).getTime() >= cutoff)),
    [reviews, rangeMs, cutoff],
  );

  // 任务完成率（全部任务中 done 的比例）
  const allTasks = tasks.filter((tk) => tk.status !== 'archived');
  const completionRate = allTasks.length === 0 ? 0 : tasks.filter((tk) => tk.status === 'done').length / allTasks.length;

  // 连续复盘天数：reviews 按 date desc，依次看连续
  const streak = useMemo(() => {
    if (reviews.length === 0) return 0;
    const sorted = [...reviews]
      .map((r) => r.date)
      .filter((d, i, arr) => arr.indexOf(d) === i)
      .sort()
      .reverse();
    let s = 0;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let cursor = today.getTime();
    for (const d of sorted) {
      const t = new Date(d).getTime();
      if (t === cursor) {
        s += 1;
        cursor -= DAY_MS;
      } else if (t === cursor + DAY_MS) {
        // 容差：今天还没复盘但昨天有
        s += 1;
        cursor = t - DAY_MS;
      } else {
        break;
      }
    }
    return s;
  }, [reviews]);

  // 每日 bucket
  const buckets = useMemo<DayBucket[]>(() => {
    const days = rangeMs === null ? 30 : range === '7d' ? 7 : 30;
    const out: DayBucket[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - i);
      out.push({ dateKey: dateKey(d), tasksDone: 0, inboxAdded: 0, pomodoros: 0 });
    }
    for (const tk of tasksDone) {
      const k = dateKey(new Date(tk.updatedAt));
      const b = out.find((x) => x.dateKey === k);
      if (b) b.tasksDone += 1;
    }
    for (const it of inboxAdded) {
      const k = dateKey(new Date(it.createdAt));
      const b = out.find((x) => x.dateKey === k);
      if (b) b.inboxAdded += 1;
    }
    // 番茄：只展示今日
    if (out.length > 0) {
      const todayKey = dateKey(new Date());
      const today = out.find((b) => b.dateKey === todayKey);
      if (today) today.pomodoros = todayPomodoros;
    }
    return out;
  }, [range, rangeMs, tasksDone, inboxAdded, todayPomodoros]);

  // 按项目完成
  const byProject = useMemo(() => {
    const map = new Map<string, { projectId: string | null; name: string; total: number; done: number }>();
    for (const p of projects) {
      map.set(p.id, { projectId: p.id, name: p.name, total: 0, done: 0 });
    }
    map.set('__none__', { projectId: null, name: t.pages.projects.noProject, total: 0, done: 0 });
    for (const tk of tasks) {
      if (tk.status === 'archived') continue;
      const k = tk.projectId ?? '__none__';
      const row = map.get(k) ?? { projectId: tk.projectId, name: k === '__none__' ? t.pages.projects.noProject : '?', total: 0, done: 0 };
      row.total += 1;
      if (tk.status === 'done') row.done += 1;
      map.set(k, row);
    }
    return [...map.values()].filter((r) => r.total > 0);
  }, [projects, tasks, t]);

  if (tasks.length === 0 && inbox.length === 0 && reviews.length === 0) {
    return (
      <section className="flex h-full flex-col gap-3 p-6" data-testid="stats-page">
        <header>
          <h1 className="text-2xl font-semibold text-primary">{t.pages.stats.title}</h1>
          <p className="text-sm text-secondary">{t.pages.stats.subtitle}</p>
        </header>
        <div className="flex-1">
          <EmptyState
            icon={BarChart3}
            title={t.empty.stats.title}
            description={t.empty.stats.description}
            data-testid="stats-empty"
          />
        </div>
      </section>
    );
  }

  return (
    <section className="flex h-full flex-col gap-3 p-6" data-testid="stats-page">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-primary">{t.pages.stats.title}</h1>
          <p className="text-sm text-secondary">{t.pages.stats.subtitle}</p>
        </div>
        <div role="tablist" aria-label="Range" className="inline-flex rounded-md border border-line bg-elevated p-1 text-xs">
          {(['7d', '30d', 'all'] as Range[]).map((r) => (
            <button
              key={r}
              type="button"
              role="tab"
              aria-selected={range === r}
              data-testid={`stats-range-${r}`}
              onClick={() => setRange(r)}
              className={[
                'rounded px-3 py-1 transition-colors',
                range === r ? 'bg-accent text-inverse' : 'text-secondary hover:text-primary',
              ].join(' ')}
            >
              {r === '7d' ? t.pages.stats.range7 : r === '30d' ? t.pages.stats.range30 : t.pages.stats.rangeAll}
            </button>
          ))}
        </div>
      </header>

      {/* 指标卡片 */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <MetricCard
          testId="stat-tasks-done"
          title={t.pages.stats.taskDone}
          value={tasksDone.length}
          sub={t.pages.stats.taskDoneSub(tasksDone.length)}
        />
        <MetricCard
          testId="stat-inbox"
          title={t.pages.stats.inboxAdded}
          value={inboxAdded.length}
          sub={t.pages.stats.inboxAddedSub(inboxAdded.length)}
        />
        <MetricCard
          testId="stat-reviews"
          title={t.pages.stats.reviewCount}
          value={reviewsInRange.length}
          sub={t.pages.stats.reviewCountSub(reviewsInRange.length)}
        />
        <MetricCard
          testId="stat-completion"
          title={t.pages.stats.completionRate}
          value={t.pages.stats.completionRateSub(completionRate)}
          sub={`${tasks.filter((tk) => tk.status === 'done').length}/${allTasks.length}`}
        />
        <MetricCard
          testId="stat-pomodoros"
          title={t.pages.stats.pomodoros}
          value={todayPomodoros}
          sub={t.pages.stats.pomodorosSub(todayPomodoros)}
        />
        <MetricCard
          testId="stat-streak"
          title={t.pages.stats.streak}
          value={streak}
          sub={t.pages.stats.streakSub(streak)}
        />
      </div>

      {/* 每日活动柱状图 */}
      <section className="rounded-lg border border-line bg-base p-3 shadow-card" data-testid="stat-daily">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-medium text-primary">{t.pages.stats.byDay}</h2>
          <p className="text-[10px] text-secondary">{t.pages.stats.byDaySub}</p>
        </div>
        <DailyChart buckets={buckets} t={t} />
      </section>

      {/* 按项目 */}
      <section className="rounded-lg border border-line bg-base p-3 shadow-card" data-testid="stat-by-project">
        <h2 className="mb-2 text-sm font-medium text-primary">{t.pages.stats.byProject}</h2>
        {byProject.length === 0 ? (
          <p className="py-3 text-xs text-secondary">{t.pages.stats.byProjectEmpty}</p>
        ) : (
          <ul className="space-y-2">
            {byProject.map((row) => {
              const percent = row.total === 0 ? 0 : Math.round((row.done / row.total) * 100);
              return (
                <li key={row.projectId ?? '__none__'} className="flex items-center gap-2 text-xs">
                  <span className="w-32 shrink-0 truncate text-primary">{row.name}</span>
                  <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-elevated">
                    <div
                      className="h-full bg-accent transition-all"
                      style={{ width: `${percent}%` }}
                    />
                  </div>
                  <span className="w-20 shrink-0 text-right text-secondary">{row.done}/{row.total}</span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </section>
  );
}

interface MetricCardProps {
  title: string;
  value: number | string;
  sub: string;
  testId: string;
}

function MetricCard({ title, value, sub, testId }: MetricCardProps): React.ReactElement {
  return (
    <div
      data-testid={testId}
      className="rounded-lg border border-line bg-elevated p-3 shadow-card"
    >
      <p className="text-[10px] text-secondary">{title}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums text-primary">{value}</p>
      <p className="mt-0.5 text-[10px] text-secondary">{sub}</p>
    </div>
  );
}

interface DailyChartProps {
  buckets: DayBucket[];
  t: ReturnType<typeof useT>;
}

function DailyChart({ buckets, t }: DailyChartProps): React.ReactElement {
  // 找出最大值
  const max = Math.max(
    1,
    ...buckets.map((b) => Math.max(b.tasksDone, b.inboxAdded, b.pomodoros)),
  );
  return (
    <div className="flex h-32 items-end gap-1" data-testid="stat-daily-chart">
      {buckets.map((b) => {
        const tasksH = (b.tasksDone / max) * 100;
        const inboxH = (b.inboxAdded / max) * 100;
        const pomoH = (b.pomodoros / max) * 100;
        return (
          <div
            key={b.dateKey}
            className="flex h-full flex-1 flex-col items-center justify-end gap-0.5"
            title={`${b.dateKey}: ${b.tasksDone} ${t.pages.stats.taskDone} / ${b.inboxAdded} ${t.pages.stats.inboxAdded} / ${b.pomodoros} ${t.pages.stats.pomodoros}`}
          >
            <div className="flex h-full w-full items-end justify-center gap-0.5">
              {b.tasksDone > 0 ? (
                <div
                  className="w-1.5 rounded-sm bg-accent"
                  style={{ height: `${tasksH}%` }}
                  data-testid={`stat-bar-task-${b.dateKey}`}
                />
              ) : null}
              {b.inboxAdded > 0 ? (
                <div
                  className="w-1.5 rounded-sm bg-success"
                  style={{ height: `${inboxH}%` }}
                  data-testid={`stat-bar-inbox-${b.dateKey}`}
                />
              ) : null}
              {b.pomodoros > 0 ? (
                <div
                  className="w-1.5 rounded-sm bg-warning"
                  style={{ height: `${pomoH}%` }}
                  data-testid={`stat-bar-pomodoro-${b.dateKey}`}
                />
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
