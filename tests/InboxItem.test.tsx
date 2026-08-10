/**
 * InboxItem 组件测试（T2-2）
 *
 * 覆盖：
 *   - 渲染 content + kind label + 时间
 *   - 归档按钮可点 / 在已归档 / 已转换时 disabled
 *   - 转任务按钮在已转换时 disabled
 *   - 点击按钮触发对应回调（带正确 id）
 *   - 已转换时显示 convertedTo 标签
 */

import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { InboxItem } from '@/components/InboxItem/InboxItem';
import type { InboxItem as InboxItemData } from '@shared/types/inbox';

function makeItem(overrides: Partial<InboxItemData> = {}): InboxItemData {
  return {
    id: '01HXYZABCDEF',
    content: 'a sample note',
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

describe('InboxItem', () => {
  it('renders content and kind label', () => {
    render(<InboxItem item={makeItem({ kind: 'todo' })} onArchive={() => undefined} onConvert={() => undefined} />);
    expect(screen.getByTestId('inbox-item-content-01HXYZABCDEF')).toHaveTextContent('a sample note');
    expect(screen.getByText('待办')).toBeInTheDocument();
  });

  it('shows "已转任务" line when status=converted', () => {
    const item = makeItem({ status: 'converted', convertedTo: 'task:01HXYZABCDEFTASK' });
    render(<InboxItem item={item} onArchive={() => undefined} onConvert={() => undefined} />);
    expect(screen.getByTestId('inbox-item-converted-01HXYZABCDEF')).toHaveTextContent('task:01HXYZABCDEFTASK');
  });

  it('shows "已归档" line when status=archived', () => {
    const item = makeItem({ status: 'archived' });
    render(<InboxItem item={item} onArchive={() => undefined} onConvert={() => undefined} />);
    expect(screen.getByText('已归档')).toBeInTheDocument();
  });

  it('calls onArchive with item id when archive button clicked', () => {
    const onArchive = vi.fn();
    render(<InboxItem item={makeItem()} onArchive={onArchive} onConvert={() => undefined} />);
    fireEvent.click(screen.getByTestId('inbox-item-archive-01HXYZABCDEF'));
    expect(onArchive).toHaveBeenCalledWith('01HXYZABCDEF');
  });

  it('calls onConvert with item id when convert button clicked', () => {
    const onConvert = vi.fn();
    render(<InboxItem item={makeItem()} onArchive={() => undefined} onConvert={onConvert} />);
    fireEvent.click(screen.getByTestId('inbox-item-convert-01HXYZABCDEF'));
    expect(onConvert).toHaveBeenCalledWith('01HXYZABCDEF');
  });

  it('disables archive button when status=archived or status=converted', () => {
    const { rerender } = render(
      <InboxItem item={makeItem({ status: 'archived' })} onArchive={() => undefined} onConvert={() => undefined} />,
    );
    expect(screen.getByTestId('inbox-item-archive-01HXYZABCDEF')).toBeDisabled();

    rerender(
      <InboxItem
        item={makeItem({ status: 'converted', convertedTo: 'task:abc' })}
        onArchive={() => undefined}
        onConvert={() => undefined}
      />,
    );
    expect(screen.getByTestId('inbox-item-archive-01HXYZABCDEF')).toBeDisabled();
  });

  it('disables convert button when status=converted', () => {
    render(
      <InboxItem
        item={makeItem({ status: 'converted', convertedTo: 'task:abc' })}
        onArchive={() => undefined}
        onConvert={() => undefined}
      />,
    );
    expect(screen.getByTestId('inbox-item-convert-01HXYZABCDEF')).toBeDisabled();
  });

  it('renders different kind labels (note/todo/file/link)', () => {
    const kinds: Array<InboxItemData['kind']> = ['note', 'todo', 'file', 'link'];
    const labels = ['想法', '待办', '文件', '链接'];
    kinds.forEach((k, i) => {
      const { unmount } = render(
        <InboxItem item={makeItem({ kind: k })} onArchive={() => undefined} onConvert={() => undefined} />,
      );
      expect(screen.getByText(labels[i] as string)).toBeInTheDocument();
      unmount();
    });
  });
});
