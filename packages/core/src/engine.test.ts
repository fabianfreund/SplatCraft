import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { PipelineEngine, type EngineEvent } from './engine.js';
import { Project } from './project.js';
import { Registry } from './registry.js';
import { definePlugin, defineStage } from './types.js';

const calls: string[] = [];

const plugin = definePlugin({
  id: 'test',
  name: 'Test',
  version: '1',
  register(api) {
    api.registerStage(
      defineStage({
        id: 'test.a',
        version: '1',
        title: 'A',
        description: '',
        category: 'prepare',
        inputs: ['sources'],
        outputs: ['frames'],
        paramsSchema: z.object({ n: z.number().default(1) }),
        async run(ctx) {
          calls.push('a');
          const out = path.join(ctx.workDir, 'a.txt');
          await writeFile(out, String(ctx.params.n));
          return { outputs: { frames: { path: out } } };
        },
      }),
    );
    api.registerStage(
      defineStage({
        id: 'test.b',
        version: '1',
        title: 'B',
        description: '',
        category: 'train',
        inputs: ['frames'],
        outputs: ['splat'],
        resumable: true,
        paramsSchema: z.object({ slow: z.boolean().default(false) }),
        async run(ctx) {
          calls.push(ctx.resume ? 'b:resume' : 'b');
          if (ctx.params.slow && !ctx.resume) {
            await new Promise((_, reject) => ctx.signal.addEventListener('abort', () => reject(new Error('aborted'))));
          }
          const out = path.join(ctx.workDir, 'b.txt');
          await writeFile(out, (await readFile(ctx.inputs.frames!.path, 'utf8')) + '!');
          return { outputs: { splat: { path: out } } };
        },
      }),
    );
  },
});

async function setup() {
  const registry = new Registry();
  await registry.load(plugin);
  const engine = new PipelineEngine(registry, { resolve: async () => ({ path: '/bin/true', version: '1' }) });
  const project = await Project.create({
    parentDir: await mkdtemp(path.join(tmpdir(), 'cs-')),
    name: 'T',
    pipeline: {
      preset: 'balanced',
      steps: [
        { key: 'a', stageId: 'test.a', enabled: true, params: {} },
        { key: 'b', stageId: 'test.b', enabled: true, params: {} },
      ],
    },
  });
  calls.length = 0;
  return { engine, project };
}

describe('PipelineEngine', () => {
  it('remembers step results in project.json, also once they are outdated', async () => {
    const { engine, project } = await setup();
    await engine.run(project);
    const reopened = await Project.open(project.dir);
    expect(reopened.meta.lastRun?.status).toBe('completed');
    expect(Object.keys(reopened.meta.steps ?? {})).toEqual(['a', 'b']);
    expect(reopened.meta.steps?.a.status).toBe('complete');

    // Change a param: the cache no longer matches, but the record survives.
    await reopened.update((m) => {
      m.pipeline.steps[0].params = { n: 2 };
    });
    const plan = await engine.plan(reopened);
    expect(plan.map((p) => p.cached)).toEqual([false, false]);
    expect(plan[0].last?.status).toBe('complete');
    expect(plan[0].last?.hash).not.toBe(plan[0].hash);
  });

  it('caches unchanged steps and re-runs only downstream of a param change', async () => {
    const { engine, project } = await setup();
    expect((await engine.run(project)).status).toBe('completed');
    expect(calls).toEqual(['a', 'b']);

    calls.length = 0;
    await engine.run(project);
    expect(calls).toEqual([]); // fully cached

    await project.update((m) => (m.pipeline.steps[0]!.params = { n: 2 }));
    await engine.run(project);
    expect(calls).toEqual(['a', 'b']); // a changed → b's input hash changed

    calls.length = 0;
    await engine.run(project, { force: ['b'] });
    expect(calls).toEqual(['b']);
  });

  it('a forced re-run makes every later step out of date, also for later runs', async () => {
    const { engine, project } = await setup();
    await engine.run(project);

    // Re-run only `a` (e.g. "Re-align cameras"): `b` must not stay cached on the old result.
    calls.length = 0;
    await engine.run(project, { untilKey: 'a', force: ['a'] });
    expect(calls).toEqual(['a']);
    expect((await engine.plan(project)).map((s) => s.cached)).toEqual([true, false]);

    calls.length = 0;
    await engine.run(project);
    expect(calls).toEqual(['b']);
    expect((await Project.open(project.dir)).meta.generations).toEqual({ a: 1 });
  });

  it('plan() and run() agree when cached outputs were deleted', async () => {
    const { engine, project } = await setup();
    await engine.run(project);
    const b = (await engine.plan(project))[1]!;
    await rm(path.join(project.paths.cache, 'test.b', b.hash, 'b.txt'));
    expect((await engine.plan(project)).map((s) => s.cached)).toEqual([true, false]);

    calls.length = 0;
    await engine.run(project);
    expect(calls).toEqual(['b']); // starts over, no resume from a "complete" dir
  });

  it('cancels and resumes a resumable stage in the same work dir', async () => {
    const { engine, project } = await setup();
    await project.update((m) => (m.pipeline.steps[1]!.params = { slow: true }));
    const events: EngineEvent[] = [];
    engine.on('event', (e) => events.push(e));
    const running = engine.run(project);
    await new Promise((r) => setTimeout(r, 50));
    engine.cancel();
    expect((await running).status).toBe('cancelled');
    expect(engine.running).toBeUndefined();

    calls.length = 0;
    expect((await engine.run(project)).status).toBe('completed');
    expect(calls).toEqual(['b:resume']);
    expect(events.some((e) => e.type === 'stage.cached' && e.key === 'a')).toBe(true);
  });

  it('plan() reports cached steps', async () => {
    const { engine, project } = await setup();
    expect((await engine.plan(project)).map((s) => s.cached)).toEqual([false, false]);
    await engine.run(project);
    expect((await engine.plan(project)).map((s) => s.cached)).toEqual([true, true]);
  });

  it('a changed video trim invalidates the steps that consume sources', async () => {
    const { engine, project } = await setup();
    const clip = path.join(project.dir, '..', 'clip.mp4');
    await writeFile(clip, 'not really a video');
    const [src] = await project.addSources([{ path: clip, trim: { start: 1, end: 4 } }], 'link');
    await engine.run(project);
    expect((await engine.plan(project)).map((s) => s.cached)).toEqual([true, true]);

    await project.updateSource(src!.id, { trim: { start: 2, end: 4 } });
    expect((await engine.plan(project)).map((s) => s.cached)).toEqual([false, false]);

    await project.updateSource(src!.id, { trim: { start: 1, end: 4 } });
    expect((await engine.plan(project)).map((s) => s.cached)).toEqual([true, true]);
  });
});

describe('notices', () => {
  it('turns StageError into an error notice and keeps info notices with the cache', async () => {
    const { StageError } = await import('./types.js');
    const registry = new Registry();
    let fail = true;
    await registry.load(
      definePlugin({
        id: 'n',
        name: 'N',
        version: '1',
        register(api) {
          api.registerStage(
            defineStage({
              id: 'n.a',
              version: '1',
              title: 'A',
              description: '',
              category: 'prepare',
              inputs: ['sources'],
              outputs: ['frames'],
              paramsSchema: z.object({}),
              async run(ctx) {
                ctx.notice({ level: 'info', title: 'hello' });
                if (fail) throw new StageError('Too few frames', { hint: 'Add more' });
                return { outputs: { frames: { path: ctx.workDir } } };
              },
            }),
          );
        },
      }),
    );
    const engine = new PipelineEngine(registry, { resolve: async () => ({ path: '/bin/true' }) });
    const project = await Project.create({
      parentDir: await mkdtemp(path.join(tmpdir(), 'cs-')),
      name: 'N',
      pipeline: { preset: 'fast', steps: [{ key: 'a', stageId: 'n.a', enabled: true, params: {} }] },
    });
    const events: EngineEvent[] = [];
    engine.on('event', (e) => events.push(e));
    expect((await engine.run(project)).status).toBe('failed');
    const notices = events.filter((e) => e.type === 'stage.notice').map((e) => (e as any).notice);
    expect(notices).toEqual([{ level: 'info', title: 'hello' }, { level: 'error', title: 'Too few frames', hint: 'Add more' }]);

    fail = false;
    await engine.run(project);
    events.length = 0;
    await engine.run(project);
    const cached = events.find((e) => e.type === 'stage.cached') as any;
    expect(cached.notices).toEqual([{ level: 'info', title: 'hello' }]);
    expect((await engine.plan(project))[0]!.notices).toEqual([{ level: 'info', title: 'hello' }]);
  });
});
