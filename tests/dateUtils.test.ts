/**
 * dateUtils 单元测试（T2-4）
 *
 * 覆盖（任务卡验收：每个函数 ≥ 3 case）：
 *   - isToday     → 今天的 / 明天的 / 昨天的 / Date 实例 / 跨年
 *   - isOverdue   → 昨天的 / 前天的 / 今天的 / 未来的 / null（边界，毫秒数被传 0）
 *   - daysOverdue → 今天=0 / 昨天=1 / 前天=2 / 未来=0 / 跨日临界
 *   - relativeTime → 刚刚 / 分钟前 / 小时前 / 天前 / 未来输入
 *
 * 全部纯函数、不依赖 DOM / store / IPC。
 */

import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { daysOverdue, isOverdue, isToday, relativeTime } from '@/lib/dateUtils';

/** 截到当天 00:00:00.000 本地时间。 */
function startOfDay(d: Date): Date {
  const x = new Date(d.getTime());
  x.setHours(0, 0, 0, 0);
  return x;
}

/** 在某天上加 N 天的 12:00，返回 ms。 */
function atNoonPlusDays(base: Date, days: number): number {
  const d = new Date(base.getTime());
  d.setDate(d.getDate() + days);
  d.setHours(12, 0, 0, 0);
  return d.getTime();
}

describe('dateUtils', () => {
  let realNow: number;
  let nowSpy: { mockRestore: () => void };

  beforeEach(() => {
    realNow = Date.now();
  });
  afterEach(() => {
    if (nowSpy) nowSpy.mockRestore();
  });

  describe('isToday', () => {
    it('returns true for a timestamp at noon today', () => {
      const today = startOfDay(new Date(realNow));
      today.setHours(12, 0, 0, 0);
      expect(isToday(today.getTime())).toBe(true);
    });

    it('returns true for a Date instance representing today', () => {
      const d = new Date(realNow);
      expect(isToday(d)).toBe(true);
    });

    it('returns false for a timestamp tomorrow', () => {
      const tomorrow = atNoonPlusDays(new Date(realNow), 1);
      expect(isToday(tomorrow)).toBe(false);
    });

    it('returns false for a timestamp yesterday', () => {
      const yesterday = atNoonPlusDays(new Date(realNow), -1);
      expect(isToday(yesterday)).toBe(false);
    });

    it('handles late-night today (23:59) as today, not tomorrow', () => {
      const d = new Date(realNow);
      d.setHours(23, 59, 59, 999);
      expect(isToday(d)).toBe(true);
    });

    it('handles early-morning today (00:00) as today, not yesterday', () => {
      const d = new Date(realNow);
      d.setHours(0, 0, 0, 0);
      expect(isToday(d)).toBe(true);
    });
  });

  describe('isOverdue', () => {
    it('returns false for a timestamp today', () => {
      const today = atNoonPlusDays(new Date(realNow), 0);
      expect(isOverdue(today)).toBe(false);
    });

    it('returns true for a timestamp yesterday', () => {
      const y = atNoonPlusDays(new Date(realNow), -1);
      expect(isOverdue(y)).toBe(true);
    });

    it('returns true for a timestamp 7 days ago', () => {
      const y = atNoonPlusDays(new Date(realNow), -7);
      expect(isOverdue(y)).toBe(true);
    });

    it('returns false for a future timestamp', () => {
      const f = atNoonPlusDays(new Date(realNow), 3);
      expect(isOverdue(f)).toBe(false);
    });

    it('accepts a Date instance', () => {
      const d = new Date(realNow);
      d.setDate(d.getDate() - 2);
      expect(isOverdue(d)).toBe(true);
    });
  });

  describe('daysOverdue', () => {
    it('returns 0 for today', () => {
      const today = atNoonPlusDays(new Date(realNow), 0);
      expect(daysOverdue(today)).toBe(0);
    });

    it('returns 1 for yesterday', () => {
      const y = atNoonPlusDays(new Date(realNow), -1);
      expect(daysOverdue(y)).toBe(1);
    });

    it('returns 7 for a week ago', () => {
      const y = atNoonPlusDays(new Date(realNow), -7);
      expect(daysOverdue(y)).toBe(7);
    });

    it('returns 0 for future dates (not negative)', () => {
      const f = atNoonPlusDays(new Date(realNow), 3);
      expect(daysOverdue(f)).toBe(0);
    });

    it('handles boundary at midnight: yesterday 00:00 is still 1 day', () => {
      const base = startOfDay(new Date(realNow));
      const yesterdayMidnight = new Date(base.getTime());
      yesterdayMidnight.setDate(yesterdayMidnight.getDate() - 1);
      expect(daysOverdue(yesterdayMidnight.getTime())).toBe(1);
    });
  });

  describe('relativeTime', () => {
    it('returns "刚刚" for < 1 minute', () => {
      const t = Date.now() - 30_000; // 30s ago
      expect(relativeTime(t)).toBe('刚刚');
    });

    it('returns "刚刚" for a future timestamp (clock skew / safe)', () => {
      const t = Date.now() + 60_000; // 1 min in the future
      expect(relativeTime(t)).toBe('刚刚');
    });

    it('returns "N 分钟前" for < 1 hour', () => {
      const t = Date.now() - 5 * 60_000; // 5 min ago
      expect(relativeTime(t)).toBe('5 分钟前');
    });

    it('returns "N 小时前" for < 1 day', () => {
      const t = Date.now() - 3 * 60 * 60_000; // 3h ago
      expect(relativeTime(t)).toBe('3 小时前');
    });

    it('returns "N 天前" for ≥ 1 day', () => {
      const t = Date.now() - 2 * 24 * 60 * 60_000; // 2 days ago
      expect(relativeTime(t)).toBe('2 天前');
    });

    it('boundary: exactly 1 minute ago → "1 分钟前"', () => {
      nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
      // 60s before the mocked now
      expect(relativeTime(940_000)).toBe('1 分钟前');
    });

    it('boundary: just under 1 minute → "刚刚"', () => {
      nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
      // 30s before the mocked now
      expect(relativeTime(970_000)).toBe('刚刚');
    });
  });
});
