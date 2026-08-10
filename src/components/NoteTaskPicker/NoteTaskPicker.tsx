/**
 * 笔记关联任务选择组件（T4-1）
 *
 * 从 `useTaskStore` 拉任务列表，多选；已选的 taskId 用 chip 展示，可 × 移除。
 *
 * **Props**：
 *   - `value`             当前选中的 taskId 列表
 *   - `onChange`          变化回调（add/remove 后整个数组）
 *
 * **行为**：
 *   - 点 "+ 添加任务" → 弹一个轻量 popover（用 div + click outside 关闭），
 *     列出所有任务（含已选的，仍可点 × 移除）
 *   - 任务列表来源：`useTaskStore`（mount 时 load 一次）
 *   - 任务可能含"无项目"的，**也**展示
 *   - 已删除的任务（taskStore 列表里没有）→ 在 chip 上显示"任务不存在"且不显示 ×
 *
 * **不做**：
 *   - 不做搜索（任务量小；T4-2 全文搜索后再加）
 *   - 不做任务创建（让用户去「项目与任务」新建）
 */

import { useEffect, useRef, useState } from 'react';
import { Plus, X } from 'lucide-react';

import { useTaskStore } from '@/store/taskStore';

export interface NoteTaskPickerProps {
  value: string[];
  onChange: (next: string[]) => void;
}

export function NoteTaskPicker({ value, onChange }: NoteTaskPickerProps): React.ReactElement {
  const tasks = useTaskStore((s) => s.tasks);
  const tasksLoading = useTaskStore((s) => s.loading);
  const taskLoad = useTaskStore((s) => s.load);
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  // 首次挂载：拉任务列表
  useEffect(() => {
    void taskLoad();
  }, [taskLoad]);

  // 点 popover 外部关闭
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent): void => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // id → task 映射
  const taskById = new Map(tasks.map((t) => [t.id, t]));

  function add(taskId: string): void {
    if (value.includes(taskId)) return;
    onChange([...value, taskId]);
  }

  function remove(taskId: string): void {
    onChange(value.filter((id) => id !== taskId));
  }

  // 已选的 chip（已知 + 未知 id）
  const selectedChips = value.map((id) => ({ id, task: taskById.get(id) }));

  return (
    <div data-testid="note-task-picker" className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        {selectedChips.map(({ id, task }) => {
          if (task) {
            return (
              <span
                key={id}
                data-testid={`note-task-chip-${id}`}
                className="inline-flex items-center gap-1 rounded-full border border-success bg-success-soft/40 px-2 py-0.5 text-xs text-success"
                title={task.title}
              >
                {task.title.length > 30 ? `${task.title.slice(0, 30)}…` : task.title}
                <button
                  type="button"
                  data-testid={`note-task-remove-${id}`}
                  onClick={() => remove(id)}
                  className="rounded-full p-0.5 text-success transition-colors hover:bg-success hover:text-inverse"
                  aria-label={`取消关联 ${task.title}`}
                  title="取消关联"
                >
                  <X className="h-3 w-3" aria-hidden="true" />
                </button>
              </span>
            );
          }
          // 任务已被硬删 / 找不到
          return (
            <span
              key={id}
              data-testid={`note-task-chip-missing-${id}`}
              className="inline-flex items-center gap-1 rounded-full border border-line bg-base px-2 py-0.5 text-xs text-secondary"
              title="任务不存在（可能已被删除）"
            >
              <span className="text-secondary">任务不存在</span>
              <button
                type="button"
                data-testid={`note-task-remove-${id}`}
                onClick={() => remove(id)}
                className="rounded-full p-0.5 text-secondary transition-colors hover:bg-line"
                aria-label="移除失效引用"
                title="移除"
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            </span>
          );
        })}
        <div className="relative" ref={popoverRef}>
          <button
            type="button"
            data-testid="note-task-picker-toggle"
            onClick={() => setOpen((o) => !o)}
            className="inline-flex items-center gap-1 rounded-md border border-line bg-base px-2 py-1 text-xs text-secondary transition-colors hover:border-accent hover:text-accent"
          >
            <Plus className="h-3 w-3" aria-hidden="true" />
            添加任务
          </button>
          {open ? (
            <div
              data-testid="note-task-picker-popover"
              className="absolute left-0 top-full z-20 mt-1 w-72 max-h-64 overflow-auto rounded-md border border-line bg-elevated p-1 shadow-card"
            >
              {tasksLoading && tasks.length === 0 ? (
                <p className="px-2 py-2 text-xs text-secondary">加载任务中…</p>
              ) : tasks.length === 0 ? (
                <p className="px-2 py-2 text-xs text-secondary">
                  还没有任务。先在「项目与任务」里建一些再关联。
                </p>
              ) : (
                tasks.map((t) => {
                  const selected = value.includes(t.id);
                  return (
                    <button
                      key={t.id}
                      type="button"
                      data-testid={`note-task-picker-item-${t.id}`}
                      onClick={() => {
                        if (selected) {
                          remove(t.id);
                        } else {
                          add(t.id);
                        }
                      }}
                      className={[
                        'flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors',
                        selected ? 'bg-accent-soft text-accent' : 'text-primary hover:bg-base',
                      ].join(' ')}
                    >
                      <span className="truncate">{t.title}</span>
                      <span className="shrink-0 text-[10px] text-secondary">
                        {t.status === 'done' ? '已完成' : t.status === 'doing' ? '进行中' : '待处理'}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
