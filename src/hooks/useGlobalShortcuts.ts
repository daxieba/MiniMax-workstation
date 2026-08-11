/**
 * 全局键盘快捷键（v0.1.1 polish）
 *
 * 监听 document keydown，按规则触发：
 *   - Ctrl+N / Cmd+N      → 跳到 /inbox + 聚焦输入框
 *   - Ctrl+K / Cmd+K      → 跳到 /knowledge（搜索栏）
 *   - Ctrl+1..7 / Cmd+1..7 → 切 sidebar（对应 NAV_ITEMS 顺序）
 *   - Ctrl+/              → 快捷键帮助（v0.1.1 stub，弹 toast 提示）
 *   - Esc                 → 离开当前 focus（最简实现：blur active element）
 *
 * **不做**：
 *   - 不做 modal 焦点陷阱（v0.1.2 再补）
 *   - 不做快捷键自定义（v0.1.2 再补）
 *
 * 实现：把每条规则注册成 listener，type === 'keydown' 时 match。
 * macOS 用 metaKey，Windows/Linux 用 ctrlKey；统一当 "Cmd" 处理。
 */
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

import { toast } from '@/store/toastStore';

// sidebar 顺序（必须与 Sidebar.tsx NAV_ITEMS 一致）
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

      // Ctrl/Cmd + ?
      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        navigate('/inbox');
        // 给点时间让 page 挂载，再聚焦输入框
        setTimeout(() => {
          const el = document.querySelector<HTMLTextAreaElement>('[data-testid="inbox-composer-content"]');
          el?.focus();
        }, 100);
        toast.info('已跳到收集箱（Ctrl+N）');
        return;
      }

      if (e.key === 'k' || e.key === 'K') {
        e.preventDefault();
        navigate('/knowledge');
        setTimeout(() => {
          // Knowledge 页搜索框的 testid
          const el = document.querySelector<HTMLInputElement>('[data-testid="knowledge-search-input"]');
          el?.focus();
        }, 100);
        toast.info('已跳到知识库（Ctrl+K）');
        return;
      }

      if (e.key === '/') {
        e.preventDefault();
        toast.info('快捷键帮助：Ctrl+N 收集箱 / Ctrl+K 搜索 / Ctrl+1-7 切页 / Esc 取消焦点');
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
          toast.info(`已切到 ${path}`);
        }
      }
    };

    document.addEventListener('keydown', handler);
    return () => {
      document.removeEventListener('keydown', handler);
    };
  }, [navigate]);
}
