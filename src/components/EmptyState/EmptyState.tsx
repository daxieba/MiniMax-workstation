/**
 * 通用空状态组件（v0.1.1 polish）
 *
 * 用于各 page / list 组件在数据为空时展示：图标 + 标题 + 描述 + 可选 CTA。
 *
 * 设计：
 *   - 居中布局 + 虚线边框（dotted 暗示"这里可以放东西"）
 *   - 图标用 lucide（与 sidebar / inbox item 视觉一致）
 *   - 标题用 primary text，描述用 secondary text
 *   - CTA 按钮可选（用 accent 颜色强调）
 *
 * 不用作"loading"占位 —— loading 应该用 Spinner / Skeleton；
 * 也不用作"error" —— error 应该走 toast 或 ErrorBoundary。
 */
import type { LucideIcon } from 'lucide-react';
import { Inbox } from 'lucide-react';

export interface EmptyStateProps {
  /** 标题（一句话说明空状态）。 */
  title: string;
  /** 描述（解释为什么空 + 提示怎么填）。 */
  description?: string | undefined;
  /** 大图标（顶部居中）。默认 Inbox。 */
  icon?: LucideIcon | undefined;
  /** 主 CTA 按钮文案。 */
  actionLabel?: string | undefined;
  /**
   * 主 CTA 点击。**可显式传 undefined**（exactOptionalPropertyTypes 兼容）——
   * 内部用 `actionLabel && onAction` 同时判断，避免传 undefined 时按钮还是渲染。
   */
  onAction?: (() => void) | undefined;
  /** 副 CTA 按钮文案（"了解更多" / "导入数据" 等）。 */
  secondaryActionLabel?: string | undefined;
  /** 副 CTA 点击。 */
  onSecondaryAction?: (() => void) | undefined;
  /** 自定义 children（在描述下方、CTA 上方插入额外内容如键盘提示）。 */
  children?: React.ReactNode | undefined;
  /**
   * 覆盖默认的 `data-testid`（默认 "empty-state"）。
   * 用于让多个 empty state 出现在同一页面时仍能稳定测试 / 查询。
   */
  'data-testid'?: string | undefined;
}

export function EmptyState({
  title,
  description,
  icon: Icon = Inbox,
  actionLabel,
  onAction,
  secondaryActionLabel,
  onSecondaryAction,
  children,
  'data-testid': testId = 'empty-state',
}: EmptyStateProps): React.ReactElement {
  return (
    <div
      data-testid={testId}
      className="flex h-full flex-col items-center justify-center gap-3 rounded-md border border-dashed border-line bg-base/50 px-6 py-12 text-center"
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent-soft text-accent">
        <Icon className="h-6 w-6" aria-hidden="true" />
      </div>
      <h3 className="text-base font-medium text-primary">{title}</h3>
      {description ? (
        <p className="max-w-md text-sm text-secondary">{description}</p>
      ) : null}
      {children}
      {actionLabel && onAction ? (
        <button
          type="button"
          data-testid="empty-state-action"
          onClick={onAction}
          className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-accent px-4 py-2 text-sm font-medium text-inverse transition-colors hover:bg-accent-hover"
        >
          {actionLabel}
        </button>
      ) : null}
      {secondaryActionLabel && onSecondaryAction ? (
        <button
          type="button"
          data-testid="empty-state-secondary-action"
          onClick={onSecondaryAction}
          className="text-xs text-secondary transition-colors hover:text-primary"
        >
          {secondaryActionLabel}
        </button>
      ) : null}
    </div>
  );
}
