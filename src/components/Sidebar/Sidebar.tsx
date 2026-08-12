import { Bot, ClipboardList, Inbox, LayoutDashboard, Library, Repeat, Settings } from 'lucide-react';
import { SidebarItem } from './SidebarItem';
import { ThemeToggle } from '@/components/ThemeToggle/ThemeToggle';
import { useT } from '@/i18n';

/**
 * 左侧导航。固定宽度，提供 7 个一级入口 + 底部主题切换。
 *
 * v0.1.2 i18n：导航项的 label / description 从 i18n 资源派生。
 * `Icon` 保持静态（图标不参与语言切换）。
 */
export function Sidebar(): React.ReactElement {
  const t = useT();
  const navItems: ReadonlyArray<{ to: string; label: string; description: string; icon: typeof Inbox }> = [
    { to: '/', label: t.sidebar.overview, description: t.pages.overview.subtitle, icon: LayoutDashboard },
    { to: '/inbox', label: t.sidebar.inbox, description: t.pages.inbox.subtitle, icon: Inbox },
    { to: '/projects', label: t.sidebar.projects, description: t.pages.projects.title, icon: ClipboardList },
    { to: '/ai', label: t.sidebar.ai, description: t.pages.ai.title, icon: Bot },
    { to: '/knowledge', label: t.sidebar.knowledge, description: t.pages.knowledge.subtitle(0).split('。')[0] ?? t.pages.knowledge.title, icon: Library },
    { to: '/review', label: t.sidebar.review, description: t.pages.review.completed, icon: Repeat },
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
      <nav className="flex-1 space-y-1 px-2 py-3" aria-label={t.sidebar.overview}>
        {navItems.map((item) => (
          <SidebarItem
            key={item.to}
            to={item.to}
            label={item.label}
            description={item.description}
            icon={item.icon}
          />
        ))}
      </nav>
      <div className="border-t border-line px-3 py-3">
        <ThemeToggle />
      </div>
    </aside>
  );
}
