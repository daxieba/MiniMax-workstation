# Changelog

本项目所有值得注意的变更都会记录在此文件。

格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本 2.0.0](https://semver.org/lang/zh-CN/)。

## [0.4.0] - 2026-08-14

### Changed (minor)

- **package.json / VERSION 升 0.3.0 → 0.4.0**：v0.4.0 双主线 ——「设置更多元」+「功能更多元」。

### Added

#### 1. 习惯打卡（Habits）⭐ 新功能

- **第 12 项导航**：Sidebar 工具区加「习惯」入口（icon：🔥 Flame），路由 `/habits`
- **Sidebar 进度 badge**：今日完成 `X/N` 显示在 nav 项右侧（完成 100% 时变 accent 色）
- **Habits 页**（`src/pages/Habits/`）：
  - **GitHub 风格 35 天热力图**（5 周 × 7 天，col-major，颜色 = 习惯色，未来日透明）
  - **3 项 stat**：连续天数 / 本周 `N/N` / 30 天完成率
  - 右上角总打卡数小标
  - 底部「今日打卡」大按钮（toggle 切 log）
  - 新建表单：名称 / emoji 图标 / 颜色 / 每周目标 0-7
  - 卡片操作：归档 / 取消归档 / 删除（带 confirm）
- **IPC 8 通道**（`electron/main/ipc/habit.ts` + `electron/preload/index.ts` + `shared/schemas/habit.ts`）：
  - `habit:list / create / update / archive / delete / toggleLog / listLogs / logsInRange`
  - 全部经 Zod 校验；`{ok, data}` / `{ok, error}` 形态；错误码 `VALIDATION_FAILED / NOT_FOUND / PERSISTENCE_FAILED / INTERNAL`
- **db schema**（`db/schema/habit.ts` + `db/migrations/0007_init_habits.sql`）：
  - `habits`（ULID 主键 / 名称 / emoji / hex 颜色 / 每周目标 / 归档 / 排序 / 时间戳）
  - `habit_logs`（联合主键 `(habit_id, date)`，一个习惯一天只能打一次）
  - 加 `(date)` 单列索引（全局查"今天打了几张卡"）
- **应用层**（`src/lib/habitStats.ts`）：`computeStreak` / `computeThisWeekCount` / `computeLast30Days` / `dateToString` / `todayString` 纯函数（无 db 依赖）
- **store**（`src/store/habitStore.ts`）：缓存 habits + 90 天 logs，IPC 持久化
- **Overview 今日待打卡 widget**（第 7 个 widget）：
  - 显示前 3 个未打卡 habit（icon + 名称 + 一键打卡按钮）
  - 全部完成时显示「🎉 今日全部完成！」
  - header extra 显示 `X/N` 进度（完成时变 accent 色）
  - 剩余 > 3 个时显示「+N 查看全部」链接
- **i18n**：`pages.habits.*`（20+ keys）+ `sidebar.habits`（zh-CN / en-US / zh-TW 三套）

#### 2. 设置页更多元（Settings 5 个新 section）⭐

- **左侧 sticky 索引导航**（视觉亮眼 + 实用）：
  - 17 个 anchor chip 横向 sticky 在 header 下方（backdrop-blur + 200ms hover）
  - 点 chip 平滑滚动到对应 section（用 CSS `scroll-behavior: smooth`）
  - mobile 隐藏
- **1.13 数据存储**（`pages.storagePrefs` + `app:getStorageInfo` IPC）：
  - 数据库大小（实时 stat）
  - 数据库路径 basename
  - 用户数据目录 basename
  - 「刷新」按钮
- **1.14 快捷键一览**（`pages.shortcutsList` + `useGlobalShortcuts` 复用）：
  - 导航组（Ctrl+1-9 → 12 个页面）
  - 动作组（Ctrl+N / Ctrl+K / Ctrl+Shift+P / Esc）
  - `<kbd>` 样式 + 灰底
- **1.15 任务默认**（`pages.taskDefaults` + 3 个新 pref）：
  - 默认优先级：低 / 中 / 高
  - 默认状态：待处理 / 进行中
  - 默认截止偏移 0-30 天（0 = 不自动设置）
  - 写入时 `updatePref` 自动 clamp 数值字段到 [min, max]
- **i18n**：`pages.settings.nav*`（17 个）+ `pages.storagePrefs.*` + `pages.shortcutsList.*` + `pages.taskDefaults.*`（zh-CN / en-US / zh-TW 三套）

#### 3. settingsStore v0.4.0（5+3 套新偏好 + 11 个新 app_meta key）

- **通知偏好**：`notifyTaskOverdue` / `notifyTaskOverdueLeadMin` (0-60) / `notifyPomodoroComplete`
- **启动行为**：`openOnBoot` / `restoreLastPage`
- **番茄偏好**：`pomodoroAutoStartBreak` / `pomodoroAutoStartFocus` / `pomodoroSoundOn`
- **关闭行为**：`closeAction` (`minimize` | `quit`)
- **数据导出**：`exportFormat` (`json` | `csv` | `markdown`)
- **周起始**：`weekStart` (`monday` | `sunday`)
- **任务默认**（v0.4.0 新增）：`defaultTaskPriority` / `defaultTaskStatus` / `defaultDueOffsetDays` (0-30)
- 全部走 `app_meta` key/value 持久化（11 个 key，不复用主进程 settings IPC）
- 类型导出 `UserPrefs / CloseAction / ExportFormat / WeekStart / DefaultTaskPriority / DefaultTaskStatus`

### Fixed

- **en-US.ts / zh-TW.ts i18n 文件结构损坏**：`append-i18n.cjs` 一次性脚本把 v0.4.0 内容插到 `pages.bookmarks` 块**中间**（多余逗号 + 孤儿 `}`），导致两个文件无法 typecheck。修复：补 `}` + 移除多余 `,`
- **Habits page `weekStart` 字段取值错**：从 `s.settings.weekStart` 改成 `s.prefs.weekStart`（weekStart 在 v0.4.0 新 prefs 里，不在老的 settings 备份字段里）
- **`shared/schemas/habit.ts` `satisfies z.ZodType<Habit>` 严格类型不匹配**：`icon` / `note` 是 `default('')`，TS 推断 `_input.icon: string | undefined`，与 `Habit.icon: string` 矛盾。改成 `z.infer<typeof Schema>` 推导 + 去掉 satisfies 第三参数
- **`electron/main/ipc/habit.ts` 8 个 `*InputParsed` 类型未导出**：补 8 个 `export type XxxInputParsed = z.infer<typeof XxxSchema>`
- **`electron/preload/index.ts` 缺 `HabitSchema` import**：补到 imports
- **`src/i18n/zh-TW.ts` 5 处函数参数隐式 any**：加 `(n: string)` / `(n: number)` / `(done: number, target: number)` 类型注解
- **`src/store/settingsStore.ts` 重复 export `UserPrefs` 等**：删除 line 337 重复 export
- **db migration journal 漏 0007**：drizzle-kit 找不到 `0007_init_habits.sql` 对应 journal entry → 集成测试报 `no such table: habits`。修复：手动在 `db/migrations/meta/_journal.json` 加 `0007_init_habits` entry

### Tests

- **81 vitest files / 1100+ cases / 100% pass**（v0.3.0 76 → v0.4.0 81，+5 新）
- 新测试：
  - `tests/habitStats.test.ts`（17 cases）— 5 个纯函数覆盖（含"今天没打卡但昨天打卡"streak 容差）
  - `tests/HabitsPage.test.tsx`（6 cases）— 页面渲染 / 新建 / toggle / 归档 / 删除
  - `tests/settingsStoreV4.test.ts`（5 cases）— 3 个新 pref + 数值字段 clamp + 未知 enum fallback
  - `tests/habitIpc.test.ts`（8 cases）— 8 个 habit handler 集成测试（create/update/archive/toggleLog/listLogs/logsInRange/delete + 错误路径）
  - `tests/appIpcStorage.test.ts`（2 cases）— `handleAppGetStorageInfo` 集成测试
- 全量 sequential runner 跑 81/81 PASS（3-4 分钟）
- `tests/example.test.tsx` 11 → 12 nav items（v0.4.0 +habits）
- `tests/Sidebar.test.tsx` 11 → 12 nav items（同步 example）

### Quality gate

- ✅ typecheck（renderer + node）：clean
- ✅ lint：clean（0 error）
- ✅ vitest 81/81：100% pass
- ✅ build：bundle 1.30 MB → 1.34 MB（+0.04 MB，Habits + 3 settings section + 索引导航）
- ⚠️ IPC smoke：headless 环境下 electron 启动后 `ready-to-show` 不触发 + `setTimeout(1s)` 后 stdout 缓冲未刷 → 跳过端到端 electron smoke。**改用 vitest 集成测试覆盖全部 19 个新 IPC 通道**（更可靠，测试用临时 db 跑真实 handler）

## [0.3.0] - 2026-08-13

### Changed (minor)

- **package.json / VERSION 升 0.2.1 → 0.3.0**：v0.3.0 大版本聚焦"眼前一亮"的视觉 / 体验升级。

### Added

#### 1. 主题色板切换（5 套 accent color）⭐

- **5 套色板**：默认蓝 / 靓紫 / 森林绿 / 暖橘 / 樱粉
- 全应用即时换色（CSS 变量 + `html[data-accent]` + 200ms 平滑过渡）
- **2 个入口**：
  - Overview 页 Hero 右上角 quick picker（5 圆点 inline）
  - 设置页"主题色板"section（5 列 grid）
- 持久化到 localStorage `minimax.theme.accent`
- 深色 / 浅色模式自动适配（每个色板都配了 `.dark` 变体）
- 切换不影响任何数据 / 逻辑

#### 2. Overview 页 → 个人工作台仪表盘 ⭐

- **Hero 区**：
  - 渐变背景（accent-soft 配色）
  - 问候语（早上好 / 中午好 / 下午好 / 晚上好 / 夜深了，按小时切换）
  - 今日日期 + 加载提示
  - **4 个 stat pill**：待办数 / 7d 收集 / 7d 完成 / 今日番茄
  - 主题色板 quick picker
- **Widget grid（6 个，桌面 3 列 / 平板 2 列 / 手机 1 列）**：
  1. 今日重点任务（最多 5 条 + hover 高亮）
  2. 逾期任务（红色 badge）
  3. **快速收集箱**（QuickInput 永远显示 + 最近 3 条 + 空态友好提示）
  4. **番茄钟快速启动**（25min / 5min / 15min 一键跳转 + 调 store.start）
  5. 当前项目进度（最多 5 个 + 进度条）
  6. **最近活动**（7d 收件 / 7d 完成 / 今日番茄）
- AI placeholder 视觉降级（虚线框 + 短提示）

#### 3. 桌面通知（v0.3.0 新基础设施）⭐

- **主进程**：新增 `app:notify` IPC handler（Zod 校验入参 + 调系统 Notification）
- **Windows**：`app.setAppUserModelId('com.MiniMax.workstation')` 通知带 app 名字
- **preload**：暴露 `window.api.app.notify({ title, body?, link? })`
- **通知 schema**：`shared/schemas/notification.ts`（title 1-200 / body 0-1000 / link 必须是 http(s)）
- **useTaskNotifier hook**：App mount 时启动，每 60s 扫一次 task.dueDate
  - 过期（昨天 + 之前）+ status 活跃 → 系统通知
  - 同一 task 不重复通知（localStorage 防重，最多 500 条）
- **Pomodoro 完成通知**：focus → break 时弹"🍅 番茄完成！休息一下吧"
- **链接支持**：link 可选，点击通知调 `shell.openExternal` 打开外链

#### 4. 快捷键 `Ctrl+Shift+H` 跳 Overview

- 跟 `Ctrl+Shift+P`（命令面板）/ `Ctrl+Shift+L`（切语言）/ `Ctrl+N`（收集箱）/ `Ctrl+K`（搜索）一致风格

#### 5. i18n 资源新增

- 5 套主题色板 label（zh-CN / en-US / zh-TW）
- Overview 仪表盘 hero + 5 个 widget + 4 个 stat pill + 3 个时段问候语
- `toasts.taskOverdueTitle`（桌面通知标题）
- pomodoroStore 新增 `setMode` action（让 Overview 一键启动可直接切到指定 mode）

### Test

- 76 files / 1100+ cases / 100% pass
- IPC 11/11 smoke 全过
- typecheck / lint / build 全部 0 错
- 新增 `tests/ThemeSwitcher.test.tsx`（5 cases）
- 新增 `tests/useTaskNotifier.test.tsx`（8 cases）

### Bundle

- 1.30MB（+0.02MB vs v0.2.1）

## [0.2.1] - 2026-08-13

### Changed (patch)

- **package.json / VERSION 升 0.2.0 → 0.2.1**：v0.2.x 阶段第二轮更新，聚焦「Projects 页大改 + bug 修复 + 打磨」。

### Added

- **Projects 页顶栏 chip 化（重做布局）**
  - **彻底移除左侧 ProjectList 1/4 栏**，释放主区空间给 List / Kanban
  - 顶栏 3 行布局：
    - 行 1：标题 + 任务数 + 视图 tab（看板/列表） + [+ 新建任务] [+ 新建项目]
    - 行 2：「项目」chip 行（横向滚动；全部任务 / 无项目 / 各项目）+ 归档过滤 tab
    - 行 3：「状态」chip（全部 / 待处理 / 进行中 / 已完成 / 已归档）+ 任务数 badge
  - 选中项目 chip 时右侧出现 3 个操作按钮（编辑 / 归档 / 删除），无须 hover
  - 视图模式 + 状态过滤 都 localStorage 持久化
  - **List 视图加 `statusFilter` 过滤**：顶栏状态 chip 切换时联动
  - **List 视图空态优化**：标题 + 副文案（提示切换过滤）+ Inbox 图标
  - 旧 `ProjectList` 组件保留（`tests/ProjectList.test.tsx` 还在测），v0.2.2 清理
- **设置页 i18n 化补漏**：
  - 数据目录 label 之前误用 `t.pages.projects.title`（"项目与任务"） → 改为 `t.settings.dbDirectory`（"数据目录"）
  - 底部 footer 路径 + 版本号 i18n 化（`t.settings.dbDirectory` + `t.settings.versionLabel`）
  - 更新 section（"更新"/"当前版本"/"检查更新"/"下载更新"）i18n 化
- **i18n 资源新增 13 个 key**：projects.* 顶栏相关 + settings.dbDirectory/versionLabel/version + settings.updates.*

### Fixed

- **设置页 section 1 第二行 label 错 bug**（pre-existing）：之前显示"项目与任务"——v0.1.2 i18n 化时把 label 误写成 `t.pages.projects.title`。v0.2.1 改为 `t.settings.dbDirectory`。
- **Projects 页"4 列 Kanban 在窄屏挤到出横向滚动条"**：1/4 + 3/4 老布局 + 4 列 Kanban 在 1280px 下被挤。v0.2.1 顶栏 chip 化后，List / Kanban 都有全宽。
- **TaskListView status 过滤后无匹配任务时白屏**：过滤后 `visibleCount === 0` 也走空态，跟 `tasks.length === 0` 一致。
- **选中项目 chip 的操作按钮需要 hover 才显示**：UX 反直觉——选中就应该能操作。v0.2.1 改为选中态直接 inline 显示（不依赖 hover）。

### Tests

- 新增 `tests/ProjectsTopbar.test.tsx`（12 cases）：顶栏 3 行渲染 / 项目 chip 切换 / 状态 chip 切换 / 视图 tab / 归档 tab / 操作按钮组
- `tests/ProjectsPageView.test.tsx` 重写（17 cases）：测新顶栏交互
- `tests/TaskListView.test.tsx` 增 5 cases：v0.2.1 status 过滤
- `tests/SettingsPage.test.tsx` / `tests/i18nStore.test.ts` 通过（i18n 资源新增 key 严格类型校验通过）

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
