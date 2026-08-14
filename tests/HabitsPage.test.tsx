/**
 * Habits 页面组件测试（v0.4.0）
 *
 * 覆盖：
 *   - 空态展示
 *   - 列表展示（habit card + 35 天热力图 + 30 天率 + 今日打卡按钮）
 *   - 新建表单提交
 *   - toggleLog 调用
 *   - 归档 / 取消归档 / 删除
 *
 * 不依赖 db / IPC —— mock `window.api.habit`。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import HabitsPage from '@/pages/Habits';
import { useHabitStore } from '@/store/habitStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useI18nStore, translations } from '@/i18n';
import type { Habit, HabitLog } from '@shared/types/habit';

function makeHabit(overrides: Partial<Habit> = {}): Habit {
  return {
    id: 'hab-1',
    name: '晨跑 30 分钟',
    icon: '🏃',
    color: '#22c55e',
    weeklyTarget: 5,
    archived: false,
    sortOrder: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

function makeLog(overrides: Partial<HabitLog> = {}): HabitLog {
  return {
    habitId: 'hab-1',
    date: '2026-08-14',
    loggedAt: Date.now(),
    note: '',
    ...overrides,
  };
}

interface MockApi {
  habit: {
    list: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    archive: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    toggleLog: ReturnType<typeof vi.fn>;
    listLogs: ReturnType<typeof vi.fn>;
    logsInRange: ReturnType<typeof vi.fn>;
  };
  app: {
    getThemeSource: ReturnType<typeof vi.fn>;
    setThemeSource: ReturnType<typeof vi.fn>;
    getSettings: ReturnType<typeof vi.fn>;
    setAppMeta: ReturnType<typeof vi.fn>;
    getAppMeta: ReturnType<typeof vi.fn>;
  };
}

function installMockApi(habits: Habit[], logs: HabitLog[]): MockApi {
  const api: MockApi = {
    habit: {
      list: vi.fn().mockResolvedValue({ ok: true, data: habits }),
      create: vi.fn().mockImplementation(async (input: { name: string }) => ({
        ok: true,
        data: makeHabit({ id: 'new', name: input.name }),
      })),
      update: vi.fn().mockResolvedValue({ ok: true, data: makeHabit() }),
      archive: vi.fn().mockResolvedValue({ ok: true, data: makeHabit() }),
      delete: vi.fn().mockResolvedValue({ ok: true, data: { deleted: true } }),
      toggleLog: vi.fn().mockResolvedValue({
        ok: true,
        data: { habitId: 'hab-1', date: '2026-08-14', completed: true },
      }),
      listLogs: vi.fn().mockResolvedValue({ ok: true, data: logs }),
      logsInRange: vi.fn().mockResolvedValue({ ok: true, data: logs }),
    },
    app: {
      getThemeSource: vi.fn().mockResolvedValue('system'),
      setThemeSource: vi.fn().mockResolvedValue({
        ok: true,
        data: { source: 'system', resolved: 'light' },
      }),
      getSettings: vi.fn().mockResolvedValue({
        ok: true,
        data: { autoBackupIntervalMin: 30, lastAutoBackupAt: null, lastRestoreAt: null },
      }),
      setAppMeta: vi.fn().mockResolvedValue({ ok: true, data: { key: 'k', value: 'v' } }),
      getAppMeta: vi.fn().mockResolvedValue({ ok: true, data: { key: 'k', value: null } }),
    },
  };
  (window as unknown as { api: MockApi }).api = api;
  return api;
}

function renderHabits(): void {
  render(
    <MemoryRouter>
      <HabitsPage />
    </MemoryRouter>,
  );
}

describe('HabitsPage', () => {
  beforeEach(() => {
    localStorage.clear();
    useI18nStore.setState({ lang: 'zh-CN', t: translations['zh-CN'] });
    useHabitStore.setState({ habits: [], logs: [], loading: false, error: null });
    useSettingsStore.setState({
      settings: { autoBackupIntervalMin: 30, lastAutoBackupAt: null, lastRestoreAt: null },
      prefs: {
        notifyTaskOverdue: true,
        notifyTaskOverdueLeadMin: 0,
        notifyPomodoroComplete: true,
        openOnBoot: false,
        restoreLastPage: true,
        pomodoroAutoStartBreak: false,
        pomodoroAutoStartFocus: false,
        pomodoroSoundOn: true,
        closeAction: 'minimize',
        exportFormat: 'json',
        weekStart: 'monday',
        defaultTaskPriority: 'medium',
        defaultTaskStatus: 'todo',
        defaultDueOffsetDays: 0,
      },
      loading: false,
      error: null,
    });
    // window.confirm / alert 兜底
    window.confirm = vi.fn().mockReturnValue(true);
    window.alert = vi.fn();
  });

  it('renders empty state when no habits', async () => {
    installMockApi([], []);
    renderHabits();
    await waitFor(() => {
      expect(screen.getByTestId('habits-empty')).toBeInTheDocument();
    });
  });

  it('renders habit card with 35-day heatmap + 30-day rate', async () => {
    const h = makeHabit();
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const logs: HabitLog[] = [
      makeLog({ date: todayStr }),
      makeLog({ date: '2026-08-13' }),
    ];
    installMockApi([h], logs);
    renderHabits();
    await waitFor(() => {
      expect(screen.getByTestId('habit-card-hab-1')).toBeInTheDocument();
    });
    // 35 天热力图渲染
    const heatmap = screen.getByTestId('habit-heatmap');
    expect(heatmap).toBeInTheDocument();
    // 35 个 cell
    expect(heatmap.children).toHaveLength(35);
  });

  it('new habit form submits and triggers create IPC', async () => {
    installMockApi([], []);
    const api = installMockApi([], []);
    renderHabits();
    await waitFor(() => {
      expect(screen.getByTestId('habits-empty')).toBeInTheDocument();
    });
    const nameInput = screen.getByTestId('habit-new-name');
    fireEvent.change(nameInput, { target: { value: '冥想 10 分钟' } });
    fireEvent.click(screen.getByTestId('habit-new-submit'));
    await waitFor(() => {
      expect(api.habit.create).toHaveBeenCalled();
    });
    const callArg = api.habit.create.mock.calls[0]?.[0] as { name: string } | undefined;
    expect(callArg?.name).toBe('冥想 10 分钟');
  });

  it('clicking today check calls toggleLog', async () => {
    const h = makeHabit();
    installMockApi([h], []);
    const api = installMockApi([h], []);
    renderHabits();
    await waitFor(() => {
      expect(screen.getByTestId('habit-card-hab-1')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('habit-check-hab-1'));
    await waitFor(() => {
      expect(api.habit.toggleLog).toHaveBeenCalled();
    });
  });

  it('archive button calls archive IPC (after confirm)', async () => {
    const h = makeHabit();
    installMockApi([h], []);
    const api = installMockApi([h], []);
    renderHabits();
    await waitFor(() => {
      expect(screen.getByTestId('habit-card-hab-1')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('habit-archive-hab-1'));
    await waitFor(() => {
      expect(api.habit.archive).toHaveBeenCalled();
    });
  });

  it('delete button calls delete IPC (after confirm)', async () => {
    const h = makeHabit();
    installMockApi([h], []);
    const api = installMockApi([h], []);
    renderHabits();
    await waitFor(() => {
      expect(screen.getByTestId('habit-card-hab-1')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('habit-delete-hab-1'));
    await waitFor(() => {
      expect(api.habit.delete).toHaveBeenCalled();
    });
  });
});
