/**
 * 全局命令面板 store（v0.1.2）
 *
 * 极简实现：只存 open 状态 + 注册/执行命令的辅助。
 * 实际命令清单和过滤由 `<CommandPalette>` 组件内 `useMemo` 计算。
 *
 * 设计：
 *   - open/close/toggle 三个 action
 *   - commands 是只读列表，App 启动时一次性注册
 */
import { create } from 'zustand';

export interface CommandItem {
  /** 唯一 id。 */
  id: string;
  /** 标题（已 i18n）。 */
  label: string;
  /** 分组（已 i18n）：Navigation / Actions / Notes / Tasks。 */
  group: string;
  /** 触发时执行（可 navigate / 调 store / 弹 modal）。 */
  run: () => void;
  /** 搜索关键词（i18n label + 别名 + 描述），用于 fuzzy filter。 */
  keywords?: string[];
}

export interface CmdPaletteState {
  open: boolean;
  setOpen: (open: boolean) => void;
  openPalette: () => void;
  closePalette: () => void;
  togglePalette: () => void;
  /** 启动期一次性注册（模块级，不会触发 re-render）。 */
  commands: CommandItem[];
  setCommands: (commands: CommandItem[]) => void;
}

export const useCmdPaletteStore = create<CmdPaletteState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
  openPalette: () => set({ open: true }),
  closePalette: () => set({ open: false }),
  togglePalette: () => set((s) => ({ open: !s.open })),
  commands: [],
  setCommands: (commands) => set({ commands }),
}));
