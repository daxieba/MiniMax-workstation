/**
 * `notes` 表 schema（T4-1 知识沉淀第一阶段）
 *
 * 笔记（Note）是知识库的核心实体。第一版支持：
 *   - Markdown 原文（渲染在渲染端用 `react-markdown` + `remark-gfm`）
 *   - 标签（JSON 字符串数组，UI 用 chip 形式输入）
 *   - 关联任务（JSON 字符串数组，对应 `tasks.id`）
 *   - 可选归属项目（FK → `projects.id`）
 *   - 来源标识：方便后续 T4-2+ 区分人工建 / AI 写 / inbox 转换
 *   - 归档标志（不硬删，UI 可选显示归档）
 *
 * **字段规范**（PROJECT_IDENTITY.md §5.3）：
 *   - 主键：`id`（ULID，26 字符文本）
 *   - 时间戳：`created_at` / `updated_at`（Unix 毫秒，integer，Drizzle `timestamp_ms`）
 *   - 软删除：笔记走 `archived` 标志位（语义清晰），不加 `deleted_at`
 *   - 必加字段：`id` / `title` / `content` / `source` / `archived` / `created_at` / `updated_at`
 *
 * **JSON 字段**（SQLite 无数组类型）：
 *   - `tags`           标签（字符串数组）
 *   - `linked_task_ids` 关联任务 id 列表（字符串数组）
 *   都用 Drizzle `mode: 'json'` 自动 (de)serialize；DB 层仍是 text。
 *
 * **外键**：
 *   - `project_id` → `projects.id`（可空，笔记可不归属项目）
 *   - 不级联删除 —— 项目删除策略由 T2-3 业务卡定义
 *   - 关联任务存的是 id 列表（**不**用 FK）—— SQLite 不支持数组外键，且
 *     任务可能被硬删，业务层读 linkedTaskIds 时做一次过滤即可
 *
 * **来源枚举**（`source`）：
 *   - `manual`  手动创建（默认；本卡 UI 走这条）
 *   - `ai`      AI 工作区写入（T4-3 接入）
 *   - `inbox`   从收集箱条目转换（T4-3 接入）
 *
 * **不存**：
 *   - 摘要（`summary`） —— 留给 T4-3 AI 摘要
 *   - 全文搜索 FTS5 虚拟表 —— 留给 T4-2
 *
 * **命名**（PROJECT_IDENTITY.md §3.1）：表名 `notes`（snake_case 复数），
 * 字段名 camelCase TS / snake_case SQL。
 *
 * @used-by T4-1 笔记 UI / 后续 T4-2 搜索 / T4-3 AI 摘要
 */

import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { projects } from './project';

/** `notes` 表的 Drizzle schema。 */
export const notes = sqliteTable('notes', {
  /** ULID 主键（26 字符）。 */
  id: text('id').primaryKey(),

  /** 笔记标题（必填）。 */
  title: text('title').notNull(),

  /** 笔记正文（Markdown 原文，必填）。 */
  content: text('content').notNull(),

  /**
   * 标签（JSON 字符串数组）。默认 `[]`。
   * UI 用 chip 形式输入；DB 层用 Drizzle `mode: 'json'` 自动 (de)serialize。
   */
  tags: text('tags', { mode: 'json' }).$type<string[]>().notNull().default([]),

  /**
   * 关联任务 id 列表（JSON 字符串数组）。默认 `[]`。
   *
   * 业务层契约：
   *   - 单击"+ 关联任务"添加一个 taskId
   *   - 单击 chip 上的 × 移除一个 taskId
   *   - 真实显示任务名需要 taskStore 配合（IPC 不返回外部数据）
   *   - 任务被硬删后，linkedTaskIds 仍保留旧 id（业务层做过滤显示"任务已删除"）
   */
  linkedTaskIds: text('linked_task_ids', { mode: 'json' })
    .$type<string[]>()
    .notNull()
    .default([]),

  /**
   * 所属项目（可空）。外键 → `projects.id`。
   * 笔记可以不挂项目（"无项目"也算合法）。
   */
  projectId: text('project_id').references(() => projects.id),

  /**
   * 来源：`manual` | `ai` | `inbox`。默认 `manual`。
   * 用途：UI 可按来源过滤（"只看 AI 写的"等），统计也方便。
   */
  source: text('source').notNull().default('manual'),

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

/** 单行 `notes` 的 TS 类型（数据库行 = select）。 */
export type NoteRow = typeof notes.$inferSelect;

/** 插入 `notes` 时的 TS 类型（缺省字段由 $defaultFn / 列 default 填充）。 */
export type NoteInsert = typeof notes.$inferInsert;
