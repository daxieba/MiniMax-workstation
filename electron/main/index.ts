import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell } from 'electron';
import { join } from 'node:path';
import { ThemeSourceSchema } from '../shared/types';
import { closeDb, createDbClient, resolveDbPath, type WorkstationDb } from '../../db/client';
import { CredentialManager } from './credentials/credentialManager';
import { cleanupAiChatForSender, registerAiIpc } from './ipc/ai';
import { registerAppIpc, type AppDbStatus } from './ipc/app';
import { registerAppSettingsIpc } from './ipc/appSettings';
import { registerBackupIpc } from './ipc/backup';
import { registerDialogIpc } from './ipc/dialog';
import { registerInboxIpc } from './ipc/inbox';
import { registerNoteIpc } from './ipc/note';
import { registerProjectIpc } from './ipc/project';
import { registerReviewIpc } from './ipc/review';
import { registerSearchIpc } from './ipc/search';
import { registerTaskIpc } from './ipc/task';
import { registerUpdaterIpc } from './ipc/updater';
import { createProviders } from './providers/factory';

// 调试开关（**env-gated，默认关闭，prod 不进 user-facing 路径**）：
//   MINIMAX_VERBOSE_LOG=1     启用 enable-logging，让主进程 console.log/warn/error 落到 stdout
//                              （Electron 主进程默认吞掉 console，必须在 app ready 之前 appendSwitch）
//   MINIMAX_CDP_PORT=<n>      启用 Chrome DevTools Protocol（remote-debugging-port），
//                              可用 ws://localhost:<n>/devtools/page/<id> 远程 evaluate
//   MINIMAX_RENDERER_CONSOLE=1 把渲染端 console-message 事件转发到主进程 stdout
//                              （在 createWindow 内按 env 注册 listener，默认不注册）
//   MINIMAX_AUTO_TEST=1       启动后自动跑一组 IPC smoke（直接 import handler 函数调）
//   MINIMAX_AUTO_TEST_EXIT=1  auto-test 完成后 app.quit()（CI 用，不阻塞 GUI 用户 session）
//
// 这些开关是 v0.1.0.4 调试能力**永久保留**——下次类似 prod-only bug 出现时，能快速定位。
if (process.env['MINIMAX_VERBOSE_LOG'] === '1') {
  app.commandLine.appendSwitch('enable-logging');
  app.commandLine.appendSwitch('v', '1');
}
if (process.env['MINIMAX_CDP_PORT']) {
  app.commandLine.appendSwitch('remote-debugging-port', process.env['MINIMAX_CDP_PORT']);
  app.commandLine.appendSwitch('remote-allow-origins', '*');
}

/**
 * 主进程入口（T1-1 最小骨架 + T1-2 主题 + T1-3 SQLite/Drizzle/IPC 集成）。
 *
 * 安全配置（遵循 PROJECT_IDENTITY.md §6.2，T1-1 已落地，本卡**不许改**）：
 *   - contextIsolation: true
 *   - nodeIntegration: false
 *   - sandbox: true
 *   - preload:    走 contextBridge 暴露白名单 API
 *   - CSP:        通过 onHeadersReceived 注入
 *
 * T1-3 在不动以上安全配置的前提下，新增：
 *   - 启动时 `createDbClient(...)` 初始化 SQLite + 跑迁移
 *   - 注册 4 个 `app:*` IPC handler（version / dbStatus / getAppMeta / setAppMeta）
 *   - app 退出时 `closeDb(...)` 释放 native handle
 *
 * 不写任何业务 IPC handler（task:* / inbox:* / ai:* / kb:* / review:*），
 * 这些留到 T2-x / T3-x / T4-x / T5-x 业务卡。
 */

/** 内容安全策略（CSP）最小限制。 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self' ws: http: https:",
].join('; ');

/** 主题变更事件通道（推送方向：main → renderer）。 */
const THEME_CHANGED_CHANNEL = 'app:theme-changed';

/** 解析后的主题类型。 */
type ResolvedTheme = 'light' | 'dark';

/**
 * db 客户端与状态（启动期初始化，app 生命周期内常驻）。
 * 任何 module-scope 状态都要在 quit 时清理。
 */
let dbClient: WorkstationDb | null = null;
let dbStatus: AppDbStatus = {
  ready: false,
  path: '',
  schemaVersion: 0,
};

/** 将 `nativeTheme` 的状态映射为 ResolvedTheme。 */
function resolveCurrentTheme(): ResolvedTheme {
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
}

/** 把变更推给所有渲染窗口。 */
function broadcastThemeChange(): void {
  const resolved = resolveCurrentTheme();
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(THEME_CHANGED_CHANNEL, resolved);
    }
  }
}

/** 创建主窗口。 */
function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    title: 'MiniMaxCode 个人工作台',
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // CSP：通过响应头注入
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [CSP],
      },
    });
  });

  // 外链用系统默认浏览器打开，阻止新窗口
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  // 阻止导航到非自身 URL
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const allowedPrefix = process.env['ELECTRON_RENDERER_URL'];
    if (allowedPrefix && url.startsWith(allowedPrefix)) return;
    event.preventDefault();
  });

  // 调试开关：MINIMAX_RENDERER_CONSOLE=1 把渲染端 console-message 转发到主进程 stdout
  // —— 方便在没有 dev tools 访问的场景（如远程 / CI / 老大跑 build 验证）定位渲染端错误。
  // **生产构建**也保留这个开关（默认关闭），不进 user-facing 文案。
  if (process.env['MINIMAX_RENDERER_CONSOLE'] === '1') {
    mainWindow.webContents.on('console-message', (event) => {
      // Electron 33 起签名变了：event 是 ConsoleMessageEvent 对象（带 level/message/sourceId/lineNumber）
      const msg = event as unknown as {
        level: 'debug' | 'info' | 'warning' | 'error' | 'verbose';
        message: string;
        sourceId: string;
        lineNumber: number;
      };
      const tag = `[renderer:${msg.level}]`;
      const where = `${msg.sourceId}:${msg.lineNumber}`;
      const line = `${tag} ${msg.message} (${where})\n`;
      // 用 process.stdout / stderr 直写，绕开 no-console lint 规则
      if (msg.level === 'error') {
        process.stderr.write(line);
      } else if (msg.level === 'warning') {
        process.stderr.write(line);
      } else {
        process.stdout.write(line);
      }
    });
  }

  // 调试开关：MINIMAX_OPEN_DEVTOOLS=1 自动开 dev tools
  // —— **仅**用于本地调试（默认关闭），不进 user-facing 文案。
  if (process.env['MINIMAX_OPEN_DEVTOOLS'] === '1') {
    mainWindow.webContents.once('did-finish-load', () => {
      mainWindow.webContents.openDevTools({ mode: 'detach' });
    });
  }

  // 加载 renderer：dev 走 Vite dev server，prod 走本地文件
  if (process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });
}

/** 注册主题相关 IPC handler。 */
function registerThemeIpc(): void {
  ipcMain.handle('app:getThemeSource', () => {
    return nativeTheme.themeSource;
  });

  ipcMain.handle('app:getResolvedTheme', () => {
    return resolveCurrentTheme();
  });

  // 设置主题源（Zod 校验入参）
  ipcMain.handle('app:setThemeSource', (_evt, raw: unknown) => {
    const parsed = ThemeSourceSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        ok: false as const,
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Invalid theme source',
          details: parsed.error.flatten(),
        },
      };
    }
    nativeTheme.themeSource = parsed.data;
    return {
      ok: true as const,
      data: { source: nativeTheme.themeSource, resolved: resolveCurrentTheme() },
    };
  });
}

app.whenReady().then(() => {
  // v0.3.0: Windows 通知需要 AppUserModelId 才能正确归属到应用 + 显示应用名
  // 必须在 app ready 之后、第一次 Notification 之前设置
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.MiniMax.workstation');
  }

  // 默认跟随系统；渲染端启动时调用 setThemeSource 同步 localStorage 中的偏好。
  nativeTheme.themeSource = 'system';

  // 1. 初始化 db（T1-3 集成点）
  try {
    const isDev = !app.isPackaged;
    const appPath = app.getAppPath();
    const userDataDir = app.getPath('userData');
    const dbPath = resolveDbPath({
      env: process.env,
      isDev,
      appPath,
      userDataDir,
    });
    const created = createDbClient(dbPath, appPath);
    dbClient = created.db;
    dbStatus = {
      ready: true,
      path: created.info.path,
      schemaVersion: created.info.schemaVersion,
    };
  } catch (err) {
    // db 启动失败 → 弹窗 + 退出（PROJECT_IDENTITY.md §7.2）
    const message = err instanceof Error ? err.message : String(err);
    const code = (err as { code?: string }).code ?? 'PERSISTENCE_FAILED';
    dialog.showErrorBox(
      '数据库初始化失败',
      `无法启动应用：db 初始化失败（${code}）。\n\n${message}\n\n请尝试重启或联系开发者。`,
    );
    app.exit(1);
    return;
  }

  // 2. 注册 IPC handler（T1-2 主题 + T1-3 app:* + T2-2 inbox:* + T2-3 project:* + T2-3 task:* + T3-1 ai:*）
  registerThemeIpc();
  registerAppIpc({
    db: dbClient,
    dbStatus,
    appVersion: app.getVersion(),
  });
  registerInboxIpc({ db: dbClient });
  registerProjectIpc({ db: dbClient });
  registerTaskIpc({ db: dbClient });
  registerNoteIpc({ db: dbClient });
  registerSearchIpc({ db: dbClient });

  // T3-2：实例化真实 AI provider + 注册到 registry + 注册 AI IPC
  const credentialManager = new CredentialManager();
  createProviders({ credentialManager });
  registerAiIpc({
    db: dbClient,
    credentialManager,
  });

  // T5-1：注册复盘 IPC（依赖 db + credentialManager —— generateDraft 走 handleAiExtractJson）
  registerReviewIpc({
    db: dbClient,
    credentialManager,
  });

  // T5-2：注册 dialog / 备份 / 设置 IPC
  registerDialogIpc({
    getFocusedWindow: () => BrowserWindow.getFocusedWindow() ?? null,
  });
  const appVersion = app.getVersion();
  const userDataDir = app.getPath('userData');
  const dbPath = dbStatus.path; // 启动期已算好的 db 绝对路径
  const backupDeps = {
    db: dbClient,
    appVersion,
    userDataDir,
    dbPath,
  };
  registerBackupIpc(backupDeps);
  registerAppSettingsIpc(backupDeps);

  // T5-3：注册应用更新 IPC（骨架，env-gated，**不**接远端）
  registerUpdaterIpc();

  // 监听系统主题变化，转发给所有渲染窗口
  nativeTheme.on('updated', () => {
    broadcastThemeChange();
  });

  createWindow();

  // 调试：MINIMAX_AUTO_TEST=1 时，渲染端 ready-to-show 后跑一组 IPC 验证
  if (process.env['MINIMAX_AUTO_TEST'] === '1') {
    const mainWindow = BrowserWindow.getAllWindows()[0];
    if (mainWindow) {
      mainWindow.once('ready-to-show', () => {
        runAutoTest();
      });
    }
  }

  // T3-3：webContents 销毁时清理 ai chat 控制器（避免悬挂 AbortController）
  app.on('web-contents-created', (_event, contents) => {
    contents.on('destroyed', () => {
      cleanupAiChatForSender(contents.id);
    });
  });

  app.on('activate', () => {
    // macOS：点击 dock 图标时重建窗口
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  // Windows / Linux：所有窗口关闭后退出
  if (process.platform !== 'darwin') app.quit();
});

/** app 退出前释放 db native handle。 */
app.on('will-quit', () => {
  if (dbClient) {
    closeDb(dbClient);
    dbClient = null;
  }
});

/**
 * 调试 auto-test（MINIMAX_AUTO_TEST=1）：
 *   主进程直接 import + 调各 IPC handler（绕开 ipcMain / 渲染端），结果打 stdout。
 *   用于无 GUI 验证 IPC 形状 + db schema 健康。
 *   **生产代码不依赖**——main bundle 编译时若 env var 关闭，runAutoTest 不会被调。
 */
async function runAutoTest(): Promise<void> {
  if (!dbClient) {
    process.stdout.write('[auto-test] FAIL: dbClient not initialized\n');
    return;
  }
  const userDataDir = app.getPath('userData');
  const dbPath = dbStatus?.path ?? join(userDataDir, 'workstation.db');
  const appVersion = app.getVersion();
  // review handler 也要 credentialManager（review:generateDraft 内部调 ai:extractJson）
  // 创建一个 stub：不连 keytar，但能通过 hasKey/getConfig 等基础检查
  const credentialManager = new CredentialManager();
  const baseDeps = { db: dbClient, credentialManager };
  // backup / appSettings / dialog 等需要 userDataDir + dbPath + appVersion
  const backupDeps = { db: dbClient, userDataDir, dbPath, appVersion, credentialManager };
  const appSettingsDeps = { db: dbClient, userDataDir, dbPath, appVersion };
  const reviewDeps = { db: dbClient, credentialManager };
  const tests: Array<[string, () => Promise<unknown>]> = [
    ['inbox.list({})', () => import('./ipc/inbox').then(m => m.handleInboxList(baseDeps, {}))],
    ['inbox.add({content:"smoke", kind:"note"})', () => import('./ipc/inbox').then(m => m.handleInboxAdd(baseDeps, { content: `auto-test-${Date.now()}`, kind: 'note' }))],
    ['project.list({})', () => import('./ipc/project').then(m => m.handleProjectList(baseDeps, {}))],
    ['task.list({})', () => import('./ipc/task').then(m => m.handleTaskList(baseDeps, {}))],
    ['note.list({})', () => import('./ipc/note').then(m => m.handleNoteList(baseDeps, {}))],
    // search handler zod 要求 query min 1 字符（设计如此 —— 空 query 走 UI 默认）
    ['search.query({query:"auto-test"})', () => import('./ipc/search').then(m => m.handleSearchQuery(baseDeps, { query: 'auto-test' }))],
    ['ai.listProviders()', () => import('./ipc/ai').then(m => m.handleAiListProviders(baseDeps, {}))],
    ['review.listRecent({})', () => import('./ipc/review').then(m => m.handleReviewListRecent(reviewDeps, {}))],
    ['app.getPaths()', () => import('./ipc/backup').then(m => m.handleGetPaths(backupDeps))],
    ['app.listBackups()', () => import('./ipc/backup').then(m => m.handleListBackups(backupDeps))],
    ['app.getSettings()', () => import('./ipc/appSettings').then(m => m.handleGetSettings(appSettingsDeps))],
  ];
  let pass = 0, fail = 0;
  for (const [label, fn] of tests) {
    try {
      await fn();
      pass++;
      process.stdout.write(`[auto-test] PASS ${label}\n`);
    } catch (err) {
      // 兼容结构化 IPC 错误（plain object {code, message}）和 Error 实例
      const msg = err instanceof Error
        ? err.message
        : (typeof err === 'object' && err !== null && 'message' in err
            ? JSON.stringify(err)
            : String(err));
      process.stdout.write(`[auto-test] FAIL ${label} -> ${msg}\n`);
      fail++;
    }
  }
  process.stdout.write(`[auto-test] done: ${pass} pass, ${fail} fail\n`);
  // 测试完成后退出（CI 用，不阻塞 GUI 用户的 session）
  if (process.env['MINIMAX_AUTO_TEST_EXIT'] === '1') {
    setTimeout(() => app.quit(), 100);
  }
}
