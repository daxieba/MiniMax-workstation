/**
 * Updater 共享 Zod schema 边界测试（T5-3）
 *
 * 覆盖：
 *   - `CheckForUpdateResponseDataSchema` 接受/拒绝各种形状
 *       1. 最小可用 `{ available: false }` → 通过
 *       2. 完整 `{ available: true, version, message }` → 通过
 *       3. `available` 缺失 → 拒
 *       4. `available` 非 boolean → 拒
 *       5. 额外字段（如 `feedUrl`）→ 拒（.strict）
 *       6. `version` 超过 64 字符 → 拒
 *       7. `message` 超过 256 字符 → 拒
 *   - `DownloadUpdateResponseDataSchema` 接受/拒绝
 *       1. `{ ok: true, message: 'ok' }` → 通过
 *       2. `ok: false` → 拒（literal true）
 *       3. 缺 message → 拒
 *       4. 额外字段 → 拒（.strict）
 *   - `CheckForUpdateInputSchema` / `DownloadUpdateInputSchema` 接受空对象，拒额外字段
 *
 * @see shared/schemas/updater.ts
 */

import { describe, expect, it } from 'vitest';

import {
  CheckForUpdateInputSchema,
  CheckForUpdateResponseDataSchema,
  DownloadUpdateInputSchema,
  DownloadUpdateResponseDataSchema,
} from '../shared/schemas/updater';

// ============================================================
//  CheckForUpdateResponseDataSchema
// ============================================================

describe('CheckForUpdateResponseDataSchema', () => {
  it('accepts minimal { available: false }', () => {
    const r = CheckForUpdateResponseDataSchema.safeParse({ available: false });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.available).toBe(false);
      expect(r.data.version).toBeUndefined();
      expect(r.data.message).toBeUndefined();
    }
  });

  it('accepts full { available: true, version, message }', () => {
    const r = CheckForUpdateResponseDataSchema.safeParse({
      available: true,
      version: '0.2.0',
      message: 'New version available',
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.version).toBe('0.2.0');
      expect(r.data.message).toBe('New version available');
    }
  });

  it('rejects when available is missing', () => {
    const r = CheckForUpdateResponseDataSchema.safeParse({ message: 'x' });
    expect(r.success).toBe(false);
  });

  it('rejects when available is not boolean', () => {
    const r = CheckForUpdateResponseDataSchema.safeParse({ available: 'true' });
    expect(r.success).toBe(false);
  });

  it('rejects extra fields (.strict)', () => {
    const r = CheckForUpdateResponseDataSchema.safeParse({
      available: false,
      feedUrl: 'https://leak.example.com',
    });
    expect(r.success).toBe(false);
  });

  it('rejects version longer than 64 chars', () => {
    const r = CheckForUpdateResponseDataSchema.safeParse({
      available: true,
      version: 'x'.repeat(65),
    });
    expect(r.success).toBe(false);
  });

  it('rejects message longer than 256 chars', () => {
    const r = CheckForUpdateResponseDataSchema.safeParse({
      available: false,
      message: 'm'.repeat(257),
    });
    expect(r.success).toBe(false);
  });
});

// ============================================================
//  DownloadUpdateResponseDataSchema
// ============================================================

describe('DownloadUpdateResponseDataSchema', () => {
  it('accepts { ok: true, message }', () => {
    const r = DownloadUpdateResponseDataSchema.safeParse({ ok: true, message: 'downloading' });
    expect(r.success).toBe(true);
  });

  it('rejects ok: false (literal true)', () => {
    const r = DownloadUpdateResponseDataSchema.safeParse({ ok: false, message: 'x' });
    expect(r.success).toBe(false);
  });

  it('rejects missing message', () => {
    const r = DownloadUpdateResponseDataSchema.safeParse({ ok: true });
    expect(r.success).toBe(false);
  });

  it('rejects extra fields (.strict)', () => {
    const r = DownloadUpdateResponseDataSchema.safeParse({
      ok: true,
      message: 'ok',
      feedUrl: 'leak',
    });
    expect(r.success).toBe(false);
  });
});

// ============================================================
//  CheckForUpdateInputSchema / DownloadUpdateInputSchema
// ============================================================

describe('Updater input schemas (empty object, no extra fields)', () => {
  it('CheckForUpdateInputSchema accepts {}', () => {
    const r = CheckForUpdateInputSchema.safeParse({});
    expect(r.success).toBe(true);
  });

  it('CheckForUpdateInputSchema rejects extra fields (.strict)', () => {
    const r = CheckForUpdateInputSchema.safeParse({ feedUrl: 'x' });
    expect(r.success).toBe(false);
  });

  it('DownloadUpdateInputSchema accepts {}', () => {
    const r = DownloadUpdateInputSchema.safeParse({});
    expect(r.success).toBe(true);
  });

  it('DownloadUpdateInputSchema rejects extra fields (.strict)', () => {
    const r = DownloadUpdateInputSchema.safeParse({ force: true });
    expect(r.success).toBe(false);
  });
});
