# MiniMaxCode 个人工作台方案

## 总体定位

做一个 Windows 优先、本地优先的“个人工作台 OS”，统一打通：

`收集 → AI 处理 → 安排任务 → 执行完成 → 复盘沉淀`

第一版同时包含任务、AI、知识三类能力，但只围绕这条主流程展开，不做功能堆砌。

## 技术方案

- 桌面框架：Electron
- 前端：React + TypeScript + Vite
- 数据库：SQLite
- 数据访问：Drizzle ORM 或同等轻量方案
- 校验：Zod
- 本地导出：Markdown、JSON
- Windows 发布：NSIS 安装包
- API Key：存入 Windows Credential Manager，不放进前端或明文配置

MiniMaxCode负责生成和修改代码；运行时的 AI 接入单独抽象为 Provider 层，支持 MiniMax 和其他 OpenAI-compatible 接口，避免以后重写业务逻辑。

## 页面与核心功能

### 1. 总览

显示：

- 今日重点任务
- 逾期任务
- 最近收集内容
- 最近 AI 结果
- 当前项目进度
- 快速输入框

### 2. 收集箱

支持快速记录：

- 一句话想法
- 待办事项
- 粘贴文本
- 文件路径
- 网页链接

每条内容可以交给 AI：

- 提取任务
- 生成笔记
- 总结内容
- 拆分下一步行动
- 归类到项目和标签

### 3. 项目与任务

任务字段保持最小可用：

- 标题
- 描述
- 状态：待处理、进行中、已完成、已归档
- 优先级
- 截止日期
- 所属项目
- 标签
- 来源：手动、AI、收集箱
- 关联笔记

支持列表视图和简单看板，不在第一版加入复杂甘特图。

### 4. AI 工作区

提供统一输入区和结果区：

- 对话
- 文本总结
- 任务提取
- 笔记整理
- 改写与翻译
- 本地知识检索

AI 结果必须先进入“待确认区”，用户确认后才能写入任务或笔记。

### 5. 知识库

第一版支持：

- Markdown 笔记
- 标签
- 全文搜索
- 笔记与项目、任务关联
- AI 生成摘要
- 一键导出

暂不做复杂向量数据库，先用 SQLite 全文搜索，降低维护成本。

### 6. 每日复盘

提供固定模板：

- 今天完成了什么
- 哪些任务未完成
- 遇到的阻塞
- 明天最重要的三件事
- AI 自动生成的日报草稿

## 核心接口

```ts
type TaskStatus = "todo" | "doing" | "done" | "archived";

type AiAction =
  | "chat"
  | "summarize"
  | "extract_tasks"
  | "create_note"
  | "rewrite"
  | "search_knowledge";

interface ProviderAdapter {
  chat(input: ChatInput): AsyncIterable<ChatChunk>;
  extractJson<T>(input: JsonExtractionInput, schema: ZodSchema<T>): Promise<T>;
}

interface TaskDraft {
  title: string;
  description?: string;
  priority?: "low" | "medium" | "high";
  dueDate?: string;
  projectId?: string;
  tags?: string[];
}
```

Electron 主进程负责数据库、文件系统和 API 调用；React 渲染进程只通过受控 IPC 接口访问这些能力。

## MiniMaxCode 分阶段执行

### 阶段 1：应用骨架

交付：

- Electron + React + TypeScript 工程
- 主窗口和左侧导航
- SQLite 初始化
- IPC 通信层
- 基础主题和错误提示

验收：应用可启动，数据库可创建，离线状态下不崩溃。

### 阶段 2：任务主链

交付：

- 收集箱
- 项目
- 任务列表
- 状态流转
- 今日视图
- 任务与收集内容关联

验收：可以完成“快速记录 → 安排任务 → 标记完成”的完整流程。

### 阶段 3：AI 接入

交付：

- Provider 抽象
- MiniMax 适配器
- OpenAI-compatible 适配器
- 流式输出
- JSON 结构化提取
- AI 结果确认后写入数据库

验收：API 成功、失败、超时、返回非法 JSON 时，原始输入都不会丢失。

### 阶段 4：知识沉淀

交付：

- Markdown 笔记
- 标签
- 全文搜索
- 笔记与任务关联
- AI 摘要和归档

验收：一条收集内容可以转成笔记，并能从项目或搜索中找到。

### 阶段 5：复盘与发布

交付：

- 每日复盘
- Markdown/JSON 导出
- 数据库备份
- 设置页
- Windows 安装包
- 基础自动更新预留

验收：新电脑安装后可运行，能够导出和恢复个人数据。

## 测试与安全门槛

必须覆盖：

- 创建、编辑、完成和恢复任务
- 删除前确认
- API 失败和网络断开
- AI 返回非法结构
- 数据库升级
- 应用异常退出后的数据恢复
- 导出后重新导入
- API Key 不出现在渲染进程、日志和导出文件中
- 无 API Key 时，任务和知识库仍可正常使用

## 明确不做

第一版不加入：

- 多用户协作
- 云端同步
- 手机 App
- 日历双向同步
- 复杂权限系统
- 自动执行高风险文件操作
- 让多个模型直接同时修改同一份项目代码

## 推荐交付节奏

按 10～14 个工作日拆成 6 张独立任务卡，每张卡都要求：

- 输入和依赖明确
- 只修改指定范围
- 附带测试
- 说明已知问题
- 通过验收后再进入下一张卡

默认采用“单一写入者”原则：MiniMaxCode 可以批量生成候选实现，但最终合并、测试和发布必须经过一次统一审查。
