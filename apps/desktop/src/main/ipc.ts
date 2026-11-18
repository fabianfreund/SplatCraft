import path from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, shell, webContents } from 'electron';
import type { PipelineSpec, PresetId } from '@splatcraft/core';
import { IPC, type AppInfo, type OpenProject, type PipelineState } from '@shared/api';
import type { EngineEventHub } from './services/events';
import type { Services } from './services';
import { assertPreset, listRuns, readMetrics, readNotices, validateSpec } from './services/pipeline';
import { latestPreviews } from './services/previews';

/** Context of a call: the calling webContents id (undefined for in-process self-tests). */
export interface CallContext {
  senderId?: number;
}

type Handler = (ctx: CallContext, ...args: any[]) => unknown;

export function broadcast(channel: string, payload: unknown) {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(channel, payload);
}

/**
 * Builds the method table behind `IPC.invoke`. Method names are the
 * `SplatCraftAPI` paths (`projects.recent`, `pipeline.run` …) plus the
 * internal `monitor.subscribe` / `monitor.unsubscribe` used by the preload.
 */
export function createHandlers(s: Services, hub: EngineEventHub): Record<string, Handler> {
  const { registry, toolchain, engine, projects, monitor } = s;

  const handlers: Record<string, Handler> = {
    /* app */
    'app.info': (): AppInfo => ({
      version: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
      electron: process.versions.electron,
    }),
    'app.revealInFolder': (_c, absPath: string) => {
      if (typeof absPath !== 'string' || !path.isAbsolute(absPath)) throw new Error('Absolute path required');
      shell.showItemInFolder(absPath);
    },

    /* projects */
    'projects.recent': () => projects.recent(),
    'projects.removeRecent': (_c, dir: string) => projects.removeRecent(String(dir)),
    'projects.create': async (_c, input) => {
      if (engine.running) throw new Error('Stop the running pipeline first');
      return projects.create(input ?? {});
    },
    'projects.open': async (_c, dir?: string) => {
      if (engine.running) throw new Error('Stop the running pipeline first');
      return projects.open(typeof dir === 'string' ? dir : undefined);
    },
    'projects.current': (): OpenProject | null => projects.current(),
    'projects.close': async () => {
      engine.cancel();
      hub.reset();
      await projects.close();
    },
    'projects.updateMeta': (_c, patch) => projects.updateMeta(patch ?? {}),

    /* sources */
    'sources.add': async (_c, paths?: string[], mode: 'copy' | 'link' = 'copy') => {
      const p = projects.require();
      let files = Array.isArray(paths) ? paths.filter((x): x is string => typeof x === 'string' && path.isAbsolute(x)) : undefined;
      if (!files) {
        const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
        const opts: Electron.OpenDialogOptions = {
          title: 'Add photos or videos',
          buttonLabel: 'Add',
          properties: ['openFile', 'multiSelections'],
          filters: [
            { name: 'Photos & videos', extensions: ['jpg', 'jpeg', 'png', 'tif', 'tiff', 'heic', 'heif', 'webp', 'dng', 'exr', 'mp4', 'mov', 'm4v', 'mkv', 'avi', 'webm', 'insv', '360'] },
            { name: 'All files', extensions: ['*'] },
          ],
        };
        const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
        if (res.canceled) return p.meta;
        files = res.filePaths;
      }
      await p.addSources(files, mode === 'link' ? 'link' : 'copy');
      projects.notify();
      return p.meta;
    },
    'sources.remove': async (_c, ids: string[]) => {
      const p = projects.require();
      await p.removeSources(Array.isArray(ids) ? ids.map(String) : []);
      projects.notify();
      return p.meta;
    },

    /* pipeline */
    'pipeline.stages': () => registry.describeStages(),
    'pipeline.templates': () =>
      [...registry.pipelines.values()].map(({ template: t }) => ({ id: t.id, title: t.title, description: t.description })),
    'pipeline.update': async (_c, spec: PipelineSpec) => {
      const p = projects.require();
      const valid = validateSpec(registry, spec);
      const meta = await p.update((m) => {
        m.pipeline = valid;
      });
      projects.notify();
      return meta;
    },
    'pipeline.setPreset': async (_c, preset: PresetId) => {
      assertPreset(preset);
      const p = projects.require();
      const meta = await p.update((m) => {
        m.pipeline.preset = preset;
      });
      projects.notify();
      return meta;
    },
    'pipeline.plan': () => engine.plan(projects.require()),
    'pipeline.run': (_c, opts?: { untilKey?: string; force?: string[] }) => {
      const project = projects.require();
      const runOpts = {
        untilKey: typeof opts?.untilKey === 'string' ? opts.untilKey : undefined,
        force: Array.isArray(opts?.force) ? opts.force.map(String) : undefined,
      };
      // Resolve as soon as the run has an id; the run itself continues in the background.
      return new Promise<{ runId: string }>((resolve, reject) => {
        const onEvent = (e: { type: string; runId: string }) => {
          if (e.type !== 'run.start') return;
          engine.off('event', onEvent);
          resolve({ runId: e.runId });
        };
        engine.on('event', onEvent);
        engine.run(project, runOpts).then(
          () => engine.off('event', onEvent),
          (err) => {
            engine.off('event', onEvent);
            reject(err);
          },
        );
      });
    },
    'pipeline.cancel': () => engine.cancel(),
    'pipeline.state': (): PipelineState => ({ runningRunId: engine.running, lastEvents: hub.snapshot() }),
    'pipeline.runs': () => (projects.currentProject ? listRuns(projects.currentProject, engine.running) : []),
    'pipeline.metrics': (_c, runId: string) => readMetrics(projects.require(), runId),
    'pipeline.notices': (_c, runId?: string) => readNotices(projects.require(), runId),
    'pipeline.latestPreviews': () => (projects.currentProject ? latestPreviews(engine, projects.currentProject) : []),

    /* tools */
    'tools.status': (_c, refresh?: boolean) => toolchain.statusAll(!!refresh),
    'tools.install': (_c, id: string) =>
      toolchain.install(String(id), (fraction, message) => broadcast(IPC.installProgress, { id, fraction, message })),

    /* plugins */
    'plugins.list': () => [...registry.plugins.values()],

    /* monitor */
    'monitor.history': () => monitor.history(),
    'monitor.subscribe': (c) => {
      if (c.senderId === undefined) return;
      const id = c.senderId;
      const first = !monitor.subscribers().includes(id);
      monitor.subscribe(id);
      // Drop the subscription when that renderer goes away.
      if (first) webContents.fromId(id)?.once('destroyed', () => monitor.unsubscribe(id, true));
    },
    'monitor.unsubscribe': (c) => {
      if (c.senderId !== undefined) monitor.unsubscribe(c.senderId);
    },
  };
  return handlers;
}

/** Calls a handler by name (allowlisted). Used by IPC and the env-gated self-test. */
export async function dispatch(handlers: Record<string, Handler>, ctx: CallContext, method: unknown, args: unknown[]) {
  if (typeof method !== 'string' || !Object.prototype.hasOwnProperty.call(handlers, method)) {
    throw new Error(`Unknown method: ${String(method)}`);
  }
  return handlers[method]!(ctx, ...args);
}

export function registerIpc(handlers: Record<string, Handler>, isTrustedUrl: (url: string) => boolean) {
  ipcMain.handle(IPC.invoke, async (e, method: unknown, ...args: unknown[]) => {
    const url = e.senderFrame?.url ?? '';
    if (!isTrustedUrl(url)) throw new Error('Untrusted sender');
    try {
      return await dispatch(handlers, { senderId: e.sender.id }, method, args);
    } catch (err) {
      // Only the message crosses the bridge; keep it readable.
      throw new Error(err instanceof Error ? err.message : String(err));
    }
  });
}
