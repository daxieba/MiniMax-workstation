# v0.1.0 Release Checklist

> 老大（AI orchestrator）维护。每项 ✓/✗ 后注明完成时间 + 证据位置。
> 此文件在 v0.1.0 发布后冻结，作为 v0.1.1 起点。

## ✅ 已完成（17 / 17 卡）

| 项 | 状态 | 证据 |
|---|---|---|
| 6 大模块功能完整 | ✅ | T2-2 / T2-3 / T2-4 / T3-3 / T4-1 / T4-2 / T4-3 / T5-1 / T5-2 |
| typecheck 0 错误 | ✅ | `pnpm typecheck` exit 0 |
| lint 0 错误 0 警告 | ✅ | `pnpm lint` exit 0 |
| test 5/5 稳定连跑 | ✅ | 60 files / 987 cases / 60-64s/run |
| build 成功 | ✅ | `pnpm build` out/{main,preload,renderer} 齐全 |
| 0 个 @ts-ignore / eslint-disable | ✅ | grep 0 匹配 |
| 0 越界 | ✅ | 每张卡越界自检 9-11 项全过 |
| 50MB 备份上限 + 路径穿越保护 | ✅ | T5-2 backupService.ts:402 + :650 |
| Zod 严格 IPC 校验 | ✅ | 全部 IPC payload `.strict()` |
| API Key 走 @napi-rs/keyring | ✅ | T3-1 + 身份卡 §6.1 |
| NSIS deleteAppDataOnUninstall: false | ✅ | electron-builder.yml |
| 自动更新 env-gated | ✅ | updater.ts:43 `UPDATE_FEED_ENV` |
| 17/17 卡通过 | ✅ | TASK_TIMES.md |

## ⏳ 待炫总拍板（不可逆 / 外部动作）

| 项 | 状态 | 备注 |
|---|---|---|
| `git init` + 首次 commit | ✅ | `2faf700` Mavis <mavis@MiniMax.local> "release: v0.1.0"（203 files / 47724 insertions） |
| `git tag v0.1.0` | ✅ | annotated tag，message 在 `git tag -n3 v0.1.0` 可查 |
| `pnpm dist:nsis` 真打 | ⏳ | 下载 ~80MB electron + NSIS 工具链，需稳定网络；建议在干净环境跑 |
| `pnpm dist:dir` 真打 | ✅ | **v0.1.0.1** `d779fd8` `7za-wrapper` C# wrapper 解 7-Zip 21.07/26.02 不支持 `-snld` 的问题；产物 `dist\win-unpacked\MiniMaxCode 工作台.exe` (180MB) |
| 代码签名 | ⏳ | 需炫总提供证书（`.pfx`） |
| macOS / Linux 真打 | ⏳ | 需对应平台机器；macOS 需 codesign + notarize |
| 自动更新源配置 | ⏳ | 配 `MINIMAX_UPDATE_FEED_URL` env + electron-builder `publish` 字段 |
| remote 推送 | ⏳ | 炫总后续如需推到 GitHub / Gitea，告诉我 remote URL，我配上去 |

## 📋 v0.1.1 计划（社区可参与）

- [ ] 提供 `build/icon.ico`（最小 256x256 PNG 转 ICO）
- [ ] T4-3 NoteExportDialog "浏览"按钮迁到 `dialog:showOpenDialog` IPC
- [ ] `NOT_IMPLEMENTED` 错误码进 `PROJECT_IDENTITY §4.4` 枚举
- [ ] Settings footer 去重（删 footer 版本号；保留 Section 6 即可）
- [ ] 实际跑 `pnpm dist:nsis` 验证产物（在 Windows 10/11 干净环境）
- [ ] README 截图补全（6 大模块 + 设置页）

## 📋 v0.1.0.1 已发布（2026-08-10）

- ✅ `pnpm dist:dir` 在 Windows 普通用户下跑通（fix commit `d779fd8`）
  - 7za-wrapper/Wrapper.cs — C# wrapper 转 `-snld` → `-xr!darwin -xr!linux`
  - scripts/install-wrapper.cjs — 自动化编译 wrapper（idempotent）
  - package.json — 7zip-bin 提到 devDependencies
- ✅ 产物：`D:\AI-project\MiniMax-project\个人工作台\dist\win-unpacked\MiniMaxCode 工作台.exe` (180 MB)
- 7-Zip 行为变更记录：7-Zip 25.01 起对 tar/zip 加了 symlink 安全检查，但**没**对 7z 格式加；所以 7-Zip 21.07 / 26.02 在 Windows 普通用户解压 winCodeSign 仍会失败。wrapper 永久绕开。

## 📋 v0.2 计划（功能扩展）

- [ ] 多端同步（WebDAV / 本地 NAS）
- [ ] 加密备份（用户口令 + AES-256-GCM）
- [ ] 笔记协作（CRDT / Yjs）
- [ ] 任务依赖（blocker / 子任务）
- [ ] 番茄钟 / 时间追踪
- [ ] 主题市场

## 📋 v0.3 计划（高级功能）

- [ ] 插件系统（沙箱 iframe + IPC）
- [ ] 多 provider 编排（MiniMax 处理 chat，DeepSeek 处理提取）
- [ ] 本地 LLM 接入（llama.cpp / Ollama）

---

**发布日**：2026-08-10
**维护者**：Mavis（Mavis 编排）+ 炫总（产品决策）
**反馈渠道**：见 RELEASE_NOTES.md

---

## 收尾记录

| 时间 | 动作 | 操作者 |
|---|---|---|
| 2026-08-10 12:14 | T5-1 验收通过 | Mavis |
| 2026-08-10 13:27 | T5-2 验收通过 | Mavis |
| 2026-08-10 15:26 | T5-3 派单 | 炫总 |
| 2026-08-10 16:28 | T5-3 验收通过 | Mavis |
| 2026-08-10 15:55 | 聚合发布物（README / CHANGELOG / RELEASE_NOTES / RELEASE_CHECKLIST / VERSION） | Mavis |
| 2026-08-10 15:55 | git 收尾（init / .gitignore / commit `2faf700` / tag `v0.1.0`） | 炫总决策 + Mavis 执行 |
