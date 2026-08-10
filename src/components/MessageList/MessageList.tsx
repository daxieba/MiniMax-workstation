/**
 * 消息列表组件（T3-3）
 *
 * 渲染多轮对话：
 *   - user 消息：右对齐，accent 色
 *   - assistant 消息：左对齐，base 色
 *   - system 消息：居中，secondary 色（一般由 store 决定什么时候插入）
 *   - streaming 占位：当 assistant 消息 `streaming=true` 且 content 为空时显示加载点
 *
 * **不**调 store（受控：messages + loading）。
 * **不**做编辑 / 删除（chat 不可改写历史；删除走 store.clearMessages）。
 *
 * 数据来源：`store.aiStore.messages`（`ChatMessageWithMeta[]`）。
 */

import { Bot, User } from 'lucide-react';

import type { ChatMessageWithMeta } from '@/store/aiStore';

export interface MessageListProps {
  messages: ReadonlyArray<ChatMessageWithMeta>;
  loading: boolean;
}

/** 单条角色元信息（图标 + 名字 + 颜色）。 */
const ROLE_META: Record<
  ChatMessageWithMeta['role'],
  { label: string; Icon: typeof Bot; align: 'left' | 'right'; bubbleClass: string }
> = {
  user: {
    label: '你',
    Icon: User,
    align: 'right',
    bubbleClass: 'bg-accent-soft text-accent border border-accent/30',
  },
  assistant: {
    label: 'AI',
    Icon: Bot,
    align: 'left',
    bubbleClass: 'bg-elevated text-primary border border-line',
  },
  system: {
    label: '系统',
    Icon: Bot,
    align: 'left',
    bubbleClass: 'bg-base text-secondary border border-line/50',
  },
};

/**
 * 消息列表。
 */
export function MessageList({ messages, loading }: MessageListProps): React.ReactElement {
  if (messages.length === 0) {
    return (
      <div
        data-testid="message-list-empty"
        className="flex h-full items-center justify-center text-sm text-secondary"
      >
        {loading ? '正在准备…' : '在下方输入框写点什么开始对话。'}
      </div>
    );
  }
  return (
    <div data-testid="message-list" className="flex h-full flex-col gap-2 overflow-auto p-3">
      {messages.map((m) => {
        const meta = ROLE_META[m.role];
        const Icon = meta.Icon;
        const isStreaming = m.streaming === true;
        const isPlaceholder = isStreaming && m.content.length === 0;
        return (
          <div
            key={m.id}
            data-testid={`message-${m.id}`}
            data-role={m.role}
            className={`flex items-start gap-2 ${meta.align === 'right' ? 'flex-row-reverse' : ''}`}
          >
            <div
              className={[
                'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border',
                meta.bubbleClass,
              ].join(' ')}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden="true" />
            </div>
            <div className={`flex max-w-[80%] flex-col ${meta.align === 'right' ? 'items-end' : ''}`}>
              <span className="mb-0.5 text-xs text-secondary">{meta.label}</span>
              <div
                data-testid={`message-bubble-${m.id}`}
                className={[
                  'whitespace-pre-wrap break-words rounded-md px-3 py-2 text-sm shadow-sm',
                  meta.bubbleClass,
                ].join(' ')}
              >
                {isPlaceholder ? (
                  <span data-testid="message-streaming-placeholder" className="inline-flex items-center gap-1">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current [animation-delay:0.15s]" />
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current [animation-delay:0.3s]" />
                  </span>
                ) : (
                  <span>{m.content}</span>
                )}
                {isStreaming && !isPlaceholder ? (
                  <span
                    data-testid="message-streaming-cursor"
                    className="ml-0.5 inline-block h-3 w-1.5 animate-pulse bg-current align-middle"
                  />
                ) : null}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
