import { useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Sidebar } from '@/components/Sidebar/Sidebar';
import { ToastProvider } from '@/components/Toast/ToastProvider';
import { ErrorBoundary } from '@/components/ErrorBoundary/ErrorBoundary';
import { subscribeNativeTheme } from '@/lib/nativeTheme';
import { useGlobalShortcuts } from '@/hooks/useGlobalShortcuts';
import OverviewPage from '@/pages/Overview';
import InboxPage from '@/pages/Inbox';
import ProjectsPage from '@/pages/Projects';
import AIPage from '@/pages/AI';
import KnowledgePage from '@/pages/Knowledge';
import ReviewPage from '@/pages/Review';
import SettingsPage from '@/pages/Settings';

/**
 * 应用根组件。
 *
 * 布局：左侧导航 + 右侧主区。
 * 路由不匹配 → fallback 到 Overview。
 * 错误边界覆盖整棵子树。
 *
 * 注意：theme store 已在 src/main.tsx 启动时通过 initTheme() 初始化；这里只
 * 订阅主进程 nativeTheme 推送，实现「跟随系统」实时响应。
 */
export default function App(): React.ReactElement {
  // 同步主进程主题推送 → store
  useEffect(() => {
    const unsubscribe = subscribeNativeTheme();
    return unsubscribe;
  }, []);

  // v0.1.1: 全局键盘快捷键（Ctrl+N / Ctrl+K / Ctrl+1-7 / Ctrl+/ / Esc）
  useGlobalShortcuts();

  return (
    <ErrorBoundary>
      <div className="flex h-full w-full bg-base text-primary">
        <Sidebar />
        <main className="flex-1 overflow-auto">
          <Routes>
            <Route path="/" element={<OverviewPage />} />
            <Route path="/inbox" element={<InboxPage />} />
            <Route path="/projects" element={<ProjectsPage />} />
            <Route path="/ai" element={<AIPage />} />
            <Route path="/knowledge" element={<KnowledgePage />} />
            <Route path="/review" element={<ReviewPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
      <ToastProvider />
    </ErrorBoundary>
  );
}
