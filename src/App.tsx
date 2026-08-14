import { useEffect, useMemo } from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { Sidebar } from '@/components/Sidebar/Sidebar';
import { ToastProvider } from '@/components/Toast/ToastProvider';
import { ErrorBoundary } from '@/components/ErrorBoundary/ErrorBoundary';
import { CommandPalette, buildCommands } from '@/components/CommandPalette/CommandPalette';
import { subscribeNativeTheme } from '@/lib/nativeTheme';
import { useGlobalShortcuts } from '@/hooks/useGlobalShortcuts';
import { useTaskNotifier } from '@/hooks/useTaskNotifier';
import { useI18nStore, useT } from '@/i18n';
import { useCmdPaletteStore } from '@/store/cmdPaletteStore';
import OverviewPage from '@/pages/Overview';
import InboxPage from '@/pages/Inbox';
import ProjectsPage from '@/pages/Projects';
import AIPage from '@/pages/AI';
import KnowledgePage from '@/pages/Knowledge';
import ReviewPage from '@/pages/Review';
import SettingsPage from '@/pages/Settings';
import CalendarPage from '@/pages/Calendar';
import PomodoroPage from '@/pages/Pomodoro';
import StatsPage from '@/pages/Stats';
import BookmarksPage from '@/pages/Bookmarks';
import HabitsPage from '@/pages/Habits';

/**
 * 应用根组件。
 *
 * 布局：左侧导航 + 右侧主区。
 * 路由不匹配 → fallback 到 Overview。
 * 错误边界覆盖整棵子树。
 *
 * v0.1.2: 命令面板（Ctrl/Cmd+Shift+P）挂在这里 + 命令清单注册一次。
 */
export default function App(): React.ReactElement {
  // 同步主进程主题推送 → store
  useEffect(() => {
    const unsubscribe = subscribeNativeTheme();
    return unsubscribe;
  }, []);

  // v0.1.1: 全局键盘快捷键（Ctrl+N / Ctrl+K / Ctrl+1-7 / Ctrl+/ / Esc / Ctrl+Shift+P / Ctrl+Shift+L）
  useGlobalShortcuts();

  // v0.3.0: 任务到期通知（每 60s 扫一次 dueDate 已过 + status 活跃的 task）
  useTaskNotifier();

  // v0.1.2: 命令面板 —— 启动期注册一次
  const t = useT();
  const navigate = useNavigate();
  const closePalette = useCmdPaletteStore((s) => s.closePalette);
  const setLang = useI18nStore((s) => s.setLang);
  const currentLang = useI18nStore((s) => s.lang);
  const setCommands = useCmdPaletteStore((s) => s.setCommands);

  const commands = useMemo(
    () =>
      buildCommands({
        navigate: (to) => navigate(to),
        closePalette: () => closePalette(),
        setLang: (l) => setLang(l),
        currentLang,
        t,
      }),
    [navigate, closePalette, setLang, currentLang, t],
  );

  // commands 变化时同步到 store（让 useGlobalShortcuts 等潜在订阅方能拿到）
  useEffect(() => {
    setCommands(commands);
  }, [commands, setCommands]);

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
            <Route path="/calendar" element={<CalendarPage />} />
            <Route path="/pomodoro" element={<PomodoroPage />} />
            <Route path="/stats" element={<StatsPage />} />
            <Route path="/bookmarks" element={<BookmarksPage />} />
            <Route path="/habits" element={<HabitsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
      <ToastProvider />
      <CommandPalette commands={commands} />
    </ErrorBoundary>
  );
}
