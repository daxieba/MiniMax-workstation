/**
 * 项目表单（T2-3）
 *
 * 新建 / 编辑项目。简单 dialog：名称、描述、标签色。
 *
 * **颜色**：
 *   - 提供 6 个预设色（用 select）；也支持手动输入 hex
 *   - 服务端用 `ProjectColorSchema` 校验；非法格式会被 Zod 拒
 *
 * **二次确认**：
 *   - 关闭（遮罩 / 取消 / Esc）不确认 —— 与 TaskForm 一致
 */

import { useEffect, useState } from 'react';

import type { CreateProjectInput, Project, UpdateProjectInput } from '@shared/types/project';

const COLOR_PRESETS: ReadonlyArray<{ value: string; label: string }> = [
  { value: '#3B82F6', label: '蓝' },
  { value: '#10B981', label: '绿' },
  { value: '#F59E0B', label: '橙' },
  { value: '#EF4444', label: '红' },
  { value: '#8B5CF6', label: '紫' },
  { value: '#6B7280', label: '灰' },
];

const HEX_RE = /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/;

export interface ProjectFormSubmitPayload {
  create?: CreateProjectInput;
  update?: { id: string; patch: UpdateProjectInput };
}

export interface ProjectFormProps {
  open: boolean;
  mode: 'create' | 'edit';
  project?: Project | undefined;
  submitting?: boolean;
  onSubmit: (payload: ProjectFormSubmitPayload) => void | Promise<unknown>;
  onClose: () => void;
}

const EMPTY_DRAFT = {
  name: '',
  description: '',
  color: '#3B82F6',
};

/**
 * 项目表单（dialog 形态）。
 */
export function ProjectForm({
  open,
  mode,
  project,
  submitting = false,
  onSubmit,
  onClose,
}: ProjectFormProps): React.ReactElement | null {
  const [draft, setDraft] = useState(EMPTY_DRAFT);

  useEffect(() => {
    if (!open) return;
    if (mode === 'edit' && project) {
      setDraft({
        name: project.name,
        description: project.description ?? '',
        color: project.color ?? '#3B82F6',
      });
    } else {
      setDraft(EMPTY_DRAFT);
    }
  }, [open, mode, project]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  const canSubmit = draft.name.trim().length > 0 && HEX_RE.test(draft.color) && !submitting;

  const handleSubmit = (): void => {
    if (!canSubmit) return;
    const name = draft.name.trim();
    const description = draft.description.trim();
    const color = draft.color;

    if (mode === 'create') {
      const payload: CreateProjectInput = { name, color };
      if (description.length > 0) payload.description = description;
      void onSubmit({ create: payload });
    } else {
      if (!project) return;
      const patch: UpdateProjectInput = {
        name,
        color,
        description: description.length > 0 ? description : null,
      };
      void onSubmit({ update: { id: project.id, patch } });
    }
  };

  return (
    <div
      data-testid="project-form-dialog"
      role="dialog"
      aria-modal="true"
      aria-label={mode === 'create' ? '新建项目' : '编辑项目'}
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-lg border border-line bg-elevated p-5 shadow-card">
        <h2 className="mb-3 text-lg font-semibold text-primary">
          {mode === 'create' ? '新建项目' : '编辑项目'}
        </h2>

        <div className="space-y-3">
          <div>
            <label htmlFor="project-form-name" className="block text-xs text-secondary">
              名称 *
            </label>
            <input
              id="project-form-name"
              data-testid="project-form-name"
              type="text"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              maxLength={128}
              className="mt-1 w-full rounded-md border border-line bg-base px-3 py-1.5 text-sm text-primary outline-none focus:border-accent"
            />
          </div>

          <div>
            <label htmlFor="project-form-description" className="block text-xs text-secondary">
              描述
            </label>
            <textarea
              id="project-form-description"
              data-testid="project-form-description"
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              rows={3}
              className="mt-1 w-full resize-y rounded-md border border-line bg-base px-3 py-1.5 text-sm text-primary outline-none focus:border-accent"
            />
          </div>

          <div>
            <label htmlFor="project-form-color" className="block text-xs text-secondary">
              标签色
            </label>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              {COLOR_PRESETS.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  data-testid={`project-form-color-${c.value}`}
                  onClick={() => setDraft({ ...draft, color: c.value })}
                  className={[
                    'h-7 w-7 rounded-full border-2 transition-transform',
                    draft.color === c.value ? 'border-primary scale-110' : 'border-line',
                  ].join(' ')}
                  style={{ backgroundColor: c.value }}
                  title={c.label}
                  aria-label={c.label}
                />
              ))}
              <input
                id="project-form-color"
                data-testid="project-form-color"
                type="text"
                value={draft.color}
                onChange={(e) => setDraft({ ...draft, color: e.target.value })}
                className="w-28 rounded-md border border-line bg-base px-2 py-1 text-xs text-primary outline-none focus:border-accent"
                placeholder="#RRGGBB"
              />
            </div>
            {!HEX_RE.test(draft.color) ? (
              <p className="mt-1 text-xs text-danger">颜色需为合法 hex（#RGB / #RRGGBB / #RRGGBBAA）</p>
            ) : null}
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            data-testid="project-form-cancel"
            onClick={onClose}
            className="rounded-md border border-line bg-base px-3 py-1.5 text-sm text-secondary transition-colors hover:text-primary"
          >
            取消
          </button>
          <button
            type="button"
            data-testid="project-form-submit"
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
