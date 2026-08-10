/**
 * InboxList 组件测试（T2-2）
 *
 * 覆盖：
 *   - 空态：根据 filter 显示对应文案
 *   - 列表渲染：每条调 InboxItem
 *   - 操作按钮转发：archive / convert 回调正确
 *   - 转换前确认：window.confirm 返回 true → 调 onConvert；返回 false → 不调
 */

import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { InboxList } from '@/components/InboxList/InboxList';
import type { InboxItem as InboxItemData } from '@shared/types/inbox';

function makeItem(overrides: Partial<InboxItemData> = {}): InboxItemData {
  return {
    id: '01HXYZABCDE_' + Math.random().toString(36).slice(2, 8),
    content: 'sample content',
    kind: 'note',
    source: 'manual',
    status: 'active',
    convertedTo: null,
    projectId: null,
    tags: [],
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    deletedAt: null,
    ...overrides,
  };
}

describe('InboxList', () => {
  describe('empty state', () => {
    it('shows "active" empty text when filter=active and items=[]', () => {
      render(<InboxList items={[]} filter="active" onArchive={() => undefined} onConvert={() => undefined} />);
      const empty = screen.getByTestId('inbox-list-empty');
      expect(empty).toBeInTheDocument();
      expect(empty.textContent).toContain('没有待处理的收集项');
    });

    it('shows "archived" empty text when filter=archived', () => {
      render(<InboxList items={[]} filter="archived" onArchive={() => undefined} onConvert={() => undefined} />);
      expect(screen.getByTestId('inbox-list-empty').textContent).toContain('还没有归档');
    });

    it('shows "all" empty text when filter=all', () => {
      render(<InboxList items={[]} filter="all" onArchive={() => undefined} onConvert={() => undefined} />);
      expect(screen.getByTestId('inbox-list-empty').textContent).toContain('还没有任何收集项');
    });
  });

  describe('non-empty state', () => {
    const items: InboxItemData[] = [
      makeItem({ id: '01AAA', content: 'first note' }),
      makeItem({ id: '01BBB', content: 'second todo', kind: 'todo' }),
    ];

    it('renders each item with its own testid', () => {
      render(<InboxList items={items} filter="active" onArchive={() => undefined} onConvert={() => undefined} />);
      expect(screen.getByTestId('inbox-list')).toBeInTheDocument();
      expect(screen.getByTestId('inbox-item-01AAA')).toBeInTheDocument();
      expect(screen.getByTestId('inbox-item-01BBB')).toBeInTheDocument();
    });

    it('archive button propagates item id', () => {
      const onArchive = vi.fn();
      render(<InboxList items={items} filter="active" onArchive={onArchive} onConvert={() => undefined} />);
      fireEvent.click(screen.getByTestId('inbox-item-archive-01AAA'));
      expect(onArchive).toHaveBeenCalledWith('01AAA');
    });

    describe('convert button + confirmation', () => {
      let confirmSpy: { mockReturnValue: (v: boolean) => unknown; mockRestore: () => void; mock: { calls: unknown[][] } };

      beforeEach(() => {
        // vi.spyOn on window.confirm returns a complex union; cast to a small surface for the assertions.
        const spy = vi.spyOn(window, 'confirm') as unknown as {
          mockReturnValue: (v: boolean) => unknown;
          mockRestore: () => void;
          mock: { calls: unknown[][] };
        };
        confirmSpy = spy;
      });
      afterEach(() => {
        confirmSpy.mockRestore();
      });

      it('does NOT call onConvert when user cancels confirm', () => {
        confirmSpy.mockReturnValue(false);
        const onConvert = vi.fn();
        render(<InboxList items={items} filter="active" onArchive={() => undefined} onConvert={onConvert} />);
        fireEvent.click(screen.getByTestId('inbox-item-convert-01AAA'));
        expect(confirmSpy.mock.calls).toHaveLength(1);
        expect(onConvert).not.toHaveBeenCalled();
      });

      it('calls onConvert when user confirms', () => {
        confirmSpy.mockReturnValue(true);
        const onConvert = vi.fn();
        render(<InboxList items={items} filter="active" onArchive={() => undefined} onConvert={onConvert} />);
        fireEvent.click(screen.getByTestId('inbox-item-convert-01BBB'));
        expect(confirmSpy.mock.calls).toHaveLength(1);
        expect(onConvert).toHaveBeenCalledWith('01BBB');
      });

      it('confirm message includes item content (truncated)', () => {
        confirmSpy.mockReturnValue(true);
        const longItem = makeItem({ id: '01LONG', content: 'x'.repeat(200) });
        render(
          <InboxList items={[longItem]} filter="active" onArchive={() => undefined} onConvert={() => vi.fn()} />,
        );
        fireEvent.click(screen.getByTestId('inbox-item-convert-01LONG'));
        const callArg = String(confirmSpy.mock.calls[0]?.[0] ?? '');
        expect(callArg).toContain('…');
      });
    });
  });
});
