/**
 * NoteAIPanel 组件测试（T4-3）
 *
 * 覆盖：
 *   - 无 note → 显示"请先选中笔记"占位
 *   - 触发 AI 摘要 → 调 onSummarize(note.content)
 *   - 展示结果：title / summary / tags（用 NoteSummary schema）
 *   - "应用到笔记" → 调 onApply + 二次确认（mock window.confirm）
 *   - "丢弃" → 调 onDismiss
 *   - 加载中态：disable 按钮 + 显示 loading 文案
 *   - 无 API key 提示
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { NoteAIPanel, buildApplyPatch } from '@/components/NoteAIPanel/NoteAIPanel';
import type { NoteSummary } from '@shared/types/ai';
import type { Note } from '@shared/types/note';
import type { PendingResult } from '@/store/aiStore';

function makeNote(overrides: Partial<Note> = {}): Note {
  return {
    id: 'N1',
    title: 'Original Title',
    content: 'Original body content',
    tags: ['orig'],
    linkedTaskIds: [],
    projectId: null,
    source: 'manual',
    archived: false,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    ...overrides,
  };
}

function makePending(overrides: Partial<PendingResult> = {}): PendingResult {
  return {
    id: 'p1',
    action: 'summarize',
    content: '',
    createdAt: 1_700_000_000_000,
    status: 'pending',
    streaming: false,
    ...overrides,
  };
}

beforeEach(() => {
  // 默认 confirm 返回 false（避免自动应用）
  vi.spyOn(window, 'confirm').mockReturnValue(false);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('NoteAIPanel (no note)', () => {
  it('shows empty placeholder when note is null', () => {
    render(
      <NoteAIPanel
        note={null}
        pending={null}
        onSummarize={() => undefined}
        onApply={() => undefined}
        onDismiss={() => undefined}
      />,
    );
    expect(screen.getByTestId('note-ai-panel-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('note-ai-panel-summarize')).toBeNull();
  });
});

describe('NoteAIPanel (basic)', () => {
  it('renders the panel with summarize button', () => {
    render(
      <NoteAIPanel
        note={makeNote()}
        pending={null}
        onSummarize={() => undefined}
        onApply={() => undefined}
        onDismiss={() => undefined}
      />,
    );
    expect(screen.getByTestId('note-ai-panel')).toBeInTheDocument();
    expect(screen.getByTestId('note-ai-panel-summarize')).toBeInTheDocument();
    expect(screen.getByTestId('note-ai-panel-hint')).toBeInTheDocument();
  });

  it('clicking AI 摘要 calls onSummarize with note.content', () => {
    const onSummarize = vi.fn();
    const note = makeNote({ content: 'my content' });
    render(
      <NoteAIPanel
        note={note}
        pending={null}
        onSummarize={onSummarize}
        onApply={() => undefined}
        onDismiss={() => undefined}
      />,
    );
    fireEvent.click(screen.getByTestId('note-ai-panel-summarize'));
    expect(onSummarize).toHaveBeenCalledWith('my content');
  });

  it('disables summarize button when loading=true', () => {
    render(
      <NoteAIPanel
        note={makeNote()}
        pending={null}
        onSummarize={() => undefined}
        onApply={() => undefined}
        onDismiss={() => undefined}
        loading
      />,
    );
    expect(screen.getByTestId('note-ai-panel-summarize')).toBeDisabled();
  });

  it('disables summarize button when hasKey=false', () => {
    render(
      <NoteAIPanel
        note={makeNote()}
        pending={null}
        onSummarize={() => undefined}
        onApply={() => undefined}
        onDismiss={() => undefined}
        hasKey={false}
      />,
    );
    expect(screen.getByTestId('note-ai-panel-summarize')).toBeDisabled();
    expect(screen.getByTestId('note-ai-panel-no-key')).toBeInTheDocument();
  });
});

describe('NoteAIPanel (with note_summary pending)', () => {
  const summary: NoteSummary = {
    title: 'AI Generated Title',
    summary: 'AI generated summary text',
    tags: ['ai', 'frontend'],
  };
  const pending: PendingResult = makePending({
    schemaName: 'note_summary',
    structured: summary,
    sourceInput: 'orig content',
  });

  it('renders title / summary / tags in editable inputs', () => {
    render(
      <NoteAIPanel
        note={makeNote()}
        pending={pending}
        onSummarize={() => undefined}
        onApply={() => undefined}
        onDismiss={() => undefined}
      />,
    );
    expect(screen.getByTestId('note-ai-panel-result')).toBeInTheDocument();
    const titleInput = screen.getByTestId('note-ai-panel-edit-title') as HTMLInputElement;
    expect(titleInput.value).toBe('AI Generated Title');
    const summaryTextarea = screen.getByTestId('note-ai-panel-edit-summary') as HTMLTextAreaElement;
    expect(summaryTextarea.value).toBe('AI generated summary text');
    const tagsInput = screen.getByTestId('note-ai-panel-edit-tags') as HTMLInputElement;
    expect(tagsInput.value).toBe('ai, frontend');
  });

  it('changing inputs reflects in local state', () => {
    render(
      <NoteAIPanel
        note={makeNote()}
        pending={pending}
        onSummarize={() => undefined}
        onApply={() => undefined}
        onDismiss={() => undefined}
      />,
    );
    const titleInput = screen.getByTestId('note-ai-panel-edit-title') as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: 'My Custom Title' } });
    expect(titleInput.value).toBe('My Custom Title');
  });

  it('clicking "应用到笔记" with confirm=true calls onApply with buildApplyPatch output', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const onApply = vi.fn();
    render(
      <NoteAIPanel
        note={makeNote()}
        pending={pending}
        onSummarize={() => undefined}
        onApply={onApply}
        onDismiss={() => undefined}
      />,
    );
    fireEvent.click(screen.getByTestId('note-ai-panel-apply'));
    expect(window.confirm).toHaveBeenCalled();
    expect(onApply).toHaveBeenCalledWith({
      title: 'AI Generated Title',
      content: 'AI generated summary text',
      tags: ['ai', 'frontend'],
    });
  });

  it('clicking "应用到笔记" with confirm=false does NOT call onApply', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const onApply = vi.fn();
    render(
      <NoteAIPanel
        note={makeNote()}
        pending={pending}
        onSummarize={() => undefined}
        onApply={onApply}
        onDismiss={() => undefined}
      />,
    );
    fireEvent.click(screen.getByTestId('note-ai-panel-apply'));
    expect(onApply).not.toHaveBeenCalled();
  });

  it('applying respects user-edited title (not the original summary title)', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const onApply = vi.fn();
    render(
      <NoteAIPanel
        note={makeNote()}
        pending={pending}
        onSummarize={() => undefined}
        onApply={onApply}
        onDismiss={() => undefined}
      />,
    );
    const titleInput = screen.getByTestId('note-ai-panel-edit-title') as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: 'My Edited Title' } });
    fireEvent.click(screen.getByTestId('note-ai-panel-apply'));
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ title: 'My Edited Title' }));
  });

  it('clicking "丢弃" calls onDismiss', () => {
    const onDismiss = vi.fn();
    render(
      <NoteAIPanel
        note={makeNote()}
        pending={pending}
        onSummarize={() => undefined}
        onApply={() => undefined}
        onDismiss={onDismiss}
      />,
    );
    fireEvent.click(screen.getByTestId('note-ai-panel-dismiss'));
    expect(onDismiss).toHaveBeenCalled();
  });

  it('shows "重新摘要" button label when pending exists', () => {
    render(
      <NoteAIPanel
        note={makeNote()}
        pending={pending}
        onSummarize={() => undefined}
        onApply={() => undefined}
        onDismiss={() => undefined}
      />,
    );
    const btn = screen.getByTestId('note-ai-panel-summarize');
    expect(btn.textContent).toContain('重新摘要');
  });
});

describe('buildApplyPatch', () => {
  it('truncates title to 256 chars and uses fallback for empty', () => {
    expect(buildApplyPatch({ title: '', summary: 's', tags: [] })).toEqual({
      title: '(无标题)',
      content: 's',
      tags: [],
    });
    expect(buildApplyPatch({ title: 'x'.repeat(300), summary: 's', tags: [] })).toEqual({
      title: 'x'.repeat(256),
      content: 's',
      tags: [],
    });
  });

  it('truncates summary content to 8192 chars', () => {
    const long = 'x'.repeat(10_000);
    const result = buildApplyPatch({ title: 't', summary: long, tags: [] });
    expect(result.content.length).toBe(8192);
  });

  it('truncates tags count to 64 and trims empty', () => {
    const tags = Array.from({ length: 100 }, (_, i) => `t${i}`);
    const result = buildApplyPatch({ title: 't', summary: 's', tags });
    expect(result.tags.length).toBe(64);
    expect(result.tags[0]).toBe('t0');
  });

  it('filters out empty tag strings', () => {
    const result = buildApplyPatch({
      title: 't',
      summary: 's',
      tags: ['a', '  ', '', 'b'],
    });
    expect(result.tags).toEqual(['a', 'b']);
  });
});
