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
