import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { definePlugin, defineStage, Project, Registry, type PipelineSpec } from '@splatcraft/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { assertRunId, listRuns, readMetrics, readNotices, validateSpec } from './pipeline';

async function registry() {
  const r = new Registry();
  await r.load(
    definePlugin({
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
            paramsSchema: z.object({ n: z.number().int().min(1).default(1) }),
            async run() {
              return { outputs: {} };
            },
          }),
        );
      },
    }),
  );
  return r;
}

const spec = (steps: unknown[]): PipelineSpec => ({ preset: 'fast', steps }) as PipelineSpec;

describe('validateSpec (renderer → main)', () => {
  it('normalizes a valid spec', async () => {
    const r = await registry();
    expect(validateSpec(r, spec([{ key: 'a', stageId: 'test.a', enabled: 1, params: { n: 2 } }]))).toEqual({
      preset: 'fast',
      steps: [{ key: 'a', stageId: 'test.a', enabled: true, params: { n: 2 } }],
    });
  });

  it('rejects unknown presets and stages, duplicate keys and bad params of enabled steps', async () => {
    const r = await registry();
    expect(() => validateSpec(r, { preset: 'ultra', steps: [] } as unknown as PipelineSpec)).toThrow(/Unknown preset/);
    expect(() => validateSpec(r, spec([{ key: 'a', stageId: 'nope', enabled: true, params: {} }]))).toThrow(/unknown stage/);
    expect(() =>
      validateSpec(r, spec([{ key: 'a', stageId: 'test.a', enabled: true, params: {} }, { key: 'a', stageId: 'test.a', enabled: true, params: {} }])),
    ).toThrow(/Duplicate step key/);
    expect(() => validateSpec(r, spec([{ key: 'a', stageId: 'test.a', enabled: true, params: { n: 0 } }]))).toThrow(/invalid parameters/);
    // Disabled steps keep whatever params they have.
    expect(validateSpec(r, spec([{ key: 'a', stageId: 'test.a', enabled: false, params: { n: 0 } }])).steps[0]!.params).toEqual({ n: 0 });
  });
});

describe('assertRunId', () => {
  it('only accepts plain directory names', () => {
    expect(() => assertRunId('2026-11-22T10-00-00_abc')).not.toThrow();
    for (const bad of ['..', '.', '../x', 'a/b', 'a\\b', '', 42]) expect(() => assertRunId(bad)).toThrow('Invalid run id');
  });
});

describe('run history on disk', () => {
  let parent: string;
  let project: Project;

  beforeAll(async () => {
    parent = await mkdtemp(path.join(tmpdir(), 'sc-runs-'));
    project = await Project.create({ name: 'Runs', parentDir: parent, pipeline: spec([]) });
    const run = async (id: string, startedAt: string, files: Record<string, string>) => {
      const dir = path.join(project.paths.runs, id);
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, 'run.json'), JSON.stringify({ runId: id, startedAt }));
      for (const [name, body] of Object.entries(files)) await writeFile(path.join(dir, name), body);
    };
    await run('r1', '2026-01-01T00:00:00Z', { 'result.json': JSON.stringify({ status: 'done', finishedAt: '2026-01-01T00:10:00Z' }) });
    await run('r2', '2026-01-02T00:00:00Z', {
      'metrics.jsonl': `${JSON.stringify({ key: 'train', step: 1, values: { loss: 0.5 } })}\n{"key":"train","st`,
      'notices.jsonl': `${JSON.stringify({ key: 'align', stageId: 'colmap', at: '2026-01-02T00:01:00Z', notice: { level: 'info', title: 'Hi' } })}\n`,
    });
  });
  afterAll(() => rm(parent, { recursive: true, force: true }));

  it('lists runs newest first; no result and not running means cancelled', async () => {
    expect((await listRuns(project)).map((r) => [r.runId, r.status])).toEqual([
      ['r2', 'cancelled'],
      ['r1', 'done'],
    ]);
    expect((await listRuns(project, 'r2'))[0]!.status).toBe('running');
  });

  it('reads metrics and notices, skipping a half-written last line', async () => {
    expect(await readMetrics(project, 'r2')).toEqual([{ key: 'train', step: 1, values: { loss: 0.5 } }]);
    expect(await readMetrics(project, 'r1')).toEqual([]);
    expect((await readNotices(project)).map((n) => n.notice.title)).toEqual(['Hi']); // default: newest run
    await expect(readMetrics(project, '../r1')).rejects.toThrow('Invalid run id');
  });
});
