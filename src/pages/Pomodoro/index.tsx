/**
 * 番茄钟页（v0.1.3 新功能）
 *
 * **功能**：
 *   - 25/5/15 计时（focus / shortBreak / longBreak）
 *   - 启动 / 暂停 / 重置 / 跳过
 *   - 关联任务（从 useTaskStore 选一条）
 *   - 今日完成数 + 配置调整
 *   - 模式自动切换（focus → break → focus）
 *
 * **设计**：
 *   - 状态全在 usePomodoroStore
 *   - setInterval 1s tick（仅 running 时）
 *   - 配置 + 今日数 持久化到 localStorage
 *
 * **不做**：
 *   - 不写 db（v0.1.x 不持久化历史；统计页只显示 sessionCount）
 *   - 不做任务完成联动（v0.1.x focus 完成只 +1 sessionCount，不动 task.status）
 */
import { useEffect, useMemo, useState } from 'react';
import { Play, Pause, RotateCcw, SkipForward, Settings as SettingsIcon, Timer as TimerIcon, Coffee, X } from 'lucide-react';

import { EmptyState } from '@/components/EmptyState/EmptyState';
import { useT } from '@/i18n';
import { usePomodoroStore, type PomodoroMode } from '@/store/pomodoroStore';
import { useTaskStore } from '@/store/taskStore';
import { toast } from '@/store/toastStore';

export default function PomodoroPage(): React.ReactElement {
  const t = useT();
  const status = usePomodoroStore((s) => s.status);
  const mode = usePomodoroStore((s) => s.mode);
  const totalMs = usePomodoroStore((s) => s.totalMs);
  const remainingMs = usePomodoroStore((s) => s.remainingMs);
  const todayCount = usePomodoroStore((s) => s.todayCount);
  const settings = usePomodoroStore((s) => s.settings);
  const linkedTaskId = usePomodoroStore((s) => s.linkedTaskId);
  const linkedTaskTitle = usePomodoroStore((s) => s.linkedTaskTitle);
  const start = usePomodoroStore((s) => s.start);
  const pause = usePomodoroStore((s) => s.pause);
  const resume = usePomodoroStore((s) => s.resume);
  const reset = usePomodoroStore((s) => s.reset);
  const skip = usePomodoroStore((s) => s.skip);
  const tick = usePomodoroStore((s) => s.tick);
  const updateSettings = usePomodoroStore((s) => s.updateSettings);
  const setLinkedTask = usePomodoroStore((s) => s.setLinkedTask);

  const tasks = useTaskStore((s) => s.tasks);
  const taskLoad = useTaskStore((s) => s.load);

  useEffect(() => {
    void taskLoad();
  }, [taskLoad]);

  // 1s tick（running 时）
  useEffect(() => {
    if (status !== 'running') return;
    const id = setInterval(() => {
      const beforeMode = usePomodoroStore.getState().mode;
      tick();
      const afterMode = usePomodoroStore.getState().mode;
      const afterStatus = usePomodoroStore.getState().status;
      // tick 把 mode 切到 next 时（idle + 新 mode）→ 弹 toast
      if (afterStatus === 'idle' && afterMode !== beforeMode) {
        if (afterMode === 'focus') {
          toast.info(t.toasts.pomodoroBreakComplete);
        } else {
          toast.success(t.toasts.pomodoroComplete);
        }
      }
    }, 1000);
    return () => clearInterval(id);
  }, [status, tick, t]);

  // 时间显示
  const min = Math.max(0, Math.floor(remainingMs / 60_000));
  const sec = Math.max(0, Math.floor((remainingMs % 60_000) / 1000));
  const timeLabel = t.pages.pomodoro.timeFormat(min, sec);
  const progress = totalMs > 0 ? 1 - remainingMs / totalMs : 0;

  // 模式 label
  const modeLabel: Record<PomodoroMode, string> = {
    focus: t.pages.pomodoro.modeFocus,
    shortBreak: t.pages.pomodoro.modeShortBreak,
    longBreak: t.pages.pomodoro.modeLongBreak,
  };

  // 设置面板
  const [settingsOpen, setSettingsOpen] = useState(false);

  // 任务选择面板
  const [pickerOpen, setPickerOpen] = useState(false);
  const activeTasks = useMemo(
    () => tasks.filter((tk) => tk.status !== 'archived' && tk.status !== 'done'),
    [tasks],
  );

  // 进度环（S）
  const ringSize = 220;
  const stroke = 10;
  const radius = (ringSize - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - progress);

  return (
    <section className="flex h-full flex-col gap-3 p-6" data-testid="pomodoro-page">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-primary">{t.pages.pomodoro.title}</h1>
          <p className="text-sm text-secondary">{t.pages.pomodoro.subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          <span
            data-testid="pomodoro-today-count"
            className="rounded-md border border-line bg-elevated px-2 py-1 text-xs text-secondary"
          >
            {t.pages.pomodoro.sessionCount(todayCount)}
          </span>
          <button
            type="button"
            data-testid="pomodoro-settings-toggle"
            onClick={() => setSettingsOpen((p) => !p)}
            className="rounded-md border border-line bg-elevated p-1.5 text-secondary transition-colors hover:text-primary"
            aria-label="Settings"
            title="Settings"
          >
            <SettingsIcon className="h-4 w-4" />
          </button>
        </div>
      </header>

      <div className="grid flex-1 grid-cols-1 gap-4 lg:grid-cols-[1fr_360px]">
        {/* 主区：计时器 + 控制 */}
        <div
          className="flex flex-col items-center justify-center gap-4 rounded-lg border border-line bg-base p-6 shadow-card"
          data-testid="pomodoro-timer"
        >
          {/* 模式切换 */}
          <div
            role="tablist"
            aria-label="Mode"
            className="inline-flex rounded-md border border-line bg-elevated p-1"
          >
            {(['focus', 'shortBreak', 'longBreak'] as PomodoroMode[]).map((m) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={mode === m}
                data-testid={`pomodoro-mode-${m}`}
                disabled={status === 'running'}
                onClick={() => {
                  if (status === 'running') return;
                  usePomodoroStore.getState().skip();
                  // 切到想要的 mode 后重置
                  const ps = usePomodoroStore.getState();
                  if (ps.mode !== m) {
                    usePomodoroStore.getState().skip();
                  }
                  // 多次 skip 直到 mode 匹配（最多 2 次）
                  let cur = usePomodoroStore.getState().mode;
                  let tries = 0;
                  while (cur !== m && tries < 3) {
                    usePomodoroStore.getState().skip();
                    cur = usePomodoroStore.getState().mode;
                    tries += 1;
                  }
                }}
                className={[
                  'rounded px-3 py-1 text-xs transition-colors',
                  mode === m ? 'bg-accent text-inverse' : 'text-secondary hover:text-primary',
                  'disabled:cursor-not-allowed disabled:opacity-50',
                ].join(' ')}
              >
                {modeLabel[m]}
              </button>
            ))}
          </div>

          {/* 进度环 */}
          <svg
            data-testid="pomodoro-ring"
            width={ringSize}
            height={ringSize}
            viewBox={`0 0 ${ringSize} ${ringSize}`}
            className="rotate-[-90deg]"
          >
            <circle
              cx={ringSize / 2}
              cy={ringSize / 2}
              r={radius}
              strokeWidth={stroke}
              fill="none"
              className="stroke-line"
            />
            <circle
              cx={ringSize / 2}
              cy={ringSize / 2}
              r={radius}
              strokeWidth={stroke}
              fill="none"
              className={mode === 'focus' ? 'stroke-accent' : 'stroke-success'}
              strokeDasharray={circumference}
              strokeDashoffset={dashOffset}
              strokeLinecap="round"
              style={{ transition: 'stroke-dashoffset 0.5s linear' }}
            />
          </svg>

          {/* 时间 */}
          <div
            data-testid="pomodoro-time"
            className="absolute font-mono text-5xl font-bold tabular-nums text-primary"
            style={{ marginTop: 0 }}
          >
            {timeLabel}
          </div>

          {/* 控制 */}
          <div className="flex items-center gap-2">
            {status === 'idle' ? (
              <button
                type="button"
                data-testid="pomodoro-start"
                onClick={start}
                className="inline-flex items-center gap-1 rounded-md bg-accent px-5 py-2 text-sm font-medium text-inverse transition-colors hover:bg-accent-hover"
              >
                <Play className="h-4 w-4" /> {t.pages.pomodoro.start}
              </button>
            ) : null}
            {status === 'running' ? (
              <button
                type="button"
                data-testid="pomodoro-pause"
                onClick={pause}
                className="inline-flex items-center gap-1 rounded-md border border-line bg-elevated px-5 py-2 text-sm text-primary transition-colors hover:border-accent hover:text-accent"
              >
                <Pause className="h-4 w-4" /> {t.pages.pomodoro.pause}
              </button>
            ) : null}
            {status === 'paused' ? (
              <button
                type="button"
                data-testid="pomodoro-resume"
                onClick={resume}
                className="inline-flex items-center gap-1 rounded-md bg-accent px-5 py-2 text-sm font-medium text-inverse transition-colors hover:bg-accent-hover"
              >
                <Play className="h-4 w-4" /> {t.pages.pomodoro.resume}
              </button>
            ) : null}
            <button
              type="button"
              data-testid="pomodoro-reset"
              onClick={reset}
              className="inline-flex items-center gap-1 rounded-md border border-line bg-elevated px-3 py-2 text-sm text-secondary transition-colors hover:border-accent hover:text-accent"
            >
              <RotateCcw className="h-4 w-4" /> {t.pages.pomodoro.reset}
            </button>
            <button
              type="button"
              data-testid="pomodoro-skip"
              onClick={skip}
              disabled={status === 'running'}
              className="inline-flex items-center gap-1 rounded-md border border-line bg-elevated px-3 py-2 text-sm text-secondary transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
            >
              <SkipForward className="h-4 w-4" /> {t.pages.pomodoro.skip}
            </button>
          </div>

          {/* 关联任务状态 */}
          <div className="flex items-center gap-2 rounded-md border border-line bg-elevated px-3 py-2 text-xs">
            <Coffee className="h-3.5 w-3.5 text-secondary" aria-hidden="true" />
            {linkedTaskId ? (
              <>
                <span className="text-primary">{t.pages.pomodoro.linkedTo(linkedTaskTitle ?? linkedTaskId)}</span>
                <button
                  type="button"
                  data-testid="pomodoro-unlink"
                  onClick={() => setLinkedTask(null, null)}
                  className="ml-1 inline-flex items-center gap-1 rounded text-secondary transition-colors hover:text-danger"
                >
                  <X className="h-3 w-3" /> {t.pages.pomodoro.unlinkTask}
                </button>
              </>
            ) : (
              <>
                <span className="text-secondary">{t.pages.pomodoro.noTaskPicked}</span>
                <button
                  type="button"
                  data-testid="pomodoro-pick-task"
                  onClick={() => setPickerOpen(true)}
                  className="ml-1 rounded text-accent transition-colors hover:text-accent-hover"
                >
                  {t.pages.pomodoro.linkTask}
                </button>
              </>
            )}
          </div>
        </div>

        {/* 右侧：设置 / 任务选择 */}
        <aside className="flex flex-col gap-3">
          {settingsOpen ? (
            <div className="rounded-lg border border-line bg-base p-3 shadow-card" data-testid="pomodoro-settings">
              <h3 className="mb-2 text-sm font-medium text-primary">Settings</h3>
              <div className="space-y-2 text-xs">
                <SettingNumber
                  label={t.pages.pomodoro.settings.focusMin}
                  value={settings.focusMin}
                  min={1}
                  max={120}
                  onChange={(v) => updateSettings({ focusMin: v })}
                  testId="pomodoro-focus-min"
                />
                <SettingNumber
                  label={t.pages.pomodoro.settings.shortBreakMin}
                  value={settings.shortBreakMin}
                  min={1}
                  max={60}
                  onChange={(v) => updateSettings({ shortBreakMin: v })}
                  testId="pomodoro-short-break-min"
                />
                <SettingNumber
                  label={t.pages.pomodoro.settings.longBreakMin}
                  value={settings.longBreakMin}
                  min={1}
                  max={120}
                  onChange={(v) => updateSettings({ longBreakMin: v })}
                  testId="pomodoro-long-break-min"
                />
                <SettingNumber
                  label={t.pages.pomodoro.settings.longBreakEvery}
                  value={settings.longBreakEvery}
                  min={1}
                  max={20}
                  onChange={(v) => updateSettings({ longBreakEvery: v })}
                  testId="pomodoro-long-break-every"
                />
              </div>
            </div>
          ) : null}

          {pickerOpen ? (
            <div
              role="dialog"
              aria-modal="true"
              data-testid="pomodoro-picker"
              className="rounded-lg border border-line bg-elevated p-2 shadow-card"
            >
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-medium text-primary">{t.pages.pomodoro.pickTask}</h3>
                <button
                  type="button"
                  onClick={() => setPickerOpen(false)}
                  className="rounded p-1 text-secondary hover:text-primary"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <p className="mb-2 text-[10px] text-secondary">{t.pages.pomodoro.pickTaskHint}</p>
              {activeTasks.length === 0 ? (
                <EmptyState
                  icon={TimerIcon}
                  title={t.pages.pomodoro.noTaskPicked}
                  description=""
                />
              ) : (
                <ul className="max-h-64 space-y-1 overflow-auto">
                  {activeTasks.map((tk) => (
                    <li key={tk.id}>
                      <button
                        type="button"
                        data-testid={`pomodoro-pick-${tk.id}`}
                        onClick={() => {
                          setLinkedTask(tk.id, tk.title);
                          setPickerOpen(false);
                        }}
                        className={[
                          'w-full rounded-md border px-2 py-1.5 text-left text-xs transition-colors',
                          linkedTaskId === tk.id
                            ? 'border-accent bg-accent-soft text-accent'
                            : 'border-line bg-base text-primary hover:border-accent',
                        ].join(' ')}
                      >
                        <p className="truncate">{tk.title}</p>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}
        </aside>
      </div>
    </section>
  );
}

interface SettingNumberProps {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  testId: string;
}

function SettingNumber({ label, value, min, max, onChange, testId }: SettingNumberProps): React.ReactElement {
  return (
    <label className="flex items-center justify-between gap-2 text-secondary">
      <span>{label}</span>
      <input
        type="number"
        data-testid={testId}
        value={value}
        min={min}
        max={max}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v)) onChange(Math.max(min, Math.min(max, Math.round(v))));
        }}
        className="w-16 rounded border border-line bg-base px-2 py-0.5 text-right text-primary outline-none focus:border-accent"
      />
    </label>
  );
}
