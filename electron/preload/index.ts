import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { z } from 'zod';
import { ResolvedThemeSchema, ThemeSourceSchema } from '../shared/types';
import {
  AppMetaKeySchema,
  AppMetaSetInputSchema,
  AppMetaValueSchema,
  AppVersionSchema,
  DbStatusSchema,
  StorageInfoSchema,
} from '../../shared/schemas/db';
import {
  MaybeAutoBackupResponseSchema,
  SetSettingsInputSchema,
  type SettingsParsed,
} from '../../shared/schemas/appSettings';
import {
  BackupNowInputSchema,
  BackupNowResponseSchema,
  DeleteBackupInputSchema,
  DeleteBackupResponseSchema,
  ExportDataInputSchema,
  ExportDataResponseSchema,
  GetPathsResponseSchema,
  ImportDataInputSchema,
  ImportDataResponseSchema,
  ListBackupsResponseSchema,
  ResetDataInputSchema,
  ResetDataResponseSchema,
  RestoreBackupInputSchema,
  RestoreBackupResponseSchema,
  type BackupNowResponseParsed,
  type DeleteBackupResponseParsed,
  type ExportDataResponseParsed,
  type GetPathsResponseParsed,
  type ImportDataResponseParsed,
  type ListBackupsResponseParsed,
  type ResetDataResponseParsed,
  type RestoreBackupResponseParsed,
} from '../../shared/schemas/backup';
import {
  ShowOpenDialogInputSchema,
  ShowOpenDialogResponseSchema,
  ShowSaveDialogInputSchema,
  ShowSaveDialogResponseSchema,
  type ShowOpenDialogResponseParsed,
  type ShowSaveDialogResponseParsed,
} from '../../shared/schemas/dialog';
import {
  CheckForUpdateResponseDataSchema,
  type CheckForUpdateResponseDataParsed,
} from '../../shared/schemas/updater';
import {
  InboxArchiveInputSchema,
  InboxConvertToTaskInputSchema,
  InboxConvertToTaskResponseSchema,
  InboxItemListSchema,
  InboxItemSchema,
  InboxListFilterSchema,
  InboxUpdateInputSchema,
  type InboxItemParsed,
} from '../../shared/schemas/inbox';
import {
  CreateProjectInputSchema,
  ProjectArchiveInputSchema,
  ProjectDeleteInputSchema,
  ProjectDeleteResponseSchema,
  ProjectListFilterSchema,
  ProjectListSchema,
  ProjectSchema,
  UpdateProjectInputSchema,
  type ProjectParsed,
} from '../../shared/schemas/project';
import {
  CreateTaskInputSchema,
  TaskArchiveInputSchema,
  TaskDeleteInputSchema,
  TaskDeleteResponseSchema,
  TaskGetInputSchema,
  TaskListFilterSchema,
  TaskListSchema,
  TaskSchema,
  TaskTransitionInputSchema,
  UpdateTaskInputSchema,
  type TaskParsed,
} from '../../shared/schemas/task';
import {
  CreateNoteInputSchema,
  LinkNoteToTaskInputSchema,
  NoteArchiveInputSchema,
  NoteDeleteInputSchema,
  NoteDeleteResponseSchema,
  NoteExportRequestSchema,
  NoteExportResponseSchema,
  NoteGetInputSchema,
  NoteListFilterSchema,
  NoteListSchema,
  NoteSchema,
  UnlinkNoteFromTaskInputSchema,
  UpdateNoteInputSchema,
  type NoteParsed,
} from '../../shared/schemas/note';
import {
  ReviewGenerateDraftInputSchema,
  ReviewGenerateDraftResponseSchema,
  ReviewGetByDateInputSchema,
  ReviewGetByDateResponseSchema,
  ReviewListRecentInputSchema,
  ReviewListRecentResponseSchema,
  ReviewSchema,
  ReviewUpdateInputSchema,
  ReviewUpsertInputSchema,
  type ReviewParsed,
} from '../../shared/schemas/review';
import type { ReviewDraft } from '../../shared/types/review';
import { NotifyInputSchema } from '../../shared/schemas/notification';
import {
  ArchiveHabitInputSchema,
  CreateHabitInputSchema,
  DeleteHabitInputSchema,
  HabitListFilterSchema,
  HabitListSchema,
  HabitLogListSchema,
  HabitSchema,
  ListHabitLogsInputSchema,
  LogsInRangeInputSchema,
  ToggleHabitLogInputSchema,
  UpdateHabitInputSchema,
  type HabitParsed,
  type HabitLogParsed,
} from '../../shared/schemas/habit';
import { SearchResultsSchema, type SearchResult } from '../../shared/schemas/search';
import { SearchQuerySchema } from '../../shared/types/search';
import {
  AiGetConfigResponseSchema,
  AiHasKeyResponseSchema,
  AiOkResponseSchema,
  AiProviderInputSchema,
  AiSetConfigInputSchema,
  AiSetConfigResponseSchema,
  AiSetKeyInputSchema,
  AiTestConnectionResponseSchema,
  ChatCancelRequestSchema,
  ChatChunkEnvelopeSchema,
  ChatRequestSchema,
  ExtractJsonRequestSchema,
  ExtractJsonResponseDataSchema,
  ProviderMetadataListSchema,
  type ChatMessageParsed,
  type ProviderIdParsed,
  type ProviderMetadataParsed,
} from '../../shared/schemas/ai';

/**
 * 预加载脚本：通过 contextBridge 在主世界暴露白名单 API（window.api）。
 *
 * 强制规则（PROJECT_IDENTITY.md §2.2 / §6.2）：
 *   - 只能通过 contextBridge.exposeInMainWorld('api', { ... }) 暴露
 *   - 暴露的每个方法必须在 WindowApi 类型中声明
 *   - 实现放主进程，通过 ipcRenderer.invoke 触发 ipcMain.handle
 *   - 严禁把 fs / http / child_process 直接暴露给渲染进程
 *
 * T1-1 仅放一个无副作用的 version() 占位方法。
 * T1-2 扩展：app.getThemeSource / app.getThemeSource / app.onThemeChange
 *           （订阅主进程推送）。
 * T1-3 扩展：app.getVersion / app.getDbStatus / app.getAppMeta / app.setAppMeta
 *           （db 状态 + 基础元数据读写，给后续业务卡用）。
 */

/** 主题变更事件 payload 校验。 */
const ThemeChangedPayloadSchema = ResolvedThemeSchema;

/** 主题设置响应（成功分支）校验。 */
const ThemeSetResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    source: ThemeSourceSchema,
    resolved: ResolvedThemeSchema,
  }),
});

/** 主题设置响应（失败分支）校验。 */
const ThemeSetErrorResponseSchema = z.object({
  ok: z.literal(false),
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});

/** 通用 IPC 成功响应 schema：data 是任意 Zod schema。 */
function successSchema<T extends z.ZodTypeAny>(data: T) {
  return z.object({ ok: z.literal(true), data });
}

/** 通用 IPC 失败响应 schema。 */
const errorResponseSchema = z.object({
  ok: z.literal(false),
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
  }),
});

/** 客户端入参 schema：`inbox:add` 的前端防线。 */
const AddInboxInputClientSchema = z.object({
  content: z.string().min(1).max(65536),
  kind: z.enum(['note', 'todo', 'file', 'link']),
  source: z.enum(['manual', 'ai', 'inbox']).optional(),
  status: z.enum(['active', 'archived', 'converted']).optional(),
  convertedTo: z.string().min(1).max(256).nullable().optional(),
  projectId: z.string().min(1).max(64).nullable().optional(),
  tags: z.array(z.string().min(1).max(64)).max(256).optional(),
});

/** 调 IPC 的通用工具：把响应解析成 `{ ok, data }` 或 `{ ok, error }`。 */
async function invokeIpc<T extends z.ZodTypeAny>(
  channel: string,
  payload: unknown,
  successData: T,
): Promise<
  { ok: true; data: z.infer<T> } | { ok: false; error: { code: string; message: string } }
> {
  const raw: unknown = await ipcRenderer.invoke(channel, payload);
  // 显式构造成功对象（避免 zod 的 optional inference 触发 union mismatch）
  const successParsed = successSchema(successData).safeParse(raw);
  if (successParsed.success) {
    return { ok: true, data: successParsed.data.data };
  }
  const errParsed = errorResponseSchema.safeParse(raw);
  if (errParsed.success) return errParsed.data;
  throw new Error(`Invalid IPC response for ${channel}`);
}

const api = {
  /** 返回当前应用版本号（来自 package.json）。 */
  version(): string {
    return '0.1.0';
  },

  /**
   * 主题相关 API（T1-2）+ 应用/db 基础 API（T1-3）。
   *
   * 所有方法遵循：
   *   - 入参先经 Zod 校验，失败抛错或返回错误对象
   *   - 不直接返回原始异常
   *   - 不暴露 ipcRenderer / ipcMain 引用
   *
   * **T1-3 新增**：
   *   - `getVersion()`     → 返回应用版本号
   *   - `getDbStatus()`    → 返回 db 状态
   *   - `getAppMeta(key)`  → 读 `app_meta`（key 不存在时 value=null）
   *   - `setAppMeta(key, value)` → 写 `app_meta`（upsert）
   */
  app: {
    /** 获取当前主题源（light / dark / system）。 */
    async getThemeSource(): Promise<'light' | 'dark' | 'system'> {
      const raw: unknown = await ipcRenderer.invoke('app:getThemeSource');
      return ThemeSourceSchema.parse(raw);
    },

    /**
     * 获取解析后的当前主题（深 / 浅）。当 themeSource 为 system 时由主进程给出。
     */
    async getResolvedTheme(): Promise<'light' | 'dark'> {
      const raw: unknown = await ipcRenderer.invoke('app:getResolvedTheme');
      return ResolvedThemeSchema.parse(raw);
    },

    /**
     * 设置主题源。返回 `{ source, resolved }`。
     * 失败时返回 `{ ok: false, error }` 形态，由渲染端处理。
     */
    async setThemeSource(
      source: 'light' | 'dark' | 'system',
    ): Promise<
      | { ok: true; data: { source: 'light' | 'dark' | 'system'; resolved: 'light' | 'dark' } }
      | { ok: false; error: { code: string; message: string } }
    > {
      const payload = ThemeSourceSchema.parse(source);
      const raw: unknown = await ipcRenderer.invoke('app:setThemeSource', payload);
      const parsed = ThemeSetResponseSchema.safeParse(raw);
      if (parsed.success) return parsed.data;
      // 尝试当作错误响应解析；解析失败则视为协议错误
      const errParsed = ThemeSetErrorResponseSchema.safeParse(raw);
      if (errParsed.success) return errParsed.data;
      throw new Error('Invalid IPC response for app:setThemeSource');
    },

    /**
     * 订阅主题变更事件。回调接收解析后的主题（深 / 浅）。
     * 返回取消订阅函数。
     */
    onThemeChange(callback: (resolved: 'light' | 'dark') => void): () => void {
      const handler = (_event: IpcRendererEvent, payload: unknown): void => {
        const parsed = ThemeChangedPayloadSchema.safeParse(payload);
        if (parsed.success) {
          callback(parsed.data);
        }
      };
      ipcRenderer.on('app:theme-changed', handler);
      return () => {
        ipcRenderer.removeListener('app:theme-changed', handler);
      };
    },

    /**
     * 返回应用版本号（来自 package.json，T1-3）。
     * 成功返回字符串；IPC 协议错误时抛 Error（理论上不会发生）。
     */
    async getVersion(): Promise<string> {
      const raw: unknown = await ipcRenderer.invoke('app:getVersion');
      return AppVersionSchema.parse(raw);
    },

    /**
     * 返回 db 状态（T1-3）。**渲染端**拿到的是已经过 Zod 校验的安全对象。
     */
    async getDbStatus(): Promise<
      | { ok: true; data: { ready: boolean; path: string; schemaVersion: number } }
      | { ok: false; error: { code: string; message: string } }
    > {
      return invokeIpc('app:getDbStatus', undefined, DbStatusSchema);
    },

    /**
     * 读 `app_meta` 单行（T1-3）。key 不存在时返回 `{ key, value: null }`。
     */
    async getAppMeta(
      key: string,
    ): Promise<
      | { ok: true; data: { key: string; value: string | null } }
      | { ok: false; error: { code: string; message: string } }
    > {
      const parsedKey = AppMetaKeySchema.parse(key);
      return invokeIpc('app:getAppMeta', parsedKey, AppMetaValueSchema);
    },

    /**
     * 写 `app_meta` 单行（T1-3，upsert）。
     * 失败时返回 `{ ok: false, error }` 形态。
     */
    async setAppMeta(
      key: string,
      value: string,
    ): Promise<
      | { ok: true; data: { key: string; value: string | null } }
      | { ok: false; error: { code: string; message: string } }
    > {
      const payload = AppMetaSetInputSchema.parse({ key, value });
      return invokeIpc('app:setAppMeta', payload, AppMetaValueSchema);
    },

    /**
     * 检查应用更新（T5-3 骨架）。
     *
     * 行为：
     *   - `process.env.MINIMAX_UPDATE_FEED_URL` 未设 → 返回
     *     `{ available: false, message: 'Update source not configured' }`（**不**报错）
     *   - 已设 → 主进程触发 `autoUpdater.setFeedURL + checkForUpdates()`，
     *     返回 `{ available: false, message: 'Check initiated' }`（结果待事件回调）
     *
     * T5-3 阶段**不**接远端；后续发布卡把真更新结果透传出来。
     */
    async checkForUpdate(): Promise<
      | { ok: true; data: CheckForUpdateResponseDataParsed }
      | { ok: false; error: { code: string; message: string } }
    > {
      return invokeIpc('app:checkForUpdate', {}, CheckForUpdateResponseDataSchema);
    },

    /**
     * 触发更新下载（T5-3 骨架：未接远端时一律返回 NOT_IMPLEMENTED）。
     */
    async downloadUpdate(): Promise<
      | { ok: true; data: { ok: true; message: string } }
      | { ok: false; error: { code: string; message: string } }
    > {
      // 响应 data 形状用 inline schema（与 dialog 写法保持一致）
      const DataSchema = z.object({
        ok: z.literal(true),
        message: z.string().min(1).max(256),
      });
      return invokeIpc('app:downloadUpdate', {}, DataSchema);
    },

    /**
     * v0.3.0: 桌面通知（任务到期 / 番茄完成 / 自定义）。
     * 调主进程系统通知 API；link 可选（点击通知打开外链）。
     */
    async notify(input: {
      title: string;
      body?: string;
      link?: string;
    }): Promise<
      | { ok: true; data: { shown: boolean } }
      | { ok: false; error: { code: string; message: string } }
    > {
      const payload = NotifyInputSchema.parse(input);
      const DataSchema = z.object({ shown: z.boolean() });
      return invokeIpc('app:notify', payload, DataSchema);
    },

    /**
     * v0.4.0: 读数据存储信息（db size / db path / userDataDir）。
     * 给 Settings → 数据存储 section 用。
     */
    async getStorageInfo(): Promise<
      | {
          ok: true;
          data: { dbSizeBytes: number; dbPath: string; userDataDir: string };
        }
      | { ok: false; error: { code: string; message: string } }
    > {
      return invokeIpc('app:getStorageInfo', {}, StorageInfoSchema);
    },
  },

  /**
   * 习惯（Habit）IPC 客户端（v0.4.0）。
   *
   * 暴露 8 个方法：
   *   - `list(filter?)`        → `Habit[]`
   *   - `create(input)`        → `Habit`
   *   - `update({ id, patch })` → `Habit`
   *   - `archive({ id, archived? })` → `Habit`
   *   - `delete({ id })`       → `{ deleted: true }`
   *   - `toggleLog({ habitId, date })` → `{ habitId, date, completed }`
   *   - `listLogs({ habitId, fromDate?, toDate? })` → `HabitLog[]`
   *   - `logsInRange({ fromDate, toDate })` → `HabitLog[]`
   */
  habit: {
    async list(filter?: { archived?: boolean }): Promise<
      | { ok: true; data: HabitParsed[] }
      | { ok: false; error: { code: string; message: string } }
    > {
      const payload = HabitListFilterSchema.parse(filter ?? {});
      return invokeIpc('habit:list', payload, HabitListSchema);
    },
    async create(input: {
      name: string;
      icon?: string;
      color?: string | null;
      weeklyTarget?: number;
    }): Promise<
      | { ok: true; data: HabitParsed }
      | { ok: false; error: { code: string; message: string } }
    > {
      const payload = CreateHabitInputSchema.parse(input);
      return invokeIpc('habit:create', payload, HabitSchema);
    },
    async update(input: {
      id: string;
      patch: {
        name?: string;
        icon?: string;
        color?: string | null;
        weeklyTarget?: number;
        archived?: boolean;
      };
    }): Promise<
      | { ok: true; data: HabitParsed }
      | { ok: false; error: { code: string; message: string } }
    > {
      const payload = UpdateHabitInputSchema.parse(input);
      return invokeIpc('habit:update', payload, HabitSchema);
    },
    async archive(input: {
      id: string;
      archived?: boolean;
    }): Promise<
      | { ok: true; data: HabitParsed }
      | { ok: false; error: { code: string; message: string } }
    > {
      const payload = ArchiveHabitInputSchema.parse(input);
      return invokeIpc('habit:archive', payload, HabitSchema);
    },
    async delete(input: { id: string }): Promise<
      | { ok: true; data: { deleted: true } }
      | { ok: false; error: { code: string; message: string } }
    > {
      const payload = DeleteHabitInputSchema.parse(input);
      const DataSchema = z.object({ deleted: z.literal(true) });
      return invokeIpc('habit:delete', payload, DataSchema);
    },
    async toggleLog(input: { habitId: string; date: string }): Promise<
      | { ok: true; data: { habitId: string; date: string; completed: boolean } }
      | { ok: false; error: { code: string; message: string } }
    > {
      const payload = ToggleHabitLogInputSchema.parse(input);
      const DataSchema = z.object({
        habitId: z.string(),
        date: z.string(),
        completed: z.boolean(),
      });
      return invokeIpc('habit:toggleLog', payload, DataSchema);
    },
    async listLogs(input: {
      habitId: string;
      fromDate?: string;
      toDate?: string;
    }): Promise<
      | { ok: true; data: HabitLogParsed[] }
      | { ok: false; error: { code: string; message: string } }
    > {
      const payload = ListHabitLogsInputSchema.parse(input);
      return invokeIpc('habit:listLogs', payload, HabitLogListSchema);
    },
    async logsInRange(input: { fromDate: string; toDate: string }): Promise<
      | { ok: true; data: HabitLogParsed[] }
      | { ok: false; error: { code: string; message: string } }
    > {
      const payload = LogsInRangeInputSchema.parse(input);
      return invokeIpc('habit:logsInRange', payload, HabitLogListSchema);
    },
  },

  /**
   * 收集箱（Inbox）IPC 客户端（T2-2）。
   *
   * 所有方法遵循：
   *   - 入参先经 Zod 校验，失败 throw ZodError（在 UI 层用 toast 显示）
   *   - 主进程响应经 InboxItemSchema / InboxItemListSchema / InboxConvertToTaskResponseSchema 再校验
   *   - 业务错误返回 `{ ok: false, error }` 形态，调用方用 toast 提示
   *
   * 暴露的 5 个方法：
   *   - `list(filter?)`              → `InboxItem[]`
   *   - `add(input)`                 → `InboxItem`
   *   - `update({ id, patch })`      → `InboxItem`
   *   - `archive({ id })`            → `InboxItem`
   *   - `convertToTask({ inboxId, taskDraft })` → `{ inbox, task }`
   */
  inbox: {
    /**
     * 列出 inbox 条目，可按 status 过滤。
     * 不传 filter 或 `filter = {}` → 返回全部（按 createdAt desc）。
     */
    async list(filter?: {
      status?: InboxItemParsed['status'];
    }): Promise<
      | { ok: true; data: InboxItemParsed[] }
      | { ok: false; error: { code: string; message: string } }
    > {
      const payload = InboxListFilterSchema.parse(filter ?? {});
      return invokeIpc('inbox:list', payload, InboxItemListSchema);
    },

    /**
     * 新增一条 inbox 条目。
     * `content` / `kind` 必填；`source` / `status` / `tags` 等有默认值。
     */
    async add(input: {
      content: string;
      kind: InboxItemParsed['kind'];
      source?: InboxItemParsed['source'];
      status?: InboxItemParsed['status'];
      convertedTo?: string | null;
      projectId?: string | null;
      tags?: string[];
    }): Promise<
      { ok: true; data: InboxItemParsed } | { ok: false; error: { code: string; message: string } }
    > {
      // 客户端做一次轻量校验，类型不匹配直接 throw ZodError
      // 主进程入口仍会再 safeParse 一次（防线深度）。
      const payload = AddInboxInputClientSchema.parse(input);
      return invokeIpc('inbox:add', payload, InboxItemSchema);
    },

    /**
     * 部分字段更新（patch）。
     */
    async update(input: {
      id: string;
      patch: {
        content?: string;
        kind?: InboxItemParsed['kind'];
        source?: InboxItemParsed['source'];
        status?: InboxItemParsed['status'];
        convertedTo?: string | null;
        projectId?: string | null;
        tags?: string[];
      };
    }): Promise<
      { ok: true; data: InboxItemParsed } | { ok: false; error: { code: string; message: string } }
    > {
      const payload = InboxUpdateInputSchema.parse(input);
      return invokeIpc('inbox:update', payload, InboxItemSchema);
    },

    /**
     * 归档（标记 `status='archived'`）。
     * 不会硬删。
     */
    async archive(input: {
      id: string;
    }): Promise<
      { ok: true; data: InboxItemParsed } | { ok: false; error: { code: string; message: string } }
    > {
      const payload = InboxArchiveInputSchema.parse(input);
      return invokeIpc('inbox:archive', payload, InboxItemSchema);
    },

    /**
     * 把一条 inbox 条目转成 task。事务内：写 task + 标 inbox `converted`。
     * 渲染端使用前**必须**二次确认（PROJECT_IDENTITY.md §6.4）。
     */
    async convertToTask(input: {
      inboxId: string;
      taskDraft: {
        title?: string;
        description?: string;
        priority?: 'low' | 'medium' | 'high';
        dueDate?: string;
        projectId?: string;
        tags?: string[];
      };
    }): Promise<
      | {
          ok: true;
          data: {
            inbox: InboxItemParsed;
            task: {
              id: string;
              title: string;
              description: string | null;
              status: 'todo' | 'doing' | 'done' | 'archived';
              priority: 'low' | 'medium' | 'high';
              dueDate: number | null;
              projectId: string | null;
              tags: string[];
              source: 'manual' | 'ai' | 'inbox';
              inboxId: string | null;
              noteIds: string[];
              createdAt: number;
              updatedAt: number;
              completedAt: number | null;
            };
          };
        }
      | { ok: false; error: { code: string; message: string } }
    > {
      const payload = InboxConvertToTaskInputSchema.parse(input);
      return invokeIpc('inbox:convertToTask', payload, InboxConvertToTaskResponseSchema);
    },
  },

  /**
   * 项目（Project）IPC 客户端（T2-3）。
   *
   * 暴露 5 个方法：
   *   - `list(filter?)`    → `Project[]`
   *   - `create(input)`    → `Project`
   *   - `update(input)`    → `Project`
   *   - `archive(input)`   → `Project`
   *   - `delete(input)`    → `{ deleted: true }`
   *
   * 删除 / 归档前**必须**在 UI 层二次确认（PROJECT_IDENTITY.md §6.4）。
   */
  project: {
    async list(filter?: {
      archived?: boolean;
    }): Promise<
      { ok: true; data: ProjectParsed[] } | { ok: false; error: { code: string; message: string } }
    > {
      const payload = ProjectListFilterSchema.parse(filter ?? {});
      return invokeIpc('project:list', payload, ProjectListSchema);
    },

    async create(input: {
      name: string;
      description?: string | null;
      color?: string | null;
      archived?: boolean;
    }): Promise<
      { ok: true; data: ProjectParsed } | { ok: false; error: { code: string; message: string } }
    > {
      const payload = CreateProjectInputSchema.parse(input);
      return invokeIpc('project:create', payload, ProjectSchema);
    },

    async update(input: {
      id: string;
      patch: {
        name?: string;
        description?: string | null;
        color?: string | null;
        archived?: boolean;
      };
    }): Promise<
      { ok: true; data: ProjectParsed } | { ok: false; error: { code: string; message: string } }
    > {
      const payload = UpdateProjectInputSchema.parse(input);
      return invokeIpc('project:update', payload, ProjectSchema);
    },

    async archive(input: {
      id: string;
    }): Promise<
      { ok: true; data: ProjectParsed } | { ok: false; error: { code: string; message: string } }
    > {
      const payload = ProjectArchiveInputSchema.parse(input);
      return invokeIpc('project:archive', payload, ProjectSchema);
    },

    async delete(input: {
      id: string;
    }): Promise<
      | { ok: true; data: { deleted: true } }
      | { ok: false; error: { code: string; message: string } }
    > {
      const payload = ProjectDeleteInputSchema.parse(input);
      return invokeIpc('project:delete', payload, ProjectDeleteResponseSchema);
    },
  },

  /**
   * 任务（Task）IPC 客户端（T2-3）。
   *
   * 暴露 7 个方法：
   *   - `list(filter?)`      → `Task[]`
   *   - `get(input)`         → `Task`
   *   - `create(input)`      → `Task`
   *   - `update(input)`      → `Task`（含状态机校验）
   *   - `transition(input)`  → `Task`（状态机 + 维护 completedAt）
   *   - `archive(input)`     → `Task`（等价 transition 到 archived）
   *   - `delete(input)`      → `{ deleted: true }`
   *
   * 删除 / 归档 / 状态流转前**必须**在 UI 层二次确认（PROJECT_IDENTITY.md §6.4）。
   */
  task: {
    async list(filter?: {
      status?: 'todo' | 'doing' | 'done' | 'archived';
      priority?: 'low' | 'medium' | 'high';
      projectId?: string | null;
    }): Promise<
      { ok: true; data: TaskParsed[] } | { ok: false; error: { code: string; message: string } }
    > {
      const payload = TaskListFilterSchema.parse(filter ?? {});
      return invokeIpc('task:list', payload, TaskListSchema);
    },

    async get(input: {
      id: string;
    }): Promise<
      { ok: true; data: TaskParsed } | { ok: false; error: { code: string; message: string } }
    > {
      const payload = TaskGetInputSchema.parse(input);
      return invokeIpc('task:get', payload, TaskSchema);
    },

    async create(input: {
      title: string;
      description?: string | null;
      status?: 'todo' | 'doing' | 'done' | 'archived';
      priority?: 'low' | 'medium' | 'high';
      dueDate?: number | null;
      projectId?: string | null;
      tags?: string[];
      source?: 'manual' | 'ai' | 'inbox';
      inboxId?: string | null;
      noteIds?: string[];
    }): Promise<
      { ok: true; data: TaskParsed } | { ok: false; error: { code: string; message: string } }
    > {
      const payload = CreateTaskInputSchema.parse(input);
      return invokeIpc('task:create', payload, TaskSchema);
    },

    async update(input: {
      id: string;
      patch: {
        title?: string;
        description?: string | null;
        status?: 'todo' | 'doing' | 'done' | 'archived';
        priority?: 'low' | 'medium' | 'high';
        dueDate?: number | null;
        projectId?: string | null;
        tags?: string[];
        source?: 'manual' | 'ai' | 'inbox';
        inboxId?: string | null;
        noteIds?: string[];
      };
    }): Promise<
      { ok: true; data: TaskParsed } | { ok: false; error: { code: string; message: string } }
    > {
      const payload = UpdateTaskInputSchema.parse(input);
      return invokeIpc('task:update', payload, TaskSchema);
    },

    async transition(input: {
      id: string;
      to: 'todo' | 'doing' | 'done' | 'archived';
    }): Promise<
      { ok: true; data: TaskParsed } | { ok: false; error: { code: string; message: string } }
    > {
      const payload = TaskTransitionInputSchema.parse(input);
      return invokeIpc('task:transition', payload, TaskSchema);
    },

    async archive(input: {
      id: string;
    }): Promise<
      { ok: true; data: TaskParsed } | { ok: false; error: { code: string; message: string } }
    > {
      const payload = TaskArchiveInputSchema.parse(input);
      return invokeIpc('task:archive', payload, TaskSchema);
    },

    async delete(input: {
      id: string;
    }): Promise<
      | { ok: true; data: { deleted: true } }
      | { ok: false; error: { code: string; message: string } }
    > {
      const payload = TaskDeleteInputSchema.parse(input);
      return invokeIpc('task:delete', payload, TaskDeleteResponseSchema);
    },
  },

  /**
   * 笔记（Note）IPC 客户端（T4-1）。
   *
   * 暴露 8 个方法：
   *   - `list(filter?)`           → `Note[]`
   *   - `get(input)`              → `Note`
   *   - `create(input)`           → `Note`
   *   - `update(input)`           → `Note`
   *   - `archive(input)`          → `Note`（设 archived=true）
   *   - `delete(input)`           → `{ deleted: true }`
   *   - `linkToTask(input)`       → `Note`（加进 linkedTaskIds）
   *   - `unlinkFromTask(input)`   → `Note`（从 linkedTaskIds 移除）
   *
   * 删除前**必须**在 UI 层二次确认（PROJECT_IDENTITY.md §6.4）。
   */
  note: {
    async list(filter?: {
      archived?: boolean;
      projectId?: string | null;
      tag?: string;
    }): Promise<
      { ok: true; data: NoteParsed[] } | { ok: false; error: { code: string; message: string } }
    > {
      const payload = NoteListFilterSchema.parse(filter ?? {});
      return invokeIpc('note:list', payload, NoteListSchema);
    },

    async get(input: {
      id: string;
    }): Promise<
      { ok: true; data: NoteParsed } | { ok: false; error: { code: string; message: string } }
    > {
      const payload = NoteGetInputSchema.parse(input);
      return invokeIpc('note:get', payload, NoteSchema);
    },

    async create(input: {
      title: string;
      content: string;
      tags?: string[];
      linkedTaskIds?: string[];
      projectId?: string | null;
      source?: 'manual' | 'ai' | 'inbox';
      archived?: boolean;
    }): Promise<
      { ok: true; data: NoteParsed } | { ok: false; error: { code: string; message: string } }
    > {
      const payload = CreateNoteInputSchema.parse(input);
      return invokeIpc('note:create', payload, NoteSchema);
    },

    async update(input: {
      id: string;
      patch: {
        title?: string;
        content?: string;
        tags?: string[];
        linkedTaskIds?: string[];
        projectId?: string | null;
        source?: 'manual' | 'ai' | 'inbox';
        archived?: boolean;
      };
    }): Promise<
      { ok: true; data: NoteParsed } | { ok: false; error: { code: string; message: string } }
    > {
      const payload = UpdateNoteInputSchema.parse(input);
      return invokeIpc('note:update', payload, NoteSchema);
    },

    async archive(input: {
      id: string;
    }): Promise<
      { ok: true; data: NoteParsed } | { ok: false; error: { code: string; message: string } }
    > {
      const payload = NoteArchiveInputSchema.parse(input);
      return invokeIpc('note:archive', payload, NoteSchema);
    },

    async delete(input: {
      id: string;
    }): Promise<
      | { ok: true; data: { deleted: true } }
      | { ok: false; error: { code: string; message: string } }
    > {
      const payload = NoteDeleteInputSchema.parse(input);
      return invokeIpc('note:delete', payload, NoteDeleteResponseSchema);
    },

    async linkToTask(input: {
      noteId: string;
      taskId: string;
    }): Promise<
      { ok: true; data: NoteParsed } | { ok: false; error: { code: string; message: string } }
    > {
      const payload = LinkNoteToTaskInputSchema.parse(input);
      return invokeIpc('note:linkToTask', payload, NoteSchema);
    },

    async unlinkFromTask(input: {
      noteId: string;
      taskId: string;
    }): Promise<
      { ok: true; data: NoteParsed } | { ok: false; error: { code: string; message: string } }
    > {
      const payload = UnlinkNoteFromTaskInputSchema.parse(input);
      return invokeIpc('note:unlinkFromTask', payload, NoteSchema);
    },

    /**
     * 导出笔记为 `.md` 文件（T4-3 知识沉淀第三阶段）。
     *
     * 行为：
     *   - 把选中的 note id 列表传给主进程
     *   - 主进程在 `<USERPROFILE>/Downloads/minimax-workstation-notes/{date}/`（或
     *     传入的 `targetDir`）下逐条写 `.md` 文件
     *   - 文件名 = `slug(title) + ulid后缀.md`
     *   - 响应：成功 → `{ files: [{ id, path }] }`；失败 → `{ error: { code, message } }`
     *
     * **安全**（PROJECT_IDENTITY.md §6.5）：
     *   - 导出文件**不**含 API Key / provider config / inbox / task 内容
     *   - schema `.strict()` 拒绝任何 `apiKey` 等额外字段
     *
     * @param input.ids       1~256 个 note id
     * @param input.targetDir 可选 —— 自定义目标目录绝对路径；省略时主进程落默认目录
     */
    async export(input: { ids: string[]; targetDir?: string }): Promise<
      | {
          ok: true;
          data: { files: Array<{ id: string; path: string }> };
        }
      | { ok: false; error: { code: string; message: string } }
    > {
      const payload = NoteExportRequestSchema.parse(input);
      return invokeIpc('note:export', payload, NoteExportResponseSchema);
    },
  },

  /**
   * 全文搜索（Search）IPC 客户端（T4-2）。
   *
   * 暴露 1 个方法：
   *   - `query(input)` → `SearchResult[]`（跨表混合结果按相关度排序）
   *
   * **安全约束**：
   *   - 渲染端只传 `query` 文本 + scope / 分页参数
   *   - 主进程负责 FTS5 MATCH 表达式构建 + bm25 归一化 + snippet 高亮 + 长度截断
   *   - 响应**不**含 source 行原文（仅 title + snippet + 必要 metadata）
   *   - 业务错误（空 query / 非法 scope / FTS5 语法错）→ `{ ok: false, error }` 形态
   *
   * **snippet 渲染注意**：
   *   - snippet 含 `<mark>...</mark>` 标签，渲染端用 `dangerouslySetInnerHTML`
   *   - 标签外的字符都经过 Zod 校验（SearchResultSchema），但渲染端仍需
   *     注意 XSS：建议用 `react-markdown` 的 raw HTML 模式 + 严格 CSP（已配）
   */
  search: {
    /**
     * 跨表全文搜索（笔记 + 任务 + 收集箱）。
     *
     * @param input.query  搜索词（1~256 字符）
     * @param input.scope  'all' | 'notes' | 'tasks' | 'inbox'（默认 'all'）
     * @param input.limit  单页条数（1~100，默认 20）
     * @param input.offset 偏移（0~1000，默认 0）
     * @returns 混合搜索结果（按归一化相关度 desc 排序）
     */
    async query(input: {
      query: string;
      scope?: 'all' | 'notes' | 'tasks' | 'inbox';
      limit?: number;
      offset?: number;
    }): Promise<
      { ok: true; data: SearchResult[] } | { ok: false; error: { code: string; message: string } }
    > {
      const payload = SearchQuerySchema.parse(input);
      return invokeIpc('search:query', payload, SearchResultsSchema);
    },
  },

  /**
   * AI（Provider / Credential / Config）IPC 客户端（T3-1 + T3-3 流式 chat + T3-4 结构化提取）。
   *
   * 暴露 9 个方法：
   *   - `listProviders()`                   → `ProviderMetadata[]`
   *   - `hasKey({ provider })`              → `{ hasKey: boolean }`
   *   - `setKey({ provider, key })`         → `{ ok: true }`（响应**不**回显 key）
   *   - `deleteKey({ provider })`           → `{ ok: true }`
   *   - `getConfig({ provider })`           → `AiConfig`（缺省回退到 metadata）
   *   - `setConfig({ provider, config })`   → `AiConfig`
   *   - `testConnection({ provider })`      → `{ ok, error? }`
   *   - `chat(input, callbacks)`            → 流式 chat（推 token / done / error，**不**含 key）
   *   - `extractJson(input)`                → `{ data, attempts }`（T3-4 结构化提取）
   *
   * **安全约束**（PROJECT_IDENTITY.md §6.1）：
   *   - 所有响应 schema **不**包含 `apiKey` 字段
   *   - 渲染进程拿到 key 的唯一时机是 `setKey({ provider, key })` 的入参 —— 用完即丢
   *   - 任何含 key 的日志 / 错误都会被主进程过滤（不在本文件的关注范围）
   *   - T3-4 `extractJson` 响应**不**含 AI 原始输出（主进程承诺）
   *
   * **流式 chat 设计**（T3-3）：
   *   - `chat(input, callbacks)` 走 `ipcRenderer.send('ai:chat', payload)` 发起
   *   - 主进程通过 `ipcRenderer.on('ai:chat:chunk', ...)` 推 chunk 回来
   *   - callbacks.onChunk / onDone / onError 各自处理流式事件
   *   - 返回 `cancel()` 函数 —— 内部 `ipcRenderer.send('ai:chat:cancel', { requestId })`
   */
  ai: {
    /**
     * 列出所有已注册 provider 的元数据（id / displayName / defaultModel / defaultBaseURL / docsUrl）。
     */
    async listProviders(): Promise<
      | { ok: true; data: ProviderMetadataParsed[] }
      | { ok: false; error: { code: string; message: string } }
    > {
      return invokeIpc('ai:listProviders', undefined, ProviderMetadataListSchema);
    },

    /**
     * 判断 provider 是否已配置 API key。
     */
    async hasKey(input: {
      provider: ProviderMetadataParsed['id'];
    }): Promise<
      | { ok: true; data: { hasKey: boolean } }
      | { ok: false; error: { code: string; message: string } }
    > {
      const payload = AiProviderInputSchema.parse(input);
      return invokeIpc('ai:hasKey', payload, AiHasKeyResponseSchema.shape.data);
    },

    /**
     * 设置 / 覆盖一个 provider 的 API key。
     *
     * 响应**不**回显 key —— 渲染端调用完即可丢弃 `input.key`。
     */
    async setKey(input: {
      provider: ProviderMetadataParsed['id'];
      key: string;
    }): Promise<
      { ok: true; data: { ok: true } } | { ok: false; error: { code: string; message: string } }
    > {
      const payload = AiSetKeyInputSchema.parse(input);
      const raw: unknown = await ipcRenderer.invoke('ai:setKey', payload);
      // setKey 响应就是 `{ ok: true }`（无 data 包装），直接 parse
      const parsed = AiOkResponseSchema.safeParse(raw);
      if (parsed.success) {
        return { ok: true, data: { ok: true as const } };
      }
      const errParsed = errorResponseSchema.safeParse(raw);
      if (errParsed.success) return errParsed.data;
      throw new Error('Invalid IPC response for ai:setKey');
    },

    /**
     * 删除一个 provider 的 API key（幂等 —— 不存在不报错）。
     */
    async deleteKey(input: {
      provider: ProviderMetadataParsed['id'];
    }): Promise<
      { ok: true; data: { ok: true } } | { ok: false; error: { code: string; message: string } }
    > {
      const payload = AiProviderInputSchema.parse(input);
      const raw: unknown = await ipcRenderer.invoke('ai:deleteKey', payload);
      const parsed = AiOkResponseSchema.safeParse(raw);
      if (parsed.success) {
        return { ok: true, data: { ok: true as const } };
      }
      const errParsed = errorResponseSchema.safeParse(raw);
      if (errParsed.success) return errParsed.data;
      throw new Error('Invalid IPC response for ai:deleteKey');
    },

    /**
     * 读一个 provider 的 config（model / baseURL / updatedAt）。
     * db 缺省时回退到 registry metadata（`updatedAt=0`）。
     */
    async getConfig(input: {
      provider: ProviderMetadataParsed['id'];
    }): Promise<
      | {
          ok: true;
          data: {
            provider: ProviderMetadataParsed['id'];
            model: string;
            baseURL: string;
            updatedAt: number;
          };
        }
      | { ok: false; error: { code: string; message: string } }
    > {
      const payload = AiProviderInputSchema.parse(input);
      return invokeIpc('ai:getConfig', payload, AiGetConfigResponseSchema.shape.data);
    },

    /**
     * 写一个 provider 的 config（upsert）。
     */
    async setConfig(input: {
      provider: ProviderMetadataParsed['id'];
      config: { model: string; baseURL: string };
    }): Promise<
      | {
          ok: true;
          data: {
            provider: ProviderMetadataParsed['id'];
            model: string;
            baseURL: string;
            updatedAt: number;
          };
        }
      | { ok: false; error: { code: string; message: string } }
    > {
      const payload = AiSetConfigInputSchema.parse(input);
      return invokeIpc('ai:setConfig', payload, AiSetConfigResponseSchema.shape.data);
    },

    /**
     * 测试 provider 连接。
     *
     * T3-1 阶段占位实现返 `{ ok: false, error: 'not implemented in T3-1, see T3-2' }`；
     * 凭据未配置返 `{ ok: false, error: 'no API key configured' }`。
     *
     * 响应**不**含 key 内容。
     */
    async testConnection(input: {
      provider: ProviderMetadataParsed['id'];
    }): Promise<
      | { ok: true; data: { ok: boolean; error?: string | undefined } }
      | { ok: false; error: { code: string; message: string } }
    > {
      const payload = AiProviderInputSchema.parse(input);
      // 用 .shape.data 抽 data 子 schema，给 invokeIpc 用
      return invokeIpc('ai:testConnection', payload, AiTestConnectionResponseSchema.shape.data);
    },

    /**
     * 流式 chat（T3-3）。
     *
     * 行为：
     *   - 调 `ipcRenderer.send('ai:chat', payload)` 发起 chat
     *   - 订阅 `ipcRenderer.on('ai:chat:chunk', ...)` 路由到对应 requestId 的回调
     *   - chunk 类型：
     *     - `token`  → onChunk({ type: 'token', content })
     *     - `done`   → onDone()
     *     - `error`  → onError({ code, message })（**不**含 key）
     *
     * **取消**：返回的 `cancel()` 函数发 `ai:chat:cancel` 通道，触发主进程 AbortController。
     *
     * **不抛错**：除入参 Zod 失败外，**不**同步抛错；所有错误通过 onError 异步报告。
     *
     * @returns `cancel()` 取消函数
     */
    chat(
      input: {
        provider: ProviderIdParsed;
        messages: ChatMessageParsed[];
        systemHint?: string;
        model?: string;
        requestId?: string;
      },
      callbacks: {
        onChunk: (chunk: { type: 'token'; content: string }) => void;
        onDone: () => void;
        onError: (err: { code: string; message: string }) => void;
      },
    ): () => void {
      // 1. 客户端 Zod 校验（防线深度）
      const requestId =
        input.requestId ??
        `chat_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      const parsed = ChatRequestSchema.parse({
        requestId,
        provider: input.provider,
        messages: input.messages,
        ...(input.systemHint !== undefined ? { systemHint: input.systemHint } : {}),
        ...(input.model !== undefined ? { model: input.model } : {}),
      });

      // 2. 订阅 chunk 事件
      const chunkHandler = (_event: IpcRendererEvent, raw: unknown): void => {
        const env = ChatChunkEnvelopeSchema.safeParse(raw);
        if (!env.success) return;
        if (env.data.requestId !== requestId) return; // 路由到正确的回调
        const chunk = env.data.chunk;
        if (chunk.type === 'token') {
          callbacks.onChunk({ type: 'token', content: chunk.content });
        } else if (chunk.type === 'done') {
          callbacks.onDone();
        } else if (chunk.type === 'error') {
          callbacks.onError({ code: chunk.error.code, message: chunk.error.message });
        }
      };
      ipcRenderer.on('ai:chat:chunk', chunkHandler);

      // 3. 发起 chat
      ipcRenderer.send('ai:chat', parsed);

      // 4. 取消函数
      let cancelled = false;
      const cancel = (): void => {
        if (cancelled) return;
        cancelled = true;
        // 取消时也清掉订阅（避免 chunk 仍然推到已经 cancel 的回调）
        ipcRenderer.removeListener('ai:chat:chunk', chunkHandler);
        // 走 cancel 通道，Zod 校验确保 requestId 非空
        const cancelPayload = ChatCancelRequestSchema.parse({ requestId });
        ipcRenderer.send('ai:chat:cancel', cancelPayload);
      };
      return cancel;
    },

    /**
     * 结构化 JSON 提取（T3-4）。
     *
     * 走 `ipcRenderer.invoke('ai:extractJson', payload)` 同步等待主进程返回。
     * 主进程已：
     *   - 强制 system hint 引导 JSON 输出
     *   - 剥 markdown fence（```json ... ``` / ``` ... ```）
     *   - JSON.parse
     *   - Zod 验证（失败自动重试 N 次，默认 1 次）
     *   - 错误信息 / 日志**不**含 AI 原始输出
     *
     * 响应 data 字段类型为 `unknown`（由 schemaName 决定具体形状）。
     * 调用方应**再次**用对应 Zod schema 校验一次（`ExtractedTasksSchema` /
     * `ExtractedInboxItemsSchema` / `NoteSummarySchema`）。
     */
    async extractJson(input: {
      provider: ProviderIdParsed;
      schemaName: 'inbox_items' | 'task_drafts' | 'note_summary' | 'review_draft';
      messages: ChatMessageParsed[];
      systemHint?: string;
      model?: string;
      temperature?: number;
      maxRetries?: number;
    }): Promise<
      | { ok: true; data: { data: unknown; attempts: number } }
      | { ok: false; error: { code: string; message: string } }
    > {
      const payload = ExtractJsonRequestSchema.parse(input);
      return invokeIpc('ai:extractJson', payload, ExtractJsonResponseDataSchema);
    },
  },

  /**
   * 复盘（Review）IPC 客户端（T5-1 每日复盘）。
   *
   * 暴露 5 个方法：
   *   - `getByDate(date)`          → `Review | null`
   *   - `upsert(input)`            → `Review`（按 date 唯一键）
   *   - `update(input)`            → `Review`（patch 语义；用于"采纳 AI 草稿"）
   *   - `listRecent(input?)`       → `Review[]`（按 date DESC，默认 30 条）
   *   - `generateDraft(input)`     → `ReviewDraft`（不入库；用户"采纳"走 update）
   *
   * **草稿语义**：
   *   - `generateDraft` 仅在内存返回，**不**写入 db
   *   - `upsert` **不**写 `aiDraft` 字段（要写必须走 `update`）
   *   - 用户点"采纳" → 渲染端把 `aiDraft` 反序列化到 4 段字段，**同时**
   *     `update({ patch: { aiDraft: null, ...4 段 } })` 写库
   *
   * **安全**：
   *   - 所有响应 schema **不**包含 `apiKey` / AI 原始输出
   *   - 入参 / 响应均经 Zod 严格校验
   */
  review: {
    /**
     * 按日期（`YYYY-MM-DD`）取一条复盘；不存在返回 `null`。
     */
    async getByDate(date: string): Promise<
      | { ok: true; data: ReviewParsed | null }
      | { ok: false; error: { code: string; message: string } }
    > {
      const payload = ReviewGetByDateInputSchema.parse({ date });
      return invokeIpc('review:getByDate', payload, ReviewGetByDateResponseSchema);
    },

    /**
     * Upsert（按 `date` 唯一键）。不写 `aiDraft`。
     */
    async upsert(input: {
      date: string;
      completed: Array<{ taskId: string; title: string }>;
      uncompleted: Array<{ taskId: string; title: string; reason?: string }>;
      blockers: string;
      topThree: string[];
    }): Promise<
      | { ok: true; data: ReviewParsed }
      | { ok: false; error: { code: string; message: string } }
    > {
      const payload = ReviewUpsertInputSchema.parse(input);
      return invokeIpc('review:upsert', payload, ReviewSchema);
    },

    /**
     * 部分字段更新（patch 语义）。**不**接受 `date`（date 不可改）。
     *
     * "采纳 AI 草稿" 路径示例：
     * ```ts
     * await window.api.review.update({
     *   id: review.id,
     *   patch: {
     *     completed: aiDraft.completed.map((t) => ({ taskId: '', title: t })),
     *     uncompleted: aiDraft.uncompleted.map((u) => ({ taskId: '', title: u.title, reason: u.reason })),
     *     blockers: aiDraft.blockers,
     *     topThree: aiDraft.topThree,
     *     aiDraft: null,
     *   },
     * });
     * ```
     */
    async update(input: {
      id: string;
      patch: {
        completed?: Array<{ taskId: string; title: string }>;
        uncompleted?: Array<{ taskId: string; title: string; reason?: string }>;
        blockers?: string;
        topThree?: string[];
        aiDraft?: ReviewDraft | null;
      };
    }): Promise<
      | { ok: true; data: ReviewParsed }
      | { ok: false; error: { code: string; message: string } }
    > {
      const payload = ReviewUpdateInputSchema.parse(input);
      return invokeIpc('review:update', payload, ReviewSchema);
    },

    /**
     * 取最近 N 条复盘（按 `date DESC`）。默认 30，最大 365。
     */
    async listRecent(input?: { limit?: number }): Promise<
      | { ok: true; data: ReviewParsed[] }
      | { ok: false; error: { code: string; message: string } }
    > {
      const payload = ReviewListRecentInputSchema.parse(input ?? {});
      return invokeIpc('review:listRecent', payload, ReviewListRecentResponseSchema);
    },

    /**
     * 生成 AI 复盘草稿（**不**入库）。
     *
     * 内部走 `handleAiExtractJson({ schemaName: 'review_draft', ... })`：
     *   - 读当天 + 昨天的 task / inbox
     *   - 调 AI 提取结构化 ReviewDraft
     *   - Zod 校验 + 重试
     *
     * 错误码：`VALIDATION_FAILED` / `DEPENDENCY_MISSING` / `EXTERNAL_FAILURE` /
     *        `PERSISTENCE_FAILED` / `INTERNAL`
     */
    async generateDraft(input: {
      date: string;
      provider: 'minimax' | 'openai-compatible';
      model?: string;
    }): Promise<
      | { ok: true; data: ReviewDraft }
      | { ok: false; error: { code: string; message: string } }
    > {
      const payload = ReviewGenerateDraftInputSchema.parse(input);
      return invokeIpc('review:generateDraft', payload, ReviewGenerateDraftResponseSchema);
    },
  },

  /**
   * 系统对话框（Dialog）IPC 客户端（T5-2 设置页 / 通用 dialog）。
   *
   * 暴露 2 个方法：
   *   - `showSaveDialog(input)` → `{ path: string | null }`（用户取消 → null）
   *   - `showOpenDialog(input)` → `{ path: string | null, paths: string[] }`
   *
   * **安全**：
   *   - 用户选完路径后由调用方（business layer）校验路径在允许范围内
   *   - 渲染端**不**直接 require electron；走 contextBridge
   */
  dialog: {
    /**
     * 显示保存对话框。用户取消 → `{ path: null }`（**不**报错）。
     */
    async showSaveDialog(input?: {
      title?: string;
      defaultPath?: string;
      filters?: Array<{ name: string; extensions: string[] }>;
    }): Promise<
      | { ok: true; data: ShowSaveDialogResponseParsed }
      | { ok: false; error: { code: string; message: string } }
    > {
      const payload = ShowSaveDialogInputSchema.parse(input ?? {});
      return invokeIpc('dialog:showSaveDialog', payload, ShowSaveDialogResponseSchema);
    },

    /**
     * 显示打开对话框。用户取消 → `{ path: null, paths: [] }`。
     *
     * `properties: ['multiSelections']` → `paths` 多选；`path` 取第一个
     */
    async showOpenDialog(input?: {
      title?: string;
      defaultPath?: string;
      filters?: Array<{ name: string; extensions: string[] }>;
      properties?: Array<
        | 'openFile'
        | 'openDirectory'
        | 'multiSelections'
        | 'showHiddenFiles'
        | 'createDirectory'
        | 'promptToCreate'
        | 'noResolveAliases'
        | 'treatPackageAsDirectory'
        | 'dontAddToRecent'
      >;
    }): Promise<
      | { ok: true; data: ShowOpenDialogResponseParsed }
      | { ok: false; error: { code: string; message: string } }
    > {
      const payload = ShowOpenDialogInputSchema.parse(input ?? {});
      return invokeIpc('dialog:showOpenDialog', payload, ShowOpenDialogResponseSchema);
    },
  },

  /**
   * 备份 / 导出 / 恢复 / 重置 IPC 客户端（T5-2 设置页）。
   *
   * 暴露 8 个方法（命名遵循 PROJECT_IDENTITY.md §4.1 `app:*`）：
   *   - `getPaths()`               → `{ userData, db, backups }`
   *   - `listBackups()`            → `BackupInfo[]`（按 createdAt DESC）
   *   - `backupNow(input?)`        → `{ path, size, createdAt }`
   *   - `exportData(input)`        → `{ path, size, createdAt }`
   *   - `restoreBackup(input)`     → `{ ok: true, restartRequired: true }`（**必须** confirm='RESTORE'）
   *   - `importData(input)`        → 同 restoreBackup（语义：从外部 .mmws.json 恢复）
   *   - `deleteBackup(input)`      → `{ deleted: true }`
   *   - `resetData(input)`         → `{ ok: true, restartRequired: true }`（**必须** confirm='RESET'）
   *
   * **安全**：
   *   - `restoreBackup` / `resetData` / `importData` 都要求大写字符串 confirm
   *   - 响应**不**含 apiKey / 绝对路径（在 error.message 里也**不**含绝对路径）
   *   - 渲染端拿到 `getPaths` 返回的路径后**只**回显 basename 给用户
   */
  appEx: {
    async getPaths(): Promise<
      | { ok: true; data: GetPathsResponseParsed }
      | { ok: false; error: { code: string; message: string } }
    > {
      return invokeIpc('app:getPaths', undefined, GetPathsResponseSchema);
    },

    async listBackups(): Promise<
      | { ok: true; data: ListBackupsResponseParsed }
      | { ok: false; error: { code: string; message: string } }
    > {
      return invokeIpc('app:listBackups', undefined, ListBackupsResponseSchema);
    },

    async backupNow(input?: { destPath?: string }): Promise<
      | { ok: true; data: BackupNowResponseParsed }
      | { ok: false; error: { code: string; message: string } }
    > {
      const payload = BackupNowInputSchema.parse(input ?? {});
      return invokeIpc('app:backupNow', payload, BackupNowResponseSchema);
    },

    async exportData(input: { destPath: string }): Promise<
      | { ok: true; data: ExportDataResponseParsed }
      | { ok: false; error: { code: string; message: string } }
    > {
      const payload = ExportDataInputSchema.parse(input);
      return invokeIpc('app:exportData', payload, ExportDataResponseSchema);
    },

    async restoreBackup(input: { path: string; confirm: 'RESTORE' }): Promise<
      | { ok: true; data: RestoreBackupResponseParsed }
      | { ok: false; error: { code: string; message: string } }
    > {
      const payload = RestoreBackupInputSchema.parse(input);
      return invokeIpc('app:restoreBackup', payload, RestoreBackupResponseSchema);
    },

    async importData(input: { path: string; confirm: 'RESTORE' }): Promise<
      | { ok: true; data: ImportDataResponseParsed }
      | { ok: false; error: { code: string; message: string } }
    > {
      const payload = ImportDataInputSchema.parse(input);
      return invokeIpc('app:importData', payload, ImportDataResponseSchema);
    },

    async deleteBackup(input: { path: string }): Promise<
      | { ok: true; data: DeleteBackupResponseParsed }
      | { ok: false; error: { code: string; message: string } }
    > {
      const payload = DeleteBackupInputSchema.parse(input);
      return invokeIpc('app:deleteBackup', payload, DeleteBackupResponseSchema);
    },

    async resetData(input: { confirm: 'RESET' }): Promise<
      | { ok: true; data: ResetDataResponseParsed }
      | { ok: false; error: { code: string; message: string } }
    > {
      const payload = ResetDataInputSchema.parse(input);
      return invokeIpc('app:resetData', payload, ResetDataResponseSchema);
    },
  },

  /**
   * 应用设置（App Settings）IPC 客户端（T5-2 设置页）。
   *
   * 暴露 3 个方法：
   *   - `getSettings()`         → `Settings`（默认 + 用户覆盖）
   *   - `setSettings(input)`    → `Settings`（patch 语义）
   *   - `maybeAutoBackup()`     → `{ triggered: boolean, path?: string }`
   *
   * **安全**：所有响应**不**含 apiKey / 绝对路径。
   */
  settings: {
    async getSettings(): Promise<
      | { ok: true; data: SettingsParsed }
      | { ok: false; error: { code: string; message: string } }
    > {
      // 用 MaybeAutoBackupResponseSchema 不合适；这里用 GetSettings 隐式 schema
      const SettingsResponse = z.object({
        autoBackupIntervalMin: z.union([z.literal(0), z.literal(30), z.literal(60), z.literal(120)]),
        lastAutoBackupAt: z.number().int().nonnegative().nullable(),
        lastRestoreAt: z.number().int().nonnegative().nullable(),
      });
      return invokeIpc('app:getSettings', undefined, SettingsResponse);
    },

    async setSettings(input: {
      autoBackupIntervalMin?: 0 | 30 | 60 | 120;
      lastAutoBackupAt?: number | null;
      lastRestoreAt?: number | null;
    }): Promise<
      | { ok: true; data: SettingsParsed }
      | { ok: false; error: { code: string; message: string } }
    > {
      const payload = SetSettingsInputSchema.parse(input);
      const SettingsResponse = z.object({
        autoBackupIntervalMin: z.union([z.literal(0), z.literal(30), z.literal(60), z.literal(120)]),
        lastAutoBackupAt: z.number().int().nonnegative().nullable(),
        lastRestoreAt: z.number().int().nonnegative().nullable(),
      });
      return invokeIpc('app:setSettings', payload, SettingsResponse);
    },

    async maybeAutoBackup(): Promise<
      | { ok: true; data: { triggered: boolean; path?: string | undefined } }
      | { ok: false; error: { code: string; message: string } }
    > {
      return invokeIpc('app:maybeAutoBackup', undefined, MaybeAutoBackupResponseSchema);
    },
  },
} as const;

/** 渲染进程可见的 window.api 类型，供 src/ 内消费方引用。 */
export type WindowApi = typeof api;

contextBridge.exposeInMainWorld('api', api);
