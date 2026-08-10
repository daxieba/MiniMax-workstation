/**
 * ReviewPage 组件测试（T5-1 每日复盘 UI）
 *
 * 覆盖：
 *   - 渲染 5 段模板（completed / uncompleted / blockers / topThree / AI 草稿区）
 *   - 顶部日期选择器 + 切换按钮 + 加载最近 30 天
 *   - 添加 / 删除 / 编辑 completed row
 *   - 添加 / 删除 / 编辑 uncompleted row（含 reason 输入）
 *   - 编辑 blockers textarea
 *   - 添加 / 删除 topThree row（max 3 限制）
 *   - 保存按钮调 upsert（mock api）
 *   - AI 草稿区折叠 / 展开
 *   - 采纳按钮：把 aiDraft 数据写到 4 段（store acceptDraft）
 *   - 重新生成按钮：调 generateDraft
 *   - 丢弃按钮：清空 aiDraft（store discardDraft）
 *
 * 全部**不**依赖真实 IPC —— 用 mock window.api.review。
 *
 * **注意**：组件 mount 时 useEffect 会调 `loadByDate`，会触发 loading=true
 * 短暂窗口使 button disabled。所有交互测试**必须**等 loadByDate 完成（用
 * `waitFor` / `findByTestId`）。
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import ReviewPage from '@/pages/Review';
import { useAiStore } from '@/store/aiStore';
import { useReviewStore } from '@/store/reviewStore';
import { useToastStore } from '@/store/toastStore';
import type { Review, ReviewDraft } from '@shared/types/review';

function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    id: 'R_' + Math.random().toString(36).slice(2, 8),
    date: '2026-08-09',
    completed: [],
    uncompleted: [],
    blockers: '',
    topThree: [],
    aiDraft: null,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    ...overrides,
  };
}

function makeDraft(overrides: Partial<ReviewDraft> = {}): ReviewDraft {
  return {
    completed: ['drafted 1'],
    uncompleted: [{ title: 'drafted pending' }],
    blockers: 'drafted blockers',
    topThree: ['t1', 't2', 't3'],
    ...overrides,
  };
}

interface MockApiCalls {
  getByDate: Array<string>;
  upsert: Array<unknown>;
  update: Array<unknown>;
  listRecent: Array<unknown>;
  generateDraft: Array<unknown>;
}

function installMockApi(opts: {
  initialReview?: Review;
  onUpsert?: (input: unknown) => { ok: true; data: Review } | { ok: false; error: { code: string; message: string } };
  onGenerateDraft?: () => { ok: true; data: ReviewDraft } | { ok: false; error: { code: string; message: string } };
} = {}): { calls: MockApiCalls } {
  const calls: MockApiCalls = {
    getByDate: [],
    upsert: [],
    update: [],
    listRecent: [],
    generateDraft: [],
  };

  (window as unknown as { api: unknown }).api = {
    review: {
      async getByDate(date: string) {
        calls.getByDate.push(date);
        return { ok: true as const, data: opts.initialReview ?? null };
      },
      async upsert(input: unknown) {
        calls.upsert.push(input);
        if (opts.onUpsert) return opts.onUpsert(input);
        const i = input as {
          date: string;
          completed: Review['completed'];
          uncompleted: Review['uncompleted'];
          blockers: string;
          topThree: string[];
        };
        return {
          ok: true as const,
          data: makeReview({
            id: 'R_NEW',
            date: i.date,
            completed: i.completed,
            uncompleted: i.uncompleted,
            blockers: i.blockers,
            topThree: i.topThree,
          }),
        };
      },
      async update(input: unknown) {
        calls.update.push(input);
        return { ok: true as const, data: makeReview() };
      },
      async listRecent(input: unknown) {
        calls.listRecent.push(input);
        return { ok: true as const, data: [] };
      },
      async generateDraft(input: unknown) {
        calls.generateDraft.push(input);
        if (opts.onGenerateDraft) return opts.onGenerateDraft();
        return { ok: true as const, data: makeDraft() };
      },
    },
  };

  return { calls };
}

function clearMockApi(): void {
  (window as unknown as { api?: unknown }).api = undefined;
}

function resetStores(): void {
  useReviewStore.setState({
    current: null,
    currentDate: '',
    recent: [],
    aiDraft: null,
    loading: false,
    error: null,
  });
  useAiStore.setState({ provider: 'minimax', model: 'test-model' });
  useToastStore.getState().clear();
}

beforeEach(() => {
  resetStores();
});

afterEach(() => {
  clearMockApi();
  resetStores();
});

/** 渲染并等初始 loadByDate 完成（loading 从 true → false）。 */
async function renderAndWaitForLoad(): Promise<ReturnType<typeof render>> {
  const result = render(<ReviewPage />);
  // 等首屏 loadByDate 的 mock api 响应触发 store 更新 → loading 变 false
  await waitFor(() => {
    expect(useReviewStore.getState().loading).toBe(false);
  });
  return result;
}

// ============================================================
//  5 段模板存在 + 顶部控件
// ============================================================

describe('ReviewPage (5 sections present)', () => {
  it('renders all 5 sections + top bar', async () => {
    const { calls } = installMockApi();
    await renderAndWaitForLoad();
    expect(screen.getByTestId('review-page')).toBeInTheDocument();
    expect(screen.getByTestId('review-section-completed')).toBeInTheDocument();
    expect(screen.getByTestId('review-section-uncompleted')).toBeInTheDocument();
    expect(screen.getByTestId('review-section-blockers')).toBeInTheDocument();
    expect(screen.getByTestId('review-section-topthree')).toBeInTheDocument();
    expect(screen.getByTestId('review-ai-draft-section')).toBeInTheDocument();
    // top bar
    expect(screen.getByTestId('review-date-input')).toBeInTheDocument();
    expect(screen.getByTestId('review-prev-day')).toBeInTheDocument();
    expect(screen.getByTestId('review-next-day')).toBeInTheDocument();
    expect(screen.getByTestId('review-today')).toBeInTheDocument();
    expect(screen.getByTestId('review-load-recent')).toBeInTheDocument();
    // empty states
    expect(screen.getByTestId('review-completed-empty')).toBeInTheDocument();
    expect(screen.getByTestId('review-uncompleted-empty')).toBeInTheDocument();
    expect(screen.getByTestId('review-topthree-empty')).toBeInTheDocument();
    // save button
    expect(screen.getByTestId('review-save')).toBeInTheDocument();
    expect(calls.getByDate).toHaveLength(1);
  });
});

// ============================================================
//  Completed / Uncompleted / TopThree 动态列表
// ============================================================

describe('ReviewPage (dynamic lists)', () => {
  it('adds and removes a completed row', async () => {
    installMockApi();
    await renderAndWaitForLoad();
    fireEvent.click(screen.getByTestId('review-completed-add'));
    expect(screen.getByTestId('review-completed-row-0')).toBeInTheDocument();
    const titleInput = screen.getByTestId('review-completed-title-0') as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: 'task A' } });
    expect(titleInput.value).toBe('task A');
    fireEvent.click(screen.getByTestId('review-completed-remove-0'));
    expect(screen.queryByTestId('review-completed-row-0')).toBeNull();
  });

  it('adds and edits an uncompleted row with reason', async () => {
    installMockApi();
    await renderAndWaitForLoad();
    fireEvent.click(screen.getByTestId('review-uncompleted-add'));
    const titleInput = screen.getByTestId('review-uncompleted-title-0') as HTMLInputElement;
    const reasonInput = screen.getByTestId('review-uncompleted-reason-0') as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: 'task X' } });
    fireEvent.change(reasonInput, { target: { value: 'blocked' } });
    expect(titleInput.value).toBe('task X');
    expect(reasonInput.value).toBe('blocked');
  });

  it('limits topThree to 3 rows', async () => {
    installMockApi();
    await renderAndWaitForLoad();
    fireEvent.click(screen.getByTestId('review-topthree-add'));
    fireEvent.click(screen.getByTestId('review-topthree-add'));
    fireEvent.click(screen.getByTestId('review-topthree-add'));
    expect(screen.getByTestId('review-topthree-row-0')).toBeInTheDocument();
    expect(screen.getByTestId('review-topthree-row-1')).toBeInTheDocument();
    expect(screen.getByTestId('review-topthree-row-2')).toBeInTheDocument();
    // 第 4 个 add 按钮应被 disabled
    const addBtn = screen.getByTestId('review-topthree-add') as HTMLButtonElement;
    expect(addBtn).toBeDisabled();
  });

  it('edits blockers textarea', async () => {
    installMockApi();
    await renderAndWaitForLoad();
    const ta = screen.getByTestId('review-blockers-input') as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: 'no progress' } });
    expect(ta.value).toBe('no progress');
  });
});

// ============================================================
//  保存
// ============================================================

describe('ReviewPage (save button)', () => {
  it('save button calls review:upsert with 4 segments', async () => {
    const { calls } = installMockApi();
    await renderAndWaitForLoad();
    // 加一条完成项
    fireEvent.click(screen.getByTestId('review-completed-add'));
    fireEvent.change(screen.getByTestId('review-completed-title-0'), {
      target: { value: 'task A' },
    });
    // 加一条 topThree
    fireEvent.click(screen.getByTestId('review-topthree-add'));
    fireEvent.change(screen.getByTestId('review-topthree-input-0'), {
      target: { value: 'next 1' },
    });
    // 设置 blockers
    fireEvent.change(screen.getByTestId('review-blockers-input'), {
      target: { value: 'busy' },
    });
    // 点保存
    await act(async () => {
      fireEvent.click(screen.getByTestId('review-save'));
    });
    expect(calls.upsert).toHaveLength(1);
    const upsertInput = calls.upsert[0] as {
      date: string;
      completed: Array<{ taskId: string; title: string }>;
      topThree: string[];
      blockers: string;
    };
    expect(upsertInput.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(upsertInput.completed).toEqual([{ taskId: '', title: 'task A' }]);
    expect(upsertInput.topThree).toEqual(['next 1']);
    expect(upsertInput.blockers).toBe('busy');
  });
});

// ============================================================
//  AI 草稿区
// ============================================================

describe('ReviewPage (AI draft panel)', () => {
  it('starts collapsed with no draft', async () => {
    installMockApi();
    await renderAndWaitForLoad();
    expect(screen.getByTestId('review-ai-draft-section')).toBeInTheDocument();
    expect(screen.queryByTestId('review-ai-draft-body')).toBeNull();
  });

  it('expands on toggle and shows generate button when no draft', async () => {
    installMockApi();
    await renderAndWaitForLoad();
    fireEvent.click(screen.getByTestId('review-ai-draft-toggle'));
    expect(screen.getByTestId('review-ai-draft-body')).toBeInTheDocument();
    expect(screen.getAllByTestId('review-ai-draft-regenerate').length).toBeGreaterThan(0);
  });

  it('shows draft details when aiDraft exists + three action buttons', async () => {
    const draft = makeDraft({
      completed: ['done A', 'done B'],
      uncompleted: [{ title: 'pending X', reason: 'why' }],
      blockers: 'blocker text',
      topThree: ['t1', 't2', 't3'],
    });
    installMockApi();
    await renderAndWaitForLoad();
    // 在 loadByDate 完成后设置 state
    act(() => {
      useReviewStore.setState({ aiDraft: draft });
    });
    // 自动展开
    expect(screen.getByTestId('review-ai-draft-body')).toBeInTheDocument();
    expect(screen.getByTestId('review-ai-draft-completed-0')).toHaveTextContent('done A');
    expect(screen.getByTestId('review-ai-draft-completed-1')).toHaveTextContent('done B');
    expect(screen.getByTestId('review-ai-draft-uncompleted-0')).toHaveTextContent('pending X');
    expect(screen.getByTestId('review-ai-draft-blockers')).toHaveTextContent('blocker text');
    // 三个 action 按钮
    expect(screen.getByTestId('review-ai-draft-accept')).toBeInTheDocument();
    expect(screen.getByTestId('review-ai-draft-regenerate')).toBeInTheDocument();
    expect(screen.getByTestId('review-ai-draft-discard')).toBeInTheDocument();
  });

  it('accept button calls store.acceptDraft (writes draft to current)', async () => {
    const review = makeReview({ id: 'R1', date: '2026-08-09' });
    const draft = makeDraft({
      completed: ['new 1'],
      uncompleted: [{ title: 'pending new' }],
      blockers: 'new blockers',
      topThree: ['n1', 'n2', 'n3'],
    });
    installMockApi();
    await renderAndWaitForLoad();
    // 在 loadByDate 完成后设置 state（避免被覆盖）
    act(() => {
      useReviewStore.setState({ current: review, aiDraft: draft });
    });
    fireEvent.click(screen.getByTestId('review-ai-draft-accept'));
    await waitFor(() => {
      expect(useReviewStore.getState().aiDraft).toBeNull();
    });
    const state = useReviewStore.getState();
    expect(state.current?.completed).toEqual([{ taskId: '', title: 'new 1' }]);
    expect(state.current?.blockers).toBe('new blockers');
    expect(state.current?.topThree).toEqual(['n1', 'n2', 'n3']);
  });

  it('regenerate button calls review:generateDraft', async () => {
    const { calls } = installMockApi();
    await renderAndWaitForLoad();
    fireEvent.click(screen.getByTestId('review-ai-draft-toggle'));
    await act(async () => {
      fireEvent.click(screen.getByTestId('review-ai-draft-regenerate'));
    });
    expect(calls.generateDraft).toHaveLength(1);
    expect((calls.generateDraft[0] as { provider: string }).provider).toBe('minimax');
  });

  it('discard button clears aiDraft (no auto-save)', async () => {
    const review = makeReview({ id: 'R1', blockers: 'keep' });
    const draft = makeDraft();
    installMockApi();
    await renderAndWaitForLoad();
    // 在 loadByDate 完成后设置 state（避免被覆盖）
    act(() => {
      useReviewStore.setState({ current: review, aiDraft: draft });
    });
    fireEvent.click(screen.getByTestId('review-ai-draft-discard'));
    await waitFor(() => {
      expect(useReviewStore.getState().aiDraft).toBeNull();
    });
    expect(useReviewStore.getState().current).toEqual(review);
  });
});

// ============================================================
//  顶部日期切换
// ============================================================

describe('ReviewPage (date navigation)', () => {
  it('prev/next day buttons trigger reloadByDate', async () => {
    const { calls } = installMockApi();
    await renderAndWaitForLoad();
    const initial = calls.getByDate.length;
    await act(async () => {
      fireEvent.click(screen.getByTestId('review-prev-day'));
    });
    await waitFor(() => {
      expect(calls.getByDate.length).toBe(initial + 1);
    });
    const newDate = calls.getByDate[calls.getByDate.length - 1] as string;
    expect(newDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('"today" button sets date input back to today', async () => {
    installMockApi();
    await renderAndWaitForLoad();
    await act(async () => {
      fireEvent.click(screen.getByTestId('review-prev-day'));
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('review-today'));
    });
    const dateInput = screen.getByTestId('review-date-input') as HTMLInputElement;
    expect(dateInput.value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('loads recent list on button click', async () => {
    const { calls } = installMockApi();
    await renderAndWaitForLoad();
    await act(async () => {
      fireEvent.click(screen.getByTestId('review-load-recent'));
    });
    await waitFor(() => {
      expect(calls.listRecent).toHaveLength(1);
    });
  });
});
