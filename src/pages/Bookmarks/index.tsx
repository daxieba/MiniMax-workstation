/**
 * 书签页（v0.1.3 新功能）
 *
 * 功能：
 *   - 顶部"加入书签"按钮 + 折叠式表单（URL / 标题 / 标签）
 *   - 搜索框（按 url / title / tags 过滤）
 *   - 列表：每条卡片显示 title + url + 标签 + 访问次数 + 上次访问
 *     - 点击 URL → 浏览器打开 + markVisited
 *     - "复制" 按钮：复制 URL 到剪贴板
 *     - "删除" 按钮：confirm 后删除
 *   - 空态：EmptyState
 *
 * 数据源：`useBookmarksStore`（localStorage 持久化）。
 *
 * 不做：
 *   - 不做 favicon 自动抓取
 *   - 不做文件夹 / 嵌套
 */
import { useMemo, useState } from 'react';
import { Bookmark as BookmarkIcon, Clipboard, ExternalLink, Plus, Search, Trash2 } from 'lucide-react';

import { EmptyState } from '@/components/EmptyState/EmptyState';
import { useI18nStore, useT } from '@/i18n';
import { useBookmarksStore, type Bookmark } from '@/store/bookmarksStore';
import { toast } from '@/store/toastStore';

export default function BookmarksPage(): React.ReactElement {
  const t = useT();
  const lang = useI18nStore((s) => s.lang);

  const bookmarks = useBookmarksStore((s) => s.bookmarks);
  const add = useBookmarksStore((s) => s.add);
  const deleteBm = useBookmarksStore((s) => s.delete);
  const markVisited = useBookmarksStore((s) => s.markVisited);

  const [addOpen, setAddOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [tags, setTags] = useState('');
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return bookmarks;
    return bookmarks.filter((b) => {
      if (b.url.toLowerCase().includes(q)) return true;
      if (b.title.toLowerCase().includes(q)) return true;
      if (b.tags.some((tag) => tag.toLowerCase().includes(q))) return true;
      return false;
    });
  }, [bookmarks, query]);

  const handleSubmit = (): void => {
    const trimmedUrl = url.trim();
    if (!trimmedUrl) return;
    if (!/^https?:\/\//i.test(trimmedUrl)) {
      toast.error(t.toasts.urlInvalid);
      return;
    }
    const tagList = tags.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
    const bm = add({ url: trimmedUrl, title: title.trim() || trimmedUrl, tags: tagList });
    if (bm) {
      toast.success(t.toasts.bookmarkAdded);
      setUrl('');
      setTitle('');
      setTags('');
      setAddOpen(false);
    }
  };

  const handleDelete = (bm: Bookmark): void => {
    if (!window.confirm(t.pages.bookmarks.deleteConfirm)) return;
    deleteBm(bm.id);
    toast.success(t.toasts.bookmarkDeleted);
  };

  const handleOpen = (bm: Bookmark): void => {
    markVisited(bm.id);
    window.open(bm.url, '_blank', 'noopener,noreferrer');
  };

  const handleCopy = async (bm: Bookmark): Promise<void> => {
    try {
      await navigator.clipboard.writeText(bm.url);
      toast.success(t.common.search === '搜索' ? '已复制' : 'Copied');
    } catch {
      // 复制失败时不强求，Electron 渲染端通常 OK
    }
  };

  return (
    <section data-testid="bookmarks-page" className="flex h-full flex-col gap-4 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-primary">{t.pages.bookmarks.title}</h1>
          <p className="text-sm text-secondary">{t.pages.bookmarks.subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          {!addOpen ? (
            <button
              type="button"
              data-testid="bookmarks-new"
              onClick={() => setAddOpen(true)}
              className="inline-flex items-center gap-1 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-inverse transition-colors hover:bg-accent-hover"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              {t.pages.bookmarks.newBookmark}
            </button>
          ) : null}
        </div>
      </header>

      {addOpen ? (
        <form
          data-testid="bookmarks-form"
          onSubmit={(e) => {
            e.preventDefault();
            handleSubmit();
          }}
          className="rounded-lg border border-line bg-elevated p-3 shadow-card"
        >
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            <label className="flex flex-col gap-1 text-xs text-secondary">
              <span>{t.pages.bookmarks.urlLabel} *</span>
              <input
                type="url"
                data-testid="bookmarks-input-url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder={t.pages.bookmarks.urlPlaceholder}
                autoFocus
                required
                className="rounded-md border border-line bg-base px-2 py-1.5 text-sm text-primary outline-none focus:border-accent"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-secondary">
              <span>{t.pages.bookmarks.titleLabel}</span>
              <input
                type="text"
                data-testid="bookmarks-input-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t.pages.bookmarks.titlePlaceholder}
                className="rounded-md border border-line bg-base px-2 py-1.5 text-sm text-primary outline-none focus:border-accent"
              />
            </label>
            <label className="col-span-full flex flex-col gap-1 text-xs text-secondary">
              <span>{t.pages.bookmarks.tagsLabel}</span>
              <input
                type="text"
                data-testid="bookmarks-input-tags"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder={t.pages.bookmarks.tagPlaceholder}
                className="rounded-md border border-line bg-base px-2 py-1.5 text-sm text-primary outline-none focus:border-accent"
              />
            </label>
          </div>
          <div className="mt-3 flex items-center justify-end gap-2">
            <button
              type="button"
              data-testid="bookmarks-cancel"
              onClick={() => {
                setAddOpen(false);
                setUrl('');
                setTitle('');
                setTags('');
              }}
              className="rounded-md border border-line bg-base px-3 py-1.5 text-xs text-secondary transition-colors hover:text-primary"
            >
              {t.common.cancel}
            </button>
            <button
              type="submit"
              data-testid="bookmarks-save"
              className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-inverse transition-colors hover:bg-accent-hover"
            >
              {t.common.save}
            </button>
          </div>
        </form>
      ) : null}

      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-secondary" aria-hidden="true" />
        <input
          type="text"
          data-testid="bookmarks-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t.pages.bookmarks.searchPlaceholder}
          className="w-full rounded-md border border-line bg-base py-1.5 pl-7 pr-2 text-sm text-primary outline-none focus:border-accent"
        />
      </div>

      {filtered.length === 0 ? (
        bookmarks.length === 0 ? (
          <EmptyState
            icon={BookmarkIcon}
            title={t.empty.bookmarks.title}
            description={t.empty.bookmarks.description}
            data-testid="bookmarks-empty"
          />
        ) : (
          <p data-testid="bookmarks-empty-search" className="py-8 text-center text-sm text-secondary">
            {t.pages.bookmarks.emptySearch}
          </p>
        )
      ) : (
        <ul data-testid="bookmarks-list" className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {filtered.map((bm) => (
            <li
              key={bm.id}
              data-testid={`bookmark-${bm.id}`}
              className="flex flex-col gap-2 rounded-md border border-line bg-elevated p-3 shadow-card"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <a
                    href={bm.url}
                    onClick={(e) => {
                      e.preventDefault();
                      handleOpen(bm);
                    }}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block truncate text-sm font-medium text-primary hover:text-accent"
                    title={bm.url}
                  >
                    {bm.title}
                  </a>
                  <p className="truncate text-[11px] text-secondary" title={bm.url}>
                    {bm.url}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    data-testid={`bookmark-open-${bm.id}`}
                    onClick={() => handleOpen(bm)}
                    className="rounded-md border border-line bg-base p-1 text-secondary transition-colors hover:text-primary"
                    title={t.pages.bookmarks.openExternal}
                    aria-label={t.pages.bookmarks.openExternal}
                  >
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    data-testid={`bookmark-copy-${bm.id}`}
                    onClick={() => void handleCopy(bm)}
                    className="rounded-md border border-line bg-base p-1 text-secondary transition-colors hover:text-primary"
                    title={t.pages.bookmarks.copyUrl}
                    aria-label={t.pages.bookmarks.copyUrl}
                  >
                    <Clipboard className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    data-testid={`bookmark-delete-${bm.id}`}
                    onClick={() => handleDelete(bm)}
                    className="rounded-md border border-line bg-base p-1 text-secondary transition-colors hover:text-danger"
                    title={t.common.delete}
                    aria-label={t.common.delete}
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </div>
              </div>
              {bm.tags.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {bm.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full border border-line bg-base px-1.5 py-0.5 text-[10px] text-secondary"
                    >
                      #{tag}
                    </span>
                  ))}
                </div>
              ) : null}
              <div className="flex items-center justify-between text-[10px] text-secondary">
                <span>{t.pages.bookmarks.visitCount(bm.visitCount)}</span>
                <span>
                  {bm.lastVisitedAt
                    ? t.pages.bookmarks.lastVisited(formatRelative(bm.lastVisitedAt, lang))
                    : t.pages.bookmarks.neverVisited}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** 简易相对时间（i18n 跟 Overview 内部实现一致）。 */
function formatRelative(ms: number, lang: 'zh-CN' | 'zh-TW' | 'en-US'): string {
  const diffMs = ms - Date.now();
  const absSec = Math.abs(diffMs) / 1000;
  const rtf = lang === 'en-US'
    ? new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
    : lang === 'zh-TW'
      ? new Intl.RelativeTimeFormat('zh-TW', { numeric: 'auto' })
      : new Intl.RelativeTimeFormat('zh-CN', { numeric: 'auto' });
  if (absSec < 60) return lang === 'en-US' ? 'just now' : '刚刚';
  if (absSec < 3600) return rtf.format(Math.round(diffMs / 60_000), 'minute');
  if (absSec < 86400) return rtf.format(Math.round(diffMs / 3_600_000), 'hour');
  if (absSec < 86400 * 30) return rtf.format(Math.round(diffMs / 86_400_000), 'day');
  return rtf.format(Math.round(diffMs / (86_400_000 * 30)), 'month');
}
