import { create } from 'zustand';

/**
 * Toast 队列 store。
 *
 * 字段：
 *   - toasts  当前展示队列（按入队顺序）
 *
 * 用法：
 *   - toast.success('保存成功')
 *   - toast.error('网络断开')
 *   - toast.info('正在加载…')
 *
 * 自动消失由调用方在 push 时传入 duration（毫秒）；store 不管理 timer，
 * 让 push/remove 的语义简单、测试稳定。
 */

export type ToastKind = 'success' | 'error' | 'info';

export interface ToastItem {
  /** 唯一 id。 */
  id: string;
  /** 文本内容。 */
  message: string;
  /** 类型。 */
  kind: ToastKind;
  /** 持续时间（毫秒），到时由 UI 自动移除。 */
  duration: number;
  /** 插入时间戳（用于排序与去重参考）。 */
  createdAt: number;
}

export interface ToastState {
  toasts: ToastItem[];
  push: (toast: Omit<ToastItem, 'id' | 'createdAt'>) => string;
  remove: (id: string) => void;
  clear: () => void;
}

let counter = 0;
/** 自增 id 生成器；测试中可被 stub。 */
function nextId(): string {
  counter += 1;
  return `toast_${Date.now().toString(36)}_${counter}`;
}

/** 重置计数器（仅供测试使用）。 */
export function __resetToastCounterForTest(): void {
  counter = 0;
}

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  push: (input) => {
    const id = nextId();
    const item: ToastItem = {
      ...input,
      id,
      createdAt: Date.now(),
    };
    set({ toasts: [...get().toasts, item] });
    return id;
  },
  remove: (id) => {
    set({ toasts: get().toasts.filter((t) => t.id !== id) });
  },
  clear: () => {
    set({ toasts: [] });
  },
}));

/** 便捷方法。 */
export const toast = {
  success(message: string, duration = 3000): string {
    return useToastStore.getState().push({ message, kind: 'success', duration });
  },
  error(message: string, duration = 5000): string {
    return useToastStore.getState().push({ message, kind: 'error', duration });
  },
  info(message: string, duration = 3000): string {
    return useToastStore.getState().push({ message, kind: 'info', duration });
  },
};
