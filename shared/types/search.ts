/**
 * 全文搜索（Search）共享类型 + Zod schemas（T4-2 知识沉淀第二阶段）
 *
 * **职责**：定义 IPC 边界使用的 Search 相关类型 + 入参 schema。
 *
 * **不写**：db 读写、IPC handler、UI 组件 —— 这些归 T4-2 业务实现。
 *
 * **命名**（PROJECT_IDENTITY.md §3.1）：
 *   - 类型：PascalCase（`SearchScope` / `SearchQuery`）
 *   - Schema：camelCase + `Schema` 后缀
 *   - 常量：UPPER_SNAKE_CASE（`SEARCH_SCOPES`）
 *
 * **跨进程序列化注意**：
 *   - `SearchResult` / `SearchResultMetadata` 在 `shared/schemas/search.ts` 定义
 *     （IPC 响应边界 schema 放 schemas/）
 *   - `SearchQuery` 的字段：query / scope / limit / offset
 *   - `scope` 语义：'all' = UNION 三表；'notes' / 'tasks' / 'inbox' = 单表
 *
 * **scope 语义**：
 *   - `all`    UNION 三张 FTS 表（笔记 + 任务 + 收集箱）按归一化 score 排序
 *   - `notes`  只查 `notes_fts` + 关联到 `notes` 表
 *   - `tasks`  只查 `tasks_fts` + 关联到 `tasks` 表
 *   - `inbox`  只查 `inbox_fts` + 关联到 `inbox_items` 表
 *
 * @see electron/main/ipc/search.ts
 * @see shared/schemas/search.ts
 */

import { z } from 'zod';

// ============================================================
//  scope 枚举
// ============================================================

/** 搜索范围枚举。 */
export const SEARCH_SCOPES = ['all', 'notes', 'tasks', 'inbox'] as const;

/** 搜索范围类型。 */
export type SearchScope = (typeof SEARCH_SCOPES)[number];

/** 搜索范围 Zod 校验 schema。 */
export const SearchScopeSchema = z.enum(SEARCH_SCOPES);

// ============================================================
//  入参 schema
// ============================================================

/**
 * `search:query` IPC 入参 schema。
 *
 * 必填：`query`（1~256 字符；超过会被 Zod 截断）
 * 可选：`scope`（默认 `'all'`）、`limit`（默认 20，1~100）、
 *       `offset`（默认 0，0~1000）
 */
export const SearchQuerySchema = z.object({
  query: z.string().min(1).max(256),
  scope: SearchScopeSchema.optional(),
  limit: z.number().int().min(1).max(100).optional(),
  offset: z.number().int().min(0).max(1000).optional(),
});

/** `SearchQuerySchema` 解析后的 TS 类型。 */
export type SearchQuery = z.infer<typeof SearchQuerySchema>;
