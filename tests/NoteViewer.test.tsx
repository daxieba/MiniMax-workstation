/**
 * NoteViewer 组件测试（T4-1）
 *
 * 覆盖：
 *   - 标题 / 标签 / 项目 / 关联任务渲染
 *   - markdown 渲染（含 GFM 表格 / 任务列表 / 代码块 / 链接）
 *   - 关联任务"已删除"角标
 *   - 归档角标
 *   - 不解析 raw HTML（react-markdown 默认行为）
 */

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { NoteViewer } from '@/components/NoteViewer/NoteViewer';
import type { Note } from '@shared/types/note';

function makeNote(overrides: Partial<Note> = {}): Note {
  return {
    id: 'N1',
    title: 'Sample',
    content: 'body',
    tags: [],
    linkedTaskIds: [],
    projectId: null,
    source: 'manual',
    archived: false,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    ...overrides,
  };
}

describe('NoteViewer', () => {
  it('renders title, tags, project, linked tasks', () => {
    const note = makeNote({
      title: 'My Note',
      tags: ['前端', 'P0'],
      projectId: 'P1',
      linkedTaskIds: ['T1', 'T2'],
    });
    render(
      <NoteViewer
        note={note}
        projectName="My Project"
        linkedTasks={[
          { id: 'T1', title: 'Task 1' },
          { id: 'T2', title: 'Task 2' },
        ]}
      />,
    );
    expect(screen.getByTestId('note-viewer-title-N1').textContent).toBe('My Note');
    expect(screen.getByTestId('note-viewer-tags-N1').textContent).toContain('前端');
    expect(screen.getByTestId('note-viewer-tags-N1').textContent).toContain('P0');
    expect(screen.getByTestId('note-viewer-project-N1').textContent).toContain('My Project');
    expect(screen.getByTestId('note-viewer-linked-N1').textContent).toContain('Task 1');
    expect(screen.getByTestId('note-viewer-linked-N1').textContent).toContain('Task 2');
  });

  it('hides project section when projectId is null', () => {
    const note = makeNote({ projectId: null });
    render(
      <NoteViewer note={note} projectName={null} linkedTasks={[]} />,
    );
    expect(screen.queryByTestId('note-viewer-project-N1')).toBeNull();
  });

  it('shows "已归档" badge when archived', () => {
    const note = makeNote({ archived: true });
    render(<NoteViewer note={note} projectName={null} linkedTasks={[]} />);
    // 用 textContent 包含"已归档"断言
    const container = screen.getByTestId('note-viewer-N1');
    expect(container.textContent).toContain('已归档');
  });

  it('shows "已删除" count for missing linked task ids', () => {
    const note = makeNote({ linkedTaskIds: ['T1', 'T_GHOST'] });
    render(
      <NoteViewer
        note={note}
        projectName={null}
        linkedTasks={[{ id: 'T1', title: 'Task 1' }]}
      />,
    );
    expect(screen.getByTestId('note-viewer-linked-N1').textContent).toContain('+ 1 个已删除');
  });

  describe('markdown rendering (react-markdown + remark-gfm)', () => {
    it('renders a GFM table', () => {
      const note = makeNote({
        content: '| col1 | col2 |\n|------|------|\n| a    | b    |\n| c    | d    |',
      });
      render(<NoteViewer note={note} projectName={null} linkedTasks={[]} />);
      const content = screen.getByTestId('note-viewer-content-N1');
      // 表格应有 th / td
      expect(content.querySelector('table')).not.toBeNull();
      expect(content.querySelector('th')?.textContent).toContain('col1');
      expect(content.querySelector('td')?.textContent).toBe('a');
    });

    it('renders a GFM task list (checkboxes)', () => {
      const note = makeNote({
        content: '- [x] done\n- [ ] todo\n',
      });
      render(<NoteViewer note={note} projectName={null} linkedTasks={[]} />);
      const content = screen.getByTestId('note-viewer-content-N1');
      // task list 渲染成 input[type=checkbox]
      const checkboxes = content.querySelectorAll('input[type="checkbox"]');
      expect(checkboxes.length).toBe(2);
    });

    it('renders inline code and code blocks', () => {
      const note = makeNote({
        content: 'inline `code` here\n\n```ts\nconst a = 1;\n```',
      });
      render(<NoteViewer note={note} projectName={null} linkedTasks={[]} />);
      const content = screen.getByTestId('note-viewer-content-N1');
      expect(content.querySelector('code')?.textContent).toBe('code');
      // code block（pre > code）也存在
      expect(content.querySelector('pre code')?.textContent).toContain('const a = 1;');
    });

    it('renders autolinks / links', () => {
      const note = makeNote({
        content: 'Visit https://example.com or [docs](https://docs.example.com).',
      });
      render(<NoteViewer note={note} projectName={null} linkedTasks={[]} />);
      const content = screen.getByTestId('note-viewer-content-N1');
      const links = content.querySelectorAll('a');
      expect(links.length).toBe(2);
    });

    it('renders strikethrough (~~text~~)', () => {
      const note = makeNote({ content: '~~old~~ new' });
      render(<NoteViewer note={note} projectName={null} linkedTasks={[]} />);
      const content = screen.getByTestId('note-viewer-content-N1');
      // react-markdown 用 <del> 渲染删除线
      expect(content.querySelector('del')?.textContent).toBe('old');
    });

    it('does NOT render raw HTML (safe by default)', () => {
      const note = makeNote({ content: '<script>alert(1)</script>visible' });
      render(<NoteViewer note={note} projectName={null} linkedTasks={[]} />);
      const content = screen.getByTestId('note-viewer-content-N1');
      // <script> 不会被作为元素插入
      expect(content.querySelector('script')).toBeNull();
      // 文本"visible"应该出现（react-markdown 把 raw HTML 当文本处理或丢弃）
      expect(content.textContent).toContain('visible');
    });
  });
});
