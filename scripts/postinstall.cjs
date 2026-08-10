#!/usr/bin/env node
/* eslint-env node */
/**
 * 占位文件 —— 已被 scripts/setup.cjs 取代
 *
 * 历史：早期尝试用 `pnpm install` 内置 postinstall 钩子装 native binary，
 *       因 pnpm 11 + --ignore-scripts 标志会一并跳过 postinstall 而失败。
 *
 * 当前：完整 native binary 安装由 `pnpm run setup` 提供，调用 scripts/setup.cjs。
 *
 * 后续若要恢复 pnpm 11 标准 onlyBuiltDependencies 模式，需要：
 *   1. 验证 @napi-rs/keyring 全部平台 prebuilt 都齐（T3-1 已替代 keytar）
 *   2. 把 onlyBuiltDependencies 加上 '@napi-rs/keyring', 'esbuild', 'electron',
 *      'better-sqlite3'
 *   3. 删除本占位文件
 */
console.log('[postinstall] deprecated. use "pnpm run setup" instead. see scripts/setup.cjs');
