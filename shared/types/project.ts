/**
 * 项目（Project）共享类型 + Zod schemas（T2-1 数据模型层）
 *
 * **职责**：定义 IPC 边界使用的 Project 类型 + 创建/更新入参 schema。
 *
 * **不写**：db 读写、IPC handler、UI 组件 —— 这些归 T2-3 业务卡。
 *
 * **命名**（PROJECT_IDENTITY.md §3.1）：同 inbox.ts。
 *
 * **跨进程序列化注意**：
 *   - 时间戳为 number（Unix 毫秒），不是 Date
 *   - `archived` 在 IPC 上为 boolean（应用层转换 0/1），DB 行类型保留 number
 */

import { z } from 'zod';

/**
 * hex 颜色字符串 schema（`#RGB` / `#RRGGBB` / `#RRGGBBAA`）。
 *
 * 业务层不强制要求（color 可空），但填了就要是合法 hex。
 */
export const ProjectColorSchema = z
  .string()
  .regex(/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/, 'color must be a valid hex string');

/**
 * 单行 Project 的 TS 类型（与 db 行对齐，供 IPC 响应使用）。
 */
export interface Project {
  /** ULID 主键。 */
  id: string;
  /** 项目名。 */
  name: string;
  /** 项目描述（可空）。 */
  description: string | null;
  /** 标签色 hex（可空）。 */
  color: string | null;
  /**
   * 归档标志（boolean 形式）。
   *
   * **注意**：db 行类型 `ProjectRow.archived` 是 number（0/1），
   * IPC 边界由 handler 转成 boolean 后用本类型。
   */
  archived: boolean;
  /** 创建时间（Unix 毫秒）。 */
  createdAt: number;
  /** 更新时间（Unix 毫秒）。 */
  updatedAt: number;
}

/**
 * 创建 Project 的 IPC 入参 schema（T2-3 项目 IPC 入口会用到）。
 *
 * 必填：`name`
 * 可选：`description`、`color`、`archived`（默认 `false`）
 *
 * 注意：`id` / `createdAt` / `updatedAt` 由主进程生成，**不入参**。
 */
export const CreateProjectSchema = z.object({
  name: z.string().min(1).max(128),
  description: z.string().max(4096).nullable().optional(),
  color: ProjectColorSchema.nullable().optional(),
  archived: z.boolean().optional(),
});

/** `CreateProjectSchema` 解析后的 TS 类型。 */
export type CreateProjectInput = z.infer<typeof CreateProjectSchema>;

/**
 * 更新 Project 的 IPC 入参 schema（部分字段可改）。
 *
 * 所有字段都 optional —— 调用方只传要改的。
 * 主进程 handler 负责：填 `updatedAt`、忽略未传字段。
 */
export const UpdateProjectSchema = z.object({
  name: z.string().min(1).max(128).optional(),
  description: z.string().max(4096).nullable().optional(),
  color: ProjectColorSchema.nullable().optional(),
  archived: z.boolean().optional(),
});

/** `UpdateProjectSchema` 解析后的 TS 类型。 */
export type UpdateProjectInput = z.infer<typeof UpdateProjectSchema>;
