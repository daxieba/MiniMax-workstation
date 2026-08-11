/**
 * 复盘（Review）IPC handler（T5-1 每日复盘）
 *
 * 暴露 5 个通道（命名遵循 PROJECT_IDENTITY.md §4.1，格式 `namespace:action`）：
 *   - `review:getByDate`     (input: `{ date }`)               → `Review | null`
 *   - `review:upsert`        (input: `UpsertInput`)            → `Review`（按 date upsert）
 *   - `review:update`        (input: `{ id, patch }`)          → `Review`（patch 语义）
 *   - `review:listRecent`    (input: `{ limit? }`)             → `Review[]`（按 date DESC）
 *   - `review:generateDraft` (input: `{ date, provider, model? }`) → `ReviewDraft`（不入库）
 *
 * **全部遵循 PROJECT_IDENTITY.md §4 IPC 契约**：
 *   - 入口 Zod 校验（共享 schema 在 `shared/schemas/review.ts`）
 *   - try/catch 全包，错误统一转成 `{ code, message, details? }`
 *   - 不返回原始异常对象
 *   - 不在日志 / 错误信息中打印 payload 里的敏感字段（本卡 payload 都是用户复盘文本，
 *     非敏感；AI 错误信息按 T3-4 兜底策略，**不**含 AI 原始输出 / API key）
 *
 * **错误码**（PROJECT_IDENTITY.md §4.4）：
 *   - `VALIDATION_FAILED`    Zod 校验失败
 *   - `NOT_FOUND`            资源不存在（update 找不到 id）
 *   - `DEPENDENCY_MISSING`   AI key 未配（generateDraft 找不到可用的 provider）
 *   - `EXTERNAL_FAILURE`     AI 调用失败（网络 / 5xx / 401 / 限流 等）
 *   - `PERSISTENCE_FAILED`   db 操作失败
 *   - `INTERNAL`             未分类
 *
 * **草稿语义**（PROJECT_IDENTITY.md §1 核心闭环）：
 *   - AI 草稿**不**自动入库 —— 用户必须"采纳"才写
 *   - `review:upsert` **不**写 `aiDraft` 字段（要写走 `review:update`）
 *   - "采纳"路径：渲染端调 `review:update({ id, patch: { ...acceptedFields, aiDraft: null } })`
 *     把 `aiDraft` 数据反序列化到正式 4 段字段，**同时**清空 `aiDraft` 字段
 *
 * **范围**（T5-1）：
 *   - 每日复盘 5 段模板（固定字段）
 *   - AI 草稿生成（不入库，schema = `review_draft`）
 *   - 不做笔记 / 任务 / 收集箱 IPC（走现有 `task:list` / `inbox:list`）
 *   - 不做 FTS5 搜索（留给 T4-2，复盘暂不入搜索）
 *
 * **测试策略**（tests/reviewIpc.test.ts）：
 *   - 5 个 handler 函数以 named export 暴露
 *   - 测试直接传 `deps` + `payload` 调用，绕开 ipcMain 事件循环
 *   - `registerReviewIpc(deps)` 只在主进程启动时调一次
 *   - `deps` 包含 `db` + `providerRegistry`（AI 调度通过 `handleAiExtractJson`）
 */

import { and, desc, eq, gte, lt, asc, type SQL } from 'drizzle-orm';
import { ipcMain } from 'electron';
import { ulid } from 'ulidx';

import { type WorkstationDb } from '../../../db/client';
import { reviews, tasks, inboxItems, type ReviewRow, type InboxItemRow } from '../../../db/schema';
import { handleAiExtractJson, type AiIpcDeps } from './ai';
import { ReviewDraftSchema, type ReviewDraftParsed } from '../../../shared/schemas/ai';
import {
  ReviewGetByDateInputSchema,
  ReviewGetByDateResponseSchema,
  ReviewGenerateDraftInputSchema,
  ReviewListRecentInputSchema,
  ReviewSchema,
  ReviewUpdateInputSchema,
  ReviewUpsertInputSchema,
  type ReviewParsed,
  type ReviewGetByDateInputParsed,
  type ReviewGetByDateResponseParsed,
  type ReviewUpsertInputParsed,
  type ReviewUpsertResponseParsed,
  type ReviewUpdateInputParsed,
  type ReviewUpdateResponseParsed,
  type ReviewListRecentInputParsed,
  type ReviewListRecentResponseParsed,
  type ReviewGenerateDraftInputParsed,
  type ReviewGenerateDraftResponseParsed,
} from '../../../shared/schemas/review';
import type { Review, ReviewDraft, ReviewItem } from '../../../shared/types/review';

/**
 * 依赖注入：注册时由主进程传入 db 客户端 + AI 调度（credentialManager）。
 *
 * 与 `AiIpcDeps` 复用 `db` + `credentialManager`，因为 `review:generateDraft`
 * 内部要调 `handleAiExtractJson`。
 */
export interface ReviewIpcDeps {
  db: WorkstationDb;
  credentialManager: AiIpcDeps['credentialManager'];
}

/** IPC 错误统一格式（PROJECT_IDENTITY.md §4.2）。 */
export interface IpcErrorPayload {
  code:
    | 'VALIDATION_FAILED'
    | 'NOT_FOUND'
    | 'DEPENDENCY_MISSING'
    | 'EXTERNAL_FAILURE'
    | 'PERSISTENCE_FAILED'
    | 'INTERNAL';
  message: string;
  details?: unknown;
}

/** 把任意异常转成 IPC 错误对象。 */
function toIpcError(err: unknown): IpcErrorPayload {
  if (err instanceof Error) {
    return { code: 'INTERNAL', message: err.message };
  }
  return { code: 'INTERNAL', message: String(err) };
}

/** 把 db 错误归类到 PERSISTENCE_FAILED。 */
function toPersistenceError(err: unknown, fallbackMessage: string): IpcErrorPayload {
  if (err instanceof Error) {
    return { code: 'PERSISTENCE_FAILED', message: `${fallbackMessage}: ${err.message}` };
  }
  return { code: 'PERSISTENCE_FAILED', message: `${fallbackMessage}: ${String(err)}` };
}

/** 判断 err 是否为已结构化的 IPC 错误。 */
function isStructuredIpcError(err: unknown): err is IpcErrorPayload {
  if (err === null || typeof err !== 'object') return false;
  const obj = err as { code?: unknown; message?: unknown };
  if (typeof obj.code !== 'string' || typeof obj.message !== 'string') return false;
  return (
    obj.code === 'VALIDATION_FAILED' ||
    obj.code === 'NOT_FOUND' ||
    obj.code === 'DEPENDENCY_MISSING' ||
    obj.code === 'EXTERNAL_FAILURE' ||
    obj.code === 'PERSISTENCE_FAILED' ||
    obj.code === 'INTERNAL'
  );
}

/** 解析 `YYYY-MM-DD` 为 `[startOfDay, endOfDay)` 的 Unix 毫秒区间（本地时区）。 */
function dateStringToRange(dateStr: string): { startMs: number; endMs: number } {
  // dateStr 必为 YYYY-MM-DD（schema 已 regex 校验）
  const [y, m, d] = dateStr.split('-').map((s) => Number(s));
  if (
    y === undefined ||
    m === undefined ||
    d === undefined ||
    !Number.isFinite(y) ||
    !Number.isFinite(m) ||
    !Number.isFinite(d)
  ) {
    // 不可达 —— schema 已 regex 校验；防御性兜底用 today 区间
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return { startMs: now.getTime(), endMs: now.getTime() + 24 * 60 * 60 * 1000 };
  }
  const start = new Date(y, m - 1, d, 0, 0, 0, 0);
  const end = new Date(y, m - 1, d + 1, 0, 0, 0, 0);
  return { startMs: start.getTime(), endMs: end.getTime() };
}

/**
 * 把 db 行（`ReviewRow`）转成 IPC DTO（`ReviewParsed`）。
 *
 * 转换点：
 *   - `completed` / `uncompleted` / `topThree` / `aiDraft` 已是 Drizzle `mode: 'json'`
 *     解出的对象；做窄化兜底
 *   - `createdAt` / `updatedAt` Date → number (Unix ms)
 */
function rowToReview(row: ReviewRow): ReviewParsed {
  // 窄化兜底：DB 里 4 个 JSON 字段已是 object；Drizzle mode: 'json' 解析
  // 但 TS 上是 $type 推断，runtime 仍是 object / string / null
  const item: Review = {
    id: row.id,
    date: row.date,
    completed: Array.isArray(row.completed) ? row.completed : [],
    uncompleted: Array.isArray(row.uncompleted) ? row.uncompleted : [],
    blockers: row.blockers ?? '',
    topThree: Array.isArray(row.topThree) ? row.topThree : [],
    aiDraft: row.aiDraft ?? null,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  };
  return ReviewSchema.parse(item);
}

// ============================================================
//  handler 函数（独立可测）
// ============================================================

/** `review:getByDate` handler。 */
export async function handleReviewGetByDate(
  deps: ReviewIpcDeps,
  payload: unknown,
): Promise<ReviewGetByDateResponseParsed> {
  const parsed = ReviewGetByDateInputSchema.safeParse(payload);
  if (!parsed.success) {
    throw {
      code: 'VALIDATION_FAILED' as const,
      message: 'Invalid review getByDate input',
      details: parsed.error.flatten(),
    };
  }
  const input: ReviewGetByDateInputParsed = parsed.data;

  try {
    const row = deps.db.select().from(reviews).where(eq(reviews.date, input.date)).get();
    if (!row) {
      return ReviewGetByDateResponseSchema.parse(null);
    }
    return rowToReview(row);
  } catch (err) {
    if (isStructuredIpcError(err)) throw err;
    throw toPersistenceError(err, 'Failed to get review by date');
  }
}

/** `review:upsert` handler（按 `date` 唯一键 upsert）。
 *
 * - **不**写 `aiDraft`（必须走 `review:update` 显式采纳）
 * - 创建时 `id` 用 ulid，`createdAt` = `updatedAt` = now
 * - 更新时 `id` 保持原值，`createdAt` 保持原值，`updatedAt` 刷新为 now
 */
export async function handleReviewUpsert(
  deps: ReviewIpcDeps,
  payload: unknown,
): Promise<ReviewUpsertResponseParsed> {
  const parsed = ReviewUpsertInputSchema.safeParse(payload);
  if (!parsed.success) {
    throw {
      code: 'VALIDATION_FAILED' as const,
      message: 'Invalid review upsert input',
      details: parsed.error.flatten(),
    };
  }
  const input: ReviewUpsertInputParsed = parsed.data;
  const now = new Date();

  try {
    const existing = deps.db.select().from(reviews).where(eq(reviews.date, input.date)).get();

    if (existing) {
      // update 路径
      deps.db
        .update(reviews)
        .set({
          completed: input.completed,
          uncompleted: input.uncompleted,
          blockers: input.blockers,
          topThree: input.topThree,
          updatedAt: now,
        })
        .where(eq(reviews.id, existing.id))
        .run();

      const row = deps.db.select().from(reviews).where(eq(reviews.id, existing.id)).get();
      if (!row) {
        throw {
          code: 'INTERNAL' as const,
          message: 'Review was updated but cannot be read back',
        };
      }
      return rowToReview(row);
    }

    // insert 路径
    const id = ulid();
    deps.db
      .insert(reviews)
      .values({
        id,
        date: input.date,
        completed: input.completed,
        uncompleted: input.uncompleted,
        blockers: input.blockers,
        topThree: input.topThree,
        aiDraft: null,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    const row = deps.db.select().from(reviews).where(eq(reviews.id, id)).get();
    if (!row) {
      throw {
        code: 'INTERNAL' as const,
        message: 'Review was inserted but cannot be read back',
      };
    }
    return rowToReview(row);
  } catch (err) {
    if (isStructuredIpcError(err)) throw err;
    throw toPersistenceError(err, 'Failed to upsert review');
  }
}

/** `review:update` handler（patch 语义）。
 *
 * - `date` 不可改（date 是唯一键，修改 = 删旧 + 插新；走 upsert）
 * - 其他字段可改（含 `aiDraft` 可显式设为 null 清空）
 * - "采纳"路径：把 `aiDraft` 数据反序列化到正式 4 段字段，**同时**清空 `aiDraft`
 */
export async function handleReviewUpdate(
  deps: ReviewIpcDeps,
  payload: unknown,
): Promise<ReviewUpdateResponseParsed> {
  const parsed = ReviewUpdateInputSchema.safeParse(payload);
  if (!parsed.success) {
    throw {
      code: 'VALIDATION_FAILED' as const,
      message: 'Invalid review update input',
      details: parsed.error.flatten(),
    };
  }
  const input: ReviewUpdateInputParsed = parsed.data;
  const { id, patch } = input;
  const now = new Date();

  try {
    const existing = deps.db.select().from(reviews).where(eq(reviews.id, id)).get();
    if (!existing) {
      throw {
        code: 'NOT_FOUND' as const,
        message: `Review not found: ${id}`,
      };
    }

    const updates: Partial<ReviewRow> = { updatedAt: now };
    if (patch.completed !== undefined) updates.completed = patch.completed;
    if (patch.uncompleted !== undefined) updates.uncompleted = patch.uncompleted;
    if (patch.blockers !== undefined) updates.blockers = patch.blockers;
    if (patch.topThree !== undefined) updates.topThree = patch.topThree;
    if (patch.aiDraft !== undefined) updates.aiDraft = patch.aiDraft;

    deps.db.update(reviews).set(updates).where(eq(reviews.id, id)).run();

    const row = deps.db.select().from(reviews).where(eq(reviews.id, id)).get();
    if (!row) {
      throw {
        code: 'INTERNAL' as const,
        message: 'Review was updated but cannot be read back',
      };
    }
    return rowToReview(row);
  } catch (err) {
    if (isStructuredIpcError(err)) throw err;
    throw toPersistenceError(err, 'Failed to update review');
  }
}

/** `review:listRecent` handler（按 `date DESC` 取最近 N 条，默认 30，最大 365）。 */
export async function handleReviewListRecent(
  deps: ReviewIpcDeps,
  payload: unknown,
): Promise<ReviewListRecentResponseParsed> {
  const parsed = ReviewListRecentInputSchema.safeParse(payload ?? {});
  if (!parsed.success) {
    throw {
      code: 'VALIDATION_FAILED' as const,
      message: 'Invalid review listRecent input',
      details: parsed.error.flatten(),
    };
  }
  const input: ReviewListRecentInputParsed = parsed.data;
  const limit = input.limit ?? 30;

  try {
    const rows = deps.db
      .select()
      .from(reviews)
      .orderBy(desc(reviews.date))
      .limit(limit)
      .all();
    return rows.map((r) => rowToReview(r));
  } catch (err) {
    if (isStructuredIpcError(err)) throw err;
    throw toPersistenceError(err, 'Failed to list recent reviews');
  }
}

/** `review:generateDraft` handler（不入库）。
 *
 * 行为：
 *   1. 校验入参（date / provider / model?）
 *   2. 拿当天 + 昨天的 task（按 `updatedAt` desc 取所有状态）
 *   3. 拿当天 + 昨天的 inbox_items
 *   4. 拼 prompt：今天日期 + 完成/未完成任务标题列表 + 收集箱条目
 *   5. 调 `handleAiExtractJson({ schemaName: 'review_draft', ... })`
 *   6. 返回 schema 校验后的 `ReviewDraft`
 *
 * **错误码**：
 *   - `VALIDATION_FAILED`    Zod 校验失败
 *   - `DEPENDENCY_MISSING`   AI key 未配（由 handleAiExtractJson 内部抛）
 *   - `EXTERNAL_FAILURE`     AI 调用失败
 *   - `PERSISTENCE_FAILED`   读 tasks / inbox_items 失败
 *   - `INTERNAL`             未分类
 */
export async function handleReviewGenerateDraft(
  deps: ReviewIpcDeps,
  payload: unknown,
): Promise<ReviewGenerateDraftResponseParsed> {
  const parsed = ReviewGenerateDraftInputSchema.safeParse(payload);
  if (!parsed.success) {
    throw {
      code: 'VALIDATION_FAILED' as const,
      message: 'Invalid review generateDraft input',
      details: parsed.error.flatten(),
    };
  }
  const input: ReviewGenerateDraftInputParsed = parsed.data;

  // 1. 解析日期范围（今天 + 昨天）—— 拿相关 task / inbox_items
  const { startMs: todayStart, endMs: todayEnd } = dateStringToRange(input.date);
  const yesterdayStart = todayStart - 24 * 60 * 60 * 1000;

  let doneTasks: Array<{ id: string; title: string }> = [];
  let todoTasks: Array<{ id: string; title: string }> = [];
  let inboxSnippets: string[] = [];
  try {
    // 完成的任务：status='done' 且 updatedAt 在 [yesterdayStart, todayEnd)
    // 未完成：status='todo' 且 updatedAt 在 [yesterdayStart, todayEnd)
    const doneConditions: SQL[] = [
      eq(tasks.status, 'done'),
      gte(tasks.updatedAt, new Date(yesterdayStart)),
      lt(tasks.updatedAt, new Date(todayEnd)),
    ];
    const todoConditions: SQL[] = [
      eq(tasks.status, 'todo'),
      gte(tasks.updatedAt, new Date(yesterdayStart)),
      lt(tasks.updatedAt, new Date(todayEnd)),
    ];
    const doneRows = deps.db
      .select({ id: tasks.id, title: tasks.title })
      .from(tasks)
      .where(and(...doneConditions))
      .orderBy(asc(tasks.title))
      .all();
    const todoRows = deps.db
      .select({ id: tasks.id, title: tasks.title })
      .from(tasks)
      .where(and(...todoConditions))
      .orderBy(asc(tasks.title))
      .all();
    doneTasks = doneRows.map((r: { id: string; title: string }) => ({
      id: r.id,
      title: r.title,
    }));
    todoTasks = todoRows.map((r: { id: string; title: string }) => ({
      id: r.id,
      title: r.title,
    }));

    // 收集箱条目：createdAt 在 [yesterdayStart, todayEnd)
    const inboxRows = deps.db
      .select({ content: inboxItems.content, kind: inboxItems.kind })
      .from(inboxItems)
      .where(
        and(
          gte(inboxItems.createdAt, new Date(yesterdayStart)),
          lt(inboxItems.createdAt, new Date(todayEnd)),
        ),
      )
      .orderBy(desc(inboxItems.createdAt))
      .limit(50)
      .all();
    inboxSnippets = inboxRows.map((r: InboxItemRow | { content: string; kind: string }) =>
      r.content.length > 200 ? r.content.slice(0, 200) + '…' : r.content,
    );
  } catch (err) {
    if (isStructuredIpcError(err)) throw err;
    throw toPersistenceError(err, 'Failed to read tasks / inbox for draft');
  }

  // 2. 拼 prompt
  const systemHint = `你是一名个人工作助理。请根据用户提供的"完成 / 未完成任务"和"收集箱条目"，生成一份**结构化**的每日复盘草稿。
要求：
1. completed: 从 done 任务中提炼，最多 5 条；每条 1 行短句
2. uncompleted: 从 todo 任务中提炼，最多 5 条；reason 字段填 1 行（如果能看出阻塞原因）
3. blockers: 自由文本（基于 inbox 推断；如没有则填 "无"）
4. topThree: 给出明日 3 件事；纯字符串数组
仅输出合法 JSON，**不要** markdown fence。`;

  const userPayload = {
    date: input.date,
    done: doneTasks.map((t: { id: string; title: string }) => `${t.title} (id=${t.id})`),
    todo: todoTasks.map((t: { id: string; title: string }) => `${t.title} (id=${t.id})`),
    inbox: inboxSnippets,
  };

  const userMessage = JSON.stringify(userPayload);

  // 3. 调 handleAiExtractJson（已经做了重试 + Zod 校验 + 错误码归类）
  const aiDeps: AiIpcDeps = { db: deps.db, credentialManager: deps.credentialManager };
  const extractInput: {
    provider: 'minimax' | 'openai-compatible';
    schemaName: 'review_draft';
    messages: Array<{ role: 'user'; content: string }>;
    systemHint: string;
    model?: string;
  } = {
    provider: input.provider,
    schemaName: 'review_draft',
    messages: [{ role: 'user', content: userMessage }],
    systemHint,
  };
  if (input.model !== undefined) {
    extractInput.model = input.model;
  }

  try {
    const result = await handleAiExtractJson(aiDeps, extractInput);
    // 4. 出口用 schema 校验一次（防御 provider 内部 bug）
    const draft: ReviewDraftParsed = ReviewDraftSchema.parse(result.data);
    return draft;
  } catch (err) {
    if (isStructuredIpcError(err)) throw err;
    // handleAiExtractJson 内部已经把所有错误码归类；如果还是冒出来未分类的，按 INTERNAL
    throw toIpcError(err);
  }
}

// ============================================================
//  registerReviewIpc：把 handler 挂到 ipcMain（主进程启动时调一次）
// ============================================================

/**
 * 注册 5 个 `review:*` IPC handler。
 *
 * 调用方：`electron/main/index.ts` 的 `app.whenReady()` 阶段。
 */
export function registerReviewIpc(deps: ReviewIpcDeps): void {
  ipcMain.handle('review:getByDate', async (_evt, payload: unknown) => {
    try {
      return {
        ok: true as const,
        data: await handleReviewGetByDate(deps, payload),
      };
    } catch (err) {
      if (isStructuredIpcError(err)) return { ok: false as const, error: err };
      return { ok: false as const, error: toIpcError(err) };
    }
  });

  ipcMain.handle('review:upsert', async (_evt, payload: unknown) => {
    try {
      return {
        ok: true as const,
        data: await handleReviewUpsert(deps, payload),
      };
    } catch (err) {
      if (isStructuredIpcError(err)) return { ok: false as const, error: err };
      return { ok: false as const, error: toIpcError(err) };
    }
  });

  ipcMain.handle('review:update', async (_evt, payload: unknown) => {
    try {
      return {
        ok: true as const,
        data: await handleReviewUpdate(deps, payload),
      };
    } catch (err) {
      if (isStructuredIpcError(err)) return { ok: false as const, error: err };
      return { ok: false as const, error: toIpcError(err) };
    }
  });

  ipcMain.handle('review:listRecent', async (_evt, payload: unknown) => {
    try {
      return {
        ok: true as const,
        data: await handleReviewListRecent(deps, payload),
      };
    } catch (err) {
      if (isStructuredIpcError(err)) return { ok: false as const, error: err };
      return { ok: false as const, error: toIpcError(err) };
    }
  });

  ipcMain.handle('review:generateDraft', async (_evt, payload: unknown) => {
    try {
      return {
        ok: true as const,
        data: await handleReviewGenerateDraft(deps, payload),
      };
    } catch (err) {
      if (isStructuredIpcError(err)) return { ok: false as const, error: err };
      return { ok: false as const, error: toIpcError(err) };
    }
  });
}

// 重新导出 Review 类型方便消费方
export type { Review, ReviewDraft, ReviewItem };
