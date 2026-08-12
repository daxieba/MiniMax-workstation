/**
 * Bookmarks store 测试（v0.1.3）
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { useBookmarksStore } from '@/store/bookmarksStore';

const STORAGE_KEY = 'minimax.workstation.bookmarks';

describe('bookmarksStore', () => {
  beforeEach(() => {
    localStorage.clear();
    useBookmarksStore.setState({ bookmarks: [] });
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('add: 接受 https URL 并创建 bookmark', () => {
    const bm = useBookmarksStore.getState().add({ url: 'https://example.com' });
    expect(bm).not.toBeNull();
    expect(bm?.url).toBe('https://example.com');
    expect(bm?.title).toBe('https://example.com'); // 没给 title 时 fallback 到 url
    expect(bm?.tags).toEqual([]);
    expect(bm?.visitCount).toBe(0);
    expect(bm?.lastVisitedAt).toBeNull();
    expect(useBookmarksStore.getState().bookmarks).toHaveLength(1);
  });

  it('add: 给 title + tags 正常保存', () => {
    const bm = useBookmarksStore.getState().add({
      url: 'https://github.com/anthropics/claude-code',
      title: 'Claude Code',
      tags: ['ai', 'cli', ' anthropic '],
    });
    expect(bm).not.toBeNull();
    expect(bm?.title).toBe('Claude Code');
    expect(bm?.tags).toEqual(['ai', 'cli', 'anthropic']); // trim + 过滤空
  });

  it('add: 拒绝非 http/https URL', () => {
    expect(useBookmarksStore.getState().add({ url: 'ftp://example.com' })).toBeNull();
    expect(useBookmarksStore.getState().add({ url: 'javascript:alert(1)' })).toBeNull();
    expect(useBookmarksStore.getState().add({ url: '' })).toBeNull();
    expect(useBookmarksStore.getState().bookmarks).toHaveLength(0);
  });

  it('add: 持久化到 localStorage', () => {
    useBookmarksStore.getState().add({ url: 'https://a.com', title: 'A' });
    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed.v).toBe(1);
    expect(parsed.bookmarks).toHaveLength(1);
    expect(parsed.bookmarks[0].title).toBe('A');
  });

  it('delete: 按 id 删除并持久化', () => {
    const a = useBookmarksStore.getState().add({ url: 'https://a.com' })!;
    useBookmarksStore.getState().add({ url: 'https://b.com' });
    expect(useBookmarksStore.getState().bookmarks).toHaveLength(2);
    useBookmarksStore.getState().delete(a.id);
    expect(useBookmarksStore.getState().bookmarks).toHaveLength(1);
    expect(useBookmarksStore.getState().bookmarks[0]?.url).toBe('https://b.com');
  });

  it('markVisited: visitCount++ + lastVisitedAt = now', () => {
    const bm = useBookmarksStore.getState().add({ url: 'https://a.com' })!;
    expect(bm.visitCount).toBe(0);
    useBookmarksStore.getState().markVisited(bm.id);
    const after = useBookmarksStore.getState().bookmarks.find((b) => b.id === bm.id)!;
    expect(after.visitCount).toBe(1);
    expect(after.lastVisitedAt).not.toBeNull();
    useBookmarksStore.getState().markVisited(bm.id);
    const after2 = useBookmarksStore.getState().bookmarks.find((b) => b.id === bm.id)!;
    expect(after2.visitCount).toBe(2);
  });

  it('update: 修改 title / tags', () => {
    const bm = useBookmarksStore.getState().add({ url: 'https://a.com' })!;
    useBookmarksStore.getState().update(bm.id, { title: 'New', tags: ['x', 'y'] });
    const after = useBookmarksStore.getState().bookmarks.find((b) => b.id === bm.id)!;
    expect(after.title).toBe('New');
    expect(after.tags).toEqual(['x', 'y']);
  });

  it('顺序：后 add 的排在前面（最新优先）', () => {
    useBookmarksStore.getState().add({ url: 'https://a.com' });
    useBookmarksStore.getState().add({ url: 'https://b.com' });
    const list = useBookmarksStore.getState().bookmarks;
    expect(list[0]?.url).toBe('https://b.com');
    expect(list[1]?.url).toBe('https://a.com');
  });
});
