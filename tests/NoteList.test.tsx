/**
 * NoteList 组件测试（T4-1）
 *
 * 覆盖：
 *   - 空态：notes=[] 时显示空态文案
 *   - 非空态：每条调 NoteCard，传入 projectName + linkedTaskCount + selected
 *   - onSelect 转发
 */

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { NoteList } from '@/components/NoteList/NoteList';
import type { Note } from '@shared/types/note';

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

describe('NoteList', () => {
  it('shows empty state when notes=[]', () => {
    render(
      <NoteList
        notes={[]}
        selectedId={null}
        onSelect={() => undefined}
        projectNameById={new Map()}
        linkedTaskCountByNoteId={new Map()}
      />,
    );
    const empty = screen.getByTestId('note-list-empty');
    expect(empty).toBeInTheDocument();
    expect(empty.textContent).toContain('还没有笔记');
  });

  it('renders a card per note', () => {
    const notes = [makeNote({ id: 'N1' }), makeNote({ id: 'N2' })];
    render(
      <NoteList
        notes={notes}
        selectedId={null}
        onSelect={() => undefined}
        projectNameById={new Map()}
        linkedTaskCountByNoteId={new Map()}
      />,
    );
    expect(screen.getByTestId('note-list')).toBeInTheDocument();
    expect(screen.getByTestId('note-card-N1')).toBeInTheDocument();
    expect(screen.getByTestId('note-card-N2')).toBeInTheDocument();
  });

  it('passes projectName from the map', () => {
    const note = makeNote({ id: 'N1', projectId: 'P1' });
    const projectMap = new Map([['P1', 'My Project']]);
    render(
      <NoteList
        notes={[note]}
        selectedId={null}
        onSelect={() => undefined}
        projectNameById={projectMap}
        linkedTaskCountByNoteId={new Map()}
      />,
    );
    expect(screen.getByTestId('note-card-project-N1').textContent).toContain('My Project');
  });

  it('shows "未知项目" when projectId set but not in map', () => {
    const note = makeNote({ id: 'N1', projectId: 'P_GHOST' });
    render(
      <NoteList
        notes={[note]}
        selectedId={null}
        onSelect={() => undefined}
        projectNameById={new Map()}
        linkedTaskCountByNoteId={new Map()}
      />,
    );
    expect(screen.getByTestId('note-card-project-N1').textContent).toContain('未知项目');
  });

  it('hides project name when projectId is null', () => {
    const note = makeNote({ id: 'N1', projectId: null });
    render(
      <NoteList
        notes={[note]}
        selectedId={null}
        onSelect={() => undefined}
        projectNameById={new Map()}
        linkedTaskCountByNoteId={new Map()}
      />,
    );
    expect(screen.queryByTestId('note-card-project-N1')).toBeNull();
  });

  it('shows linked task count when > 0', () => {
    const note = makeNote({ id: 'N1', linkedTaskIds: ['T1', 'T2', 'T3'] });
    const map = new Map([['N1', 3]]);
    render(
      <NoteList
        notes={[note]}
        selectedId={null}
        onSelect={() => undefined}
        projectNameById={new Map()}
        linkedTaskCountByNoteId={map}
      />,
    );
    expect(screen.getByTestId('note-card-linked-N1').textContent).toContain('3');
  });

  it('hides linked count when 0', () => {
    const note = makeNote({ id: 'N1', linkedTaskIds: [] });
    render(
      <NoteList
        notes={[note]}
        selectedId={null}
        onSelect={() => undefined}
        projectNameById={new Map()}
        linkedTaskCountByNoteId={new Map()}
      />,
    );
    expect(screen.queryByTestId('note-card-linked-N1')).toBeNull();
  });

  it('forwards onSelect with note id', () => {
    const onSelect = vi.fn();
    const notes = [makeNote({ id: 'N1' })];
    render(
      <NoteList
        notes={notes}
        selectedId={null}
        onSelect={onSelect}
        projectNameById={new Map()}
        linkedTaskCountByNoteId={new Map()}
      />,
    );
    fireEvent.click(screen.getByTestId('note-card-N1'));
    expect(onSelect).toHaveBeenCalledWith('N1');
  });

  it('marks selected card with selected visual', () => {
    const notes = [makeNote({ id: 'N1' })];
    render(
      <NoteList
        notes={notes}
        selectedId="N1"
        onSelect={() => undefined}
        projectNameById={new Map()}
        linkedTaskCountByNoteId={new Map()}
      />,
    );
    // selected 用 border-accent 类区分
    const card = screen.getByTestId('note-card-N1');
    expect(card.className).toContain('border-accent');
  });
});
