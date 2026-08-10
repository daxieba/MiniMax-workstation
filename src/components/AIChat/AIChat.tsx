/**
 * 多轮对话组件（T3-3）
 *
 * 把 `MessageList` + `MessageInput` + 简单的本地 input state 组合到一起。
 *
 * **不**直接调 store —— 通过 `onSend` prop 把消息交给父组件 / store 处理。
 * 这样组件本身**不**依赖 zustand，方便单测。
 *
 * **不做**：
 *   - 不读 store
 *   - 不内联编辑历史消息
 */

import { useState } from 'react';

import { MessageInput, type MessageInputProps } from '@/components/MessageInput/MessageInput';
import { MessageList, type MessageListProps } from '@/components/MessageList/MessageList';
import type { ChatMessageWithMeta } from '@/store/aiStore';

export interface AIChatProps {
  messages: ReadonlyArray<ChatMessageWithMeta>;
  loading: boolean;
  disabled?: boolean;
  placeholder?: string;
  onSend: (content: string) => void;
  onCancel?: () => void;
}

/**
 * 多轮对话组件。
 */
export function AIChat({
  messages,
  loading,
  disabled,
  placeholder,
  onSend,
  onCancel,
}: AIChatProps): React.ReactElement {
  const [value, setValue] = useState('');

  const listProps: MessageListProps = { messages, loading };
  const inputProps: MessageInputProps = {
    value,
    loading,
    ...(placeholder !== undefined ? { placeholder } : {}),
    ...(disabled !== undefined ? { disabled } : {}),
    onChange: setValue,
    onSend: () => {
      const v = value.trim();
      if (v.length === 0) return;
      onSend(v);
      setValue('');
    },
    ...(onCancel !== undefined ? { onCancel } : {}),
  };

  return (
    <div data-testid="ai-chat" className="flex h-full flex-col">
      <div className="flex-1 overflow-hidden">
        <MessageList {...listProps} />
      </div>
      <MessageInput {...inputProps} />
    </div>
  );
}
