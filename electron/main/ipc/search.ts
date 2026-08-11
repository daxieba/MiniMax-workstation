/**
 * 全文搜索（Search）IPC handler（T4-2 知识沉淀第二阶段）
 *
 * 暴露 1 个通道（命名遵循 PROJECT_IDENTITY.md §4.1，格式 `namespace:action`）：
 *   - `search:query` (input: `SearchQuery`) → `SearchResult[]`
 *
 * **核心实现**：
 *   - 三张 FTS5 虚拟表（`notes_fts` / `inbox_fts` / `tasks_fts`，见 0005 迁移）
 *   - 跨表 query 用 `UNION ALL`，每个表用 `bm25()` 函数算相关度
 *   - bm25 跨表不能直接比较（不同表 row count 不同），所以 JS 端做
 *     **按表归一化**：每张表内 min-max 归一化到 [0, 1]，1 = 最相关
 *   - snippet 用 FTS5 `snippet(table, -1, '<mark>', '</mark>', '…', 8)`
 *     （column_idx=-1 = FTS5 自动选最相关列；前后 8 token 上下文）
 *   - 限制 snippet 总长度 ≤ 100 字符（身份卡 §关键约束，隐私）
 *
 * **scope 语义**：
 *   - `all`     → UNION 三张 FTS 表，每表归一化后合并排序
 *   - `notes`   → 只查 `notes_fts`
 *   - `tasks`   → 只查 `tasks_fts`
 *   - `inbox`   → 只查 `inbox_fts`
 *
 * **FTS5 MATCH 语法注意**：
 *   - 用户 query 含特殊字符（`*` / `:` / `(` / `)` 等）会触发 SQLite 语法错
 *   - 捕获后归类到 `VALIDATION_FAILED`（语义上"用户 query 不合法"）
 *   - 不向 SQLite 注入额外语法（如 `*` 通配符），保持用户原文
 *
 * **范围**（T4-2）：
 *   - 仅做 FTS5 搜索（标题 + 内容混合）
 *   - 不做模糊匹配（fuzzy）/ 同义词 / 中文分词增强（PLAN §暂不做复杂向量数据库）
 *   - 不做 AI 摘要 / 导出 —— T4-3 范围
 *
 * **错误码**（PROJECT_IDENTITY.md §4.4）：
 *   - `VALIDATION_FAILED`   Zod 校验失败 / FTS5 语法错
 *   - `PERSISTENCE_FAILED`  db 操作失败（其他 SQLite 错）
 *   - `INTERNAL`            未分类
 *
 * **测试策略**（tests/searchIpc.test.ts）：
 *   - 1 个 handler 函数以 named export 暴露（`handleSearchQuery`）
 *   - 测试直接传 `deps` + `payload` 调用，绕开 ipcMain 事件循环
 *   - `registerSearchIpc(deps)` 只在主进程启动时调一次
 */

import { ipcMain } from 'electron';

import { type WorkstationDb } from '../../../db/client';
import { SearchQuerySchema, type SearchScope } from '../../../shared/types/search';
import { SearchResultSchema, type SearchResult, type SearchResultMetadata } from '../../../shared/schemas/search';

/** 依赖注入：注册时由主进程传入 db 客户端。 */
export interface SearchIpcDeps {
  db: WorkstationDb;
}

/** IPC 错误统一格式（PROJECT_IDENTITY.md §4.2）。 */
export interface IpcErrorPayload {
  code: 'VALIDATION_FAILED' | 'PERSISTENCE_FAILED' | 'INTERNAL';
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
    obj.code === 'PERSISTENCE_FAILED' ||
    obj.code === 'INTERNAL'
  );
}

// ============================================================
//  FTS5 SQL 拼装
// ============================================================

/** snippet 长度上限（身份卡 §关键约束：不要泄露超过 100 字符原文）。 */
const SNIPPET_MAX_CHARS = 100;

/** title 截断上限（用户 UI 上显示用）。 */
const TITLE_MAX_CHARS = 60;

/** FTS5 snippet 函数参数：列数、open 标签、close 标签、省略号、token 数。 */
const SNIPPET_TOKEN_COUNT = 8;

/**
 * 把任意字符串截断到 max 字符数（按 Unicode 码点；不切半个字符）。
 * 超出部分追加 `…`。
 */
function truncateForDisplay(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

/**
 * 把 FTS5 snippet 输出截断到 SNIPPET_MAX_CHARS 字符。
 *
 * 注意 FTS5 snippet 会自动 wrap `<mark>` 标签；我们按字符数截断后，**可能**留下
 * 未闭合的 `<mark>`（如 `<ma…`），需要在 UI 渲染前再过滤（渲染端 `dangerouslySetInnerHTML`
 * 的 XSS 风险也是同一处过滤）。
 *
 * 为安全：截断时如果最后一段是开 `<mark>` 但没 close，则把开标签一并去掉。
 * 实现上保守：截断到 SNIPPET_MAX_CHARS 后 strip 掉尾部所有未匹配的 `<mark>` / `</mark>`。
 */
function trimSnippet(raw: string): string {
  let s = raw;
  if (s.length > SNIPPET_MAX_CHARS) {
    s = s.slice(0, SNIPPET_MAX_CHARS);
  }
  // 平衡 mark 标签：清掉尾部所有未配对的 <mark>（保留已配对的）
  // 简单算法：把字符串按 <mark>/</mark> 拆，记 unbalance 数；最后清掉 unbalance 个开标签
  const opens = (s.match(/<mark>/g) ?? []).length;
  const closes = (s.match(/<\/mark>/g) ?? []).length;
  if (opens > closes) {
    // 截断时丢了 close 标签 → 移除最后 opens - closes 个开标签
    const surplus = opens - closes;
    let removed = 0;
    s = s.replace(/<mark>/g, (m) => {
      if (removed < surplus) {
        removed += 1;
        return '';
      }
      return m;
    });
  }
  return s;
}

/**
 * 跨表 bm25 归一化（按表分组 min-max 归一化到 [0, 1]）。
 *
 * 公式：
 *   - `|bm25|` 越大越相关
 *   - 组内最大 |bm25| → 归一化为 1
 *   - 组内最小 |bm25| → 归一化为 0
 *   - 单条结果（max == min）→ 归一化为 1（视作该表的"唯一命中"，给满分）
 *
 * @param rows 原始行（含 bm25）
 * @returns 新增 `score` 字段（0~1）
 */
function normalizeBm25<T extends { bm25: number }>(rows: T[]): Array<T & { score: number }> {
  if (rows.length === 0) return [];
  let minAbs = Number.POSITIVE_INFINITY;
  let maxAbs = 0;
  for (const r of rows) {
    const a = Math.abs(r.bm25);
    if (a < minAbs) minAbs = a;
    if (a > maxAbs) maxAbs = a;
  }
  if (maxAbs === minAbs) {
    return rows.map((r) => ({ ...r, score: 1 }));
  }
  const span = maxAbs - minAbs;
  return rows.map((r) => {
    const a = Math.abs(r.bm25);
    const norm = (a - minAbs) / span; // 0..1, 1=最相关
    return { ...r, score: norm };
  });
}

/** FTS5 row 原始 shape（每个 UNION ALL 子查询都返回这六个字段）。 */
interface FtsRow {
  kind: 'note' | 'task' | 'inbox';
  id: string;
  title: string | null;
  archived: number | null;
  snippet: string;
  bm25: number;
  task_status: string | null;
  task_priority: string | null;
  inbox_kind: string | null;
  inbox_status: string | null;
}

/** 把 FTS5 row 转成 SearchResult。 */
function rowToResult(row: FtsRow, score: number): SearchResult {
  const title =
    row.title === null || row.title.length === 0
      ? '(无标题)'
      : truncateForDisplay(row.title, TITLE_MAX_CHARS);

  let metadata: SearchResultMetadata;
  if (row.kind === 'note') {
    metadata = { kind: 'note' };
  } else if (row.kind === 'task') {
    metadata = {
      kind: 'task',
      status: (row.task_status ?? 'todo') as 'todo' | 'doing' | 'done' | 'archived',
      priority: (row.task_priority ?? 'medium') as 'low' | 'medium' | 'high',
    };
  } else {
    metadata = {
      kind: 'inbox',
      itemKind: (row.inbox_kind ?? 'note') as 'note' | 'todo' | 'file' | 'link',
      status: (row.inbox_status ?? 'active') as 'active' | 'archived' | 'converted',
    };
  }

  const item: SearchResult = {
    kind: row.kind,
    id: row.id,
    title,
    snippet: trimSnippet(row.snippet),
    score,
    metadata,
  };
  return SearchResultSchema.parse(item);
}

/**
 * 跑单张 FTS5 表的 MATCH query（带 metadata 字段 + bm25）。
 *
 * SQL 用 raw 字符串（不通过 Drizzle query builder，因为 FTS5 是 SQLite 特有
 * 语法，Drizzle 0.36 没有 first-class 支持）。
 *
 * @returns 该表的所有命中行（不含 score，需后续 normalize）
 */
function queryOneTable(
  db: WorkstationDb,
  scope: 'notes' | 'tasks' | 'inbox',
  matchExpr: string,
): FtsRow[] {
  const client = db.$client;
  let sql: string;
  if (scope === 'notes') {
    sql = `
      SELECT 'note' AS kind,
             n.id AS id,
             n.title AS title,
             n.archived AS archived,
             snippet(notes_fts, -1, '<mark>', '</mark>', '…', ?) AS snippet,
             bm25(notes_fts) AS bm25,
             NULL AS task_status,
             NULL AS task_priority,
             NULL AS inbox_kind,
             NULL AS inbox_status
      FROM notes_fts
      JOIN notes n ON n.rowid = notes_fts.rowid
      WHERE notes_fts MATCH ?
    `;
  } else if (scope === 'tasks') {
    sql = `
      SELECT 'task' AS kind,
             t.id AS id,
             t.title AS title,
             NULL AS archived,
             snippet(tasks_fts, -1, '<mark>', '</mark>', '…', ?) AS snippet,
             bm25(tasks_fts) AS bm25,
             t.status AS task_status,
             t.priority AS task_priority,
             NULL AS inbox_kind,
             NULL AS inbox_status
      FROM tasks_fts
      JOIN tasks t ON t.rowid = tasks_fts.rowid
      WHERE tasks_fts MATCH ?
    `;
  } else {
    sql = `
      SELECT 'inbox' AS kind,
             i.id AS id,
             i.content AS title,
             NULL AS archived,
             snippet(inbox_fts, -1, '<mark>', '</mark>', '…', ?) AS snippet,
             bm25(inbox_fts) AS bm25,
             NULL AS task_status,
             NULL AS task_priority,
             i.kind AS inbox_kind,
             i.status AS inbox_status
      FROM inbox_fts
      JOIN inbox_items i ON i.rowid = inbox_fts.rowid
      WHERE inbox_fts MATCH ?
    `;
  }
  const stmt = client.prepare(sql);
  return stmt.all(SNIPPET_TOKEN_COUNT, matchExpr) as FtsRow[];
}

/**
 * 跑 UNION ALL 三张 FTS5 表的 MATCH query（scope='all' 用）。
 *
 * @returns 合并后的所有命中行（不含 score）
 */
function queryAllTables(db: WorkstationDb, matchExpr: string): FtsRow[] {
  const client = db.$client;
  const sql = `
    SELECT 'note' AS kind,
           n.id AS id,
           n.title AS title,
           n.archived AS archived,
           snippet(notes_fts, -1, '<mark>', '</mark>', '…', ?) AS snippet,
           bm25(notes_fts) AS bm25,
           NULL AS task_status,
           NULL AS task_priority,
           NULL AS inbox_kind,
           NULL AS inbox_status
    FROM notes_fts
    JOIN notes n ON n.rowid = notes_fts.rowid
    WHERE notes_fts MATCH ?
    UNION ALL
    SELECT 'task' AS kind,
           t.id AS id,
           t.title AS title,
           NULL AS archived,
           snippet(tasks_fts, -1, '<mark>', '</mark>', '…', ?) AS snippet,
           bm25(tasks_fts) AS bm25,
           t.status AS task_status,
           t.priority AS task_priority,
           NULL AS inbox_kind,
           NULL AS inbox_status
    FROM tasks_fts
    JOIN tasks t ON t.rowid = tasks_fts.rowid
    WHERE tasks_fts MATCH ?
    UNION ALL
    SELECT 'inbox' AS kind,
           i.id AS id,
           i.content AS title,
           NULL AS archived,
           snippet(inbox_fts, -1, '<mark>', '</mark>', '…', ?) AS snippet,
           bm25(inbox_fts) AS bm25,
           NULL AS task_status,
           NULL AS task_priority,
           i.kind AS inbox_kind,
           i.status AS inbox_status
    FROM inbox_fts
    JOIN inbox_items i ON i.rowid = inbox_fts.rowid
    WHERE inbox_fts MATCH ?
  `;
  const stmt = client.prepare(sql);
  return stmt.all(
    SNIPPET_TOKEN_COUNT,
    matchExpr,
    SNIPPET_TOKEN_COUNT,
    matchExpr,
    SNIPPET_TOKEN_COUNT,
    matchExpr,
  ) as FtsRow[];
}

/**
 * 把用户 query 转成 FTS5 MATCH 表达式。
 *
 * 规则：
 *   - 拆分空白为多个 term，每个 term 加双引号包裹（处理空格 / 特殊字符）
 *   - 多个 term 用空格连接（FTS5 默认 AND 语义）
 *   - 全部小写化（FTS5 unicode61 大小写不敏感，但保险起见）
 *   - 跳过空 term
 *
 * 例：`"React 前端"` → `"react" "前端"` → 双 term AND
 *
 * 注意：FTS5 双引号包裹会把内容当 phrase 匹配。如果用户输入 `"react"`，我们
 * 不希望再二次包裹；这里做一次"已含引号的 term 跳过包裹"。
 */
function buildMatchExpr(rawQuery: string): string {
  const terms = rawQuery
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  if (terms.length === 0) return '""';
  return terms
    .map((t) => {
      // 已含双引号 → 当作 phrase 原文
      if (t.startsWith('"') && t.endsWith('"') && t.length >= 2) return t;
      // 否则双引号包裹，term 内部的双引号转义
      const escaped = t.replace(/"/g, '""');
      return `"${escaped}"`;
    })
    .join(' ');
}

// ============================================================
//  handler
// ============================================================

/** `search:query` handler。 */
export async function handleSearchQuery(
  deps: SearchIpcDeps,
  payload: unknown,
): Promise<SearchResult[]> {
  const parsed = SearchQuerySchema.safeParse(payload);
  if (!parsed.success) {
    throw {
      code: 'VALIDATION_FAILED' as const,
      message: 'Invalid search query',
      details: parsed.error.flatten(),
    };
  }
  const { query, scope: rawScope, limit = 20, offset = 0 } = parsed.data;
  const scope: SearchScope = rawScope ?? 'all';

  // 1. 把 user query 转 FTS5 MATCH 表达式
  const matchExpr = buildMatchExpr(query);

  // 2. 跑 SQL（FTS5 语法错 → VALIDATION_FAILED；其他 db 错 → PERSISTENCE_FAILED）
  let rawRows: FtsRow[];
  try {
    if (scope === 'notes') {
      rawRows = queryOneTable(deps.db, 'notes', matchExpr);
    } else if (scope === 'tasks') {
      rawRows = queryOneTable(deps.db, 'tasks', matchExpr);
    } else if (scope === 'inbox') {
      rawRows = queryOneTable(deps.db, 'inbox', matchExpr);
    } else {
      rawRows = queryAllTables(deps.db, matchExpr);
    }
  } catch (err) {
    // FTS5 语法错：SqliteError.message 含 "fts5: syntax error"
    const msg = err instanceof Error ? err.message : String(err);
    if (/fts5:|syntax error|malformed/i.test(msg)) {
      throw {
        code: 'VALIDATION_FAILED' as const,
        message: `Invalid FTS5 query syntax: ${msg}`,
      };
    }
    if (isStructuredIpcError(err)) throw err;
    throw toPersistenceError(err, 'Failed to execute search query');
  }

  if (rawRows.length === 0) {
    return [];
  }

  // 3. 跨表 bm25 归一化（按 scope 不同策略）
  let scored: Array<FtsRow & { score: number }>;
  if (scope === 'all') {
    // 跨表 UNION：按表分组各自归一化
    const byKind = new Map<FtsRow['kind'], FtsRow[]>();
    for (const r of rawRows) {
      const arr = byKind.get(r.kind) ?? [];
      arr.push(r);
      byKind.set(r.kind, arr);
    }
    scored = [];
    for (const [, arr] of byKind) {
      scored = scored.concat(normalizeBm25(arr));
    }
  } else {
    // 单表：直接归一化（即使只有一条）
    scored = normalizeBm25(rawRows);
  }

  // 4. 按 score desc 排序；同分按 id 稳定排序
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.id < b.id ? -1 : 1;
  });

  // 5. 应用 offset / limit
  const sliced = scored.slice(offset, offset + limit);

  // 6. 转 SearchResult
  return sliced.map((r) => rowToResult(r, r.score));
}

// ============================================================
//  registerSearchIpc：把 handler 挂到 ipcMain（主进程启动时调一次）
// ============================================================

/**
 * 注册 1 个 `search:query` IPC handler。
 *
 * 调用方：`electron/main/index.ts` 的 `app.whenReady()` 阶段。
 */
export function registerSearchIpc(deps: SearchIpcDeps): void {
  ipcMain.handle('search:query', async (_evt, payload: unknown) => {
    try {
      return { ok: true as const, data: await handleSearchQuery(deps, payload) };
    } catch (err) {
      if (isStructuredIpcError(err)) return { ok: false as const, error: err };
      return { ok: false as const, error: toIpcError(err) };
    }
  });
}

// Re-export 让测试 / 调用方能引用 schema symbol（仅 for code-completion；不强制）
export { SearchQuerySchema };
