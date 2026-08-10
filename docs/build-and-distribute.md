# 构建与发布（Build & Distribute）

> 范围：**T5-3 安装与自动更新骨架**。本文档说明怎么打 Windows NSIS 包、配置更新源占位、做基本签名占位、以及本地不解包快速验证。

## 1. 前置

- Node ≥ 20（与 `engines` 一致）
- 已在根目录装好依赖：`pnpm install`
- 项目使用 `electron-vite` 构建 renderer / main / preload，输出到 `out/`
- 打包器：`electron-builder`（devDep） + `electron-updater`（dep）

## 2. 构建脚本

`package.json` 暴露 3 个 dist 入口：

| 命令 | 作用 |
|---|---|
| `pnpm dist` | 全平台默认 target 打包（**当前**= Windows NSIS x64 + macOS dmg + Linux AppImage） |
| `pnpm dist:nsis` | 只打 Windows NSIS x64（开发期快速验证用） |
| `pnpm dist:dir` | 不出 .exe / .dmg，只在 `dist/` 下产出免安装目录（最快冒烟） |

每个命令都先跑 `pnpm build`（electron-vite 三段构建），再用 `electron-builder` 出包，**不**自动 publish（`--publish never`）。

## 3. 打 NSIS 包

```bash
pnpm dist:nsis
```

产物落在 `dist/`：

- `MiniMaxCode 工作台-0.1.0-x64.exe`  —— 安装包（NSIS）
- `MiniMaxCode 工作台-0.1.0-x64.exe.blockmap`  —— 增量更新差分文件

包名由 `electron-builder.yml` 的 `artifactName: ${productName}-${version}-${arch}.${ext}` 决定。

NSIS 安装器特性（见 `electron-builder.yml` 中 `nsis:` 段）：

- `oneClick: false` —— 走向导流程，让用户看 license / 选择目录
- `allowToChangeInstallationDirectory: true` —— 用户可改安装目录
- `createDesktopShortcut: true` / `createStartMenuShortcut: true` —— 桌面 + 开始菜单快捷方式
- `installerLanguages: ['zh_CN', 'en_US']` —— 简中 / 英文
- `deleteAppDataOnUninstall: false` —— **卸载时保留 userData**（用户数据安全；误卸载可恢复）
- `perMachine: false` —— 默认 per-user 安装，**不**需要管理员权限

## 4. 本地冒烟（不出 .exe）

```bash
pnpm dist:dir
```

在 `dist/win-unpacked/`（Windows）下产出可直接双击 `MiniMaxCode 工作台.exe` 运行的免安装目录。**最便宜**的端到端验证：跑通 main 启动 / preload 注入 / renderer 加载。

## 5. 图标（占位）

本卡**不**提供应用图标。`build/` 目录留有 `.gitkeep` 说明。`electron-builder.yml` 中**不**写 `win.icon` / `mac.icon` —— electron-builder 找不到时会用默认占位图，**不影响**功能。

后续发布卡补图时：

- `build/icon.ico`（256×256，Windows）
- `build/icon.png`（512×512，macOS / Linux）
- 在 `electron-builder.yml` 加 `win.icon: build/icon.ico` / `mac.icon: build/icon.png`

## 6. 自动更新源配置（**占位**，不接远端）

更新源通过环境变量 `MINIMAX_UPDATE_FEED_URL` 启用：

- **未设** → 主进程 IPC 立刻返回 `{ available: false, message: 'Update source not configured' }`，**不**触发任何网络请求
- **已设** → `autoUpdater.setFeedURL(url)` + `checkForUpdates()` 触发；T5-3 **不**真正下载 / 安装

T5-3 **不**启用：

- `autoUpdater.autoDownload = false`
- `autoUpdater.autoInstallOnAppQuit = false`

> 后续发布卡接远端时建议：服务端返回 `app-update.yml`（electron-builder 默认产物），feed URL 形如 `https://releases.example.com/minimax-workstation/`。

## 7. 代码签名（**占位**）

T5-3 **不**配置代码签名。Windows 上未签名的 .exe 在 SmartScreen 会被警告，但**不影响**开发期自测。

后续发布卡补签名时，在 `electron-builder.yml` 增加：

```yaml
win:
  # ...
  certificateFile: cert/code-signing.pfx  # 不要 commit
  certificatePassword: ${env.CSC_KEY_PASSWORD}  # 走 env，绝不入仓
  signingHashAlgorithms:
    - sha256
```

**禁止**把 `.pfx` / 私钥 / 密码 commit 到仓库（PROJECT_IDENTITY.md §6.1）。

## 8. 常见问题

- `pnpm dist` 第一次跑会下载 ~80MB electron 二进制（electron-builder cache 到 `%LOCALAPPDATA%/electron-builder/Cache`）
- macOS dmg 需要 macOS 主机；Linux AppImage 需要 Linux 主机。Windows 主机打不出 macOS / Linux 原生包（签名 + 工具链限制）。跨平台打通用 `pnpm dist` 走当前 OS 的 target
- 启动报错 `Cannot find module 'better-sqlite3'` → 走 `pnpm setup` 重新装 native module

## 9. 安全 checklist（T5-3 必过）

- [x] NSIS `deleteAppDataOnUninstall: false` —— 卸载保留用户数据
- [x] `electron-builder.yml` **不**写图标路径（避免 commit 资源）
- [x] `package.json` **不**含 `build` 字段（配置外置到 yml）
- [x] `publish: null` —— 防止 `pnpm dist` 误触远端 publish
- [x] updater handler 错误信息**不**含 feed URL / 绝对路径 / 用户名
- [x] updater handler **不**启用 `autoDownload` / `autoInstallOnAppQuit`
- [x] 签名配置（未来）走 env，绝不入仓

## 10. 相关文件

- `electron-builder.yml` —— 打包配置
- `electron/main/ipc/updater.ts` —— 更新 IPC 骨架
- `shared/schemas/updater.ts` —— 更新 IPC 共享 schema
- `build/.gitkeep` —— 图标资源占位说明
