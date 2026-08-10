/**
 * aiStore Zustand store 测试（T3-3 + T3-4 结构化提取）
 *
 * 覆盖：
 *   - loadProviders 调 window.api.ai.listProviders 并更新 providers
 *   - setProvider 切换 provider + 刷 hasKey + 切 model
 *   - setKey / deleteKey 联动 hasKey
 *   - sendMessage：调 window.api.ai.chat + 累积 chunks 到 messages
 *   - sendMessage 收到 done chunk → 标记 assistant 消息 streaming=false
 *   - sendMessage 收到 error chunk → 标记错误 + toast
 *   - runAction(summarize)：调 chat + 加 pending + 流式累积
 *   - confirmPending 改 status
 *   - dismissPending 改 status
 *   - clearMessages 清空 + 取消进行中的 chat
 *   - T3-4 runStructuredAction：调 extractJson + 写 pending.structured
 *   - T3-4 runStructuredAction 错误 → toast + pending dismissed
 *
 * 全部**不**依赖真实 IPC —— 用 `window.api` 形状 mock。
 *
 * **不**触发真实 fetch / CredentialManager —— 全部在 jsdom 下 mock。
 */

import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import type { Mock } from 'vitest';
import { act } from '@testing-library/react';

import { __resetAiStoreCounterForTest, useAiStore } from '@/store/aiStore';
import type { ChatMessage } from '@shared/types/ai';
import { useToastStore } from '@/store/toastStore';

interface ChatCall {
  input: {
    provider: string;
    messages: ChatMessage[];
    systemHint?: string;
    model?: string;
    requestId?: string;
  };
  callbacks: {
    onChunk: Mock;
    onDone: Mock;
    onError: Mock;
  };
  // 用于在 cancel 时显式调
  cancelFn: () => void;
}

interface ExtractJsonCall {
  input: {
    provider: string;
    schemaName: string;
    messages: ChatMessage[];
    systemHint?: string;
    model?: string;
    temperature?: number;
    maxRetries?: number;
  };
}

/**
 * 在 window 上挂一个 mock api.ai，支持所有方法。
 * chat 是一个**异步模拟器** —— 调 `onChunk` N 次，然后 `onDone`。
 */
function installMockApi(opts: {
  providers?: Array<{
    id: string;
    displayName: string;
    defaultModel: string;
    defaultBaseURL: string;
  }>;
  hasKey?: boolean;
  chatSimulator?: (call: ChatCall) => void | Promise<void>;
  extractJsonResult?:
    | { ok: true; data: unknown; attempts?: number }
    | { ok: false; error: { code: string; message: string } };
  config?: { model: string; baseURL: string; updatedAt: number };
}): {
  calls: {
    listProviders: Array<undefined>;
    hasKey: Array<{ provider: string }>;
    setKey: Array<{ provider: string; key: string }>;
    deleteKey: Array<{ provider: string }>;
    getConfig: Array<{ provider: string }>;
    setConfig: Array<{ provider: string; config: { model: string; baseURL: string } }>;
    testConnection: Array<{ provider: string }>;
    chat: ChatCall[];
    extractJson: ExtractJsonCall[];
  };
} {
  const calls = {
    listProviders: [] as Array<undefined>,
    hasKey: [] as Array<{ provider: string }>,
    setKey: [] as Array<{ provider: string; key: string }>,
    deleteKey: [] as Array<{ provider: string }>,
    getConfig: [] as Array<{ provider: string }>,
    setConfig: [] as Array<{ provider: string; config: { model: string; baseURL: string } }>,
    testConnection: [] as Array<{ provider: string }>,
    chat: [] as ChatCall[],
    extractJson: [] as ExtractJsonCall[],
  };
  const api = {
    async listProviders() {
      calls.listProviders.push(undefined);
      return { ok: true as const, data: opts.providers ?? [] };
    },
    async hasKey(input: { provider: string }) {
      calls.hasKey.push(input);
      return { ok: true as const, data: { hasKey: opts.hasKey ?? false } };
    },
    async setKey(input: { provider: string; key: string }) {
      calls.setKey.push(input);
      return { ok: true as const, data: { ok: true as const } };
    },
    async deleteKey(input: { provider: string }) {
      calls.deleteKey.push(input);
      return { ok: true as const, data: { ok: true as const } };
    },
    async getConfig(input: { provider: string }) {
      calls.getConfig.push(input);
      if (opts.config) {
        return {
          ok: true as const,
          data: { provider: input.provider as 'minimax', ...opts.config },
        };
      }
      return { ok: false as const, error: { code: 'NOT_FOUND', message: 'not found' } };
    },
    async setConfig(input: { provider: string; config: { model: string; baseURL: string } }) {
      calls.setConfig.push(input);
      return {
        ok: true as const,
        data: {
          provider: input.provider as 'minimax',
          ...input.config,
          updatedAt: Date.now(),
        },
      };
    },
    async testConnection(input: { provider: string }) {
      calls.testConnection.push(input);
      return { ok: true as const, data: { ok: true, error: undefined } };
    },
    chat(
      input: {
        provider: string;
        messages: ChatMessage[];
        systemHint?: string;
        model?: string;
        requestId?: string;
      },
      cbs: { onChunk: Mock; onDone: Mock; onError: Mock },
    ) {
      const call: ChatCall = {
        input,
        callbacks: cbs,
        cancelFn: () => undefined,
      };
      calls.chat.push(call);
      // 异步模拟器
      if (opts.chatSimulator) {
        void Promise.resolve(opts.chatSimulator(call));
      }
      // 返回 cancel 函数
      return (): void => {
        call.cancelFn();
      };
    },
    async extractJson(input: {
      provider: string;
      schemaName: string;
      messages: ChatMessage[];
      systemHint?: string;
      model?: string;
      temperature?: number;
      maxRetries?: number;
    }) {
      calls.extractJson.push({ input });
      const result = opts.extractJsonResult;
      if (result && !result.ok) {
        return result;
      }
      if (result && result.ok) {
        return { ok: true as const, data: { data: result.data, attempts: result.attempts ?? 1 } };
      }
      // 默认：成功空结果
      return { ok: true as const, data: { data: { tasks: [] }, attempts: 1 } };
    },
  };
  // 挂到 window.api.ai
  (window as unknown as { api: { ai: typeof api } }).api = { ai: api };
  return { calls };
}

function uninstallMockApi(): void {
  delete (window as unknown as { api?: unknown }).api;
}

beforeEach(() => {
  __resetAiStoreCounterForTest();
  useToastStore.setState({ toasts: [] });
  // store 重置（每个测试独立）
  useAiStore.setState({
    providers: [],
    provider: 'minimax',
    model: 'MiniMax-M2',
    hasKey: false,
    messages: [],
    pendingResults: [],
    loading: false,
    error: null,
    cancelCurrent: null,
  });
});

afterEach(() => {
  uninstallMockApi();
});

describe('aiStore.loadProviders', () => {
  it('calls window.api.ai.listProviders and updates state', async () => {
    const { calls } = installMockApi({
      providers: [
        {
          id: 'minimax',
          displayName: 'MiniMax',
          defaultModel: 'MiniMax-M2',
          defaultBaseURL: 'https://example.com/v1',
        },
      ],
    });
    await act(async () => {
      await useAiStore.getState().loadProviders();
    });
    expect(calls.listProviders).toHaveLength(1);
    expect(useAiStore.getState().providers).toHaveLength(1);
    expect(useAiStore.getState().providers[0]?.id).toBe('minimax');
  });
});

describe('aiStore.setProvider', () => {
  it('changes provider, updates model, refreshes hasKey', async () => {
    const { calls } = installMockApi({
      providers: [
        {
          id: 'minimax',
          displayName: 'MiniMax',
          defaultModel: 'MiniMax-M2',
          defaultBaseURL: 'https://m/v1',
        },
        {
          id: 'openai-compatible',
          displayName: 'OpenAI',
          defaultModel: 'gpt-4o-mini',
          defaultBaseURL: 'https://o/v1',
        },
      ],
      hasKey: true,
    });
    // 先 load providers
    await act(async () => {
      await useAiStore.getState().loadProviders();
    });
    // setProvider
    act(() => {
      useAiStore.getState().setProvider('openai-compatible');
    });
    expect(useAiStore.getState().provider).toBe('openai-compatible');
    expect(useAiStore.getState().model).toBe('gpt-4o-mini');
    // 异步刷 hasKey → 等一拍
    await act(async () => {
      await Promise.resolve();
    });
    expect(calls.hasKey.length).toBeGreaterThanOrEqual(1);
    expect(calls.hasKey[calls.hasKey.length - 1]).toEqual({ provider: 'openai-compatible' });
    expect(useAiStore.getState().hasKey).toBe(true);
  });
});

describe('aiStore.setKey / deleteKey', () => {
  it('setKey calls window.api.ai.setKey and updates hasKey', async () => {
    const { calls } = installMockApi({});
    await act(async () => {
      await useAiStore.getState().setKey('sk-abc');
    });
    expect(calls.setKey).toEqual([{ provider: 'minimax', key: 'sk-abc' }]);
    expect(useAiStore.getState().hasKey).toBe(true);
  });

  it('deleteKey calls window.api.ai.deleteKey and updates hasKey', async () => {
    const { calls } = installMockApi({});
    // 先 setKey
    await act(async () => {
      await useAiStore.getState().setKey('sk-abc');
    });
    await act(async () => {
      await useAiStore.getState().deleteKey();
    });
    expect(calls.deleteKey).toEqual([{ provider: 'minimax' }]);
    expect(useAiStore.getState().hasKey).toBe(false);
  });
});

describe('aiStore.sendMessage', () => {
  it('appends user + assistant placeholder, streams tokens, marks done', async () => {
    installMockApi({
      hasKey: true,
      chatSimulator: (call) => {
        // 模拟：发 3 个 token 然后 done
        call.callbacks.onChunk({ type: 'token', content: 'Hel' });
        call.callbacks.onChunk({ type: 'token', content: 'lo' });
        call.callbacks.onChunk({ type: 'token', content: '!' });
        call.callbacks.onDone();
      },
    });
    useAiStore.setState({ hasKey: true });
    await act(async () => {
      await useAiStore.getState().sendMessage('hi');
    });
    // 等待模拟器跑完
    await act(async () => {
      await Promise.resolve();
    });
    const messages = useAiStore.getState().messages;
    expect(messages).toHaveLength(2);
    expect(messages[0]?.role).toBe('user');
    expect(messages[0]?.content).toBe('hi');
    expect(messages[1]?.role).toBe('assistant');
    expect(messages[1]?.content).toBe('Hello!');
    expect(messages[1]?.streaming).toBe(false);
    expect(useAiStore.getState().loading).toBe(false);
  });

  it('does nothing when no key configured', async () => {
    installMockApi({ hasKey: false });
    // hasKey 默认 false
    await act(async () => {
      await useAiStore.getState().sendMessage('hi');
    });
    expect(useAiStore.getState().messages).toHaveLength(0);
  });

  it('does nothing when content is empty / whitespace', async () => {
    installMockApi({ hasKey: true });
    useAiStore.setState({ hasKey: true });
    await act(async () => {
      await useAiStore.getState().sendMessage('   ');
    });
    expect(useAiStore.getState().messages).toHaveLength(0);
  });

  it('handles error chunk: marks message complete + sets error', async () => {
    installMockApi({
      hasKey: true,
      chatSimulator: (call) => {
        call.callbacks.onChunk({ type: 'token', content: 'partial ' });
        call.callbacks.onError({ code: 'EXTERNAL_FAILURE', message: 'server down' });
      },
    });
    useAiStore.setState({ hasKey: true });
    await act(async () => {
      await useAiStore.getState().sendMessage('hi');
    });
    await act(async () => {
      await Promise.resolve();
    });
    const messages = useAiStore.getState().messages;
    expect(messages).toHaveLength(2);
    expect(messages[1]?.streaming).toBe(false);
    expect(useAiStore.getState().error).toBe('server down');
  });
});

describe('aiStore.runAction', () => {
  it('summarize: adds pending with streaming=true, accumulates content', async () => {
    installMockApi({
      hasKey: true,
      chatSimulator: (call) => {
        call.callbacks.onChunk({ type: 'token', content: 'Sum' });
        call.callbacks.onChunk({ type: 'token', content: 'mary' });
        call.callbacks.onDone();
      },
    });
    useAiStore.setState({ hasKey: true });
    await act(async () => {
      await useAiStore.getState().runAction('summarize', 'long text');
    });
    await act(async () => {
      await Promise.resolve();
    });
    const pending = useAiStore.getState().pendingResults;
    expect(pending).toHaveLength(1);
    expect(pending[0]?.action).toBe('summarize');
    expect(pending[0]?.content).toBe('Summary');
    expect(pending[0]?.streaming).toBe(false);
    expect(pending[0]?.sourceInput).toBe('long text');
  });

  it('error: marks pending as dismissed', async () => {
    installMockApi({
      hasKey: true,
      chatSimulator: (call) => {
        call.callbacks.onError({ code: 'EXTERNAL_FAILURE', message: 'oops' });
      },
    });
    useAiStore.setState({ hasKey: true });
    await act(async () => {
      await useAiStore.getState().runAction('summarize', 'text');
    });
    await act(async () => {
      await Promise.resolve();
    });
    const pending = useAiStore.getState().pendingResults;
    expect(pending[0]?.status).toBe('dismissed');
  });
});

describe('aiStore.confirmPending / dismissPending', () => {
  it('confirmPending sets status=confirmed', () => {
    useAiStore.setState({
      pendingResults: [
        {
          id: 'p1',
          action: 'summarize',
          content: 'x',
          createdAt: 0,
          status: 'pending',
          streaming: false,
        },
      ],
    });
    act(() => {
      useAiStore.getState().confirmPending('p1');
    });
    expect(useAiStore.getState().pendingResults[0]?.status).toBe('confirmed');
  });

  it('dismissPending sets status=dismissed', () => {
    useAiStore.setState({
      pendingResults: [
        {
          id: 'p1',
          action: 'summarize',
          content: 'x',
          createdAt: 0,
          status: 'pending',
          streaming: false,
        },
      ],
    });
    act(() => {
      useAiStore.getState().dismissPending('p1');
    });
    expect(useAiStore.getState().pendingResults[0]?.status).toBe('dismissed');
  });
});

describe('aiStore.clearMessages', () => {
  it('clears messages and cancels current chat', () => {
    let cancelCalled = false;
    useAiStore.setState({
      messages: [{ id: 'm1', role: 'user', content: 'hi', createdAt: 0 }],
      cancelCurrent: (): void => {
        cancelCalled = true;
      },
    });
    act(() => {
      useAiStore.getState().clearMessages();
    });
    expect(useAiStore.getState().messages).toHaveLength(0);
    expect(cancelCalled).toBe(true);
  });
});

describe('aiStore.runStructuredAction (T3-4)', () => {
  it('extracts task_drafts successfully: writes structured + content JSON', async () => {
    installMockApi({
      hasKey: true,
      extractJsonResult: {
        ok: true,
        data: {
          tasks: [{ title: 'Task 1', priority: 'high' }, { title: 'Task 2' }],
        },
        attempts: 1,
      },
    });
    useAiStore.setState({ hasKey: true });
    await act(async () => {
      await useAiStore
        .getState()
        .runStructuredAction('extract_tasks', 'task_drafts', 'long text input');
    });
    const pending = useAiStore.getState().pendingResults;
    expect(pending).toHaveLength(1);
    expect(pending[0]?.action).toBe('extract_tasks');
    expect(pending[0]?.schemaName).toBe('task_drafts');
    expect(pending[0]?.structured).toEqual({
      tasks: [{ title: 'Task 1', priority: 'high' }, { title: 'Task 2' }],
    });
    expect(pending[0]?.content).toContain('Task 1');
    expect(pending[0]?.attempts).toBe(1);
    expect(pending[0]?.status).toBe('pending');
  });

  it('extracts inbox_items successfully', async () => {
    installMockApi({
      hasKey: true,
      extractJsonResult: {
        ok: true,
        data: { items: [{ content: 'a note', kind: 'note' }] },
        attempts: 1,
      },
    });
    useAiStore.setState({ hasKey: true });
    await act(async () => {
      await useAiStore.getState().runStructuredAction('summarize', 'inbox_items', 'input');
    });
    const pending = useAiStore.getState().pendingResults;
    expect(pending[0]?.schemaName).toBe('inbox_items');
    expect(pending[0]?.structured).toEqual({ items: [{ content: 'a note', kind: 'note' }] });
  });

  it('error: marks pending as dismissed when IPC returns ok:false', async () => {
    installMockApi({
      hasKey: true,
      extractJsonResult: {
        ok: false,
        error: { code: 'VALIDATION_FAILED', message: 'invalid output' },
      },
    });
    useAiStore.setState({ hasKey: true });
    await act(async () => {
      await useAiStore.getState().runStructuredAction('extract_tasks', 'task_drafts', 'input');
    });
    const pending = useAiStore.getState().pendingResults;
    expect(pending[0]?.status).toBe('dismissed');
  });

  it('does nothing when no key is configured', async () => {
    const { calls } = installMockApi({ hasKey: false });
    await act(async () => {
      await useAiStore.getState().runStructuredAction('extract_tasks', 'task_drafts', 'input');
    });
    expect(calls.extractJson).toHaveLength(0);
    expect(useAiStore.getState().pendingResults).toHaveLength(0);
  });

  it('does nothing when input is empty / whitespace', async () => {
    const { calls } = installMockApi({ hasKey: true });
    useAiStore.setState({ hasKey: true });
    await act(async () => {
      await useAiStore.getState().runStructuredAction('extract_tasks', 'task_drafts', '   ');
    });
    expect(calls.extractJson).toHaveLength(0);
  });

  it('defensive: marks pending as dismissed if return value does not match schema (renderer-side)', async () => {
    installMockApi({
      hasKey: true,
      // 故意返回不匹配 task_drafts 的结构
      extractJsonResult: {
        ok: true,
        data: { wrong_field: 'no tasks key' },
        attempts: 1,
      },
    });
    useAiStore.setState({ hasKey: true });
    await act(async () => {
      await useAiStore.getState().runStructuredAction('extract_tasks', 'task_drafts', 'input');
    });
    const pending = useAiStore.getState().pendingResults;
    expect(pending[0]?.status).toBe('dismissed');
  });
});

describe('aiStore.runStructuredAction (T4-3: note_summary)', () => {
  it('extracts note_summary successfully: writes structured {title, summary, tags} + JSON content', async () => {
    installMockApi({
      hasKey: true,
      extractJsonResult: {
        ok: true,
        data: {
          title: 'AI Note Title',
          summary: 'Concise summary text from AI.',
          tags: ['frontend', 'react', 'state'],
        },
        attempts: 1,
      },
    });
    useAiStore.setState({ hasKey: true });
    await act(async () => {
      await useAiStore
        .getState()
        .runStructuredAction('summarize', 'note_summary', 'long note content for summarization');
    });
    const pending = useAiStore.getState().pendingResults;
    expect(pending).toHaveLength(1);
    expect(pending[0]?.action).toBe('summarize');
    expect(pending[0]?.schemaName).toBe('note_summary');
    expect(pending[0]?.structured).toEqual({
      title: 'AI Note Title',
      summary: 'Concise summary text from AI.',
      tags: ['frontend', 'react', 'state'],
    });
    expect(pending[0]?.content).toContain('AI Note Title');
    expect(pending[0]?.content).toContain('Concise summary text');
    expect(pending[0]?.content).toContain('frontend');
    expect(pending[0]?.attempts).toBe(1);
    expect(pending[0]?.status).toBe('pending');
  });

  it('note_summary error: marks pending as dismissed when IPC returns ok:false', async () => {
    installMockApi({
      hasKey: true,
      extractJsonResult: {
        ok: false,
        error: { code: 'EXTERNAL_FAILURE', message: 'AI service down' },
      },
    });
    useAiStore.setState({ hasKey: true });
    await act(async () => {
      await useAiStore.getState().runStructuredAction('summarize', 'note_summary', 'content');
    });
    const pending = useAiStore.getState().pendingResults;
    expect(pending[0]?.status).toBe('dismissed');
  });

  it('note_summary defensive: marks pending as dismissed if return value does not match schema', async () => {
    installMockApi({
      hasKey: true,
      // 故意返回不匹配 note_summary 的结构（缺 title / summary / tags）
      extractJsonResult: {
        ok: true,
        data: { wrong_field: 'no note_summary key' },
        attempts: 1,
      },
    });
    useAiStore.setState({ hasKey: true });
    await act(async () => {
      await useAiStore.getState().runStructuredAction('summarize', 'note_summary', 'content');
    });
    const pending = useAiStore.getState().pendingResults;
    expect(pending[0]?.status).toBe('dismissed');
  });

  it('note_summary: sourceInput stores the original content (used by NoteAIPanel to find pending)', async () => {
    installMockApi({
      hasKey: true,
      extractJsonResult: {
        ok: true,
        data: { title: 'T', summary: 'S', tags: [] },
        attempts: 1,
      },
    });
    useAiStore.setState({ hasKey: true });
    const inputContent = 'the original note body to summarize';
    await act(async () => {
      await useAiStore.getState().runStructuredAction('summarize', 'note_summary', inputContent);
    });
    const pending = useAiStore.getState().pendingResults;
    expect(pending[0]?.sourceInput).toBe(inputContent);
  });
});
