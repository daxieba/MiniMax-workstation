/**
 * `inbox_items` 表 schema（T2-1 业务表）
 *
 * 收集箱（Inbox）条目的持久化。第一版收集箱支持 4 种 `kind`：
 *   - `note`  一句话想法 / 文字片段
 *   - `todo`  明确的待办（用户自己先标了 todo）
 *   - `file`  文件路径
 *   - `link`  网页链接
 *
 * `source` 标识条目来源：
 *   - `manual` 用户在收集箱 UI 手动录入（默认）
 *   - `ai`     AI 工作区把结果回写到收集箱（"待确认区"思路，T3-x 实现）
 *   - `inbox`  转发 / 复制自其他条目（预留，T4-x 知识库可能用）
 *
 * `status` 标识条目生命周期：
 *   - `active`    正常显示在收集箱（默认）
 *   - `archived`  软归档（用户主动隐藏，仍可搜到）
 *   - `converted` 已转成 task / note，`convertedTo` 字段填目标资源 id
 *     （格式：`task:<ulid>` 或 `note:<ulid>`，schema 层不强制格式，UI/IPC 层做）
 *
 * **字段规范**（PROJECT_IDENTITY.md §5.3）：
 *   - 主键：`id`（ULID）
 *   - 时间戳：`created_at` / `updated_at`
 *   - 软删除：`deleted_at` 可空（收集箱条目可硬删除 / 软删除由 IPC 层决定）
 *
 * **JSON 字段**（SQLite 无数组类型）：`tags` 存 JSON 字符串数组，应用层用 Zod 解析。
 *
 * **外键**：`project_id` → `projects.id`（可空，收集箱条目可不归属项目）。
 * inbox_items 不级联删除 projects —— 项目删除策略由 T2-3 业务卡定义。
 *
 * @used-by T2-1 业务表 / T2-2 收集箱 UI / T3-x AI 写回
 */

import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { projects } from './project';

/** `inbox_items` 表的 Drizzle schema。 */
export const inboxItems = sqliteTable('inbox_items', {
  /** ULID 主键（26 字符）。 */
  id: text('id').primaryKey(),

  /** 条目正文（必填）。对 `file` / `link` 这里是路径 / URL。 */
  content: text('content').notNull(),

  /**
   * 条目种类：`note` | `todo` | `file` | `link`。
   * 应用层用 `InboxKindSchema` (Zod) 校验，DB 层只存 text。
   */
  kind: text('kind').notNull(),

  /**
   * 来源：`manual` | `ai` | `inbox`。
   * 默认 `manual`。
   */
  source: text('source').notNull().default('manual'),

  /**
   * 生命周期状态：`active` | `archived` | `converted`。
   * 默认 `active`。
   */
  status: text('status').notNull().default('active'),

  /**
   * 转换目标（`status = 'converted'` 时填）。
   * 格式：`task:<ulid>` 或 `note:<ulid>`。
   * 可空（默认）。
   */
  convertedTo: text('converted_to'),

  /**
   * 所属项目（可空）。外键 → `projects.id`。
   * 用途：用户把收集箱条目"归类"到某个项目时填。
   */
  projectId: text('project_id').references(() => projects.id),

  /**
   * 标签（JSON 字符串数组）。
   * 用 Drizzle `mode: 'json'` 自动 (de)serialize；DB 层仍是 text。
   * 默认 `[]`。
   */
  tags: text('tags', { mode: 'json' }).$type<string[]>().notNull().default([]),

  /** 创建时间（Unix 毫秒）。 */
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),

  /** 更新时间（Unix 毫秒）。 */
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),

  /**
   * 软删除时间（Unix 毫秒，可空）。
   * 收集箱条目硬删 vs 软删由 T2-2 UI / T2-x IPC 决定；本表先留字段。
   */
  deletedAt: integer('deleted_at', { mode: 'timestamp_ms' }),
});

/** 单行 `inbox_items` 的 TS 类型。 */
export type InboxItemRow = typeof inboxItems.$inferSelect;

/** 插入 `inbox_items` 时的 TS 类型。 */
export type InboxItemInsert = typeof inboxItems.$inferInsert;
