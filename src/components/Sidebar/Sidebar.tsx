/**
 * 左侧导航（v0.1.3）
 *
 * 布局：分组布局（主导航 / 工具 / 系统）
 *   - 主导航：总览 / 收集箱 / 项目 / AI / 知识库 / 复盘
 *   - 工具：日历 / 番茄钟 / 统计
 *   - 系统：设置
 *
 * v0.1.2 i18n：导航项的 label / description 从 i18n 资源派生。
 * `Icon` 保持静态（图标不参与语言切换）。
 */
import { useMemo } from 'react';
import { Bot, Bookmark, CalendarDays, ClipboardList, Flame, Inbox, LayoutDashboard, Library, Repeat, Settings, Timer, BarChart3 } from 'lucide-react';
import { SidebarItem } from './SidebarItem';
import { ThemeToggle } from '@/components/ThemeToggle/ThemeToggle';
import { useT } from '@/i18n';
import { useHabitStore } from '@/store/habitStore';
import { todayString } from '@/lib/habitStats';

interface NavItem {
  to: string;
  label: string;
  description: string;
  icon: typeof Inbox;
  /** v0.4.0: 右侧 badge（如 habits 今日 X/N）。 */
  badge?: { done: number; total: number } | undefined;
}

/**
 * 左侧导航。固定宽度，分 3 组。
 */
export function Sidebar(): React.ReactElement {
  const t = useT();

  // v0.4.0: Habits 今日打卡进度（done/total）显示在 sidebar 项右侧
  const habits = useHabitStore((s) => s.habits);
  const habitLogs = useHabitStore((s) => s.logs);
  const habitBadge = useMemo(() => {
    const total = habits.filter((h) => !h.archived).length;
    if (total === 0) return undefined;
    const today = todayString();
    const done = habits.filter(
      (h) => !h.archived && habitLogs.some((l) => l.habitId === h.id && l.date === today),
    ).length;
    return { done, total };
  }, [habits, habitLogs]);

  const mainNav: ReadonlyArray<NavItem> = [
    { to: '/', label: t.sidebar.overview, description: t.pages.overview.subtitle, icon: LayoutDashboard },
    { to: '/inbox', label: t.sidebar.inbox, description: t.pages.inbox.subtitle, icon: Inbox },
    { to: '/projects', label: t.sidebar.projects, description: t.pages.projects.title, icon: ClipboardList },
    { to: '/knowledge', label: t.sidebar.knowledge, description: t.pages.knowledge.title, icon: Library },
    { to: '/review', label: t.sidebar.review, description: t.pages.review.title, icon: Repeat },
    { to: '/ai', label: t.sidebar.ai, description: t.pages.ai.title, icon: Bot },
  ];

  const toolNav: ReadonlyArray<NavItem> = [
    { to: '/calendar', label: t.sidebar.calendar, description: t.pages.calendar.subtitle, icon: CalendarDays },
    { to: '/pomodoro', label: t.sidebar.pomodoro, description: t.pages.pomodoro.subtitle, icon: Timer },
    { to: '/habits', label: t.sidebar.habits, description: t.pages.habits.subtitle, icon: Flame, badge: habitBadge },
    { to: '/stats', label: t.sidebar.stats, description: t.pages.stats.subtitle, icon: BarChart3 },
    { to: '/bookmarks', label: t.sidebar.bookmarks, description: t.pages.bookmarks.subtitle, icon: Bookmark },
  ];

  const systemNav: ReadonlyArray<NavItem> = [
    { to: '/settings', label: t.sidebar.settings, description: t.pages.settings.title, icon: Settings },
  ];

  return (
    <aside
      data-testid="sidebar"
      className="flex h-full w-60 shrink-0 flex-col border-r border-line bg-sidebar"
    >
      <div className="border-b border-line px-4 py-4">
        <h1 className="text-sm font-semibold text-primary">{t.app.name.split(' ')[0]}</h1>
        <p className="text-xs text-secondary">{t.app.name.split(' ').slice(1).join(' ') || t.app.tagline}</p>
      </div>
      <nav className="flex-1 space-y-3 overflow-y-auto px-2 py-3" aria-label={t.sidebar.overview}>
        <NavGroup title={t.sidebar.groupMain} items={mainNav} />
        <NavGroup title={t.sidebar.groupTools} items={toolNav} />
        <NavGroup title={t.sidebar.groupSystem} items={systemNav} />
      </nav>
      <div className="border-t border-line px-3 py-3">
        <ThemeToggle />
      </div>
    </aside>
  );
}

interface NavGroupProps {
  title: string;
  items: ReadonlyArray<NavItem>;
}

function NavGroup({ title, items }: NavGroupProps): React.ReactElement {
  return (
    <div data-testid={`sidebar-group-${title}`} className="space-y-1">
      <p className="px-3 py-1 text-[10px] font-medium uppercase tracking-wider text-secondary">
        {title}
      </p>
      {items.map((item) => (
        <SidebarItem
          key={item.to}
          to={item.to}
          label={item.label}
          description={item.description}
          icon={item.icon}
          badge={item.badge}
        />
      ))}
    </div>
  );
}
