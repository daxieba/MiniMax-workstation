/**
 * Provider 注册表（T3-2 适配器）
 *
 * 集中管理所有 `ProviderAdapter` 实例。业务层只通过 `getProvider(id)` /
 * `listProviders()` 拿 provider，**不**直接 new 适配器。
 *
 * **T3-1 阶段**：模块顶层 import 即注册两个占位 provider。
 * **T3-2 阶段**：移除模块顶层副作用 + 占位实现类；改为由 `factory.ts` 在主进程
 * 启动期显式调 `registerProvider(...)` 注册两个真实 provider。
 *
 * **设计要点**：
 *   - registry 是**模块内单例**（顶层 `providers` Map），不引入 DI 容器
 *   - `registerProvider` 走 `Map.set` 语义：同一 id 重复注册 → 覆盖（warning）
 *   - 拿不存在的 provider → 返回 `undefined`（调用方据此返回 NOT_FOUND）
 *   - **不暴露 unregister**：避免误删（实际切换 provider 走 setConfig）
 *
 * **线程安全**：主进程单线程，模块顶层 Map 初始化顺序固定。
 *
 * @used-by electron/main/ipc/ai.ts
 *          electron/main/providers/factory.ts
 */

import type { ProviderAdapter } from './ProviderAdapter';
import type { MiniMaxProvider } from './minimaxProvider';
import type { OpenAICompatibleProvider } from './openaiCompatibleProvider';
import type { ProviderId, ProviderMetadata } from '../../../shared/types/ai';

/** provider 存储结构：id → adapter。 */
const providers = new Map<ProviderId, ProviderAdapter>();

/**
 * 注册 / 覆盖一个 provider。
 *
 * 同 id 重复注册会打印 warning（开发期发现意外的覆盖），不抛错。
 * 真实替换由 `factory.ts` 在主进程启动时一次性注册。
 */
export function registerProvider(adapter: ProviderAdapter): void {
  const existing = providers.get(adapter.metadata.id);
  if (existing !== undefined) {
    // eslint-disable-next-line no-console
    console.warn(
      `[providers] re-registering provider '${adapter.metadata.id}' (was: ${existing.constructor.name}, now: ${adapter.constructor.name})`,
    );
  }
  providers.set(adapter.metadata.id, adapter);
}

/**
 * 注销一个 provider（**仅供测试使用**）。
 *
 * 生产代码不调用此函数；只用于测试 NOT_FOUND 路径。
 */
export function unregisterProviderForTest(id: ProviderId): void {
  providers.delete(id);
}

/**
 * 拿一个 provider adapter。
 *
 * @returns adapter；不存在时返回 `undefined`（IPC handler 据此返回 NOT_FOUND）
 */
export function getProvider(id: ProviderId): ProviderAdapter | undefined {
  return providers.get(id);
}

/**
 * 列出所有已注册 provider 的 metadata。
 *
 * 顺序：按注册顺序（Map 保持插入顺序）。
 */
export function listProviders(): ProviderMetadata[] {
  return Array.from(providers.values()).map((a) => a.metadata);
}

/**
 * 拿默认 metadata（用于 setConfig 时缺省回退）。
 *
 * @returns metadata；不存在时返回 `undefined`
 */
export function getProviderMetadata(id: ProviderId): ProviderMetadata | undefined {
  return providers.get(id)?.metadata;
}

/**
 * 工厂注册返回值（`factory.ts` 的 `createProviders` 返回值）。
 *
 * **仅作类型定义**：主进程 / 测试拿到工厂返回值后可以直接读 `result.minimax.metadata`，
 * 不必走 `getProvider` 二次查询。
 */
export interface ProviderRegistrationResult {
  minimax: MiniMaxProvider;
  openaiCompatible: OpenAICompatibleProvider;
}
