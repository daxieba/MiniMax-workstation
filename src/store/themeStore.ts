import { create } from 'zustand';
import type { ResolvedTheme, ThemeSource } from '@electron-shared/types';
import type { AccentPalette } from '@/lib/theme';

/**
 * 主题 store：渲染端唯一的主题状态源。
 *
 * 字段：
 *   - mode      用户意图（light / dark / system）
 *   - resolved  实际生效主题（light / dark），system 模式下由主进程 / matchMedia 给出
 *   - accent    v0.3.0: 主题色板（blue / indigo / green / orange / pink）
 *
 * 写策略：
 *   - setMode 同时改 mode；resolved 由 bootstrapTheme / applyThemeMode / subscribeNativeTheme 维护
 *   - 不直接对外暴露 setResolved（仅主进程推送 + 初始化时使用）
 *   - setAccent 直接改 accent + 调 lib/theme.applyAccent 同步 DOM
 */

export interface ThemeState {
  /** 用户选择的主题模式。 */
  mode: ThemeSource;
  /** 实际生效主题（system 模式 → 由主进程 / matchMedia 解析）。 */
  resolved: ResolvedTheme;
  /** v0.3.0: 主题色板（蓝/紫/绿/橘/粉） */
  accent: AccentPalette;
  /** 写入用户意图；resolved 由 side effect 维护。 */
  setMode: (mode: ThemeSource) => void;
  /** 写入 resolved（仅用于初始化 / 主进程推送）。 */
  setResolved: (resolved: ResolvedTheme) => void;
  /** v0.3.0: 写入主题色板。 */
  setAccent: (accent: AccentPalette) => void;
}

export const useThemeStore = create<ThemeState>((set) => ({
  mode: 'system',
  resolved: 'light',
  accent: 'blue',
  setMode: (mode) => {
    set({ mode });
  },
  setResolved: (resolved) => {
    set({ resolved });
  },
  setAccent: (accent) => {
    set({ accent });
  },
}));
