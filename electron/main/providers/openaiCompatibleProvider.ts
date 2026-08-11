/**
 * OpenAI-compatible provider（T3-2 适配器）
 *
 * 任意兼容 OpenAI Chat Completions 协议的 provider（OpenAI 官方、Azure OpenAI、
 * 各类代理、第三方托管服务等）的适配器。继承 `OpenAIChatProvider`，只提供 metadata。
 *
 * **注意**：`defaultBaseURL` 是 `https://api.openai.com/v1`（OpenAI 官方）—— 用户
 * 拿到第一个 API key 时大多数情况下会通过 `ai:setConfig` 把它改为自己 endpoint；
 * 改之前默认值足够 `testConnection` 跑通（如果用户用的是 OpenAI 官方 key）。
 *
 * **T3-2 范围**：
 *   - 暴露 OpenAI-compatible provider id + defaultModel / defaultBaseURL / docsUrl
 *   - chat / testConnection 行为完全由基类提供
 *
 * @used-by electron/main/providers/factory.ts
 *          tests/openaiCompatibleProvider.test.ts
 */

import type { ProviderMetadata } from '../../../shared/types/ai';
import { OpenAIChatProvider } from './openaiChatProvider';

/**
 * OpenAI-compatible provider 适配器。
 *
 * 构造时**不**拿 key：基类 `chat` 第一次 `.next()` 时才读。
 */
export class OpenAICompatibleProvider extends OpenAIChatProvider {
  public readonly metadata: ProviderMetadata = {
    id: 'openai-compatible',
    displayName: 'OpenAI Compatible',
    defaultModel: 'gpt-4o-mini',
    defaultBaseURL: 'https://api.openai.com/v1',
    docsUrl: 'https://platform.openai.com/api-keys',
  };
}
