/**
 * 任务状态流转按钮组（T2-3）
 *
 * 根据当前状态 + `ALLOWED_TRANSITIONS` 渲染允许的目标状态按钮。
 *
 * **数据来源**：
 *   - `currentStatus` 任务的当前 `status`
 *   - `ALLOWED_TRANSITIONS` 来自 `@shared/types/taskStatus` 单一真源
 *
 * **设计**：
 *   - 每个允许的 `to` 状态渲染一个按钮，文案是中文（与状态机文档保持一致）
 *   - 点击按钮**不**做二次确认 —— 由父组件（卡片）做确认后再调 onTransition
 *   - 只读态（`readOnly`）下隐藏所有按钮（用于展示场景）
 *
 * **不做**：
 *   - 不调 IPC（store 在父层）
 *   - 不做拖拽（T2-3 明确不引入拖拽库）
 */

import { ArrowRight } from 'lucide-react';

import {
  ALLOWED_TRANSITIONS,
  type TaskStatus,
} from '@shared/types/taskStatus';

export interface TaskStatusActionsProps {
  /** 当前状态。 */
  currentStatus: TaskStatus;
  /** 选中目标状态时的回调（父层负责确认 + 调 store.transition）。 */
  onTransition: (to: TaskStatus) => void;
  /** 禁用所有按钮（用于加载中 / 只读场景）。 */
  disabled?: boolean;
}

const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: '待处理',
  doing: '进行中',
  done: '已完成',
  archived: '已归档',
};

/**
 * 状态流转按钮组：根据当前状态 + 状态机，渲染允许的目标按钮。
 */
export function TaskStatusActions({
  currentStatus,
  onTransition,
  disabled = false,
}: TaskStatusActionsProps): React.ReactElement | null {
  const targets: readonly TaskStatus[] = ALLOWED_TRANSITIONS[currentStatus];

  if (targets.length === 0) {
    return null;
  }

  return (
    <div
      data-testid={`task-status-actions-${currentStatus}`}
      className="flex flex-wrap items-center gap-1"
      role="group"
      aria-label="状态流转"
    >
      {targets.map((to) => (
        <button
          key={to}
          type="button"
          data-testid={`task-status-action-${currentStatus}-to-${to}`}
          onClick={() => onTransition(to)}
          disabled={disabled}
          className="inline-flex items-center gap-1 rounded-md border border-line bg-base px-2 py-1 text-xs text-secondary transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
          title={`流转到 ${STATUS_LABELS[to]}`}
        >
          <ArrowRight className="h-3 w-3" aria-hidden="true" />
          {STATUS_LABELS[to]}
        </button>
      ))}
    </div>
  );
}
