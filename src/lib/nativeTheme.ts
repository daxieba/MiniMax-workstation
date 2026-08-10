import type { ResolvedTheme, ThemeSource } from '@electron-shared/types';
import { useThemeStore } from '@/store/themeStore';
import { applyResolvedTheme, saveStoredMode } from '@/lib/theme';

/**
 * nativeTheme 桥接：渲染端订阅主进程的 theme 变化，并同步到 store / DOM。
 *
 * 调用顺序：
 *   - 应用启动时执行 `bootstrapTheme()`：拉一次主进程源，同步到 store
 *   - `subscribeNativeTheme()` 在 App 挂载后调用，注册主进程推送
 */

declare global {
  interface Window {
    api?: {
      version: () => string;
      app: {
        getThemeSource: () => Promise<ThemeSource>;
        getResolvedTheme: () => Promise<ResolvedTheme>;
        setThemeSource: (
          source: ThemeSource,
        ) => Promise<
          | { ok: true; data: { source: ThemeSource; resolved: ResolvedTheme } }
          | { ok: false; error: { code: string; message: string } }
        >;
        onThemeChange: (cb: (resolved: ResolvedTheme) => void) => () => void;
      };
    };
  }
}

/** 拿到 window.api.app；测试 / 非 Electron 环境可能为 undefined。 */
function getBridge(): Window['api'] {
  if (typeof window === 'undefined') return undefined;
  return window.api;
}

/**
 * 启动时拉一次主进程源 → 与本地 mode 对齐：
 *   - 如果主进程是 system 而本地存了 light/dark，把本地偏好推到主进程
 *   - 否则用主进程给出的 source 当成最终 mode
 */
export async function bootstrapTheme(): Promise<void> {
  const bridge = getBridge();
  if (!bridge) return; // 测试环境：直接 return

  const store = useThemeStore.getState();
  let mainSource: ThemeSource;
  try {
    mainSource = await bridge.app.getThemeSource();
  } catch {
    mainSource = 'system';
  }

  // 如果 store 里 mode 与主进程不一致，把 store 的推到主进程
  if (store.mode !== mainSource) {
    try {
      const res = await bridge.app.setThemeSource(store.mode);
      if (res.ok) {
        useThemeStore.setState({ resolved: res.data.resolved });
        applyResolvedTheme(res.data.resolved);
      }
    } catch {
      // 静默：保留本地状态
    }
  } else {
    try {
      const resolved = await bridge.app.getResolvedTheme();
      useThemeStore.setState({ resolved });
      applyResolvedTheme(resolved);
    } catch {
      // 静默
    }
  }
}

/** 订阅主进程推送。返回取消订阅函数。 */
export function subscribeNativeTheme(): () => void {
  const bridge = getBridge();
  if (!bridge) return () => undefined;
  return bridge.app.onThemeChange((resolved) => {
    useThemeStore.setState({ resolved });
    applyResolvedTheme(resolved);
  });
}

/**
 * 应用层切换 mode：
 *   1. 写入 store
 *   2. 推给主进程（影响 nativeTheme 行为 + system 模式下触发 resolved 更新）
 *   3. 持久化到 localStorage
 */
export async function applyThemeMode(mode: ThemeSource): Promise<void> {
  const store = useThemeStore.getState();
  store.setMode(mode);
  saveStoredMode(mode);

  const bridge = getBridge();
  if (!bridge) {
    // 测试 / 非 Electron 环境下，直接在本地计算 resolved
    const resolved: ResolvedTheme = mode === 'system' ? resolveLocalSystem() : mode;
    useThemeStore.setState({ resolved });
    applyResolvedTheme(resolved);
    return;
  }

  try {
    const res = await bridge.app.setThemeSource(mode);
    if (res.ok) {
      useThemeStore.setState({ resolved: res.data.resolved });
      applyResolvedTheme(res.data.resolved);
    }
  } catch {
    // 静默：保留用户选择
  }
}

/** 本地解析系统主题（matchMedia）。 */
function resolveLocalSystem(): ResolvedTheme {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return 'light';
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** 循环切换：light → dark → system → light。 */
export const NEXT_MODE_ORDER: ReadonlyArray<ThemeSource> = ['light', 'dark', 'system'];

/** 给定当前 mode，返回下一个 mode。 */
export function nextModeOf(current: ThemeSource): ThemeSource {
  const idx = NEXT_MODE_ORDER.indexOf(current);
  const safeIdx = idx === -1 ? 0 : idx;
  const next = NEXT_MODE_ORDER[(safeIdx + 1) % NEXT_MODE_ORDER.length];
  return next ?? 'system';
}
