/**
 * `habits` + `habit_logs` 表 schema (v0.4.0 习惯打卡)
 *
 * 设计：
 *   - `habits`：用户定义的习惯（名称 / 颜色 / 图标 / 每周目标）
 *   - `habit_logs`：每条"打卡"记录（一个 habit 在某一天是否完成）
 *
 * **字段规范**（PROJECT_IDENTITY.md §5.3）：
 *   - 主键：`id`（ULID，26 字符文本）
 *   - 时间戳：`created_at` / `updated_at`（Unix 毫秒）
 *   - `date`：`YYYY-MM-DD` 文本（用于 streak 计算）
 *
 * **habit_logs 联合主键**：(habit_id, date) —— 一个习惯一天只能打一次
 *
 * **不存**：
 *   - 提醒时间（v0.4.0 不做提醒，留 v0.5.x）
 *   - 复杂统计（连续天数由应用层从 log 算）
 *
 * @used-by v0.4.0 Habits 页 + Overview widget
 */

import { integer, sqliteTable, text, primaryKey } from 'drizzle-orm/sqlite-core';

/** `habits` 表 schema。 */
export const habits = sqliteTable('habits', {
  /** ULID 主键（26 字符）。 */
  id: text('id').primaryKey(),

  /** 习惯名称（1..60 字符）。 */
  name: text('name').notNull(),

  /** 习惯图标（emoji 或字符，0..16 字符；默认空）。 */
  icon: text('icon').notNull().default(''),

  /** 颜色（hex #RRGGBB，可空）。 */
  color: text('color'),

  /**
   * 每周目标打卡次数（0..7）。
   * 0 = 不限；1..7 = 每周至少 N 次。
   * 用于 Overview 显示"本周完成 N/N"。
   */
  weeklyTarget: integer('weekly_target').notNull().default(0),

  /** 归档（软删）。已归档的习惯不计入 Overview。 */
  archived: integer('archived', { mode: 'boolean' }).notNull().default(false),

  /** 排序权重（数值越小越靠前；v0.4.0 默认按 createdAt desc，应用层排序不持久化）。 */
  sortOrder: integer('sort_order').notNull().default(0),

  /** 创建时间（Unix 毫秒）。 */
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),

  /** 更新时间（Unix 毫秒）。 */
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
});

/** 单行 `habits` 的 TS 类型。 */
export type HabitRow = typeof habits.$inferSelect;

/** 插入 `habits` 时的 TS 类型。 */
export type HabitInsert = typeof habits.$inferInsert;

/** `habit_logs` 表 schema（每条打卡记录）。 */
export const habitLogs = sqliteTable(
  'habit_logs',
  {
    /** 关联 habit.id（FK 不强约束，应用层负责一致性）。 */
    habitId: text('habit_id').notNull(),

    /** 打卡日期（`YYYY-MM-DD`）。 */
    date: text('date').notNull(),

    /** 打卡时间（Unix 毫秒，可选；用于精确"几点打的卡"统计）。 */
    loggedAt: integer('logged_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),

    /** 备注（0..200 字符；可选）。 */
    note: text('note').notNull().default(''),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.habitId, table.date] }),
  }),
);

/** 单行 `habit_logs` 的 TS 类型。 */
export type HabitLogRow = typeof habitLogs.$inferSelect;

/** 插入 `habit_logs` 时的 TS 类型。 */
export type HabitLogInsert = typeof habitLogs.$inferInsert;
