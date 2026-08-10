import { useToastStore } from '@/store/toastStore';
import { Toast } from './Toast';

/**
 * Toast 容器：挂在 App 根，跟随 toastStore 渲染队列。
 *
 * 设计：
 *   - fixed 在视口右下角
 *   - 通过 z-index 保证在主区之上
 *   - 不使用 portal，单纯一个 fixed 容器即可
 */
export function ToastProvider(): React.ReactElement {
  const toasts = useToastStore((s) => s.toasts);
  return (
    <div
      aria-live="polite"
      aria-atomic="false"
      className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-80 flex-col gap-2"
    >
      {toasts.map((t) => (
        <div key={t.id} className="pointer-events-auto">
          <Toast toast={t} />
        </div>
      ))}
    </div>
  );
}
