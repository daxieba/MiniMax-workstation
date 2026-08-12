/**
 * 日历页（v0.1.3 新功能）
 *
 * 按 dueDate 渲染任务到月历上。点击日期 → 弹出当日任务列表。
 *
 * **设计**：
 *   - 月历 grid 6×7（最多 6 周）
 *   - 每个日期格：日期号 + 该日任务数 badge + 前 2 条任务标题
 *   - 月首/月末跨月
 *   - 不引入第三方日历库（自己算 grid）
 *
 * **数据**：useTaskStore.tasks（已加载，dueDate 非空的任务）
 *   - 不调额外 IPC（task 列表加载时已包含 dueDate）
 *
 * **不做**：
 *   - 拖拽改 dueDate（v0.1.x 不做）
 *   - 周/日视图（v0.1.x 不做）
 *   - 任务创建（用户去「项目与任务」创建）
 */
import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, CalendarDays as CalIcon } from 'lucide-react';

import { EmptyState } from '@/components/EmptyState/EmptyState';
import { useT } from '@/i18n';
import { useTaskStore } from '@/store/taskStore';
import { startOfMonth, endOfMonth, startOfWeek, endOfWeek, addDays, isSameDay, isSameMonth, format } from '@/lib/dateUtils';
import type { Task } from '@shared/types/task';

interface DayCell {
  date: Date;
  inMonth: boolean;
  isToday: boolean;
  tasks: Task[];
}

/** 构造 6×7 = 42 格月历。 */
function buildMonthGrid(viewMonth: Date): DayCell[] {
  const first = startOfMonth(viewMonth);
  const last = endOfMonth(viewMonth);
  const gridStart = startOfWeek(first);
  const gridEnd = endOfWeek(last);
  const today = new Date();
  const cells: DayCell[] = [];
  let cur = gridStart;
  while (cur <= gridEnd) {
    cells.push({
      date: cur,
      inMonth: isSameMonth(cur, viewMonth),
      isToday: isSameDay(cur, today),
      tasks: [],
    });
    cur = addDays(cur, 1);
  }
  return cells;
}

export default function CalendarPage(): React.ReactElement {
  const t = useT();
  const tasks = useTaskStore((s) => s.tasks);
  const [viewMonth, setViewMonth] = useState<Date>(() => new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);

  // 按 dueDate 分组
  const tasksByDate = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const tk of tasks) {
      if (tk.dueDate === null || tk.status === 'archived') continue;
      const key = format(new Date(tk.dueDate), 'yyyy-MM-dd');
      const list = map.get(key) ?? [];
      list.push(tk);
      map.set(key, list);
    }
    return map;
  }, [tasks]);

  const grid = useMemo(() => {
    const cells = buildMonthGrid(viewMonth);
    for (const cell of cells) {
      const key = format(cell.date, 'yyyy-MM-dd');
      cell.tasks = tasksByDate.get(key) ?? [];
    }
    return cells;
  }, [viewMonth, tasksByDate]);

  const monthLabel = useMemo(() => {
    return format(viewMonth, t.pages.calendar.weekdaySun === '日' ? 'yyyy 年 MM 月' : 'MMM yyyy');
  }, [viewMonth, t]);

  const todayCount = useMemo(() => {
    const key = format(new Date(), 'yyyy-MM-dd');
    return tasksByDate.get(key)?.length ?? 0;
  }, [tasksByDate]);

  const handlePrev = (): void => {
    setViewMonth((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1));
  };
  const handleNext = (): void => {
    setViewMonth((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1));
  };
  const handleToday = (): void => {
    setViewMonth(new Date());
    setSelectedDate(new Date());
  };

  const weekdayLabels = [
    t.pages.calendar.weekdaySun,
    t.pages.calendar.weekdayMon,
    t.pages.calendar.weekdayTue,
    t.pages.calendar.weekdayWed,
    t.pages.calendar.weekdayThu,
    t.pages.calendar.weekdayFri,
    t.pages.calendar.weekdaySat,
  ];

  const monthTotal = grid.reduce((s, c) => s + c.tasks.length, 0);
  const selectedTasks = selectedDate
    ? tasksByDate.get(format(selectedDate, 'yyyy-MM-dd')) ?? []
    : [];

  if (tasks.length === 0) {
    return (
      <section className="flex h-full flex-col gap-3 p-6" data-testid="calendar-page">
        <CalendarHeader
          title={t.pages.calendar.title}
          subtitle={t.pages.calendar.subtitle}
          monthLabel={monthLabel}
          onPrev={handlePrev}
          onNext={handleNext}
          onToday={handleToday}
        />
        <div className="flex-1">
          <EmptyState
            icon={CalIcon}
            title={t.empty.calendar.title}
            description={t.empty.calendar.description}
            data-testid="calendar-empty"
          />
        </div>
      </section>
    );
  }

  return (
    <section className="flex h-full flex-col gap-3 p-6" data-testid="calendar-page">
      <CalendarHeader
        title={t.pages.calendar.title}
        subtitle={t.pages.calendar.subtitle}
        monthLabel={monthLabel}
        onPrev={handlePrev}
        onNext={handleNext}
        onToday={handleToday}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
        {/* 月历 */}
        <div className="rounded-lg border border-line bg-base p-3 shadow-card" data-testid="calendar-grid-wrap">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-medium text-primary">{monthLabel}</p>
            <p className="text-xs text-secondary">
              {t.pages.calendar.taskCount(monthTotal)} · {t.pages.calendar.taskCount(todayCount)} {t.pages.calendar.today}
            </p>
          </div>
          {/* 周表头 */}
          <div className="grid grid-cols-7 gap-1 text-center text-[10px] text-secondary">
            {weekdayLabels.map((w) => (
              <div key={w} className="py-1 font-medium uppercase">
                {w}
              </div>
            ))}
          </div>
          {/* 日期格 */}
          <div className="grid grid-cols-7 gap-1">
            {grid.map((cell) => {
              const isSelected = selectedDate !== null && isSameDay(cell.date, selectedDate);
              return (
                <button
                  key={cell.date.getTime()}
                  type="button"
                  data-testid={`calendar-day-${format(cell.date, 'yyyy-MM-dd')}`}
                  onClick={() => setSelectedDate(cell.date)}
                  className={[
                    'flex min-h-[5rem] flex-col items-start rounded border p-1.5 text-left transition-colors',
                    cell.inMonth ? 'bg-elevated' : 'bg-base/50 text-secondary/60',
                    cell.isToday ? 'border-accent ring-1 ring-accent' : 'border-line',
                    isSelected ? 'ring-2 ring-accent' : '',
                    'hover:border-accent',
                  ].join(' ')}
                >
                  <span
                    className={[
                      'text-xs font-medium',
                      cell.isToday ? 'text-accent' : '',
                    ].join(' ')}
                  >
                    {cell.date.getDate()}
                  </span>
                  {cell.tasks.length > 0 ? (
                    <span
                      data-testid={`calendar-day-count-${format(cell.date, 'yyyy-MM-dd')}`}
                      className="mt-0.5 self-start rounded bg-accent-soft px-1 text-[10px] font-medium text-accent"
                    >
                      {cell.tasks.length}
                    </span>
                  ) : null}
                  <div className="mt-1 flex w-full flex-col gap-0.5">
                    {cell.tasks.slice(0, 2).map((tk) => (
                      <span
                        key={tk.id}
                        className="truncate rounded bg-accent-soft px-1 text-[10px] text-accent"
                        title={tk.title}
                      >
                        {tk.title}
                      </span>
                    ))}
                    {cell.tasks.length > 2 ? (
                      <span className="text-[10px] text-secondary">+{cell.tasks.length - 2}</span>
                    ) : null}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* 右侧详情 */}
        <aside className="rounded-lg border border-line bg-base p-3 shadow-card" data-testid="calendar-detail">
          <h3 className="text-sm font-medium text-primary">
            {selectedDate ? format(selectedDate, t.pages.calendar.weekdaySun === '日' ? 'yyyy 年 MM 月 dd 日' : 'MMM d, yyyy') : t.pages.calendar.today}
          </h3>
          {selectedDate ? (
            <div className="mt-2 space-y-1">
              {selectedTasks.length === 0 ? (
                <p className="py-2 text-xs text-secondary">{t.pages.calendar.noTasks}</p>
              ) : (
                selectedTasks.map((tk) => (
                  <div
                    key={tk.id}
                    data-testid={`calendar-task-${tk.id}`}
                    className="rounded border border-line bg-elevated px-2 py-1.5 text-xs"
                  >
                    <p className="truncate text-primary">{tk.title}</p>
                    <p className="mt-0.5 text-[10px] text-secondary">
                      {statusLabel(tk.status, t)}
                    </p>
                  </div>
                ))
              )}
            </div>
          ) : (
            <p className="mt-2 py-2 text-xs text-secondary">← {t.pages.calendar.today} · {t.pages.calendar.taskCount(todayCount)}</p>
          )}
        </aside>
      </div>
    </section>
  );
}

interface HeaderProps {
  title: string;
  subtitle: string;
  monthLabel: string;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
}

function CalendarHeader({ title, subtitle, monthLabel, onPrev, onNext, onToday }: HeaderProps): React.ReactElement {
  return (
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold text-primary">{title}</h1>
        <p className="text-sm text-secondary">{subtitle}</p>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          data-testid="calendar-prev"
          onClick={onPrev}
          className="rounded-md border border-line bg-elevated p-1.5 text-secondary transition-colors hover:text-primary"
          aria-label={title}
          title={title}
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span data-testid="calendar-month-label" className="px-2 text-sm font-medium text-primary">
          {monthLabel}
        </span>
        <button
          type="button"
          data-testid="calendar-next"
          onClick={onNext}
          className="rounded-md border border-line bg-elevated p-1.5 text-secondary transition-colors hover:text-primary"
          aria-label={title}
          title={title}
        >
          <ChevronRight className="h-4 w-4" />
        </button>
        <button
          type="button"
          data-testid="calendar-today"
          onClick={onToday}
          className="rounded-md border border-line bg-elevated px-2 py-1 text-xs text-secondary transition-colors hover:border-accent hover:text-accent"
        >
          {title}
        </button>
      </div>
    </header>
  );
}

/** status → i18n label 辅助（避免引入任务 status 全套 i18n 字段）。 */
function statusLabel(s: Task['status'], t: ReturnType<typeof useT>): string {
  switch (s) {
    case 'todo':
      return t.pages.projects.statusTodo;
    case 'doing':
      return t.pages.projects.statusDoing;
    case 'done':
      return t.pages.projects.statusDone;
    case 'archived':
      return t.pages.projects.statusArchived;
  }
}
