/**
 * AIPendingConfirm 组件测试（T3-3）
 *
 * 覆盖：
 *   - pending 状态显示"待确认" + 确认/丢弃按钮
 *   - confirmed 状态显示"已确认"，按钮 disabled
 *   - dismissed 状态显示"已丢弃"，按钮 disabled
 *   - 按钮点击调 onConfirm / onDismiss
 *   - content 渲染
 *   - 源输入显示
 */

import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { AIPendingConfirm } from '@/components/AIPendingConfirm/AIPendingConfirm';
import type { PendingResult } from '@/store/aiStore';

function makePending(overrides: Partial<PendingResult> = {}): PendingResult {
  return {
    id: 'p1',
    action: 'summarize',
    content: 'summary text',
    createdAt: 1700000000000,
    status: 'pending',
    streaming: false,
    sourceInput: 'original input',
    ...overrides,
  };
}

describe('AIPendingConfirm', () => {
  it('renders pending state with action and content', () => {
    const item = makePending();
    render(<AIPendingConfirm item={item} onConfirm={() => undefined} onDismiss={() => undefined} />);
    const root = screen.getByTestId('ai-pending-p1');
    expect(root.getAttribute('data-status')).toBe('pending');
    expect(screen.getByTestId('ai-pending-action-p1').textContent).toContain('总结');
    expect(screen.getByTestId('ai-pending-content-p1').textContent).toContain('summary text');
    expect(screen.getByTestId('ai-pending-status-p1').textContent).toContain('待确认');
  });

  it('shows confirm and dismiss buttons when status=pending', () => {
    const item = makePending();
    render(<AIPendingConfirm item={item} onConfirm={() => undefined} onDismiss={() => undefined} />);
    expect(screen.getByTestId('ai-pending-confirm-p1')).toBeInTheDocument();
    expect(screen.getByTestId('ai-pending-dismiss-p1')).toBeInTheDocument();
  });

  it('calls onConfirm with id when confirm button clicked', () => {
    const item = makePending();
    const onConfirm = vi.fn();
    render(<AIPendingConfirm item={item} onConfirm={onConfirm} onDismiss={() => undefined} />);
    fireEvent.click(screen.getByTestId('ai-pending-confirm-p1'));
    expect(onConfirm).toHaveBeenCalledWith('p1');
  });

  it('calls onDismiss with id when dismiss button clicked', () => {
    const item = makePending();
    const onDismiss = vi.fn();
    render(<AIPendingConfirm item={item} onConfirm={() => undefined} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByTestId('ai-pending-dismiss-p1'));
    expect(onDismiss).toHaveBeenCalledWith('p1');
  });

  it('does NOT show action buttons when status=confirmed', () => {
    const item = makePending({ status: 'confirmed' });
    render(<AIPendingConfirm item={item} onConfirm={() => undefined} onDismiss={() => undefined} />);
    expect(screen.queryByTestId('ai-pending-confirm-p1')).toBeNull();
    expect(screen.queryByTestId('ai-pending-dismiss-p1')).toBeNull();
    expect(screen.getByTestId('ai-pending-status-p1').textContent).toContain('已确认');
  });

  it('does NOT show action buttons when status=dismissed', () => {
    const item = makePending({ status: 'dismissed' });
    render(<AIPendingConfirm item={item} onConfirm={() => undefined} onDismiss={() => undefined} />);
    expect(screen.queryByTestId('ai-pending-confirm-p1')).toBeNull();
    expect(screen.queryByTestId('ai-pending-dismiss-p1')).toBeNull();
    expect(screen.getByTestId('ai-pending-status-p1').textContent).toContain('已丢弃');
  });

  it('shows streaming badge when streaming=true', () => {
    const item = makePending({ streaming: true, content: 'partial' });
    render(<AIPendingConfirm item={item} onConfirm={() => undefined} onDismiss={() => undefined} />);
    expect(screen.getByTestId('ai-pending-streaming-p1')).toBeInTheDocument();
  });

  it('renders extract_tasks action label', () => {
    const item = makePending({ action: 'extract_tasks' });
    render(<AIPendingConfirm item={item} onConfirm={() => undefined} onDismiss={() => undefined} />);
    expect(screen.getByTestId('ai-pending-action-p1').textContent).toContain('提取任务');
  });

  it('renders rewrite action label', () => {
    const item = makePending({ action: 'rewrite' });
    render(<AIPendingConfirm item={item} onConfirm={() => undefined} onDismiss={() => undefined} />);
    expect(screen.getByTestId('ai-pending-action-p1').textContent).toContain('改写');
  });
});
