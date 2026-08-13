/**
 * 番茄钟 store（v0.1.3 新功能）
 *
 * 设计：
 *   - 状态机：idle / running / paused
 *   - mode: focus / shortBreak / longBreak
 *   - remaining: 当前计时剩余 ms
 *   - sessionCount: 今日完成的番茄数（每天 0 点重置，简单实现）
 *   - linkedTaskId / linkedTaskTitle: 关联任务（可选）
 *   - 配置：focusMin / shortBreakMin / longBreakMin / longBreakEvery
 *
 * **持久化**：仅 settings + todayCount 持久化到 localStorage。
 *  - reason：避免每次刷新丢失设置 / 当日计数
 *  - 不持久化 running 状态（页面 reload 后默认 idle）
 *
 * **不做**：
 *   - 不持久化 remaining（页面 reload 重新计时到完整周期更友好）
 *   - 不做历史天数（v0.1.x 不需要；统计页只显示 sessionCount）
 */
import { create } from 'zustand';

export type PomodoroMode = 'focus' | 'shortBreak' | 'longBreak';
export type PomodoroStatus = 'idle' | 'running' | 'paused';

export interface PomodoroSettings {
  focusMin: number;
  shortBreakMin: number;
  longBreakMin: number;
  longBreakEvery: number;
}

const DEFAULT_SETTINGS: PomodoroSettings = {
  focusMin: 25,
  shortBreakMin: 5,
  longBreakMin: 15,
  longBreakEvery: 4,
};

const STORAGE_KEY = 'minimax.workstation.pomodoro';
const STORAGE_VERSION = 1;

interface PersistedShape {
  v: number;
  settings: PomodoroSettings;
  todayCount: number;
  todayDate: string; // 'yyyy-MM-dd'
}

function loadPersisted(): { settings: PomodoroSettings; todayCount: number; todayDate: string } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { settings: DEFAULT_SETTINGS, todayCount: 0, todayDate: todayString() };
    const parsed = JSON.parse(raw) as PersistedShape;
    if (parsed.v !== STORAGE_VERSION || !parsed.settings) {
      return { settings: DEFAULT_SETTINGS, todayCount: 0, todayDate: todayString() };
    }
    // 跨天：todayCount 重置
    const today = todayString();
    if (parsed.todayDate !== today) {
      return { settings: parsed.settings, todayCount: 0, todayDate: today };
    }
    return { settings: parsed.settings, todayCount: parsed.todayCount ?? 0, todayDate: today };
  } catch {
    return { settings: DEFAULT_SETTINGS, todayCount: 0, todayDate: todayString() };
  }
}

function todayString(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function savePersisted(state: { settings: PomodoroSettings; todayCount: number; todayDate: string }): void {
  try {
    const payload: PersistedShape = { v: STORAGE_VERSION, ...state };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // ignore
  }
}

export interface PomodoroState {
  status: PomodoroStatus;
  mode: PomodoroMode;
  /** 当前周期总时长（ms）。remaining = total - elapsed。 */
  totalMs: number;
  remainingMs: number;
  /** 今日完成的 focus 数。 */
  todayCount: number;
  /** todayCount 所属的日期 'yyyy-MM-dd'（跨天自动重置）。 */
  todayDate: string;
  settings: PomodoroSettings;
  /** 当前 mode 之前连续完成 focus 的数量（用于判断下一个是否 longBreak）。 */
  focusStreak: number;
  linkedTaskId: string | null;
  linkedTaskTitle: string | null;

  // actions
  start: () => void;
  pause: () => void;
  resume: () => void;
  reset: () => void;
  /** 跳过当前 mode（不计入完成），切到下一个 mode。 */
  skip: () => void;
  /** v0.3.0: 显式切到指定 mode（reset 计时 + idle）。 */
  setMode: (mode: PomodoroMode) => void;
  /** 内部：tick 1s 减 remaining；归零时调 onComplete（由组件传入）。 */
  tick: () => void;
  /** 切换 settings（持久化）。 */
  updateSettings: (patch: Partial<PomodoroSettings>) => void;
  /** 关联 / 取消关联任务。 */
  setLinkedTask: (id: string | null, title: string | null) => void;
  /** 完整周期长度（ms），按当前 mode 算。 */
  totalForMode: (mode: PomodoroMode) => number;
}

const initial = loadPersisted();

export const usePomodoroStore = create<PomodoroState>((set, get) => {
  const initialMode: PomodoroMode = 'focus';
  const totalMs = getTotalForMode(DEFAULT_SETTINGS, initialMode);
  return {
    status: 'idle',
    mode: initialMode,
    totalMs,
    remainingMs: totalMs,
    todayCount: initial.todayCount,
    todayDate: initial.todayDate,
    settings: initial.settings,
    focusStreak: 0,
    linkedTaskId: null,
    linkedTaskTitle: null,

    start: () => {
      set({ status: 'running' });
    },
    pause: () => {
      set({ status: 'paused' });
    },
    resume: () => {
      set({ status: 'running' });
    },
    reset: () => {
      const { mode, settings } = get();
      const total = getTotalForMode(settings, mode);
      set({ status: 'idle', remainingMs: total, totalMs: total });
    },
    skip: () => {
      const { mode } = get();
      const next = nextMode(get(), mode);
      const total = getTotalForMode(get().settings, next);
      set({ status: 'idle', mode: next, totalMs: total, remainingMs: total });
    },
    setMode: (mode) => {
      // v0.3.0: 显式设置 mode，重置计时器 + 切到 idle。
      // 不计入 todayCount（用户从 Overview 快速启动，应是"开始一段专注"，不计入完成）。
      const total = getTotalForMode(get().settings, mode);
      set({ mode, status: 'idle', totalMs: total, remainingMs: total });
    },
    tick: () => {
      const { status, remainingMs, mode, focusStreak, settings, todayCount, todayDate } = get();
      if (status !== 'running') return;
      const next = remainingMs - 1000;
      if (next > 0) {
        set({ remainingMs: next });
        return;
      }
      // 完成
      const completedMode = mode;
      const newTodayCount = completedMode === 'focus' ? todayCount + 1 : todayCount;
      const newStreak = completedMode === 'focus' ? focusStreak + 1 : focusStreak;
      const nextM = completedMode === 'focus'
        ? (newStreak % settings.longBreakEvery === 0 ? 'longBreak' : 'shortBreak')
        : 'focus';
      const total = getTotalForMode(settings, nextM);
      const nextState: Partial<PomodoroState> = {
        status: 'idle',
        mode: nextM,
        totalMs: total,
        remainingMs: total,
        todayCount: newTodayCount,
        focusStreak: newStreak,
        todayDate,
      };
      set(nextState);
      savePersisted({ settings, todayCount: newTodayCount, todayDate });
    },
    updateSettings: (patch) => {
      const settings = { ...get().settings, ...patch };
      const { mode, status } = get();
      // 只在 idle 状态调整 total/remaining（避免 running 时被改）
      const total = getTotalForMode(settings, mode);
      if (status === 'idle') {
        set({ settings, totalMs: total, remainingMs: total });
      } else {
        set({ settings });
      }
      savePersisted({ settings, todayCount: get().todayCount, todayDate: get().todayDate });
    },
    setLinkedTask: (id, title) => {
      set({ linkedTaskId: id, linkedTaskTitle: title });
    },
    totalForMode: (mode) => getTotalForMode(get().settings, mode),
  };
});

function getTotalForMode(s: PomodoroSettings, mode: PomodoroMode): number {
  const min = mode === 'focus' ? s.focusMin : mode === 'shortBreak' ? s.shortBreakMin : s.longBreakMin;
  return Math.max(1, min) * 60_000;
}

function nextMode(state: { settings: PomodoroSettings; focusStreak: number }, current: PomodoroMode): PomodoroMode {
  if (current !== 'focus') return 'focus';
  // focus → break（看 streak 决定 long / short）
  return (state.focusStreak + 1) % state.settings.longBreakEvery === 0 ? 'longBreak' : 'shortBreak';
}
