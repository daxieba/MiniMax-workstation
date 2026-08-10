/**
 * `projects` 表 schema（T2-1 业务表）
 *
 * 项目（Project）是任务（tasks）和收集箱条目（inbox_items）可选的归属分组。
 * 第一版不实现成员协作（PROJECT_IDENTITY.md §1），所以 projects 本身只承载：
 *   - 名称 / 描述 / 颜色（用于 UI 标签色）
 *   - 归档标志（archived：0/1）
 *
 * **字段规范**（遵循 PROJECT_IDENTITY.md §5.3）：
 *   - 主键：`id`（ULID，26 字符文本）
 *   - 时间戳：`created_at` / `updated_at`（Unix 毫秒，Drizzle `timestamp_ms`）
 *   - 软删除：项目不软删除（用 `archived` 即可），故不加 `deleted_at`
 *
 * **命名**（PROJECT_IDENTITY.md §3.1）：表名 `projects`（snake_case 复数），
 * 字段名 `projectId`（camelCase TS） / `project_id`（snake_case SQL）。
 *
 * **不存**：
 *   - 成员关系（多用户协作为第一版不做项）
 *   - 排序权重（顺序由 UI 决定，不需要 schema 字段）
 *
 * @used-by T2-1 业务表 / T2-3 项目 UI / 后续 tasks / inbox_items 的 FK
 */

import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/** `projects` 表的 Drizzle schema。 */
export const projects = sqliteTable('projects', {
  /** ULID 主键（26 字符）。 */
  id: text('id').primaryKey(),

  /** 项目名（必填，非空字符串）。 */
  name: text('name').notNull(),

  /** 项目描述（可空，UI 上是多行文本框）。 */
  description: text('description'),

  /**
   * 标签色（hex 字符串，例 `#3B82F6`）。用于 UI 上项目徽章背景色。
   * 业务层可不填（UI fallback 到中性灰）。
   */
  color: text('color'),

  /**
   * 归档标志（SQLite 用 0/1 表示布尔，0 = 未归档，1 = 已归档）。
   * 不加 `default(false)` —— Drizzle SQLite 用 `.default(0)` 数字字面量更稳。
   */
  archived: integer('archived').notNull().default(0),

  /** 创建时间（Unix 毫秒）。 */
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),

  /** 更新时间（Unix 毫秒）。每次 update 应刷新。 */
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
});

/** 单行 `projects` 的 TS 类型（数据库行 = select）。 */
export type ProjectRow = typeof projects.$inferSelect;

/** 插入 `projects` 时的 TS 类型（缺省字段由 $defaultFn / 列 default 填充）。 */
export type ProjectInsert = typeof projects.$inferInsert;
