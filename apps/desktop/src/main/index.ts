import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { app, BrowserWindow, dialog, shell, webContents } from 'electron';
import { classifySource, PROJECT_EXT, PROJECT_FILE } from '@splatcraft/core';
import { IPC, type MenuAction } from '@shared/api';
import { broadcast, createHandlers, dispatch, registerIpc } from './ipc';
import { buildMenu } from './menu';
import { handleFileProtocol, registerFileSchemePrivileges } from './protocol';
import { createServices, type Services } from './services';
import { EngineEventHub } from './services/events';
import { PreviewRecorder } from './services/previews';
import { runScreenshot, runSelfTest } from './verify';
import appIcon from '../../resources/icon.png?asset';
import appIconMac from '../../resources/icon-mac.png?asset';

const here = import.meta.dirname;
const RENDERER_DEV_URL = process.env['ELECTRON_RENDERER_URL'];
const RENDERER_FILE = path.join(here, '../renderer/index.html');
const PRELOAD = path.join(here, '../preload/index.cjs');

let mainWindow: BrowserWindow | null = null;
let services: Services | null = null;
/** Project paths received before services were ready (argv / open-file). */
const pendingOpen: string[] = [];

registerFileSchemePrivileges();

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    const dir = projectFromArgv(argv);
    if (dir) void openProject(dir);
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  // macOS: double-clicking a .splatcraft folder / dropping on the dock icon.
  app.on('open-file', (e, file) => {
    e.preventDefault();
    if (services) void openProject(file);
    else pendingOpen.push(file);
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', () => {
    services?.updater.stop();
    services?.engine.cancel();
    services?.monitor.dispose();
  });

  app.whenReady().then(main).catch((e) => {
    console.error('[main] startup failed', e);
    app.exit(1);
  });
}

async function main() {
  if (process.platform === 'win32') app.setAppUserModelId('dev.splatcraft.app');
  // Packaged builds take the icon from the bundle; in dev the dock would show Electron's.
  if (process.platform === 'darwin' && !app.isPackaged) app.dock?.setIcon(appIconMac);
  services = await createServices();
  const s = services;

  const hub = new EngineEventHub((e) => broadcast(IPC.engineEvent, e));
  const recorder = new PreviewRecorder();
  s.engine.on('event', (e) => {
    hub.push(e);
    recorder.onEvent(s.projects.currentProject, e);
    if (e.type === 'run.start') s.monitor.setKeepAlive(true);
    if (e.type === 'run.done') s.monitor.setKeepAlive(false);
    if (e.type === 'stage.preview' && e.preview.kind === 'images' && e.preview.paths.length) {
      void s.projects.notePreviewImage(e.preview.paths[e.preview.paths.length - 1]!);
    }
  });
  s.monitor.on('sample', (sample) => {
    for (const id of s.monitor.subscribers()) webContents.fromId(id)?.send(IPC.monitorSample, sample);
  });
  s.updater.on('state', (st) => broadcast(IPC.updateState, st));
  s.projects.on('changed', (p) => {
    broadcast(IPC.projectChanged, p);
    if (p) app.addRecentDocument(p.dir);
    rebuildMenu();
  });

  handleFileProtocol(() => {
    const roots = [path.join(app.getPath('userData'), 'thumbnails'), ...s.projects.recentDirs(), ...s.projects.previewPaths()];
    const p = s.projects.currentProject;
    if (p) {
      roots.push(p.dir);
      // Linked (not copied) sources live outside the project folder.
      // Only individual media files — never directories — from a (possibly shared) project.json.
      for (const src of p.meta.sources) {
        if (src.mode === 'link' && path.isAbsolute(src.path) && classifySource(src.path) !== 'other') roots.push(src.path);
      }
    }
    return roots;
  });

  const handlers = createHandlers(s, hub);
  registerIpc(handlers, isTrustedUrl);

  rebuildMenu();

  if (process.env['SPLATCRAFT_SELFTEST']) {
    await runSelfTest(handlers, dispatch, process.env['SPLATCRAFT_SELFTEST'], s.monitor);
    app.exit(0);
    return;
  }

  // Projects requested on start: env (for screenshots), argv, macOS open-file.
  const initial = process.env['SPLATCRAFT_OPEN_PROJECT'] ?? projectFromArgv(process.argv) ?? pendingOpen.pop();
  if (initial) await openProject(initial);

  createWindow();
  s.updater.start();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}

function rebuildMenu() {
  buildMenu({
    action: (a: MenuAction) => {
      const win = BrowserWindow.getFocusedWindow() ?? mainWindow;
      win?.webContents.send(IPC.menuAction, a);
    },
    openProject: () => {
      services?.projects.open().catch((e) => sendError(e));
    },
    closeProject: () => {
      services?.engine.cancel();
      void services?.projects.close();
    },
    hasProject: () => !!services?.projects.currentProject,
    checkForUpdates: () => {
      void services?.updater.check();
      const win = BrowserWindow.getFocusedWindow() ?? mainWindow;
      win?.webContents.send(IPC.menuAction, 'app.updates' satisfies MenuAction);
    },
  });
}

function sendError(e: unknown) {
  console.error('[main]', e);
  dialog.showErrorBox('SplatCraft', e instanceof Error ? e.message : String(e));
}

async function openProject(dir: string) {
  if (!services) return void pendingOpen.push(dir);
  try {
    if (services.engine.running) throw new Error('Stop the running pipeline before opening another project.');
    await services.projects.open(dir);
  } catch (e) {
    sendError(e);
  }
}

function projectFromArgv(argv: string[]): string | undefined {
  // Skip the executable (and the app path in dev: `electron .`).
  for (const arg of argv.slice(app.isPackaged ? 1 : 2)) {
    if (!arg || arg.startsWith('-')) continue;
    const abs = path.resolve(arg);
    try {
      if (arg.endsWith(PROJECT_EXT) || (statSync(abs).isDirectory() && existsSync(path.join(abs, PROJECT_FILE)))) return abs;
      if (path.basename(abs) === PROJECT_FILE) return path.dirname(abs);
    } catch {
      /* not a path */
    }
  }
  return undefined;
}

function isTrustedUrl(url: string) {
  if (RENDERER_DEV_URL && url.startsWith(RENDERER_DEV_URL)) return true;
  return url.startsWith(pathToFileURL(path.dirname(RENDERER_FILE)).href + '/');
}

function createWindow() {
  const isMac = process.platform === 'darwin';
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    title: 'SplatCraft',
    icon: appIcon,
    backgroundColor: '#0b0c0f',
    ...(isMac ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 16, y: 16 } } : {}),
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  });
  mainWindow = win;

  win.once('ready-to-show', () => win.show());
  const sendFullScreen = () => win.webContents.send(IPC.fullScreen, win.isFullScreen());
  win.on('enter-full-screen', sendFullScreen);
  win.on('leave-full-screen', sendFullScreen);
  win.webContents.on('did-finish-load', sendFullScreen);
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });

  // Never open new windows or navigate away from the app; external links go to the browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!isTrustedUrl(url)) {
      e.preventDefault();
      if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    }
  });
  win.webContents.on('render-process-gone', (_e, d) => console.error('[renderer] gone:', d.reason));
  win.webContents.on('console-message', (e) => {
    if (process.env['SPLATCRAFT_SCREENSHOT'] && (e.level === 'error' || e.level === 'warning')) {
      console.log(`[renderer:${e.level}] ${e.message}`);
    }
  });

  if (process.env['SPLATCRAFT_SCREENSHOT']) runScreenshot(win, process.env['SPLATCRAFT_SCREENSHOT']);

  if (RENDERER_DEV_URL) void win.loadURL(RENDERER_DEV_URL);
  else void win.loadFile(RENDERER_FILE);
}
