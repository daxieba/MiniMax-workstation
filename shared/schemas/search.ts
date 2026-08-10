/**
 * 全文搜索（Search）IPC 共享 Zod schemas（T4-2）
 *
 * 与 `shared/types/search.ts` 互补 —— 这里放 IPC 响应边界的 Zod schema。
 *
 * **职责**：
 *   - 主进程出口 schema 校验（`SearchResultsSchema.parse(rows)`）
 *   - 预加载脚本解析响应数据（`safeParse`）
 *   - 渲染进程 store 收到响应后再次校验（保持端到端契约稳定）
 *
 * **不做**：
 *   - 业务规则（搜索 score 归一化、snippet 截断）—— 留给主进程 handler
 *   - db 读写 —— 留给主进程
 *
 * **score 归一化说明**：
 *   - FTS5 `bm25()` 返回的是**负数**（数值越小越相关）
 *   - 主进程 handler 把每张表的 bm25 绝对值取 min-max 归一化到 [0, 1]，
 *     并在跨表 UNION 时把分数翻转（1 - normalized）让 1 = 最相关
 *   - 渲染端直接拿 `score` 排序，无需再处理
 *
 * **snippet 高亮**：
 *   - FTS5 `snippet(table, column_idx, open, close, ellipsis, num)` 包裹 `<mark>` 标签
 *   - 主进程限制 snippet 总长度 ≤ 100 字符（防隐私泄露；身份卡 §关键约束）
 *
 * **metadata 多态**：
 *   - `SearchResultMetadata` 用 `z.discriminatedUnion('kind', ...)` 区分 note / task / inbox
 *   - 渲染端用 `result.metadata.kind` 路由 UI
 *
 * @see shared/types/search.ts
 * @see electron/main/ipc/search.ts
 */

import { z } from 'zod';

// ============================================================
//  metadata 多态 schema
// ============================================================

/**
 * `SearchResult.metadata` 的多态 schema。
 *
 * 用 `z.discriminatedUnion('kind', ...)` 区分：
 *   - `note`  → `{ kind: 'note' }` （标题/标签已在外层，metadata 仅占位）
 *   - `task`  → `{ kind: 'task', status, priority }`
 *   - `inbox` → `{ kind: 'inbox', itemKind, status }`
 */
export const SearchResultMetadataSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('note') }),
  z.object({
    kind: z.literal('task'),
    status: z.enum(['todo', 'doing', 'done', 'archived']),
    priority: z.enum(['low', 'medium', 'high']),
  }),
  z.object({
    kind: z.literal('inbox'),
    itemKind: z.enum(['note', 'todo', 'file', 'link']),
    status: z.enum(['active', 'archived', 'converted']),
  }),
]);

// ============================================================
//  单条结果 schema
// ============================================================

/** 单条搜索结果 schema。 */
export const SearchResultSchema = z.object({
  /** 结果来源：`'note' | 'task' | 'inbox'`。 */
  kind: z.enum(['note', 'task', 'inbox']),
  /** 资源 id（对应 `notes.id` / `tasks.id` / `inbox_items.id`）。 */
  id: z.string().min(1).max(64),
  /** 资源标题 / 内容摘要（用于显示）。 */
  title: z.string().max(512),
  /** 包含高亮的 snippet（FTS5 `snippet()` 输出，带 `<mark>` 标签）。 */
  snippet: z.string().max(200),
  /** 归一化相关度（0~1，1 = 最相关）。 */
  score: z.number().min(0).max(1),
  /** 额外 metadata（按 kind 不同）。 */
  metadata: SearchResultMetadataSchema,
});

// ============================================================
//  列表 schema
// ============================================================

/** `SearchResult[]` schema（list 接口响应）。 */
export const SearchResultsSchema = z.array(SearchResultSchema);

// ============================================================
//  类型导出
// ============================================================

/** `SearchResultSchema` 解析后的 TS 类型。 */
export type SearchResult = z.infer<typeof SearchResultSchema>;
/** `SearchResultMetadataSchema` 解析后的 TS 类型。 */
export type SearchResultMetadata = z.infer<typeof SearchResultMetadataSchema>;
