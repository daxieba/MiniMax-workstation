import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from '@/App';

/**
 * 应用根组件冒烟测试。
 *
 * 验证：
 *   - 渲染成功
 *   - 侧栏 7 项入口都在（T5-2 新增"设置"）
 *   - 路径 / 渲染 Overview
 *   - 路径 /inbox 渲染 Inbox
 *   - 路径不匹配时 fallback 到 Overview
 */
describe('App', () => {
  it('renders the workspace title and sidebar with 12 nav items (v0.4.0 +habits)', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    );

    expect(screen.getByText('MiniMaxCode')).toBeInTheDocument();

    const sidebar = screen.getByTestId('sidebar');
    const items = within(sidebar).getAllByRole('link');
    expect(items).toHaveLength(12);
    expect(items[0]).toHaveTextContent('总览');
    expect(items[1]).toHaveTextContent('收集箱');
    expect(items[2]).toHaveTextContent('项目与任务');
    expect(items[3]).toHaveTextContent('知识库');
    expect(items[4]).toHaveTextContent('每日复盘');
    expect(items[5]).toHaveTextContent('AI 工作区');
    expect(items[6]).toHaveTextContent('日历');
    expect(items[7]).toHaveTextContent('番茄钟');
    expect(items[8]).toHaveTextContent('习惯');
    expect(items[9]).toHaveTextContent('统计');
    expect(items[10]).toHaveTextContent('书签');
    expect(items[11]).toHaveTextContent('设置');
  });

  it('overview page renders when path is /', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: '总览' })).toBeInTheDocument();
  });

  it('inbox page renders when path is /inbox', () => {
    render(
      <MemoryRouter initialEntries={['/inbox']}>
        <App />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: '收集箱' })).toBeInTheDocument();
  });

  it('unknown path falls back to overview', () => {
    render(
      <MemoryRouter initialEntries={['/does-not-exist']}>
        <App />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: '总览' })).toBeInTheDocument();
  });
});
