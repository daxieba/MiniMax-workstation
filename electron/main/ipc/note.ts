/**
 * 笔记（Note）IPC handler（T4-1 知识沉淀第一阶段 + T4-3 知识沉淀第三阶段）
 *
 * 暴露 9 个通道（命名遵循 PROJECT_IDENTITY.md §4.1，格式 `namespace:action`）：
 *   - `note:list`            (filter: `NoteListFilter`)       → `Note[]`
 *   - `note:get`             (input: `{ id }`)                → `Note`
 *   - `note:create`          (input: `CreateNoteInput`)       → `Note`
 *   - `note:update`          (input: `{ id, patch }`)         → `Note`
 *   - `note:archive`         (input: `{ id }`)                → `Note`（设 `archived=1`）
 *   - `note:delete`          (input: `{ id }`)                → `{ deleted: true }`（硬删）
 *   - `note:linkToTask`      (input: `{ noteId, taskId }`)    → `Note`（去重加入 linkedTaskIds）
 *   - `note:unlinkFromTask`  (input: `{ noteId, taskId }`)    → `Note`（移除；不存在则 no-op）
 *   - `note:export`          (input: `{ ids, targetDir? }`)   → `{ files: [{id, path}] }`（T4-3）
 *
 * **全部遵循 PROJECT_IDENTITY.md §4 IPC 契约**：
 *   - 入口 Zod 校验（共享 schema 在 `shared/schemas/note.ts`）
 *   - try/catch 全包，错误统一转成 `{ code, message, details? }`
 *   - 不返回原始异常对象
 *   - 不在日志中打印 payload 里的敏感字段（本卡 payload 都是用户笔记内容，非敏感）
 *
 * **错误码**（PROJECT_IDENTITY.md §4.4）：
 *   - `VALIDATION_FAILED`   Zod 校验失败
 *   - `NOT_FOUND`           资源不存在（get / update / archive / delete 找不到 id；linkToTask 时 task/note 不存在）
 *   - `PERSISTENCE_FAILED`  db 操作失败 / 写盘失败（T4-3 export 写文件也走这个）
 *   - `INTERNAL`            未分类
 *
 * **范围**（T4-1 + T4-3）：
 *   - T4-1 笔记 CRUD + 标签 + 关联任务
 *   - T4-3 **新增** `note:export`：把笔记导出为 `.md` 文件
 *     - 主进程用 `fs.writeFile`（**主进程**有 fs 权限，渲染端不能写）
 *     - 目标目录默认 `%USERPROFILE%/Downloads/minimax-workstation-notes/{date}/`
 *     - 文件名 = slug(title) + ulid 后缀防重名
 *     - **不**含敏感字段（apiKey / provider / inbox / task 内容）
 *   - 不做 ai:* / review:* / kb-aggregated:* 的 IPC（留给对应业务卡）
 *   - 不做 FTS5 搜索（留给 T4-2）
 *   - AI 摘要 UI 在渲染端（NoteAIPanel + AI 工作区"AI 摘要笔记" tab），**不**走新 IPC
 *
 * **关联任务子操作**（`linkToTask` / `unlinkFromTask`）：
 *   - 任务存在性**不**在子操作里校验 —— 任务可能被硬删，但保留在 linkedTaskIds
 *     里仍不影响笔记本身；UI 渲染时再过滤"任务已删除"提示
 *   - 这与 T2-3 任务 schema 中"删除时 SQLite FK NO ACTION"的策略一致：
 *     主进程不去做跨表存在性校验（成本 + 锁），由 UI 拿 taskStore 配合
 *
 * **测试策略**（tests/noteIpc.test.ts + tests/noteExportIpc.test.ts）：
 *   - 9 个 handler 函数以 named export 暴露
 *   - 测试直接传 `deps` + `payload` 调用，绕开 ipcMain 事件循环
 *   - `registerNoteIpc(deps)` 只在主进程启动时调一次
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, tmpdir } from 'node:os';

import { and, desc, eq, isNull, like } from 'drizzle-orm';
import { ipcMain } from 'electron';
import { ulid } from 'ulidx';

import { type WorkstationDb } from '../../../db/client';
import { notes, type NoteRow } from '../../../db/schema';
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
  NoteSchema,
  UnlinkNoteFromTaskInputSchema,
  UpdateNoteInputSchema,
  type NoteExportFileParsed,
  type NoteExportResponseParsed,
  type NoteParsed,
} from '../../../shared/schemas/note';
import { NOTE_SOURCES, type Note, type NoteSource } from '../../../shared/types/note';

/** 依赖注入：注册时由主进程传入 db 客户端。 */
export interface NoteIpcDeps {
  db: WorkstationDb;
}

/** IPC 错误统一格式（PROJECT_IDENTITY.md §4.2）。 */
export interface IpcErrorPayload {
  code: 'VALIDATION_FAILED' | 'NOT_FOUND' | 'CONFLICT' | 'PERSISTENCE_FAILED' | 'INTERNAL';
  message: string;
  details?: unknown;
}

/** 把任意异常转成 IPC 错误对象。 */
function toIpcError(err: unknown): IpcErrorPayload {
  if (err instanceof Error) {
    return { code: 'INTERNAL', message: err.message };
  }
  return { code: 'INTERNAL', message: String(err) };
}

/** 把 db 错误归类到 PERSISTENCE_FAILED。 */
function toPersistenceError(err: unknown, fallbackMessage: string): IpcErrorPayload {
  if (err instanceof Error) {
    return { code: 'PERSISTENCE_FAILED', message: `${fallbackMessage}: ${err.message}` };
  }
  return { code: 'PERSISTENCE_FAILED', message: `${fallbackMessage}: ${String(err)}` };
}

/** 判断 err 是否为已结构化的 IPC 错误。 */
function isStructuredIpcError(err: unknown): err is IpcErrorPayload {
  if (err === null || typeof err !== 'object') return false;
  const obj = err as { code?: unknown; message?: unknown };
  if (typeof obj.code !== 'string' || typeof obj.message !== 'string') return false;
  return (
    obj.code === 'VALIDATION_FAILED' ||
    obj.code === 'NOT_FOUND' ||
    obj.code === 'CONFLICT' ||
    obj.code === 'PERSISTENCE_FAILED' ||
    obj.code === 'INTERNAL'
  );
}

/** 运行时校验 source 字符串。 */
function isNoteSource(value: string): value is NoteSource {
  return (NOTE_SOURCES as readonly string[]).includes(value);
}

/**
 * 把 db 行（`NoteRow`）转成 IPC DTO（`NoteParsed`）。
 *
 * 转换点：
 *   - `archived`           number (0/1) → boolean
 *   - `createdAt` / `updatedAt` Date → number (Unix ms)
 *   - 其他字段（`tags` / `linkedTaskIds`）已在 schema 层是 string[]（Drizzle `mode: 'json'`）
 *   - `source` 已是字符串字面量；做一次窄化兜底
 */
function rowToNote(row: NoteRow): NoteParsed {
  const item: Note = {
    id: row.id,
    title: row.title,
    content: row.content,
    tags: row.tags,
    linkedTaskIds: row.linkedTaskIds,
    projectId: row.projectId,
    source: isNoteSource(row.source) ? row.source : 'manual',
    archived: row.archived === 1,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  };
  return NoteSchema.parse(item);
}

// ============================================================
//  handler 函数（独立可测）
// ============================================================

/** `note:list` handler。 */
export async function handleNoteList(deps: NoteIpcDeps, payload: unknown): Promise<NoteParsed[]> {
  const parsed = NoteListFilterSchema.safeParse(payload ?? {});
  if (!parsed.success) {
    throw {
      code: 'VALIDATION_FAILED' as const,
      message: 'Invalid note list filter',
      details: parsed.error.flatten(),
    };
  }
  const filter: {
    archived?: boolean | undefined;
    projectId?: string | null | undefined;
    tag?: string | undefined;
  } = parsed.data;

  try {
    const conditions = [];
    if (filter.archived !== undefined) {
      conditions.push(eq(notes.archived, filter.archived ? 1 : 0));
    }
    if (filter.projectId !== undefined) {
      // null 走 isNull；非 null 走 eq
      conditions.push(
        filter.projectId === null ? isNull(notes.projectId) : eq(notes.projectId, filter.projectId),
      );
    }
    if (filter.tag !== undefined && filter.tag.length > 0) {
      // SQLite 里 tags 是 JSON 字符串数组 —— 用 LIKE 做粗匹配
      // 例：tag="前端" → WHERE tags LIKE '%"前端"%'
      // 局限性：如果 tag 内容包含引号会误匹配；T4-2 全文搜索会取代这个
      // 这里先做"能用"的近似实现，满足 T4-1 单标签过滤
      const escaped = filter.tag.replace(/"/g, '\\"');
      conditions.push(like(notes.tags, `%"${escaped}"%`));
    }

    const baseQuery = deps.db.select().from(notes);
    const rows =
      conditions.length === 0
        ? baseQuery.orderBy(desc(notes.updatedAt)).all()
        : baseQuery
            .where(and(...conditions))
            .orderBy(desc(notes.updatedAt))
            .all();
    return rows.map((r) => rowToNote(r));
  } catch (err) {
    if (isStructuredIpcError(err)) throw err;
    throw toPersistenceError(err, 'Failed to list notes');
  }
}

/** `note:get` handler。 */
export async function handleNoteGet(deps: NoteIpcDeps, payload: unknown): Promise<NoteParsed> {
  const parsed = NoteGetInputSchema.safeParse(payload);
  if (!parsed.success) {
    throw {
      code: 'VALIDATION_FAILED' as const,
      message: 'Invalid note get input',
      details: parsed.error.flatten(),
    };
  }
  const { id } = parsed.data;

  try {
    const row = deps.db.select().from(notes).where(eq(notes.id, id)).get();
    if (!row) {
      throw {
        code: 'NOT_FOUND' as const,
        message: `Note not found: ${id}`,
      };
    }
    return rowToNote(row);
  } catch (err) {
    if (isStructuredIpcError(err)) throw err;
    throw toPersistenceError(err, 'Failed to get note');
  }
}

/** `note:create` handler。 */
export async function handleNoteCreate(deps: NoteIpcDeps, payload: unknown): Promise<NoteParsed> {
  const parsed = CreateNoteInputSchema.safeParse(payload);
  if (!parsed.success) {
    throw {
      code: 'VALIDATION_FAILED' as const,
      message: 'Invalid note create input',
      details: parsed.error.flatten(),
    };
  }
  const input = parsed.data;
  const now = new Date();
  const id = ulid();

  try {
    deps.db
      .insert(notes)
      .values({
        id,
        title: input.title,
        content: input.content,
        tags: input.tags ?? [],
        linkedTaskIds: input.linkedTaskIds ?? [],
        projectId: input.projectId ?? null,
        source: input.source ?? 'manual',
        archived: input.archived === true ? 1 : 0,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    const row = deps.db.select().from(notes).where(eq(notes.id, id)).get();
    if (!row) {
      throw {
        code: 'INTERNAL' as const,
        message: 'Note was inserted but cannot be read back',
      };
    }
    return rowToNote(row);
  } catch (err) {
    if (isStructuredIpcError(err)) throw err;
    throw toPersistenceError(err, 'Failed to create note');
  }
}

/** `note:update` handler。 */
export async function handleNoteUpdate(deps: NoteIpcDeps, payload: unknown): Promise<NoteParsed> {
  const parsed = UpdateNoteInputSchema.safeParse(payload);
  if (!parsed.success) {
    throw {
      code: 'VALIDATION_FAILED' as const,
      message: 'Invalid note update input',
      details: parsed.error.flatten(),
    };
  }
  const { id, patch } = parsed.data;
  const now = new Date();

  try {
    const existing = deps.db.select().from(notes).where(eq(notes.id, id)).get();
    if (!existing) {
      throw {
        code: 'NOT_FOUND' as const,
        message: `Note not found: ${id}`,
      };
    }

    const updates: Partial<NoteRow> = { updatedAt: now };
    if (patch.title !== undefined) updates.title = patch.title;
    if (patch.content !== undefined) updates.content = patch.content;
    if (patch.tags !== undefined) updates.tags = patch.tags;
    if (patch.linkedTaskIds !== undefined) updates.linkedTaskIds = patch.linkedTaskIds;
    if (patch.projectId !== undefined) updates.projectId = patch.projectId;
    if (patch.source !== undefined) updates.source = patch.source;
    if (patch.archived !== undefined) updates.archived = patch.archived ? 1 : 0;

    deps.db.update(notes).set(updates).where(eq(notes.id, id)).run();

    const row = deps.db.select().from(notes).where(eq(notes.id, id)).get();
    if (!row) {
      throw {
        code: 'INTERNAL' as const,
        message: 'Note was updated but cannot be read back',
      };
    }
    return rowToNote(row);
  } catch (err) {
    if (isStructuredIpcError(err)) throw err;
    throw toPersistenceError(err, 'Failed to update note');
  }
}

/** `note:archive` handler：设 `archived=1`（不删数据，可恢复）。 */
export async function handleNoteArchive(deps: NoteIpcDeps, payload: unknown): Promise<NoteParsed> {
  const parsed = NoteArchiveInputSchema.safeParse(payload);
  if (!parsed.success) {
    throw {
      code: 'VALIDATION_FAILED' as const,
      message: 'Invalid note archive input',
      details: parsed.error.flatten(),
    };
  }
  const { id } = parsed.data;
  const now = new Date();

  try {
    const existing = deps.db.select().from(notes).where(eq(notes.id, id)).get();
    if (!existing) {
      throw {
        code: 'NOT_FOUND' as const,
        message: `Note not found: ${id}`,
      };
    }

    deps.db.update(notes).set({ archived: 1, updatedAt: now }).where(eq(notes.id, id)).run();

    const row = deps.db.select().from(notes).where(eq(notes.id, id)).get();
    if (!row) {
      throw {
        code: 'INTERNAL' as const,
        message: 'Note was archived but cannot be read back',
      };
    }
    return rowToNote(row);
  } catch (err) {
    if (isStructuredIpcError(err)) throw err;
    throw toPersistenceError(err, 'Failed to archive note');
  }
}

/** `note:delete` handler：硬删。 */
export async function handleNoteDelete(
  deps: NoteIpcDeps,
  payload: unknown,
): Promise<{ deleted: true }> {
  const parsed = NoteDeleteInputSchema.safeParse(payload);
  if (!parsed.success) {
    throw {
      code: 'VALIDATION_FAILED' as const,
      message: 'Invalid note delete input',
      details: parsed.error.flatten(),
    };
  }
  const { id } = parsed.data;

  try {
    const existing = deps.db.select().from(notes).where(eq(notes.id, id)).get();
    if (!existing) {
      throw {
        code: 'NOT_FOUND' as const,
        message: `Note not found: ${id}`,
      };
    }
    deps.db.delete(notes).where(eq(notes.id, id)).run();
    return NoteDeleteResponseSchema.parse({ deleted: true });
  } catch (err) {
    if (isStructuredIpcError(err)) throw err;
    throw toPersistenceError(err, 'Failed to delete note');
  }
}

/**
 * `note:linkToTask` handler：把 taskId 加进 note.linkedTaskIds（去重，保留顺序）。
 *
 * 任务存在性**不**校验 —— 任务被硬删后 id 仍在数组里，UI 层在渲染时配合
 * taskStore 过滤"任务已删除"提示。
 */
export async function handleNoteLinkToTask(
  deps: NoteIpcDeps,
  payload: unknown,
): Promise<NoteParsed> {
  const parsed = LinkNoteToTaskInputSchema.safeParse(payload);
  if (!parsed.success) {
    throw {
      code: 'VALIDATION_FAILED' as const,
      message: 'Invalid note link input',
      details: parsed.error.flatten(),
    };
  }
  const { noteId, taskId } = parsed.data;
  const now = new Date();

  try {
    const existing = deps.db.select().from(notes).where(eq(notes.id, noteId)).get();
    if (!existing) {
      throw {
        code: 'NOT_FOUND' as const,
        message: `Note not found: ${noteId}`,
      };
    }

    // 去重 + 保序
    const next = existing.linkedTaskIds.includes(taskId)
      ? existing.linkedTaskIds
      : [...existing.linkedTaskIds, taskId];

    deps.db
      .update(notes)
      .set({ linkedTaskIds: next, updatedAt: now })
      .where(eq(notes.id, noteId))
      .run();

    const row = deps.db.select().from(notes).where(eq(notes.id, noteId)).get();
    if (!row) {
      throw {
        code: 'INTERNAL' as const,
        message: 'Note was linked but cannot be read back',
      };
    }
    return rowToNote(row);
  } catch (err) {
    if (isStructuredIpcError(err)) throw err;
    throw toPersistenceError(err, 'Failed to link note to task');
  }
}

/**
 * `note:unlinkFromTask` handler：从 note.linkedTaskIds 移除 taskId（如不存在则 no-op）。
 */
export async function handleNoteUnlinkFromTask(
  deps: NoteIpcDeps,
  payload: unknown,
): Promise<NoteParsed> {
  const parsed = UnlinkNoteFromTaskInputSchema.safeParse(payload);
  if (!parsed.success) {
    throw {
      code: 'VALIDATION_FAILED' as const,
      message: 'Invalid note unlink input',
      details: parsed.error.flatten(),
    };
  }
  const { noteId, taskId } = parsed.data;
  const now = new Date();

  try {
    const existing = deps.db.select().from(notes).where(eq(notes.id, noteId)).get();
    if (!existing) {
      throw {
        code: 'NOT_FOUND' as const,
        message: `Note not found: ${noteId}`,
      };
    }

    const next = existing.linkedTaskIds.filter((id) => id !== taskId);

    // 仅当实际变化才写库（省 updatedAt 抖动 + 触发不必要的 store 刷新）
    if (next.length !== existing.linkedTaskIds.length) {
      deps.db
        .update(notes)
        .set({ linkedTaskIds: next, updatedAt: now })
        .where(eq(notes.id, noteId))
        .run();
    }

    const row = deps.db.select().from(notes).where(eq(notes.id, noteId)).get();
    if (!row) {
      throw {
        code: 'INTERNAL' as const,
        message: 'Note was unlinked but cannot be read back',
      };
    }
    return rowToNote(row);
  } catch (err) {
    if (isStructuredIpcError(err)) throw err;
    throw toPersistenceError(err, 'Failed to unlink note from task');
  }
}

// ============================================================
//  T4-3 导出（`note:export`）
// ============================================================

/** 文件名 slug 化：替换 Windows / Unix 非法字符 + 折叠空白 + 截断。 */
export function slugifyTitle(title: string, maxLen: number = 80): string {
  // 1. 替换 Windows / Unix 非法字符为 `-`
  //    Windows: < > : " / \ | ? * 加上控制字符 0..31
  //    Unix: /
  // 2. 折叠空白为 `-`
  // 3. 折叠连续 `-`
  // 4. 去头尾 `-` / `_` / `.` / 空白
  // 5. 截断到 maxLen
  // 6. 空 fallback → "note"
  // 注意：不用 regex 控制字符类（eslint no-control-regex）—— 用 charCode 走一遍
  const illegalChars = new Set(['<', '>', ':', '"', '/', '\\', '|', '?', '*']);
  let buf = '';
  for (const ch of title) {
    const code = ch.charCodeAt(0);
    if (code <= 0x1f) {
      buf += '-';
    } else if (illegalChars.has(ch)) {
      buf += '-';
    } else {
      buf += ch;
    }
  }
  const cleaned = buf
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-_.]+|[-_.]+$/g, '')
    .slice(0, maxLen);
  return cleaned.length > 0 ? cleaned : 'note';
}

/** YAML 字符串字段值（双引号 + 转义内部双引号 / 反斜杠 / 控制字符）。 */
function yamlQuote(value: string): string {
  // 简化：只处理 ASCII 控制字符 + 双引号 + 反斜杠
  // 对中文 / 其他 unicode 不做转义（YAML 1.2 + UTF-8 直接合法）
  // 不用 regex 控制字符类（eslint no-control-regex）—— 用 charCode 走一遍
  const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  let buf = '';
  for (const ch of escaped) {
    const code = ch.charCodeAt(0);
    if (code === 0x00) buf += '\\0';
    else if (code === 0x07) buf += '\\a';
    else if (code === 0x08) buf += '\\b';
    else if (code === 0x09) buf += '\\t';
    else if (code === 0x0a) buf += '\\n';
    else if (code === 0x0c) buf += '\\f';
    else if (code === 0x0d) buf += '\\r';
    else buf += ch;
  }
  return `"${buf}"`;
}

/**
 * 把单条 Note 渲染成 Markdown + YAML frontmatter。
 *
 * **安全（PROJECT_IDENTITY.md §6.1 / §6.5）**：
 *   - **不**含 API Key / Provider 配置 / inbox 内容 / task 内容
 *   - YAML 字段仅来自 note 自身（id / title / tags / createdAt / source / linkedTaskIds / archived）
 *   - 列表字段（tags / linkedTaskIds）用 JSON-ish 数组语法（YAML 兼容）
 *
 * @param note  单条 note（IPC DTO）
 * @returns 完整文件内容（含 frontmatter）
 */
export function renderNoteToMarkdown(note: Note): string {
  const tagsStr = note.tags.length === 0 ? '[]' : `[${note.tags.map(yamlQuote).join(', ')}]`;
  const linkedStr =
    note.linkedTaskIds.length === 0 ? '[]' : `[${note.linkedTaskIds.map(yamlQuote).join(', ')}]`;
  const lines: string[] = [
    '---',
    `id: ${yamlQuote(note.id)}`,
    `title: ${yamlQuote(note.title)}`,
    `tags: ${tagsStr}`,
    `createdAt: ${yamlQuote(new Date(note.createdAt).toISOString())}`,
    `source: ${yamlQuote(note.source)}`,
    `linkedTaskIds: ${linkedStr}`,
    `archived: ${note.archived ? 'true' : 'false'}`,
    '---',
    '',
    `# ${note.title}`,
    '',
    note.content,
    '',
  ];
  return lines.join('\n');
}

/** 解析默认目标目录（带测试 override 钩子 —— 测试可注入 `tmpdir`）。 */
function resolveDefaultExportDir(): string {
  const date = new Date().toISOString().slice(0, 10);
  // 优先 `USERPROFILE`（Windows），fallback `HOME`，再 fallback `tmpdir()`
  const home = process.env['USERPROFILE'] ?? process.env['HOME'] ?? homedir() ?? tmpdir();
  return join(home, 'Downloads', 'minimax-workstation-notes', date);
}

/**
 * `note:export` handler（T4-3）。
 *
 * 行为：
 *   1. Zod 校验入参（`ids` 1~256 个；`targetDir` 可选）
 *   2. 解析目标目录（缺省 → `<userHome>/Downloads/minimax-workstation-notes/{date}/`）
 *   3. 依次读每个 note（按 id 查 db；找不到的 id 跳过且不报错 —— 部分导出是合理选择）
 *   4. 每个 note 写成一个 `.md` 文件，文件名 = `slug(title) + ulid 后缀`
 *   5. 累计 `files: [{ id, path }]`，返回给渲染端
 *
 * **错误码**（PROJECT_IDENTITY.md §4.4）：
 *   - `VALIDATION_FAILED`  Zod 校验失败 / `ids` 为空
 *   - `PERSISTENCE_FAILED` 写盘失败（mkdir / writeFile）
 *   - `INTERNAL`           未分类
 *
 * **导出文件不含**（PROJECT_IDENTITY.md §6.5）：
 *   - API Key
 *   - Provider 配置（model / baseURL）
 *   - inbox 条目内容
 *   - task 内容
 *   仅含 note 自身字段（title / tags / createdAt / source / linkedTaskIds / content）+ 归档标志。
 */
export async function handleNoteExport(
  deps: NoteIpcDeps,
  payload: unknown,
  /** 测试钩子：覆盖默认目标目录解析（生产 = `undefined`）。 */
  resolveDir: (() => string) | undefined = undefined,
): Promise<NoteExportResponseParsed> {
  const parsed = NoteExportRequestSchema.safeParse(payload);
  if (!parsed.success) {
    throw {
      code: 'VALIDATION_FAILED' as const,
      message: 'Invalid note export input',
      details: parsed.error.flatten(),
    };
  }
  const { ids, targetDir } = parsed.data;

  // 1. 解析目标目录
  let dir: string;
  try {
    dir = targetDir ?? (resolveDir ? resolveDir() : resolveDefaultExportDir());
  } catch (err) {
    throw {
      code: 'INTERNAL' as const,
      message: `Failed to resolve export dir: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // 2. 确保目录存在（mkdir 失败 → PERSISTENCE_FAILED）
  if (!existsSync(dir)) {
    try {
      mkdirSync(dir, { recursive: true });
    } catch (err) {
      throw {
        code: 'PERSISTENCE_FAILED' as const,
        message: `Failed to create export dir ${dir}: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  // 3. 读 notes → 渲染 → 写文件
  const files: NoteExportFileParsed[] = [];
  for (const id of ids) {
    const row = deps.db.select().from(notes).where(eq(notes.id, id)).get();
    if (!row) {
      // 找不到的 id 跳过（不报错 —— 部分导出是合法语义；UI 可选显示"跳过 N 条"）
      continue;
    }
    const note = rowToNote(row);
    const slug = slugifyTitle(note.title);
    // ulid 后缀防重名：取 ulid 末 6 位（保持文件名短 + 唯一性足够）
    const suffix = note.id.slice(-6);
    const filename = `${slug}-${suffix}.md`;
    const fullPath = join(dir, filename);
    const content = renderNoteToMarkdown(note);
    try {
      writeFileSync(fullPath, content, { encoding: 'utf-8' });
    } catch (err) {
      throw {
        code: 'PERSISTENCE_FAILED' as const,
        message: `Failed to write note ${note.id} to ${fullPath}: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    files.push({ id: note.id, path: fullPath });
  }

  return NoteExportResponseSchema.parse({ files });
}

// ============================================================
//  registerNoteIpc：把 handler 挂到 ipcMain（主进程启动时调一次）
// ============================================================

/**
 * 注册 9 个 `note:*` IPC handler。
 *
 * 调用方：`electron/main/index.ts` 的 `app.whenReady()` 阶段。
 */
export function registerNoteIpc(deps: NoteIpcDeps): void {
  ipcMain.handle('note:list', async (_evt, payload: unknown) => {
    try {
      return { ok: true as const, data: await handleNoteList(deps, payload) };
    } catch (err) {
      if (isStructuredIpcError(err)) return { ok: false as const, error: err };
      return { ok: false as const, error: toIpcError(err) };
    }
  });

  ipcMain.handle('note:get', async (_evt, payload: unknown) => {
    try {
      return { ok: true as const, data: await handleNoteGet(deps, payload) };
    } catch (err) {
      if (isStructuredIpcError(err)) return { ok: false as const, error: err };
      return { ok: false as const, error: toIpcError(err) };
    }
  });

  ipcMain.handle('note:create', async (_evt, payload: unknown) => {
    try {
      return { ok: true as const, data: await handleNoteCreate(deps, payload) };
    } catch (err) {
      if (isStructuredIpcError(err)) return { ok: false as const, error: err };
      return { ok: false as const, error: toIpcError(err) };
    }
  });

  ipcMain.handle('note:update', async (_evt, payload: unknown) => {
    try {
      return { ok: true as const, data: await handleNoteUpdate(deps, payload) };
    } catch (err) {
      if (isStructuredIpcError(err)) return { ok: false as const, error: err };
      return { ok: false as const, error: toIpcError(err) };
    }
  });

  ipcMain.handle('note:archive', async (_evt, payload: unknown) => {
    try {
      return { ok: true as const, data: await handleNoteArchive(deps, payload) };
    } catch (err) {
      if (isStructuredIpcError(err)) return { ok: false as const, error: err };
      return { ok: false as const, error: toIpcError(err) };
    }
  });

  ipcMain.handle('note:delete', async (_evt, payload: unknown) => {
    try {
      return { ok: true as const, data: await handleNoteDelete(deps, payload) };
    } catch (err) {
      if (isStructuredIpcError(err)) return { ok: false as const, error: err };
      return { ok: false as const, error: toIpcError(err) };
    }
  });

  ipcMain.handle('note:linkToTask', async (_evt, payload: unknown) => {
    try {
      return { ok: true as const, data: await handleNoteLinkToTask(deps, payload) };
    } catch (err) {
      if (isStructuredIpcError(err)) return { ok: false as const, error: err };
      return { ok: false as const, error: toIpcError(err) };
    }
  });

  ipcMain.handle('note:unlinkFromTask', async (_evt, payload: unknown) => {
    try {
      return { ok: true as const, data: await handleNoteUnlinkFromTask(deps, payload) };
    } catch (err) {
      if (isStructuredIpcError(err)) return { ok: false as const, error: err };
      return { ok: false as const, error: toIpcError(err) };
    }
  });

  ipcMain.handle('note:export', async (_evt, payload: unknown) => {
    try {
      return { ok: true as const, data: await handleNoteExport(deps, payload) };
    } catch (err) {
      if (isStructuredIpcError(err)) return { ok: false as const, error: err };
      return { ok: false as const, error: toIpcError(err) };
    }
  });
}
