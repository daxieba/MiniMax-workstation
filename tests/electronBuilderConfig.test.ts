/**
 * electron-builder 配置 yml 验证（T5-3）
 *
 * 覆盖：
 *   - yml 文件存在、可读
 *   - 顶层关键字段：appId / productName / directories / files / asar / compression
 *   - win.target = nsis x64（**不**含 win.icon）
 *   - mac.target = dmg / linux.target = AppImage
 *   - nsis 关键开关：oneClick=false / perMachine=false / allowToChangeInstallationDirectory=true /
 *     createDesktopShortcut=true / createStartMenuShortcut=true / shortcutName /
 *     installerLanguages 包含 zh_CN / displayLanguageSelector=false
 *   - **安全**：deleteAppDataOnUninstall: false（卸载保留用户数据）
 *   - artifactName 含 ${productName}-${version}-${arch}
 *   - publish: null（**不**接远端）
 *
 * 解析策略：**不**引入 js-yaml（避免新增依赖）—— 用文本分块（按 `key: value`
 * 一行行）检查 + 关键字符串包含。简单但对固定 schema 够用。
 *
 * @see electron-builder.yml
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const YML_PATH = resolve(__dirname, '..', 'electron-builder.yml');

interface Parsed {
  raw: string;
  lines: string[];
  /** 一级 key -> 整段原始文本（行数不定，可能是 scalar / block / nested）。 */
  sections: Map<string, string>;
}

/** 简易 yml 解析（只够 electron-builder 的固定 schema）。 */
function parseYaml(text: string): Parsed {
  const lines = text.split(/\r?\n/);
  const sections = new Map<string, string>();
  let currentKey: string | null = null;
  let currentBuf: string[] = [];

  for (const line of lines) {
    // 跳过空行 + 注释
    if (line.trim().length === 0) continue;
    if (line.trim().startsWith('#')) continue;

    const indent = line.match(/^(\s*)/)?.[1]?.length ?? 0;
    const m = line.match(/^(\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/);
    if (m && m[1] !== undefined && m[2] !== undefined) {
      const key = m[2];
      // 进入新一级（indent === 0）时，flush 上一个
      if (indent === 0) {
        if (currentKey !== null) sections.set(currentKey, currentBuf.join('\n'));
        currentKey = key;
        currentBuf = [line];
      } else if (currentKey !== null) {
        // 嵌套：仍归到 currentKey
        currentBuf.push(line);
      }
      continue;
    }
    if (currentKey !== null) {
      currentBuf.push(line);
    }
  }
  if (currentKey !== null) sections.set(currentKey, currentBuf.join('\n'));

  return { raw: text, lines, sections };
}

function loadConfig(): Parsed {
  expect(existsSync(YML_PATH), `electron-builder.yml should exist at ${YML_PATH}`).toBe(true);
  const raw = readFileSync(YML_PATH, 'utf-8');
  expect(raw.length, 'yml should not be empty').toBeGreaterThan(0);
  return parseYaml(raw);
}

describe('electron-builder.yml — file', () => {
  it('exists and is non-empty', () => {
    const c = loadConfig();
    expect(c.lines.length).toBeGreaterThan(10);
  });
});

describe('electron-builder.yml — top-level identity', () => {
  it('has appId com.minimax.workstation', () => {
    const c = loadConfig();
    const appId = c.sections.get('appId') ?? '';
    expect(appId).toMatch(/^appId:\s*com\.minimax\.workstation\s*$/m);
  });

  it('has productName "MiniMaxCode 工作台"', () => {
    const c = loadConfig();
    const productName = c.sections.get('productName') ?? '';
    expect(productName).toMatch(/^productName:\s*MiniMaxCode 工作台\s*$/m);
  });
});

describe('electron-builder.yml — directories', () => {
  it('declares output: dist', () => {
    const c = loadConfig();
    const dirs = c.sections.get('directories') ?? '';
    expect(dirs).toMatch(/output:\s*dist/);
  });

  it('declares buildResources: build', () => {
    const c = loadConfig();
    const dirs = c.sections.get('directories') ?? '';
    expect(dirs).toMatch(/buildResources:\s*build/);
  });
});

describe('electron-builder.yml — files / packaging', () => {
  it('includes out/**/* and package.json', () => {
    const c = loadConfig();
    const files = c.sections.get('files') ?? '';
    expect(files).toMatch(/out\/\*\*\/\*/);
    expect(files).toMatch(/package\.json/);
  });

  it('excludes .md and .map', () => {
    const c = loadConfig();
    const files = c.sections.get('files') ?? '';
    expect(files).toMatch(/\*\*\/\*\.md/);
    expect(files).toMatch(/\*\*\/\*\.map/);
  });

  it('enables asar with normal compression', () => {
    const c = loadConfig();
    const asar = c.sections.get('asar') ?? '';
    expect(asar).toMatch(/^asar:\s*true\s*$/m);
    const compression = c.sections.get('compression') ?? '';
    expect(compression).toMatch(/^compression:\s*normal\s*$/m);
  });
});

describe('electron-builder.yml — win target', () => {
  it('uses nsis x64', () => {
    const c = loadConfig();
    const win = c.sections.get('win') ?? '';
    expect(win).toMatch(/target:/);
    expect(win).toMatch(/nsis/);
    expect(win).toMatch(/x64/);
  });

  it('does NOT configure win.icon (per T5-3 scope)', () => {
    const c = loadConfig();
    const win = c.sections.get('win') ?? '';
    expect(win).not.toMatch(/icon:/);
  });
});

describe('electron-builder.yml — mac / linux targets', () => {
  it('mac uses dmg', () => {
    const c = loadConfig();
    const mac = c.sections.get('mac') ?? '';
    expect(mac).toMatch(/target:/);
    expect(mac).toMatch(/dmg/);
  });

  it('linux uses AppImage', () => {
    const c = loadConfig();
    const linux = c.sections.get('linux') ?? '';
    expect(linux).toMatch(/target:/);
    expect(linux).toMatch(/AppImage/);
  });
});

describe('electron-builder.yml — nsis', () => {
  it('uses oneClick=false, perMachine=false, allowToChangeInstallationDirectory=true', () => {
    const c = loadConfig();
    const nsis = c.sections.get('nsis') ?? '';
    expect(nsis).toMatch(/oneClick:\s*false/);
    expect(nsis).toMatch(/perMachine:\s*false/);
    expect(nsis).toMatch(/allowToChangeInstallationDirectory:\s*true/);
    expect(nsis).toMatch(/allowElevation:\s*true/);
  });

  it('creates desktop + start menu shortcuts with correct name', () => {
    const c = loadConfig();
    const nsis = c.sections.get('nsis') ?? '';
    expect(nsis).toMatch(/createDesktopShortcut:\s*true/);
    expect(nsis).toMatch(/createStartMenuShortcut:\s*true/);
    expect(nsis).toMatch(/shortcutName:\s*MiniMaxCode 工作台/);
  });

  it('installerLanguages contains zh_CN and en_US, no language selector', () => {
    const c = loadConfig();
    const nsis = c.sections.get('nsis') ?? '';
    expect(nsis).toMatch(/installerLanguages:/);
    expect(nsis).toMatch(/zh_CN/);
    expect(nsis).toMatch(/en_US/);
    expect(nsis).toMatch(/displayLanguageSelector:\s*false/);
  });

  it('keeps user data on uninstall (security: deleteAppDataOnUninstall: false)', () => {
    const c = loadConfig();
    const nsis = c.sections.get('nsis') ?? '';
    expect(nsis).toMatch(/deleteAppDataOnUninstall:\s*false/);
  });
});

describe('electron-builder.yml — artifact / publish', () => {
  it('artifactName uses ${productName}-${version}-${arch}', () => {
    const c = loadConfig();
    const artifact = c.sections.get('artifactName') ?? '';
    expect(artifact).toMatch(/artifactName:\s*\$\{productName\}-\$\{version\}-\$\{arch\}\.\$\{ext\}/);
  });

  it('publish is null (no remote publish by default)', () => {
    const c = loadConfig();
    const publish = c.sections.get('publish') ?? '';
    expect(publish).toMatch(/^publish:\s*null\s*$/m);
  });
});
