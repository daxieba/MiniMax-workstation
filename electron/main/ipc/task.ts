/**
 * 任务（Task）IPC handler（T2-3 业务 IPC）
 *
 * 暴露 7 个通道（命名遵循 PROJECT_IDENTITY.md §4.1，格式 `namespace:action`）：
 *   - `task:list`        (filter: `{ status?, priority?, projectId? }`) → `Task[]`
 *   - `task:get`         (input: `{ id }`)                              → `Task`
 *   - `task:create`      (input: `CreateTaskInput`)                     → `Task`
 *   - `task:update`      (input: `{ id, patch }`)                       → `Task`
 *   - `task:transition`  (input: `{ id, to }`)                          → `Task`
 *   - `task:archive`     (input: `{ id }`)                             → `Task`（等价 transition 到 archived）
 *   - `task:delete`      (input: `{ id }`)                             → `{ deleted: true }`
 *
 * **状态机强制**：
 *   - `task:transition` / `task:update`（含 `status` patch）必须用
 *     `shared/types/taskStatus.ts` 的 `transition()` 校验合法性
 *   - 非法流转抛 `InvalidTaskTransitionError` → 在 handler 内转成 `CONFLICT` 错误码
 *   - `completedAt` 联动由 `task:transition` 维护：
 *     - 转 `done` 时填 `Date.now()`
 *     - 转出 `done` 时（`done → todo` / `done → archived`）清空
 *
 * 全部遵循 PROJECT_IDENTITY.md §4 IPC 契约：
 *   - 入口 Zod 校验（共享 schema 在 `shared/schemas/task.ts`）
 *   - try/catch 全包，错误统一转成 `{ code, message, details? }`
 *   - 不返回原始异常对象
 *
 * 错误码（PROJECT_IDENTITY.md §4.4）：
 *   - `VALIDATION_FAILED`  Zod 校验失败
 *   - `NOT_FOUND`          资源不存在（get / update / transition / archive / delete 找不到 id）
 *   - `CONFLICT`           状态冲突（非法状态流转）
 *   - `PERSISTENCE_FAILED` db 操作失败（含 FK 违反）
 *   - `INTERNAL`           未分类
 *
 * **范围**（T2-3）：
 *   - 仅做 task 自身。
 *   - 不写 note:* / ai:* / review:* / kb:* 的 IPC（留给对应业务卡）。
 *   - `task:delete` 走硬删；FK 关系是 ON DELETE NO ACTION，若有笔记 id 引用
 *     （T4-x 落地）会被 SQLite 拒 → 业务层应先解关联。
 *
 * **测试策略**（tests/taskIpc.test.ts）：
 *   - 7 个 handler 函数以 named export 暴露，测试直接传 `deps` + `payload` 调用
 *   - `registerTaskIpc(deps)` 只在主进程启动时调一次
 */

import { and, desc, eq, isNull } from 'drizzle-orm';
import { ipcMain } from 'electron';
import { ulid } from 'ulidx';

import { type WorkstationDb } from '../../../db/client';
import { tasks, type TaskRow } from '../../../db/schema';
import {
  CreateTaskInputSchema,
  TaskArchiveInputSchema,
  TaskDeleteInputSchema,
  TaskDeleteResponseSchema,
  TaskGetInputSchema,
  TaskListFilterSchema,
  TaskSchema,
  TaskTransitionInputSchema,
  UpdateTaskInputSchema,
  type TaskParsed,
} from '../../../shared/schemas/task';
import {
  InvalidTaskTransitionError,
  TASK_STATUSES,
  TaskStatusSchema,
  transition,
  type TaskStatus,
} from '../../../shared/types/taskStatus';
import {
  TASK_PRIORITIES,
  type Task,
  type TaskPriority,
  type TaskSource,
} from '../../../shared/types/task';

/** 依赖注入：注册时由主进程传入 db 客户端。 */
export interface TaskIpcDeps {
  db: WorkstationDb;
}

/** IPC 错误统一格式（PROJECT_IDENTITY.md §4.2）。 */
export interface IpcErrorPayload {
  code: 'VALIDATION_FAILED' | 'NOT_FOUND' | 'CONFLICT' | 'PERSISTENCE_FAILED' | 'INTERNAL';
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

/** 判断 err 是否为已结构化的 IPC 错误（严格匹配，避免误吃 SqliteError.code）。 */
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

/** 运行时校验 status 字符串。 */
function isTaskStatus(value: string): value is TaskStatus {
  return (TASK_STATUSES as readonly string[]).includes(value);
}

/** 运行时校验 priority 字符串。 */
function isTaskPriority(value: string): value is TaskPriority {
  return (TASK_PRIORITIES as readonly string[]).includes(value);
}

/** 运行时校验 source 字符串。 */
function isTaskSource(value: string): value is TaskSource {
  return (['manual', 'ai', 'inbox'] as readonly string[]).includes(value);
}

/**
 * 把 db 行（`TaskRow`）转成 IPC DTO（`TaskParsed`）。
 *
 * 转换点：
 *   - `dueDate` / `createdAt` / `updatedAt` / `completedAt` Date → number (Unix ms)
 *   - 其他字段（status / priority / source）已在 schema 层是 string 字符串字面量
 */
function rowToTask(row: TaskRow): TaskParsed {
  const item: Task = {
    id: row.id,
    title: row.title,
    description: row.description,
    status: isTaskStatus(row.status) ? row.status : 'todo',
    priority: isTaskPriority(row.priority) ? row.priority : 'medium',
    dueDate: row.dueDate ? row.dueDate.getTime() : null,
    projectId: row.projectId,
    tags: row.tags,
    source: isTaskSource(row.source) ? row.source : 'manual',
    inboxId: row.inboxId,
    noteIds: row.noteIds,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
    completedAt: row.completedAt ? row.completedAt.getTime() : null,
  };
  return TaskSchema.parse(item);
}

/**
 * 根据状态流转计算新的 `completedAt`。
 *
 * 约定（与 `shared/types/taskStatus.ts` 文档一致）：
 *   - 转 `done` → 填 `Date.now()`
 *   - 转出 `done`（包括 `done → todo` / `done → archived`）→ 清空 `null`
 *   - 其他流转（与 `done` 无关）→ 保持原值
 */
function computeCompletedAt(from: TaskStatus, to: TaskStatus, prev: Date | null): Date | null {
  if (to === 'done') {
    return new Date();
  }
  if (from === 'done') {
    return null;
  }
  return prev;
}

// ============================================================
//  handler 函数（独立可测）
// ============================================================

/** `task:list` handler。 */
export async function handleTaskList(
  deps: TaskIpcDeps,
  payload: unknown,
): Promise<TaskParsed[]> {
  const parsed = TaskListFilterSchema.safeParse(payload ?? {});
  if (!parsed.success) {
    throw {
      code: 'VALIDATION_FAILED' as const,
      message: 'Invalid task list filter',
      details: parsed.error.flatten(),
    };
  }
  const filter: {
    status?: TaskStatus | undefined;
    priority?: TaskPriority | undefined;
    projectId?: string | null | undefined;
  } = parsed.data;

  try {
    const conditions = [];
    if (filter.status !== undefined) {
      conditions.push(eq(tasks.status, filter.status));
    }
    if (filter.priority !== undefined) {
      conditions.push(eq(tasks.priority, filter.priority));
    }
    if (filter.projectId !== undefined) {
      // null 走 isNull；非 null 走 eq
      conditions.push(filter.projectId === null ? isNull(tasks.projectId) : eq(tasks.projectId, filter.projectId));
    }

    const baseQuery = deps.db.select().from(tasks);
    const rows = conditions.length === 0
      ? baseQuery.orderBy(desc(tasks.createdAt)).all()
      : baseQuery.where(and(...conditions)).orderBy(desc(tasks.createdAt)).all();
    return rows.map((r) => rowToTask(r));
  } catch (err) {
    if (isStructuredIpcError(err)) throw err;
    throw toPersistenceError(err, 'Failed to list tasks');
  }
}

/** `task:get` handler。 */
export async function handleTaskGet(
  deps: TaskIpcDeps,
  payload: unknown,
): Promise<TaskParsed> {
  const parsed = TaskGetInputSchema.safeParse(payload);
  if (!parsed.success) {
    throw {
      code: 'VALIDATION_FAILED' as const,
      message: 'Invalid task get input',
      details: parsed.error.flatten(),
    };
  }
  const { id } = parsed.data;

  try {
    const row = deps.db.select().from(tasks).where(eq(tasks.id, id)).get();
    if (!row) {
      throw {
        code: 'NOT_FOUND' as const,
        message: `Task not found: ${id}`,
      };
    }
    return rowToTask(row);
  } catch (err) {
    if (isStructuredIpcError(err)) throw err;
    throw toPersistenceError(err, 'Failed to get task');
  }
}

/** `task:create` handler。 */
export async function handleTaskCreate(
  deps: TaskIpcDeps,
  payload: unknown,
): Promise<TaskParsed> {
  const parsed = CreateTaskInputSchema.safeParse(payload);
  if (!parsed.success) {
    throw {
      code: 'VALIDATION_FAILED' as const,
      message: 'Invalid task create input',
      details: parsed.error.flatten(),
    };
  }
  const input = parsed.data;
  const now = new Date();
  const id = ulid();
  const status: TaskStatus = input.status ?? 'todo';
  // completedAt 仅在 status === 'done' 时有意义
  const completedAt = status === 'done' ? now : null;

  try {
    deps.db
      .insert(tasks)
      .values({
        id,
        title: input.title,
        description: input.description ?? null,
        status,
        priority: input.priority ?? 'medium',
        dueDate: input.dueDate !== undefined && input.dueDate !== null ? new Date(input.dueDate) : null,
        projectId: input.projectId ?? null,
        tags: input.tags ?? [],
        source: input.source ?? 'manual',
        inboxId: input.inboxId ?? null,
        noteIds: input.noteIds ?? [],
        createdAt: now,
        updatedAt: now,
        completedAt,
      })
      .run();

    const row = deps.db.select().from(tasks).where(eq(tasks.id, id)).get();
    if (!row) {
      throw {
        code: 'INTERNAL' as const,
        message: 'Task was inserted but cannot be read back',
      };
    }
    return rowToTask(row);
  } catch (err) {
    if (isStructuredIpcError(err)) throw err;
    throw toPersistenceError(err, 'Failed to create task');
  }
}

/** `task:update` handler。 */
export async function handleTaskUpdate(
  deps: TaskIpcDeps,
  payload: unknown,
): Promise<TaskParsed> {
  const parsed = UpdateTaskInputSchema.safeParse(payload);
  if (!parsed.success) {
    throw {
      code: 'VALIDATION_FAILED' as const,
      message: 'Invalid task update input',
      details: parsed.error.flatten(),
    };
  }
  const { id, patch } = parsed.data;
  const now = new Date();

  try {
    const existing = deps.db.select().from(tasks).where(eq(tasks.id, id)).get();
    if (!existing) {
      throw {
        code: 'NOT_FOUND' as const,
        message: `Task not found: ${id}`,
      };
    }

    const currentStatus: TaskStatus = isTaskStatus(existing.status) ? existing.status : 'todo';

    // 状态机校验：如果 patch 包含 status，必须是合法流转
    let nextStatus: TaskStatus = currentStatus;
    if (patch.status !== undefined) {
      try {
        nextStatus = transition(currentStatus, patch.status);
      } catch (err) {
        if (err instanceof InvalidTaskTransitionError) {
          throw {
            code: 'CONFLICT' as const,
            message: `Invalid task status transition: ${err.from} -> ${err.to}`,
            details: { from: err.from, to: err.to },
          };
        }
        throw err;
      }
    }

    const updates: Partial<TaskRow> = { updatedAt: now };
    if (patch.title !== undefined) updates.title = patch.title;
    if (patch.description !== undefined) updates.description = patch.description;
    if (patch.status !== undefined) updates.status = nextStatus;
    if (patch.priority !== undefined) updates.priority = patch.priority;
    if (patch.dueDate !== undefined) {
      updates.dueDate = patch.dueDate !== null ? new Date(patch.dueDate) : null;
    }
    if (patch.projectId !== undefined) updates.projectId = patch.projectId;
    if (patch.tags !== undefined) updates.tags = patch.tags;
    if (patch.source !== undefined) updates.source = patch.source;
    if (patch.inboxId !== undefined) updates.inboxId = patch.inboxId;
    if (patch.noteIds !== undefined) updates.noteIds = patch.noteIds;

    // completedAt 联动
    if (patch.status !== undefined) {
      updates.completedAt = computeCompletedAt(currentStatus, nextStatus, existing.completedAt);
    }

    deps.db.update(tasks).set(updates).where(eq(tasks.id, id)).run();

    const row = deps.db.select().from(tasks).where(eq(tasks.id, id)).get();
    if (!row) {
      throw {
        code: 'INTERNAL' as const,
        message: 'Task was updated but cannot be read back',
      };
    }
    return rowToTask(row);
  } catch (err) {
    if (isStructuredIpcError(err)) throw err;
    throw toPersistenceError(err, 'Failed to update task');
  }
}

/** `task:transition` handler：用 `transition()` 强制状态机 + 维护 `completedAt`。 */
export async function handleTaskTransition(
  deps: TaskIpcDeps,
  payload: unknown,
): Promise<TaskParsed> {
  const parsed = TaskTransitionInputSchema.safeParse(payload);
  if (!parsed.success) {
    throw {
      code: 'VALIDATION_FAILED' as const,
      message: 'Invalid task transition input',
      details: parsed.error.flatten(),
    };
  }
  const { id, to } = parsed.data;
  // 防御性：schema 已校验 `to` 是合法 status；这里只强转一下方便后续
  const toStatus: TaskStatus = TaskStatusSchema.parse(to);
  const now = new Date();

  try {
    const existing = deps.db.select().from(tasks).where(eq(tasks.id, id)).get();
    if (!existing) {
      throw {
        code: 'NOT_FOUND' as const,
        message: `Task not found: ${id}`,
      };
    }

    const currentStatus: TaskStatus = isTaskStatus(existing.status) ? existing.status : 'todo';

    // 状态机强制：非法流转 → CONFLICT
    let nextStatus: TaskStatus;
    try {
      nextStatus = transition(currentStatus, toStatus);
    } catch (err) {
      if (err instanceof InvalidTaskTransitionError) {
        throw {
          code: 'CONFLICT' as const,
          message: `Invalid task status transition: ${err.from} -> ${err.to}`,
          details: { from: err.from, to: err.to },
        };
      }
      throw err;
    }

    const completedAt = computeCompletedAt(currentStatus, nextStatus, existing.completedAt);

    deps.db
      .update(tasks)
      .set({ status: nextStatus, completedAt, updatedAt: now })
      .where(eq(tasks.id, id))
      .run();

    const row = deps.db.select().from(tasks).where(eq(tasks.id, id)).get();
    if (!row) {
      throw {
        code: 'INTERNAL' as const,
        message: 'Task was transitioned but cannot be read back',
      };
    }
    return rowToTask(row);
  } catch (err) {
    if (isStructuredIpcError(err)) throw err;
    throw toPersistenceError(err, 'Failed to transition task');
  }
}

/** `task:archive` handler：等价 `task:transition(id, 'archived')`。 */
export async function handleTaskArchive(
  deps: TaskIpcDeps,
  payload: unknown,
): Promise<TaskParsed> {
  const parsed = TaskArchiveInputSchema.safeParse(payload);
  if (!parsed.success) {
    throw {
      code: 'VALIDATION_FAILED' as const,
      message: 'Invalid task archive input',
      details: parsed.error.flatten(),
    };
  }
  const { id } = parsed.data;
  return handleTaskTransition(deps, { id, to: 'archived' });
}

/** `task:delete` handler：硬删。 */
export async function handleTaskDelete(
  deps: TaskIpcDeps,
  payload: unknown,
): Promise<{ deleted: true }> {
  const parsed = TaskDeleteInputSchema.safeParse(payload);
  if (!parsed.success) {
    throw {
      code: 'VALIDATION_FAILED' as const,
      message: 'Invalid task delete input',
      details: parsed.error.flatten(),
    };
  }
  const { id } = parsed.data;

  try {
    const existing = deps.db.select().from(tasks).where(eq(tasks.id, id)).get();
    if (!existing) {
      throw {
        code: 'NOT_FOUND' as const,
        message: `Task not found: ${id}`,
      };
    }
    deps.db.delete(tasks).where(eq(tasks.id, id)).run();
    return TaskDeleteResponseSchema.parse({ deleted: true });
  } catch (err) {
    if (isStructuredIpcError(err)) throw err;
    throw toPersistenceError(err, 'Failed to delete task');
  }
}

// ============================================================
//  registerTaskIpc：把 handler 挂到 ipcMain（主进程启动时调一次）
// ============================================================

/**
 * 注册 7 个 `task:*` IPC handler。
 *
 * 调用方：`electron/main/index.ts` 的 `app.whenReady()` 阶段。
 */
export function registerTaskIpc(deps: TaskIpcDeps): void {
  ipcMain.handle('task:list', async (_evt, payload: unknown) => {
    try {
      return { ok: true as const, data: await handleTaskList(deps, payload) };
    } catch (err) {
      if (isStructuredIpcError(err)) return { ok: false as const, error: err };
      return { ok: false as const, error: toIpcError(err) };
    }
  });

  ipcMain.handle('task:get', async (_evt, payload: unknown) => {
    try {
      return { ok: true as const, data: await handleTaskGet(deps, payload) };
    } catch (err) {
      if (isStructuredIpcError(err)) return { ok: false as const, error: err };
      return { ok: false as const, error: toIpcError(err) };
    }
  });

  ipcMain.handle('task:create', async (_evt, payload: unknown) => {
    try {
      return { ok: true as const, data: await handleTaskCreate(deps, payload) };
    } catch (err) {
      if (isStructuredIpcError(err)) return { ok: false as const, error: err };
      return { ok: false as const, error: toIpcError(err) };
    }
  });

  ipcMain.handle('task:update', async (_evt, payload: unknown) => {
    try {
      return { ok: true as const, data: await handleTaskUpdate(deps, payload) };
    } catch (err) {
      if (isStructuredIpcError(err)) return { ok: false as const, error: err };
      return { ok: false as const, error: toIpcError(err) };
    }
  });

  ipcMain.handle('task:transition', async (_evt, payload: unknown) => {
    try {
      return { ok: true as const, data: await handleTaskTransition(deps, payload) };
    } catch (err) {
      if (isStructuredIpcError(err)) return { ok: false as const, error: err };
      return { ok: false as const, error: toIpcError(err) };
    }
  });

  ipcMain.handle('task:archive', async (_evt, payload: unknown) => {
    try {
      return { ok: true as const, data: await handleTaskArchive(deps, payload) };
    } catch (err) {
      if (isStructuredIpcError(err)) return { ok: false as const, error: err };
      return { ok: false as const, error: toIpcError(err) };
    }
  });

  ipcMain.handle('task:delete', async (_evt, payload: unknown) => {
    try {
      return { ok: true as const, data: await handleTaskDelete(deps, payload) };
    } catch (err) {
      if (isStructuredIpcError(err)) return { ok: false as const, error: err };
      return { ok: false as const, error: toIpcError(err) };
    }
  });
}
