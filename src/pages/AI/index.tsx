/**
 * AI 工作区页（T3-3 完整实现 + T3-4 结构化提取 tab + T4-3 AI 摘要笔记 tab）
 *
 * 布局：
 *   - 顶部工具栏：provider / model / key 状态 / test connection
 *   - 左侧 tabs：chat / summarize / extract_tasks / extract_inbox / rewrite /
 *                **note_summary（T4-3 新增）** / 待确认
 *   - 主区：当前 tab 对应的组件
 *   - 底部固定"待确认区"摘要（点击切到"待确认" tab 看完整列表）
 *
 * 状态来源：全部走 `useAiStore`。
 *
 * **T3-4 改动**：
 *   - "提取任务" 改走 `runStructuredAction({ schemaName: 'task_drafts' })`（用 AIQuickAction 结构化展示）
 *   - 新增 "提取 inbox 条目" tab → 走 `runStructuredAction({ schemaName: 'inbox_items' })`
 *   - `AIQuickAction` 接收 `onAcceptAll` / `onDismissAll`：本卡**不**实际落库（**不**写 db），
 *     只把 status 切到 confirmed / dismissed；落库由 T4-x / 后续卡接 `task:create` / `inbox:add`
 *
 * **T4-3 改动**：
 *   - 新增 "AI 摘要笔记" tab → 走 `runStructuredAction({ schemaName: 'note_summary' })`
 *   - 用户粘贴笔记内容 → AI 返回 title / summary / tags
 *   - 结果展示复用 AIQuickAction 的 `note_summary` 结构化分支（已在 T3-4 落地）
 *   - 落库（写回 NoteEditor）由 NoteAIPanel 在 Knowledge 页负责 —— 本 tab **不**接 noteStore
 *     （保持渲染端"落库动作始终在 Knowledge 页上下文"的语义一致）
 *
 * **不**做：note / kb / review / search（留 T4-x）。
 */

import { useEffect, useMemo, useState } from 'react';
import { ClipboardList, FileText, Inbox, MessageSquare, PenLine, Sparkles } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { AIChat } from '@/components/AIChat/AIChat';
import { AIModelInput } from '@/components/AIModelInput/AIModelInput';
import { AIPendingConfirm } from '@/components/AIPendingConfirm/AIPendingConfirm';
import { AIProviderPicker } from '@/components/AIProviderPicker/AIProviderPicker';
import { AIQuickAction } from '@/components/AIQuickAction/AIQuickAction';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { useT } from '@/i18n';
import type { JsonExtractionSchemaName } from '@shared/types/ai';
import type { PendingResult, QuickAction } from '@/store/aiStore';
import { useAiStore } from '@/store/aiStore';

type TabKey =
  'chat' | 'summarize' | 'extract_tasks' | 'extract_inbox' | 'rewrite' | 'note_summary' | 'pending';

interface TabConfig {
  key: TabKey;
  label: string;
  Icon: LucideIcon;
}

/** T3-4 + T4-3：结构化 tab → (action, schemaName) 映射。 */
const STRUCTURED_TAB_CONFIG: Record<
  'extract_tasks' | 'extract_inbox' | 'note_summary',
  { action: QuickAction; schemaName: JsonExtractionSchemaName }
> = {
  extract_tasks: { action: 'extract_tasks', schemaName: 'task_drafts' },
  extract_inbox: { action: 'summarize', schemaName: 'inbox_items' },
  note_summary: { action: 'summarize', schemaName: 'note_summary' },
};

/** 默认页。 */
export default function AIPage(): React.ReactElement {
  const t = useT();
  const TABS = useMemo<ReadonlyArray<TabConfig>>(
    () => [
      { key: 'chat', label: t.pages.ai.tabs.chat, Icon: MessageSquare },
      { key: 'summarize', label: t.pages.ai.tabs.summarize, Icon: Sparkles },
      { key: 'extract_tasks', label: t.pages.ai.tabs.extractTasks, Icon: ClipboardList },
      { key: 'extract_inbox', label: t.pages.ai.tabs.extractInbox, Icon: Inbox },
      { key: 'rewrite', label: t.pages.ai.tabs.rewrite, Icon: PenLine },
      { key: 'note_summary', label: t.pages.ai.tabs.noteSummary, Icon: FileText },
      { key: 'pending', label: t.pages.ai.tabs.pending, Icon: Inbox },
    ],
    [t],
  );
  // ---- store 订阅 ----
  const providers = useAiStore((s) => s.providers);
  const provider = useAiStore((s) => s.provider);
  const model = useAiStore((s) => s.model);
  const hasKey = useAiStore((s) => s.hasKey);
  const messages = useAiStore((s) => s.messages);
  const pendingResults = useAiStore((s) => s.pendingResults);
  const loading = useAiStore((s) => s.loading);
  const loadProviders = useAiStore((s) => s.loadProviders);
  const refreshHasKey = useAiStore((s) => s.refreshHasKey);
  const setProvider = useAiStore((s) => s.setProvider);
  const setModel = useAiStore((s) => s.setModel);
  const setKey = useAiStore((s) => s.setKey);
  const deleteKey = useAiStore((s) => s.deleteKey);
  const loadConfig = useAiStore((s) => s.loadConfig);
  const saveConfig = useAiStore((s) => s.saveConfig);
  const testConnection = useAiStore((s) => s.testConnection);
  const sendMessage = useAiStore((s) => s.sendMessage);
  const runAction = useAiStore((s) => s.runAction);
  const runStructuredAction = useAiStore((s) => s.runStructuredAction);
  const cancelChat = useAiStore((s) => s.cancelChat);
  const confirmPending = useAiStore((s) => s.confirmPending);
  const dismissPending = useAiStore((s) => s.dismissPending);
  const clearMessages = useAiStore((s) => s.clearMessages);

  // ---- 本地 state ----
  const [tab, setTab] = useState<TabKey>('chat');
  const [actionInput, setActionInput] = useState<Record<TabKey, string>>({
    chat: '',
    summarize: '',
    extract_tasks: '',
    extract_inbox: '',
    rewrite: '',
    note_summary: '',
    pending: '',
  });
  const [testing, setTesting] = useState(false);

  // ---- 启动期初始化 ----
  useEffect(() => {
    void loadProviders();
    void refreshHasKey();
    void loadConfig();
  }, [loadProviders, refreshHasKey, loadConfig]);

  // provider 切换时刷 hasKey + 加载 config
  useEffect(() => {
    void refreshHasKey();
    void loadConfig();
  }, [provider, refreshHasKey, loadConfig]);

  // ---- 派生 ----
  const currentTabConfig = useMemo(() => TABS.find((tt) => tt.key === tab) ?? TABS[0]!, [tab, TABS]);
  const pendingCount = useMemo(
    () => pendingResults.filter((p) => p.status === 'pending').length,
    [pendingResults],
  );
  const visiblePending = useMemo(
    () => pendingResults.filter((p) => p.status === 'pending' || p.status === 'dismissed'),
    [pendingResults],
  );
  // 找当前 quick action 最近的 pending（用于流式 / 结构化展示）
  const currentActionResult: PendingResult | undefined = useMemo(() => {
    if (tab === 'summarize' || tab === 'rewrite') {
      // 流式 action
      return pendingResults.find(
        (p) =>
          p.action === tab &&
          !p.schemaName &&
          (p.status === 'pending' || (loading && p.content.length > 0)),
      );
    }
    if (tab === 'extract_tasks' || tab === 'extract_inbox' || tab === 'note_summary') {
      // 结构化 action
      const cfg = STRUCTURED_TAB_CONFIG[tab];
      return pendingResults.find(
        (p) => p.action === cfg.action && p.schemaName === cfg.schemaName && p.status === 'pending',
      );
    }
    return undefined;
  }, [tab, pendingResults, loading]);

  /** T3-4 + T4-3：当前 tab 的"运行"回调（流式 vs 结构化分支）。 */
  const onRunCurrent = (): void => {
    const text = actionInput[tab];
    if (tab === 'summarize' || tab === 'rewrite') {
      void runAction(tab, text);
    } else if (tab === 'extract_tasks' || tab === 'extract_inbox' || tab === 'note_summary') {
      const cfg = STRUCTURED_TAB_CONFIG[tab];
      void runStructuredAction(cfg.action, cfg.schemaName, text);
    }
  };

  return (
    <section data-testid="ai-page" className="flex h-full flex-col gap-3 p-4">
      {/* 顶部：provider + model + key + test */}
      <div className="space-y-2">
        <h1 className="text-xl font-semibold text-primary">{t.pages.ai.title}</h1>
        <AIProviderPicker
          providers={providers}
          provider={provider}
          model={model}
          hasKey={hasKey}
          testing={testing}
          onProviderChange={setProvider}
          onModelChange={setModel}
          onSaveModel={() => void saveConfig(model)}
          onTestConnection={async () => {
            setTesting(true);
            try {
              await testConnection();
            } finally {
              setTesting(false);
            }
          }}
          onSetKey={(k) => void setKey(k)}
          onDeleteKey={() => void deleteKey()}
        />
        {/* 单独 model 输入（spec 要求独立组件） */}
        <AIModelInput
          value={model}
          placeholder={providers.find((p) => p.id === provider)?.defaultModel ?? ''}
          onChange={setModel}
          onSave={() => void saveConfig(model)}
        />
      </div>

      {/* 主体：左侧 tabs + 主区 */}
      <div className="flex min-h-0 flex-1 gap-3">
        {/* 左侧 tabs */}
        <nav
          aria-label="AI 工作区功能"
          className="flex w-40 shrink-0 flex-col gap-1 rounded-md border border-line bg-elevated p-2"
        >
          {TABS.map((t) => {
            const isActive = t.key === tab;
            const Icon = t.Icon;
            const showBadge = t.key === 'pending' && pendingCount > 0;
            return (
              <button
                key={t.key}
                type="button"
                data-testid={`ai-tab-${t.key}`}
                onClick={() => setTab(t.key)}
                className={[
                  'flex items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors',
                  isActive
                    ? 'bg-accent-soft text-accent'
                    : 'text-secondary hover:bg-base hover:text-primary',
                ].join(' ')}
                aria-current={isActive ? 'page' : undefined}
              >
                <span className="flex items-center gap-2">
                  <Icon className="h-4 w-4" aria-hidden="true" />
                  {t.label}
                </span>
                {showBadge ? (
                  <span
                    data-testid={`ai-tab-${t.key}-count`}
                    className="rounded-full bg-warning px-1.5 py-0.5 text-xs text-inverse"
                  >
                    {pendingCount}
                  </span>
                ) : null}
              </button>
            );
          })}
        </nav>

        {/* 主区 */}
        <div
          data-testid="ai-main"
          data-tab={tab}
          className="flex min-h-0 flex-1 flex-col rounded-md border border-line bg-base"
        >
          {tab === 'chat' ? (
            <AIChat
              messages={messages}
              loading={loading}
              disabled={!hasKey}
              placeholder={hasKey ? t.pages.ai.placeholderChat : t.pages.ai.placeholderNoKey}
              onSend={(content) => void sendMessage(content)}
              onCancel={() => cancelChat()}
            />
          ) : tab === 'pending' ? (
            <PendingList
              items={visiblePending}
              onConfirm={confirmPending}
              onDismiss={dismissPending}
            />
          ) : tab === 'extract_tasks' || tab === 'extract_inbox' || tab === 'note_summary' ? (
            <AIQuickAction
              action={STRUCTURED_TAB_CONFIG[tab].action}
              value={actionInput[tab]}
              onChange={(v) => setActionInput((prev) => ({ ...prev, [tab]: v }))}
              onRun={onRunCurrent}
              onCancel={() => cancelChat()}
              loading={loading}
              disabled={!hasKey}
              onAcceptAll={(r) => confirmPending(r.id)}
              onDismissAll={(r) => dismissPending(r.id)}
              {...(currentActionResult !== undefined ? { result: currentActionResult } : {})}
            />
          ) : (
            <AIQuickAction
              action={tab}
              value={actionInput[tab]}
              onChange={(v) => setActionInput((prev) => ({ ...prev, [tab]: v }))}
              onRun={onRunCurrent}
              onCancel={() => cancelChat()}
              loading={loading}
              disabled={!hasKey}
              {...(currentActionResult !== undefined ? { result: currentActionResult } : {})}
            />
          )}
        </div>
      </div>

      {/* 底部：聊天 tab 下的"清空"按钮 + pending 摘要 */}
      {tab === 'chat' && messages.length > 0 ? (
        <div className="flex items-center justify-end">
          <button
            type="button"
            data-testid="ai-chat-clear"
            onClick={() => clearMessages()}
            className="rounded-md border border-line bg-elevated px-3 py-1 text-xs text-secondary transition-colors hover:text-danger"
          >
            {t.pages.ai.clearChat}
          </button>
        </div>
      ) : null}

      {/* 当前 tab 提示（仅调试信息友好） */}
      <p className="sr-only">{t.pages.ai.currentTab(currentTabConfig.label)}</p>
    </section>
  );
}

/** 待确认列表（行内子组件，仅本页用）。 */
function PendingList({
  items,
  onConfirm,
  onDismiss,
}: {
  items: PendingResult[];
  onConfirm: (id: string) => void;
  onDismiss: (id: string) => void;
}): React.ReactElement {
  const t = useT();
  if (items.length === 0) {
    return (
      <EmptyState
        icon={Inbox}
        title={t.empty.aiPending.title}
        description={t.empty.aiPending.description}
        data-testid="ai-pending-empty"
      />
    );
  }
  return (
    <div data-testid="ai-pending-list" className="flex-1 space-y-3 overflow-auto p-3">
      {items.map((it) => (
        <AIPendingConfirm key={it.id} item={it} onConfirm={onConfirm} onDismiss={onDismiss} />
      ))}
    </div>
  );
}
