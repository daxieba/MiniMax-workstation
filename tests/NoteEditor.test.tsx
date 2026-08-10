/**
 * NoteEditor 组件测试（T4-1）
 *
 * 覆盖：
 *   - create / edit 模式渲染
 *   - title / content / tags / project / linked tasks 受控更新
 *   - 提交校验：title 空 / 仅空白时按钮 disable
 *   - 提交时调 onSubmit({ create }) 或 onSubmit({ update })
 *   - 取消按钮调 onCancel
 *   - 删除按钮（仅 edit 模式）调 onDelete
 *   - 归档按钮（仅 edit 模式）调 onArchive
 *   - 编辑/预览 tab 切换
 *   - 预览模式渲染 markdown
 */

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { NoteEditor, EMPTY_NOTE_DRAFT, noteToDraft, type NoteDraft } from '@/components/NoteEditor/NoteEditor';
import type { Note } from '@shared/types/note';
import type { Project } from '@shared/types/project';

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'P1',
    name: 'Project 1',
    description: null,
    color: null,
    archived: false,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    ...overrides,
  };
}

function makeNote(overrides: Partial<Note> = {}): Note {
  return {
    id: 'N1',
    title: 'Original',
    content: 'original body',
    tags: ['前端'],
    linkedTaskIds: ['T1'],
    projectId: 'P1',
    source: 'manual',
    archived: false,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    ...overrides,
  };
}

describe('NoteEditor', () => {
  describe('create mode', () => {
    it('renders empty draft fields', () => {
      render(
        <NoteEditor
          mode="create"
          draft={EMPTY_NOTE_DRAFT}
          onChange={() => undefined}
          onSubmit={() => undefined}
          onCancel={() => undefined}
          projects={[]}
        />,
      );
      expect(screen.getByTestId('note-editor-title')).toHaveValue('');
      expect(screen.getByTestId('note-editor-content')).toHaveValue('');
    });

    it('updates draft on title change', () => {
      const onChange = vi.fn();
      render(
        <NoteEditor
          mode="create"
          draft={EMPTY_NOTE_DRAFT}
          onChange={onChange}
          onSubmit={() => undefined}
          onCancel={() => undefined}
          projects={[]}
        />,
      );
      fireEvent.change(screen.getByTestId('note-editor-title'), {
        target: { value: 'new' },
      });
      expect(onChange).toHaveBeenCalled();
    });

    it('submit button is disabled when title is empty', () => {
      render(
        <NoteEditor
          mode="create"
          draft={EMPTY_NOTE_DRAFT}
          onChange={() => undefined}
          onSubmit={() => undefined}
          onCancel={() => undefined}
          projects={[]}
        />,
      );
      expect(screen.getByTestId('note-editor-submit')).toBeDisabled();
    });

    it('submit button is disabled when title is whitespace only', () => {
      const draft: NoteDraft = { ...EMPTY_NOTE_DRAFT, title: '   ' };
      render(
        <NoteEditor
          mode="create"
          draft={draft}
          onChange={() => undefined}
          onSubmit={() => undefined}
          onCancel={() => undefined}
          projects={[]}
        />,
      );
      expect(screen.getByTestId('note-editor-submit')).toBeDisabled();
    });

    it('submit calls onSubmit with { create } payload including trimmed title', async () => {
      const onSubmit = vi.fn().mockResolvedValue(undefined);
      const draft: NoteDraft = {
        title: '  hello  ',
        content: 'body',
        tags: ['前端'],
        linkedTaskIds: ['T1'],
        projectId: 'P1',
      };
      render(
        <NoteEditor
          mode="create"
          draft={draft}
          onChange={() => undefined}
          onSubmit={onSubmit}
          onCancel={() => undefined}
          projects={[makeProject()]}
        />,
      );
      fireEvent.click(screen.getByTestId('note-editor-submit'));
      expect(onSubmit).toHaveBeenCalledWith({
        create: {
          title: 'hello',
          content: 'body',
          tags: ['前端'],
          linkedTaskIds: ['T1'],
          projectId: 'P1',
        },
      });
    });

    it('cancel calls onCancel', () => {
      const onCancel = vi.fn();
      render(
        <NoteEditor
          mode="create"
          draft={EMPTY_NOTE_DRAFT}
          onChange={() => undefined}
          onSubmit={() => undefined}
          onCancel={onCancel}
          projects={[]}
        />,
      );
      fireEvent.click(screen.getByTestId('note-editor-cancel'));
      expect(onCancel).toHaveBeenCalled();
    });
  });

  describe('edit mode', () => {
    it('renders note data into the form', () => {
      const note = makeNote();
      render(
        <NoteEditor
          mode="edit"
          draft={noteToDraft(note)}
          onChange={() => undefined}
          onSubmit={() => undefined}
          onCancel={() => undefined}
          onDelete={() => undefined}
          onArchive={() => undefined}
          projects={[makeProject()]}
          editingNoteId="N1"
        />,
      );
      expect(screen.getByTestId('note-editor-title')).toHaveValue('Original');
      expect(screen.getByTestId('note-editor-content')).toHaveValue('original body');
      expect(screen.getByTestId('note-editor-delete')).toBeInTheDocument();
      expect(screen.getByTestId('note-editor-archive')).toBeInTheDocument();
    });

    it('submit calls onSubmit with { update } payload', () => {
      const onSubmit = vi.fn();
      const note = makeNote();
      render(
        <NoteEditor
          mode="edit"
          draft={noteToDraft(note)}
          onChange={() => undefined}
          onSubmit={onSubmit}
          onCancel={() => undefined}
          onDelete={() => undefined}
          onArchive={() => undefined}
          projects={[makeProject()]}
          editingNoteId="N1"
        />,
      );
      fireEvent.click(screen.getByTestId('note-editor-submit'));
      expect(onSubmit).toHaveBeenCalledWith({
        update: {
          id: 'N1',
          patch: {
            title: 'Original',
            content: 'original body',
            tags: ['前端'],
            linkedTaskIds: ['T1'],
            projectId: 'P1',
          },
        },
      });
    });

    it('delete button calls onDelete', () => {
      const onDelete = vi.fn();
      const note = makeNote();
      render(
        <NoteEditor
          mode="edit"
          draft={noteToDraft(note)}
          onChange={() => undefined}
          onSubmit={() => undefined}
          onCancel={() => undefined}
          onDelete={onDelete}
          onArchive={() => undefined}
          projects={[makeProject()]}
          editingNoteId="N1"
        />,
      );
      fireEvent.click(screen.getByTestId('note-editor-delete'));
      expect(onDelete).toHaveBeenCalled();
    });

    it('archive button calls onArchive', () => {
      const onArchive = vi.fn();
      const note = makeNote();
      render(
        <NoteEditor
          mode="edit"
          draft={noteToDraft(note)}
          onChange={() => undefined}
          onSubmit={() => undefined}
          onCancel={() => undefined}
          onDelete={() => undefined}
          onArchive={onArchive}
          projects={[makeProject()]}
          editingNoteId="N1"
        />,
      );
      fireEvent.click(screen.getByTestId('note-editor-archive'));
      expect(onArchive).toHaveBeenCalled();
    });
  });

  describe('edit/preview tab', () => {
    it('default tab is edit', () => {
      render(
        <NoteEditor
          mode="create"
          draft={EMPTY_NOTE_DRAFT}
          onChange={() => undefined}
          onSubmit={() => undefined}
          onCancel={() => undefined}
          projects={[]}
        />,
      );
      expect(screen.getByTestId('note-editor-content')).toBeInTheDocument();
      expect(screen.queryByTestId('note-editor-preview')).toBeNull();
    });

    it('clicking preview tab shows preview pane with rendered markdown', () => {
      const draft: NoteDraft = {
        ...EMPTY_NOTE_DRAFT,
        title: 't',
        content: '# Heading\n\n- a\n- b',
      };
      render(
        <NoteEditor
          mode="create"
          draft={draft}
          onChange={() => undefined}
          onSubmit={() => undefined}
          onCancel={() => undefined}
          projects={[]}
        />,
      );
      fireEvent.click(screen.getByTestId('note-editor-view-preview'));
      const preview = screen.getByTestId('note-editor-preview');
      expect(preview).toBeInTheDocument();
      expect(preview.querySelector('h1')?.textContent).toBe('Heading');
    });

    it('preview shows "（还没有内容）" when content is empty', () => {
      render(
        <NoteEditor
          mode="create"
          draft={EMPTY_NOTE_DRAFT}
          onChange={() => undefined}
          onSubmit={() => undefined}
          onCancel={() => undefined}
          projects={[]}
        />,
      );
      fireEvent.click(screen.getByTestId('note-editor-view-preview'));
      const preview = screen.getByTestId('note-editor-preview');
      expect(preview.textContent).toContain('还没有内容');
    });
  });

  describe('error display', () => {
    it('renders error message when error prop is set', () => {
      render(
        <NoteEditor
          mode="create"
          draft={EMPTY_NOTE_DRAFT}
          onChange={() => undefined}
          onSubmit={() => undefined}
          onCancel={() => undefined}
          projects={[]}
          error="VALIDATION_FAILED: title too long"
        />,
      );
      const err = screen.getByTestId('note-editor-error');
      expect(err).toBeInTheDocument();
      expect(err.textContent).toContain('title too long');
    });
  });
});
