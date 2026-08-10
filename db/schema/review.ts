/**
 * `reviews` 表 schema（T5-1 每日复盘）
 *
 * 复盘（Review）是工作台"每日复盘"模块的核心实体。固定 5 段模板：
 *   - 今天完成
 *   - 未完成
 *   - 阻塞
 *   - 明天三件事
 *   - AI 草稿（仅内存，用户采纳后才入库）
 *
 * **字段规范**（PROJECT_IDENTITY.md §5.3）：
 *   - 主键：`id`（ULID，26 字符文本）
 *   - 时间戳：`created_at` / `updated_at`（Unix 毫秒，Drizzle `timestamp_ms`）
 *   - `date`：`YYYY-MM-DD` 文本，唯一约束（一天一条复盘）
 *
 * **JSON 字段**（SQLite 无数组类型）：
 *   - `completed`   完成项：数组 of `{ taskId, title }`（来自 tasks 表，可能已被删）
 *   - `uncompleted` 未完成项：数组 of `{ taskId, title, reason? }`
 *   - `topThree`    明日三件事：数组 of 字符串
 *   - `aiDraft`     AI 草稿：ReviewDraft 对象（null = 未生成 / 已采纳后清空）
 *
 * 全部用 Drizzle `mode: 'json'` 自动 (de)serialize；DB 层仍是 text。
 *
 * **重要约束**：
 *   - `aiDraft` **不**自动写入正式字段 —— 用户必须走 `review:update` 把
 *     `aiDraft` 内容显式写入 `completed` / `uncompleted` / `blockers` / `topThree`，
 *     然后清空 `aiDraft`（避免下次启动再次展示同一份草稿）。
 *   - `date` 唯一约束 = 一天一条复盘（无重复日期）
 *
 * **不存**：
 *   - 关联任务 id 列表（**不**走 FK —— SQLite 不支持数组外键，渲染端读
 *     `completed` / `uncompleted` 时按 `taskId` 配合 taskStore 过滤"任务已删除"）
 *   - 项目分组（复盘是日维度，不分项目）
 *
 * **索引**：`idx_reviews_date_desc`（`date DESC`）—— `review:listRecent` 用。
 *
 * **命名**（PROJECT_IDENTITY.md §3.1）：表名 `reviews`（snake_case 复数），
 * 字段名 camelCase TS / snake_case SQL。
 *
 * @used-by T5-1 每日复盘 UI / 后续 T5-2 周复盘 / T5-3 月复盘
 */

import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/** Review 草稿结构（也是 `aiDraft` 字段类型，IPC DTO）。 */
export interface ReviewDraftRow {
  completed: string[];
  uncompleted: Array<{ title: string; reason?: string | undefined }>;
  blockers: string;
  topThree: string[];
}

/** 完成项 / 未完成项行（在 `completed` / `uncompleted` 数组里）。 */
export interface ReviewItemRow {
  taskId: string;
  title: string;
  reason?: string | undefined;
}

/** `reviews` 表的 Drizzle schema。 */
export const reviews = sqliteTable('reviews', {
  /** ULID 主键（26 字符）。 */
  id: text('id').primaryKey(),

  /**
   * 复盘日期（`YYYY-MM-DD`）。
   *
   * 唯一约束：一天一条复盘。upsert 走 `ON CONFLICT(date)`。
   */
  date: text('date').notNull().unique(),

  /**
   * 完成项（JSON 字符串数组）。
   * 元素：`{ taskId, title }` —— taskId 可能指向已删除的任务（业务层容错）。
   */
  completed: text('completed', { mode: 'json' })
    .$type<ReviewItemRow[]>()
    .notNull()
    .default([]),

  /**
   * 未完成项（JSON 字符串数组）。
   * 元素：`{ taskId, title, reason? }`。
   */
  uncompleted: text('uncompleted', { mode: 'json' })
    .$type<ReviewItemRow[]>()
    .notNull()
    .default([]),

  /** 阻塞（自由文本，0..4096 字符）。 */
  blockers: text('blockers').notNull().default(''),

  /**
   * 明日三件事（JSON 字符串数组），最多 3 条。
   * 元素是纯字符串标题。
   */
  topThree: text('top_three', { mode: 'json' })
    .$type<string[]>()
    .notNull()
    .default([]),

  /**
   * AI 草稿（JSON 字符串，可空）。
   *
   * **不**自动写入正式字段 —— 用户必须走 `review:update` 显式采纳并清空
   * `aiDraft`。`null` 表示"未生成 / 已采纳"。
   */
  aiDraft: text('ai_draft', { mode: 'json' }).$type<ReviewDraftRow | null>(),

  /** 创建时间（Unix 毫秒）。 */
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),

  /** 更新时间（Unix 毫秒）。每次 update 应刷新。 */
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
});
// 注：`idx_reviews_date_desc` 索引由 `db/migrations/0006_init_reviews.sql` 手写 DDL 创建；
// Drizzle 0.36 的 `index().on(table.col.desc())` 在 SQLite 下与 drizzle-kit 的解析偶有冲突，
// 本卡走 raw SQL 路径更稳。

/** 单行 `reviews` 的 TS 类型（数据库行 = select）。 */
export type ReviewRow = typeof reviews.$inferSelect;

/** 插入 `reviews` 时的 TS 类型（缺省字段由 $defaultFn / 列 default 填充）。 */
export type ReviewInsert = typeof reviews.$inferInsert;
