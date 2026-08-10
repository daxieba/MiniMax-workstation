# MiniMaxCode 个人工作台 — 长期身份卡

> **使用方式**：本文件是所有子 agent 启动时的**必读第一文件**。每张任务卡的分发指令包都必须在开头写：
> "请先完整读取本项目根目录的 `PROJECT_IDENTITY.md`，再开始执行。"
> 任何与本文件冲突的卡内指令，**以本文件为准**。如有冲突无法判断，停下来问老大（Mavis），不要自行决定。

---

## 1. 项目身份

- **项目名**：MiniMaxCode 个人工作台
- **定位**：Windows 优先、本地优先的"个人工作台 OS"
- **核心闭环**：`收集 → AI 处理 → 安排任务 → 执行完成 → 复盘沉淀`
- **第一版范围**：6 大模块（总览 / 收集箱 / 项目与任务 / AI 工作区 / 知识库 / 每日复盘），仅围绕主闭环，不堆功能
- **第一版不做的硬约束**：
  - 多用户协作
  - 云端同步
  - 手机 App
  - 日历双向同步
  - 复杂权限系统
  - 自动执行高风险文件操作
  - 多个模型同时修改同一份项目代码

---

## 2. 架构基线

### 2.1 技术栈（锁定）

| 层 | 选型 |
|---|---|
| 桌面框架 | Electron |
| 前端 | React + TypeScript + Vite |
| 数据库 | SQLite（better-sqlite3） |
| ORM | Drizzle ORM |
| 校验 | Zod |
| 本地导出 | Markdown / JSON |
| 桌面打包 | NSIS |
| 凭据存储 | Windows Credential Manager（`@napi-rs/keyring`，NAPI 跨平台） |
| AI 协议 | OpenAI-compatible（含 MiniMax） |

任何子 agent 引入新依赖前，**必须先问老大**。

### 2.2 进程边界（强约束）

- **主进程（main）**：文件系统、SQLite、网络、Keychain、子进程
- **预加载（preload）**：唯一对外暴露 `window.api` 的位置
- **渲染进程（renderer）**：**严禁**直接访问 Node、fs、network；只能通过 `window.api`
- 渲染进程**永远拿不到** API Key、原始数据库连接

### 2.3 目录约定

```
/
├── electron/
│   ├── main/          # 主进程入口、窗口管理、IPC handler
│   ├── preload/       # 预加载脚本，window.api 定义
│   └── shared/        # 主预共享类型
├── src/               # 渲染进程（React）
│   ├── pages/         # 6 大页面
│   ├── components/    # 通用组件
│   ├── hooks/         # 自定义 hooks
│   ├── store/         # 状态管理
│   ├── styles/        # 全局样式、主题
│   └── lib/           # 渲染端工具
├── db/
│   ├── schema/        # Drizzle schema
│   ├── migrations/    # 数据库迁移
│   └── seed/          # 种子数据
├── shared/            # 主/渲染共享类型、Zod schema
├── tests/             # 单元测试、集成测试
├── resources/         # 静态资源、图标
└── package.json
```

子 agent 只能修改本卡指定的目录，**严禁跨目录改东西**。

---

## 3. 命名与代码风格

### 3.1 命名

- **组件**：`PascalCase`（`TaskList.tsx`）
- **函数 / 变量**：`camelCase`（`getTaskById`）
- **类型 / 接口**：`PascalCase`，接口不加 `I` 前缀（`Task` 而非 `ITask`）
- **常量**：`UPPER_SNAKE_CASE`（`MAX_TITLE_LENGTH`）
- **文件**：`kebab-case.ts`（除组件 `.tsx` 用 PascalCase）
- **数据库表**：`snake_case` 复数（`tasks`、`inbox_items`）
- **IPC 通道**：`namespace:action`（`task:create`、`inbox:add`）

### 3.2 代码风格

- TypeScript `strict: true`，禁用 `any`（必要时 `unknown` + 类型守卫）
- 使用 ESM，不要 CommonJS
- React 函数组件 + Hooks，不用 class
- 状态管理优先 Zustand（避免 Redux 样板）
- 样式用 CSS Modules 或 Tailwind（**优先 Tailwind**）
- 所有公共函数 / 导出符号必须写 JSDoc

### 3.3 导入顺序

```ts
// 1. Node/第三方
import { z } from "zod";

// 2. 共享类型
import type { Task } from "@shared/types";

// 3. 主进程 / 项目内
import { db } from "../db/client";

// 4. 相对路径
import { TaskCard } from "./TaskCard";

// 5. 样式
import styles from "./TaskList.module.css";
```

---

## 4. IPC 契约

### 4.1 通道命名

`{domain}:{action}` 全小写，例：`task:create`、`inbox:list`、`ai:chat`。

### 4.2 请求 / 响应格式

```ts
// 请求
{ id: string; payload: unknown }

// 成功响应
{ id: string; ok: true; data: T }

// 失败响应
{ id: string; ok: false; error: { code: string; message: string; details?: unknown } }
```

### 4.3 Handler 实现基线

```ts
ipcMain.handle("task:create", async (_evt, payload: unknown) => {
  try {
    const input = TaskCreateSchema.parse(payload);  // Zod 必加
    const data = await createTask(input);
    return { ok: true, data };
  } catch (err) {
    logger.error("task:create failed", { err });
    return {
      ok: false,
      error: toIpcError(err),  // 统一错误转换，禁止直透
    };
  }
});
```

**所有 IPC handler 必须**：
- 入口 Zod 校验
- try/catch 全包
- 不返回原始异常对象
- 不在日志中打印 payload 里的敏感字段

### 4.4 错误码（统一）

| 码 | 含义 |
|---|---|
| `VALIDATION_FAILED` | Zod 校验失败 |
| `NOT_FOUND` | 资源不存在 |
| `CONFLICT` | 状态冲突（如重复创建） |
| `DEPENDENCY_MISSING` | 前置依赖缺失（如未配 API Key） |
| `EXTERNAL_FAILURE` | 外部服务失败（AI / 网络） |
| `PERSISTENCE_FAILED` | 数据库操作失败 |
| `INTERNAL` | 未分类内部错误 |

---

## 5. 数据基线

### 5.1 SQLite 位置

- 开发：`./.data/workstation.db`
- 生产：`%APPDATA%/MiniMaxCode/workstation.db`

### 5.2 迁移

- 每次 schema 变更**必须**新增一个迁移文件
- 文件名格式：`NNNN_name.sql`（4 位递增）
- **严禁**直接改已应用的迁移
- 启动时自动跑迁移，跑过的不再跑

### 5.3 必加字段

每张业务表都加：

```ts
{
  id: text("id").primaryKey(),  // ULID
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
}
```

软删除字段（按需）：

```ts
deletedAt: integer("deleted_at", { mode: "timestamp" }),
```

### 5.4 ID 生成

统一用 ULID，不用自增 ID。

---

## 6. 安全基线（红线）

### 6.1 API Key 处理

- **存储**：`@napi-rs/keyring`（NAPI 跨平台），service = `minimax-workstation`，account = `provider:<providerName>`
- **明文落盘**：严禁
- **日志输出**：严禁（所有 `console.log` / `logger.info` 必须经过脱敏 filter）
- **导出文件**：严禁
- **错误信息**：禁止回显 Key 内容
- **IPC 透传**：渲染进程**永远不接收** Key，Provider 内部读取

### 6.2 IPC 隔离

- `contextIsolation: true`
- `nodeIntegration: false`
- `sandbox: true`（能开就开）
- 预加载脚本只暴露 `window.api` 一个对象，**白名单** API

### 6.3 输入校验

- 所有 IPC 入口必过 Zod
- 所有外部数据（AI 返回、文件内容、URL）必过 Zod 或显式 sanitize
- AI 返回 JSON 失败 → 原始输入保留，绝不丢失

### 6.4 危险操作

- 删除 / 覆盖 / 批量修改 → 必须二次确认
- 数据库迁移 → 启动前自动备份
- 文件系统写操作 → 限定在用户工作目录内

---

## 7. 错误处理基线

### 7.1 渲染端

- 任何 IPC 失败 → toast / inline error 提示用户
- 永远不白屏
- 网络断开 / API 失败 → 降级到本地能力 + 明确文案

### 7.2 主进程

- 任何未捕获异常 → 写入 `logs/error.log` + 弹窗（首次）+ 优雅退出
- 不静默吞错

### 7.3 日志

- 路径：`%APPDATA%/MiniMaxCode/logs/`
- 轮转：单文件 5MB，最多 5 个
- 格式：`[ISO时间] [LEVEL] [module] message {context}`
- **禁止记录**：API Key、用户输入原文、文件路径含用户名（可哈希）

---

## 8. 测试基线

### 8.1 框架

- 单元 / 集成：Vitest
- E2E（后期阶段）：Playwright

### 8.2 覆盖要求

每张卡至少包含：

| 类型 | 最低要求 |
|---|---|
| 单元测试 | 所有新公共函数 / 工具 |
| 状态机测试 | 所有状态流转路径 + 非法路径 |
| 集成测试 | 关键 IPC handler 端到端 |
| 安全测试 | Key 不落日志 / 渲染进程不可见 / 导出不含 Key |

测试必须和卡同 PR 提交，不接受"后续补"。

### 8.3 运行命令

```bash
pnpm test          # 全量
pnpm test:watch    # 监听
pnpm test:coverage # 覆盖率（目标 ≥ 70%）
```

---

## 9. 性能预算

- 冷启动 ≤ 3s（不含 AI 初始化）
- 首屏可交互 ≤ 1s
- 列表渲染 1000 条 ≤ 16ms / 帧
- AI 流式首 token ≤ 2s
- SQLite 单查询 ≤ 50ms

---

## 10. 交付物格式（每张卡必须）

子 agent 完成时返回：

```markdown
## 卡号：T?-?
## 状态：已完成 / 部分完成 / 失败

### 变更清单
- 新增：path/to/file (用途)
- 修改：path/to/file (改了啥)
- 删除：path/to/file (原因)

### 测试
- [x] 单测通过
- [x] 集成测试通过
- [x] 安全 checklist 通过

### 验收对照
- 验收点 1：✅ / ❌（说明）
- 验收点 2：✅ / ❌（说明）

### 已知问题
- (无 / 问题描述 + 建议处理时机)

### 越界检查
- (没有越界 / 列了越界的东西并说明原因)
```

---

## 11. 协作契约（与老大）

### 11.1 单一写入者

任意时刻**一个 worker 写一份代码**。并行只允许在不同分支 / 不同文件树。

### 11.2 接口锁定

跨卡接口卡（T1-3、T3-1）必须先产出 TypeScript 类型 / Zod schema，老大批准后才能进入下游卡。

### 11.3 越界处理

子 agent 发现指令包不清晰 / 缺依赖 / 范围超出本卡 → **立刻停下问老大**，不要自行扩张。

### 11.4 失败处理

子 agent 在一张卡内卡住超过 2 次同类型错误 → 停下回报，**不要死磕**。

### 11.5 验收门禁（强约束）

**每张卡必须通过验收才能进入下一张**。
- 不通过 → 老大打回，子 agent 必须重做
- 改到全部验收点通过 → 才放行下一张
- 改的次数没有上限（直到通过为止），但同一类错误超 3 次 → 升级到老大，停下回报
- 严禁"标部分完成 + 继续推下一张"——这是被禁止的妥协

子 agent 返工时，老大必须明确指出：
- 哪些验收点未过
- 期望的修复方向
- 是否需要重读身份卡某节

### 11.6 不重复造轮子

- 看到别的卡可能用得上的代码，**先看是否已存在**
- 已有工具就用，没有再写
- 写完标注 `@used-by` 注释给后续卡参考

---

## 12. 禁止事项

- ❌ 引入方案外的依赖（未与老大确认前）
- ❌ 在渲染进程写 `fs` / `http` / `child_process`
- ❌ 把 API Key 放到任何文件 / 日志 / 错误信息
- ❌ 跳过 Zod 校验"省时间"
- ❌ 直接修改已应用的数据库迁移
- ❌ 自动执行删除 / 覆盖（必须二次确认）
- ❌ 让多个 worker 改同一个文件
- ❌ 提交未通过的测试
- ❌ 提交时把 `.env`、Key 文件一起 commit
- ❌ 跨卡修改未授权的代码

---

## 13. 变更日志

| 日期 | 变更 | 原因 |
|---|---|---|
| 2026-08-07 | 初版 | 项目启动 |

---

**最后再强调一次**：本文件是项目宪法。任何与本文件冲突的临时指令、子 agent 的"自由发挥"、外部建议，**统统以本文件为准**。有疑问问老大。
