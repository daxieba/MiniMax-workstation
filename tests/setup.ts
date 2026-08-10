import '@testing-library/jest-dom/vitest';

/**
 * jsdom 缺省实现：matchMedia、ResizeObserver、scrollTo。
 * T1-2 主题测试需要 matchMedia；其他为后续卡片预留。
 */

if (typeof window !== 'undefined') {
  if (!window.matchMedia) {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: (query: string): MediaQueryList => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => undefined,
        removeListener: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => false,
      }),
    });
  }
}
