/**
 * 每日复盘页（T5-1 完整实现）
 *
 * 固定 5 段模板：
 *   1. 今天完成
 *   2. 未完成
 *   3. 阻塞
 *   4. 明天三件事
 *   5. AI 草稿（折叠区；展开后显示当前 aiDraft，下面 3 个按钮）
 *
 * **顶部**：
 *   - 日期选择器（默认今天）+ 左右切换（前一天/后一天）按钮
 *   - "加载最近 30 天"链接
 *
 * **底部**：
 *   - 大"保存"按钮（调 review:upsert）—— **不**写入 aiDraft
 *
 * **草稿交互**：
 *   - "采纳并填充"：把 aiDraft 数据写到 store 的 4 段字段（仅本地），并把
 *     aiDraft 设为 null；**不**自动保存，需要用户再点"保存"
 *   - "重新生成"：调 review:generateDraft 拿新草稿覆盖 store.aiDraft
 *   - "丢弃"：清空 aiDraft
 *
 * **风格**：Tailwind + 现有 Sidebar/Toast 模式（不引入新组件库）。
 * **错误提示**：用 useToastStore（已有）。
 * **加载状态**：loading 时按钮 disabled + 旋转图标（用 lucide-react 的 Loader2）。
 *
 * **不实现**：
 *   - 周复盘 / 月复盘 / 项目复盘 / AI 评分 / 复盘模板切换（留给后续卡）
 *   - 笔记搜索 / 设置 / 导出 / 备份 / 恢复 / NSIS 安装包（其他卡）
 *
 * @see src/store/reviewStore.ts
 * @see electron/main/ipc/review.ts
 */

import { useEffect, useMemo, useState } from 'react';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Loader2,
  Plus,
  Save,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';

import { useAiStore } from '@/store/aiStore';
import { useReviewStore } from '@/store/reviewStore';
import { toast } from '@/store/toastStore';
import { useT } from '@/i18n';
import type { Review, ReviewDraft } from '@shared/types/review';

/** 本地"今天"日期（`YYYY-MM-DD`）。 */
function todayDateString(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 把 `YYYY-MM-DD` 加 / 减 N 天，返回新的 `YYYY-MM-DD`。 */
function shiftDate(dateStr: string, days: number): string {
  // dateStr 必为 YYYY-MM-DD（schema 已 regex 校验；UI 日期选择器也保证）
  const [y, m, d] = dateStr.split('-').map((s) => Number(s));
  if (y === undefined || m === undefined || d === undefined) return dateStr;
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  const ny = dt.getFullYear();
  const nm = String(dt.getMonth() + 1).padStart(2, '0');
  const nd = String(dt.getDate()).padStart(2, '0');
  return `${ny}-${nm}-${nd}`;
}

// ============================================================
//  复盘 row 的本地状态（list of items）
// ============================================================

interface CompletedRow {
  taskId: string;
  title: string;
}

interface UncompletedRow {
  taskId: string;
  title: string;
  reason?: string;
}

/** 把当前 `current` 解析为本地 row 形式（每次 `current` 变都重新算）。 */
function deriveLocalState(current: Review | null): {
  completed: CompletedRow[];
  uncompleted: UncompletedRow[];
  blockers: string;
  topThree: string[];
} {
  if (!current) {
    return { completed: [], uncompleted: [], blockers: '', topThree: [] };
  }
  return {
    completed: current.completed.map((c) => ({ taskId: c.taskId, title: c.title })),
    uncompleted: current.uncompleted.map((u) => {
      const row: UncompletedRow = { taskId: u.taskId, title: u.title };
      if (u.reason !== undefined) row.reason = u.reason;
      return row;
    }),
    blockers: current.blockers,
    topThree: current.topThree.slice(0, 3),
  };
}

// ============================================================
//  复盘 row UI 子组件（5 段模板的 1/2/4 段都是动态列表）
// ============================================================

interface CompletedListProps {
  rows: CompletedRow[];
  onChange: (rows: CompletedRow[]) => void;
  disabled: boolean;
}

function CompletedList({ rows, onChange, disabled }: CompletedListProps): React.ReactElement {
  const t = useT();
  function add(): void {
    onChange([...rows, { taskId: '', title: '' }]);
  }
  function remove(idx: number): void {
    onChange(rows.filter((_, i) => i !== idx));
  }
  function update(idx: number, patch: Partial<CompletedRow>): void {
    onChange(rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }
  return (
    <div className="space-y-1" data-testid="review-completed-list">
      {rows.length === 0 ? (
        <p className="py-2 text-xs text-secondary" data-testid="review-completed-empty">
          {t.pages.review.completedEmpty}
        </p>
      ) : (
        rows.map((r, i) => (
          <div
            key={i}
            className="flex items-center gap-2"
            data-testid={`review-completed-row-${i}`}
          >
            <input
              type="checkbox"
              checked
              disabled
              className="h-3.5 w-3.5 accent-accent"
              aria-label={t.pages.review.ariaCompleted}
            />
            <input
              type="text"
              data-testid={`review-completed-title-${i}`}
              value={r.title}
              onChange={(e) => update(i, { title: e.target.value })}
              disabled={disabled}
              placeholder={t.pages.review.completedPlaceholder}
              className="flex-1 rounded-md border border-line bg-elevated px-2 py-1 text-sm text-primary outline-none focus:border-accent"
            />
            <button
              type="button"
              data-testid={`review-completed-remove-${i}`}
              onClick={() => remove(i)}
              disabled={disabled}
              className="rounded p-1 text-secondary transition-colors hover:text-danger disabled:opacity-50"
              title={t.pages.review.titleRemove}
              aria-label={t.pages.review.ariaRemoveCompleted}
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ))
      )}
      <button
        type="button"
        data-testid="review-completed-add"
        onClick={add}
        disabled={disabled}
        className="inline-flex items-center gap-1 rounded-md border border-dashed border-line bg-base px-2 py-1 text-xs text-secondary transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
      >
        <Plus className="h-3 w-3" aria-hidden="true" />
        {t.pages.review.addCompleted}
      </button>
    </div>
  );
}

interface UncompletedListProps {
  rows: UncompletedRow[];
  onChange: (rows: UncompletedRow[]) => void;
  disabled: boolean;
}

function UncompletedList({
  rows,
  onChange,
  disabled,
}: UncompletedListProps): React.ReactElement {
  const t = useT();
  function add(): void {
    onChange([...rows, { taskId: '', title: '' }]);
  }
  function remove(idx: number): void {
    onChange(rows.filter((_, i) => i !== idx));
  }
  function update(idx: number, patch: Partial<UncompletedRow>): void {
    onChange(rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }
  return (
    <div className="space-y-1" data-testid="review-uncompleted-list">
      {rows.length === 0 ? (
        <p className="py-2 text-xs text-secondary" data-testid="review-uncompleted-empty">
          {t.pages.review.uncompletedEmpty}
        </p>
      ) : (
        rows.map((r, i) => (
          <div
            key={i}
            className="flex flex-col gap-1 sm:flex-row sm:items-center"
            data-testid={`review-uncompleted-row-${i}`}
          >
            <div className="flex flex-1 items-center gap-2">
              <input
                type="checkbox"
                checked={false}
                disabled
                className="h-3.5 w-3.5"
                aria-label={t.pages.review.ariaUncompleted}
              />
              <input
                type="text"
                data-testid={`review-uncompleted-title-${i}`}
                value={r.title}
                onChange={(e) => update(i, { title: e.target.value })}
                disabled={disabled}
                placeholder={t.pages.review.completedPlaceholder}
                className="flex-1 rounded-md border border-line bg-elevated px-2 py-1 text-sm text-primary outline-none focus:border-accent"
              />
            </div>
            <input
              type="text"
              data-testid={`review-uncompleted-reason-${i}`}
              value={r.reason ?? ''}
              onChange={(e) => update(i, { reason: e.target.value })}
              disabled={disabled}
              placeholder={t.pages.review.uncompletedReasonPlaceholder}
              className="flex-1 rounded-md border border-line bg-elevated px-2 py-1 text-sm text-primary outline-none focus:border-accent"
            />
            <button
              type="button"
              data-testid={`review-uncompleted-remove-${i}`}
              onClick={() => remove(i)}
              disabled={disabled}
              className="rounded p-1 text-secondary transition-colors hover:text-danger disabled:opacity-50 sm:self-start"
              title={t.pages.review.titleRemove}
              aria-label={t.pages.review.ariaRemoveUncompleted}
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ))
      )}
      <button
        type="button"
        data-testid="review-uncompleted-add"
        onClick={add}
        disabled={disabled}
        className="inline-flex items-center gap-1 rounded-md border border-dashed border-line bg-base px-2 py-1 text-xs text-secondary transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
      >
        <Plus className="h-3 w-3" aria-hidden="true" />
        {t.pages.review.addUncompleted}
      </button>
    </div>
  );
}

interface TopThreeListProps {
  rows: string[];
  onChange: (rows: string[]) => void;
  disabled: boolean;
}

function TopThreeList({ rows, onChange, disabled }: TopThreeListProps): React.ReactElement {
  const t = useT();
  function add(): void {
    if (rows.length >= 3) {
      toast.info(t.pages.review.topThreeMax);
      return;
    }
    onChange([...rows, '']);
  }
  function remove(idx: number): void {
    onChange(rows.filter((_, i) => i !== idx));
  }
  function update(idx: number, value: string): void {
    onChange(rows.map((r, i) => (i === idx ? value : r)));
  }
  return (
    <div className="space-y-1" data-testid="review-topthree-list">
      {rows.length === 0 ? (
        <p className="py-2 text-xs text-secondary" data-testid="review-topthree-empty">
          {t.pages.review.topThreeEmpty}
        </p>
      ) : (
        rows.map((tt, i) => (
          <div
            key={i}
            className="flex items-center gap-2"
            data-testid={`review-topthree-row-${i}`}
          >
            <span className="w-5 text-center text-xs text-secondary">{i + 1}.</span>
            <input
              type="text"
              data-testid={`review-topthree-input-${i}`}
              value={tt}
              onChange={(e) => update(i, e.target.value)}
              disabled={disabled}
              placeholder={t.pages.review.topThreePlaceholder}
              className="flex-1 rounded-md border border-line bg-elevated px-2 py-1 text-sm text-primary outline-none focus:border-accent"
            />
            <button
              type="button"
              data-testid={`review-topthree-remove-${i}`}
              onClick={() => remove(i)}
              disabled={disabled}
              className="rounded p-1 text-secondary transition-colors hover:text-danger disabled:opacity-50"
              title={t.pages.review.titleRemove}
              aria-label={t.pages.review.ariaRemoveTopThree}
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ))
      )}
      <button
        type="button"
        data-testid="review-topthree-add"
        onClick={add}
        disabled={disabled || rows.length >= 3}
        className="inline-flex items-center gap-1 rounded-md border border-dashed border-line bg-base px-2 py-1 text-xs text-secondary transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
      >
        <Plus className="h-3 w-3" aria-hidden="true" />
        {t.pages.review.addTopThree}
      </button>
    </div>
  );
}

// ============================================================
//  AI 草稿折叠区
// ============================================================

interface AIDraftPanelProps {
  draft: ReviewDraft | null;
  loading: boolean;
  onAccept: () => void;
  onRegenerate: () => void;
  onDiscard: () => void;
}

function AIDraftPanel({
  draft,
  loading,
  onAccept,
  onRegenerate,
  onDiscard,
}: AIDraftPanelProps): React.ReactElement {
  const t = useT();
  const [open, setOpen] = useState(false);
  const hasDraft = draft !== null;

  // 草稿生成成功后自动展开
  useEffect(() => {
    if (hasDraft) setOpen(true);
  }, [hasDraft]);

  return (
    <section
      className="rounded-lg border border-line bg-elevated"
      data-testid="review-ai-draft-section"
    >
      <button
        type="button"
        data-testid="review-ai-draft-toggle"
        onClick={() => setOpen((p) => !p)}
        className="flex w-full items-center justify-between px-3 py-2 text-left"
        aria-expanded={open}
      >
        <span className="inline-flex items-center gap-2 text-sm font-medium text-primary">
          <Sparkles className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
          {t.pages.review.aiDraft}
          {hasDraft ? (
            <span className="rounded bg-accent-soft px-1.5 py-0.5 text-[10px] text-accent">
              {t.pages.review.aiDraftCount(1)}
            </span>
          ) : (
            <span className="text-xs text-secondary">{t.pages.review.aiDraftNone}</span>
          )}
        </span>
        {open ? (
          <ChevronUp className="h-4 w-4 text-secondary" aria-hidden="true" />
        ) : (
          <ChevronDown className="h-4 w-4 text-secondary" aria-hidden="true" />
        )}
      </button>

      {open ? (
        <div className="border-t border-line px-3 py-2" data-testid="review-ai-draft-body">
          {hasDraft ? (
            <div className="space-y-2 text-xs">
              <div>
                <span className="text-secondary">{t.pages.review.aiDraftCompletedLabel}</span>
                <ul className="ml-4 list-disc text-primary">
                  {draft.completed.map((tt, i) => (
                    <li key={i} data-testid={`review-ai-draft-completed-${i}`}>
                      {tt}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <span className="text-secondary">{t.pages.review.aiDraftUncompletedLabel}</span>
                <ul className="ml-4 list-disc text-primary">
                  {draft.uncompleted.map((u, i) => (
                    <li key={i} data-testid={`review-ai-draft-uncompleted-${i}`}>
                      {u.title}
                      {u.reason ? (
                        <span className="ml-1 text-secondary">（{u.reason}）</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <span className="text-secondary">{t.pages.review.aiDraftBlockersLabel}</span>
                <p className="ml-4 text-primary" data-testid="review-ai-draft-blockers">
                  {draft.blockers || t.pages.review.aiDraftNone}
                </p>
              </div>
              <div>
                <span className="text-secondary">{t.pages.review.aiDraftTopThreeLabel}</span>
                <ul className="ml-4 list-decimal text-primary">
                  {draft.topThree.map((tt, i) => (
                    <li key={i} data-testid={`review-ai-draft-topthree-${i}`}>
                      {tt}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="flex flex-wrap items-center gap-2 border-t border-line pt-2">
                <button
                  type="button"
                  data-testid="review-ai-draft-accept"
                  onClick={onAccept}
                  disabled={loading}
                  className="inline-flex items-center gap-1 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-inverse transition-colors hover:bg-accent-hover disabled:opacity-50"
                >
                  {t.pages.review.aiDraftAccept}
                </button>
                <button
                  type="button"
                  data-testid="review-ai-draft-regenerate"
                  onClick={onRegenerate}
                  disabled={loading}
                  className="inline-flex items-center gap-1 rounded-md border border-line bg-base px-3 py-1.5 text-xs text-primary transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
                >
                  {loading ? (
                    <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                  ) : (
                    <Sparkles className="h-3 w-3" aria-hidden="true" />
                  )}
                  {t.pages.review.aiDraftRegenerate}
                </button>
                <button
                  type="button"
                  data-testid="review-ai-draft-discard"
                  onClick={onDiscard}
                  disabled={loading}
                  className="inline-flex items-center gap-1 rounded-md border border-line bg-base px-3 py-1.5 text-xs text-secondary transition-colors hover:border-danger hover:text-danger disabled:opacity-50"
                >
                  <Trash2 className="h-3 w-3" aria-hidden="true" />
                  {t.pages.review.aiDraftDiscard}
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-secondary">{t.pages.review.aiDraftEmpty}</p>
              <button
                type="button"
                data-testid="review-ai-draft-regenerate"
                onClick={onRegenerate}
                disabled={loading}
                className="inline-flex items-center gap-1 rounded-md border border-line bg-base px-3 py-1.5 text-xs text-primary transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
              >
                {loading ? (
                  <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                ) : (
                  <Sparkles className="h-3 w-3" aria-hidden="true" />
                )}
                {t.pages.review.aiDraftGenerate}
              </button>
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}

// ============================================================
//  Review 主页
// ============================================================

export default function ReviewPage(): React.ReactElement {
  const t = useT();
  // store
  const current = useReviewStore((s) => s.current);
  const currentDate = useReviewStore((s) => s.currentDate);
  const recent = useReviewStore((s) => s.recent);
  const aiDraft = useReviewStore((s) => s.aiDraft);
  const loading = useReviewStore((s) => s.loading);
  const error = useReviewStore((s) => s.error);
  const loadByDate = useReviewStore((s) => s.loadByDate);
  const loadRecent = useReviewStore((s) => s.loadRecent);
  const upsertReview = useReviewStore((s) => s.upsertReview);
  const generateDraft = useReviewStore((s) => s.generateDraft);
  const acceptDraft = useReviewStore((s) => s.acceptDraft);
  const discardDraft = useReviewStore((s) => s.discardDraft);

  // AI store：拿当前 provider / model（generateDraft 必填）
  const aiProvider = useAiStore((s) => s.provider);
  const aiModel = useAiStore((s) => s.model);

  // 日期：默认今天
  const [date, setDate] = useState<string>(() => currentDate || todayDateString());
  const [showRecent, setShowRecent] = useState(false);
  const [saving, setSaving] = useState(false);

  // 每次 date 变 → loadByDate
  useEffect(() => {
    void loadByDate(date);
  }, [date, loadByDate]);

  // 本地 row 状态（基于 current）
  const initial = useMemo(() => deriveLocalState(current), [current]);
  const [completed, setCompleted] = useState<CompletedRow[]>(initial.completed);
  const [uncompleted, setUncompleted] = useState<UncompletedRow[]>(initial.uncompleted);
  const [blockers, setBlockers] = useState<string>(initial.blockers);
  const [topThree, setTopThree] = useState<string[]>(initial.topThree);

  // current 变（比如刷新 / 切换日期） → 把本地 row 同步
  useEffect(() => {
    setCompleted(initial.completed);
    setUncompleted(initial.uncompleted);
    setBlockers(initial.blockers);
    setTopThree(initial.topThree);
  }, [initial.completed, initial.uncompleted, initial.blockers, initial.topThree]);

  function handlePrevDay(): void {
    setDate((d) => shiftDate(d, -1));
  }
  function handleNextDay(): void {
    setDate((d) => shiftDate(d, 1));
  }
  function handleDateInput(e: React.ChangeEvent<HTMLInputElement>): void {
    const v = e.target.value;
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
      setDate(v);
    }
  }
  async function handleLoadRecent(): Promise<void> {
    setShowRecent((p) => !p);
    if (!showRecent) {
      await loadRecent(30);
    }
  }

  async function handleSave(): Promise<void> {
    setSaving(true);
    try {
      // 过滤空白
      const cleanCompleted = completed
        .map((r) => ({ taskId: r.taskId, title: r.title.trim() }))
        .filter((r) => r.title.length > 0);
      const cleanUncompleted = uncompleted
        .map((r) => {
          const out: { taskId: string; title: string; reason?: string } = {
            taskId: r.taskId,
            title: r.title.trim(),
          };
          const reason = (r.reason ?? '').trim();
          if (reason.length > 0) out.reason = reason;
          return out;
        })
        .filter((r) => r.title.length > 0);
      const cleanTopThree = topThree.map((t) => t.trim()).filter((t) => t.length > 0).slice(0, 3);
      await upsertReview({
        date,
        completed: cleanCompleted,
        uncompleted: cleanUncompleted,
        blockers,
        topThree: cleanTopThree,
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleGenerate(): Promise<void> {
    if (!aiProvider) {
      toast.error(t.settings.sections.ai);
      return;
    }
    await generateDraft(date, aiProvider, aiModel || undefined);
  }

  return (
    <div className="space-y-3 p-6" data-testid="review-page">
      {/* 顶部：日期选择 + 切换 + 加载最近 */}
      <header className="flex flex-wrap items-center gap-2">
        <h1 className="mr-2 text-2xl font-semibold text-primary">{t.pages.review.title}</h1>
        <button
          type="button"
          data-testid="review-prev-day"
          onClick={handlePrevDay}
          disabled={loading}
          className="rounded-md border border-line bg-elevated p-1.5 text-secondary transition-colors hover:text-primary disabled:opacity-50"
          aria-label={t.pages.review.prevDay}
          title={t.pages.review.prevDay}
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <label className="inline-flex items-center gap-1">
          <CalendarDays className="h-3.5 w-3.5 text-secondary" aria-hidden="true" />
          <input
            type="date"
            data-testid="review-date-input"
            value={date}
            onChange={handleDateInput}
            disabled={loading}
            className="rounded-md border border-line bg-elevated px-2 py-1 text-sm text-primary outline-none focus:border-accent"
          />
        </label>
        <button
          type="button"
          data-testid="review-next-day"
          onClick={handleNextDay}
          disabled={loading}
          className="rounded-md border border-line bg-elevated p-1.5 text-secondary transition-colors hover:text-primary disabled:opacity-50"
          aria-label={t.pages.review.nextDay}
          title={t.pages.review.nextDay}
        >
          <ChevronRight className="h-4 w-4" />
        </button>
        <button
          type="button"
          data-testid="review-today"
          onClick={() => setDate(todayDateString())}
          disabled={loading}
          className="rounded-md border border-line bg-elevated px-2 py-1 text-xs text-secondary transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
        >
          {t.pages.review.today}
        </button>
        <button
          type="button"
          data-testid="review-load-recent"
          onClick={() => void handleLoadRecent()}
          disabled={loading}
          className="ml-auto rounded-md border border-line bg-elevated px-2 py-1 text-xs text-secondary transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
        >
          {showRecent ? t.pages.review.recent : t.pages.review.recent}
        </button>
      </header>

      {showRecent ? (
        <section
          data-testid="review-recent-section"
          className="rounded-lg border border-line bg-elevated p-2"
        >
          <h2 className="px-2 py-1 text-sm font-medium text-primary">{t.pages.review.recent}</h2>
          {recent.length === 0 ? (
            <p className="px-2 py-3 text-xs text-secondary" data-testid="review-recent-empty">
              {t.empty.reviewRecent.description}
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {recent.map((r) => (
                <li
                  key={r.id}
                  data-testid={`review-recent-item-${r.id}`}
                  className="flex items-center gap-2 px-2 py-1.5"
                >
                  <button
                    type="button"
                    onClick={() => setDate(r.date)}
                    className="flex-1 truncate text-left text-sm text-primary hover:text-accent"
                  >
                    <span className="font-mono text-xs text-secondary">{r.date}</span>
                    <span className="ml-2">{r.blockers ? r.blockers.slice(0, 40) : '（无阻塞）'}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {error ? (
        <div
          role="alert"
          data-testid="review-error"
          className="rounded border border-danger bg-danger-soft/40 px-3 py-1.5 text-xs text-danger"
        >
          {error}
        </div>
      ) : null}

      {/* 5 段模板 */}
      <section
        className="rounded-lg border border-line bg-elevated p-3"
        data-testid="review-section-completed"
      >
        <h2 className="mb-2 text-sm font-medium text-primary">{t.pages.review.completed}</h2>
        <CompletedList rows={completed} onChange={setCompleted} disabled={saving || loading} />
      </section>

      <section
        className="rounded-lg border border-line bg-elevated p-3"
        data-testid="review-section-uncompleted"
      >
        <h2 className="mb-2 text-sm font-medium text-primary">{t.pages.review.uncompleted}</h2>
        <UncompletedList
          rows={uncompleted}
          onChange={setUncompleted}
          disabled={saving || loading}
        />
      </section>

      <section
        className="rounded-lg border border-line bg-elevated p-3"
        data-testid="review-section-blockers"
      >
        <h2 className="mb-2 text-sm font-medium text-primary">{t.pages.review.blockers}</h2>
        <textarea
          data-testid="review-blockers-input"
          value={blockers}
          onChange={(e) => setBlockers(e.target.value)}
          disabled={saving || loading}
          maxLength={4096}
          rows={3}
          placeholder={t.pages.review.blockers}
          className="w-full rounded-md border border-line bg-base px-2 py-1 text-sm text-primary outline-none focus:border-accent"
        />
      </section>

      <section
        className="rounded-lg border border-line bg-elevated p-3"
        data-testid="review-section-topthree"
      >
        <h2 className="mb-2 text-sm font-medium text-primary">{t.pages.review.topThree}</h2>
        <TopThreeList rows={topThree} onChange={setTopThree} disabled={saving || loading} />
      </section>

      <AIDraftPanel
        draft={aiDraft}
        loading={loading}
        onAccept={acceptDraft}
        onRegenerate={() => void handleGenerate()}
        onDiscard={discardDraft}
      />

      {/* 底部：保存按钮 */}
      <div className="flex items-center justify-end pt-2">
        <button
          type="button"
          data-testid="review-save"
          onClick={() => void handleSave()}
          disabled={saving || loading}
          className="inline-flex items-center gap-1 rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-inverse transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}
          <Save className="h-3.5 w-3.5" aria-hidden="true" />
          {t.pages.review.save}
        </button>
      </div>
    </div>
  );
}
