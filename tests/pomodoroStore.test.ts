/**
 * pomodoroStore 测试（v0.1.3）
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { act } from '@testing-library/react';

import { usePomodoroStore } from '@/store/pomodoroStore';

describe('pomodoroStore', () => {
  beforeEach(() => {
    localStorage.clear();
    usePomodoroStore.setState({
      status: 'idle',
      mode: 'focus',
      totalMs: 25 * 60_000,
      remainingMs: 25 * 60_000,
      todayCount: 0,
      todayDate: '2024-01-01',
      settings: { focusMin: 25, shortBreakMin: 5, longBreakMin: 15, longBreakEvery: 4 },
      focusStreak: 0,
      linkedTaskId: null,
      linkedTaskTitle: null,
    });
  });

  it('初始状态：idle / mode=focus / 25min', () => {
    const s = usePomodoroStore.getState();
    expect(s.status).toBe('idle');
    expect(s.mode).toBe('focus');
    expect(s.totalMs).toBe(25 * 60_000);
  });

  it('start → running', () => {
    act(() => {
      usePomodoroStore.getState().start();
    });
    expect(usePomodoroStore.getState().status).toBe('running');
  });

  it('pause / resume', () => {
    act(() => {
      usePomodoroStore.getState().start();
    });
    act(() => {
      usePomodoroStore.getState().pause();
    });
    expect(usePomodoroStore.getState().status).toBe('paused');
    act(() => {
      usePomodoroStore.getState().resume();
    });
    expect(usePomodoroStore.getState().status).toBe('running');
  });

  it('reset 把 remaining 重置为 total', () => {
    act(() => {
      usePomodoroStore.getState().start();
    });
    // 模拟时间过去
    usePomodoroStore.setState({ remainingMs: 1000 });
    act(() => {
      usePomodoroStore.getState().reset();
    });
    const s = usePomodoroStore.getState();
    expect(s.remainingMs).toBe(s.totalMs);
    expect(s.status).toBe('idle');
  });

  it('tick 减 1s', () => {
    act(() => {
      usePomodoroStore.getState().start();
    });
    const before = usePomodoroStore.getState().remainingMs;
    act(() => {
      usePomodoroStore.getState().tick();
    });
    expect(usePomodoroStore.getState().remainingMs).toBe(before - 1000);
  });

  it('tick 归零时自动切到 shortBreak + todayCount +1', () => {
    act(() => {
      usePomodoroStore.getState().start();
    });
    usePomodoroStore.setState({ remainingMs: 1000 });
    act(() => {
      usePomodoroStore.getState().tick();
    });
    const s = usePomodoroStore.getState();
    expect(s.mode).toBe('shortBreak');
    expect(s.todayCount).toBe(1);
    expect(s.focusStreak).toBe(1);
    expect(s.status).toBe('idle');
  });

  it('第 4 个 focus 完成后切到 longBreak', () => {
    act(() => {
      usePomodoroStore.getState().start();
    });
    // 跑 3 个 focus + shortBreak 循环，再跑 1 个 focus
    for (let i = 0; i < 4; i++) {
      usePomodoroStore.setState({ remainingMs: 1000, status: 'running', mode: 'focus' });
      act(() => {
        usePomodoroStore.getState().tick();
      });
    }
    const s = usePomodoroStore.getState();
    expect(s.mode).toBe('longBreak');
    expect(s.todayCount).toBe(4);
    expect(s.focusStreak).toBe(4);
  });

  it('updateSettings 修改配置', () => {
    act(() => {
      usePomodoroStore.getState().updateSettings({ focusMin: 50 });
    });
    expect(usePomodoroStore.getState().settings.focusMin).toBe(50);
    expect(usePomodoroStore.getState().totalMs).toBe(50 * 60_000);
  });

  it('setLinkedTask 关联任务', () => {
    act(() => {
      usePomodoroStore.getState().setLinkedTask('tk-1', '写完 v0.1.3');
    });
    const s = usePomodoroStore.getState();
    expect(s.linkedTaskId).toBe('tk-1');
    expect(s.linkedTaskTitle).toBe('写完 v0.1.3');
  });

  it('skip 切到下一个 mode（focus → shortBreak）', () => {
    act(() => {
      usePomodoroStore.getState().skip();
    });
    const s = usePomodoroStore.getState();
    expect(s.mode).toBe('shortBreak');
    expect(s.status).toBe('idle');
  });

  it('持久化：updateSettings 后 localStorage 有数据', () => {
    act(() => {
      usePomodoroStore.getState().updateSettings({ focusMin: 30 });
    });
    const raw = localStorage.getItem('minimax.workstation.pomodoro');
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    expect(parsed.settings.focusMin).toBe(30);
  });
});
