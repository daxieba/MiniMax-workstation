/**
 * 习惯统计工具（v0.4.0）
 *
 * 应用层从 `HabitLog[]` 算出：
 *   - streak 连续天数（从今天往前数连续有打卡的日期）
 *   - 本周完成数（周一到周日）
 *   - 总打卡数
 *
 * 不存任何 db 状态 —— 全是纯函数。
 */

import type { HabitLog } from '@shared/types/habit';

/** 计算一个 habit 的连续打卡天数（从今天往前）。 */
export function computeStreak(
  logs: HabitLog[],
  today: string = dateToString(new Date()),
): number {
  if (logs.length === 0) return 0;
  const loggedSet = new Set(logs.map((l) => l.date));
  const cursor = new Date(today + 'T00:00:00');
  let streak = 0;
  // 第一天：今天或昨天（容差：今天没打卡但昨天打卡也算连续）
  if (!loggedSet.has(today)) {
    cursor.setDate(cursor.getDate() - 1);
    if (!loggedSet.has(dateToString(cursor))) {
      return 0;
    }
  }
  while (loggedSet.has(dateToString(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

/** 把 Date → `YYYY-MM-DD`（本地时区）。 */
export function dateToString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 计算一个 habit 在本周（默认周一到周日）打卡的次数。 */
export function computeThisWeekCount(
  logs: HabitLog[],
  weekStart: 'monday' | 'sunday' = 'monday',
  today: Date = new Date(),
): number {
  if (logs.length === 0) return 0;
  const loggedSet = new Set(logs.map((l) => l.date));
  const start = new Date(today);
  start.setHours(0, 0, 0, 0);
  // 取本周起点
  const day = start.getDay(); // 0=Sun, 1=Mon, ... 6=Sat
  if (weekStart === 'monday') {
    // 本周一：day === 0 时回到 6（前一周日是周六）
    const offset = day === 0 ? 6 : day - 1;
    start.setDate(start.getDate() - offset);
  } else {
    start.setDate(start.getDate() - day);
  }
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  let count = 0;
  for (const d = new Date(start); d < end; d.setDate(d.getDate() + 1)) {
    if (loggedSet.has(dateToString(d))) count += 1;
  }
  return count;
}

/** 计算一个 habit 在最近 N 天（含今天）的打卡次数（用于 30 天折线图）。 */
export function computeLast30Days(
  logs: HabitLog[],
  today: Date = new Date(),
): Array<{ date: string; completed: boolean }> {
  const loggedSet = new Set(logs.map((l) => l.date));
  const result: Array<{ date: string; completed: boolean }> = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dateStr = dateToString(d);
    result.push({ date: dateStr, completed: loggedSet.has(dateStr) });
  }
  return result;
}

/** 今天日期（本地时区，`YYYY-MM-DD`）。 */
export function todayString(): string {
  return dateToString(new Date());
}
