/**
 * `ai_configs` 表 schema（T3-1 基础设施）
 *
 * 用途：按 provider 存储 AI 配置（model + baseURL），**不含 apiKey**。
 *
 * **关键安全约束**（PROJECT_IDENTITY.md §6.1）：
 *   - apiKey **永不入表** —— 走 `CredentialManager`（Windows Credential Manager）
 *   - 渲染进程可读 `aiConfigs` 行（model / baseURL），**永拿不到** key
 *   - 表的 PK 是 `provider`（一个 provider 最多一行配置）
 *
 * **字段规范**（遵循 PROJECT_IDENTITY.md §5.3）：
 *   - 主键：`provider`（text，业务可读字符串）
 *   - 时间戳：`updated_at`（Unix 毫秒，integer）
 *   - **不**加 `created_at`（provider 配置首次创建时间用 `updated_at` 即可，
 *     没有"创建后从不更新"的语义 —— 配置可被改）
 *   - **不**加 `id`（PK 直接是 provider，业务可读性更高）
 *
 * **命名**（PROJECT_IDENTITY.md §3.1）：表名 `ai_configs`（snake_case 复数），
 * 字段名 `provider` / `model` / `baseURL`（camelCase TS） / `base_url` / `updated_at`（snake_case SQL）。
 *
 * @used-by T3-1 AI IPC（`ai:getConfig` / `ai:setConfig`）/ 后续 T3-2 chat handler
 */

import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * `ai_configs` 表的 Drizzle schema。
 *
 * 注意 Drizzle sqlite-core 的 `text(...).primaryKey()` 会创建 `text PRIMARY KEY NOT NULL`。
 * 我们不传 `mode: 'timestamp_ms'` —— 保持简单（业务上 `updated_at` 当成 Unix ms number 用）。
 */
export const aiConfigs = sqliteTable('ai_configs', {
  /** Provider id（PK，字符串字面量，例 `'minimax'` / `'openai-compatible'`）。 */
  provider: text('provider').primaryKey(),

  /** 模型名（必填，例 `'MiniMax-M2'` / `'gpt-4o-mini'`）。 */
  model: text('model').notNull(),

  /**
   * Provider API baseURL（必填，例 `'https://api.minimax.chat/v1'`）。
   *
   * 业务层可改（指向反代 / 自部署 / OpenAI-compatible 任意端点）。
   */
  baseURL: text('base_url').notNull(),

  /** 最近一次更新时间（Unix 毫秒）。每次 setConfig 都刷新。 */
  updatedAt: integer('updated_at').notNull(),
});

/** 单行 `ai_configs` 的 TS 类型（数据库行 = select）。 */
export type AiConfigRow = typeof aiConfigs.$inferSelect;

/** 插入 `ai_configs` 时的 TS 类型（缺省字段由业务层 / 列 default 填充）。 */
export type AiConfigInsert = typeof aiConfigs.$inferInsert;
