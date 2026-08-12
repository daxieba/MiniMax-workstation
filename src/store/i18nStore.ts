/**
 * i18n store：当前语言 + 切换（v0.1.2）
 *
 * 设计：轻量级自写 i18n（**不**用 i18next 库）
 *   - 资源文件是嵌套对象（`src/i18n/zh-CN.ts` + `en-US.ts`）
 *   - 持久化：localStorage 记住用户选择（不跟系统 locale）
 *   - 默认：跟浏览器语言 → 否则 'zh-CN'
 *
 * 不做的事：
 *   - 不做复数形式（v0.1.x 不需要）
 *   - 不做命名插值（v0.1.x 用 `t('key', { name: 'x' })` 已够）
 *   - 不做动态加载（v0.1.x 资源小，直接全量 import）
 */
import { create } from 'zustand';

import enUS from '@/i18n/en-US';
import zhCN from '@/i18n/zh-CN';
import zhTW from '@/i18n/zh-TW';
import type { Translations } from '@/i18n/zh-CN';
import type { Lang } from '@/i18n';

const TRANSLATIONS: Record<Lang, Translations> = {
  'zh-CN': zhCN,
  'zh-TW': zhTW,
  'en-US': enUS,
};

const STORAGE_KEY = 'minimax.workstation.lang';
const DEFAULT_LANG: Lang = 'zh-CN';

/**
 * 检测浏览器语言 → 决定默认 lang。
 * 浏览器可能是 `zh-CN` / `zh-TW` / `zh-HK` / `zh` / `en-US` / `en` / 其他。
 * 只在用户没显式选过时调用。
 */
function detectBrowserLang(): Lang {
  if (typeof navigator === 'undefined') return DEFAULT_LANG;
  const lang = navigator.language?.toLowerCase() ?? '';
  if (lang.startsWith('zh-tw') || lang.startsWith('zh-hk') || lang.startsWith('zh-mo')) return 'zh-TW';
  if (lang.startsWith('zh')) return 'zh-CN';
  if (lang.startsWith('en')) return 'en-US';
  return DEFAULT_LANG;
}

/** 读 localStorage（带 try/catch，Electron 安全模型可能禁用 localStorage）。 */
function readStoredLang(): Lang | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'zh-CN' || v === 'zh-TW' || v === 'en-US') return v;
  } catch {
    // ignore
  }
  return null;
}

function writeStoredLang(lang: Lang): void {
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // ignore
  }
}

export interface I18nState {
  lang: Lang;
  /** 切换语言（持久化到 localStorage + 通知所有订阅者）。 */
  setLang: (lang: Lang) => void;
  /**
   * 翻译对象快照。**仅作占位** —— 组件应该用 `useT()` 拿当前 t（响应式），
   * 不要从 store 直接读 t（store 里的 t 不会随 setLang 实时更新，省内存）。
   */
  t: Translations;
}

export const useI18nStore = create<I18nState>((set) => {
  const initial = readStoredLang() ?? detectBrowserLang();
  return {
    lang: initial,
    t: TRANSLATIONS[initial],
    setLang: (lang) => {
      writeStoredLang(lang);
      set({ lang, t: TRANSLATIONS[lang] });
    },
  };
});
