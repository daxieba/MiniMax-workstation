/**
 * 笔记导出对话框（T4-3 知识沉淀第三阶段）
 *
 * 多选笔记 + 选择目标目录 + 调 `noteStore.export`。
 *
 * **不做**：
 *   - 不直接调 fs / 写文件（统一走 `noteStore.export` → 主进程 handler）
 *   - 不渲染 Markdown 内容（只列标题 / 标签 / 时间）
 *   - 不实现"删除"语义（导出本身**不**是删除 —— 身份卡 §6.4 仅"删除"需二次确认；
 *     导出的二次确认是业务级"覆盖目标目录"，本组件在选择目标时已通过原生 dialog
 *     给用户做了一次确认，且**默认**目标目录是新建的 `{date}/` 子目录不会覆盖旧文件）
 *
 * **测试**（tests/NoteExportDialog.test.tsx）：
 *   - 渲染 note 列表 + checkbox
 *   - 默认全选（被选 checkbox 选中）
 *   - 切换选中
 *   - 选目录 → 调 dialog stub → input 填入
 *   - "开始导出" → 调 onExport
 *   - 取消 → 调 onClose
 *   - 空列表 → 显示空态
 */

import { useEffect, useMemo, useState } from 'react';
import { FolderOpen, Loader2, X } from 'lucide-react';

import type { Note } from '@shared/types/note';

export interface NoteExportDialogProps {
  /** 候选笔记（一般 = 当前过滤下的所有 notes）。 */
  notes: Note[];
  /** 默认全选？默认 true。 */
  defaultAllSelected?: boolean;
  /** 关闭对话框。 */
  onClose: () => void;
  /** 提交导出。返回 Promise，UI 等它完成。 */
  onExport: (selectedIds: string[], targetDir: string) => Promise<void>;
  /**
   * 选目录：调用方实现（生产 = 调 `window.api.dialog.showOpenDialog`）。
   * 渲染进程**不能**直接 require electron，本组件通过 prop 注入。
   * 测试可以传一个 stub 返回固定路径。
   */
  pickDirectory: () => Promise<string | null>;
  /** 默认目录（仅展示用，实际落盘 = 用户选的目录）。 */
  defaultDirHint?: string;
  /** 是否正在导出（disable 按钮 / 显示 loading）。 */
  exporting?: boolean;
}

const TIME_FORMATTER = new Intl.DateTimeFormat('zh-CN', {
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

function formatTime(ms: number): string {
  return TIME_FORMATTER.format(new Date(ms));
}

export function NoteExportDialog({
  notes,
  defaultAllSelected = true,
  onClose,
  onExport,
  pickDirectory,
  defaultDirHint,
  exporting = false,
}: NoteExportDialogProps): React.ReactElement {
  const [selected, setSelected] = useState<Set<string>>(() => {
    if (!defaultAllSelected) return new Set();
    return new Set(notes.map((n) => n.id));
  });
  const [targetDir, setTargetDir] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  // 候选列表变化时，默认全选重置
  useEffect(() => {
    if (defaultAllSelected) {
      setSelected(new Set(notes.map((n) => n.id)));
    }
  }, [notes, defaultAllSelected]);

  const selectedCount = selected.size;
  const canSubmit = selectedCount > 0 && targetDir.length > 0 && !exporting;

  function toggleOne(id: string): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function toggleAll(): void {
    setSelected((prev) => {
      if (prev.size === notes.length) {
        return new Set();
      }
      return new Set(notes.map((n) => n.id));
    });
  }

  async function handlePick(): Promise<void> {
    setError(null);
    try {
      const dir = await pickDirectory();
      if (dir !== null && dir.length > 0) {
        setTargetDir(dir);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleSubmit(): Promise<void> {
    if (!canSubmit) return;
    setError(null);
    try {
      await onExport(Array.from(selected), targetDir);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  // 按 updatedAt desc 排序（与 NoteList 一致）
  const sortedNotes = useMemo(() => [...notes].sort((a, b) => b.updatedAt - a.updatedAt), [notes]);

  return (
    <div
      data-testid="note-export-dialog"
      role="dialog"
      aria-modal="true"
      aria-label="导出笔记"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
        // 点遮罩关闭（仅非导出中）
        if (!exporting && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        data-testid="note-export-dialog-panel"
        className="flex max-h-[80vh] w-full max-w-2xl flex-col gap-3 rounded-lg border border-line bg-base p-4 shadow-card"
      >
        <header className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-primary">导出笔记</h2>
          <button
            type="button"
            data-testid="note-export-dialog-close"
            onClick={onClose}
            disabled={exporting}
            className="rounded-md p-1 text-secondary transition-colors hover:text-primary disabled:opacity-50"
            title="关闭"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </header>

        {/* 目录选择 */}
        <div className="space-y-1">
          <label className="block text-xs text-secondary">目标目录</label>
          <div className="flex items-center gap-2">
            <input
              type="text"
              data-testid="note-export-dialog-dir"
              value={targetDir}
              onChange={(e) => setTargetDir(e.target.value)}
              placeholder={defaultDirHint ?? '选目录'}
              className="flex-1 rounded-md border border-line bg-elevated px-2 py-1 text-sm text-primary outline-none focus:border-accent"
            />
            <button
              type="button"
              data-testid="note-export-dialog-browse"
              onClick={() => void handlePick()}
              disabled={exporting}
              className="inline-flex items-center gap-1 rounded-md border border-line bg-elevated px-3 py-1 text-xs text-primary transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
            >
              <FolderOpen className="h-3 w-3" aria-hidden="true" />
              浏览
            </button>
          </div>
        </div>

        {/* 笔记列表 + 多选 */}
        <div className="flex min-h-0 flex-1 flex-col gap-1">
          <div className="flex items-center justify-between text-xs text-secondary">
            <span>
              候选笔记 <span data-testid="note-export-dialog-count">{notes.length}</span> 条
              {selectedCount !== notes.length ? (
                <>
                  {' · '}
                  <span data-testid="note-export-dialog-selected">{selectedCount}</span> 条已选
                </>
              ) : null}
            </span>
            <button
              type="button"
              data-testid="note-export-dialog-toggle-all"
              onClick={toggleAll}
              disabled={notes.length === 0 || exporting}
              className="rounded border border-line bg-elevated px-2 py-0.5 text-xs text-primary transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
            >
              {selected.size === notes.length ? '全不选' : '全选'}
            </button>
          </div>
          <div
            data-testid="note-export-dialog-list"
            className="min-h-32 max-h-72 flex-1 overflow-auto rounded-md border border-line bg-elevated"
          >
            {sortedNotes.length === 0 ? (
              <p
                data-testid="note-export-dialog-empty"
                className="p-4 text-center text-sm text-secondary"
              >
                没有可导出的笔记。
              </p>
            ) : (
              <ul className="divide-y divide-line">
                {sortedNotes.map((n) => {
                  const checked = selected.has(n.id);
                  return (
                    <li
                      key={n.id}
                      data-testid={`note-export-dialog-item-${n.id}`}
                      className="flex items-center gap-2 px-2 py-1.5"
                    >
                      <input
                        type="checkbox"
                        data-testid={`note-export-dialog-checkbox-${n.id}`}
                        checked={checked}
                        onChange={() => toggleOne(n.id)}
                        disabled={exporting}
                        className="h-3.5 w-3.5 cursor-pointer accent-accent"
                        aria-label={`选择笔记 ${n.title}`}
                      />
                      <div className="flex min-w-0 flex-1 flex-col">
                        <span
                          data-testid={`note-export-dialog-item-title-${n.id}`}
                          className="truncate text-sm text-primary"
                        >
                          {n.title}
                        </span>
                        <span className="truncate text-[10px] text-secondary">
                          {n.tags.length > 0 ? `#${n.tags.join(' #')}` : '(无标签)'} ·{' '}
                          {formatTime(n.updatedAt)}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        {error ? (
          <div
            role="alert"
            data-testid="note-export-dialog-error"
            className="rounded border border-danger bg-danger-soft/40 px-3 py-1.5 text-xs text-danger"
          >
            {error}
          </div>
        ) : null}

        <footer className="flex items-center justify-end gap-2 border-t border-line pt-3">
          <button
            type="button"
            data-testid="note-export-dialog-cancel"
            onClick={onClose}
            disabled={exporting}
            className="rounded-md border border-line bg-base px-3 py-1.5 text-sm text-secondary transition-colors hover:text-primary disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="button"
            data-testid="note-export-dialog-submit"
            onClick={() => void handleSubmit()}
            disabled={!canSubmit}
            className="inline-flex items-center gap-1 rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-inverse transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}
            {exporting ? '导出中…' : '开始导出'}
          </button>
        </footer>
      </div>
    </div>
  );
}
