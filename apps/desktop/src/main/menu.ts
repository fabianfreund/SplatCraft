import { app, Menu, shell, type MenuItemConstructorOptions } from 'electron';
import type { MenuAction } from '@shared/api';

export interface MenuHandlers {
  /** Forward a command to the renderer. */
  action(a: MenuAction): void;
  openProject(): void;
  closeProject(): void;
  hasProject(): boolean;
  checkForUpdates(): void;
}

export function buildMenu(h: MenuHandlers) {
  const isMac = process.platform === 'darwin';
  const dev = !app.isPackaged;

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? ([
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              { label: 'Check for Updates…', click: () => h.checkForUpdates() },
              { type: 'separator' },
              { label: 'Settings…', accelerator: 'Cmd+,', click: () => h.action('app.settings') },
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          },
        ] satisfies MenuItemConstructorOptions[])
      : []),
    {
      label: 'File',
      submenu: [
        { label: 'New Project…', accelerator: 'CmdOrCtrl+N', click: () => h.action('project.new') },
        { label: 'Open…', accelerator: 'CmdOrCtrl+O', click: () => h.openProject() },
        { role: 'recentDocuments', visible: isMac, submenu: [{ role: 'clearRecentDocuments' }] },
        { type: 'separator' },
        { label: 'Close Project', accelerator: 'CmdOrCtrl+Shift+W', enabled: h.hasProject(), click: () => h.closeProject() },
        ...(isMac
          ? ([{ role: 'close' }] satisfies MenuItemConstructorOptions[])
          : ([{ type: 'separator' }, { label: 'Settings…', accelerator: 'Ctrl+,', click: () => h.action('app.settings') }, { role: 'quit' }] satisfies MenuItemConstructorOptions[])),
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        ...(dev
          ? ([{ role: 'reload' }, { role: 'forceReload' }, { role: 'toggleDevTools' }, { type: 'separator' }] satisfies MenuItemConstructorOptions[])
          : []),
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        { label: 'Open Data Folder', click: () => void shell.openPath(app.getPath('userData')) },
        ...(isMac ? [] : ([{ label: 'Check for Updates…', click: () => h.checkForUpdates() }] satisfies MenuItemConstructorOptions[])),
        ...(dev ? [] : ([{ type: 'separator' }, { role: 'toggleDevTools' }] satisfies MenuItemConstructorOptions[])),
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
