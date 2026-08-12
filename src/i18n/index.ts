/**
 * i18n 入口（v0.1.2）
 *
 * 暴露：
 *   - `translations`: zh-CN / en-US 资源表（`Translations` 类型从 zh-CN 推导）
 *   - `Lang`: 语言标识联合类型
 *   - `useT()`: hook，组件内调用返回当前语言的翻译对象
 *   - `<T>`: 小工具组件，用 `<T k="sidebar.inbox" />` 取单条 key（可选）
 *
 * 用法：
 *   ```ts
 *   const t = useT();
 *   return <h1>{t.pages.inbox.title}</h1>;
 *   ```
 *
 * 切换语言：`useI18nStore(s => s.setLang)('en-US')`
 *
 * 资源加载：全量 import（同 bundle 一起构建），**不**做 lazy / dynamic。
 */
import enUS from './en-US';
import zhCN from './zh-CN';
import type { Translations } from './zh-CN';

import { useI18nStore } from '@/store/i18nStore';

export { default as zhCN } from './zh-CN';
export { default as enUS } from './en-US';
export type { Translations } from './zh-CN';
export { useI18nStore } from '@/store/i18nStore';

export const translations = {
  'zh-CN': zhCN,
  'en-US': enUS,
};

export type Lang = keyof typeof translations;

/**
 * 组件内 hook：返回当前语言的翻译对象。
 * TS 自动推导类型（基于 `Translations`）。
 *
 * **为什么不存整个 translations 对象在 store**：
 *   - 每次 setLang 时所有订阅者都 re-render，浪费
 *   - 改用 store 存 lang，组件用 useT() 派生 t，lang 不变时引用稳定
 */
export function useT(): Translations {
  const lang = useI18nStore((s) => s.lang);
  return translations[lang];
}
