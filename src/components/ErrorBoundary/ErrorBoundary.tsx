import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
  /** 自定义降级页（不传则用默认）。 */
  fallback?: (error: Error, reset: () => void) => ReactNode;
  /** 触发 onError 时机（测试用）。 */
  onError?: (error: Error, info: ErrorInfo) => void;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * 根级 ErrorBoundary。
 *
 * 设计：
 *   - 捕获整棵 React 子树中的渲染期错误，**绝不让主进程白屏**
 *   - 默认降级页：标题 + 错误信息 + 重置按钮
 *   - 错误信息不在生产环境暴露 stack（避免泄漏内部路径）
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // 主进程日志留作后续业务卡补；这里只在 dev 输出
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.error('[ErrorBoundary] caught', error, info);
    }
    this.props.onError?.(error, info);
  }

  reset = (): void => {
    this.setState({ error: null });
  };

  override render(): ReactNode {
    const { error } = this.state;
    if (error) {
      if (this.props.fallback) {
        return this.props.fallback(error, this.reset);
      }
      return <DefaultFallback error={error} onReset={this.reset} />;
    }
    return this.props.children;
  }
}

function DefaultFallback({ error, onReset }: { error: Error; onReset: () => void }): ReactNode {
  const isDev = import.meta.env.DEV;
  return (
    <div className="flex h-full w-full items-center justify-center bg-base p-8 text-primary">
      <div className="max-w-lg rounded-lg border border-line bg-elevated p-6 shadow-card">
        <h1 className="text-lg font-semibold">出错了，应用已暂停</h1>
        <p className="mt-2 text-sm text-secondary">
          渲染过程中发生未捕获异常。已阻止白屏，可点击下方按钮重置。
        </p>
        <pre className="mt-4 max-h-40 overflow-auto rounded bg-base p-3 text-xs text-secondary">
          {error.message}
          {isDev && error.stack ? `\n\n${error.stack}` : null}
        </pre>
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onReset}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-inverse hover:bg-accent-hover"
          >
            重置
          </button>
        </div>
      </div>
    </div>
  );
}
