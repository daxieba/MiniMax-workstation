/**
 * 任务到期 + 番茄完成通知（v0.3.0）
 *
 * 设计：
 *   - mount 时启动 setInterval（每 60s 扫一次）
 *   - 检查 task.dueDate 已过 + status 不是 done/archived + 之前未通知过 → 调 notify
 *   - 用 localStorage 记"已通知过的 task id"集合（避免重复通知）
 *   - pomodoro 完成由 PomodoroPage 直接调 notify（避免耦合）
 *
 * 边界：
 *   - app 未运行时不发（mount 在 App.tsx）
 *   - 渲染端 / 渲染端测试环境：window.api 不可用时静默 return
 *   - 调 IPC 失败时 toast 提示（但通知本身不弹）
 *
 * @used-by src/App.tsx
 */
import { useEffect, useRef } from 'react';

import { useTaskStore } from '@/store/taskStore';
import { useT } from '@/i18n';
import { isOverdue } from '@/lib/dateUtils';
import { toast } from '@/store/toastStore';

const NOTIFIED_KEY = 'minimax.workstation.notifiedTasks';
const SCAN_INTERVAL_MS = 60_000;

interface NotifyApi {
  notify: (input: { title: string; body?: string; link?: string }) => Promise<
    | { ok: true; data: { shown: boolean } }
    | { ok: false; error: { code: string; message: string } }
  >;
}

function getNotifyApi(): NotifyApi['notify'] | null {
  if (typeof window === 'undefined') return null;
  const api = (window as unknown as { api?: { app?: NotifyApi } }).api?.app;
  return api?.notify ?? null;
}

/** 读出已通知过的 task id 集合（防重复）。 */
function loadNotifiedSet(): Set<string> {
  try {
    if (typeof localStorage === 'undefined') return new Set();
    const raw = localStorage.getItem(NOTIFIED_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as unknown;
    if (Array.isArray(arr)) {
      return new Set(arr.filter((x): x is string => typeof x === 'string'));
    }
  } catch {
    // ignore
  }
  return new Set();
}

/** 持久化已通知过的 task id 集合。 */
function saveNotifiedSet(set: Set<string>): void {
  try {
    if (typeof localStorage === 'undefined') return;
    // 限制 500 条上限，避免 set 无限增长
    const arr = Array.from(set).slice(-500);
    localStorage.setItem(NOTIFIED_KEY, JSON.stringify(arr));
  } catch {
    // ignore
  }
}

/**
 * App mount-only hook：扫到期任务 + 通知。
 * 内部用 useRef 存"已通知 set"避免依赖 + setState 触发循环。
 */
export function useTaskNotifier(): void {
  const t = useT();
  // 持久化 set 用 ref，组件重渲染不丢
  const notifiedRef = useRef<Set<string>>(loadNotifiedSet());

  useEffect(() => {
    const notifyApi = getNotifyApi();
    if (!notifyApi) return; // 测试环境 / 浏览器预览

    const scan = async (): Promise<void> => {
      const tasks = useTaskStore.getState().tasks;
      for (const task of tasks) {
        // 跳过 done/archived
        if (task.status === 'done' || task.status === 'archived') continue;
        // 跳过没 dueDate
        if (task.dueDate === null) continue;
        // 跳过还没到期
        if (!isOverdue(task.dueDate)) continue;
        // 跳过已通知过
        if (notifiedRef.current.has(task.id)) continue;

        // 调通知
        try {
          const res = await notifyApi({
            title: t.toasts.taskOverdueTitle,
            body: task.title,
          });
          if (res.ok && res.data.shown) {
            notifiedRef.current.add(task.id);
            saveNotifiedSet(notifiedRef.current);
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          toast.error(`通知失败：${msg}`);
        }
      }
    };

    // mount 后立即扫一次 + 启动 interval
    void scan();
    const id = setInterval(() => {
      void scan();
    }, SCAN_INTERVAL_MS);
    return (): void => {
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
