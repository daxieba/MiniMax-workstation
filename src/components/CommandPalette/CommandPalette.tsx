/**
 * 全局命令面板（v0.1.2 新功能）
 *
 * 触发：Ctrl/Cmd + Shift + P
 * 行为：
 *   - 居中 modal + 背景半透明
 *   - 输入框 fuzzy filter 命令
 *   - ↑↓ 切换 / Enter 执行 / Esc 关闭
 *   - 命令分组显示（导航 / 动作 / 笔记 / 任务）
 *   - 任何命令执行完都自动关闭
 *
 * **不做**：
 *   - 不做命令收藏 / 自定义命令（v0.1.x 不需要）
 *   - 不做 fuzzy 算法优化（v0.1.x 直接用 includes；命令少时够用）
 *   - 不做 nested / 异步命令
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';

import { useT, type Translations } from '@/i18n';
import { useI18nStore, type Lang } from '@/i18n';
import { useCmdPaletteStore, type CommandItem } from '@/store/cmdPaletteStore';

interface CommandPaletteProps {
  /** 命令清单（启动时构造）。 */
  commands: CommandItem[];
  /** 测试用。 */
  testId?: string;
}

/** 简单 fuzzy：全小写 + includes。 */
function matchQuery(item: CommandItem, q: string): boolean {
  if (!q) return true;
  const lower = q.toLowerCase();
  if (item.label.toLowerCase().includes(lower)) return true;
  if (item.group.toLowerCase().includes(lower)) return true;
  if (item.keywords?.some((k) => k.toLowerCase().includes(lower))) return true;
  return false;
}

/** 按 group 分组（保留原顺序）。 */
function groupBy<T>(arr: T[], key: (it: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const it of arr) {
    const k = key(it);
    const list = m.get(k) ?? [];
    list.push(it);
    m.set(k, list);
  }
  return m;
}

export function CommandPalette({ commands, testId = 'cmd-palette' }: CommandPaletteProps): React.ReactElement | null {
  const t = useT();
  const open = useCmdPaletteStore((s) => s.open);
  const closePalette = useCmdPaletteStore((s) => s.closePalette);
  const currentLang = useI18nStore((s) => s.lang);

  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  // 打开时重置状态 + focus
  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIdx(0);
      // 下一帧 focus（modal mount 后）
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // 过滤 + 分组
  const filtered = useMemo(() => commands.filter((c) => matchQuery(c, query)), [commands, query]);
  const grouped = useMemo(() => groupBy(filtered, (c) => c.group), [filtered]);
  const flat = useMemo(() => {
    // 展平成单 array 用于 ↑↓ 索引
    const result: CommandItem[] = [];
    for (const c of filtered) result.push(c);
    return result;
  }, [filtered]);

  // query 变化时把 activeIdx 拉回 0
  useEffect(() => {
    setActiveIdx(0);
  }, [query]);

  // 键盘事件
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closePalette();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIdx((i) => Math.min(flat.length - 1, i + 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIdx((i) => Math.max(0, i - 1));
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        const item = flat[activeIdx];
        if (item) {
          item.run();
          closePalette();
        }
      }
    };
    document.addEventListener('keydown', handler);
    return () => {
      document.removeEventListener('keydown', handler);
    };
  }, [open, flat, activeIdx, closePalette]);

  if (!open) return null;

  // 渲染分组（顺序按 group 出现顺序）
  let runningIdx = -1;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t.shortcuts.cmdPalette}
      data-testid={testId}
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-24"
      onClick={(e) => {
        // 点背景关闭
        if (e.target === e.currentTarget) closePalette();
      }}
    >
      <div className="w-[28rem] overflow-hidden rounded-lg border border-line bg-elevated shadow-card">
        {/* 输入框 */}
        <div className="flex items-center gap-2 border-b border-line px-3 py-2">
          <Search className="h-4 w-4 text-secondary" aria-hidden="true" />
          <input
            ref={inputRef}
            data-testid="cmd-palette-input"
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t.cmd.placeholder}
            className="flex-1 bg-transparent text-sm text-primary outline-none placeholder:text-secondary"
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        {/* 命令列表 */}
        <div ref={listRef} data-testid="cmd-palette-list" className="max-h-80 overflow-auto py-1">
          {flat.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-secondary">{t.cmd.noResults}</p>
          ) : (
            Array.from(grouped.entries()).map(([group, items]) => (
              <div key={group} className="px-1 pb-1" data-testid={`cmd-palette-group-${group}`}>
                <p className="px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-secondary">
                  {group}
                </p>
                {items.map((item) => {
                  runningIdx += 1;
                  const isActive = runningIdx === activeIdx;
                  const localIdx = runningIdx;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      data-testid={`cmd-palette-item-${item.id}`}
                      data-active={isActive}
                      onMouseEnter={() => setActiveIdx(localIdx)}
                      onClick={() => {
                        item.run();
                        closePalette();
                      }}
                      className={[
                        'flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-sm',
                        isActive ? 'bg-accent text-inverse' : 'text-primary hover:bg-base',
                      ].join(' ')}
                    >
                      <span className="truncate">{item.label}</span>
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        {/* 底部状态 */}
        <div className="flex items-center justify-between border-t border-line bg-base/40 px-3 py-1 text-[10px] text-secondary">
          <span>↑↓ {currentLang === 'zh-CN' ? '选择' : 'navigate'}</span>
          <span>Enter {currentLang === 'zh-CN' ? '执行' : 'run'}</span>
          <span>Esc {currentLang === 'zh-CN' ? '关闭' : 'close'}</span>
        </div>
      </div>
    </div>
  );
}

/**
 * 构造命令清单的工厂（启动期调用一次）。
 * 注意：把 navigate / setLang / closePalette 提前从 hook 拿出来再传进来，
 * 让本函数能脱离 React 组件树调用。
 */
export interface CommandPaletteActions {
  navigate: (to: string) => void;
  closePalette: () => void;
  setLang: (lang: Lang) => void;
  currentLang: Lang;
  t: Translations;
}

export function buildCommands(a: CommandPaletteActions): CommandItem[] {
  const { t } = a;
  const go = (to: string, label: string, group: string, keywords: string[] = []): CommandItem => ({
    id: `nav:${to}`,
    label,
    group,
    // 把 path 也作为 keyword（让用户搜 "/inbox" 或 "inbox" 都能命中）
    keywords: [...keywords, to, to.replace(/^\//, '')],
    run: () => a.navigate(to),
  });

  const cmds: CommandItem[] = [
    go('/', t.sidebar.overview, t.cmd.sectionNavigation, [t.shortcuts.navOverview]),
    go('/inbox', t.sidebar.inbox, t.cmd.sectionNavigation, [t.shortcuts.navInbox, t.shortcuts.newInbox]),
    go('/projects', t.sidebar.projects, t.cmd.sectionNavigation, [t.shortcuts.navProjects]),
    go('/ai', t.sidebar.ai, t.cmd.sectionNavigation, [t.shortcuts.navAi]),
    go('/knowledge', t.sidebar.knowledge, t.cmd.sectionNavigation, [t.shortcuts.navKnowledge, t.shortcuts.search]),
    go('/review', t.sidebar.review, t.cmd.sectionNavigation, [t.shortcuts.navReview]),
    go('/settings', t.sidebar.settings, t.cmd.sectionNavigation, [t.shortcuts.navSettings]),
    // 动作
    {
      id: 'action:lang:zh',
      label: t.settings.language.zhCN,
      group: t.cmd.sectionActions,
      keywords: ['language', '语言', 'chinese', 'zh'],
      run: () => a.setLang('zh-CN'),
    },
    {
      id: 'action:lang:en',
      label: t.settings.language.enUS,
      group: t.cmd.sectionActions,
      keywords: ['language', '语言', 'english', 'en'],
      run: () => a.setLang('en-US'),
    },
    {
      id: 'action:cmd-palette:close',
      label: t.shortcuts.esc,
      group: t.cmd.sectionActions,
      keywords: ['close', 'esc', '关闭'],
      run: () => a.closePalette(),
    },
  ];

  return cmds;
}
