import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

/**
 * Vitest 配置：jsdom 环境 + React 插件 + 路径别名
 * 用于渲染进程 / 工具函数的单元测试。
 * 主进程相关单测由后续卡（T2-x）在主进程测试任务卡内补充配置。
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@shared': resolve(__dirname, 'shared'),
      '@electron-shared': resolve(__dirname, 'electron/shared'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
    css: false,
    // T3-1.x: 修 keyring 跨文件 flaky —— forks 进程隔离 + 文件串行
    // - pool: 'forks'   fork 子进程跑测试（threads 在 Windows 上共享 OS keyring 句柄不稳）
    // - isolate: true   每个测试文件独立子进程，彻底隔离全局状态
    // - fileParallelism: false  文件之间串行跑，避免 set/has/get/delete 互踩
    // v0.1.3: 测试数涨到 1056+，maxWorkers 限制为 2 避免 OOM（v0.1.2 是 4）。
    pool: 'forks',
    isolate: true,
    fileParallelism: false,
    maxWorkers: 2,
  },
});
