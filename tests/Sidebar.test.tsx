import { describe, it, expect } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Sidebar } from '@/components/Sidebar/Sidebar';
import OverviewPage from '@/pages/Overview';
import AIPage from '@/pages/AI';

/**
 * Sidebar 组件测试。
 *
 * 验证：
 *   - 7 个导航项渲染（T5-2 新增"设置"）
 *   - 当前路由对应的项被高亮
 *   - 点击导航项触发路由切换
 *
 * 用 fireEvent.click 而非 @testing-library/user-event，避免新增 dev 依赖
 * （任务约束：T1-2 范围仅允许新增 react-router-dom + lucide-react）。
 */

function renderApp(initialPath = '/'): void {
  render(
    <MemoryRouter initialEntries={[initialPath]}>
      <div className="flex h-full w-full">
        <Sidebar />
        <main>
          <Routes>
            <Route path="/" element={<OverviewPage />} />
            <Route path="/inbox" element={<div>Inbox</div>} />
            <Route path="/projects" element={<div>Projects</div>} />
            <Route path="/ai" element={<AIPage />} />
            <Route path="/knowledge" element={<div>KB</div>} />
            <Route path="/review" element={<div>Review</div>} />
            <Route path="/settings" element={<div>Settings</div>} />
          </Routes>
        </main>
      </div>
    </MemoryRouter>,
  );
}

describe('Sidebar', () => {
  it('renders 7 navigation items with correct labels', () => {
    renderApp();
    const sidebar = screen.getByTestId('sidebar');
    const items = within(sidebar).getAllByRole('link');
    expect(items).toHaveLength(7);
    const labels = items.map((a) => a.textContent);
    expect(labels).toEqual([
      '总览',
      '收集箱',
      '项目与任务',
      'AI 工作区',
      '知识库',
      '每日复盘',
      '设置',
    ]);
  });

  it('highlights active item based on current pathname', () => {
    renderApp('/ai');
    const sidebar = screen.getByTestId('sidebar');
    const aiLink = within(sidebar).getByText('AI 工作区').closest('a');
    expect(aiLink).not.toBeNull();
    expect(aiLink).toHaveClass('bg-accent-soft');
  });

  it('clicking nav item triggers route change', () => {
    renderApp('/');
    const aiLink = screen.getByRole('link', { name: /AI 工作区/ });
    fireEvent.click(aiLink);
    // AI 页 heading 应出现
    expect(screen.getByRole('heading', { name: 'AI 工作区' })).toBeInTheDocument();
  });
});

describe('AppRouter (v0.1.0.4 HashRouter fix)', () => {
  // 关键修复：prod 模式 Electron 加载 file:// 协议 HTML，BrowserRouter
  // 用 pushState('/path') 改 URL —— file:// 协议下被解析为实际文件路径，
  // 触发主进程 will-navigate 拦截 → 路由 state 不更新 → NavLink 点击无反应
  // HashRouter 用 #/inbox（URL fragment），任何协议下都 work。
  //
  // jsdom 测不到 BrowserRouter 在 file:// 下的真实失败（jsdom 默认 http://），
  // 这里只验证：AppRouter 模块能正常 import + 在 jsdom 默认环境下挂载不抛错。
  it('AppRouter exports a component that mounts without error', async () => {
    const { AppRouter } = await import('@/AppRouter');
    expect(typeof AppRouter).toBe('function');
    // 不嵌套 router —— 直接测 AppRouter 函数本身能 render children
    // 实际部署行为靠 electron-builder 打包后手测（prod exe 启动 + 点 sidebar）。
    const { render } = await import('@testing-library/react');
    expect(() => render(<AppRouter><div data-testid="probe">probe</div></AppRouter>)).not.toThrow();
  });
});
