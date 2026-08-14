/**
 * 习惯（Habit）共享类型（v0.4.0）
 *
 * 渲染端 / 主进程 / preload 共用的接口 + 基础枚举。
 * 与 `db/schema/habit.ts` 的 db row 对应（Date → number 转换）。
 */

/** 单条 habit（IPC DTO）。 */
export interface Habit {
  id: string;
  name: string;
  icon: string;
  color: string | null;
  weeklyTarget: number;
  archived: boolean;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

/** 单条 habit log（一条打卡记录，IPC DTO）。 */
export interface HabitLog {
  habitId: string;
  date: string;
  loggedAt: number;
  note: string;
}
