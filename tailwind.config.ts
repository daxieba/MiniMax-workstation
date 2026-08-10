import type { Config } from 'tailwindcss';

/**
 * Tailwind 配置
 * - content 扫描 src/ 和 index.html
 * - darkMode: 'class' 配合 <html class="dark"> 切换
 * - 主题色通过 CSS 变量（见 src/styles/global.css）暴露成 Tailwind 的 bg-*
 *   /text-* 等工具类，渲染端只需写 `bg-base text-primary` 即可在浅/深之间切换
 */
const config: Config = {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        base: 'var(--bg-base)',
        elevated: 'var(--bg-elevated)',
        sidebar: 'var(--bg-sidebar)',
        primary: 'var(--text-primary)',
        secondary: 'var(--text-secondary)',
        inverse: 'var(--text-inverse)',
        line: 'var(--border)',
        'line-strong': 'var(--border-strong)',
        accent: 'var(--accent)',
        'accent-hover': 'var(--accent-hover)',
        'accent-soft': 'var(--accent-soft)',
        danger: 'var(--danger)',
        'danger-soft': 'var(--danger-soft)',
        success: 'var(--success)',
        'success-soft': 'var(--success-soft)',
        warning: 'var(--warning)',
        'warning-soft': 'var(--warning-soft)',
      },
      boxShadow: {
        card: 'var(--shadow)',
      },
    },
  },
  plugins: [],
};

export default config;
