import { Monitor, Moon, Sun } from 'lucide-react';
import { useThemeStore } from '@/store/themeStore';
import { applyThemeMode, nextModeOf } from '@/lib/nativeTheme';
import type { ThemeSource } from '@electron-shared/types';

const LABELS: Record<ThemeSource, string> = {
  light: '浅色',
  dark: '深色',
  system: '跟随系统',
};

const ICONS: Record<ThemeSource, typeof Sun> = {
  light: Sun,
  dark: Moon,
  system: Monitor,
};

/**
 * 主题切换控件：循环 light → dark → system → light ...
 *
 * 通过 `applyThemeMode` 触发 store 写入 + 主进程同步 + localStorage 持久化。
 * 为了避免 React 闭包陷阱，icon 和 label 直接从 store.mode 派生。
 */
export function ThemeToggle(): React.ReactElement {
  const mode = useThemeStore((s) => s.mode);
  const Icon = ICONS[mode];

  const handleClick = (): void => {
    const next = nextModeOf(mode);
    void applyThemeMode(next);
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={`主题：${LABELS[mode]}（点击切换）`}
      data-testid="theme-toggle"
      data-mode={mode}
      className="inline-flex items-center gap-2 rounded-md border border-line bg-elevated px-3 py-1.5 text-sm text-primary hover:border-line-strong"
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
      <span>{LABELS[mode]}</span>
    </button>
  );
}
