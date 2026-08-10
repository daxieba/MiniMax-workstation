/**
 * AIProviderPicker 组件测试（T3-3）
 *
 * 覆盖：
 *   - 渲染 provider select
 *   - 渲染 model input
 *   - 渲染 key 状态徽章（已配置 / 未配置）
 *   - provider 切换触发 onProviderChange
 *   - model 输入触发 onModelChange
 *   - test connection 按钮触发 onTestConnection
 *   - hasKey=true → 显示"已配置 Key" + "删除 Key" 按钮
 *   - hasKey=false → 显示"未配置 Key" + "设置 Key" 按钮
 *   - setKey 弹窗：点"设置 Key" → 弹窗显示 → 输入 → 确认调 onSetKey
 *   - deleteKey 按钮调 onDeleteKey
 */

import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { AIProviderPicker } from '@/components/AIProviderPicker/AIProviderPicker';
import type { ProviderId } from '@shared/types/ai';

const providers: Array<{
  id: ProviderId;
  displayName: string;
  defaultModel: string;
  defaultBaseURL: string;
  docsUrl?: string;
}> = [
  { id: 'minimax', displayName: 'MiniMax', defaultModel: 'MiniMax-M2', defaultBaseURL: 'https://example.com/v1' },
  { id: 'openai-compatible', displayName: 'OpenAI', defaultModel: 'gpt-4o-mini', defaultBaseURL: 'https://api.openai.com/v1' },
];

describe('AIProviderPicker', () => {
  it('renders provider select with all providers', () => {
    render(
      <AIProviderPicker
        providers={providers}
        provider="minimax"
        model="MiniMax-M2"
        hasKey={false}
        testing={false}
        onProviderChange={() => undefined}
        onModelChange={() => undefined}
        onSaveModel={() => undefined}
        onTestConnection={() => undefined}
        onSetKey={() => undefined}
        onDeleteKey={() => undefined}
      />,
    );
    const select = screen.getByTestId('ai-provider-select') as HTMLSelectElement;
    expect(select.value).toBe('minimax');
    const options = Array.from(select.options).map((o) => o.value);
    expect(options).toContain('minimax');
    expect(options).toContain('openai-compatible');
  });

  it('shows "未配置 Key" badge when hasKey=false', () => {
    render(
      <AIProviderPicker
        providers={providers}
        provider="minimax"
        model="MiniMax-M2"
        hasKey={false}
        testing={false}
        onProviderChange={() => undefined}
        onModelChange={() => undefined}
        onSaveModel={() => undefined}
        onTestConnection={() => undefined}
        onSetKey={() => undefined}
        onDeleteKey={() => undefined}
      />,
    );
    expect(screen.getByTestId('ai-key-badge').textContent).toContain('未配置 Key');
  });

  it('shows "已配置 Key" badge and delete button when hasKey=true', () => {
    render(
      <AIProviderPicker
        providers={providers}
        provider="minimax"
        model="MiniMax-M2"
        hasKey={true}
        testing={false}
        onProviderChange={() => undefined}
        onModelChange={() => undefined}
        onSaveModel={() => undefined}
        onTestConnection={() => undefined}
        onSetKey={() => undefined}
        onDeleteKey={() => undefined}
      />,
    );
    expect(screen.getByTestId('ai-key-badge').textContent).toContain('已配置 Key');
    expect(screen.getByTestId('ai-key-delete')).toBeInTheDocument();
  });

  it('calls onProviderChange when select changes', () => {
    const onChange = vi.fn();
    render(
      <AIProviderPicker
        providers={providers}
        provider="minimax"
        model="MiniMax-M2"
        hasKey={false}
        testing={false}
        onProviderChange={onChange}
        onModelChange={() => undefined}
        onSaveModel={() => undefined}
        onTestConnection={() => undefined}
        onSetKey={() => undefined}
        onDeleteKey={() => undefined}
      />,
    );
    fireEvent.change(screen.getByTestId('ai-provider-select'), { target: { value: 'openai-compatible' } });
    expect(onChange).toHaveBeenCalledWith('openai-compatible');
  });

  it('calls onModelChange when model input changes', () => {
    const onChange = vi.fn();
    render(
      <AIProviderPicker
        providers={providers}
        provider="minimax"
        model="MiniMax-M2"
        hasKey={false}
        testing={false}
        onProviderChange={() => undefined}
        onModelChange={onChange}
        onSaveModel={() => undefined}
        onTestConnection={() => undefined}
        onSetKey={() => undefined}
        onDeleteKey={() => undefined}
      />,
    );
    fireEvent.change(screen.getByTestId('ai-model-input'), { target: { value: 'gpt-4' } });
    expect(onChange).toHaveBeenCalledWith('gpt-4');
  });

  it('calls onTestConnection when test button clicked', () => {
    const onTest = vi.fn();
    render(
      <AIProviderPicker
        providers={providers}
        provider="minimax"
        model="MiniMax-M2"
        hasKey={true}
        testing={false}
        onProviderChange={() => undefined}
        onModelChange={() => undefined}
        onSaveModel={() => undefined}
        onTestConnection={onTest}
        onSetKey={() => undefined}
        onDeleteKey={() => undefined}
      />,
    );
    fireEvent.click(screen.getByTestId('ai-test-connection'));
    expect(onTest).toHaveBeenCalledTimes(1);
  });

  it('disables test connection when hasKey=false', () => {
    render(
      <AIProviderPicker
        providers={providers}
        provider="minimax"
        model="MiniMax-M2"
        hasKey={false}
        testing={false}
        onProviderChange={() => undefined}
        onModelChange={() => undefined}
        onSaveModel={() => undefined}
        onTestConnection={() => undefined}
        onSetKey={() => undefined}
        onDeleteKey={() => undefined}
      />,
    );
    expect(screen.getByTestId('ai-test-connection')).toBeDisabled();
  });

  it('opens set-key dialog when "设置 Key" button clicked', () => {
    render(
      <AIProviderPicker
        providers={providers}
        provider="minimax"
        model="MiniMax-M2"
        hasKey={false}
        testing={false}
        onProviderChange={() => undefined}
        onModelChange={() => undefined}
        onSaveModel={() => undefined}
        onTestConnection={() => undefined}
        onSetKey={() => undefined}
        onDeleteKey={() => undefined}
      />,
    );
    fireEvent.click(screen.getByTestId('ai-key-set'));
    expect(screen.getByTestId('ai-key-dialog')).toBeInTheDocument();
    expect(screen.getByTestId('ai-key-input')).toBeInTheDocument();
  });

  it('calls onSetKey with the entered key and closes dialog', () => {
    const onSetKey = vi.fn();
    render(
      <AIProviderPicker
        providers={providers}
        provider="minimax"
        model="MiniMax-M2"
        hasKey={false}
        testing={false}
        onProviderChange={() => undefined}
        onModelChange={() => undefined}
        onSaveModel={() => undefined}
        onTestConnection={() => undefined}
        onSetKey={onSetKey}
        onDeleteKey={() => undefined}
      />,
    );
    fireEvent.click(screen.getByTestId('ai-key-set'));
    fireEvent.change(screen.getByTestId('ai-key-input'), { target: { value: 'sk-abc' } });
    fireEvent.click(screen.getByTestId('ai-key-dialog-confirm'));
    expect(onSetKey).toHaveBeenCalledWith('sk-abc');
    // 弹窗消失
    expect(screen.queryByTestId('ai-key-dialog')).toBeNull();
  });

  it('disables confirm button when key input is empty', () => {
    render(
      <AIProviderPicker
        providers={providers}
        provider="minimax"
        model="MiniMax-M2"
        hasKey={false}
        testing={false}
        onProviderChange={() => undefined}
        onModelChange={() => undefined}
        onSaveModel={() => undefined}
        onTestConnection={() => undefined}
        onSetKey={() => undefined}
        onDeleteKey={() => undefined}
      />,
    );
    fireEvent.click(screen.getByTestId('ai-key-set'));
    expect(screen.getByTestId('ai-key-dialog-confirm')).toBeDisabled();
  });

  it('calls onDeleteKey when delete button clicked', () => {
    const onDeleteKey = vi.fn();
    render(
      <AIProviderPicker
        providers={providers}
        provider="minimax"
        model="MiniMax-M2"
        hasKey={true}
        testing={false}
        onProviderChange={() => undefined}
        onModelChange={() => undefined}
        onSaveModel={() => undefined}
        onTestConnection={() => undefined}
        onSetKey={() => undefined}
        onDeleteKey={onDeleteKey}
      />,
    );
    fireEvent.click(screen.getByTestId('ai-key-delete'));
    expect(onDeleteKey).toHaveBeenCalledTimes(1);
  });
});
