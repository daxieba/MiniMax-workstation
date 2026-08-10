/**
 * 笔记列表组件（T4-1）
 *
 * 渲染当前过滤下的 notes 列表 + 空态。
 *
 * **Props**：
 *   - `notes`         笔记数组
 *   - `selectedId`    当前选中的 note id（高亮）
 *   - `onSelect`      选中回调
 *   - `projectNameById`  projectId → name 映射（父组件从 projectStore 计算）
 *   - `linkedTaskCountByNoteId`  noteId → 关联任务数
 *
 * **不做**：
 *   - 不调 IPC / store
 *   - 不做分页（第一版不做）
 */

import { NoteCard } from '@/components/NoteCard/NoteCard';
import type { Note } from '@shared/types/note';

export interface NoteListProps {
  notes: Note[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  projectNameById: Map<string, string>;
  linkedTaskCountByNoteId: Map<string, number>;
}

const EMPTY_TEXT = '还没有笔记。点上方「+ 新建笔记」开始记录。';

export function NoteList({
  notes,
  selectedId,
  onSelect,
  projectNameById,
  linkedTaskCountByNoteId,
}: NoteListProps): React.ReactElement {
  if (notes.length === 0) {
    return (
      <div
        data-testid="note-list-empty"
        className="rounded-md border border-dashed border-line bg-base p-6 text-center text-sm text-secondary"
      >
        {EMPTY_TEXT}
      </div>
    );
  }

  return (
    <div data-testid="note-list" className="flex flex-col gap-2">
      {notes.map((n) => (
        <NoteCard
          key={n.id}
          note={n}
          projectName={n.projectId === null ? null : (projectNameById.get(n.projectId) ?? '未知项目')}
          linkedTaskCount={linkedTaskCountByNoteId.get(n.id) ?? 0}
          selected={selectedId === n.id}
          onClick={() => onSelect(n.id)}
        />
      ))}
    </div>
  );
}
