/**
 * settingsStore v0.4.0 新增测试。
 *
 * 覆盖：
 *   - DEFAULT prefs 包含 3 个新字段（defaultTaskPriority / defaultTaskStatus / defaultDueOffsetDays）
 *   - updatePref 能写入新字段
 *   - 解析 fallback：未知值回退到 default
 *
 * 跑在 jsdom（不需要 Electron），mock window.api.app.getAppMeta / setAppMeta。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSettingsStore } from '@/store/settingsStore';

interface MockApi {
  app: {
    getAppMeta: ReturnType<typeof vi.fn>;
    setAppMeta: ReturnType<typeof vi.fn>;
    getSettings: ReturnType<typeof vi.fn>;
  };
}

function installMockApi(): MockApi {
  const api: MockApi = {
    app: {
      getAppMeta: vi.fn().mockImplementation(async (key: string) => ({
        ok: true,
        data: { key, value: null },
      })),
      setAppMeta: vi.fn().mockImplementation(async (key: string, value: string) => ({
        ok: true,
        data: { key, value },
      })),
      getSettings: vi.fn().mockResolvedValue({
        ok: true,
        data: { autoBackupIntervalMin: 30, lastAutoBackupAt: null, lastRestoreAt: null },
      }),
    },
  };
  (window as unknown as { api: MockApi }).api = api;
  return api;
}

describe('settingsStore v0.4.0', () => {
  beforeEach(() => {
    localStorage.clear();
    installMockApi();
  });

  it('default prefs include 3 new task default fields', () => {
    const prefs = useSettingsStore.getState().prefs;
    expect(prefs.defaultTaskPriority).toBe('medium');
    expect(prefs.defaultTaskStatus).toBe('todo');
    expect(prefs.defaultDueOffsetDays).toBe(0);
  });

  it('updatePref writes defaultTaskPriority and updates store', async () => {
    const api = (window as unknown as { api: MockApi }).api;
    await useSettingsStore.getState().updatePref('defaultTaskPriority', 'high');
    const prefs = useSettingsStore.getState().prefs;
    expect(prefs.defaultTaskPriority).toBe('high');
    expect(api.app.setAppMeta).toHaveBeenCalledWith('prefs.task.defaultPriority', 'high');
  });

  it('updatePref writes defaultTaskStatus and updates store', async () => {
    await useSettingsStore.getState().updatePref('defaultTaskStatus', 'doing');
    const prefs = useSettingsStore.getState().prefs;
    expect(prefs.defaultTaskStatus).toBe('doing');
  });

  it('updatePref clamps defaultDueOffsetDays to [0, 30]', async () => {
    await useSettingsStore.getState().updatePref('defaultDueOffsetDays', 14);
    expect(useSettingsStore.getState().prefs.defaultDueOffsetDays).toBe(14);
    // 超出 max 30 → 30
    await useSettingsStore.getState().updatePref('defaultDueOffsetDays', 100);
    expect(useSettingsStore.getState().prefs.defaultDueOffsetDays).toBe(30);
    // 低于 min 0 → 0
    await useSettingsStore.getState().updatePref('defaultDueOffsetDays', -5);
    expect(useSettingsStore.getState().prefs.defaultDueOffsetDays).toBe(0);
  });

  it('parsePrefs falls back to default for unknown enum values', async () => {
    // 模拟 getAppMeta 返回 invalid value
    const api = (window as unknown as { api: MockApi }).api;
    api.app.getAppMeta.mockImplementation(async (key: string) => {
      if (key === 'prefs.task.defaultPriority') {
        return { ok: true, data: { key, value: 'invalid_priority' } };
      }
      return { ok: true, data: { key, value: null } };
    });
    await useSettingsStore.getState().load();
    expect(useSettingsStore.getState().prefs.defaultTaskPriority).toBe('medium'); // fallback
  });
});
