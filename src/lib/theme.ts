import type { ThemeSource } from '@electron-shared/types';

/**
 * 主题工具：把 mode 应用到 <html> 上的 `.dark` class，并持久化到 localStorage。
 *
 * 设计：
 *   - SSR/CSR 之间通过 localStorage 提前读出 mode，**先于** React 挂载应用 class
 *     （见 main.tsx 的 initTheme()），保证首屏无闪烁
 *   - localStorage 操作全部 try/catch（隐私模式或被禁用可能抛）
 *   - 不直接依赖 zustand store；store 通过本模块驱动 DOM
 */

const STORAGE_KEY = 'minimax.theme.mode';
/** v0.3.0: 主题色板（accent color） */
const ACCENT_STORAGE_KEY = 'minimax.theme.accent';
/** 5 套主题色板 + 兜底 */
export const ACCENT_PALETTES = ['blue', 'indigo', 'green', 'orange', 'pink'] as const;
export type AccentPalette = (typeof ACCENT_PALETTES)[number];
const VALID_PALETTES: ReadonlyArray<string> = ACCENT_PALETTES;

/** 合法 mode 值（防御性，正常情况下只由 store 写入）。 */
const VALID_MODES: ReadonlyArray<ThemeSource> = ['light', 'dark', 'system'];

/** 从 localStorage 读出上次保存的 mode；失败 / 非法返回 null。 */
export function loadStoredMode(): ThemeSource | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    if ((VALID_MODES as ReadonlyArray<string>).includes(raw)) {
      return raw as ThemeSource;
    }
    return null;
  } catch {
    return null;
  }
}

/** 把 mode 写入 localStorage；失败静默。 */
export function saveStoredMode(mode: ThemeSource): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // 隐私模式 / quota 满 / 被禁用 → 静默，不影响功能
  }
}

/** 把 `resolved` 主题应用为 <html> 上的 .dark class。 */
export function applyResolvedTheme(resolved: 'light' | 'dark'): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (resolved === 'dark') {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }
  // 给浏览器一个 hint（影响 form controls / scrollbar）
  root.style.colorScheme = resolved;
}

/** v0.3.0: 读出上次保存的主题色板；失败 / 非法返回 'blue' 兜底。 */
export function loadStoredAccent(): AccentPalette {
  try {
    if (typeof localStorage === 'undefined') return 'blue';
    const raw = localStorage.getItem(ACCENT_STORAGE_KEY);
    if (raw && VALID_PALETTES.includes(raw)) return raw as AccentPalette;
  } catch {
    // ignore
  }
  return 'blue';
}

/** v0.3.0: 把主题色板写入 localStorage + 挂到 <html data-accent="...">。 */
export function applyAccent(palette: AccentPalette): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(ACCENT_STORAGE_KEY, palette);
    }
  } catch {
    // ignore
  }
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-accent', palette);
  }
}

/** 解析当前系统的实际主题（用于 `system` 模式的兜底）。 */
export function resolveSystemTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return 'light';
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/**
 * 首屏同步应用：在 React 挂载前调用，避免首屏闪烁。
 *
 * 流程：
 *   1. 读 localStorage 里的 mode + accent
 *   2. 如果是 light/dark 直接应用；如果是 system 用 matchMedia 解析
 *   3. 给后续的 main 进程 IPC 异步同步打基础
 */
export function initTheme(): { mode: ThemeSource; resolved: 'light' | 'dark'; accent: AccentPalette } {
  const mode = loadStoredMode() ?? 'system';
  const resolved = mode === 'system' ? resolveSystemTheme() : mode;
  const accent = loadStoredAccent();
  applyResolvedTheme(resolved);
  applyAccent(accent);
  return { mode, resolved, accent };
}
