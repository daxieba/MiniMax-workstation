/**
 * LanguageSwitcher 测试（v0.1.2）
 *
 * 覆盖：
 *   - 渲染两个按钮（简体中文 / English）
 *   - 当前 lang 高亮（aria-checked=true）
 *   - 点击另一个按钮切换 lang
 *   - 切换后 store.t 同步
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { LanguageSwitcher } from '@/components/LanguageSwitcher/LanguageSwitcher';
import { translations, useI18nStore } from '@/i18n';

describe('LanguageSwitcher', () => {
  beforeEach(() => {
    localStorage.clear();
    useI18nStore.setState({ lang: 'zh-CN', t: translations['zh-CN'] });
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('渲染两个按钮（zh-CN / en-US）', () => {
    render(<LanguageSwitcher />);
    expect(screen.getByTestId('language-switcher-zh-CN')).toBeTruthy();
    expect(screen.getByTestId('language-switcher-en-US')).toBeTruthy();
  });

  it('zh-CN 是默认时，zh-CN 高亮', () => {
    render(<LanguageSwitcher />);
    const zh = screen.getByTestId('language-switcher-zh-CN');
    const en = screen.getByTestId('language-switcher-en-US');
    expect(zh.getAttribute('aria-checked')).toBe('true');
    expect(en.getAttribute('aria-checked')).toBe('false');
  });

  it('点击 en-US 切换 lang', () => {
    render(<LanguageSwitcher />);
    fireEvent.click(screen.getByTestId('language-switcher-en-US'));
    expect(useI18nStore.getState().lang).toBe('en-US');
    expect(useI18nStore.getState().t).toBe(translations['en-US']);
  });

  it('点击当前激活的按钮不重复切换', () => {
    render(<LanguageSwitcher />);
    const initialT = useI18nStore.getState().t;
    fireEvent.click(screen.getByTestId('language-switcher-zh-CN'));
    expect(useI18nStore.getState().t).toBe(initialT);
  });

  it('切换后 aria-checked 状态更新', () => {
    render(<LanguageSwitcher />);
    fireEvent.click(screen.getByTestId('language-switcher-en-US'));
    const zh = screen.getByTestId('language-switcher-zh-CN');
    const en = screen.getByTestId('language-switcher-en-US');
    expect(zh.getAttribute('aria-checked')).toBe('false');
    expect(en.getAttribute('aria-checked')).toBe('true');
  });
});
