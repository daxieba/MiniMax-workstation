/**
 * EmptyState 通用组件测试（v0.1.1）
 *
 * 覆盖：
 *   - 默认渲染：图标 + 标题 + 描述 + CTA
 *   - 没传 onAction 时 CTA 不渲染（仅显示文案）
 *   - data-testid 可覆盖
 *   - 副 CTA + children slot
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { FolderOpen, Inbox } from 'lucide-react';

import { EmptyState } from '@/components/EmptyState/EmptyState';

describe('EmptyState', () => {
  it('renders title + description + CTA when all props given', () => {
    const onAction = vi.fn();
    render(
      <EmptyState
        title="收件箱是空的"
        description="随手记点什么"
        actionLabel="录入第一条"
        onAction={onAction}
      />,
    );
    const empty = screen.getByTestId('empty-state');
    expect(empty.textContent).toContain('收件箱是空的');
    expect(empty.textContent).toContain('随手记点什么');
    const cta = screen.getByTestId('empty-state-action');
    expect(cta.textContent).toBe('录入第一条');
    fireEvent.click(cta);
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('uses default Inbox icon when icon prop not given', () => {
    render(<EmptyState title="x" />);
    // lucide Inbox 会渲染成 svg with class "lucide-inbox"
    const svg = document.querySelector('svg.lucide-inbox');
    expect(svg).toBeInTheDocument();
  });

  it('uses custom icon when icon prop given', () => {
    render(<EmptyState title="x" icon={FolderOpen} />);
    const svg = document.querySelector('svg.lucide-folder-open');
    expect(svg).toBeInTheDocument();
  });

  it('without actionLabel → CTA button not rendered', () => {
    render(<EmptyState title="x" />);
    expect(screen.queryByTestId('empty-state-action')).not.toBeInTheDocument();
  });

  it('without onAction (actionLabel given) → CTA not rendered (still shows no button)', () => {
    render(<EmptyState title="x" actionLabel="不点" />);
    // actionLabel 有但 onAction 是 undefined → button 不渲染
    expect(screen.queryByTestId('empty-state-action')).not.toBeInTheDocument();
  });

  it('data-testid override works', () => {
    render(<EmptyState title="x" data-testid="custom-id" />);
    expect(screen.getByTestId('custom-id')).toBeInTheDocument();
    expect(screen.queryByTestId('empty-state')).not.toBeInTheDocument();
  });

  it('renders secondary CTA when both secondaryActionLabel and onSecondaryAction given', () => {
    const onSec = vi.fn();
    render(
      <EmptyState
        title="x"
        actionLabel="主"
        onAction={() => undefined}
        secondaryActionLabel="次"
        onSecondaryAction={onSec}
      />,
    );
    const sec = screen.getByTestId('empty-state-secondary-action');
    expect(sec.textContent).toBe('次');
    fireEvent.click(sec);
    expect(onSec).toHaveBeenCalledTimes(1);
  });

  it('renders children slot between description and CTA', () => {
    render(
      <EmptyState title="x" actionLabel="go" onAction={() => undefined}>
        <div data-testid="custom-slot">hello slot</div>
      </EmptyState>,
    );
    expect(screen.getByTestId('custom-slot')).toBeInTheDocument();
    // children 出现在 title 之后、CTA 之前
    const empty = screen.getByTestId('empty-state');
    const titleIdx = empty.textContent!.indexOf('x');
    const slotIdx = empty.textContent!.indexOf('hello slot');
    const ctaIdx = empty.textContent!.indexOf('go');
    expect(slotIdx).toBeGreaterThan(titleIdx);
    expect(ctaIdx).toBeGreaterThan(slotIdx);
  });

  it('icon does not need an explicit prop (Inbox default)', () => {
    // 默认 icon = Inbox —— 不传 icon prop 也应该能渲染
    const { container } = render(<EmptyState title="x" />);
    expect(container.querySelector('svg')).toBeInTheDocument();
  });
});

// 避免 unused import 警告
void Inbox;
