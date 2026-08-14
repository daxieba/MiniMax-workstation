/**
 * 习惯打卡页（v0.4.0）
 *
 * v0.4.0 升级：
 *   - 单 habit 卡片：30 天折线 → **GitHub 风格 35 天热力图**（5 周 × 7 天，col-major）
 *   - 统计行：连续 / 本周 / **30 天完成率**（替换"总数"，总数挪到卡片右上小标）
 *   - 卡片右上"总打卡数"小标（总览用）
 *   - 卡片底部仍保留"今日打卡"大按钮
 *
 * 不做的事：
 *   - 不做提醒 / 通知（v0.4.x 范围外）
 *   - 不做拖拽排序
 *   - 不做编辑（v0.4.0 范围外 —— 只能 archive / unarchive / delete / create）
 */
import { useEffect, useMemo, useState } from 'react';
import { Check, Plus, Trash2, Archive, ArchiveRestore, Flame, BarChart3 } from 'lucide-react';

import { EmptyState } from '@/components/EmptyState/EmptyState';
import { useT } from '@/i18n';
import { useHabitStore } from '@/store/habitStore';
import { useSettingsStore } from '@/store/settingsStore';
import { todayString, computeStreak, computeThisWeekCount, computeLast30Days, dateToString } from '@/lib/habitStats';
import { toast } from '@/store/toastStore';
import type { Habit, HabitLog } from '@shared/types/habit';

// =============================================================
//  35 天热力图（GitHub contribution graph 风格）
// =============================================================

/**
 * 算 35 天热力图对应的日期数组（col-major：列=周，行=weekday）。
 * 从"5 周前的周开始日"开始，按 (col * 7 + row) 顺序填充 35 格。
 */
function buildHeatmapDays(today: string, weekStart: 'monday' | 'sunday'): string[] {
  const todayDate = new Date(today + 'T00:00:00');
  const start = new Date(todayDate);
  // 35 天前
  start.setDate(start.getDate() - 34);
  // 回到"周开始日"
  const day = start.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  if (weekStart === 'monday') {
    const offset = day === 0 ? 6 : day - 1;
    start.setDate(start.getDate() - offset);
  } else {
    start.setDate(start.getDate() - day);
  }
  const days: string[] = [];
  for (let i = 0; i < 35; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    days.push(dateToString(d));
  }
  return days;
}

interface HabitHeatmapProps {
  logs: HabitLog[];
  weekStart: 'monday' | 'sunday';
  today: string;
  /** 自定义颜色（habit.color）。null/undefined → 跟 accent 色板。 */
  color?: string | null;
}

function HabitHeatmap({ logs, weekStart, today, color }: HabitHeatmapProps): React.ReactElement {
  const t = useT();
  const days = useMemo(() => buildHeatmapDays(today, weekStart), [today, weekStart]);
  const loggedSet = useMemo(() => new Set(logs.map((l) => l.date)), [logs]);

  return (
    <div
      data-testid="habit-heatmap"
      className="grid grid-flow-col grid-rows-7 gap-[3px]"
      title={t.pages.habits.last30Days}
    >
      {days.map((d) => {
        const completed = loggedSet.has(d);
        const isToday = d === today;
        const isFuture = new Date(d + 'T00:00:00') > new Date(today + 'T00:00:00');
        return (
          <div
            key={d}
            data-completed={completed ? '1' : '0'}
            data-is-today={isToday ? '1' : '0'}
            data-is-future={isFuture ? '1' : '0'}
            className={[
              'h-3 w-3 rounded-sm transition-colors',
              isFuture
                ? 'bg-base opacity-30'
                : completed
                  ? isToday
                    ? 'ring-1 ring-offset-1 ring-offset-elevated'
                    : ''
                  : 'bg-elevated',
            ].join(' ')}
            style={
              completed
                ? color
                  ? { backgroundColor: color }
                  : undefined
                : undefined
            }
            title={`${d} ${completed ? '✓' : '·'}`}
          />
        );
      })}
    </div>
  );
}

// 占位 i18n 工具：避免每次都 `useT()` —— 实际上组件内用 useT() 拿 t，下面放一个辅助
// 实际我们直接 import useT 在内部组件用。

// =============================================================
//  单个 habit 卡片
// =============================================================

interface HabitCardProps {
  habit: Habit;
  logs: HabitLog[];
  onToggleToday: (habit: Habit) => void;
  onArchive: (habit: Habit) => void;
  onUnarchive: (habit: Habit) => void;
  onDelete: (habit: Habit) => void;
  weekStart: 'monday' | 'sunday';
  today: string;
}

function HabitCard({
  habit,
  logs,
  onToggleToday,
  onArchive,
  onUnarchive,
  onDelete,
  weekStart,
  today,
}: HabitCardProps): React.ReactElement {
  const t = useT();
  const habitLogs = useMemo(() => logs.filter((l) => l.habitId === habit.id), [logs, habit.id]);
  const loggedToday = habitLogs.some((l) => l.date === today);
  const streak = useMemo(() => computeStreak(habitLogs, today), [habitLogs, today]);
  const weekCount = useMemo(
    () => computeThisWeekCount(habitLogs, weekStart),
    [habitLogs, weekStart],
  );
  const last30 = useMemo(() => computeLast30Days(habitLogs), [habitLogs]);
  // 30 天完成率
  const rate30 = useMemo(() => {
    if (last30.length === 0) return 0;
    const done = last30.filter((d) => d.completed).length;
    return Math.round((done / last30.length) * 100);
  }, [last30]);

  return (
    <div
      data-testid={`habit-card-${habit.id}`}
      className="flex flex-col gap-3 rounded-lg border border-line bg-elevated p-4 shadow-card transition-shadow hover:shadow-md"
    >
      <header className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {habit.color ? (
            <span
              aria-hidden="true"
              className="h-3 w-3 shrink-0 rounded-full ring-1 ring-line"
              style={{ backgroundColor: habit.color }}
            />
          ) : null}
          {habit.icon ? (
            <span aria-hidden="true" className="text-lg">
              {habit.icon}
            </span>
          ) : null}
          <h3 className="truncate text-base font-semibold text-primary">{habit.name}</h3>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <span
            data-testid={`habit-total-${habit.id}`}
            className="rounded-md border border-line bg-base px-1.5 py-0.5 text-[10px] tabular-nums text-secondary"
            title={t.pages.habits.totalCount(habitLogs.length)}
          >
            {t.pages.habits.totalCount(habitLogs.length)}
          </span>
          <button
            type="button"
            data-testid={`habit-archive-${habit.id}`}
            onClick={() => (habit.archived ? onUnarchive(habit) : onArchive(habit))}
            title={habit.archived ? t.pages.habits.unarchive : t.pages.habits.archive}
            aria-label={habit.archived ? t.pages.habits.unarchive : t.pages.habits.archive}
            className="rounded p-1 text-secondary transition-colors hover:bg-base hover:text-primary"
          >
            {habit.archived ? (
              <ArchiveRestore className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <Archive className="h-3.5 w-3.5" aria-hidden="true" />
            )}
          </button>
          <button
            type="button"
            data-testid={`habit-delete-${habit.id}`}
            onClick={() => onDelete(habit)}
            title={t.pages.habits.delete}
            aria-label={t.pages.habits.delete}
            className="rounded p-1 text-secondary transition-colors hover:bg-base hover:text-danger"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      </header>

      {/* 35 天热力图 */}
      <HabitHeatmap logs={habitLogs} weekStart={weekStart} today={today} color={habit.color} />

      {/* 统计行：连续 / 本周 / 30 天率 */}
      <div className="grid grid-cols-3 gap-2 text-center">
        <div
          data-testid={`habit-stat-streak-${habit.id}`}
          className="rounded-md border border-line bg-base px-2 py-1.5"
        >
          <div className="flex items-center justify-center gap-1 text-[10px] uppercase tracking-wide text-secondary">
            <Flame className="h-3 w-3" aria-hidden="true" />
            STREAK
          </div>
          <div className="mt-0.5 text-sm font-semibold text-primary tabular-nums">
            {streak > 0 ? t.pages.habits.streak(streak) : t.pages.habits.streakZero}
          </div>
        </div>
        <div
          data-testid={`habit-stat-week-${habit.id}`}
          className="rounded-md border border-line bg-base px-2 py-1.5"
        >
          <div className="text-[10px] uppercase tracking-wide text-secondary">
            {habit.weeklyTarget > 0 ? `${habit.weeklyTarget}/wk` : 'WEEK'}
          </div>
          <div className="mt-0.5 text-sm font-semibold text-primary tabular-nums">
            {t.pages.habits.thisWeek(weekCount, habit.weeklyTarget)}
          </div>
        </div>
        <div
          data-testid={`habit-stat-rate-${habit.id}`}
          className="rounded-md border border-line bg-base px-2 py-1.5"
        >
          <div className="text-[10px] uppercase tracking-wide text-secondary">30D</div>
          <div className="mt-0.5 text-sm font-semibold text-primary tabular-nums">
            {rate30}%
          </div>
        </div>
      </div>

      {/* 今日打卡按钮 */}
      <button
        type="button"
        data-testid={`habit-check-${habit.id}`}
        onClick={() => onToggleToday(habit)}
        aria-pressed={loggedToday}
        className={[
          'inline-flex w-full items-center justify-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors',
          loggedToday
            ? 'border-accent bg-accent text-inverse'
            : 'border-line bg-base text-secondary hover:border-accent hover:text-accent',
        ].join(' ')}
      >
        <Check className="h-4 w-4" aria-hidden="true" />
        {t.pages.habits.todayCheck}
      </button>
    </div>
  );
}

// =============================================================
//  新建习惯表单
// =============================================================

interface NewHabitFormProps {
  onCreate: (input: { name: string; icon?: string; color?: string | null; weeklyTarget?: number }) => Promise<void>;
}

function NewHabitForm({ onCreate }: NewHabitFormProps): React.ReactElement {
  const t = useT();
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('');
  const [color, setColor] = useState('#22c55e');
  const [target, setTarget] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (): Promise<void> => {
    if (name.trim().length === 0) return;
    setSubmitting(true);
    try {
      await onCreate({
        name: name.trim(),
        icon: icon.trim(),
        color: color,
        weeklyTarget: target,
      });
      setName('');
      setIcon('');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      data-testid="habit-new-form"
      className="flex flex-wrap items-end gap-2 rounded-lg border border-line bg-elevated p-3 shadow-card"
      onSubmit={(e) => {
        e.preventDefault();
        void handleSubmit();
      }}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <label className="text-[10px] uppercase tracking-wide text-secondary">
          {t.pages.habits.newHabit}
        </label>
        <input
          type="text"
          data-testid="habit-new-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t.pages.habits.addHabitPlaceholder}
          maxLength={60}
          className="rounded-md border border-line bg-base px-2 py-1.5 text-sm text-primary outline-none focus:border-accent"
        />
      </div>
      <div className="flex w-20 flex-col gap-1">
        <label className="text-[10px] uppercase tracking-wide text-secondary">
          {t.pages.habits.addIconPlaceholder.split('（')[0]}
        </label>
        <input
          type="text"
          data-testid="habit-new-icon"
          value={icon}
          onChange={(e) => setIcon(e.target.value)}
          placeholder="🌱"
          maxLength={16}
          className="rounded-md border border-line bg-base px-2 py-1.5 text-center text-sm outline-none focus:border-accent"
        />
      </div>
      <div className="flex w-20 flex-col gap-1">
        <label className="text-[10px] uppercase tracking-wide text-secondary">
          {t.pages.habits.colorLabel}
        </label>
        <input
          type="color"
          data-testid="habit-new-color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
          className="h-8 w-full cursor-pointer rounded-md border border-line bg-base"
        />
      </div>
      <div className="flex w-32 flex-col gap-1">
        <label className="text-[10px] uppercase tracking-wide text-secondary">
          {t.pages.habits.weeklyTargetLabel}
        </label>
        <select
          data-testid="habit-new-target"
          value={target}
          onChange={(e) => setTarget(Number(e.target.value))}
          className="rounded-md border border-line bg-base px-2 py-1.5 text-sm outline-none focus:border-accent"
        >
          {([0, 1, 2, 3, 4, 5, 6, 7] as const).map((n) => (
            <option key={n} value={n}>
              {t.pages.habits.weeklyTargets[String(n) as '0'] ?? String(n)}
            </option>
          ))}
        </select>
      </div>
      <button
        type="submit"
        data-testid="habit-new-submit"
        disabled={submitting || name.trim().length === 0}
        className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-inverse transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
        {t.pages.habits.add}
      </button>
    </form>
  );
}

// =============================================================
//  主组件
// =============================================================

export default function HabitsPage(): React.ReactElement {
  const t = useT();
  const habits = useHabitStore((s) => s.habits);
  const logs = useHabitStore((s) => s.logs);
  const loading = useHabitStore((s) => s.loading);
  const habitLoad = useHabitStore((s) => s.load);
  const habitCreate = useHabitStore((s) => s.create);
  const habitArchive = useHabitStore((s) => s.archive);
  const habitRemove = useHabitStore((s) => s.remove);
  const habitToggleLog = useHabitStore((s) => s.toggleLog);

  const weekStart = useSettingsStore((s) => s.prefs.weekStart);

  const today = todayString();

  useEffect(() => {
    void habitLoad();
  }, [habitLoad]);

  const handleCreate = async (input: {
    name: string;
    icon?: string;
    color?: string | null;
    weeklyTarget?: number;
  }): Promise<void> => {
    const created = await habitCreate(input);
    if (created) {
      toast.success(`「${created.name}」已添加`);
    }
  };

  const handleToggleToday = async (habit: Habit): Promise<void> => {
    await habitToggleLog(habit.id, today);
  };

  const handleArchive = async (habit: Habit): Promise<void> => {
    const ok = window.confirm(t.pages.habits.archiveConfirm(habit.name));
    if (!ok) return;
    await habitArchive(habit.id, true);
  };

  const handleUnarchive = async (habit: Habit): Promise<void> => {
    await habitArchive(habit.id, false);
  };

  const handleDelete = async (habit: Habit): Promise<void> => {
    const ok = window.confirm(t.pages.habits.deleteConfirm(habit.name));
    if (!ok) return;
    const ok2 = await habitRemove(habit.id);
    if (ok2) {
      toast.success(`已删除「${habit.name}」`);
    }
  };

  return (
    <section
      data-testid="habits-page"
      className="flex h-full flex-col gap-4 overflow-auto p-6"
    >
      <header>
        <h1 className="text-2xl font-semibold text-primary">{t.pages.habits.title}</h1>
        <p className="text-sm text-secondary">{t.pages.habits.subtitle}</p>
      </header>

      <NewHabitForm onCreate={handleCreate} />

      {habits.length === 0 ? (
        <EmptyState
          icon={BarChart3}
          title={t.pages.habits.empty}
          description={t.pages.habits.emptyDesc}
          data-testid="habits-empty"
        />
      ) : (
        <div
          data-testid="habits-grid"
          className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3"
        >
          {habits.map((h) => (
            <HabitCard
              key={h.id}
              habit={h}
              logs={logs}
              onToggleToday={handleToggleToday}
              onArchive={handleArchive}
              onUnarchive={handleUnarchive}
              onDelete={handleDelete}
              weekStart={weekStart}
              today={today}
            />
          ))}
        </div>
      )}

      {loading ? (
        <p className="text-xs text-secondary">加载中…</p>
      ) : null}
    </section>
  );
}
