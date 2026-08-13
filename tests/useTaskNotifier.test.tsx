/**
 * useTaskNotifier hook test (v0.3.0)
 *
 * Verifies:
 *   - mount scans tasks; overdue (yesterday) -> calls window.api.app.notify
 *   - skips done / archived / no-dueDate / future-dueDate / today
 *   - localStorage dedupe (same task not notified twice)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';

import { useTaskNotifier } from '@/hooks/useTaskNotifier';
import { useTaskStore } from '@/store/taskStore';
import type { Task } from '@shared/types/task';

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'tk-1',
    title: 'Test',
    content: '',
    status: 'todo',
    priority: 'medium',
    projectId: null,
    dueDate: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    archived: false,
    linkedNoteIds: [],
    ...overrides,
  } as Task;
}

function yesterdayMs(): number {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  d.setHours(12, 0, 0, 0);
  return d.getTime();
}

const NOTIFIED_KEY = 'minimax.workstation.notifiedTasks';

let notifyMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  notifyMock = vi.fn(async () => ({ ok: true, data: { shown: true } }));
  (window as unknown as { api: unknown }).api = { app: { notify: notifyMock } };
  localStorage.clear();
  useTaskStore.setState({ tasks: [], loading: false, error: null });
});

afterEach(() => {
  (window as unknown as { api: unknown }).api = undefined;
  vi.clearAllMocks();
});

function TestComp(): React.ReactElement {
  useTaskNotifier();
  return <div data-testid="test-comp" />;
}

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

describe('useTaskNotifier (v0.3.0)', () => {
  it('mount: no tasks -> no notify', async () => {
    render(<TestComp />);
    await flushMicrotasks();
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it('overdue (yesterday) task -> notify', async () => {
    const overdue = makeTask({ id: 'tk-1', status: 'todo', dueDate: yesterdayMs() });
    useTaskStore.setState({ tasks: [overdue] });
    render(<TestComp />);
    await flushMicrotasks();
    expect(notifyMock).toHaveBeenCalledTimes(1);
    expect(notifyMock).toHaveBeenCalledWith({ title: expect.any(String), body: 'Test' });
  });

  it('done overdue task -> no notify', async () => {
    const t = makeTask({ id: 'tk-1', status: 'done', dueDate: yesterdayMs() });
    useTaskStore.setState({ tasks: [t] });
    render(<TestComp />);
    await flushMicrotasks();
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it('archived overdue task -> no notify', async () => {
    const t = makeTask({ id: 'tk-1', status: 'archived', dueDate: yesterdayMs() });
    useTaskStore.setState({ tasks: [t] });
    render(<TestComp />);
    await flushMicrotasks();
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it('no dueDate -> no notify', async () => {
    const t = makeTask({ id: 'tk-1', status: 'todo', dueDate: null });
    useTaskStore.setState({ tasks: [t] });
    render(<TestComp />);
    await flushMicrotasks();
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it('future dueDate (tomorrow) -> no notify (not yet due)', async () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(12, 0, 0, 0);
    const t = makeTask({ id: 'tk-1', status: 'todo', dueDate: tomorrow.getTime() });
    useTaskStore.setState({ tasks: [t] });
    render(<TestComp />);
    await flushMicrotasks();
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it('same task not re-notified (localStorage dedupe)', async () => {
    localStorage.setItem(NOTIFIED_KEY, JSON.stringify(['tk-1']));
    const overdue = makeTask({ id: 'tk-1', status: 'todo', dueDate: yesterdayMs() });
    useTaskStore.setState({ tasks: [overdue] });
    render(<TestComp />);
    await flushMicrotasks();
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it('writes localStorage with notified task id', async () => {
    const overdue = makeTask({ id: 'tk-1', status: 'todo', dueDate: yesterdayMs() });
    useTaskStore.setState({ tasks: [overdue] });
    render(<TestComp />);
    await flushMicrotasks();
    const stored = JSON.parse(localStorage.getItem(NOTIFIED_KEY) ?? '[]') as string[];
    expect(stored).toContain('tk-1');
  });
});
