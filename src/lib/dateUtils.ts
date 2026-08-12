/**
 * 渲染端日期工具（T2-4 总览页）
 *
 * **职责**：提供"今天 / 逾期 / 相对时间"的纯函数。
 *
 * **设计原则**（PROJECT_IDENTITY.md §3.2）：
 *   - 纯函数：零 I/O、零副作用，可独立单测
 *   - 接受 `number | Date`（number 为 Unix 毫秒；Date 用于测试 / 已有 Date 实例）
 *   - "今日"用 start-of-day 比较，避免时分秒造成 off-by-one
 *
 * **不做**：
 *   - 不解析字符串（截止日期是 `number` ms，不做 i18n 文案本地化以外的语义）
 *   - 不做复杂 locale（`relativeTime` 只输出 zh-CN 短串）
 *   - 不引入 dayjs / date-fns（身份卡未授权新依赖）
 *
 * @used-by src/pages/Overview
 * @used-by tests/dateUtils.test.ts
 */

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;

/** 把入参规整为 Date。 */
function toDate(value: number | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

/** 截到当地零点（返回 ms 时间戳）。 */
function startOfDay(d: Date): number {
  const x = new Date(d.getTime());
  x.setHours(0, 0, 0, 0);
  return x.getTime();
}

/**
 * 判断给定时间是否"今天"（基于本地时区，与 0 点比较）。
 *
 * @param value Unix 毫秒或 Date
 * @returns true 表示今天
 */
export function isToday(value: number | Date): boolean {
  return startOfDay(toDate(value)) === startOfDay(new Date());
}

/**
 * 判断给定时间是否严格早于"今天"（基于本地时区）。
 *
 * "今天"不视为逾期；只有 start-of-day 早于今天的才算逾期。
 *
 * @param value Unix 毫秒或 Date
 * @returns true 表示逾期
 */
export function isOverdue(value: number | Date): boolean {
  return startOfDay(toDate(value)) < startOfDay(new Date());
}

/**
 * 距今天数（0 = 今天，1 = 昨天，2 = 前天…）。
 *
 * 未来日期返回 0（不视为逾期）。
 *
 * @param value Unix 毫秒或 Date
 * @returns 距今天数（≥ 0）
 */
export function daysOverdue(value: number | Date): number {
  const today = startOfDay(new Date());
  const due = startOfDay(toDate(value));
  if (due >= today) return 0;
  return Math.round((today - due) / MS_PER_DAY);
}

/**
 * 相对时间（zh-CN 短串）。
 *
 * 输出档位：
 *   - 未来或 < 1 分钟   → "刚刚"
 *   - < 1 小时          → "N 分钟前"
 *   - < 1 天            → "N 小时前"
 *   - ≥ 1 天            → "N 天前"
 *
 * 注意：只用本地时区 + `Date.now()`，不做 locale 切换。
 *
 * @param value Unix 毫秒或 Date
 * @returns 人类可读短串
 */
export function relativeTime(value: number | Date): string {
  const d = toDate(value);
  const diff = Date.now() - d.getTime();
  if (diff < MS_PER_MINUTE) return '刚刚';
  if (diff < MS_PER_HOUR) return `${Math.floor(diff / MS_PER_MINUTE)} 分钟前`;
  if (diff < MS_PER_DAY) return `${Math.floor(diff / MS_PER_HOUR)} 小时前`;
  const days = Math.floor(diff / MS_PER_DAY);
  return `${days} 天前`;
}

// ============================================================
//  v0.1.3 增强：日历 / 番茄钟 / 统计用
// ============================================================

/**
 * 加 / 减天数（返回新 Date）。
 *
 * @param d 基准日期
 * @param n 天数（负数 = 减）
 * @returns 新 Date 实例
 */
export function addDays(d: Date, n: number): Date {
  const x = new Date(d.getTime());
  x.setDate(x.getDate() + n);
  return x;
}

/**
 * 加 / 减月（返回新 Date；月末 day 自动 clamp）。
 *
 * @param d 基准日期
 * @param n 月数（负数 = 减）
 */
export function addMonths(d: Date, n: number): Date {
  const x = new Date(d.getTime());
  const targetMonth = x.getMonth() + n;
  x.setMonth(targetMonth);
  // 如果 setMonth 溢出（例如 1/31 + 1 月 = 3/03 in JS），已经自动 clamp 到目标月
  return x;
}

/** 当月 1 号 00:00。 */
export function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

/** 当月最后一天 23:59:59.999。 */
export function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
}

/**
 * 所在周的周日开始（00:00）。
 * 注意：周日开始 = 美国习惯；如果将来要改成周一开始，把 0 换成 1。
 */
export function startOfWeek(d: Date): Date {
  return startOfDayLocal(addDays(d, -d.getDay()));
}

/** 所在周的周六结束（23:59:59.999）。 */
export function endOfWeek(d: Date): Date {
  return endOfDayLocal(addDays(d, 6 - d.getDay()));
}

/** 当天 00:00:00.000（返回 Date）。 */
export function startOfDayLocal(d: Date): Date {
  const x = new Date(d.getTime());
  x.setHours(0, 0, 0, 0);
  return x;
}

/** 当天 23:59:59.999（返回 Date）。 */
export function endOfDayLocal(d: Date): Date {
  const x = new Date(d.getTime());
  x.setHours(23, 59, 59, 999);
  return x;
}

/** 是否同年同月同日。 */
export function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** 是否同年同月。 */
export function isSameMonth(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

/**
 * 简易日期格式化。
 * 模式：
 *   - `yyyy` 4 位年
 *   - `yy`   2 位年
 *   - `MM`   2 位月
 *   - `M`    月（无前导 0）
 *   - `dd`   2 位日
 *   - `d`    日
 *   - `HH`   2 位小时（24）
 *   - `mm`   2 位分钟
 *   - `MMM`  短月名（en：Jan/Feb/…；zh：1 月/2 月/…）
 */
export function format(d: Date, pattern: string): string {
  const yyyy = String(d.getFullYear());
  const yy = yyyy.slice(-2);
  const M = d.getMonth() + 1;
  const MM = String(M).padStart(2, '0');
  const day = d.getDate();
  const dd = String(day).padStart(2, '0');
  const HH = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  // 用一组中性的月份短名；上层 i18n 通过传入 pattern 控制
  const MMM_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return pattern
    .replace(/yyyy/g, yyyy)
    .replace(/yy/g, yy)
    .replace(/MMM/g, MMM_EN[M - 1] ?? '???')
    .replace(/MM/g, MM)
    .replace(/M/g, String(M))
    .replace(/dd/g, dd)
    .replace(/d/g, String(day))
    .replace(/HH/g, HH)
    .replace(/mm/g, mm);
}
