/**
 * 收集箱（Inbox）IPC 共享 Zod schemas（T2-2）
 *
 * 与 `shared/types/inbox.ts` 的 `InboxItem` 接口对应，提供 IPC 边界的运行时校验。
 * 命名（PROJECT_IDENTITY.md §3.1）：camelCase 变量，PascalCase 类型导出。
 *
 * **职责**：
 *   - 主进程入口校验入参（safeParse）
 *   - 预加载脚本解析响应数据（safeParse）
 *   - 渲染进程 store 收到响应后再次校验（保持端到端契约稳定）
 *
 * **不做**：
 *   - 业务规则（状态机、确认流程）—— 留给主进程 handler
 *   - db 读写 —— 留给主进程
 *
 * @see shared/types/inbox.ts
 */

import { z } from 'zod';

import {
  InboxKindSchema,
  InboxSourceSchema,
  InboxStatusSchema,
  type InboxItem,
} from '../types/inbox';

/** 单行 InboxItem 在 IPC 边界上的 Zod schema。 */
export const InboxItemSchema = z.object({
  id: z.string().min(1).max(64),
  content: z.string().min(1),
  kind: InboxKindSchema,
  source: InboxSourceSchema,
  status: InboxStatusSchema,
  convertedTo: z.string().nullable(),
  projectId: z.string().nullable(),
  tags: z.array(z.string().min(1)),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  deletedAt: z.number().int().nonnegative().nullable(),
}) satisfies z.ZodType<InboxItem>;

/** `InboxItem[]` schema（list 接口响应）。 */
export const InboxItemListSchema = z.array(InboxItemSchema);

/** `inbox:list` 入参 schema（filter 可空，不传则返回全部非 deleted）。 */
export const InboxListFilterSchema = z
  .object({
    status: InboxStatusSchema.optional(),
  })
  .strict();

/** `inbox:update` 入参 schema。patch 字段全 optional。 */
export const InboxUpdateInputSchema = z
  .object({
    id: z.string().min(1).max(64),
    patch: z
      .object({
        content: z.string().min(1).max(65536).optional(),
        kind: InboxKindSchema.optional(),
        source: InboxSourceSchema.optional(),
        status: InboxStatusSchema.optional(),
        convertedTo: z.string().min(1).max(256).nullable().optional(),
        projectId: z.string().min(1).max(64).nullable().optional(),
        tags: z.array(z.string().min(1).max(64)).max(256).optional(),
      })
      .strict(),
  })
  .strict();

/** `inbox:archive` 入参 schema。 */
export const InboxArchiveInputSchema = z
  .object({
    id: z.string().min(1).max(64),
  })
  .strict();

/** `inbox:convertToTask` 入参 schema。
 *
 * `taskDraft` 与 `shared/types/task.ts` 的 `TaskDraft` 对齐：
 *   - 字段全 optional
 *   - `dueDate` 接受 ISO 字符串或 epoch 毫秒数字串；handler 负责转 number
 */
export const InboxConvertToTaskInputSchema = z
  .object({
    inboxId: z.string().min(1).max(64),
    taskDraft: z
      .object({
        title: z.string().min(1).max(512).optional(),
        description: z.string().max(16384).optional(),
        priority: z.enum(['low', 'medium', 'high']).optional(),
        dueDate: z.string().min(1).max(64).optional(),
        projectId: z.string().min(1).max(64).optional(),
        tags: z.array(z.string().min(1).max(64)).max(256).optional(),
      })
      .strict(),
  })
  .strict();

/** `inbox:convertToTask` 成功响应 data schema：`{ inbox, task }`。 */
export const InboxConvertToTaskResponseSchema = z.object({
  inbox: InboxItemSchema,
  task: z.object({
    id: z.string().min(1).max(64),
    title: z.string().min(1),
    description: z.string().nullable(),
    status: z.enum(['todo', 'doing', 'done', 'archived']),
    priority: z.enum(['low', 'medium', 'high']),
    dueDate: z.number().int().nonnegative().nullable(),
    projectId: z.string().nullable(),
    tags: z.array(z.string().min(1)),
    source: z.enum(['manual', 'ai', 'inbox']),
    inboxId: z.string().nullable(),
    noteIds: z.array(z.string().min(1)),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
    completedAt: z.number().int().nonnegative().nullable(),
  }),
});

/** 类型导出（z.infer 形式）。 */
export type InboxItemParsed = z.infer<typeof InboxItemSchema>;
export type InboxListFilterParsed = z.infer<typeof InboxListFilterSchema>;
export type InboxUpdateInputParsed = z.infer<typeof InboxUpdateInputSchema>;
export type InboxArchiveInputParsed = z.infer<typeof InboxArchiveInputSchema>;
export type InboxConvertToTaskInputParsed = z.infer<typeof InboxConvertToTaskInputSchema>;
export type InboxConvertToTaskResponseParsed = z.infer<typeof InboxConvertToTaskResponseSchema>;
