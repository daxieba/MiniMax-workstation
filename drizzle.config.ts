/**
 * drizzle-kit 配置（T1-3 基础设施）
 *
 * 用途：
 *   - `pnpm db:generate` → 比较 schema 变更，生成 SQL 迁移到 `db/migrations/`
 *   - `pnpm db:migrate`   → 把待应用的迁移跑到 dev db
 *   - `pnpm db:studio`    → 起 Drizzle Studio（dev 调试用）
 *
 * dbCredentials.url 用的是 **dev 路径**（./.data/workstation.db）。
 * 这是因为 drizzle-kit 跑在 Node 命令行环境，不在 Electron 主进程里，
 * 拿不到 `app.getPath('userData')`。
 * Prod 路径在 `electron/main/index.ts` 里直接传给 `createDbClient`。
 *
 * 命名：遵循 PROJECT_IDENTITY.md §5.2 — `NNNN_name.sql` 4 位递增。
 */

import { defineConfig } from 'drizzle-kit';

const DEV_DB_PATH = './.data/workstation.db';

export default defineConfig({
  dialect: 'sqlite',
  schema: './db/schema/index.ts',
  out: './db/migrations',
  dbCredentials: {
    url: DEV_DB_PATH,
  },
  verbose: true,
  strict: true,
});
