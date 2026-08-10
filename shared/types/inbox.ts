/**
 * 收集箱（Inbox）共享类型 + Zod schemas（T2-1 数据模型层）
 *
 * **职责**：定义 IPC 边界使用的 InboxItem 类型 + 创建/更新入参 schema。
 *
 * **不写**：db 读写、IPC handler、UI 组件 —— 这些归 T2-2 / T2-3 业务卡。
 *
 * **命名**（PROJECT_IDENTITY.md §3.1）：
 *   - 类型：PascalCase（`InboxItem`、`InboxKind`）
 *   - Schema：camelCase + `Schema` 后缀（`InboxKindSchema`）
 *   - 常量：UPPER_SNAKE_CASE（`INBOX_KINDS`）
 *
 * **跨进程序列化注意**：
 *   - `tags` 在 DB 里是 JSON 字符串（SQLite 无数组），跨 IPC 时**仍序列化为字符串**，
 *     由渲染端 `JSON.parse` 或保持为字符串数组（取决于 IPC handler 决定）。
 *     本文件 type 与 db 行的 `tags: string[]` 对齐（已经过 Drizzle `mode: 'json'` 解析）。
 *   - `createdAt` / `updatedAt` / `deletedAt` 在 IPC 上是 number（Unix 毫秒），
 *     与 db 行类型保持一致（不用 Date，Date 不能 JSON 序列化）。
 */

import { z } from 'zod';

/** Inbox 条目 kind 枚举。 */
export const INBOX_KINDS = ['note', 'todo', 'file', 'link'] as const;

/** Inbox 条目 kind 类型。 */
export type InboxKind = (typeof INBOX_KINDS)[number];

/** Inbox 条目 kind Zod 校验 schema。 */
export const InboxKindSchema = z.enum(INBOX_KINDS);

/** Inbox 条目来源枚举。 */
export const INBOX_SOURCES = ['manual', 'ai', 'inbox'] as const;

/** Inbox 条目来源类型。 */
export type InboxSource = (typeof INBOX_SOURCES)[number];

/** Inbox 条目来源 Zod 校验 schema。 */
export const InboxSourceSchema = z.enum(INBOX_SOURCES);

/** Inbox 条目生命周期状态枚举。 */
export const INBOX_STATUSES = ['active', 'archived', 'converted'] as const;

/** Inbox 条目生命周期状态类型。 */
export type InboxStatus = (typeof INBOX_STATUSES)[number];

/** Inbox 条目生命周期状态 Zod 校验 schema。 */
export const InboxStatusSchema = z.enum(INBOX_STATUSES);

/**
 * 单行 InboxItem 的 TS 类型（与 db 行对齐，供 IPC 响应使用）。
 *
 * **重要**：所有时间戳为 number（Unix 毫秒），不是 Date —— Date 无法 JSON 序列化。
 * 渲染端收到后可自行 `new Date(row.createdAt)`。
 */
export interface InboxItem {
  /** ULID 主键。 */
  id: string;
  /** 条目正文。 */
  content: string;
  /** 条目种类。 */
  kind: InboxKind;
  /** 来源。 */
  source: InboxSource;
  /** 生命周期状态。 */
  status: InboxStatus;
  /** 转换目标（`status = 'converted'` 时填），格式 `task:<id>` / `note:<id>`。 */
  convertedTo: string | null;
  /** 所属项目 id（可空）。 */
  projectId: string | null;
  /** 标签数组。 */
  tags: string[];
  /** 创建时间（Unix 毫秒）。 */
  createdAt: number;
  /** 更新时间（Unix 毫秒）。 */
  updatedAt: number;
  /** 软删除时间（Unix 毫秒，可空；本卡先建字段，UI 层由 T2-2 决定用法）。 */
  deletedAt: number | null;
}

/**
 * 创建 InboxItem 的 IPC 入参 schema（T2-2 收集箱 IPC 入口会用到）。
 *
 * 必填：`content` / `kind`
 * 可选：`source`（默认 `manual`，由 schema 设默认值）、`tags`（默认 `[]`）、
 *       `projectId`、`convertedTo`、`status`（默认 `active`）
 *
 * 注意：`id` / `createdAt` / `updatedAt` / `deletedAt` 由主进程生成，**不入参**。
 */
export const CreateInboxItemSchema = z.object({
  content: z.string().min(1).max(65536),
  kind: InboxKindSchema,
  source: InboxSourceSchema.optional(),
  status: InboxStatusSchema.optional(),
  convertedTo: z.string().min(1).max(256).nullable().optional(),
  projectId: z.string().min(1).max(64).nullable().optional(),
  tags: z.array(z.string().min(1).max(64)).max(256).optional(),
});

/** `CreateInboxItemSchema` 解析后的 TS 类型。 */
export type CreateInboxItemInput = z.infer<typeof CreateInboxItemSchema>;
