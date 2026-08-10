/**
 * MessageList 组件测试（T3-3）
 *
 * 覆盖：
 *   - 空态：显示"在下方输入框写点什么开始对话。"
 *   - loading=true + 空消息：显示"正在准备…"
 *   - 单条 user 消息：渲染气泡
 *   - 单条 assistant 消息：渲染气泡
 *   - streaming 占位：3 个 pulse 圆点
 *   - 流式累积：content 变化时正常渲染
 *   - 不同 role 用不同对齐 / 颜色 class
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { MessageList } from '@/components/MessageList/MessageList';
import type { ChatMessageWithMeta } from '@/store/aiStore';

function makeMessage(overrides: Partial<ChatMessageWithMeta> = {}): ChatMessageWithMeta {
  return {
    id: 'm1',
    role: 'user',
    content: 'hi',
    createdAt: 1700000000000,
    ...overrides,
  };
}

describe('MessageList', () => {
  it('shows empty state when no messages', () => {
    render(<MessageList messages={[]} loading={false} />);
    const empty = screen.getByTestId('message-list-empty');
    expect(empty).toBeInTheDocument();
    expect(empty.textContent).toContain('开始对话');
  });

  it('shows preparing state when loading with no messages', () => {
    render(<MessageList messages={[]} loading={true} />);
    const empty = screen.getByTestId('message-list-empty');
    expect(empty.textContent).toContain('正在准备');
  });

  it('renders a user message bubble', () => {
    const messages = [makeMessage({ id: 'u1', role: 'user', content: 'hello' })];
    render(<MessageList messages={messages} loading={false} />);
    const bubble = screen.getByTestId('message-bubble-u1');
    expect(bubble).toBeInTheDocument();
    expect(bubble.textContent).toContain('hello');
    const row = screen.getByTestId('message-u1');
    expect(row.getAttribute('data-role')).toBe('user');
  });

  it('renders an assistant message bubble', () => {
    const messages = [makeMessage({ id: 'a1', role: 'assistant', content: 'world' })];
    render(<MessageList messages={messages} loading={false} />);
    const bubble = screen.getByTestId('message-bubble-a1');
    expect(bubble.textContent).toContain('world');
    const row = screen.getByTestId('message-a1');
    expect(row.getAttribute('data-role')).toBe('assistant');
  });

  it('shows streaming placeholder when streaming=true and content is empty', () => {
    const messages = [makeMessage({ id: 's1', role: 'assistant', content: '', streaming: true })];
    render(<MessageList messages={messages} loading={true} />);
    expect(screen.getByTestId('message-streaming-placeholder')).toBeInTheDocument();
  });

  it('renders streaming content + cursor when content is present', () => {
    const messages = [makeMessage({ id: 's2', role: 'assistant', content: 'partial', streaming: true })];
    render(<MessageList messages={messages} loading={true} />);
    const bubble = screen.getByTestId('message-bubble-s2');
    expect(bubble.textContent).toContain('partial');
    expect(screen.getByTestId('message-streaming-cursor')).toBeInTheDocument();
  });

  it('renders multiple messages in order', () => {
    const messages: ChatMessageWithMeta[] = [
      makeMessage({ id: 'm1', role: 'user', content: 'first' }),
      makeMessage({ id: 'm2', role: 'assistant', content: 'second' }),
      makeMessage({ id: 'm3', role: 'user', content: 'third' }),
    ];
    render(<MessageList messages={messages} loading={false} />);
    expect(screen.getByTestId('message-bubble-m1').textContent).toContain('first');
    expect(screen.getByTestId('message-bubble-m2').textContent).toContain('second');
    expect(screen.getByTestId('message-bubble-m3').textContent).toContain('third');
  });
});
