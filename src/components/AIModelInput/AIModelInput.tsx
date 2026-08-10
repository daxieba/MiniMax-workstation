/**
 * AI Model 输入（T3-3）
 *
 * 一个简单受控的 model 输入框 + 保存按钮。
 *
 * **不**与 provider 选择耦合 —— 用作通用输入组件（spec 列了独立文件，
 * 方便 T4-x 复用或单测）。
 *
 * **不做**：
 *   - 不读 store（受控：value + onChange + onSave）
 *   - 不自动保存（用户点 "保存" 才触发）
 */

import { Save } from 'lucide-react';

export interface AIModelInputProps {
  value: string;
  placeholder?: string;
  disabled?: boolean;
  onChange: (model: string) => void;
  onSave: () => void;
}

/**
 * AI Model 输入组件。
 */
export function AIModelInput({
  value,
  placeholder,
  disabled,
  onChange,
  onSave,
}: AIModelInputProps): React.ReactElement {
  return (
    <div data-testid="ai-model-input-row" className="flex items-center gap-2">
      <label className="text-sm text-secondary">Model</label>
      <input
        data-testid="ai-model-input"
        type="text"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? ''}
        className="w-56 rounded-md border border-line bg-base px-2 py-1 text-sm text-primary disabled:opacity-50"
      />
      <button
        type="button"
        data-testid="ai-model-save"
        onClick={onSave}
        disabled={disabled}
        className="inline-flex items-center gap-1 rounded-md border border-line bg-base px-2 py-1 text-xs text-secondary transition-colors hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Save className="h-3 w-3" aria-hidden="true" />
        保存
      </button>
    </div>
  );
}
