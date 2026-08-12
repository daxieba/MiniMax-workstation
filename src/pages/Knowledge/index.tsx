/**
 * 知识库页（T4-1 完整实现 + T4-2 全文搜索 UI + T4-3 AI 摘要 + 导出）
 *
 * 布局：
 *   - 左侧栏（30% 宽）：过滤区 + 笔记列表
 *   - 右侧主区（70% 宽）：
 *     - 默认：选中笔记的查看 / 编辑（+ 底部 NoteAIPanel）
 *     - 搜索激活（query 非空）：搜索结果列表（跨笔记 / 任务 / 收集箱）
 *
 * 状态：
 *   - `view`            `'list' | 'create' | 'edit'`
 *   - `selectedId`      当前选中的 note id
 *   - `draft`           编辑草稿（create + edit 模式用）
 *   - `exportOpen`      导出对话框开关
 *
 * 行为：
 *   - 点 "+ 新建笔记" → 进入 create 模式（右侧 NoteEditor）
 *   - 点列表项 → 进入 view 模式（右侧 NoteViewer + NoteAIPanel）
 *   - viewer 上点"编辑" → 进入 edit 模式（右侧 NoteEditor + NoteAIPanel）
 *   - 归档切换（左上） → 切 store.filter.archived
 *   - 项目过滤（左上） → 切 store.filter.projectId
 *   - 标签过滤（左上） → 切 store.filter.tag
 *   - 删除 → 二次确认（window.confirm）→ 调 store.delete
 *   - **T4-2**：顶部 SearchBar → 触发搜索；搜索结果在主区显示
 *     - 点击 note 结果 → 选中该 note（在 note 列表 + 右侧 viewer 同步）
 *     - 点击 task / inbox 结果 → 跳转到对应页面（Projects / Inbox）
 *   - **T4-3**：
 *     - 顶部"AI 摘要选中" → 调 aiStore.runStructuredAction(...)
 *     - 顶部"导出选中" → 打开 NoteExportDialog
 *     - 右侧底部 NoteAIPanel → 触发 / 展示 / 应用 AI 摘要结果
 *
 * 二次确认（PROJECT_IDENTITY.md §6.4）：
 *   - 删除笔记 → 强制 `window.confirm`
 *   - 归档 / 取消关联任务 → 不确认（可逆 / 改主进程幂等）
 *   - 导出本身**不**是删除 → 不需要二次确认（已通过 dialog 让用户选目录）
 *   - AI 摘要"应用到笔记"会覆盖原内容 → NoteAIPanel 内做二次确认
 *
 * **不做**：
 *   - 不做笔记 / FTS5 搜索的 IPC（已落地，T4-1 / T4-2 范围）
 *   - 不做复盘 / 知识库聚合视图 —— T4 范围只做笔记（聚合留给 T5）
 *   - 不做搜索历史 / 联想词（留给后续卡）
 *   - 不引入新依赖
 *
 * 数据源：
 *   - `useNoteStore`     笔记列表 + CRUD + 导出
 *   - `useProjectStore`  项目下拉（编辑器 / 过滤）
 *   - `useTaskStore`     关联任务（编辑器 / 任务数显示 / viewer）
 *   - `useSearchStore`   全文搜索（T4-2）
 *   - `useAiStore`       AI 摘要 runStructuredAction（T4-3）
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, Library, Plus, Search, Sparkles, Tag as TagIcon } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { NoteAIPanel } from '@/components/NoteAIPanel/NoteAIPanel';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { useT } from '@/i18n';
import {
  NoteEditor,
  type NoteDraft,
  EMPTY_NOTE_DRAFT,
  noteToDraft,
  type NoteEditorSubmitPayload,
} from '@/components/NoteEditor/NoteEditor';
import { NoteExportDialog } from '@/components/NoteExportDialog/NoteExportDialog';
import { NoteList } from '@/components/NoteList/NoteList';
import { NoteViewer } from '@/components/NoteViewer/NoteViewer';
import { SearchBar } from '@/components/SearchBar/SearchBar';
import { SearchResults } from '@/components/SearchResults/SearchResults';
import { useAiStore } from '@/store/aiStore';
import { useNoteStore } from '@/store/noteStore';
import { useProjectStore } from '@/store/projectStore';
import { useSearchStore } from '@/store/searchStore';
import { useTaskStore } from '@/store/taskStore';
import type { SearchResult } from '@shared/schemas/search';
import type { Note } from '@shared/types/note';
import type { NoteListFilter } from '@shared/types/note';

type ViewMode = 'view' | 'create' | 'edit';

const TRUNCATE_MAX = 60;
function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…`;
}

export default function KnowledgePage(): React.ReactElement {
  const t = useT();
  // 笔记 store
  const notes = useNoteStore((s) => s.notes);
  const notesLoading = useNoteStore((s) => s.loading);
  const notesError = useNoteStore((s) => s.error);
  const filter = useNoteStore((s) => s.filter);
  const noteLoad = useNoteStore((s) => s.load);
  const noteSetFilter = useNoteStore((s) => s.setFilter);
  const noteGet = useNoteStore((s) => s.get);
  const noteCreate = useNoteStore((s) => s.create);
  const noteUpdate = useNoteStore((s) => s.update);
  const noteArchive = useNoteStore((s) => s.archive);
  const noteDelete = useNoteStore((s) => s.delete);

  // 项目 store
  const projects = useProjectStore((s) => s.projects);
  const projectLoad = useProjectStore((s) => s.load);
  // 任务 store
  const tasks = useTaskStore((s) => s.tasks);
  const taskLoad = useTaskStore((s) => s.load);

  // T4-2 搜索 store
  const searchQuery = useSearchStore((s) => s.query);
  const searchResults = useSearchStore((s) => s.results);
  const searchLoading = useSearchStore((s) => s.loading);
  const searchError = useSearchStore((s) => s.error);
  const searchClear = useSearchStore((s) => s.clear);

  // T4-3 AI store（用于"AI 摘要选中"按钮 + NoteAIPanel 联动）
  const aiHasKey = useAiStore((s) => s.hasKey);
  const aiLoading = useAiStore((s) => s.loading);
  const aiPendingResults = useAiStore((s) => s.pendingResults);
  const aiRunStructuredAction = useAiStore((s) => s.runStructuredAction);
  const aiDismissPending = useAiStore((s) => s.dismissPending);
  const aiRefreshHasKey = useAiStore((s) => s.refreshHasKey);
  // T4-3 导出（noteStore.export）
  const noteExport = useNoteStore((s) => s.export);

  // 路由跳转（搜索结果跳到 task / inbox 详情时用）
  const navigate = useNavigate();

  // 视图级
  const [view, setView] = useState<ViewMode>('view');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<NoteDraft>(EMPTY_NOTE_DRAFT);
  // 标签过滤的输入态（避免 input 抖动，每次 enter 才写 store）
  const [tagInput, setTagInput] = useState<string>('');
  // T4-3：导出对话框开关
  const [exportOpen, setExportOpen] = useState<boolean>(false);
  // T4-3：导出进行中（用于 dialog 禁用按钮）
  const [exporting, setExporting] = useState<boolean>(false);

  // T4-2 搜索模式：query 非空 → 显示搜索结果；空 → 显示原布局
  const isSearchActive = searchQuery.trim().length > 0;

  // 首次挂载：拉笔记 / 项目 / 任务
  useEffect(() => {
    void noteLoad();
    void projectLoad();
    void taskLoad();
    void aiRefreshHasKey();
  }, [noteLoad, projectLoad, taskLoad, aiRefreshHasKey]);

  // T4-2：Knowledge 页首次进入 → 用 store.query 做一次"全部" scope 的搜索，
  // 这样默认能看到搜索 UI（任务卡：默认显示"全部" scope 结果）。
  // 用 ref 锁定只跑一次（避免 useEffect deps 告警，也避免 SearchBar 触发后覆盖用户输入）
  const initialSearchDoneRef = useRef(false);
  useEffect(() => {
    if (initialSearchDoneRef.current) return;
    initialSearchDoneRef.current = true;
    const q = useSearchStore.getState().query.trim();
    if (q.length > 0) {
      void useSearchStore.getState().search();
    }
  }, []);

  // 选中笔记变化 → 拉一次最新（兜底；列表可能已经是最新的）
  useEffect(() => {
    if (selectedId) {
      void noteGet(selectedId);
    }
  }, [selectedId, noteGet]);

  // projectId → name 映射
  const projectNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of projects) m.set(p.id, p.name);
    return m;
  }, [projects]);

  // 关联任务数（按 noteId 索引）
  const linkedTaskCountByNoteId = useMemo(() => {
    const m = new Map<string, number>();
    for (const n of notes) m.set(n.id, n.linkedTaskIds.length);
    return m;
  }, [notes]);

  // 选中的 note（实时从 store 拿，避免陈旧）
  const selectedNote = useMemo<Note | null>(
    () => notes.find((n) => n.id === selectedId) ?? null,
    [notes, selectedId],
  );

  // 选中 note 的关联任务（去 taskStore 找）
  const selectedLinkedTasks = useMemo(() => {
    if (!selectedNote) return [];
    const byId = new Map(tasks.map((t) => [t.id, t]));
    return selectedNote.linkedTaskIds
      .map((id) => byId.get(id))
      .filter((t): t is NonNullable<typeof t> => t !== undefined)
      .map((t) => ({ id: t.id, title: t.title }));
  }, [selectedNote, tasks]);

  // ====== 操作 handlers ======

  const handleCreateNote = useCallback((): void => {
    setDraft(EMPTY_NOTE_DRAFT);
    setView('create');
  }, []);

  const handleSelect = useCallback((id: string): void => {
    setSelectedId(id);
    setView('view');
  }, []);

  /**
   * T4-2：搜索结果点击。
   * - `note` → 选中并显示在 viewer
   * - `task` → 跳转到 Projects 页（任务详情在 Projects 页内）
   * - `inbox` → 跳转到 Inbox 页
   */
  const handleSearchSelect = useCallback(
    (id: string, kind: SearchResult['kind']): void => {
      if (kind === 'note') {
        handleSelect(id);
        searchClear();
      } else if (kind === 'task') {
        // Projects 页支持 ?focus=<taskId> 打开任务详情（本卡只做跳转，详情由 Projects 页处理）
        navigate(`/projects?focus=${encodeURIComponent(id)}`);
      } else {
        // inbox
        navigate('/inbox');
      }
    },
    [handleSelect, searchClear, navigate],
  );

  const handleEditStart = useCallback((): void => {
    if (!selectedNote) return;
    setDraft(noteToDraft(selectedNote));
    setView('edit');
  }, [selectedNote]);

  const handleCancel = useCallback((): void => {
    if (view === 'create') {
      setView(selectedId === null ? 'view' : 'view');
    } else if (view === 'edit') {
      setView('view');
    }
  }, [view, selectedId]);

  const handleEditorSubmit = useCallback(
    async (payload: NoteEditorSubmitPayload): Promise<void> => {
      try {
        if (payload.create) {
          const created = await noteCreate(payload.create);
          if (created) {
            setSelectedId(created.id);
            setView('view');
          }
        } else if (payload.update) {
          const updated = await noteUpdate(payload.update.id, payload.update.patch);
          if (updated) {
            setView('view');
          }
        }
      } catch {
        // toast 已在 store 里打
      }
    },
    [noteCreate, noteUpdate],
  );

  const handleDeleteNote = useCallback(async (): Promise<void> => {
    if (!selectedNote) return;
    const ok = window.confirm(t.actions.deleteConfirm(truncate(selectedNote.title, TRUNCATE_MAX)));
    if (!ok) return;
    const success = await noteDelete(selectedNote.id);
    if (success) {
      setSelectedId(null);
      setView('view');
    }
  }, [selectedNote, noteDelete, t]);

  const handleArchiveNote = useCallback(async (): Promise<void> => {
    if (!selectedNote) return;
    if (selectedNote.archived) return;
    await noteArchive(selectedNote.id);
  }, [selectedNote, noteArchive]);

  // ====== 过滤 chips（标签 / 项目 / 归档） ======

  const handleFilterChange = useCallback(
    (next: NoteListFilter): void => {
      noteSetFilter(next);
    },
    [noteSetFilter],
  );

  function commitTagFilter(): void {
    const v = tagInput.trim();
    if (v.length === 0) {
      // 清除 tag 过滤
      const { tag: _ignored, ...rest } = filter;
      void _ignored;
      handleFilterChange(rest);
    } else {
      handleFilterChange({ ...filter, tag: v });
    }
  }

  // 当前过滤下的 projectId 选项：取所有出现在可见项目中的 id
  const activeProjects = useMemo(() => projects.filter((p) => !p.archived), [projects]);

  // ====== T4-3：AI 摘要 + 导出 ======

  /**
   * 当前选中的 note 对应的最新 `note_summary` pending。
   * 找 `schemaName='note_summary' && status='pending'` 的最近一条。
   */
  const noteSummaryPending = useMemo(() => {
    if (!selectedId) return null;
    return (
      aiPendingResults.find(
        (p) =>
          p.schemaName === 'note_summary' && p.status === 'pending' && p.sourceInput !== undefined,
      ) ?? null
    );
  }, [aiPendingResults, selectedId]);

  /**
   * T4-3 顶部"AI 摘要选中"按钮：调 aiStore.runStructuredAction
   * 走 `summarize` action + `note_summary` schema（已有的 aiStore API）。
   */
  const handleSummarizeSelected = useCallback((): void => {
    if (!selectedNote) return;
    if (!aiHasKey) {
      window.alert(t.settings.sections.ai);
      return;
    }
    void aiRunStructuredAction('summarize', 'note_summary', selectedNote.content);
  }, [selectedNote, aiHasKey, aiRunStructuredAction, t]);

  /**
   * T4-3 NoteAIPanel "应用到笔记"：调 noteStore.update
   * 把 AI 摘要（title / content / tags）写回 note。
   */
  const handleApplySummary = useCallback(
    (patch: { title: string; content: string; tags: string[] }): void => {
      if (!selectedNote) return;
      void noteUpdate(selectedNote.id, {
        title: patch.title,
        content: patch.content,
        tags: patch.tags,
      });
    },
    [selectedNote, noteUpdate],
  );

  /**
   * T4-3 NoteAIPanel "丢弃"：dismiss 当前的 note_summary pending。
   */
  const handleDismissSummary = useCallback((): void => {
    if (noteSummaryPending) {
      aiDismissPending(noteSummaryPending.id);
    }
  }, [noteSummaryPending, aiDismissPending]);

  /**
   * T4-3 NoteAIPanel "触发 AI 摘要"。
   */
  const handlePanelSummarize = useCallback(
    (noteContent: string): void => {
      if (!selectedNote) return;
      if (!aiHasKey) {
        window.alert(t.settings.sections.ai);
        return;
      }
      void aiRunStructuredAction('summarize', 'note_summary', noteContent);
    },
    [selectedNote, aiHasKey, aiRunStructuredAction, t],
  );

  /**
   * T4-3 顶部"导出选中"按钮 → 打开对话框。
   * 候选列表 = 当前过滤下的所有 notes。
   */
  const handleOpenExport = useCallback((): void => {
    if (notes.length === 0) {
      window.alert(t.pages.knowledge.noExportable);
      return;
    }
    setExportOpen(true);
  }, [notes.length, t]);

  /**
   * T4-3 NoteExportDialog 提交导出。
   */
  const handleConfirmExport = useCallback(
    async (selectedIds: string[], targetDir: string): Promise<void> => {
      setExporting(true);
      try {
        const files = await noteExport(selectedIds, targetDir);
        if (files !== null) {
          // 成功：关闭 dialog（store 已 toast 提示）
          setExportOpen(false);
        }
      } finally {
        setExporting(false);
      }
    },
    [noteExport],
  );

  /**
   * T4-3 选目录：调主进程 dialog（通过 electron 的 ipcRenderer —— 在渲染端我们走
   * preload 暴露的接口）。
   *
   * **T5-2 TODO**：T5-2 已经落地 `dialog:showOpenDialog` IPC（`window.api.dialog.showOpenDialog`），
   * 但本组件**不**在本卡范围改动（保持范围严格 —— 改这里要跑 T4-3 的全部测试）。
   * 后续 T5-2.1 / T5-3 可以把下面的 `window.prompt` 改成调 `window.api.dialog.showOpenDialog`。
   */
  const handlePickDir = useCallback(async (): Promise<string | null> => {
    const v = window.prompt(
      '输入目标目录绝对路径：\n\n（示例：D:\\Export\\Notes）\n\n' +
        '主进程会把每条 note 写成 `{slug(title)}-{ulid后缀}.md`。',
      '',
    );
    if (v === null) return null;
    const trimmed = v.trim();
    if (trimmed.length === 0) return null;
    return trimmed;
  }, []);

  return (
    <section className="flex h-full flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-elevated/40 px-6 py-4">
        <div>
          <h1 className="text-2xl font-semibold text-primary">{t.pages.knowledge.title}</h1>
          <p className="text-sm text-secondary">{t.pages.knowledge.subtitle(notes.length)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* T4-3：AI 摘要选中 / 导出选中 / 新建 */}
          <button
            type="button"
            data-testid="knowledge-ai-summarize-selected"
            onClick={handleSummarizeSelected}
            disabled={!selectedNote || aiLoading}
            title={selectedNote ? t.pages.knowledge.aiSummarizeHint : t.pages.knowledge.aiSummarizeHintNoSel}
            className="inline-flex items-center gap-1 rounded-md border border-line bg-elevated px-3 py-1.5 text-sm text-primary transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Sparkles className="h-4 w-4" aria-hidden="true" />
            {t.pages.knowledge.aiSummarize}
          </button>
          <button
            type="button"
            data-testid="knowledge-export-open"
            onClick={handleOpenExport}
            disabled={notes.length === 0}
            title={notes.length === 0 ? t.pages.knowledge.noExportable : t.pages.knowledge.exportHint}
            className="inline-flex items-center gap-1 rounded-md border border-line bg-elevated px-3 py-1.5 text-sm text-primary transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            {t.pages.knowledge.export}
          </button>
          <button
            type="button"
            data-testid="knowledge-new-note"
            onClick={handleCreateNote}
            className="inline-flex items-center gap-1 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-inverse transition-colors hover:bg-accent-hover"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            {t.pages.knowledge.newNote}
          </button>
        </div>
      </header>

      {/* T4-2 搜索栏：跨表搜索（笔记 / 任务 / 收集箱） */}
      <div className="border-b border-line bg-elevated/20 px-6 py-3">
        <SearchBar testIdPrefix="knowledge-search" />
      </div>

      <div className="flex min-h-0 flex-1">
        {/* ====== 左侧栏 ====== */}
        <aside
          data-testid="knowledge-sidebar"
          className="flex w-80 shrink-0 flex-col gap-3 border-r border-line bg-sidebar p-3"
        >
          {/* 过滤区 */}
          <div className="space-y-2">
            {/* 归档 toggle */}
            <div
              role="tablist"
              aria-label={t.pages.knowledge.archiveFilterLabel}
              className="inline-flex w-full rounded-md border border-line bg-elevated p-0.5 text-xs"
            >
              {(
                [
                  { value: false, label: t.pages.knowledge.archiveFilterActive },
                  { value: true, label: t.pages.knowledge.archiveFilterArchived },
                ] as const
              ).map((opt) => {
                const active = (filter.archived ?? false) === opt.value;
                return (
                  <button
                    key={String(opt.value)}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    data-testid={`knowledge-archive-filter-${opt.value ? 'archived' : 'active'}`}
                    onClick={() => handleFilterChange({ ...filter, archived: opt.value })}
                    className={[
                      'flex-1 rounded px-2 py-1 transition-colors',
                      active ? 'bg-accent text-inverse' : 'text-secondary hover:text-primary',
                    ].join(' ')}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>

            {/* 项目过滤 */}
            <select
              data-testid="knowledge-project-filter"
              value={
                filter.projectId === undefined
                  ? ''
                  : filter.projectId === null
                    ? '__none__'
                    : filter.projectId
              }
              onChange={(e) => {
                const v = e.target.value;
                if (v === '') {
                  const { projectId: _ignored, ...rest } = filter;
                  void _ignored;
                  handleFilterChange(rest);
                } else if (v === '__none__') {
                  handleFilterChange({ ...filter, projectId: null });
                } else {
                  handleFilterChange({ ...filter, projectId: v });
                }
              }}
              className="w-full rounded-md border border-line bg-base px-2 py-1.5 text-xs text-primary outline-none focus:border-accent"
              aria-label={t.pages.knowledge.projectFilterLabel}
            >
              <option value="">{t.pages.knowledge.projectFilterAll}</option>
              <option value="__none__">{t.pages.inbox.projectNone}</option>
              {activeProjects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>

            {/* 标签过滤输入 */}
            <div className="flex items-center gap-1">
              <div className="relative flex-1">
                <Search
                  className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-secondary"
                  aria-hidden="true"
                />
                <input
                  type="text"
                  data-testid="knowledge-tag-filter"
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      commitTagFilter();
                    }
                  }}
                  onBlur={() => {
                    if (tagInput.length > 0) commitTagFilter();
                  }}
                  placeholder={t.pages.knowledge.tagFilterPlaceholder}
                  className="w-full rounded-md border border-line bg-base py-1.5 pl-7 pr-2 text-xs text-primary outline-none focus:border-accent"
                />
              </div>
              {filter.tag !== undefined ? (
                <button
                  type="button"
                  data-testid="knowledge-tag-filter-clear"
                  onClick={() => {
                    setTagInput('');
                    const { tag: _ignored, ...rest } = filter;
                    void _ignored;
                    handleFilterChange(rest);
                  }}
                  className="rounded-md border border-line bg-base px-2 py-1 text-xs text-secondary transition-colors hover:text-primary"
                  title={t.pages.knowledge.tagFilterClear}
                >
                  <TagIcon className="h-3 w-3" aria-hidden="true" />
                </button>
              ) : null}
            </div>
            {filter.tag !== undefined ? (
              <p data-testid="knowledge-tag-filter-active" className="text-[10px] text-secondary">
                标签过滤：
                <span className="rounded-full border border-accent bg-accent-soft px-1.5 py-0.5 text-accent">
                  {filter.tag}
                </span>
              </p>
            ) : null}
          </div>

          {/* 列表 */}
          <div className="min-h-0 flex-1 overflow-auto">
            {notesError ? (
              <div
                role="alert"
                data-testid="knowledge-error"
                className="mb-2 rounded-md border border-danger bg-danger-soft/40 px-3 py-2 text-sm text-danger"
              >
                {notesError}
              </div>
            ) : null}
            {notesLoading && notes.length === 0 ? (
              <p data-testid="knowledge-loading" className="text-xs text-secondary">
                {t.common.loading}
              </p>
            ) : (
              <NoteList
                notes={notes}
                selectedId={selectedId}
                onSelect={handleSelect}
                projectNameById={projectNameById}
                linkedTaskCountByNoteId={linkedTaskCountByNoteId}
              />
            )}
          </div>
        </aside>

        {/* ====== 右侧主区 ====== */}
        <main className="flex min-h-0 flex-1 flex-col gap-3 p-4">
          {isSearchActive ? (
            // T4-2：搜索激活时显示跨表搜索结果
            <div className="flex h-full flex-col gap-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-medium text-primary">
                  {t.pages.knowledge.subtitle(searchResults.length)}
                </h2>
                {searchLoading ? (
                  <span data-testid="knowledge-search-loading" className="text-xs text-secondary">
                    {t.common.loading}
                  </span>
                ) : null}
              </div>
              <div className="min-h-0 flex-1 overflow-auto">
                <SearchResults
                  results={searchResults}
                  onSelect={handleSearchSelect}
                  testIdPrefix="knowledge-search-results"
                />
                {searchError ? (
                  <p data-testid="knowledge-search-error" className="mt-2 text-xs text-danger">
                    {searchError}
                  </p>
                ) : null}
              </div>
            </div>
          ) : view === 'create' ? (
            <>
              <NoteEditor
                mode="create"
                draft={draft}
                onChange={setDraft}
                onSubmit={handleEditorSubmit}
                onCancel={handleCancel}
                submitting={notesLoading}
                projects={activeProjects}
              />
              {/* T4-3：create 模式下显示 AI 摘要面板（用空 draft），让用户创建后立刻摘要 */}
              <NoteAIPanel
                note={null}
                pending={null}
                onSummarize={handlePanelSummarize}
                onApply={handleApplySummary}
                onDismiss={handleDismissSummary}
                loading={aiLoading}
                hasKey={aiHasKey}
              />
            </>
          ) : view === 'edit' && selectedNote ? (
            <>
              <NoteEditor
                mode="edit"
                draft={draft}
                onChange={setDraft}
                onSubmit={handleEditorSubmit}
                onCancel={handleCancel}
                onDelete={handleDeleteNote}
                onArchive={handleArchiveNote}
                submitting={notesLoading}
                projects={activeProjects}
                editingNoteId={selectedNote.id}
              />
              {/* T4-3：edit 模式下展示 AI 摘要面板 */}
              <NoteAIPanel
                note={selectedNote}
                pending={noteSummaryPending}
                onSummarize={handlePanelSummarize}
                onApply={handleApplySummary}
                onDismiss={handleDismissSummary}
                loading={aiLoading}
                hasKey={aiHasKey}
              />
            </>
          ) : selectedNote ? (
            <>
              <div className="flex items-center justify-end">
                <button
                  type="button"
                  data-testid="knowledge-edit"
                  onClick={handleEditStart}
                  className="inline-flex items-center gap-1 rounded-md border border-line bg-elevated px-3 py-1.5 text-xs text-primary transition-colors hover:border-accent hover:text-accent"
                >
                  {t.common.edit}
                </button>
              </div>
              <NoteViewer
                note={selectedNote}
                projectName={
                  selectedNote.projectId === null
                    ? null
                    : (projectNameById.get(selectedNote.projectId) ?? '未知项目')
                }
                linkedTasks={selectedLinkedTasks}
              />
              {/* T4-3：view 模式下展示 AI 摘要面板 */}
              <NoteAIPanel
                note={selectedNote}
                pending={noteSummaryPending}
                onSummarize={handlePanelSummarize}
                onApply={handleApplySummary}
                onDismiss={handleDismissSummary}
                loading={aiLoading}
                hasKey={aiHasKey}
              />
            </>
          ) : (
            <EmptyState
              icon={Library}
              title={t.empty.knowledge.title}
              description={t.empty.knowledge.description}
              data-testid="knowledge-empty"
            />
          )}
        </main>
      </div>

      {/* T4-3：导出对话框 */}
      {exportOpen ? (
        <NoteExportDialog
          notes={notes}
          defaultAllSelected
          exporting={exporting}
          onClose={() => setExportOpen(false)}
          onExport={handleConfirmExport}
          pickDirectory={handlePickDir}
          defaultDirHint="~/Downloads/minimax-workstation-notes/{date}"
        />
      ) : null}
    </section>
  );
}
