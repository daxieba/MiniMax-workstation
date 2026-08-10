import { describe, it, expect, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ThemeToggle } from '@/components/ThemeToggle/ThemeToggle';
import { useThemeStore } from '@/store/themeStore';
import { applyThemeMode, nextModeOf } from '@/lib/nativeTheme';
import { applyResolvedTheme } from '@/lib/theme';

/**
 * ThemeToggle 行为测试。
 *
 * 由于 jsdom 没有 window.api，applyThemeMode 走本地 fallback 分支：
 *   - 直接修改 store.mode
 *   - 通过 matchMedia 解析 system → light / dark
 *   - 把结果应用到 <html> 的 .dark class
 *
 * 用 fireEvent.click 而非 @testing-library/user-event，避免新增 dev 依赖。
 */

function resetStore(): void {
  useThemeStore.setState({ mode: 'system', resolved: 'light' });
  document.documentElement.classList.remove('dark');
  document.documentElement.style.colorScheme = '';
  try {
    localStorage.removeItem('minimax.theme.mode');
  } catch {
    // 忽略
  }
}

describe('ThemeToggle', () => {
  beforeEach(() => {
    resetStore();
  });

  it('renders current mode label', () => {
    useThemeStore.setState({ mode: 'dark' });
    render(<ThemeToggle />);
    expect(screen.getByTestId('theme-toggle')).toHaveTextContent('深色');
  });

  it('cycles light → dark → system → light on click', () => {
    useThemeStore.setState({ mode: 'light' });
    render(<ThemeToggle />);
    const btn = screen.getByTestId('theme-toggle');

    expect(btn).toHaveTextContent('浅色');
    fireEvent.click(btn);
    expect(btn).toHaveTextContent('深色');

    fireEvent.click(btn);
    expect(btn).toHaveTextContent('跟随系统');

    fireEvent.click(btn);
    expect(btn).toHaveTextContent('浅色');
  });

  it('applies dark class on resolved=dark', () => {
    applyResolvedTheme('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    applyResolvedTheme('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('persists mode to localStorage when applyThemeMode is called', async () => {
    await applyThemeMode('dark');
    expect(useThemeStore.getState().mode).toBe('dark');
    expect(localStorage.getItem('minimax.theme.mode')).toBe('dark');
  });

  it('nextModeOf cycles correctly', () => {
    expect(nextModeOf('light')).toBe('dark');
    expect(nextModeOf('dark')).toBe('system');
    expect(nextModeOf('system')).toBe('light');
  });
});
