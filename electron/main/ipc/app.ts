/**
 * 应用级 IPC handler（T1-3 基础设施）
 *
 * 暴露 4 个通道：
 *   - `app:getVersion`     → 返回应用版本号
 *   - `app:getDbStatus`    → 返回 db 状态（ready / path / schemaVersion）
 *   - `app:getAppMeta`     → 读 `app_meta` 单行
 *   - `app:setAppMeta`     → 写 `app_meta` 单行
 *
 * 全部遵循 PROJECT_IDENTITY.md §4 IPC 契约：
 *   - 入口过 Zod（共享 schema 在 `shared/schemas/db.ts`）
 *   - try/catch 全包，错误统一转成 `{ code, message }`
 *   - 不返回原始异常
 *   - 不在日志中打印 payload 里的敏感字段（本卡 payload 都是非敏感的 key 名）
 *
 * 错误码（PROJECT_IDENTITY.md §4.4）：
 *   - `VALIDATION_FAILED`  Zod 校验失败
 *   - `NOT_FOUND`          key 不存在（getAppMeta 用）
 *   - `PERSISTENCE_FAILED` db 操作失败
 *   - `INTERNAL`           未分类
 *
 * 范围：**不写任何业务 IPC handler**。task/inbox/ai/review/kb 等业务的
 * IPC 通道在 T2-x / T3-x / T4-x 业务卡里添加。
 */

import { eq } from 'drizzle-orm';
import { ipcMain, type IpcMainInvokeEvent } from 'electron';

import { appMeta } from '../../../db/schema';
import { type WorkstationDb } from '../../../db/client';
import {
  AppMetaKeySchema,
  AppMetaSetInputSchema,
  AppMetaValueSchema,
  AppVersionSchema,
  DbStatusSchema,
  type AppMetaSetInput,
  type AppMetaValueParsed,
  type DbStatusParsed,
} from '../../../shared/schemas/db';

/** db 状态（启动时算好，由 `electron/main/index.ts` 注入）。 */
export interface AppDbStatus extends DbStatusParsed {
  /** 启动是否成功。 */
  ready: boolean;
}

/** 依赖注入：注册时由主进程传入 db 客户端和启动期状态。 */
export interface AppIpcDeps {
  db: WorkstationDb;
  dbStatus: AppDbStatus;
  /** 应用版本号（来自 package.json，固化在主进程）。 */
  appVersion: string;
}

/** IPC 错误统一格式（PROJECT_IDENTITY.md §4.2）。 */
interface IpcErrorPayload {
  code: 'VALIDATION_FAILED' | 'NOT_FOUND' | 'PERSISTENCE_FAILED' | 'INTERNAL';
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

/** 包装 ipcMain.handle，加 try/catch 兜底。 */
function safeHandle<T>(
  channel: string,
  handler: (evt: IpcMainInvokeEvent, payload: unknown) => Promise<T> | T,
): void {
  ipcMain.handle(channel, async (evt, payload) => {
    try {
      const data = await handler(evt, payload);
      return { ok: true as const, data };
    } catch (err) {
      // 已是结构化错误则原样返回；否则包成 INTERNAL
      if (
        err &&
        typeof err === 'object' &&
        'code' in err &&
        'message' in err &&
        typeof (err as { code: unknown }).code === 'string' &&
        typeof (err as { message: unknown }).message === 'string'
      ) {
        return { ok: false as const, error: err as IpcErrorPayload };
      }
      return { ok: false as const, error: toIpcError(err) };
    }
  });
}

/** 注册 4 个 `app:*` IPC handler。**只调一次**（main 进程启动时）。 */
export function registerAppIpc(deps: AppIpcDeps): void {
  // 1. app:getVersion
  safeHandle('app:getVersion', () => {
    // 启动期已固化到 deps，无需再读 package.json
    return AppVersionSchema.parse(deps.appVersion);
  });

  // 2. app:getDbStatus
  safeHandle('app:getDbStatus', () => {
    return DbStatusSchema.parse({
      ready: deps.dbStatus.ready,
      path: deps.dbStatus.path,
      schemaVersion: deps.dbStatus.schemaVersion,
    });
  });

  // 3. app:getAppMeta
  safeHandle('app:getAppMeta', (evt, payload) => {
    const parsedKey = AppMetaKeySchema.safeParse(payload);
    if (!parsedKey.success) {
      throw {
        code: 'VALIDATION_FAILED' as const,
        message: 'Invalid app_meta key',
        details: parsedKey.error.flatten(),
      };
    }
    const key = parsedKey.data;
    try {
      const row = deps.db.select().from(appMeta).where(eq(appMeta.key, key)).get();
      const data: AppMetaValueParsed = {
        key,
        value: row ? row.value : null,
      };
      // 二次 schema 校验，确保返回结构稳定
      return AppMetaValueSchema.parse(data);
    } catch (err) {
      if (
        err &&
        typeof err === 'object' &&
        'code' in err &&
        (err as { code: string }).code === 'VALIDATION_FAILED'
      ) {
        throw err;
      }
      throw {
        code: 'PERSISTENCE_FAILED' as const,
        message: 'Failed to read app_meta',
        details: toIpcError(err).message,
      };
    }
  });

  // 4. app:setAppMeta
  safeHandle('app:setAppMeta', (evt, payload) => {
    const parsedInput = AppMetaSetInputSchema.safeParse(payload);
    if (!parsedInput.success) {
      throw {
        code: 'VALIDATION_FAILED' as const,
        message: 'Invalid app_meta input',
        details: parsedInput.error.flatten(),
      };
    }
    const input: AppMetaSetInput = parsedInput.data;
    const now = new Date();
    try {
      // SQLite `INSERT ... ON CONFLICT DO UPDATE` 语义（upsert）。
      // Drizzle 的 better-sqlite3 driver 提供 `insert().values().onConflictDoUpdate()`。
      deps.db
        .insert(appMeta)
        .values({
          key: input.key,
          value: input.value,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: appMeta.key,
          set: { value: input.value, updatedAt: now },
        })
        .run();
      return AppMetaValueSchema.parse({ key: input.key, value: input.value });
    } catch (err) {
      throw {
        code: 'PERSISTENCE_FAILED' as const,
        message: 'Failed to write app_meta',
        details: toIpcError(err).message,
      };
    }
  });
}
