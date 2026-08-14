/**
 * 习惯（Habit）渲染端 store（v0.4.0）
 *
 * 缓存 habits + logs，调 `window.api.habit.*` 走 IPC。
 *
 * 派生数据：今日打卡状态（map of habitId → bool），从 logs 计算。
 *
 * 不做的事：
 *   - 不做 streak 计算（用 `lib/habitStats` 的纯函数）
 *   - 不做持久化（所有数据走 IPC + db）
 */
import { create } from 'zustand';

import type { Habit, HabitLog } from '@shared/types/habit';

interface ApiHabit {
  list: (filter?: { archived?: boolean }) => Promise<
    | { ok: true; data: Habit[] }
    | { ok: false; error: { code: string; message: string } }
  >;
  create: (input: {
    name: string;
    icon?: string;
    color?: string | null;
    weeklyTarget?: number;
  }) => Promise<{ ok: true; data: Habit } | { ok: false; error: { code: string; message: string } }>;
  update: (input: {
    id: string;
    patch: Partial<{
      name: string;
      icon: string;
      color: string | null;
      weeklyTarget: number;
      archived: boolean;
    }>;
  }) => Promise<{ ok: true; data: Habit } | { ok: false; error: { code: string; message: string } }>;
  archive: (input: { id: string; archived?: boolean }) => Promise<
    { ok: true; data: Habit } | { ok: false; error: { code: string; message: string } }
  >;
  delete: (input: { id: string }) => Promise<
    { ok: true; data: { deleted: true } } | { ok: false; error: { code: string; message: string } }
  >;
  toggleLog: (input: { habitId: string; date: string }) => Promise<
    | { ok: true; data: { habitId: string; date: string; completed: boolean } }
    | { ok: false; error: { code: string; message: string } }
  >;
  listLogs: (input: {
    habitId: string;
    fromDate?: string;
    toDate?: string;
  }) => Promise<{ ok: true; data: HabitLog[] } | { ok: false; error: { code: string; message: string } }>;
  logsInRange: (input: { fromDate: string; toDate: string }) => Promise<
    { ok: true; data: HabitLog[] } | { ok: false; error: { code: string; message: string } }
  >;
}

function getHabitApi(): ApiHabit | null {
  if (typeof window === 'undefined') return null;
  return (window as unknown as { api?: { habit?: ApiHabit } }).api?.habit ?? null;
}

export interface HabitState {
  habits: Habit[];
  logs: HabitLog[];
  loading: boolean;
  error: string | null;

  load: () => Promise<void>;
  create: (input: { name: string; icon?: string; color?: string | null; weeklyTarget?: number }) => Promise<Habit | null>;
  update: (id: string, patch: Partial<{
    name: string;
    icon: string;
    color: string | null;
    weeklyTarget: number;
    archived: boolean;
  }>) => Promise<Habit | null>;
  archive: (id: string, archived?: boolean) => Promise<Habit | null>;
  remove: (id: string) => Promise<boolean>;
  toggleLog: (habitId: string, date: string) => Promise<boolean>;
}

export const useHabitStore = create<HabitState>((set, get) => ({
  habits: [],
  logs: [],
  loading: false,
  error: null,

  async load(): Promise<void> {
    const api = getHabitApi();
    if (!api) {
      set({ habits: [], logs: [], loading: false, error: null });
      return;
    }
    set({ loading: true, error: null });
    try {
      const [habitsRes, todayStr] = await Promise.all([
        api.list({ archived: false }),
        Promise.resolve(new Date().toISOString().slice(0, 10)),
      ]);
      // 计算 90 天前的日期，拉 90 天 logs（足够计算 streak / 折线图）
      const fromDate = new Date();
      fromDate.setDate(fromDate.getDate() - 90);
      const fromDateStr = fromDate.toISOString().slice(0, 10);
      const logsRes = await api.logsInRange({ fromDate: fromDateStr, toDate: todayStr });
      if (habitsRes.ok && logsRes.ok) {
        set({
          habits: habitsRes.data,
          logs: logsRes.data,
          loading: false,
          error: null,
        });
      } else {
        const msg =
          !habitsRes.ok ? habitsRes.error.message : logsRes.ok ? '' : logsRes.error.message;
        set({ loading: false, error: msg });
      }
    } catch (err) {
      set({ loading: false, error: err instanceof Error ? err.message : String(err) });
    }
  },

  async create(input): Promise<Habit | null> {
    const api = getHabitApi();
    if (!api) return null;
    try {
      const res = await api.create(input);
      if (res.ok) {
        set({ habits: [res.data, ...get().habits] });
        return res.data;
      }
      set({ error: res.error.message });
      return null;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      return null;
    }
  },

  async update(id, patch): Promise<Habit | null> {
    const api = getHabitApi();
    if (!api) return null;
    try {
      const res = await api.update({ id, patch });
      if (res.ok) {
        set({
          habits: get().habits.map((h) => (h.id === id ? res.data : h)),
        });
        return res.data;
      }
      set({ error: res.error.message });
      return null;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      return null;
    }
  },

  async archive(id, archived = true): Promise<Habit | null> {
    const api = getHabitApi();
    if (!api) return null;
    try {
      const res = await api.archive({ id, archived });
      if (res.ok) {
        if (archived) {
          // 归档：移出 visible 列表
          set({ habits: get().habits.filter((h) => h.id !== id) });
        } else {
          set({ habits: get().habits.map((h) => (h.id === id ? res.data : h)) });
        }
        return res.data;
      }
      set({ error: res.error.message });
      return null;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      return null;
    }
  },

  async remove(id): Promise<boolean> {
    const api = getHabitApi();
    if (!api) return false;
    try {
      const res = await api.delete({ id });
      if (res.ok) {
        set({
          habits: get().habits.filter((h) => h.id !== id),
          logs: get().logs.filter((l) => l.habitId !== id),
        });
        return true;
      }
      set({ error: res.error.message });
      return false;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      return false;
    }
  },

  async toggleLog(habitId, date): Promise<boolean> {
    const api = getHabitApi();
    if (!api) return false;
    try {
      const res = await api.toggleLog({ habitId, date });
      if (res.ok) {
        const currentLogs = get().logs;
        if (res.data.completed) {
          // 加一条 log
          if (!currentLogs.find((l) => l.habitId === habitId && l.date === date)) {
            set({
              logs: [
                ...currentLogs,
                { habitId, date, loggedAt: Date.now(), note: '' },
              ],
            });
          }
        } else {
          // 删一条 log
          set({
            logs: currentLogs.filter((l) => !(l.habitId === habitId && l.date === date)),
          });
        }
        return res.data.completed;
      }
      set({ error: res.error.message });
      return false;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      return false;
    }
  },
}));
