/**
 * 项目（Project）IPC 共享 Zod schemas（T2-3）
 *
 * 与 `shared/types/project.ts` 的 `Project` 接口对应，提供 IPC 边界的运行时校验。
 *
 * **职责**：
 *   - 主进程入口校验入参（`safeParse`）
 *   - 预加载脚本解析响应数据（`safeParse`）
 *   - 渲染进程 store 收到响应后再次校验（保持端到端契约稳定）
 *
 * **不做**：
 *   - 业务规则（确认流程）—— 留给主进程 / 渲染端
 *   - db 读写 —— 留给主进程
 *
 * @see shared/types/project.ts
 */

import { z } from 'zod';

import {
  ProjectColorSchema,
  type Project,
} from '../types/project';

/** 单行 Project 在 IPC 边界上的 Zod schema（与 `Project` 接口字段一致）。 */
export const ProjectSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(128),
  description: z.string().nullable(),
  color: z.string().nullable(),
  archived: z.boolean(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
}) satisfies z.ZodType<Project>;

/** `Project[]` schema（list 接口响应）。 */
export const ProjectListSchema = z.array(ProjectSchema);

/** `project:list` 入参 schema（filter 可空，不传则返回全部未归档）。 */
export const ProjectListFilterSchema = z
  .object({
    archived: z.boolean().optional(),
  })
  .strict();

/** `project:create` 入参 schema（与 `CreateProjectInput` 字段一致）。 */
export const CreateProjectInputSchema = z
  .object({
    name: z.string().min(1).max(128),
    description: z.string().max(4096).nullable().optional(),
    color: ProjectColorSchema.nullable().optional(),
    archived: z.boolean().optional(),
  })
  .strict();

/** `project:update` 入参 schema：必填 id，patch 字段全 optional。 */
export const UpdateProjectInputSchema = z
  .object({
    id: z.string().min(1).max(64),
    patch: z
      .object({
        name: z.string().min(1).max(128).optional(),
        description: z.string().max(4096).nullable().optional(),
        color: ProjectColorSchema.nullable().optional(),
        archived: z.boolean().optional(),
      })
      .strict(),
  })
  .strict();

/** `project:archive` 入参 schema。 */
export const ProjectArchiveInputSchema = z
  .object({
    id: z.string().min(1).max(64),
  })
  .strict();

/** `project:delete` 入参 schema。 */
export const ProjectDeleteInputSchema = z
  .object({
    id: z.string().min(1).max(64),
  })
  .strict();

/** `project:delete` 成功响应 data schema。 */
export const ProjectDeleteResponseSchema = z.object({
  deleted: z.literal(true),
});

/** 类型导出（z.infer 形式）。 */
export type ProjectParsed = z.infer<typeof ProjectSchema>;
export type ProjectListFilterParsed = z.infer<typeof ProjectListFilterSchema>;
export type CreateProjectInputParsed = z.infer<typeof CreateProjectInputSchema>;
export type UpdateProjectInputParsed = z.infer<typeof UpdateProjectInputSchema>;
export type ProjectArchiveInputParsed = z.infer<typeof ProjectArchiveInputSchema>;
export type ProjectDeleteInputParsed = z.infer<typeof ProjectDeleteInputSchema>;
