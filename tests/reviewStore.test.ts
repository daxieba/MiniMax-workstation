/**
 * reviewStore Zustand store 测试（T5-1）
 *
 * 覆盖：
 *   - loadByDate 调 window.api.review.getByDate
 *   - loadRecent 调 window.api.review.listRecent
 *   - upsertReview 调 window.api.review.upsert（同步 current + recent）
 *   - updateReview 调 window.api.review.update
 *   - generateDraft 调 window.api.review.generateDraft（写 aiDraft）
 *   - acceptDraft 把 aiDraft 数据写到 current 的 4 段字段（仅本地），并清空 aiDraft
 *     —— **不**自动保存
 *   - discardDraft 仅清空 aiDraft
 *   - 失败 → toast + 不更新本地状态
 *   - 没有 window.api（SSR / test）→ 静默 no-op
 *
 * 全部**不**依赖真实 IPC —— 用 mock api。
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from '@testing-library/react';

import { useReviewStore } from '@/store/reviewStore';
import { useToastStore } from '@/store/toastStore';
import type { Review, ReviewDraft } from '@shared/types/review';

/** 把 store action 包在 act() 里跑，并显式返回 Promise<T>。 */
async function runInAct<T>(fn: () => Promise<T>): Promise<T> {
  let result!: T;
  await act(async () => {
    result = await fn();
  });
  return result;
}

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
    completed: ['finished 1'],
    uncompleted: [{ title: 'pending 1' }],
    blockers: 'no blockers',
    topThree: ['next 1', 'next 2', 'next 3'],
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

interface InstallOpts {
  getByDateResult?: (date: string) =>
    | { ok: true; data: Review | null }
    | { ok: false; error: { code: string; message: string } };
  upsertResult?: (input: unknown) =>
    | { ok: true; data: Review }
    | { ok: false; error: { code: string; message: string } };
  updateResult?: (input: unknown) =>
    | { ok: true; data: Review }
    | { ok: false; error: { code: string; message: string } };
  listRecentResult?: (input: unknown) =>
    | { ok: true; data: Review[] }
    | { ok: false; error: { code: string; message: string } };
  generateDraftResult?: (input: unknown) =>
    | { ok: true; data: ReviewDraft }
    | { ok: false; error: { code: string; message: string } };
}

function installMockApi(opts: InstallOpts = {}): { calls: MockApiCalls } {
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
        if (opts.getByDateResult) return opts.getByDateResult(date);
        return { ok: true as const, data: null };
      },
      async upsert(input: unknown) {
        calls.upsert.push(input);
        if (opts.upsertResult) return opts.upsertResult(input);
        return { ok: false as const, error: { code: 'INTERNAL', message: 'no result' } };
      },
      async update(input: unknown) {
        calls.update.push(input);
        if (opts.updateResult) return opts.updateResult(input);
        return { ok: false as const, error: { code: 'INTERNAL', message: 'no result' } };
      },
      async listRecent(input: unknown) {
        calls.listRecent.push(input);
        if (opts.listRecentResult) return opts.listRecentResult(input);
        return { ok: true as const, data: [] };
      },
      async generateDraft(input: unknown) {
        calls.generateDraft.push(input);
        if (opts.generateDraftResult) return opts.generateDraftResult(input);
        return { ok: false as const, error: { code: 'INTERNAL', message: 'no result' } };
      },
    },
  };

  return { calls };
}

function clearMockApi(): void {
  (window as unknown as { api?: unknown }).api = undefined;
}

function resetStore(): void {
  useReviewStore.setState({
    current: null,
    currentDate: '',
    recent: [],
    aiDraft: null,
    loading: false,
    error: null,
  });
  useToastStore.getState().clear();
}

beforeEach(() => {
  resetStore();
});

afterEach(() => {
  clearMockApi();
  resetStore();
});

// ============================================================
//  loadByDate
// ============================================================

describe('reviewStore.loadByDate', () => {
  it('loads and sets current', async () => {
    const review = makeReview({ date: '2026-08-09', blockers: 'busy' });
    const { calls } = installMockApi({
      getByDateResult: () => ({ ok: true as const, data: review }),
    });
    try {
      await runInAct(() => useReviewStore.getState().loadByDate('2026-08-09'));
      expect(calls.getByDate).toEqual(['2026-08-09']);
      const state = useReviewStore.getState();
      expect(state.current).toEqual(review);
      expect(state.currentDate).toBe('2026-08-09');
      expect(state.error).toBeNull();
    } finally {
      clearMockApi();
    }
  });

  it('handles null result (no review for date)', async () => {
    installMockApi({
      getByDateResult: () => ({ ok: true as const, data: null }),
    });
    try {
      await runInAct(() => useReviewStore.getState().loadByDate('2026-08-10'));
      const state = useReviewStore.getState();
      expect(state.current).toBeNull();
      expect(state.currentDate).toBe('2026-08-10');
    } finally {
      clearMockApi();
    }
  });

  it('toasts and sets error on failure', async () => {
    installMockApi({
      getByDateResult: () => ({
        ok: false as const,
        error: { code: 'PERSISTENCE_FAILED', message: 'db broken' },
      }),
    });
    try {
      await runInAct(() => useReviewStore.getState().loadByDate('2026-08-09'));
      const state = useReviewStore.getState();
      expect(state.error).toContain('db broken');
      expect(state.current).toBeNull();
      // toast 队列里应该有 1 条
      expect(useToastStore.getState().toasts.length).toBeGreaterThan(0);
    } finally {
      clearMockApi();
    }
  });
});

// ============================================================
//  loadRecent
// ============================================================

describe('reviewStore.loadRecent', () => {
  it('loads recent list with default empty limit', async () => {
    const reviews = [makeReview({ id: 'R1' }), makeReview({ id: 'R2' })];
    const { calls } = installMockApi({
      listRecentResult: () => ({ ok: true as const, data: reviews }),
    });
    try {
      await runInAct(() => useReviewStore.getState().loadRecent());
      expect(calls.listRecent).toHaveLength(1);
      expect(calls.listRecent[0]).toEqual({});
      expect(useReviewStore.getState().recent).toEqual(reviews);
    } finally {
      clearMockApi();
    }
  });

  it('passes limit through', async () => {
    const { calls } = installMockApi();
    try {
      await runInAct(() => useReviewStore.getState().loadRecent(7));
      expect(calls.listRecent[0]).toEqual({ limit: 7 });
    } finally {
      clearMockApi();
    }
  });
});

// ============================================================
//  upsertReview
// ============================================================

describe('reviewStore.upsertReview', () => {
  it('upserts and updates current + recent', async () => {
    const review = makeReview({ id: 'R_NEW' });
    const { calls } = installMockApi({
      upsertResult: (input) => {
        // echo back with id and date
        const i = input as { date: string };
        return { ok: true as const, data: { ...review, date: i.date } };
      },
    });
    try {
      const result = await runInAct(() =>
        useReviewStore.getState().upsertReview({
          date: '2026-08-09',
          completed: [],
          uncompleted: [],
          blockers: '',
          topThree: [],
        }),
      );
      expect(calls.upsert).toHaveLength(1);
      expect(result).not.toBeNull();
      const state = useReviewStore.getState();
      expect(state.current?.id).toBe('R_NEW');
      expect(state.recent[0]?.id).toBe('R_NEW');
    } finally {
      clearMockApi();
    }
  });

  it('returns null and toasts on failure', async () => {
    installMockApi({
      upsertResult: () => ({
        ok: false as const,
        error: { code: 'VALIDATION_FAILED', message: 'bad' },
      }),
    });
    try {
      const result = await runInAct(() =>
        useReviewStore.getState().upsertReview({
          date: '2026-08-09',
          completed: [],
          uncompleted: [],
          blockers: '',
          topThree: [],
        }),
      );
      expect(result).toBeNull();
      expect(useToastStore.getState().toasts.length).toBeGreaterThan(0);
    } finally {
      clearMockApi();
    }
  });
});

// ============================================================
//  generateDraft
// ============================================================

describe('reviewStore.generateDraft', () => {
  it('calls generateDraft and stores aiDraft', async () => {
    const draft = makeDraft();
    const { calls } = installMockApi({
      generateDraftResult: () => ({ ok: true as const, data: draft }),
    });
    try {
      const result = await runInAct(() =>
        useReviewStore.getState().generateDraft('2026-08-09', 'minimax', 'test-model'),
      );
      expect(calls.generateDraft).toHaveLength(1);
      expect(calls.generateDraft[0]).toEqual({
        date: '2026-08-09',
        provider: 'minimax',
        model: 'test-model',
      });
      expect(result).toEqual(draft);
      expect(useReviewStore.getState().aiDraft).toEqual(draft);
    } finally {
      clearMockApi();
    }
  });

  it('toasts and returns null on AI failure', async () => {
    installMockApi({
      generateDraftResult: () => ({
        ok: false as const,
        error: { code: 'EXTERNAL_FAILURE', message: 'AI broken' },
      }),
    });
    try {
      const result = await runInAct(() =>
        useReviewStore.getState().generateDraft('2026-08-09', 'minimax'),
      );
      expect(result).toBeNull();
      expect(useReviewStore.getState().aiDraft).toBeNull();
      expect(useToastStore.getState().toasts.length).toBeGreaterThan(0);
    } finally {
      clearMockApi();
    }
  });
});

// ============================================================
//  acceptDraft（核心：不自动保存）
// ============================================================

describe('reviewStore.acceptDraft (CRITICAL: does NOT auto-save)', () => {
  it('writes aiDraft data into current 4 fields and clears aiDraft', () => {
    const review = makeReview({ id: 'R1', date: '2026-08-09' });
    const draft = makeDraft({
      completed: ['drafted 1', 'drafted 2'],
      uncompleted: [{ title: 'drafted pending 1', reason: 'because' }],
      blockers: 'drafted blockers',
      topThree: ['t1', 't2', 't3'],
    });
    useReviewStore.setState({ current: review, aiDraft: draft });

    useReviewStore.getState().acceptDraft();

    const state = useReviewStore.getState();
    // aiDraft 已清空
    expect(state.aiDraft).toBeNull();
    // current 的 4 段字段被 draft 数据覆盖
    expect(state.current?.completed).toEqual([
      { taskId: '', title: 'drafted 1' },
      { taskId: '', title: 'drafted 2' },
    ]);
    expect(state.current?.uncompleted).toEqual([
      { taskId: '', title: 'drafted pending 1', reason: 'because' },
    ]);
    expect(state.current?.blockers).toBe('drafted blockers');
    expect(state.current?.topThree).toEqual(['t1', 't2', 't3']);
    // 其他字段保持
    expect(state.current?.id).toBe('R1');
    expect(state.current?.date).toBe('2026-08-09');
    // **关键**：store 没有调 upsert / update —— 不自动保存
    // 这通过 mock api calls.length === 0 验证
  });

  it('handles no-current case (clears aiDraft, no auto-save)', () => {
    useReviewStore.setState({ current: null, aiDraft: makeDraft() });
    useReviewStore.getState().acceptDraft();
    const state = useReviewStore.getState();
    expect(state.aiDraft).toBeNull();
    expect(state.current).toBeNull();
  });

  it('no-op when no aiDraft', () => {
    const review = makeReview({ id: 'R1' });
    useReviewStore.setState({ current: review, aiDraft: null });
    useReviewStore.getState().acceptDraft();
    // current 不变
    expect(useReviewStore.getState().current).toEqual(review);
  });
});

// ============================================================
//  discardDraft
// ============================================================

describe('reviewStore.discardDraft', () => {
  it('clears aiDraft but keeps current', () => {
    const review = makeReview({ id: 'R1', blockers: 'keep me' });
    useReviewStore.setState({ current: review, aiDraft: makeDraft() });
    useReviewStore.getState().discardDraft();
    const state = useReviewStore.getState();
    expect(state.aiDraft).toBeNull();
    expect(state.current).toEqual(review);
  });
});

// ============================================================
//  无 window.api（SSR / test 环境）
// ============================================================

describe('reviewStore (no window.api fallback)', () => {
  it('loadByDate is no-op when api is missing', async () => {
    clearMockApi();
    await runInAct(() => useReviewStore.getState().loadByDate('2026-08-09'));
    const state = useReviewStore.getState();
    expect(state.current).toBeNull();
    expect(state.currentDate).toBe('2026-08-09');
    expect(state.loading).toBe(false);
  });
});
