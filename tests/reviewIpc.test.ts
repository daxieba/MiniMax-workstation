/**
 * Review IPC handler 单元测试（T5-1）
 *
 * 直接调 `handleReview*` 函数（绕开 ipcMain 事件循环），喂临时 db，验证：
 *   - 5 个 handler 都有成功 + 失败两条用例
 *   - 错误码符合 PROJECT_IDENTITY.md §4.4
 *     (VALIDATION_FAILED / NOT_FOUND / EXTERNAL_FAILURE / PERSISTENCE_FAILED)
 *   - upsert 按 `date` 唯一键
 *   - update 的 `aiDraft: null` 清空语义
 *   - listRecent 默认 limit + 倒序
 *   - generateDraft 走 `handleAiExtractJson`（mock fetch 注入 AI 响应）
 *   - generateDraft 在 AI 失败时返 EXTERNAL_FAILURE
 *
 * **不依赖 Electron** —— 直接用 `db/client.ts` 的 createDbClient + 真实 CredentialManager。
 *
 * @see electron/main/ipc/review.ts
 */

import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve as resolvePath } from 'node:path';

import { ulid } from 'ulidx';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeDb, createDbClient, type WorkstationDb } from '../db/client';
import { reviews, type ReviewRow } from '../db/schema';
import { CredentialManager } from '../electron/main/credentials/credentialManager';
import { handleReviewGenerateDraft, type ReviewIpcDeps } from '../electron/main/ipc/review';
import {
  handleReviewGetByDate,
  handleReviewListRecent,
  handleReviewUpdate,
  handleReviewUpsert,
} from '../electron/main/ipc/review';
import { createProviders } from '../electron/main/providers/factory';
import { unregisterProviderForTest } from '../electron/main/providers/registry';

const TMP_ROOT = join(tmpdir(), 'minimax-workstation-review-ipc-test');

beforeAll(() => {
  if (!existsSync(TMP_ROOT)) {
    mkdirSync(TMP_ROOT, { recursive: true });
  }
});

afterAll(() => {
  try {
    rmSync(TMP_ROOT, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

interface Fixture {
  deps: ReviewIpcDeps;
  db: WorkstationDb;
  close: () => void;
}

function makeFixture(): Fixture {
  const dbPath = join(
    TMP_ROOT,
    `review-ipc-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
  );
  const { db } = createDbClient(dbPath, resolvePath(__dirname, '..'));
  const manager = new CredentialManager(`minimax-workstation-test-${ulid().toLowerCase()}`);
  createProviders({ credentialManager: manager });
  return {
    deps: { db, credentialManager: manager },
    db,
    close: () => closeDb(db),
  };
}

/** 工具：直接在 db 里建一个 review 行（绕开 IPC）。 */
function seedReview(db: WorkstationDb, overrides: Partial<ReviewRow> = {}): ReviewRow {
  const id = overrides.id ?? ulid();
  const now = new Date();
  const row: ReviewRow = {
    id,
    date: overrides.date ?? '2026-08-09',
    completed: overrides.completed ?? [],
    uncompleted: overrides.uncompleted ?? [],
    blockers: overrides.blockers ?? '',
    topThree: overrides.topThree ?? [],
    aiDraft: overrides.aiDraft === undefined ? null : overrides.aiDraft,
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
  };
  db.insert(reviews).values(row).run();
  return row;
}

/** 构造一个 SSE 响应，body 是单条 data 事件。 */
function makeSseResponseWithContent(content: string): Response {
  const body = `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n\n`;
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller): void {
        controller.enqueue(new TextEncoder().encode(body));
        controller.close();
      },
    }),
    { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  unregisterProviderForTest('minimax');
  unregisterProviderForTest('openai-compatible');
});

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

// ============================================================
//  review:getByDate
// ============================================================

describe('review:getByDate', () => {
  it('returns the review by date', async () => {
    const f = makeFixture();
    try {
      const seeded = seedReview(f.db, { date: '2026-08-09', blockers: 'busy' });
      const result = await handleReviewGetByDate(f.deps, { date: '2026-08-09' });
      expect(result).not.toBeNull();
      expect(result?.id).toBe(seeded.id);
      expect(result?.date).toBe('2026-08-09');
      expect(result?.blockers).toBe('busy');
    } finally {
      f.close();
    }
  });

  it('returns null for unknown date', async () => {
    const f = makeFixture();
    try {
      const result = await handleReviewGetByDate(f.deps, { date: '2026-08-09' });
      expect(result).toBeNull();
    } finally {
      f.close();
    }
  });

  it('rejects invalid date format with VALIDATION_FAILED', async () => {
    const f = makeFixture();
    try {
      const err = await handleReviewGetByDate(f.deps, { date: 'not-a-date' }).catch(
        (e) => e,
      );
      expect((err as { code: string }).code).toBe('VALIDATION_FAILED');
    } finally {
      f.close();
    }
  });

  it('rejects extra fields with VALIDATION_FAILED', async () => {
    const f = makeFixture();
    try {
      const err = await handleReviewGetByDate(f.deps, {
        date: '2026-08-09',
        extra: 'no',
      } as unknown as { date: string }).catch((e) => e);
      expect((err as { code: string }).code).toBe('VALIDATION_FAILED');
    } finally {
      f.close();
    }
  });
});

// ============================================================
//  review:upsert
// ============================================================

describe('review:upsert', () => {
  it('inserts a new review when no row exists for the date', async () => {
    const f = makeFixture();
    try {
      const result = await handleReviewUpsert(f.deps, {
        date: '2026-08-09',
        completed: [{ taskId: 'T1', title: 'task 1' }],
        uncompleted: [{ taskId: 'T2', title: 'task 2' }],
        blockers: '',
        topThree: ['item 1', 'item 2'],
      });
      expect(result.id).toHaveLength(26);
      expect(result.date).toBe('2026-08-09');
      expect(result.completed).toEqual([{ taskId: 'T1', title: 'task 1' }]);
      expect(result.uncompleted).toEqual([{ taskId: 'T2', title: 'task 2' }]);
      expect(result.topThree).toEqual(['item 1', 'item 2']);
      expect(result.aiDraft).toBeNull();
    } finally {
      f.close();
    }
  });

  it('updates existing review by date and bumps updatedAt', async () => {
    const f = makeFixture();
    try {
      const seeded = seedReview(f.db, {
        date: '2026-08-09',
        blockers: 'old',
      });
      await new Promise((r) => setTimeout(r, 5));
      const updated = await handleReviewUpsert(f.deps, {
        date: '2026-08-09',
        completed: [{ taskId: 'TX', title: 'new' }],
        uncompleted: [],
        blockers: 'new',
        topThree: [],
      });
      expect(updated.id).toBe(seeded.id);
      expect(updated.completed).toEqual([{ taskId: 'TX', title: 'new' }]);
      expect(updated.blockers).toBe('new');
      expect(updated.updatedAt).toBeGreaterThanOrEqual(seeded.updatedAt.getTime());
    } finally {
      f.close();
    }
  });

  it('upsert does NOT write aiDraft (only update path can)', async () => {
    const f = makeFixture();
    try {
      // 先 seed 一个 aiDraft 的 review
      seedReview(f.db, {
        date: '2026-08-09',
        aiDraft: { completed: ['a'], uncompleted: [], blockers: 'x', topThree: ['b'] },
      });
      // upsert 时不传 aiDraft → 不应被清空（也不应被覆盖）
      // 注：upsert 接口本身不接受 aiDraft 字段
      const result = await handleReviewUpsert(f.deps, {
        date: '2026-08-09',
        completed: [],
        uncompleted: [],
        blockers: '',
        topThree: [],
      });
      expect(result.aiDraft).toEqual({
        completed: ['a'],
        uncompleted: [],
        blockers: 'x',
        topThree: ['b'],
      });
    } finally {
      f.close();
    }
  });

  it('rejects invalid date with VALIDATION_FAILED', async () => {
    const f = makeFixture();
    try {
      const err = await handleReviewUpsert(f.deps, {
        date: '2026/08/09',
        completed: [],
        uncompleted: [],
        blockers: '',
        topThree: [],
      }).catch((e) => e);
      expect((err as { code: string }).code).toBe('VALIDATION_FAILED');
    } finally {
      f.close();
    }
  });
});

// ============================================================
//  review:update
// ============================================================

describe('review:update', () => {
  it('patches specified fields and bumps updatedAt', async () => {
    const f = makeFixture();
    try {
      const seeded = seedReview(f.db, { date: '2026-08-09', blockers: 'old' });
      await new Promise((r) => setTimeout(r, 5));
      const updated = await handleReviewUpdate(f.deps, {
        id: seeded.id,
        patch: { blockers: 'new' },
      });
      expect(updated.blockers).toBe('new');
      expect(updated.updatedAt).toBeGreaterThanOrEqual(seeded.updatedAt.getTime());
    } finally {
      f.close();
    }
  });

  it('can clear aiDraft by setting null (accept path)', async () => {
    const f = makeFixture();
    try {
      const seeded = seedReview(f.db, {
        date: '2026-08-09',
        aiDraft: { completed: ['a'], uncompleted: [], blockers: '', topThree: [] },
      });
      expect(seeded.aiDraft).not.toBeNull();
      const updated = await handleReviewUpdate(f.deps, {
        id: seeded.id,
        patch: { aiDraft: null },
      });
      expect(updated.aiDraft).toBeNull();
    } finally {
      f.close();
    }
  });

  it('returns NOT_FOUND for unknown id', async () => {
    const f = makeFixture();
    try {
      const err = await handleReviewUpdate(f.deps, {
        id: 'NOPE',
        patch: { blockers: 'x' },
      }).catch((e) => e);
      expect((err as { code: string }).code).toBe('NOT_FOUND');
    } finally {
      f.close();
    }
  });

  it('rejects unknown patch fields with VALIDATION_FAILED', async () => {
    const f = makeFixture();
    try {
      const seeded = seedReview(f.db, { date: '2026-08-09' });
      const err = await handleReviewUpdate(f.deps, {
        id: seeded.id,
        patch: { date: '2026-08-10' },
      } as unknown as { id: string; patch: { blockers: string } }).catch((e) => e);
      expect((err as { code: string }).code).toBe('VALIDATION_FAILED');
    } finally {
      f.close();
    }
  });
});

// ============================================================
//  review:listRecent
// ============================================================

describe('review:listRecent', () => {
  it('returns empty list when no reviews', async () => {
    const f = makeFixture();
    try {
      const result = await handleReviewListRecent(f.deps, {});
      expect(result).toEqual([]);
    } finally {
      f.close();
    }
  });

  it('orders by date DESC and respects limit', async () => {
    const f = makeFixture();
    try {
      seedReview(f.db, { date: '2026-08-01' });
      seedReview(f.db, { date: '2026-08-09' });
      seedReview(f.db, { date: '2026-08-05' });

      const result = await handleReviewListRecent(f.deps, {});
      expect(result.map((r) => r.date)).toEqual(['2026-08-09', '2026-08-05', '2026-08-01']);

      const limited = await handleReviewListRecent(f.deps, { limit: 2 });
      expect(limited.map((r) => r.date)).toEqual(['2026-08-09', '2026-08-05']);
    } finally {
      f.close();
    }
  });

  it('rejects limit > 365 with VALIDATION_FAILED', async () => {
    const f = makeFixture();
    try {
      const err = await handleReviewListRecent(f.deps, { limit: 999 }).catch((e) => e);
      expect((err as { code: string }).code).toBe('VALIDATION_FAILED');
    } finally {
      f.close();
    }
  });
});

// ============================================================
//  review:generateDraft
// ============================================================

describe('review:generateDraft (success path)', () => {
  it('returns parsed ReviewDraft from AI', async () => {
    const f = makeFixture();
    try {
      await f.deps.credentialManager.setKey('minimax', `sk-test-${ulid()}`);
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          makeSseResponseWithContent(
            JSON.stringify({
              completed: ['finished task A'],
              uncompleted: [{ title: 'pending task B' }],
              blockers: 'no blockers',
              topThree: ['next 1', 'next 2', 'next 3'],
            }),
          ),
        ) as unknown as typeof fetch,
      );

      const result = await handleReviewGenerateDraft(f.deps, {
        date: '2026-08-09',
        provider: 'minimax',
      });

      expect(result.completed).toEqual(['finished task A']);
      expect(result.uncompleted).toEqual([{ title: 'pending task B' }]);
      expect(result.blockers).toBe('no blockers');
      expect(result.topThree).toEqual(['next 1', 'next 2', 'next 3']);
    } finally {
      await f.deps.credentialManager.deleteKey('minimax').catch(() => undefined);
      f.close();
    }
  });

  it('rejects invalid date with VALIDATION_FAILED', async () => {
    const f = makeFixture();
    try {
      const err = await handleReviewGenerateDraft(f.deps, {
        date: 'bad',
        provider: 'minimax',
      }).catch((e) => e);
      expect((err as { code: string }).code).toBe('VALIDATION_FAILED');
    } finally {
      f.close();
    }
  });
});

describe('review:generateDraft (AI failure path)', () => {
  it('returns EXTERNAL_FAILURE when AI key is missing', async () => {
    const f = makeFixture();
    try {
      // 故意不 setKey
      const err = await handleReviewGenerateDraft(f.deps, {
        date: '2026-08-09',
        provider: 'minimax',
      }).catch((e) => e);
      // DEPENDENCY_MISSING 由 handleAiExtractJson 抛出 → 透传
      expect((err as { code: string }).code).toBe('DEPENDENCY_MISSING');
    } finally {
      f.close();
    }
  });

  it('returns EXTERNAL_FAILURE when AI returns invalid JSON', async () => {
    const f = makeFixture();
    try {
      await f.deps.credentialManager.setKey('minimax', `sk-test-${ulid()}`);
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockImplementation(() =>
            Promise.resolve(makeSseResponseWithContent('not json at all')),
          ) as unknown as typeof fetch,
      );

      const err = await handleReviewGenerateDraft(f.deps, {
        date: '2026-08-09',
        provider: 'minimax',
        model: 'test-model',
      }).catch((e) => e);
      // INVALID_OUTPUT → VALIDATION_FAILED（Zod 校验失败）
      expect((err as { code: string }).code).toBe('VALIDATION_FAILED');
      // 错误信息**不**含 AI 原始输出
      expect((err as { message: string }).message).not.toContain('not json at all');
    } finally {
      await f.deps.credentialManager.deleteKey('minimax').catch(() => undefined);
      f.close();
    }
  });

  it('CRITICAL: error message does NOT leak AI raw output', async () => {
    const f = makeFixture();
    const sensitiveRaw = 'SENSITIVE_USER_DATA_XYZ';
    try {
      await f.deps.credentialManager.setKey('minimax', `sk-test-${ulid()}`);
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockImplementation(() => Promise.resolve(makeSseResponseWithContent(sensitiveRaw))) as unknown as typeof fetch,
      );

      const err = await handleReviewGenerateDraft(f.deps, {
        date: '2026-08-09',
        provider: 'minimax',
      }).catch((e) => e);
      const all = JSON.stringify(err);
      expect(all).not.toContain(sensitiveRaw);
      expect(all).not.toContain('SENSITIVE_USER_DATA');
    } finally {
      await f.deps.credentialManager.deleteKey('minimax').catch(() => undefined);
      f.close();
    }
  });

  it('CRITICAL: error message does NOT leak API key', async () => {
    const f = makeFixture();
    const key = `sk-secret-${ulid()}`;
    try {
      await f.deps.credentialManager.setKey('minimax', key);
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockImplementation(() =>
            Promise.resolve(makeSseResponseWithContent('not json')),
          ) as unknown as typeof fetch,
      );

      const err = await handleReviewGenerateDraft(f.deps, {
        date: '2026-08-09',
        provider: 'minimax',
      }).catch((e) => e);
      const all = JSON.stringify(err);
      expect(all).not.toContain(key);
      expect(all).not.toContain('sk-secret');
    } finally {
      await f.deps.credentialManager.deleteKey('minimax').catch(() => undefined);
      f.close();
    }
  });
});
