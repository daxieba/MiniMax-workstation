/**
 * Bookmarks store（v0.1.3）
 *
 * 设计：
 *   - localStorage 持久化（不写 db schema，避免破坏 T2-x 既有数据结构）
 *   - 每个 bookmark：id / url / title / tags[] / createdAt / visitCount / lastVisitedAt
 *   - 操作：add / update / delete / markVisited
 *
 * 不做：
 *   - 不做 sync（单设备 local-first）
 *   - 不做 favicon 自动抓取（v0.1.x）
 */
import { create } from 'zustand';

export interface Bookmark {
  id: string;
  url: string;
  title: string;
  tags: string[];
  createdAt: number;
  visitCount: number;
  lastVisitedAt: number | null;
}

const STORAGE_KEY = 'minimax.workstation.bookmarks';
const STORAGE_VERSION = 1;

interface PersistedShape {
  v: number;
  bookmarks: Bookmark[];
}

function loadPersisted(): Bookmark[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PersistedShape;
    if (parsed.v !== STORAGE_VERSION || !Array.isArray(parsed.bookmarks)) return [];
    return parsed.bookmarks;
  } catch {
    return [];
  }
}

function savePersisted(bookmarks: Bookmark[]): void {
  try {
    const payload: PersistedShape = { v: STORAGE_VERSION, bookmarks };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // ignore
  }
}

function makeId(): string {
  // ULID-like：时间 + 随机
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 10);
  return `bm-${t}-${r}`;
}

export interface AddBookmarkInput {
  url: string;
  title?: string;
  tags?: string[];
}

export interface BookmarksState {
  bookmarks: Bookmark[];
  add: (input: AddBookmarkInput) => Bookmark | null;
  update: (id: string, patch: Partial<Omit<Bookmark, 'id' | 'createdAt'>>) => void;
  delete: (id: string) => void;
  /** 标记访问一次（visitCount++ / lastVisitedAt = now）。 */
  markVisited: (id: string) => void;
  /** 全量替换（导入用）。 */
  setAll: (bookmarks: Bookmark[]) => void;
}

export const useBookmarksStore = create<BookmarksState>((set, get) => ({
  bookmarks: loadPersisted(),

  add: (input) => {
    const url = input.url.trim();
    if (!/^https?:\/\//i.test(url)) return null;
    const title = input.title?.trim() || url;
    const tags = (input.tags ?? []).map((t) => t.trim()).filter((t) => t.length > 0);
    const bm: Bookmark = {
      id: makeId(),
      url,
      title,
      tags,
      createdAt: Date.now(),
      visitCount: 0,
      lastVisitedAt: null,
    };
    const next = [bm, ...get().bookmarks];
    set({ bookmarks: next });
    savePersisted(next);
    return bm;
  },

  update: (id, patch) => {
    const next = get().bookmarks.map((b) => (b.id === id ? { ...b, ...patch } : b));
    set({ bookmarks: next });
    savePersisted(next);
  },

  delete: (id) => {
    const next = get().bookmarks.filter((b) => b.id !== id);
    set({ bookmarks: next });
    savePersisted(next);
  },

  markVisited: (id) => {
    const next = get().bookmarks.map((b) =>
      b.id === id ? { ...b, visitCount: b.visitCount + 1, lastVisitedAt: Date.now() } : b,
    );
    set({ bookmarks: next });
    savePersisted(next);
  },

  setAll: (bookmarks) => {
    set({ bookmarks });
    savePersisted(bookmarks);
  },
}));
