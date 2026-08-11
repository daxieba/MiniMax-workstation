# MiniMaxCode 个人工作台

> **Windows 优先、本地优先**的"个人工作台 OS"。
> 核心闭环：**收集 → AI 处理 → 安排任务 → 执行完成 → 复盘沉淀**。

[![version](https://img.shields.io/badge/version-0.1.0-blue.svg)](./VERSION)
[![patches](https://img.shields.io/badge/patches-v0.1.0.4-blueviolet.svg)](./CHANGELOG.md)
[![tests](https://img.shields.io/badge/tests-991%20passed-success.svg)](./CHANGELOG.md)
[![files](https://img.shields.io/badge/test%20files-60-informational.svg)](./CHANGELOG.md)
[![license](https://img.shields.io/badge/license-Private-red.svg)]()

[English](./README.en.md) | [中文](./README.md)

---

## 一句话定位

一个**装在你电脑上的**个人工作台：把"想到的事 → 该做的事 → 做完的事 → 今天的复盘"全部串起来，本地存、AI 帮、你说了算。

---

## 6 大模块

| 模块 | 一句话 | 关键能力 |
|---|---|---|
| 📥 **收集箱** | 随手丢想法，AI 帮你识别 | 4 种 kind、AI 提取结构化、一键转任务 |
| ✅ **项目 + 任务** | 看板三列，按项目分组 | 状态机、拖拽改状态、AI 草稿、跨项目任务 |
| 🤖 **AI 工作区** | 2 provider，流式 chat + 结构化提取 | MiniMax / OpenAI-compatible、Zod 严格校验、错误兜底 |
| 📚 **知识库** | Markdown 笔记 + 全文搜索 | 标签、关联任务、FTS5 搜索、AI 摘要、YAML 导出 |
| 🪞 **每日复盘** | 5 段模板 + AI 日报 | 完成/未完成/阻塞/明日 3 件事/AI 草稿，必须手动采纳 |
| ⚙️ **设置 + 备份** | 主题、AI、备份/恢复/重置 | 自动+手动备份、`.mmws.json` 格式、卸载保留数据 |

---

## 快速开始

需要：**Node 24** + **pnpm 11** + **Windows 10/11**

```bash
git clone <repo>
cd 个人工作台
pnpm install --ignore-scripts
pnpm run setup
pnpm dev
```

> 为什么 `--ignore-scripts`？pnpm 11 默认禁止 install scripts。本项目 native binary（electron / better-sqlite3 / esbuild）由 `pnpm run setup` 单独处理。详见 [`scripts/setup.cjs`](./scripts/setup.cjs)。

---

## 自己打 NSIS 安装包

```bash
pnpm dist:nsis
# 产物：dist/MiniMaxCode 工作台-0.1.0-x64.exe
```

详细打包、签名、更新源配置见 [`docs/build-and-distribute.md`](./docs/build-and-distribute.md)。

> ⚠️ v0.1.0 **未**真打（首次发布需在干净环境验证 + 配代码签名）。见 [RELEASE_CHECKLIST.md](./RELEASE_CHECKLIST.md)。

---

## 技术栈

| 层 | 选型 |
|---|---|
| 桌面框架 | Electron 33 |
| 前端 | React 18 + TypeScript 5（strict） |
| 构建 | Vite 5 + electron-vite |
| 样式 | Tailwind CSS 3 |
| 状态管理 | Zustand 5 |
| 校验 | Zod |
| 数据库 | SQLite（better-sqlite3）+ Drizzle ORM + FTS5 全文搜索 |
| 凭据 | `@napi-rs/keyring`（Windows Credential Manager，NAPI 跨平台 binary） |
| 包 | electron-builder 25.1.8 + electron-updater 6.8.9 |
| 测试 | Vitest 2 + Testing Library |
| 包管理 | pnpm 11 |

---

## 目录约定

遵循 [`PROJECT_IDENTITY.md §2.3`](./PROJECT_IDENTITY.md)：

```
electron/
  main/        主进程入口、窗口管理、IPC handler
  preload/     预加载脚本，window.api 定义
src/           渲染进程（React）
  pages/       6 大页面（AI / Inbox / Knowledge / Overview / Projects / Review / Settings）
  components/  通用组件
  store/       状态管理（Zustand）
db/            SQLite schema / 迁移 / 种子
shared/        主/渲染共享类型 + Zod schemas
tests/         单元 / 集成测试
docs/          构建 / 发布 / 架构文档
scripts/       工程脚本
build/         electron-builder 资源（icon 占位）
```

---

## 启动命令

```bash
# 开发模式
pnpm dev

# 类型检查
pnpm typecheck

# Lint
pnpm lint
pnpm lint:fix

# 格式化
pnpm format
pnpm format:check

# 单元测试
pnpm test              # 一次性（60-64s）
pnpm test:watch        # 监听模式

# 打包
pnpm build             # 仅 vite build
pnpm dist              # electron-builder 全平台
pnpm dist:nsis         # 仅 Windows NSIS
pnpm dist:dir          # 仅解压目录（开发验证用，不打 installer）

# 数据库
pnpm db:generate       # Drizzle 生成迁移
pnpm db:migrate        # 跑迁移
pnpm db:studio         # 打开 Drizzle Studio
```

---

## 安全基线（红线）

- 主进程 `BrowserWindow` **必须** 配齐：
  - `contextIsolation: true`
  - `nodeIntegration: false`
  - `sandbox: true`
  - `preload: <指向 preload 产物>`
  - CSP 通过 `onHeadersReceived` 注入
- 渲染进程 **严禁** 直接 `require('fs')` / `require('http')` / `require('child_process')`
- 渲染进程只能通过 `window.api`（由 preload `contextBridge.exposeInMainWorld` 暴露）访问主进程能力
- API Key 走 `@napi-rs/keyring`（Windows Credential Manager），**永不**进入渲染进程 / 日志 / 错误 / 导出文件
- IPC payload 全部 Zod `.strict()` 双向校验
- 备份文件不含 apiKey / 绝对路径 / FTS5 虚表数据
- 恢复 / 重置 必须大写 `RESTORE` / `RESET` 二次确认

---

## 当前状态（v0.1.0）

| 项 | 状态 |
|---|---|
| 6 大模块功能完整 | ✅ |
| Test Files | 60 |
| Test Cases | 987（5/5 稳定连跑 60-64s） |
| typecheck / lint | 0 错误 |
| 越界 | 0 |
| `@ts-ignore` / `eslint-disable` | 0 |
| `pnpm dist:nsis` 真打 | ⏳ 待 v0.1.0.1 |
| `build/icon.ico` | ⏳ 待 v0.1.1 |
| 自动更新源 | ⏳ 待 v0.1.1 |

详见 [RELEASE_CHECKLIST.md](./RELEASE_CHECKLIST.md)。

---

## 文档导航

| 文档 | 用途 |
|---|---|
| [PROJECT_IDENTITY.md](./PROJECT_IDENTITY.md) | **项目宪法**：架构、IPC 契约、命名、安全、错误码、验收门禁 |
| [PLAN (1).md](./PLAN%20(1).md) | 产品方案：6 大模块定义 + 17 张卡拆分 |
| [CHANGELOG.md](./CHANGELOG.md) | 全部版本变更记录 |
| [RELEASE_NOTES.md](./RELEASE_NOTES.md) | 当前版本发布说明（终端用户视角） |
| [RELEASE_CHECKLIST.md](./RELEASE_CHECKLIST.md) | 发布收尾检查项 + 后续版本计划 |
| [TASK_TIMES.md](./TASK_TIMES.md) | 17 张卡耗时记录（老大视角） |
| [docs/build-and-distribute.md](./docs/build-and-distribute.md) | NSIS 打包 / 自动更新源配置 / 签名占位说明 |
| [VERSION](./VERSION) | 当前版本号（单文件） |

---

## 仓库约定

- **单写入者规则**：任意时刻一个 worker 写一份代码（`PROJECT_IDENTITY.md §11.1`）
- **跨卡接口**（IPC 类型 / Zod schema）由接口卡先产出，老大批准后再下游
- **任何超出本卡范围的改动** → 停下问老大
- **同一错误超 2 次** → 停下回报，不死磕
- **严格验收门禁**：每张卡必须 `typecheck 0` + `lint 0` + `test 5/5 稳` + `build 0` 才能进下一张

---

## 许可

Private — 炫总个人项目，未授权前**不**得公开分发。
