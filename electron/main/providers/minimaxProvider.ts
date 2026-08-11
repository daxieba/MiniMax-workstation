/**
 * MiniMax provider（T3-2 适配器）
 *
 * MiniMax 官方 OpenAI-compatible 接口适配器。继承 `OpenAIChatProvider`，
 * 只提供 metadata。
 *
 * **T3-2 范围**：
 *   - 暴露 MiniMax provider id + defaultModel / defaultBaseURL / docsUrl
 *   - chat / testConnection 行为完全由基类提供
 *   - **不**加 MiniMax 特有逻辑（MiniMax 接口完全 OpenAI 兼容）
 *
 * @used-by electron/main/providers/factory.ts
 *          tests/minimaxProvider.test.ts
 */

import type { ProviderMetadata } from '../../../shared/types/ai';
import { OpenAIChatProvider } from './openaiChatProvider';

/**
 * MiniMax provider 适配器。
 *
 * 构造时**不**拿 key：基类 `chat` 第一次 `.next()` 时才读，避免应用启动期
 * 强制 keychain 调用。
 */
export class MiniMaxProvider extends OpenAIChatProvider {
  public readonly metadata: ProviderMetadata = {
    id: 'minimax',
    displayName: 'MiniMax',
    defaultModel: 'MiniMax-M2',
    defaultBaseURL: 'https://api.minimax.chat/v1',
    docsUrl: 'https://api.minimax.chat/',
  };
}
