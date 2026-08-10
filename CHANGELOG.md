# Changelog

本项目所有值得注意的变更都会记录在此文件。

格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本 2.0.0](https://semver.org/lang/zh-CN/)。

## [0.1.0.1] - 2026-08-10

### Fixed

- **`pnpm dist:dir` 在 Windows 普通用户下能跑通**
  - electron-builder 25.1.8 hardcode 了 7-Zip 不支持的 `-snld` CLI 参数；
    Windows 普通用户没 symlink 权限触发 darwin/linux 符号链接创建失败
  - 新增 `7za-wrapper/Wrapper.cs`（C# 编译，5.6 KB）— 把 `-snld` 转成 7-Zip 21.07/26.02 都支持的 `-xr!darwin -xr!linux`
  - 新增 `scripts/install-wrapper.cjs` — 自动化编译 wrapper 到 `node_modules\.pnpm\7zip-bin@5.2.0\node_modules\7zip-bin\win\x64\7za.exe`，备份原版到 `7za-real.exe` + `7za.exe.bak21`，幂等可重跑
  - `package.json` 把 `7zip-bin ^5.2.0` 提升到 devDependencies（之前是 transitive）
- **新装仓库后**：先 `pnpm install` → 再 `node scripts/install-wrapper.cjs` → 然后 `pnpm dist:dir` / `pnpm dist:nsis` 都不需要管理员

### Verified

- ✅ `pnpm dist:dir` 成功生成 `dist\win-unpacked\MiniMaxCode 工作台.exe` (180 MB)
- ✅ 整个 `dist\win-unpacked\` 目录 ~227 MB
- ✅ 用 huaweicloud 镜像（`ELECTRON_MIRROR` / `ELECTRON_BUILDER_BINARIES_MIRROR`）下 electron 33.4.11 (115 MB) + winCodeSign 2.6.0 (5.6 MB) 速度可接受
- ⚠️ `pnpm dist:nsis` 仍需在干净环境验证（要下 NSIS 工具链 ~30MB）

## [0.1.0] - 2026-08-10

首个功能完整的 v0.1 发布。覆盖 6 大模块（收集箱 / 项目与任务 / AI 工作区 / 知识库 / 每日复盘 / 设置与备份），17 张任务卡全部通过验收门禁。

### Added

#### 收集箱
- 4 种条目类型（`note` / `todo` / `file` / `link`），可一键转任务
- 状态机：`pending` → `processed` / `archived`
- AI 一键提取：识别条目里的任务 / 想法 / 链接结构化输出
- InboxComposer / InboxItem / InboxList 组件

#### 项目 + 任务
- 看板三列（todo / doing / done）+ 已归档视图
- 状态机 `todo → doing → done / archived`，重启任务必须从 `done → todo`（设计意图）
- 项目分组、跨项目任务、拖拽改状态
- AI 任务草稿：从 Inbox 条目 / 自由文本生成任务候选
- TaskBoard / TaskColumn / TaskCard / TaskForm / TaskStatusActions 组件

#### AI 工作区
- 2 个 provider：`minimax`（MiniMax 内置）+ `openai-compatible`（任意 OpenAI 兼容端点）
- API Key 走 `@napi-rs/keyring`（Windows Credential Manager），永不出现在 IPC / 日志 / 导出文件
- 流式 chat（`ai:chat` + `ai:chat:chunk` 事件）
- 结构化 JSON 提取（`ai:extractJson`）—— 4 个固定 schema：inbox_items / task_drafts / note_summary / review_draft
- 错误兜底：AI 失败返回 `EXTERNAL_FAILURE`，错误信息不含原始输出 / API Key
- AIProviderPicker / AIQuickAction / AIPendingConfirm / AIChat 组件

#### 知识库
- Markdown 笔记 + 标签（多对多）+ 关联任务
- 全文搜索：SQLite FTS5 虚表（`notes_fts` / `inbox_fts` / `tasks_fts`）+ 9 个同步触发器
- AI 摘要：基于笔记内容生成标题 / 摘要 / 标签（`note_summary` schema）
- 一键导出：多选 + 选目录 + 写 `.md` + YAML frontmatter（字段白名单，不含敏感信息）
- NoteEditor / NoteViewer / NoteList / NoteTagInput / NoteTaskPicker / NoteCard / NoteAIPanel / NoteExportDialog 组件

#### 每日复盘
- 5 段固定模板：今天完成 / 未完成 / 阻塞 / 明日 3 件事 / AI 草稿
- 日期选择器 + 前后翻 + 最近 30 天列表
- AI 日报草稿：从当天 + 昨天任务 / Inbox 拼接 prompt → `review_draft` schema 提取
- **强制** 用户手动"采纳"才入库（草稿不入库）
- 草稿 3 按钮：采纳并填充 / 重新生成 / 丢弃

#### 设置 + 备份
- 6 个 section：外观 / AI / 备份 / 备份文件列表 / 危险区 / 更新
- 主题切换（system / light / dark）
- 自动备份频率（0/30/60/120 分钟）+ 手动备份 + 立即备份
- 备份格式：`.mmws.json`（单文件 JSON，**不**用 zip；不含 apiKey / 绝对路径 / FTS5 虚表数据）
- 备份保留策略：自动备份保留最近 10 份，手动备份无限期
- 恢复：选文件 → 大写 `RESTORE` 二次确认 → 自动备份当前 db → 事务替换 → 提示重启
- 导出 / 导入：同 `.mmws.json` 格式
- 重置：大写 `RESET` 二次确认 → 清空业务表 → 保留 `app_meta` schemaVersion
- 通用 dialog IPC：`dialog:showSaveDialog` / `dialog:showOpenDialog`（T4-3 NoteExportDialog 的"浏览"按钮留的口子本卡补上）

#### 发布骨架
- `electron-builder.yml` 外置配置（appId `com.minimax.workstation` / NSIS / macOS dmg / Linux AppImage）
- 3 个 dist scripts：`pnpm dist` / `dist:nsis` / `dist:dir`
- NSIS 配置：用户选目录 + 桌面 / 开始菜单快捷方式 + `deleteAppDataOnUninstall: false`（卸载保留数据）
- 自动更新 IPC 骨架：`app:checkForUpdate` / `app:downloadUpdate`，env-gated（`MINIMAX_UPDATE_FEED_URL` 未设时返回 `NOT_IMPLEMENTED`）
- `docs/build-and-distribute.md` 文档（如何打 NSIS 包 / 配置更新源 / 签名占位说明）

### Security
- API Key 走 `@napi-rs/keyring`（NAPI 跨平台 binary，Windows Credential Manager）—— 永不进入渲染进程 / 日志 / 错误 / 备份文件
- Zod 严格双向校验（IPC 边界全部 `.strict()` 拒额外字段，含 `app_meta` 5-key 白名单）
- 备份文件不含 apiKey / 绝对路径 / FTS5 虚表数据
- 50MB 单文件大小上限 + 路径穿越保护（`deleteBackupFile` 校验 `resolvedPath.startsWith(backups + sep)`）
- 恢复 / 重置有 `RESTORE` / `RESET` 大写字符串字面量二次确认
- AI 错误信息不含原始输出 / API Key
- NSIS `deleteAppDataOnUninstall: false`（卸载保留用户数据）
- 主进程 `contextIsolation: true` + `nodeIntegration: false` + `sandbox: true` + CSP 注入

### Test Coverage
- **60 test files / 987 test cases**
- 5/5 稳定连跑（60-64s/run）
- 0 个 `@ts-ignore` / `eslint-disable`
- 0 越界（每张卡有自检报告）
- vitest 串行配置（`pool: 'forks' + isolate: true + fileParallelism: false`）—— 解决 OS Credential Manager 跨文件锁竞争（T3-1 时代的 flaky 已修）
- `better_sqlite3.electron.node` 命名修复（T1-3：better-sqlite3 12.x `database.js:52` 强制 `.node` 后缀）

### Fixed
- T3-1 flaky 测试（OS Credential Manager 跨文件锁竞争）
- T1-3 better-sqlite3 native binary 命名（`better_sqlite3.node.electron` → `better_sqlite3.electron.node`）
- T2-3 状态机语义（`done → doing` 不允许；`done` 只能 `→ todo` / `→ archived`）

### Known Limitations
- **T4-3 NoteExportDialog "浏览"按钮** 仍用 `window.prompt` 拿目录路径（已加 TODO 指向 T5-2 落地的 `dialog:showOpenDialog` IPC，留给 v0.2 小卡修）
- **`NOT_IMPLEMENTED` 错误码** 不在 `PROJECT_IDENTITY §4.4` 错误码枚举里（v0.1 按指令新增并仅用于 updater IPC；规范化进枚举留 v0.2）
- **`build/icon.ico` 未生成**：NSIS 用 electron-builder 默认占位 icon（v0.2 需补）
- **Settings footer 重复显示版本号**：Section 6 + footer 都有版本显示（按指令"不重排前 5 section / footer"保留的视觉冗余）
- **NSIS 真打未跑**：`pnpm dist:nsis` 未验证产物（需先下载 ~80MB electron + NSIS 工具链，CI 上跑更稳）
- **vitest PowerShell 5.1 + pnpm 兼容**：直接 `pnpm exec vitest` 在 PowerShell 5.1 下会因 stderr ANSI 触发 `NativeCommandError`；解决方案用 `cmd /c "..."` 隔离（与代码无关）

### Architecture
- 严格分层：`electron/main` (主进程) / `electron/preload` (preload) / `src` (渲染) / `shared` (主预共享) / `db` (schema + 迁移)
- 单写入者规则：任意时刻一个 worker 写一份代码（`PROJECT_IDENTITY.md §11.1`）
- Zod 端到端契约：主进程入口校验 + preload 解析响应 + 渲染端 store 再次校验
- IPC 错误统一 `isStructuredIpcError` 模式 + 7 个错误码（`VALIDATION_FAILED` / `NOT_FOUND` / `CONFLICT` / `DEPENDENCY_MISSING` / `EXTERNAL_FAILURE` / `PERSISTENCE_FAILED` / `INTERNAL`）
