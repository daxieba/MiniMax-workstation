import { Bot, ClipboardList, Inbox, LayoutDashboard, Library, Repeat, Settings } from 'lucide-react';
import { SidebarItem, type SidebarItemConfig } from './SidebarItem';
import { ThemeToggle } from '@/components/ThemeToggle/ThemeToggle';

const NAV_ITEMS: ReadonlyArray<SidebarItemConfig> = [
  { to: '/', label: '总览', icon: LayoutDashboard, description: '今日重点 / 收集 / 项目进度' },
  { to: '/inbox', label: '收集箱', icon: Inbox, description: '快速记录 + AI 处理' },
  { to: '/projects', label: '项目与任务', icon: ClipboardList, description: '任务列表 / 看板' },
  { to: '/ai', label: 'AI 工作区', icon: Bot, description: '对话 / 总结 / 提取' },
  { to: '/knowledge', label: '知识库', icon: Library, description: '笔记 / 搜索' },
  { to: '/review', label: '每日复盘', icon: Repeat, description: '今日完成 / 明日三件事' },
  { to: '/settings', label: '设置', icon: Settings, description: '外观 / 备份 / 重置' },
];

/**
 * 左侧导航。固定宽度，提供 6 个一级入口 + 底部主题切换。
 */
export function Sidebar(): React.ReactElement {
  return (
    <aside
      data-testid="sidebar"
      className="flex h-full w-60 shrink-0 flex-col border-r border-line bg-sidebar"
    >
      <div className="border-b border-line px-4 py-4">
        <h1 className="text-sm font-semibold text-primary">MiniMaxCode</h1>
        <p className="text-xs text-secondary">个人工作台</p>
      </div>
      <nav className="flex-1 space-y-1 px-2 py-3" aria-label="主导航">
        {NAV_ITEMS.map((item) => (
          <SidebarItem key={item.to} item={item} />
        ))}
      </nav>
      <div className="border-t border-line px-3 py-3">
        <ThemeToggle />
      </div>
    </aside>
  );
}
