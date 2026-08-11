/**
 * 顶层 Router 包装：dev 用 BrowserRouter，prod 用 HashRouter。
 *
 * 原因：Electron prod 模式 `mainWindow.loadFile(...)` 加载 `file://` 协议 HTML，
 * BrowserRouter 用 `window.history.pushState(state, '', '/inbox')` 改 URL，
 * `file://` 协议下会被解析成实际文件路径 → 触发主进程 `will-navigate` 拦截
 * 或文件找不到 → React Router 内部 state 不同步 → NavLink 点击后路由不切换。
 *
 * HashRouter 用 `#/inbox`（URL fragment）—— hash 永远不会被 file 协议解析，
 * 任何协议下都工作。
 *
 * dev 模式 vite dev server 是 `http://localhost:5173/`，BrowserRouter 正常工作。
 *
 * 切换条件：`import.meta.env.DEV`（vite 编译时替换为字面量 `true` / `false`），
 * prod bundle 里 `Router === HashRouter` 静态可见，tree-shake 干净。
 *
 * 测试用 MemoryRouter 直接挂载 App，不走 AppRouter，不受影响。
 */
import { BrowserRouter, HashRouter } from 'react-router-dom';

const Router = import.meta.env.DEV ? BrowserRouter : HashRouter;

export function AppRouter({ children }: { children: React.ReactNode }): React.ReactElement {
  return <Router>{children}</Router>;
}
