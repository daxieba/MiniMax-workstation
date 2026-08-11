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
    // **不**用 externalizeDepsPlugin()：
    // electron-builder 把 preload bundle 打进 asar 后，sandbox: true 模式下 preload
    // 只能从 `app.asar/out/preload/` 向上找 `node_modules` —— 但 asar 里没 node_modules
    // （electron-builder.yml `files: out/**/*` 只打包 out 目录），导致 `require('zod')` 失败。
    // 让 vite/rollup 把 zod inline 到 preload bundle（~50KB）彻底解决。
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
