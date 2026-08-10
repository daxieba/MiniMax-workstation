/**
 * `note:export` IPC handler 端到端测试（T4-3）
 *
 * 直接调 `handleNoteExport(...)` 函数（绕开 ipcMain 事件循环），喂临时 db +
 * 临时导出目录，验证：
 *   - 单 note 导出 → 1 个 .md 文件
 *   - 多 note 导出 → N 个 .md 文件
 *   - 文件名 slug 化（特殊字符替换 / 折叠空白）
 *   - YAML frontmatter 正确
 *   - 默认目录路径（用 resolveDir 钩子）
 *   - 自定义 targetDir
 *   - 错误路径：ids 空 → VALIDATION_FAILED
 *   - **安全**：导出文件**不**含 apiKey / provider config / inbox 内容 / task 内容
 *
 * **不依赖 Electron** —— 直接用 `db/client.ts` 的 createDbClient。
 *
 * @see electron/main/ipc/note.ts
 */

import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve as resolvePath } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ulid } from 'ulidx';

import { closeDb, createDbClient, type WorkstationDb } from '../db/client';
import { notes, type NoteRow } from '../db/schema';
import {
  handleNoteExport,
  renderNoteToMarkdown,
  slugifyTitle,
  type NoteIpcDeps,
} from '../electron/main/ipc/note';
import type { Note } from '../shared/types/note';

const TMP_ROOT = join(tmpdir(), 'minimax-workstation-note-export-test');

beforeAll(() => {
  if (!existsSync(TMP_ROOT)) {
    mkdirSync(TMP_ROOT, { recursive: true });
  }
});

afterAll(() => {
  try {
    rmSync(TMP_ROOT, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

interface Fixture {
  deps: NoteIpcDeps;
  db: WorkstationDb;
  exportDir: string;
  close: () => void;
}

function makeFixture(): Fixture {
  const dbPath = join(
    TMP_ROOT,
    `note-export-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
  );
  const { db } = createDbClient(dbPath, resolvePath(__dirname, '..'));
  const exportDir = join(TMP_ROOT, `export-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(exportDir, { recursive: true });
  return {
    deps: { db },
    db,
    exportDir,
    close: () => closeDb(db),
  };
}

/** 工具：直接在 db 里建一个 note 行（绕开 IPC）。 */
function seedNote(db: WorkstationDb, overrides: Partial<NoteRow> = {}): NoteRow {
  const id = overrides.id ?? ulid();
  const now = new Date();
  const row: NoteRow = {
    id,
    title: overrides.title ?? 'seed',
    content: overrides.content ?? 'body',
    tags: overrides.tags ?? [],
    linkedTaskIds: overrides.linkedTaskIds ?? [],
    projectId: overrides.projectId ?? null,
    source: overrides.source ?? 'manual',
    archived: overrides.archived ?? 0,
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
  };
  db.insert(notes).values(row).run();
  return row;
}

// ============================================================
//  slugifyTitle
// ============================================================

describe('slugifyTitle', () => {
  it('replaces Windows illegal characters', () => {
    expect(slugifyTitle('a<b>c:d"e/f\\g|h?i*j')).toBe('a-b-c-d-e-f-g-h-i-j');
  });

  it('folds whitespace and consecutive hyphens', () => {
    expect(slugifyTitle('  hello   world  ')).toBe('hello-world');
    expect(slugifyTitle('a--b---c')).toBe('a-b-c');
  });

  it('truncates to maxLen', () => {
    const long = 'x'.repeat(200);
    expect(slugifyTitle(long, 50).length).toBe(50);
  });

  it('falls back to "note" for empty input', () => {
    expect(slugifyTitle('')).toBe('note');
    expect(slugifyTitle('   ')).toBe('note');
    expect(slugifyTitle('---')).toBe('note');
  });

  it('preserves Chinese characters', () => {
    expect(slugifyTitle('笔记标题 测试')).toBe('笔记标题-测试');
  });
});

// ============================================================
//  renderNoteToMarkdown
// ============================================================

describe('renderNoteToMarkdown', () => {
  it('contains YAML frontmatter and markdown body', () => {
    const note: Note = {
      id: '01H',
      title: 'Test',
      content: 'Body text',
      tags: ['前端', 'react'],
      linkedTaskIds: ['T_1'],
      projectId: null,
      source: 'manual',
      archived: false,
      createdAt: Date.UTC(2026, 0, 15, 10, 0, 0),
      updatedAt: Date.UTC(2026, 0, 15, 10, 0, 0),
    };
    const md = renderNoteToMarkdown(note);
    expect(md).toMatch(/^---\n/);
    expect(md).toContain('title: "Test"');
    expect(md).toContain('tags: ["前端", "react"]');
    expect(md).toContain('linkedTaskIds: ["T_1"]');
    expect(md).toContain('source: "manual"');
    expect(md).toContain('archived: false');
    expect(md).toContain('# Test');
    expect(md).toContain('Body text');
  });

  it('escapes quotes and backslashes in YAML values', () => {
    const note: Note = {
      id: '01H',
      title: 'a "quoted" \\ name',
      content: 'body',
      tags: ['with "quote"'],
      linkedTaskIds: [],
      projectId: null,
      source: 'manual',
      archived: false,
      createdAt: 0,
      updatedAt: 0,
    };
    const md = renderNoteToMarkdown(note);
    expect(md).toContain('title: "a \\"quoted\\" \\\\ name"');
    expect(md).toContain('tags: ["with \\"quote\\""]');
  });
});

// ============================================================
//  handleNoteExport
// ============================================================

describe('handleNoteExport — single note', () => {
  it('exports one .md file with correct name + path', async () => {
    const f = makeFixture();
    try {
      const seeded = seedNote(f.db, {
        title: 'First Note',
        content: '# Heading\n\nBody',
        tags: ['前端'],
      });
      const result = await handleNoteExport(f.deps, { ids: [seeded.id] }, () => f.exportDir);
      expect(result.files).toHaveLength(1);
      const file = result.files[0]!;
      expect(file.id).toBe(seeded.id);
      expect(file.path).toContain(f.exportDir);
      expect(file.path).toMatch(/\.md$/);
      // 文件存在 + 内容含 YAML
      expect(existsSync(file.path)).toBe(true);
      const content = readFileSync(file.path, 'utf-8');
      expect(content).toMatch(/^---/);
      expect(content).toContain('title: "First Note"');
    } finally {
      f.close();
    }
  });

  it('slugifies special characters in filename', async () => {
    const f = makeFixture();
    try {
      const seeded = seedNote(f.db, { title: 'a/b\\c?d*' });
      const result = await handleNoteExport(f.deps, { ids: [seeded.id] }, () => f.exportDir);
      const file = result.files[0]!;
      // 文件名不能含 / \ ? * (Windows 非法)
      const basename = file.path.split(/[\\/]/).pop() ?? '';
      expect(basename).not.toMatch(/[<>:"/\\|?*]/);
    } finally {
      f.close();
    }
  });

  it('appends ulid suffix to filename (unique per note)', async () => {
    const f = makeFixture();
    try {
      const a = seedNote(f.db, { title: 'Same Title' });
      const b = seedNote(f.db, { title: 'Same Title' });
      const result = await handleNoteExport(f.deps, { ids: [a.id, b.id] }, () => f.exportDir);
      expect(result.files).toHaveLength(2);
      const paths = result.files.map((x) => x.path);
      // 两个文件应不同名（ulid 后缀不同）
      expect(new Set(paths).size).toBe(2);
      // 都有 ulid 后缀（6 字符）
      for (const p of paths) {
        const basename = p.split(/[\\/]/).pop() ?? '';
        expect(basename).toMatch(/^Same-Title-[A-Z0-9]{6}\.md$/);
      }
    } finally {
      f.close();
    }
  });
});

describe('handleNoteExport — multiple notes', () => {
  it('exports N .md files for N ids', async () => {
    const f = makeFixture();
    try {
      const ids = [
        seedNote(f.db, { title: 'A' }).id,
        seedNote(f.db, { title: 'B' }).id,
        seedNote(f.db, { title: 'C' }).id,
      ];
      const result = await handleNoteExport(f.deps, { ids }, () => f.exportDir);
      expect(result.files).toHaveLength(3);
      expect(result.files.map((x) => x.id).sort()).toEqual([...ids].sort());
      for (const file of result.files) {
        expect(existsSync(file.path)).toBe(true);
      }
    } finally {
      f.close();
    }
  });

  it('skips unknown ids (does not error)', async () => {
    const f = makeFixture();
    try {
      const seeded = seedNote(f.db, { title: 'Real' });
      const result = await handleNoteExport(
        f.deps,
        { ids: [seeded.id, 'NONEXISTENT'] },
        () => f.exportDir,
      );
      expect(result.files).toHaveLength(1);
      expect(result.files[0]?.id).toBe(seeded.id);
    } finally {
      f.close();
    }
  });
});

describe('handleNoteExport — target dir', () => {
  it('uses custom targetDir when provided', async () => {
    const f = makeFixture();
    try {
      const seeded = seedNote(f.db, { title: 'Custom Dir' });
      const customDir = join(TMP_ROOT, `custom-${Date.now()}`);
      const result = await handleNoteExport(f.deps, {
        ids: [seeded.id],
        targetDir: customDir,
      });
      expect(result.files[0]?.path).toContain(customDir);
      expect(existsSync(customDir)).toBe(true);
    } finally {
      f.close();
    }
  });

  it('default dir contains "minimax-workstation-notes" (uses resolveDir hook)', async () => {
    const f = makeFixture();
    try {
      const seeded = seedNote(f.db, { title: 'Default' });
      const customHome = join(TMP_ROOT, `home-${Date.now()}`);
      mkdirSync(customHome, { recursive: true });
      const result = await handleNoteExport(f.deps, { ids: [seeded.id] }, () =>
        join(customHome, 'Downloads', 'minimax-workstation-notes', '2026-08-09'),
      );
      expect(result.files[0]?.path).toContain(customHome);
      expect(result.files[0]?.path).toContain('minimax-workstation-notes');
    } finally {
      f.close();
    }
  });

  it('creates nested targetDir if it does not exist', async () => {
    const f = makeFixture();
    try {
      const seeded = seedNote(f.db, { title: 'Nested' });
      const nestedDir = join(TMP_ROOT, `nested-${Date.now()}`, 'a', 'b', 'c');
      const result = await handleNoteExport(f.deps, {
        ids: [seeded.id],
        targetDir: nestedDir,
      });
      expect(existsSync(nestedDir)).toBe(true);
      expect(result.files[0]?.path).toContain(nestedDir);
    } finally {
      f.close();
    }
  });
});

describe('handleNoteExport — validation', () => {
  it('rejects empty ids with VALIDATION_FAILED', async () => {
    const f = makeFixture();
    try {
      await expect(handleNoteExport(f.deps, { ids: [] }, () => f.exportDir)).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
      });
    } finally {
      f.close();
    }
  });

  it('rejects non-string ids with VALIDATION_FAILED', async () => {
    const f = makeFixture();
    try {
      await expect(
        handleNoteExport(f.deps, { ids: [123] as unknown as string[] }, () => f.exportDir),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    } finally {
      f.close();
    }
  });

  it('rejects extra fields via .strict()', async () => {
    const f = makeFixture();
    try {
      await expect(
        handleNoteExport(
          f.deps,
          { ids: ['x'], apiKey: 'sk-secret' } as unknown as { ids: string[] },
          () => f.exportDir,
        ),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    } finally {
      f.close();
    }
  });
});

describe('handleNoteExport — SECURITY: no sensitive data in output', () => {
  it('YAML frontmatter does NOT contain apiKey/model/baseURL (provider config / API key fields)', async () => {
    const f = makeFixture();
    try {
      const note = seedNote(f.db, {
        title: 'Security Test',
        content: 'Note body.',
        tags: [],
        linkedTaskIds: [],
      });
      const result = await handleNoteExport(f.deps, { ids: [note.id] }, () => f.exportDir);
      const file = result.files[0]!;
      const content = readFileSync(file.path, 'utf-8');

      // 取出 YAML frontmatter（--- 到 --- 之间）
      const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
      expect(fmMatch).not.toBeNull();
      const fm = fmMatch![1]!;

      // frontmatter **绝不**含 apiKey / model / baseURL 等 provider config 字段
      expect(fm).not.toMatch(/^apiKey:/m);
      expect(fm).not.toMatch(/^key:/m);
      expect(fm).not.toMatch(/^model:/m);
      expect(fm).not.toMatch(/^baseURL:/m);
      expect(fm).not.toMatch(/^provider:/m);
      expect(fm).not.toMatch(/^secret:/m);
      // frontmatter 字段是白名单的：id / title / tags / createdAt / source / linkedTaskIds / archived
      const allowedKeys = new Set([
        'id',
        'title',
        'tags',
        'createdAt',
        'source',
        'linkedTaskIds',
        'archived',
      ]);
      const fmKeys = fm
        .split('\n')
        .map((line) => line.split(':')[0]?.trim())
        .filter((k): k is string => typeof k === 'string' && k.length > 0);
      for (const k of fmKeys) {
        expect(allowedKeys.has(k)).toBe(true);
      }
    } finally {
      f.close();
    }
  });

  it('renderNoteToMarkdown output only contains note-derived fields (no API key / provider / inbox / task injection)', () => {
    // 即使用户在 content 里写 apiKey，也**只**是正文 —— 但 frontmatter / 结构化字段
    // 都是 note 自身字段，不会注入 apiKey/model/baseURL/inbox content/task content。
    const note: Note = {
      id: 'N1',
      title: 't',
      content: 'plain body',
      tags: ['x'],
      linkedTaskIds: ['L1'],
      projectId: null,
      source: 'manual',
      archived: false,
      createdAt: 0,
      updatedAt: 0,
    };
    const md = renderNoteToMarkdown(note);
    // frontmatter 提取
    const fmMatch = md.match(/^---\n([\s\S]*?)\n---/);
    expect(fmMatch).not.toBeNull();
    const fm = fmMatch![1]!;
    // 关键安全约束：frontmatter 不含 apiKey / model / baseURL 等
    expect(fm).not.toMatch(/apiKey|key:|model:|baseURL|provider:|secret:/);
    // body 仅含 "# {title}" + 原文 content
    const body = md.split('---').slice(2).join('---').trim();
    expect(body).toContain('# t');
    expect(body).toContain('plain body');
  });

  it('YAML escaping does not leak keys through tag content (defense-in-depth)', async () => {
    const f = makeFixture();
    try {
      const note = seedNote(f.db, {
        title: 't',
        content: 'c',
        // 故意把 apiKey 字符串当 tag（用户行为）—— frontmatter 仍要安全
        tags: ['sk-fake-api-key-DO-NOT-LEAK'],
      });
      const result = await handleNoteExport(f.deps, { ids: [note.id] }, () => f.exportDir);
      const file = result.files[0]!;
      const content = readFileSync(file.path, 'utf-8');
      // 提取 frontmatter
      const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
      const fm = fmMatch![1]!;
      // frontmatter 字段名（不是值）不含 apiKey
      const fmFieldNames = fm
        .split('\n')
        .map((line) => line.match(/^(\w+):/)?.[1] ?? '')
        .filter((k) => k.length > 0);
      expect(fmFieldNames).not.toContain('apiKey');
    } finally {
      f.close();
    }
  });
});
