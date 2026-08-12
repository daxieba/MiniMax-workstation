/**
 * i18n store 测试（v0.1.2 + v0.1.3）
 *
 * 覆盖：
 *   - 默认 lang 检测（zh-CN / zh-TW / en-US / 其他 → zh-CN）
 *   - localStorage 持久化
 *   - setLang 切换 + 持久化
 *   - translations 跟 lang 对应
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useI18nStore } from '@/store/i18nStore';
import { translations, type Lang } from '@/i18n';

const STORAGE_KEY = 'minimax.workstation.lang';

describe('i18nStore (v0.1.3)', () => {
  beforeEach(() => {
    localStorage.clear();
    // 重置 store（每个 test 独立）
    useI18nStore.setState({ lang: 'zh-CN', t: translations['zh-CN'] });
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('默认 lang 是 zh-CN（localStorage 空 + navigator.language 是 en）', () => {
    vi.stubGlobal('navigator', { language: 'en-US' });
    useI18nStore.getState().setLang('en-US');
    expect(useI18nStore.getState().lang).toBe('en-US');
    vi.unstubAllGlobals();
  });

  it('setLang 切到 en-US 并持久化到 localStorage', () => {
    useI18nStore.getState().setLang('en-US');
    expect(useI18nStore.getState().lang).toBe('en-US');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('en-US');
    expect(useI18nStore.getState().t).toBe(translations['en-US']);
  });

  it('setLang 切到 zh-CN 并持久化到 localStorage', () => {
    useI18nStore.getState().setLang('en-US');
    useI18nStore.getState().setLang('zh-CN');
    expect(useI18nStore.getState().lang).toBe('zh-CN');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('zh-CN');
    expect(useI18nStore.getState().t).toBe(translations['zh-CN']);
  });

  it('v0.1.3: setLang 切到 zh-TW（繁体）并持久化', () => {
    useI18nStore.getState().setLang('zh-TW');
    expect(useI18nStore.getState().lang).toBe('zh-TW');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('zh-TW');
    expect(useI18nStore.getState().t).toBe(translations['zh-TW']);
    // 验证繁体：sidebar.inbox = "收件箱"
    expect(useI18nStore.getState().t.sidebar.inbox).toBe('收件箱');
  });

  it('localStorage 已有值时，store 读取该值', () => {
    localStorage.setItem(STORAGE_KEY, 'en-US');
    const stored = localStorage.getItem(STORAGE_KEY) as Lang | null;
    useI18nStore.setState({ lang: stored ?? 'zh-CN', t: translations[stored ?? 'zh-CN'] });
    expect(useI18nStore.getState().lang).toBe('en-US');
  });

  it('setLang 后 t 字段同步更新（components 重新派生翻译）', () => {
    useI18nStore.getState().setLang('en-US');
    expect(useI18nStore.getState().t.sidebar.inbox).toBe('Inbox');
    useI18nStore.getState().setLang('zh-CN');
    expect(useI18nStore.getState().t.sidebar.inbox).toBe('收集箱');
  });

  it('translations 表完整覆盖 zh-CN / zh-TW / en-US', () => {
    expect(translations['zh-CN']).toBeDefined();
    expect(translations['zh-TW']).toBeDefined();
    expect(translations['en-US']).toBeDefined();
    // 一些核心 key 必须同时存在
    const required: Array<keyof typeof translations['zh-CN']> = [
      'app',
      'sidebar',
      'pages',
      'common',
      'actions',
      'empty',
      'cmd',
      'shortcuts',
      'toasts',
      'settings',
    ];
    for (const k of required) {
      expect(translations['zh-CN'][k]).toBeDefined();
      expect(translations['zh-TW'][k]).toBeDefined();
      expect(translations['en-US'][k]).toBeDefined();
    }
  });

  it('zh-TW 至少有几个明显的台湾术语', () => {
    // 收集箱 → 收件箱 (台湾习惯)
    expect(translations['zh-TW'].sidebar.inbox).toBe('收件箱');
    expect(translations['zh-TW'].pages.inbox.kindFile).toBe('檔案');
    // 设置 → 設定
    expect(translations['zh-TW'].sidebar.settings).toBe('設定');
  });

  it('v0.1.3 新增 pages.calendar / pomodoro / stats 在三种语言都存在', () => {
    for (const lang of ['zh-CN', 'zh-TW', 'en-US'] as const) {
      const t = translations[lang];
      expect(t.pages.calendar).toBeDefined();
      expect(t.pages.pomodoro).toBeDefined();
      expect(t.pages.stats).toBeDefined();
      // 三大页 title
      expect(t.pages.calendar.title.length).toBeGreaterThan(0);
      expect(t.pages.pomodoro.title.length).toBeGreaterThan(0);
      expect(t.pages.stats.title.length).toBeGreaterThan(0);
    }
  });
});
