/**
 * 收集箱（Inbox）IPC handler（T2-2 业务 IPC）
 *
 * 暴露 5 个通道（命名遵循 PROJECT_IDENTITY.md §4.1，格式 `namespace:action`）：
 *   - `inbox:list`         (filter: `{ status?: InboxStatus }`) → `InboxItem[]`
 *   - `inbox:add`          (input: `CreateInboxItemInput`)       → `InboxItem`
 *   - `inbox:update`       (input: `{ id, patch }`)              → `InboxItem`
 *   - `inbox:archive`      (input: `{ id }`)                     → `InboxItem`
 *   - `inbox:convertToTask`(input: `{ inboxId, taskDraft }`)     → `{ inbox, task }`
 *
 * 全部遵循 PROJECT_IDENTITY.md §4 IPC 契约：
 *   - 入口 Zod 校验（共享 schema 在 `shared/schemas/inbox.ts`）
 *   - try/catch 全包，错误统一转成 `{ code, message, details? }`
 *   - 不返回原始异常对象
 *   - 不在日志中打印 payload 里的敏感字段（本卡 payload 都是用户输入文本，不视作敏感；
 *     但 handler 内部仅记录结构信息，不打印 content 全文以避免大对象日志膨胀）
 *
 * 错误码（PROJECT_IDENTITY.md §4.4）：
 *   - `VALIDATION_FAILED`  Zod 校验失败
 *   - `NOT_FOUND`          资源不存在（update / archive / convertToTask 找不到 inbox）
 *   - `CONFLICT`           状态冲突（如 convertToTask 时 inbox 已 converted）
 *   - `PERSISTENCE_FAILED` db 操作失败（含 FK 违反）
 *   - `INTERNAL`           未分类
 *
 * **范围**（T2-2）：
 *   - 仅做 inbox 自身 + 写一条 task（convertToTask）。
 *   - 项目的 projectId 仅做"写入"操作；不查 / 不显示项目名（留给 T2-3）。
 *   - 不写 task:* / project:* / note:* / ai:* / review:* 的独立 IPC。
 *
 * **测试策略**（tests/inboxIpc.test.ts）：
 *   - 5 个 handler 函数以 named export 暴露（handleInboxList / handleInboxAdd / ...），
 *     测试直接传 `deps` + `payload` 调用，绕开 ipcMain 的事件循环
 *   - `registerInboxIpc(deps)` 只在主进程启动时调一次
 */

import { desc, eq } from 'drizzle-orm';
import { ipcMain } from 'electron';
import { ulid } from 'ulidx';

import { type WorkstationDb } from '../../../db/client';
import { inboxItems, tasks, type InboxItemRow, type TaskRow } from '../../../db/schema';
import {
  CreateInboxItemSchema,
  type InboxItem,
  type InboxStatus,
} from '../../../shared/types/inbox';
import {
  type TaskDraft,
  type TaskPriority,
  TASK_PRIORITIES,
} from '../../../shared/types/task';
import {
  InboxArchiveInputSchema,
  InboxConvertToTaskInputSchema,
  InboxItemSchema,
  InboxListFilterSchema,
  InboxUpdateInputSchema,
  type InboxItemParsed,
} from '../../../shared/schemas/inbox';

/** 依赖注入：注册时由主进程传入 db 客户端。 */
export interface InboxIpcDeps {
  db: WorkstationDb;
}

/** IPC 错误统一格式（PROJECT_IDENTITY.md §4.2）。 */
export type IpcErrorPayload = {
  code: 'VALIDATION_FAILED' | 'NOT_FOUND' | 'CONFLICT' | 'PERSISTENCE_FAILED' | 'INTERNAL';
  message: string;
  details?: unknown;
};

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

/** 判断 err 是否为已结构化的 IPC 错误。
 *
 * 严格匹配：`code` 必须是已知的 IPC 错误码之一。
 *
 * **为什么严格**：better-sqlite3 / Drizzle 抛出的 `SqliteError` 也带 `code: 'SQLITE_CONSTRAINT_FOREIGNKEY'`，
 * 容易被宽松的 `typeof code === 'string'` 误判。所以这里限定到 IPC 错误码枚举。
 */
function isStructuredIpcError(err: unknown): err is IpcErrorPayload {
  if (err === null || typeof err !== 'object') return false;
  const obj = err as { code?: unknown; message?: unknown };
  if (typeof obj.code !== 'string' || typeof obj.message !== 'string') return false;
  return (
    obj.code === 'VALIDATION_FAILED' ||
    obj.code === 'NOT_FOUND' ||
    obj.code === 'CONFLICT' ||
    obj.code === 'PERSISTENCE_FAILED' ||
    obj.code === 'INTERNAL'
  );
}

/**
 * 把 db 行（`InboxItemRow`）转成 IPC DTO（`InboxItemParsed`）。
 *
 * 转换点：
 *   - `createdAt` / `updatedAt` / `deletedAt`：Date → number (Unix ms)
 *   - 其他字段（kind / source / status / tags）已经是 string 数组 / 字符串字面量
 */
function rowToInboxItem(row: InboxItemRow): InboxItemParsed {
  const item: InboxItem = {
    id: row.id,
    content: row.content,
    kind: row.kind as InboxItem['kind'],
    source: row.source as InboxItem['source'],
    status: row.status as InboxItem['status'],
    convertedTo: row.convertedTo,
    projectId: row.projectId,
    tags: row.tags,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
    deletedAt: row.deletedAt ? row.deletedAt.getTime() : null,
  };
  return InboxItemSchema.parse(item);
}

/** IPC 上的 task DTO（inbox:convertToTask 响应里用）。 */
export interface TaskIpcDto {
  id: string;
  title: string;
  description: string | null;
  status: 'todo' | 'doing' | 'done' | 'archived';
  priority: 'low' | 'medium' | 'high';
  dueDate: number | null;
  projectId: string | null;
  tags: string[];
  source: 'manual' | 'ai' | 'inbox';
  inboxId: string | null;
  noteIds: string[];
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
}

/** 把 db 行（`TaskRow`）转成 IPC DTO。 */
function rowToTaskIpc(row: TaskRow): TaskIpcDto {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status as TaskIpcDto['status'],
    priority: row.priority as TaskIpcDto['priority'],
    dueDate: row.dueDate ? row.dueDate.getTime() : null,
    projectId: row.projectId,
    tags: row.tags,
    source: row.source as TaskIpcDto['source'],
    inboxId: row.inboxId,
    noteIds: row.noteIds,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
    completedAt: row.completedAt ? row.completedAt.getTime() : null,
  };
}

/**
 * 把 `TaskDraft.dueDate`（字符串）解析为 number（Unix ms）。
 * - 全数字串 → 当作 epoch 毫秒
 * - ISO / 可 parse 的日期串 → `Date.parse`
 * - 其他情况 → null（不传）
 */
function parseTaskDraftDueDate(input: string | undefined): number | null {
  if (input === undefined) return null;
  if (/^\d{1,13}$/.test(input)) {
    const n = Number(input);
    if (Number.isFinite(n) && n >= 0) return n;
    return null;
  }
  const parsed = Date.parse(input);
  return Number.isFinite(parsed) ? parsed : null;
}

/** 校验 priority 字符串是否合法（防御性）。 */
function isTaskPriority(value: string): value is TaskPriority {
  return (TASK_PRIORITIES as readonly string[]).includes(value);
}

// ============================================================
//  handler 函数（独立可测）
// ============================================================

/** `inbox:list` handler。 */
export async function handleInboxList(
  deps: InboxIpcDeps,
  payload: unknown,
): Promise<InboxItemParsed[]> {
  const parsed = InboxListFilterSchema.safeParse(payload ?? {});
  if (!parsed.success) {
    throw {
      code: 'VALIDATION_FAILED' as const,
      message: 'Invalid inbox list filter',
      details: parsed.error.flatten(),
    };
  }
  const filter: { status?: InboxStatus | undefined } = parsed.data;

  try {
    const query = deps.db.select().from(inboxItems);
    const rows =
      filter.status === undefined
        ? query.orderBy(desc(inboxItems.createdAt)).all()
        : query.where(eq(inboxItems.status, filter.status)).orderBy(desc(inboxItems.createdAt)).all();
    return rows.map((r) => rowToInboxItem(r));
  } catch (err) {
    if (isStructuredIpcError(err)) throw err;
    throw toPersistenceError(err, 'Failed to list inbox items');
  }
}

/** `inbox:add` handler。 */
export async function handleInboxAdd(
  deps: InboxIpcDeps,
  payload: unknown,
): Promise<InboxItemParsed> {
  const parsed = CreateInboxItemSchema.safeParse(payload);
  if (!parsed.success) {
    throw {
      code: 'VALIDATION_FAILED' as const,
      message: 'Invalid inbox add input',
      details: parsed.error.flatten(),
    };
  }
  const input = parsed.data;
  const now = new Date();
  const id = ulid();

  try {
    deps.db
      .insert(inboxItems)
      .values({
        id,
        content: input.content,
        kind: input.kind,
        source: input.source ?? 'manual',
        status: input.status ?? 'active',
        convertedTo: input.convertedTo ?? null,
        projectId: input.projectId ?? null,
        tags: input.tags ?? [],
        createdAt: now,
        updatedAt: now,
      })
      .run();

    const row = deps.db.select().from(inboxItems).where(eq(inboxItems.id, id)).get();
    if (!row) {
      throw {
        code: 'INTERNAL' as const,
        message: 'Inbox item was inserted but cannot be read back',
      };
    }
    return rowToInboxItem(row);
  } catch (err) {
    if (isStructuredIpcError(err)) throw err;
    throw toPersistenceError(err, 'Failed to add inbox item');
  }
}

/** `inbox:update` handler。 */
export async function handleInboxUpdate(
  deps: InboxIpcDeps,
  payload: unknown,
): Promise<InboxItemParsed> {
  const parsed = InboxUpdateInputSchema.safeParse(payload);
  if (!parsed.success) {
    throw {
      code: 'VALIDATION_FAILED' as const,
      message: 'Invalid inbox update input',
      details: parsed.error.flatten(),
    };
  }
  const { id, patch } = parsed.data;
  const now = new Date();

  try {
    const existing = deps.db.select().from(inboxItems).where(eq(inboxItems.id, id)).get();
    if (!existing) {
      throw {
        code: 'NOT_FOUND' as const,
        message: `Inbox item not found: ${id}`,
      };
    }

    const updates: Partial<InboxItemRow> = { updatedAt: now };
    if (patch.content !== undefined) updates.content = patch.content;
    if (patch.kind !== undefined) updates.kind = patch.kind;
    if (patch.source !== undefined) updates.source = patch.source;
    if (patch.status !== undefined) updates.status = patch.status;
    if (patch.convertedTo !== undefined) updates.convertedTo = patch.convertedTo;
    if (patch.projectId !== undefined) updates.projectId = patch.projectId;
    if (patch.tags !== undefined) updates.tags = patch.tags;

    deps.db.update(inboxItems).set(updates).where(eq(inboxItems.id, id)).run();

    const row = deps.db.select().from(inboxItems).where(eq(inboxItems.id, id)).get();
    if (!row) {
      throw {
        code: 'INTERNAL' as const,
        message: 'Inbox item was updated but cannot be read back',
      };
    }
    return rowToInboxItem(row);
  } catch (err) {
    if (isStructuredIpcError(err)) throw err;
    throw toPersistenceError(err, 'Failed to update inbox item');
  }
}

/** `inbox:archive` handler：标记 `status='archived'`。 */
export async function handleInboxArchive(
  deps: InboxIpcDeps,
  payload: unknown,
): Promise<InboxItemParsed> {
  const parsed = InboxArchiveInputSchema.safeParse(payload);
  if (!parsed.success) {
    throw {
      code: 'VALIDATION_FAILED' as const,
      message: 'Invalid inbox archive input',
      details: parsed.error.flatten(),
    };
  }
  const { id } = parsed.data;
  const now = new Date();

  try {
    const existing = deps.db.select().from(inboxItems).where(eq(inboxItems.id, id)).get();
    if (!existing) {
      throw {
        code: 'NOT_FOUND' as const,
        message: `Inbox item not found: ${id}`,
      };
    }

    deps.db
      .update(inboxItems)
      .set({ status: 'archived', updatedAt: now })
      .where(eq(inboxItems.id, id))
      .run();

    const row = deps.db.select().from(inboxItems).where(eq(inboxItems.id, id)).get();
    if (!row) {
      throw {
        code: 'INTERNAL' as const,
        message: 'Inbox item was archived but cannot be read back',
      };
    }
    return rowToInboxItem(row);
  } catch (err) {
    if (isStructuredIpcError(err)) throw err;
    throw toPersistenceError(err, 'Failed to archive inbox item');
  }
}

/** `inbox:convertToTask` handler：写 task + 标记 inbox converted，单事务。 */
export async function handleInboxConvertToTask(
  deps: InboxIpcDeps,
  payload: unknown,
): Promise<{ inbox: InboxItemParsed; task: TaskIpcDto }> {
  const parsed = InboxConvertToTaskInputSchema.safeParse(payload);
  if (!parsed.success) {
    throw {
      code: 'VALIDATION_FAILED' as const,
      message: 'Invalid inbox convertToTask input',
      details: parsed.error.flatten(),
    };
  }
  const { inboxId, taskDraft } = parsed.data;

  if (taskDraft.title === undefined || taskDraft.title.length === 0) {
    throw {
      code: 'VALIDATION_FAILED' as const,
      message: 'TaskDraft.title is required for convertToTask',
    };
  }
  if (taskDraft.priority !== undefined && !isTaskPriority(taskDraft.priority)) {
    throw {
      code: 'VALIDATION_FAILED' as const,
      message: `Invalid task priority: ${taskDraft.priority}`,
    };
  }

  const now = new Date();

  try {
    return deps.db.transaction((tx) => {
      const existing = tx.select().from(inboxItems).where(eq(inboxItems.id, inboxId)).get();
      if (!existing) {
        throw {
          code: 'NOT_FOUND' as const,
          message: `Inbox item not found: ${inboxId}`,
        };
      }
      if (existing.status === 'converted') {
        throw {
          code: 'CONFLICT' as const,
          message: `Inbox item already converted: ${inboxId}`,
        };
      }

      const taskId = ulid();
      const dueDate = parseTaskDraftDueDate(taskDraft.dueDate);
      tx.insert(tasks)
        .values({
          id: taskId,
          title: taskDraft.title as string,
          description: taskDraft.description ?? null,
          status: 'todo',
          priority: taskDraft.priority ?? 'medium',
          dueDate: dueDate !== null ? new Date(dueDate) : null,
          projectId: taskDraft.projectId ?? null,
          tags: taskDraft.tags ?? [],
          source: 'inbox',
          inboxId,
          noteIds: [],
          createdAt: now,
          updatedAt: now,
          completedAt: null,
        })
        .run();

      tx.update(inboxItems)
        .set({
          status: 'converted',
          convertedTo: `task:${taskId}`,
          updatedAt: now,
        })
        .where(eq(inboxItems.id, inboxId))
        .run();

      const updatedInbox = tx
        .select()
        .from(inboxItems)
        .where(eq(inboxItems.id, inboxId))
        .get();
      const newTask = tx.select().from(tasks).where(eq(tasks.id, taskId)).get();

      if (!updatedInbox || !newTask) {
        throw {
          code: 'INTERNAL' as const,
          message: 'convertToTask: rows missing after write',
        };
      }

      return { inbox: rowToInboxItem(updatedInbox), task: rowToTaskIpc(newTask) };
    });
  } catch (err) {
    if (isStructuredIpcError(err)) throw err;
    throw toPersistenceError(err, 'Failed to convert inbox item to task');
  }
}

// ============================================================
//  registerInboxIpc：把 handler 挂到 ipcMain（主进程启动时调一次）
// ============================================================

/**
 * 注册 5 个 `inbox:*` IPC handler。
 *
 * 与 `registerAppIpc` 同形：每个 handler 的入参/出参都过 Zod，错误统一转 IPC 错误。
 *
 * 调用方：`electron/main/index.ts` 的 `app.whenReady()` 阶段。
 */
export function registerInboxIpc(deps: InboxIpcDeps): void {
  ipcMain.handle('inbox:list', async (_evt, payload: unknown) => {
    try {
      return { ok: true as const, data: await handleInboxList(deps, payload) };
    } catch (err) {
      if (isStructuredIpcError(err)) return { ok: false as const, error: err };
      return { ok: false as const, error: toIpcError(err) };
    }
  });

  ipcMain.handle('inbox:add', async (_evt, payload: unknown) => {
    try {
      return { ok: true as const, data: await handleInboxAdd(deps, payload) };
    } catch (err) {
      if (isStructuredIpcError(err)) return { ok: false as const, error: err };
      return { ok: false as const, error: toIpcError(err) };
    }
  });

  ipcMain.handle('inbox:update', async (_evt, payload: unknown) => {
    try {
      return { ok: true as const, data: await handleInboxUpdate(deps, payload) };
    } catch (err) {
      if (isStructuredIpcError(err)) return { ok: false as const, error: err };
      return { ok: false as const, error: toIpcError(err) };
    }
  });

  ipcMain.handle('inbox:archive', async (_evt, payload: unknown) => {
    try {
      return { ok: true as const, data: await handleInboxArchive(deps, payload) };
    } catch (err) {
      if (isStructuredIpcError(err)) return { ok: false as const, error: err };
      return { ok: false as const, error: toIpcError(err) };
    }
  });

  ipcMain.handle('inbox:convertToTask', async (_evt, payload: unknown) => {
    try {
      return {
        ok: true as const,
        data: await handleInboxConvertToTask(deps, payload),
      };
    } catch (err) {
      if (isStructuredIpcError(err)) return { ok: false as const, error: err };
      return { ok: false as const, error: toIpcError(err) };
    }
  });
}

/** 类型导出（供 preload / store / tests 引用）。 */
export type InboxItemDto = InboxItemParsed;
export type TaskDraftInput = TaskDraft;
