/**
 * Preload (sandboxed, bundled to CommonJS). Exposes `window.splatcraft`
 * implementing `SplatCraftAPI`; all calls go through one `IPC.invoke`
 * channel that main validates against an allowlist.
 */
import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron';
import { IPC, type SplatCraftAPI } from '@shared/api';
import { toFileUrl } from '@shared/file-url';

const invoke = <T>(method: string, ...args: unknown[]) => ipcRenderer.invoke(IPC.invoke, method, ...args) as Promise<T>;

function on<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: IpcRendererEvent, payload: T) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
}

const api: SplatCraftAPI = {
  app: {
    info: () => invoke('app.info'),
    fileUrl: (absPath) => toFileUrl(absPath),
    revealInFolder: (absPath) => invoke('app.revealInFolder', absPath),
    onMenuAction: (cb) => on(IPC.menuAction, cb),
    onFullScreen: (cb) => on(IPC.fullScreen, cb),
  },
  projects: {
    recent: () => invoke('projects.recent'),
    removeRecent: (dir) => invoke('projects.removeRecent', dir),
    create: (input) => invoke('projects.create', input),
    open: (dir) => invoke('projects.open', dir),
    current: () => invoke('projects.current'),
    close: () => invoke('projects.close'),
    updateMeta: (patch) => invoke('projects.updateMeta', patch),
    onChanged: (cb) => on(IPC.projectChanged, cb),
  },
  sources: {
    inspect: (paths) => invoke('sources.inspect', paths),
    add: (items, mode) => invoke('sources.add', items, mode),
    update: (id, patch) => invoke('sources.update', id, patch),
    remove: (ids) => invoke('sources.remove', ids),
    pathForFile: (file) => webUtils.getPathForFile(file),
  },
  pipeline: {
    stages: () => invoke('pipeline.stages'),
    templates: () => invoke('pipeline.templates'),
    update: (spec) => invoke('pipeline.update', spec),
    setPreset: (preset) => invoke('pipeline.setPreset', preset),
    plan: () => invoke('pipeline.plan'),
    run: (opts) => invoke('pipeline.run', opts),
    cancel: () => invoke('pipeline.cancel'),
    state: () => invoke('pipeline.state'),
    runs: () => invoke('pipeline.runs'),
    metrics: (runId) => invoke('pipeline.metrics', runId),
    latestPreviews: () => invoke('pipeline.latestPreviews'),
    notices: (runId) => invoke('pipeline.notices', runId),
    onEvent: (cb) => on(IPC.engineEvent, cb),
  },
  tools: {
    status: (refresh) => invoke('tools.status', refresh),
    install: (id) => invoke('tools.install', id),
    onInstallProgress: (cb) => on(IPC.installProgress, cb),
  },
  plugins: {
    list: () => invoke('plugins.list'),
  },
  monitor: {
    // Main samples only while at least one subscriber exists.
    onSample: (cb) => {
      const off = on(IPC.monitorSample, cb);
      void invoke('monitor.subscribe');
      let done = false;
      return () => {
        if (done) return;
        done = true;
        off();
        void invoke('monitor.unsubscribe');
      };
    },
    history: () => invoke('monitor.history'),
  },
};

contextBridge.exposeInMainWorld('splatcraft', api);
