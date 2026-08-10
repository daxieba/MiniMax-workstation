import { useEffect } from 'react';
import { CheckCircle2, CircleAlert, Info, X } from 'lucide-react';
import type { ToastItem, ToastKind } from '@/store/toastStore';
import { useToastStore } from '@/store/toastStore';

const KIND_STYLES: Record<ToastKind, string> = {
  success: 'border-success text-success bg-success-soft/40',
  error: 'border-danger text-danger bg-danger-soft/40',
  info: 'border-line text-primary bg-elevated',
};

const KIND_ICON: Record<ToastKind, typeof Info> = {
  success: CheckCircle2,
  error: CircleAlert,
  info: Info,
};

interface ToastProps {
  toast: ToastItem;
}

/** 单个 toast 项。 */
export function Toast({ toast }: ToastProps): React.ReactElement {
  const remove = useToastStore((s) => s.remove);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      remove(toast.id);
    }, toast.duration);
    return () => window.clearTimeout(timer);
  }, [toast.id, toast.duration, remove]);

  const Icon = KIND_ICON[toast.kind];
  return (
    <div
      role="status"
      data-testid={`toast-${toast.kind}`}
      className={`flex items-start gap-2 rounded-md border px-3 py-2 shadow-card ${KIND_STYLES[toast.kind]}`}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <p className="flex-1 text-sm">{toast.message}</p>
      <button
        type="button"
        onClick={() => remove(toast.id)}
        className="text-secondary hover:text-primary"
        aria-label="关闭通知"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
