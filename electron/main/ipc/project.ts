/**
 * 项目（Project）IPC handler（T2-3 业务 IPC）
 *
 * 暴露 5 个通道（命名遵循 PROJECT_IDENTITY.md §4.1，格式 `namespace:action`）：
 *   - `project:list`     (filter: `{ archived?: boolean }`) → `Project[]`
 *   - `project:create`    (input: `CreateProjectInput`)      → `Project`
 *   - `project:update`    (input: `{ id, patch }`)           → `Project`
 *   - `project:archive`   (input: `{ id }`)                  → `Project`（设 `archived=1`）
 *   - `project:delete`    (input: `{ id }`)                  → `{ deleted: true }`
 *
 * 全部遵循 PROJECT_IDENTITY.md §4 IPC 契约：
 *   - 入口 Zod 校验（共享 schema 在 `shared/schemas/project.ts`）
 *   - try/catch 全包，错误统一转成 `{ code, message, details? }`
 *   - 不返回原始异常对象
 *   - 不在日志中打印 payload 里的敏感字段（本卡 payload 都是项目元数据，非敏感）
 *
 * 错误码（PROJECT_IDENTITY.md §4.4）：
 *   - `VALIDATION_FAILED`  Zod 校验失败
 *   - `NOT_FOUND`          资源不存在（update / archive / delete 找不到 id）
 *   - `PERSISTENCE_FAILED` db 操作失败（含 FK 违反）
 *   - `INTERNAL`           未分类
 *
 * **范围**（T2-3）：
 *   - 仅做 project 自身。
 *   - 不写 task:* / note:* / ai:* / review:* 的 IPC（留给对应业务卡）。
 *   - 不做项目级 cascade（`tasks.project_id` 和 `inbox_items.project_id` 不会
 *     因 project:delete 而被清空；FK 关系是 ON DELETE NO ACTION，删除会被 SQLite 拒）。
 *     UI 层在调用 `project:delete` 前**必须**二次确认（PROJECT_IDENTITY.md §6.4）。
 *
 * **测试策略**（tests/projectIpc.test.ts）：
 *   - 5 个 handler 函数以 named export 暴露（handleProjectList / ...），
 *     测试直接传 `deps` + `payload` 调用，绕开 ipcMain 的事件循环
 *   - `registerProjectIpc(deps)` 只在主进程启动时调一次
 */

import { asc, desc, eq } from 'drizzle-orm';
import { ipcMain } from 'electron';
import { ulid } from 'ulidx';

import { type WorkstationDb } from '../../../db/client';
import { projects, type ProjectRow } from '../../../db/schema';
import {
  CreateProjectInputSchema,
  ProjectArchiveInputSchema,
  ProjectDeleteInputSchema,
  ProjectDeleteResponseSchema,
  ProjectListFilterSchema,
  ProjectSchema,
  UpdateProjectInputSchema,
  type ProjectParsed,
} from '../../../shared/schemas/project';
import { type Project } from '../../../shared/types/project';

/** 依赖注入：注册时由主进程传入 db 客户端。 */
export interface ProjectIpcDeps {
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

/** 判断 err 是否为已结构化的 IPC 错误。 */
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
 * 把 db 行（`ProjectRow`）转成 IPC DTO（`ProjectParsed`）。
 *
 * 转换点：
 *   - `archived`   number (0/1) → boolean
 *   - `createdAt` / `updatedAt` Date → number (Unix ms)
 *   - `description` / `color`   string | null → 保持 null
 */
function rowToProject(row: ProjectRow): ProjectParsed {
  const item: Project = {
    id: row.id,
    name: row.name,
    description: row.description,
    color: row.color,
    archived: row.archived === 1,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  };
  return ProjectSchema.parse(item);
}

// ============================================================
//  handler 函数（独立可测）
// ============================================================

/** `project:list` handler。 */
export async function handleProjectList(
  deps: ProjectIpcDeps,
  payload: unknown,
): Promise<ProjectParsed[]> {
  const parsed = ProjectListFilterSchema.safeParse(payload ?? {});
  if (!parsed.success) {
    throw {
      code: 'VALIDATION_FAILED' as const,
      message: 'Invalid project list filter',
      details: parsed.error.flatten(),
    };
  }
  const filter: { archived?: boolean | undefined } = parsed.data;

  try {
    let rows: ProjectRow[];
    if (filter.archived === undefined) {
      // 默认：未归档在前，归档在后；组内按 createdAt desc
      rows = deps.db
        .select()
        .from(projects)
        .orderBy(asc(projects.archived), desc(projects.createdAt))
        .all();
    } else {
      rows = deps.db
        .select()
        .from(projects)
        .where(eq(projects.archived, filter.archived ? 1 : 0))
        .orderBy(desc(projects.createdAt))
        .all();
    }
    return rows.map((r) => rowToProject(r));
  } catch (err) {
    if (isStructuredIpcError(err)) throw err;
    throw toPersistenceError(err, 'Failed to list projects');
  }
}

/** `project:create` handler。 */
export async function handleProjectCreate(
  deps: ProjectIpcDeps,
  payload: unknown,
): Promise<ProjectParsed> {
  const parsed = CreateProjectInputSchema.safeParse(payload);
  if (!parsed.success) {
    throw {
      code: 'VALIDATION_FAILED' as const,
      message: 'Invalid project create input',
      details: parsed.error.flatten(),
    };
  }
  const input = parsed.data;
  const now = new Date();
  const id = ulid();

  try {
    deps.db
      .insert(projects)
      .values({
        id,
        name: input.name,
        description: input.description ?? null,
        color: input.color ?? null,
        archived: input.archived === true ? 1 : 0,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    const row = deps.db.select().from(projects).where(eq(projects.id, id)).get();
    if (!row) {
      throw {
        code: 'INTERNAL' as const,
        message: 'Project was inserted but cannot be read back',
      };
    }
    return rowToProject(row);
  } catch (err) {
    if (isStructuredIpcError(err)) throw err;
    throw toPersistenceError(err, 'Failed to create project');
  }
}

/** `project:update` handler。 */
export async function handleProjectUpdate(
  deps: ProjectIpcDeps,
  payload: unknown,
): Promise<ProjectParsed> {
  const parsed = UpdateProjectInputSchema.safeParse(payload);
  if (!parsed.success) {
    throw {
      code: 'VALIDATION_FAILED' as const,
      message: 'Invalid project update input',
      details: parsed.error.flatten(),
    };
  }
  const { id, patch } = parsed.data;
  const now = new Date();

  try {
    const existing = deps.db.select().from(projects).where(eq(projects.id, id)).get();
    if (!existing) {
      throw {
        code: 'NOT_FOUND' as const,
        message: `Project not found: ${id}`,
      };
    }

    const updates: Partial<ProjectRow> = { updatedAt: now };
    if (patch.name !== undefined) updates.name = patch.name;
    if (patch.description !== undefined) updates.description = patch.description;
    if (patch.color !== undefined) updates.color = patch.color;
    if (patch.archived !== undefined) updates.archived = patch.archived ? 1 : 0;

    deps.db.update(projects).set(updates).where(eq(projects.id, id)).run();

    const row = deps.db.select().from(projects).where(eq(projects.id, id)).get();
    if (!row) {
      throw {
        code: 'INTERNAL' as const,
        message: 'Project was updated but cannot be read back',
      };
    }
    return rowToProject(row);
  } catch (err) {
    if (isStructuredIpcError(err)) throw err;
    throw toPersistenceError(err, 'Failed to update project');
  }
}

/** `project:archive` handler：等价于 `project:update({ archived: true })`。 */
export async function handleProjectArchive(
  deps: ProjectIpcDeps,
  payload: unknown,
): Promise<ProjectParsed> {
  const parsed = ProjectArchiveInputSchema.safeParse(payload);
  if (!parsed.success) {
    throw {
      code: 'VALIDATION_FAILED' as const,
      message: 'Invalid project archive input',
      details: parsed.error.flatten(),
    };
  }
  const { id } = parsed.data;
  const now = new Date();

  try {
    const existing = deps.db.select().from(projects).where(eq(projects.id, id)).get();
    if (!existing) {
      throw {
        code: 'NOT_FOUND' as const,
        message: `Project not found: ${id}`,
      };
    }

    deps.db
      .update(projects)
      .set({ archived: 1, updatedAt: now })
      .where(eq(projects.id, id))
      .run();

    const row = deps.db.select().from(projects).where(eq(projects.id, id)).get();
    if (!row) {
      throw {
        code: 'INTERNAL' as const,
        message: 'Project was archived but cannot be read back',
      };
    }
    return rowToProject(row);
  } catch (err) {
    if (isStructuredIpcError(err)) throw err;
    throw toPersistenceError(err, 'Failed to archive project');
  }
}

/**
 * `project:delete` handler：硬删一行。
 *
 * **前置约束**（UI 层负责）：
 *   - 删除前必须二次确认（PROJECT_IDENTITY.md §6.4）
 *   - `tasks.project_id` / `inbox_items.project_id` 是 ON DELETE NO ACTION，
 *     若仍有任务 / 收集项挂在本项目下，SQLite 会抛 FK 约束错误 → 转 PERSISTENCE_FAILED
 *     （业务层应先转交 / 转移 / 删任务再删项目）
 */
export async function handleProjectDelete(
  deps: ProjectIpcDeps,
  payload: unknown,
): Promise<{ deleted: true }> {
  const parsed = ProjectDeleteInputSchema.safeParse(payload);
  if (!parsed.success) {
    throw {
      code: 'VALIDATION_FAILED' as const,
      message: 'Invalid project delete input',
      details: parsed.error.flatten(),
    };
  }
  const { id } = parsed.data;

  try {
    const existing = deps.db.select().from(projects).where(eq(projects.id, id)).get();
    if (!existing) {
      throw {
        code: 'NOT_FOUND' as const,
        message: `Project not found: ${id}`,
      };
    }
    deps.db.delete(projects).where(eq(projects.id, id)).run();
    return ProjectDeleteResponseSchema.parse({ deleted: true });
  } catch (err) {
    if (isStructuredIpcError(err)) throw err;
    throw toPersistenceError(err, 'Failed to delete project');
  }
}

// ============================================================
//  registerProjectIpc：把 handler 挂到 ipcMain（主进程启动时调一次）
// ============================================================

/**
 * 注册 5 个 `project:*` IPC handler。
 *
 * 与 `registerAppIpc` / `registerInboxIpc` 同形：每个 handler 的入参/出参都过 Zod，错误统一转 IPC 错误。
 *
 * 调用方：`electron/main/index.ts` 的 `app.whenReady()` 阶段。
 */
export function registerProjectIpc(deps: ProjectIpcDeps): void {
  ipcMain.handle('project:list', async (_evt, payload: unknown) => {
    try {
      return { ok: true as const, data: await handleProjectList(deps, payload) };
    } catch (err) {
      if (isStructuredIpcError(err)) return { ok: false as const, error: err };
      return { ok: false as const, error: toIpcError(err) };
    }
  });

  ipcMain.handle('project:create', async (_evt, payload: unknown) => {
    try {
      return { ok: true as const, data: await handleProjectCreate(deps, payload) };
    } catch (err) {
      if (isStructuredIpcError(err)) return { ok: false as const, error: err };
      return { ok: false as const, error: toIpcError(err) };
    }
  });

  ipcMain.handle('project:update', async (_evt, payload: unknown) => {
    try {
      return { ok: true as const, data: await handleProjectUpdate(deps, payload) };
    } catch (err) {
      if (isStructuredIpcError(err)) return { ok: false as const, error: err };
      return { ok: false as const, error: toIpcError(err) };
    }
  });

  ipcMain.handle('project:archive', async (_evt, payload: unknown) => {
    try {
      return { ok: true as const, data: await handleProjectArchive(deps, payload) };
    } catch (err) {
      if (isStructuredIpcError(err)) return { ok: false as const, error: err };
      return { ok: false as const, error: toIpcError(err) };
    }
  });

  ipcMain.handle('project:delete', async (_evt, payload: unknown) => {
    try {
      return { ok: true as const, data: await handleProjectDelete(deps, payload) };
    } catch (err) {
      if (isStructuredIpcError(err)) return { ok: false as const, error: err };
      return { ok: false as const, error: toIpcError(err) };
    }
  });
}
