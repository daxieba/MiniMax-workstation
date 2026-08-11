/**
 * 凭据管理器（T3-1 基础设施）
 *
 * 把 API Key 安全地存在 OS 级别的 keyring（Windows Credential Manager / macOS Keychain /
 * Linux Secret Service / libsecret / 直接文件 fallback），主进程内**唯一**的 key 入口。
 *
 * **依赖**（PROJECT_IDENTITY.md §2.1）：
 *   - `@napi-rs/keyring`（T3-1 替代 `keytar`，NAPI 跨平台、Node 24 原生兼容）
 *   - 内部 `Entry` 包装：每个 (service, account) 对应 OS keyring 一条
 *
 * **服务名 / 账户名约定**（PROJECT_IDENTITY.md §6.1）：
 *   - `service` = `SERVICE_NAME` = `'minimax-workstation'`
 *   - `account` = `provider:<providerId>`（例 `'provider:minimax'`）
 *
 * **关键安全约束**（PROJECT_IDENTITY.md §6.1）：
 *   - **不**在日志 / 错误信息中输出 key 内容
 *   - 错误统一转 `Error`，message 只含 provider id + 操作类型 + 错误类别（不含 key）
 *   - 渲染进程**永不**直接调本类 —— 走主进程 IPC handler
 *
 * **T3-1 范围**：
 *   - 仅做 CRUD（setKey / getKey / deleteKey / hasKey）
 *   - **不**做 key rotation / 加密备份 / 多端点共享 —— 留给后续卡
 *
 * @used-by electron/main/ipc/ai.ts（`ai:hasKey` / `ai:setKey` / `ai:deleteKey`）
 *          后续 T3-2 适配器构造时拿 key
 */

import { Entry } from '@napi-rs/keyring';

import type { ProviderId } from '../../../shared/types/ai';

/** keyring service 名（所有 provider 共享）。 */
export const SERVICE_NAME = 'minimax-workstation';

/**
 * CredentialManager —— 包装 `@napi-rs/keyring` 的 `Entry`。
 *
 * 线程 / 进程：主进程单例（不需要并发同步，keyring 操作是阻塞且快速）。
 *
 * 序列化：@napi-rs/keyring 的 Entry.setPassword 是**异步**的（NAPI 走 libuv 线程池），
 * 所以公开方法都是 async（即使底层大部分场景是瞬时返回）。
 */
export class CredentialManager {
  /** keyring service 名（恒为 `SERVICE_NAME`）。 */
  public readonly service: string;

  public constructor(service: string = SERVICE_NAME) {
    this.service = service;
  }

  /**
   * 计算 provider 对应的 keyring account 字符串。
   *
   * 格式：`provider:<providerId>` —— 与 PROJECT_IDENTITY.md §6.1 对齐。
   *
   * @example
   *   accountFor('minimax')           // 'provider:minimax'
   *   accountFor('openai-compatible') // 'provider:openai-compatible'
   */
  public accountFor(provider: ProviderId): string {
    return `provider:${provider}`;
  }

  /**
   * 存一个 provider 的 API key。已存在则覆盖。
   *
   * @param provider provider id
   * @param key      API key 字符串
   *
   * @throws {Error} keyring 写入失败（message 不含 key）
   */
  public async setKey(provider: ProviderId, key: string): Promise<void> {
    if (typeof key !== 'string' || key.length === 0) {
      throw this.makeError('set', 'invalid-key', 'key must be a non-empty string');
    }
    try {
      const entry = new Entry(this.service, this.accountFor(provider));
      await entry.setPassword(key);
    } catch (err) {
      // 错误信息只含 provider + 操作 + 类别，**不**含 key 内容
      throw this.makeError('set', 'keychain-failed', this.toMessage(err));
    }
  }

  /**
   * 读一个 provider 的 API key。
   *
   * **找不到** → 返回 `null`（不抛错，调用方据此走"未配置"分支）。
   * **读取失败** → 抛 `Error`。
   *
   * @param provider provider id
   * @returns key 字符串；不存在时 `null`
   *
   * @throws {Error} keyring 读取失败（message 不含 key）
   */
  public async getKey(provider: ProviderId): Promise<string | null> {
    try {
      const entry = new Entry(this.service, this.accountFor(provider));
      const password = await entry.getPassword();
      // @napi-rs/keyring 在 NoEntry 时返回 null（与 keytar 一致）
      return password ?? null;
    } catch (err) {
      // 兜底：部分后端在 NoEntry 时也会抛 NoEntryError，这里把 'no entry' 也归 null
      if (this.isNoEntryError(err)) return null;
      throw this.makeError('get', 'keychain-failed', this.toMessage(err));
    }
  }

  /**
   * 删除一个 provider 的 API key。
   *
   * **不存在** → 不抛错（幂等删除）。
   * **删除失败** → 抛 `Error`。
   *
   * @param provider provider id
   *
   * @throws {Error} keyring 删除失败（message 不含 key）
   */
  public async deleteKey(provider: ProviderId): Promise<void> {
    try {
      const entry = new Entry(this.service, this.accountFor(provider));
      await entry.deletePassword();
    } catch (err) {
      if (this.isNoEntryError(err)) return;
      throw this.makeError('delete', 'keychain-failed', this.toMessage(err));
    }
  }

  /**
   * 判断一个 provider 是否已配置 API key。
   *
   * 实现：先 `getKey()` 再判断非空。底层走同一条 keyring 路径。
   *
   * @param provider provider id
   * @returns `true` 表示已存在 key；`false` 表示未配置
   *
   * @throws {Error} keyring 读取失败（message 不含 key）
   */
  public async hasKey(provider: ProviderId): Promise<boolean> {
    const key = await this.getKey(provider);
    return key !== null && key.length > 0;
  }

  // ------------------------------------------------------------------
  //  私有辅助
  // ------------------------------------------------------------------

  /**
   * 把异常 / 字符串转成安全 message（不包含可能泄露的 key 内容）。
   *
   * @napi-rs/keyring 的错误信息通常只是简短后端描述（"No matching entry" /
   * "Access denied" 等），不含 key 内容 —— 但我们仍走 `.message`，
   * 不走 `String(err)`，避免 `err.toString()` 拼接栈帧时把任何
   * 包含 key 的字段带出来。
   */
  private toMessage(err: unknown): string {
    if (err instanceof Error) return err.message;
    return 'unknown error';
  }

  /**
   * 判断异常是否为"keyring 无此条目"。
   *
   * @napi-rs/keyring 在不同平台下可能：
   *   - 直接返回 `null`（Mac / Linux libsecret）
   *   - 抛 `Error('No matching entry')`（Windows Credential Manager 部分版本）
   *
   * 把后者归到"无条目"语义，让 `getKey` / `deleteKey` 行为一致。
   */
  private isNoEntryError(err: unknown): boolean {
    if (!(err instanceof Error)) return false;
    const msg = err.message.toLowerCase();
    return (
      msg.includes('no matching entry') ||
      msg.includes('no entry') ||
      msg.includes('not found')
    );
  }

  /**
   * 构造统一格式的 Error。
   *
   * message 模板：`[credential:${operation}:${kind}] ${provider} <detail>`，
   * **绝不**包含 key 内容。
   */
  private makeError(
    operation: 'set' | 'get' | 'delete' | 'has' | 'invalid-key',
    kind: 'keychain-failed' | 'invalid-key',
    detail: string,
  ): Error {
    const message = `[credential:${operation}:${kind}] ${detail}`;
    return new Error(message);
  }
}
