/**
 * `tasks` 表 schema（T2-1 业务表）
 *
 * 任务（Task）是工作台的核心实体。状态机定义在
 * `shared/types/taskStatus.ts`，由 `ALLOWED_TRANSITIONS` 描述。
 *
 * **状态字段**（`status`）：
 *   - `todo`      待处理（默认）
 *   - `doing`     进行中
 *   - `done`      已完成
 *   - `archived`  软归档
 *
 * **优先级**（`priority`）：`low` | `medium` | `high`，默认 `medium`。
 *
 * **来源**（`source`）：标识任务最初怎么来的，便于统计和筛选：
 *   - `manual` 用户在任务 UI 手动建（默认）
 *   - `ai`     AI 工作区建议 / 自动创建（T3-x）
 *   - `inbox`  从收集箱条目转换（T2-2 收集箱 UI）
 *
 * **外键**：
 *   - `project_id` → `projects.id`（可空，任务可不归属项目）
 *   - `inbox_id`   → `inbox_items.id`（可空，仅 `source = 'inbox'` 时填）
 *
 * **JSON 字段**（SQLite 无数组类型）：
 *   - `tags`    JSON 字符串数组，标签
 *   - `noteIds` JSON 字符串数组，关联笔记 id 列表（笔记表 T4-x 落地后才有真实 id）
 *
 * **特殊时间戳**：
 *   - `completed_at`：仅 `status = 'done'` 时填，应用层在 status 流转时维护
 *   - `due_date`：任务截止时间（Unix 毫秒，可空）
 *
 * **字段规范**（PROJECT_IDENTITY.md §5.3）：
 *   - 主键：`id`（ULID）
 *   - 时间戳：`created_at` / `updated_at` + 业务专用 `completed_at` / `due_date`
 *   - 软删除：任务不软删除（用 `archived` 状态即可），故不加 `deleted_at`
 *
 * @used-by T2-1 业务表 / T2-3 任务 UI / T2-2 inbox→task 转换
 */

import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { inboxItems } from './inbox';
import { projects } from './project';

/** `tasks` 表的 Drizzle schema。 */
export const tasks = sqliteTable('tasks', {
  /** ULID 主键（26 字符）。 */
  id: text('id').primaryKey(),

  /** 任务标题（必填，最小可用字段）。 */
  title: text('title').notNull(),

  /** 任务描述（可空，Markdown 文本）。 */
  description: text('description'),

  /**
   * 任务状态：`todo` | `doing` | `done` | `archived`。
   * 默认 `todo`。状态机见 `shared/types/taskStatus.ts`。
   */
  status: text('status').notNull().default('todo'),

  /**
   * 优先级：`low` | `medium` | `high`。默认 `medium`。
   */
  priority: text('priority').notNull().default('medium'),

  /**
   * 截止时间（Unix 毫秒，可空）。
   * 业务层做"今日 / 逾期"判断时用。
   */
  dueDate: integer('due_date', { mode: 'timestamp_ms' }),

  /**
   * 所属项目（可空）。外键 → `projects.id`。
   * 任务可以不挂项目（"无项目"也算合法）。
   */
  projectId: text('project_id').references(() => projects.id),

  /**
   * 标签（JSON 字符串数组）。默认 `[]`。
   */
  tags: text('tags', { mode: 'json' }).$type<string[]>().notNull().default([]),

  /**
   * 来源：`manual` | `ai` | `inbox`。
   * 默认 `manual`。
   */
  source: text('source').notNull().default('manual'),

  /**
   * 关联的收集箱条目 id（可空）。
   * 仅 `source = 'inbox'` 时填；外键 → `inbox_items.id`。
   * 不级联删除（收集箱条目硬删策略由 T2-2 决定）。
   */
  inboxId: text('inbox_id').references(() => inboxItems.id),

  /**
   * 关联的笔记 id 列表（JSON 字符串数组）。
   * 笔记表由 T4-x 落地；本字段先建好，方便届时不用改 schema。
   * 默认 `[]`。
   */
  noteIds: text('note_ids', { mode: 'json' }).$type<string[]>().notNull().default([]),

  /** 创建时间（Unix 毫秒）。 */
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),

  /** 更新时间（Unix 毫秒）。每次 update 应刷新。 */
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),

  /**
   * 完成时间（Unix 毫秒，可空）。
   * 应用层约定：`status` 转 `done` 时填，`status` 离开 `done` 时清空。
   * 不在 schema 层面强制（SQLite CHECK 约束也能做，但跨字段约束 Drizzle 不友好），
   * 由 `shared/types/taskStatus.ts` 的 `transition()` 调用方维护。
   */
  completedAt: integer('completed_at', { mode: 'timestamp_ms' }),
});

/** 单行 `tasks` 的 TS 类型。 */
export type TaskRow = typeof tasks.$inferSelect;

/** 插入 `tasks` 时的 TS 类型。 */
export type TaskInsert = typeof tasks.$inferInsert;
