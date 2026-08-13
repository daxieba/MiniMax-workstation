# Changelog

本项目所有值得注意的变更都会记录在此文件。

格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本 2.0.0](https://semver.org/lang/zh-CN/)。

## [0.2.0] - 2026-08-13

### Changed (minor)

- **package.json / VERSION 升 0.1.0 → 0.2.0**：v0.1.x 阶段（基础打磨 + i18n + 4 大新功能）收尾，
  v0.2.0 开启新一轮大更新。git tag 历史保留 v0.1.x。

### Added

- **Projects 页重构：Kanban / List 双视图**
  - 默认 **List 视图**：「一页看全」所有任务，按 status 分组（待处理 / 进行中 / 已完成 / 已归档），
    每组按 priority + dueDate 排序
  - 可切到 Kanban 视图：原 4 列横排看板（保留拖拽等所有 v0.1.1 功能）
  - 顶部 tab 切换，localStorage 记住选择
  - List 视图支持 inline 状态流转（点 status badge → 弹菜单 → 改 status）
  - List 视图卡片显示：项目 + 优先级 + dueDate + 标签

## [0.1.3.1] - 2026-08-13

### Fixed

- 设置页「复制路径」按钮文案从误写的「搜索」改为「复制」（v0.1.2 i18n 化遗留）
- 番茄钟布局间距（tab / 圆 / 按钮分离，呼吸感更舒服）

## [0.1.3] - 2026-08-12

### Added

- **zh-TW 繁體中文**：第三套语言资源，台湾惯用词（收件箱 / 設定 / 檔案 / 連結）
- **4 大新功能**：📅 日历 / 🍅 番茄钟 / 📊 统计 / 🔖 书签
- Sidebar 11 项分 3 组（主导航 1-6 / 工具 7-0 / 系统 Shift+0）
- 命令面板加 4 个新导航 + zh-TW 语言切换
- 浏览器 detect: zh-TW / zh-HK / zh-MO → 繁體

## [0.1.2] - 2026-08-12

### Added

- i18n 自写框架（zh-CN / en-US，~250 keys）
- 全局命令面板（Ctrl/Cmd+Shift+P）
- LanguageSwitcher（zh-CN / en-US）+ Ctrl/Cmd+Shift+L 切换
- 5 大页双语化：Sidebar / Inbox / Projects / AI / Knowledge / Review / Overview

## [0.1.0.4] - 2026-08-11

### Fixed

#### 1. **db migrations 在 prod 模式仍然报 "Can't find meta/_journal.json"**
- 症状：v0.1.0.3 修了 asarUnpack，但启动 .exe 仍然弹"数据库初始化失败"对话框
- 根因：Drizzle migrator 内部用 `` `${migrationsFolder}/meta/_journal.json` ``（**正斜杠**）调 `fs.existsSync`；
  Windows + asar 虚拟 fs + 混合正反斜杠 + 嵌套子目录上行为不稳定，`fs.existsSync` 返回 false
- 修复（`db/client.ts`）：新增 `resolveMigrationsFolder({ isDev, appPath })` 纯函数
  - dev 模式：`appPath/db/migrations`（项目根）
  - prod 模式：`app.asar.unpacked/db/migrations`（**绕开 asar 虚拟 fs，直接走物理磁盘**）
  - 用 `appPath.replace(/[/\\]app\.asar$/, '')` 转换，保留 / 兼容 / 异常 fallback 三种情况
- 测试覆盖（`tests/db.test.ts`）：4 个新 case（dev / prod Windows / prod POSIX / 异常 fallback）

#### 2. **preload 加载失败 "Error: module not found: zod"**
- 症状：app 启动但 UI 死白板 —— 主题切换能用（纯 zustand state），其他功能全死（IPC 通道没注册）
- 根因：`electron.vite.config.ts` `preload` 段用 `externalizeDepsPlugin()` 让 zod 走运行时 `require('zod')`；
  sandbox: true 模式下 preload 从 `app.asar/out/preload/` 向上找 `node_modules` —— **但 asar 里没 node_modules**
  （`electron-builder.yml` `files: out/**/*` 只打包 out 目录，main 进程能通过 `out/main/../node_modules` 找到，preload 找不到）
- 修复（`electron.vite.config.ts`）：**preload 段去掉 `externalizeDepsPlugin()`**，让 vite/rollup 把 zod inline 到 preload bundle
  - preload bundle: 60KB → 169KB（zod 进去）
  - 行为对比：之前需要 asar 内 node_modules + 复杂的 externalize 策略；现在单文件 standalone

#### 3. **backupStore / settingsStore 调错 IPC 路径导致设置页全死**
- 症状：进设置页（备份/恢复/重置/自动备份间隔）全报 TypeError
- 根因：T5-2 worker 写 store 时假设的 IPC 路径跟 preload 实际暴露的不一致
  - `backupStore` 调 `window.api.appEx.*`（preload 没这个 key）
  - `settingsStore` 调 `window.api.settings.*`（preload 把 getSettings/setSettings 放在 `app.*` 下）
  - preload 实际：所有备份 + 设置 IPC 都在 `window.api.app.*` 下
- 修复：
  - `src/store/backupStore.ts`: `getBackupApi()` 改 `w.api?.app ?? null`
  - `src/store/settingsStore.ts`: `getSettingsApi()` 改 `w.api?.app ?? null`
  - `tests/SettingsPage.test.tsx`: MockApi 形状同步合并（`app` 段加 getSettings/setSettings/maybeAutoBackup + getPaths/listBackups 等），删除 `settings`/`appEx` 段
- 测试覆盖盲区：T5-2 没为 backupStore / settingsStore 写 store-level 单元测试，**bug 漏到 prod**。
  v0.1.1 计划补 backupStore.test.ts / settingsStore.test.ts + store 测试模板

#### 4. **v0.1.0.2 修复漏改 updater 测试 mock**
- 症状：`tests/updaterIpc.test.ts` 4 个 test fail：vitest 抱怨 `No "default" export is defined on the "electron-updater" mock`
- 根因：v0.1.0.2 修 main 用 `import electronUpdater from 'electron-updater'` + `electronUpdater.autoUpdater.xxx`，
  但测试 `vi.mock('electron-updater', ...)` 工厂只返回 named export `{ autoUpdater }`，没 default。
  vite SSR CJS interop 找不到 default export
- 修复（`tests/updaterIpc.test.ts`）：mock 工厂同时返回 `default: exports` 让 default + named 都可用
- 备注：v0.1.0.2 当时用 default import 是为了**真实**匹配 main runtime 行为（esbuild 编译后保留 `import x from "cjs-mod"` 不加 `__importDefault` wrapper，
  vite 测试上下文走另一条 cjs interop 路径需要 default）

#### 5. **左侧 sidebar 导航点击没反应**（v0.1.0.4 后续发现）
- 症状：v0.1.0.4 fix 后左侧 7 个导航项（总览/收集箱/项目/AI/知识库/复盘/设置）点击都没反应
- 根因：`src/main.tsx` 用 `BrowserRouter`；Electron prod 模式 `mainWindow.loadFile()` 加载 `file://` 协议 HTML，
  BrowserRouter 用 `window.history.pushState(state, '', '/inbox')` 改 URL —— `file://` 协议下被解析为实际文件路径，
  触发主进程 `will-navigate` 拦截（`event.preventDefault()`）+ React Router 内部 state 不同步 → NavLink 点击后路由不切换
- 修复（新增 `src/AppRouter.tsx` + `src/main.tsx` 改用 `AppRouter`）：
  - dev 模式用 `BrowserRouter`（vite dev server 是 `http://`，正常）
  - prod 模式用 `HashRouter`（`#/inbox` URL fragment，hash 永远不会被 file 协议解析）
  - 切换条件：`import.meta.env.DEV`（vite 编译时替换为字面量 `true` / `false`），prod bundle 静态选 HashRouter
- 测试覆盖（`tests/Sidebar.test.tsx`）：新增 `AppRouter` 导出 + 挂载 smoke test（jsdom 测不到 file:// 真实行为，靠 electron-builder 打包后手测）

### Added

#### 调试能力（env-gated，prod 默认关闭，**永久保留**）
- **`MINIMAX_VERBOSE_LOG=1`**：开 `enable-logging` + `v=1`，主进程 console.log/warn/error 落 stdout
- **`MINIMAX_CDP_PORT=<n>`**：开 Chrome DevTools Protocol（remote-debugging-port + remote-allow-origins=*），
  远程 evaluate JS / 抓 console / 触发 IPC
- **`MINIMAX_RENDERER_CONSOLE=1`**：把渲染端 `console-message` 事件转发到主进程 stdout（按 env 注册 listener）
- **`MINIMAX_AUTO_TEST=1`**：渲染端 ready-to-show 后自动跑 11 个 IPC smoke（直接 import handler 函数调，绕开 ipcMain / 渲染端）
- **`MINIMAX_AUTO_TEST_EXIT=1`**：auto-test 完成后 `app.quit()`（CI 用，不阻塞 GUI 用户 session）

### Fixed (meta)

#### **v0.1.0 commit 漏了 `electron/` 源码目录** — 这是 v0.1.0 起所有 bug 的源头
- 症状：v0.1.0 commit `2faf700` 里**没有**任何 `electron/main/` `electron/preload/` `electron/shared/` 下的文件
  （203 files / 47724 insertions 全是 renderer / db / tests / config）
- 影响：
  - v0.1.0 编译时**本地有这些文件**所以 build 成功（用的是 disk 上文件）
  - **但 git 仓库没跟踪**，v0.1.0.1 / v0.1.0.2 / v0.1.0.3 fix commit 也都没补回来
  - **如果有人 clone v0.1.0 tag，跑 `pnpm install && pnpm build` 会编译出没有主进程的 bundle**
  - 即便用本地 build，"为什么 store 调 IPC 静默失败" 也找不到代码（store 期望 `window.api.app.listBackups()` 但主进程代码不存在）
- 修复（`fix(v0.1.0.4)` commit `58ee52f`）：把 `electron/main/` `electron/preload/` `electron/shared/` 下所有 22 个 .ts 文件全部 add 进 git
  - 包括 credentials/credentialManager.ts + index.ts + 13 个 ipc/*.ts + 6 个 providers/*.ts + 1 个 services/*.ts + preload/index.ts + shared/types.ts
- 教训：v0.1.0 release commit `2faf700` 用 `git add .` 时**没**把 `electron/` 加进去（v0.1.0 fix commit 也都漏检 .git tracking status）
  - v0.1.1 流程改进：每次 `git add` 后必须 `git status --short` 确认 expected file 全部 staged

### Verified

- ✅ `pnpm typecheck` 干净
- ✅ `pnpm lint` 干净
- ✅ `pnpm test` × 5 轮稳定通过：60 test files / 991 cases
- ✅ `pnpm dist:dir` 成功生成 `dist\win-unpacked\MiniMaxCode 工作台.exe` (188 MB)
- ✅ `MINIMAX_AUTO_TEST=1` 启动后自动测 11 个 IPC 通道：**11/11 全过**（inbox.list / inbox.add / project.list / task.list / note.list / search.query / ai.listProviders / review.listRecent / app.getPaths / app.listBackups / app.getSettings）
- ✅ db schema version 6，6 个 migration 全跑过
- ✅ 桌面快捷方式路径不变（指向 `dist\win-unpacked\MiniMaxCode 工作台.exe`，自动用新版本）

### Fixed (process)

#### **v0.1.0.4 第一次 commit `58ee52f` 用 `git add <path>` 漏 staged 14 个 fix 文件**
- 现象：`git add electron/main/ electron/preload/ electron/shared/` 只 add 新文件，**不**add working tree 里的其他修改
- 结果：v0.1.0.4 tag `f0340ec` 推出去后 GitHub 仓库**没**4 个 fix 代码，CHANGELOG 描述 + electron/ 源码 add 但 fix 实际代码缺席
- 修复（commit `37054b7`）：重新 stage 所有 working tree 改动 + force-update v0.1.0.4 tag 指向 37054b7
- 教训：永远用 `git add -A`（不是 `git add <path>`），`git add` 后立即 `git diff --staged --stat` + `git show --stat <commit>` 复核
- 详见 agent memory "派单收尾前必查 git status" + "`git add <path>` 不会 add 其他 working tree 改动"

## [0.1.0.3] - 2026-08-10
