import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ErrorBoundary } from '@/components/ErrorBoundary/ErrorBoundary';

/**
 * ErrorBoundary 测试。
 *
 * 故意让子组件抛错，验证：
 *   - 降级页显示
 *   - 不会白屏（父元素存在）
 *   - "重置"按钮能清掉错误状态
 *   - 支持自定义 fallback
 *
 * React 18 在 error boundary 捕获时会向 console.error 写日志；测试里 spy 掉避免污染。
 */

function Boom(): React.ReactElement {
  throw new Error('boom from Boom');
}

describe('ErrorBoundary', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterAll(() => {
    errorSpy.mockRestore();
  });

  it('renders fallback when child throws', () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByText('出错了，应用已暂停')).toBeInTheDocument();
    expect(screen.getByText(/boom from Boom/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重置' })).toBeInTheDocument();
  });

  it('reset button clears error and re-renders children', () => {
    let shouldThrow = true;
    function ConditionalBoom(): React.ReactElement {
      if (shouldThrow) throw new Error('still throwing');
      return <div>recovered</div>;
    }

    render(
      <ErrorBoundary>
        <ConditionalBoom />
      </ErrorBoundary>,
    );
    expect(screen.getByText('出错了，应用已暂停')).toBeInTheDocument();

    shouldThrow = false;
    fireEvent.click(screen.getByRole('button', { name: '重置' }));
    expect(screen.getByText('recovered')).toBeInTheDocument();
  });

  it('uses custom fallback when provided', () => {
    render(
      <ErrorBoundary fallback={(err) => <div>custom: {err.message}</div>}>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByText(/custom: boom from Boom/)).toBeInTheDocument();
  });
});
