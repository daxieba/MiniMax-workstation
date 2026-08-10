#!/usr/bin/env node
/**
 * Install the 7za.exe wrapper for electron-builder 25.1.8 on Windows.
 *
 * Why this exists:
 *   electron-builder 25.1.8 hardcodes the 7za CLI switch `-snld`,
 *   which 7-Zip (any version) never supported. On Windows 非管理员
 *   用户 runs, this fails because 7-Zip tries to create symlinks
 *   for the cross-platform darwin / linux subdirs in winCodeSign.
 *
 *   This script compiles `7za-wrapper/Wrapper.cs` to
 *   `node_modules/.pnpm/7zip-bin@5.2.0/node_modules/7zip-bin/win/x64/7za.exe`,
 *   replacing the bundled 7za 21.07. The wrapper translates `-snld`
 *   into `-xr!darwin -xr!linux` (which 7-Zip 21.07 / 26.02 both support)
 *   and then spawns the real binary (saved as 7za-real.exe).
 *
 * Run after every `pnpm install` that re-installs 7zip-bin:
 *   node scripts/install-wrapper.cjs
 *
 * @see 7za-wrapper/Wrapper.cs
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync, execSync } = require('node:child_process');

const projectRoot = path.resolve(__dirname, '..');
const wrapperSrc = path.join(projectRoot, '7za-wrapper', 'Wrapper.cs');
const sevenZipDir = path.join(
  projectRoot,
  'node_modules',
  '.pnpm',
  '7zip-bin@5.2.0',
  'node_modules',
  '7zip-bin',
  'win',
  'x64',
);
const targetExe = path.join(sevenZipDir, '7za.exe');
const realExe = path.join(sevenZipDir, '7za-real.exe');
const backupExe = path.join(sevenZipDir, '7za.exe.bak21');
const cscExe = 'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe';

function bail(msg) {
  console.error('[install-wrapper] ' + msg);
  process.exit(1);
}

if (process.platform !== 'win32') {
  console.log('[install-wrapper] skip (not Windows)');
  process.exit(0);
}
if (!fs.existsSync(wrapperSrc)) {
  bail('Wrapper.cs not found at ' + wrapperSrc);
}
if (!fs.existsSync(sevenZipDir)) {
  bail('7zip-bin not installed (run pnpm install first). dir=' + sevenZipDir);
}
if (!fs.existsSync(cscExe)) {
  bail('csc.exe not found at ' + cscExe + ' — .NET Framework 4.x required');
}

// Detect if already installed
try {
  const current = fs.readFileSync(targetExe);
  if (current.length < 100 * 1024) {
    // Wrapper binary is ~5 KB; real 7za 21.07 is ~1.3 MB; real 7za 26.02 is ~1.2 MB
    console.log('[install-wrapper] wrapper already in place at ' + targetExe);
    process.exit(0);
  }
} catch {}

// Backup the real 7za (one-time)
if (!fs.existsSync(realExe) && fs.existsSync(targetExe)) {
  console.log('[install-wrapper] backing up real 7za to ' + backupExe);
  fs.copyFileSync(targetExe, backupExe);
  fs.renameSync(targetExe, realExe);
} else if (fs.existsSync(realExe)) {
  // already in wrapper mode; just re-compile
  console.log('[install-wrapper] wrapper mode detected; recompiling');
}

// Compile wrapper.cs → 7za.exe
console.log('[install-wrapper] compiling Wrapper.cs → 7za.exe');
const r = spawnSync(
  cscExe,
  [
    '/nologo',
    '/out:' + targetExe,
    '/target:exe',
    '/optimize',
    wrapperSrc,
  ],
  { stdio: 'inherit', windowsHide: true },
);
if (r.status !== 0) {
  bail('csc.exe failed with exit ' + r.status);
}

const stat = fs.statSync(targetExe);
if (stat.size > 100 * 1024) {
  bail('compiled 7za.exe is ' + stat.size + ' bytes — too big, something went wrong');
}
console.log('[install-wrapper] OK — ' + targetExe + ' (' + stat.size + ' bytes)');
console.log('[install-wrapper]   real 7za kept at ' + realExe);
console.log('[install-wrapper]   backup of original at ' + backupExe);
