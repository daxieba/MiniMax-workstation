/**
 * ThemeSwitcher 行为测试（v0.3.0）
 *
 * 5 套主题色板（blue / indigo / green / orange / pink）：
 *   - 渲染 5 个 radio
 *   - 当前 accent 高亮（aria-checked=true）
 *   - 点不同圆点切换 + 写 store + 写 localStorage + 挂到 <html data-accent>
 *   - row / grid 两种 layout
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { ThemeSwitcher } from '@/components/ThemeSwitcher/ThemeSwitcher';
import { useThemeStore } from '@/store/themeStore';
import { ACCENT_PALETTES } from '@/lib/theme';

function resetStore(): void {
  useThemeStore.setState({ mode: 'system', resolved: 'light', accent: 'blue' });
  try {
    localStorage.removeItem('minimax.theme.accent');
  } catch {
    // ignore
  }
  document.documentElement.removeAttribute('data-accent');
}

describe('ThemeSwitcher (v0.3.0)', () => {
  beforeEach(() => {
    resetStore();
  });

  it('row 模式渲染 5 个 radio（5 套色板）', () => {
    render(<ThemeSwitcher layout="row" testIdPrefix="theme-accent" />);
    for (const p of ACCENT_PALETTES) {
      expect(screen.getByTestId(`theme-accent-${p}`)).toBeInTheDocument();
    }
  });

  it('grid 模式渲染 5 个 radio', () => {
    render(<ThemeSwitcher layout="grid" testIdPrefix="theme-accent" />);
    for (const p of ACCENT_PALETTES) {
      expect(screen.getByTestId(`theme-accent-${p}`)).toBeInTheDocument();
    }
  });

  it('当前 accent 高亮（aria-checked=true）', () => {
    useThemeStore.setState({ accent: 'indigo' });
    render(<ThemeSwitcher testIdPrefix="theme-accent" />);
    expect(screen.getByTestId('theme-accent-indigo').getAttribute('aria-checked')).toBe('true');
    expect(screen.getByTestId('theme-accent-blue').getAttribute('aria-checked')).toBe('false');
  });

  it('点不同色板 → 切换 + 写 store + 写 localStorage + 挂到 <html>', () => {
    render(<ThemeSwitcher testIdPrefix="theme-accent" />);
    const orange = screen.getByTestId('theme-accent-orange');
    fireEvent.click(orange);
    expect(useThemeStore.getState().accent).toBe('orange');
    expect(localStorage.getItem('minimax.theme.accent')).toBe('orange');
    expect(document.documentElement.getAttribute('data-accent')).toBe('orange');
    expect(orange.getAttribute('aria-checked')).toBe('true');
  });

  it('切到 pink 后蓝的 radio 不再高亮', () => {
    useThemeStore.setState({ accent: 'blue' });
    render(<ThemeSwitcher testIdPrefix="theme-accent" />);
    fireEvent.click(screen.getByTestId('theme-accent-pink'));
    expect(screen.getByTestId('theme-accent-blue').getAttribute('aria-checked')).toBe('false');
    expect(screen.getByTestId('theme-accent-pink').getAttribute('aria-checked')).toBe('true');
  });
});
