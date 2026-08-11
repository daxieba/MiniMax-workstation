/**
 * Provider 工厂（T3-2 适配器）
 *
 * 把真实 provider 适配器实例化、注册到 registry 的统一入口。
 *
 * **T3-2 阶段**：实例化两个 provider（MiniMax / OpenAI-compatible），并把它们
 * 注册到 `electron/main/providers/registry.ts` 的全局 registry，**覆盖** T3-1 阶段
 * 的占位实现。
 *
 * **调用方**：`electron/main/index.ts` 在 `app.whenReady()` 内：
 *   1. 创建 `CredentialManager`
 *   2. 调 `createProviders({ credentialManager })`
 *   3. 调 `registerAiIpc({ db, credentialManager })`
 *
 * **为什么需要工厂**：T3-1 的 `ensurePlaceholderProvidersRegistered` 是模块顶层
 * 副作用（import 即注册），T3-2 改成"显式依赖注入 + 显式注册"——这样：
 *   - provider 持有 `CredentialManager` 实例引用，可单测 mock
 *   - 应用启动期能控制注册顺序（先创建 provider，再注册 IPC）
 *   - 未来要加新 provider 只需在工厂里 `new + registerProvider`
 *
 * @used-by electron/main/index.ts
 */

import type { CredentialManager } from '../credentials/credentialManager';
import { MiniMaxProvider } from './minimaxProvider';
import { OpenAICompatibleProvider } from './openaiCompatibleProvider';
import { registerProvider, type ProviderRegistrationResult } from './registry';

/**
 * 工厂依赖：当前只注入 CredentialManager（之后可能要注入 logger / metrics，扩展时再加）。
 */
export interface CreateProvidersDeps {
  credentialManager: CredentialManager;
}

/**
 * 创建并注册全部真实 provider。
 *
 * **副作用**：
 *   - 实例化 `MiniMaxProvider` + `OpenAICompatibleProvider`
 *   - 注入依赖 `getKey: () => credentialManager.getKey(id)`
 *   - 调 `registerProvider` 注册到全局 registry（覆盖 T3-1 占位）
 *
 * **返回**：把两个 provider 实例化结果一并返回，方便主进程代码 / 测试拿到
 * adapter 引用（不必 `getProvider()` 二次查询）。
 */
export function createProviders(deps: CreateProvidersDeps): ProviderRegistrationResult {
  const minimax = new MiniMaxProvider({
    getKey: () => deps.credentialManager.getKey('minimax'),
  });
  const openaiCompatible = new OpenAICompatibleProvider({
    getKey: () => deps.credentialManager.getKey('openai-compatible'),
  });

  registerProvider(minimax);
  registerProvider(openaiCompatible);

  return { minimax, openaiCompatible };
}
