# Release Notes — v0.1.0.4

**发布日期**：2026-08-11
**代号**："终于能跑"补丁（v0.1.0 之后第 4 次修补，**桌面 app 第一个真正可用的版本**）

---

## 修了什么

v0.1.0 发布时号称"能跑"，但普通用户**双击** .exe 会发现 app 实际上死得不能再死。v0.1.0.4 是把"能启动 + 几乎所有功能能用"这个最低门槛打通的修补包。

### 🐛 修复 1 — 数据库初始化失败
- **症状**：双击 .exe 弹错误框"无法启动应用：db 初始化失败 (PERSISTENCE_FAILED)"
- **根因**：drizzle migrator 用正斜杠拼接路径 + Windows + asar 虚拟 fs 在嵌套子目录上 `fs.existsSync` 行为不稳定
- **修复**：prod 模式直接走 `app.asar.unpacked/db/migrations/` 物理目录，绕开 asar 虚拟 fs

### 🐛 修复 2 — UI 白板（preload 找不到 zod）
- **症状**：app 启动了，但**所有功能**都用不了（除了主题切换 —— 因为主题切换不依赖 IPC）
- **根因**：electron-builder 打包时只 `files: out/**/*`，asar 内**没有** node_modules；
  preload 走 sandbox 模式从 asar 内找不到 `require('zod')`
- **修复**：让 vite 把 zod inline 到 preload bundle（60KB → 169KB），preload 变成单文件 standalone

### 🐛 修复 3 — 设置页全死
- **症状**：点设置 → 备份列表 / 自动备份间隔 / 重置数据 全报 TypeError
- **根因**：backupStore / settingsStore 用了错的 IPC 路径（`window.api.appEx` / `window.api.settings`），preload 实际暴露的是 `window.api.app`
- **修复**：两个 store 的 `getXxxApi()` 都改成 `w.api?.app`

### 🐛 修复 4 — updater 测试 mock 漏 default export
- **症状**：`pnpm test` 4 个 fail：`No "default" export is defined on the "electron-updater" mock`
- **根因**：v0.1.0.2 修主进程用 `import electronUpdater from 'electron-updater'` 但没改测试 mock
- **修复**：测试 mock 同时返回 `default: exports`

---

## 已知问题（不阻塞 v0.1.0.4 发布的瑕疵）

- **store-level 单元测试覆盖不足** — backupStore / settingsStore / taskStore / projectStore 等都缺独立单测，
  靠 `tests/SettingsPage.test.tsx` 之类的 page-level 测试间接覆盖（mock 直接打桩到 `window.api`，不走 store 间接层）。
  **v0.1.1 计划补 backupStore.test.ts / settingsStore.test.ts + store 测试模板**
- **MINIMAX_AUTO_TEST 调试能力是临时新增的**（v0.1.0.4 调试时加的）—— 已经 env-gated 保留，
  **生产代码不依赖**（if (env === '1') 包裹），CI / 下次 prod-only bug 出现时能用

---

## 怎么用

1. 下载 `MiniMaxCode 工作台-0.1.0-x64.exe`（或解压 `MiniMaxCode 工作台-0.1.0-portable.zip`）
2. 双击 .exe 安装（或直接运行 portable 解压目录）
3. 桌面快捷方式会创建好
4. **首次启动会自动建 db**（用 `C:\Users\<你>\AppData\Roaming\minimax-workstation\workstation.db`）
5. 进设置 → AI 配置 → 填 API Key → 开始用

---

## 调试开关（**默认关闭**，需要时设环境变量）

- `MINIMAX_VERBOSE_LOG=1` — 主进程 console 落 stdout
- `MINIMAX_CDP_PORT=<n>` — 开 Chrome DevTools Protocol 远程调试
- `MINIMAX_RENDERER_CONSOLE=1` — 渲染端 console 转发到主进程 stdout
- `MINIMAX_AUTO_TEST=1` — 启动后自动跑 11 个 IPC smoke（验证 db + IPC 通道健康）
- `MINIMAX_AUTO_TEST_EXIT=1` — auto-test 完成后 `app.quit()`（CI 用）

---

## 完整功能（v0.1.0 已有）

### 📥 收集箱
随手把想法、任务、文件、链接丢进收集箱，AI 自动识别结构化（任务 / 笔记 / 链接），一键转化。

### ✅ 项目 + 任务
看板三列（待办 / 进行中 / 已完成），按项目分组。任务可以加描述、优先级、关联笔记。AI 帮你从一句话扩展出完整任务草稿。

### 🤖 AI 工作区
- 两个 provider：MiniMax 内置 + 任意 OpenAI 兼容端点（自托管 / DeepSeek / 通义千问 / …）
- 流式 chat
- 结构化提取（"这段话里有哪些任务？" → 任务列表）
- 失败兜底：AI 报错时给清晰提示，**不**泄露 API Key / 原始输出

### 📚 知识库
Markdown 笔记 + 多标签 + 关联任务。全文搜索（SQLite FTS5，毫秒级）。AI 一键摘要 + 标签建议。整批导出为带 YAML frontmatter 的 `.md` 文件。

### 🪞 每日复盘
5 段固定模板：今天完成 / 未完成 / 阻塞 / 明日 3 件事 / AI 草稿。AI 看完你今天做了什么 + 还剩什么，生成明日 3 件事草稿。**你说了算**——必须手动点"采纳"才入库。

### ⚙️ 设置 + 备份
- 主题切换（跟随系统 / 亮 / 暗）
- 手动 + 自动备份（`30 / 60 / 120` 分钟可选）

---

## 这是什么

**MiniMaxCode 个人工作台** 是一款 Windows 优先、本地优先的桌面应用，帮你打通日常工作闭环：

> **收集 → AI 处理 → 安排任务 → 执行完成 → 复盘沉淀**

所有数据**仅存本机**（SQLite + FTS5 全文搜索），AI 凭据走操作系统凭据管理器（**不**上云、**不**写文件、**不**进日志）。

---

## v0.1.0 包含什么

### 📥 收集箱
随手把想法、任务、文件、链接丢进收集箱，AI 自动识别结构化（任务 / 笔记 / 链接），一键转化。

### ✅ 项目 + 任务
看板三列（待办 / 进行中 / 已完成），按项目分组。任务可以加描述、优先级、关联笔记。AI 帮你从一句话扩展出完整任务草稿。

### 🤖 AI 工作区
- 两个 provider：MiniMax 内置 + 任意 OpenAI 兼容端点（自托管 / DeepSeek / 通义千问 / …）
- 流式 chat
- 结构化提取（"这段话里有哪些任务？" → 任务列表）
- 失败兜底：AI 报错时给清晰提示，**不**泄露 API Key / 原始输出

### 📚 知识库
Markdown 笔记 + 多标签 + 关联任务。全文搜索（SQLite FTS5，毫秒级）。AI 一键摘要 + 标签建议。整批导出为带 YAML frontmatter 的 `.md` 文件。

### 🪞 每日复盘
5 段固定模板：今天完成 / 未完成 / 阻塞 / 明日 3 件事 / AI 草稿。AI 看完你今天做了什么 + 还剩什么，生成明日 3 件事草稿。**你说了算**——必须手动点"采纳"才入库。

### ⚙️ 设置 + 备份
- 主题切换（跟随系统 / 亮 / 暗）
- 手动 + 自动备份（`30 / 60 / 120` 分钟可选）
- 备份格式：单文件 `.mmws.json`（人类可读，可手动 diff / 复制）
- 一键恢复 / 导出 / 导入 / 重置
- 卸载软件**不**丢数据（NSIS `deleteAppDataOnUninstall: false`）

---

## 怎么装

### 方式 1：直接下载安装包（即将支持）

> ⚠️ v0.1.0 **未**跑 `pnpm dist:nsis` 真打包（首次发布需在干净环境验证产物 + 配代码签名）。
> 临时方案：开发模式运行（见方式 2）。

### 方式 2：开发模式（推荐尝鲜）

需要：Node 24 + pnpm 11 + Windows 10/11

```bash
git clone <repo>
cd 个人工作台
pnpm install --ignore-scripts
pnpm run setup
pnpm dev
```

> 为什么 `--ignore-scripts`？pnpm 11 默认禁止 install scripts。本项目 native binary 由 `pnpm run setup` 单独处理（electron / better-sqlite3 / esbuild）。详见 `README.md`。

### 方式 3：自己打 NSIS 包

```bash
pnpm install --ignore-scripts
pnpm run setup
pnpm dist:nsis
# 产物在 dist/MiniMaxCode 工作台-0.1.0-x64.exe
```

详细打包流程、签名、图标占位说明见 [`docs/build-and-distribute.md`](./docs/build-and-distribute.md)。

---

## 怎么开始

1. **首次启动** → 设置 → 选 AI provider → 填 API Key（**仅**存操作系统凭据，不上传）
2. **随手收集** → Inbox 页面 + → 输入 / 拖入
3. **AI 提取** → 选条目 → 点"AI 提取" → 任务 / 笔记进对应模块
4. **今日工作** → 看板拖拽 / 复盘页
5. **每日复盘** → Review 页 → 选日期 → 填 5 段 → 选"生成 AI 草稿" → 采纳好的部分
6. **备份** → 设置 → 立即备份（默认每 30 分钟自动一次）

---

## 安全 & 隐私

- ✅ **本地优先**：所有数据存本机 SQLite，**不**联网同步
- ✅ **API Key 走操作系统凭据管理器**（`@napi-rs/keyring` → Windows Credential Manager），**永**不进入渲染进程 / 日志 / 错误 / 导出文件
- ✅ **渲染进程隔离**：`contextIsolation: true` + `nodeIntegration: false` + `sandbox: true` + CSP 注入
- ✅ **IPC 边界 Zod 严格校验**（`.strict()` 拒额外字段）
- ✅ **备份文件不含敏感信息**：不含 apiKey / 绝对路径 / FTS5 虚表数据
- ✅ **危险操作二次确认**：恢复 / 重置 必须输入 `RESTORE` / `RESET` 大写字符串
- ✅ **NSIS 卸载保留数据**（`deleteAppDataOnUninstall: false`）

---

## 已知限制

| 项 | 状态 | 计划 |
|---|---|---|
| `pnpm dist:nsis` 真打产物未验证 | 首次发布需在干净环境跑 | v0.1.0.1 |
| `build/icon.ico` 未生成（用默认占位） | 需设计师出一版 | v0.1.1 |
| 自动更新源未配置 | 配 `MINIMAX_UPDATE_FEED_URL` env + 代码签名 | v0.1.1 |
| T4-3 NoteExportDialog "浏览"按钮用 `window.prompt` | 已有 `dialog:showOpenDialog` IPC 可换 | v0.1.1 |
| `NOT_IMPLEMENTED` 错误码未进 `PROJECT_IDENTITY §4.4` 枚举 | 规范化错误码枚举 | v0.1.1 |
| macOS / Linux 仅打包配置就位，未真打 | 需 macOS / Linux 机器 | v0.2 |
| 多端同步 / 云备份 / 加密压缩 | 不在 v0.1 范围 | v0.3+ |

---

## 反馈

- **Bug** → 项目 issue 列表
- **功能建议** → 项目 discussion
- **安全问题** → **不**走公开渠道，直接联系维护者

---

## 致谢

- 17 张任务卡的 Mavis worker 们（虽然都是同一个模型，但每次派单都认真按指令包执行）
- 项目身份卡 `PROJECT_IDENTITY.md` 的 §11.5 验收门禁——没有这条线，v0.1 不可能 0 越界
- vitest 5/5 稳定连跑（60-64s/run）—— 严格的回归保护

---

**v0.1.0 是一个里程碑，但远不是终点。下一个版本我们一起把它用起来、看哪里需要改、再迭代。**

—— 炫总的个人工作台项目组
