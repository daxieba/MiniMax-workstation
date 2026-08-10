/**
 * AIQuickAction 组件测试（T3-3 + T3-4 结构化展示）
 *
 * 覆盖：
 *   - 基础：渲染 textarea + 按钮 + 结果区
 *   - 流式结果展示（schemaName 为空）：accumulate + done
 *   - 结构化结果展示：
 *     - `inbox_items` schema：items 列表（每条 content + kind badge + 全部接受/丢弃）
 *     - `task_drafts` schema：tasks 列表（每条 title + priority badge + 全部接受/丢弃）
 *     - `note_summary` schema：title + summary + tags + 全部接受/丢弃
 *   - 底部"全部接受" / "全部丢弃"按钮：触发 onAcceptAll / onDismissAll
 */

import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { AIQuickAction } from '@/components/AIQuickAction/AIQuickAction';
import type { PendingResult } from '@/store/aiStore';

function makePending(overrides: Partial<PendingResult> = {}): PendingResult {
  return {
    id: 'p1',
    action: 'extract_tasks',
    content: '',
    createdAt: 1700000000000,
    status: 'pending',
    streaming: false,
    ...overrides,
  };
}

describe('AIQuickAction (basic streaming)', () => {
  it('renders input + run button + empty result', () => {
    render(
      <AIQuickAction
        action="summarize"
        value=""
        onChange={() => undefined}
        onRun={() => undefined}
        loading={false}
      />,
    );
    expect(screen.getByTestId('ai-quick-action-summarize-input')).toBeInTheDocument();
    expect(screen.getByTestId('ai-quick-action-summarize-run')).toBeInTheDocument();
    expect(screen.getByTestId('ai-quick-action-summarize-result')).toBeInTheDocument();
  });

  it('disables run button when input is empty', () => {
    render(
      <AIQuickAction
        action="summarize"
        value=""
        onChange={() => undefined}
        onRun={() => undefined}
        loading={false}
      />,
    );
    expect(screen.getByTestId('ai-quick-action-summarize-run')).toBeDisabled();
  });

  it('shows streaming content when result has content + streaming', () => {
    const item = makePending({ action: 'summarize', streaming: true, content: 'partial...' });
    render(
      <AIQuickAction
        action="summarize"
        value="x"
        onChange={() => undefined}
        onRun={() => undefined}
        loading={false}
        result={item}
      />,
    );
    const resultDiv = screen.getByTestId('ai-quick-action-summarize-result');
    expect(resultDiv.textContent).toContain('partial...');
  });
});

describe('AIQuickAction (T3-4 structured: task_drafts)', () => {
  it('renders tasks list with title + priority badge', () => {
    const item = makePending({
      action: 'extract_tasks',
      schemaName: 'task_drafts',
      structured: {
        tasks: [
          { title: 'Write report', priority: 'high' },
          { title: 'Send email', priority: 'low' },
          { title: 'No priority task' },
        ],
      },
      attempts: 1,
    });
    render(
      <AIQuickAction
        action="extract_tasks"
        value="x"
        onChange={() => undefined}
        onRun={() => undefined}
        loading={false}
        result={item}
        onAcceptAll={() => undefined}
        onDismissAll={() => undefined}
      />,
    );
    expect(screen.getByTestId('ai-quick-action-extract_tasks-structured')).toBeInTheDocument();
    expect(screen.getByTestId('ai-quick-action-extract_tasks-structured').getAttribute('data-schema-name')).toBe('task_drafts');
    // 3 个 task
    expect(screen.getByTestId('ai-quick-action-extract_tasks-task-0')).toBeInTheDocument();
    expect(screen.getByTestId('ai-quick-action-extract_tasks-task-1')).toBeInTheDocument();
    expect(screen.getByTestId('ai-quick-action-extract_tasks-task-2')).toBeInTheDocument();
    // title 文本
    expect(screen.getByTestId('ai-quick-action-extract_tasks-task-title-0').textContent).toContain('Write report');
    expect(screen.getByTestId('ai-quick-action-extract_tasks-task-title-1').textContent).toContain('Send email');
    // priority badge（高 / 低）
    expect(screen.getByTestId('ai-quick-action-extract_tasks-task-priority-0').textContent).toContain('高');
    expect(screen.getByTestId('ai-quick-action-extract_tasks-task-priority-1').textContent).toContain('低');
  });

  it('accept-all button triggers onAcceptAll', () => {
    const onAcceptAll = vi.fn();
    const item = makePending({
      schemaName: 'task_drafts',
      structured: { tasks: [{ title: 'Task 1' }] },
    });
    render(
      <AIQuickAction
        action="extract_tasks"
        value="x"
        onChange={() => undefined}
        onRun={() => undefined}
        loading={false}
        result={item}
        onAcceptAll={onAcceptAll}
        onDismissAll={() => undefined}
      />,
    );
    fireEvent.click(screen.getByTestId('ai-quick-action-extract_tasks-accept-all'));
    expect(onAcceptAll).toHaveBeenCalledWith(item);
  });

  it('dismiss-all button triggers onDismissAll', () => {
    const onDismissAll = vi.fn();
    const item = makePending({
      schemaName: 'task_drafts',
      structured: { tasks: [{ title: 'Task 1' }] },
    });
    render(
      <AIQuickAction
        action="extract_tasks"
        value="x"
        onChange={() => undefined}
        onRun={() => undefined}
        loading={false}
        result={item}
        onAcceptAll={() => undefined}
        onDismissAll={onDismissAll}
      />,
    );
    fireEvent.click(screen.getByTestId('ai-quick-action-extract_tasks-dismiss-all'));
    expect(onDismissAll).toHaveBeenCalledWith(item);
  });
});

describe('AIQuickAction (T3-4 structured: inbox_items)', () => {
  it('renders items list with content + kind badge', () => {
    const item = makePending({
      action: 'summarize',
      schemaName: 'inbox_items',
      structured: {
        items: [
          { content: 'Remember to call John', kind: 'note' },
          { content: 'Buy milk', kind: 'todo' },
        ],
      },
    });
    render(
      <AIQuickAction
        action="summarize"
        value="x"
        onChange={() => undefined}
        onRun={() => undefined}
        loading={false}
        result={item}
        onAcceptAll={() => undefined}
        onDismissAll={() => undefined}
      />,
    );
    expect(screen.getByTestId('ai-quick-action-summarize-structured').getAttribute('data-schema-name')).toBe('inbox_items');
    expect(screen.getByTestId('ai-quick-action-summarize-item-content-0').textContent).toContain('Remember to call John');
    expect(screen.getByTestId('ai-quick-action-summarize-item-kind-0').textContent).toContain('想法');
    expect(screen.getByTestId('ai-quick-action-summarize-item-kind-1').textContent).toContain('待办');
  });
});

describe('AIQuickAction (T3-4 structured: note_summary)', () => {
  it('renders title + summary + tags', () => {
    const item = makePending({
      action: 'summarize',
      schemaName: 'note_summary',
      structured: {
        title: 'My Note Title',
        summary: 'A short summary text',
        tags: ['ai', 'work'],
      },
    });
    render(
      <AIQuickAction
        action="summarize"
        value="x"
        onChange={() => undefined}
        onRun={() => undefined}
        loading={false}
        result={item}
        onAcceptAll={() => undefined}
        onDismissAll={() => undefined}
      />,
    );
    expect(screen.getByTestId('ai-quick-action-summarize-structured').getAttribute('data-schema-name')).toBe('note_summary');
    expect(screen.getByTestId('ai-quick-action-summarize-note-title').textContent).toContain('My Note Title');
    expect(screen.getByTestId('ai-quick-action-summarize-note-summary').textContent).toContain('A short summary text');
    expect(screen.getByTestId('ai-quick-action-summarize-note-tag-0').textContent).toContain('#ai');
    expect(screen.getByTestId('ai-quick-action-summarize-note-tag-1').textContent).toContain('#work');
  });
});

describe('AIQuickAction (T3-4 streaming fallback when no schemaName)', () => {
  it('falls back to streaming view when result has no schemaName', () => {
    const item = makePending({ action: 'summarize', content: 'just text', streaming: false });
    render(
      <AIQuickAction
        action="summarize"
        value="x"
        onChange={() => undefined}
        onRun={() => undefined}
        loading={false}
        result={item}
      />,
    );
    // 流式视图
    expect(screen.getByTestId('ai-quick-action-summarize-result')).toBeInTheDocument();
    // 结构化视图**不**渲染
    expect(screen.queryByTestId('ai-quick-action-summarize-structured')).toBeNull();
    // 没有 accept / dismiss 按钮
    expect(screen.queryByTestId('ai-quick-action-summarize-accept-all')).toBeNull();
  });
});
