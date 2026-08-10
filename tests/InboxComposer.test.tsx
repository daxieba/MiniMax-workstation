/**
 * InboxComposer 组件测试（T2-2）
 *
 * 覆盖：
 *   - 初始渲染：textarea 空、kind 默认 'note'、4 个 kind 按钮
 *   - 输入文本：textarea onChange 触发 state 更新
 *   - 提交：空内容时按钮 disabled；填了内容后点提交触发 onSubmit + 清空 textarea
 *   - kind 切换：点击不同 kind 按钮 → onSubmit 携带对应 kind
 */

import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { InboxComposer } from '@/components/InboxComposer/InboxComposer';

describe('InboxComposer', () => {
  it('renders textarea + 4 kind buttons + submit button', () => {
    render(<InboxComposer onSubmit={() => undefined} />);
    const textarea = screen.getByTestId('inbox-composer-content');
    expect(textarea).toBeInTheDocument();
    expect(textarea).toHaveValue('');

    expect(screen.getByTestId('inbox-composer-kind-note')).toBeInTheDocument();
    expect(screen.getByTestId('inbox-composer-kind-todo')).toBeInTheDocument();
    expect(screen.getByTestId('inbox-composer-kind-file')).toBeInTheDocument();
    expect(screen.getByTestId('inbox-composer-kind-link')).toBeInTheDocument();

    const submit = screen.getByTestId('inbox-composer-submit');
    expect(submit).toBeInTheDocument();
    expect(submit).toBeDisabled();
  });

  it('disables submit when content is empty or whitespace-only', () => {
    render(<InboxComposer onSubmit={() => undefined} />);
    const textarea = screen.getByTestId('inbox-composer-content');
    const submit = screen.getByTestId('inbox-composer-submit');

    fireEvent.change(textarea, { target: { value: '   ' } });
    expect(submit).toBeDisabled();

    fireEvent.change(textarea, { target: { value: 'hello' } });
    expect(submit).toBeEnabled();
  });

  it('default kind is "note" and visually marked', () => {
    render(<InboxComposer onSubmit={() => undefined} />);
    const noteBtn = screen.getByTestId('inbox-composer-kind-note');
    expect(noteBtn).toHaveAttribute('aria-checked', 'true');
  });

  it('clicking a kind button updates selection', () => {
    render(<InboxComposer onSubmit={() => undefined} />);
    const todoBtn = screen.getByTestId('inbox-composer-kind-todo');
    fireEvent.click(todoBtn);
    expect(todoBtn).toHaveAttribute('aria-checked', 'true');
    const noteBtn = screen.getByTestId('inbox-composer-kind-note');
    expect(noteBtn).toHaveAttribute('aria-checked', 'false');
  });

  it('submitting calls onSubmit with trimmed content + selected kind, then clears textarea', () => {
    const onSubmit = vi.fn();
    render(<InboxComposer onSubmit={onSubmit} />);
    const textarea = screen.getByTestId('inbox-composer-content');
    const submit = screen.getByTestId('inbox-composer-submit');

    fireEvent.click(screen.getByTestId('inbox-composer-kind-todo'));
    fireEvent.change(textarea, { target: { value: '  buy milk  ' } });
    fireEvent.click(submit);

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith({ content: 'buy milk', kind: 'todo', projectId: null });

    // 提交后 textarea 应被清空
    expect(textarea).toHaveValue('');
  });

  it('submitting via form submit (Enter in textarea) also works', () => {
    const onSubmit = vi.fn();
    render(<InboxComposer onSubmit={onSubmit} />);
    const textarea = screen.getByTestId('inbox-composer-content');
    const form = textarea.closest('form');
    if (!form) throw new Error('form not found');

    fireEvent.change(textarea, { target: { value: 'x' } });
    fireEvent.submit(form);
    expect(onSubmit).toHaveBeenCalledWith({ content: 'x', kind: 'note', projectId: null });
  });

  it('disables textarea and submit when submitting=true', () => {
    render(<InboxComposer onSubmit={() => undefined} submitting />);
    const textarea = screen.getByTestId('inbox-composer-content');
    const submit = screen.getByTestId('inbox-composer-submit');
    expect(textarea).toBeDisabled();
    expect(submit).toBeDisabled();
  });
});
