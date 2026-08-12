/**
 * Bookmarks 页面测试（v0.1.3）
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import BookmarksPage from '@/pages/Bookmarks';
import { useBookmarksStore } from '@/store/bookmarksStore';
import { toast } from '@/store/toastStore';

vi.mock('@/store/toastStore', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

const mockWindowOpen = vi.fn();
const originalOpen = window.open;
const originalConfirm = window.confirm;
const originalClipboard = navigator.clipboard;

beforeAll(() => {
  // jsdom 不实现 window.open
  window.open = mockWindowOpen as unknown as typeof window.open;
});

afterAll(() => {
  window.open = originalOpen;
  window.confirm = originalConfirm;
  Object.defineProperty(navigator, 'clipboard', { value: originalClipboard, configurable: true });
});

describe('BookmarksPage', () => {
  beforeEach(() => {
    localStorage.clear();
    useBookmarksStore.setState({ bookmarks: [] });
    mockWindowOpen.mockClear();
    (toast.success as ReturnType<typeof vi.fn>).mockClear();
    (toast.error as ReturnType<typeof vi.fn>).mockClear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  function renderPage(): void {
    render(
      <MemoryRouter>
        <BookmarksPage />
      </MemoryRouter>,
    );
  }

  it('空态：没有 bookmark 时显示 EmptyState', () => {
    renderPage();
    expect(screen.getByTestId('bookmarks-empty')).toBeInTheDocument();
  });

  it('点"加入书签"展开表单', () => {
    renderPage();
    fireEvent.click(screen.getByTestId('bookmarks-new'));
    expect(screen.getByTestId('bookmarks-form')).toBeInTheDocument();
    expect(screen.getByTestId('bookmarks-input-url')).toBeInTheDocument();
  });

  it('表单：填 URL + title + tags 提交后 bookmark 出现在列表', () => {
    renderPage();
    fireEvent.click(screen.getByTestId('bookmarks-new'));
    fireEvent.change(screen.getByTestId('bookmarks-input-url'), {
      target: { value: 'https://example.com' },
    });
    fireEvent.change(screen.getByTestId('bookmarks-input-title'), {
      target: { value: 'Example' },
    });
    fireEvent.change(screen.getByTestId('bookmarks-input-tags'), {
      target: { value: 'tag1, tag2' },
    });
    fireEvent.click(screen.getByTestId('bookmarks-save'));
    expect(useBookmarksStore.getState().bookmarks).toHaveLength(1);
    expect(screen.getByTestId('bookmarks-list')).toBeInTheDocument();
    expect(toast.success).toHaveBeenCalled();
  });

  it('表单：拒绝非 http/https URL', () => {
    renderPage();
    fireEvent.click(screen.getByTestId('bookmarks-new'));
    fireEvent.change(screen.getByTestId('bookmarks-input-url'), {
      target: { value: 'ftp://nope' },
    });
    fireEvent.click(screen.getByTestId('bookmarks-save'));
    expect(useBookmarksStore.getState().bookmarks).toHaveLength(0);
    expect(toast.error).toHaveBeenCalled();
  });

  it('搜索：按 title 过滤', () => {
    useBookmarksStore.setState({
      bookmarks: [
        {
          id: 'a',
          url: 'https://alpha.com',
          title: 'Alpha',
          tags: [],
          createdAt: 1,
          visitCount: 0,
          lastVisitedAt: null,
        },
        {
          id: 'b',
          url: 'https://beta.com',
          title: 'Beta',
          tags: [],
          createdAt: 2,
          visitCount: 0,
          lastVisitedAt: null,
        },
      ],
    });
    renderPage();
    fireEvent.change(screen.getByTestId('bookmarks-search'), { target: { value: 'alpha' } });
    expect(screen.getByTestId('bookmark-a')).toBeInTheDocument();
    expect(screen.queryByTestId('bookmark-b')).toBeNull();
  });

  it('点删除 → 确认后删除', () => {
    useBookmarksStore.setState({
      bookmarks: [
        {
          id: 'a',
          url: 'https://a.com',
          title: 'A',
          tags: [],
          createdAt: 1,
          visitCount: 0,
          lastVisitedAt: null,
        },
      ],
    });
    window.confirm = vi.fn(() => true);
    renderPage();
    fireEvent.click(screen.getByTestId('bookmark-delete-a'));
    expect(window.confirm).toHaveBeenCalled();
    expect(useBookmarksStore.getState().bookmarks).toHaveLength(0);
  });

  it('点打开 → markVisited + window.open', () => {
    useBookmarksStore.setState({
      bookmarks: [
        {
          id: 'a',
          url: 'https://a.com',
          title: 'A',
          tags: [],
          createdAt: 1,
          visitCount: 0,
          lastVisitedAt: null,
        },
      ],
    });
    renderPage();
    act(() => {
      fireEvent.click(screen.getByTestId('bookmark-open-a'));
    });
    expect(mockWindowOpen).toHaveBeenCalledWith('https://a.com', '_blank', 'noopener,noreferrer');
    expect(useBookmarksStore.getState().bookmarks[0]?.visitCount).toBe(1);
  });
});
