/**
 * 复盘（Review）共享类型（T5-1 每日复盘）
 *
 * **职责**：定义 IPC 边界使用的 Review / ReviewDraft TS 类型。
 *
 * **不写**：db 读写、IPC handler、UI 组件 —— 这些归 T5-1 业务实现。
 *
 * **命名**（PROJECT_IDENTITY.md §3.1）：
 *   - 类型：PascalCase（`Review`、`ReviewDraft`、`ReviewItem`）
 *   - 字段：camelCase
 *
 * **跨进程序列化注意**：
 *   - `completed` / `uncompleted` / `topThree` / `aiDraft` 在 DB 里是 JSON 字符串
 *     （SQLite 无数组），跨 IPC 时**已**在主进程 handler 里 Drizzle
 *     `mode: 'json'` 解析为对象
 *   - `createdAt` / `updatedAt` 在 IPC 上是 number（Unix 毫秒）
 *   - `aiDraft` 在 IPC 上是 `ReviewDraft | null`
 *
 * **ReviewDraft 与 Review 的关系**：
 *   - `ReviewDraft` 是 AI 生成的草稿（缺 taskId —— AI 不一定知道 task 表 id）
 *   - `Review` 是正式入库的 5 段（completed / uncompleted 都有 taskId）
 *   - 用户"采纳"路径：把 `ReviewDraft` 数据写入 `Review.completed` /
 *     `Review.uncompleted` / `Review.blockers` / `Review.topThree`，**同时**清空
 *     `Review.aiDraft`（避免下次启动再次展示同一份草稿）
 *
 * @see shared/schemas/review.ts
 * @see electron/main/ipc/review.ts
 */

/**
 * AI 草稿（schema = `review_draft`）。
 *
 * 字段：
 *   - `completed`   完成项标题列表（纯字符串 —— AI 不知道 taskId）
 *   - `uncompleted` 未完成项 + 可选原因
 *   - `blockers`    阻塞（自由文本）
 *   - `topThree`    明日三件事（纯字符串）
 */
export interface ReviewDraft {
  completed: string[];
  uncompleted: Array<{ title: string; reason?: string | undefined }>;
  blockers: string;
  topThree: string[];
}

/** Review 单条 item（完成 / 未完成）。 */
export interface ReviewItem {
  /** 关联任务 id（可能指向已删除的任务 —— 业务层容错）。 */
  taskId: string;
  /** 任务标题。 */
  title: string;
  /** 未完成原因（仅 `uncompleted` 用；`completed` 不需要）。 */
  reason?: string | undefined;
}

/**
 * 单条 Review 的 TS 类型（与 db 行对齐，供 IPC 响应使用）。
 *
 * - `date` 是 `YYYY-MM-DD` 字符串
 * - `aiDraft` 可空（null = 未生成 / 已采纳后清空）
 */
export interface Review {
  /** ULID 主键。 */
  id: string;
  /** 复盘日期（`YYYY-MM-DD`）。 */
  date: string;
  /** 完成项。 */
  completed: ReviewItem[];
  /** 未完成项。 */
  uncompleted: ReviewItem[];
  /** 阻塞（自由文本）。 */
  blockers: string;
  /** 明日三件事（纯字符串）。 */
  topThree: string[];
  /** AI 草稿（可空）。 */
  aiDraft: ReviewDraft | null;
  /** 创建时间（Unix 毫秒）。 */
  createdAt: number;
  /** 更新时间（Unix 毫秒）。 */
  updatedAt: number;
}
