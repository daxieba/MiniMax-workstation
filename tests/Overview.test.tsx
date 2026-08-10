/**
 * 总览页（Overview）UI 测试（T2-4）
 *
 * 覆盖（任务卡验收）：
 *   - 加载态渲染
 *   - 4 个卡片都有空态文案
 *   - 4 个卡片都有数据时正确显示
 *   - 快速输入提交触发 inboxStore.add
 *   - 逾期任务红色角标
 *   - 今日任务按 priority + dueDate 排序
 *
 * **store 模拟策略**：
 *   测试环境 `window.api` 为 undefined，store.load() 会清空状态。
 *   为让 setup 阶段 setState 注入的数据不被 effect 重置，
 *   用 `useStore.setState({ load: vi.fn(), add: vi.fn(), ... })`
 *   替换 `load` / `add` 等动作为 no-op / spy，保留 `items` / `tasks` / `projects`。
 *   这样页面的 useEffect 调的是 vi.fn，状态被原样保留。
 */

import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import OverviewPage from '@/pages/Overview';
import { useInboxStore } from '@/store/inboxStore';
import { useTaskStore } from '@/store/taskStore';
import { useProjectStore } from '@/store/projectStore';
import { __resetToastCounterForTest, useToastStore } from '@/store/toastStore';

import type { InboxItem } from '@shared/types/inbox';
import type { Project } from '@shared/types/project';
import type { Task } from '@shared/types/task';

// ====== 工厂函数 ======

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'T_' + Math.random().toString(36).slice(2, 8),
    title: 'Task',
    description: null,
    status: 'todo',
    priority: 'medium',
    dueDate: null,
    projectId: null,
    tags: [],
    source: 'manual',
    inboxId: null,
    noteIds: [],
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    completedAt: null,
    ...overrides,
  };
}

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'P_' + Math.random().toString(36).slice(2, 8),
    name: 'Project',
    description: null,
    color: null,
    archived: false,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    ...overrides,
  };
}

function makeInbox(overrides: Partial<InboxItem> = {}): InboxItem {
  return {
    id: 'I_' + Math.random().toString(36).slice(2, 8),
    content: 'sample',
    kind: 'note',
    source: 'manual',
    status: 'active',
    convertedTo: null,
    projectId: null,
    tags: [],
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    deletedAt: null,
    ...overrides,
  };
}

/** 截到当天 00:00 本地时间。 */
function startOfToday(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** 在某天上加 N 天的 12:00，返回 ms。 */
function atNoon(base: number, daysOffset: number): number {
  const d = new Date(base);
  d.setDate(d.getDate() + daysOffset);
  d.setHours(12, 0, 0, 0);
  return d.getTime();
}

// ====== 通用 setup ======

interface StoresState {
  tasks: Task[];
  projects: Project[];
  inbox: InboxItem[];
  tasksLoading?: boolean;
  projectsLoading?: boolean;
  inboxLoading?: boolean;
}

function setupStores(state: StoresState = { tasks: [], projects: [], inbox: [] }): void {
  useTaskStore.setState({
    tasks: state.tasks,
    loading: state.tasksLoading ?? false,
    error: null,
    filter: {},
    load: vi.fn().mockResolvedValue(undefined),
    setFilter: vi.fn(),
    get: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue(null),
    update: vi.fn().mockResolvedValue(null),
    transition: vi.fn().mockResolvedValue(null),
    archive: vi.fn().mockResolvedValue(null),
    delete: vi.fn().mockResolvedValue(false),
  });
  useProjectStore.setState({
    projects: state.projects,
    loading: state.projectsLoading ?? false,
    error: null,
    archiveFilter: 'active',
    load: vi.fn().mockResolvedValue(undefined),
    setArchiveFilter: vi.fn(),
    create: vi.fn().mockResolvedValue(null),
    update: vi.fn().mockResolvedValue(null),
    archive: vi.fn().mockResolvedValue(null),
    delete: vi.fn().mockResolvedValue(false),
  });
  useInboxStore.setState({
    items: state.inbox,
    loading: state.inboxLoading ?? false,
    error: null,
    filter: 'active',
    load: vi.fn().mockResolvedValue(undefined),
    setFilter: vi.fn(),
    add: vi.fn().mockResolvedValue(null),
    update: vi.fn().mockResolvedValue(null),
    archive: vi.fn().mockResolvedValue(null),
    convertToTask: vi.fn().mockResolvedValue(null),
  });
}

function renderOverview(): void {
  render(
    <MemoryRouter>
      <OverviewPage />
    </MemoryRouter>,
  );
}

// ====== 测试 ======

describe('OverviewPage', () => {
  beforeEach(() => {
    setupStores();
    __resetToastCounterForTest();
    useToastStore.setState({ toasts: [] });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('loading state', () => {
    it('shows "数据加载中…" header when any store is loading', () => {
      setupStores({ tasks: [], projects: [], inbox: [], tasksLoading: true });
      renderOverview();
      expect(screen.getByTestId('overview-loading')).toBeInTheDocument();
    });

    it('does NOT show loading indicator when no store is loading', () => {
      renderOverview();
      expect(screen.queryByTestId('overview-loading')).not.toBeInTheDocument();
    });
  });

  describe('empty states (4 cards)', () => {
    it('renders empty text for today card', () => {
      renderOverview();
      const empty = screen.getByTestId('overview-card-today-empty');
      expect(empty).toBeInTheDocument();
      expect(empty.textContent).toContain('今天没有重点任务');
    });

    it('renders empty text for overdue card', () => {
      renderOverview();
      const empty = screen.getByTestId('overview-card-overdue-empty');
      expect(empty).toBeInTheDocument();
      expect(empty.textContent).toContain('没有逾期任务');
    });

    it('renders empty text for inbox card', () => {
      renderOverview();
      const empty = screen.getByTestId('overview-card-inbox-empty');
      expect(empty).toBeInTheDocument();
      expect(empty.textContent).toContain('收集箱是空的');
    });

    it('renders empty text for projects card', () => {
      renderOverview();
      const empty = screen.getByTestId('overview-card-projects-empty');
      expect(empty).toBeInTheDocument();
      expect(empty.textContent).toContain('还没有项目');
    });

    it('renders the AI placeholder card with the expected text', () => {
      renderOverview();
      const placeholder = screen.getByTestId('overview-ai-placeholder');
      expect(placeholder).toBeInTheDocument();
      expect(placeholder.textContent).toContain('AI 工作区将在 T3-x 接入');
    });
  });

  describe('today card sorting (priority desc + dueDate asc)', () => {
    it('orders high before medium before low, and same-priority by dueDate asc', () => {
      const today = startOfToday();
      const tHighLate = makeTask({ id: 'T_high_late', priority: 'high', dueDate: atNoon(today, 0) + 5 * 60_000 });
      const tHighEarly = makeTask({ id: 'T_high_early', priority: 'high', dueDate: atNoon(today, 0) + 60_000 });
      const tMed = makeTask({ id: 'T_med', priority: 'medium', dueDate: atNoon(today, 0) });
      const tLow = makeTask({ id: 'T_low', priority: 'low', dueDate: atNoon(today, 0) + 60_000 });

      // 给同样的 dueDate 让 high 区分顺序
      const highLateNoon = atNoon(today, 0) + 5 * 60_000; // 12:05
      const highEarlyNoon = atNoon(today, 0) + 60 * 60_000; // 13:00
      const medNoon = atNoon(today, 0); // 12:00
      const lowNoon = atNoon(today, 0) + 2 * 60 * 60_000; // 14:00

      tHighLate.dueDate = highLateNoon;
      tHighEarly.dueDate = highEarlyNoon;
      tMed.dueDate = medNoon;
      tLow.dueDate = lowNoon;

      const tasks = [tLow, tHighLate, tMed, tHighEarly];
      useTaskStore.setState({ tasks });

      renderOverview();

      const list = screen.getByTestId('overview-today-list');
      const rendered = within(list).getAllByTestId(/^overview-task-row-/);
      expect(rendered.map((el) => el.getAttribute('data-testid'))).toEqual([
        'overview-task-row-T_high_late', // high 12:05
        'overview-task-row-T_high_early', // high 13:00
        'overview-task-row-T_med', // medium 12:00
        'overview-task-row-T_low', // low 14:00
      ]);
    });

    it('excludes done and archived tasks from the today list', () => {
      const today = startOfToday();
      const tasks = [
        makeTask({ id: 'T_done', status: 'done', priority: 'high', dueDate: atNoon(today, 0) }),
        makeTask({ id: 'T_archived', status: 'archived', priority: 'high', dueDate: atNoon(today, 0) }),
        makeTask({ id: 'T_todo', status: 'todo', priority: 'high', dueDate: atNoon(today, 0) }),
      ];
      useTaskStore.setState({ tasks });
      renderOverview();
      const list = screen.getByTestId('overview-today-list');
      expect(within(list).queryByTestId('overview-task-row-T_done')).toBeNull();
      expect(within(list).queryByTestId('overview-task-row-T_archived')).toBeNull();
      expect(within(list).getByTestId('overview-task-row-T_todo')).toBeInTheDocument();
    });

    it('excludes tasks without dueDate from the today list', () => {
      const tasks = [
        makeTask({ id: 'T_nodue', priority: 'high', dueDate: null }),
      ];
      useTaskStore.setState({ tasks });
      renderOverview();
      expect(screen.getByTestId('overview-card-today-empty')).toBeInTheDocument();
    });
  });

  describe('overdue card', () => {
    it('shows the red overdue badge with days count', () => {
      const today = startOfToday();
      const threeDaysAgo = atNoon(today, -3);
      const tasks = [makeTask({ id: 'T_od3', priority: 'high', dueDate: threeDaysAgo })];
      useTaskStore.setState({ tasks });
      renderOverview();

      const badge = screen.getByTestId('overview-task-overdue-T_od3');
      expect(badge).toBeInTheDocument();
      expect(badge.textContent).toContain('逾期 3 天');
      // 红色角标：用 className 包含 danger 关键字做最小断言
      expect(badge.className).toMatch(/danger/);
    });

    it('excludes done/archived tasks', () => {
      const today = startOfToday();
      const yesterday = atNoon(today, -1);
      const tasks = [
        makeTask({ id: 'T_od_done', status: 'done', priority: 'high', dueDate: yesterday }),
        makeTask({ id: 'T_od_arch', status: 'archived', priority: 'high', dueDate: yesterday }),
      ];
      useTaskStore.setState({ tasks });
      renderOverview();
      expect(screen.getByTestId('overview-card-overdue-empty')).toBeInTheDocument();
    });

    it('does NOT show overdue badge on today list rows', () => {
      const today = startOfToday();
      const tasks = [makeTask({ id: 'T_today', priority: 'high', dueDate: atNoon(today, 0) })];
      useTaskStore.setState({ tasks });
      renderOverview();
      expect(screen.queryByTestId('overview-task-overdue-T_today')).toBeNull();
    });
  });

  describe('recent inbox card', () => {
    it('renders up to 5 active items', () => {
      const items: InboxItem[] = [];
      for (let i = 0; i < 8; i++) {
        items.push(
          makeInbox({ id: `I_${i}`, content: `item ${i}`, createdAt: 1_700_000_000_000 + i * 1000 }),
        );
      }
      useInboxStore.setState({ items });
      renderOverview();

      const list = screen.getByTestId('overview-inbox-list');
      const rendered = within(list).getAllByTestId(/^overview-inbox-item-/);
      expect(rendered).toHaveLength(5);
    });

    it('excludes archived/converted items', () => {
      const items: InboxItem[] = [
        makeInbox({ id: 'I_active', status: 'active' }),
        makeInbox({ id: 'I_archived', status: 'archived' }),
        makeInbox({ id: 'I_converted', status: 'converted' }),
      ];
      useInboxStore.setState({ items });
      renderOverview();
      const list = screen.getByTestId('overview-inbox-list');
      expect(within(list).getByTestId('overview-inbox-item-I_active')).toBeInTheDocument();
      expect(within(list).queryByTestId('overview-inbox-item-I_archived')).toBeNull();
      expect(within(list).queryByTestId('overview-inbox-item-I_converted')).toBeNull();
    });

    it('truncates long content to 50 chars + ellipsis', () => {
      const long = 'x'.repeat(200);
      const items = [makeInbox({ id: 'I_long', content: long })];
      useInboxStore.setState({ items });
      renderOverview();
      const row = screen.getByTestId('overview-inbox-item-I_long');
      const text = row.querySelector('p')?.textContent ?? '';
      expect(text.length).toBeLessThanOrEqual(51);
      expect(text.endsWith('…')).toBe(true);
    });

    it('wraps items in a Link that routes to /inbox', () => {
      const items = [makeInbox({ id: 'I_link' })];
      useInboxStore.setState({ items });
      renderOverview();
      const link = screen.getByTestId('overview-inbox-link-I_link');
      expect(link).toBeInTheDocument();
      expect(link.getAttribute('href')).toBe('/inbox');
    });
  });

  describe('project progress card', () => {
    it('renders each active project with done/total counts', () => {
      const projects: Project[] = [
        makeProject({ id: 'P_a', name: 'A' }),
        makeProject({ id: 'P_b', name: 'B', archived: true }),
      ];
      const tasks: Task[] = [
        makeTask({ id: 'T_a1', projectId: 'P_a', status: 'done' }),
        makeTask({ id: 'T_a2', projectId: 'P_a', status: 'todo' }),
        makeTask({ id: 'T_b1', projectId: 'P_b', status: 'done' }),
      ];
      useTaskStore.setState({ tasks });
      useProjectStore.setState({ projects });
      renderOverview();

      const list = screen.getByTestId('overview-projects-list');
      // 归档的 P_b 不应出现
      expect(within(list).getByTestId('overview-project-P_a')).toBeInTheDocument();
      expect(within(list).queryByTestId('overview-project-P_b')).toBeNull();
      // 进度数字 1/2
      expect(within(list).getByTestId('overview-project-progress-P_a').textContent).toBe('1 / 2');
    });

    it('orders projects by most-recent task activity desc', () => {
      const projects: Project[] = [
        makeProject({ id: 'P_old', name: 'old' }),
        makeProject({ id: 'P_new', name: 'new' }),
        makeProject({ id: 'P_empty', name: 'empty' }),
      ];
      const tasks: Task[] = [
        makeTask({ id: 'T_old', projectId: 'P_old', updatedAt: 1_000 }),
        makeTask({ id: 'T_new', projectId: 'P_new', updatedAt: 5_000 }),
      ];
      useTaskStore.setState({ tasks });
      useProjectStore.setState({ projects });
      renderOverview();

      const list = screen.getByTestId('overview-projects-list');
      const rows = within(list).getAllByTestId(/^overview-project-(?!progress)/);
      const ids = rows.map((r) => r.getAttribute('data-testid'));
      // P_new 先（P_new 的 updatedAt 更大），再 P_old，最后无任务的 P_empty
      expect(ids).toEqual(['overview-project-P_new', 'overview-project-P_old', 'overview-project-P_empty']);
    });
  });

  describe('quick input submission', () => {
    it('calls inboxStore.add with content + kind + projectId=null on submit', () => {
      const addSpy = vi.fn().mockResolvedValue(null);
      useInboxStore.setState({ add: addSpy });
      renderOverview();

      const textarea = screen.getByTestId('overview-quick-input-content');
      const submit = screen.getByTestId('overview-quick-input-submit');

      fireEvent.click(screen.getByTestId('overview-quick-input-kind-todo'));
      fireEvent.change(textarea, { target: { value: '  buy milk  ' } });
      fireEvent.click(submit);

      expect(addSpy).toHaveBeenCalledWith({
        content: 'buy milk',
        kind: 'todo',
        projectId: null,
      });
    });

    it('disables submit when content is empty / whitespace', () => {
      renderOverview();
      const submit = screen.getByTestId('overview-quick-input-submit');
      expect(submit).toBeDisabled();
      const textarea = screen.getByTestId('overview-quick-input-content');
      fireEvent.change(textarea, { target: { value: '   ' } });
      expect(submit).toBeDisabled();
      fireEvent.change(textarea, { target: { value: 'hi' } });
      expect(submit).toBeEnabled();
    });

    it('clears textarea after a successful submit', () => {
      const addSpy = vi.fn().mockResolvedValue(null);
      useInboxStore.setState({ add: addSpy });
      renderOverview();
      const textarea = screen.getByTestId('overview-quick-input-content');
      fireEvent.change(textarea, { target: { value: 'idea' } });
      fireEvent.click(screen.getByTestId('overview-quick-input-submit'));
      expect(textarea).toHaveValue('');
    });
  });

  describe('navigation', () => {
    it('renders a "查看全部收集箱" link pointing to /inbox', () => {
      renderOverview();
      const link = screen.getByRole('link', { name: /查看全部收集箱/ });
      expect(link.getAttribute('href')).toBe('/inbox');
    });
  });
});
