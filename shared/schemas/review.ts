/**
 * 复盘（Review）IPC 共享 Zod schemas（T5-1 每日复盘）
 *
 * 与 `shared/types/review.ts` 的 `Review` 接口对应，提供 IPC 边界的运行时校验。
 *
 * **职责**：
 *   - 主进程入口校验入参（`safeParse`）
 *   - 预加载脚本解析响应数据（`safeParse`）
 *   - 渲染进程 store 收到响应后再次校验（保持端到端契约稳定）
 *
 * **不做**：
 *   - 业务规则（5 段字段互斥 / 关联任务去重）—— 留给主进程 handler
 *   - db 读写 —— 留给主进程
 *
 * **ReviewDraft 边界**：
 *   - `completed` / `topThree` 数组 max 100 长度（防极端输入）
 *   - 字符串 max 4096
 *   - `uncompleted.reason` max 1024
 *   - `.strict()` 拒绝任何额外字段
 *
 * @see shared/types/review.ts
 * @see electron/main/ipc/review.ts
 */

import { z } from 'zod';

import { ReviewDraftSchema } from './ai';
import type { Review, ReviewDraft } from '../types/review';

/**
 * `YYYY-MM-DD` 日期格式校验。
 *
 * 严格匹配 4 位年 + 2 位月 + 2 位日；不校验日期合法性（如 2024-02-30 会通过）。
 * 业务上 date 由 `new Date().toISOString().slice(0, 10)` 或用户选日期器生成，
 * 不会出现无效日期；这里只防止"任意字符串"渗透进 db 唯一键。
 */
const DateStringSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD')
  .min(10)
  .max(10);

/**
 * 单行 Review 在 IPC 边界上的 Zod schema（与 `Review` 接口字段一致）。
 *
 * 时间戳：Unix 毫秒（number）。
 * `aiDraft` 可空（null = 未生成 / 已采纳）。
 */
export const ReviewSchema = z
  .object({
    id: z.string().min(1).max(64),
    date: DateStringSchema,
    completed: z
      .array(
        z
          .object({
            taskId: z.string().min(1).max(64),
            title: z.string().min(1).max(512),
            reason: z.string().max(1024).optional(),
          })
          .strict(),
      )
      .max(256),
    uncompleted: z
      .array(
        z
          .object({
            taskId: z.string().min(1).max(64),
            title: z.string().min(1).max(512),
            reason: z.string().max(1024).optional(),
          })
          .strict(),
      )
      .max(256),
    blockers: z.string().max(4096),
    topThree: z.array(z.string().min(1).max(512)).max(3),
    aiDraft: ReviewDraftSchema.nullable(),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
  })
  .strict() satisfies z.ZodType<Review>;

/** `Review[]` schema（listRecent 接口响应）。 */
export const ReviewListSchema = z.array(ReviewSchema);

// ============================================================
//  IPC 入参 / 响应 schemas
// ============================================================

/** `review:getByDate` 入参 schema。 */
export const ReviewGetByDateInputSchema = z
  .object({
    date: DateStringSchema,
  })
  .strict();

/** `review:getByDate` 响应 data schema（Review | null）。 */
export const ReviewGetByDateResponseSchema = ReviewSchema.nullable();

/** `review:upsert` 入参 schema。
 *
 * - 不接受 `aiDraft`（必须走 `review:update` 显式采纳）
 * - 不接受 `id` / `createdAt` / `updatedAt`（主进程维护）
 */
export const ReviewUpsertInputSchema = z
  .object({
    date: DateStringSchema,
    completed: z
      .array(
        z
          .object({
            taskId: z.string().min(1).max(64),
            title: z.string().min(1).max(512),
          })
          .strict(),
      )
      .max(256),
    uncompleted: z
      .array(
        z
          .object({
            taskId: z.string().min(1).max(64),
            title: z.string().min(1).max(512),
            reason: z.string().max(1024).optional(),
          })
          .strict(),
      )
      .max(256),
    blockers: z.string().max(4096),
    topThree: z.array(z.string().min(1).max(512)).max(3),
  })
  .strict();

/** `review:upsert` 响应 data schema（更新后的 Review）。 */
export const ReviewUpsertResponseSchema = ReviewSchema;

/** `review:update` 入参 schema。
 *
 * - `id` 必填
 * - `date` **不**接受（date 是唯一键，修改 = 删旧 + 插新；走 upsert）
 * - 其他 4 段字段全 optional（patch 语义）
 * - `aiDraft` 也可显式设为 null（清空草稿）
 */
export const ReviewUpdateInputSchema = z
  .object({
    id: z.string().min(1).max(64),
    patch: z
      .object({
        completed: z
          .array(
            z
              .object({
                taskId: z.string().min(1).max(64),
                title: z.string().min(1).max(512),
              })
              .strict(),
          )
          .max(256)
          .optional(),
        uncompleted: z
          .array(
            z
              .object({
                taskId: z.string().min(1).max(64),
                title: z.string().min(1).max(512),
                reason: z.string().max(1024).optional(),
              })
              .strict(),
          )
          .max(256)
          .optional(),
        blockers: z.string().max(4096).optional(),
        topThree: z.array(z.string().min(1).max(512)).max(3).optional(),
        aiDraft: ReviewDraftSchema.nullable().optional(),
      })
      .strict(),
  })
  .strict();

/** `review:update` 响应 data schema。 */
export const ReviewUpdateResponseSchema = ReviewSchema;

/** `review:listRecent` 入参 schema。 */
export const ReviewListRecentInputSchema = z
  .object({
    limit: z.number().int().min(1).max(365).optional(),
  })
  .strict();

/** `review:listRecent` 响应 data schema。 */
export const ReviewListRecentResponseSchema = ReviewListSchema;

/**
 * `review:generateDraft` 入参 schema。
 *
 * - `date` 必填
 * - `provider` 必填（主进程用 provider 调 `ai:extractJson`）
 * - `model` 可选（缺省走 provider metadata.defaultModel）
 *
 * 注：spec 原话 `入参 { date }` —— 实际实现时必须知道 provider 才能调
 * `handleAiExtractJson`（后者入参必填 provider）；这里把 provider 提到
 * review:generateDraft 入参层，由渲染端从 useAiStore 注入。
 */
export const ReviewGenerateDraftInputSchema = z
  .object({
    date: DateStringSchema,
    provider: z.enum(['minimax', 'openai-compatible']),
    model: z.string().min(1).max(256).optional(),
  })
  .strict();

/** `review:generateDraft` 响应 data schema。 */
export const ReviewGenerateDraftResponseSchema = ReviewDraftSchema;

// ============================================================
//  类型导出（z.infer 形式）
// ============================================================

export type ReviewParsed = z.infer<typeof ReviewSchema>;
export type ReviewListParsed = z.infer<typeof ReviewListSchema>;
export type ReviewGetByDateInputParsed = z.infer<typeof ReviewGetByDateInputSchema>;
export type ReviewGetByDateResponseParsed = z.infer<typeof ReviewGetByDateResponseSchema>;
export type ReviewUpsertInputParsed = z.infer<typeof ReviewUpsertInputSchema>;
export type ReviewUpsertResponseParsed = z.infer<typeof ReviewUpsertResponseSchema>;
export type ReviewUpdateInputParsed = z.infer<typeof ReviewUpdateInputSchema>;
export type ReviewUpdateResponseParsed = z.infer<typeof ReviewUpdateResponseSchema>;
export type ReviewListRecentInputParsed = z.infer<typeof ReviewListRecentInputSchema>;
export type ReviewListRecentResponseParsed = z.infer<typeof ReviewListRecentResponseSchema>;
export type ReviewGenerateDraftInputParsed = z.infer<typeof ReviewGenerateDraftInputSchema>;
export type ReviewGenerateDraftResponseParsed = z.infer<typeof ReviewGenerateDraftResponseSchema>;

// 重新导出 Review 类型方便消费方
export type { Review, ReviewDraft };
