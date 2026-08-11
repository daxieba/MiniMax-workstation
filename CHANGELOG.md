# Changelog

本项目所有值得注意的变更都会记录在此文件。

格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本 2.0.0](https://semver.org/lang/zh-CN/)。

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

## [0.1.0.3] - 2026-08-10
