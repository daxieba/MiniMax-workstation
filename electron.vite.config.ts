import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

/**
 * electron-vite 三段配置：main / preload / renderer
 * - main / preload: externalize 依赖，lib 模式构建到 out/{main,preload}/index.js
 * - renderer: React 插件，root 设为项目根，入口 index.html 引用 src/main.tsx
 *
 * 目录约定遵循 PROJECT_IDENTITY.md §2.3：
 *   electron/{main,preload,shared}  →  主进程 / 预加载 / 共享类型
 *   src/                            →  渲染进程（React）
 *   shared/                         →  主/渲染共享类型（独立于 electron/shared/）
 */
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/main',
      lib: {
        entry: resolve(__dirname, 'electron/main/index.ts'),
        formats: ['es'],
      },
      rollupOptions: {
        output: {
          entryFileNames: 'index.js',
        },
      },
    },
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'shared'),
        '@electron-shared': resolve(__dirname, 'electron/shared'),
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/preload',
      lib: {
        entry: resolve(__dirname, 'electron/preload/index.ts'),
        formats: ['cjs'],
      },
      rollupOptions: {
        output: {
          entryFileNames: 'index.cjs',
        },
      },
    },
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'shared'),
        '@electron-shared': resolve(__dirname, 'electron/shared'),
      },
    },
  },
  renderer: {
    root: resolve(__dirname),
    plugins: [react()],
    build: {
      outDir: 'out/renderer',
      rollupOptions: {
        input: resolve(__dirname, 'index.html'),
      },
    },
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
        '@shared': resolve(__dirname, 'shared'),
        '@electron-shared': resolve(__dirname, 'electron/shared'),
      },
    },
    server: {
      port: 5173,
    },
  },
});
