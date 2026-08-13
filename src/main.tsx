import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppRouter } from './AppRouter';
import App from './App';
import './styles/global.css';
import { initTheme } from '@/lib/theme';
import { bootstrapTheme } from '@/lib/nativeTheme';
import { useThemeStore } from '@/store/themeStore';

/**
 * 首屏主题同步：必须在 createRoot 之前调用，避免首屏闪烁。
 * 1. 从 localStorage 读 mode + accent + 解析 → 直接挂到 <html>
 * 2. 同步到 store
 */
const { mode, resolved, accent } = initTheme();
useThemeStore.setState({ mode, resolved, accent });

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('Root element #root not found in index.html');
}

createRoot(rootEl).render(
  <StrictMode>
    <AppRouter>
      <App />
    </AppRouter>
  </StrictMode>,
);

// 渲染后异步拉一次主进程，对齐 source 状态（system 模式下尤其重要）
void bootstrapTheme();
