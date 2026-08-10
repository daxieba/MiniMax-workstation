/**
 * 共享类型（主进程 ↔ 渲染进程）
 *
 * 仅放**类型**。运行时校验 schema 在 `shared/schemas/db.ts`。
 *
 * 命名遵循 PROJECT_IDENTITY.md §3.1：PascalCase 类型，camelCase 变量。
 *
 * 跨进程序列化：
 *   - `AppVersion` / `DbStatus` 都会被主进程 JSON 化后通过 IPC 返回渲染端。
 *   - 渲染端 preload 脚本里再 `Zod.parse` 一次。
 */

import { z } from 'zod';

/**
 * 数据库状态（T1-3 唯一暴露给渲染端的状态）。
 *
 * 字段对应 `app:getDbStatus` 的成功响应 data。
 */
export interface DbStatus {
  /** db 是否可用（文件能打开、迁移跑完）。 */
  ready: boolean;
  /** db 文件绝对路径。**敏感**：本卡暂时返回给渲染端方便调试，T1-3 验收后会收紧。 */
  path: string;
  /** 当前 schema 版本号（最大已应用迁移序号，无迁移时为 0）。 */
  schemaVersion: number;
}

/** 应用版本号（来自 `package.json`）。 */
export type AppVersion = string;

/** `appMeta` 单行结构。key/value 均为字符串，由业务自行序列化 JSON。 */
export interface AppMetaEntry {
  key: string;
  value: string;
}

/** 单行 `app_meta` 的数据库行（含时间戳）。 */
export interface AppMetaRow {
  key: string;
  value: string;
  createdAt: number;
  updatedAt: number;
}

/** Zod 工具：复用此 z 对象避免循环依赖。 */
export const zShared = z;
