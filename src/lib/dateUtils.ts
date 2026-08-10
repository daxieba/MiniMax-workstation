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
