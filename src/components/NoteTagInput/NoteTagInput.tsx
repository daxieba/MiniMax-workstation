/**
 * 笔记标签输入组件（T4-1）
 *
 * Chip 形式：每个 tag 一个 chip + × 按钮移除；输入框 Enter 添加。
 *
 * **Props**：
 *   - `value`        当前 tag 数组
 *   - `onChange`     tag 数组变化时回调
 *   - `placeholder`  输入框占位
 *
 * **不做**：
 *   - 不做 tag 自动补全（第一版手动输入；T4-2 全文搜索时可考虑加联想）
 *   - 不做大小写转换（保持原样；用户自己控制）
 *
 * **键盘**：
 *   - Enter → 把当前 input 加进去
 *   - Backspace 在空 input 上 → 删最后一个 chip
 *
 * **重复 / 空白**：
 *   - trim 后空字符串 → 忽略
 *   - 重复 tag → 忽略（不弹错，静默）
 */

import { useState } from 'react';
import { X } from 'lucide-react';

const MAX_TAG_LEN = 64;
const MAX_TAGS = 256;

export interface NoteTagInputProps {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}

export function NoteTagInput({
  value,
  onChange,
  placeholder = '按 Enter 添加标签…',
}: NoteTagInputProps): React.ReactElement {
  const [draft, setDraft] = useState('');

  function commit(): void {
    const trimmed = draft.trim();
    if (trimmed.length === 0) return;
    if (trimmed.length > MAX_TAG_LEN) {
      // 截断后追加（Zod 还会校验，但前端先给清晰行为）
      const safe = trimmed.slice(0, MAX_TAG_LEN);
      if (!value.includes(safe)) {
        onChange([...value, safe]);
      }
    } else if (!value.includes(trimmed)) {
      if (value.length >= MAX_TAGS) {
        setDraft('');
        return;
      }
      onChange([...value, trimmed]);
    }
    setDraft('');
  }

  function removeAt(idx: number): void {
    onChange(value.filter((_, i) => i !== idx));
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Backspace' && draft.length === 0 && value.length > 0) {
      e.preventDefault();
      removeAt(value.length - 1);
    } else if (e.key === ',' || e.key === '，') {
      // 中文 / 英文逗号也能当分隔
      e.preventDefault();
      commit();
    }
  }

  return (
    <div
      data-testid="note-tag-input"
      className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-md border border-line bg-base px-2 py-1.5 focus-within:border-accent"
    >
      {value.map((tag, i) => (
        <span
          key={`${tag}_${i}`}
          data-testid={`note-tag-chip-${tag}`}
          className="inline-flex items-center gap-1 rounded-full border border-accent bg-accent-soft px-2 py-0.5 text-xs text-accent"
        >
          {tag}
          <button
            type="button"
            data-testid={`note-tag-remove-${tag}`}
            onClick={() => removeAt(i)}
            className="rounded-full p-0.5 text-accent transition-colors hover:bg-accent hover:text-inverse"
            aria-label={`移除标签 ${tag}`}
            title="移除"
          >
            <X className="h-3 w-3" aria-hidden="true" />
          </button>
        </span>
      ))}
      <input
        type="text"
        data-testid="note-tag-input-field"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => {
          if (draft.trim().length > 0) commit();
        }}
        placeholder={value.length === 0 ? placeholder : ''}
        className="min-w-32 flex-1 bg-transparent text-sm text-primary outline-none placeholder:text-secondary"
      />
    </div>
  );
}
