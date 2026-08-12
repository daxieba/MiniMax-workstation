/**
 * CommandPalette 测试（v0.1.2）
 *
 * 覆盖：
 *   - 打开 / 关闭 modal
 *   - 输入框过滤命令
 *   - 分组（Navigation / Actions）正确显示
 *   - 点击命令触发 run + 自动关闭
 *   - Esc 关闭
 *   - 当前 lang 切换时按钮文案 / 命令 label 更新
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { CommandPalette, buildCommands } from '@/components/CommandPalette/CommandPalette';
import { translations, useI18nStore, type Translations } from '@/i18n';
import { useCmdPaletteStore } from '@/store/cmdPaletteStore';

const mockNavigate = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

function makeCommands(t: Translations, currentLang: 'zh-CN' | 'en-US') {
  return buildCommands({
    navigate: (to: string) => mockNavigate(to),
    closePalette: () => useCmdPaletteStore.getState().closePalette(),
    setLang: (l) => useI18nStore.getState().setLang(l),
    currentLang,
    t,
  });
}

describe('CommandPalette', () => {
  beforeEach(() => {
    useCmdPaletteStore.setState({ open: false, commands: [] });
    useI18nStore.setState({ lang: 'zh-CN', t: translations['zh-CN'] });
    mockNavigate.mockClear();
  });

  afterEach(() => {
    useCmdPaletteStore.setState({ open: false });
  });

  it('关闭时（open=false）不渲染任何东西', () => {
    const { container } = render(
      <MemoryRouter>
        <CommandPalette commands={makeCommands(translations['zh-CN'], 'zh-CN')} />
      </MemoryRouter>,
    );
    expect(container.firstChild).toBeNull();
  });

  it('打开时显示输入框 + 关闭时不显示', () => {
    const cmds = makeCommands(translations['zh-CN'], 'zh-CN');
    render(
      <MemoryRouter>
        <CommandPalette commands={cmds} />
      </MemoryRouter>,
    );
    act(() => {
      useCmdPaletteStore.getState().openPalette();
    });
    expect(screen.getByTestId('cmd-palette-input')).toBeTruthy();
    // 一些命令应该出现
    expect(screen.getByTestId('cmd-palette-item-nav:/inbox')).toBeTruthy();
  });

  it('输入过滤：输入"inbox" 过滤后只显示 inbox 导航', () => {
    const cmds = makeCommands(translations['zh-CN'], 'zh-CN');
    render(
      <MemoryRouter>
        <CommandPalette commands={cmds} />
      </MemoryRouter>,
    );
    act(() => {
      useCmdPaletteStore.getState().openPalette();
    });
    const input = screen.getByTestId('cmd-palette-input');
    fireEvent.change(input, { target: { value: 'inbox' } });
    // inbox 导航（中文 label = "收集箱"）应该出现
    expect(screen.getByTestId('cmd-palette-item-nav:/inbox')).toBeTruthy();
    // projects 导航不应该出现
    expect(screen.queryByTestId('cmd-palette-item-nav:/projects')).toBeNull();
  });

  it('点击命令触发 run + 关闭 modal', () => {
    const cmds = makeCommands(translations['zh-CN'], 'zh-CN');
    render(
      <MemoryRouter>
        <CommandPalette commands={cmds} />
      </MemoryRouter>,
    );
    act(() => {
      useCmdPaletteStore.getState().openPalette();
    });
    fireEvent.click(screen.getByTestId('cmd-palette-item-nav:/projects'));
    expect(mockNavigate).toHaveBeenCalledWith('/projects');
    // 关闭后 modal 消失
    expect(useCmdPaletteStore.getState().open).toBe(false);
  });

  it('按 Esc 关闭 modal', () => {
    const cmds = makeCommands(translations['zh-CN'], 'zh-CN');
    render(
      <MemoryRouter>
        <CommandPalette commands={cmds} />
      </MemoryRouter>,
    );
    act(() => {
      useCmdPaletteStore.getState().openPalette();
    });
    expect(useCmdPaletteStore.getState().open).toBe(true);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(useCmdPaletteStore.getState().open).toBe(false);
  });

  it('切换语言后命令 label 也跟着切换', () => {
    const cmdsZh = makeCommands(translations['zh-CN'], 'zh-CN');
    const { rerender } = render(
      <MemoryRouter>
        <CommandPalette commands={cmdsZh} />
      </MemoryRouter>,
    );
    act(() => {
      useCmdPaletteStore.getState().openPalette();
    });
    // 切换为 en
    act(() => {
      useI18nStore.getState().setLang('en-US');
    });
    const cmdsEn = makeCommands(translations['en-US'], 'en-US');
    rerender(
      <MemoryRouter>
        <CommandPalette commands={cmdsEn} />
      </MemoryRouter>,
    );
    // 收集箱 → Inbox（en）
    const inboxItem = screen.getByTestId('cmd-palette-item-nav:/inbox');
    expect(inboxItem.textContent).toContain('Inbox');
  });

  it('空查询时分组标签显示', () => {
    const cmds = makeCommands(translations['zh-CN'], 'zh-CN');
    render(
      <MemoryRouter>
        <CommandPalette commands={cmds} />
      </MemoryRouter>,
    );
    act(() => {
      useCmdPaletteStore.getState().openPalette();
    });
    expect(screen.getByTestId('cmd-palette-group-导航')).toBeTruthy();
    expect(screen.getByTestId('cmd-palette-group-动作')).toBeTruthy();
  });

  it('无匹配结果显示 noResults 文本', () => {
    const cmds = makeCommands(translations['zh-CN'], 'zh-CN');
    render(
      <MemoryRouter>
        <CommandPalette commands={cmds} />
      </MemoryRouter>,
    );
    act(() => {
      useCmdPaletteStore.getState().openPalette();
    });
    const input = screen.getByTestId('cmd-palette-input');
    fireEvent.change(input, { target: { value: 'xxxxnomatchxxxx' } });
    // 应该出现 noResults 文本
    expect(screen.getByText('没找到匹配的命令')).toBeTruthy();
  });
});
