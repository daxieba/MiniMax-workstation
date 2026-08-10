import { create } from 'zustand';

/**
 * 全局应用 store（占位）。
 *
 * 设计原则（PROJECT_IDENTITY.md §3.2）：
 *   - 状态管理用 Zustand，避免 Redux 样板
 *   - 所有 slice 通过组合方式挂载
 *
 * 当前（T1-1）仅放一个空壳 store。后续业务卡按模块拆 slice 写入此处：
 *   - inbox  → 收集箱状态
 *   - tasks  → 项目与任务状态
 *   - ai     → AI 工作区状态
 *   - kb     → 知识库状态
 *   - review → 复盘状态
 *   - app    → 全局 UI 状态
 */
export const useAppStore = create<Record<string, never>>(() => ({}));
