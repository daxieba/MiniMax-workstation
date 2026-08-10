/**
 * AIChat 组件测试（T3-3）
 *
 * 覆盖：
 *   - 渲染消息列表（空态 + 非空态）
 *   - 输入 + 发送：触发 onSend 并清空 textarea
 *   - 加载中：发送按钮变为取消按钮
 *   - 取消按钮触发 onCancel
 *   - 流式累积：外部传新的 messages 时正确渲染
 */

import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { AIChat } from '@/components/AIChat/AIChat';
import type { ChatMessageWithMeta } from '@/store/aiStore';

describe('AIChat', () => {
  it('renders empty state when no messages', () => {
    render(
      <AIChat
        messages={[]}
        loading={false}
        onSend={() => undefined}
      />,
    );
    expect(screen.getByTestId('message-list-empty')).toBeInTheDocument();
  });

  it('renders a user message', () => {
    const messages: ChatMessageWithMeta[] = [
      { id: 'm1', role: 'user', content: 'hello', createdAt: 1700000000000 },
    ];
    render(<AIChat messages={messages} loading={false} onSend={() => undefined} />);
    expect(screen.getByTestId('message-bubble-m1').textContent).toContain('hello');
  });

  it('sends message and clears textarea on click', () => {
    const onSend = vi.fn();
    render(<AIChat messages={[]} loading={false} onSend={onSend} />);
    const textarea = screen.getByTestId('message-input-textarea');
    fireEvent.change(textarea, { target: { value: 'hi there' } });
    fireEvent.click(screen.getByTestId('message-input-send'));
    expect(onSend).toHaveBeenCalledWith('hi there');
    // textarea 清空
    expect((textarea as HTMLTextAreaElement).value).toBe('');
  });

  it('disables send button when textarea is empty', () => {
    render(<AIChat messages={[]} loading={false} onSend={() => undefined} />);
    expect(screen.getByTestId('message-input-send')).toBeDisabled();
  });

  it('trims whitespace before sending (empty trim is a no-op)', () => {
    const onSend = vi.fn();
    render(<AIChat messages={[]} loading={false} onSend={onSend} />);
    const textarea = screen.getByTestId('message-input-textarea');
    fireEvent.change(textarea, { target: { value: '   ' } });
    fireEvent.click(screen.getByTestId('message-input-send'));
    // 不调 onSend（empty trim → 跳过）
    expect(onSend).not.toHaveBeenCalled();
  });

  it('shows cancel button instead of send when loading=true', () => {
    const onCancel = vi.fn();
    render(
      <AIChat
        messages={[{ id: 'm1', role: 'user', content: 'hi', createdAt: 0 }]}
        loading={true}
        onSend={() => undefined}
        onCancel={onCancel}
      />,
    );
    expect(screen.getByTestId('message-input-cancel')).toBeInTheDocument();
    expect(screen.queryByTestId('message-input-send')).toBeNull();
    fireEvent.click(screen.getByTestId('message-input-cancel'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('supports Enter to send (without shift)', () => {
    const onSend = vi.fn();
    render(<AIChat messages={[]} loading={false} onSend={onSend} />);
    const textarea = screen.getByTestId('message-input-textarea');
    fireEvent.change(textarea, { target: { value: 'go' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
    expect(onSend).toHaveBeenCalledWith('go');
  });

  it('Shift+Enter inserts a newline (no send)', () => {
    const onSend = vi.fn();
    render(<AIChat messages={[]} loading={false} onSend={onSend} />);
    const textarea = screen.getByTestId('message-input-textarea');
    fireEvent.change(textarea, { target: { value: 'go' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();
  });

  it('renders streaming assistant message with cursor', () => {
    const messages: ChatMessageWithMeta[] = [
      { id: 'u1', role: 'user', content: 'q', createdAt: 0 },
      { id: 'a1', role: 'assistant', content: 'partial', streaming: true, createdAt: 0 },
    ];
    render(<AIChat messages={messages} loading={true} onSend={() => undefined} />);
    expect(screen.getByTestId('message-bubble-a1').textContent).toContain('partial');
    expect(screen.getByTestId('message-streaming-cursor')).toBeInTheDocument();
  });

  it('disables textarea when disabled=true', () => {
    render(<AIChat messages={[]} loading={false} disabled={true} onSend={() => undefined} />);
    expect(screen.getByTestId('message-input-textarea')).toBeDisabled();
  });
});
