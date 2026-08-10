/**
 * 笔记（Note）IPC 共享 Zod schemas（T4-1）
 *
 * 与 `shared/types/note.ts` 的 `Note` 接口对应，提供 IPC 边界的运行时校验。
 *
 * **职责**：
 *   - 主进程入口校验入参（`safeParse`）
 *   - 预加载脚本解析响应数据（`safeParse`）
 *   - 渲染进程 store 收到响应后再次校验（保持端到端契约稳定）
 *
 * **不做**：
 *   - 业务规则（关联任务的去重 / 状态流转）—— 留给主进程 handler
 *   - db 读写 —— 留给主进程
 *
 * @see shared/types/note.ts
 * @see electron/main/ipc/note.ts
 */

import { z } from 'zod';

import { NoteSourceSchema, type Note } from '../types/note';

/**
 * 单行 Note 在 IPC 边界上的 Zod schema（与 `Note` 接口字段一致）。
 *
 * `archived` 必须是 boolean（应用层把 db 0/1 转过来）。
 */
export const NoteSchema = z.object({
  id: z.string().min(1).max(64),
  title: z.string().min(1).max(512),
  content: z.string().max(1_048_576),
  tags: z.array(z.string().min(1).max(64)).max(256),
  linkedTaskIds: z.array(z.string().min(1).max(64)).max(256),
  projectId: z.string().nullable(),
  source: NoteSourceSchema,
  archived: z.boolean(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
}) satisfies z.ZodType<Note>;

/** `Note[]` schema（list 接口响应）。 */
export const NoteListSchema = z.array(NoteSchema);

/**
 * `note:list` 入参 schema（filter 可空，不传则返回全部非归档）。
 *
 * 字段全 optional —— 渲染端传 `{}` 视为"全部"。
 */
export const NoteListFilterSchema = z
  .object({
    archived: z.boolean().optional(),
    projectId: z.string().min(1).max(64).nullable().optional(),
    tag: z.string().min(1).max(64).optional(),
  })
  .strict();

/** `note:get` 入参 schema。 */
export const NoteGetInputSchema = z
  .object({
    id: z.string().min(1).max(64),
  })
  .strict();

/** `note:create` 入参 schema（与 `CreateNoteInput` 字段一致）。 */
export const CreateNoteInputSchema = z
  .object({
    title: z.string().min(1).max(512),
    content: z.string().max(1_048_576),
    tags: z.array(z.string().min(1).max(64)).max(256).optional(),
    linkedTaskIds: z.array(z.string().min(1).max(64)).max(256).optional(),
    projectId: z.string().min(1).max(64).nullable().optional(),
    source: NoteSourceSchema.optional(),
    archived: z.boolean().optional(),
  })
  .strict();

/** `note:update` 入参 schema：必填 id，patch 字段全 optional。 */
export const UpdateNoteInputSchema = z
  .object({
    id: z.string().min(1).max(64),
    patch: z
      .object({
        title: z.string().min(1).max(512).optional(),
        content: z.string().max(1_048_576).optional(),
        tags: z.array(z.string().min(1).max(64)).max(256).optional(),
        linkedTaskIds: z.array(z.string().min(1).max(64)).max(256).optional(),
        projectId: z.string().min(1).max(64).nullable().optional(),
        source: NoteSourceSchema.optional(),
        archived: z.boolean().optional(),
      })
      .strict(),
  })
  .strict();

/** `note:archive` 入参 schema。 */
export const NoteArchiveInputSchema = z
  .object({
    id: z.string().min(1).max(64),
  })
  .strict();

/** `note:delete` 入参 schema。 */
export const NoteDeleteInputSchema = z
  .object({
    id: z.string().min(1).max(64),
  })
  .strict();

/** `note:delete` 成功响应 data schema。 */
export const NoteDeleteResponseSchema = z.object({
  deleted: z.literal(true),
});

/**
 * `note:linkToTask` 入参 schema。
 *
 * 业务行为：把 `taskId` 加进 note 的 `linkedTaskIds`（去重，保留顺序）。
 * 任务不存在 / 笔记不存在 → `NOT_FOUND`。
 */
export const LinkNoteToTaskInputSchema = z
  .object({
    noteId: z.string().min(1).max(64),
    taskId: z.string().min(1).max(64),
  })
  .strict();

/**
 * `note:unlinkFromTask` 入参 schema。
 *
 * 业务行为：从 note 的 `linkedTaskIds` 里移除 `taskId`（如不存在则 no-op）。
 * 笔记不存在 → `NOT_FOUND`。
 */
export const UnlinkNoteFromTaskInputSchema = z
  .object({
    noteId: z.string().min(1).max(64),
    taskId: z.string().min(1).max(64),
  })
  .strict();

/**
 * `note:export` 入参 schema（T4-3 知识沉淀第三阶段）。
 *
 * 字段：
 *   - `ids`        必填，至少 1 个、最多 256 个 note id
 *   - `targetDir`  可选 —— 自定义目标目录绝对路径；省略时主进程落到
 *                  `<USERPROFILE>/Downloads/minimax-workstation-notes/{date}/`
 *
 * 业务行为：把每条 note 写成一个 `.md` 文件，文件名 = `slug(title) + ulid后缀`。
 *
 * **安全（PROJECT_IDENTITY.md §6.1 / §6.5）**：
 *   - 导出文件**不**包含 API Key / provider config / inbox 内容 / task 内容
 *   - 仅含笔记自身字段：title / tags / createdAt / source / linkedTaskIds / content
 *   - 入参**不**含 apiKey 字段（schema 严格模式）
 */
export const NoteExportRequestSchema = z
  .object({
    ids: z.array(z.string().min(1).max(64)).min(1).max(256),
    targetDir: z.string().min(1).max(2048).optional(),
  })
  .strict();

/** `note:export` 成功响应 data schema。 */
export const NoteExportResponseSchema = z.object({
  files: z.array(
    z.object({
      id: z.string().min(1).max(64),
      path: z.string().min(1).max(4096),
    }),
  ),
});

/** 类型导出（z.infer 形式）。 */
export type NoteParsed = z.infer<typeof NoteSchema>;
export type NoteListFilterParsed = z.infer<typeof NoteListFilterSchema>;
export type NoteGetInputParsed = z.infer<typeof NoteGetInputSchema>;
export type CreateNoteInputParsed = z.infer<typeof CreateNoteInputSchema>;
export type UpdateNoteInputParsed = z.infer<typeof UpdateNoteInputSchema>;
export type NoteArchiveInputParsed = z.infer<typeof NoteArchiveInputSchema>;
export type NoteDeleteInputParsed = z.infer<typeof NoteDeleteInputSchema>;
export type LinkNoteToTaskInputParsed = z.infer<typeof LinkNoteToTaskInputSchema>;
export type UnlinkNoteFromTaskInputParsed = z.infer<typeof UnlinkNoteFromTaskInputSchema>;
export type NoteExportRequestParsed = z.infer<typeof NoteExportRequestSchema>;
export type NoteExportResponseParsed = z.infer<typeof NoteExportResponseSchema>;
export type NoteExportFileParsed = NoteExportResponseParsed['files'][number];
