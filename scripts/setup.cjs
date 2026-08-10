#!/usr/bin/env node
/* eslint-env node */
/**
 * 完整安装脚本
 *
 * 调用方式：`pnpm run setup` 或 `node scripts/setup.cjs`
 *
 * 背景：
 *   1. pnpm 11 默认禁止 install scripts（安全机制）
 *   2. electron / better-sqlite3 / esbuild 各自需要 native binary，
 *      且各自有特殊的下载流程（不走 pnpm 标准的 prebuilt 路径）
 *   3. **历史（T1-1）**：当时用 keytar 7.9.0 存 API Key，没有 Node 24
 *      prebuilt binding，强制走 node-gyp，且 vcxproj 锁定 ClangCL 工具集；
 *      VS 2022 BuildTools 默认不装 → `pnpm install`（默认形式）会因
 *      keytar 编译失败 exit 1
 *   4. **当前（T3-1）**：keytar 已被 `@napi-rs/keyring` 替代（NAPI 跨平台 binding，
 *      pnpm install 自动下载），不再触发 native build 失败
 *
 * 因此仍用 `pnpm install --ignore-scripts` 跳过所有 postinstall：
 *   - electron / better-sqlite3 / esbuild 的 native binary 各自有特殊流程，
 *     本脚本单独处理
 *   - @napi-rs/keyring 走 pnpm 标准 prebuilt 路径，不需要额外步骤
 *
 * 本脚本职责：
 *   1. 调用 `pnpm install --ignore-scripts` 装好 JS 部分（已 OK）
 *   2. 单独装需要 native binary 的包：
 *      - electron          → install.js 下载 platform binary（必需，T1-1 用）
 *      - better-sqlite3    → prebuild-install 下载 Node 24 ABI binding（vitest 需要） + electron-v130 binding（pnpm dev / production 需要），T1-3 起必跑
 *      - esbuild           → 平台 native binary（必需，Vite/Vitest 用）
 *   3. @napi-rs/keyring 在 `pnpm install --ignore-scripts` 阶段已下载完成，
 *      不需要额外步骤
 */
const { execFileSync } = require('node:child_process');
const { existsSync, readdirSync, copyFileSync, mkdirSync } = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const pnpmDir = path.join(projectRoot, 'node_modules/.pnpm');

/** 运行 Node 脚本，错误不致命。 */
function tryRunNode(scriptPath, label) {
  if (!existsSync(scriptPath)) {
    console.warn(`[setup] skip ${label}: not found at ${scriptPath}`);
    return false;
  }
  console.log(`[setup] running ${label}`);
  try {
    execFileSync(process.execPath, [scriptPath], {
      cwd: path.dirname(scriptPath),
      stdio: 'inherit',
    });
    return true;
  } catch (err) {
    console.error(`[setup] ${label} failed (non-fatal): ${err.message}`);
    return false;
  }
}

/** 在 pnpmDir 中找匹配前缀的目录，返回其下的 node_modules 路径。 */
function findPnpmNodeModules(prefix) {
  if (!existsSync(pnpmDir)) return null;
  const match = readdirSync(pnpmDir).find((name) => name.startsWith(prefix));
  return match ? path.join(pnpmDir, match, 'node_modules') : null;
}

// 1. electron
const electronNm = findPnpmNodeModules('electron@');
if (electronNm) {
  tryRunNode(path.join(electronNm, 'electron/install.js'), 'electron install');
} else {
  console.warn('[setup] electron package not found, skipping');
}

// 2. better-sqlite3（best-effort：prebuild-install 路径在不同 layout 下不同，
//    找不到时跳过。T1-1 不实际 require better-sqlite3，影响为零）
//    T1-3 起成为必需：下载 host Node 用的 binary + Electron 33 用的 binary，
//    让 vitest（跑在 host Node）和 pnpm dev（跑在 Electron）都能加载。
//
//    注意：用 symlinked 入口（node_modules/better-sqlite3）反推真实版本，
//    不要用字母序首个 .pnpm/better-sqlite3@<x>，可能命中旧版本残留。
const symlinkedBetterSqlite = path.join(projectRoot, 'node_modules', 'better-sqlite3');
let betterSqliteNm = null;
if (existsSync(symlinkedBetterSqlite)) {
  // 真实包路径：node_modules/better-sqlite3 → ../../.pnpm/better-sqlite3@X.Y.Z/node_modules/better-sqlite3
  const real = require('node:fs').realpathSync(symlinkedBetterSqlite);
  // real 形如 .../node_modules/.pnpm/better-sqlite3@X.Y.Z/node_modules/better-sqlite3
  // 我们要 .pnpm/better-sqlite3@X.Y.Z/node_modules
  betterSqliteNm = path.join(path.dirname(path.dirname(real)), 'node_modules');
}
if (betterSqliteNm) {
  // prebuild-install 是 better-sqlite3 的 dep，可能在 .pnpm/prebuild-install@x.x.x 下
  let prebuildBinPath = null;
  for (const entry of readdirSync(pnpmDir)) {
    if (entry.startsWith('prebuild-install@')) {
      const candidate = path.join(
        pnpmDir,
        entry,
        'node_modules/prebuild-install/bin.js',
      );
      if (existsSync(candidate)) {
        prebuildBinPath = candidate;
        break;
      }
    }
  }
  if (prebuildBinPath) {
    const betterSqlitePkg = path.join(betterSqliteNm, 'better-sqlite3');
    const releaseDir = path.join(betterSqlitePkg, 'build', 'Release');
    const defaultBinary = path.join(releaseDir, 'better_sqlite3.node');
    // electron binary 必须带 `.node` 后缀：better-sqlite3 12.x 的
    // database.js:52 用 `replace(/(\.node)?$/, '.node')` 强制 .node 后缀。
    // 之前用 `better_sqlite3.node.electron`（无 .node）会被强制加 .node 变成
    // `better_sqlite3.node.electron.node` → 找不到，应用启动就崩。
    // 改为 `better_sqlite3.electron.node`（有 .node 后缀），replace 不会改它。
    const electronBinary = path.join(releaseDir, 'better_sqlite3.electron.node');

    // host Node binary（vitest / 任何 Node 进程需要）
    console.log('[setup] running better-sqlite3 prebuild-install (node runtime)');
    try {
      execFileSync(process.execPath, [prebuildBinPath], {
        cwd: betterSqlitePkg,
        stdio: 'inherit',
      });
    } catch (err) {
      console.error(`[setup] better-sqlite3 node prebuild-install failed (non-fatal): ${err.message}`);
    }

    // Electron 33 binary（pnpm dev / production 主进程需要）
    // Electron 33.x → prebuild tag 是 electron-v130
    // prebuild-install 默认覆盖 build/Release/better_sqlite3.node，
    // 所以先备份 node binary，再装 electron 并另存，最后还原 node binary。
    console.log('[setup] running better-sqlite3 prebuild-install (electron runtime)');
    try {
      const tmpNodeBackup = path.join(releaseDir, 'better_sqlite3.node.nodeBak');
      if (existsSync(defaultBinary)) {
        mkdirSync(releaseDir, { recursive: true });
        copyFileSync(defaultBinary, tmpNodeBackup);
      }
      execFileSync(
        process.execPath,
        [prebuildBinPath, '--runtime=electron', '--target=33.0.0'],
        { cwd: betterSqlitePkg, stdio: 'inherit' },
      );
      // 把刚下载的 electron binary 另存，名字带 .electron 后缀
      if (existsSync(defaultBinary)) {
        copyFileSync(defaultBinary, electronBinary);
      }
      // 还原 node binary 到默认位置
      if (existsSync(tmpNodeBackup)) {
        copyFileSync(tmpNodeBackup, defaultBinary);
        // 清理临时备份
        try {
          require('node:fs').unlinkSync(tmpNodeBackup);
        } catch {
          // ignore
        }
      }
      console.log(`[setup] electron binary stored at ${electronBinary}`);
    } catch (err) {
      console.error(`[setup] better-sqlite3 electron prebuild-install failed (non-fatal): ${err.message}`);
    }
  } else {
    console.warn('[setup] prebuild-install not found, skipping better-sqlite3');
  }
} else {
  console.warn('[setup] better-sqlite3 package not found, skipping');
}

// 3. esbuild（每个 esbuild 子版本都跑 install.js）
if (existsSync(pnpmDir)) {
  for (const entry of readdirSync(pnpmDir)) {
    if (!entry.startsWith('esbuild@')) continue;
    const esbuildDir = path.join(pnpmDir, entry, 'node_modules/esbuild');
    if (existsSync(esbuildDir)) {
      tryRunNode(path.join(esbuildDir, 'install.js'), `esbuild install (${entry})`);
    }
  }
}

console.log('[setup] done. (@napi-rs/keyring ships with native binding via pnpm install.)');
