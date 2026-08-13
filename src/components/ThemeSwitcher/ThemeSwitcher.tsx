/**
 * 主题色板切换（v0.3.0 新增）
 *
 * 5 套 accent color 让用户选：
 *   - blue    默认蓝（沉稳）
 *   - indigo  靓紫（活力）
 *   - green   森林绿（自然）
 *   - orange  暖橘（阳光）
 *   - pink    樱粉（温柔）
 *
 * 实现：5 个圆点按钮 + 选中描边 + 点击调 useThemeStore.setAccent
 *   内部已包写 localStorage 持久化（lib/theme.applyAccent）
 *
 * 视觉：
 *   - 未选：圆点 24px + 浅描边
 *   - 选中：圆点 + accent 描边 + 阴影
 *
 * 不做：
 *   - 不做自定义 color picker（5 套够用）
 *   - 不在 ThemeToggle 里集成（分离关注点）
 *
 * @used-by src/pages/Settings 外观 section + src/components/OverviewDashboard/QuickPalette
 */
import { useThemeStore } from '@/store/themeStore';
import { ACCENT_PALETTES, type AccentPalette, applyAccent } from '@/lib/theme';
import { useT } from '@/i18n';

const PALETTE_SWATCH: Record<AccentPalette, { light: string; dark: string; label: string; emoji: string }> = {
  blue: { light: '#2563eb', dark: '#60a5fa', label: '默认蓝', emoji: '🔵' },
  indigo: { light: '#6366f1', dark: '#818cf8', label: '靓紫', emoji: '🟣' },
  green: { light: '#16a34a', dark: '#4ade80', label: '森林绿', emoji: '🟢' },
  orange: { light: '#ea580c', dark: '#fb923c', label: '暖橘', emoji: '🟠' },
  pink: { light: '#db2777', dark: '#f472b6', label: '樱粉', emoji: '🩷' },
};

export interface ThemeSwitcherProps {
  /** 'row' 横向一行；'grid' 5 列网格（用于设置页）。 */
  layout?: 'row' | 'grid';
  /** 测试钩子前缀。 */
  testIdPrefix?: string;
}

export function ThemeSwitcher({
  layout = 'row',
  testIdPrefix = 'theme-switcher',
}: ThemeSwitcherProps): React.ReactElement {
  const t = useT();
  const accent = useThemeStore((s) => s.accent);
  const setAccent = useThemeStore((s) => s.setAccent);
  // resolved 用来决定圆点显示浅色 / 深色 variant
  const resolved = useThemeStore((s) => s.resolved);

  const handleSelect = (p: AccentPalette): void => {
    setAccent(p);
    applyAccent(p);
  };

  return (
    <div
      data-testid={testIdPrefix}
      className={
        layout === 'grid'
          ? 'grid grid-cols-5 gap-2'
          : 'flex flex-wrap items-center gap-2'
      }
      role="radiogroup"
      aria-label={t.settings.theme.accentLabel}
    >
      {ACCENT_PALETTES.map((p) => {
        const isActive = p === accent;
        const swatch = PALETTE_SWATCH[p];
        const color = resolved === 'dark' ? swatch.dark : swatch.light;
        return (
          <button
            key={p}
            type="button"
            role="radio"
            aria-checked={isActive}
            data-testid={`${testIdPrefix}-${p}`}
            data-active={isActive ? 'true' : 'false'}
            onClick={() => handleSelect(p)}
            title={swatch.label}
            className={[
              'group relative inline-flex items-center gap-1.5 rounded-full border-2 transition-all',
              isActive
                ? 'border-accent bg-elevated px-2.5 py-1 text-xs font-medium text-primary shadow-sm'
                : 'border-line bg-elevated px-2.5 py-1 text-xs text-secondary hover:border-accent/60 hover:text-primary',
            ].join(' ')}
          >
            <span
              aria-hidden="true"
              className="inline-block h-4 w-4 shrink-0 rounded-full ring-1 ring-black/5 dark:ring-white/10"
              style={{ backgroundColor: color }}
            />
            <span className="hidden sm:inline">{swatch.label}</span>
          </button>
        );
      })}
    </div>
  );
}
