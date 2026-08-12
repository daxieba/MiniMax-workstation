/**
 * 语言切换器（v0.1.2）
 *
 * 两个按钮：简体中文 / English
 * 当前 lang 高亮，点另一个调 useI18nStore.setLang
 *
 * 也支持键盘 Ctrl+Shift+L 切换（v0.1.2 新增快捷键）。
 */
import { Languages } from 'lucide-react';

import { useI18nStore, useT, type Lang } from '@/i18n';

export interface LanguageSwitcherProps {
  /** 紧凑模式（icon-only，用于 sidebar / 顶部）。 */
  compact?: boolean;
  /** 测试用。 */
  testId?: string;
}

const LANGS: ReadonlyArray<{ value: Lang; key: 'zhCN' | 'enUS' }> = [
  { value: 'zh-CN', key: 'zhCN' },
  { value: 'en-US', key: 'enUS' },
];

export function LanguageSwitcher({ compact = false, testId = 'language-switcher' }: LanguageSwitcherProps): React.ReactElement {
  const t = useT();
  const lang = useI18nStore((s) => s.lang);
  const setLang = useI18nStore((s) => s.setLang);

  return (
    <div
      role="radiogroup"
      aria-label={t.settings.language.label}
      data-testid={testId}
      className={[
        'inline-flex items-center gap-1 rounded-md border border-line bg-elevated p-0.5',
        compact ? 'text-xs' : 'text-sm',
      ].join(' ')}
    >
      <Languages className={compact ? 'ml-1 h-3.5 w-3.5 text-secondary' : 'ml-1 h-4 w-4 text-secondary'} aria-hidden="true" />
      {LANGS.map((l) => {
        const active = l.value === lang;
        return (
          <button
            key={l.value}
            type="button"
            role="radio"
            aria-checked={active}
            data-testid={`${testId}-${l.value}`}
            onClick={() => {
              if (!active) setLang(l.value);
            }}
            className={[
              'rounded px-2 py-0.5 transition-colors',
              active ? 'bg-accent text-inverse' : 'text-secondary hover:text-primary',
            ].join(' ')}
          >
            {t.settings.language[l.key]}
          </button>
        );
      })}
    </div>
  );
}
