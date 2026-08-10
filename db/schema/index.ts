/**
 * Drizzle schema 入口（PROJECT_IDENTITY.md §2.3 `db/schema/`）
 *
 * 导出当前已落地的所有业务表。`db/client.ts` 用 `import * as schema from './schema'`
 * 拿到完整 schema 树以构造带类型的 Drizzle 客户端。
 *
 * **表清单**：
 *   - `appMeta`   （T1-3）key/value 元数据
 *   - `projects`  （T2-1）项目分组
 *   - `inboxItems`（T2-1）收集箱条目
 *   - `tasks`     （T2-1）任务（核心实体）
 *   - `aiConfigs` （T3-1）AI provider 配置（不含 apiKey）
 *   - `notes`     （T4-1）知识库笔记（Markdown / 标签 / 关联任务）
 *   - `notesFts` / `inboxFts` / `tasksFts` （T4-2）FTS5 全文搜索虚拟表的引用
 *   - `reviews`   （T5-1）每日复盘（5 段模板：完成 / 未完成 / 阻塞 / 明日 3 件事 / AI 草稿）
 *
 * 后续业务卡（T4-3 / T5-x）会在这里加新的表 schema。
 *
 * 用法：
 *   ```ts
 *   import { appMeta, tasks, projects, inboxItems, aiConfigs, notesFts } from '../../db/schema';
 *   import { db } from '../client';
 *   const rows = db.select().from(tasks).all();
 *   ```
 */

import { sql } from 'drizzle-orm';

export { appMeta, type AppMetaRow, type AppMetaInsert } from './appMeta';
export { projects, type ProjectRow, type ProjectInsert } from './project';
export { inboxItems, type InboxItemRow, type InboxItemInsert } from './inbox';
export { tasks, type TaskRow, type TaskInsert } from './task';
export { aiConfigs, type AiConfigRow, type AiConfigInsert } from './aiConfig';
export { notes, type NoteRow, type NoteInsert } from './note';
export {
  reviews,
  type ReviewRow,
  type ReviewInsert,
  type ReviewDraftRow,
  type ReviewItemRow,
} from './review';

/**
 * FTS5 全文搜索虚拟表引用（T4-2）。
 *
 * FTS5 虚拟表是 SQLite 特有的，Drizzle ORM 没有 first-class 支持。
 * 这里用 `sql.raw()` 标签把虚拟表名作为 raw SQL 标识符导出 —— 供主进程
 * FTS5 query 拼装 reference 使用（如 `db.$client.prepare("SELECT ... FROM " + notesFts.queryChunks[0].value + " ...")`）。
 *
 * **实际 DDL 在 `db/migrations/0005_init_fts5.sql` 里手写**（CREATE VIRTUAL TABLE
 * + 6 个同步触发器），这里不参与 Drizzle 的 schema 推断。
 *
 * 主进程搜索 query 走 `db.$client.prepare("...").all(...)`（FTS5 MATCH 必须用
 * raw prepared statement），这三个 export 仅作为命名常量供模块间共享表名。
 */

/** `notes_fts` 全文搜索虚拟表引用（索引 `notes.title` / `notes.content` / `notes.tags`）。 */
export const notesFts = sql.raw('notes_fts');
/** `inbox_fts` 全文搜索虚拟表引用（索引 `inbox_items.content`）。 */
export const inboxFts = sql.raw('inbox_fts');
/** `tasks_fts` 全文搜索虚拟表引用（索引 `tasks.title` / `tasks.description`）。 */
export const tasksFts = sql.raw('tasks_fts');
