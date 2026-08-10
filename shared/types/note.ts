/**
 * 笔记（Note）共享类型 + Zod schemas（T4-1 知识沉淀第一阶段）
 *
 * **职责**：定义 IPC 边界使用的 Note 类型 + 创建/更新入参 schema + 关联任务子 schema。
 *
 * **不写**：db 读写、IPC handler、UI 组件 —— 这些归 T4-1 业务实现。
 *
 * **命名**（PROJECT_IDENTITY.md §3.1）：
 *   - 类型：PascalCase（`Note`、`NoteSource`）
 *   - Schema：camelCase + `Schema` 后缀
 *   - 常量：UPPER_SNAKE_CASE（`NOTE_SOURCES`）
 *
 * **跨进程序列化注意**：
 *   - `tags` / `linkedTaskIds` 在 DB 里是 JSON 字符串（SQLite 无数组），
 *     跨 IPC 时**已**在主进程 handler 里 Drizzle `mode: 'json'` 解析为数组
 *   - `createdAt` / `updatedAt` 在 IPC 上是 number（Unix 毫秒）
 *   - `archived` 在 IPC 上是 boolean（应用层转换 0/1）
 *
 * **CreateNoteInput vs UpdateNoteInput**：
 *   - Create：必填 `title` / `content`；其余可选
 *   - Update：所有字段 optional，patch 语义（调用方只传要改的）
 *   - 都用 Zod 校验（身份卡 §4.3 / §6.3）
 *
 * **关联任务 schema**：
 *   - `linkNoteToTask({ noteId, taskId })` 和 `unlinkNoteFromTask(...)`：
 *     主进程 handler 负责读 note → 改 `linkedTaskIds` → 写回 → 返回新 note
 *   - schema 只校验 `{ noteId, taskId }` 入参
 */

import { z } from 'zod';

/** 笔记来源枚举。 */
export const NOTE_SOURCES = ['manual', 'ai', 'inbox'] as const;

/** 笔记来源类型。 */
export type NoteSource = (typeof NOTE_SOURCES)[number];

/** 笔记来源 Zod 校验 schema。 */
export const NoteSourceSchema = z.enum(NOTE_SOURCES);

/**
 * 单行 Note 的 TS 类型（与 db 行对齐，供 IPC 响应使用）。
 *
 * `archived` 在 IPC 上是 boolean（db 行 `NoteRow.archived` 是 number 0/1）。
 */
export interface Note {
  /** ULID 主键。 */
  id: string;
  /** 笔记标题。 */
  title: string;
  /** 笔记正文（Markdown 原文）。 */
  content: string;
  /** 标签数组。 */
  tags: string[];
  /** 关联任务 id 列表。 */
  linkedTaskIds: string[];
  /** 所属项目 id（可空）。 */
  projectId: string | null;
  /** 来源。 */
  source: NoteSource;
  /** 归档标志（boolean 形式）。 */
  archived: boolean;
  /** 创建时间（Unix 毫秒）。 */
  createdAt: number;
  /** 更新时间（Unix 毫秒）。 */
  updatedAt: number;
}

/**
 * 创建 Note 的 IPC 入参 schema（T4-1 笔记 IPC 入口会用到）。
 *
 * 必填：`title` / `content`
 * 可选：`tags`（默认 `[]`）、`linkedTaskIds`（默认 `[]`）、
 *       `projectId`、`source`（默认 `manual`）、`archived`（默认 `false`）
 *
 * 注意：`id` / `createdAt` / `updatedAt` 由主进程生成 / 维护，**不入参**。
 */
export const CreateNoteSchema = z.object({
  title: z.string().min(1).max(512),
  content: z.string().max(1_048_576), // 1MB Markdown — 防极端输入
  tags: z.array(z.string().min(1).max(64)).max(256).optional(),
  linkedTaskIds: z.array(z.string().min(1).max(64)).max(256).optional(),
  projectId: z.string().min(1).max(64).nullable().optional(),
  source: NoteSourceSchema.optional(),
  archived: z.boolean().optional(),
});

/** `CreateNoteSchema` 解析后的 TS 类型。 */
export type CreateNoteInput = z.infer<typeof CreateNoteSchema>;

/**
 * 更新 Note 的 IPC 入参 schema（部分字段可改）。
 *
 * 所有字段都 optional —— 调用方只传要改的。
 * 主进程 handler 负责：填 `updatedAt`、忽略未传字段。
 *
 * 注意：`content` 单独修改也可走 update；不需要"新建 + 删除"的旧接口。
 */
export const UpdateNoteSchema = z.object({
  title: z.string().min(1).max(512).optional(),
  content: z.string().max(1_048_576).optional(),
  tags: z.array(z.string().min(1).max(64)).max(256).optional(),
  linkedTaskIds: z.array(z.string().min(1).max(64)).max(256).optional(),
  projectId: z.string().min(1).max(64).nullable().optional(),
  source: NoteSourceSchema.optional(),
  archived: z.boolean().optional(),
});

/** `UpdateNoteSchema` 解析后的 TS 类型。 */
export type UpdateNoteInput = z.infer<typeof UpdateNoteSchema>;

/**
 * 笔记列表过滤 schema。
 *
 * 三维度（自由组合）：
 *   - `archived`   布尔，true = 只看归档，false = 只看非归档；省略 = 全部
 *   - `projectId`  按项目过滤；`null` 显式匹配"无项目"；省略 = 全部
 *   - `tag`        按单个标签过滤（包含该标签的笔记）；省略 = 全部
 */
export const NoteListFilterSchema = z.object({
  archived: z.boolean().optional(),
  projectId: z.string().min(1).max(64).nullable().optional(),
  tag: z.string().min(1).max(64).optional(),
});

/** `NoteListFilterSchema` 解析后的 TS 类型。 */
export type NoteListFilter = z.infer<typeof NoteListFilterSchema>;
