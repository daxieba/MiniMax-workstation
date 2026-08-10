/**
 * `app_meta` 表 schema
 *
 * **唯一**本卡（T1-3）建的表。用途：
 *   1. 验证 Drizzle ORM 接入正确
 *   2. 验证迁移机制工作（启动时自动跑迁移）
 *   3. 提供一个 key/value 元数据存储，给后续业务卡（T2-x / T3-x）使用
 *      —— 例如存 `lastOpenedInboxId`、`setupCompletedAt` 等
 *
 * **字段规范**（遵循 PROJECT_IDENTITY.md §5.3）：
 *   - 主键：`key`（text，业务可读字符串，例 `setupCompletedAt`）
 *   - 时间戳：integer（毫秒），由 Drizzle `{ mode: 'timestamp' }` 自动转 Date
 *
 * **不要**在此表里塞业务字段。业务字段由对应业务卡（T2-x 等）在新表里建。
 */

import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/** `app_meta` 表的 Drizzle schema。 */
export const appMeta = sqliteTable('app_meta', {
  /** 元数据键（业务可读，唯一）。如 `setupCompletedAt`、`schemaVersion`。 */
  key: text('key').primaryKey(),

  /** 元数据值（统一存字符串，业务自行序列化 JSON / 数字 / 时间）。 */
  value: text('value').notNull(),

  /** 创建时间（Unix 毫秒）。 */
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),

  /** 更新时间（Unix 毫秒）。 */
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
});

/** 单行 `app_meta` 的 TS 类型。 */
export type AppMetaRow = typeof appMeta.$inferSelect;

/** 插入 `app_meta` 时的 TS 类型。 */
export type AppMetaInsert = typeof appMeta.$inferInsert;
