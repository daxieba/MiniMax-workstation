/**
 * habitStats 纯函数单元测试（v0.4.0）
 *
 * 覆盖：
 *   - `dateToString` / `todayString`：日期 ↔ 字符串转换
 *   - `computeStreak`：连续天数（含"今天未打卡但昨天打卡"容差）
 *   - `computeThisWeekCount`：本周完成数（周一 / 周日起）
 *   - `computeLast30Days`：最近 30 天逐天状态
 *
 * 不依赖 db / IPC / React —— 纯函数逻辑。
 */
import { describe, expect, it } from 'vitest';
import {
  computeStreak,
  computeThisWeekCount,
  computeLast30Days,
  dateToString,
  todayString,
} from '@/lib/habitStats';
import type { HabitLog } from '@shared/types/habit';

/** 构造一条 log（测试 helper）。 */
function log(date: string): HabitLog {
  return { habitId: 'h1', date, loggedAt: 0, note: '' };
}

/** 固定 today 字符串避免运行时变化。 */
const TODAY = '2026-08-14';

describe('dateToString', () => {
  it('formats Date as YYYY-MM-DD (本地时区)', () => {
    expect(dateToString(new Date(2026, 0, 1))).toBe('2026-01-01'); // 月份 0-based
    expect(dateToString(new Date(2026, 11, 31))).toBe('2026-12-31');
  });
  it('pads single-digit month / day with 0', () => {
    expect(dateToString(new Date(2026, 2, 5))).toBe('2026-03-05');
  });
});

describe('todayString', () => {
  it('returns today in YYYY-MM-DD', () => {
    const s = todayString();
    expect(s).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(s).toBe(dateToString(new Date()));
  });
});

describe('computeStreak', () => {
  it('returns 0 for empty logs', () => {
    expect(computeStreak([], TODAY)).toBe(0);
  });
  it('counts 1 if only today is logged', () => {
    expect(computeStreak([log(TODAY)], TODAY)).toBe(1);
  });
  it('counts back-to-back days starting from today', () => {
    expect(
      computeStreak([log(TODAY), log('2026-08-13'), log('2026-08-12')], TODAY),
    ).toBe(3);
  });
  it('breaks at first missed day', () => {
    expect(
      computeStreak([log(TODAY), log('2026-08-12')], TODAY),
    ).toBe(1);
  });
  it('tolerates "today not logged yet but yesterday logged"', () => {
    // 今天没打卡但昨天 + 之前都打卡 → 应该从昨天算
    expect(
      computeStreak([log('2026-08-13'), log('2026-08-12')], TODAY),
    ).toBe(2);
  });
  it('returns 0 if neither today nor yesterday logged', () => {
    expect(computeStreak([log('2026-08-12')], TODAY)).toBe(0);
  });
  it('handles long streak (30 days)', () => {
    const logs: HabitLog[] = [];
    for (let i = 0; i < 30; i++) {
      const d = new Date(TODAY + 'T00:00:00');
      d.setDate(d.getDate() - i);
      logs.push(log(dateToString(d)));
    }
    expect(computeStreak(logs, TODAY)).toBe(30);
  });
});

describe('computeThisWeekCount', () => {
  it('returns 0 for empty logs', () => {
    expect(computeThisWeekCount([], 'monday', new Date(TODAY + 'T12:00:00'))).toBe(0);
  });
  it('counts all logs in current week (monday-start)', () => {
    // 2026-08-14 是星期五；本周一是 2026-08-10
    const logs = [
      log('2026-08-10'), // 周一
      log('2026-08-11'),
      log('2026-08-12'),
      log('2026-08-13'),
      log('2026-08-14'), // 周五（今天）
    ];
    expect(computeThisWeekCount(logs, 'monday', new Date(TODAY + 'T12:00:00'))).toBe(5);
  });
  it('excludes logs from previous week (monday-start)', () => {
    // 2026-08-14 周五；上周一是 2026-08-03
    const logs = [log('2026-08-03'), log('2026-08-09')]; // 上周
    expect(computeThisWeekCount(logs, 'monday', new Date(TODAY + 'T12:00:00'))).toBe(0);
  });
  it('handles sunday-start (week includes current Sunday + Mon-Sat)', () => {
    // 2026-08-14 周五；本周日（sunday-start）= 2026-08-09
    const logs = [
      log('2026-08-09'), // 本周日
      log('2026-08-10'),
      log('2026-08-11'),
      log('2026-08-12'),
      log('2026-08-13'),
      log('2026-08-14'),
    ];
    expect(computeThisWeekCount(logs, 'sunday', new Date(TODAY + 'T12:00:00'))).toBe(6);
  });
});

describe('computeLast30Days', () => {
  it('returns 30 entries, oldest first', () => {
    const out = computeLast30Days([], new Date(TODAY + 'T12:00:00'));
    expect(out).toHaveLength(30);
    // 第一项是 29 天前
    expect(out[0]?.date).toBe('2026-07-16');
    // 最后一项是今天
    expect(out[29]?.date).toBe(TODAY);
  });
  it('marks completed days correctly', () => {
    const logs = [log('2026-08-12'), log('2026-08-13')];
    const out = computeLast30Days(logs, new Date(TODAY + 'T12:00:00'));
    expect(out.find((d) => d.date === '2026-08-12')?.completed).toBe(true);
    expect(out.find((d) => d.date === '2026-08-13')?.completed).toBe(true);
    expect(out.find((d) => d.date === '2026-08-14')?.completed).toBe(false);
  });
  it('handles empty logs (all completed=false)', () => {
    const out = computeLast30Days([], new Date(TODAY + 'T12:00:00'));
    expect(out.every((d) => d.completed === false)).toBe(true);
  });
});
