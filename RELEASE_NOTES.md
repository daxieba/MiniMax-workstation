# Release Notes — v0.1.0

**发布日期**：2026-08-10
**代号**：Minimax（"个人工作台 OS" 第一个完整版本）

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
