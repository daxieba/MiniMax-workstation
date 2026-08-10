/**
 * 消息输入框（T3-3）
 *
 * 多行 textarea + 发送按钮 + 取消按钮（loading 时显示）。
 *
 * 受控：value + onChange + onSend + onCancel。
 *
 * **不做**：
 *   - 不读 store
 *   - 不做自动 grow（保持固定行数 + 滚动）
 *   - 不做附件 / 图片（多模态留给后续版本）
 */

import { Loader2, Send, X } from 'lucide-react';

export interface MessageInputProps {
  value: string;
  loading: boolean;
  disabled?: boolean;
  placeholder?: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onCancel?: () => void;
}

/**
 * 消息输入框。
 */
export function MessageInput({
  value,
  loading,
  disabled,
  placeholder,
  onChange,
  onSend,
  onCancel,
}: MessageInputProps): React.ReactElement {
  const canSend = !disabled && !loading && value.trim().length > 0;
  return (
    <div
      data-testid="message-input"
      className="flex items-end gap-2 border-t border-line bg-elevated p-3"
    >
      <textarea
        data-testid="message-input-textarea"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? '输入消息…（Enter 发送 / Shift+Enter 换行）'}
        rows={2}
        disabled={disabled}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (canSend) onSend();
          }
        }}
        className="flex-1 resize-none rounded-md border border-line bg-base px-3 py-2 text-sm text-primary disabled:opacity-50"
      />
      {loading ? (
        <button
          type="button"
          data-testid="message-input-cancel"
          onClick={() => onCancel?.()}
          className="inline-flex items-center gap-1 rounded-md border border-line bg-base px-3 py-2 text-xs text-secondary transition-colors hover:text-danger"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
          取消
        </button>
      ) : (
        <button
          type="button"
          data-testid="message-input-send"
          onClick={() => onSend()}
          disabled={!canSend}
          className="inline-flex items-center gap-1 rounded-md border border-accent bg-accent-soft px-3 py-2 text-xs text-accent transition-colors hover:bg-accent hover:text-inverse disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <Send className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          发送
        </button>
      )}
    </div>
  );
}
