/**
 * 收集箱页（T2-2 完整实现 + v0.1.1 polish）
 *
 * 结构：
 *   - 顶部：标题 + 计数 + 过滤切换（active / archived / all）
 *   - 中部：InboxComposer（输入组件）
 *   - 下部：InboxList（按当前 filter 过滤的列表）
 *
 * 数据源：`useInboxStore`（Zustand）。
 *   - 挂载时 load
 *   - 切换 filter → store 自动重 load
 *   - 添加 / 归档 / 转任务都走 store action
 *
 * v0.1.1 polish：
 *   - 注入 composer ref 让"空态 CTA 录入第一条"焦点跳到输入框
 *   - **拖拽支持**（Drag & Drop）：把文件 / 文本 / 链接拖到本页任意位置自动 add
 *     - 文件：electron 渲染进程拿不到 file 真实内容，只能拿到 path（File.path）
 *     - 文本：dataTransfer.getData('text/plain') → add kind=note
 *     - 链接：dataTransfer.getData('text/uri-list') → add kind=link
 *   - 拖拽时光标位置高亮（drag-over 视觉反馈）
 */

import { useEffect, useRef, useState } from 'react';

import { InboxComposer, type InboxComposerHandle } from '@/components/InboxComposer/InboxComposer';
import { InboxList } from '@/components/InboxList/InboxList';
import { toast } from '@/store/toastStore';
import { type InboxFilter, useInboxStore } from '@/store/inboxStore';

const FILTERS: ReadonlyArray<{ value: InboxFilter; label: string }> = [
  { value: 'active', label: '活跃' },
  { value: 'archived', label: '已归档' },
  { value: 'all', label: '全部' },
];

export default function InboxPage(): React.ReactElement {
  const items = useInboxStore((s) => s.items);
  const loading = useInboxStore((s) => s.loading);
  const error = useInboxStore((s) => s.error);
  const filter = useInboxStore((s) => s.filter);
  const load = useInboxStore((s) => s.load);
  const setFilter = useInboxStore((s) => s.setFilter);
  const add = useInboxStore((s) => s.add);
  const archive = useInboxStore((s) => s.archive);
  const convertToTask = useInboxStore((s) => s.convertToTask);

  // v0.1.1: 给 composer 一个 ref，CTA "录入第一条" 触发时聚焦到输入框
  const composerRef = useRef<InboxComposerHandle>(null);

  // v0.1.1: 拖拽高亮态
  const [isDragOver, setIsDragOver] = useState(false);

  useEffect(() => {
    void load();
  }, [load]);

  // v0.1.1: 处理拖入事件
  // 优先级：文件 > 链接 > 文本（文件是最常见的拖入内容）
  const handleDrop = (e: React.DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    const dt = e.dataTransfer;
    if (!dt) return;

    // 1. 文件（Electron 下 File.path 会有真实绝对路径，普通浏览器为空）
    if (dt.files && dt.files.length > 0) {
      const paths: string[] = [];
      for (let i = 0; i < dt.files.length; i++) {
        const f = dt.files[i];
        if (!f) continue;
        // Electron 18+ 暴露 File.path
        const filePath = (f as unknown as { path?: string }).path;
        paths.push(filePath ?? f.name);
      }
      if (paths.length === 0) return;
      // 文件路径用 file kind 一次 add（一条含所有路径的 inbox）
      const content = paths.length === 1
        ? paths[0]!
        : `${paths[0]!}\n${paths.slice(1).join('\n')}`;
      void add({ content, kind: 'file' });
      toast.success(`已加入收集箱（${paths.length} 个文件）`);
      return;
    }

    // 2. 链接（text/uri-list，浏览器拖入链接触发）
    const uriList = dt.getData('text/uri-list');
    if (uriList) {
      const urls = uriList.split('\n').filter((u) => u.trim() && !u.startsWith('#'));
      if (urls.length > 0) {
        const content = urls.length === 1 ? urls[0]! : urls.join('\n');
        void add({ content, kind: 'link' });
        toast.success(`已加入收集箱（${urls.length} 个链接）`);
        return;
      }
    }

    // 3. 纯文本（从浏览器地址栏 / 选中文本 / 别的 app 拖入）
    const text = dt.getData('text/plain');
    if (text.trim()) {
      // 检测是不是 URL（http / https 开头）
      const isUrl = /^https?:\/\//i.test(text.trim().split('\n')[0] ?? '');
      void add({ content: text.trim(), kind: isUrl ? 'link' : 'note' });
      toast.success('已加入收集箱');
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'copy';
    }
  };

  const handleDragEnter = (e: React.DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    e.stopPropagation();
    // 只有离开整个容器时才取消高亮（避免子元素 dragleave 闪烁）
    if (e.currentTarget === e.target) {
      setIsDragOver(false);
    }
  };

  return (
    <section
      className={[
        'relative flex h-full flex-col gap-4 p-6 transition-colors',
        isDragOver ? 'bg-accent-soft/30 ring-2 ring-inset ring-accent' : '',
      ].join(' ')}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      data-testid="inbox-page"
    >
      {isDragOver ? (
        <div
          data-testid="inbox-drop-overlay"
          className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-accent/10"
        >
          <div className="rounded-md border-2 border-dashed border-accent bg-elevated px-6 py-4 text-sm font-medium text-accent">
            松开鼠标即可加入收集箱
          </div>
        </div>
      ) : null}

      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-primary">收集箱</h1>
          <p className="text-sm text-secondary">
            快速记录、归档、转为任务。共 {items.length} 条。
            <span className="ml-2 text-xs text-secondary/70">
              （提示：拖文件 / 链接 / 文本到本页任意位置可自动添加）
            </span>
          </p>
        </div>
        <div role="tablist" aria-label="过滤" className="inline-flex rounded-md border border-line bg-elevated p-1">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              role="tab"
              aria-selected={filter === f.value}
              data-testid={`inbox-filter-${f.value}`}
              onClick={() => setFilter(f.value)}
              className={[
                'rounded px-3 py-1 text-xs transition-colors',
                filter === f.value
                  ? 'bg-accent text-inverse'
                  : 'text-secondary hover:text-primary',
              ].join(' ')}
            >
              {f.label}
            </button>
          ))}
        </div>
      </header>

      <InboxComposer
        ref={composerRef}
        onSubmit={(input) => {
          // 透传 projectId 到 store.add
          return add({ content: input.content, kind: input.kind, projectId: input.projectId });
        }}
        submitting={loading}
      />

      {error ? (
        <div
          role="alert"
          data-testid="inbox-error"
          className="rounded-md border border-danger bg-danger-soft/40 px-3 py-2 text-sm text-danger"
        >
          {error}
        </div>
      ) : null}

      <div className="flex-1 overflow-auto">
        <InboxList
          items={items}
          filter={filter}
          onArchive={archive}
          onConvert={(id) => {
            // 用 inbox content 作为 task title（截断到 80 字）。后续 T3-x AI 工作区可改更智能。
            const it = items.find((x) => x.id === id);
            const title = (it?.content ?? '').slice(0, 80);
            void convertToTask(id, { title });
          }}
          onFocusComposer={() => composerRef.current?.focus()}
        />
      </div>
    </section>
  );
}
