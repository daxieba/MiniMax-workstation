/**
 * AI Provider 选择器 + Key 状态徽章 + 设置入口（T3-3）
 *
 * 顶部工具栏组件：
 *   - provider 下拉选择
 *   - model 输入框（受控）
 *   - test connection 按钮
 *   - key 状态徽章（"已配置" / "未配置"）
 *   - setKey 弹窗入口（点击 "未配置" 徽章或 "设置 Key" 按钮触发）
 *
 * 弹窗用一个简单的 inline 模式（`showSetKey`）展示 —— **不**引新依赖；
 * 用户填 key 后调 store.setKey(key) —— key 仅留在 React state + 一次 IPC 传输，组件 unmount 时丢。
 *
 * **不做**：
 *   - 不展示 key 内容（永远只显示掩码 `••••`）
 *   - 不在 props / 日志中打印 key
 */

import { useState } from 'react';
import { Check, KeyRound, Loader2, Plug, X } from 'lucide-react';

import type { ProviderId } from '@shared/types/ai';

export interface AIProviderPickerProps {
  providers: ReadonlyArray<{
    id: ProviderId;
    displayName: string;
    defaultModel: string;
    docsUrl?: string;
  }>;
  provider: ProviderId;
  model: string;
  hasKey: boolean;
  testing: boolean;
  onProviderChange: (provider: ProviderId) => void;
  onModelChange: (model: string) => void;
  onSaveModel: () => void;
  onTestConnection: () => void;
  onSetKey: (key: string) => void;
  onDeleteKey: () => void;
}

/**
 * AI Provider 选择器。
 *
 * 受控组件：所有状态由父组件 / store 提供。
 */
export function AIProviderPicker({
  providers,
  provider,
  model,
  hasKey,
  testing,
  onProviderChange,
  onModelChange,
  onSaveModel,
  onTestConnection,
  onSetKey,
  onDeleteKey,
}: AIProviderPickerProps): React.ReactElement {
  const [showKeyDialog, setShowKeyDialog] = useState(false);
  const [keyInput, setKeyInput] = useState('');
  const meta = providers.find((p) => p.id === provider);

  return (
    <div
      data-testid="ai-provider-picker"
      className="flex flex-wrap items-center gap-3 rounded-md border border-line bg-elevated p-3"
    >
      {/* provider 选择 */}
      <label className="flex items-center gap-2 text-sm text-secondary">
        <span>Provider</span>
        <select
          data-testid="ai-provider-select"
          value={provider}
          onChange={(e) => onProviderChange(e.target.value as ProviderId)}
          className="rounded-md border border-line bg-base px-2 py-1 text-sm text-primary"
        >
          {providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.displayName}
            </option>
          ))}
        </select>
      </label>

      {/* model 输入 */}
      <label className="flex items-center gap-2 text-sm text-secondary">
        <span>Model</span>
        <input
          data-testid="ai-model-input"
          type="text"
          value={model}
          onChange={(e) => onModelChange(e.target.value)}
          placeholder={meta?.defaultModel ?? ''}
          className="w-56 rounded-md border border-line bg-base px-2 py-1 text-sm text-primary"
        />
        <button
          type="button"
          data-testid="ai-model-save"
          onClick={onSaveModel}
          className="rounded-md border border-line bg-base px-2 py-1 text-xs text-secondary transition-colors hover:text-primary"
        >
          保存
        </button>
      </label>

      {/* key 状态徽章 */}
      <button
        type="button"
        data-testid="ai-key-badge"
        onClick={() => {
          if (hasKey) {
            // 已配 key：徽章点击无副作用（delete 走专门按钮）
            return;
          }
          setShowKeyDialog(true);
        }}
        className={[
          'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors',
          hasKey
            ? 'border-success text-success bg-success-soft/40'
            : 'border-warning text-warning bg-warning-soft/40',
        ].join(' ')}
        title={hasKey ? 'API Key 已配置' : '点击设置 API Key'}
      >
        {hasKey ? <Check className="h-3 w-3" aria-hidden="true" /> : <KeyRound className="h-3 w-3" aria-hidden="true" />}
        {hasKey ? '已配置 Key' : '未配置 Key'}
      </button>

      {hasKey ? (
        <button
          type="button"
          data-testid="ai-key-delete"
          onClick={onDeleteKey}
          className="rounded-md border border-line bg-base px-2 py-1 text-xs text-secondary transition-colors hover:text-danger"
        >
          删除 Key
        </button>
      ) : (
        <button
          type="button"
          data-testid="ai-key-set"
          onClick={() => setShowKeyDialog(true)}
          className="rounded-md border border-line bg-base px-2 py-1 text-xs text-secondary transition-colors hover:text-primary"
        >
          设置 Key
        </button>
      )}

      {/* test connection */}
      <button
        type="button"
        data-testid="ai-test-connection"
        onClick={onTestConnection}
        disabled={testing || !hasKey}
        className="ml-auto inline-flex items-center gap-1 rounded-md border border-accent bg-accent-soft px-3 py-1 text-xs text-accent transition-colors hover:bg-accent hover:text-inverse disabled:cursor-not-allowed disabled:opacity-50"
      >
        {testing ? (
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
        ) : (
          <Plug className="h-3 w-3" aria-hidden="true" />
        )}
        测试连接
      </button>

      {/* setKey 弹窗（无 portal；用 inline 模式） */}
      {showKeyDialog ? (
        <div
          data-testid="ai-key-dialog-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="设置 API Key"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
        >
          <div
            data-testid="ai-key-dialog"
            className="w-96 rounded-md border border-line bg-elevated p-4 shadow-card"
          >
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-primary">
                设置 {meta?.displayName ?? provider} API Key
              </h3>
              <button
                type="button"
                onClick={() => {
                  setShowKeyDialog(false);
                  setKeyInput('');
                }}
                className="text-secondary hover:text-primary"
                aria-label="关闭"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <input
              data-testid="ai-key-input"
              type="password"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              placeholder="sk-..."
              autoFocus
              className="w-full rounded-md border border-line bg-base px-2 py-1.5 text-sm text-primary"
            />
            <p className="mt-1 text-xs text-secondary">
              Key 存于系统 keyring（Windows Credential Manager），不落盘不外发。
            </p>
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                data-testid="ai-key-dialog-cancel"
                onClick={() => {
                  setShowKeyDialog(false);
                  setKeyInput('');
                }}
                className="rounded-md border border-line bg-base px-3 py-1 text-xs text-secondary transition-colors hover:text-primary"
              >
                取消
              </button>
              <button
                type="button"
                data-testid="ai-key-dialog-confirm"
                disabled={keyInput.trim().length === 0}
                onClick={() => {
                  onSetKey(keyInput.trim());
                  setShowKeyDialog(false);
                  setKeyInput('');
                }}
                className="rounded-md border border-accent bg-accent-soft px-3 py-1 text-xs text-accent transition-colors hover:bg-accent hover:text-inverse disabled:cursor-not-allowed disabled:opacity-50"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
