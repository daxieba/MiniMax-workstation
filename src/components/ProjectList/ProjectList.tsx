/**
 * 项目列表组件（T2-3）
 *
 * 项目与任务页左侧栏。展示当前 archiveFilter 下的项目 + 顶部"+ 新建项目"按钮 +
 * 归档切换（active / archived / all）。
 *
 * **选中**：
 *   - 选中项高亮
 *   - "全部任务"作为伪项目（projectId = undefined），常驻顶部
 *   - "无项目"作为伪项目（projectId = null），仅在 archiveFilter 含未归档时出现
 *
 * **不做**：
 *   - 不调 IPC / store
 *   - 二次确认在父页面做
 */

import { Plus, FolderOpen } from 'lucide-react';

import { EmptyState } from '@/components/EmptyState/EmptyState';
import type { Project } from '@shared/types/project';
import type { ProjectArchiveFilter } from '@/store/projectStore';

export interface ProjectListProps {
  projects: Project[];
  /** 当前选中的 projectId（`undefined` = 全部任务；`null` = 无项目；其他 = 项目 id）。 */
  selectedId: string | null | undefined;
  onSelect: (id: string | null | undefined) => void;
  onCreate: () => void;
  /** 项目行级操作（编辑、归档、删除）。 */
  onEdit: (id: string) => void;
  onArchive: (id: string) => void;
  onDelete: (id: string) => void;
  archiveFilter: ProjectArchiveFilter;
  onArchiveFilterChange: (filter: ProjectArchiveFilter) => void;
}

const ARCHIVE_FILTERS: ReadonlyArray<{ value: ProjectArchiveFilter; label: string }> = [
  { value: 'active', label: '活跃' },
  { value: 'archived', label: '已归档' },
  { value: 'all', label: '全部' },
];

const TRUNCATE_MAX = 24;
function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…`;
}

/**
 * 项目列表（左侧栏）。
 */
export function ProjectList({
  projects,
  selectedId,
  onSelect,
  onCreate,
  onEdit,
  onArchive,
  onDelete,
  archiveFilter,
  onArchiveFilterChange,
}: ProjectListProps): React.ReactElement {
  return (
    <aside
      data-testid="project-list"
      className="flex h-full w-64 shrink-0 flex-col gap-2 border-r border-line bg-sidebar p-3"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-primary">项目</h2>
        <button
          type="button"
          data-testid="project-list-new"
          onClick={onCreate}
          className="inline-flex items-center gap-1 rounded-md border border-line bg-elevated px-2 py-1 text-xs text-primary transition-colors hover:border-accent hover:text-accent"
          title="新建项目"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          新建
        </button>
      </div>

      <div
        role="tablist"
        aria-label="归档过滤"
        className="inline-flex rounded-md border border-line bg-elevated p-0.5 text-xs"
      >
        {ARCHIVE_FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            role="tab"
            aria-selected={archiveFilter === f.value}
            data-testid={`project-list-archive-filter-${f.value}`}
            onClick={() => onArchiveFilterChange(f.value)}
            className={[
              'flex-1 rounded px-2 py-1 transition-colors',
              archiveFilter === f.value ? 'bg-accent text-inverse' : 'text-secondary hover:text-primary',
            ].join(' ')}
          >
            {f.label}
          </button>
        ))}
      </div>

      <nav className="flex-1 space-y-1 overflow-auto" aria-label="项目列表">
        {/* 全部任务（伪项目） */}
        <button
          type="button"
          data-testid="project-list-item-all"
          onClick={() => onSelect(undefined)}
          className={[
            'flex w-full items-center justify-between rounded-md border px-2 py-1.5 text-left text-sm transition-colors',
            selectedId === undefined
              ? 'border-accent bg-accent-soft text-accent'
              : 'border-transparent text-primary hover:bg-elevated',
          ].join(' ')}
        >
          <span className="truncate">全部任务</span>
        </button>

        {/* 无项目（伪项目） */}
        {archiveFilter !== 'archived' ? (
          <button
            type="button"
            data-testid="project-list-item-none"
            onClick={() => onSelect(null)}
            className={[
              'flex w-full items-center justify-between rounded-md border px-2 py-1.5 text-left text-sm transition-colors',
              selectedId === null
                ? 'border-accent bg-accent-soft text-accent'
                : 'border-transparent text-primary hover:bg-elevated',
            ].join(' ')}
          >
            <span className="truncate text-secondary">无项目</span>
          </button>
        ) : null}

        {projects.length === 0 ? (
          <EmptyState
            icon={FolderOpen}
            title={archiveFilter === 'archived' ? '没有已归档的项目' : '还没有项目'}
            description={
              archiveFilter === 'archived'
                ? '归档的项目会出现在这里，方便回查。'
                : '项目把相关任务归一组。建第一个项目开始组织你的工作。'
            }
            actionLabel={archiveFilter === 'archived' ? undefined : '新建项目'}
            onAction={archiveFilter === 'archived' ? undefined : onCreate}
            data-testid="project-list-empty"
          />
        ) : (
          projects.map((p) => (
            <div
              key={p.id}
              data-testid={`project-list-row-${p.id}`}
              className={[
                'group flex items-center gap-1 rounded-md border px-2 py-1.5 text-left text-sm transition-colors',
                selectedId === p.id
                  ? 'border-accent bg-accent-soft text-accent'
                  : 'border-transparent text-primary hover:bg-elevated',
                p.archived ? 'opacity-60' : '',
              ].join(' ')}
            >
              <button
                type="button"
                data-testid={`project-list-select-${p.id}`}
                onClick={() => onSelect(p.id)}
                className="flex flex-1 items-center gap-2 truncate text-left"
              >
                {p.color ? (
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: p.color }}
                    aria-hidden="true"
                  />
                ) : null}
                <span className="truncate">{truncate(p.name, TRUNCATE_MAX)}</span>
              </button>
              <div className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
                <button
                  type="button"
                  data-testid={`project-list-edit-${p.id}`}
                  onClick={() => onEdit(p.id)}
                  className="rounded px-1 text-xs text-secondary hover:text-primary"
                  title="编辑"
                >
                  编辑
                </button>
                {!p.archived ? (
                  <button
                    type="button"
                    data-testid={`project-list-archive-${p.id}`}
                    onClick={() => onArchive(p.id)}
                    className="rounded px-1 text-xs text-secondary hover:text-primary"
                    title="归档"
                  >
                    归档
                  </button>
                ) : null}
                <button
                  type="button"
                  data-testid={`project-list-delete-${p.id}`}
                  onClick={() => onDelete(p.id)}
                  className="rounded px-1 text-xs text-danger hover:text-danger"
                  title="删除"
                >
                  删除
                </button>
              </div>
            </div>
          ))
        )}
      </nav>
    </aside>
  );
}
