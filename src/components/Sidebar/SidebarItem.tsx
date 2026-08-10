import { NavLink } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';

export interface SidebarItemConfig {
  /** 路由 path。 */
  to: string;
  /** 中文标题。 */
  label: string;
  /** 图标。 */
  icon: LucideIcon;
  /** ARIA 提示文字。 */
  description?: string;
}

interface SidebarItemProps {
  item: SidebarItemConfig;
}

/**
 * 单个导航项：基于 react-router 的 NavLink，激活态高亮。
 */
export function SidebarItem({ item }: SidebarItemProps): React.ReactElement {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      end={item.to === '/'}
      data-testid={`nav-${item.to.replace(/\W+/g, '_') || 'root'}`}
      className={({ isActive }) =>
        [
          'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
          isActive
            ? 'bg-accent-soft text-accent'
            : 'text-primary hover:bg-base',
        ].join(' ')
      }
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="truncate">{item.label}</span>
    </NavLink>
  );
}
