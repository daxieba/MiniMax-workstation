/**
 * NoteTagInput 组件测试（T4-1）
 *
 * 覆盖：
 *   - 输入 → Enter 添加 tag
 *   - × 移除 tag
 *   - 重复 tag 忽略
 *   - 空白 / 纯空格忽略
 *   - Backspace 在空 input 上 → 删最后一个
 *   - 逗号（中文 / 英文）也能当分隔
 *   - onBlur 自动 commit
 */

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { NoteTagInput } from '@/components/NoteTagInput/NoteTagInput';

describe('NoteTagInput', () => {
  it('renders existing tags as chips with × buttons', () => {
    const onChange = vi.fn();
    render(<NoteTagInput value={['前端', 'P0']} onChange={onChange} />);
    expect(screen.getByTestId('note-tag-chip-前端')).toBeInTheDocument();
    expect(screen.getByTestId('note-tag-chip-P0')).toBeInTheDocument();
    expect(screen.getByTestId('note-tag-remove-前端')).toBeInTheDocument();
  });

  it('adds a tag on Enter', () => {
    const onChange = vi.fn();
    render(<NoteTagInput value={[]} onChange={onChange} />);
    const input = screen.getByTestId('note-tag-input-field');
    fireEvent.change(input, { target: { value: '新标签' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith(['新标签']);
  });

  it('ignores empty / whitespace input on Enter', () => {
    const onChange = vi.fn();
    render(<NoteTagInput value={['existing']} onChange={onChange} />);
    const input = screen.getByTestId('note-tag-input-field');
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('ignores duplicate tags', () => {
    const onChange = vi.fn();
    render(<NoteTagInput value={['前端']} onChange={onChange} />);
    const input = screen.getByTestId('note-tag-input-field');
    fireEvent.change(input, { target: { value: '前端' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('removes a tag when × is clicked', () => {
    const onChange = vi.fn();
    render(<NoteTagInput value={['前端', 'P0']} onChange={onChange} />);
    fireEvent.click(screen.getByTestId('note-tag-remove-前端'));
    expect(onChange).toHaveBeenCalledWith(['P0']);
  });

  it('Backspace on empty input removes the last chip', () => {
    const onChange = vi.fn();
    render(<NoteTagInput value={['前端', 'P0']} onChange={onChange} />);
    const input = screen.getByTestId('note-tag-input-field');
    fireEvent.keyDown(input, { key: 'Backspace' });
    expect(onChange).toHaveBeenCalledWith(['前端']);
  });

  it('English comma also commits the tag', () => {
    const onChange = vi.fn();
    render(<NoteTagInput value={[]} onChange={onChange} />);
    const input = screen.getByTestId('note-tag-input-field');
    fireEvent.change(input, { target: { value: 'urgent' } });
    fireEvent.keyDown(input, { key: ',' });
    expect(onChange).toHaveBeenCalledWith(['urgent']);
  });

  it('Chinese comma also commits the tag', () => {
    const onChange = vi.fn();
    render(<NoteTagInput value={[]} onChange={onChange} />);
    const input = screen.getByTestId('note-tag-input-field');
    fireEvent.change(input, { target: { value: '紧急' } });
    fireEvent.keyDown(input, { key: '，' });
    expect(onChange).toHaveBeenCalledWith(['紧急']);
  });

  it('onBlur auto-commits non-empty input', () => {
    const onChange = vi.fn();
    render(<NoteTagInput value={[]} onChange={onChange} />);
    const input = screen.getByTestId('note-tag-input-field');
    fireEvent.change(input, { target: { value: 'onblur' } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith(['onblur']);
  });

  it('onBlur does NOT commit empty input', () => {
    const onChange = vi.fn();
    render(<NoteTagInput value={['existing']} onChange={onChange} />);
    const input = screen.getByTestId('note-tag-input-field');
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.blur(input);
    expect(onChange).not.toHaveBeenCalled();
  });
});
