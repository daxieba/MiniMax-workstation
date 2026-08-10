/**
 * Task 状态机单元测试（T2-1）
 *
 * 覆盖（PROJECT_IDENTITY.md §8.2 状态机测试要求）：
 *   - 所有合法流转：每一对 `(from, to)` 在 `ALLOWED_TRANSITIONS` 中都能成功
 *   - 所有非法流转：包括显式非法的 `(from, to)` + 边界（identity、未知状态）
 *   - 完整性检查：每个 `TaskStatus` 至少有一个合法 next；`ALLOWED_TRANSITIONS` 自身合法
 *   - `transition()` 抛 `InvalidTaskTransitionError`，且错误带 `from` / `to` 字段
 *   - `canTransition()` 是纯函数（多次调用结果一致）
 *   - `TaskStatusSchema` (Zod) 接受 4 个合法值、拒绝其他
 *
 * **不依赖 db** —— 此测试可纯 Node 跑，不需要 better-sqlite3 / Drizzle。
 *
 * @see shared/types/taskStatus.ts
 */

import { describe, expect, it } from 'vitest';

import {
  ALLOWED_TRANSITIONS,
  InvalidTaskTransitionError,
  TASK_STATUSES,
  TaskStatusSchema,
  canTransition,
  transition,
  type TaskStatus,
} from '../shared/types/taskStatus';

/** 把状态机的"所有合法对"和"所有非法对"都枚举出来。 */
const ALL_STATUSES: readonly TaskStatus[] = TASK_STATUSES;

describe('TaskStatusSchema (Zod)', () => {
  it('accepts all 4 valid statuses', () => {
    for (const s of ALL_STATUSES) {
      const parsed = TaskStatusSchema.safeParse(s);
      expect(parsed.success).toBe(true);
    }
  });

  it('rejects unknown statuses', () => {
    for (const bad of ['pending', 'TODO', '', 'unknown', 'in_progress', null, undefined, 0, {}]) {
      const parsed = TaskStatusSchema.safeParse(bad);
      expect(parsed.success).toBe(false);
    }
  });
});

describe('ALLOWED_TRANSITIONS (integrity)', () => {
  it('covers every TaskStatus as a key', () => {
    for (const s of ALL_STATUSES) {
      expect(ALLOWED_TRANSITIONS).toHaveProperty(s);
      expect(Array.isArray(ALLOWED_TRANSITIONS[s])).toBe(true);
    }
  });

  it('every allowed target is a valid TaskStatus', () => {
    for (const from of ALL_STATUSES) {
      for (const to of ALLOWED_TRANSITIONS[from]) {
        expect(ALL_STATUSES).toContain(to);
      }
    }
  });

  it('every status has at least one valid next (no dead-end graph)', () => {
    for (const s of ALL_STATUSES) {
      expect(ALLOWED_TRANSITIONS[s].length).toBeGreaterThan(0);
    }
  });

  it('all 4 statuses are reachable from `todo` (graph is connected)', () => {
    // BFS from todo
    const seen = new Set<TaskStatus>(['todo']);
    const queue: TaskStatus[] = ['todo'];
    while (queue.length > 0) {
      const cur = queue.shift();
      if (cur === undefined) break;
      for (const next of ALLOWED_TRANSITIONS[cur]) {
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    expect(seen.size).toBe(ALL_STATUSES.length);
  });
});

describe('canTransition (pure function)', () => {
  // ===== 合法流转：穷举所有 (from, to) ∈ ALLOWED_TRANSITIONS =====
  describe('legal transitions (positive)', () => {
    const cases: Array<[TaskStatus, TaskStatus]> = [];
    for (const from of ALL_STATUSES) {
      for (const to of ALLOWED_TRANSITIONS[from]) {
        cases.push([from, to]);
      }
    }
    it.each(cases)('canTransition(%s, %s) === true', (from, to) => {
      expect(canTransition(from, to)).toBe(true);
    });
  });

  // ===== 非法流转：穷举所有 (from, to) ∉ ALLOWED_TRANSITIONS（不含 identity） =====
  describe('illegal transitions (negative)', () => {
    const cases: Array<[TaskStatus, TaskStatus]> = [];
    for (const from of ALL_STATUSES) {
      for (const to of ALL_STATUSES) {
        if (from === to) continue;
        if (ALLOWED_TRANSITIONS[from].includes(to)) continue;
        cases.push([from, to]);
      }
    }
    it.each(cases)('canTransition(%s, %s) === false', (from, to) => {
      expect(canTransition(from, to)).toBe(false);
    });
  });

  // ===== 边界 =====
  describe('boundary cases', () => {
    it.each(ALL_STATUSES)('identity transition canTransition(%s, %s) === false (not a "transition")', (s) => {
      expect(canTransition(s, s)).toBe(false);
    });

    it('unknown from returns false (runtime safety net)', () => {
      // 编译期 type guard 已挡，但 DB 里 text 列可能脏数据
      expect(canTransition('not_a_status' as TaskStatus, 'todo')).toBe(false);
    });

    it('unknown to returns false (runtime safety net)', () => {
      expect(canTransition('todo', 'pending' as TaskStatus)).toBe(false);
    });

    it('both unknown returns false', () => {
      expect(canTransition('x' as TaskStatus, 'y' as TaskStatus)).toBe(false);
    });
  });

  it('is pure: same input → same output, no side effects', () => {
    expect(canTransition('todo', 'doing')).toBe(true);
    expect(canTransition('todo', 'doing')).toBe(true);
    expect(canTransition('todo', 'done')).toBe(false);
    expect(canTransition('todo', 'done')).toBe(false);
  });
});

describe('transition (throws on illegal)', () => {
  // ===== 合法流转返回 to =====
  describe('legal transitions return target', () => {
    const cases: Array<[TaskStatus, TaskStatus]> = [];
    for (const from of ALL_STATUSES) {
      for (const to of ALLOWED_TRANSITIONS[from]) {
        cases.push([from, to]);
      }
    }
    it.each(cases)('transition(%s, %s) === %s', (from, to) => {
      expect(transition(from, to)).toBe(to);
    });
  });

  // ===== 关键验收点 =====
  it('AC: transition(todo, doing) returns "doing"', () => {
    expect(transition('todo', 'doing')).toBe('doing');
  });

  it('AC: transition(todo, done) throws (illegal skip doing)', () => {
    expect(() => transition('todo', 'done')).toThrow(InvalidTaskTransitionError);
  });

  // ===== 所有非法抛错 =====
  describe('illegal transitions throw', () => {
    const cases: Array<[TaskStatus, TaskStatus]> = [];
    for (const from of ALL_STATUSES) {
      for (const to of ALL_STATUSES) {
        if (from === to) continue;
        if (ALLOWED_TRANSITIONS[from].includes(to)) continue;
        cases.push([from, to]);
      }
    }
    it.each(cases)('transition(%s, %s) throws', (from, to) => {
      expect(() => transition(from, to)).toThrow(InvalidTaskTransitionError);
    });
  });

  // ===== 边界 =====
  describe('boundary throws', () => {
    it.each(ALL_STATUSES)('identity transition(%s, %s) throws', (s) => {
      expect(() => transition(s, s)).toThrow(InvalidTaskTransitionError);
    });

    it('unknown from throws', () => {
      expect(() => transition('not_a_status' as TaskStatus, 'todo')).toThrow(InvalidTaskTransitionError);
    });

    it('unknown to throws', () => {
      expect(() => transition('todo', 'pending' as TaskStatus)).toThrow(InvalidTaskTransitionError);
    });
  });
});

describe('InvalidTaskTransitionError', () => {
  it('carries from / to fields on the instance', () => {
    try {
      transition('todo', 'done');
      // 不应到达这里
      expect.fail('expected transition to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidTaskTransitionError);
      const e = err as InvalidTaskTransitionError;
      expect(e.from).toBe('todo');
      expect(e.to).toBe('done');
      expect(e.message).toContain('todo');
      expect(e.message).toContain('done');
      expect(e.name).toBe('InvalidTaskTransitionError');
    }
  });

  it('is an Error subclass', () => {
    const err = new InvalidTaskTransitionError('doing', 'archived');
    expect(err).toBeInstanceOf(Error);
    expect(err.from).toBe('doing');
    expect(err.to).toBe('archived');
  });
});
