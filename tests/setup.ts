import '@testing-library/jest-dom/vitest';
import { beforeEach } from 'vitest';

import { translations, useI18nStore } from '@/i18n';

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

/**
 * v0.1.2：每个 test 重置 i18n 状态到 zh-CN（避免跨测试污染 + 期望文案稳定）。
 * localStorage 也清掉，避免读到上一个 test 残留的 lang。
 */
beforeEach(() => {
  try {
    localStorage.clear();
  } catch {
    // ignore
  }
  useI18nStore.setState({ lang: 'zh-CN', t: translations['zh-CN'] });
});
