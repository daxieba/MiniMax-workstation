#!/usr/bin/env node
/**
 * 清理 build 失败残留 + Chromium 临时缓存
 *
 * 背景：v0.1.0 → v0.1.0.1 期间 electron-builder 跑过 5+ 次失败（7za symlink 错），
 *       每次失败我都把产物 rename 为 dist.bad{1,2,3,4,5,6}.old 留底；现在 5 个 303MB
 *       备份都还在。app 启动时崩，userData 只有 Chromium cache 没真数据。
 *
 * 清理目标（~1.5 GB）：
 *   - 5 个 dist.bad2.old - dist.bad6.old 目录（每次失败的完整 win-unpacked）
 *   - userData 的 Cache/ + Code Cache/ + GPUCache/ + Dawn*Cache/ + Network/
 *     （Chromium HTTP cache + V8 byte cache + GPU shader cache，下次启动自动重建）
 *   - 根目录 dist-build.log.*.old 临时日志
 *   - 根目录 *.old.txt 调试临时文件
 *
 * 保留：
 *   - node_modules, dist\win-unpacked, out, .git, 所有源码
 *   - userData/Preferences + Local State + Local Storage（Electron 状态，重建需重设）
 *
 * 跑法：node scripts/cleanup-build-artifacts.cjs
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');

const targets = [
  // 5 个失败 build 的完整产物（~1.5 GB）
  { type: 'dir', rel: 'dist.bad2.old' },
  { type: 'dir', rel: 'dist.bad3.old' },
  { type: 'dir', rel: 'dist.bad4.old' },
  { type: 'dir', rel: 'dist.bad5.old' },
  { type: 'dir', rel: 'dist.bad6.old' },
  // 根目录临时日志
  { type: 'file', rel: 'dist-build.log.bad' },
  { type: 'file', rel: 'dist-build.log.v2.old' },
  { type: 'file', rel: 'dist-build.log.v3.old' },
  { type: 'file', rel: 'dist-build.log.v4.old' },
  { type: 'file', rel: 'dist-build.log.v5.old' },
  { type: 'file', rel: 'dist-build.log.v6.old' },
  { type: 'file', rel: 'dist-build.log.v7.old' },
  // 根目录调试临时文件
  { type: 'file', rel: '7z-list.old.txt' },
  { type: 'file', rel: '7za-help.old.txt' },
  { type: 'file', rel: '7za-help.2.txt' },
  { type: 'file', rel: '7za-ver.old.txt' },
  { type: 'file', rel: '7za-version.old.txt' },
  { type: 'file', rel: 'full-help.old.txt' },
  { type: 'file', rel: 'list-193.old.txt' },
  { type: 'file', rel: 'list-953.old.txt' },
  { type: 'file', rel: 'test-out.old.txt' },
];

const userDataCache = [
  'Cache',
  'Code Cache',
  'GPUCache',
  'DawnGraphiteCache',
  'DawnWebGPUCache',
  'Network',
  'blob_storage',
  'Dictionaries',
  'Shared Dictionary',
];

function rm(target) {
  const p = path.join(projectRoot, target.rel);
  if (!fs.existsSync(p)) return null;
  let size = 0;
  try {
    if (fs.statSync(p).isDirectory()) {
      size = walkSize(p);
    } else {
      size = fs.statSync(p).size;
    }
    fs.rmSync(p, { recursive: true, force: true });
  } catch (err) {
    return { target: target.rel, size, ok: false, err: err.message };
  }
  return { target: target.rel, size, ok: true };
}

function walkSize(p) {
  let total = 0;
  for (const entry of fs.readdirSync(p, { withFileTypes: true })) {
    const child = path.join(p, entry.name);
    if (entry.isDirectory()) total += walkSize(child);
    else if (entry.isFile()) total += fs.statSync(child).size;
  }
  return total;
}

let totalFreed = 0;
let totalOk = 0;
let totalSkip = 0;
let totalErr = 0;

console.log('=== 清理 1：根目录失败 build 残留 + 调试临时文件 ===\n');
for (const t of targets) {
  const r = rm(t);
  if (r === null) {
    totalSkip++;
    continue;
  }
  if (r.ok) {
    totalOk++;
    totalFreed += r.size;
    console.log('  deleted: ' + r.target + '  (' + (r.size / 1024 / 1024).toFixed(1) + ' MB)');
  } else {
    totalErr++;
    console.log('  FAILED: ' + r.target + '  -- ' + r.err);
  }
}

// userData 缓存清理（仅当 userData 存在时）
const ud = path.join(process.env.APPDATA || '', 'minimax-workstation');
if (fs.existsSync(ud)) {
  console.log('\n=== 清理 2：userData Chromium 缓存（app 重启会重建）===\n');
  for (const sub of userDataCache) {
    const p = path.join(ud, sub);
    if (!fs.existsSync(p)) continue;
    try {
      const size = walkSize(p);
      fs.rmSync(p, { recursive: true, force: true });
      totalOk++;
      totalFreed += size;
      console.log('  deleted: ' + path.join('userData', sub) + '  (' + (size / 1024 / 1024).toFixed(1) + ' MB)');
    } catch (err) {
      totalErr++;
      console.log('  FAILED: ' + sub + '  -- ' + err.message);
    }
  }
} else {
  console.log('\n(userData not found, skip)');
}

console.log('\n=== 总结 ===');
console.log('  成功清理: ' + totalOk + ' 项');
console.log('  跳过（不存在）: ' + totalSkip + ' 项');
console.log('  失败: ' + totalErr + ' 项');
console.log('  释放空间: ' + (totalFreed / 1024 / 1024).toFixed(1) + ' MB');
