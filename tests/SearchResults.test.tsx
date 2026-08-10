/**
 * SearchResults 组件测试（T4-2）
 *
 * 覆盖：
 *   - 渲染：每个 result 渲染 title / snippet / kind 徽章 / score
 *   - 交互：点击 → 调 onSelect(id, kind)
 *   - 边界：
 *     - results=[] → 空态文案
 *     - error → error 提示
 *     - snippet 含 <mark> → 渲染为高亮（XSS 安全：原文 escape，只保留 mark）
 *     - snippet 含 <script> → 被 escape，不当 HTML 执行
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { SearchResults } from '@/components/SearchResults/SearchResults';
import { useSearchStore } from '@/store/searchStore';
import type { SearchResult } from '@shared/schemas/search';

beforeEach(() => {
  useSearchStore.setState({
    query: 'react',
    scope: 'all',
    results: [],
    loading: false,
    error: null,
  });
});

afterEach(() => {
  // no-op
});

function makeNoteResult(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    kind: 'note',
    id: 'N1',
    title: 'React tutorial',
    snippet: 'Learn <mark>react</mark> basics',
    score: 0.85,
    metadata: { kind: 'note' },
    ...overrides,
  };
}

function makeTaskResult(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    kind: 'task',
    id: 'T1',
    title: 'React refactor task',
    snippet: 'Refactor <mark>react</mark> components',
    score: 0.6,
    metadata: { kind: 'task', status: 'doing', priority: 'high' },
    ...overrides,
  };
}

function makeInboxResult(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    kind: 'inbox',
    id: 'I1',
    title: 'React article link',
    snippet: 'https://example.com/<mark>react</mark>',
    score: 0.3,
    metadata: { kind: 'inbox', itemKind: 'link', status: 'active' },
    ...overrides,
  };
}

describe('SearchResults empty / error states', () => {
  it('shows empty state when results=[]', () => {
    render(<SearchResults results={[]} onSelect={() => undefined} testIdPrefix="results" />);
    expect(screen.getByTestId('results-empty')).toBeInTheDocument();
  });

  it('shows error message when store.error is set', () => {
    useSearchStore.setState({ error: 'something broke' });
    render(<SearchResults results={[]} onSelect={() => undefined} testIdPrefix="results" />);
    expect(screen.getByTestId('results-error')).toBeInTheDocument();
    expect(screen.getByTestId('results-error').textContent).toContain('something broke');
  });
});

describe('SearchResults rendering', () => {
  it('renders one item per result', () => {
    const results = [makeNoteResult({ id: 'A' }), makeTaskResult({ id: 'B' }), makeInboxResult({ id: 'C' })];
    render(<SearchResults results={results} onSelect={() => undefined} testIdPrefix="results" />);
    expect(screen.getByTestId('results-item-note-A')).toBeInTheDocument();
    expect(screen.getByTestId('results-item-task-B')).toBeInTheDocument();
    expect(screen.getByTestId('results-item-inbox-C')).toBeInTheDocument();
  });

  it('shows kind badge per result', () => {
    const results = [makeNoteResult({ id: 'A' }), makeTaskResult({ id: 'B' }), makeInboxResult({ id: 'C' })];
    render(<SearchResults results={results} onSelect={() => undefined} testIdPrefix="results" />);
    expect(screen.getByTestId('results-kind-note-A').textContent).toContain('笔记');
    expect(screen.getByTestId('results-kind-task-B').textContent).toContain('任务');
    expect(screen.getByTestId('results-kind-inbox-C').textContent).toContain('收集箱');
  });

  it('shows title per result', () => {
    const results = [makeNoteResult({ id: 'A', title: 'My React Note' })];
    render(<SearchResults results={results} onSelect={() => undefined} testIdPrefix="results" />);
    expect(screen.getByTestId('results-title-note-A').textContent).toBe('My React Note');
  });

  it('shows score as percentage', () => {
    const results = [makeNoteResult({ id: 'A', score: 0.85 })];
    render(<SearchResults results={results} onSelect={() => undefined} testIdPrefix="results" />);
    expect(screen.getByTestId('results-score-note-A').textContent).toBe('85%');
  });

  it('renders snippet with <mark> preserved (HTML escape + mark restore)', () => {
    const results = [makeNoteResult({ id: 'A', snippet: 'Learn <mark>react</mark> basics' })];
    const { container } = render(
      <SearchResults results={results} onSelect={() => undefined} testIdPrefix="results" />,
    );
    const snippet = screen.getByTestId('results-snippet-note-A');
    // 找到内部的 <mark>
    const mark = snippet.querySelector('mark');
    expect(mark).not.toBeNull();
    expect(mark?.textContent).toBe('react');
    // snippet 内不应有 dangerouslySetInnerHTML 注入的 <script>
    expect(container.querySelectorAll('script').length).toBe(0);
  });

  it('XSS-escapes raw HTML in snippet (only mark tag preserved)', () => {
    const results = [
      makeNoteResult({ id: 'A', snippet: 'evil <script>alert(1)</script> and <mark>react</mark> text' }),
    ];
    const { container } = render(
      <SearchResults results={results} onSelect={() => undefined} testIdPrefix="results" />,
    );
    // script 标签不应被插入 DOM
    expect(container.querySelectorAll('script').length).toBe(0);
    // mark 标签应被保留
    const mark = container.querySelector('mark');
    expect(mark).not.toBeNull();
    expect(mark?.textContent).toBe('react');
    // 转义后的 script 文本应作为字符串存在
    expect(container.innerHTML).toContain('&lt;script&gt;');
  });
});

describe('SearchResults click', () => {
  it('click on item calls onSelect with id and kind', () => {
    const onSelect = vi.fn();
    const results = [makeNoteResult({ id: 'A' })];
    render(<SearchResults results={results} onSelect={onSelect} testIdPrefix="results" />);
    fireEvent.click(screen.getByTestId('results-item-click-note-A'));
    expect(onSelect).toHaveBeenCalledWith('A', 'note');
  });

  it('task click calls onSelect with kind=task', () => {
    const onSelect = vi.fn();
    const results = [makeTaskResult({ id: 'B' })];
    render(<SearchResults results={results} onSelect={onSelect} testIdPrefix="results" />);
    fireEvent.click(screen.getByTestId('results-item-click-task-B'));
    expect(onSelect).toHaveBeenCalledWith('B', 'task');
  });

  it('inbox click calls onSelect with kind=inbox', () => {
    const onSelect = vi.fn();
    const results = [makeInboxResult({ id: 'C' })];
    render(<SearchResults results={results} onSelect={onSelect} testIdPrefix="results" />);
    fireEvent.click(screen.getByTestId('results-item-click-inbox-C'));
    expect(onSelect).toHaveBeenCalledWith('C', 'inbox');
  });
});
