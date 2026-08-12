/**
 * 全局键盘快捷键（v0.1.1 polish + v0.1.2 i18n）
 *
 * 监听 document keydown，按规则触发：
 *   - Ctrl+N / Cmd+N      → 跳到 /inbox + 聚焦输入框
 *   - Ctrl+K / Cmd+K      → 跳到 /knowledge（搜索栏）
 *   - Ctrl+Shift+P / Cmd+Shift+P → 打开命令面板
 *   - Ctrl+1..7 / Cmd+1..7 → 切 sidebar（对应 NAV_ITEMS 顺序）
 *   - Ctrl+/              → 快捷键帮助（弹 toast 提示）
 *   - Esc                 → 离开当前 focus（最简实现：blur active element）
 *   - Ctrl+Shift+L        → 切换语言（v0.1.2）
 *
 * 实现：把每条规则注册成 listener，type === 'keydown' 时 match。
 * macOS 用 metaKey，Windows/Linux 用 ctrlKey；统一当 "Cmd" 处理。
 */
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

import { useI18nStore, useT } from '@/i18n';
import { useCmdPaletteStore } from '@/store/cmdPaletteStore';
import { toast } from '@/store/toastStore';

// sidebar 顺序（必须与 Sidebar.tsx navItems 一致）
const SIDEBAR_PATHS = ['/', '/inbox', '/projects', '/ai', '/knowledge', '/review', '/settings'] as const;

function isMac(): boolean {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
}

function isFormFieldFocused(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || (el as HTMLElement).isContentEditable;
}

export function useGlobalShortcuts(): void {
  const navigate = useNavigate();
  const t = useT();
  const setLang = useI18nStore((s) => s.setLang);
  const currentLang = useI18nStore((s) => s.lang);

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      const cmd = isMac() ? e.metaKey : e.ctrlKey;
      if (!cmd) {
        // Esc 单独处理（不需要 modifier）
        if (e.key === 'Escape') {
          const el = document.activeElement;
          if (el && el !== document.body) {
            (el as HTMLElement).blur();
            e.preventDefault();
          }
        }
        return;
      }

      // Ctrl/Cmd + N（注意：需要 e.shiftKey === false，避免跟 Ctrl+Shift+N 冲突）
      if (!e.shiftKey && (e.key === 'n' || e.key === 'N')) {
        e.preventDefault();
        navigate('/inbox');
        setTimeout(() => {
          const el = document.querySelector<HTMLTextAreaElement>('[data-testid="inbox-composer-content"]');
          el?.focus();
        }, 100);
        toast.info(t.toasts.jumpedInbox);
        return;
      }

      if (!e.shiftKey && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        navigate('/knowledge');
        setTimeout(() => {
          const el = document.querySelector<HTMLInputElement>('[data-testid="knowledge-search-input"]');
          el?.focus();
        }, 100);
        toast.info(t.toasts.jumpedSearch);
        return;
      }

      // Ctrl/Cmd + Shift + P → 命令面板
      if (e.shiftKey && (e.key === 'P' || e.key === 'p')) {
        e.preventDefault();
        useCmdPaletteStore.getState().openPalette();
        return;
      }

      // Ctrl/Cmd + Shift + L → 切换语言
      if (e.shiftKey && (e.key === 'L' || e.key === 'l')) {
        e.preventDefault();
        setLang(currentLang === 'zh-CN' ? 'en-US' : 'zh-CN');
        toast.success(t.toasts.languageChanged);
        return;
      }

      if (e.key === '/') {
        e.preventDefault();
        toast.info(t.toasts.helpText);
        return;
      }

      // Ctrl/Cmd + 1..7
      const digit = e.key.match(/^([1-7])$/);
      if (digit) {
        // 在表单输入框里时不让快捷键切页（避免误触）
        if (isFormFieldFocused()) return;
        e.preventDefault();
        const path = SIDEBAR_PATHS[parseInt(digit[1]!, 10) - 1];
        if (path) {
          navigate(path);
          toast.info(t.toasts.switchedTo(path));
        }
      }
    };

    document.addEventListener('keydown', handler);
    return () => {
      document.removeEventListener('keydown', handler);
    };
  }, [navigate, t, setLang, currentLang]);
}
