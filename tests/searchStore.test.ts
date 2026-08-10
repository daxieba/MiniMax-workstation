/**
 * searchStore Zustand store 测试（T4-2）
 *
 * 覆盖：
 *   - setQuery / setScope 改 state
 *   - search 调 window.api.search.query 并更新 results
 *   - search 空 query → 不调 IPC + 清 results
 *   - search 失败 → toast + 不更新 results
 *   - clear 清 results
 *   - 没有 window.api（SSR / test）→ 静默 no-op
 *
 * 全部**不**依赖真实 IPC —— 用 mock api。
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from '@testing-library/react';

import { useSearchStore } from '@/store/searchStore';
import { useToastStore } from '@/store/toastStore';
import type { SearchResult } from '@shared/schemas/search';

/** 把 store action 包在 act() 里跑，并显式返回 Promise<T>。 */
async function runInAct<T>(fn: () => Promise<T>): Promise<T> {
  let result!: T;
  await act(async () => {
    result = await fn();
  });
  return result;
}

interface MockApiCalls {
  query: Array<unknown>;
}

interface InstallOpts {
  queryResult?:
    | { ok: true; data: SearchResult[] }
    | { ok: false; error: { code: string; message: string } };
}

function installMockApi(opts: InstallOpts = {}): { calls: MockApiCalls } {
  const calls: MockApiCalls = { query: [] };

  const api = {
    async query(input: unknown) {
      calls.query.push(input);
      return (
        opts.queryResult ?? {
          ok: true as const,
          data: [],
        }
      );
    },
  };

  (window as unknown as { api: { search: typeof api } }).api = { search: api };
  return { calls };
}

function uninstallMockApi(): void {
  delete (window as unknown as { api?: unknown }).api;
}

function makeResult(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    kind: 'note',
    id: 'N_' + Math.random().toString(36).slice(2, 8),
    title: 'Sample result',
    snippet: 'Sample <mark>match</mark> text',
    score: 0.85,
    metadata: { kind: 'note' },
    ...overrides,
  };
}

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
  uninstallMockApi();
});

describe('searchStore basic actions', () => {
  it('setQuery updates state.query', () => {
    act(() => {
      useSearchStore.getState().setQuery('react');
    });
    expect(useSearchStore.getState().query).toBe('react');
  });

  it('setScope updates state.scope', () => {
    act(() => {
      useSearchStore.getState().setScope('notes');
    });
    expect(useSearchStore.getState().scope).toBe('notes');
  });

  it('clear resets results / error / loading (keeps query)', () => {
    useSearchStore.setState({
      results: [makeResult()],
      error: 'something',
      loading: true,
      query: 'keep me',
    });
    act(() => {
      useSearchStore.getState().clear();
    });
    expect(useSearchStore.getState().results).toEqual([]);
    expect(useSearchStore.getState().error).toBeNull();
    expect(useSearchStore.getState().loading).toBe(false);
    expect(useSearchStore.getState().query).toBe('keep me');
  });
});

describe('searchStore.search', () => {
  it('calls window.api.search.query with trimmed query + scope + default limit', async () => {
    const { calls } = installMockApi({
      queryResult: { ok: true, data: [makeResult()] },
    });
    await act(async () => {
      useSearchStore.getState().setQuery('  react tutorial  ');
      useSearchStore.getState().setScope('notes');
    });
    await runInAct(() => useSearchStore.getState().search());
    expect(calls.query).toHaveLength(1);
    // store 默认带 limit: 20（IPC 入参 schema 接受）
    expect(calls.query[0]).toEqual({ query: 'react tutorial', scope: 'notes', limit: 20 });
  });

  it('updates results on success', async () => {
    const results = [makeResult({ id: 'N1' }), makeResult({ id: 'N2' })];
    installMockApi({ queryResult: { ok: true, data: results } });
    await act(async () => {
      useSearchStore.getState().setQuery('react');
    });
    await runInAct(() => useSearchStore.getState().search());
    expect(useSearchStore.getState().results).toEqual(results);
    expect(useSearchStore.getState().error).toBeNull();
  });

  it('shows toast and sets error on IPC failure', async () => {
    installMockApi({
      queryResult: { ok: false, error: { code: 'PERSISTENCE_FAILED', message: 'db boom' } },
    });
    await act(async () => {
      useSearchStore.getState().setQuery('react');
    });
    await runInAct(() => useSearchStore.getState().search());
    expect(useSearchStore.getState().results).toEqual([]);
    expect(useSearchStore.getState().error).toBe('搜索失败: PERSISTENCE_FAILED db boom');
    expect(useToastStore.getState().toasts.length).toBeGreaterThan(0);
  });

  it('does not call IPC for empty query (clears results silently)', async () => {
    const { calls } = installMockApi({
      queryResult: { ok: true, data: [makeResult()] },
    });
    await act(async () => {
      useSearchStore.getState().setQuery('   ');
    });
    await runInAct(() => useSearchStore.getState().search());
    expect(calls.query).toHaveLength(0);
    expect(useSearchStore.getState().results).toEqual([]);
  });

  it('does not call IPC for whitespace-only query', async () => {
    const { calls } = installMockApi();
    await act(async () => {
      useSearchStore.getState().setQuery('\t\n  ');
    });
    await runInAct(() => useSearchStore.getState().search());
    expect(calls.query).toHaveLength(0);
  });
});

describe('searchStore with no window.api', () => {
  it('search is a silent no-op when api is missing', async () => {
    uninstallMockApi();
    await act(async () => {
      useSearchStore.getState().setQuery('react');
    });
    await runInAct(() => useSearchStore.getState().search());
    expect(useSearchStore.getState().results).toEqual([]);
    expect(useSearchStore.getState().error).toBeNull();
  });
});
