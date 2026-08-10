/**
 * 任务（Task）共享类型 + Zod schemas（T2-1 数据模型层）
 *
 * **职责**：定义 IPC 边界使用的 Task 类型 + 创建/更新入参 schema + TaskDraft。
 *
 * **不写**：db 读写、IPC handler、UI 组件 —— 这些归 T2-3 业务卡。
 *
 * **命名**（PROJECT_IDENTITY.md §3.1）：同 inbox.ts。
 *
 * **TaskDraft**（PLAN §核心接口）：
 *   - 是 AI 工作区 / inbox→task 转换的中间产物
 *   - 不含 `id` / `status` / `source` / 时间戳 —— 这些由落库时填
 *   - 与 `CreateTaskSchema` 字段大体一致但更宽松（字段全 optional）
 *
 * **状态机**：实际流转规则见 `./taskStatus.ts` 的 `ALLOWED_TRANSITIONS`。
 * 本文件只定义"status 字段是什么"，不定义"status 之间怎么转"。
 */

import { z } from 'zod';

import { TaskStatusSchema, type TaskStatus } from './taskStatus';

/** 任务优先级枚举。 */
export const TASK_PRIORITIES = ['low', 'medium', 'high'] as const;

/** 任务优先级类型。 */
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

/** 任务优先级 Zod 校验 schema。 */
export const TaskPrioritySchema = z.enum(TASK_PRIORITIES);

/** 任务来源枚举。 */
export const TASK_SOURCES = ['manual', 'ai', 'inbox'] as const;

/** 任务来源类型。 */
export type TaskSource = (typeof TASK_SOURCES)[number];

/** 任务来源 Zod 校验 schema。 */
export const TaskSourceSchema = z.enum(TASK_SOURCES);

/**
 * 单行 Task 的 TS 类型（与 db 行对齐，供 IPC 响应使用）。
 *
 * `status` 字段直接引用 `taskStatus.ts` 的 `TaskStatus` 单一真源，
 * 避免类型重复定义后不同步。
 */
export interface Task {
  /** ULID 主键。 */
  id: string;
  /** 任务标题。 */
  title: string;
  /** 任务描述（可空，Markdown 文本）。 */
  description: string | null;
  /** 状态（状态机见 `./taskStatus.ts`）。 */
  status: TaskStatus;
  /** 优先级。 */
  priority: TaskPriority;
  /** 截止时间（Unix 毫秒，可空）。 */
  dueDate: number | null;
  /** 所属项目 id（可空）。 */
  projectId: string | null;
  /** 标签数组。 */
  tags: string[];
  /** 来源。 */
  source: TaskSource;
  /** 关联的收集箱条目 id（可空，仅 `source = 'inbox'` 时填）。 */
  inboxId: string | null;
  /** 关联的笔记 id 列表（笔记表 T4-x 落地后才有真实 id）。 */
  noteIds: string[];
  /** 创建时间（Unix 毫秒）。 */
  createdAt: number;
  /** 更新时间（Unix 毫秒）。 */
  updatedAt: number;
  /**
   * 完成时间（Unix 毫秒，可空）。
   *
   * 约定：`status = 'done'` 时填，离开 `done` 时清空。
   * 由 IPC handler 层（T2-3）维护。
   */
  completedAt: number | null;
}

/**
 * 创建 Task 的 IPC 入参 schema（T2-3 任务 IPC 入口会用到）。
 *
 * 必填：`title`
 * 可选：`description`（默认 null）、`priority`（默认 `medium`）、
 *       `status`（默认 `todo`）、`dueDate`、`projectId`、`tags`（默认 `[]`）、
 *       `source`（默认 `manual`）、`inboxId`、`noteIds`（默认 `[]`）
 *
 * 注意：`id` / `createdAt` / `updatedAt` / `completedAt` 由主进程生成 / 维护，**不入参**。
 */
export const CreateTaskSchema = z.object({
  title: z.string().min(1).max(512),
  description: z.string().max(16384).nullable().optional(),
  status: TaskStatusSchema.optional(),
  priority: TaskPrioritySchema.optional(),
  dueDate: z.number().int().nonnegative().nullable().optional(),
  projectId: z.string().min(1).max(64).nullable().optional(),
  tags: z.array(z.string().min(1).max(64)).max(256).optional(),
  source: TaskSourceSchema.optional(),
  inboxId: z.string().min(1).max(64).nullable().optional(),
  noteIds: z.array(z.string().min(1).max(64)).max(256).optional(),
});

/** `CreateTaskSchema` 解析后的 TS 类型。 */
export type CreateTaskInput = z.infer<typeof CreateTaskSchema>;

/**
 * 更新 Task 的 IPC 入参 schema（部分字段可改）。
 *
 * 字段全 optional —— 调用方只传要改的。
 * 主进程 handler 负责：
 *   - 填 `updatedAt`
 *   - 处理 `status` 流转（用 `transition()` 校验合法性 + 维护 `completedAt`）
 */
export const UpdateTaskSchema = z.object({
  title: z.string().min(1).max(512).optional(),
  description: z.string().max(16384).nullable().optional(),
  status: TaskStatusSchema.optional(),
  priority: TaskPrioritySchema.optional(),
  dueDate: z.number().int().nonnegative().nullable().optional(),
  projectId: z.string().min(1).max(64).nullable().optional(),
  tags: z.array(z.string().min(1).max(64)).max(256).optional(),
  source: TaskSourceSchema.optional(),
  inboxId: z.string().min(1).max(64).nullable().optional(),
  noteIds: z.array(z.string().min(1).max(64)).max(256).optional(),
});

/** `UpdateTaskSchema` 解析后的 TS 类型。 */
export type UpdateTaskInput = z.infer<typeof UpdateTaskSchema>;

/**
 * TaskDraft（PLAN §核心接口规定的结构）
 *
 * 用途：AI 工作区 / inbox→task 转换的中间产物。
 *
 * 与 `CreateTaskSchema` 的区别：
 *   - 字段全 optional（更宽松，AI 可能只给标题）
 *   - 不含 `status` / `source` / `inboxId` / `noteIds` / 时间戳 —— 落库时由系统填
 *   - 不含 `id` —— 落库时主进程生成 ULID
 *
 * 渲染进程拿到 `TaskDraft` 后，UI 走"待确认"流程，用户确认后
 * 转成 `CreateTaskInput` 调 IPC 落库。
 */
export const TaskDraftSchema = z.object({
  title: z.string().min(1).max(512).optional(),
  description: z.string().max(16384).optional(),
  priority: TaskPrioritySchema.optional(),
  dueDate: z.string().min(1).max(64).optional(),
  projectId: z.string().min(1).max(64).optional(),
  tags: z.array(z.string().min(1).max(64)).max(256).optional(),
});

/** `TaskDraftSchema` 解析后的 TS 类型（与 PLAN §核心接口 TaskDraft 对齐）。 */
export interface TaskDraft {
  title?: string;
  description?: string;
  priority?: TaskPriority;
  dueDate?: string;
  projectId?: string;
  tags?: string[];
}

/** `z.infer` 出来的 schema 解析结果（与手写 `TaskDraft` 形状一致时可直接当 TaskDraft 用）。 */
export type TaskDraftParsed = z.infer<typeof TaskDraftSchema>;
