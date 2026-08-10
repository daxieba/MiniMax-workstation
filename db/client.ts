/**
 * Drizzle ORM 客户端（better-sqlite3 驱动）
 *
 * **唯一**的 db 入口。所有主进程代码只能从这里 import `db`。
 * **严禁**在渲染进程、preload 脚本、shared 目录里引用此文件。
 *
 * 路径策略（PROJECT_IDENTITY.md §5.1）：
 *   - dev 模式（`pnpm dev`）：`./.data/workstation.db`（相对项目根）
 *   - prod 模式（`pnpm start` / 打包后）：`app.getPath('userData') + '/workstation.db'`
 *   - 测试场景：可显式传 `WORKSTATION_DB_PATH` 覆盖
 *
 * 数据库能力（PROJECT_IDENTITY.md §5.x）：
 *   - WAL 模式（提高并发读写性能）
 *   - `foreign_keys = ON`（开启外键约束）
 *   - `synchronous = NORMAL`（WAL 下推荐）
 *   - 启动时自动跑迁移（drizzle-orm/better-sqlite3/migrator）
 *
 * 生命周期：
 *   - `createDbClient(dbPath, migrationsFolder)` 在 main 进程 `app.whenReady()` 阶段调用一次
 *   - 失败时抛 `DbInitError`（带 `code: 'PERSISTENCE_FAILED'`）
 *   - 应用退出时必须调用 `closeDb(db)` 释放 native handle
 *
 * 双 runtime binary 加载：
 *   - setup.cjs 同时下载 node-v137 binary（默认 `bindings` 找到）和
 *     electron-v130 binary（另存在 `better_sqlite3.node.electron`）
 *   - 在 Electron 里运行时（`process.versions.electron !== undefined`），
 *     必须通过 `nativeBinding` 显式指向 electron binary，
 *     否则 `bindings` 会用 node-v137 binary，Electron 加载 ABI 不匹配会崩
 */

import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve as resolvePath } from 'node:path';

import Database from 'better-sqlite3';
import type { Database as BetterSqliteDatabase, Options as DatabaseOptions } from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

import * as schema from './schema';

/** Drizzle 客户端类型（带 schema 类型）。 */
export type WorkstationDb = BetterSQLite3Database<typeof schema> & {
  $client: BetterSqliteDatabase;
};

/** db 初始化失败的统一错误类型。 */
export class DbInitError extends Error {
  public readonly code: 'PERSISTENCE_FAILED' | 'INTERNAL';

  public constructor(code: 'PERSISTENCE_FAILED' | 'INTERNAL', message: string) {
    super(message);
    this.name = 'DbInitError';
    this.code = code;
  }
}

/** 解析后的 db 绝对路径（用于 `app:getDbStatus` 返回）。 */
export interface ResolvedDbInfo {
  /** db 文件绝对路径。 */
  path: string;
  /** 迁移是否成功。 */
  migrated: boolean;
  /** 当前最大迁移版本号（无迁移时为 0）。 */
  schemaVersion: number;
}

/**
 * 检测当前是否在 Electron 主进程里运行。
 *
 * 渲染进程永远碰不到此模块（preload 不会暴露 db），主进程启动后此值必为非空。
 * 普通 Node 脚本（vitest / drizzle-kit）下为 `undefined`。
 */
function isElectronMain(): boolean {
  return typeof process !== 'undefined' && typeof process.versions.electron === 'string';
}

/**
 * 计算 better-sqlite3 native binary 路径。
 *
 * - Electron 主进程：用 `nativeBinding` 指向 `better_sqlite3.node.electron`
 *   （setup.cjs 在 `pnpm run setup` 阶段下载并存放到同一目录）
 * - 普通 Node（vitest / 迁移脚本）：不传 `nativeBinding`，让 `bindings` 自动
 *   找到 `build/Release/better_sqlite3.node`（即 node-v137 binary）
 *
 * 之所以这样：better-sqlite3 v12 的 `bindings` 加载器只会找单一文件名
 * （`better_sqlite3.node`），无法同时放两份 binary。所以 setup 把 node 版
 * 放在默认位置，electron 版另存为 `better_sqlite3.node.electron`，由
 * nativeBinding 显式选择。
 */
function resolveNativeBinding(appPath: string): string | undefined {
  if (!isElectronMain()) return undefined;

  // 在 dev（electron-vite dev）和 prod（electron-vite build）两种情况下，
  // better-sqlite3 都装在 `<appPath>/node_modules/better-sqlite3/`。
  // 兼容两种 electron-vite 的构建产物结构（main bundle 在 out/main/ 下）。
  // 注意：better-sqlite3 12.x 的 `database.js:52` 对 nativeBinding 路径强制
  // 走 `replace(/(\.node)?$/, '.node')` —— 路径必须以 `.node` 结尾才能被
  // 正确 require。所以 electron binary 命名为 `better_sqlite3.electron.node`。
  // （不要用 `better_sqlite3.node.electron` —— 会被强制加 .node 后缀变成
  // `better_sqlite3.node.electron.node`，找不到。）
  const electronBin = join(
    appPath,
    'node_modules',
    'better-sqlite3',
    'build',
    'Release',
    'better_sqlite3.electron.node',
  );
  return existsSync(electronBin) ? electronBin : undefined;
}

/**
 * 创建 db 客户端。**在 `app.whenReady()` 期间只调用一次**。
 *
 * 行为：
 *   1. 确保 db 文件所在目录存在
 *   2. 打开 better-sqlite3 连接，启用 WAL + foreign_keys
 *   3. 用 drizzle-orm migrator 跑 `migrationsFolder` 下所有待应用迁移
 *   4. 用 Drizzle 包装底层连接，返回带 schema 类型的 `db` 实例
 *
 * 失败时抛 `DbInitError`：
 *   - `PERSISTENCE_FAILED` → 文件 IO / SQL 错误
 *   - `INTERNAL` → 其他未分类错误
 *
 * 启动期失败会阻断主进程继续启动，由 `electron/main/index.ts` 弹错误框并退出。
 *
 * @param dbPath 绝对 db 文件路径（由 `resolveDbPath` 计算）
 * @param appPath 应用根目录（dev = project root；prod = `app.getAppPath()`）
 *                用于定位 better-sqlite3 的 native binary 和 migrations 目录
 */
export function createDbClient(
  dbPath: string,
  appPath: string,
): {
  db: WorkstationDb;
  info: ResolvedDbInfo;
} {
  const absolutePath = resolvePath(dbPath);

  // 1. 确保目录存在
  const dir = dirname(absolutePath);
  if (!existsSync(dir)) {
    try {
      mkdirSync(dir, { recursive: true });
    } catch (err) {
      throw new DbInitError(
        'PERSISTENCE_FAILED',
        `Failed to create db directory ${dir}: ${(err as Error).message}`,
      );
    }
  }

  // 2. 打开 better-sqlite3 连接
  const nativeBinding = resolveNativeBinding(appPath);
  const sqliteOptions: DatabaseOptions = {
    // dev/prod 都开 WAL；better-sqlite3 在 WAL 模式下不需要 readonly 之外的可选项
    fileMustExist: false,
  };
  if (nativeBinding !== undefined) {
    sqliteOptions.nativeBinding = nativeBinding;
  }

  let sqlite: BetterSqliteDatabase;
  try {
    sqlite = new Database(absolutePath, sqliteOptions);
    sqlite.pragma('journal_mode = WAL');
    sqlite.pragma('foreign_keys = ON');
    sqlite.pragma('synchronous = NORMAL');
  } catch (err) {
    throw new DbInitError(
      'PERSISTENCE_FAILED',
      `Failed to open db at ${absolutePath}: ${(err as Error).message}`,
    );
  }

  // 3. 包成 Drizzle
  const db = drizzle(sqlite, { schema }) as WorkstationDb;

  // 4. 跑迁移（migrations 目录跟 db/client.ts 同级 db/migrations/）
  const migrationsFolder = join(appPath, 'db', 'migrations');
  try {
    migrate(db, { migrationsFolder });
  } catch (err) {
    // 关闭连接避免资源泄漏
    try {
      sqlite.close();
    } catch {
      // ignore
    }
    throw new DbInitError(
      'PERSISTENCE_FAILED',
      `Failed to run db migrations from ${migrationsFolder}: ${(err as Error).message}`,
    );
  }

  // 5. 读 schema 版本：drizzle 的 migrator 用 `__drizzle_migrations` 表记录
  const schemaVersion = readSchemaVersion(sqlite);

  return {
    db,
    info: {
      path: absolutePath,
      migrated: true,
      schemaVersion,
    },
  };
}

/**
 * 从 drizzle 迁移日志表读已应用迁移条数。
 *
 * 注意：drizzle-orm 内部用 `__drizzle_migrations` 表（id 列在 SQLite 下
 * 因为 schema 用 `SERIAL PRIMARY KEY` 而非 `INTEGER PRIMARY KEY AUTOINCREMENT`，
 * 实际为 nullable）。`MAX(id)` 在 SQLite 上可能返回 null（实测）。
 * 所以用 `COUNT(*)` 数行数作为 schema 版本号，最稳。
 *
 * 表不存在说明从未跑过迁移 → 返回 0。
 */
function readSchemaVersion(sqlite: BetterSqliteDatabase): number {
  try {
    const row = sqlite
      .prepare('SELECT COUNT(*) AS cnt FROM __drizzle_migrations')
      .get() as { cnt: number } | undefined;
    return row?.cnt ?? 0;
  } catch {
    return 0;
  }
}

/**
 * 关闭 db 连接。**在 `app.on('before-quit')` 或 `window-all-closed` 阶段调用**。
 *
 * 失败仅 warn，不抛（应用已经在退出流程里）。
 */
export function closeDb(db: WorkstationDb): void {
  try {
    db.$client.close();
  } catch (err) {
    // 主进程退出阶段不抛错，只打 warn
    console.warn(`[db] failed to close db: ${(err as Error).message}`);
  }
}

/**
 * 决定 db 文件路径的纯函数（无副作用，便于单测）。
 *
 * 优先级：
 *   1. `WORKSTATION_DB_PATH` 环境变量（测试 / CI 覆盖用）
 *   2. dev 模式（`isDev === true`）：`<appPath>/.data/workstation.db`
 *   3. prod 模式：`<userDataDir>/workstation.db`
 */
export function resolveDbPath(opts: {
  env: NodeJS.ProcessEnv;
  isDev: boolean;
  appPath: string;
  userDataDir: string;
}): string {
  if (typeof opts.env.WORKSTATION_DB_PATH === 'string' && opts.env.WORKSTATION_DB_PATH.length > 0) {
    return resolvePath(opts.env.WORKSTATION_DB_PATH);
  }
  if (opts.isDev) {
    return join(opts.appPath, '.data', 'workstation.db');
  }
  return join(opts.userDataDir, 'workstation.db');
}
