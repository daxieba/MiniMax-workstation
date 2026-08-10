/**
 * noteStore Zustand store 测试（T4-1）
 *
 * 覆盖：
 *   - load 调 window.api.note.list 并更新 notes
 *   - setFilter 触发 reload
 *   - get / create / update / archive / delete 调对应 IPC + 更新本地状态
 *   - linkToTask / unlinkFromTask 调对应 IPC + 更新本地状态
 *   - 失败 → toast + 不更新本地状态
 *   - 没有 window.api（SSR / test）→ 静默 no-op
 *
 * 全部**不**依赖真实 IPC —— 用 mock api。
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from '@testing-library/react';

import { useNoteStore } from '@/store/noteStore';
import { useToastStore } from '@/store/toastStore';
import type { Note } from '@shared/types/note';

/** 把 store action 包在 act() 里跑，并显式返回 Promise<T>（避免 act 返回值类型被推断成 never）。 */
async function runInAct<T>(fn: () => Promise<T>): Promise<T> {
  let result!: T;
  await act(async () => {
    result = await fn();
  });
  return result;
}

interface MockApiCalls {
  list: Array<unknown>;
  get: Array<{ id: string }>;
  create: Array<unknown>;
  update: Array<{ id: string; patch: unknown }>;
  archive: Array<{ id: string }>;
  delete: Array<{ id: string }>;
  linkToTask: Array<{ noteId: string; taskId: string }>;
  unlinkFromTask: Array<{ noteId: string; taskId: string }>;
}

interface InstallOpts {
  listResult?: { ok: true; data: Note[] } | { ok: false; error: { code: string; message: string } };
  getResult?: (input: { id: string }) =>
    | { ok: true; data: Note }
    | { ok: false; error: { code: string; message: string } };
  createResult?: { ok: true; data: Note } | { ok: false; error: { code: string; message: string } };
  updateResult?: (input: { id: string; patch: unknown }) =>
    | { ok: true; data: Note }
    | { ok: false; error: { code: string; message: string } };
  archiveResult?: (input: { id: string }) =>
    | { ok: true; data: Note }
    | { ok: false; error: { code: string; message: string } };
  deleteResult?: { ok: true; data: { deleted: true } } | { ok: false; error: { code: string; message: string } };
  linkResult?: (input: { noteId: string; taskId: string }) =>
    | { ok: true; data: Note }
    | { ok: false; error: { code: string; message: string } };
  unlinkResult?: (input: { noteId: string; taskId: string }) =>
    | { ok: true; data: Note }
    | { ok: false; error: { code: string; message: string } };
}

function installMockApi(opts: InstallOpts = {}): { calls: MockApiCalls } {
  const calls: MockApiCalls = {
    list: [],
    get: [],
    create: [],
    update: [],
    archive: [],
    delete: [],
    linkToTask: [],
    unlinkFromTask: [],
  };

  const api = {
    async list(filter: unknown) {
      calls.list.push(filter);
      return (
        opts.listResult ?? {
          ok: true as const,
          data: [],
        }
      );
    },
    async get(input: { id: string }) {
      calls.get.push(input);
      const handler = opts.getResult;
      if (handler) return handler(input);
      return {
        ok: false as const,
        error: { code: 'NOT_FOUND', message: 'not found' },
      };
    },
    async create(input: unknown) {
      calls.create.push(input);
      return (
        opts.createResult ?? {
          ok: false as const,
          error: { code: 'INTERNAL', message: 'no result configured' },
        }
      );
    },
    async update(input: { id: string; patch: unknown }) {
      calls.update.push(input);
      const handler = opts.updateResult;
      if (handler) return handler(input);
      return {
        ok: false as const,
        error: { code: 'NOT_FOUND', message: 'not found' },
      };
    },
    async archive(input: { id: string }) {
      calls.archive.push(input);
      const handler = opts.archiveResult;
      if (handler) return handler(input);
      return {
        ok: false as const,
        error: { code: 'NOT_FOUND', message: 'not found' },
      };
    },
    async delete(input: { id: string }) {
      calls.delete.push(input);
      return (
        opts.deleteResult ?? {
          ok: false as const,
          error: { code: 'NOT_FOUND', message: 'not found' },
        }
      );
    },
    async linkToTask(input: { noteId: string; taskId: string }) {
      calls.linkToTask.push(input);
      const handler = opts.linkResult;
      if (handler) return handler(input);
      return {
        ok: false as const,
        error: { code: 'INTERNAL', message: 'no result' },
      };
    },
    async unlinkFromTask(input: { noteId: string; taskId: string }) {
      calls.unlinkFromTask.push(input);
      const handler = opts.unlinkResult;
      if (handler) return handler(input);
      return {
        ok: false as const,
        error: { code: 'INTERNAL', message: 'no result' },
      };
    },
  };

  (window as unknown as { api: { note: typeof api } }).api = { note: api };
  return { calls };
}

function uninstallMockApi(): void {
  delete (window as unknown as { api?: unknown }).api;
}

function makeNote(overrides: Partial<Note> = {}): Note {
  return {
    id: 'N_' + Math.random().toString(36).slice(2, 8),
    title: 'Sample',
    content: 'body',
    tags: [],
    linkedTaskIds: [],
    projectId: null,
    source: 'manual',
    archived: false,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    ...overrides,
  };
}

beforeEach(() => {
  useToastStore.setState({ toasts: [] });
  useNoteStore.setState({
    notes: [],
    loading: false,
    error: null,
    filter: {},
  });
});

afterEach(() => {
  uninstallMockApi();
});

describe('noteStore.load', () => {
  it('calls window.api.note.list and updates state', async () => {
    const note = makeNote({ id: 'N1' });
    const { calls } = installMockApi({
      listResult: { ok: true, data: [note] },
    });
    await act(async () => {
      await useNoteStore.getState().load();
    });
    expect(calls.list).toHaveLength(1);
    expect(useNoteStore.getState().notes).toEqual([note]);
  });

  it('shows toast and sets error when IPC returns ok:false', async () => {
    installMockApi({
      listResult: { ok: false, error: { code: 'INTERNAL', message: 'boom' } },
    });
    await act(async () => {
      await useNoteStore.getState().load();
    });
    expect(useNoteStore.getState().error).toBe('boom');
    expect(useToastStore.getState().toasts.length).toBeGreaterThan(0);
  });
});

describe('noteStore.setFilter', () => {
  it('updates filter and triggers reload', async () => {
    const { calls } = installMockApi({ listResult: { ok: true, data: [] } });
    act(() => {
      useNoteStore.getState().setFilter({ tag: '前端' });
    });
    expect(useNoteStore.getState().filter).toEqual({ tag: '前端' });
    // reload 是异步；等一拍
    await act(async () => {
      await Promise.resolve();
    });
    expect(calls.list.length).toBeGreaterThanOrEqual(1);
  });
});

describe('noteStore.create', () => {
  it('inserts the new note when IPC succeeds', async () => {
    const newNote = makeNote({ id: 'N_new', title: 'fresh' });
    installMockApi({ createResult: { ok: true, data: newNote } });
    const captured = await runInAct(() => useNoteStore.getState().create({ title: 'fresh', content: 'body' }));
    expect(captured).not.toBeNull();
    if (captured) expect(captured.id).toBe('N_new');
    expect(useNoteStore.getState().notes.map((n) => n.id)).toContain('N_new');
  });

  it('returns null and toasts on error', async () => {
    installMockApi({
      createResult: { ok: false, error: { code: 'VALIDATION_FAILED', message: 'bad' } },
    });
    const captured = await runInAct(() => useNoteStore.getState().create({ title: 'x', content: 'y' }));
    expect(captured).toBeNull();
    expect(useToastStore.getState().toasts.length).toBeGreaterThan(0);
  });
});

describe('noteStore.update', () => {
  it('replaces the existing note in the list', async () => {
    const note = makeNote({ id: 'N1', title: 'old' });
    useNoteStore.setState({ notes: [note] });
    const updated = { ...note, title: 'new' };
    installMockApi({ updateResult: () => ({ ok: true as const, data: updated }) });
    const captured = await runInAct(() => useNoteStore.getState().update('N1', { title: 'new' }));
    expect(captured).not.toBeNull();
    if (captured) expect(captured.title).toBe('new');
    expect(useNoteStore.getState().notes[0]?.title).toBe('new');
  });
});

describe('noteStore.archive', () => {
  it('updates the note with archived=true', async () => {
    const note = makeNote({ id: 'N1', archived: false });
    useNoteStore.setState({ notes: [note] });
    const archived = { ...note, archived: true };
    installMockApi({ archiveResult: () => ({ ok: true as const, data: archived }) });
    const captured = await runInAct(() => useNoteStore.getState().archive('N1'));
    expect(captured).not.toBeNull();
    if (captured) expect(captured.archived).toBe(true);
  });
});

describe('noteStore.delete', () => {
  it('removes the note from the list on success', async () => {
    const note = makeNote({ id: 'N1' });
    useNoteStore.setState({ notes: [note] });
    installMockApi({ deleteResult: { ok: true, data: { deleted: true } } });
    const captured = await runInAct(() => useNoteStore.getState().delete('N1'));
    expect(captured).toBe(true);
    expect(useNoteStore.getState().notes.map((n) => n.id)).not.toContain('N1');
  });

  it('returns false and toasts on error', async () => {
    installMockApi({
      deleteResult: { ok: false, error: { code: 'NOT_FOUND', message: 'gone' } },
    });
    const captured = await runInAct(() => useNoteStore.getState().delete('N1'));
    expect(captured).toBe(false);
    expect(useToastStore.getState().toasts.length).toBeGreaterThan(0);
  });
});

describe('noteStore.linkToTask / unlinkFromTask', () => {
  it('linkToTask updates the note with new linkedTaskIds', async () => {
    const note = makeNote({ id: 'N1', linkedTaskIds: [] });
    useNoteStore.setState({ notes: [note] });
    const updated = { ...note, linkedTaskIds: ['T1'] };
    installMockApi({ linkResult: () => ({ ok: true as const, data: updated }) });
    const captured = await runInAct(() => useNoteStore.getState().linkToTask('N1', 'T1'));
    expect(captured).not.toBeNull();
    if (captured) expect(captured.linkedTaskIds).toEqual(['T1']);
    expect(useNoteStore.getState().notes[0]?.linkedTaskIds).toEqual(['T1']);
  });

  it('unlinkFromTask updates the note with taskId removed', async () => {
    const note = makeNote({ id: 'N1', linkedTaskIds: ['T1', 'T2'] });
    useNoteStore.setState({ notes: [note] });
    const updated = { ...note, linkedTaskIds: ['T2'] };
    installMockApi({ unlinkResult: () => ({ ok: true as const, data: updated }) });
    const captured = await runInAct(() => useNoteStore.getState().unlinkFromTask('N1', 'T1'));
    expect(captured).not.toBeNull();
    if (captured) expect(captured.linkedTaskIds).toEqual(['T2']);
  });
});

describe('noteStore with no window.api', () => {
  it('load is a silent no-op when api is missing', async () => {
    uninstallMockApi();
    await act(async () => {
      await useNoteStore.getState().load();
    });
    expect(useNoteStore.getState().notes).toEqual([]);
    expect(useNoteStore.getState().error).toBeNull();
  });

  it('create returns null when api is missing', async () => {
    uninstallMockApi();
    const captured = await runInAct(() => useNoteStore.getState().create({ title: 'x', content: 'y' }));
    expect(captured).toBeNull();
  });
});
