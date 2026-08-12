import { NavLink } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';

export interface SidebarItemConfig {
  /** 路由 path。 */
  to: string;
  /** 标题（已 i18n）。 */
  label: string;
  /** ARIA 提示文字（已 i18n）。 */
  description?: string;
  /** 图标。 */
  icon: LucideIcon;
}

interface SidebarItemProps {
  item?: SidebarItemConfig;
  // v0.1.2 i18n: 也支持 props 直接传（避免在父组件再次构造 SidebarItemConfig）
  to?: string;
  label?: string;
  description?: string;
  icon?: LucideIcon;
}

/**
 * 单个导航项：基于 react-router 的 NavLink，激活态高亮。
 */
export function SidebarItem(props: SidebarItemProps): React.ReactElement {
  // 优先用 item（向后兼容），否则用单独 props
  const to = props.item?.to ?? props.to ?? '/';
  const label = props.item?.label ?? props.label ?? '';
  const description = props.item?.description ?? props.description;
  const Icon = (props.item?.icon ?? props.icon) as LucideIcon;
  return (
    <NavLink
      to={to}
      end={to === '/'}
      data-testid={`nav-${to.replace(/\W+/g, '_') || 'root'}`}
      title={description}
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
      <span className="truncate">{label}</span>
    </NavLink>
  );
}
