/**
 * ReviewDraftSchema Zod 边界测试（T5-1）
 *
 * 覆盖 `shared/schemas/ai.ts` 的 `ReviewDraftSchema`：
 *   - 合法对象通过
 *   - `completed` / `topThree` 字符串 max 4096
 *   - `completed` / `topThree` / `uncompleted` 数组 max 100 长度
 *   - `uncompleted.reason` max 1024
 *   - 字符串必填（min 1）
 *   - `.strict()` 拒绝额外字段
 *   - `ReviewDraft` 也覆盖（IPCDTO 校验）
 *   - 日期正则 `^\d{4}-\d{2}-\d{2}$`
 *
 * @see shared/schemas/ai.ts
 * @see shared/schemas/review.ts
 */

import { describe, expect, it } from 'vitest';

import { ReviewDraftSchema } from '../shared/schemas/ai';
import {
  ReviewGenerateDraftResponseSchema,
  ReviewSchema,
  ReviewUpdateInputSchema,
  ReviewUpsertInputSchema,
} from '../shared/schemas/review';

// ============================================================
//  合法对象
// ============================================================

describe('ReviewDraftSchema (valid objects)', () => {
  it('accepts a minimal valid draft', () => {
    const r = ReviewDraftSchema.safeParse({
      completed: ['x'],
      uncompleted: [],
      blockers: 'none',
      topThree: ['a'],
    });
    expect(r.success).toBe(true);
  });

  it('accepts full draft with reasons', () => {
    const r = ReviewDraftSchema.safeParse({
      completed: ['A', 'B', 'C'],
      uncompleted: [
        { title: 'X', reason: 'blocked' },
        { title: 'Y' },
      ],
      blockers: 'long blocker text',
      topThree: ['1', '2', '3'],
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.uncompleted[0]?.reason).toBe('blocked');
    }
  });

  it('accepts empty completed and topThree arrays', () => {
    const r = ReviewDraftSchema.safeParse({
      completed: [],
      uncompleted: [],
      blockers: '',
      topThree: [],
    });
    expect(r.success).toBe(true);
  });
});

// ============================================================
//  字符串长度边界
// ============================================================

describe('ReviewDraftSchema (string length boundaries)', () => {
  it('rejects string > 4096 in completed', () => {
    const r = ReviewDraftSchema.safeParse({
      completed: ['x'.repeat(4097)],
      uncompleted: [],
      blockers: '',
      topThree: [],
    });
    expect(r.success).toBe(false);
  });

  it('rejects string > 4096 in topThree', () => {
    const r = ReviewDraftSchema.safeParse({
      completed: [],
      uncompleted: [],
      blockers: '',
      topThree: ['x'.repeat(4097)],
    });
    expect(r.success).toBe(false);
  });

  it('rejects blockers > 4096', () => {
    const r = ReviewDraftSchema.safeParse({
      completed: [],
      uncompleted: [],
      blockers: 'x'.repeat(4097),
      topThree: [],
    });
    expect(r.success).toBe(false);
  });

  it('rejects uncompleted.title > 4096', () => {
    const r = ReviewDraftSchema.safeParse({
      completed: [],
      uncompleted: [{ title: 'x'.repeat(4097) }],
      blockers: '',
      topThree: [],
    });
    expect(r.success).toBe(false);
  });

  it('rejects uncompleted.reason > 1024', () => {
    const r = ReviewDraftSchema.safeParse({
      completed: [],
      uncompleted: [{ title: 'x', reason: 'x'.repeat(1025) }],
      blockers: '',
      topThree: [],
    });
    expect(r.success).toBe(false);
  });

  it('accepts string at exactly 4096', () => {
    const r = ReviewDraftSchema.safeParse({
      completed: ['x'.repeat(4096)],
      uncompleted: [],
      blockers: '',
      topThree: [],
    });
    expect(r.success).toBe(true);
  });
});

// ============================================================
//  数组长度边界
// ============================================================

describe('ReviewDraftSchema (array length boundaries)', () => {
  it('rejects completed > 100 items', () => {
    const items = Array.from({ length: 101 }, (_, i) => `item_${i}`);
    const r = ReviewDraftSchema.safeParse({
      completed: items,
      uncompleted: [],
      blockers: '',
      topThree: [],
    });
    expect(r.success).toBe(false);
  });

  it('rejects uncompleted > 100 items', () => {
    const items = Array.from({ length: 101 }, (_, i) => ({ title: `t_${i}` }));
    const r = ReviewDraftSchema.safeParse({
      completed: [],
      uncompleted: items,
      blockers: '',
      topThree: [],
    });
    expect(r.success).toBe(false);
  });

  it('rejects topThree > 100 items', () => {
    const items = Array.from({ length: 101 }, (_, i) => `t_${i}`);
    const r = ReviewDraftSchema.safeParse({
      completed: [],
      uncompleted: [],
      blockers: '',
      topThree: items,
    });
    expect(r.success).toBe(false);
  });

  it('accepts arrays at exactly 100 items', () => {
    const items = Array.from({ length: 100 }, (_, i) => `t_${i}`);
    const r = ReviewDraftSchema.safeParse({
      completed: items,
      uncompleted: [],
      blockers: '',
      topThree: items,
    });
    expect(r.success).toBe(true);
  });
});

// ============================================================
//  额外字段拒绝
// ============================================================

describe('ReviewDraftSchema (strict mode rejects extras)', () => {
  it('rejects extra field on top-level', () => {
    const r = ReviewDraftSchema.safeParse({
      completed: [],
      uncompleted: [],
      blockers: '',
      topThree: [],
      extra: 'no',
    });
    expect(r.success).toBe(false);
  });

  it('rejects extra field on uncompleted item', () => {
    const r = ReviewDraftSchema.safeParse({
      completed: [],
      uncompleted: [{ title: 'x', extra: 'no' }],
      blockers: '',
      topThree: [],
    });
    expect(r.success).toBe(false);
  });

  it('rejects unknown top-level field (apiKey / key / etc.)', () => {
    const r = ReviewDraftSchema.safeParse({
      completed: [],
      uncompleted: [],
      blockers: '',
      topThree: [],
      apiKey: 'sk-secret',
    });
    expect(r.success).toBe(false);
  });
});

// ============================================================
//  必填 / 缺失字段
// ============================================================

describe('ReviewDraftSchema (required fields)', () => {
  it('rejects missing blockers', () => {
    const r = ReviewDraftSchema.safeParse({
      completed: [],
      uncompleted: [],
      topThree: [],
    });
    expect(r.success).toBe(false);
  });

  it('rejects empty string in completed (min 1)', () => {
    const r = ReviewDraftSchema.safeParse({
      completed: [''],
      uncompleted: [],
      blockers: '',
      topThree: [],
    });
    expect(r.success).toBe(false);
  });

  it('rejects empty title in uncompleted (min 1)', () => {
    const r = ReviewDraftSchema.safeParse({
      completed: [],
      uncompleted: [{ title: '' }],
      blockers: '',
      topThree: [],
    });
    expect(r.success).toBe(false);
  });
});

// ============================================================
//  Review 整行 + IPC schema
// ============================================================

describe('ReviewSchema (date YYYY-MM-DD regex)', () => {
  it('rejects invalid date format', () => {
    const r = ReviewSchema.safeParse({
      id: 'X',
      date: '2026/08/09',
      completed: [],
      uncompleted: [],
      blockers: '',
      topThree: [],
      aiDraft: null,
      createdAt: 0,
      updatedAt: 0,
    });
    expect(r.success).toBe(false);
  });

  it('rejects short date string', () => {
    const r = ReviewSchema.safeParse({
      id: 'X',
      date: '2026-8-9',
      completed: [],
      uncompleted: [],
      blockers: '',
      topThree: [],
      aiDraft: null,
      createdAt: 0,
      updatedAt: 0,
    });
    expect(r.success).toBe(false);
  });

  it('accepts valid YYYY-MM-DD', () => {
    const r = ReviewSchema.safeParse({
      id: 'X',
      date: '2026-08-09',
      completed: [],
      uncompleted: [],
      blockers: '',
      topThree: [],
      aiDraft: null,
      createdAt: 0,
      updatedAt: 0,
    });
    expect(r.success).toBe(true);
  });
});

describe('ReviewUpsertInputSchema (rejects aiDraft / id / createdAt / updatedAt)', () => {
  it('rejects extra aiDraft field', () => {
    const r = ReviewUpsertInputSchema.safeParse({
      date: '2026-08-09',
      completed: [],
      uncompleted: [],
      blockers: '',
      topThree: [],
      aiDraft: { completed: [], uncompleted: [], blockers: '', topThree: [] },
    });
    expect(r.success).toBe(false);
  });

  it('rejects extra id field', () => {
    const r = ReviewUpsertInputSchema.safeParse({
      id: 'NOPE',
      date: '2026-08-09',
      completed: [],
      uncompleted: [],
      blockers: '',
      topThree: [],
    });
    expect(r.success).toBe(false);
  });
});

describe('ReviewUpdateInputSchema (rejects date, accepts aiDraft: null)', () => {
  it('rejects date field in patch', () => {
    const r = ReviewUpdateInputSchema.safeParse({
      id: 'X',
      patch: { date: '2026-08-10' },
    });
    expect(r.success).toBe(false);
  });

  it('accepts aiDraft: null in patch', () => {
    const r = ReviewUpdateInputSchema.safeParse({
      id: 'X',
      patch: { aiDraft: null },
    });
    expect(r.success).toBe(true);
  });
});

describe('ReviewGenerateDraftResponseSchema (review_draft shape)', () => {
  it('accepts a valid draft', () => {
    const r = ReviewGenerateDraftResponseSchema.safeParse({
      completed: ['a'],
      uncompleted: [{ title: 'b' }],
      blockers: '',
      topThree: ['c'],
    });
    expect(r.success).toBe(true);
  });
});
