/**
 * 任务（Task）IPC 共享 Zod schemas（T2-3）
 *
 * 与 `shared/types/task.ts` 的 `Task` 接口对应，提供 IPC 边界的运行时校验。
 *
 * **职责**：
 *   - 主进程入口校验入参（`safeParse`）
 *   - 预加载脚本解析响应数据（`safeParse`）
 *   - 渲染进程 store 收到响应后再次校验（保持端到端契约稳定）
 *
 * **不做**：
 *   - 业务规则（状态机、确认流程、completedAt 维护）—— 留给主进程 handler
 *   - db 读写 —— 留给主进程
 *
 * @see shared/types/task.ts
 * @see shared/types/taskStatus.ts
 */

import { z } from 'zod';

import {
  TaskPrioritySchema,
  TaskSourceSchema,
  type Task,
} from '../types/task';
import { TaskStatusSchema } from '../types/taskStatus';

/** 单行 Task 在 IPC 边界上的 Zod schema（与 `Task` 接口字段一致）。 */
export const TaskSchema = z.object({
  id: z.string().min(1).max(64),
  title: z.string().min(1),
  description: z.string().nullable(),
  status: TaskStatusSchema,
  priority: TaskPrioritySchema,
  dueDate: z.number().int().nonnegative().nullable(),
  projectId: z.string().nullable(),
  tags: z.array(z.string().min(1)),
  source: TaskSourceSchema,
  inboxId: z.string().nullable(),
  noteIds: z.array(z.string().min(1)),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  completedAt: z.number().int().nonnegative().nullable(),
}) satisfies z.ZodType<Task>;

/** `Task[]` schema（list 接口响应）。 */
export const TaskListSchema = z.array(TaskSchema);

/**
 * `task:list` 入参 schema。
 *
 * 过滤项全 optional：
 *   - `status`    按状态过滤
 *   - `priority`  按优先级过滤
 *   - `projectId` 按项目过滤（`null` 表示"无项目"，省略表示"全部"）
 */
export const TaskListFilterSchema = z
  .object({
    status: TaskStatusSchema.optional(),
    priority: TaskPrioritySchema.optional(),
    projectId: z.string().min(1).max(64).nullable().optional(),
  })
  .strict();

/** `task:get` 入参 schema。 */
export const TaskGetInputSchema = z
  .object({
    id: z.string().min(1).max(64),
  })
  .strict();

/** `task:create` 入参 schema（与 `CreateTaskInput` 字段一致）。 */
export const CreateTaskInputSchema = z
  .object({
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
  })
  .strict();

/** `task:update` 入参 schema：必填 id，patch 字段全 optional。 */
export const UpdateTaskInputSchema = z
  .object({
    id: z.string().min(1).max(64),
    patch: z
      .object({
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
      })
      .strict(),
  })
  .strict();

/** `task:transition` 入参 schema。 */
export const TaskTransitionInputSchema = z
  .object({
    id: z.string().min(1).max(64),
    to: TaskStatusSchema,
  })
  .strict();

/** `task:archive` 入参 schema。 */
export const TaskArchiveInputSchema = z
  .object({
    id: z.string().min(1).max(64),
  })
  .strict();

/** `task:delete` 入参 schema。 */
export const TaskDeleteInputSchema = z
  .object({
    id: z.string().min(1).max(64),
  })
  .strict();

/** `task:delete` 成功响应 data schema。 */
export const TaskDeleteResponseSchema = z.object({
  deleted: z.literal(true),
});

/** 类型导出（z.infer 形式）。 */
export type TaskParsed = z.infer<typeof TaskSchema>;
export type TaskListFilterParsed = z.infer<typeof TaskListFilterSchema>;
export type TaskGetInputParsed = z.infer<typeof TaskGetInputSchema>;
export type CreateTaskInputParsed = z.infer<typeof CreateTaskInputSchema>;
export type UpdateTaskInputParsed = z.infer<typeof UpdateTaskInputSchema>;
export type TaskTransitionInputParsed = z.infer<typeof TaskTransitionInputSchema>;
export type TaskArchiveInputParsed = z.infer<typeof TaskArchiveInputSchema>;
export type TaskDeleteInputParsed = z.infer<typeof TaskDeleteInputSchema>;
