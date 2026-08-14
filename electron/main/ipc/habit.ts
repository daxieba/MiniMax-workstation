/**
 * 习惯（Habit）IPC handler（v0.4.0 新功能）
 *
 * 暴露 8 个通道：
 *   - `habit:list`         → `Habit[]`（按 createdAt desc）
 *   - `habit:create`       → `Habit`
 *   - `habit:update`       → `Habit`（patch 语义）
 *   - `habit:archive`      → `Habit`（设 archived 标志）
 *   - `habit:delete`       → `{ deleted: true }`（硬删 + 删 logs）
 *   - `habit:toggleLog`    → `{ date, completed }`（toggle 单天打卡状态）
 *   - `habit:listLogs`     → `HabitLog[]`（某 habit 的 logs，可选日期范围）
 *   - `habit:logsInRange`  → `HabitLog[]`（所有 habit 在某段时间的 logs）
 *
 * 全部遵循 PROJECT_IDENTITY.md §4 IPC 契约。
 *
 * 错误码：
 *   - `VALIDATION_FAILED`  Zod 校验失败
 *   - `NOT_FOUND`          资源不存在（update 找不到 id）
 *   - `PERSISTENCE_FAILED` db 操作失败
 *   - `INTERNAL`           未分类
 *
 * **不做**：
 *   - 提醒（v0.4.0 不做）
 *   - streak 计算（应用层从 logs 算）
 */
import { and, between, desc, eq, gte, lte, type SQL } from 'drizzle-orm';
import { ipcMain } from 'electron';
import { ulid } from 'ulidx';

import { type WorkstationDb } from '../../../db/client';
import { habits, habitLogs, type HabitRow, type HabitLogRow } from '../../../db/schema';
import {
  ArchiveHabitInputSchema,
  CreateHabitInputSchema,
  DeleteHabitInputSchema,
  HabitListFilterSchema,
  HabitListSchema,
  HabitLogListSchema,
  HabitLogSchema,
  HabitSchema,
  ListHabitLogsInputSchema,
  LogsInRangeInputSchema,
  ToggleHabitLogInputSchema,
  UpdateHabitInputSchema,
  type CreateHabitInputParsed,
  type DeleteHabitInputParsed,
  type ListHabitLogsInputParsed,
  type LogsInRangeInputParsed,
  type ToggleHabitLogInputParsed,
  type UpdateHabitInputParsed,
  type ArchiveHabitInputParsed,
  type HabitParsed,
  type HabitLogParsed,
} from '../../../shared/schemas/habit';

/** 依赖：只需要 db（无 AI 依赖）。 */
export interface HabitIpcDeps {
  db: WorkstationDb;
}

interface IpcErrorPayload {
  code: 'VALIDATION_FAILED' | 'NOT_FOUND' | 'PERSISTENCE_FAILED' | 'INTERNAL';
  message: string;
  details?: unknown;
}

function toIpcError(err: unknown): IpcErrorPayload {
  if (err instanceof Error) {
    return { code: 'INTERNAL', message: err.message };
  }
  return { code: 'INTERNAL', message: String(err) };
}

function toPersistenceError(err: unknown, fallback: string): IpcErrorPayload {
  if (err instanceof Error) {
    return { code: 'PERSISTENCE_FAILED', message: `${fallback}: ${err.message}` };
  }
  return { code: 'PERSISTENCE_FAILED', message: `${fallback}: ${String(err)}` };
}

function isStructuredIpcError(err: unknown): err is IpcErrorPayload {
  if (err === null || typeof err !== 'object') return false;
  const obj = err as { code?: unknown; message?: unknown };
  if (typeof obj.code !== 'string' || typeof obj.message !== 'string') return false;
  return (
    obj.code === 'VALIDATION_FAILED' ||
    obj.code === 'NOT_FOUND' ||
    obj.code === 'PERSISTENCE_FAILED' ||
    obj.code === 'INTERNAL'
  );
}

/** 把 db row → IPC DTO。 */
function rowToHabit(row: HabitRow): HabitParsed {
  return HabitSchema.parse({
    id: row.id,
    name: row.name,
    icon: row.icon,
    color: row.color,
    weeklyTarget: row.weeklyTarget,
    archived: row.archived,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  });
}

function rowToHabitLog(row: HabitLogRow): HabitLogParsed {
  return HabitLogSchema.parse({
    habitId: row.habitId,
    date: row.date,
    loggedAt: row.loggedAt.getTime(),
    note: row.note,
  });
}

// ============================================================
//  handler 函数
// ============================================================

/** `habit:list` handler。 */
export async function handleHabitList(
  deps: HabitIpcDeps,
  payload: unknown,
): Promise<HabitParsed[]> {
  const parsed = HabitListFilterSchema.safeParse(payload ?? {});
  if (!parsed.success) {
    throw {
      code: 'VALIDATION_FAILED' as const,
      message: 'Invalid habit list input',
      details: parsed.error.flatten(),
    };
  }
  const filter = parsed.data;
  try {
    const conds: SQL[] = [];
    if (filter.archived !== undefined) {
      conds.push(eq(habits.archived, filter.archived));
    }
    const where = conds.length > 0 ? and(...conds) : undefined;
    const rows = where
      ? deps.db.select().from(habits).where(where).orderBy(desc(habits.createdAt)).all()
      : deps.db.select().from(habits).orderBy(desc(habits.createdAt)).all();
    return HabitListSchema.parse(rows.map(rowToHabit));
  } catch (err) {
    if (isStructuredIpcError(err)) throw err;
    throw toPersistenceError(err, 'Failed to list habits');
  }
}

/** `habit:create` handler。 */
export async function handleHabitCreate(
  deps: HabitIpcDeps,
  payload: unknown,
): Promise<HabitParsed> {
  const parsed = CreateHabitInputSchema.safeParse(payload);
  if (!parsed.success) {
    throw {
      code: 'VALIDATION_FAILED' as const,
      message: 'Invalid habit create input',
      details: parsed.error.flatten(),
    };
  }
  const input: CreateHabitInputParsed = parsed.data;
  const id = ulid();
  const now = new Date();
  try {
    deps.db
      .insert(habits)
      .values({
        id,
        name: input.name,
        icon: input.icon ?? '',
        color: input.color ?? null,
        weeklyTarget: input.weeklyTarget ?? 0,
        archived: false,
        sortOrder: 0,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    const row = deps.db.select().from(habits).where(eq(habits.id, id)).get();
    if (!row) {
      throw {
        code: 'INTERNAL' as const,
        message: 'Habit was inserted but cannot be read back',
      };
    }
    return rowToHabit(row);
  } catch (err) {
    if (isStructuredIpcError(err)) throw err;
    throw toPersistenceError(err, 'Failed to create habit');
  }
}

/** `habit:update` handler（patch 语义）。 */
export async function handleHabitUpdate(
  deps: HabitIpcDeps,
  payload: unknown,
): Promise<HabitParsed> {
  const parsed = UpdateHabitInputSchema.safeParse(payload);
  if (!parsed.success) {
    throw {
      code: 'VALIDATION_FAILED' as const,
      message: 'Invalid habit update input',
      details: parsed.error.flatten(),
    };
  }
  const input: UpdateHabitInputParsed = parsed.data;
  const now = new Date();
  try {
    const existing = deps.db.select().from(habits).where(eq(habits.id, input.id)).get();
    if (!existing) {
      throw {
        code: 'NOT_FOUND' as const,
        message: `Habit not found: ${input.id}`,
      };
    }
    // filter undefined 字段（exactOptionalPropertyTypes 严格模式）
    const cleanPatch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input.patch)) {
      if (v !== undefined) cleanPatch[k] = v;
    }
    deps.db
      .update(habits)
      .set({ ...cleanPatch, updatedAt: now })
      .where(eq(habits.id, input.id))
      .run();
    const row = deps.db.select().from(habits).where(eq(habits.id, input.id)).get();
    if (!row) {
      throw {
        code: 'INTERNAL' as const,
        message: 'Habit was updated but cannot be read back',
      };
    }
    return rowToHabit(row);
  } catch (err) {
    if (isStructuredIpcError(err)) throw err;
    throw toPersistenceError(err, 'Failed to update habit');
  }
}

/** `habit:archive` handler。 */
export async function handleHabitArchive(
  deps: HabitIpcDeps,
  payload: unknown,
): Promise<HabitParsed> {
  const parsed = ArchiveHabitInputSchema.safeParse(payload);
  if (!parsed.success) {
    throw {
      code: 'VALIDATION_FAILED' as const,
      message: 'Invalid habit archive input',
      details: parsed.error.flatten(),
    };
  }
  const input: ArchiveHabitInputParsed = parsed.data;
  try {
    const existing = deps.db.select().from(habits).where(eq(habits.id, input.id)).get();
    if (!existing) {
      throw {
        code: 'NOT_FOUND' as const,
        message: `Habit not found: ${input.id}`,
      };
    }
    deps.db
      .update(habits)
      .set({ archived: input.archived, updatedAt: new Date() })
      .where(eq(habits.id, input.id))
      .run();
    const row = deps.db.select().from(habits).where(eq(habits.id, input.id)).get();
    if (!row) {
      throw {
        code: 'INTERNAL' as const,
        message: 'Habit was archived but cannot be read back',
      };
    }
    return rowToHabit(row);
  } catch (err) {
    if (isStructuredIpcError(err)) throw err;
    throw toPersistenceError(err, 'Failed to archive habit');
  }
}

/** `habit:delete` handler（硬删 + 删 logs）。 */
export async function handleHabitDelete(
  deps: HabitIpcDeps,
  payload: unknown,
): Promise<{ deleted: true }> {
  const parsed = DeleteHabitInputSchema.safeParse(payload);
  if (!parsed.success) {
    throw {
      code: 'VALIDATION_FAILED' as const,
      message: 'Invalid habit delete input',
      details: parsed.error.flatten(),
    };
  }
  const input: DeleteHabitInputParsed = parsed.data;
  try {
    const existing = deps.db.select().from(habits).where(eq(habits.id, input.id)).get();
    if (!existing) {
      throw {
        code: 'NOT_FOUND' as const,
        message: `Habit not found: ${input.id}`,
      };
    }
    // 事务：先删 logs 再删 habit
    deps.db.transaction((tx) => {
      tx.delete(habitLogs).where(eq(habitLogs.habitId, input.id)).run();
      tx.delete(habits).where(eq(habits.id, input.id)).run();
    });
    return { deleted: true };
  } catch (err) {
    if (isStructuredIpcError(err)) throw err;
    throw toPersistenceError(err, 'Failed to delete habit');
  }
}

/** `habit:toggleLog` handler：toggle 单天打卡状态。 */
export async function handleHabitToggleLog(
  deps: HabitIpcDeps,
  payload: unknown,
): Promise<{ habitId: string; date: string; completed: boolean }> {
  const parsed = ToggleHabitLogInputSchema.safeParse(payload);
  if (!parsed.success) {
    throw {
      code: 'VALIDATION_FAILED' as const,
      message: 'Invalid habit toggleLog input',
      details: parsed.error.flatten(),
    };
  }
  const input: ToggleHabitLogInputParsed = parsed.data;
  try {
    // 检查 habit 存在
    const habit = deps.db.select().from(habits).where(eq(habits.id, input.habitId)).get();
    if (!habit) {
      throw {
        code: 'NOT_FOUND' as const,
        message: `Habit not found: ${input.habitId}`,
      };
    }
    const existing = deps.db
      .select()
      .from(habitLogs)
      .where(and(eq(habitLogs.habitId, input.habitId), eq(habitLogs.date, input.date)))
      .get();
    if (existing) {
      // 存在 → 删
      deps.db
        .delete(habitLogs)
        .where(and(eq(habitLogs.habitId, input.habitId), eq(habitLogs.date, input.date)))
        .run();
      return { habitId: input.habitId, date: input.date, completed: false };
    }
    // 不存在 → 加
    deps.db
      .insert(habitLogs)
      .values({
        habitId: input.habitId,
        date: input.date,
        loggedAt: new Date(),
        note: '',
      })
      .run();
    return { habitId: input.habitId, date: input.date, completed: true };
  } catch (err) {
    if (isStructuredIpcError(err)) throw err;
    throw toPersistenceError(err, 'Failed to toggle habit log');
  }
}

/** `habit:listLogs` handler。 */
export async function handleHabitListLogs(
  deps: HabitIpcDeps,
  payload: unknown,
): Promise<HabitLogParsed[]> {
  const parsed = ListHabitLogsInputSchema.safeParse(payload);
  if (!parsed.success) {
    throw {
      code: 'VALIDATION_FAILED' as const,
      message: 'Invalid habit listLogs input',
      details: parsed.error.flatten(),
    };
  }
  const input: ListHabitLogsInputParsed = parsed.data;
  try {
    const conds: SQL[] = [eq(habitLogs.habitId, input.habitId)];
    if (input.fromDate) conds.push(gte(habitLogs.date, input.fromDate));
    if (input.toDate) conds.push(lte(habitLogs.date, input.toDate));
    const rows = deps.db
      .select()
      .from(habitLogs)
      .where(and(...conds))
      .orderBy(desc(habitLogs.date))
      .all();
    return HabitLogListSchema.parse(rows.map(rowToHabitLog));
  } catch (err) {
    if (isStructuredIpcError(err)) throw err;
    throw toPersistenceError(err, 'Failed to list habit logs');
  }
}

/** `habit:logsInRange` handler：所有 habit 在某段时间的 logs。 */
export async function handleHabitLogsInRange(
  deps: HabitIpcDeps,
  payload: unknown,
): Promise<HabitLogParsed[]> {
  const parsed = LogsInRangeInputSchema.safeParse(payload);
  if (!parsed.success) {
    throw {
      code: 'VALIDATION_FAILED' as const,
      message: 'Invalid habit logsInRange input',
      details: parsed.error.flatten(),
    };
  }
  const input: LogsInRangeInputParsed = parsed.data;
  try {
    const rows = deps.db
      .select()
      .from(habitLogs)
      .where(between(habitLogs.date, input.fromDate, input.toDate))
      .all();
    return HabitLogListSchema.parse(rows.map(rowToHabitLog));
  } catch (err) {
    if (isStructuredIpcError(err)) throw err;
    throw toPersistenceError(err, 'Failed to query habit logs in range');
  }
}

// ============================================================
//  注册到 ipcMain
// ============================================================

function safeHandle<T>(channel: string, handler: (payload: unknown) => Promise<T>): void {
  ipcMain.handle(channel, async (_evt, payload) => {
    try {
      const data = await handler(payload);
      return { ok: true as const, data };
    } catch (err) {
      if (isStructuredIpcError(err)) {
        return { ok: false as const, error: err };
      }
      return { ok: false as const, error: toIpcError(err) };
    }
  });
}

export function registerHabitIpc(deps: HabitIpcDeps): void {
  safeHandle('habit:list', (p) => handleHabitList(deps, p));
  safeHandle('habit:create', (p) => handleHabitCreate(deps, p));
  safeHandle('habit:update', (p) => handleHabitUpdate(deps, p));
  safeHandle('habit:archive', (p) => handleHabitArchive(deps, p));
  safeHandle('habit:delete', (p) => handleHabitDelete(deps, p));
  safeHandle('habit:toggleLog', (p) => handleHabitToggleLog(deps, p));
  safeHandle('habit:listLogs', (p) => handleHabitListLogs(deps, p));
  safeHandle('habit:logsInRange', (p) => handleHabitLogsInRange(deps, p));
}
