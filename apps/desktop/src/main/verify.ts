/**
 * Env-gated verification hooks (no effect unless the env var is set):
 *  - SPLATCRAFT_SCREENSHOT=/abs/out.png  [SPLATCRAFT_SCREENSHOT_DELAY=ms, default 2500]
 *      capture the window after the renderer loaded, then quit.
 *  - SPLATCRAFT_SELFTEST=/abs/dir
 *      exercise the IPC handlers in-process (creates a project in dir), log, exit.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { app, net, type BrowserWindow } from 'electron';
import { toFileUrl } from '@shared/file-url';
import type { CallContext, dispatch as Dispatch } from './ipc';

export function runScreenshot(win: BrowserWindow, out: string) {
  const delay = Number(process.env['SPLATCRAFT_SCREENSHOT_DELAY'] ?? 2500);
  win.webContents.once('did-fail-load', (_e, code, desc, url) => console.error(`[screenshot] load failed ${code} ${desc} ${url}`));
  win.webContents.once('did-finish-load', () => {
    setTimeout(async () => {
      try {
        const img = await win.webContents.capturePage();
        await mkdir(path.dirname(out), { recursive: true });
        await writeFile(out, img.toPNG());
        const { width, height } = img.getSize();
        console.log(`[screenshot] wrote ${out} (${width}x${height})`);
      } catch (e) {
        console.error('[screenshot] failed', e);
      } finally {
        app.exit(0);
      }
    }, delay);
  });
}

export async function runSelfTest(
  handlers: Record<string, any>,
  dispatch: typeof Dispatch,
  dir: string,
  monitor: { sampleOnce(): Promise<unknown>; supportedProviders: string[] },
) {
  const ctx: CallContext = {};
  const call = (m: string, ...args: unknown[]) => dispatch(handlers, ctx, m, args);
  const log = (label: string, v: unknown) => console.log(`[selftest] ${label}:`, typeof v === 'string' ? v : JSON.stringify(v, null, 0)?.slice(0, 600));
  const step = async (label: string, fn: () => Promise<unknown>) => {
    try {
      log(label, await fn());
    } catch (e) {
      console.log(`[selftest] ${label}: ERROR ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  await mkdir(dir, { recursive: true });
  await step('app.info', () => call('app.info'));
  await step('plugins.list', async () => ((await call('plugins.list')) as any[]).map((p) => `${p.id}(${p.stages.length} stages)`));
  await step('pipeline.stages', async () => ((await call('pipeline.stages')) as any[]).map((s) => s.id));
  await step('pipeline.templates', () => call('pipeline.templates'));
  await step('tools.status', async () => ((await call('tools.status')) as any[]).map((t) => `${t.id}:${t.available ? `ok ${t.source} ${t.version ?? ''}` : 'missing'}`));
  await step('unknown method', () => call('fs.rm', '/'));
  const name = `SelfTest-${Date.now()}`;
  await step('projects.create', async () => {
    const p = (await call('projects.create', { name, parentDir: dir })) as any;
    return { dir: p.dir, steps: p.meta.pipeline.steps.map((s: any) => s.stageId), preset: p.meta.pipeline.preset };
  });
  await step('projects.current', async () => ((await call('projects.current')) as any)?.meta.name);
  await step('projects.recent', async () => ((await call('projects.recent')) as any[]).slice(0, 3));
  await step('pipeline.plan', () => call('pipeline.plan'));
  await step('pipeline.setPreset(fast)', async () => ((await call('pipeline.setPreset', 'fast')) as any).pipeline.preset);
  await step('pipeline.update(bad stage)', async () => {
    const cur = (await call('projects.current')) as any;
    return call('pipeline.update', { ...cur.meta.pipeline, steps: [...cur.meta.pipeline.steps, { key: 'x', stageId: 'nope', enabled: true, params: {} }] });
  });
  await step('pipeline.runs', () => call('pipeline.runs'));
  await step('pipeline.metrics(../etc)', () => call('pipeline.metrics', '../etc'));
  await step('pipeline.state', () => call('pipeline.state'));
  await step('monitor providers', async () => monitor.supportedProviders);
  await step('monitor sample', async () => {
    await monitor.sampleOnce(); // first CPU delta needs a baseline
    await new Promise((r) => setTimeout(r, 500));
    return monitor.sampleOnce();
  });

  const cur = (await call('projects.current')) as any;
  if (cur) {
    const metaFile = path.join(cur.dir, 'project.json');
    await step('sc-file project.json', async () => {
      const r = await net.fetch(toFileUrl(metaFile));
      return `${r.status} ${r.headers.get('content-type')} ${(await r.text()).length}B`;
    });
    await step('sc-file range', async () => {
      const r = await net.fetch(toFileUrl(metaFile), { headers: { Range: 'bytes=0-9' } });
      return `${r.status} ${r.headers.get('content-range')} ${JSON.stringify(await r.text())}`;
    });
    await step('sc-file traversal', async () => {
      const r = await net.fetch(toFileUrl(path.join(cur.dir, '..', '..', '..', '..', 'etc', 'hosts')));
      return `${r.status}`;
    });
    await step('sc-file outside', async () => (await net.fetch(toFileUrl('/etc/hosts'))).status);
  }
  const e2e = process.env['SPLATCRAFT_OPEN_PROJECT'];
  if (e2e) {
    await step('projects.open(e2e)', async () => ((await call('projects.open', e2e)) as any)?.meta.name);
    await step('pipeline.runs(e2e)', async () => ((await call('pipeline.runs')) as any[]).slice(0, 2));
    await step('pipeline.latestPreviews(e2e)', async () =>
      ((await call('pipeline.latestPreviews')) as any[]).map((p) => ({ key: p.key, kind: p.preview.kind, path: p.preview.path, n: p.preview.cameras?.length, step: p.preview.step })),
    );
    await step('pipeline.metrics(e2e newest)', async () => {
      const runs = (await call('pipeline.runs')) as any[];
      return ((await call('pipeline.metrics', runs[0]?.runId)) as any[]).length + ' points';
    });
  }
  await step('projects.close', () => call('projects.close'));
  await step('projects.current after close', () => call('projects.current'));
}
