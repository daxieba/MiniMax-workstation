/**
 * 任务表单（T2-3）
 *
 * 新建 / 编辑任务。是一个简单的 dialog：标题、描述、优先级、截止日期、项目下拉、标签。
 *
 * **Props 模式**：
 *   - `open` 控制是否显示
 *   - `mode` 区分新建（create） / 编辑（edit）
 *   - `initial` 编辑时填初值
 *   - `onSubmit(payload)` 父层把 payload 转成 CreateTaskInput / UpdateTaskInput 调 store
 *   - `onClose` 关闭回调
 *
 * **项目下拉**：
 *   - 用 `useProjectStore` 拉项目列表（只显示未归档的）
 *   - 支持"无项目"选项（projectId=null）
 *
 * **截止日期**：
 *   - 文本输入（ISO 日期 `YYYY-MM-DD` 或空）
 *   - 解析失败 → 抛错，不提交
 *   - 编辑时如果原本是 null，留空
 *
 * **二次确认**：
 *   - 关闭表单（点遮罩 / 取消 / Esc）**不**做确认 —— 用户填的字段会丢失（T2-3 暂不做"未保存"提示）
 *   - 删除按钮在 TaskCard / 父页面做
 */

import { useEffect, useState } from 'react';

import type { Project } from '@shared/types/project';
import type { CreateTaskInput, Task, TaskPriority, UpdateTaskInput } from '@shared/types/task';

const PRIORITY_OPTIONS: ReadonlyArray<{ value: TaskPriority; label: string }> = [
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
];

export interface TaskFormSubmitPayload {
  create?: CreateTaskInput;
  update?: { id: string; patch: UpdateTaskInput };
}

export interface TaskFormProps {
  open: boolean;
  mode: 'create' | 'edit';
  /** 编辑模式必填：被编辑的任务。 */
  task?: Task | undefined;
  /** 项目下拉的可选项（父层从 projectStore 传入；已过滤掉 archived）。 */
  projects: Project[];
  submitting?: boolean;
  onSubmit: (payload: TaskFormSubmitPayload) => void | Promise<unknown>;
  onClose: () => void;
}

const EMPTY_DRAFT: {
  title: string;
  description: string;
  priority: TaskPriority;
  dueDate: string;
  projectId: string | null;
  tags: string;
} = {
  title: '',
  description: '',
  priority: 'medium',
  dueDate: '',
  projectId: null,
  tags: '',
};

/** 把 Unix ms 截到 `YYYY-MM-DD`（本地时区）。空时返回 ''。 */
function toDateInputValue(ms: number | null): string {
  if (ms === null) return '';
  const d = new Date(ms);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * 任务表单（dialog 形态）。
 */
export function TaskForm({
  open,
  mode,
  task,
  projects,
  submitting = false,
  onSubmit,
  onClose,
}: TaskFormProps): React.ReactElement | null {
  const [draft, setDraft] = useState(EMPTY_DRAFT);

  // 打开 / 切换 mode 时，重置 draft
  useEffect(() => {
    if (!open) return;
    if (mode === 'edit' && task) {
      setDraft({
        title: task.title,
        description: task.description ?? '',
        priority: task.priority,
        dueDate: toDateInputValue(task.dueDate),
        projectId: task.projectId,
        tags: task.tags.join(', '),
      });
    } else {
      setDraft(EMPTY_DRAFT);
    }
  }, [open, mode, task]);

  // Esc 关闭
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  const canSubmit = draft.title.trim().length > 0 && !submitting;

  const handleSubmit = (): void => {
    if (!canSubmit) return;
    const title = draft.title.trim();
    const description = draft.description.trim();
    const tags = draft.tags
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    let dueDate: number | null = null;
    if (draft.dueDate.length > 0) {
      const parsed = Date.parse(`${draft.dueDate}T00:00:00`);
      if (!Number.isFinite(parsed)) {
        window.alert('截止日期格式不合法，请用 YYYY-MM-DD');
        return;
      }
      dueDate = parsed;
    }

    if (mode === 'create') {
      const payload: CreateTaskInput = {
        title,
        priority: draft.priority,
        tags,
        projectId: draft.projectId,
      };
      if (description.length > 0) payload.description = description;
      if (dueDate !== null) payload.dueDate = dueDate;
      void onSubmit({ create: payload });
    } else {
      // edit 模式
      if (!task) return;
      const patch: UpdateTaskInput = {
        title,
        priority: draft.priority,
        tags,
        projectId: draft.projectId,
        dueDate,
        description: description.length > 0 ? description : null,
      };
      void onSubmit({ update: { id: task.id, patch } });
    }
  };

  return (
    <div
      data-testid="task-form-dialog"
      role="dialog"
      aria-modal="true"
      aria-label={mode === 'create' ? '新建任务' : '编辑任务'}
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-lg rounded-lg border border-line bg-elevated p-5 shadow-card">
        <h2 className="mb-3 text-lg font-semibold text-primary">
          {mode === 'create' ? '新建任务' : '编辑任务'}
        </h2>

        <div className="space-y-3">
          <div>
            <label htmlFor="task-form-title" className="block text-xs text-secondary">
              标题 *
            </label>
            <input
              id="task-form-title"
              data-testid="task-form-title"
              type="text"
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              maxLength={512}
              className="mt-1 w-full rounded-md border border-line bg-base px-3 py-1.5 text-sm text-primary outline-none focus:border-accent"
            />
          </div>

          <div>
            <label htmlFor="task-form-description" className="block text-xs text-secondary">
              描述
            </label>
            <textarea
              id="task-form-description"
              data-testid="task-form-description"
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              rows={3}
              className="mt-1 w-full resize-y rounded-md border border-line bg-base px-3 py-1.5 text-sm text-primary outline-none focus:border-accent"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="task-form-priority" className="block text-xs text-secondary">
                优先级
              </label>
              <select
                id="task-form-priority"
                data-testid="task-form-priority"
                value={draft.priority}
                onChange={(e) => setDraft({ ...draft, priority: e.target.value as TaskPriority })}
                className="mt-1 w-full rounded-md border border-line bg-base px-2 py-1.5 text-sm text-primary outline-none focus:border-accent"
              >
                {PRIORITY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="task-form-due" className="block text-xs text-secondary">
                截止日期
              </label>
              <input
                id="task-form-due"
                data-testid="task-form-due"
                type="date"
                value={draft.dueDate}
                onChange={(e) => setDraft({ ...draft, dueDate: e.target.value })}
                className="mt-1 w-full rounded-md border border-line bg-base px-2 py-1.5 text-sm text-primary outline-none focus:border-accent"
              />
            </div>
          </div>

          <div>
            <label htmlFor="task-form-project" className="block text-xs text-secondary">
              所属项目
            </label>
            <select
              id="task-form-project"
              data-testid="task-form-project"
              value={draft.projectId ?? ''}
              onChange={(e) => {
                const v = e.target.value;
                setDraft({ ...draft, projectId: v.length === 0 ? null : v });
              }}
              className="mt-1 w-full rounded-md border border-line bg-base px-2 py-1.5 text-sm text-primary outline-none focus:border-accent"
            >
              <option value="">（无项目）</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="task-form-tags" className="block text-xs text-secondary">
              标签（逗号分隔）
            </label>
            <input
              id="task-form-tags"
              data-testid="task-form-tags"
              type="text"
              value={draft.tags}
              onChange={(e) => setDraft({ ...draft, tags: e.target.value })}
              placeholder="例：前端, P0, 待 review"
              className="mt-1 w-full rounded-md border border-line bg-base px-3 py-1.5 text-sm text-primary outline-none focus:border-accent"
            />
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            data-testid="task-form-cancel"
            onClick={onClose}
            className="rounded-md border border-line bg-base px-3 py-1.5 text-sm text-secondary transition-colors hover:text-primary"
          >
            取消
          </button>
          <button
            type="button"
            data-testid="task-form-submit"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-inverse transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? '保存中…' : mode === 'create' ? '创建' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}
