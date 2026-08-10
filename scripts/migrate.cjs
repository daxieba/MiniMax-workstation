#!/usr/bin/env node
/* eslint-env node */
/**
 * 迁移运行脚本（T1-3）
 *
 * 流程：
 *   1. 解析 db 路径（dev = `./.data/workstation.db`，可被 `WORKSTATION_DB_PATH` 覆盖）
 *   2. 确保 db 父目录存在
 *   3. 调用 drizzle-kit 的 `migrate` 功能（编程式 API），把 `db/migrations` 下所有
 *      待应用迁移跑完
 *
 * 用法：
 *   - `pnpm db:migrate`              （dev 路径）
 *   - `WORKSTATION_DB_PATH=/tmp/x.db pnpm db:migrate`  （覆盖路径）
 *
 * 为什么不用 `drizzle-kit migrate` CLI：
 *   - CLI 不会自动创建 db 父目录，期望目录已存在
 *   - CLI 总是连固定的 dev 路径，无法被 env 覆盖
 *   - 这里用编程式 API，让 dev / CI / 测试用同一份脚本
 */
const { existsSync, mkdirSync } = require('node:fs');
const { dirname, join, resolve: resolvePath } = require('node:path');

(async () => {
  // 1. 决定 db 路径
  const envPath = process.env['WORKSTATION_DB_PATH'];
  const dbPath = envPath && envPath.length > 0
    ? resolvePath(envPath)
    : resolvePath(process.cwd(), '.data', 'workstation.db');

  // 2. 确保父目录存在（drizzle-kit 自己不会 mkdir）
  const parent = dirname(dbPath);
  if (!existsSync(parent)) {
    mkdirSync(parent, { recursive: true });
    console.log(`[migrate] created db directory: ${parent}`);
  }

  // 3. 调 drizzle-kit 编程式 API
  //    用动态 require 是因为 drizzle-kit 没有 ESM 入口（旧版）
  const drizzleKit = require('drizzle-kit');
  const migrationsFolder = join(process.cwd(), 'db', 'migrations');

  console.log(`[migrate] db: ${dbPath}`);
  console.log(`[migrate] migrations: ${migrationsFolder}`);

  // drizzle-kit 0.28 的编程式 API：drizzle-kit/.../api 或直接调 bin 解析
  // 这里用最稳的方式：调内部 helper（drizzle-kit 暴露了 `migrate` 在 bin.cjs 里）
  // 但更稳的写法是直接用 drizzle-orm 的 migrator（在主进程启动期也一样会跑）
  const Database = require('better-sqlite3');
  const { drizzle } = require('drizzle-orm/better-sqlite3');
  const { migrate } = require('drizzle-orm/better-sqlite3/migrator');

  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  const db = drizzle(sqlite);
  try {
    migrate(db, { migrationsFolder });
    console.log('[migrate] ok.');
  } catch (err) {
    console.error(`[migrate] failed: ${err && err.message ? err.message : String(err)}`);
    sqlite.close();
    process.exitCode = 1;
    return;
  }
  sqlite.close();
})();
