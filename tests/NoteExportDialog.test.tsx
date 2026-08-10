/**
 * NoteExportDialog 组件测试（T4-3）
 *
 * 覆盖：
 *   - 渲染笔记列表 + checkbox
 *   - 默认全选
 *   - 切换单个选中
 *   - 全选/全不选 toggle
 *   - 浏览按钮 → 调 pickDirectory + input 填入
 *   - "开始导出" → 调 onExport(ids, dir)
 *   - 取消 → 调 onClose
 *   - 空列表 → 空态
 *   - 0 选中时 disable submit
 */

import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { NoteExportDialog } from '@/components/NoteExportDialog/NoteExportDialog';
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

describe('NoteExportDialog (basic)', () => {
  it('renders dialog with title + close button', () => {
    render(
      <NoteExportDialog
        notes={[makeNote()]}
        onClose={() => undefined}
        onExport={async () => undefined}
        pickDirectory={async () => null}
      />,
    );
    expect(screen.getByTestId('note-export-dialog')).toBeInTheDocument();
    expect(screen.getByTestId('note-export-dialog-close')).toBeInTheDocument();
  });

  it('shows empty state when no notes', () => {
    render(
      <NoteExportDialog
        notes={[]}
        onClose={() => undefined}
        onExport={async () => undefined}
        pickDirectory={async () => null}
      />,
    );
    expect(screen.getByTestId('note-export-dialog-empty')).toBeInTheDocument();
  });

  it('disables submit when no notes selected', () => {
    const notes = [makeNote({ id: 'N1', title: 'A' })];
    render(
      <NoteExportDialog
        notes={notes}
        defaultAllSelected={false}
        onClose={() => undefined}
        onExport={async () => undefined}
        pickDirectory={async () => null}
      />,
    );
    expect(screen.getByTestId('note-export-dialog-submit')).toBeDisabled();
  });
});

describe('NoteExportDialog (selection)', () => {
  it('default selects all when defaultAllSelected=true', () => {
    const notes = [makeNote({ id: 'N1', title: 'A' }), makeNote({ id: 'N2', title: 'B' })];
    render(
      <NoteExportDialog
        notes={notes}
        defaultAllSelected
        onClose={() => undefined}
        onExport={async () => undefined}
        pickDirectory={async () => null}
      />,
    );
    const c1 = screen.getByTestId('note-export-dialog-checkbox-N1') as HTMLInputElement;
    const c2 = screen.getByTestId('note-export-dialog-checkbox-N2') as HTMLInputElement;
    expect(c1.checked).toBe(true);
    expect(c2.checked).toBe(true);
  });

  it('toggling individual checkbox updates state', () => {
    const notes = [makeNote({ id: 'N1', title: 'A' }), makeNote({ id: 'N2', title: 'B' })];
    render(
      <NoteExportDialog
        notes={notes}
        defaultAllSelected
        onClose={() => undefined}
        onExport={async () => undefined}
        pickDirectory={async () => null}
      />,
    );
    const c1 = screen.getByTestId('note-export-dialog-checkbox-N1') as HTMLInputElement;
    fireEvent.click(c1);
    expect(c1.checked).toBe(false);
    expect(screen.getByTestId('note-export-dialog-selected').textContent).toBe('1');
  });

  it('toggle-all button deselects when all are selected, selects when none', () => {
    const notes = [makeNote({ id: 'N1' }), makeNote({ id: 'N2' })];
    render(
      <NoteExportDialog
        notes={notes}
        defaultAllSelected
        onClose={() => undefined}
        onExport={async () => undefined}
        pickDirectory={async () => null}
      />,
    );
    const toggleBtn = screen.getByTestId('note-export-dialog-toggle-all');
    expect(toggleBtn.textContent).toBe('全不选');
    fireEvent.click(toggleBtn);
    expect((screen.getByTestId('note-export-dialog-checkbox-N1') as HTMLInputElement).checked).toBe(
      false,
    );
    expect((screen.getByTestId('note-export-dialog-checkbox-N2') as HTMLInputElement).checked).toBe(
      false,
    );
    expect(toggleBtn.textContent).toBe('全选');
    fireEvent.click(toggleBtn);
    expect((screen.getByTestId('note-export-dialog-checkbox-N1') as HTMLInputElement).checked).toBe(
      true,
    );
    expect((screen.getByTestId('note-export-dialog-checkbox-N2') as HTMLInputElement).checked).toBe(
      true,
    );
  });
});

describe('NoteExportDialog (directory pick)', () => {
  it('"浏览" button calls pickDirectory and fills input', async () => {
    const pickDirectory = vi.fn().mockResolvedValue('D:\\Export');
    render(
      <NoteExportDialog
        notes={[makeNote()]}
        onClose={() => undefined}
        onExport={async () => undefined}
        pickDirectory={pickDirectory}
      />,
    );
    fireEvent.click(screen.getByTestId('note-export-dialog-browse'));
    await waitFor(() => {
      expect(pickDirectory).toHaveBeenCalled();
    });
    await waitFor(() => {
      const input = screen.getByTestId('note-export-dialog-dir') as HTMLInputElement;
      expect(input.value).toBe('D:\\Export');
    });
  });

  it('does NOT fill input when pickDirectory returns null', async () => {
    const pickDirectory = vi.fn().mockResolvedValue(null);
    render(
      <NoteExportDialog
        notes={[makeNote()]}
        onClose={() => undefined}
        onExport={async () => undefined}
        pickDirectory={pickDirectory}
      />,
    );
    fireEvent.click(screen.getByTestId('note-export-dialog-browse'));
    await waitFor(() => {
      expect(pickDirectory).toHaveBeenCalled();
    });
    const input = screen.getByTestId('note-export-dialog-dir') as HTMLInputElement;
    expect(input.value).toBe('');
  });

  it('disables submit when target dir is empty', () => {
    render(
      <NoteExportDialog
        notes={[makeNote()]}
        onClose={() => undefined}
        onExport={async () => undefined}
        pickDirectory={async () => null}
      />,
    );
    expect(screen.getByTestId('note-export-dialog-submit')).toBeDisabled();
  });

  it('allows manual input of target dir', () => {
    render(
      <NoteExportDialog
        notes={[makeNote()]}
        onClose={() => undefined}
        onExport={async () => undefined}
        pickDirectory={async () => null}
      />,
    );
    const input = screen.getByTestId('note-export-dialog-dir') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '/custom/path' } });
    expect(input.value).toBe('/custom/path');
  });
});

describe('NoteExportDialog (submit)', () => {
  it('clicking "开始导出" calls onExport with selected ids and target dir', async () => {
    const notes = [makeNote({ id: 'N1' }), makeNote({ id: 'N2' })];
    const onExport = vi.fn().mockResolvedValue(undefined);
    const pickDirectory = vi.fn().mockResolvedValue('D:\\Export');
    render(
      <NoteExportDialog
        notes={notes}
        defaultAllSelected
        onClose={() => undefined}
        onExport={onExport}
        pickDirectory={pickDirectory}
      />,
    );
    fireEvent.click(screen.getByTestId('note-export-dialog-browse'));
    await waitFor(() => {
      expect((screen.getByTestId('note-export-dialog-dir') as HTMLInputElement).value).toBe(
        'D:\\Export',
      );
    });
    fireEvent.click(screen.getByTestId('note-export-dialog-submit'));
    await waitFor(() => {
      expect(onExport).toHaveBeenCalled();
    });
    const [ids, dir] = onExport.mock.calls[0]!;
    expect(ids.sort()).toEqual(['N1', 'N2'].sort());
    expect(dir).toBe('D:\\Export');
  });

  it('does not call onExport when target dir is empty', () => {
    const onExport = vi.fn().mockResolvedValue(undefined);
    render(
      <NoteExportDialog
        notes={[makeNote()]}
        defaultAllSelected
        onClose={() => undefined}
        onExport={onExport}
        pickDirectory={async () => null}
      />,
    );
    fireEvent.click(screen.getByTestId('note-export-dialog-submit'));
    expect(onExport).not.toHaveBeenCalled();
  });
});

describe('NoteExportDialog (close)', () => {
  it('clicking 取消 calls onClose', () => {
    const onClose = vi.fn();
    render(
      <NoteExportDialog
        notes={[makeNote()]}
        onClose={onClose}
        onExport={async () => undefined}
        pickDirectory={async () => null}
      />,
    );
    fireEvent.click(screen.getByTestId('note-export-dialog-cancel'));
    expect(onClose).toHaveBeenCalled();
  });

  it('clicking close button calls onClose', () => {
    const onClose = vi.fn();
    render(
      <NoteExportDialog
        notes={[makeNote()]}
        onClose={onClose}
        onExport={async () => undefined}
        pickDirectory={async () => null}
      />,
    );
    fireEvent.click(screen.getByTestId('note-export-dialog-close'));
    expect(onClose).toHaveBeenCalled();
  });

  it('disables close button when exporting=true', () => {
    render(
      <NoteExportDialog
        notes={[makeNote()]}
        exporting
        onClose={() => undefined}
        onExport={async () => undefined}
        pickDirectory={async () => null}
      />,
    );
    expect(screen.getByTestId('note-export-dialog-close')).toBeDisabled();
    expect(screen.getByTestId('note-export-dialog-cancel')).toBeDisabled();
  });
});
