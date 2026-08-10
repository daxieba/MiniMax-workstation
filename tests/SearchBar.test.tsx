/**
 * SearchBar 组件测试（T4-2）
 *
 * 覆盖：
 *   - 渲染：输入框、4 个 scope 按钮、搜索按钮、清除按钮
 *   - 受控：query / scope / loading 来自 store
 *   - 交互：
 *     - 输入 query → store.setQuery
 *     - Enter → store.search
 *     - Escape → store.clear
 *     - scope 按钮 → store.setScope + 立即 store.search
 *     - 搜索按钮 → store.search
 *     - 清除按钮 → store.clear
 *   - 边界：
 *     - 空 query 时搜索按钮 disabled
 *     - loading 时搜索按钮显示 "搜索中…"
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

import { SearchBar } from '@/components/SearchBar/SearchBar';
import { useSearchStore } from '@/store/searchStore';
import { useToastStore } from '@/store/toastStore';

beforeEach(() => {
  useToastStore.setState({ toasts: [] });
  useSearchStore.setState({
    query: '',
    scope: 'all',
    results: [],
    loading: false,
    error: null,
  });
});

afterEach(() => {
  // 不卸载 mock api，因为我们没装 mock —— store 的 getSearchApi() 在没有 window.api 时
  // 直接返回 null，setQuery / setScope / clear 这些纯 state 操作的 action 仍然工作
});

describe('SearchBar rendering', () => {
  it('renders input + 4 scope buttons + submit + clear', () => {
    render(<SearchBar testIdPrefix="search-bar" />);
    expect(screen.getByTestId('search-bar-input')).toBeInTheDocument();
    expect(screen.getByTestId('search-bar-scope-all')).toBeInTheDocument();
    expect(screen.getByTestId('search-bar-scope-notes')).toBeInTheDocument();
    expect(screen.getByTestId('search-bar-scope-tasks')).toBeInTheDocument();
    expect(screen.getByTestId('search-bar-scope-inbox')).toBeInTheDocument();
    expect(screen.getByTestId('search-bar-submit')).toBeInTheDocument();
    expect(screen.getByTestId('search-bar-clear')).toBeInTheDocument();
  });

  it('marks the active scope button with aria-selected=true', () => {
    act(() => {
      useSearchStore.getState().setScope('notes');
    });
    render(<SearchBar testIdPrefix="search-bar" />);
    expect(screen.getByTestId('search-bar-scope-notes').getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('search-bar-scope-all').getAttribute('aria-selected')).toBe('false');
  });

  it('input is controlled by store.query', () => {
    act(() => {
      useSearchStore.getState().setQuery('react');
    });
    render(<SearchBar testIdPrefix="search-bar" />);
    const input = screen.getByTestId('search-bar-input') as HTMLInputElement;
    expect(input.value).toBe('react');
  });
});

describe('SearchBar interactions', () => {
  it('typing into input updates store.query', () => {
    render(<SearchBar testIdPrefix="search-bar" />);
    const input = screen.getByTestId('search-bar-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'hello' } });
    expect(useSearchStore.getState().query).toBe('hello');
  });

  it('Enter key triggers store.search', () => {
    const searchSpy = vi.spyOn(useSearchStore.getState(), 'search');
    render(<SearchBar testIdPrefix="search-bar" />);
    const input = screen.getByTestId('search-bar-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'react' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(searchSpy).toHaveBeenCalled();
    searchSpy.mockRestore();
  });

  it('Escape key triggers store.clear', () => {
    const clearSpy = vi.spyOn(useSearchStore.getState(), 'clear');
    render(<SearchBar testIdPrefix="search-bar" />);
    const input = screen.getByTestId('search-bar-input') as HTMLInputElement;
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });

  it('scope button click updates scope and triggers search', () => {
    const searchSpy = vi.spyOn(useSearchStore.getState(), 'search');
    render(<SearchBar testIdPrefix="search-bar" />);
    fireEvent.click(screen.getByTestId('search-bar-scope-tasks'));
    expect(useSearchStore.getState().scope).toBe('tasks');
    expect(searchSpy).toHaveBeenCalled();
    searchSpy.mockRestore();
  });

  it('submit button click triggers store.search', () => {
    const searchSpy = vi.spyOn(useSearchStore.getState(), 'search');
    render(<SearchBar testIdPrefix="search-bar" />);
    act(() => {
      useSearchStore.getState().setQuery('react');
    });
    fireEvent.click(screen.getByTestId('search-bar-submit'));
    expect(searchSpy).toHaveBeenCalled();
    searchSpy.mockRestore();
  });

  it('clear button click triggers store.clear', () => {
    const clearSpy = vi.spyOn(useSearchStore.getState(), 'clear');
    render(<SearchBar testIdPrefix="search-bar" />);
    act(() => {
      useSearchStore.getState().setQuery('react');
    });
    fireEvent.click(screen.getByTestId('search-bar-clear'));
    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });
});

describe('SearchBar disabled states', () => {
  it('submit button is disabled when query is empty', () => {
    render(<SearchBar testIdPrefix="search-bar" />);
    const submit = screen.getByTestId('search-bar-submit') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
  });

  it('submit button is enabled when query has content', () => {
    render(<SearchBar testIdPrefix="search-bar" />);
    act(() => {
      useSearchStore.getState().setQuery('react');
    });
    const submit = screen.getByTestId('search-bar-submit') as HTMLButtonElement;
    expect(submit.disabled).toBe(false);
  });

  it('submit button shows "搜索中…" when loading', () => {
    render(<SearchBar testIdPrefix="search-bar" />);
    act(() => {
      useSearchStore.setState({ loading: true, query: 'react' });
    });
    const submit = screen.getByTestId('search-bar-submit') as HTMLButtonElement;
    expect(submit.textContent).toContain('搜索中');
    expect(submit.disabled).toBe(true);
  });
});
