/**
 * Task 状态机（T2-1 数据模型层）
 *
 * **职责**：定义 `TaskStatus` 枚举 + 合法流转关系 + 纯函数 `canTransition` / `transition`。
 *
 * **设计原则**（PROJECT_IDENTITY.md §3.2 / §8.2）：
 *   - 纯函数：零 I/O、零副作用，可独立单测
 *   - 无 db / 无 IPC 依赖：可被主进程、渲染进程、shared 任何地方 import
 *   - 完整覆盖：每条合法路径 + 每条非法路径都对应一张测试用例
 *
 * **流转图**（identity `from === to` 不算"流转"，视为非法）：
 *
 * ```
 *   todo ⇄ doing → done
 *    ↑   ↘   ↑     ↓
 *    │     ↘   │     ↘ archived
 *    │       ↘ │
 *    └─────────┴── archived → todo
 * ```
 *
 * 具体（来自任务卡 T2-1 规格）：
 *   - `todo`     → `doing` | `archived`
 *   - `doing`    → `todo` | `done` | `archived`
 *   - `done`     → `todo` | `archived`  （从 done 回到 todo 表示重新打开）
 *   - `archived` → `todo`              （从归档恢复）
 *
 * **completedAt 联动**（约定，非强制）：
 *   - 转入 `done` 时，应用层应同时把 `completed_at` 填为当前时间
 *   - 转出 `done` 时（`done` → `todo` 或 `done` → `archived`），应用层应清空 `completed_at`
 *   - 本模块不直接读写 db，联动由 IPC handler 层（T2-3）维护
 */

import { z } from 'zod';

/** 任务状态枚举（与 `TaskStatus` 字符串字面量一一对应）。 */
export const TASK_STATUSES = ['todo', 'doing', 'done', 'archived'] as const;

/** 任务状态类型（从常量数组推导）。 */
export type TaskStatus = (typeof TASK_STATUSES)[number];

/** 任务状态 Zod 校验 schema。 */
export const TaskStatusSchema = z.enum(TASK_STATUSES);

/**
 * 合法状态流转映射表。
 *
 * 键为"当前状态"，值为"允许转入的状态列表"（不含自身 —— 同状态不是"流转"）。
 *
 * 完整覆盖所有 `(from, to)` 合法对：测试用此表反推每条合法对做一次正向断言。
 */
export const ALLOWED_TRANSITIONS: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = {
  todo: ['doing', 'archived'],
  doing: ['todo', 'done', 'archived'],
  done: ['todo', 'archived'],
  archived: ['todo'],
} as const;

/**
 * 非法流转异常。
 *
 * 抛出时携带 `from` / `to` 便于上层（IPC handler / UI）打日志。
 */
export class InvalidTaskTransitionError extends Error {
  public readonly from: TaskStatus;
  public readonly to: TaskStatus;

  public constructor(from: TaskStatus, to: TaskStatus) {
    super(`Invalid task status transition: ${from} -> ${to}`);
    this.name = 'InvalidTaskTransitionError';
    this.from = from;
    this.to = to;
  }
}

/**
 * 判断 `from → to` 是否为合法流转。
 *
 * 规则：
 *   - 同状态（`from === to`）返回 `false`（identity 不算流转）
 *   - `from` / `to` 不在 `TASK_STATUSES` 中时返回 `false`（运行时安全网；
 *     编译期 type 已保证是 `TaskStatus`，但 DB 里 text 列可能塞脏数据）
 *   - 否则查 `ALLOWED_TRANSITIONS[from]` 列表
 *
 * @param from 当前状态
 * @param to   目标状态
 * @returns 是否允许流转
 */
export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  if (from === to) return false;
  if (!isTaskStatus(from) || !isTaskStatus(to)) return false;
  const allowed = ALLOWED_TRANSITIONS[from];
  return allowed.includes(to);
}

/**
 * 执行状态流转。
 *
 * 合法流转返回 `to`；非法流转（含同状态 / 未知状态）抛 `InvalidTaskTransitionError`。
 *
 * 纯函数：不更新 `completedAt` / 不写 db —— 联动由调用方（IPC handler）维护。
 *
 * @throws {InvalidTaskTransitionError} 非法流转时
 */
export function transition(from: TaskStatus, to: TaskStatus): TaskStatus {
  if (!canTransition(from, to)) {
    throw new InvalidTaskTransitionError(from, to);
  }
  return to;
}

/**
 * 内部 helper：运行时校验字符串是否为合法 `TaskStatus`。
 *
 * 给 `canTransition` 做防御用（即使编译期 type guard 已足够，
 * 防御性写法可以捕获来自 DB / IPC 的脏数据）。
 */
function isTaskStatus(value: string): value is TaskStatus {
  return (TASK_STATUSES as readonly string[]).includes(value);
}
