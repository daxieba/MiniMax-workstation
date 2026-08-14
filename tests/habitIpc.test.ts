/**
 * Habit IPC handler 单元测试（v0.4.0）
 *
 * 直接调 `handleHabit*` 函数（绕开 ipcMain），喂临时 db，验证：
 *   - 8 个 handler 的成功路径
 *   - Zod 校验失败 → VALIDATION_FAILED
 *   - 不存在的 habit id → NOT_FOUND
 *   - toggleLog 互斥（一次加，一次删）
 *   - delete 级联删 logs
 *
 * 不依赖 Electron。
 */
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve as resolvePath } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeDb, createDbClient, type WorkstationDb } from '../db/client';
import {
  handleHabitArchive,
  handleHabitCreate,
  handleHabitDelete,
  handleHabitList,
  handleHabitListLogs,
  handleHabitLogsInRange,
  handleHabitToggleLog,
  handleHabitUpdate,
  type HabitIpcDeps,
} from '../electron/main/ipc/habit';

const TMP_ROOT = join(tmpdir(), 'minimax-workstation-habit-ipc-test');

beforeAll(() => {
  if (!existsSync(TMP_ROOT)) mkdirSync(TMP_ROOT, { recursive: true });
});
afterAll(() => {
  try { rmSync(TMP_ROOT, { recursive: true, force: true }); } catch { /* ignore */ }
});

interface Fixture { deps: HabitIpcDeps; db: WorkstationDb; close: () => void; }

function makeFixture(): Fixture {
  const dbPath = join(TMP_ROOT, `habit-ipc-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  const { db } = createDbClient(dbPath, resolvePath(__dirname, '..'));
  return { deps: { db }, db, close: () => closeDb(db) };
}

function unwrapOk<T>(p: Promise<T>): Promise<T> {
  // 错误：thrown 形如 {code, message, details}
  return p.then(
    (v) => v,
    (err: { code?: string; message?: string }) => {
      throw new Error(`unexpected: ${err.code ?? '?'} ${err.message ?? '?'}`);
    },
  );
}

describe('Habit IPC', () => {
  it('create / list', async () => {
    const f = makeFixture();
    try {
      const created = await unwrapOk(handleHabitCreate(f.deps, { name: '晨跑 30 分钟' }));
      expect(created.name).toBe('晨跑 30 分钟');
      expect(created.weeklyTarget).toBe(0);
      expect(created.archived).toBe(false);

      const list = await unwrapOk(handleHabitList(f.deps, { archived: false }));
      expect(list.find((h) => h.id === created.id)).toBeTruthy();
    } finally { f.close(); }
  });

  it('update patches fields', async () => {
    const f = makeFixture();
    try {
      const h = await unwrapOk(handleHabitCreate(f.deps, { name: '冥想' }));
      const updated = await unwrapOk(handleHabitUpdate(f.deps, { id: h.id, patch: { name: '冥想 10 分钟', weeklyTarget: 7 } }));
      expect(updated.name).toBe('冥想 10 分钟');
      expect(updated.weeklyTarget).toBe(7);
    } finally { f.close(); }
  });

  it('archive / unarchive', async () => {
    const f = makeFixture();
    try {
      const h = await unwrapOk(handleHabitCreate(f.deps, { name: 'A' }));
      const archived = await unwrapOk(handleHabitArchive(f.deps, { id: h.id, archived: true }));
      expect(archived.archived).toBe(true);
      const unarchived = await unwrapOk(handleHabitArchive(f.deps, { id: h.id, archived: false }));
      expect(unarchived.archived).toBe(false);
    } finally { f.close(); }
  });

  it('toggleLog: add then remove', async () => {
    const f = makeFixture();
    try {
      const h = await unwrapOk(handleHabitCreate(f.deps, { name: 'A' }));
      const today = '2026-08-14';
      const t1 = await unwrapOk(handleHabitToggleLog(f.deps, { habitId: h.id, date: today }));
      expect(t1.completed).toBe(true);
      const t2 = await unwrapOk(handleHabitToggleLog(f.deps, { habitId: h.id, date: today }));
      expect(t2.completed).toBe(false);
    } finally { f.close(); }
  });

  it('listLogs / logsInRange return matching rows', async () => {
    const f = makeFixture();
    try {
      const h = await unwrapOk(handleHabitCreate(f.deps, { name: 'A' }));
      await unwrapOk(handleHabitToggleLog(f.deps, { habitId: h.id, date: '2026-08-10' }));
      await unwrapOk(handleHabitToggleLog(f.deps, { habitId: h.id, date: '2026-08-12' }));
      const all = await unwrapOk(handleHabitListLogs(f.deps, { habitId: h.id }));
      expect(all).toHaveLength(2);
      const ranged = await unwrapOk(handleHabitLogsInRange(f.deps, { fromDate: '2026-08-11', toDate: '2026-08-13' }));
      expect(ranged).toHaveLength(1);
      expect(ranged[0]?.date).toBe('2026-08-12');
    } finally { f.close(); }
  });

  it('delete cascades to logs', async () => {
    const f = makeFixture();
    try {
      const h = await unwrapOk(handleHabitCreate(f.deps, { name: 'A' }));
      await unwrapOk(handleHabitToggleLog(f.deps, { habitId: h.id, date: '2026-08-10' }));
      await unwrapOk(handleHabitDelete(f.deps, { id: h.id }));
      const logs = await unwrapOk(handleHabitListLogs(f.deps, { habitId: h.id }));
      expect(logs).toHaveLength(0);
    } finally { f.close(); }
  });

  it('VALIDATION_FAILED on bad input', async () => {
    const f = makeFixture();
    try {
      // name 空 → 失败
      await expect(handleHabitCreate(f.deps, { name: '' })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
      // color 非法 hex → 失败
      await expect(
        handleHabitCreate(f.deps, { name: 'x', color: 'red' }),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
      // date 格式错
      const h = await unwrapOk(handleHabitCreate(f.deps, { name: 'A' }));
      await expect(
        handleHabitToggleLog(f.deps, { habitId: h.id, date: '2026/08/14' }),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    } finally { f.close(); }
  });

  it('NOT_FOUND on missing id', async () => {
    const f = makeFixture();
    try {
      await expect(
        handleHabitArchive(f.deps, { id: 'nonexistent' }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(
        handleHabitUpdate(f.deps, { id: 'nonexistent', patch: { name: 'x' } }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(
        handleHabitToggleLog(f.deps, { habitId: 'nonexistent', date: '2026-08-14' }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    } finally { f.close(); }
  });
});
